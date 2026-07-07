from fastapi import APIRouter, BackgroundTasks, Depends, File, HTTPException, Query, UploadFile
import io
from fastapi.responses import FileResponse, StreamingResponse
from typing import Optional
from pydantic import BaseModel
from datetime import datetime, timezone
import os
import uuid
from auth import get_current_user, require_admin, require_permission
from odoo_client import get_odoo_client
from database import col, NO_ID
from middleware.audit import audit_log
from routes.settings_routes import get_email_routing
from services.email_service import (
    send_onboarding_submitted, send_onboarding_approved,
    send_onboarding_rejected,
)
from services.r2_client import r2_put, r2_delete, r2_presign, r2_get

router = APIRouter(prefix="/api/onboarding", tags=["onboarding"])

SA_PROVINCES = [
    "Gauteng", "Western Cape", "KwaZulu-Natal", "Eastern Cape",
    "Limpopo", "Mpumalanga", "North West", "Free State", "Northern Cape",
]

_TEMPLATE_DIR = os.path.join(os.path.dirname(__file__), "..", "static", "onboarding-templates")

# Hardcoded manifest — prevents directory traversal, controls display names
TEMPLATES: dict[str, str] = {
    "store-onboarding-agreement.pdf": "Store Onboarding Agreement",
    "customer-information-form.pdf":  "Customer Information Form",
    "nda.pdf":                        "NDA",
    "tqa.pdf":                        "TQA Document",
}

# All five are required before an application can be submitted or approved
REQUIRED_DOC_TYPES: dict[str, str] = {
    "store_onboarding_agreement": "Signed Store Onboarding Agreement",
    "customer_information_form":  "Signed Customer Information Form",
    "nda":                        "Signed NDA",
    "tqa":                        "Signed TQA Document",
    "cipc_certificate":           "CIPC Company Registration Certificate",
}

# Subset of REQUIRED_DOC_TYPES that have a Bassani signature field and therefore
# require countersigning by the signing authority holder before approval.
BASSANI_SIG_DOC_TYPES: frozenset[str] = frozenset({"nda", "tqa", "store_onboarding_agreement"})


# ── Pydantic models ───────────────────────────────────────────────────────────

class OnboardingApplication(BaseModel):
    # Step 0 — Documents (uploaded to R2 before form submission)
    document_session_id: Optional[str] = None
    documents:           Optional[list] = []

    # Step 1 — Business details
    company_name:        str
    trading_name:        Optional[str] = ""
    registration_number: Optional[str] = ""
    vat_number:          Optional[str] = ""
    business_type:       str = "Pharmacy"

    # Step 2 — Primary contact
    contact_name:      str
    contact_position:  Optional[str] = ""
    contact_email:     str
    contact_phone:     str
    contact_alt_phone: Optional[str] = ""

    # Step 3 — Business address
    street:      str
    suburb:      Optional[str] = ""
    city:        str
    province:    Optional[str] = ""
    postal_code: Optional[str] = ""
    country:     str = "South Africa"

    # Step 4 — Additional information
    ordering_volume: Optional[str] = ""
    referral_source: Optional[str] = ""
    notes:           Optional[str] = ""


class RejectBody(BaseModel):
    reason: str


class ApproveLinkBody(BaseModel):
    odoo_partner_id: int


class TemplateEmailBody(BaseModel):
    to_email:      str
    customer_name: Optional[str] = ""


class InviteBody(BaseModel):
    to_email:         str
    customer_name:    Optional[str] = ""
    registration_url: str  # full URL (with ?ref= if applicable), constructed by the frontend


class ContactApplicantBody(BaseModel):
    subject: Optional[str] = ""
    message: str


class ApproveBody(BaseModel):
    company_name: Optional[str] = None  # required for inbox-sourced apps that have no company_name yet


class UpdateApplicationBody(BaseModel):
    company_name:        Optional[str] = None
    trading_name:        Optional[str] = None
    registration_number: Optional[str] = None
    vat_number:          Optional[str] = None
    business_type:       Optional[str] = None
    contact_name:        Optional[str] = None
    contact_position:    Optional[str] = None
    contact_email:       Optional[str] = None
    contact_phone:       Optional[str] = None
    contact_alt_phone:   Optional[str] = None
    street:              Optional[str] = None
    suburb:              Optional[str] = None
    city:                Optional[str] = None
    province:            Optional[str] = None
    postal_code:         Optional[str] = None
    country:             Optional[str] = None
    ordering_volume:     Optional[str] = None
    referral_source:     Optional[str] = None
    notes:               Optional[str] = None


# ── Template endpoints ────────────────────────────────────────────────────────

@router.get("/templates")
async def list_templates(current_user: dict = Depends(get_current_user)):
    """List available Bassani onboarding template documents."""
    result = []
    for filename, label in TEMPLATES.items():
        fpath = os.path.join(_TEMPLATE_DIR, filename)
        result.append({
            "filename": filename,
            "label":    label,
            "available": os.path.exists(fpath),
        })
    return {"templates": result}


@router.get("/templates/download/{filename}")
async def download_template(filename: str, current_user: dict = Depends(get_current_user)):
    """Stream a Bassani onboarding template PDF for download."""
    if filename not in TEMPLATES:
        raise HTTPException(status_code=404, detail="Template not found")

    # Serve managed R2 version if one has been uploaded; fall back to static file
    from routes.doc_template_routes import FILENAME_TO_DOC_TYPE, get_active_template_bytes
    doc_type = FILENAME_TO_DOC_TYPE.get(filename)
    if doc_type:
        data = await get_active_template_bytes(doc_type)
        if data:
            return StreamingResponse(
                io.BytesIO(data),
                media_type="application/pdf",
                headers={"Content-Disposition": f'attachment; filename="{filename}"'},
            )

    fpath = os.path.join(_TEMPLATE_DIR, filename)
    if not os.path.exists(fpath):
        raise HTTPException(status_code=404, detail="Template file not yet available on this server")
    return FileResponse(fpath, media_type="application/pdf", filename=filename)


