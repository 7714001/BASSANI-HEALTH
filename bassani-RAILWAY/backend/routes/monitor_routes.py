"""
Operations monitor — read-only live board for TV / big-screen display.

Public endpoints (token-verified, no login required):
  GET /api/monitor/validate?token=   — check token validity
  GET /api/monitor/data?token=       — full board data + KPIs

Admin endpoints (JWT):
  GET  /api/monitor/token            — retrieve current token
  POST /api/monitor/token            — generate / rotate token

Otherwise Mongo-only by design (cheap for frequent polling) — the one
exception is the has_mo_pending signal (23.4, 2026-08-22), which makes a
single bounded, degrade-gracefully Odoo call per poll since there is no
Mongo mirror of mrp.production. Same class of exception
manufacturing_monitor_routes.py and scheduler.py::run_mo_digest already are.
"""
import secrets
from datetime import datetime, timezone

from fastapi import APIRouter, Depends, HTTPException, Query, WebSocket, WebSocketDisconnect

from auth import require_admin
from database import col
from odoo_client import get_odoo_client

router = APIRouter(prefix="/api/monitor", tags=["monitor"])

NO_ID         = {"_id": 0}
OVERDUE_HOURS = 72
QUOTE_HOURS   = 48   # softer deadline for unconfirmed quotes
_TERMINAL     = {"complete", "cancelled", "collected", "cleared"}


# ── Live-push WebSocket manager ───────────────────────────────────────────────

class _MonitorManager:
    """Holds all connected monitor WebSocket clients and broadcasts refresh nudges."""

    def __init__(self):
        self._connections: list[WebSocket] = []

    def connect(self, ws: WebSocket):
        self._connections.append(ws)

    def disconnect(self, ws: WebSocket):
        self._connections = [c for c in self._connections if c is not ws]

    async def broadcast_refresh(self):
        dead = []
        for ws in list(self._connections):
            try:
                await ws.send_text('{"type":"refresh"}')
            except Exception:
                dead.append(ws)
        for ws in dead:
            self.disconnect(ws)


_monitor_manager = _MonitorManager()


async def broadcast_monitor_refresh():
    """Call from any route that changes ticket or packing board state."""
    await _monitor_manager.broadcast_refresh()


# ── Token helpers ─────────────────────────────────────────────────────────────

async def _verify_token(token: str) -> bool:
    if not token:
        return False
    rec = await col("portal_settings").find_one({"_id": "monitor_display_token"})
    return bool(rec and rec.get("token") == token)


# ── Admin: token management ───────────────────────────────────────────────────

@router.get("/token")
async def get_token(current_user: dict = Depends(require_admin)):
    rec = await col("portal_settings").find_one(
        {"_id": "monitor_display_token"},
        {"token": 1, "rotated_at": 1, "_id": 0},
    )
    return {
        "token":      rec.get("token") if rec else None,
        "rotated_at": rec["rotated_at"].isoformat() if rec and rec.get("rotated_at") else None,
    }


@router.post("/token")
async def rotate_token(current_user: dict = Depends(require_admin)):
    token = secrets.token_urlsafe(32)
    now   = datetime.now(timezone.utc)
    await col("portal_settings").update_one(
        {"_id": "monitor_display_token"},
        {"$set": {"token": token, "rotated_at": now}, "$setOnInsert": {"created_at": now}},
        upsert=True,
    )
    return {"token": token}


# ── Shared helpers ────────────────────────────────────────────────────────────

def _utc(dt: datetime) -> datetime:
    if dt is None:
        return datetime.now(timezone.utc)
    return dt if dt.tzinfo else dt.replace(tzinfo=timezone.utc)


def _iso(dt) -> str | None:
    return _utc(dt).isoformat() if dt else None


def _hours_elapsed(since: datetime) -> float:
    return (datetime.now(timezone.utc) - _utc(since)).total_seconds() / 3600


def _age_tier(elapsed: float, deadline: float) -> str:
    pct = elapsed / deadline
    if pct >= 1.0:   return "overdue"
    if pct >= 0.66:  return "urgent"
    if pct >= 0.33:  return "warning"
    return "ok"


