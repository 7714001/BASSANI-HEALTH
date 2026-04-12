"""
Packing Board — real-time WebSocket hub.

Connections:
  ws://host/ws/packing-board          ← 85" screen (read-only display)
  ws://host/ws/packing-board/supervisor ← supervisor phone (read + write)

All connected clients receive the full board state on connect,
then incremental updates as orders change.

Board state lives in MongoDB `packing_board` collection so it
survives server restarts.
"""
from fastapi import APIRouter, WebSocket, WebSocketDisconnect, Depends, HTTPException
from pydantic import BaseModel
from typing import Optional, List
from datetime import datetime, timezone
import asyncio, json
from auth import require_admin, get_current_user
from database import col, NO_ID
from middleware.audit import audit_log

router = APIRouter(prefix="/api/packing", tags=["packing-board"])

# ── Connection manager ────────────────────────────────────────────────────────

class BoardManager:
    def __init__(self):
        self.screens:     list[WebSocket] = []   # 85" display connections
        self.supervisors: list[WebSocket] = []   # supervisor phone connections

    async def connect_screen(self, ws: WebSocket):
        await ws.accept()
        self.screens.append(ws)
        await ws.send_text(json.dumps({"type": "full_state", "data": await get_board_state()}))

    async def connect_supervisor(self, ws: WebSocket):
        await ws.accept()
        self.supervisors.append(ws)
        await ws.send_text(json.dumps({"type": "full_state", "data": await get_board_state()}))

    def disconnect(self, ws: WebSocket):
        self.screens     = [c for c in self.screens     if c is not ws]
        self.supervisors = [c for c in self.supervisors if c is not ws]

    async def broadcast(self, message: dict):
        """Push update to ALL connected clients (screens + supervisors)."""
        payload = json.dumps(message)
        dead = []
        for ws in self.screens + self.supervisors:
            try:
                await ws.send_text(payload)
            except Exception:
                dead.append(ws)
        for ws in dead:
            self.disconnect(ws)


manager = BoardManager()


# ── Board state helpers ───────────────────────────────────────────────────────

async def get_board_state() -> list:
    """Return all non-cleared board entries, sorted by queued_at."""
    entries = await (
        col("packing_board")
        .find({"status": {"$ne": "cleared"}}, NO_ID)
        .sort("queued_at", 1)
        .to_list(length=100)
    )
    return entries


async def push_update(entry: dict):
    """Broadcast a single entry update to all clients."""
    await manager.broadcast({"type": "entry_update", "data": entry})


# ── REST endpoints (called by main app on invoice confirm) ────────────────────

class BoardEntry(BaseModel):
    order_id:      str
    customer_name: str
    customer_city: str
    items:         List[dict]       # [{name, sku, qty, location}]
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
    status:   str     # queued / packing / ready / collected / cleared


@router.post("/queue")
async def add_to_board(
    entry: BoardEntry,
    current_user: dict = Depends(require_admin),
):
    """
    Called automatically when a picking slip is confirmed.
    Adds the order to the packing board and notifies all screens.
    """
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

    # Upsert — if order already on board, refresh it
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
    """Supervisor assigns a packer to an order."""
    now = datetime.now(timezone.utc)
    result = await col("packing_board").find_one_and_update(
        {"order_id": body.order_id},
        {"$set": {
            "packer_name": body.packer_name.upper(),
            "status":      "packing",
            "assigned_at": now,
        }},
        return_document=True,
    )
    if not result:
        raise HTTPException(status_code=404, detail="Order not on board")

    # Strip MongoDB _id before broadcasting
    result.pop("_id", None)
    await push_update(result)
    await audit_log("packing.assigned", body.order_id, user=current_user,
                    detail={"packer": body.packer_name})

    return {"success": True, "packer": body.packer_name.upper()}


@router.put("/tick")
async def tick_item(
    order_id: str,
    sku:      str,
    ticked:   bool = True,
    current_user: dict = Depends(require_admin),
):
    """Mark a single line item as picked on the board."""
    entry = await col("packing_board").find_one({"order_id": order_id})
    if not entry:
        raise HTTPException(status_code=404, detail="Order not on board")

    ticks = entry.get("item_ticks", {})
    ticks[sku] = ticked
    all_done = all(ticks.values())

    update: dict = {"item_ticks": ticks}
    if all_done:
        update["status"]   = "ready"
        update["ready_at"] = datetime.now(timezone.utc)

    updated = await col("packing_board").find_one_and_update(
        {"order_id": order_id},
        {"$set": update},
        return_document=True,
    )
    updated.pop("_id", None)
    await push_update(updated)

    return {"success": True, "all_done": all_done, "status": updated["status"]}