@router.post("/templates/email")
async def email_templates(
    body: TemplateEmailBody,
    background_tasks: BackgroundTasks,
    current_user: dict = Depends(get_current_user),
):
    """
    Email all four Bassani template PDFs to the customer's email address.
    Uses the connected onboarding mailbox (Graph or IMAP) so the email comes
    from the business address and customer replies land in the Onboarding Inbox.
    """
    if not body.to_email.strip():
        raise HTTPException(status_code=400, detail="Email address required")

    from services.imap_client import get_config as _imap_cfg, get_graph_mailbox_address
    from services.graph_client import graph_configured

    onboarding_graph_address = get_graph_mailbox_address("onboarding")
    imap_cfg = _imap_cfg("onboarding")
    use_graph = graph_configured() and bool(onboarding_graph_address)

    if not use_graph and not imap_cfg:
        raise HTTPException(
            status_code=503,
            detail="Onboarding mailbox not configured. Set up the mailbox in Settings before sending documents.",
        )

    _TEMPLATE_DIR = os.path.join(os.path.dirname(__file__), "..", "static", "onboarding-templates")
    _TEMPLATES = [
        ("store-onboarding-agreement.pdf", "Bassani Health Store Onboarding Agreement"),
        ("customer-information-form.pdf",  "Bassani Health Customer Information Form"),
        ("nda.pdf",                        "Bassani Health NDA"),
        ("tqa.pdf",                        "Bassani Health TQA Document"),
    ]
    file_attachments = []
    for filename, display_name in _TEMPLATES:
        fpath = os.path.join(_TEMPLATE_DIR, filename)
        if os.path.exists(fpath):
            with open(fpath, "rb") as f:
                file_attachments.append({
                    "filename":     f"{display_name}.pdf",
                    "content":      f.read(),
                    "content_type": "application/pdf",
                })

    from services.email_service import _wrap as _email_wrap, _h1, _p, _info_box, _divider
    body_html = _email_wrap(
        _h1("Your onboarding documents")
        + _p("Please find your Bassani Health onboarding documents attached to this email.")
        + _p(
            "Once you have completed and signed all documents, please "
            "<strong>reply directly to this email</strong> with all five signed documents "
            "attached. Our onboarding team will review them and activate your account."
        )
        + _info_box([
            ("Attached templates",   f"{len(file_attachments)} documents"),
            ("Also required",        "CIPC Company Registration Certificate"),
            ("How to return signed docs", "Reply directly to this email with all five attached"),
        ])
        + _divider()
        + _p(
            "If you have any questions before returning your documents, please reply to this email "
            "and a member of the team will assist you.", muted=True
        ),
        footer_note=(
            "Please reply to this email with your five completed documents attached. "
            "Bassani Health &nbsp;&middot;&nbsp; Cnr Dytchley &amp; Marcius Roads, Kyalami"
        ),
    )
    subject = "Bassani Health: Onboarding Documents"
    from_address = onboarding_graph_address if use_graph else (
        imap_cfg.get("mailbox_address") or imap_cfg.get("imap_username", "")
    )

    # Create thread root in the onboarding inbox so the customer's reply
    # auto-threads and appears in the Onboarding Inbox for staff to action.
    now = datetime.now(timezone.utc)
    thread_doc = {
        "mailbox_address": from_address,
        "from_email":      from_address,
        "from_name":       "Bassani Health",
        "to_email":        body.to_email.strip(),
        "subject":         subject,
        "body_html":       body_html,
        "body_preview":    f"Onboarding documents sent to {body.to_email.strip()}",
        "is_outgoing":     True,
        "status":          "sent",
        "received_at":     now,
        "has_attachments": bool(file_attachments),
        "attachments":     [{"name": a["filename"]} for a in file_attachments],
        "thread_root_id":  None,
        "is_read":         True,
        "created_at":      now,
        "sent_by":         current_user.get("username"),
    }
    result = await col("onboarding_inbox").insert_one(thread_doc)
    item_id_str = str(result.inserted_id)
    thread_stamp: dict = {"thread_root_id": item_id_str}

    # When a reseller sends onboarding docs, create a draft application so the
    # customer remains associated with that reseller once their account is created.
    application_id: str | None = None
    if current_user.get("role") == "reseller":
        reseller = await col("resellers").find_one({"user_id": current_user["id"]}, NO_ID)
        if reseller:
            app_ref = "APP-" + str(uuid.uuid4())[:8].upper()
            await col("customer_onboarding").insert_one({
                "id":            app_ref,
                "reseller_id":   reseller.get("id"),
                "reseller_name": reseller.get("name", current_user.get("username", "")),
                "status":        "awaiting_docs",
                "source":        "inbox",
                "contact_email": body.to_email.strip(),
                "contact_name":  (body.customer_name or "").strip(),
                "company_name":  (body.customer_name or "").strip(),
                "inbox_thread_id": item_id_str,
                "created_at":    now,
                "submitted_at":  None,
                "reviewed_at":   None,
                "reviewed_by":   None,
                "documents":     [],
            })
            application_id = app_ref
            thread_stamp["application_id"] = app_ref
            thread_stamp["reseller_id"]    = reseller.get("id")
            thread_stamp["reseller_name"]  = reseller.get("name", "")
            thread_stamp["status"]         = "application_linked"

    await col("onboarding_inbox").update_one(
        {"_id": result.inserted_id},
        {"$set": thread_stamp},
    )

    async def _do_send():
        try:
            if use_graph:
                from services.graph_client import send_mail as graph_send_mail
                await graph_send_mail(
                    to_email=body.to_email.strip(),
                    subject=subject,
                    body_html=body_html,
                    file_attachments=file_attachments,
                    mailbox_address=onboarding_graph_address,
                )
            else:
                from services.imap_client import send_new_email as imap_send_new
                message_id = await imap_send_new(
                    to_email=body.to_email.strip(),
                    subject=subject,
                    body_html=body_html,
                    file_attachments=file_attachments,
                    mailbox="onboarding",
                )
                await col("onboarding_inbox").update_one(
                    {"_id": result.inserted_id},
                    {"$set": {"imap_message_id": message_id}},
                )
        except Exception as exc:
            import logging as _log
            _log.getLogger(__name__).error(
                "onboarding.email_templates_send_failed to=%s error=%s",
                body.to_email, exc,
            )

    background_tasks.add_task(_do_send)
    background_tasks.add_task(
        audit_log,
        "onboarding.email_templates_sent", "onboarding_inbox", item_id_str,
        entity_label=body.to_email.strip(),
        user=current_user,
        after={"to_email": body.to_email.strip()},
    )
    return {"success": True, "item_id": item_id_str, "application_id": application_id}


