from fastapi import APIRouter, BackgroundTasks, Depends, File, HTTPException, Query, UploadFile
import io
import re
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
from config import get_settings as _get_settings
from routes.ticket_routes import ticket_manager

router = APIRouter(prefix="/api/onboarding", tags=["onboarding"])

SA_PROVINCES = [
    "Gauteng", "Western Cape", "KwaZulu-Natal", "Eastern Cape",
    "Limpopo", "Mpumalanga", "North West", "Free State", "Northern Cape",
]

_TEMPLATE_DIR = os.path.join(os.path.dirname(__file__), "..", "static", "onboarding-templates")

# Hardcoded manifest — prevents directory traversal, controls display names
TEMPLATES: dict[str, str] = {
    "customer-information-form.pdf":  "Customer Information Form",
}

# All four are required before a business application can be approved:
# customer_information_form + cipc_certificate submitted by customer;
# nda + store_onboarding_agreement sent via signing session after admin review.
# This is the reseller-submitted onboarding wizard's document set — that flow
# is business-only (see 8.50 for the individual/natural-person path, which
# only extends the self-service /apply flow in public_routes.py).
REQUIRED_DOC_TYPES: dict[str, str] = {
    "customer_information_form":  "Signed Customer Information Form",
    "cipc_certificate":           "CIPC Company Registration Certificate",
    "nda":                        "Signed NDA",
    "store_onboarding_agreement": "Signed Store Onboarding Agreement",
}

# Individual (natural-person) self-service applications swap the CIPC
# certificate for an ID document + Section 21 outcome letter (8.50).
INDIVIDUAL_DOC_TYPES: dict[str, str] = {
    "id_document":       "Copy of ID Document",
    "section21_outcome": "Section 21 Outcome Letter",
}

# Union — used to validate/label any doc_type on the generic admin upload,
# replace, and delete endpoints, regardless of which flow it came from.
ALL_DOC_TYPES: dict[str, str] = {**REQUIRED_DOC_TYPES, **INDIVIDUAL_DOC_TYPES}

# Subset of REQUIRED_DOC_TYPES that have a Bassani signature field and therefore
# require countersigning by the signing authority holder before approval.
BASSANI_SIG_DOC_TYPES: frozenset[str] = frozenset({"nda", "store_onboarding_agreement"})


def _required_doc_types(app: dict) -> dict[str, str]:
    """Final approval-gate document set for an application — business (CIPC)
    vs individual (ID document + Section 21 outcome letter)."""
    if app.get("registration_type") == "individual":
        return {
            "customer_information_form":  REQUIRED_DOC_TYPES["customer_information_form"],
            **INDIVIDUAL_DOC_TYPES,
            "nda":                        REQUIRED_DOC_TYPES["nda"],
            "store_onboarding_agreement": REQUIRED_DOC_TYPES["store_onboarding_agreement"],
        }
    return REQUIRED_DOC_TYPES


def _pre_signing_doc_types(app: dict) -> dict[str, str]:
    """Docs required before Generate Documents can run — everything except
    NDA/Store Onboarding Agreement, which are only sent after this review gate."""
    return {k: v for k, v in _required_doc_types(app).items()
            if k not in ("nda", "store_onboarding_agreement")}


def _signatory_id_label(app: dict) -> str:
    """The signatory's ID field may hold an SA ID or a passport number
    (signatory_id_type) — used wherever the value is written into a
    human-readable note/comment so it isn't mislabelled "SA ID" for a
    passport holder."""
    return "Passport" if app.get("signatory_id_type") == "passport" else "SA ID"


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


class SendWelcomePackBody(BaseModel):
    message: str
    subject: Optional[str] = None


