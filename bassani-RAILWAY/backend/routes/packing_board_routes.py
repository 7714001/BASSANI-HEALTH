"""
Packing Board — real-time WebSocket hub.

Connections (all require token auth):
  wss://host/api/packing/ws/board?token=<per-warehouse display token>   ← 85" screen
  wss://host/api/packing/ws/supervisor?token=<supervisor_jwt>             ← supervisor phone
  wss://host/api/packing/ws/packer?token=<packer_jwt>                    ← packer handheld

Every connection is scoped to exactly one warehouse (the screen's token maps to
one warehouse; the supervisor/packer's fixed `warehouse_id`) — board state and
broadcasts are filtered so a vault never sees another vault's queue.

Board state lives in MongoDB `packing_board` collection so it
survives server restarts.
"""
import asyncio
import json
import jwt
import logging
from datetime import datetime, timezone
from fastapi import APIRouter, BackgroundTasks, WebSocket, WebSocketDisconnect, Depends, HTTPException
from pydantic import BaseModel
from typing import Optional, List
from auth import require_admin, get_current_user, get_user_by_username, require_permission, require_any_permission, require_super_admin, ADMIN_ROLES
from config import get_settings
from database import col, NO_ID
from middleware.audit import audit_log
from odoo_client import get_odoo_client, odoo as odoo_call
from routes.settings_routes import get_email_routing
from routes.monitor_routes import broadcast_monitor_refresh
from services.email_service import (
    send_order_packing_started,
    send_order_ready_for_collection,
    send_order_ready_for_collection_reseller,
    send_order_ready_for_collection_customer,
    send_partial_delivery_ready,
    send_backorder_created_internal,
    send_backorder_stock_ready,
    send_qa_approval_needed,
    send_rp_approval_needed,
)
from services.notification_service import notify_ticket_handoff
from services.age_tier import board_entry_age_fields

logger = logging.getLogger(__name__)
router = APIRouter(prefix="/api/packing", tags=["packing-board"])
settings = get_settings()


def _dumps(obj) -> str:
    """json.dumps that handles MongoDB datetime objects."""
    def _default(o):
        if isinstance(o, datetime):
            return o.isoformat()
        raise TypeError(f"Not serializable: {type(o)}")
    return json.dumps(obj, default=_default)


# ── Connection manager ────────────────────────────────────────────────────────

class BoardManager:
    def __init__(self):
        self.screens:     list[tuple[WebSocket, Optional[int]]] = []
        self.supervisors: list[tuple[WebSocket, Optional[int]]] = []
        self.packers:     list[tuple[WebSocket, Optional[int]]] = []

    async def connect_screen(self, ws: WebSocket, warehouse_id: Optional[int]):
        self.screens.append((ws, warehouse_id))
        await ws.send_text(_dumps({"type": "full_state", "data": await get_board_state(warehouse_id)}))

    async def connect_supervisor(self, ws: WebSocket, warehouse_id: Optional[int]):
        self.supervisors.append((ws, warehouse_id))
        await ws.send_text(_dumps({"type": "full_state", "data": await get_board_state(warehouse_id)}))

    async def connect_packer(self, ws: WebSocket, warehouse_id: Optional[int]):
        self.packers.append((ws, warehouse_id))
        await ws.send_text(_dumps({"type": "full_state", "data": await get_board_state(warehouse_id)}))

    def disconnect(self, ws: WebSocket):
        self.screens     = [c for c in self.screens     if c[0] is not ws]
        self.supervisors = [c for c in self.supervisors if c[0] is not ws]
        self.packers     = [c for c in self.packers     if c[0] is not ws]

    async def broadcast(self, message: dict, warehouse_id: Optional[int] = None):
        """Deliver to every connection, unless `warehouse_id` is given — then
        skip connections scoped to a *different* warehouse. Connections with no
        warehouse (e.g. a super_admin testing a role JWT) always receive."""
        payload = _dumps(message)
        dead = []
        for ws, ws_wh in self.screens + self.supervisors + self.packers:
            if warehouse_id is not None and ws_wh is not None and ws_wh != warehouse_id:
                continue
            try:
                await ws.send_text(payload)
            except Exception:
                dead.append(ws)
        for ws in dead:
            self.disconnect(ws)


manager = BoardManager()


# ── Board state helpers ───────────────────────────────────────────────────────

def _with_age(entry: dict) -> dict:
    """Attach age_tier/hours_elapsed/deadline_hours to a packing_board entry
    — same clock/deadline choice services/age_tier.py's board_entry_age_fields
    (shared with monitor_routes.py's own _board_card) already uses for the
    public Operations Monitor (2026-08-26), so this page's age badge can
    never disagree with that board's."""
    entry.update(board_entry_age_fields(entry))
    return entry


async def get_board_state(warehouse_id: Optional[int] = None) -> list:
    query: dict = {"status": {"$ne": "cleared"}}
    if warehouse_id is not None:
        query["warehouse_id"] = warehouse_id
    entries = await (
        col("packing_board")
        .find(query, NO_ID)
        .sort("queued_at", 1)
        .to_list(length=100)
    )
    return [_with_age(e) for e in entries]


async def push_update(entry: dict):
    await manager.broadcast({"type": "entry_update", "data": entry}, warehouse_id=entry.get("warehouse_id"))


async def _resolve_customer_notification_recipients(odoo, partner_id: int) -> tuple:
    """Resolve recipients for a customer-facing milestone email (currently:
    ready for collection) — the account's main company email plus every
    other active contact on file, so the notification reaches the actual
    customer regardless of who placed the order (reseller or Bassani staff).

    Returns (company_email, other_contact_emails). Best-effort: returns
    (None, []) on any Odoo error rather than raising — a failed lookup here
    must never block the packing/status update that triggered it."""
    try:
        _cpr = odoo.read("res.partner", [partner_id], fields=["commercial_partner_id"])
        company_id = partner_id
        if _cpr:
            _cp = _cpr[0].get("commercial_partner_id")
            if _cp and _cp is not False:
                company_id = _cp[0]

        company_rows = odoo.read("res.partner", [company_id], fields=["email"])
        company_email = company_rows[0].get("email") if company_rows else None
        company_email = company_email if company_email and company_email is not False else None

        contact_ids = odoo.search(
            "res.partner", [["parent_id", "=", company_id], ["active", "=", True]], limit=50,
        )
        other_emails: list = []
        if contact_ids:
            raw = odoo.read("res.partner", contact_ids, fields=["email", "type"])
            for c in raw:
                email = c.get("email")
                if email and email is not False and c.get("type") in ("contact", "invoice"):
                    other_emails.append(email)

        seen = {company_email.lower()} if company_email else set()
        deduped: list = []
        for e in other_emails:
            if e.lower() not in seen:
                seen.add(e.lower())
                deduped.append(e)
        return company_email, deduped
    except Exception as exc:
        logger.warning("customer_notification_recipients_failed partner_id=%s error=%s", partner_id, exc)
        return None, []


async def _sync_sales_ticket(
    order_id: str,
    outcome: str,
    reason: Optional[str] = None,
    background_tasks: Optional[BackgroundTasks] = None,
):
    """
    Phase 8.4 — write an Orders outcome (complete/incomplete/cancelled) back
    to the linked Sales ticket and notify the assigned sales rep. Best-effort
    and silent if no Sales ticket exists for this order — a packing board
    entry can exist without ever having gone through one (e.g. legacy orders
    confirmed before Phase 8, or orders placed without a logged PO/RFQ).

    background_tasks is optional and only used for the ready_for_collection
    customer-notification email below — callers that don't need it (or that
    never reach that outcome) can omit it.
    """
    try:
        ticket = await col("tickets").find_one(
            {"type": "sales", "order_id": int(order_id), "exit_status": None}
        )
        if not ticket:
            return
        now = datetime.now(timezone.utc)
        updates: dict = {"updated_at": now}
        if outcome == "incomplete":
            updates["status"] = "incomplete"
            updates["incomplete_reason"] = reason
        elif outcome == "partially_fulfilled":
            updates["status"] = "partially_fulfilled"
        elif outcome == "ready_for_collection":
            updates["status"] = "ready_for_collection"
        else:  # complete | cancelled — terminal exit
            updates["exit_status"] = outcome
        await col("tickets").update_one(
            {"_id": ticket["_id"]},
            {"$set": updates, "$push": {"stage_history": {
                "status": updates.get("status", ticket["status"]),
                "exit_status": updates.get("exit_status"),
                "actor_id": None, "actor_name": "system", "at": now,
                "note": f"Orders ticket reached '{outcome}'" + (f": {reason}" if reason else ""),
            }}},
        )
        await notify_ticket_handoff(ticket.get("customer_name", ""), outcome, ticket.get("assigned_to"))

        # Notify the actual customer account — main company email plus every
        # other contact on file — regardless of whether this order was placed
        # by a reseller (who gets their own separate notification) or
        # directly by Bassani staff (who today notified nobody outside the
        # warehouse). Reuses customer_id/customer_company_id already on the
        # ticket doc rather than a fresh Odoo sale.order read.
        if outcome == "ready_for_collection" and background_tasks is not None:
            partner_id = ticket.get("customer_company_id") or ticket.get("customer_id")
            if partner_id:
                odoo = get_odoo_client()
                company_email, other_emails = await _resolve_customer_notification_recipients(odoo, partner_id)
                if company_email:
                    background_tasks.add_task(
                        send_order_ready_for_collection_customer,
                        customer_email=company_email,
                        order_ref=str(order_id),
                        customer_name=ticket.get("customer_name", ""),
                        cc=other_emails or None,
                    )
    except Exception as e:
        logger.warning("sales_ticket_sync_failed order_id=%s error=%s", order_id, e)


# ── WebSocket auth helpers ────────────────────────────────────────────────────

async def _verify_display_token(ws: WebSocket) -> Optional[int]:
    """Validate ?token= against the Mongo-stored per-warehouse display token.
    Returns the matched warehouse_id, or None if invalid/missing."""
    provided = ws.query_params.get("token", "").strip()
    if not provided:
        return None
    record = await col("warehouse_display_tokens").find_one({"token": provided}, {"warehouse_id": 1})
    return record["warehouse_id"] if record else None


# Phase 8.3 — roles that need read access to the board to do their job, even
# though they don't hold a granular `warehouse.*` permission. Kept separate
# from require_admin (coarse, all admins) and require_permission (granular,
# tickets.* specific) since this is neither — just "can see the board".
_BOARD_VIEW_ROLES = {"orders_clerk", "qa_manager", "responsible_pharmacist", "sales"}


