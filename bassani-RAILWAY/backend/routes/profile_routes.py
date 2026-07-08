"""
My Profile — personal settings for the authenticated user.

Covers:
  - Viewing and updating display name, signing name, signing title
  - Uploading or drawing a personal signature (requires signing_authority.sign)
  - Serving the user's own signature image for countersigning flows

Signature images are stored in R2 at user-signatures/{user_id}.png.
"""
import base64
import io
from datetime import datetime

from fastapi import APIRouter, Depends, File, Form, HTTPException, UploadFile
from fastapi.responses import StreamingResponse
from pydantic import BaseModel
from typing import Optional

from auth import get_current_user, require_permission
from database import col
from services.r2_client import r2_put, r2_get, r2_delete
from middleware.audit import audit_log

router = APIRouter(prefix="/api/profile", tags=["profile"])


def _sig_key(user_id: str) -> str:
    return f"user-signatures/{user_id}.png"


# ── GET own profile ────────────────────────────────────────────────────────────

@router.get("/")
async def get_profile(current_user: dict = Depends(get_current_user)):
    uid = current_user.get("id", "")
    doc = await col("users").find_one({"id": uid})
    return {
        "id":            uid,
        "username":      current_user.get("username", ""),
        "name":          doc.get("name", "") if doc else current_user.get("name", ""),
        "email":         doc.get("email", "") if doc else current_user.get("email", ""),
        "role":          current_user.get("role", ""),
        "is_super_admin": bool(current_user.get("is_super_admin", False)),
        "signing_name":  doc.get("signing_name", "") if doc else "",
        "signing_title": doc.get("signing_title", "") if doc else "",
        "has_signature": bool(doc.get("has_signature", False)) if doc else False,
        "signature_updated_at": doc.get("signature_updated_at").isoformat() if doc and doc.get("signature_updated_at") else None,
    }


# ── PUT own profile ────────────────────────────────────────────────────────────

class UpdateProfileBody(BaseModel):
    name:          Optional[str] = None
    signing_name:  Optional[str] = None
    signing_title: Optional[str] = None


@router.put("/")
async def update_profile(
    body: UpdateProfileBody,
    current_user: dict = Depends(get_current_user),
):
    updates: dict = {}
    if body.name is not None:
        updates["name"] = body.name.strip()
    if body.signing_name is not None:
        updates["signing_name"] = body.signing_name.strip()
    if body.signing_title is not None:
        updates["signing_title"] = body.signing_title.strip()

    if not updates:
        return {"success": True}

    uid = current_user.get("id", "")
    updates["updated_at"] = datetime.utcnow()
    await col("users").update_one({"id": uid}, {"$set": updates})

    await audit_log(
        user=current_user,
        action="profile.updated",
        entity_type="user",
        entity_id=uid,
        entity_label=f"Profile — {current_user.get('username', '')}",
        after=updates,
    )
    return {"success": True}


# ── POST own signature ─────────────────────────────────────────────────────────

@router.post("/signature")
async def upload_signature(
    signature_file:  Optional[UploadFile] = File(None),
    signature_drawn: Optional[str]        = Form(None),
    current_user: dict = Depends(require_permission("signing_authority.sign")),
):
    """Upload or draw a personal signature for use when countersigning documents."""
    uid = current_user.get("id", "")

    sig_bytes: Optional[bytes] = None

    if signature_file and signature_file.filename:
        ct    = (signature_file.content_type or "").lower()
        fname = (signature_file.filename or "").lower()
        if not any(t in ct for t in ("png", "jpeg", "jpg", "webp")) and \
           not any(fname.endswith(e) for e in (".png", ".jpg", ".jpeg", ".webp")):
            raise HTTPException(status_code=422, detail="Signature must be a PNG, JPG, or WebP image")
        sig_bytes = await signature_file.read()
        if len(sig_bytes) > 5 * 1024 * 1024:
            raise HTTPException(status_code=413, detail="Signature image too large (5 MB max)")

    elif signature_drawn:
        if "," in signature_drawn:
            signature_drawn = signature_drawn.split(",", 1)[1]
        try:
            sig_bytes = base64.b64decode(signature_drawn)
        except Exception:
            raise HTTPException(status_code=422, detail="Invalid base64 signature data")

    if sig_bytes is None:
        raise HTTPException(status_code=422, detail="A signature image or drawn signature is required")

    await r2_put(_sig_key(uid), sig_bytes, content_type="image/png")

    now = datetime.utcnow()
    await col("users").update_one(
        {"id": uid},
        {"$set": {"has_signature": True, "signature_updated_at": now}},
    )

    await audit_log(
        user=current_user,
        action="profile.signature_uploaded",
        entity_type="user",
        entity_id=uid,
        entity_label=f"Signature — {current_user.get('name') or current_user.get('username', '')}",
        after={"has_signature": True, "updated_at": now.isoformat()},
    )
    return {"success": True}


# ── GET own signature image ────────────────────────────────────────────────────

@router.get("/signature")
async def get_signature(current_user: dict = Depends(require_permission("signing_authority.sign"))):
    """Serve the authenticated user's own signature image for preview or PDF embedding."""
    uid = current_user.get("id", "")
    doc = await col("users").find_one({"id": uid}, {"has_signature": 1})
    if not doc or not doc.get("has_signature"):
        raise HTTPException(status_code=404, detail="No signature configured — upload one in My Profile")

    try:
        data = await r2_get(_sig_key(uid))
    except Exception:
        raise HTTPException(status_code=404, detail="Signature image not found in storage")

    return StreamingResponse(
        io.BytesIO(data),
        media_type="image/png",
        headers={"Cache-Control": "no-store"},
    )


# ── DELETE own signature ───────────────────────────────────────────────────────

@router.delete("/signature")
async def delete_signature(current_user: dict = Depends(require_permission("signing_authority.sign"))):
    uid = current_user.get("id", "")
    try:
        await r2_delete(_sig_key(uid))
    except Exception:
        pass
    await col("users").update_one(
        {"id": uid},
        {"$set": {"has_signature": False}, "$unset": {"signature_updated_at": ""}},
    )
    await audit_log(
        user=current_user,
        action="profile.signature_deleted",
        entity_type="user",
        entity_id=uid,
        entity_label=f"Signature — {current_user.get('name') or current_user.get('username', '')}",
        after={"has_signature": False},
    )
    return {"success": True}
