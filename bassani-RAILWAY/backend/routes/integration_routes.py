"""Phase 14.0 — portal-side administration of external integrations.

Staff-login (JWT) endpoints under /api/integrations/, deliberately separate
from the API-key-only /api/external/v1/ surface (external_routes.py): an API
key can never reach an admin action, and a staff session never authenticates
the external API.

  - API clients: external systems that call the portal. Super admin only —
    a key grants machine access to catalogue and stock data, and later
    (14.6/14.15) to order intake, so minting one is a top-level decision.
    A `partner_platform` client (14.10) is a POS platform's own key, linked to
    the Sales Agent account Bassani created for that platform; creating one
    flags the account `channel: "api_partner"` and issues a webhook signing
    secret (encrypted at rest, shown once) for the partner's callback URL.
    Store keys (`partner_store`) are issued per store in 14.13, never here.
  - Sales channels: stores the portal calls out to (WooCommerce first).
    `channels.manage`. Secrets are encrypted at rest (secret_box.py) and
    write-only — never returned by any endpoint.
  - Kill switch: pauses every external API request and channel sync at once.
    Super admin only.
"""
import logging
import secrets
from datetime import datetime, timezone
from typing import Literal, Optional
from urllib.parse import urlparse

from bson import ObjectId
from fastapi import APIRouter, Depends, HTTPException, Query, Request
from pydantic import BaseModel, Field

import secret_box
from auth import require_permission, require_super_admin
from database import col
from external_auth import (
    CLIENT_PARTNER_PLATFORM, CLIENT_PARTNER_STORE, CLIENT_STANDARD,
    KILL_SWITCH_ID, external_api_enabled, generate_api_key,
)
from middleware.audit import audit_log
from odoo_client import get_odoo_client
from parent_categories import UNCATEGORISED
from warehouse_context import get_company_id

logger = logging.getLogger(__name__)

router = APIRouter(prefix="/api/integrations", tags=["integrations"])


def _ip(request: Request) -> Optional[str]:
    return request.client.host if request.client else None


def _oid(value: str) -> ObjectId:
    try:
        return ObjectId(value)
    except Exception:
        raise HTTPException(status_code=404, detail="Not found")


def _warehouse_summary(odoo, warehouse_id: int) -> dict:
    """Validates the warehouse and resolves its company in one read."""
    try:
        rows = odoo.read("stock.warehouse", [warehouse_id], fields=["name", "company_id"])
    except Exception as e:
        raise HTTPException(status_code=502, detail=f"Could not read the warehouse: {e}")
    if not rows:
        raise HTTPException(status_code=400, detail="That warehouse no longer exists, or the portal can't access it.")
    company = rows[0].get("company_id") or None
    return {
        "warehouse_name": rows[0]["name"],
        "company_id": company[0] if company else None,
        "company_name": company[1] if company else None,
    }


def _validate_pricelist(odoo, pricelist_id: Optional[int], company_id: Optional[int]) -> Optional[str]:
    """A pricelist must belong to the warehouse's company, or be shared (no
    company). Returns its name, or None when no pricelist is set."""
    if not pricelist_id:
        return None
    try:
        rows = odoo.read("product.pricelist", [pricelist_id], fields=["name", "company_id", "active"])
    except Exception as e:
        raise HTTPException(status_code=502, detail=f"Could not read the pricelist: {e}")
    if not rows or not rows[0].get("active", True):
        raise HTTPException(status_code=400, detail="That pricelist no longer exists or is archived.")
    pl_company = rows[0].get("company_id")
    if pl_company and company_id and pl_company[0] != company_id:
        raise HTTPException(status_code=400, detail="That pricelist belongs to a different company than the selected warehouse.")
    return rows[0]["name"]


async def _validate_parent_categories(ids: Optional[list[str]]) -> Optional[list[str]]:
    """Every id must be an active Parent Category, or the Uncategorised
    bucket. Empty/None = no restriction (the whole reseller catalogue)."""
    if not ids:
        return None
    ids = list(dict.fromkeys(ids))
    real = [i for i in ids if i != UNCATEGORISED]
    oids = []
    for i in real:
        try:
            oids.append(ObjectId(i))
        except Exception:
            raise HTTPException(status_code=400, detail="One of the selected categories no longer exists.")
    found = {str(d["_id"]) for d in await col("parent_categories").find({"_id": {"$in": oids}, "active": True}, {"_id": 1}).to_list(None)}
    if len(found) != len(real):
        raise HTTPException(status_code=400, detail="One of the selected categories no longer exists or is inactive.")
    return ids