async def require_board_access(current_user: dict = Depends(get_current_user)) -> dict:
    if current_user.get("is_super_admin") or current_user.get("role") in ADMIN_ROLES:
        return current_user
    if current_user.get("role") in _BOARD_VIEW_ROLES:
        return current_user
    raise HTTPException(status_code=403, detail="Access denied")


async def _verify_ws_user(ws: WebSocket, required_roles: set) -> Optional[dict]:
    token = ws.query_params.get("token", "")
    if not token:
        return None
    try:
        payload = jwt.decode(token, settings.jwt_secret, algorithms=[settings.jwt_algorithm])
        username = payload.get("sub")
        if not username:
            return None
        user = await get_user_by_username(username)
        if not user or not user.get("active", True):
            return None
        if user.get("is_super_admin"):
            return user
        if user.get("role") not in required_roles:
            return None
        return user
    except Exception:
        return None


# ── Shared action service ─────────────────────────────────────────────────────
# Used by both REST endpoints and WebSocket handlers to ensure audit logging
# is consistent regardless of how an action is triggered.

def _entry_query(order_id: str, picking_id: Optional[int] = None) -> dict:
    """The single lookup rule every per-entry packing_board endpoint uses to
    find the right document (2026-08-23). order_id alone is NOT unique — a
    backorder entry deliberately shares its parent's order_id (set at the
    split point in complete_entry below), so once both the primary and a
    reactivated backorder exist at the same time under the same order_id,
    a bare {"order_id": ...} lookup can silently resolve to either one.
    picking_id (Odoo's own stock.picking id, already stored on every entry
    as odoo_picking_id) is the real unique identifier for "which delivery."
    When omitted, defaults to the primary (non-backorder) entry — the exact
    rule mark_collected already used for itself before this was generalised,
    which is also why this is fully backward compatible: an order with no
    backorder only ever has one entry matching either branch, so nothing
    about the existing trained flow changes."""
    query: dict = {"order_id": order_id}
    if picking_id:
        query["odoo_picking_id"] = picking_id
    else:
        query["is_backorder"] = {"$ne": True}
    return query


async def _do_assign_packer(order_id: str, packer_name: str, actor: dict, picking_id: Optional[int] = None) -> Optional[dict]:
    result = await col("packing_board").find_one_and_update(
        _entry_query(order_id, picking_id),
        {"$set": {
            "packer_name": packer_name.upper(),
            "status":      "packing",
            "assigned_at": datetime.now(timezone.utc),
        }},
        return_document=True,
    )
    if not result:
        return None
    result.pop("_id", None)
    await push_update(result)
    await audit_log("packing.assigned", "packing_board", order_id, entity_label=order_id,
                    user=actor, detail={"packer": packer_name})
    return result


async def _do_tick_item(order_id: str, sku: str, ticked: bool, actor: dict, picking_id: Optional[int] = None) -> Optional[dict]:
    entry = await col("packing_board").find_one(_entry_query(order_id, picking_id))
    if not entry:
        return None
    ticks = entry.get("item_ticks", {})
    ticks[sku] = ticked
    all_done = all(ticks.values()) if ticks else False
    update: dict = {"item_ticks": ticks}
    if all_done:
        update["status"]   = "ready"
        update["ready_at"] = datetime.now(timezone.utc)
    updated = await col("packing_board").find_one_and_update(
        {"_id": entry["_id"]},
        {"$set": update},
        return_document=True,
    )
    if not updated:
        return None
    updated.pop("_id", None)
    await push_update(updated)
    if all_done:
        await audit_log("packing.items_complete", "packing_board", order_id, entity_label=order_id,
                        user=actor, detail={"packer": entry.get("packer_name")})
    return updated


async def _do_update_status(order_id: str, new_status: str, actor: dict, picking_id: Optional[int] = None) -> Optional[dict]:
    ts_field = {
        "collected": "collected_at",
        "cleared":   "cleared_at",
        "ready":     "ready_at",
    }.get(new_status)
    update: dict = {"status": new_status}
    if ts_field:
        update[ts_field] = datetime.now(timezone.utc)
    updated = await col("packing_board").find_one_and_update(
        _entry_query(order_id, picking_id),
        {"$set": update},
        return_document=True,
    )
    if not updated:
        return None
    updated.pop("_id", None)
    await push_update(updated)
    await audit_log(f"packing.{new_status}", "packing_board", order_id, entity_label=order_id, user=actor)
    await broadcast_monitor_refresh()
    return updated


# ── Pydantic models ───────────────────────────────────────────────────────────

class BoardEntry(BaseModel):
    order_id:      str
    warehouse_id:  Optional[int] = None
    customer_name: str
    customer_city: str
    items:         List[dict]
    total_units:   int
    inv_num:       str
    dn_num:        str
    ps_num:        str
    notes:         Optional[str] = ""
    is_reseller:   bool = False
    reseller_name: Optional[str] = None
    order_value:   Optional[float] = None


class AssignPacker(BaseModel):
    order_id:    str
    packer_name: str
    picking_id:  Optional[int] = None  # Odoo picking ID; if omitted, targets the primary (non-backorder) entry


class UpdateStatus(BaseModel):
    order_id:   str
    status:     str
    picking_id: Optional[int] = None  # Odoo picking ID; if omitted, targets the primary (non-backorder) entry


class OrderIdBody(BaseModel):
    order_id:   str
    picking_id: Optional[int] = None  # Odoo picking ID; if omitted, targets the primary (non-backorder) entry


class IncompleteBody(BaseModel):
    order_id:   str
    reason:     str
    picking_id: Optional[int] = None  # Odoo picking ID; if omitted, targets the primary (non-backorder) entry


class CancelBody(BaseModel):
    order_id:   str
    reason:     Optional[str] = None
    picking_id: Optional[int] = None  # Odoo picking ID; if omitted, targets the primary (non-backorder) entry


class AdoptBody(BaseModel):
    order_id: int  # Odoo sale.order ID (integer)

class MarkCollectedBody(BaseModel):
    order_id: str
    picking_id: Optional[int] = None  # Odoo picking ID; if omitted, targets the primary (non-backorder) entry

class UpdateItemQtyBody(BaseModel):
    order_id:   str
    sku:        str
    qty_packed: float
    picking_id: Optional[int] = None  # Odoo picking ID; if omitted, targets the primary (non-backorder) entry


# ── REST endpoints ────────────────────────────────────────────────────────────

@router.post("/queue")
async def add_to_board(
    entry: BoardEntry,
    current_user: dict = Depends(require_admin),
):
    now = datetime.now(timezone.utc)
    doc = {
        **entry.model_dump(),
        "packer_name":  None,
        "status":       "queued",
        "queued_at":    now,
        "packed_at":    None,
        "ready_at":     None,
        "collected_at": None,
        "cancelled_at":   None,
        "incomplete_at":  None,
        "completed_at":   None,
        "incomplete_reason": None,
        "qa_approved_by": None, "qa_approved_at": None,
        "rp_approved_by": None, "rp_approved_at": None,
        "item_ticks":   {i["sku"]: False for i in entry.items},
    }
    await col("packing_board").replace_one(
        {"order_id": entry.order_id},
        doc,
        upsert=True,
    )
    await push_update(doc)
    await audit_log("packing.queued", "packing_board", entry.order_id, entity_label=entry.customer_name,
                    user=current_user, detail={"customer": entry.customer_name, "units": entry.total_units})
    await broadcast_monitor_refresh()
    return {"success": True, "order_id": entry.order_id}


@router.put("/assign")
async def assign_packer(
    body: AssignPacker,
    current_user: dict = Depends(require_admin),
):
    result = await _do_assign_packer(body.order_id, body.packer_name, current_user, body.picking_id)
    if not result:
        raise HTTPException(status_code=404, detail="Order not on board")
    return {"success": True, "packer": body.packer_name.upper()}


@router.put("/tick")
async def tick_item(
    order_id: str,
    sku:      str,
    ticked:   bool = True,
    picking_id: Optional[int] = None,
    current_user: dict = Depends(require_admin),
):
    updated = await _do_tick_item(order_id, sku, ticked, current_user, picking_id)
    if not updated:
        raise HTTPException(status_code=404, detail="Order not on board")
    all_done = all(updated["item_ticks"].values()) if updated.get("item_ticks") else False
    return {"success": True, "all_done": all_done, "status": updated["status"]}


@router.put("/update-item-qty")
async def update_item_qty(
    body: UpdateItemQtyBody,
    current_user: dict = Depends(require_permission("tickets.orders")),
):
    """Packer sets the actual qty they have in hand for a specific line item.
    Stored as qty_packed on the item; used as qty_done when validating in Odoo.
    Must be >= 0 and <= qty_reserved. If below reserved, Odoo will auto-create
    a backorder for the shortfall when the order is marked complete."""
    entry = await col("packing_board").find_one(_entry_query(body.order_id, body.picking_id))
    if not entry:
        raise HTTPException(status_code=404, detail="Order not on board")
    if entry["status"] != "packing":
        raise HTTPException(status_code=400, detail=f"Qty can only be edited while packing (current status: '{entry['status']}')")

    items = entry.get("items", [])
    item = next((i for i in items if i.get("sku") == body.sku), None)
    if not item:
        raise HTTPException(status_code=404, detail="Item not found on this order")

    qty_reserved = float(item.get("qty_reserved") or item.get("qty") or 0)
    if body.qty_packed < 0:
        raise HTTPException(status_code=400, detail="Qty packed cannot be negative")
    if body.qty_packed > qty_reserved:
        raise HTTPException(status_code=400, detail=f"Qty packed ({body.qty_packed}) cannot exceed reserved qty ({qty_reserved})")

    new_items = [
        {**i, "qty_packed": body.qty_packed} if i.get("sku") == body.sku else i
        for i in items
    ]
    await col("packing_board").update_one(
        {"_id": entry["_id"]},
        {"$set": {"items": new_items}},
    )
    await audit_log(
        "packing.qty_packed", "packing_board", body.order_id,
        entity_label=body.order_id, user=current_user,
        detail={"sku": body.sku, "qty_packed": body.qty_packed, "qty_reserved": qty_reserved},
    )
    return {"success": True, "qty_packed": body.qty_packed}


@router.put("/status")
async def update_status(
    body: UpdateStatus,
    current_user: dict = Depends(require_admin),
):
    updated = await _do_update_status(body.order_id, body.status, current_user, body.picking_id)
    if not updated:
        raise HTTPException(status_code=404, detail="Order not on board")
    return {"success": True}


