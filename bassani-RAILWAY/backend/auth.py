import bcrypt
import jwt
from datetime import datetime, timedelta, timezone
from typing import Optional, Callable
from fastapi import Depends, HTTPException, status
from fastapi.security import OAuth2PasswordBearer
from pydantic import BaseModel
from config import get_settings
from database import col

settings = get_settings()
oauth2_scheme = OAuth2PasswordBearer(tokenUrl="/api/auth/login")


# ── Permission constants ──────────────────────────────────────────────────────
#
# Used by require_permission() and as defaults when creating/migrating users.
# Structure mirrors the permissions object stored on each admin user document.

ALL_ROLES = {
    "super_admin", "admin", "warehouse_supervisor", "packer", "reseller",
    # Phase 8 ticketing roles — each maps 1:1 to a named staff member and a
    # single fixed ticket permission (see TICKET_ROLE_PERMISSIONS below).
    "sales", "orders_clerk", "finance", "qa_manager", "responsible_pharmacist",
}
ADMIN_ROLES = {"super_admin", "admin"}  # roles that access the main React portal
TICKET_ROLES = {"sales", "orders_clerk", "finance", "qa_manager", "responsible_pharmacist"}

# Default for newly created admin accounts — view-only on sensitive operations.
DEFAULT_ADMIN_PERMISSIONS: dict = {
    "products":    {"manage": False},
    "orders":      {"view": True,  "confirm": False, "cancel": False},
    "customers":   {"view": True,  "manage": False,  "approve_onboarding": False, "reject_onboarding": False},
    "commission":  {"view": True,  "generate_statements": False, "mark_paid": False, "configure_tiers": False},
    "resellers":   {"view": True,  "manage": False},
    "invoices":    {"view": True,  "record_payment": False},
    "reports":     {"view": True,  "export": False},
    "healthcare":  {"view": True,  "manage": False},
    "users":       {"manage": False},
    "warehouse":   {"view": False, "supervise": False},
    "audit":       {"view": False},
    "tickets":     {"sales": False, "orders": False, "finance_confirm": False, "qa_approve": False, "rp_approve": False, "manage": False},
    "inbox":       {"view": False},
    "onboarding":  {"inbox": False},
    "suppliers":   {"view": True,  "manage": False},
    "settings":    {"manage": False},
}

# Applied to existing admin users during migration — they had full access before.
FULL_PERMISSIONS: dict = {
    "products":    {"manage": True},
    "orders":      {"view": True,  "confirm": True,  "cancel": True},
    "customers":   {"view": True,  "manage": True,   "approve_onboarding": True,  "reject_onboarding": True},
    "commission":  {"view": True,  "generate_statements": True,  "mark_paid": True,  "configure_tiers": True},
    "resellers":   {"view": True,  "manage": True},
    "invoices":    {"view": True,  "record_payment": True},
    "reports":     {"view": True,  "export": True},
    "healthcare":  {"view": True,  "manage": True},
    "users":       {"manage": True},
    "warehouse":   {"view": True,  "supervise": True},
    "audit":       {"view": True},
    "tickets":     {"sales": True, "orders": True, "finance_confirm": True, "qa_approve": True, "rp_approve": True, "manage": True},
    "inbox":       {"view": True},
    "onboarding":  {"inbox": True},
    "suppliers":   {"view": True,  "manage": True},
    "settings":    {"manage": True},
}