def _normalise_callback_url(url: Optional[str]) -> Optional[str]:
    if not url or not url.strip():
        return None
    url = url.strip()
    parsed = urlparse(url)
    if parsed.scheme != "https" or not parsed.netloc:
        raise HTTPException(status_code=400, detail="The webhook address must be a full https:// address.")
    return url


def _new_webhook_secret() -> tuple[str, str]:
    """(raw secret shown once, encrypted copy stored). Unlike an API key this
    can't be a one-way hash: the portal needs the secret itself to sign every
    outbound webhook (14.13/14.15)."""
    raw = "whsec_" + secrets.token_urlsafe(32)
    try:
        return raw, secret_box.encrypt(raw)
    except secret_box.SecretBoxNotConfigured:
        raise HTTPException(
            status_code=503,
            detail="Credential storage isn't configured on the server yet (CREDENTIALS_ENCRYPTION_KEY), so a partner's webhook secret can't be stored. Set it before creating a POS partner key.",
        )


async def _active_partner(reseller_id: str) -> dict:
    partner = await col("resellers").find_one({"id": reseller_id, "active": {"$ne": False}}, {"_id": 0, "id": 1, "name": 1, "warehouse_id": 1, "channel": 1})
    if not partner:
        raise HTTPException(status_code=400, detail="That Sales Agent account doesn't exist or is deactivated.")
    return partner


# ── API clients ───────────────────────────────────────────────────────────────

class ApiClientIn(BaseModel):
    name: str = Field(min_length=2, max_length=80)
    description: str = ""
    client_type: Literal["standard", "partner_platform"] = "standard"
    integration_partner_id: Optional[str] = None      # reseller `id`, required for partner_platform
    callback_url: Optional[str] = None                # partner_platform only: where webhooks go
    warehouse_id: int
    pricelist_id: Optional[int] = None
    stock_detail: Literal["binary", "quantity"] = "binary"
    # Portal Parent Category ids (7.12) — the same grouping the reseller/
    # customer cart uses — or "uncategorised". None = the whole reseller
    # catalogue. A top-level id includes its sub-categories.
    scoped_parent_category_ids: Optional[list[str]] = None
    sandbox: bool = False


class ApiClientUpdate(BaseModel):
    name: Optional[str] = Field(default=None, min_length=2, max_length=80)
    description: Optional[str] = None
    warehouse_id: Optional[int] = None
    pricelist_id: Optional[int] = None
    clear_pricelist: bool = False                     # None can't mean "remove it"
    stock_detail: Optional[Literal["binary", "quantity"]] = None
    scoped_parent_category_ids: Optional[list[str]] = None
    clear_category_scope: bool = False
    sandbox: Optional[bool] = None
    callback_url: Optional[str] = None                # partner_platform only; "" clears it


_CLIENT_PUBLIC_FIELDS = (
    "name", "description", "client_type", "warehouse_id", "warehouse_name", "company_id",
    "company_name", "pricelist_id", "pricelist_name", "stock_detail", "scoped_parent_category_ids",
    "key_prefix", "sandbox", "active", "created_at", "created_by", "updated_at",
    "last_used_at", "key_rotated_at",
    "integration_partner_id", "integration_partner_name", "parent_client_id", "odoo_partner_id",
    "callback_url", "webhook_secret_rotated_at",
)


def _client_out(doc: dict) -> dict:
    out = {"id": str(doc["_id"])}
    out.update({k: doc.get(k) for k in _CLIENT_PUBLIC_FIELDS})
    out["client_type"] = out.get("client_type") or CLIENT_STANDARD
    out["has_webhook_secret"] = bool(doc.get("webhook_secret_enc"))
    return out


@router.get("/api-clients")
async def list_api_clients(
    include_store_keys: bool = Query(False, description="Store keys (14.13) are listed per partner, not here, by default"),
    current_user: dict = Depends(require_super_admin),
):
    query = {} if include_store_keys else {"client_type": {"$ne": CLIENT_PARTNER_STORE}}
    docs = await col("api_clients").find(query).sort("created_at", -1).to_list(500)
    return {"clients": [_client_out(d) for d in docs]}


