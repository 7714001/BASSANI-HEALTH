import secrets
import string
from fastapi import APIRouter, BackgroundTasks, Depends, HTTPException, Query
from typing import Optional
from pydantic import BaseModel
from datetime import datetime, timezone
from bson import ObjectId
from auth import (
    require_admin, get_current_user, hash_password, DEFAULT_ADMIN_PERMISSIONS,
    ALL_ROLES, TICKET_ROLES, TICKET_ROLE_PERMISSIONS,
)
from database import col
from middleware.audit import audit_log
from services.email_service import send_welcome_email

router = APIRouter(prefix="/api/users", tags=["users"])

# Roles that require super_admin to create (admins cannot promote peers)
SUPER_ADMIN_ONLY_ROLES = {"admin", "super_admin"}

# Roles that appear in the main portal (warehouse/packer roles are separate HTML pages)
PORTAL_ROLES = {"admin", "warehouse_supervisor", "packer"} | TICKET_ROLES


# ── Pydantic models ───────────────────────────────────────────────────────────

class UserCreate(BaseModel):
    username: str
    password: str
    role: str = "admin"
    name: str = ""
    email: Optional[str] = None
    display_name: Optional[str] = None   # shown on packing board (packer role)
    warehouse_id: Optional[int] = None   # required for warehouse_supervisor/packer — which vault they work
    permissions: Optional[dict] = None   # only applied when role == "admin"

class UserUpdate(BaseModel):
    name: Optional[str] = None
    email: Optional[str] = None
    display_name: Optional[str] = None
    role: Optional[str] = None
    active: Optional[bool] = None
    warehouse_id: Optional[int] = None
    permissions: Optional[dict] = None   # only super_admin may set this

class PasswordReset(BaseModel):
    new_password: str

class WarehouseSelect(BaseModel):
    warehouse_id: Optional[int] = None   # None = "All warehouses" (clears the active selection)


# ── Helpers ───────────────────────────────────────────────────────────────────

def generate_password(length: int = 12) -> str:
    alphabet = string.ascii_letters + string.digits + "!@#$%"
    return "".join(secrets.choice(alphabet) for _ in range(length))


def _permissions_for_new_role(role: str, supplied: Optional[dict]) -> Optional[dict]:
    """Return the permissions dict to store, or None for roles that don't use it."""
    if role == "admin":
        return supplied if supplied else DEFAULT_ADMIN_PERMISSIONS
    if role in TICKET_ROLES:
        # Fixed, not user-customisable — the role IS the permission.
        return TICKET_ROLE_PERMISSIONS[role]
    # warehouse_supervisor and packer access is role-gated at the packing board layer,
    # not via this permissions object — store nothing so the portal summary shows correctly.
    return None


# ── Endpoints ─────────────────────────────────────────────────────────────────

@router.put("/me/warehouse")
async def set_active_warehouse(
    body: WarehouseSelect,
    current_user: dict = Depends(get_current_user),
):
    """Admin/super_admin self-service: switch which warehouse the portal top-nav
    selector scopes stock/product/order reads to. Drives `active_warehouse_id`
    on the user's own document — distinct from the fixed `warehouse_id` assigned
    to warehouse_supervisor/packer accounts."""
    if current_user.get("role") not in ("admin", "super_admin"):
        raise HTTPException(status_code=403, detail="Only admin accounts can switch warehouses")

    await col("users").update_one(
        {"_id": ObjectId(current_user["id"])},
        {"$set": {"active_warehouse_id": body.warehouse_id}},
    )
    return {"success": True, "active_warehouse_id": body.warehouse_id}


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
    background_tasks: BackgroundTasks,
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
        "must_change_password": True,
        "created_at": datetime.now(timezone.utc),
    }

    if body.email:
        doc["email"] = body.email.lower().strip()
    if body.display_name:
        doc["display_name"] = body.display_name
    if body.role in ("warehouse_supervisor", "packer") and body.warehouse_id:
        doc["warehouse_id"] = body.warehouse_id

    perms = _permissions_for_new_role(body.role, body.permissions)
    if perms:
        doc["permissions"] = perms

    result = await col("users").insert_one(doc)
    await audit_log("user.create", "user", str(result.inserted_id), entity_label=body.username,
                    user=current_user, after={"role": body.role, "name": body.name})
    if body.email:
        background_tasks.add_task(
            send_welcome_email,
            username=body.username,
            name=body.name,
            email=body.email,
        )
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
    if body.email is not None:
        updates["email"] = body.email.lower().strip()
    if body.display_name is not None:
        updates["display_name"] = body.display_name
    if body.active is not None:
        updates["active"] = body.active
    if body.warehouse_id is not None:
        updates["warehouse_id"] = body.warehouse_id

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

    before = {k: target.get(k) for k in updates if k != "updated_at"}
    await audit_log("user.update", "user", user_id, entity_label=target.get("username", ""),
                    user=current_user, before=before,
                    after={k: v for k, v in updates.items() if k != "updated_at"})
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
            "must_change_password": True,
            "updated_at": datetime.now(timezone.utc),
        }},
    )
    await audit_log("user.reset_password", "user", user_id, entity_label=target.get("username", ""),
                    user=current_user)
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
    await audit_log("user.deactivate", "user", user_id, entity_label=target.get("username", ""),
                    user=current_user)
    return {"success": True}


@router.post("/{user_id}/reactivate")
async def reactivate_user(
    user_id: str,
    current_user: dict = Depends(require_admin),
):
    """Re-enable a previously deactivated account."""
    try:
        oid = ObjectId(user_id)
    except Exception:
        raise HTTPException(status_code=400, detail="Invalid user ID")

    target = await col("users").find_one({"_id": oid})
    result = await col("users").update_one(
        {"_id": oid},
        {"$set": {"active": True, "updated_at": datetime.now(timezone.utc)}},
    )
    if result.matched_count == 0:
        raise HTTPException(status_code=404, detail="User not found")
    await audit_log("user.reactivate", "user", user_id,
                    entity_label=target.get("username", "") if target else "",
                    user=current_user)
    return {"success": True}
