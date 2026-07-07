"""
Public registration endpoints — no authentication required.

These serve the self-service customer registration page (/apply).
Callers are unauthenticated: potential Bassani customers or referred contacts.
Session IDs are validated as UUIDs to prevent path traversal on R2 keys.
"""
from fastapi import APIRouter, BackgroundTasks, File, HTTPException, UploadFile
from fastapi.responses import FileResponse, StreamingResponse
from typing import Optional
from pydantic import BaseModel
from datetime import datetime, timezone
import os
import uuid

from database import col, NO_ID
from services.r2_client import r2_put, r2_delete

router = APIRouter(prefix="/api/public", tags=["public"])

_TEMPLATE_DIR = os.path.join(os.path.dirname(__file__), "..", "static", "onboarding-templates")

TEMPLATES: dict[str, str] = {
    "store-onboarding-agreement.pdf": "Store Onboarding Agreement",
    "customer-information-form.pdf":  "Customer Information Form",
    "nda.pdf":                        "NDA",
    "tqa.pdf":                        "TQA Document",
}

REQUIRED_DOC_TYPES: dict[str, str] = {
    "store_onboarding_agreement": "Signed Store Onboarding Agreement",
    "customer_information_form":  "Signed Customer Information Form",
    "nda":                        "Signed NDA",
    "tqa":                        "Signed TQA Document",
    "cipc_certificate":           "CIPC Company Registration Certificate",
}


class PublicRegistration(BaseModel):
    document_session_id: str
    documents:           list = []
    referral_code:       Optional[str] = None   # reseller portal user_id from ?ref= param

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


def _validate_session(session_id: str) -> None:
    try:
        uuid.UUID(session_id)
    except ValueError:
        raise HTTPException(status_code=400, detail="Invalid session ID")


@router.get("/referral/{referral_code}")
async def validate_referral(referral_code: str):
    """
    Validate a reseller referral code and return the reseller display name.
    The code is the reseller's portal user_id (from JWT sub).
    Returns 404 for invalid codes — callers should silently ignore rather than
    surface an error, to avoid referral code enumeration.
    """
    reseller = await col("resellers").find_one({"user_id": referral_code}, NO_ID)
    if not reseller:
        raise HTTPException(status_code=404, detail="Referral link not found")
    return {
        "valid":         True,
        "reseller_name": reseller.get("name") or reseller.get("company_name", ""),
        "reseller_id":   reseller.get("id"),
    }


@router.get("/templates")
async def list_public_templates():
    from routes.doc_template_routes import FILENAME_TO_DOC_TYPE, get_active_template_bytes
    result = []
    for filename, label in TEMPLATES.items():
        doc_type  = FILENAME_TO_DOC_TYPE.get(filename)
        r2_active = bool(doc_type and await get_active_template_bytes(doc_type))
        fpath     = os.path.join(_TEMPLATE_DIR, filename)
        result.append({
            "filename":  filename,
            "label":     label,
            "available": r2_active or os.path.exists(fpath),
            "managed":   r2_active,
        })
    return {"templates": result}


@router.get("/templates/download/{filename}")
async def download_public_template(filename: str):
    if filename not in TEMPLATES:
        raise HTTPException(status_code=404, detail="Template not found")

    # Serve managed R2 version if one has been uploaded; fall back to static file
    from routes.doc_template_routes import FILENAME_TO_DOC_TYPE, get_active_template_bytes
    import io
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
        raise HTTPException(status_code=404, detail="Template file not yet available")
    return FileResponse(fpath, media_type="application/pdf", filename=filename)


@router.post("/documents/upload")
async def upload_document_public(
    session_id: str,
    doc_type:   str,
    file: UploadFile = File(...),
):
    """Upload a signed document to R2 for a self-service registration session."""
    _validate_session(session_id)
    if doc_type not in REQUIRED_DOC_TYPES:
        raise HTTPException(status_code=400, detail=f"Unknown document type: {doc_type}")

    contents = await file.read()
    if len(contents) > 20 * 1024 * 1024:
        raise HTTPException(status_code=413, detail="File too large (20 MB maximum)")

    ext = os.path.splitext(file.filename or "")[1] or ".pdf"
    key = f"onboarding/sessions/{session_id}/{doc_type}{ext}"
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
async def delete_document_public(session_id: str, doc_type: str):
    _validate_session(session_id)
    if doc_type not in REQUIRED_DOC_TYPES:
        raise HTTPException(status_code=400, detail=f"Unknown document type: {doc_type}")
    for ext in [".pdf", ".jpg", ".jpeg", ".png", ".doc", ".docx"]:
        try:
            await r2_delete(f"onboarding/sessions/{session_id}/{doc_type}{ext}")
        except Exception:
            pass
    return {"success": True}