@router.put("/qa-approve")
async def qa_approve(
    body: OrderIdBody,
    current_user: dict = Depends(require_permission("tickets.qa_approve")),
):
    """QA Manager sign-off — required (alongside RP) before an entry can be
    marked complete. Only valid once packing has finished (status='ready')."""
    entry = await col("packing_board").find_one(_entry_query(body.order_id, body.picking_id))
    if not entry:
        raise HTTPException(status_code=404, detail="Order not on board")
    if entry["status"] != "ready":
        raise HTTPException(status_code=400, detail="Order isn't ready for inspection yet")

    now = datetime.now(timezone.utc)
    updated = await col("packing_board").find_one_and_update(
        {"_id": entry["_id"]},
        {"$set": {"qa_approved_by": current_user.get("name") or current_user.get("username"), "qa_approved_at": now}},
        return_document=True,
    )
    updated.pop("_id", None)
    await push_update(updated)
    await audit_log("packing.qa_approve", "packing_board", body.order_id, entity_label=body.order_id, user=current_user)
    await broadcast_monitor_refresh()
    return {"success": True}


@router.put("/rp-approve")
async def rp_approve(
    body: OrderIdBody,
    current_user: dict = Depends(require_permission("tickets.rp_approve")),
):
    """Responsible Pharmacist sign-off — required (alongside QA) before an
    entry can be marked complete. Independent of QA's approval — neither
    approves on the other's behalf."""
    entry = await col("packing_board").find_one(_entry_query(body.order_id, body.picking_id))
    if not entry:
        raise HTTPException(status_code=404, detail="Order not on board")
    if entry["status"] != "ready":
        raise HTTPException(status_code=400, detail="Order isn't ready for inspection yet")

    now = datetime.now(timezone.utc)
    updated = await col("packing_board").find_one_and_update(
        {"_id": entry["_id"]},
        {"$set": {"rp_approved_by": current_user.get("name") or current_user.get("username"), "rp_approved_at": now}},
        return_document=True,
    )
    updated.pop("_id", None)
    await push_update(updated)
    await audit_log("packing.rp_approve", "packing_board", body.order_id, entity_label=body.order_id, user=current_user)
    await broadcast_monitor_refresh()
    return {"success": True}


def _validate_odoo_delivery(odoo_order_id: int, qty_overrides: Optional[dict] = None) -> dict:
    """Validate all assigned stock.picking records linked to an Odoo sale order.

    Normally sets qty_done = reserved quantity via action_set_quantities_to_reservation.
    When qty_overrides is provided ({product_id: qty_packed}), writes those specific
    qty_done values to the move lines directly — allowing a packer-reported shortfall
    to produce a backorder automatically via Odoo's standard wizard.

    Returns {"success": bool, "pickings": [name, ...], "error": str|None,
             "backorder_picking_id": int|None, "backorder_picking_name": str|None}.
    Never raises — caller always continues regardless of outcome.
    """
    _odoo = get_odoo_client()
    _no_backorder = {"backorder_picking_id": None, "backorder_picking_name": None}
    try:
        pickings = _odoo.search_read(
            "stock.picking",
            [("sale_id", "=", odoo_order_id), ("state", "=", "assigned")],
            ["id", "name"],
        )
    except Exception as e:
        return {"success": False, "pickings": [], "error": f"Could not fetch delivery orders from Odoo: {e}", **_no_backorder}

    if not pickings:
        # Nothing left in Odoo's "assigned" (Ready) state — this used to be
        # treated as a flat failure regardless of why, which conflated two
        # very different situations: a delivery that was already validated
        # (state "done") outside this button — most commonly staff doing
        # the picking directly in Odoo instead of through the portal — is
        # functionally the same outcome this function itself would have
        # produced, just not via this call; a delivery that's genuinely not
        # ready (no stock reserved yet, or no delivery generated at all) is
        # a real problem. Reconciling against Odoo's actual state here
        # (2026-08-27, found live) rather than assuming the portal is the
        # only possible actor matches this app's own architecture principle
        # that staff shouldn't need Odoo at all for routine work — but that
        # only holds if the portal also correctly recognizes when someone
        # legitimately did act there directly.
        try:
            all_pickings = _odoo.search_read(
                "stock.picking",
                [("sale_id", "=", odoo_order_id)],
                ["id", "name", "state"],
            )
        except Exception as e:
            return {"success": False, "pickings": [], "error": f"Could not fetch delivery orders from Odoo: {e}", **_no_backorder}

        if not all_pickings:
            return {
                "success": False, "pickings": [],
                "error": "No delivery orders found for this order in Odoo — check that the sale order has generated a delivery",
                **_no_backorder,
            }
        done_pickings = [p for p in all_pickings if p["state"] == "done"]
        if len(done_pickings) == len(all_pickings):
            # Every delivery on this order was already validated — nothing
            # left for this call to do, and that's a success, not an error.
            return {"success": True, "pickings": [p["name"] for p in done_pickings], "error": None, **_no_backorder}
        states = ", ".join(sorted({p["state"] for p in all_pickings}))
        return {
            "success": False, "pickings": [],
            "error": f"Delivery not yet ready to validate in Odoo (current state: {states}) — check stock reservation",
            **_no_backorder,
        }

    validated: list = []
    errors: list = []
    backorder_picking_id: Optional[int] = None
    backorder_picking_name: Optional[str] = None
    for picking in pickings:
        pid = picking["id"]
        pname = picking["name"]
        try:
            if qty_overrides:
                # Apply per-product qty_done values; fill move lines in order,
                # stopping when the packer-reported qty is reached.
                # 'quantity' not 'reserved_uom_qty' (2026-08-11, live-verified
                # against production Odoo 19 — see order_routes.py's
                # _queue_packing_board for the fuller field-drift writeup):
                # 'reserved_uom_qty' does not exist on this instance's
                # stock.move.line at all. 'quantity' holds the reserved-but-
                # unpicked amount for that specific move line before
                # completion, confirmed live across real assigned pickings.
                from collections import defaultdict as _dd
                move_lines = _odoo.search_read(
                    "stock.move.line",
                    [("picking_id", "=", pid), ("state", "not in", ["done", "cancel"])],
                    ["id", "product_id", "quantity"],
                )
                product_mls: dict = _dd(list)
                for ml in move_lines:
                    pid_val = ml["product_id"][0] if isinstance(ml["product_id"], list) else ml["product_id"]
                    product_mls[pid_val].append(ml)
                for product_id_val, mls in product_mls.items():
                    override = qty_overrides.get(product_id_val)
                    remaining = float(override) if override is not None else None
                    for ml in mls:
                        reserved = float(ml.get("quantity", 0))
                        if remaining is None:
                            _odoo.execute("stock.move.line", "write", [[ml["id"]], {"qty_done": reserved}])
                        else:
                            take = min(remaining, reserved)
                            _odoo.execute("stock.move.line", "write", [[ml["id"]], {"qty_done": take}])
                            remaining = max(0.0, remaining - take)
            else:
                _odoo.execute("stock.picking", "action_set_quantities_to_reservation", [pid])
            result = _odoo.execute("stock.picking", "button_validate", [pid])
            if isinstance(result, dict) and result.get("res_model") == "stock.backorder.confirmation":
                # Partial reservation — ask Odoo to auto-create a backorder
                try:
                    wiz_id = _odoo.create("stock.backorder.confirmation", {"pick_ids": [(4, pid)]})
                    _odoo.execute("stock.backorder.confirmation", "process", [wiz_id])
                    # Capture the new backorder picking so we can create a portal entry
                    _bo_picks = _odoo.search_read(
                        "stock.picking",
                        [("backorder_id", "=", pid), ("state", "not in", ["done", "cancel"])],
                        ["id", "name"],
                        limit=1,
                    )
                    if _bo_picks:
                        backorder_picking_id = _bo_picks[0]["id"]
                        backorder_picking_name = _bo_picks[0]["name"]
                except Exception:
                    pass  # backorder wizard failed — picking validated with partial qty_done
            validated.append(pname)
        except Exception as e:
            errors.append(f"{pname}: {e}")

    if errors and not validated:
        return {"success": False, "pickings": [], "error": "; ".join(errors), **_no_backorder}
    if errors:
        return {"success": True, "pickings": validated, "error": f"Partial: {'; '.join(errors)}", "backorder_picking_id": backorder_picking_id, "backorder_picking_name": backorder_picking_name}
    return {"success": True, "pickings": validated, "error": None, "backorder_picking_id": backorder_picking_id, "backorder_picking_name": backorder_picking_name}


