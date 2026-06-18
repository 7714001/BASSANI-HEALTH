"""
Packing Board — real-time WebSocket hub.

Connections (all require token auth):
  wss://host/api/packing/ws/board?token=<PACKING_BOARD_DISPLAY_TOKEN>   ← 85" screen
  wss://host/api/packing/ws/supervisor?token=<supervisor_jwt>             ← supervisor phone
  wss://host/api/packing/ws/packer?token=<packer_jwt>                    ← packer handheld

All connected clients receive the full board state on connect,
then incremental updates as orders change.

Board state lives in MongoDB `packing_board` collection so it
survives server restarts.
"""
import secrets
import asyncio
import json
import jwt
from fastapi import APIRouter, WebSocket, WebSocketDisconnect, Depends, HTTPException
from pydantic import BaseModel
from typing import Optional, List
from datetime import datetime, timezone
from auth import require_admin, get_current_user, get_user_by_username
from config import get_settings
from database import col, NO_ID
from middleware.audit import audit_log

router = APIRouter(prefix="/api/packing", tags=["packing-board"])
settings = get_settings()


# ── Connection manager ────────────────────────────────────────────────────────

class BoardManager:
    def __init__(self):
        self.screens:     list[WebSocket] = []
        self.supervisors: list[WebSocket] = []
        self.packers:     list[WebSocket] = []

    async def connect_screen(self, ws: WebSocket):
        self.screens.append(ws)
        await ws.send_text(json.dumps({"type": "full_state", "data": await get_board_state()}))

    async def connect_supervisor(self, ws: WebSocket):
        self.supervisors.append(ws)
        await ws.send_text(json.dumps({"type": "full_state", "data": await get_board_state()}))

    async def connect_packer(self, ws: WebSocket):
        self.packers.append(ws)
        await ws.send_text(json.dumps({"type": "full_state", "data": await get_board_state()}))

    def disconnect(self, ws: WebSocket):
        self.screens     = [c for c in self.screens     if c is not ws]
        self.supervisors = [c for c in self.supervisors if c is not ws]
        self.packers     = [c for c in self.packers     if c is not ws]

    async def broadcast(self, message: dict):
        payload = json.dumps(message)
        dead = []
        for ws in self.screens + self.supervisors + self.packers:
            try:
                await ws.send_text(payload)
            except Exception:
                dead.append(ws)
        for ws in dead:
            self.disconnect(ws)


manager = BoardManager()


# ── Board state helpers ───────────────────────────────────────────────────────

async def get_board_state() -> list:
    entries = await (
        col("packing_board")
        .find({"status": {"$ne": "cleared"}}, NO_ID)
        .sort("queued_at", 1)
        .to_list(length=100)
    )
    return entries


async def push_update(entry: dict):
    await manager.broadcast({"type": "entry_update", "data": entry})


# ── WebSocket auth helpers ────────────────────────────────────────────────────

def _verify_display_token(ws: WebSocket) -> bool:
    display_token = settings.packing_board_display_token
    if not display_token:
        return False
    provided = ws.query_params.get("token", "")
    return secrets.compare_digest(provided.encode(), display_token.encode())


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
    await audit_log("packing.assigned", order_id, user=actor,
                    detail={"packer": packer_name})
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
        await audit_log("packing.items_complete", order_id, user=actor,
                        detail={"packer": entry.get("packer_name")})
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
    await audit_log(f"packing.{new_status}", order_id, user=actor)
    return updated


# ── Pydantic models ───────────────────────────────────────────────────────────

class BoardEntry(BaseModel):
    order_id:      str
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
        "item_ticks":   {i["sku"]: False for i in entry.items},
    }
    await col("packing_board").replace_one(
        {"order_id": entry.order_id},
        doc,
        upsert=True,
    )
    await push_update(doc)
    await audit_log("packing.queued", entry.order_id, user=current_user,
                    detail={"customer": entry.customer_name, "units": entry.total_units})
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


@router.get("/board")
async def get_board(_: dict = Depends(require_admin)):
    return {"entries": await get_board_state()}


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
    await ws.send_text(json.dumps({"type": "auth_error", "reason": reason}))
    await ws.close(code=4001)


@router.websocket("/ws/board")
async def websocket_board(ws: WebSocket):
    """
    85" display screen — read-only.
    Authenticated via PACKING_BOARD_DISPLAY_TOKEN env var passed as ?token=.
    """
    await ws.accept()
    if not _verify_display_token(ws):
        await _ws_reject(ws, "invalid_token")
        return
    await manager.connect_screen(ws)
    try:
        while True:
            await asyncio.sleep(30)
            await ws.send_text(json.dumps({"type": "ping"}))
    except (WebSocketDisconnect, Exception):
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
    await manager.connect_supervisor(ws)
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
    await manager.connect_packer(ws)
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
