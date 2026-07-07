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
    provider:              str = "imap"  # "imap" | "graph"
    # IMAP / SMTP fields
    imap_host:             str = ""
    imap_port:             int = 993
    imap_username:         str = ""
    imap_password:         str = ""
    smtp_host:             str = ""
    smtp_port:             int = 587
    smtp_username:         str = ""
    smtp_password:         str = ""
    mailbox_address:       str = ""
    # Microsoft 365 Graph API fields
    ms_tenant_id:          str = ""
    ms_client_id:          str = ""
    ms_client_secret:      str = ""   # empty string → keep existing on save
    graph_mailbox_address: str = ""


def _mailbox_response(doc: dict) -> dict:
    """Serialise a portal_settings mailbox doc for the API response."""
    provider = doc.get("provider", "imap")
    if provider == "graph":
        configured = bool(
            doc.get("ms_tenant_id") and doc.get("ms_client_id")
            and doc.get("ms_client_secret") and doc.get("graph_mailbox_address")
        )
    else:
        configured = bool(doc.get("imap_host") and doc.get("imap_username") and doc.get("imap_password"))
    return {
        "configured":           configured,
        "provider":             provider,
        # IMAP fields
        "imap_host":            doc.get("imap_host", ""),
        "imap_port":            doc.get("imap_port", 993),
        "imap_username":        doc.get("imap_username", ""),
        "smtp_host":            doc.get("smtp_host", ""),
        "smtp_port":            doc.get("smtp_port", 587),
        "smtp_username":        doc.get("smtp_username", ""),
        "mailbox_address":      doc.get("mailbox_address", ""),
        # Graph fields — secret is never returned in plain text
        "ms_tenant_id":         doc.get("ms_tenant_id", ""),
        "ms_client_id":         doc.get("ms_client_id", ""),
        "ms_client_secret":     "••••••••" if doc.get("ms_client_secret") else "",
        "graph_mailbox_address": doc.get("graph_mailbox_address", ""),
    }


def _blank_mailbox_response() -> dict:
    return {
        "configured": False, "provider": "imap",
        "imap_host": "", "imap_port": 993, "imap_username": "",
        "smtp_host": "", "smtp_port": 587, "smtp_username": "",
        "mailbox_address": "",
        "ms_tenant_id": "", "ms_client_id": "", "ms_client_secret": "",
        "graph_mailbox_address": "",
    }


async def _save_mailbox_doc(settings_id: str, body: MailboxConfig, mailbox: str) -> None:
    """Persist mailbox config and reload the in-memory client."""
    data = body.model_dump()
    existing = await col("portal_settings").find_one({"_id": settings_id}) or {}

    if body.provider == "graph":
        # Keep existing secret when the UI sends the redacted placeholder or blank
        if not data["ms_client_secret"] or data["ms_client_secret"] == "••••••••":
            data["ms_client_secret"] = existing.get("ms_client_secret", "")
    else:
        # Keep existing IMAP passwords when omitted
        if not data["imap_password"]:
            data["imap_password"] = existing.get("imap_password", "")
        if not data["smtp_password"]:
            data["smtp_password"] = existing.get("smtp_password", "")
        if not data["mailbox_address"]:
            data["mailbox_address"] = data["imap_username"]

    await col("portal_settings").update_one(
        {"_id": settings_id}, {"$set": data}, upsert=True,
    )
    from services.imap_client import load_config_from_db
    await load_config_from_db(mailbox)