@router.post("/invite")
async def send_registration_invite(
    body: InviteBody,
    background_tasks: BackgroundTasks,
    current_user: dict = Depends(get_current_user),
):
    """
    Email a self-registration invitation link to a prospective customer.
    The link (and any referral code) is constructed by the frontend so the
    backend never needs to know the portal's public URL.
    Sent from the onboarding mailbox — replies thread back into Onboarding Inbox.
    """
    if not body.to_email.strip():
        raise HTTPException(status_code=400, detail="Email address required")
    if not body.registration_url.strip():
        raise HTTPException(status_code=400, detail="Registration URL required")

    from services.imap_client import get_config as _imap_cfg, get_graph_mailbox_address
    from services.graph_client import graph_configured
    from services.email_service import _wrap as _email_wrap, _h1, _p, _divider

    onboarding_graph_address = get_graph_mailbox_address("onboarding")
    imap_cfg = _imap_cfg("onboarding")
    use_graph = graph_configured() and bool(onboarding_graph_address)

    if not use_graph and not imap_cfg:
        raise HTTPException(
            status_code=503,
            detail="Onboarding mailbox not configured. Set up the mailbox in Settings before sending invitations.",
        )

    from_address = onboarding_graph_address if use_graph else (
        imap_cfg.get("mailbox_address") or imap_cfg.get("imap_username", "")
    )

    reg_url = body.registration_url.strip()
    customer_name = body.customer_name.strip() if body.customer_name else None
    greeting = f"Hi {customer_name}," if customer_name else "Hi,"
    subject = "You're invited to register with Bassani Health"

    body_html = _email_wrap(
        _h1("Register with Bassani Health")
        + _p(greeting)
        + _p(
            "You have been invited to complete your registration with Bassani Health. "
            "Click the button below to get started. You will be guided through a short "
            "registration form and asked to upload your signed documents."
        )
        + f"""<table width="100%" cellpadding="0" cellspacing="0" border="0" style="margin:24px 0;">
          <tr><td align="center">
            <a href="{reg_url}"
               style="display:inline-block;padding:12px 28px;background:#0f6e56;color:#fff;font-size:14px;font-weight:700;text-decoration:none;border-radius:8px;letter-spacing:-0.2px;">
              Start Registration
            </a>
          </td></tr>
        </table>"""
        + _p(
            f'Or copy this link: <a href="{reg_url}" style="color:#0f6e56;word-break:break-all;">{reg_url}</a>',
            muted=True,
        )
        + _divider()
        + _p(
            "If you were not expecting this invitation, you can safely ignore this email.",
            muted=True,
        ),
        footer_note="Bassani Health &nbsp;&middot;&nbsp; Cnr Dytchley &amp; Marcius Roads, Kyalami",
    )

    now = datetime.now(timezone.utc)
    thread_doc = {
        "mailbox_address": from_address,
        "from_email":      from_address,
        "from_name":       "Bassani Health",
        "to_email":        body.to_email.strip(),
        "subject":         subject,
        "body_html":       body_html,
        "body_preview":    f"Registration invitation sent to {body.to_email.strip()}",
        "is_outgoing":     True,
        "status":          "sent",
        "received_at":     now,
        "has_attachments": False,
        "attachments":     [],
        "thread_root_id":  None,
        "is_read":         True,
        "created_at":      now,
        "sent_by":         current_user.get("username"),
    }
    result = await col("onboarding_inbox").insert_one(thread_doc)
    item_id_str = str(result.inserted_id)
    await col("onboarding_inbox").update_one(
        {"_id": result.inserted_id},
        {"$set": {"thread_root_id": item_id_str}},
    )

    async def _do_send():
        try:
            if use_graph:
                from services.graph_client import send_mail as graph_send_mail
                await graph_send_mail(
                    to_email=body.to_email.strip(),
                    subject=subject,
                    body_html=body_html,
                    mailbox_address=onboarding_graph_address,
                )
            else:
                from services.imap_client import send_new_email as imap_send_new
                message_id = await imap_send_new(
                    to_email=body.to_email.strip(),
                    subject=subject,
                    body_html=body_html,
                    mailbox="onboarding",
                )
                await col("onboarding_inbox").update_one(
                    {"_id": result.inserted_id},
                    {"$set": {"imap_message_id": message_id}},
                )
        except Exception as exc:
            import logging as _log
            _log.getLogger(__name__).error(
                "onboarding.invite_send_failed to=%s error=%s", body.to_email, exc
            )

    background_tasks.add_task(_do_send)
    background_tasks.add_task(
        audit_log,
        "onboarding.invite_sent", "onboarding_inbox", item_id_str,
        entity_label=body.to_email.strip(),
        user=current_user,
        after={"to_email": body.to_email.strip()},
    )

    return {"success": True}