class ApproveAndSendWelcomePackBody(BaseModel):
    company_name: Optional[str] = None  # required for inbox-sourced apps that have no company_name yet
    message:      str
    subject:      Optional[str] = None


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
        ("customer-information-form.pdf",  "Bassani Health Customer Information Form"),
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
        + _p("Please find the Customer Information Form attached to this email.")
        + _p(
            "Please complete and sign the form, then "
            "<strong>reply directly to this email</strong> with the signed form "
            "and your CIPC company registration certificate attached. "
            "Our team will review your submission and send you the remaining documents to sign."
        )
        + _info_box([
            ("Attached",       "Customer Information Form"),
            ("Also required",  "CIPC Company Registration Certificate (reply with both)"),
        ])
        + _divider()
        + _p(
            "If you have any questions, please reply to this email and a member of the team will assist you.",
            muted=True,
        ),
        footer_note=(
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
                "inbox_thread_ids": [item_id_str],
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
        {"$addToSet": {"inbox_thread_ids": item_id_str}},
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

    return {"inbox_thread_id": item_id_str, "inbox_thread_ids": [item_id_str], "to_email": contact_email}


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
    if doc_type not in ALL_DOC_TYPES:
        raise HTTPException(status_code=400, detail=f"Unknown document type: {doc_type}")

    ext = os.path.splitext(file.filename or "")[1] or ".pdf"
    key = f"onboarding/sessions/{session_id}/{doc_type}{ext}"
    contents = await file.read()

    await r2_put(key, contents, file.content_type or "application/octet-stream")

    return {
        "doc_type":    doc_type,
        "label":       ALL_DOC_TYPES[doc_type],
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
    if doc_type not in ALL_DOC_TYPES:
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

    # Enforce initial required documents before submission (customer_information_form + cipc_certificate)
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
    """Admin updates the text fields of a pending application."""
    perms = current_user.get("permissions", {})
    if not (current_user.get("is_super_admin") or perms.get("customers", {}).get("approve_onboarding")):
        raise HTTPException(status_code=403, detail="Permission denied")

    app = await col("customer_onboarding").find_one({"id": app_id}, NO_ID)
    if not app:
        raise HTTPException(status_code=404, detail="Application not found")
    if app.get("status") not in {"pending", "awaiting_docs"}:
        raise HTTPException(status_code=400, detail="Only pending or draft applications can be updated")

    updates = body.model_dump(exclude_unset=True)
    if not updates:
        raise HTTPException(status_code=400, detail="No fields provided")
    updates["updated_at"] = datetime.now(timezone.utc)

    await col("customer_onboarding").update_one({"id": app_id}, {"$set": updates})
    await audit_log("onboarding.update", "customer_onboarding", app_id,
                    entity_label=app.get("company_name", ""), user=current_user,
                    reseller_id=app.get("reseller_id"), after=updates)
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
    """Admin replaces a specific document on a pending application."""
    perms = current_user.get("permissions", {})
    if not (current_user.get("is_super_admin") or perms.get("customers", {}).get("approve_onboarding")):
        raise HTTPException(status_code=403, detail="Permission denied")

    app = await col("customer_onboarding").find_one({"id": app_id}, NO_ID)
    if not app:
        raise HTTPException(status_code=404, detail="Application not found")
    if app.get("status") != "pending":
        raise HTTPException(status_code=400, detail="Only pending applications can be updated")
    if doc_type not in ALL_DOC_TYPES:
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
        "label":       ALL_DOC_TYPES[doc_type],
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
                    reseller_id=app.get("reseller_id"), after={"doc_type": doc_type, "filename": file.filename})
    return new_doc


@router.post("/{app_id}/countersign/{doc_type}")
async def countersign_document(
    app_id:   str,
    doc_type: str,
    file: UploadFile = File(...),
    background_tasks: BackgroundTasks = None,
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

    # Advance all linked inbox threads to docs_complete once every portal-signed
    # Bassani-sig doc has been countersigned, and notify configured recipients.
    all_countersigned = all(
        d.get("countersigned_at") or d.get("doc_type") == doc_type
        for d in updated_docs
        if d.get("signed_in_portal") and d.get("doc_type") in BASSANI_SIG_DOC_TYPES
    )
    if all_countersigned:
        thread_ids = app.get("inbox_thread_ids") or (
            [app["inbox_thread_id"]] if app.get("inbox_thread_id") else []
        )
        from bson import ObjectId as _OID
        for tid in thread_ids:
            try:
                await col("onboarding_inbox").update_many(
                    {"$or": [{"_id": _OID(tid)}, {"thread_root_id": tid}]},
                    {"$set": {"status": "docs_complete"}},
                )
            except Exception:
                pass

        if background_tasks:
            from routes.settings_routes import get_email_routing
            from services.email_service import send_countersign_complete_notification
            routing = await get_email_routing()
            notify = routing.get("countersign_complete_to") or []
            if notify:
                background_tasks.add_task(
                    send_countersign_complete_notification,
                    to_emails=notify,
                    company_name=app.get("company_name") or app.get("contact_name", ""),
                    app_id=app_id,
                )

    return {
        "doc_type":         doc_type,
        "countersigned_at": now.isoformat(),
        "countersigned_by": actor_name,
    }


def _file_ext(filename: str) -> str:
    return ("." + filename.rsplit(".", 1)[-1].lower()) if filename and "." in filename else ".pdf"


def _welcome_pack_doc_attachments(app: dict) -> list[dict]:
    """
    Onboarding documents that will be attached to the welcome pack email — every
    uploaded doc with an r2_key (CIF, the CIPC/ID+S21 supporting doc(s),
    countersigned NDA, countersigned SOA). Countersigning overwrites the same R2
    key in place, so r2_key on NDA/SOA already points at the countersigned version.
    Shared by the real send and its preview endpoint so the preview can never
    show a different attachment list than what actually goes out.
    """
    result = []
    for doc in (app.get("documents") or []):
        if not doc.get("r2_key"):
            continue
        result.append({
            "doc_type":         doc.get("doc_type"),
            "label":            ALL_DOC_TYPES.get(doc.get("doc_type", ""), "Document"),
            "filename":         doc.get("filename", ""),
            "r2_key":           doc["r2_key"],
            "countersigned_at": doc.get("countersigned_at"),
        })
    return result


@router.get("/{app_id}/welcome-pack-preview")
async def welcome_pack_preview(
    app_id: str,
    current_user: dict = Depends(require_permission("customers.approve_onboarding")),
):
    """
    Exactly what /send-welcome-pack (and /approve-and-send-welcome-pack) will
    attach — computed from the same _welcome_pack_doc_attachments() +
    get_active_bundle_files() calls the real send uses, so the compose-modal
    preview can never drift from what actually gets emailed.
    """
    app = await col("customer_onboarding").find_one({"id": app_id}, NO_ID)
    if not app:
        raise HTTPException(status_code=404, detail="Application not found")

    documents = [
        {k: v for k, v in d.items() if k != "r2_key"}
        for d in _welcome_pack_doc_attachments(app)
    ]

    from routes.doc_template_routes import get_active_bundle_files
    bundle_files = await get_active_bundle_files("welcome_pack")

    return {
        "documents":    documents,
        "bundle_files": [{"filename": f["filename"]} for f in bundle_files],
    }


async def _send_welcome_pack_impl(
    app_id: str,
    body: SendWelcomePackBody,
    background_tasks: BackgroundTasks,
    current_user: dict,
) -> dict:
    """
    Send the welcome pack email to the customer.
    Attaches all onboarding documents (CIF, CIPC/ID+S21 supporting doc(s),
    countersigned NDA, countersigned SOA) plus all four active welcome pack
    slot files (budget, letter, price list, brochure).
    Email footer uses the sender's signing_name and signing_title from their profile.
    Creates an outgoing inbox thread so the send is traceable in the onboarding inbox.
    """
    app = await col("customer_onboarding").find_one({"id": app_id}, NO_ID)
    if not app:
        raise HTTPException(status_code=404, detail="Application not found")

    customer_email = (app.get("contact_email") or "").strip()
    if not customer_email:
        raise HTTPException(status_code=400, detail="No customer email on this application")

    docs = app.get("documents") or []
    bassani_docs = [d for d in docs if d.get("doc_type") in BASSANI_SIG_DOC_TYPES]
    uncountersigned = [d for d in bassani_docs if not d.get("countersigned_at")]
    if uncountersigned or not bassani_docs:
        raise HTTPException(
            status_code=400,
            detail="All onboarding documents must be countersigned before sending the welcome pack",
        )

    # Fetch all files from the active welcome pack bundle
    from routes.doc_template_routes import get_active_bundle_files
    bundle_files = await get_active_bundle_files("welcome_pack")
    if not bundle_files:
        raise HTTPException(status_code=404, detail="No active welcome pack template has been uploaded. Upload one under Settings > Document Templates.")

    attachments = []
    for doc_meta in _welcome_pack_doc_attachments(app):
        file_bytes = await r2_get(doc_meta["r2_key"])
        if file_bytes:
            ext = _file_ext(doc_meta["filename"])
            attachments.append({"filename": f"{doc_meta['label']}{ext}", "content": list(file_bytes)})

    # Attach every file in the welcome pack bundle (budget, letter, price_list, brochure)
    for f in bundle_files:
        attachments.append({"filename": f["filename"], "content": list(f["data"])})

    # Get sender's signing name and title from their profile
    username = current_user.get("username", "")
    user_doc = await col("users").find_one({"username": username})
    sender_name  = (user_doc or {}).get("signing_name") or current_user.get("name") or "Bassani Health"
    sender_title = (user_doc or {}).get("signing_title", "")

    company_name = app.get("company_name") or app.get("contact_name", "Customer")
    message      = body.message.strip()
    email_subject = (body.subject or "").strip() or "Welcome to Bassani Health"

    # Send email in background
    from services.email_service import send_customer_welcome_pack
    background_tasks.add_task(
        send_customer_welcome_pack,
        to_email=customer_email,
        customer_name=company_name,
        custom_message=message,
        sender_name=sender_name,
        sender_title=sender_title,
        attachments=attachments,
        subject=email_subject,
    )

    # Create an outgoing inbox thread so the send is visible in onboarding inbox
    now = datetime.now(timezone.utc)
    from services.email_service import _wrap as _email_wrap, _p, _divider
    body_html = _email_wrap(
        _p(message.replace("\n", "<br>"))
        + _divider()
        + _p(f"Application reference: <strong>{app_id}</strong>", muted=True)
    )
    # Use the existing signing correspondence thread if one exists,
    # so welcome pack and signing link stay in a single inbox thread.
    signing_thread_id = app.get("signing_thread_id")
    thread_doc = {
        "mailbox_address":  "resend",
        "from_email":       current_user.get("email", ""),
        "from_name":        sender_name,
        "to_email":         customer_email,
        "subject":          email_subject,
        "body_html":        body_html,
        "body_preview":     message[:120],
        "is_outgoing":      True,
        "status":           "application_linked",
        "received_at":      now,
        "has_attachments":  True,
        "attachments":      [],
        "thread_root_id":   signing_thread_id,  # reply in signing thread, or new root
        "is_read":          True,
        "created_at":       now,
        "sent_by":          username,
        "application_id":   app_id,
        "reseller_id":      app.get("reseller_id"),
        "reseller_name":    app.get("reseller_name"),
        "note":             "welcome_pack",
    }
    result  = await col("onboarding_inbox").insert_one(thread_doc)
    new_id  = str(result.inserted_id)

    if signing_thread_id:
        # Reply in existing thread — no new thread root or inbox_thread_ids entry needed
        thread_id = signing_thread_id
        await col("customer_onboarding").update_one(
            {"id": app_id},
            {"$set": {
                "welcome_pack_sent_at": now.isoformat(),
                "welcome_pack_sent_by": current_user.get("name") or username,
            }},
        )
    else:
        # No signing thread found — create new root
        thread_id = new_id
        await col("onboarding_inbox").update_one(
            {"_id": result.inserted_id},
            {"$set": {"thread_root_id": thread_id}},
        )
        await col("customer_onboarding").update_one(
            {"id": app_id},
            {
                "$addToSet": {"inbox_thread_ids": thread_id},
                "$set": {
                    "welcome_pack_sent_at": now.isoformat(),
                    "welcome_pack_sent_by": current_user.get("name") or username,
                },
            },
        )

    await audit_log(
        user=current_user,
        action="onboarding.welcome_pack_sent",
        entity_type="customer_onboarding",
        entity_id=app_id,
        entity_label=company_name,
        after={"sent_to": customer_email},
    )

    return {"success": True, "thread_id": thread_id}


@router.post("/{app_id}/send-welcome-pack")
async def send_welcome_pack(
    app_id: str,
    body: SendWelcomePackBody,
    background_tasks: BackgroundTasks,
    current_user: dict = Depends(require_permission("customers.approve_onboarding")),
):
    return await _send_welcome_pack_impl(app_id, body, background_tasks, current_user)


async def _approve_application_impl(
    app_id: str,
    background_tasks: BackgroundTasks,
    body: Optional[ApproveBody],
    current_user: dict,
) -> dict:
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
        missing = [label for dtype, label in _required_doc_types(app).items() if dtype not in submitted_types]
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

    # True-duplicate checks — these still block approval:
    #   1. A matching VAT number is a real same-legal-entity signal.
    #   2. The exact same company_name + trading_name combination already
    #      approved is almost certainly an accidental resubmission of the
    #      same branch, not a genuinely new one.
    # Deliberately NOT blocking on the contact email matching an existing
    # partner/contact — for this business, "same person, another branch" is
    # the normal case (one owner running several stores, sometimes under
    # separate legal entities with different CIPC docs, sometimes the same
    # entity operating multiple branches under one CIPC registration), not a
    # duplicate. Confirmed 2026-08-04 against real applications: two
    # "Curabliss" entities (different CIPC docs, same signatory) and two
    # "Cannapure Plus NPC" branches (identical CIPC docs, different trading
    # names, no VAT) both needed to become separate company profiles with
    # the same contact linked to each. See linked_contact_note below for how
    # that's surfaced instead of blocked.
    is_individual = app.get("registration_type") == "individual"

    if not is_individual and app.get("vat_number"):
        try:
            vat_matches = odoo.search_read(
                "res.partner",
                domain=[
                    ("active", "=", True), ("vat", "=", app["vat_number"].strip()),
                    "|", ("customer_rank", ">", 0), ("is_company", "=", True),
                ],
                fields=["id", "name", "email", "vat"], limit=1,
            )
        except Exception as e:
            raise HTTPException(status_code=502, detail=f"Odoo duplicate check failed: {str(e)}")
        if vat_matches:
            m = {k: (None if v is False else v) for k, v in vat_matches[0].items()}
            raise HTTPException(
                status_code=409,
                detail={
                    "message": "A customer with this VAT number already exists.",
                    "existing": m,
                },
            )

    if not is_individual and app.get("trading_name"):
        _dup_app = await col("customer_onboarding").find_one({
            "id": {"$ne": app_id},
            "status": "approved",
            "company_name": {"$regex": f"^{re.escape(app['company_name'].strip())}$", "$options": "i"},
            "trading_name": {"$regex": f"^{re.escape(app['trading_name'].strip())}$", "$options": "i"},
        })
        if _dup_app:
            raise HTTPException(
                status_code=409,
                detail={
                    "message": (
                        f"An application for \"{app['company_name']}\" trading as "
                        f"\"{app['trading_name']}\" was already approved ({_dup_app['id']})."
                    ),
                    "existing": {"application_id": _dup_app["id"], "odoo_partner_id": _dup_app.get("odoo_partner_id")},
                },
            )

    # Individual duplicate check — unlike businesses, one person is not
    # legitimately "multiple branches," so a matching SA ID number on another
    # approved individual application blocks outright (checked against the
    # portal's own records, not Odoo — there is no dedicated ID-number field
    # on res.partner to match against).
    if is_individual and app.get("signatory_id_number"):
        _dup_individual = await col("customer_onboarding").find_one({
            "id": {"$ne": app_id},
            "status": "approved",
            "registration_type": "individual",
            "signatory_id_number": app["signatory_id_number"].strip(),
        })
        if _dup_individual:
            raise HTTPException(
                status_code=409,
                detail={
                    "message": f"An individual application with this ID number was already approved ({_dup_individual['id']}).",
                    "existing": {"application_id": _dup_individual["id"], "odoo_partner_id": _dup_individual.get("odoo_partner_id")},
                },
            )

    # Informational only — never blocks approval. Surfaced in the audit log
    # (detail below) so it's visible on the customer record if anyone goes
    # looking, without adding friction to the common case.
    linked_contact_note: Optional[str] = None
    if app.get("contact_email"):
        try:
            _existing_contacts = odoo.search_read(
                "res.partner",
                domain=[("active", "=", True), ("email", "=", app["contact_email"].strip().lower())],
                fields=["id", "name", "parent_id", "is_company"],
                limit=10,
            )
            _other_companies = sorted(set(
                c["name"] if c.get("is_company") else c["parent_id"][1]
                for c in _existing_contacts
                if c.get("is_company") or c.get("parent_id")
            ))
            if _other_companies:
                linked_contact_note = (
                    f"{app.get('contact_name') or app['contact_email']} is also a contact on: "
                    + ", ".join(_other_companies)
                )
        except Exception:
            pass  # best-effort — never block approval on this lookup failing

    if is_individual:
        # Individual (natural-person) applications create a single standalone
        # res.partner — the applicant IS the contact, so there is no separate
        # company + child contact structure to build.
        notes_parts = []
        if app.get("signatory_id_number"): notes_parts.append(f"{_signatory_id_label(app)}: {app['signatory_id_number']}")
        notes_parts.append(f"Onboarded via: {app_id}")

        _display_name = app.get("contact_name") or app.get("company_name") or "Individual Customer"

        vals: dict = {
            "name":          _display_name,
            "company_type":  "person",
            "customer_rank": 1,
            "comment":       " | ".join(notes_parts),
        }
    else:
        # Build internal notes — prefer new structured fields, fall back to legacy business_type
        category  = app.get("business_category") or app.get("business_type") or ""
        entity    = app.get("entity_type", "")
        if app.get("business_category") == "Other":
            category = app.get("business_category_other") or "Other"
        if app.get("entity_type") == "Other":
            entity = app.get("entity_type_other") or "Other"
        notes_parts = []
        if category:  notes_parts.append(f"Category: {category}")
        if entity:    notes_parts.append(f"Entity: {entity}")
        if app.get("section22c_licensed"): notes_parts.append("Section 22C Licensed")
        if app.get("registration_number"): notes_parts.append(f"Reg: {app['registration_number']}")
        if app.get("vat_number"):          notes_parts.append(f"VAT: {app['vat_number']}")
        if app.get("trading_name"):        notes_parts.append(f"Trading as: {app['trading_name']}")
        notes_parts.append(f"Onboarded via: {app_id}")

        # Trading name folded into the display name itself, not just the comment
        # field — two branches of the same legal entity (e.g. "Cannapure Plus
        # NPC" operating in both Witbank and Dullstroom) would otherwise be
        # indistinguishable everywhere the customer name is shown: order lists,
        # the dashboard, invoices, ticket headers. Confirmed 2026-08-04.
        _display_name = app["company_name"]
        if app.get("trading_name") and app["trading_name"].strip().lower() != app["company_name"].strip().lower():
            _display_name = f"{app['company_name']} - {app['trading_name']}"

        vals: dict = {
            "name":          _display_name,
            "company_type":  "company",
            "customer_rank": 1,
            "comment":       " | ".join(notes_parts),
        }
        if app.get("vat_number"): vals["vat"] = app["vat_number"]

    if app.get("contact_email"):  vals["email"]   = app["contact_email"]
    if app.get("contact_phone"):  vals["phone"]   = app["contact_phone"]
    if app.get("street"):         vals["street"]  = app["street"]
    if app.get("suburb"):         vals["street2"] = app["suburb"]
    if app.get("city"):           vals["city"]    = app["city"]
    if app.get("postal_code"):    vals["zip"]     = app["postal_code"]
    # Province → Odoo state_id; country always South Africa
    from routes.customer_routes import _resolve_za_state_id, _get_za_country_id
    if app.get("province"):
        sid = _resolve_za_state_id(odoo, app["province"])
        if sid:
            vals["state_id"] = sid
    za_id = _get_za_country_id(odoo)
    if za_id:
        vals["country_id"] = za_id

    try:
        partner_id = odoo.create("res.partner", vals)
    except Exception as e:
        raise HTTPException(status_code=502, detail=f"Failed to create Odoo customer: {str(e)}")

    # Create a child contact person for the primary signatory — business
    # applications only. Individuals are already the top-level partner record
    # created above, so there is no separate contact to add.
    if not is_individual and app.get("contact_name"):
        contact_vals: dict = {
            "name":      app["contact_name"],
            "parent_id": partner_id,
            "type":      "contact",
        }
        if app.get("contact_position"):    contact_vals["function"] = app["contact_position"]
        if app.get("contact_email"):       contact_vals["email"]    = app["contact_email"]
        if app.get("contact_phone"):       contact_vals["phone"]    = app["contact_phone"]
        if app.get("signatory_id_number"): contact_vals["comment"]  = f"{_signatory_id_label(app)}: {app['signatory_id_number']}"
        try:
            odoo.create("res.partner", contact_vals)
        except Exception:
            pass  # non-fatal — company is already created

    now_approved = datetime.now(timezone.utc)

    await col("customer_ownership").insert_one({
        "odoo_partner_id":     partner_id,
        "reseller_id":         app["reseller_id"],
        "reseller_name":       app.get("reseller_name", ""),
        "created_at":          now_approved,
        "created_by_username": current_user.get("username", ""),
        "onboarding_ref":      app_id,
    })
    await ticket_manager.refresh_reseller(app["reseller_id"])

    # Persist diagnosis/indication onto the ongoing customer record (portal-layer
    # data, not financial — belongs in customer_metadata per architecture
    # principle #5) so it survives beyond this one-off application document.
    if is_individual and app.get("diagnosis_indication"):
        await col("customer_metadata").update_one(
            {"odoo_partner_id": partner_id},
            {"$set": {"diagnosis_indication": app["diagnosis_indication"]}},
            upsert=True,
        )

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

    # Archive all linked inbox threads and stamp customer_id on them.
    thread_ids = app.get("inbox_thread_ids") or (
        [app["inbox_thread_id"]] if app.get("inbox_thread_id") else []
    )
    if thread_ids:
        from bson import ObjectId as _OID
        for tid in thread_ids:
            try:
                await col("onboarding_inbox").update_many(
                    {"$or": [{"_id": _OID(tid)}, {"thread_root_id": tid}]},
                    {"$set": {
                        "status":        "archived",
                        "customer_id":   partner_id,
                        "customer_name": _display_name,
                    }},
                )
            except Exception:
                pass  # non-fatal

    _approve_detail: dict = {"odoo_partner_id": partner_id}
    if linked_contact_note:
        _approve_detail["linked_contact_note"] = linked_contact_note
    await audit_log("onboarding.approve", "customer_onboarding", app_id,
                    entity_label=_display_name, user=current_user,
                    detail=_approve_detail,
                    reseller_id=app.get("reseller_id"))

    _res = await col("resellers").find_one({"id": app.get("reseller_id")}, {"email": 1, "_id": 0})
    if _res and _res.get("email"):
        background_tasks.add_task(
            send_onboarding_approved,
            company_name=_display_name,
            reseller_name=app.get("reseller_name", ""),
            reseller_email=_res["email"],
            customer_contact_email=app.get("contact_email"),
        )

    return {"success": True, "odoo_partner_id": partner_id, "display_name": _display_name}


@router.put("/{app_id}/approve")
async def approve_application(
    app_id: str,
    background_tasks: BackgroundTasks,
    body: ApproveBody = None,
    current_user: dict = Depends(require_permission("customers.approve_onboarding")),
):
    result = await _approve_application_impl(app_id, background_tasks, body, current_user)
    return {"success": result["success"], "odoo_partner_id": result["odoo_partner_id"]}


@router.put("/{app_id}/approve-and-send-welcome-pack")
async def approve_and_send_welcome_pack(
    app_id: str,
    body: ApproveAndSendWelcomePackBody,
    background_tasks: BackgroundTasks,
    current_user: dict = Depends(require_permission("customers.approve_onboarding")),
):
    """
    Single combined action: approve the application (create the Odoo customer)
    and immediately send the welcome pack email — the normal path now that
    both are gated on the exact same "all Bassani-sig docs countersigned"
    requirement, so there's no real reason to make them two separate clicks.

    Approval runs first since it's the harder-to-reverse, load-bearing step
    (it creates the live Odoo customer and customer_ownership record). If the
    welcome pack send then fails (e.g. no active template uploaded, or a
    transient email error), the approval is deliberately NOT rolled back —
    same non-blocking-failure convention used elsewhere in onboarding
    (e.g. _queue_packing_board's packing_board_queue_error). The application
    is left approved with welcome_pack_sent_at unset; the detail page shows a
    retry "Send Welcome Pack" button for exactly this state.
    """
    approve_result = await _approve_application_impl(
        app_id, background_tasks, ApproveBody(company_name=body.company_name), current_user,
    )

    try:
        wp_result = await _send_welcome_pack_impl(
            app_id,
            SendWelcomePackBody(message=body.message, subject=body.subject),
            background_tasks,
            current_user,
        )
    except HTTPException as e:
        return {
            "success":            True,
            "odoo_partner_id":    approve_result["odoo_partner_id"],
            "welcome_pack_sent":  False,
            "welcome_pack_error": e.detail if isinstance(e.detail, str) else "Failed to send welcome pack",
        }

    return {
        "success":           True,
        "odoo_partner_id":   approve_result["odoo_partner_id"],
        "welcome_pack_sent": True,
        "thread_id":         wp_result["thread_id"],
    }


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
    await ticket_manager.refresh_reseller(app["reseller_id"])

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
                    entity_label=app.get("company_name") or app.get("contact_name", ""), user=current_user,
                    detail={"odoo_partner_id": body.odoo_partner_id, "linked_to_existing": True},
                    reseller_id=app.get("reseller_id"))

    _res = await col("resellers").find_one({"id": app.get("reseller_id")}, {"email": 1, "_id": 0})
    if _res and _res.get("email"):
        background_tasks.add_task(
            send_onboarding_approved,
            company_name=app.get("company_name") or app.get("contact_name", ""),
            reseller_name=app.get("reseller_name", ""),
            reseller_email=_res["email"],
            customer_contact_email=app.get("contact_email"),
        )

    return {"success": True, "odoo_partner_id": body.odoo_partner_id}


@router.post("/{app_id}/generate-signing-docs")
async def generate_signing_docs(
    app_id: str,
    current_user: dict = Depends(require_permission("customers.approve_onboarding")),
):
    """
    Generate a 30-day signing session for the customer to sign the NDA and
    Store Onboarding Agreement.  Creates the session and snapshots the form data
    so the admin can preview the pre-filled documents before sending to the customer.
    Does NOT send any email — call POST /{app_id}/send-signing-docs to send.
    """
    app = await col("customer_onboarding").find_one({"id": app_id}, NO_ID)
    if not app:
        raise HTTPException(status_code=404, detail="Application not found")
    if app.get("status") not in {"pending", "awaiting_docs"}:
        raise HTTPException(status_code=400, detail="Signing documents can only be generated for pending applications")

    submitted_types = {d.get("doc_type") for d in (app.get("documents") or [])}
    for required, label in _pre_signing_doc_types(app).items():
        if required not in submitted_types:
            raise HTTPException(
                status_code=400,
                detail=f"Cannot generate signing documents — {label} has not been submitted yet",
            )

    token = str(uuid.uuid4())
    now   = datetime.now(timezone.utc)
    from datetime import timedelta
    expires_at = now + timedelta(days=30)

    form_snapshot = {
        # Individual applications have no company_name — NDA/Store Onboarding
        # Agreement prefill falls back to the applicant's own name.
        "company_name":        app.get("company_name") or app.get("contact_name", ""),
        "trading_name":        app.get("trading_name", ""),
        "registration_number": app.get("registration_number", ""),
        "vat_number":          app.get("vat_number", ""),
        "contact_name":        app.get("contact_name", ""),
        "contact_position":    app.get("contact_position", ""),
        "contact_email":       app.get("contact_email", ""),
        "contact_phone":       app.get("contact_phone", ""),
        "contact_alt_phone":   app.get("contact_alt_phone", ""),
        "signatory_id_type":   app.get("signatory_id_type", "sa_id"),
        "signatory_id_number": app.get("signatory_id_number", ""),
        "street":              app.get("street", ""),
        "suburb":              app.get("suburb", ""),
        "city":                app.get("city", ""),
        "province":            app.get("province", ""),
        "postal_code":         app.get("postal_code", ""),
        "country":             app.get("country", "South Africa"),
    }

    session_doc = {
        "token":        token,
        "app_id":       app_id,
        "form_data":    form_snapshot,
        "docs_to_sign": ["nda", "store_onboarding_agreement"],
        "signed":       {},
        "status":       "generated",
        "sent_at":      None,
        "expires_at":   expires_at,
        "generated_by_id":   str(current_user.get("_id") or current_user.get("id", "")),
        "generated_by_name": current_user.get("name") or current_user.get("username", ""),
    }
    await col("signing_sessions").insert_one(session_doc)
    await col("customer_onboarding").update_one(
        {"id": app_id},
        {"$set": {"signing_session_token": token, "signing_session_generated_at": now}},
    )

    await audit_log(
        "onboarding.generate_signing_docs", "customer_onboarding", app_id,
        entity_label=app.get("company_name") or app.get("contact_name", ""), user=current_user,
        after={"signing_session_token": token, "expires_at": expires_at.isoformat(), "status": "generated"},
    )
    return {"success": True, "token": token, "expires_at": expires_at.isoformat()}


@router.post("/{app_id}/send-signing-docs")
async def send_signing_docs(
    app_id: str,
    background_tasks: BackgroundTasks,
    current_user: dict = Depends(require_permission("customers.approve_onboarding")),
):
    """
    Send the signing invitation email to the customer using the existing generated
    signing session.  Admin must have called generate-signing-docs first.
    Can be called multiple times to resend.
    """
    app = await col("customer_onboarding").find_one({"id": app_id}, NO_ID)
    if not app:
        raise HTTPException(status_code=404, detail="Application not found")

    token = app.get("signing_session_token")
    if not token:
        raise HTTPException(status_code=400, detail="No signing session found. Generate documents first.")

    session = await col("signing_sessions").find_one({"token": token})
    if not session:
        raise HTTPException(status_code=404, detail="Signing session not found")

    contact_email = app.get("contact_email", "").strip()
    if not contact_email:
        raise HTTPException(status_code=400, detail="Application has no customer email address")

    now        = datetime.now(timezone.utc)
    expires_at = session.get("expires_at")

    await col("signing_sessions").update_one(
        {"token": token},
        {"$set": {
            "status":        "sent",
            "sent_at":       now,
            "sent_by_email": current_user.get("email") or current_user.get("username", ""),
        }},
    )
    await col("customer_onboarding").update_one(
        {"id": app_id},
        {"$set": {"signing_session_sent_at": now}},
    )

    from services.email_service import send_signing_invitation
    signing_url = f"{_get_settings().portal_url}/sign/{token}"
    background_tasks.add_task(
        send_signing_invitation,
        to_email=contact_email,
        customer_name=app.get("contact_name") or app.get("company_name", ""),
        signing_url=signing_url,
        expiry_date=expires_at.strftime("%-d %B %Y") if expires_at else "",
    )

    # Create or append to the onboarding correspondence thread in the inbox.
    # First send: create thread root and store ID on the app.
    # Resend: insert as reply in the existing thread so all sends stay in one place.
    from services.email_service import _wrap as _email_wrap, _p, _divider
    company_name = app.get("company_name") or app.get("contact_name", "Customer")
    signing_thread_id = app.get("signing_thread_id")
    _body_html = _email_wrap(
        _p(f"Signing invitation sent to <strong>{contact_email}</strong>.")
        + _p("The customer has been sent a secure link to sign the NDA and Store Onboarding Agreement.")
        + _divider()
        + _p(f"Application reference: <strong>{app_id}</strong>", muted=True)
    )
    _signing_thread_doc = {
        "mailbox_address": "resend",
        "from_email":      current_user.get("email", ""),
        "from_name":       current_user.get("name") or current_user.get("username", ""),
        "to_email":        contact_email,
        "subject":         f"Onboarding: {company_name}",
        "body_html":       _body_html,
        "body_preview":    f"Signing invitation sent to {contact_email}",
        "is_outgoing":     True,
        "status":          "application_linked",
        "received_at":     now,
        "has_attachments": False,
        "attachments":     [],
        "thread_root_id":  signing_thread_id,  # None = new root; existing ID = reply
        "is_read":         True,
        "created_at":      now,
        "sent_by":         current_user.get("username"),
        "application_id":  app_id,
        "reseller_id":     app.get("reseller_id"),
        "reseller_name":   app.get("reseller_name"),
        "note":            "signing_link",
    }
    _result = await col("onboarding_inbox").insert_one(_signing_thread_doc)
    _new_id  = str(_result.inserted_id)
    if not signing_thread_id:
        # First send — make this the thread root
        await col("onboarding_inbox").update_one(
            {"_id": _result.inserted_id},
            {"$set": {"thread_root_id": _new_id}},
        )
        await col("customer_onboarding").update_one(
            {"id": app_id},
            {
                "$addToSet": {"inbox_thread_ids": _new_id},
                "$set":      {"signing_thread_id": _new_id},
            },
        )

    await audit_log(
        "onboarding.send_signing_docs", "customer_onboarding", app_id,
        entity_label=app.get("company_name", ""), user=current_user,
        after={"signing_session_token": token, "sent_at": now.isoformat()},
    )
    return {"success": True, "sent_at": now.isoformat()}


@router.get("/{app_id}/signing-session")
async def get_signing_session(
    app_id: str,
    current_user: dict = Depends(require_permission("customers.approve_onboarding")),
):
    """Return the current signing session state for an application, or null if none exists."""
    app = await col("customer_onboarding").find_one({"id": app_id}, NO_ID)
    if not app:
        raise HTTPException(status_code=404, detail="Application not found")

    token = app.get("signing_session_token")
    if not token:
        return {"session": None}

    session = await col("signing_sessions").find_one({"token": token}, NO_ID)
    if not session:
        return {"session": None}

    now = datetime.now(timezone.utc)
    expires_at = session.get("expires_at")
    if expires_at and expires_at.tzinfo is None:
        expires_at = expires_at.replace(tzinfo=timezone.utc)
    expired = bool(expires_at and now > expires_at)

    return {
        "session": {
            "token":              session["token"],
            "status":             session.get("status", "pending"),
            "docs_to_sign":       session.get("docs_to_sign", []),
            "signed":             session.get("signed", {}),
            "form_data":          session.get("form_data", {}),
            "sent_at":            session["sent_at"].isoformat() if session.get("sent_at") else None,
            "expires_at":         expires_at.isoformat() if expires_at else None,
            "expired":            expired,
            "generated_by_name":  session.get("generated_by_name", ""),
            "sent_by_name":       session.get("sent_by_name", ""),
        }
    }


@router.put("/{app_id}/assign")
async def assign_application(
    app_id: str,
    current_user: dict = Depends(require_permission("signing_authority.sign")),
):
    """
    Claim or release an application for countersigning.
    If already assigned to the current user, calling this again releases the claim.
    If assigned to someone else, the claim transfers to the current user.
    Returns the updated assigned_to object (or None if released).
    """
    app = await col("customer_onboarding").find_one({"id": app_id}, NO_ID)
    if not app:
        raise HTTPException(status_code=404, detail="Application not found")

    uid  = str(current_user.get("_id") or current_user.get("id", ""))
    name = current_user.get("name") or current_user.get("username", "")

    current_assignment = app.get("assigned_to")
    already_mine = current_assignment and current_assignment.get("user_id") == uid

    if already_mine:
        # Release the claim
        await col("customer_onboarding").update_one(
            {"id": app_id}, {"$unset": {"assigned_to": ""}}
        )
        await audit_log(
            user=current_user, action="onboarding.unassigned",
            entity_type="customer_onboarding", entity_id=app_id,
            entity_label=app.get("company_name", ""),
        )
        return {"assigned_to": None}
    else:
        assignment = {"user_id": uid, "name": name, "assigned_at": datetime.now(timezone.utc).isoformat()}
        await col("customer_onboarding").update_one(
            {"id": app_id}, {"$set": {"assigned_to": assignment}}
        )
        await audit_log(
            user=current_user, action="onboarding.assigned",
            entity_type="customer_onboarding", entity_id=app_id,
            entity_label=app.get("company_name", ""),
            after={"assigned_to": assignment},
        )
        return {"assigned_to": assignment}


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