@router.post("/register")
async def submit_public_registration(
    registration: PublicRegistration,
    background_tasks: BackgroundTasks,
):
    """
    Submit a self-service customer registration application.
    Creates a customer_onboarding document with source='self_service'.
    If a valid referral_code is supplied the application is linked to that reseller.
    All 5 documents are required before submission (no inbox fallback on this path).
    """
    from routes.settings_routes import get_email_routing
    from services.email_service import send_onboarding_submitted

    # Resolve referral code to reseller (silently ignored if invalid)
    reseller_id   = None
    reseller_name = ""
    if registration.referral_code:
        reseller = await col("resellers").find_one(
            {"user_id": registration.referral_code}, NO_ID
        )
        if reseller:
            reseller_id   = reseller.get("id")
            reseller_name = reseller.get("name") or reseller.get("company_name", "")

    # Require all 5 documents
    submitted_types = {d.get("doc_type") for d in (registration.documents or [])}
    missing = [label for dtype, label in REQUIRED_DOC_TYPES.items()
               if dtype not in submitted_types]
    if missing:
        raise HTTPException(
            status_code=400,
            detail=f"Missing required documents: {', '.join(missing)}",
        )

    ref = f"APP-{str(uuid.uuid4())[:8].upper()}"
    now = datetime.now(timezone.utc)

    doc = {
        "id":                  ref,
        "reseller_id":         reseller_id,
        "reseller_name":       reseller_name,
        "source":              "self_service",
        "status":              "pending",
        "submitted_at":        now,
        "reviewed_at":         None,
        "reviewed_by":         None,
        "rejection_reason":    None,
        "odoo_partner_id":     None,
        "document_session_id": registration.document_session_id,
        "documents":           registration.documents or [],
        **{k: v for k, v in registration.model_dump().items()
           if k not in ("document_session_id", "documents", "referral_code")},
    }
    await col("customer_onboarding").insert_one(doc)

    routing = await get_email_routing()
    background_tasks.add_task(
        send_onboarding_submitted,
        company_name=registration.company_name,
        reseller_name=reseller_name or "Direct (self-service)",
        app_ref=ref,
        to=routing["application_submitted_to"],
        source="self_service",
    )

    async def _send_confirmation():
        """
        Send the registration confirmation from the onboarding mailbox so the
        applicant's reply auto-threads back into Onboarding Inbox and is linked
        to this application. Falls back to Resend when the mailbox is not yet set up.
        """
        from services.imap_client import get_config as _imap_cfg, get_graph_mailbox_address
        from services.graph_client import graph_configured
        from services.email_service import (
            _wrap as _email_wrap, _h1, _p, _info_box, _divider,
            send_registration_confirmation,
        )

        onboarding_graph_address = get_graph_mailbox_address("onboarding")
        imap_cfg = _imap_cfg("onboarding")
        use_graph = graph_configured() and bool(onboarding_graph_address)
        mailbox_configured = use_graph or bool(imap_cfg)

        if not mailbox_configured:
            send_registration_confirmation(
                company_name=registration.company_name,
                contact_name=registration.contact_name,
                contact_email=registration.contact_email,
                app_ref=ref,
            )
            return

        from_address = onboarding_graph_address if use_graph else (
            imap_cfg.get("mailbox_address") or imap_cfg.get("imap_username", "")
        )

        contact_name = registration.contact_name or registration.company_name
        subject = f"Application Received: {registration.company_name}"
        body_html = _email_wrap(
            _h1("We have received your application")
            + _p(f"Hi {contact_name},")
            + _p(
                "Thank you for submitting your registration with Bassani Health. "
                "We have received your application and will review it within 2 to 3 business days."
            )
            + _info_box([
                ("Reference",     ref),
                ("Business name", registration.company_name),
                ("Contact email", registration.contact_email),
            ])
            + _divider()
            + _p(
                "If you have any questions, please reply directly to this email and "
                "a member of our team will assist you.",
                muted=True,
            )
        )

        now_ts = datetime.now(timezone.utc)
        thread_doc = {
            "mailbox_address": from_address,
            "from_email":      from_address,
            "from_name":       "Bassani Health",
            "to_email":        registration.contact_email,
            "subject":         subject,
            "body_html":       body_html,
            "body_preview":    f"Application received. Reference: {ref}",
            "is_outgoing":     True,
            "status":          "application_linked",
            "received_at":     now_ts,
            "has_attachments": False,
            "attachments":     [],
            "thread_root_id":  None,
            "is_read":         True,
            "created_at":      now_ts,
            "sent_by":         "system",
            "application_id":  ref,
            "reseller_id":     reseller_id,
            "reseller_name":   reseller_name,
        }
        result = await col("onboarding_inbox").insert_one(thread_doc)
        item_id_str = str(result.inserted_id)

        await col("onboarding_inbox").update_one(
            {"_id": result.inserted_id},
            {"$set": {"thread_root_id": item_id_str}},
        )
        await col("customer_onboarding").update_one(
            {"id": ref},
            {"$set": {"inbox_thread_id": item_id_str}},
        )

        try:
            if use_graph:
                from services.graph_client import send_mail as graph_send_mail
                await graph_send_mail(
                    to_email=registration.contact_email,
                    subject=subject,
                    body_html=body_html,
                    mailbox_address=onboarding_graph_address,
                )
            else:
                from services.imap_client import send_new_email as imap_send_new
                message_id = await imap_send_new(
                    to_email=registration.contact_email,
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
                "public.register_confirmation_send_failed app=%s error=%s", ref, exc
            )

    background_tasks.add_task(_send_confirmation)

    return {"success": True, "reference": ref}