async def _create_final_invoice(entry: dict, now: datetime) -> dict:
    """Create + post the final delivery invoice for an order in Odoo (after
    QA + RP sign-off) and stamp its id back onto the linked Sales ticket.
    Extracted from complete_entry (2026-08-27) so the same logic can be
    re-run standalone by the retry-invoice-creation endpoint below, for an
    order that reached "complete" with no invoice created — e.g. the
    create_invoices() TypeError incident (see this file's own history) left
    orders stuck at "complete" with no invoice and no way to register the
    balance payment. Never raises — returns invoice_warning on any failure,
    same as complete_entry's own original inline try/except did."""
    invoice_id: Optional[int] = None
    invoice_name: Optional[str] = None
    invoice_warning: Optional[str] = None
    invoice_sent = False
    try:
        odoo = get_odoo_client()
        sale_order_id = int(entry["order_id"])

        # All invoice lookups below key off sale.order.invoice_ids — Odoo's
        # own authoritative relation — never a string match against
        # invoice_origin (2026-08-27 fix, found live: that heuristic missed
        # a real draft final invoice that genuinely existed in Odoo, because
        # this specific order's invoice_origin didn't contain the plain
        # order id as a substring the way it was assumed to).
        _ticket_doc = await col("tickets").find_one(
            {"type": "sales", "order_id": sale_order_id, "exit_status": None},
            {"invoice_id": 1},
        )
        _deposit_invoice_id = _ticket_doc.get("invoice_id") if _ticket_doc else None

        try:
            _order_rows = odoo.read("sale.order", [sale_order_id], fields=["invoice_ids"])
            _invoice_ids_before = set(_order_rows[0].get("invoice_ids", [])) if _order_rows else set()
        except Exception:
            _invoice_ids_before = set()

        # Check for a usable final invoice already sitting in Odoo before
        # creating a new one — the create_invoices() XML-RPC marshalling
        # quirk below can leave a real draft invoice created server-side
        # even when the call raises and the overall attempt gets reported
        # as a failure; a second create_invoices() call against the same
        # order can then behave unpredictably (Odoo may see nothing further
        # to invoice) rather than cleanly erroring. Reusing an already-
        # existing, not-yet-linked invoice instead of blindly creating
        # another is the same "check before creating" principle
        # ticket_routes.py's existing-invoices/use-existing-invoice flow
        # already established for the deposit invoice — never a parallel-
        # ledger risk (Architecture Principle #1), just avoiding a genuine
        # duplicate-invoice risk. Excludes the deposit invoice specifically.
        _candidate_ids = [i for i in _invoice_ids_before if i != _deposit_invoice_id]
        _existing = []
        if _candidate_ids:
            try:
                _rows = odoo.read("account.move", _candidate_ids, fields=["id", "name", "state", "move_type"])
                _existing = sorted(
                    (r for r in _rows if r.get("move_type") == "out_invoice" and r.get("state") != "cancel"),
                    key=lambda r: r["id"], reverse=True,
                )
            except Exception:
                _existing = []

        if _existing:
            invoice_id = _existing[0]["id"]
            invoice_name = _existing[0]["name"]
            if _existing[0]["state"] == "draft":
                odoo.execute("account.move", "action_post", [invoice_id])
        else:
            wiz_id = odoo.create(
                "sale.advance.payment.inv",
                {"advance_payment_method": "delivered", "sale_order_ids": [(4, sale_order_id)]},
            )

            # Capture invoice_ids before the call so a genuine failure can be
            # told apart from create_invoices' known XML-RPC response-
            # serialization quirk (found and fixed once already in
            # ticket_routes.py::register_deposit for the deposit invoice, hit
            # again here for the final invoice) — the action dict Odoo
            # returns can contain None values the marshaller rejects even
            # though the invoice really was created. Assuming every
            # exception from create_invoices IS that harmless quirk is
            # itself the mistake register_deposit's own fix corrected — a
            # genuine failure (nothing to invoice, a validation error)
            # raises the exact same way and looks identical from here
            # without this check. (_invoice_ids_before already captured above.)
            _raised: Optional[Exception] = None
            try:
                # OdooClient.execute()'s (*args) -> single flat args list has
                # no way to send real XML-RPC kwargs/context —
                # create_invoices() on Odoo 19 takes no extra arguments at
                # all, deriving everything from the wizard's own already-set
                # sale_order_ids field (2026-08-27 fix).
                odoo.execute("sale.advance.payment.inv", "create_invoices", [wiz_id])
            except Exception as e:
                _raised = e
                logger.warning(
                    "final_invoice_create_invoices_response_error",
                    extra={"wiz_id": wiz_id, "order_id": sale_order_id, "error": str(e)},
                )

            # Resolve the new invoice by diffing invoice_ids, whether or not
            # create_invoices() itself raised — on success this is the only
            # lookup (replacing an earlier invoice_origin string search that
            # could miss a real invoice); on the marshalling quirk it's what
            # tells a harmless response-serialization failure apart from a
            # genuine one (nothing new means genuine).
            try:
                _after_rows = odoo.read("sale.order", [sale_order_id], fields=["invoice_ids"])
                _new_ids = (set(_after_rows[0].get("invoice_ids", [])) - _invoice_ids_before) if _after_rows else set()
            except Exception:
                _new_ids = set()

            if _raised and not _new_ids:
                # No new invoice actually appeared — a real failure, not the
                # serialization quirk. invoice_id is still None here, so the
                # ticket-stamping block below is already correctly a no-op.
                return {
                    "invoice_id": None, "invoice_name": None,
                    "invoice_warning": f"Invoice creation failed: {_raised}", "invoice_sent": False,
                }

            if _new_ids:
                try:
                    _new_rows = odoo.read("account.move", list(_new_ids), fields=["id", "name", "move_type", "state"])
                    _new_out = sorted(
                        (r for r in _new_rows if r.get("move_type") == "out_invoice"),
                        key=lambda r: r["id"], reverse=True,
                    )
                except Exception:
                    _new_out = []
                if _new_out:
                    invoice_id = _new_out[0]["id"]
                    invoice_name = _new_out[0]["name"]
                    if _new_out[0]["state"] == "draft":
                        odoo.execute("account.move", "action_post", [invoice_id])

        if invoice_id:
            # Auto-send the final invoice to the customer via Odoo's own mail
            # system (same mechanism as ticket_routes.py's manual "Send Invoice"
            # action) — non-fatal, mirrors send_deposit_due_proforma's degrade-to-warning
            # pattern so a missing/misconfigured Odoo mail template never blocks completion.
            # Runs whether this invoice was newly created above or an
            # existing not-yet-linked one was just found and reused.
            try:
                _templates = odoo.search_read(
                    "mail.template",
                    [("model", "=", "account.move")],
                    fields=["id", "name"],
                    limit=10,
                )
                _inv_template = next(
                    (t for t in _templates if "invoice" in t["name"].lower()),
                    _templates[0] if _templates else None,
                )
                if _inv_template:
                    odoo_call(
                        "mail.template", "send_mail",
                        [_inv_template["id"], invoice_id],
                        {"force_send": True},
                    )
                    invoice_sent = True
                else:
                    invoice_warning = "Invoice created but no invoice email template found in Odoo — configure one under Email > Templates"
            except Exception as e:
                invoice_warning = f"Invoice created but the email may not have been sent: {e}"
    except Exception as e:
        invoice_warning = f"Invoice creation failed: {e}"

    # Stamp invoice_id on the linked sales ticket so Finance can register payment
    if invoice_id:
        try:
            _st = await col("tickets").find_one(
                {"type": "sales", "order_id": int(entry["order_id"]), "exit_status": None}
            )
            if _st:
                _ticket_set: dict = {"invoice_id": invoice_id}
                if invoice_sent:
                    _ticket_set["invoice_sent_at"] = now
                await col("tickets").update_one({"_id": _st["_id"]}, {"$set": _ticket_set})
        except Exception:
            pass

    return {
        "invoice_id": invoice_id, "invoice_name": invoice_name,
        "invoice_warning": invoice_warning, "invoice_sent": invoice_sent,
    }