@router.post("/{app_id}/contact")
async def contact_applicant(
    app_id: str,
    body: ContactApplicantBody,
    background_tasks: BackgroundTasks,
    current_user: dict = Depends(require_permission("customers.approve_onboarding")),
):
    """
    Initiate a correspondence thread with an applicant from the application detail view.
    Creates an onboarding inbox thread linked to the application and sends the message
    from the onboarding mailbox. Only valid when no thread exists yet.
    """
    if not body.message.strip():
        raise HTTPException(status_code=400, detail="Message body required")

    app = await col("customer_onboarding").find_one({"id": app_id}, NO_ID)
    if not app:
        raise HTTPException(status_code=404, detail="Application not found")

    contact_email = app.get("contact_email", "").strip()
    if not contact_email:
        raise HTTPException(status_code=400, detail="This application has no contact email address")

    if app.get("inbox_thread_id"):
        raise HTTPException(status_code=409, detail="An inbox thread already exists for this application")

    from services.imap_client import get_config as _imap_cfg, get_graph_mailbox_address
    from services.graph_client import graph_configured

    onboarding_graph_address = get_graph_mailbox_address("onboarding")
    imap_cfg = _imap_cfg("onboarding")
    use_graph = graph_configured() and bool(onboarding_graph_address)

    if not use_graph and not imap_cfg:
        raise HTTPException(
            status_code=503,
            detail="Onboarding mailbox not configured. Set up the mailbox in Settings before sending messages.",
        )

    from_address = onboarding_graph_address if use_graph else (
        imap_cfg.get("mailbox_address") or imap_cfg.get("imap_username", "")
    )

    company_name = app.get("company_name") or app.get("contact_name") or "Applicant"
    subject = body.subject.strip() if body.subject and body.subject.strip() else f"Your application: {company_name}"

    from services.email_service import _wrap as _email_wrap, _p, _divider
    body_html = _email_wrap(
        _p(body.message.strip().replace("\n", "<br>"))
        + _divider()
        + _p(f"Application reference: <strong>{app_id}</strong>", muted=True)
    )

    now = datetime.now(timezone.utc)
    thread_doc = {
        "mailbox_address": from_address,
        "from_email":      from_address,
        "from_name":       "Bassani Health",
        "to_email":        contact_email,
        "subject":         subject,
        "body_html":       body_html,
        "body_preview":    body.message.strip()[:120],
        "is_outgoing":     True,
        "status":          "application_linked",
        "received_at":     now,
        "has_attachments": False,
        "attachments":     [],
        "thread_root_id":  None,
        "is_read":         True,
        "created_at":      now,
        "sent_by":         current_user.get("username"),
        "application_id":  app_id,
        "reseller_id":     app.get("reseller_id"),
        "reseller_name":   app.get("reseller_name"),
    }

    result = await col("onboarding_inbox").insert_one(thread_doc)
    item_id_str = str(result.inserted_id)

    await col("onboarding_inbox").update_one(
        {"_id": result.inserted_id},
        {"$set": {"thread_root_id": item_id_str}},
    )
    await col("customer_onboarding").update_one(
        {"id": app_id},
        {"$set": {"inbox_thread_id": item_id_str}},
    )

    async def _do_send():
        try:
            if use_graph:
                from services.graph_client import send_mail as graph_send_mail
                await graph_send_mail(
                    to_email=contact_email,
                    subject=subject,
                    body_html=body_html,
                    mailbox_address=onboarding_graph_address,
                )
            else:
                from services.imap_client import send_new_email as imap_send_new
                message_id = await imap_send_new(
                    to_email=contact_email,
                    subject=subject,
                    body_html=body_html,
                    mailbox="onboarding",
                )
                await col("onboarding_inbox").update_one(
                    {"_id": result.inserted_id},
                    {"$set": {"imap_message_id": message_id}},
                )
        except Exception as exc:
            import logging as _log
            _log.getLogger(__name__).error(
                "onboarding.contact_send_failed app=%s error=%s", app_id, exc
            )

    background_tasks.add_task(_do_send)
    background_tasks.add_task(
        audit_log,
        "onboarding.contact_sent", "customer_onboarding", app_id,
        entity_label=company_name,
        user=current_user,
        after={"to_email": contact_email, "inbox_thread_id": item_id_str},
    )

    return {"inbox_thread_id": item_id_str, "to_email": contact_email}


# ── Document upload endpoints ─────────────────────────────────────────────────

@router.post("/documents/upload")
async def upload_document(
    session_id: str,
    doc_type:   str,
    file: UploadFile = File(...),
    current_user: dict = Depends(get_current_user),
):
    """Upload a signed document or CIPC certificate to R2 for an onboarding session."""
    role  = current_user.get("role")
    perms = current_user.get("permissions", {})
    is_admin = current_user.get("is_super_admin") or perms.get("customers", {}).get("manage")
    if role != "reseller" and not is_admin:
        raise HTTPException(status_code=403, detail="Not authorised to upload onboarding documents")
    if doc_type not in REQUIRED_DOC_TYPES:
        raise HTTPException(status_code=400, detail=f"Unknown document type: {doc_type}")

    ext = os.path.splitext(file.filename or "")[1] or ".pdf"
    key = f"onboarding/sessions/{session_id}/{doc_type}{ext}"
    contents = await file.read()

    await r2_put(key, contents, file.content_type or "application/octet-stream")

    return {
        "doc_type":    doc_type,
        "label":       REQUIRED_DOC_TYPES[doc_type],
        "r2_key":      key,
        "filename":    file.filename,
        "size":        len(contents),
        "uploaded_at": datetime.now(timezone.utc).isoformat(),
    }


@router.delete("/documents/{session_id}/{doc_type}")
async def delete_document(
    session_id: str,
    doc_type:   str,
    current_user: dict = Depends(get_current_user),
):
    """Remove an uploaded document from R2 (before the application is submitted)."""
    role  = current_user.get("role")
    perms = current_user.get("permissions", {})
    is_admin = current_user.get("is_super_admin") or perms.get("customers", {}).get("manage")
    if role != "reseller" and not is_admin:
        raise HTTPException(status_code=403, detail="Not authorised to remove onboarding documents")
    if doc_type not in REQUIRED_DOC_TYPES:
        raise HTTPException(status_code=400, detail=f"Unknown document type: {doc_type}")

    # Try both .pdf and other common extensions
    for ext in [".pdf", ".jpg", ".jpeg", ".png", ".doc", ".docx"]:
        key = f"onboarding/sessions/{session_id}/{doc_type}{ext}"
        try:
            await r2_delete(key)
        except Exception:
            pass
    return {"success": True}


# ── Application list / detail endpoints ───────────────────────────────────────

@router.get("/pending-count")
async def pending_count(current_user: dict = Depends(require_admin)):
    """Used by the admin nav badge."""
    count = await col("customer_onboarding").count_documents({"status": "pending"})
    return {"count": count}


@router.get("/")
async def list_applications(
    status: Optional[str] = None,
    limit:  int = Query(50, le=200),
    offset: int = 0,
    current_user: dict = Depends(get_current_user),
):
    query: dict = {}

    if current_user.get("role") == "reseller":
        reseller = await col("resellers").find_one({"user_id": current_user["id"]}, NO_ID)
        query["reseller_id"] = reseller["id"] if reseller else "__none__"

    if status and status != "all":
        query["status"] = status

    total = await col("customer_onboarding").count_documents(query)
    apps = await (
        col("customer_onboarding")
        .find(query, NO_ID)
        .sort("submitted_at", -1)
        .skip(offset)
        .limit(limit)
        .to_list(length=limit)
    )
    return {"applications": apps, "total": total}


