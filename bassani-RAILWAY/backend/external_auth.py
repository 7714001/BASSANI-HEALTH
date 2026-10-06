"""Phase 14.0 — API-key authentication for the external API (/api/external/v1/).

An API client is an external system calling the portal (a WooCommerce sync
job, a partner POS backend, ...). It never holds a staff login: it presents
an `X-API-Key` header, which is checked here against `api_clients`, where
only the SHA-256 hash of each key is stored. The raw key is shown once, at
creation/rotation, and can't be recovered afterwards.

Kept at root level (like ownership.py/contacts.py) because both the admin
routes (integration_routes.py, which mints keys) and the external routes
(external_routes.py, which checks them) need it.
"""
import hashlib
import logging
import secrets
from datetime import datetime, timezone, timedelta
from typing import Optional

import sentry_sdk
from bson import ObjectId
from fastapi import Depends, HTTPException, Request, status
from fastapi.security import APIKeyHeader
from slowapi.util import get_remote_address

from database import col

logger = logging.getLogger(__name__)

API_KEY_HEADER = "X-API-Key"
# Recognisable prefix so a leaked key is easy to spot in logs, tickets or a
# public repo (and matchable by secret scanners).
KEY_PREFIX = "bhk_"
KILL_SWITCH_ID = "external_api_enabled"

# Only stamp last_used_at at most once a minute per client, so a busy
# integration doesn't turn every read into a Mongo write.
_LAST_USED_GRANULARITY = timedelta(minutes=1)

_api_key_header = APIKeyHeader(name=API_KEY_HEADER, auto_error=False)


def hash_api_key(raw: str) -> str:
    return hashlib.sha256(raw.encode()).hexdigest()


def generate_api_key() -> tuple[str, str, str]:
    """Returns (raw_key, key_hash, key_prefix). The raw key is returned to
    the admin exactly once; only the hash and display prefix are stored."""
    raw = KEY_PREFIX + secrets.token_urlsafe(32)
    return raw, hash_api_key(raw), raw[:12]


async def external_api_enabled() -> bool:
    """Global kill switch (14.0). Missing doc = enabled."""
    doc = await col("portal_settings").find_one({"_id": KILL_SWITCH_ID})
    return True if not doc else bool(doc.get("enabled", True))


def api_key_rate_key(request: Request) -> str:
    """slowapi key function: rate-limit per API key, not per IP. Several
    integrations can share one egress IP (e.g. a hosting provider), and one
    integration can call from many — the key is the real identity."""
    raw = request.headers.get(API_KEY_HEADER)
    if raw:
        return "apikey:" + hash_api_key(raw)[:24]
    return get_remote_address(request)


async def require_api_client(
    request: Request,
    raw_key: Optional[str] = Depends(_api_key_header),
) -> dict:
    """FastAPI dependency for every /api/external/v1/ route. Returns the
    api_clients doc (with `id` as a string). The 401 deliberately doesn't
    say whether a key exists but is inactive, or doesn't exist at all."""
    if not await external_api_enabled():
        raise HTTPException(
            status_code=status.HTTP_503_SERVICE_UNAVAILABLE,
            detail="The Bassani Health API is temporarily paused. Please try again later.",
        )

    unauthorized = HTTPException(
        status_code=status.HTTP_401_UNAUTHORIZED,
        detail="Invalid or missing API key",
        headers={"WWW-Authenticate": "ApiKey"},
    )
    if not raw_key or not raw_key.startswith(KEY_PREFIX):
        raise unauthorized

    client = await col("api_clients").find_one({"key_hash": hash_api_key(raw_key), "active": True})
    if not client:
        raise unauthorized

    client["id"] = str(client.pop("_id"))
    client.pop("key_hash", None)

    now = datetime.now(timezone.utc)
    last = client.get("last_used_at")
    if last is not None and last.tzinfo is None:
        last = last.replace(tzinfo=timezone.utc)
    if last is None or now - last >= _LAST_USED_GRANULARITY:
        try:
            await col("api_clients").update_one({"_id": ObjectId(client["id"])}, {"$set": {"last_used_at": now}})
        except Exception as e:
            logger.warning("api_client_last_used_update_failed client_id=%s error=%s", client["id"], e)

    # Attribute any error on this request to the integration that caused it.
    sentry_sdk.set_tag("api_client_id", client["id"])
    sentry_sdk.set_user({"id": f"api_client:{client['id']}", "username": client.get("name", "")})
    request.state.api_client = client
    return client
