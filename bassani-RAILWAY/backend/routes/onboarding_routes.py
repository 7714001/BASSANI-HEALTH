from fastapi import APIRouter, BackgroundTasks, Depends, File, HTTPException, Query, UploadFile
from fastapi.responses import FileResponse
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
from services.r2_client import r2_put, r2_delete, r2_presign

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
    to_email: str


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
    return {"success": True}


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
    if app.get("status") != "pending":
        raise HTTPException(status_code=400, detail="Only pending applications can be updated")

    updates = body.model_dump(exclude_unset=True)
    if not updates:
        raise HTTPException(status_code=400, detail="No fields provided")
    updates["updated_at"] = datetime.now(timezone.utc)

    await col("customer_onboarding").update_one({"id": app_id}, {"$set": updates})
    await audit_log("onboarding.update", "customer_onboarding", app_id,
                    entity_label=app.get("company_name", ""), user=current_user,
                    reseller_id=reseller["id"], after=updates)
    return {"success": True}


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


@router.put("/{app_id}/approve")
async def approve_application(
    app_id: str,
    background_tasks: BackgroundTasks,
    current_user: dict = Depends(require_permission("customers.approve_onboarding")),
):
    """
    Approve an onboarding application:
    1. Verify all 5 required documents are present
    2. Create res.partner in Odoo
    3. Insert customer_ownership record linking partner to reseller
    4. Mark application as approved
    """
    app = await col("customer_onboarding").find_one({"id": app_id}, NO_ID)
    if not app:
        raise HTTPException(status_code=404, detail="Application not found")
    if app["status"] != "pending":
        raise HTTPException(status_code=400, detail=f"Application is already {app['status']}")

    submitted_types = {d.get("doc_type") for d in (app.get("documents") or [])}
    missing = [label for dtype, label in REQUIRED_DOC_TYPES.items() if dtype not in submitted_types]
    if missing:
        raise HTTPException(
            status_code=400,
            detail=f"Cannot approve — missing required documents: {', '.join(missing)}",
        )

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

    await col("customer_ownership").insert_one({
        "odoo_partner_id":     partner_id,
        "reseller_id":         app["reseller_id"],
        "reseller_name":       app.get("reseller_name", ""),
        "created_at":          datetime.now(timezone.utc),
        "created_by_username": current_user.get("username", ""),
        "onboarding_ref":      app_id,
    })

    await col("customer_onboarding").update_one(
        {"id": app_id},
        {"$set": {
            "status":          "approved",
            "odoo_partner_id": partner_id,
            "reviewed_at":     datetime.now(timezone.utc),
            "reviewed_by":     current_user.get("username", ""),
        }},
    )
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

    await col("customer_ownership").insert_one({
        "odoo_partner_id":     body.odoo_partner_id,
        "reseller_id":         app["reseller_id"],
        "reseller_name":       app.get("reseller_name", ""),
        "created_at":          datetime.now(timezone.utc),
        "created_by_username": current_user.get("username", ""),
        "onboarding_ref":      app_id,
    })
    await col("customer_onboarding").update_one(
        {"id": app_id},
        {"$set": {
            "status":          "approved",
            "odoo_partner_id": body.odoo_partner_id,
            "reviewed_at":     datetime.now(timezone.utc),
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
    if app["status"] != "pending":
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
