"""
Portal settings — email routing config (super_admin only).

The get_email_routing() helper is imported by other routes that need to
resolve recipients at send time. It reads from MongoDB first, falling
back to the support_email env var default.
"""
import re
from fastapi import APIRouter, HTTPException, Depends
from typing import List, Optional
from pydantic import BaseModel
from auth import require_permission
from database import col
from config import get_settings
from services.email_service import (
    send_onboarding_submitted, send_application_escalation, send_countersign_needed,
    send_countersign_complete_notification, send_qa_approval_needed, send_rp_approval_needed,
    send_qa_rp_daily_digest, send_order_ready_for_collection, send_order_confirmed,
    send_backorder_daily_digest, send_mo_daily_digest, send_payment_auto_confirmed, send_s6_flag_notification,
    send_recurring_order_accepted_internal, send_recurring_order_declined_internal,
    send_recurring_order_skipped_internal, send_recurring_order_needs_confirm_internal,
    send_recurring_order_upcoming, send_order_ready_for_collection_customer,
    send_pop_uploaded_notification,
)

router = APIRouter(prefix="/api/settings", tags=["settings"])
settings = get_settings()

_EMAIL_RE = re.compile(r"^[^\s@]+@[^\s@]+\.[^\s@]+$")

# One dummy-data sender per ROUTING_KEYS entry (frontend/src/views/EmailSettings.js) —
# lets an admin preview exactly what a real notification looks like without waiting
# for the real trigger event. Fabricated data only, never touches real records.
# order_cc isn't its own template (it's a cc= add-on to reseller order emails), so
# it previews via send_order_confirmed with the test address as the primary recipient.
TEST_EMAIL_SENDERS: dict = {
    "application_submitted_to": lambda to: send_onboarding_submitted(
        company_name="Test Pharmacy (Pty) Ltd", reseller_name="Jane Reseller",
        app_ref="APP-TEST01", to=[to], source="reseller",
    ),
    "application_escalation_to": lambda to: send_application_escalation(
        [to], app_id="APP-TEST01", company_name="Test Pharmacy (Pty) Ltd", hours_pending=5.5,
    ),
    "countersign_needed_to": lambda to: send_countersign_needed(
        [to], app_id="APP-TEST01", company_name="Test Pharmacy (Pty) Ltd",
    ),
    "countersign_complete_to": lambda to: send_countersign_complete_notification(
        [to], company_name="Test Pharmacy (Pty) Ltd", app_id="APP-TEST01",
    ),
    "pop_uploaded_to": lambda to: send_pop_uploaded_notification(
        [to], ticket_ref="TICKET-TEST01", customer_name="Test Pharmacy (Pty) Ltd", filename="proof_of_payment.pdf",
    ),
    "qa_approval_to": lambda to: send_qa_approval_needed(
        [to], order_ref="S00999", customer_name="Test Pharmacy (Pty) Ltd", order_id="999",
    ),
    "rp_approval_to": lambda to: send_rp_approval_needed(
        [to], order_ref="S00999", customer_name="Test Pharmacy (Pty) Ltd", order_id="999",
    ),
    "qa_rp_daily_digest_to": lambda to: send_qa_rp_daily_digest(
        [to], items=[
            {"order_ref": "S00999", "customer_name": "Test Pharmacy (Pty) Ltd", "missing": ["QA"]},
            {"order_ref": "S01000", "customer_name": "Sample Wellness Centre", "missing": ["QA", "RP"]},
        ],
    ),
    "order_ready_extra_to": lambda to: send_order_ready_for_collection(
        order_ref="S00999", customer_name="Test Pharmacy (Pty) Ltd", packer_name="Test Packer",
        supervisor_emails=[to],
    ),
    # Preview-only — this one always goes straight to the customer account
    # resolved from Odoo (main company email + every other contact on file),
    # not a configurable staff list, so there's no matching EmailRoutingConfig
    # field. Same shape as recurring_order_upcoming below.
    "order_ready_customer": lambda to: send_order_ready_for_collection_customer(
        customer_email=to, order_ref="S00999", customer_name="Test Pharmacy (Pty) Ltd",
    ),
    "order_cc": lambda to: send_order_confirmed(
        order_ref="S00999", customer_name="Test Pharmacy (Pty) Ltd", order_total=12500.00,
        reseller_name="Jane Reseller", reseller_email=to,
    ),
    "backorder_daily_digest_to": lambda to: send_backorder_daily_digest(
        [to], items=[{"order_ref": "S00999", "customer_name": "Test Pharmacy (Pty) Ltd", "picking_name": "WH/OUT/00123"}],
    ),
    "mo_daily_digest_to": lambda to: send_mo_daily_digest(
        [to], items=[{"mo_name": "WH/MO/00456", "product_name": "Test Flower 1G", "order_ref": "S00999", "state": "confirmed"}],
    ),
    "finance_notification_to": lambda to: send_payment_auto_confirmed(
        [to], confirmed_items=[{"customer_name": "Test Pharmacy (Pty) Ltd", "order_id": "999", "invoice_name": "INV/2026/0999"}],
    ),
    "s6_flag_to": lambda to: send_s6_flag_notification(
        [to], supplier_name="Test Supplier", product_name="Test Product 1G", batch_id="BISB-TST101-290726",
        qty_received="10", actor_name="Test User",
    ),
    "recurring_order_accepted_to": lambda to: send_recurring_order_accepted_internal(
        [to], customer_name="Test Pharmacy (Pty) Ltd", order_ref="S00999",
    ),
    "recurring_order_needs_confirm_to": lambda to: send_recurring_order_needs_confirm_internal(
        [to], customer_name="Test Pharmacy (Pty) Ltd", order_ref="S00999",
        reason="Test Pharmacy (Pty) Ltd is over their credit limit by R5,000.00 (credit R55,000.00 of R50,000.00 limit).",
    ),
    "recurring_order_declined_to": lambda to: send_recurring_order_declined_internal(
        [to], customer_name="Test Pharmacy (Pty) Ltd", order_ref="S00999",
    ),
    "recurring_order_skipped_to": lambda to: send_recurring_order_skipped_internal(
        [to], customer_name="Test Pharmacy (Pty) Ltd", order_ref="S00999",
    ),
    # Preview-only — this one always goes straight to the customer on file, not a
    # configurable staff list, so there's no matching EmailRoutingConfig field. It
    # still gets a Send Test entry so admins can see what the customer receives.
    "recurring_order_upcoming": lambda to: send_recurring_order_upcoming(
        customer_email=to, customer_name="Test Pharmacy (Pty) Ltd", order_ref="S00999",
        lines=[
            {"name": "Test Product 1G", "qty": 10},
            {"name": "Test Product 3G", "qty": 5},
        ],
        order_total=4250.00, scheduled_date="15 August 2026",
        review_url=f"{settings.portal_url}/recurring/test-token",
    ),
}