@router.put("/complete")
async def complete_entry(
    body: OrderIdBody,
    background_tasks: BackgroundTasks,
    current_user: dict = Depends(require_permission("tickets.orders")),
):
    """Orders Clerk's final close-out action — the explicit "I'm declaring
    this ready" step the business described, taken only after both QA and RP
    have independently signed off."""
    entry = await col("packing_board").find_one(_entry_query(body.order_id, body.picking_id))
    if not entry:
        raise HTTPException(status_code=404, detail="Order not on board")
    if entry["status"] != "ready":
        raise HTTPException(status_code=400, detail="Order must be ready before it can be marked complete")
    if not entry.get("qa_approved_at") or not entry.get("rp_approved_at"):
        raise HTTPException(status_code=400, detail="Both QA and RP approval are required before marking complete")

    now = datetime.now(timezone.utc)

    # ── Odoo delivery validation (non-blocking) ────────────────────────────────
    _no_bo: dict = {"backorder_picking_id": None, "backorder_picking_name": None}
    delivery_result: dict = {"success": False, "pickings": [], "error": "Not attempted", **_no_bo}

    # Build per-product qty overrides from packer-reported qty_packed values.
    packing_items = entry.get("items", [])
    qty_overrides: Optional[dict] = None
    _packed_map = {
        i["product_id"]: float(i["qty_packed"])
        for i in packing_items
        if i.get("product_id") and i.get("qty_packed") is not None
    }
    if _packed_map:
        qty_overrides = _packed_map

    try:
        odoo_order_id = int(entry["order_id"])
        delivery_result = _validate_odoo_delivery(odoo_order_id, qty_overrides)
    except (ValueError, TypeError) as e:
        delivery_result = {"success": False, "pickings": [], "error": f"Invalid order ID: {e}", **_no_bo}
    except Exception as e:
        delivery_result = {"success": False, "pickings": [], "error": str(e), **_no_bo}

    is_partial = bool(entry.get("has_pending_invoice"))

    # Detect packing-time shortfall: packer reported less than reserved for at least one product
    # and Odoo created a new backorder picking.
    _is_packing_shortfall = bool(
        qty_overrides
        and delivery_result.get("backorder_picking_id")
        and any(
            _packed_map.get(i.get("product_id"), i.get("qty_reserved", 0)) < float(i.get("qty_reserved", 0))
            for i in packing_items
            if i.get("product_id")
        )
    )

    backorder_entry_id: Optional[str] = None
    backorder_picking_name: Optional[str] = delivery_result.get("backorder_picking_name")

    # ── Create backorder packing entry when a partial delivery was validated ──
    if (is_partial or _is_packing_shortfall) and delivery_result.get("backorder_picking_id"):
        if _is_packing_shortfall:
            # Items that were short at packing time — qty = reserved minus what was packed
            _bo_items = [
                {
                    "name": i["name"],
                    "sku": i.get("sku", ""),
                    "product_id": i.get("product_id"),
                    "qty": round(float(i.get("qty_reserved", 0)) - _packed_map.get(i["product_id"], float(i.get("qty_reserved", 0))), 4),
                    "qty_ordered": round(float(i.get("qty_reserved", 0)) - _packed_map.get(i["product_id"], float(i.get("qty_reserved", 0))), 4),
                    "qty_reserved": 0,
                    "is_backordered": False,
                    "location": "",
                }
                for i in packing_items
                if i.get("product_id") and _packed_map.get(i["product_id"]) is not None
                and _packed_map[i["product_id"]] < float(i.get("qty_reserved", 0))
            ]
            # Ensure mark_collected will create an invoice for the delivered qty
            if not is_partial:
                await col("packing_board").update_one(
                    {"_id": entry["_id"]},
                    {"$set": {"has_pending_invoice": True}},
                )
        else:
            # Pre-packing backorder (existing logic) — items flagged is_backordered at confirmation
            _bo_items = [
                {
                    "name": i["name"],
                    "sku": i.get("sku", ""),
                    "product_id": i.get("product_id"),
                    "qty": round(i.get("qty_ordered", i.get("qty", 0)) - i.get("qty_reserved", 0), 4),
                    "qty_ordered": round(i.get("qty_ordered", i.get("qty", 0)) - i.get("qty_reserved", 0), 4),
                    "qty_reserved": 0,
                    "is_backordered": False,
                    "location": "",
                }
                for i in packing_items
                if i.get("is_backordered")
            ]
        _bo_entry = {
            "order_id": body.order_id,
            "odoo_picking_id": delivery_result["backorder_picking_id"],
            "picking_name": backorder_picking_name,
            "is_backorder": True,
            "parent_packing_id": str(entry["_id"]),
            "waiting_stock": True,
            "has_pending_invoice": True,
            "status": "waiting_stock",
            "items": _bo_items,
            "reseller_id": entry.get("reseller_id"),
            "customer_name": entry.get("customer_name"),
            "partner_id": entry.get("partner_id"),
            "assigned_packer": None,
            "qa_approved_at": None, "qa_approved_by": None,
            "rp_approved_at": None, "rp_approved_by": None,
            "collected_at": None, "collected_by": None,
            "delivery_validated": None,
            "created_at": now,
            "completed_at": None,
            "notes": f"Backorder for {entry.get('picking_name', body.order_id)}",
        }
        _bo_result = await col("packing_board").insert_one(_bo_entry)
        backorder_entry_id = str(_bo_result.inserted_id)

    # ── Create and post Odoo invoice for delivered qty ────────────────────────
    # Invoice is raised here (after QA + RP sign-off) for all orders including
    # samples. Sample invoices total R0.00 and Odoo marks them paid immediately.
    _inv_result = await _create_final_invoice(entry, now)
    invoice_id      = _inv_result["invoice_id"]
    invoice_name    = _inv_result["invoice_name"]
    invoice_warning = _inv_result["invoice_warning"]

    _complete_set: dict = {
        "status": "complete",
        "completed_at": now,
        "delivery_validated": delivery_result["success"],
    }
    if invoice_id:
        _complete_set["inv_num"] = invoice_name or ""
        _complete_set["invoice_id"] = invoice_id
        # Clear any stale error from a previous failed attempt (e.g. this
        # order already went through the retry-invoice-creation endpoint).
        _complete_set["invoice_creation_error"] = None
        _complete_set["invoice_creation_failed_at"] = None
    else:
        # Persisted (2026-08-27), not just returned as a one-off response
        # warning — the create_invoices() TypeError incident showed a
        # transient toast was the only trace of this failure, leaving an
        # order stuck at "complete" with no invoice and no visible reason
        # why. Surfaced on the ticket detail page with a Retry Invoice
        # Creation action, same non-blocking-failure convention as
        # packing_board_queue_error elsewhere in this codebase.
        _complete_set["invoice_creation_error"] = invoice_warning
        _complete_set["invoice_creation_failed_at"] = now

    # Targets the exact same document resolved at the top of this function via
    # entry["_id"] — previously hardcoded to {"order_id": ..., "is_backorder":
    # {"$ne": True}} regardless of which entry was actually being completed,
    # which meant completing a backorder's own delivery here would have
    # silently tried to re-complete the primary entry instead (2026-08-23 fix).
    updated = await col("packing_board").find_one_and_update(
        {"_id": entry["_id"]},
        {"$set": _complete_set},
        return_document=True,
    )
    if updated:
        updated.pop("_id", None)
        await push_update(updated)
    await audit_log("packing.complete", "packing_board", body.order_id, entity_label=body.order_id, user=current_user)
    await audit_log(
        "packing.delivery_validated",
        "packing_board",
        body.order_id,
        entity_label=body.order_id,
        user=current_user,
        detail=delivery_result,
    )
    await _sync_sales_ticket(
        body.order_id, "partially_fulfilled" if is_partial else "ready_for_collection",
        background_tasks=background_tasks,
    )

    _routing = await get_email_routing()

    if is_partial:
        # ── Partial: notify reseller of first delivery + backorder creation ──
        _reseller_email: Optional[str] = None
        _reseller_name: Optional[str] = None
        if entry.get("reseller_id"):
            _res = await col("resellers").find_one(
                {"id": entry["reseller_id"]}, {"email": 1, "name": 1, "_id": 0}
            )
            if _res:
                _reseller_email = _res.get("email")
                _reseller_name = _res.get("name")
        _shipped_items = [
            {"name": i["name"], "qty": i.get("qty_reserved", i.get("qty", 0))}
            for i in entry.get("items", [])
            if not i.get("is_backordered")
        ]
        _backorder_items = [
            {"name": i["name"], "qty": round(i.get("qty_ordered", i.get("qty", 0)) - i.get("qty_reserved", 0), 4)}
            for i in entry.get("items", [])
            if i.get("is_backordered")
        ]
        if _reseller_email:
            background_tasks.add_task(
                send_partial_delivery_ready,
                reseller_email=_reseller_email,
                order_ref=str(entry.get("order_id", body.order_id)),
                customer_name=entry.get("customer_name", ""),
                reseller_name=_reseller_name or "",
                shipped_lines=_shipped_items,
                backorder_lines=_backorder_items,
                cc=_routing.get("order_cc") or None,
            )
        if _routing.get("order_to"):
            background_tasks.add_task(
                send_backorder_created_internal,
                to=_routing["order_to"],
                order_ref=str(entry.get("order_id", body.order_id)),
                customer_name=entry.get("customer_name", ""),
                backorder_ref=backorder_picking_name or "",
                backorder_lines=_backorder_items,
            )
    else:
        # ── Full delivery: notify supervisors + reseller for collection ────────
        _sups = await col("users").find(
            {"role": "warehouse_supervisor", "email": {"$exists": True, "$ne": ""}},
            {"email": 1, "_id": 0},
        ).to_list(50)
        _sup_emails = [u["email"] for u in _sups if u.get("email")]
        for _extra in _routing.get("order_ready_extra_to", []):
            if _extra and _extra not in _sup_emails:
                _sup_emails.append(_extra)
        if _sup_emails:
            background_tasks.add_task(
                send_order_ready_for_collection,
                order_ref=str((updated or entry).get("order_id", body.order_id)),
                customer_name=(updated or entry).get("customer_name", ""),
                packer_name=(updated or entry).get("assigned_packer", "") or (updated or entry).get("packer_name", ""),
                supervisor_emails=_sup_emails,
            )
        if (updated or entry).get("reseller_id"):
            _full_res = await col("resellers").find_one(
                {"id": (updated or entry)["reseller_id"]}, {"email": 1, "name": 1, "_id": 0}
            )
            if _full_res and _full_res.get("email"):
                background_tasks.add_task(
                    send_order_ready_for_collection_reseller,
                    reseller_email=_full_res["email"],
                    order_ref=str((updated or entry).get("order_id", body.order_id)),
                    customer_name=(updated or entry).get("customer_name", ""),
                    reseller_name=_full_res.get("name", ""),
                    cc=_routing.get("order_cc") or None,
                )

    response: dict = {
        "success": True,
        "delivery_validated": delivery_result["success"],
        "invoice_id": invoice_id,
        "invoice_name": invoice_name,
    }
    if is_partial:
        response["is_partial"] = True
        response["backorder_entry_id"] = backorder_entry_id
    warnings: list = []
    if not delivery_result["success"]:
        warnings.append(
            delivery_result.get("error")
            or "Delivery could not be validated in Odoo. Stock levels may not reflect this completion."
        )
    if invoice_warning:
        warnings.append(invoice_warning)
    if warnings:
        response["warning"] = " | ".join(warnings)
    return response


@router.put("/retry-invoice-creation")
async def retry_invoice_creation(
    body: OrderIdBody,
    current_user: dict = Depends(require_any_permission("tickets.orders", "tickets.finance_confirm")),
):
    """Recovery action (2026-08-27) for an order that reached packing status
    "complete" (or later) with no final invoice ever created — most
    commonly a transient Odoo-side failure at Mark Complete time (see
    _create_final_invoice's own history for the create_invoices() TypeError
    incident that prompted this). Re-runs the exact same invoice-creation
    logic complete_entry itself uses. Refuses to run at all once an invoice
    already exists on this entry, so this can never create a duplicate —
    unlike complete_entry, a failure here IS the whole point of the call,
    so it raises rather than degrading to a response `warning`. Gated to
    `tickets.orders` OR `tickets.finance_confirm` (2026-08-27, widened from
    `tickets.orders` alone once this action was also surfaced on Order
    Passport) — Finance is the role most likely to actually discover this
    failure, via a blank Register Balance Payment amount."""
    entry = await col("packing_board").find_one(_entry_query(body.order_id, body.picking_id))
    if not entry:
        raise HTTPException(status_code=404, detail="Order not on board")
    if entry.get("status") not in ("complete", "collected"):
        raise HTTPException(status_code=400, detail="Order must be complete before an invoice can be created")
    if entry.get("invoice_id"):
        raise HTTPException(
            status_code=400,
            detail=f"An invoice already exists for this order ({entry.get('inv_num') or entry['invoice_id']}) — nothing to retry",
        )

    now = datetime.now(timezone.utc)
    result = await _create_final_invoice(entry, now)
    invoice_id = result["invoice_id"]

    update_set: dict = {}
    if invoice_id:
        update_set["inv_num"] = result["invoice_name"] or ""
        update_set["invoice_id"] = invoice_id
        update_set["invoice_creation_error"] = None
        update_set["invoice_creation_failed_at"] = None
    else:
        update_set["invoice_creation_error"] = result["invoice_warning"]
        update_set["invoice_creation_failed_at"] = now

    updated = await col("packing_board").find_one_and_update(
        {"_id": entry["_id"]}, {"$set": update_set}, return_document=True,
    )
    if updated:
        updated.pop("_id", None)
        await push_update(updated)
    await audit_log(
        "packing.retry_invoice_creation", "packing_board", body.order_id,
        entity_label=body.order_id, user=current_user,
        detail={"success": bool(invoice_id), "invoice_id": invoice_id},
    )

    if not invoice_id:
        raise HTTPException(status_code=502, detail=result["invoice_warning"] or "Invoice creation failed")
    return {"success": True, "invoice_id": invoice_id, "invoice_name": result["invoice_name"], "warning": result["invoice_warning"]}