def _board_card(entry: dict, deadline: int = OVERDUE_HOURS, assigned_name: str | None = None, has_backorder: bool = False, has_mo_pending: bool = False) -> dict:
    clock   = entry.get("queued_at", datetime.now(timezone.utc))
    elapsed = _hours_elapsed(clock)
    return {
        "id":             entry.get("order_id", ""),
        "type":           "order",
        "customer_name":  entry.get("customer_name", ""),
        "so_ref":         entry.get("ps_num") or entry.get("order_id", ""),
        "clock_start":    _iso(clock),
        "deadline_hours": deadline,
        "hours_elapsed":  round(elapsed, 2),
        "age_tier":       _age_tier(elapsed, deadline),
        "total_units":    entry.get("total_units", 0),
        "order_value":    entry.get("order_value"),
        "is_sample":      entry.get("is_sample", False),
        "is_reseller":    entry.get("is_reseller", False),
        "reseller_name":  entry.get("reseller_name"),
        "status":         entry.get("status", ""),
        "qa_approved_at": _iso(entry.get("qa_approved_at")),
        "rp_approved_at": _iso(entry.get("rp_approved_at")),
        "packer_name":    entry.get("packer_name"),
        "assigned_name":  assigned_name,
        "warehouse_name": entry.get("warehouse_name"),
        # True when a sibling packing_board entry for this same order_id is
        # a still-waiting backorder child (is_backorder/waiting_stock, set
        # in packing_board_routes.py around the backorder-split point) —
        # 2026-08-22. Flags that this order LOOKS on-track here but part of
        # it is actually stuck waiting on stock/production; see the
        # Manufacturing Orders monitor for the production-floor detail.
        "has_backorder":  has_backorder,
        # True when this order has an open (not done/cancel) mrp.production
        # tied to it via origin (23.4, 2026-08-22) — same signal as
        # has_backorder above but for the "Odoo needs to make more stock"
        # case rather than the "delivery was short-picked" case. Sourced
        # live from Odoo each poll (see mo_pending_map below) since there is
        # no Mongo mirror of mrp.production — degrades to False on any Odoo
        # error rather than failing the board.
        "has_mo_pending": has_mo_pending,
    }


# Ticket statuses shown in the Quotes column, with their deadlines.
# open/quote = soft 48h (not yet a confirmed order)
# sale_order = hard 72h (order confirmed, awaiting packing board)
# awaiting_deposit = hard 72h (order confirmed, customer has committed —
# arguably more urgent than sale_order, not less, since this is purely a
# Finance action waiting to happen, not a customer decision)
_QUOTE_STATUS_DEADLINE = {
    "open":              QUOTE_HOURS,
    "quote":             QUOTE_HOURS,
    "sale_order":        OVERDUE_HOURS,
    "awaiting_deposit":  OVERDUE_HOURS,
}


def _ticket_card(ticket: dict) -> dict:
    clock   = ticket.get("created_at", datetime.now(timezone.utc))
    status  = ticket.get("status", "open")
    deadline = _QUOTE_STATUS_DEADLINE.get(status, QUOTE_HOURS)
    elapsed = _hours_elapsed(clock)
    return {
        "id":             str(ticket.get("_id", "")),
        "type":           "quote",
        "customer_name":  ticket.get("customer_name", ""),
        "so_ref":         ticket.get("order_id") or "",
        "clock_start":    _iso(clock),
        "deadline_hours": deadline,
        "hours_elapsed":  round(elapsed, 2),
        "age_tier":       _age_tier(elapsed, deadline),
        "total_units":    0,
        "order_value":    None,
        "is_sample":      ticket.get("is_sample", False),
        "is_reseller":    bool(ticket.get("reseller_id")),
        "reseller_name":  ticket.get("reseller_name"),
        "status":         status,
        "qa_approved_at": None,
        "rp_approved_at": None,
        "packer_name":    None,
        "assigned_name":  ticket.get("assigned_to_name"),
        "warehouse_name": None,
        "has_backorder":  False,  # not reachable pre-packing-board-completion
        "has_mo_pending": False,  # not reachable pre-packing-board-completion
    }