@router.post("/api-clients")
async def create_api_client(body: ApiClientIn, request: Request, current_user: dict = Depends(require_super_admin)):
    partner = None
    callback_url = webhook_secret = webhook_secret_enc = None
    if body.client_type == CLIENT_PARTNER_PLATFORM:
        if not body.integration_partner_id:
            raise HTTPException(status_code=400, detail="Choose the Sales Agent account this POS partner belongs to.")
        callback_url = _normalise_callback_url(body.callback_url)   # validate input before any lookups
        partner = await _active_partner(body.integration_partner_id)
        # One platform key per partner: a second would split its stores and
        # webhooks across two credentials. Rotate the existing key instead.
        if await col("api_clients").find_one({"client_type": CLIENT_PARTNER_PLATFORM, "integration_partner_id": partner["id"]}, {"_id": 1}):
            raise HTTPException(status_code=409, detail=f"{partner['name']} already has a POS partner key. Rotate that key instead of creating another.")
        webhook_secret, webhook_secret_enc = _new_webhook_secret()

    odoo = get_odoo_client()
    wh = _warehouse_summary(odoo, body.warehouse_id)
    pricelist_name = _validate_pricelist(odoo, body.pricelist_id, wh["company_id"])

    raw_key, key_hash, key_prefix = generate_api_key()
    now = datetime.now(timezone.utc)
    doc = {
        "name": body.name.strip(),
        "description": body.description.strip(),
        "client_type": body.client_type,
        "integration_partner_id": partner["id"] if partner else None,
        "integration_partner_name": partner["name"] if partner else None,
        "parent_client_id": None,
        "odoo_partner_id": None,
        "callback_url": callback_url,
        "webhook_secret_enc": webhook_secret_enc,
        "webhook_secret_rotated_at": None,
        "warehouse_id": body.warehouse_id,
        **wh,
        "pricelist_id": body.pricelist_id,
        "pricelist_name": pricelist_name,
        "stock_detail": body.stock_detail,
        "scoped_parent_category_ids": await _validate_parent_categories(body.scoped_parent_category_ids),
        "key_hash": key_hash,
        "key_prefix": key_prefix,
        "sandbox": body.sandbox,
        "active": True,
        "created_at": now,
        "created_by": current_user.get("username"),
        "updated_at": now,
        "last_used_at": None,
        "key_rotated_at": None,
    }
    result = await col("api_clients").insert_one(doc)
    doc["_id"] = result.inserted_id
    out = _client_out(doc)
    await audit_log(
        "api_client.created", "api_client", out["id"], entity_label=doc["name"],
        user=current_user, after=out, ip=_ip(request),
        reseller_id=partner["id"] if partner else None,
    )
    if partner and partner.get("channel") != "api_partner":
        await col("resellers").update_one(
            {"id": partner["id"]},
            {"$set": {"channel": "api_partner", "updated_at": now}},
        )
        await audit_log(
            "reseller.channel_changed", "reseller", partner["id"], entity_label=partner["name"],
            user=current_user, before={"channel": partner.get("channel") or "portal"},
            after={"channel": "api_partner"}, ip=_ip(request), reseller_id=partner["id"],
        )
    # The only time the raw key (and webhook secret) is ever returned.
    return {"client": out, "api_key": raw_key, "webhook_secret": webhook_secret}