@router.put("/mark-collected")
async def mark_collected(
    body: MarkCollectedBody,
    background_tasks: BackgroundTasks,
    current_user: dict = Depends(require_permission("tickets.orders")),
):
    """Orders Clerk confirms customer has collected a delivery (primary or backorder).
    Creates the Odoo invoice for the delivered qty, then checks whether all pickings
    for this order are now collected — if so, advances the ticket to complete."""
    entry = await col("packing_board").find_one(_entry_query(body.order_id, body.picking_id))
    if not entry:
        raise HTTPException(status_code=404, detail="Packing entry not found")
    if entry.get("collected_at"):
        raise HTTPException(status_code=400, detail="This delivery has already been marked as collected")
    if entry.get("status") != "complete":
        raise HTTPException(status_code=400, detail="Delivery must be complete before it can be marked as collected")

    now = datetime.now(timezone.utc)
    actor_name = current_user.get("name") or current_user.get("username", "")

    # ── Mark entry collected ──────────────────────────────────────────────────
    # Invoice was already created at mark_complete (after QA + RP sign-off).
    update_fields: dict = {"collected_at": now, "collected_by": actor_name, "status": "collected"}

    await col("packing_board").update_one({"_id": entry["_id"]}, {"$set": update_fields})
    await audit_log(
        "packing.collected",
        "packing_board",
        body.order_id,
        entity_label=body.order_id,
        user=current_user,
        detail={"picking_id": entry.get("odoo_picking_id")},
    )

    # ── Check if all pickings for this order are now collected ────────────────
    all_entries = await col("packing_board").find({"order_id": body.order_id}).to_list(50)
    # Exclude waiting_stock backorders — they haven't started yet and don't count
    relevant = [e for e in all_entries if not e.get("waiting_stock")]
    all_collected = bool(relevant) and all(e.get("collected_at") is not None for e in relevant)
    if all_collected:
        await _sync_sales_ticket(body.order_id, "complete")

    await broadcast_monitor_refresh()
    return {
        "success": True,
        "collected_at": now.isoformat(),
        "order_complete": all_collected,
    }


async def _refresh_entry_item_backorder_flags(odoo, entry: dict) -> Optional[list]:
    """Re-read live stock.move reservation for one packing_board entry's
    delivery and recompute each item's is_backordered/qty_reserved from
    scratch (2026-08-27). The flag _queue_packing_board originally computes
    is a one-time snapshot taken at deposit-registration time — if Odoo
    hadn't finished reserving stock against the delivery at that exact
    moment, every line gets flagged, and nothing ever re-checks it
    afterward even once reservation catches up. Found live: every item on
    an order showed the yellow "Backorder" label while the Backorders page
    (which only tracks genuine Odoo-created backorder pickings, a
    completely different signal) correctly showed none.

    Never raises — returns the corrected items list only when something
    actually changed, or None on any failure/no-op, so callers can treat
    this as pure best-effort and skip the write entirely when there's
    nothing to do."""
    picking_id = entry.get("odoo_picking_id")
    if not picking_id:
        return None
    try:
        pick_rows = odoo.read("stock.picking", [picking_id], fields=["move_ids"])
        if not pick_rows or not pick_rows[0].get("move_ids"):
            return None
        # 'quantity' not 'reserved_availability' — see the field-drift note
        # on this exact read elsewhere in this file (_validate_odoo_delivery)
        # and in order_routes.py's _queue_packing_board, which this mirrors.
        moves = odoo.read(
            "stock.move", pick_rows[0]["move_ids"],
            fields=["product_id", "product_uom_qty", "quantity"],
        )
    except Exception:
        return None

    by_product = {m["product_id"][0]: m for m in moves if m.get("product_id")}
    items = entry.get("items", [])
    changed = False
    for item in items:
        move = by_product.get(item.get("product_id"))
        if not move:
            continue
        qty_ordered  = float(move.get("product_uom_qty", 0))
        qty_reserved = float(move.get("quantity", 0))
        new_flag = qty_reserved < qty_ordered
        if item.get("qty_reserved") != qty_reserved or item.get("is_backordered") != new_flag:
            item["qty_reserved"] = qty_reserved
            item["is_backordered"] = new_flag
            changed = True
    return items if changed else None


async def _refresh_active_item_backorder_flags() -> dict:
    """Bulk companion to _check_and_notify_backorder_stock below (2026-08-27)
    — that function re-checks whole BACKORDER CHILD entries (is_backorder
    True, waiting_stock True); this one re-checks the per-line
    is_backordered flags on regular, still-active entries (queued/packing)
    that were snapshotted stale at deposit-registration time. Deliberately
    reuses the exact same event-driven trigger points (the manual "Check
    backorder stock" button, and Manufacturing Order record-production/
    complete) rather than adding a new poll or a live check on every page
    read — production/stock events advancing is exactly when a recheck is
    worth paying for; a live check on every Order Ticket view would not be,
    at real production volume."""
    entries = await col("packing_board").find(
        {"status": {"$in": ["queued", "packing"]}, "items.is_backordered": True}
    ).to_list(200)
    if not entries:
        return {"checked": 0, "updated": 0}

    odoo = get_odoo_client()
    updated = 0
    for entry in entries:
        new_items = await _refresh_entry_item_backorder_flags(odoo, entry)
        if new_items is None:
            continue
        await col("packing_board").update_one({"_id": entry["_id"]}, {"$set": {"items": new_items}})
        updated += 1
        entry["items"] = new_items
        entry.pop("_id", None)
        await push_update(entry)
    return {"checked": len(entries), "updated": updated}


async def _check_and_notify_backorder_stock(background_tasks: BackgroundTasks, actor: Optional[dict] = None) -> dict:
    """Check all waiting_stock backorder entries against Odoo. When a backorder picking
    has moved to 'assigned' (stock reserved), clears the waiting flag, moves the
    entry back into the active pipeline, and fires notifications to the
    reseller, internal staff, and the assigned sales rep.

    Shared by the manual "Check backorder stock" button (check_backorder_stock
    below, actor=current_user so the audit trail attributes the clerk who
    triggered it) and, since 2026-08-22, automatically called from
    order_routes.py's Manufacturing Order Record Production / Mark Complete
    endpoints (actor=whoever updated the MO) — production finishing or
    advancing is exactly the kind of event that should prompt a reservation
    recheck, not just wait for someone to click the manual button.
    Deliberately not scoped to the specific product an MO just produced: this
    sweep is already cheap and bounded (≤200 waiting_stock entries), so
    reusing the same blanket check avoids the real complexity of correlating
    an MO's product back to which backorder line(s) it might unblock.

    **2026-08-23 fix:** this used to only clear the `waiting_stock` boolean —
    the notifications fired correctly, but the entry's own `status` field
    stayed `"waiting_stock"` forever, so it never actually reappeared in the
    Queued column or anywhere staff would naturally look for active work.
    The only way to progress it was a generic admin-only status override.
    Now explicitly re-queues it (`status: "queued"`, fresh `queued_at` so its
    age on the monitor starts counting from when it actually became
    actionable, not from whenever the original shortfall was discovered) —
    the same entry point a brand-new packing_board entry starts at
    (`POST /queue`), so every existing queued→packing→ready→QA→RP→complete
    action already works on it with no special-casing needed."""
    entries = await col("packing_board").find(
        {"is_backorder": True, "waiting_stock": True}
    ).to_list(200)

    if not entries:
        return {"checked": 0, "ready": 0, "updated": []}

    odoo = get_odoo_client()
    _routing = await get_email_routing()
    updated_refs: list = []

    for bo_entry in entries:
        picking_id = bo_entry.get("odoo_picking_id")
        if not picking_id:
            continue
        try:
            pick_rows = odoo.read("stock.picking", [picking_id], fields=["id", "state"])
        except Exception:
            continue
        if not pick_rows or pick_rows[0]["state"] != "assigned":
            continue

        now = datetime.now(timezone.utc)
        await col("packing_board").update_one(
            {"_id": bo_entry["_id"]},
            {"$set": {"waiting_stock": False, "status": "queued", "queued_at": now}},
        )

        order_ref = str(bo_entry.get("order_id", ""))
        customer_name = bo_entry.get("customer_name", "")
        await audit_log("packing.backorder_stock_ready", "packing_board", order_ref,
                         entity_label=customer_name, user=actor,
                         detail={"picking_id": picking_id, "picking_name": bo_entry.get("picking_name")})
        await broadcast_monitor_refresh()
        reseller_email: Optional[str] = None
        reseller_name: Optional[str] = None
        if bo_entry.get("reseller_id"):
            _res = await col("resellers").find_one(
                {"id": bo_entry["reseller_id"]}, {"email": 1, "name": 1, "_id": 0}
            )
            if _res:
                reseller_email = _res.get("email")
                reseller_name = _res.get("name")

        _bo_items = [
            {"name": i["name"], "qty": i.get("qty_ordered", i.get("qty", 0))}
            for i in bo_entry.get("items", [])
        ]

        background_tasks.add_task(
            send_backorder_stock_ready,
            reseller_email=reseller_email,
            internal_to=_routing.get("order_to"),
            order_ref=order_ref,
            customer_name=customer_name,
            reseller_name=reseller_name or "",
            backorder_lines=_bo_items,
        )

        # Push notification to whoever owns the Sales ticket (2026-08-22) —
        # reuses notify_ticket_handoff's existing "a ticket I own changed
        # stage" semantics rather than inventing a new preference key nobody
        # can configure yet (no notification-preferences UI exists in the
        # frontend today). order_id on a backorder entry is the same
        # str(sale_order_id) the primary entry it split from carries.
        try:
            _bo_ticket = await col("tickets").find_one(
                {"type": "sales", "order_id": int(bo_entry["order_id"]), "exit_status": None},
                {"assigned_to": 1, "_id": 0},
            )
            if _bo_ticket and _bo_ticket.get("assigned_to"):
                background_tasks.add_task(
                    notify_ticket_handoff,
                    customer_name=customer_name,
                    outcome="stock now available for packing",
                    assigned_user_id=_bo_ticket["assigned_to"],
                )
        except (ValueError, TypeError):
            pass  # order_id wasn't a plain int string — non-fatal, email notice above already fired

        updated_refs.append(order_ref)

    return {"checked": len(entries), "ready": len(updated_refs), "updated": updated_refs}


@router.get("/backorders/check-stock")
async def check_backorder_stock(
    background_tasks: BackgroundTasks,
    current_user: dict = Depends(require_permission("tickets.orders")),
):
    result = await _check_and_notify_backorder_stock(background_tasks, actor=current_user)
    item_result = await _refresh_active_item_backorder_flags()
    result["items_updated"] = item_result["updated"]
    return result


