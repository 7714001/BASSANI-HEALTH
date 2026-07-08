import hashlib
import logging
import random
import re
import secrets
from datetime import datetime, timedelta, timezone

from fastapi import APIRouter, BackgroundTasks, Depends, HTTPException, Request, status
from fastapi.security import OAuth2PasswordRequestForm
from pydantic import BaseModel
from bson import ObjectId

from auth import (
    authenticate_user, create_access_token,
    get_current_user, get_user_by_username,
    Token, verify_password, hash_password,
)
from config import get_settings
from database import col
from middleware.audit import audit_log
from rate_limit import limiter

logger = logging.getLogger(__name__)

router = APIRouter(prefix="/api/auth", tags=["auth"])


class ChangePasswordBody(BaseModel):
    current_password: str
    new_password: str


class VerifyOtpBody(BaseModel):
    session_id: str
    otp: str


def _user_payload(user: dict) -> dict:
    """Build the public user object returned by login and /me."""
    return {
        "id":            user["id"],
        "username":      user["username"],
        "role":          user.get("role", "reseller"),
        "name":          user.get("name", ""),
        "display_name":  user.get("display_name", ""),
        "reseller_id":   user.get("reseller_id"),
        "is_super_admin": bool(user.get("is_super_admin", False)),
        "permissions":   user.get("permissions") or {},
        "warehouse_id":        user.get("warehouse_id"),
        "active_warehouse_id": user.get("active_warehouse_id"),
        "must_change_password": bool(user.get("must_change_password", False)),
        "commission_eligible": bool(user.get("commission_eligible", True)),
    }


@router.post("/login", response_model=Token)
@limiter.limit("5/15minutes")
async def login(
    request: Request,
    background_tasks: BackgroundTasks,
    form_data: OAuth2PasswordRequestForm = Depends(),
):
    settings = get_settings()
    user = await authenticate_user(form_data.username, form_data.password)
    if not user:
        raise HTTPException(
            status_code=status.HTTP_401_UNAUTHORIZED,
            detail="Incorrect username or password",
            headers={"WWW-Authenticate": "Bearer"},
        )

    # Email OTP 2FA — applies to any account that has an email address stored
    email = user.get("email")
    if settings.require_2fa_admin and email:
        from services.email_service import send_otp_email
        otp = f"{random.randint(100000, 999999)}"
        otp_hash = hashlib.sha256(otp.encode()).hexdigest()
        session_token = secrets.token_urlsafe(32)
        await col("otp_sessions").insert_one({
            "session_token": session_token,
            "username": user["username"],
            "otp_hash": otp_hash,
            "expires_at": datetime.now(timezone.utc) + timedelta(minutes=10),
            "attempts": 0,
        })
        background_tasks.add_task(
            send_otp_email,
            email,
            user.get("name") or user["username"],
            otp,
        )
        return Token(otp_required=True, otp_session_id=session_token)

    token = create_access_token(data={"sub": user["username"], "tv": user.get("token_version") or 0})
    await col("users").update_one(
        {"username": user["username"]},
        {"$set": {"last_login_at": datetime.now(timezone.utc)}},
    )
    await audit_log("user.login", "user", user["id"], entity_label=user["username"], user=user,
                    reseller_id=user.get("reseller_id"))
    return Token(access_token=token, token_type="bearer", user=_user_payload(user))


@router.post("/verify-otp", response_model=Token)
@limiter.limit("10/15minutes")
async def verify_otp(request: Request, body: VerifyOtpBody):
    now = datetime.now(timezone.utc)
    session = await col("otp_sessions").find_one({"session_token": body.session_id})
    if not session:
        raise HTTPException(status_code=401,
                            detail="Invalid or expired session. Please sign in again.")

    # Normalise stored datetime to timezone-aware for comparison
    exp = session["expires_at"]
    if exp.tzinfo is None:
        exp = exp.replace(tzinfo=timezone.utc)
    if exp < now:
        await col("otp_sessions").delete_one({"session_token": body.session_id})
        raise HTTPException(status_code=401,
                            detail="Code has expired. Please sign in again.")

    if session["attempts"] >= 3:
        await col("otp_sessions").delete_one({"session_token": body.session_id})
        raise HTTPException(status_code=401,
                            detail="Too many incorrect attempts. Please sign in again.")

    otp_hash = hashlib.sha256(body.otp.strip().encode()).hexdigest()
    if otp_hash != session["otp_hash"]:
        new_attempts = session["attempts"] + 1
        if new_attempts >= 3:
            await col("otp_sessions").delete_one({"session_token": body.session_id})
            raise HTTPException(status_code=400,
                                detail="Incorrect code. You have used all attempts. Please sign in again.")
        await col("otp_sessions").update_one(
            {"session_token": body.session_id},
            {"$inc": {"attempts": 1}},
        )
        remaining = 3 - new_attempts
        noun = "attempt" if remaining == 1 else "attempts"
        raise HTTPException(status_code=400,
                            detail=f"Incorrect code. {remaining} {noun} remaining.")

    await col("otp_sessions").delete_one({"session_token": body.session_id})

    user = await get_user_by_username(session["username"])
    if not user or not user.get("active", True):
        raise HTTPException(status_code=401, detail="Account is no longer active.")

    token = create_access_token(data={"sub": user["username"], "tv": user.get("token_version") or 0})
    await col("users").update_one(
        {"username": user["username"]},
        {"$set": {"last_login_at": now}},
    )
    await audit_log("user.login", "user", user["id"], entity_label=user["username"], user=user,
                    reseller_id=user.get("reseller_id"))
    return Token(access_token=token, token_type="bearer", user=_user_payload(user))