class TestEmailRequest(BaseModel):
    key: str
    to: str


class EmailRoutingConfig(BaseModel):
    application_submitted_to:  List[str] = []
    application_escalation_to: List[str] = []   # application stalled 4+ hours with no signing docs generated
    countersign_needed_to:     List[str] = []   # customer submitted both signed onboarding docs
    countersign_complete_to:   List[str] = []
    order_ready_extra_to:      List[str] = []
    order_cc:                  List[str] = []
    qa_approval_to:            List[str] = []   # order ready for QA inspection
    rp_approval_to:            List[str] = []   # order ready for RP inspection
    qa_rp_daily_digest_to:     List[str] = []   # 17:00 daily — orders still awaiting QA/RP sign-off
    backorder_daily_digest_to: List[str] = []   # 17:00 daily — orders waiting on stock
    mo_daily_digest_to:        List[str] = []   # 17:00 daily — Manufacturing Orders still in progress
    finance_notification_to:   List[str] = []
    s6_flag_to:                List[str] = []   # S6 receipt flagged: no purchase order found
    recurring_order_accepted_to: List[str] = []  # customer accepted a recurring order occurrence
    recurring_order_needs_confirm_to: List[str] = []  # accepted, but auto-confirm was blocked (e.g. credit limit) — needs manual staff review
    recurring_order_declined_to: List[str] = []  # customer declined a recurring order occurrence
    recurring_order_skipped_to:  List[str] = []  # recurring order occurrence expired with no response
    pop_uploaded_to:             List[str] = []  # customer/reseller uploaded a proof of payment