@router.put("/incomplete")
async def mark_incomplete(
    body: IncompleteBody,
    current_user: dict = Depends(require_permission("tickets.orders")),
):
    """Orders Clerk flags a partial/blocked order — always requires a reason
    so Sales has something concrete to relay to the client."""
    entry = await col("packing_board").find_one(_entry_query(body.order_id, body.picking_id))
    if not entry:
        raise HTTPException(status_code=404, detail="Order not on board")
    if entry["status"] in ("collected", "cleared", "cancelled", "complete", "incomplete"):
        raise HTTPException(status_code=400, detail=f"Order is already '{entry['status']}'")

    now = datetime.now(timezone.utc)
    updated = await col("packing_board").find_one_and_update(
        {"_id": entry["_id"]},
        {"$set": {"status": "incomplete", "incomplete_at": now, "incomplete_reason": body.reason}},
        return_document=True,
    )
    updated.pop("_id", None)
    await push_update(updated)
    await audit_log("packing.incomplete", "packing_board", body.order_id, entity_label=body.order_id,
                    user=current_user, detail={"reason": body.reason})
    await _sync_sales_ticket(body.order_id, "incomplete", body.reason)
    return {"success": True}


@router.put("/cancel")
async def cancel_entry(
    body: CancelBody,
    current_user: dict = Depends(require_permission("tickets.orders")),
):
    """Orders Clerk cancels an order before fulfilment completes."""
    entry = await col("packing_board").find_one(_entry_query(body.order_id, body.picking_id))
    if not entry:
        raise HTTPException(status_code=404, detail="Order not on board")
    if entry["status"] in ("collected", "cleared", "cancelled", "complete", "incomplete"):
        raise HTTPException(status_code=400, detail=f"Order is already '{entry['status']}'")

    now = datetime.now(timezone.utc)
    updated = await col("packing_board").find_one_and_update(
        {"_id": entry["_id"]},
        {"$set": {"status": "cancelled", "cancelled_at": now, "incomplete_reason": body.reason}},
        return_document=True,
    )
    updated.pop("_id", None)
    await push_update(updated)
    await audit_log("packing.cancelled", "packing_board", body.order_id, entity_label=body.order_id,
                    user=current_user, detail={"reason": body.reason})
    await _sync_sales_ticket(body.order_id, "cancelled", body.reason)
    return {"success": True}


@router.get("/entry/{order_id}")
async def get_entry(order_id: str, picking_id: Optional[int] = None, current_user: dict = Depends(get_current_user)):
    if current_user.get("role") == "reseller":
        res_doc = await col("resellers").find_one({"user_id": current_user["id"]}, {"id": 1, "_id": 0})
        rid = res_doc["id"] if res_doc else None
        entry = await col("packing_board").find_one({**_entry_query(order_id, picking_id), "reseller_id": rid}, NO_ID)
        if not entry:
            raise HTTPException(status_code=403, detail="Access denied")
        return _with_age(entry)
    # Staff: enforce board access
    if not (
        current_user.get("is_super_admin")
        or current_user.get("role") in ADMIN_ROLES
        or current_user.get("role") in _BOARD_VIEW_ROLES
    ):
        raise HTTPException(status_code=403, detail="Access denied")
    entry = await col("packing_board").find_one(_entry_query(order_id, picking_id), NO_ID)
    if not entry:
        raise HTTPException(status_code=404, detail="Entry not found")
    return _with_age(entry)


@router.post("/adopt")
async def adopt_order(
    body: AdoptBody,
    current_user: dict = Depends(require_permission("tickets.manage")),
):
    """Adopt an existing confirmed Odoo order into the packing pipeline.
    Used by admins to bring pre-pipeline orders into the Orders Ticket flow
    without going through the full Sales Ticket quote/deposit process."""
    order_id_str = str(body.order_id)

    existing = await col("packing_board").find_one({"order_id": order_id_str})
    if existing:
        raise HTTPException(
            status_code=409,
            detail=f"Order is already in the pipeline (status: {existing['status']})",
        )

    odoo = get_odoo_client()
    try:
        rows = odoo.read(
            "sale.order", [body.order_id],
            fields=["name", "partner_id", "state", "warehouse_id", "picking_ids", "note", "invoice_ids"],
        )
    except Exception as e:
        raise HTTPException(status_code=502, detail=f"Odoo error: {str(e)}")

    if not rows:
        raise HTTPException(status_code=404, detail="Order not found in Odoo")
    order_data = rows[0]

    _STATE_LABELS = {
        "draft": "a draft quotation", "sent": "a sent quotation",
        "done": "already completed", "cancel": "cancelled",
    }
    if order_data["state"] != "sale":
        label = _STATE_LABELS.get(order_data["state"], order_data["state"])
        raise HTTPException(
            status_code=400,
            detail=f"Cannot adopt: order is {label}. Only confirmed Sales Orders can be queued.",
        )

    # Invoice name (best-effort — may not exist for orders confirmed outside portal)
    inv_name = ""
    if order_data.get("invoice_ids"):
        try:
            inv_rows = odoo.read("account.move", [order_data["invoice_ids"][0]], fields=["name"])
            inv_name = inv_rows[0]["name"] if inv_rows else ""
        except Exception:
            pass

    # Items from the delivery order (picking), same as the confirm flow
    items: list = []
    dn_num = ""
    if order_data.get("picking_ids"):
        try:
            picking_id = order_data["picking_ids"][0]
            pickings = odoo.read("stock.picking", [picking_id], fields=["name", "move_ids"])
            picking = pickings[0] if pickings else None
            if picking:
                dn_num = picking["name"]
                if picking.get("move_ids"):
                    moves = odoo.read(
                        "stock.move", picking["move_ids"],
                        fields=["product_id", "product_uom_qty"],
                    )
                    for m in moves:
                        pname = m["product_id"][1] if m.get("product_id") else "Unknown"
                        prod = (
                            odoo.read("product.product", [m["product_id"][0]], fields=["default_code"])
                            if m.get("product_id") else []
                        )
                        sku = prod[0].get("default_code") or str(m["product_id"][0]) if prod else ""
                        items.append({"name": pname, "sku": sku, "product_id": m["product_id"][0] if m.get("product_id") else None, "qty": m["product_uom_qty"], "location": ""})
        except Exception as e:
            print(f"⚠️  adopt: could not read picking for order {body.order_id}: {e}")

    partner_name = order_data["partner_id"][1] if order_data.get("partner_id") else ""
    comm_data = await col("order_commissions").find_one({"odoo_order_id": order_id_str}, NO_ID)

    now = datetime.now(timezone.utc)
    doc = {
        "order_id":      order_id_str,
        "warehouse_id":  order_data["warehouse_id"][0] if order_data.get("warehouse_id") else None,
        "warehouse_name": order_data["warehouse_id"][1] if order_data.get("warehouse_id") else None,
        "customer_name": partner_name,
        "customer_city": "",
        "items":         items,
        "total_units":   int(sum(i["qty"] for i in items)),
        "inv_num":       inv_name,
        "dn_num":        dn_num,
        "ps_num":        order_data["name"],
        "notes":         order_data.get("note") or "",
        "is_reseller":   bool(comm_data),
        "reseller_name": comm_data.get("reseller_name") if comm_data else None,
        "packer_name":   None,
        "status":        "queued",
        "queued_at":     now,
        "packed_at":     None,
        "ready_at":      None,
        "collected_at":  None,
        "cancelled_at":  None,
        "incomplete_at": None,
        "completed_at":  None,
        "incomplete_reason": None,
        "qa_approved_by": None, "qa_approved_at": None,
        "rp_approved_by": None, "rp_approved_at": None,
        "item_ticks":    {i["sku"]: False for i in items},
    }
    await col("packing_board").replace_one({"order_id": order_id_str}, doc, upsert=True)
    await manager.broadcast({"type": "entry_update", "data": {**doc, "queued_at": now.isoformat()}})
    await audit_log(
        "packing.adopted", "packing_board", order_id_str,
        entity_label=order_data["name"],
        user=current_user,
        detail={"customer": partner_name, "units": doc["total_units"]},
    )
    return {"success": True, "order_id": order_id_str}


@router.put("/mark-packing")
async def mark_packing(
    body: OrderIdBody,
    background_tasks: BackgroundTasks,
    current_user: dict = Depends(require_permission("tickets.orders")),
):
    """Orders Clerk: advance a queued order to packing."""
    entry = await col("packing_board").find_one(_entry_query(body.order_id, body.picking_id))
    if not entry:
        raise HTTPException(status_code=404, detail="Order not on board")
    if entry["status"] != "queued":
        raise HTTPException(status_code=400, detail="Order must be queued before marking as packing")

    # Refresh stale is_backordered flags right as packing starts (2026-08-27)
    # — the single highest-value moment to correct them, since the packer is
    # about to act on this data. See _refresh_entry_item_backorder_flags's
    # own docstring for why this snapshot can go stale in the first place.
    try:
        new_items = await _refresh_entry_item_backorder_flags(get_odoo_client(), entry)
        if new_items is not None:
            await col("packing_board").update_one({"_id": entry["_id"]}, {"$set": {"items": new_items}})
    except Exception as e:
        logger.warning("mark_packing_item_backorder_refresh_failed", extra={"order_id": body.order_id, "error": str(e)})

    updated = await _do_update_status(body.order_id, "packing", current_user, body.picking_id)
    if not updated:
        raise HTTPException(status_code=404, detail="Order not on board")
    if entry.get("reseller_id"):
        _res = await col("resellers").find_one(
            {"id": entry["reseller_id"]}, {"email": 1, "name": 1, "_id": 0}
        )
        if _res and _res.get("email"):
            _routing = await get_email_routing()
            background_tasks.add_task(
                send_order_packing_started,
                reseller_email=_res["email"],
                order_ref=entry.get("order_id", body.order_id),
                customer_name=entry.get("customer_name", ""),
                reseller_name=_res.get("name", ""),
                cc=_routing.get("order_cc") or None,
            )
    return {"success": True}


@router.put("/mark-ready")
async def mark_ready(
    body: OrderIdBody,
    background_tasks: BackgroundTasks,
    current_user: dict = Depends(require_permission("tickets.orders")),
):
    """Orders Clerk: advance a packing order to ready for inspection."""
    entry = await col("packing_board").find_one(_entry_query(body.order_id, body.picking_id))
    if not entry:
        raise HTTPException(status_code=404, detail="Order not on board")
    if entry["status"] != "packing":
        raise HTTPException(status_code=400, detail="Order must be packing before marking as ready")
    updated = await _do_update_status(body.order_id, "ready", current_user, body.picking_id)
    if not updated:
        raise HTTPException(status_code=404, detail="Order not on board")

    _routing = await get_email_routing()
    background_tasks.add_task(
        send_qa_approval_needed,
        _routing["qa_approval_to"], body.order_id, entry.get("customer_name", ""), body.order_id,
    )
    background_tasks.add_task(
        send_rp_approval_needed,
        _routing["rp_approval_to"], body.order_id, entry.get("customer_name", ""), body.order_id,
    )
    return {"success": True}