@router.post("/")
async def submit_application(
    application: OnboardingApplication,
    background_tasks: BackgroundTasks,
    current_user: dict = Depends(get_current_user),
):
    """Reseller submits a customer onboarding application for admin review."""
    if current_user.get("role") != "reseller":
        raise HTTPException(status_code=403, detail="Only resellers can submit onboarding applications")

    reseller = await col("resellers").find_one({"user_id": current_user["id"]}, NO_ID)
    if not reseller:
        raise HTTPException(status_code=400, detail="Reseller profile not found")

    # Enforce all 5 required documents before submission
    submitted_types = {d.get("doc_type") for d in (application.documents or [])}
    missing = [label for dtype, label in REQUIRED_DOC_TYPES.items() if dtype not in submitted_types]
    if missing:
        raise HTTPException(
            status_code=400,
            detail=f"Missing required documents: {', '.join(missing)}",
        )

    ref = f"APP-{str(uuid.uuid4())[:8].upper()}"

    doc = {
        "id":                  ref,
        "reseller_id":         reseller["id"],
        "reseller_name":       reseller.get("name", current_user.get("username", "")),
        "status":              "pending",
        "submitted_at":        datetime.now(timezone.utc),
        "reviewed_at":         None,
        "reviewed_by":         None,
        "rejection_reason":    None,
        "odoo_partner_id":     None,
        "document_session_id": application.document_session_id,
        "documents":           application.documents or [],
        **{k: v for k, v in application.model_dump().items()
           if k not in ("document_session_id", "documents")},
    }
    await col("customer_onboarding").insert_one(doc)
    await audit_log("onboarding.submit", "customer_onboarding", ref,
                    entity_label=application.company_name, user=current_user,
                    reseller_id=reseller["id"])
    routing = await get_email_routing()
    background_tasks.add_task(
        send_onboarding_submitted,
        company_name=application.company_name,
        reseller_name=reseller.get("name", current_user.get("username", "")),
        app_ref=ref,
        to=routing["application_submitted_to"],
    )
    return {"success": True, "reference": ref}


@router.get("/{app_id}/documents")
async def get_application_documents(
    app_id: str,
    current_user: dict = Depends(get_current_user),
):
    """Return presigned R2 download URLs for all uploaded documents on an application.
    Admins require customers.approve_onboarding; resellers may view their own application's docs."""
    app = await col("customer_onboarding").find_one({"id": app_id}, NO_ID)
    if not app:
        raise HTTPException(status_code=404, detail="Application not found")

    if current_user.get("role") == "reseller":
        reseller = await col("resellers").find_one({"user_id": current_user["id"]}, NO_ID)
        if not reseller or app.get("reseller_id") != reseller["id"]:
            raise HTTPException(status_code=403, detail="Access denied")
    else:
        perms = current_user.get("permissions", {})
        if not (current_user.get("is_super_admin") or perms.get("customers", {}).get("approve_onboarding")):
            raise HTTPException(status_code=403, detail="Permission denied")

    docs = app.get("documents") or []
    result = []
    for d in docs:
        key = d.get("r2_key")
        if key:
            try:
                url = await r2_presign(key, expires=3600)
                result.append({**d, "download_url": url})
            except Exception:
                result.append({**d, "download_url": None})
        else:
            result.append({**d, "download_url": None})

    return {"documents": result}


@router.get("/{app_id}/documents/{doc_type}/download")
async def download_application_document(
    app_id:   str,
    doc_type: str,
    current_user: dict = Depends(get_current_user),
):
    """
    Proxy an R2 document download through the backend so the browser
    can fetch bytes without hitting R2 directly (avoids CORS issues
    with presigned URLs when used in fetch() + arrayBuffer()).
    Used by the CountersignModal to load the customer-signed PDF.
    """
    app = await col("customer_onboarding").find_one({"id": app_id}, NO_ID)
    if not app:
        raise HTTPException(status_code=404, detail="Application not found")

    perms = current_user.get("permissions", {})
    if not (current_user.get("is_super_admin") or perms.get("customers", {}).get("approve_onboarding")):
        raise HTTPException(status_code=403, detail="Permission denied")

    docs = app.get("documents") or []
    doc  = next((d for d in docs if d.get("doc_type") == doc_type), None)
    if not doc or not doc.get("r2_key"):
        raise HTTPException(status_code=404, detail=f"Document '{doc_type}' not found")

    try:
        data = await r2_get(doc["r2_key"])
    except Exception:
        raise HTTPException(status_code=502, detail="Could not retrieve document from storage")

    import io
    return StreamingResponse(
        io.BytesIO(data),
        media_type="application/pdf",
        headers={"Content-Disposition": f'inline; filename="{doc_type}.pdf"'},
    )


@router.get("/{app_id}")
async def get_application(app_id: str, current_user: dict = Depends(get_current_user)):
    app = await col("customer_onboarding").find_one({"id": app_id}, NO_ID)
    if not app:
        raise HTTPException(status_code=404, detail="Application not found")
    if current_user.get("role") == "reseller":
        reseller = await col("resellers").find_one({"user_id": current_user["id"]}, NO_ID)
        if not reseller or app.get("reseller_id") != reseller["id"]:
            raise HTTPException(status_code=403, detail="Access denied")
    return app


@router.put("/{app_id}")
async def update_application(
    app_id: str,
    body: UpdateApplicationBody,
    current_user: dict = Depends(get_current_user),
):
    """Reseller updates the text fields of their own pending application."""
    if current_user.get("role") != "reseller":
        raise HTTPException(status_code=403, detail="Only resellers can update applications")
    reseller = await col("resellers").find_one({"user_id": current_user["id"]}, NO_ID)
    if not reseller:
        raise HTTPException(status_code=403, detail="Reseller profile not found")

    app = await col("customer_onboarding").find_one({"id": app_id}, NO_ID)
    if not app:
        raise HTTPException(status_code=404, detail="Application not found")
    if app.get("reseller_id") != reseller["id"]:
        raise HTTPException(status_code=403, detail="Access denied")
    if app.get("status") not in {"pending", "awaiting_docs"}:
        raise HTTPException(status_code=400, detail="Only pending or draft applications can be updated")

    updates = body.model_dump(exclude_unset=True)
    if not updates:
        raise HTTPException(status_code=400, detail="No fields provided")
    updates["updated_at"] = datetime.now(timezone.utc)

    await col("customer_onboarding").update_one({"id": app_id}, {"$set": updates})
    await audit_log("onboarding.update", "customer_onboarding", app_id,
                    entity_label=app.get("company_name", ""), user=current_user,
                    reseller_id=reseller["id"], after=updates)
    return {"success": True}