@router.put("/api-clients/{client_id}")
async def update_api_client(client_id: str, body: ApiClientUpdate, request: Request, current_user: dict = Depends(require_super_admin)):
    existing = await col("api_clients").find_one({"_id": _oid(client_id)})
    if not existing:
        raise HTTPException(status_code=404, detail="API client not found")

    odoo = get_odoo_client()
    updates: dict = {}
    if body.name is not None:
        updates["name"] = body.name.strip()
    if body.description is not None:
        updates["description"] = body.description.strip()
    if body.stock_detail is not None:
        updates["stock_detail"] = body.stock_detail
    if body.sandbox is not None:
        updates["sandbox"] = body.sandbox
    if body.clear_category_scope:
        updates["scoped_parent_category_ids"] = None
    elif body.scoped_parent_category_ids is not None:
        updates["scoped_parent_category_ids"] = await _validate_parent_categories(body.scoped_parent_category_ids)
    if body.callback_url is not None:
        if existing.get("client_type") != CLIENT_PARTNER_PLATFORM:
            raise HTTPException(status_code=400, detail="Only a POS partner key has a webhook address.")
        updates["callback_url"] = _normalise_callback_url(body.callback_url)

    company_id = existing.get("company_id")
    if body.warehouse_id is not None and body.warehouse_id != existing.get("warehouse_id"):
        wh = _warehouse_summary(odoo, body.warehouse_id)
        updates.update({"warehouse_id": body.warehouse_id, **wh})
        company_id = wh["company_id"]

    if body.clear_pricelist:
        updates.update({"pricelist_id": None, "pricelist_name": None})
    elif body.pricelist_id is not None or "company_id" in updates:
        # Re-validate the pricelist whenever either side of the pairing changes.
        pricelist_id = body.pricelist_id if body.pricelist_id is not None else existing.get("pricelist_id")
        updates.update({"pricelist_id": pricelist_id, "pricelist_name": _validate_pricelist(odoo, pricelist_id, company_id)})

    if not updates:
        return {"client": _client_out(existing)}
    updates["updated_at"] = datetime.now(timezone.utc)
    await col("api_clients").update_one({"_id": existing["_id"]}, {"$set": updates})
    after = await col("api_clients").find_one({"_id": existing["_id"]})
    await audit_log(
        "api_client.updated", "api_client", client_id, entity_label=after.get("name", ""),
        user=current_user, before=_client_out(existing), after=_client_out(after), ip=_ip(request),
    )
    return {"client": _client_out(after)}


@router.post("/api-clients/{client_id}/rotate")
async def rotate_api_client_key(client_id: str, request: Request, current_user: dict = Depends(require_super_admin)):
    """Atomic swap: the single update replaces the stored hash, so the old
    key stops working at the same instant the new one starts."""
    existing = await col("api_clients").find_one({"_id": _oid(client_id)})
    if not existing:
        raise HTTPException(status_code=404, detail="API client not found")
    raw_key, key_hash, key_prefix = generate_api_key()
    now = datetime.now(timezone.utc)
    await col("api_clients").update_one(
        {"_id": existing["_id"]},
        {"$set": {"key_hash": key_hash, "key_prefix": key_prefix, "key_rotated_at": now, "updated_at": now}},
    )
    await audit_log(
        "api_client.key_rotated", "api_client", client_id, entity_label=existing.get("name", ""),
        user=current_user, before={"key_prefix": existing.get("key_prefix")}, after={"key_prefix": key_prefix},
        ip=_ip(request), reseller_id=existing.get("integration_partner_id"),
    )
    after = await col("api_clients").find_one({"_id": existing["_id"]})
    return {"client": _client_out(after), "api_key": raw_key}


@router.post("/api-clients/{client_id}/rotate-webhook-secret")
async def rotate_webhook_secret(client_id: str, request: Request, current_user: dict = Depends(require_super_admin)):
    """New signing secret for a POS partner's webhooks. Takes effect for the
    next webhook sent; the partner must switch to verifying with it."""
    existing = await col("api_clients").find_one({"_id": _oid(client_id)})
    if not existing:
        raise HTTPException(status_code=404, detail="API client not found")
    if existing.get("client_type") != CLIENT_PARTNER_PLATFORM:
        raise HTTPException(status_code=400, detail="Only a POS partner key has a webhook secret.")
    raw, enc = _new_webhook_secret()
    now = datetime.now(timezone.utc)
    await col("api_clients").update_one(
        {"_id": existing["_id"]},
        {"$set": {"webhook_secret_enc": enc, "webhook_secret_rotated_at": now, "updated_at": now}},
    )
    await audit_log(
        "api_client.webhook_secret_rotated", "api_client", client_id, entity_label=existing.get("name", ""),
        user=current_user, ip=_ip(request), reseller_id=existing.get("integration_partner_id"),
    )
    after = await col("api_clients").find_one({"_id": existing["_id"]})
    return {"client": _client_out(after), "webhook_secret": raw}