def _collection_card(ticket: dict, board: dict) -> dict:
    clock   = board.get("queued_at") or ticket.get("updated_at", datetime.now(timezone.utc))
    elapsed = _hours_elapsed(clock)
    return {
        "id":             str(ticket.get("_id", "")),
        "type":           "order",
        "customer_name":  ticket.get("customer_name", ""),
        "so_ref":         board.get("ps_num") or ticket.get("orders_ticket_ref", ""),
        "clock_start":    _iso(clock),
        "deadline_hours": OVERDUE_HOURS,
        "hours_elapsed":  round(elapsed, 2),
        "age_tier":       _age_tier(elapsed, OVERDUE_HOURS),
        "total_units":    board.get("total_units", 0),
        "order_value":    board.get("order_value"),
        "is_sample":      ticket.get("is_sample", False),
        "is_reseller":    bool(ticket.get("reseller_id")),
        "reseller_name":  ticket.get("reseller_name"),
        "status":         "awaiting_payment",
        "qa_approved_at": None,
        "rp_approved_at": None,
        "packer_name":    None,
        "assigned_name":  ticket.get("assigned_to_name"),
        "warehouse_name": board.get("warehouse_name"),
        "has_backorder":  False,  # not reachable pre-packing-board-completion
        "has_mo_pending": False,  # not reachable pre-packing-board-completion
    }


def _board_ready_card(entry: dict, assigned_name: str | None = None) -> dict:
    """Card for a packing board 'complete' entry with no linked sales ticket.
    Clock starts at completed_at — how long the order has been waiting for collection."""
    clock   = entry.get("completed_at") or entry.get("queued_at", datetime.now(timezone.utc))
    elapsed = _hours_elapsed(clock)
    return {
        "id":             entry.get("order_id", ""),
        "type":           "order",
        "customer_name":  entry.get("customer_name", ""),
        "so_ref":         entry.get("ps_num") or entry.get("order_id", ""),
        "clock_start":    _iso(clock),
        "deadline_hours": OVERDUE_HOURS,
        "hours_elapsed":  round(elapsed, 2),
        "age_tier":       _age_tier(elapsed, OVERDUE_HOURS),
        "total_units":    entry.get("total_units", 0),
        "order_value":    entry.get("order_value"),
        "is_sample":      entry.get("is_sample", False),
        "is_reseller":    entry.get("is_reseller", False),
        "reseller_name":  entry.get("reseller_name"),
        "status":         "ready_for_collection",
        "qa_approved_at": _iso(entry.get("qa_approved_at")),
        "rp_approved_at": _iso(entry.get("rp_approved_at")),
        "packer_name":    entry.get("packer_name") or entry.get("assigned_packer"),
        "assigned_name":  assigned_name,
        "warehouse_name": entry.get("warehouse_name"),
        "has_backorder":  False,  # not reachable once an order is already ready for collection
        "has_mo_pending": False,  # not reachable once an order is already ready for collection
    }


# ── Public: validate ──────────────────────────────────────────────────────────

@router.get("/validate")
async def validate_token(token: str = Query("")):
    if not await _verify_token(token):
        raise HTTPException(status_code=403, detail="Invalid monitor token")
    return {"valid": True}


# ── Public: live-push WebSocket ───────────────────────────────────────────────

@router.websocket("/ws")
async def monitor_ws(ws: WebSocket, token: str = Query("")):
    """Token-verified WebSocket. Server pushes {type:'refresh'} on any pipeline change."""
    await ws.accept()
    if not await _verify_token(token):
        await ws.send_text('{"type":"error","message":"Invalid monitor token"}')
        await ws.close(code=1008)
        return
    _monitor_manager.connect(ws)
    try:
        while True:
            await ws.receive_text()   # block; raises WebSocketDisconnect on close
    except WebSocketDisconnect:
        _monitor_manager.disconnect(ws)


# ── Public: full board data ───────────────────────────────────────────────────

