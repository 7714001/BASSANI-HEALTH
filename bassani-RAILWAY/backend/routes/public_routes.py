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
    "customer-information-form.pdf":      "Customer Information Form",
    "nda.pdf":                            "Non-Disclosure Agreement",
    "store-onboarding-agreement.pdf":     "Store Onboarding Agreement",
}

# Documents submitted by the customer at registration time.
# NDA + Store Onboarding Agreement are sent by admin via signing session after review.
REQUIRED_DOC_TYPES: dict[str, str] = {
    "customer_information_form":  "Signed Customer Information Form",
    "cipc_certificate":           "CIPC Company Registration Certificate",
}

# Doc types accepted via the signing session flow (not the regular upload endpoint)
SIGNING_SESSION_DOC_TYPES: frozenset[str] = frozenset({"nda", "store_onboarding_agreement"})


class PublicRegistration(BaseModel):
    document_session_id: str
    documents:           list = []
    referral_code:       Optional[str] = None   # reseller portal user_id from ?ref= param

    # Step 1 — Business details
    company_name:             str
    trading_name:             Optional[str] = ""
    registration_number:      Optional[str] = ""
    vat_number:               Optional[str] = ""
    business_category:        Optional[str] = ""
    business_category_other:  Optional[str] = ""
    entity_type:              Optional[str] = ""
    entity_type_other:        Optional[str] = ""
    section22c_licensed:      bool = False
    business_type:            Optional[str] = ""   # legacy — kept for old applications

    # Step 2 — Primary contact
    contact_name:        str
    contact_position:    Optional[str] = ""
    contact_email:       str
    contact_phone:       str
    contact_alt_phone:   Optional[str] = ""
    signatory_id_number: Optional[str] = ""

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


@router.get("/signing-authority-meta")
async def get_public_signing_meta():
    """
    Returns Bassani signing authority name and title for public document pre-fill.
    Intentionally omits the signature image — that is only available to authenticated admins.
    """
    doc = await col("signing_authority").find_one({}, NO_ID)
    if not doc:
        return {"name": "", "title": ""}
    return {"name": doc.get("name", ""), "title": doc.get("title", "")}


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
    session_id:       str,
    doc_type:         str,
    signed_in_portal: bool = False,
    file: UploadFile = File(...),
):
    """Upload a signed document to R2 for a self-service registration session.

    signed_in_portal=true is set by the in-browser CustomerSigningModal so that
    the admin review page can identify which documents require countersigning.
    """
    _validate_session(session_id)
    if doc_type not in REQUIRED_DOC_TYPES:
        raise HTTPException(status_code=400, detail=f"Unknown document type: {doc_type}")

    contents = await file.read()
    if len(contents) > 20 * 1024 * 1024:
        raise HTTPException(status_code=413, detail="File too large (20 MB maximum)")

    ext = os.path.splitext(file.filename or "")[1] or ".pdf"
    key = f"onboarding/sessions/{session_id}/{doc_type}{ext}"
    await r2_put(key, contents, file.content_type or "application/octet-stream")

    result = {
        "doc_type":    doc_type,
        "label":       REQUIRED_DOC_TYPES[doc_type],
        "r2_key":      key,
        "filename":    file.filename,
        "size":        len(contents),
        "uploaded_at": datetime.now(timezone.utc).isoformat(),
    }
    if signed_in_portal:
        result["signed_in_portal"] = True
    return result


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
    Two documents are required at submission: Customer Information Form + CIPC certificate.
    NDA and Store Onboarding Agreement are sent by admin via signing session after review.
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

    # Require initial 2 documents at submission
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
            {"$addToSet": {"inbox_thread_ids": item_id_str}},
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


# ── Public signing session endpoints ──────────────────────────────────────────
# These serve the /sign/:token page (no auth required).