async def get_email_routing() -> dict:
    """Return the active email routing config, falling back to env-var defaults."""
    doc = await col("portal_settings").find_one({"_id": "email_routing"})
    if not doc:
        doc = {}
    return {
        "application_submitted_to": doc.get("application_submitted_to") or [settings.support_email],
        "application_escalation_to": doc.get("application_escalation_to", []),
        "countersign_needed_to":    doc.get("countersign_needed_to", []),
        "countersign_complete_to":  doc.get("countersign_complete_to", []),
        "order_ready_extra_to":     doc.get("order_ready_extra_to", []),
        "order_cc":                 doc.get("order_cc", []),
        "qa_approval_to":           doc.get("qa_approval_to", []),
        "rp_approval_to":           doc.get("rp_approval_to", []),
        "qa_rp_daily_digest_to":    doc.get("qa_rp_daily_digest_to", []),
        "backorder_daily_digest_to": doc.get("backorder_daily_digest_to", []),
        "mo_daily_digest_to":       doc.get("mo_daily_digest_to", []),
        "finance_notification_to":  doc.get("finance_notification_to", []),
        "s6_flag_to":               doc.get("s6_flag_to", []),
        "recurring_order_accepted_to": doc.get("recurring_order_accepted_to", []),
        "recurring_order_needs_confirm_to": doc.get("recurring_order_needs_confirm_to", []),
        "recurring_order_declined_to": doc.get("recurring_order_declined_to", []),
        "recurring_order_skipped_to":  doc.get("recurring_order_skipped_to", []),
    }



@router.get("/email-routing")
async def get_email_routing_config(_: dict = Depends(require_permission("settings.manage"))):
    return await get_email_routing()


@router.put("/email-routing")
async def update_email_routing_config(
    body: EmailRoutingConfig,
    _: dict = Depends(require_permission("settings.manage")),
):
    await col("portal_settings").update_one(
        {"_id": "email_routing"},
        {"$set": body.model_dump()},
        upsert=True,
    )
    return {"success": True}


@router.post("/email-routing/test")
async def send_test_email(
    body: TestEmailRequest,
    _: dict = Depends(require_permission("settings.manage")),
):
    """Send a real notification template, populated with fabricated dummy data,
    to whatever address the admin types in — so they can see exactly what a
    notification looks like without waiting for its real trigger event."""
    sender = TEST_EMAIL_SENDERS.get(body.key)
    if not sender:
        raise HTTPException(status_code=400, detail=f"Unknown notification key: {body.key}")
    if not _EMAIL_RE.match(body.to):
        raise HTTPException(status_code=400, detail="Enter a valid email address")
    try:
        sender(body.to)
    except Exception as e:
        raise HTTPException(status_code=502, detail=f"Failed to send test email: {str(e)}")
    return {"success": True}


# ── Default warehouse ────────────────────────────────────────────────────────

class DefaultWarehouseConfig(BaseModel):
    warehouse_id: Optional[int] = None


async def get_default_warehouse_id() -> Optional[int]:
    """Return the portal-wide default warehouse ID, or None if not set."""
    doc = await col("portal_settings").find_one({"_id": "default_warehouse"})
    return doc.get("warehouse_id") if doc else None


@router.get("/default-warehouse")
async def get_default_warehouse(_: dict = Depends(require_permission("settings.manage"))):
    return {"warehouse_id": await get_default_warehouse_id()}