async def _set_client_active(client_id: str, active: bool, request: Request, current_user: dict) -> dict:
    existing = await col("api_clients").find_one({"_id": _oid(client_id)})
    if not existing:
        raise HTTPException(status_code=404, detail="API client not found")
    await col("api_clients").update_one(
        {"_id": existing["_id"]},
        {"$set": {"active": active, "updated_at": datetime.now(timezone.utc)}},
    )
    await audit_log(
        "api_client.activated" if active else "api_client.revoked", "api_client", client_id,
        entity_label=existing.get("name", ""), user=current_user,
        before={"active": existing.get("active")}, after={"active": active}, ip=_ip(request),
        reseller_id=existing.get("integration_partner_id"),
    )
    after = await col("api_clients").find_one({"_id": existing["_id"]})
    return {"client": _client_out(after)}


@router.post("/api-clients/{client_id}/revoke")
async def revoke_api_client(client_id: str, request: Request, current_user: dict = Depends(require_super_admin)):
    """Immediate: the very next request with this key gets a 401."""
    return await _set_client_active(client_id, False, request, current_user)


@router.post("/api-clients/{client_id}/activate")
async def activate_api_client(client_id: str, request: Request, current_user: dict = Depends(require_super_admin)):
    return await _set_client_active(client_id, True, request, current_user)


# ── Kill switch ───────────────────────────────────────────────────────────────

class KillSwitchIn(BaseModel):
    enabled: bool
    reason: str = ""


@router.get("/kill-switch")
async def get_kill_switch(current_user: dict = Depends(require_super_admin)):
    doc = await col("portal_settings").find_one({"_id": KILL_SWITCH_ID}) or {}
    return {
        "enabled": await external_api_enabled(),
        "reason": doc.get("reason"),
        "updated_at": doc.get("updated_at"),
        "updated_by": doc.get("updated_by"),
    }


@router.put("/kill-switch")
async def set_kill_switch(body: KillSwitchIn, request: Request, current_user: dict = Depends(require_super_admin)):
    if not body.enabled and not body.reason.strip():
        raise HTTPException(status_code=400, detail="Give a reason for pausing the external API.")
    before = await external_api_enabled()
    await col("portal_settings").update_one(
        {"_id": KILL_SWITCH_ID},
        {"$set": {
            "enabled": body.enabled,
            "reason": body.reason.strip() or None,
            "updated_at": datetime.now(timezone.utc),
            "updated_by": current_user.get("username"),
        }},
        upsert=True,
    )
    await audit_log(
        "external_api.resumed" if body.enabled else "external_api.paused", "portal_settings", KILL_SWITCH_ID,
        entity_label="External API kill switch", user=current_user,
        before={"enabled": before}, after={"enabled": body.enabled},
        detail={"reason": body.reason.strip() or None}, ip=_ip(request),
    )
    return await get_kill_switch(current_user)


# ── Sales channels ────────────────────────────────────────────────────────────

class SalesChannelIn(BaseModel):
    name: str = Field(min_length=2, max_length=80)
    channel_type: Literal["woocommerce"] = "woocommerce"
    warehouse_id: int
    pricelist_id: Optional[int] = None
    store_url: str
    consumer_key: Optional[str] = None
    consumer_secret: Optional[str] = None
    webhook_secret: Optional[str] = None
    payment_journal_id: Optional[int] = None
    safety_buffer_qty: float = Field(default=0, ge=0)


class SalesChannelUpdate(BaseModel):
    name: Optional[str] = Field(default=None, min_length=2, max_length=80)
    warehouse_id: Optional[int] = None
    pricelist_id: Optional[int] = None
    clear_pricelist: bool = False
    store_url: Optional[str] = None
    # Secrets: omitted or blank = keep the stored value. Write-only.
    consumer_key: Optional[str] = None
    consumer_secret: Optional[str] = None
    webhook_secret: Optional[str] = None
    payment_journal_id: Optional[int] = None
    clear_payment_journal: bool = False
    safety_buffer_qty: Optional[float] = Field(default=None, ge=0)
    active: Optional[bool] = None


_SECRET_FIELDS = ("consumer_key", "consumer_secret", "webhook_secret")

_CHANNEL_PUBLIC_FIELDS = (
    "name", "channel_type", "warehouse_id", "warehouse_name", "company_id", "company_name",
    "pricelist_id", "pricelist_name", "store_url", "payment_journal_id", "payment_journal_name",
    "safety_buffer_qty", "consumer_key_hint", "sync_enabled", "order_intake_enabled",
    "sandbox", "active", "created_at", "created_by", "updated_at", "last_sync_at", "last_order_poll_at",
)