@router.post("/{app_id}/submit")
async def submit_draft_application(
    app_id: str,
    background_tasks: BackgroundTasks,
    current_user: dict = Depends(get_current_user),
):
    """Reseller submits an awaiting_docs draft application for admin review."""
    if current_user.get("role") != "reseller":
        raise HTTPException(status_code=403, detail="Only resellers can submit applications")
    reseller = await col("resellers").find_one({"user_id": current_user["id"]}, NO_ID)
    if not reseller:
        raise HTTPException(status_code=403, detail="Reseller profile not found")

    app = await col("customer_onboarding").find_one({"id": app_id}, NO_ID)
    if not app:
        raise HTTPException(status_code=404, detail="Application not found")
    if app.get("reseller_id") != reseller["id"]:
        raise HTTPException(status_code=403, detail="Access denied")
    if app.get("status") != "awaiting_docs":
        raise HTTPException(status_code=400, detail="Only draft applications can be submitted this way")

    required_fields = [
        ("company_name",  "Company name"),
        ("contact_name",  "Contact name"),
        ("contact_email", "Contact email"),
        ("contact_phone", "Contact phone"),
        ("street",        "Street address"),
        ("city",          "City"),
    ]
    for field, label in required_fields:
        if not (app.get(field) or "").strip():
            raise HTTPException(status_code=400, detail=f"{label} is required before submitting")

    submitted_types = {d.get("doc_type") for d in (app.get("documents") or [])}
    missing = [lbl for dtype, lbl in REQUIRED_DOC_TYPES.items() if dtype not in submitted_types]
    if missing:
        raise HTTPException(
            status_code=400,
            detail=f"Missing required documents: {', '.join(missing)}",
        )

    now = datetime.now(timezone.utc)
    await col("customer_onboarding").update_one(
        {"id": app_id},
        {"$set": {"status": "pending", "submitted_at": now}},
    )
    await audit_log(
        "onboarding.submit", "customer_onboarding", app_id,
        entity_label=app.get("company_name", ""), user=current_user,
        before={"status": "awaiting_docs"}, after={"status": "pending"},
        reseller_id=reseller["id"],
    )
    routing = await get_email_routing()
    background_tasks.add_task(
        send_onboarding_submitted,
        company_name=app.get("company_name", ""),
        reseller_name=reseller.get("name", current_user.get("username", "")),
        app_ref=app_id,
        to=routing["application_submitted_to"],
    )
    return {"success": True, "reference": app_id}


@router.post("/{app_id}/documents/{doc_type}")
async def replace_application_document(
    app_id: str,
    doc_type: str,
    file: UploadFile = File(...),
    current_user: dict = Depends(get_current_user),
):
    """Reseller replaces a specific document on their own pending application."""
    if current_user.get("role") != "reseller":
        raise HTTPException(status_code=403, detail="Only resellers can replace application documents")
    reseller = await col("resellers").find_one({"user_id": current_user["id"]}, NO_ID)
    if not reseller:
        raise HTTPException(status_code=403, detail="Reseller profile not found")

    app = await col("customer_onboarding").find_one({"id": app_id}, NO_ID)
    if not app:
        raise HTTPException(status_code=404, detail="Application not found")
    if app.get("reseller_id") != reseller["id"]:
        raise HTTPException(status_code=403, detail="Access denied")
    if app.get("status") != "pending":
        raise HTTPException(status_code=400, detail="Only pending applications can be updated")
    if doc_type not in REQUIRED_DOC_TYPES:
        raise HTTPException(status_code=400, detail=f"Unknown document type: {doc_type}")

    session_id = app.get("document_session_id")
    if not session_id:
        raise HTTPException(status_code=400, detail="Application has no document session")

    # Remove old file(s) for this doc type from R2
    for ext in [".pdf", ".jpg", ".jpeg", ".png", ".doc", ".docx"]:
        try:
            await r2_delete(f"onboarding/sessions/{session_id}/{doc_type}{ext}")
        except Exception:
            pass

    # Upload new file
    ext = os.path.splitext(file.filename or "")[1] or ".pdf"
    key = f"onboarding/sessions/{session_id}/{doc_type}{ext}"
    contents = await file.read()
    await r2_put(key, contents, file.content_type or "application/octet-stream")

    now = datetime.now(timezone.utc)
    new_doc = {
        "doc_type":    doc_type,
        "label":       REQUIRED_DOC_TYPES[doc_type],
        "r2_key":      key,
        "filename":    file.filename,
        "size":        len(contents),
        "uploaded_at": now,
    }

    # Replace the existing doc in the documents array
    docs = [d for d in (app.get("documents") or []) if d.get("doc_type") != doc_type]
    docs.append(new_doc)
    await col("customer_onboarding").update_one(
        {"id": app_id},
        {"$set": {"documents": docs, "updated_at": now}},
    )
    await audit_log("onboarding.replace_document", "customer_onboarding", app_id,
                    entity_label=app.get("company_name", ""), user=current_user,
                    reseller_id=reseller["id"], after={"doc_type": doc_type, "filename": file.filename})
    return new_doc


@router.post("/{app_id}/countersign/{doc_type}")
async def countersign_document(
    app_id:   str,
    doc_type: str,
    file: UploadFile = File(...),
    current_user: dict = Depends(require_permission("customers.approve_onboarding")),
):
    """
    Upload a countersigned PDF for a portal-signed onboarding document.

    Only documents in BASSANI_SIG_DOC_TYPES can be countersigned.  The
    countersigned file overwrites the original at the same R2 key so there is
    always exactly one copy per document.  The MongoDB record is updated with
    countersign metadata (who, when) which serves as the audit trail.
    """
    if doc_type not in BASSANI_SIG_DOC_TYPES:
        raise HTTPException(
            status_code=400,
            detail=f"Document type '{doc_type}' does not require countersigning",
        )

    app = await col("customer_onboarding").find_one({"id": app_id}, NO_ID)
    if not app:
        raise HTTPException(status_code=404, detail="Application not found")

    docs = app.get("documents") or []
    target = next((d for d in docs if d.get("doc_type") == doc_type), None)
    if not target:
        raise HTTPException(status_code=404, detail=f"Document '{doc_type}' not found on this application")
    if not target.get("signed_in_portal"):
        raise HTTPException(status_code=400, detail="This document was not signed in portal and does not require countersigning")

    contents = await file.read()
    if len(contents) > 20 * 1024 * 1024:
        raise HTTPException(status_code=413, detail="File too large (20 MB maximum)")

    key = target["r2_key"]
    await r2_put(key, contents, "application/pdf")

    now = datetime.now(timezone.utc)
    actor_name = current_user.get("name") or current_user.get("username", "")
    countersign_meta = {
        "countersigned_at":    now.isoformat(),
        "countersigned_by":    actor_name,
        "countersigned_by_id": str(current_user.get("_id") or current_user.get("username", "")),
    }

    updated_docs = [
        {**d, **countersign_meta} if d.get("doc_type") == doc_type else d
        for d in docs
    ]
    await col("customer_onboarding").update_one(
        {"id": app_id},
        {"$set": {"documents": updated_docs, "updated_at": now}},
    )

    await audit_log(
        user=current_user,
        action="onboarding.countersign_document",
        entity_type="customer_onboarding",
        entity_id=app_id,
        entity_label=app.get("company_name", ""),
        after={"doc_type": doc_type, "r2_key": key},
    )

    return {
        "doc_type":         doc_type,
        "countersigned_at": now.isoformat(),
        "countersigned_by": actor_name,
    }


