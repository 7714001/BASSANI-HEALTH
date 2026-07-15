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
from datetime import datetime, timezone
from fastapi import APIRouter, BackgroundTasks, WebSocket, WebSocketDisconnect, Depends, HTTPException
from pydantic import BaseModel
from typing import Optional, List
from auth import require_admin, get_current_user, get_user_by_username, require_permission, require_super_admin, ADMIN_ROLES
from config import get_settings
from database import col, NO_ID
from middleware.audit import audit_log
from odoo_client import get_odoo_client
from routes.settings_routes import get_email_routing
from services.email_service import (
    send_order_ready_for_collection,
    send_partial_delivery_ready,
    send_backorder_created_internal,
    send_backorder_stock_ready,
)

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
    return entries


async def push_update(entry: dict):
    await manager.broadcast({"type": "entry_update", "data": entry}, warehouse_id=entry.get("warehouse_id"))


async def _sync_sales_ticket(order_id: str, outcome: str, reason: Optional[str] = None):
    """
    Phase 8.4 — write an Orders outcome (complete/incomplete/cancelled) back
    to the linked Sales ticket and notify the assigned sales rep. Best-effort
    and silent if no Sales ticket exists for this order — a packing board
    entry can exist without ever having gone through one (e.g. legacy orders
    confirmed before Phase 8, or orders placed without a logged PO/RFQ).
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
        from services.notification_service import notify_ticket_handoff
        await notify_ticket_handoff(ticket.get("customer_name", ""), outcome, ticket.get("assigned_to"))
    except Exception as e:
        print(f"⚠️  Sales ticket sync failed for order {order_id}: {e}")


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

async def _do_assign_packer(order_id: str, packer_name: str, actor: dict) -> Optional[dict]:
    result = await col("packing_board").find_one_and_update(
        {"order_id": order_id},
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


async def _do_tick_item(order_id: str, sku: str, ticked: bool, actor: dict) -> Optional[dict]:
    entry = await col("packing_board").find_one({"order_id": order_id})
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
        {"order_id": order_id},
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


async def _do_update_status(order_id: str, new_status: str, actor: dict) -> Optional[dict]:
    ts_field = {
        "collected": "collected_at",
        "cleared":   "cleared_at",
        "ready":     "ready_at",
    }.get(new_status)
    update: dict = {"status": new_status}
    if ts_field:
        update[ts_field] = datetime.now(timezone.utc)
    updated = await col("packing_board").find_one_and_update(
        {"order_id": order_id},
        {"$set": update},
        return_document=True,
    )
    if not updated:
        return None
    updated.pop("_id", None)
    await push_update(updated)
    await audit_log(f"packing.{new_status}", "packing_board", order_id, entity_label=order_id, user=actor)
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


class UpdateStatus(BaseModel):
    order_id: str
    status:   str


class OrderIdBody(BaseModel):
    order_id: str


class IncompleteBody(BaseModel):
    order_id: str
    reason:   str


class CancelBody(BaseModel):
    order_id: str
    reason:   Optional[str] = None


class AdoptBody(BaseModel):
    order_id: int  # Odoo sale.order ID (integer)

class MarkCollectedBody(BaseModel):
    order_id: str
    picking_id: Optional[int] = None  # Odoo picking ID; if omitted, targets the primary (non-backorder) entry

class UpdateItemQtyBody(BaseModel):
    order_id:   str
    sku:        str
    qty_packed: float


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
    return {"success": True, "order_id": entry.order_id}


@router.put("/assign")
async def assign_packer(
    body: AssignPacker,
    current_user: dict = Depends(require_admin),
):
    result = await _do_assign_packer(body.order_id, body.packer_name, current_user)
    if not result:
        raise HTTPException(status_code=404, detail="Order not on board")
    return {"success": True, "packer": body.packer_name.upper()}


@router.put("/tick")
async def tick_item(
    order_id: str,
    sku:      str,
    ticked:   bool = True,
    current_user: dict = Depends(require_admin),
):
    updated = await _do_tick_item(order_id, sku, ticked, current_user)
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
    entry = await col("packing_board").find_one({"order_id": body.order_id})
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
        {"order_id": body.order_id},
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
    updated = await _do_update_status(body.order_id, body.status, current_user)
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
    entry = await col("packing_board").find_one({"order_id": body.order_id})
    if not entry:
        raise HTTPException(status_code=404, detail="Order not on board")
    if entry["status"] != "ready":
        raise HTTPException(status_code=400, detail="Order isn't ready for inspection yet")

    now = datetime.now(timezone.utc)
    updated = await col("packing_board").find_one_and_update(
        {"order_id": body.order_id},
        {"$set": {"qa_approved_by": current_user.get("name") or current_user.get("username"), "qa_approved_at": now}},
        return_document=True,
    )
    updated.pop("_id", None)
    await push_update(updated)
    await audit_log("packing.qa_approve", "packing_board", body.order_id, entity_label=body.order_id, user=current_user)
    return {"success": True}


@router.put("/rp-approve")
async def rp_approve(
    body: OrderIdBody,
    current_user: dict = Depends(require_permission("tickets.rp_approve")),
):
    """Responsible Pharmacist sign-off — required (alongside QA) before an
    entry can be marked complete. Independent of QA's approval — neither
    approves on the other's behalf."""
    entry = await col("packing_board").find_one({"order_id": body.order_id})
    if not entry:
        raise HTTPException(status_code=404, detail="Order not on board")
    if entry["status"] != "ready":
        raise HTTPException(status_code=400, detail="Order isn't ready for inspection yet")

    now = datetime.now(timezone.utc)
    updated = await col("packing_board").find_one_and_update(
        {"order_id": body.order_id},
        {"$set": {"rp_approved_by": current_user.get("name") or current_user.get("username"), "rp_approved_at": now}},
        return_document=True,
    )
    updated.pop("_id", None)
    await push_update(updated)
    await audit_log("packing.rp_approve", "packing_board", body.order_id, entity_label=body.order_id, user=current_user)
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
        return {"success": False, "pickings": [], "error": "No delivery orders in Ready state found for this order", **_no_backorder}

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
                from collections import defaultdict as _dd
                move_lines = _odoo.search_read(
                    "stock.move.line",
                    [("picking_id", "=", pid), ("state", "not in", ["done", "cancel"])],
                    ["id", "product_id", "reserved_uom_qty"],
                )
                product_mls: dict = _dd(list)
                for ml in move_lines:
                    pid_val = ml["product_id"][0] if isinstance(ml["product_id"], list) else ml["product_id"]
                    product_mls[pid_val].append(ml)
                for product_id_val, mls in product_mls.items():
                    override = qty_overrides.get(product_id_val)
                    remaining = float(override) if override is not None else None
                    for ml in mls:
                        reserved = float(ml.get("reserved_uom_qty", 0))
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