@router.put("/status")
async def update_status(
    body: UpdateStatus,
    current_user: dict = Depends(require_admin),
):
    """Manual status override — collected, cleared, etc."""
    now = datetime.now(timezone.utc)
    ts_field = {
        "collected": "collected_at",
        "cleared":   "cleared_at",
        "ready":     "ready_at",
    }.get(body.status)

    update: dict = {"status": body.status}
    if ts_field:
        update[ts_field] = now

    updated = await col("packing_board").find_one_and_update(
        {"order_id": body.order_id},
        {"$set": update},
        return_document=True,
    )
    if not updated:
        raise HTTPException(status_code=404, detail="Order not on board")
    updated.pop("_id", None)
    await push_update(updated)

    await audit_log(f"packing.{body.status}", body.order_id, user=current_user)
    return {"success": True}


@router.get("/board")
async def get_board(current_user: dict = Depends(require_admin)):
    """REST fallback — returns current board state."""
    return {"entries": await get_board_state()}


@router.get("/packers")
async def list_packers(current_user: dict = Depends(get_current_user)):
    """Return configured packer names from settings."""
    settings = await col("settings").find_one({"key": "packing_board"}, NO_ID)
    packers = settings.get("packers", ["THEMBI", "SIPHO", "PRIYA", "RUAN", "ANELE"]) if settings else []
    return {"packers": packers}


@router.put("/packers")
async def update_packers(
    packers: List[str],
    current_user: dict = Depends(require_admin),
):
    """Update the list of packer names shown in supervisor view."""
    await col("settings").update_one(
        {"key": "packing_board"},
        {"$set": {"packers": [p.upper().strip() for p in packers if p.strip()]}},
        upsert=True,
    )
    return {"success": True}


# ── WebSocket endpoints ───────────────────────────────────────────────────────

@router.websocket("/ws/board")
async def websocket_board(ws: WebSocket):
    """
    85" screen connection — receives updates, never sends.
    No auth on this endpoint — it's a display-only public URL.
    """
    await manager.connect_screen(ws)
    try:
        while True:
            # Keep alive — screens don't send messages
            await asyncio.sleep(30)
            await ws.send_text(json.dumps({"type": "ping"}))
    except (WebSocketDisconnect, Exception):
        manager.disconnect(ws)


@router.websocket("/ws/supervisor")
async def websocket_supervisor(ws: WebSocket):
    """
    Supervisor phone/tablet connection — receives AND sends updates.
    Supervisor sends JSON actions: assign_packer, tick_item, update_status.
    """
    await manager.connect_supervisor(ws)
    try:
        while True:
            raw = await ws.receive_text()
            try:
                msg = json.loads(raw)
                action = msg.get("action")

                if action == "assign_packer":
                    await col("packing_board").update_one(
                        {"order_id": msg["order_id"]},
                        {"$set": {
                            "packer_name": msg["packer_name"].upper(),
                            "status":      "packing",
                            "assigned_at": datetime.now(timezone.utc),
                        }},
                    )
                elif action == "tick_item":
                    entry = await col("packing_board").find_one({"order_id": msg["order_id"]})
                    if entry:
                        ticks = entry.get("item_ticks", {})
                        ticks[msg["sku"]] = msg.get("ticked", True)
                        all_done = all(ticks.values())
                        update: dict = {"item_ticks": ticks}
                        if all_done:
                            update["status"]   = "ready"
                            update["ready_at"] = datetime.now(timezone.utc)
                        await col("packing_board").update_one(
                            {"order_id": msg["order_id"]},
                            {"$set": update},
                        )
                elif action == "update_status":
                    await col("packing_board").update_one(
                        {"order_id": msg["order_id"]},
                        {"$set": {"status": msg["status"]}},
                    )

                # Broadcast updated state to everyone
                updated = await col("packing_board").find_one(
                    {"order_id": msg.get("order_id", "")},
                )
                if updated:
                    updated.pop("_id", None)
                    await manager.broadcast({"type": "entry_update", "data": updated})

            except Exception as e:
                print(f"⚠️  Supervisor WS error: {e}")

    except WebSocketDisconnect:
        manager.disconnect(ws)