@router.put("/override-status")
async def override_status(
    body: UpdateStatus,
    background_tasks: BackgroundTasks,
    current_user: dict = Depends(require_permission("tickets.manage")),
):
    """Admin override — set any status directly (tickets.manage permission required).
    When overriding to a terminal status, also syncs the linked sales ticket so
    legacy or manually-corrected entries stay consistent with the sales pipeline."""
    entry = await col("packing_board").find_one(_entry_query(body.order_id, body.picking_id))
    if not entry:
        raise HTTPException(status_code=404, detail="Order not on board")
    updated = await col("packing_board").find_one_and_update(
        {"_id": entry["_id"]},
        {"$set": {"status": body.status}},
        return_document=True,
    )
    if not updated:
        raise HTTPException(status_code=404, detail="Order not on board")
    updated.pop("_id", None)
    await push_update(updated)
    await audit_log("packing.override_status", "packing_board", body.order_id,
                    entity_label=body.order_id, user=current_user,
                    detail={"from": entry["status"], "to": body.status})

    # Sync the linked sales ticket when overriding to a terminal packing status.
    _ticket_outcome = {
        "complete":   "ready_for_collection",
        "incomplete": "incomplete",
        "cancelled":  "cancelled",
        "collected":  "complete",
    }.get(body.status)
    if _ticket_outcome:
        await _sync_sales_ticket(body.order_id, _ticket_outcome, background_tasks=background_tasks)

    return {"success": True}


class AssignLotBody(BaseModel):
    order_id: str
    product_id: int   # Odoo product.product ID
    lot_id: int       # Odoo stock.lot ID
    picking_id: Optional[int] = None  # Odoo picking ID; if omitted, targets the primary (non-backorder) entry


@router.put("/assign-lot")
async def assign_lot(
    body: AssignLotBody,
    current_user: dict = Depends(require_permission("tickets.orders")),
):
    """Assign a specific lot/batch to a product line on the active delivery order.

    Writes lot_id to the matching stock.move.line in Odoo so the lot appears
    on the validated delivery note. Must be called before mark-complete.
    """
    entry = await col("packing_board").find_one(_entry_query(body.order_id, body.picking_id))
    if not entry:
        raise HTTPException(status_code=404, detail="Order not on packing board")
    if entry.get("status") not in ("queued", "packing", "ready"):
        raise HTTPException(status_code=400, detail="Lot assignment is only allowed before the order is completed")

    odoo = get_odoo_client()
    try:
        # Scoped to the specific picking when known (body.picking_id, or the
        # resolved entry's own odoo_picking_id — a backorder and its primary
        # are separate Odoo pickings, so searching "all active pickings for
        # this sale order" could otherwise match move lines belonging to the
        # wrong delivery entirely, 2026-08-23 fix).
        _picking_filter_id = body.picking_id or entry.get("odoo_picking_id")
        _picking_domain = [("id", "=", _picking_filter_id)] if _picking_filter_id else [("sale_id", "=", int(body.order_id))]
        pickings = odoo.search_read(
            "stock.picking",
            _picking_domain + [("state", "not in", ["done", "cancel"])],
            fields=["id", "move_line_ids"],
        )
    except Exception as e:
        raise HTTPException(status_code=502, detail=f"Odoo error: {str(e)}")

    if not pickings:
        raise HTTPException(status_code=404, detail="No active delivery order found in Odoo for this sale order")

    all_ml_ids = [ml for p in pickings for ml in p.get("move_line_ids", [])]
    if not all_ml_ids:
        raise HTTPException(status_code=404, detail="No move lines found on the delivery order")

    try:
        move_lines = odoo.read(
            "stock.move.line", all_ml_ids,
            fields=["product_id", "lot_id"],
        )
    except Exception as e:
        raise HTTPException(status_code=502, detail=f"Odoo error reading move lines: {str(e)}")

    # Find the move line(s) for this product
    target_ml_ids = [
        ml["id"] for ml in move_lines
        if (ml["product_id"][0] if isinstance(ml["product_id"], list) else ml["product_id"]) == body.product_id
    ]
    if not target_ml_ids:
        raise HTTPException(status_code=404, detail=f"Product {body.product_id} not found on the delivery order")

    try:
        odoo.write("stock.move.line", target_ml_ids, {"lot_id": body.lot_id})
    except Exception as e:
        raise HTTPException(status_code=502, detail=f"Failed to assign lot in Odoo: {str(e)}")

    # Fetch lot name for audit log
    try:
        lot_rows = odoo.read("stock.lot", [body.lot_id], fields=["name"])
        lot_name = lot_rows[0]["name"] if lot_rows else str(body.lot_id)
    except Exception:
        lot_name = str(body.lot_id)

    await audit_log(
        "packing.assign_lot", "packing_board", body.order_id,
        entity_label=body.order_id,
        user=current_user,
        detail={"product_id": body.product_id, "lot_id": body.lot_id, "lot_name": lot_name},
    )
    return {"success": True, "lot_name": lot_name}


@router.get("/board")
async def get_board(warehouse_id: Optional[int] = None, _: dict = Depends(require_board_access)):
    return {"entries": await get_board_state(warehouse_id)}


@router.get("/packers")
async def list_packers(_: dict = Depends(get_current_user)):
    """Return active packer user accounts."""
    packers = await col("users").find(
        {"role": "packer", "active": True},
        {"_id": 0, "username": 1, "display_name": 1, "name": 1},
    ).to_list(length=100)
    return {"packers": packers}


# ── WebSocket endpoints ───────────────────────────────────────────────────────

async def _ws_reject(ws: WebSocket, reason: str):
    """Send a JSON auth_error before closing — Railway's proxy strips custom close codes."""
    await ws.send_text(_dumps({"type": "auth_error", "reason": reason}))
    await ws.close(code=4001)


@router.websocket("/ws/board")
async def websocket_board(ws: WebSocket):
    """
    85" display screen — read-only.
    Authenticated via a per-warehouse display token (Mongo-stored) passed as ?token=.
    """
    await ws.accept()
    warehouse_id = await _verify_display_token(ws)
    if warehouse_id is None:
        await _ws_reject(ws, "invalid_token")
        return
    try:
        await manager.connect_screen(ws, warehouse_id)
        while True:
            await asyncio.sleep(15)
            await ws.send_text(_dumps({"type": "ping"}))
    except WebSocketDisconnect:
        manager.disconnect(ws)
    except Exception as e:
        print(f"⚠️  Board WS error: {e}")
        manager.disconnect(ws)


@router.websocket("/ws/supervisor")
async def websocket_supervisor(ws: WebSocket):
    """
    Supervisor phone/tablet — read + write.
    Requires a valid warehouse_supervisor JWT passed as ?token=.
    """
    await ws.accept()
    user = await _verify_ws_user(ws, {"warehouse_supervisor"})
    if not user:
        await _ws_reject(ws, "unauthorized")
        return
    await manager.connect_supervisor(ws, user.get("warehouse_id"))
    try:
        while True:
            raw = await ws.receive_text()
            try:
                msg = json.loads(raw)
                action = msg.get("action")
                if action == "assign_packer":
                    await _do_assign_packer(msg["order_id"], msg["packer_name"], user)
                elif action == "tick_item":
                    await _do_tick_item(msg["order_id"], msg["sku"], msg.get("ticked", True), user)
                elif action == "update_status":
                    await _do_update_status(msg["order_id"], msg["status"], user)
            except Exception as e:
                print(f"⚠️  Supervisor WS error: {e}")
    except WebSocketDisconnect:
        manager.disconnect(ws)


@router.websocket("/ws/packer")
async def websocket_packer(ws: WebSocket):
    """
    Packer handheld — read + tick only.
    Requires a valid packer JWT passed as ?token=.
    """
    await ws.accept()
    user = await _verify_ws_user(ws, {"packer"})
    if not user:
        await _ws_reject(ws, "unauthorized")
        return
    await manager.connect_packer(ws, user.get("warehouse_id"))
    try:
        while True:
            raw = await ws.receive_text()
            try:
                msg = json.loads(raw)
                if msg.get("action") == "tick_item":
                    await _do_tick_item(msg["order_id"], msg["sku"], msg.get("ticked", True), user)
            except Exception as e:
                print(f"⚠️  Packer WS error: {e}")
    except WebSocketDisconnect:
        manager.disconnect(ws)


# ── Super-admin: test data purge ──────────────────────────────────────────────

class PurgeOrderBody(BaseModel):
    order_id: str


@router.delete("/purge")
async def purge_packing_entry(
    body: PurgeOrderBody,
    current_user: dict = Depends(require_super_admin),
):
    """
    Permanently delete all packing board entries for an order_id and every
    audit log trace.  Cascades to the linked sales ticket (and its audit logs).
    Irreversible — super_admin only.
    """
    order_id = body.order_id

    # Linked sales ticket (if any) — capture before deletion
    linked_ticket = await col("tickets").find_one({"orders_ticket_ref": order_id})

    deleted: dict = {"packing_board": 0, "ticket": 0, "audit_logs": 0}

    # All packing board entries for this order (includes backorders)
    pb_result = await col("packing_board").delete_many({"order_id": order_id})
    deleted["packing_board"] = pb_result.deleted_count

    # Audit logs for the packing board entries
    al_pb = await col("audit_log").delete_many(
        {"entity_type": "packing_board", "entity_id": order_id}
    )
    deleted["audit_logs"] += al_pb.deleted_count

    # Cascade: linked sales ticket and its audit logs
    if linked_ticket:
        ticket_id = str(linked_ticket["_id"])
        al_t = await col("audit_log").delete_many(
            {"entity_type": {"$in": ["ticket", "tickets"]}, "entity_id": ticket_id}
        )
        deleted["audit_logs"] += al_t.deleted_count
        await col("tickets").delete_one({"_id": linked_ticket["_id"]})
        deleted["ticket"] = 1

    # Record the purge itself
    await audit_log(
        "packing.purge", "admin_purge", order_id,
        entity_label=order_id,
        user=current_user,
        detail={"linked_ticket": str(linked_ticket["_id"]) if linked_ticket else None, "deleted": deleted},
    )

    return {
        "success": True,
        "purged": deleted,
        "order_id": order_id,
        "customer_name": linked_ticket.get("customer_name", "") if linked_ticket else "",
    }