async def _test_mailbox(body: MailboxConfig, settings_id: str = "mailbox_config") -> dict:
    """Test Graph token fetch or IMAP connection. Returns success dict or raises."""
    if body.provider == "graph":
        if not body.ms_tenant_id or not body.ms_client_id or not body.ms_client_secret:
            raise HTTPException(
                status_code=422,
                detail="Tenant ID, Client ID, and Client Secret are required for the connection test.",
            )
        # Resolve the redacted placeholder back to the real stored secret
        secret = body.ms_client_secret
        if secret == "••••••••":
            doc = await col("portal_settings").find_one({"_id": settings_id})
            secret = (doc or {}).get("ms_client_secret", "")
            if not secret:
                raise HTTPException(
                    status_code=422,
                    detail="Client Secret could not be resolved. Re-enter it to run the test.",
                )
        token_url = (
            f"https://login.microsoftonline.com/{body.ms_tenant_id.strip()}/oauth2/v2.0/token"
        )
        import httpx as _httpx
        try:
            async with _httpx.AsyncClient(timeout=15) as client:
                r = await client.post(token_url, data={
                    "grant_type":    "client_credentials",
                    "client_id":     body.ms_client_id.strip(),
                    "client_secret": secret,
                    "scope":         "https://graph.microsoft.com/.default",
                })
                r.raise_for_status()
            return {"success": True, "message": "Microsoft 365 connection successful. OAuth token acquired."}
        except _httpx.HTTPStatusError as exc:
            if exc.response.status_code == 401:
                raise HTTPException(
                    status_code=422,
                    detail="Microsoft 365 authentication failed. Check your Tenant ID, Client ID, and Client Secret — one or more values are incorrect or the secret may have expired.",
                )
            raise HTTPException(status_code=502, detail=f"Microsoft 365 connection failed: {exc}")
        except Exception as exc:
            raise HTTPException(status_code=502, detail=f"Microsoft 365 connection failed: {exc}")
    else:
        if not body.imap_host or not body.imap_username or not body.imap_password:
            raise HTTPException(
                status_code=422,
                detail="IMAP host, username, and password are required for the connection test.",
            )
        from services.imap_client import test_connection
        cfg = {
            "imap_host":       body.imap_host.strip(),
            "imap_port":       body.imap_port or 993,
            "imap_username":   body.imap_username.strip(),
            "imap_password":   body.imap_password,
            "smtp_host":       body.smtp_host or body.imap_host,
            "smtp_port":       body.smtp_port or 587,
            "smtp_username":   body.smtp_username or body.imap_username,
            "smtp_password":   body.smtp_password or body.imap_password,
            "mailbox_address": body.mailbox_address or body.imap_username,
        }
        try:
            await test_connection(cfg)
            return {"success": True, "message": "Connection successful. Mailbox is reachable."}
        except Exception as exc:
            err = str(exc)
            if "AUTHENTICATIONFAILED" in err or "Authentication failed" in err:
                raise HTTPException(
                    status_code=422,
                    detail="Authentication failed. Check the username and password, and confirm the mailbox exists on this server.",
                )
            raise HTTPException(status_code=502, detail=f"Connection failed: {exc}")


@router.get("/mailbox")
async def get_mailbox_config(_: dict = Depends(_require_super_admin)):
    doc = await col("portal_settings").find_one({"_id": "mailbox_config"})
    return _mailbox_response(doc) if doc else _blank_mailbox_response()


@router.put("/mailbox")
async def save_mailbox_config(body: MailboxConfig, _: dict = Depends(_require_super_admin)):
    await _save_mailbox_doc("mailbox_config", body, "sales")
    return {"success": True}


@router.delete("/mailbox")
async def clear_mailbox_config(_: dict = Depends(_require_super_admin)):
    await col("portal_settings").delete_one({"_id": "mailbox_config"})
    from services.imap_client import load_config_from_db
    await load_config_from_db()
    return {"success": True}


@router.delete("/mailbox/clear-inbox")
async def clear_sales_inbox(_: dict = Depends(_require_super_admin)):
    """Wipe all documents from sales_inbox. Use when swapping mailboxes during development."""
    result = await col("sales_inbox").delete_many({})
    return {"deleted": result.deleted_count}


@router.post("/mailbox/test")
async def test_mailbox_connection(body: MailboxConfig, _: dict = Depends(_require_super_admin)):
    return await _test_mailbox(body, "mailbox_config")


# ── Onboarding mailbox config ─────────────────────────────────────────────────
# Mirrors the sales mailbox endpoints. Uses a separate MongoDB doc so the two
# mailboxes can have different providers, hosts, and credentials.

_ONBOARDING_KEY = "mailbox_config_onboarding"


@router.get("/onboarding-mailbox")
async def get_onboarding_mailbox_config(_: dict = Depends(_require_super_admin)):
    doc = await col("portal_settings").find_one({"_id": _ONBOARDING_KEY})
    return _mailbox_response(doc) if doc else _blank_mailbox_response()


@router.put("/onboarding-mailbox")
async def save_onboarding_mailbox_config(body: MailboxConfig, _: dict = Depends(_require_super_admin)):
    await _save_mailbox_doc(_ONBOARDING_KEY, body, "onboarding")
    return {"success": True}


@router.delete("/onboarding-mailbox")
async def clear_onboarding_mailbox_config(_: dict = Depends(_require_super_admin)):
    await col("portal_settings").delete_one({"_id": _ONBOARDING_KEY})
    from services.imap_client import load_config_from_db
    await load_config_from_db("onboarding")
    return {"success": True}


@router.delete("/onboarding-mailbox/clear-inbox")
async def clear_onboarding_inbox(_: dict = Depends(_require_super_admin)):
    """Wipe all documents from onboarding_inbox. Use when swapping mailboxes during development."""
    result = await col("onboarding_inbox").delete_many({})
    return {"deleted": result.deleted_count}


@router.post("/onboarding-mailbox/test")
async def test_onboarding_mailbox_connection(body: MailboxConfig, _: dict = Depends(_require_super_admin)):
    return await _test_mailbox(body, _ONBOARDING_KEY)
