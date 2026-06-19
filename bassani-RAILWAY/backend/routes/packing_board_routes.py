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
from fastapi import APIRouter, WebSocket, WebSocketDisconnect, Depends, HTTPException
from pydantic import BaseModel
from typing import Optional, List
from auth import require_admin, get_current_user, get_user_by_username, require_permission, ADMIN_ROLES
from config import get_settings
from database import col, NO_ID
from middleware.audit import audit_log

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
_BOARD_VIEW_ROLES = {"orders_clerk", "qa_manager", "responsible_pharmacist"}


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


@router.put("/complete")
async def complete_entry(
    body: OrderIdBody,
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
    updated = await col("packing_board").find_one_and_update(
        {"order_id": body.order_id},
        {"$set": {"status": "complete", "completed_at": now}},
        return_document=True,
    )
    updated.pop("_id", None)
    await push_update(updated)
    await audit_log("packing.complete", "packing_board", body.order_id, entity_label=body.order_id, user=current_user)
    await _sync_sales_ticket(body.order_id, "complete")
    return {"success": True}


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