def _channel_out(doc: dict) -> dict:
    out = {"id": str(doc["_id"])}
    out.update({k: doc.get(k) for k in _CHANNEL_PUBLIC_FIELDS})
    for f in _SECRET_FIELDS:
        out[f"has_{f}"] = bool(doc.get(f"{f}_enc"))
    return out


def _normalise_store_url(url: str) -> str:
    url = url.strip().rstrip("/")
    parsed = urlparse(url)
    if parsed.scheme != "https" or not parsed.netloc:
        raise HTTPException(status_code=400, detail="The store URL must be a full https:// address, e.g. https://shop.example.co.za")
    return url


def _validate_journal(odoo, journal_id: Optional[int], company_id: Optional[int]) -> Optional[str]:
    if not journal_id:
        return None
    try:
        rows = odoo.read("account.journal", [journal_id], fields=["name", "type", "company_id"])
    except Exception as e:
        raise HTTPException(status_code=502, detail=f"Could not read the payment journal: {e}")
    if not rows or rows[0].get("type") not in ("bank", "cash"):
        raise HTTPException(status_code=400, detail="Choose a bank or cash journal for web payments.")
    j_company = rows[0].get("company_id")
    if company_id and j_company and j_company[0] != company_id:
        raise HTTPException(status_code=400, detail="That payment journal belongs to a different company than the selected warehouse.")
    return rows[0]["name"]


def _encrypt_secrets(body, updates: dict) -> None:
    """Encrypts any non-blank secret on the payload into `updates`."""
    for f in _SECRET_FIELDS:
        value = (getattr(body, f) or "").strip()
        if not value:
            continue
        try:
            updates[f"{f}_enc"] = secret_box.encrypt(value)
        except secret_box.SecretBoxNotConfigured:
            raise HTTPException(
                status_code=503,
                detail="Credential storage isn't configured on the server yet (CREDENTIALS_ENCRYPTION_KEY). Ask a super admin to set it before saving store credentials.",
            )
        if f == "consumer_key":
            updates["consumer_key_hint"] = value[-4:]


@router.get("/channels")
async def list_channels(current_user: dict = Depends(require_permission("channels.manage"))):
    docs = await col("sales_channels").find({}).sort("created_at", -1).to_list(200)
    return {"channels": [_channel_out(d) for d in docs], "credentials_storage_configured": secret_box.is_configured()}


@router.post("/channels")
async def create_channel(body: SalesChannelIn, request: Request, current_user: dict = Depends(require_permission("channels.manage"))):
    odoo = get_odoo_client()
    wh = _warehouse_summary(odoo, body.warehouse_id)
    now = datetime.now(timezone.utc)
    doc = {
        "name": body.name.strip(),
        "channel_type": body.channel_type,
        "warehouse_id": body.warehouse_id,
        **wh,
        "pricelist_id": body.pricelist_id,
        "pricelist_name": _validate_pricelist(odoo, body.pricelist_id, wh["company_id"]),
        "store_url": _normalise_store_url(body.store_url),
        "payment_journal_id": body.payment_journal_id,
        "payment_journal_name": _validate_journal(odoo, body.payment_journal_id, wh["company_id"]),
        "safety_buffer_qty": body.safety_buffer_qty,
        # Both stay off until 14.5 (sync) and 14.6 (order intake) exist and
        # the channel has been tested; switched on deliberately, not by default.
        "sync_enabled": False,
        "order_intake_enabled": False,
        "sandbox": True,
        "active": True,
        "created_at": now,
        "created_by": current_user.get("username"),
        "updated_at": now,
        "last_sync_at": None,
        "last_order_poll_at": None,
    }
    _encrypt_secrets(body, doc)
    result = await col("sales_channels").insert_one(doc)
    doc["_id"] = result.inserted_id
    out = _channel_out(doc)
    await audit_log(
        "sales_channel.created", "sales_channel", out["id"], entity_label=doc["name"],
        user=current_user, after=out, ip=_ip(request),
    )
    return {"channel": out}