# Full default permission sets for each staff role.
# Each role's core ticket permission is always True — everything else reflects
# what that role typically needs.  Super admin can extend any key via the Users UI.
# Replaces the old TICKET_ROLE_PERMISSIONS (single-key objects); kept as an alias
# for any import sites that haven't been updated yet.
ROLE_DEFAULT_PERMISSIONS: dict = {
    "sales": {
        "products":   {"manage": False},
        "orders":     {"view": True,  "confirm": False, "cancel": False},
        "customers":  {"view": True,  "manage": True,   "approve_onboarding": False, "reject_onboarding": False},
        "commission": {"view": False, "generate_statements": False, "mark_paid": False, "configure_tiers": False},
        "resellers":  {"view": False, "manage": False},
        "invoices":   {"view": False, "record_payment": False},
        "reports":    {"view": False, "export": False},
        "healthcare": {"view": False, "manage": False},
        "users":      {"manage": False},
        "warehouse":  {"view": False, "supervise": False},
        "audit":      {"view": False},
        "tickets":    {"sales": True, "orders": False, "finance_confirm": False, "qa_approve": False, "rp_approve": False, "manage": False},
        "inbox":      {"view": True},
        "onboarding": {"inbox": False},
        "suppliers":  {"view": False, "manage": False},
        "settings":   {"manage": False},
    },
    "orders_clerk": {
        "products":   {"manage": False},
        "orders":     {"view": True,  "confirm": False, "cancel": False},
        "customers":  {"view": True,  "manage": False,  "approve_onboarding": False, "reject_onboarding": False},
        "commission": {"view": False, "generate_statements": False, "mark_paid": False, "configure_tiers": False},
        "resellers":  {"view": False, "manage": False},
        "invoices":   {"view": False, "record_payment": False},
        "reports":    {"view": False, "export": False},
        "healthcare": {"view": False, "manage": False},
        "users":      {"manage": False},
        "warehouse":  {"view": False, "supervise": False},
        "audit":      {"view": False},
        "tickets":    {"sales": False, "orders": True, "finance_confirm": False, "qa_approve": False, "rp_approve": False, "manage": False},
        "inbox":      {"view": False},
        "onboarding": {"inbox": False},
        "suppliers":  {"view": False, "manage": False},
        "settings":   {"manage": False},
    },
    "finance": {
        "products":   {"manage": False},
        "orders":     {"view": True,  "confirm": False, "cancel": False},
        "customers":  {"view": True,  "manage": False,  "approve_onboarding": False, "reject_onboarding": False},
        "commission": {"view": True,  "generate_statements": True,  "mark_paid": True,  "configure_tiers": False},
        "resellers":  {"view": True,  "manage": False},
        "invoices":   {"view": True,  "record_payment": True},
        "reports":    {"view": True,  "export": False},
        "healthcare": {"view": False, "manage": False},
        "users":      {"manage": False},
        "warehouse":  {"view": False, "supervise": False},
        "audit":      {"view": False},
        "tickets":    {"sales": False, "orders": False, "finance_confirm": True, "qa_approve": False, "rp_approve": False, "manage": False},
        "inbox":      {"view": False},
        "onboarding": {"inbox": False},
        "suppliers":  {"view": True,  "manage": False},
        "settings":   {"manage": False},
    },
    "qa_manager": {
        "products":   {"manage": False},
        "orders":     {"view": True,  "confirm": False, "cancel": False},
        "customers":  {"view": False, "manage": False,  "approve_onboarding": False, "reject_onboarding": False},
        "commission": {"view": False, "generate_statements": False, "mark_paid": False, "configure_tiers": False},
        "resellers":  {"view": False, "manage": False},
        "invoices":   {"view": False, "record_payment": False},
        "reports":    {"view": False, "export": False},
        "healthcare": {"view": False, "manage": False},
        "users":      {"manage": False},
        "warehouse":  {"view": False, "supervise": False},
        "audit":      {"view": False},
        "tickets":    {"sales": False, "orders": False, "finance_confirm": False, "qa_approve": True, "rp_approve": False, "manage": False},
        "inbox":      {"view": False},
        "onboarding": {"inbox": False},
        "suppliers":  {"view": False, "manage": False},
        "settings":   {"manage": False},
    },
    "responsible_pharmacist": {
        "products":   {"manage": False},
        "orders":     {"view": True,  "confirm": False, "cancel": False},
        "customers":  {"view": False, "manage": False,  "approve_onboarding": False, "reject_onboarding": False},
        "commission": {"view": False, "generate_statements": False, "mark_paid": False, "configure_tiers": False},
        "resellers":  {"view": False, "manage": False},
        "invoices":   {"view": False, "record_payment": False},
        "reports":    {"view": False, "export": False},
        "healthcare": {"view": True,  "manage": True},
        "users":      {"manage": False},
        "warehouse":  {"view": False, "supervise": False},
        "audit":      {"view": False},
        "tickets":    {"sales": False, "orders": False, "finance_confirm": False, "qa_approve": False, "rp_approve": True, "manage": False},
        "inbox":      {"view": False},
        "onboarding": {"inbox": False},
        "suppliers":  {"view": False, "manage": False},
        "settings":   {"manage": False},
    },
}
TICKET_ROLE_PERMISSIONS = ROLE_DEFAULT_PERMISSIONS  # backwards-compat alias


# ── Pydantic models ───────────────────────────────────────────────────────────

class Token(BaseModel):
    access_token: str = ""
    token_type: str = "bearer"
    user: dict | None = None
    otp_required: bool = False
    otp_session_id: str | None = None


class UserOut(BaseModel):
    id: str
    username: str


# ── Password helpers ──────────────────────────────────────────────────────────

def hash_password(plain: str) -> str:
    return bcrypt.hashpw(plain.encode(), bcrypt.gensalt()).decode()


def verify_password(plain: str, hashed: str) -> bool:
    return bcrypt.checkpw(plain.encode(), hashed.encode())


# ── JWT helpers ───────────────────────────────────────────────────────────────

