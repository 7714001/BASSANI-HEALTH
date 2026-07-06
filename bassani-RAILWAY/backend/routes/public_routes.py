"""
Public registration endpoints — no authentication required.

These serve the self-service customer registration page (/apply).
Callers are unauthenticated: potential Bassani customers or referred contacts.
Session IDs are validated as UUIDs to prevent path traversal on R2 keys.
"""
from fastapi import APIRouter, BackgroundTasks, File, HTTPException, UploadFile
from fastapi.responses import FileResponse
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
async def download_public_template(filename: str):
    if filename not in TEMPLATES:
        raise HTTPException(status_code=404, detail="Template not found")
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
    from services.email_service import send_onboarding_submitted, send_registration_confirmation

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
    background_tasks.add_task(
        send_registration_confirmation,
        company_name=registration.company_name,
        contact_name=registration.contact_name,
        contact_email=registration.contact_email,
        app_ref=ref,
    )

    return {"success": True, "reference": ref}