@router.put("/default-warehouse")
async def set_default_warehouse(
    body: DefaultWarehouseConfig,
    _: dict = Depends(require_permission("settings.manage")),
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

    # Clean up any live Graph subscription BEFORE load_config_from_db below
    # switches the runtime credentials over — delete_subscription() still
    # needs the OLD credentials (via graph_client's currently-loaded token)
    # to authenticate the call to Microsoft. Otherwise a mailbox switched off
    # Graph keeps a subscription alive on Microsoft's side for up to ~3 days,
    # showing up as unexplained "invalid_state" webhook warnings.
    if existing.get("provider", "imap") == "graph" and body.provider != "graph":
        from services.graph_subscription import delete_subscription
        await delete_subscription(mailbox)

    await col("portal_settings").update_one(
        {"_id": settings_id}, {"$set": data}, upsert=True,
    )
    from services.imap_client import load_config_from_db
    await load_config_from_db(mailbox)


async def _clear_mailbox_doc(settings_id: str, mailbox: str) -> None:
    """Delete mailbox config entirely and reload the in-memory client. Cleans
    up any live Graph subscription first — see _save_mailbox_doc above for
    why this has to happen before the config disappears."""
    existing = await col("portal_settings").find_one({"_id": settings_id})
    if existing and existing.get("provider") == "graph":
        from services.graph_subscription import delete_subscription
        await delete_subscription(mailbox)

    await col("portal_settings").delete_one({"_id": settings_id})
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
async def get_mailbox_config(_: dict = Depends(require_permission("settings.manage"))):
    doc = await col("portal_settings").find_one({"_id": "mailbox_config"})
    return _mailbox_response(doc) if doc else _blank_mailbox_response()


@router.put("/mailbox")
async def save_mailbox_config(body: MailboxConfig, _: dict = Depends(require_permission("settings.manage"))):
    await _save_mailbox_doc("mailbox_config", body, "sales")
    return {"success": True}


@router.delete("/mailbox")
async def clear_mailbox_config(_: dict = Depends(require_permission("settings.manage"))):
    await _clear_mailbox_doc("mailbox_config", "sales")
    return {"success": True}


@router.delete("/mailbox/clear-inbox")
async def clear_sales_inbox(_: dict = Depends(require_permission("settings.manage"))):
    """Wipe all documents from sales_inbox. Use when swapping mailboxes during development."""
    result = await col("sales_inbox").delete_many({})
    return {"deleted": result.deleted_count}


@router.post("/mailbox/test")
async def test_mailbox_connection(body: MailboxConfig, _: dict = Depends(require_permission("settings.manage"))):
    return await _test_mailbox(body, "mailbox_config")


# ── Onboarding mailbox config ─────────────────────────────────────────────────
# Mirrors the sales mailbox endpoints. Uses a separate MongoDB doc so the two
# mailboxes can have different providers, hosts, and credentials.

_ONBOARDING_KEY = "mailbox_config_onboarding"


@router.get("/onboarding-mailbox")
async def get_onboarding_mailbox_config(_: dict = Depends(require_permission("settings.manage"))):
    doc = await col("portal_settings").find_one({"_id": _ONBOARDING_KEY})
    return _mailbox_response(doc) if doc else _blank_mailbox_response()


@router.put("/onboarding-mailbox")
async def save_onboarding_mailbox_config(body: MailboxConfig, _: dict = Depends(require_permission("settings.manage"))):
    await _save_mailbox_doc(_ONBOARDING_KEY, body, "onboarding")
    return {"success": True}


@router.delete("/onboarding-mailbox")
async def clear_onboarding_mailbox_config(_: dict = Depends(require_permission("settings.manage"))):
    await _clear_mailbox_doc(_ONBOARDING_KEY, "onboarding")
    return {"success": True}


@router.delete("/onboarding-mailbox/clear-inbox")
async def clear_onboarding_inbox(_: dict = Depends(require_permission("settings.manage"))):
    """Wipe all documents from onboarding_inbox. Use when swapping mailboxes during development."""
    result = await col("onboarding_inbox").delete_many({})
    return {"deleted": result.deleted_count}


@router.post("/onboarding-mailbox/test")
async def test_onboarding_mailbox_connection(body: MailboxConfig, _: dict = Depends(require_permission("settings.manage"))):
    return await _test_mailbox(body, _ONBOARDING_KEY)


# ── Orders mailbox config ─────────────────────────────────────────────────────
# Separate MongoDB doc for the orders inbox mailbox.

_ORDERS_KEY = "mailbox_config_orders"


@router.get("/orders-mailbox")
async def get_orders_mailbox_config(_: dict = Depends(require_permission("settings.manage"))):
    doc = await col("portal_settings").find_one({"_id": _ORDERS_KEY})
    return _mailbox_response(doc) if doc else _blank_mailbox_response()


@router.put("/orders-mailbox")
async def save_orders_mailbox_config(body: MailboxConfig, _: dict = Depends(require_permission("settings.manage"))):
    await _save_mailbox_doc(_ORDERS_KEY, body, "orders")
    return {"success": True}


@router.delete("/orders-mailbox")
async def clear_orders_mailbox_config(_: dict = Depends(require_permission("settings.manage"))):
    await _clear_mailbox_doc(_ORDERS_KEY, "orders")
    return {"success": True}


@router.delete("/orders-mailbox/clear-inbox")
async def clear_orders_inbox(_: dict = Depends(require_permission("settings.manage"))):
    """Wipe all documents from orders_inbox. Use when swapping mailboxes during development."""
    result = await col("orders_inbox").delete_many({})
    return {"deleted": result.deleted_count}


@router.post("/orders-mailbox/test")
async def test_orders_mailbox_connection(body: MailboxConfig, _: dict = Depends(require_permission("settings.manage"))):
    return await _test_mailbox(body, _ORDERS_KEY)