@router.put("/{app_id}/approve")
async def approve_application(
    app_id: str,
    background_tasks: BackgroundTasks,
    body: ApproveBody = None,
    current_user: dict = Depends(require_permission("customers.approve_onboarding")),
):
    """
    Approve an onboarding application:
    1. Verify all 5 required documents are present (skipped for inbox-sourced apps)
    2. Create res.partner in Odoo
    3. Insert customer_ownership record linking partner to reseller
    4. Mark application as approved
    5. If inbox-sourced, stamp customer_id on the linked inbox thread
    """
    app = await col("customer_onboarding").find_one({"id": app_id}, NO_ID)
    if not app:
        raise HTTPException(status_code=404, detail="Application not found")

    is_inbox_source = app.get("source") == "inbox"
    allowed_statuses = {"pending", "awaiting_docs"} if is_inbox_source else {"pending"}
    if app["status"] not in allowed_statuses:
        raise HTTPException(status_code=400, detail=f"Application is already {app['status']}")

    # Inbox-sourced apps skip the doc check — docs arrive via email and are saved
    # to the customer profile after the account is created (via the inbox thread).
    if not is_inbox_source:
        submitted_types = {d.get("doc_type") for d in (app.get("documents") or [])}
        missing = [label for dtype, label in REQUIRED_DOC_TYPES.items() if dtype not in submitted_types]
        if missing:
            raise HTTPException(
                status_code=400,
                detail=f"Cannot approve — missing required documents: {', '.join(missing)}",
            )

        # Portal-signed docs with a Bassani signature field must be countersigned
        # before approval.  Manually-uploaded docs skip this gate.
        uncountersigned = [
            d for d in (app.get("documents") or [])
            if d.get("signed_in_portal")
            and d.get("doc_type") in BASSANI_SIG_DOC_TYPES
            and not d.get("countersigned_at")
        ]
        if uncountersigned:
            labels = ", ".join(d.get("label", d["doc_type"]) for d in uncountersigned)
            raise HTTPException(
                status_code=400,
                detail=f"Cannot approve — the following documents require countersigning first: {labels}",
            )

    # For inbox-sourced apps the admin supplies company_name at approval time
    # if it wasn't collected upfront.
    if body and body.company_name:
        await col("customer_onboarding").update_one(
            {"id": app_id}, {"$set": {"company_name": body.company_name.strip()}}
        )
        app["company_name"] = body.company_name.strip()

    odoo = get_odoo_client()

    # Duplicate check — block if email or VAT already exists in Odoo
    dup_conditions = []
    if app.get("contact_email"):
        dup_conditions.append(("email", "=", app["contact_email"].strip().lower()))
    if app.get("vat_number"):
        dup_conditions.append(("vat", "=", app["vat_number"].strip()))
    if dup_conditions:
        dup_domain = [("customer_rank", ">", 0), ("active", "=", True)]
        if len(dup_conditions) == 2:
            dup_domain += ["|"] + dup_conditions
        else:
            dup_domain += dup_conditions
        try:
            dup_matches = odoo.search_read(
                "res.partner", domain=dup_domain,
                fields=["id", "name", "email", "vat"], limit=1,
            )
            if dup_matches:
                m = {k: (None if v is False else v) for k, v in dup_matches[0].items()}
                raise HTTPException(
                    status_code=409,
                    detail={
                        "message": "A customer with this email or VAT number already exists.",
                        "existing": m,
                    },
                )
        except HTTPException:
            raise
        except Exception as e:
            raise HTTPException(status_code=502, detail=f"Odoo duplicate check failed: {str(e)}")

    notes_parts = [f"Type: {app.get('business_type', '')}"]
    if app.get("registration_number"):
        notes_parts.append(f"Reg: {app['registration_number']}")
    if app.get("vat_number"):
        notes_parts.append(f"VAT: {app['vat_number']}")
    if app.get("trading_name"):
        notes_parts.append(f"Trading as: {app['trading_name']}")
    notes_parts.append(f"Onboarded via: {app_id}")

    vals: dict = {
        "name":          app["company_name"],
        "company_type":  "company",
        "customer_rank": 1,
        "comment":       " | ".join(notes_parts),
    }
    if app.get("contact_email"):  vals["email"]   = app["contact_email"]
    if app.get("contact_phone"):  vals["phone"]   = app["contact_phone"]
    if app.get("street"):         vals["street"]  = app["street"]
    if app.get("suburb"):         vals["street2"] = app["suburb"]
    if app.get("city"):           vals["city"]    = app["city"]
    if app.get("postal_code"):    vals["zip"]     = app["postal_code"]
    if app.get("vat_number"):     vals["vat"]     = app["vat_number"]

    try:
        partner_id = odoo.create("res.partner", vals)
    except Exception as e:
        raise HTTPException(status_code=502, detail=f"Failed to create Odoo customer: {str(e)}")

    now_approved = datetime.now(timezone.utc)

    await col("customer_ownership").insert_one({
        "odoo_partner_id":     partner_id,
        "reseller_id":         app["reseller_id"],
        "reseller_name":       app.get("reseller_name", ""),
        "created_at":          now_approved,
        "created_by_username": current_user.get("username", ""),
        "onboarding_ref":      app_id,
    })

    # Transfer application docs to customer_documents by reference — same R2 keys,
    # no byte copy. Works for both portal-wizard and inbox-sourced applications.
    for doc in (app.get("documents") or []):
        r2_key = doc.get("r2_key")
        if not r2_key:
            continue
        record = {
            "id":              str(uuid.uuid4()),
            "odoo_partner_id": partner_id,
            "label":           doc.get("label") or doc.get("doc_type") or "Document",
            "filename":        doc.get("filename", ""),
            "r2_key":          r2_key,
            "size":            doc.get("size", 0),
            "doc_type":        doc.get("doc_type"),
            "uploaded_at":     now_approved,
            "source":          "onboarding",
            "onboarding_ref":  app_id,
        }
        await col("customer_documents").insert_one(record)

    await col("customer_onboarding").update_one(
        {"id": app_id},
        {"$set": {
            "status":          "approved",
            "odoo_partner_id": partner_id,
            "reviewed_at":     now_approved,
            "reviewed_by":     current_user.get("username", ""),
        }},
    )

    # For inbox-sourced applications, stamp the linked thread with the new
    # customer_id so Save Documents becomes available immediately.
    if is_inbox_source and app.get("inbox_thread_id"):
        from bson import ObjectId as _OID
        try:
            tid = app["inbox_thread_id"]
            await col("onboarding_inbox").update_many(
                {"$or": [{"_id": _OID(tid)}, {"thread_root_id": tid}]},
                {"$set": {"customer_id": partner_id, "customer_name": app.get("company_name", "")}},
            )
        except Exception:
            pass  # non-fatal — thread link can be set manually

    await audit_log("onboarding.approve", "customer_onboarding", app_id,
                    entity_label=app.get("company_name", ""), user=current_user,
                    detail={"odoo_partner_id": partner_id},
                    reseller_id=app.get("reseller_id"))

    _res = await col("resellers").find_one({"id": app.get("reseller_id")}, {"email": 1, "_id": 0})
    if _res and _res.get("email"):
        background_tasks.add_task(
            send_onboarding_approved,
            company_name=app.get("company_name", ""),
            reseller_name=app.get("reseller_name", ""),
            reseller_email=_res["email"],
            customer_contact_email=app.get("contact_email"),
        )

    return {"success": True, "odoo_partner_id": partner_id}