def create_access_token(data: dict, expires_delta: Optional[timedelta] = None) -> str:
    payload = data.copy()
    expire = datetime.now(timezone.utc) + (
        expires_delta or timedelta(minutes=settings.jwt_expire_minutes)
    )
    payload["exp"] = expire
    return jwt.encode(payload, settings.jwt_secret, algorithm=settings.jwt_algorithm)


# ── User lookup ───────────────────────────────────────────────────────────────

async def get_user_by_username(username: str) -> Optional[dict]:
    user = await col("users").find_one({"username": username})
    if user:
        user["id"] = str(user.pop("_id"))
    return user


async def authenticate_user(username: str, password: str) -> Optional[dict]:
    user = await get_user_by_username(username)
    if not user:
        return None
    if not verify_password(password, user["password"]):
        return None
    if not user.get("active", True):
        return None
    return user


# ── FastAPI dependencies ──────────────────────────────────────────────────────

async def get_current_user(token: str = Depends(oauth2_scheme)) -> dict:
    credentials_exception = HTTPException(
        status_code=status.HTTP_401_UNAUTHORIZED,
        detail="Could not validate credentials",
        headers={"WWW-Authenticate": "Bearer"},
    )
    try:
        payload = jwt.decode(
            token, settings.jwt_secret, algorithms=[settings.jwt_algorithm]
        )
        username: str = payload.get("sub")
        if not username:
            raise credentials_exception
    except jwt.InvalidTokenError:
        raise credentials_exception

    user = await get_user_by_username(username)
    if not user:
        raise credentials_exception

    # Token version check — invalidates all sessions issued before a password reset
    if payload.get("tv", 0) != (user.get("token_version") or 0):
        raise credentials_exception

    return user


async def require_admin(current_user: dict = Depends(get_current_user)) -> dict:
    """Allow any admin-level portal user (super_admin or admin)."""
    if current_user.get("role") not in ADMIN_ROLES:
        raise HTTPException(
            status_code=status.HTTP_403_FORBIDDEN,
            detail="Admin access required",
        )
    return current_user


async def require_super_admin(current_user: dict = Depends(get_current_user)) -> dict:
    """Allow only the super admin."""
    if not current_user.get("is_super_admin"):
        raise HTTPException(
            status_code=status.HTTP_403_FORBIDDEN,
            detail="Super admin access required",
        )
    return current_user


def require_permission(permission: str) -> Callable:
    """
    Dependency factory for granular permission checks.

    Usage:  current_user: dict = Depends(require_permission("commission.mark_paid"))

    Super admins bypass all checks. Regular admins and the narrow ticketing
    roles (sales/orders_clerk/finance/qa_manager/responsible_pharmacist) are
    evaluated against their stored permissions object. Any other role is
    rejected with 403.

    Permission string format: "<domain>.<action>", e.g. "orders.confirm".
    """
    async def _check(current_user: dict = Depends(get_current_user)) -> dict:
        # Super admin passes unconditionally
        if current_user.get("is_super_admin") or current_user.get("role") == "super_admin":
            return current_user

        # Only admin-tier and ticketing-role users reach the permission check —
        # ticketing roles never gain require_admin access, just this narrower gate.
        if current_user.get("role") not in (ADMIN_ROLES | TICKET_ROLES):
            raise HTTPException(
                status_code=status.HTTP_403_FORBIDDEN,
                detail="Access denied",
            )

        parts = permission.split(".", 1)
        if len(parts) != 2:
            raise HTTPException(status_code=500, detail="Invalid permission key")
        domain, action = parts

        perms = current_user.get("permissions") or {}
        if not perms.get(domain, {}).get(action, False):
            raise HTTPException(
                status_code=status.HTTP_403_FORBIDDEN,
                detail="You do not have permission to perform this action",
            )
        return current_user

    return _check


def require_any_permission(*permissions: str) -> Callable:
    """
    Like require_permission(), but passes if the user has ANY of the given
    permission strings — for data that multiple roles legitimately need to
    see for different reasons (e.g. a Sales ticket is visible to both
    `sales`, who drives it, and `finance`, who needs to find tickets
    awaiting payment confirmation across all reps).

    Usage:  Depends(require_any_permission("tickets.sales", "tickets.finance_confirm"))
    """
    async def _check(current_user: dict = Depends(get_current_user)) -> dict:
        if current_user.get("is_super_admin") or current_user.get("role") == "super_admin":
            return current_user

        if current_user.get("role") not in (ADMIN_ROLES | TICKET_ROLES):
            raise HTTPException(status_code=status.HTTP_403_FORBIDDEN, detail="Access denied")

        perms = current_user.get("permissions") or {}
        for permission in permissions:
            domain, action = permission.split(".", 1)
            if perms.get(domain, {}).get(action, False):
                return current_user

        raise HTTPException(
            status_code=status.HTTP_403_FORBIDDEN,
            detail="You do not have permission to perform this action",
        )

    return _check
