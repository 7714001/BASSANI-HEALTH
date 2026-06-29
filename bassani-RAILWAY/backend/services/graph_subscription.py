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
# Renew when fewer than this many hours remain on the current subscription.
_RENEWAL_THRESHOLD_HOURS = 47

_SETTINGS_KEY = "graph_subscription"


async def _get_stored() -> dict | None:
    return await col("settings").find_one({"key": _SETTINGS_KEY})


async def create_subscription() -> dict:
    notification_url = f"{settings.portal_url}/api/inbox/graph-webhook"
    client_state = secrets.token_hex(32)
    expiry = (
        datetime.now(timezone.utc) + timedelta(minutes=_SUBSCRIPTION_LIFETIME_MINUTES)
    ).strftime("%Y-%m-%dT%H:%M:%SZ")

    token = await get_access_token()
    async with httpx.AsyncClient(timeout=20) as client:
        r = await client.post(
            f"{GRAPH_BASE}/subscriptions",
            headers={"Authorization": f"Bearer {token}", "Content-Type": "application/json"},
            json={
                "changeType": "created",
                "notificationUrl": notification_url,
                "resource": (
                    f"users/{settings.ms_shared_mailbox}/mailFolders('inbox')/messages"
                ),
                "expirationDateTime": expiry,
                "clientState": client_state,
            },
        )
        r.raise_for_status()
        data = r.json()

    subscription_id = data["id"]
    await col("settings").update_one(
        {"key": _SETTINGS_KEY},
        {
            "$set": {
                "key": _SETTINGS_KEY,
                "subscription_id": subscription_id,
                "client_state": client_state,
                "expiry": expiry,
                "updated_at": datetime.now(timezone.utc),
            }
        },
        upsert=True,
    )
    logger.info(
        "graph_subscription_created subscription_id=%s expiry=%s",
        subscription_id,
        expiry,
    )
    return data


async def renew_subscription(subscription_id: str) -> None:
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
        {"key": _SETTINGS_KEY},
        {"$set": {"expiry": expiry, "updated_at": datetime.now(timezone.utc)}},
    )
    logger.info(
        "graph_subscription_renewed subscription_id=%s expiry=%s",
        subscription_id,
        expiry,
    )


async def ensure_subscription() -> None:
    """
    Idempotent — creates a new subscription or renews the existing one as needed.
    Safe to call multiple times; skips entirely if MS credentials are not configured.
    """
    if not graph_configured():
        logger.info("graph_subscription_skipped — MS credentials not configured")
        return

    stored = await _get_stored()

    if stored and stored.get("subscription_id"):
        expiry_str = stored.get("expiry", "")
        try:
            expiry_dt = datetime.strptime(expiry_str, "%Y-%m-%dT%H:%M:%SZ").replace(
                tzinfo=timezone.utc
            )
            hours_remaining = (
                expiry_dt - datetime.now(timezone.utc)
            ).total_seconds() / 3600

            if hours_remaining > _RENEWAL_THRESHOLD_HOURS:
                logger.info(
                    "graph_subscription_ok hours_remaining=%.1f", hours_remaining
                )
                return

            await renew_subscription(stored["subscription_id"])
            return
        except Exception as exc:
            logger.warning("graph_subscription_renewal_failed error=%s", exc)

    # No valid subscription — create fresh.
    try:
        await create_subscription()
    except Exception as exc:
        logger.error("graph_subscription_create_failed error=%s", exc)


async def get_client_state() -> str | None:
    stored = await _get_stored()
    return stored.get("client_state") if stored else None
