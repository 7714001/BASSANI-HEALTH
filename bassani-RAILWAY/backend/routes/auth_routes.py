from datetime import datetime, timezone
from fastapi import APIRouter, Depends, HTTPException, Request, status
from fastapi.security import OAuth2PasswordRequestForm
from pydantic import BaseModel
from bson import ObjectId
from auth import (
    authenticate_user, create_access_token,
    get_current_user, Token, verify_password, hash_password
)
from database import col
from middleware.audit import audit_log
from rate_limit import limiter

router = APIRouter(prefix="/api/auth", tags=["auth"])


class ChangePasswordBody(BaseModel):
    current_password: str
    new_password: str


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
    }


@router.post("/login", response_model=Token)
@limiter.limit("5/15minutes")
async def login(request: Request, form_data: OAuth2PasswordRequestForm = Depends()):
    user = await authenticate_user(form_data.username, form_data.password)
    if not user:
        raise HTTPException(
            status_code=status.HTTP_401_UNAUTHORIZED,
            detail="Incorrect username or password",
            headers={"WWW-Authenticate": "Bearer"},
        )
    token = create_access_token(data={"sub": user["username"]})
    await col("users").update_one(
        {"username": user["username"]},
        {"$set": {"last_login_at": datetime.now(timezone.utc)}},
    )
    await audit_log("user.login", "user", user["id"], entity_label=user["username"], user=user,
                    reseller_id=user.get("reseller_id"))
    return {
        "access_token": token,
        "token_type": "bearer",
        "user": _user_payload(user),
    }


@router.get("/me")
async def me(current_user: dict = Depends(get_current_user)):
    return _user_payload(current_user)


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
