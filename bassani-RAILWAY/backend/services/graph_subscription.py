"""
Microsoft Graph change-notification subscription manager.

Subscriptions expire after at most 4,230 minutes (~3 days for mail resources).
We store the active subscription in MongoDB (settings collection, key "graph_subscription")
and renew it automatically before it expires.

Called on startup (ensure_subscription) and every 47 hours by a background task
in server.py to ensure continuous delivery of push notifications.

If subscription creation or renewal fails, the inbox_routes webhook falls back
to a 60-second polling loop (handled inside inbox_routes.py startup task).
"""
import asyncio
import logging
import secrets
from datetime import datetime, timedelta, timezone

import httpx

from config import get_settings
from database import col
from services.graph_client import GRAPH_BASE, get_access_token, graph_configured

logger = logging.getLogger(__name__)
settings = get_settings()

# Max allowed by Graph for mail resources is 4,230 minutes; we use slightly less.
_SUBSCRIPTION_LIFETIME_MINUTES = 4200
_RENEWAL_THRESHOLD_HOURS = 47

# Sales keeps the original key for backward compat with existing subscriptions.
def _settings_key(mailbox: str) -> str:
    return "graph_subscription" if mailbox == "sales" else f"graph_subscription_{mailbox}"

# Webhook URL per mailbox — each mailbox has its own endpoint so the handler
# knows which collection to write to.
def _webhook_url(mailbox: str) -> str:
    base = settings.portal_url.rstrip("/")
    if mailbox == "sales":
        return f"{base}/api/inbox/graph-webhook"
    return f"{base}/api/onboarding-inbox/graph-webhook"


async def _get_stored(mailbox: str = "sales") -> dict | None:
    return await col("settings").find_one({"key": _settings_key(mailbox)})


async def create_subscription(mailbox: str = "sales", mailbox_address: str = "") -> dict:
    # Brief pause so any in-flight Railway health-check routing settles before
    # Microsoft sends the webhook validation POST back to our notificationUrl.
    await asyncio.sleep(2)
    address = mailbox_address or settings.ms_shared_mailbox
    notification_url = _webhook_url(mailbox)
    client_state = secrets.token_hex(32)
    expiry = (
        datetime.now(timezone.utc) + timedelta(minutes=_SUBSCRIPTION_LIFETIME_MINUTES)
    ).strftime("%Y-%m-%dT%H:%M:%SZ")

    token = await get_access_token()
    key = _settings_key(mailbox)
    async with httpx.AsyncClient(timeout=20) as client:
        r = await client.post(
            f"{GRAPH_BASE}/subscriptions",
            headers={"Authorization": f"Bearer {token}", "Content-Type": "application/json"},
            json={
                "changeType":        "created",
                "notificationUrl":   notification_url,
                "resource":          f"users/{address}/mailFolders('inbox')/messages",
                "expirationDateTime": expiry,
                "clientState":       client_state,
            },
        )
        if not r.is_success:
            logger.error(
                "graph_subscription_http_error mailbox=%s status=%d body=%s",
                mailbox, r.status_code, r.text[:500],
            )
        r.raise_for_status()
        data = r.json()

    subscription_id = data["id"]
    await col("settings").update_one(
        {"key": key},
        {"$set": {
            "key":             key,
            "subscription_id": subscription_id,
            "client_state":    client_state,
            "expiry":          expiry,
            "updated_at":      datetime.now(timezone.utc),
        }},
        upsert=True,
    )
    logger.info("graph_subscription_created mailbox=%s id=%s expiry=%s",
                mailbox, subscription_id, expiry)
    return data


async def renew_subscription(subscription_id: str, mailbox: str = "sales") -> None:
    expiry = (
        datetime.now(timezone.utc) + timedelta(minutes=_SUBSCRIPTION_LIFETIME_MINUTES)
    ).strftime("%Y-%m-%dT%H:%M:%SZ")

    token = await get_access_token()
    async with httpx.AsyncClient(timeout=20) as client:
        r = await client.patch(
            f"{GRAPH_BASE}/subscriptions/{subscription_id}",
            headers={"Authorization": f"Bearer {token}", "Content-Type": "application/json"},
            json={"expirationDateTime": expiry},
        )
        r.raise_for_status()

    await col("settings").update_one(
        {"key": _settings_key(mailbox)},
        {"$set": {"expiry": expiry, "updated_at": datetime.now(timezone.utc)}},
    )
    logger.info("graph_subscription_renewed mailbox=%s id=%s expiry=%s",
                mailbox, subscription_id, expiry)


async def ensure_subscription(mailbox: str = "sales", mailbox_address: str = "") -> None:
    """
    Idempotent — creates or renews the Graph subscription for one mailbox.
    Skips if MS credentials are not configured, or if no mailbox address is
    available for this slot (e.g. onboarding mailbox not yet connected).
    """
    if not graph_configured():
        logger.info("graph_subscription_skipped — MS credentials not configured")
        return

    from services.imap_client import get_graph_mailbox_address
    address = mailbox_address or get_graph_mailbox_address(mailbox) or ""
    if not address:
        logger.info("graph_subscription_skipped mailbox=%s — no mailbox address configured", mailbox)
        return

    stored = await _get_stored(mailbox)
    if stored and stored.get("subscription_id"):
        expiry_str = stored.get("expiry", "")
        try:
            expiry_dt = datetime.strptime(expiry_str, "%Y-%m-%dT%H:%M:%SZ").replace(
                tzinfo=timezone.utc
            )
            hours_remaining = (expiry_dt - datetime.now(timezone.utc)).total_seconds() / 3600
            if hours_remaining > _RENEWAL_THRESHOLD_HOURS:
                logger.info("graph_subscription_ok mailbox=%s hours_remaining=%.1f",
                            mailbox, hours_remaining)
                return
            await renew_subscription(stored["subscription_id"], mailbox=mailbox)
            return
        except Exception as exc:
            logger.warning("graph_subscription_renewal_failed mailbox=%s error=%s", mailbox, exc)

    try:
        await create_subscription(mailbox=mailbox, mailbox_address=address)
    except Exception as exc:
        logger.error("graph_subscription_create_failed mailbox=%s error=%s", mailbox, exc)


async def get_client_state(mailbox: str = "sales") -> str | None:
    stored = await _get_stored(mailbox)
    return stored.get("client_state") if stored else None
