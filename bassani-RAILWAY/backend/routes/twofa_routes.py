"""2FA — TOTP (Google Authenticator compatible) for admin users."""
from fastapi import APIRouter, Depends, HTTPException
from pydantic import BaseModel
import pyotp, qrcode, base64, io
from datetime import datetime, timezone
from auth import get_current_user, require_admin
from database import col
from config import get_settings

router = APIRouter(prefix="/api/2fa", tags=["2fa"])
settings = get_settings()

class TOTPVerify(BaseModel):
    code: str      # 6-digit code from authenticator app

class TOTPDisable(BaseModel):
    code: str
    password: str

@router.post("/setup")
async def setup_totp(current_user: dict = Depends(get_current_user)):
    """Generate a new TOTP secret and QR code URI for the user."""
    secret = pyotp.random_base32()
    totp   = pyotp.TOTP(secret)
    uri    = totp.provisioning_uri(
        name=current_user["username"],
        issuer_name=settings.totp_issuer
    )
    # Generate QR code as base64 PNG
    qr = qrcode.make(uri)
    buf = io.BytesIO(); qr.save(buf, format="PNG")
    qr_b64 = base64.b64encode(buf.getvalue()).decode()

    # Store secret (unverified until confirm)
    await col("users").update_one(
        {"id": current_user["id"]},
        {"$set": {"totp_secret_pending": secret, "updated_at": datetime.now(timezone.utc)}}
    )
    return {"secret": secret, "uri": uri, "qr_base64": qr_b64,
            "message": "Scan the QR code in your authenticator app, then confirm with a code."}

@router.post("/confirm")
async def confirm_totp(body: TOTPVerify, current_user: dict = Depends(get_current_user)):
    """Verify the code and activate 2FA."""
    user = await col("users").find_one({"id": current_user["id"]})
    secret = user.get("totp_secret_pending")
    if not secret: raise HTTPException(400, "No pending 2FA setup. Call /setup first.")
    if not pyotp.TOTP(secret).verify(body.code, valid_window=1):
        raise HTTPException(400, "Invalid code. Try again.")
    await col("users").update_one({"id": current_user["id"]}, {
        "$set": {"totp_secret": secret, "totp_enabled": True,
                 "totp_enabled_at": datetime.now(timezone.utc)},
        "$unset": {"totp_secret_pending": ""}
    })
    return {"success": True, "message": "2FA activated."}

@router.post("/verify")
async def verify_totp(body: TOTPVerify, current_user: dict = Depends(get_current_user)):
    """Verify a TOTP code (called after password login when 2FA is enabled)."""
    user = await col("users").find_one({"id": current_user["id"]})
    secret = user.get("totp_secret")
    if not secret: raise HTTPException(400, "2FA not enabled for this account.")
    if not pyotp.TOTP(secret).verify(body.code, valid_window=1):
        raise HTTPException(401, "Invalid 2FA code.")
    return {"success": True, "verified": True}

@router.delete("/disable")
async def disable_totp(body: TOTPDisable, current_user: dict = Depends(get_current_user)):
    """Disable 2FA (requires valid code as confirmation)."""
    user = await col("users").find_one({"id": current_user["id"]})
    secret = user.get("totp_secret")
    if not secret: raise HTTPException(400, "2FA not enabled.")
    if not pyotp.TOTP(secret).verify(body.code, valid_window=1):
        raise HTTPException(401, "Invalid 2FA code.")
    await col("users").update_one({"id": current_user["id"]}, {
        "$set": {"totp_enabled": False}, "$unset": {"totp_secret": ""}
    })
    return {"success": True, "message": "2FA disabled."}

@router.get("/status")
async def totp_status(current_user: dict = Depends(get_current_user)):
    user = await col("users").find_one({"id": current_user["id"]})
    return {"enabled": bool(user.get("totp_enabled")),
            "enabled_at": user.get("totp_enabled_at")}