@router.get("/me")
async def me(current_user: dict = Depends(get_current_user)):
    return _user_payload(current_user)


class ForgotPasswordBody(BaseModel):
    email: str


class ResetPasswordBody(BaseModel):
    token: str
    new_password: str


@router.post("/forgot-password")
@limiter.limit("3/hour")
async def forgot_password(
    request: Request,
    body: ForgotPasswordBody,
    background_tasks: BackgroundTasks,
):
    """
    Initiates a self-service password reset. Always returns success — never
    reveals whether an account exists for the given email (prevents enumeration).
    Generates a 256-bit token, stores it SHA-256 hashed with a 15-minute TTL,
    and emails a reset link via Resend.
    """
    email_lower = body.email.strip().lower()
    user = await col("users").find_one(
        {"email": {"$regex": f"^{re.escape(email_lower)}$", "$options": "i"},
         "active": {"$ne": False}},
    )
    if user and not user.get("is_super_admin") and user.get("role") != "super_admin":
        user["id"] = str(user.pop("_id"))
        token = secrets.token_urlsafe(32)
        token_hash = hashlib.sha256(token.encode()).hexdigest()
        await col("password_reset_tokens").insert_one({
            "token_hash": token_hash,
            "username":   user["username"],
            "created_at": datetime.now(timezone.utc),
            "expires_at": datetime.now(timezone.utc) + timedelta(minutes=15),
        })
        from config import get_settings as _gs
        _s = _gs()
        reset_url = f"{_s.portal_url}/reset-password?token={token}"
        from services.email_service import send_password_reset_email
        background_tasks.add_task(
            send_password_reset_email,
            email_lower,
            user.get("name") or user["username"],
            reset_url,
        )
        background_tasks.add_task(
            audit_log,
            "user.password_reset_requested", "user", user["id"],
            entity_label=user["username"], user=user,
        )
    return {"success": True}


@router.post("/reset-password")
@limiter.limit("10/hour")
async def reset_password(
    request: Request,
    body: ResetPasswordBody,
):
    """
    Completes a password reset. Validates the token (hashed lookup, TTL check),
    deletes it immediately (single-use), updates the password, and bumps
    token_version so all existing sessions for this user are invalidated.
    """
    token_hash = hashlib.sha256(body.token.strip().encode()).hexdigest()
    record = await col("password_reset_tokens").find_one({"token_hash": token_hash})
    if not record:
        raise HTTPException(status_code=400,
                            detail="This reset link is invalid or has already been used.")

    now = datetime.now(timezone.utc)
    exp = record["expires_at"]
    if exp.tzinfo is None:
        exp = exp.replace(tzinfo=timezone.utc)
    if exp < now:
        await col("password_reset_tokens").delete_one({"token_hash": token_hash})
        raise HTTPException(status_code=400,
                            detail="This reset link has expired. Please request a new one.")

    if len(body.new_password) < 8:
        raise HTTPException(status_code=400,
                            detail="Password must be at least 8 characters.")

    # Delete immediately — token is single-use regardless of what follows
    await col("password_reset_tokens").delete_one({"token_hash": token_hash})

    user = await get_user_by_username(record["username"])
    if not user or not user.get("active", True):
        raise HTTPException(status_code=400, detail="Account not found or inactive.")
    if user.get("is_super_admin") or user.get("role") == "super_admin":
        raise HTTPException(status_code=400, detail="This account's password is managed through the system configuration and cannot be reset here.")

    new_version = (user.get("token_version") or 0) + 1
    await col("users").update_one(
        {"username": record["username"]},
        {"$set": {
            "password":             hash_password(body.new_password),
            "must_change_password": False,
            "token_version":        new_version,
            "updated_at":           now,
        }},
    )
    await audit_log(
        "user.password_reset_completed", "user", user["id"],
        entity_label=user["username"], user=user,
    )
    return {"success": True}


@router.post("/change-password")
async def change_password(
    body: ChangePasswordBody,
    current_user: dict = Depends(get_current_user),
):
    """Authenticated user changes their own password. Clears must_change_password."""
    if not verify_password(body.current_password, current_user["password"]):
        raise HTTPException(status_code=400, detail="Current password is incorrect")

    if len(body.new_password) < 8:
        raise HTTPException(status_code=400, detail="New password must be at least 8 characters")

    if body.current_password == body.new_password:
        raise HTTPException(status_code=400, detail="New password must differ from the current password")

    await col("users").update_one(
        {"_id": ObjectId(current_user["id"])},
        {"$set": {
            "password": hash_password(body.new_password),
            "must_change_password": False,
            "updated_at": datetime.now(timezone.utc),
        }},
    )
    await audit_log("user.change_password", "user", current_user["id"],
                    entity_label=current_user["username"], user=current_user)
    return {"success": True}