@router.get("/data")
async def get_monitor_data(token: str = Query("")):
    if not await _verify_token(token):
        raise HTTPException(status_code=403, detail="Invalid monitor token")

    now         = datetime.now(timezone.utc)
    today_start = now.replace(hour=0, minute=0, second=0, microsecond=0)

    # ── Queries (all MongoDB — no Odoo call) ──────────────────────────────────
    board_active = await col("packing_board").find(
        {"status": {"$nin": list(_TERMINAL) + ["cleared", "waiting_stock"]}},
        NO_ID,
    ).to_list(length=1000)

    completed_today = await col("packing_board").count_documents(
        {"status": "complete", "completed_at": {"$gte": today_start}}
    )

    # open/quote = unconfirmed; sale_order = confirmed but not yet on packing board
    open_quotes = await col("tickets").find(
        {"type": "sales", "status": {"$in": ["open", "quote", "sale_order"]},
         "exit_status": None, "orders_ticket_ref": None},
        NO_ID,
    ).to_list(length=500)

    # Confirmed orders sitting on the deposit gate (8.47) — a packing board
    # entry only gets created once Finance registers the deposit, so before
    # this these tickets matched no column at all and were invisible on the
    # board despite this being a real bottleneck stage.
    awaiting_deposit_tickets = await col("tickets").find(
        {"type": "sales", "status": "awaiting_deposit",
         "exit_status": None, "orders_ticket_ref": None},
        NO_ID,
    ).to_list(length=500)

    collection_tickets = await col("tickets").find(
        {"type": "sales", "status": "ready_for_collection",
         "exit_status": None, "payment_confirmed_at": None},
        NO_ID,
    ).to_list(length=500)

    # Packing board entries that are complete but not yet collected — catches orders
    # that went through the packing board without a linked sales ticket.
    board_complete = await col("packing_board").find(
        {"status": "complete", "collected_at": None},
        NO_ID,
    ).to_list(length=500)

    # Board lookup for collection clock + value (ticket-linked cards)
    coll_refs = [t.get("orders_ticket_ref") for t in collection_tickets if t.get("orders_ticket_ref")]
    board_coll_map: dict = {}
    if coll_refs:
        extra = await col("packing_board").find(
            {"order_id": {"$in": coll_refs}},
            {"order_id": 1, "queued_at": 1, "order_value": 1,
             "total_units": 1, "ps_num": 1, "warehouse_name": 1, "_id": 0},
        ).to_list(length=500)
        board_coll_map = {e["order_id"]: e for e in extra}

    # order_ids already covered by the ticket-based collection cards — used to
    # deduplicate when _sync_sales_ticket did run successfully.
    covered_order_ids: set = set()
    for t in collection_tickets:
        if t.get("orders_ticket_ref"):
            covered_order_ids.add(t["orders_ticket_ref"])
        if t.get("order_id") is not None:
            covered_order_ids.add(str(t["order_id"]))

    # Ticket assignee lookup for packing board cards (board entries don't store assignee)
    board_order_ids = [e.get("order_id") for e in board_active if e.get("order_id")]
    ticket_assign_map: dict = {}
    if board_order_ids:
        ticket_assigns = await col("tickets").find(
            {"orders_ticket_ref": {"$in": board_order_ids}},
            {"orders_ticket_ref": 1, "assigned_to_name": 1, "_id": 0},
        ).to_list(length=1000)
        ticket_assign_map = {
            t["orders_ticket_ref"]: t.get("assigned_to_name")
            for t in ticket_assigns
            if t.get("orders_ticket_ref")
        }

    # Backorder signal (2026-08-22) — a still-waiting backorder child entry
    # shares its order_id with the primary entry it split from
    # (packing_board_routes.py sets "order_id": body.order_id on the child
    # doc), so one batched query against the same order_ids already on this
    # page finds every order whose primary card should carry the badge.
    # Deliberately Mongo-only, no Odoo call, to preserve this file's
    # existing Mongo-only design.
    backorder_map: dict = {}
    if board_order_ids:
        bo_entries = await col("packing_board").find(
            {"order_id": {"$in": board_order_ids}, "is_backorder": True, "waiting_stock": True},
            {"order_id": 1, "_id": 0},
        ).to_list(length=1000)
        backorder_map = {e["order_id"]: True for e in bo_entries}

    # Manufacturing-order signal (23.4, 2026-08-22) — the mirror of
    # backorder_map above for the "Odoo needs to make more stock" case. There
    # is no Mongo copy of mrp.production, so unlike every other lookup in this
    # function this one is a live, bounded Odoo call (bounded to the
    # order_ids already on this page, same batching approach as
    # backorder_map) — the same class of Odoo-touching exception
    # manufacturing_monitor_routes.py and scheduler.py::run_mo_digest already
    # are. Same domain as both of those, and as order_routes.py's
    # /manufacturing-orders list, so none of the four ever disagree about
    # what counts as an open, order-linked MO. Fully non-fatal: any Odoo
    # error here degrades to "no badge shown," never fails the board.
    mo_pending_map: dict = {}
    if board_order_ids:
        try:
            odoo = get_odoo_client()
            sale_rows = odoo.search_read(
                "sale.order",
                domain=[("id", "in", [int(i) for i in board_order_ids])],
                fields=["id", "name"],
                limit=len(board_order_ids),
            )
            name_to_order_id = {s["name"]: str(s["id"]) for s in sale_rows}
            if name_to_order_id:
                mos = odoo.search_read(
                    "mrp.production",
                    domain=[("state", "not in", ["done", "cancel"]),
                            ("origin", "in", list(name_to_order_id.keys()))],
                    fields=["origin"],
                    limit=1000,
                )
                for mo in mos:
                    oid = name_to_order_id.get(mo.get("origin"))
                    if oid:
                        mo_pending_map[oid] = True
        except Exception:
            pass

    # ── Build columns ─────────────────────────────────────────────────────────
    packing_col    = []
    qa_col         = []
    rp_col         = []

    for entry in board_active:
        status    = entry.get("status", "")
        order_id  = entry.get("order_id", "")
        a_name    = ticket_assign_map.get(order_id)
        has_bo    = backorder_map.get(order_id, False)
        has_mo    = mo_pending_map.get(order_id, False)
        if status in ("queued", "packing"):
            packing_col.append(_board_card(entry, assigned_name=a_name, has_backorder=has_bo, has_mo_pending=has_mo))
        elif status == "ready":
            if not entry.get("qa_approved_at"):
                qa_col.append(_board_card(entry, assigned_name=a_name, has_backorder=has_bo, has_mo_pending=has_mo))
            else:
                rp_col.append(_board_card(entry, assigned_name=a_name, has_backorder=has_bo, has_mo_pending=has_mo))

    quotes_col     = [_ticket_card(t) for t in open_quotes]
    deposit_col    = [_ticket_card(t) for t in awaiting_deposit_tickets]
    collection_col = [
        _collection_card(t, board_coll_map.get(t.get("orders_ticket_ref", ""), {}))
        for t in collection_tickets
    ] + [
        _board_ready_card(e, ticket_assign_map.get(e.get("order_id", "")))
        for e in board_complete
        if e.get("order_id") not in covered_order_ids
    ]

    # Sort all columns oldest-first so the most urgent card is always at the top
    for lst in [quotes_col, deposit_col, packing_col, qa_col, rp_col, collection_col]:
        lst.sort(key=lambda x: x["hours_elapsed"], reverse=True)

    # ── KPIs ──────────────────────────────────────────────────────────────────
    all_active    = quotes_col + deposit_col + packing_col + qa_col + rp_col + collection_col
    overdue_count = sum(1 for c in all_active if c["age_tier"] == "overdue")
    at_risk_count = sum(1 for c in all_active if c["age_tier"] == "urgent")
    oldest_hours  = max((c["hours_elapsed"] for c in all_active), default=None)

    return {
        "kpis": {
            "overdue":             overdue_count,
            "at_risk":             at_risk_count,
            "compliance_hold":     len(qa_col) + len(rp_col),
            "completed_today":     completed_today,
            "open_quotes":         len(quotes_col),
            "awaiting_deposit":    len(deposit_col),
            "in_packing":          len(packing_col),
            "qa_pending":          len(qa_col),
            "rp_pending":          len(rp_col),
            "awaiting_collection": len(collection_col),
            "backorders":          len(backorder_map),
            "in_production":       sum(1 for c in all_active if c["has_mo_pending"]),
            "oldest_hours":        round(oldest_hours, 1) if oldest_hours is not None else None,
        },
        "columns": {
            "quotes":     quotes_col,
            "deposit":    deposit_col,
            "packing":    packing_col,
            "qa":         qa_col,
            "rp":         rp_col,
            "collection": collection_col,
        },
        "server_time": now.isoformat(),
    }
