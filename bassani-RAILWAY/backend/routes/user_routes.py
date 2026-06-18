import secrets
import string
from fastapi import APIRouter, Depends, HTTPException, Query
from typing import Optional
from pydantic import BaseModel
from datetime import datetime, timezone
from bson import ObjectId
from auth import require_admin, hash_password, DEFAULT_ADMIN_PERMISSIONS, FULL_PERMISSIONS, ALL_ROLES
from database import col

router = APIRouter(prefix="/api/users", tags=["users"])

# Roles that require super_admin to create (admins cannot promote peers)
SUPER_ADMIN_ONLY_ROLES = {"admin", "super_admin"}

# Roles that appear in the main portal (warehouse/packer roles are separate HTML pages)
PORTAL_ROLES = {"admin", "warehouse_supervisor", "packer"}


# ── Pydantic models ───────────────────────────────────────────────────────────

class UserCreate(BaseModel):
    username: str
    password: str
    role: str = "admin"
    name: str = ""
    display_name: Optional[str] = None   # shown on packing board (packer role)
    permissions: Optional[dict] = None   # only applied when role == "admin"

class UserUpdate(BaseModel):
    name: Optional[str] = None
    display_name: Optional[str] = None
    role: Optional[str] = None
    active: Optional[bool] = None
    permissions: Optional[dict] = None   # only super_admin may set this

class PasswordReset(BaseModel):
    new_password: str


# ── Helpers ───────────────────────────────────────────────────────────────────

def generate_password(length: int = 12) -> str:
    alphabet = string.ascii_letters + string.digits + "!@#$%"
    return "".join(secrets.choice(alphabet) for _ in range(length))


def _permissions_for_new_role(role: str, supplied: Optional[dict]) -> Optional[dict]:
    """Return the permissions dict to store, or None for non-admin roles."""
    if role == "admin":
        return supplied if supplied else DEFAULT_ADMIN_PERMISSIONS
    if role in ("super_admin", "warehouse_supervisor", "packer"):
        return FULL_PERMISSIONS  # fixed; stored for completeness but role governs access
    return None


# ── Endpoints ─────────────────────────────────────────────────────────────────

@router.get("/")
async def list_users(
    role: Optional[str] = Query(None),
    _: dict = Depends(require_admin),
):
    """List all user accounts. Optionally filter by role (e.g. ?role=packer)."""
    query: dict = {}
    if role:
        query["role"] = role

    users = await col("users").find(query, {"password": 0}).to_list(length=500)
    for u in users:
        u["id"] = str(u.pop("_id"))
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
    """
    Create a user account.

    - super_admin can create any role.
    - admin can create warehouse_supervisor and packer only.
    - Nobody can create a second super_admin via the API.
    """
    if body.role not in ALL_ROLES:
        raise HTTPException(status_code=400, detail=f"Invalid role '{body.role}'")

    if body.role == "super_admin":
        raise HTTPException(status_code=400, detail="Cannot create a super_admin account via the API")

    is_super = current_user.get("is_super_admin", False)
    if body.role in SUPER_ADMIN_ONLY_ROLES and not is_super:
        raise HTTPException(
            status_code=403,
            detail="Only the super admin can create admin accounts",
        )

    if await col("users").find_one({"username": body.username}):
        raise HTTPException(status_code=400, detail=f"Username '{body.username}' is already taken")

    doc = {
        "username": body.username,
        "password": hash_password(body.password),
        "role": body.role,
        "name": body.name,
        "active": True,
        "is_super_admin": False,
        "created_at": datetime.now(timezone.utc),
    }

    if body.display_name:
        doc["display_name"] = body.display_name

    perms = _permissions_for_new_role(body.role, body.permissions)
    if perms:
        doc["permissions"] = perms

    result = await col("users").insert_one(doc)
    return {"success": True, "user_id": str(result.inserted_id)}


@router.put("/{user_id}")
async def update_user(
    user_id: str,
    body: UserUpdate,
    current_user: dict = Depends(require_admin),
):
    """
    Update a user account.

    - Only super_admin can change the permissions object.
    - Nobody can edit the super_admin account via this endpoint.
    - Admins cannot promote another user to admin or super_admin.
    """
    try:
        oid = ObjectId(user_id)
    except Exception:
        raise HTTPException(status_code=400, detail="Invalid user ID")

    target = await col("users").find_one({"_id": oid})
    if not target:
        raise HTTPException(status_code=404, detail="User not found")

    if target.get("is_super_admin"):
        raise HTTPException(status_code=403, detail="The super admin account cannot be edited here")

    is_super = current_user.get("is_super_admin", False)

    updates: dict = {}

    if body.name is not None:
        updates["name"] = body.name
    if body.display_name is not None:
        updates["display_name"] = body.display_name
    if body.active is not None:
        updates["active"] = body.active

    if body.role is not None:
        if body.role not in ALL_ROLES or body.role == "super_admin":
            raise HTTPException(status_code=400, detail="Invalid role")
        if body.role in SUPER_ADMIN_ONLY_ROLES and not is_super:
            raise HTTPException(status_code=403, detail="Only the super admin can assign the admin role")
        updates["role"] = body.role

    if body.permissions is not None:
        if not is_super:
            raise HTTPException(status_code=403, detail="Only the super admin can modify permissions")
        # Prevent self-escalation
        if user_id == current_user.get("id"):
            raise HTTPException(status_code=400, detail="You cannot modify your own permissions")
        updates["permissions"] = body.permissions

    if not updates:
        raise HTTPException(status_code=400, detail="No fields to update")

    updates["updated_at"] = datetime.now(timezone.utc)
    await col("users").update_one({"_id": oid}, {"$set": updates})
    return {"success": True}


@router.post("/{user_id}/reset-password")
async def reset_password(
    user_id: str,
    body: Optional[PasswordReset] = None,
    current_user: dict = Depends(require_admin),
):
    """
    Reset a user's password. Admin only.
    Returns the plain-text password once — it cannot be retrieved again.
    """
    try:
        oid = ObjectId(user_id)
    except Exception:
        raise HTTPException(status_code=400, detail="Invalid user ID")

    target = await col("users").find_one({"_id": oid})
    if not target:
        raise HTTPException(status_code=404, detail="User not found")

    if target.get("is_super_admin") and not current_user.get("is_super_admin"):
        raise HTTPException(status_code=403, detail="Only the super admin can reset the super admin password")

    plain = body.new_password if (body and body.new_password) else generate_password()

    await col("users").update_one(
        {"_id": oid},
        {"$set": {
            "password": hash_password(plain),
            "updated_at": datetime.now(timezone.utc),
        }},
    )
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
    """Deactivate a user account."""
    try:
        oid = ObjectId(user_id)
    except Exception:
        raise HTTPException(status_code=400, detail="Invalid user ID")

    if user_id == current_user.get("id"):
        raise HTTPException(status_code=400, detail="You cannot deactivate your own account")

    target = await col("users").find_one({"_id": oid})
    if not target:
        raise HTTPException(status_code=404, detail="User not found")

    if target.get("is_super_admin"):
        raise HTTPException(status_code=403, detail="The super admin account cannot be deactivated")

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
    _: dict = Depends(require_admin),
):
    """Re-enable a previously deactivated account."""
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