@router.put("/complete")
async def complete_entry(
    body: OrderIdBody,
    background_tasks: BackgroundTasks,
    current_user: dict = Depends(require_permission("tickets.orders")),
):
    """Orders Clerk's final close-out action — the explicit "I'm declaring
    this ready" step the business described, taken only after both QA and RP
    have independently signed off."""
    entry = await col("packing_board").find_one({"order_id": body.order_id})
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
    invoice_id: Optional[int] = None
    invoice_name: Optional[str] = None
    invoice_warning: Optional[str] = None
    try:
        odoo = get_odoo_client()
        sale_order_id = int(entry["order_id"])
        wiz_id = odoo.create(
            "sale.advance.payment.inv",
            {"advance_payment_method": "delivered", "sale_order_ids": [(4, sale_order_id)]},
        )
        odoo.execute("sale.advance.payment.inv", "create_invoices", [wiz_id], {"active_ids": [sale_order_id]})
        inv_rows = odoo.search_read(
            "account.move",
            [["invoice_origin", "like", str(sale_order_id)], ["move_type", "=", "out_invoice"], ["state", "=", "draft"]],
            ["id", "name"],
            order="id desc",
            limit=1,
        )
        if inv_rows:
            invoice_id = inv_rows[0]["id"]
            invoice_name = inv_rows[0]["name"]
            odoo.execute("account.move", "action_post", [invoice_id])
    except Exception as e:
        invoice_warning = f"Invoice creation failed: {e}"

    # Stamp invoice_id on the linked sales ticket so Finance can register payment
    if invoice_id:
        try:
            _st = await col("tickets").find_one(
                {"type": "sales", "order_id": int(entry["order_id"]), "exit_status": None}
            )
            if _st:
                await col("tickets").update_one({"_id": _st["_id"]}, {"$set": {"invoice_id": invoice_id}})
        except Exception:
            pass

    _complete_set: dict = {
        "status": "complete",
        "completed_at": now,
        "delivery_validated": delivery_result["success"],
    }
    if invoice_id:
        _complete_set["inv_num"] = invoice_name or ""
        _complete_set["invoice_id"] = invoice_id

    updated = await col("packing_board").find_one_and_update(
        {"order_id": body.order_id, "is_backorder": {"$ne": True}},
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
    await _sync_sales_ticket(body.order_id, "partially_fulfilled" if is_partial else "ready_for_collection")

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
        # ── Full delivery: notify supervisors for collection ──────────────────
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


@router.put("/mark-collected")
async def mark_collected(
    body: MarkCollectedBody,
    background_tasks: BackgroundTasks,
    current_user: dict = Depends(require_permission("tickets.orders")),
):
    """Orders Clerk confirms customer has collected a delivery (primary or backorder).
    Creates the Odoo invoice for the delivered qty, then checks whether all pickings
    for this order are now collected — if so, advances the ticket to complete."""
    query: dict = {"order_id": body.order_id}
    if body.picking_id:
        query["odoo_picking_id"] = body.picking_id
    else:
        query["is_backorder"] = {"$ne": True}  # target primary entry when no picking_id given

    entry = await col("packing_board").find_one(query)
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

    return {
        "success": True,
        "collected_at": now.isoformat(),
        "order_complete": all_collected,
    }


@router.get("/backorders/check-stock")
async def check_backorder_stock(
    background_tasks: BackgroundTasks,
    current_user: dict = Depends(require_permission("tickets.orders")),
):
    """Check all waiting_stock backorder entries against Odoo. When a backorder picking
    has moved to 'assigned' (stock reserved), clears the waiting flag and fires
    notifications to the reseller and internal staff."""
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

        await col("packing_board").update_one(
            {"_id": bo_entry["_id"]},
            {"$set": {"waiting_stock": False}},
        )

        order_ref = str(bo_entry.get("order_id", ""))
        customer_name = bo_entry.get("customer_name", "")
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
        updated_refs.append(order_ref)

    return {"checked": len(entries), "ready": len(updated_refs), "updated": updated_refs}


@router.put("/incomplete")
async def mark_incomplete(
    body: IncompleteBody,
    current_user: dict = Depends(require_permission("tickets.orders")),
):
    """Orders Clerk flags a partial/blocked order — always requires a reason
    so Sales has something concrete to relay to the client."""
    entry = await col("packing_board").find_one({"order_id": body.order_id})
    if not entry:
        raise HTTPException(status_code=404, detail="Order not on board")
    if entry["status"] in ("collected", "cleared", "cancelled", "complete", "incomplete"):
        raise HTTPException(status_code=400, detail=f"Order is already '{entry['status']}'")

    now = datetime.now(timezone.utc)
    updated = await col("packing_board").find_one_and_update(
        {"order_id": body.order_id},
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
    entry = await col("packing_board").find_one({"order_id": body.order_id})
    if not entry:
        raise HTTPException(status_code=404, detail="Order not on board")
    if entry["status"] in ("collected", "cleared", "cancelled", "complete", "incomplete"):
        raise HTTPException(status_code=400, detail=f"Order is already '{entry['status']}'")

    now = datetime.now(timezone.utc)
    updated = await col("packing_board").find_one_and_update(
        {"order_id": body.order_id},
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
async def get_entry(order_id: str, _: dict = Depends(require_board_access)):
    entry = await col("packing_board").find_one({"order_id": order_id}, NO_ID)
    if not entry:
        raise HTTPException(status_code=404, detail="Entry not found")
    return entry


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
    current_user: dict = Depends(require_permission("tickets.orders")),
):
    """Orders Clerk: advance a queued order to packing."""
    entry = await col("packing_board").find_one({"order_id": body.order_id})
    if not entry:
        raise HTTPException(status_code=404, detail="Order not on board")
    if entry["status"] != "queued":
        raise HTTPException(status_code=400, detail="Order must be queued before marking as packing")
    updated = await _do_update_status(body.order_id, "packing", current_user)
    if not updated:
        raise HTTPException(status_code=404, detail="Order not on board")
    return {"success": True}


@router.put("/mark-ready")
async def mark_ready(
    body: OrderIdBody,
    current_user: dict = Depends(require_permission("tickets.orders")),
):
    """Orders Clerk: advance a packing order to ready for inspection."""
    entry = await col("packing_board").find_one({"order_id": body.order_id})
    if not entry:
        raise HTTPException(status_code=404, detail="Order not on board")
    if entry["status"] != "packing":
        raise HTTPException(status_code=400, detail="Order must be packing before marking as ready")
    updated = await _do_update_status(body.order_id, "ready", current_user)
    if not updated:
        raise HTTPException(status_code=404, detail="Order not on board")
    return {"success": True}


@router.put("/override-status")
async def override_status(
    body: UpdateStatus,
    current_user: dict = Depends(require_permission("tickets.manage")),
):
    """Admin override — set any status directly (tickets.manage permission required).
    When overriding to a terminal status, also syncs the linked sales ticket so
    legacy or manually-corrected entries stay consistent with the sales pipeline."""
    entry = await col("packing_board").find_one({"order_id": body.order_id})
    if not entry:
        raise HTTPException(status_code=404, detail="Order not on board")
    updated = await col("packing_board").find_one_and_update(
        {"order_id": body.order_id},
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
        await _sync_sales_ticket(body.order_id, _ticket_outcome)

    return {"success": True}


class AssignLotBody(BaseModel):
    order_id: str
    product_id: int   # Odoo product.product ID
    lot_id: int       # Odoo stock.lot ID


@router.put("/assign-lot")
async def assign_lot(
    body: AssignLotBody,
    current_user: dict = Depends(require_permission("tickets.orders")),
):
    """Assign a specific lot/batch to a product line on the active delivery order.

    Writes lot_id to the matching stock.move.line in Odoo so the lot appears
    on the validated delivery note. Must be called before mark-complete.
    """
    entry = await col("packing_board").find_one({"order_id": body.order_id})
    if not entry:
        raise HTTPException(status_code=404, detail="Order not on packing board")
    if entry.get("status") not in ("queued", "packing", "ready"):
        raise HTTPException(status_code=400, detail="Lot assignment is only allowed before the order is completed")

    odoo = get_odoo_client()
    try:
        # Find all active (not done/cancelled) pickings for this sale order
        pickings = odoo.search_read(
            "stock.picking",
            [("sale_id", "=", int(body.order_id)), ("state", "not in", ["done", "cancel"])],
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
