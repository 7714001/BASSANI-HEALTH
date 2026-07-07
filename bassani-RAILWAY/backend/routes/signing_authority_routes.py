"""
Signing Authority management.

Stores the CEO/signatory profile used to auto-fill Bassani's side of all
co-signed onboarding documents. Only super_admin can read or write.

The signature image is stored in R2 at signing-authority/signature.png.
Text fields (name, title, location) are stored in the signing_authority
MongoDB collection (single document, keyed by a fixed id="current").

The signature image is served back to the frontend for preview and
is fetched at PDF-signing time by the fill-and-sign pipeline.
"""
import base64
import io
from datetime import datetime

from fastapi import APIRouter, Depends, File, Form, HTTPException, UploadFile
from fastapi.responses import StreamingResponse
from typing import Optional

from auth import get_current_user, require_admin
from database import col
from services.r2_client import r2_put, r2_get
from middleware.audit import audit_log

router = APIRouter(prefix="/api/signing-authority", tags=["signing-authority"])

R2_KEY = "signing-authority/signature.png"
_DOC_ID = "current"


def _require_super_admin(current_user: dict) -> None:
    if not current_user.get("is_super_admin") and current_user.get("role") != "super_admin":
        raise HTTPException(status_code=403, detail="Super admin access required")


# ── GET current profile ────────────────────────────────────────────────────────

@router.get("/", dependencies=[Depends(require_admin)])
async def get_signing_authority(current_user: dict = Depends(get_current_user)):
    _require_super_admin(current_user)

    doc = await col("signing_authority").find_one({"id": _DOC_ID})
    if not doc:
        return {"configured": False, "profile": None}

    return {
        "configured": True,
        "profile": {
            "name":           doc.get("name", ""),
            "title":          doc.get("title", ""),
            "location":       doc.get("location", ""),
            "has_signature":  doc.get("has_signature", False),
            "updated_at":     doc["updated_at"].isoformat() if doc.get("updated_at") else None,
            "updated_by":     doc.get("updated_by_name", ""),
            "holder_user_id": doc.get("holder_user_id", ""),
            "holder_name":    doc.get("holder_name", ""),
        },
    }


# ── Save / replace profile ─────────────────────────────────────────────────────

@router.post("/", dependencies=[Depends(require_admin)])
async def save_signing_authority(
    name:             str           = Form(...),
    title:            str           = Form(...),
    location:         str           = Form(...),
    holder_user_id:   Optional[str] = Form(None),   # portal user ID of the countersigning authority
    holder_name:      Optional[str] = Form(None),   # display name of that user
    signature_file:   Optional[UploadFile] = File(None),
    signature_drawn:  Optional[str] = Form(None),   # base64 data-URL from canvas
    current_user: dict = Depends(get_current_user),
):
    """
    Save or replace the signing authority profile.

    Accepts either a file upload (photo/scan) or a base64-encoded canvas PNG
    (drawn in-app). At least one must be provided on first setup; subsequent
    calls without a signature field leave the existing R2 image in place.
    """
    _require_super_admin(current_user)

    existing = await col("signing_authority").find_one({"id": _DOC_ID})
    has_existing_sig = bool(existing and existing.get("has_signature"))

    sig_bytes: Optional[bytes] = None

    if signature_file and signature_file.filename:
        # Validate image type
        ct = (signature_file.content_type or "").lower()
        fname = (signature_file.filename or "").lower()
        if not any(t in ct for t in ("png", "jpeg", "jpg", "webp")) and \
           not any(fname.endswith(e) for e in (".png", ".jpg", ".jpeg", ".webp")):
            raise HTTPException(status_code=422, detail="Signature must be a PNG, JPG, or WebP image")
        sig_bytes = await signature_file.read()
        if len(sig_bytes) > 5 * 1024 * 1024:
            raise HTTPException(status_code=413, detail="Signature image too large (5 MB max)")

    elif signature_drawn:
        # Strip data URL prefix: "data:image/png;base64,<data>"
        if "," in signature_drawn:
            signature_drawn = signature_drawn.split(",", 1)[1]
        try:
            sig_bytes = base64.b64decode(signature_drawn)
        except Exception:
            raise HTTPException(status_code=422, detail="Invalid base64 signature data")

    if sig_bytes is None and not has_existing_sig:
        raise HTTPException(
            status_code=422,
            detail="A signature image is required for first-time setup",
        )

    # Upload new signature to R2 if provided
    if sig_bytes is not None:
        await r2_put(R2_KEY, sig_bytes, content_type="image/png")

    now = datetime.utcnow()
    profile = {
        "id":              _DOC_ID,
        "name":            name.strip(),
        "title":           title.strip(),
        "location":        location.strip(),
        "has_signature":   True if (sig_bytes or has_existing_sig) else False,
        "updated_at":      now,
        "updated_by_id":   str(current_user.get("_id") or current_user.get("username", "")),
        "updated_by_name": current_user.get("name") or current_user.get("username", ""),
        "holder_user_id":  holder_user_id.strip() if holder_user_id else None,
        "holder_name":     holder_name.strip()    if holder_name    else None,
    }

    await col("signing_authority").replace_one({"id": _DOC_ID}, profile, upsert=True)

    await audit_log(
        user=current_user,
        action="signing_authority.updated",
        entity_type="signing_authority",
        entity_id=_DOC_ID,
        entity_label=f"Signing authority profile — {name.strip()}",
        after={
            "name":        name.strip(),
            "title":       title.strip(),
            "location":    location.strip(),
            "sig_replaced": sig_bytes is not None,
        },
    )

    return {"success": True, "signature_replaced": sig_bytes is not None}


# ── Holder check — any admin can call this ────────────────────────────────────

@router.get("/am-i-holder", dependencies=[Depends(require_admin)])
async def am_i_holder(current_user: dict = Depends(get_current_user)):
    """
    Returns whether the current user is the configured signing authority holder.
    Super admins always return True. For other admins, the user must match the
    explicit holder_user_id saved on the signing authority profile.
    Any authenticated admin may call this.
    """
    # Super admins can always countersign
    if current_user.get("is_super_admin") or current_user.get("role") == "super_admin":
        return {"is_holder": True}

    doc = await col("signing_authority").find_one({"id": _DOC_ID})
    if not doc:
        return {"is_holder": False}

    current_uid = str(current_user.get("_id") or current_user.get("username", ""))
    # Check explicit holder_user_id first, fall back to updated_by_id for legacy records
    holder_uid = doc.get("holder_user_id") or doc.get("updated_by_id")
    return {"is_holder": holder_uid == current_uid}


# ── Serve signature image (for preview and PDF embedding) ─────────────────────

@router.get("/signature", dependencies=[Depends(require_admin)])
async def get_signature_image(current_user: dict = Depends(get_current_user)):
    doc = await col("signing_authority").find_one({"id": _DOC_ID})
    if not doc or not doc.get("has_signature"):
        raise HTTPException(status_code=404, detail="No signature configured")

    # Super admins and the signing authority holder can fetch the signature image.
    current_uid = str(current_user.get("_id") or current_user.get("username", ""))
    is_super    = current_user.get("is_super_admin") or current_user.get("role") == "super_admin"
    is_holder   = doc.get("updated_by_id") == current_uid
    if not is_super and not is_holder:
        raise HTTPException(status_code=403, detail="Super admin or signing authority holder access required")

    try:
        data = await r2_get(R2_KEY)
    except Exception:
        raise HTTPException(status_code=404, detail="Signature image not found in storage")

    return StreamingResponse(
        io.BytesIO(data),
        media_type="image/png",
        headers={"Cache-Control": "no-store"},
    )