@router.get("/signing/{token}")
async def get_signing_session(token: str):
    """
    Validate a signing session token and return the form data and docs to sign.
    Called by the public /sign/:token page before rendering the signing UI.
    """
    try:
        uuid.UUID(token)
    except ValueError:
        raise HTTPException(status_code=400, detail="Invalid token")

    session = await col("signing_sessions").find_one({"token": token}, NO_ID)
    if not session:
        raise HTTPException(status_code=404, detail="Signing link not found or has already been used")

    from datetime import timezone as _tz
    now = datetime.now(_tz.utc)
    expires_at = session.get("expires_at")
    if expires_at and expires_at.tzinfo is None:
        expires_at = expires_at.replace(tzinfo=_tz.utc)
    if expires_at and now > expires_at:
        raise HTTPException(status_code=410, detail="This signing link has expired. Please contact Bassani Health to request a new one.")

    # Sessions in "generated" state have not been deliberately sent to the customer yet.
    # "pending" is the legacy status from before the generate/send split — treat as sent.
    session_status = session.get("status", "pending")
    if session_status == "generated":
        raise HTTPException(status_code=403, detail="This signing link is not yet active. Please contact Bassani Health.")

    return {
        "token":          token,
        "form_data":      session.get("form_data", {}),
        "docs_to_sign":   session.get("docs_to_sign", []),
        "signed":         session.get("signed", {}),
        "expires_at":     expires_at.isoformat() if expires_at else None,
        "sent_by_email":  session.get("sent_by_email", ""),
    }


@router.post("/signing/{token}/sign/{doc_type}")
async def submit_signed_doc(token: str, doc_type: str, file: UploadFile = File(...)):
    """
    Accept a signed PDF for a specific doc type and store it in R2.
    Updates the signing session and stamps the document onto the application.
    """
    try:
        uuid.UUID(token)
    except ValueError:
        raise HTTPException(status_code=400, detail="Invalid token")

    if doc_type not in SIGNING_SESSION_DOC_TYPES:
        raise HTTPException(status_code=400, detail=f"Unknown document type: {doc_type}")

    session = await col("signing_sessions").find_one({"token": token}, NO_ID)
    if not session:
        raise HTTPException(status_code=404, detail="Signing link not found")

    from datetime import timezone as _tz
    now = datetime.now(_tz.utc)
    expires_at = session.get("expires_at")
    if expires_at and expires_at.tzinfo is None:
        expires_at = expires_at.replace(tzinfo=_tz.utc)
    if expires_at and now > expires_at:
        raise HTTPException(status_code=410, detail="This signing link has expired")

    if doc_type not in session.get("docs_to_sign", []):
        raise HTTPException(status_code=400, detail=f"{doc_type} is not part of this signing session")

    contents = await file.read()
    if len(contents) > 20 * 1024 * 1024:
        raise HTTPException(status_code=413, detail="File too large (20 MB maximum)")

    ext = os.path.splitext(file.filename or "")[1] or ".pdf"
    r2_key = f"onboarding/signing-sessions/{token}/{doc_type}{ext}"
    await r2_put(r2_key, contents, file.content_type or "application/pdf")

    doc_labels = {
        "nda":                        "Signed NDA",
        "store_onboarding_agreement": "Signed Store Onboarding Agreement",
    }

    signed_entry = {
        "r2_key":      r2_key,
        "filename":    file.filename,
        "signed_at":   now.isoformat(),
        "size":        len(contents),
    }

    # Update session
    updated_signed = {**session.get("signed", {}), doc_type: signed_entry}
    all_signed = all(d in updated_signed for d in session.get("docs_to_sign", []))
    new_status = "fully_signed" if all_signed else "partially_signed"

    await col("signing_sessions").update_one(
        {"token": token},
        {"$set": {f"signed.{doc_type}": signed_entry, "status": new_status}},
    )

    # Stamp document onto the application so it appears in the admin docs list
    app_id = session.get("app_id")
    if app_id:
        doc_record = {
            "doc_type":        doc_type,
            "label":           doc_labels.get(doc_type, doc_type),
            "r2_key":          r2_key,
            "filename":        file.filename,
            "size":            len(contents),
            "uploaded_at":     now.isoformat(),
            "signed_in_portal": True,
        }
        # Remove any existing entry for this doc_type, then push the new one
        await col("customer_onboarding").update_one(
            {"id": app_id},
            {"$pull": {"documents": {"doc_type": doc_type}}},
        )
        await col("customer_onboarding").update_one(
            {"id": app_id},
            {"$push": {"documents": doc_record}},
        )

    return {"success": True, "doc_type": doc_type, "all_signed": all_signed}
