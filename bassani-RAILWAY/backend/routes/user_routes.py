import secrets
import string
from fastapi import APIRouter, Depends, HTTPException
from typing import Optional
from pydantic import BaseModel
from datetime import datetime, timezone
from bson import ObjectId
from auth import require_admin, hash_password
from database import col, NO_ID

router = APIRouter(prefix="/api/users", tags=["users"])


# ── Pydantic models ───────────────────────────────────────────────────────────

class UserCreate(BaseModel):
    username: str
    password: str
    role: str = "admin"          # admin | reseller
    name: str = ""

class UserUpdate(BaseModel):
    name: Optional[str] = None
    role: Optional[str] = None
    active: Optional[bool] = None

class PasswordReset(BaseModel):
    new_password: str


# ── Helpers ───────────────────────────────────────────────────────────────────

def _safe_user(user: dict) -> dict:
    """Strip sensitive fields and normalise _id → id."""
    user.pop("password", None)
    if "_id" in user:
        user["id"] = str(user.pop("_id"))
    return user


def generate_password(length: int = 12) -> str:
    alphabet = string.ascii_letters + string.digits + "!@#$%"
    return "".join(secrets.choice(alphabet) for _ in range(length))


# ── Endpoints ─────────────────────────────────────────────────────────────────

@router.get("/")
async def list_users(current_user: dict = Depends(require_admin)):
    """List all user accounts. Admin only. Passwords never returned."""
    users = await col("users").find({}, {"password": 0}).to_list(length=500)
    for u in users:
        u["id"] = str(u.pop("_id"))
        # Attach linked reseller name if present
        if u.get("reseller_id"):
            reseller = await col("resellers").find_one(
                {"id": u["reseller_id"]}, {"name": 1, "_id": 0}
            )
            u["reseller_name"] = reseller["name"] if reseller else None
        else:
            u["reseller_name"] = None
    return {"users": users, "total": len(users)}


@router.post("/")
async def create_user(
    body: UserCreate,
    current_user: dict = Depends(require_admin),
):
    """Create a standalone user account (e.g. a new admin). Admin only."""
    if await col("users").find_one({"username": body.username}):
        raise HTTPException(status_code=400, detail=f"Username '{body.username}' is already taken")
    if body.role not in ("admin", "reseller"):
        raise HTTPException(status_code=400, detail="Role must be 'admin' or 'reseller'")

    doc = {
        "username": body.username,
        "password": hash_password(body.password),
        "role": body.role,
        "name": body.name,
        "active": True,
        "created_at": datetime.now(timezone.utc),
    }
    result = await col("users").insert_one(doc)
    return {"success": True, "user_id": str(result.inserted_id)}


@router.put("/{user_id}")
async def update_user(
    user_id: str,
    body: UserUpdate,
    current_user: dict = Depends(require_admin),
):
    """Update a user's name, role, or active status. Admin only."""
    try:
        oid = ObjectId(user_id)
    except Exception:
        raise HTTPException(status_code=400, detail="Invalid user ID")

    updates = {k: v for k, v in body.model_dump().items() if v is not None}
    if not updates:
        raise HTTPException(status_code=400, detail="No fields to update")
    if "role" in updates and updates["role"] not in ("admin", "reseller"):
        raise HTTPException(status_code=400, detail="Role must be 'admin' or 'reseller'")

    updates["updated_at"] = datetime.now(timezone.utc)
    result = await col("users").update_one({"_id": oid}, {"$set": updates})
    if result.matched_count == 0:
        raise HTTPException(status_code=404, detail="User not found")
    return {"success": True}


@router.post("/{user_id}/reset-password")
async def reset_password(
    user_id: str,
    body: Optional[PasswordReset] = None,
    current_user: dict = Depends(require_admin),
):
    """
    Reset a user's password. Admin only.
    If a new_password is supplied it is used; otherwise a secure random
    password is generated. The resulting plain-text password is returned
    ONCE in this response — it cannot be retrieved again.
    """
    try:
        oid = ObjectId(user_id)
    except Exception:
        raise HTTPException(status_code=400, detail="Invalid user ID")

    plain = body.new_password if (body and body.new_password) else generate_password()

    result = await col("users").update_one(
        {"_id": oid},
        {"$set": {
            "password": hash_password(plain),
            "updated_at": datetime.now(timezone.utc),
        }},
    )
    if result.matched_count == 0:
        raise HTTPException(status_code=404, detail="User not found")

    return {
        "success": True,
        "new_password": plain,
        "warning": "Save this password now — it will not be shown again",
    }


@router.delete("/{user_id}")
async def deactivate_user(
    user_id: str,
    current_user: dict = Depends(require_admin),
):
    """Deactivate a user account. The user can no longer log in. Admin only."""
    try:
        oid = ObjectId(user_id)
    except Exception:
        raise HTTPException(status_code=400, detail="Invalid user ID")

    # Prevent self-deactivation
    if user_id == current_user.get("id"):
        raise HTTPException(status_code=400, detail="You cannot deactivate your own account")

    result = await col("users").update_one(
        {"_id": oid},
        {"$set": {"active": False, "updated_at": datetime.now(timezone.utc)}},
    )
    if result.matched_count == 0:
        raise HTTPException(status_code=404, detail="User not found")
    return {"success": True}


@router.post("/{user_id}/reactivate")
async def reactivate_user(
    user_id: str,
    current_user: dict = Depends(require_admin),
):
    """Re-enable a previously deactivated account. Admin only."""
    try:
        oid = ObjectId(user_id)
    except Exception:
        raise HTTPException(status_code=400, detail="Invalid user ID")

    result = await col("users").update_one(
        {"_id": oid},
        {"$set": {"active": True, "updated_at": datetime.now(timezone.utc)}},
    )
    if result.matched_count == 0:
        raise HTTPException(status_code=404, detail="User not found")
    return {"success": True}
