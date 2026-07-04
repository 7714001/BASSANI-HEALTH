"""
Portal settings — email routing config (super_admin only).

The get_email_routing() helper is imported by other routes that need to
resolve recipients at send time. It reads from MongoDB first, falling
back to the support_email env var default.
"""
from fastapi import APIRouter, HTTPException, Depends
from typing import List, Optional
from pydantic import BaseModel
from auth import get_current_user
from database import col
from config import get_settings

router = APIRouter(prefix="/api/settings", tags=["settings"])
settings = get_settings()


class EmailRoutingConfig(BaseModel):
    application_submitted_to: List[str] = []
    order_ready_extra_to:     List[str] = []
    order_cc:                 List[str] = []


async def get_email_routing() -> dict:
    """Return the active email routing config, falling back to env-var defaults."""
    doc = await col("portal_settings").find_one({"_id": "email_routing"})
    if not doc:
        return {
            "application_submitted_to": [settings.support_email],
            "order_ready_extra_to": [],
            "order_cc": [],
        }
    return {
        "application_submitted_to": doc.get("application_submitted_to") or [settings.support_email],
        "order_ready_extra_to":     doc.get("order_ready_extra_to", []),
        "order_cc":                 doc.get("order_cc", []),
    }


def _require_super_admin(current_user: dict = Depends(get_current_user)) -> dict:
    if not current_user.get("is_super_admin"):
        raise HTTPException(status_code=403, detail="Super admin access required")
    return current_user


@router.get("/email-routing")
async def get_email_routing_config(_: dict = Depends(_require_super_admin)):
    return await get_email_routing()


@router.put("/email-routing")
async def update_email_routing_config(
    body: EmailRoutingConfig,
    _: dict = Depends(_require_super_admin),
):
    await col("portal_settings").update_one(
        {"_id": "email_routing"},
        {"$set": body.model_dump()},
        upsert=True,
    )
    return {"success": True}


# ── Default warehouse ────────────────────────────────────────────────────────

class DefaultWarehouseConfig(BaseModel):
    warehouse_id: Optional[int] = None


async def get_default_warehouse_id() -> Optional[int]:
    """Return the portal-wide default warehouse ID, or None if not set."""
    doc = await col("portal_settings").find_one({"_id": "default_warehouse"})
    return doc.get("warehouse_id") if doc else None


@router.get("/default-warehouse")
async def get_default_warehouse(_: dict = Depends(_require_super_admin)):
    return {"warehouse_id": await get_default_warehouse_id()}


@router.put("/default-warehouse")
async def set_default_warehouse(
    body: DefaultWarehouseConfig,
    _: dict = Depends(_require_super_admin),
):
    await col("portal_settings").update_one(
        {"_id": "default_warehouse"},
        {"$set": {"warehouse_id": body.warehouse_id}},
        upsert=True,
    )
    return {"success": True, "warehouse_id": body.warehouse_id}


# ── Mailbox config ────────────────────────────────────────────────────────────

class MailboxConfig(BaseModel):
    imap_host:       str = ""
    imap_port:       int = 993
    imap_username:   str = ""
    imap_password:   str = ""
    smtp_host:       str = ""
    smtp_port:       int = 587
    smtp_username:   str = ""
    smtp_password:   str = ""
    mailbox_address: str = ""  # display from-address (defaults to imap_username if blank)


@router.get("/mailbox")
async def get_mailbox_config(_: dict = Depends(_require_super_admin)):
    doc = await col("portal_settings").find_one({"_id": "mailbox_config"})
    if not doc:
        return {
            "configured": False,
            "imap_host": "", "imap_port": 993, "imap_username": "",
            "smtp_host": "", "smtp_port": 587, "smtp_username": "",
            "mailbox_address": "",
            # passwords are never returned
        }
    return {
        "configured": bool(doc.get("imap_host") and doc.get("imap_username") and doc.get("imap_password")),
        "imap_host":       doc.get("imap_host", ""),
        "imap_port":       doc.get("imap_port", 993),
        "imap_username":   doc.get("imap_username", ""),
        "smtp_host":       doc.get("smtp_host", ""),
        "smtp_port":       doc.get("smtp_port", 587),
        "smtp_username":   doc.get("smtp_username", ""),
        "mailbox_address": doc.get("mailbox_address", ""),
        # password fields intentionally omitted — update only
    }


@router.put("/mailbox")
async def save_mailbox_config(
    body: MailboxConfig,
    _: dict = Depends(_require_super_admin),
):
    data = body.model_dump()
    # Allow password omission (empty string) to mean "keep existing"
    existing = await col("portal_settings").find_one({"_id": "mailbox_config"}) or {}
    if not data["imap_password"]:
        data["imap_password"] = existing.get("imap_password", "")
    if not data["smtp_password"]:
        data["smtp_password"] = existing.get("smtp_password", "")
    if not data["mailbox_address"]:
        data["mailbox_address"] = data["imap_username"]

    await col("portal_settings").update_one(
        {"_id": "mailbox_config"},
        {"$set": data},
        upsert=True,
    )
    # Reload the in-memory config immediately so the inbox is live without restart
    from services.imap_client import load_config_from_db
    await load_config_from_db()
    return {"success": True}


@router.delete("/mailbox")
async def clear_mailbox_config(_: dict = Depends(_require_super_admin)):
    await col("portal_settings").delete_one({"_id": "mailbox_config"})
    from services.imap_client import load_config_from_db
    await load_config_from_db()
    return {"success": True}


@router.post("/mailbox/test")
async def test_mailbox_connection(
    body: MailboxConfig,
    _: dict = Depends(_require_super_admin),
):
    """Test IMAP credentials without saving. Returns success or error detail."""
    if not body.imap_host or not body.imap_username or not body.imap_password:
        raise HTTPException(status_code=422, detail="IMAP host, username, and password are required for the connection test.")
    from services.imap_client import test_connection
    cfg = {
        "imap_host":      body.imap_host.strip(),
        "imap_port":      body.imap_port or 993,
        "imap_username":  body.imap_username.strip(),
        "imap_password":  body.imap_password,
        "smtp_host":      body.smtp_host or body.imap_host,
        "smtp_port":      body.smtp_port or 587,
        "smtp_username":  body.smtp_username or body.imap_username,
        "smtp_password":  body.smtp_password or body.imap_password,
        "mailbox_address": body.mailbox_address or body.imap_username,
    }
    try:
        await test_connection(cfg)
        return {"success": True, "message": "Connection successful. Mailbox is reachable."}
    except Exception as exc:
        raise HTTPException(status_code=502, detail=f"Connection failed: {exc}")