@router.put("/channels/{channel_id}")
async def update_channel(channel_id: str, body: SalesChannelUpdate, request: Request, current_user: dict = Depends(require_permission("channels.manage"))):
    existing = await col("sales_channels").find_one({"_id": _oid(channel_id)})
    if not existing:
        raise HTTPException(status_code=404, detail="Sales channel not found")

    odoo = get_odoo_client()
    updates: dict = {}
    if body.name is not None:
        updates["name"] = body.name.strip()
    if body.store_url is not None:
        updates["store_url"] = _normalise_store_url(body.store_url)
    if body.safety_buffer_qty is not None:
        updates["safety_buffer_qty"] = body.safety_buffer_qty
    if body.active is not None:
        updates["active"] = body.active

    company_id = existing.get("company_id")
    if body.warehouse_id is not None and body.warehouse_id != existing.get("warehouse_id"):
        wh = _warehouse_summary(odoo, body.warehouse_id)
        updates.update({"warehouse_id": body.warehouse_id, **wh})
        company_id = wh["company_id"]
    company_changed = "company_id" in updates

    if body.clear_pricelist:
        updates.update({"pricelist_id": None, "pricelist_name": None})
    elif body.pricelist_id is not None or company_changed:
        pl_id = body.pricelist_id if body.pricelist_id is not None else existing.get("pricelist_id")
        updates.update({"pricelist_id": pl_id, "pricelist_name": _validate_pricelist(odoo, pl_id, company_id)})

    if body.clear_payment_journal:
        updates.update({"payment_journal_id": None, "payment_journal_name": None})
    elif body.payment_journal_id is not None or company_changed:
        j_id = body.payment_journal_id if body.payment_journal_id is not None else existing.get("payment_journal_id")
        updates.update({"payment_journal_id": j_id, "payment_journal_name": _validate_journal(odoo, j_id, company_id)})

    _encrypt_secrets(body, updates)
    if not updates:
        return {"channel": _channel_out(existing)}
    updates["updated_at"] = datetime.now(timezone.utc)
    await col("sales_channels").update_one({"_id": existing["_id"]}, {"$set": updates})
    after = await col("sales_channels").find_one({"_id": existing["_id"]})
    await audit_log(
        "sales_channel.updated", "sales_channel", channel_id, entity_label=after.get("name", ""),
        user=current_user, before=_channel_out(existing), after=_channel_out(after),
        # Which secrets changed, never their values.
        detail={"secrets_changed": [f for f in _SECRET_FIELDS if f"{f}_enc" in updates]},
        ip=_ip(request),
    )
    return {"channel": _channel_out(after)}


# ── Picker options ────────────────────────────────────────────────────────────

@router.get("/options/pricelists")
async def pricelist_options(
    warehouse_id: int = Query(...),
    current_user: dict = Depends(require_permission("channels.manage")),
):
    """Pricelists usable with this warehouse: its own company's, plus shared
    ones with no company. Super admins (the only API-client managers) pass
    the channels.manage gate unconditionally."""
    odoo = get_odoo_client()
    company_id = get_company_id(odoo, warehouse_id)
    domain: list = [("active", "=", True)]
    if company_id:
        domain += ["|", ("company_id", "=", company_id), ("company_id", "=", False)]
    try:
        rows = odoo.search_read(
            "product.pricelist", domain=domain,
            fields=["id", "name", "company_id", "currency_id"], limit=100, order="name asc",
        )
    except Exception as e:
        raise HTTPException(status_code=502, detail=f"Could not load pricelists: {e}")
    return {"pricelists": [
        {
            "id": r["id"],
            "name": r["name"],
            "company_name": r["company_id"][1] if r.get("company_id") else "Shared",
            "currency": r["currency_id"][1] if r.get("currency_id") else None,
        }
        for r in rows
    ]}


@router.get("/options/payment-journals")
async def payment_journal_options(
    warehouse_id: int = Query(...),
    current_user: dict = Depends(require_permission("channels.manage")),
):
    odoo = get_odoo_client()
    company_id = get_company_id(odoo, warehouse_id)
    domain: list = [("type", "in", ["bank", "cash"]), ("active", "=", True)]
    if company_id:
        domain.append(("company_id", "=", company_id))
    try:
        rows = odoo.search_read("account.journal", domain=domain, fields=["id", "name", "code", "type"], limit=100, order="name asc")
    except Exception as e:
        raise HTTPException(status_code=502, detail=f"Could not load payment journals: {e}")
    return {"journals": rows}