@router.put("/{app_id}/approve-link")
async def approve_application_link(
    app_id: str,
    body: ApproveLinkBody,
    background_tasks: BackgroundTasks,
    current_user: dict = Depends(require_permission("customers.approve_onboarding")),
):
    """
    Approve an application by linking it to an existing Odoo customer rather than creating a new one.
    Used when the duplicate check at approval time surfaces an existing partner that matches.
    """
    app = await col("customer_onboarding").find_one({"id": app_id}, NO_ID)
    if not app:
        raise HTTPException(status_code=404, detail="Application not found")
    if app["status"] != "pending":
        raise HTTPException(status_code=400, detail=f"Application is already {app['status']}")

    odoo = get_odoo_client()
    records = odoo.read("res.partner", [body.odoo_partner_id], fields=["id", "name"])
    if not records:
        raise HTTPException(status_code=404, detail="Odoo partner not found")

    now_link = datetime.now(timezone.utc)

    await col("customer_ownership").insert_one({
        "odoo_partner_id":     body.odoo_partner_id,
        "reseller_id":         app["reseller_id"],
        "reseller_name":       app.get("reseller_name", ""),
        "created_at":          now_link,
        "created_by_username": current_user.get("username", ""),
        "onboarding_ref":      app_id,
    })

    # Transfer application docs to customer_documents by reference (same R2 keys, no byte copy)
    for doc in (app.get("documents") or []):
        r2_key = doc.get("r2_key")
        if not r2_key:
            continue
        await col("customer_documents").insert_one({
            "id":              str(uuid.uuid4()),
            "odoo_partner_id": body.odoo_partner_id,
            "label":           doc.get("label") or doc.get("doc_type") or "Document",
            "filename":        doc.get("filename", ""),
            "r2_key":          r2_key,
            "size":            doc.get("size", 0),
            "doc_type":        doc.get("doc_type"),
            "uploaded_at":     now_link,
            "source":          "onboarding",
            "onboarding_ref":  app_id,
        })

    await col("customer_onboarding").update_one(
        {"id": app_id},
        {"$set": {
            "status":          "approved",
            "odoo_partner_id": body.odoo_partner_id,
            "reviewed_at":     now_link,
            "reviewed_by":     current_user.get("username", ""),
        }},
    )
    await audit_log("onboarding.approve_link", "customer_onboarding", app_id,
                    entity_label=app.get("company_name", ""), user=current_user,
                    detail={"odoo_partner_id": body.odoo_partner_id, "linked_to_existing": True},
                    reseller_id=app.get("reseller_id"))

    _res = await col("resellers").find_one({"id": app.get("reseller_id")}, {"email": 1, "_id": 0})
    if _res and _res.get("email"):
        background_tasks.add_task(
            send_onboarding_approved,
            company_name=app.get("company_name", ""),
            reseller_name=app.get("reseller_name", ""),
            reseller_email=_res["email"],
            customer_contact_email=app.get("contact_email"),
        )

    return {"success": True, "odoo_partner_id": body.odoo_partner_id}


@router.put("/{app_id}/reject")
async def reject_application(
    app_id: str,
    body:   RejectBody,
    background_tasks: BackgroundTasks,
    current_user: dict = Depends(require_permission("customers.reject_onboarding")),
):
    app = await col("customer_onboarding").find_one({"id": app_id}, NO_ID)
    if not app:
        raise HTTPException(status_code=404, detail="Application not found")
    if app["status"] not in {"pending", "awaiting_docs"}:
        raise HTTPException(status_code=400, detail=f"Application is already {app['status']}")

    await col("customer_onboarding").update_one(
        {"id": app_id},
        {"$set": {
            "status":           "rejected",
            "rejection_reason": body.reason,
            "reviewed_at":      datetime.now(timezone.utc),
            "reviewed_by":      current_user.get("username", ""),
        }},
    )
    await audit_log("onboarding.reject", "customer_onboarding", app_id,
                    entity_label=app.get("company_name", ""), user=current_user,
                    detail={"reason": body.reason},
                    reseller_id=app.get("reseller_id"))

    _res = await col("resellers").find_one({"id": app.get("reseller_id")}, {"email": 1, "_id": 0})
    if _res and _res.get("email"):
        background_tasks.add_task(
            send_onboarding_rejected,
            company_name=app.get("company_name", ""),
            reseller_name=app.get("reseller_name", ""),
            reseller_email=_res["email"],
            reason=body.reason,
        )

    return {"success": True}
