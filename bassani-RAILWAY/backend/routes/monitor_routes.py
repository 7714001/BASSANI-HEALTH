"""
Operations monitor — read-only live board for TV / big-screen display.

Public endpoints (token-verified, no login required):
  GET /api/monitor/validate?token=   — check token validity
  GET /api/monitor/data?token=       — full board data + KPIs
  GET /api/monitor/export?token=     — one row per card for the Excel export
                                       (23.9; reads Odoo only when clicked)

Admin endpoints (JWT):
  GET  /api/monitor/token            — retrieve current token
  POST /api/monitor/token            — generate / rotate token

Otherwise Mongo-only by design (cheap for frequent polling) — the exceptions
are bounded, degrade-gracefully Odoo calls per poll, each scoped to only the
ids already on the current page: the has_mo_pending signal (23.4,
2026-08-22), since there is no Mongo mirror of mrp.production (same class of
exception manufacturing_monitor_routes.py and scheduler.py::run_mo_digest
already are); and the quote/deposit-stage order_value lookup (2026-09-20),
since a ticket with no packing_board entry yet never had its order's
amount_total stamped anywhere in Mongo.
"""
import logging
import secrets
from datetime import datetime, timezone

from fastapi import APIRouter, Depends, HTTPException, Query, WebSocket, WebSocketDisconnect

from auth import require_admin
from database import col
from odoo_client import get_odoo_client
from services.age_tier import OVERDUE_HOURS, QUOTE_HOURS, hours_elapsed as _hours_elapsed, age_tier as _age_tier

router = APIRouter(prefix="/api/monitor", tags=["monitor"])
logger = logging.getLogger(__name__)

NO_ID         = {"_id": 0}
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


# _hours_elapsed/_age_tier/OVERDUE_HOURS/QUOTE_HOURS now imported from
# services/age_tier.py (2026-08-26) — kept under these same local names so
# every call site below is unchanged; see that module's docstring for why.


def _creator(ticket: dict | None) -> str | None:
    """Who generated the order: the actor on the ticket's first stage_history
    entry (every ticket-creating path writes one), falling back to the
    reseller's name for a reseller order."""
    if not ticket:
        return None
    hist = ticket.get("stage_history") or []
    name = hist[0].get("actor_name") if hist else None
    if name in (None, "", "system", "unknown"):
        name = ticket.get("reseller_name") or name
    return name


def _odoo_order_id(value) -> int | None:
    try:
        return int(value) if value not in (None, "", False) else None
    except (TypeError, ValueError):
        return None


def _board_card(entry: dict, deadline: int = OVERDUE_HOURS, assigned_name: str | None = None, has_backorder: bool = False, has_mo_pending: bool = False, created_by_name: str | None = None) -> dict:
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
        "created_by_name": created_by_name,
        "odoo_order_id":  _odoo_order_id(entry.get("order_id")),
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


def _ticket_card(ticket: dict, order_value: float | None = None) -> dict:
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
        "order_value":    order_value,
        "is_sample":      ticket.get("is_sample", False),
        "is_reseller":    bool(ticket.get("reseller_id")),
        "reseller_name":  ticket.get("reseller_name"),
        "status":         status,
        "qa_approved_at": None,
        "rp_approved_at": None,
        "packer_name":    None,
        "assigned_name":  ticket.get("assigned_to_name"),
        "created_by_name": _creator(ticket),
        "odoo_order_id":  _odoo_order_id(ticket.get("order_id")),
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
        "created_by_name": _creator(ticket),
        "odoo_order_id":  _odoo_order_id(ticket.get("order_id") or ticket.get("orders_ticket_ref")),
        "warehouse_name": board.get("warehouse_name"),
        "has_backorder":  False,  # not reachable pre-packing-board-completion
        "has_mo_pending": False,  # not reachable pre-packing-board-completion
    }


def _board_ready_card(entry: dict, assigned_name: str | None = None, status: str = "ready_for_collection", created_by_name: str | None = None) -> dict:
    """Card for a packing board 'complete' entry with no linked sales ticket.
    Clock starts at completed_at — how long the order has been waiting for collection.
    status="awaiting_payment" (8.69): packed, notice held until paid; clock
    starts when the hold began."""
    clock   = (entry.get("payment_hold_at") if status == "awaiting_payment" else None)         or entry.get("completed_at") or entry.get("queued_at", datetime.now(timezone.utc))
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
        "status":         status,
        "qa_approved_at": _iso(entry.get("qa_approved_at")),
        "rp_approved_at": _iso(entry.get("rp_approved_at")),
        "packer_name":    entry.get("packer_name") or entry.get("assigned_packer"),
        "assigned_name":  assigned_name,
        "created_by_name": created_by_name,
        "odoo_order_id":  _odoo_order_id(entry.get("order_id")),
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

    # Fetched (not just counted) so completed_today_value can be summed below
    # without a second query — the CFO/exco-facing "what did we ship today,
    # in rand" figure alongside the ops-facing count.
    completed_today_docs = await col("packing_board").find(
        {"status": "complete", "completed_at": {"$gte": today_start}},
        {"order_value": 1, "_id": 0},
    ).to_list(length=1000)
    completed_today       = len(completed_today_docs)
    completed_today_value = round(sum(d.get("order_value") or 0 for d in completed_today_docs), 2)

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
    # Covers the complete (payment / ready-to-collect) entries too, which
    # previously got no assignee; also captures who generated the order
    # (first stage_history entry) for the Excel export.
    lookup_ids = list({*board_order_ids,
                       *[e.get("order_id") for e in board_complete if e.get("order_id")]})
    ticket_assign_map: dict = {}
    ticket_creator_map: dict = {}
    if lookup_ids:
        ticket_assigns = await col("tickets").find(
            {"orders_ticket_ref": {"$in": lookup_ids}},
            {"orders_ticket_ref": 1, "assigned_to_name": 1, "reseller_name": 1,
             "stage_history": {"$slice": 1}, "_id": 0},
        ).to_list(length=1000)
        for t in ticket_assigns:
            ref = t.get("orders_ticket_ref")
            if ref:
                ticket_assign_map[ref] = t.get("assigned_to_name")
                ticket_creator_map[ref] = _creator(t)

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

    # Ticket-linked order value (2026-09-20) — a quote/deposit-stage ticket has
    # no packing_board doc yet (that's only created post-deposit), so unlike
    # packing/qa/rp/collection cards it never got order_value stamped anywhere
    # in Mongo. Same bounded, degrade-gracefully shape as mo_pending_map above:
    # one extra sale.order read for just the order_ids already on this page.
    # A ticket with no order_id yet (never quoted) genuinely has no value.
    ticket_value_map: dict = {}
    ticket_order_ids = list({
        t["order_id"] for t in (open_quotes + awaiting_deposit_tickets)
        if t.get("order_id")
    })
    if ticket_order_ids:
        try:
            odoo = get_odoo_client()
            value_rows = odoo.search_read(
                "sale.order",
                domain=[("id", "in", ticket_order_ids)],
                fields=["id", "amount_total"],
                limit=len(ticket_order_ids),
            )
            ticket_value_map = {str(r["id"]): float(r.get("amount_total") or 0) for r in value_rows}
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
        c_name    = ticket_creator_map.get(order_id)
        if status in ("queued", "packing"):
            packing_col.append(_board_card(entry, assigned_name=a_name, has_backorder=has_bo, has_mo_pending=has_mo, created_by_name=c_name))
        elif status == "ready":
            if not entry.get("qa_approved_at"):
                qa_col.append(_board_card(entry, assigned_name=a_name, has_backorder=has_bo, has_mo_pending=has_mo, created_by_name=c_name))
            else:
                rp_col.append(_board_card(entry, assigned_name=a_name, has_backorder=has_bo, has_mo_pending=has_mo, created_by_name=c_name))

    # 8.69 — packed and signed off, but the customer notice is held until the
    # invoice is paid: its own column, so Ready to Collect only ever shows
    # orders the customer has actually been told they can collect.
    def _held(e: dict) -> bool:
        return bool(e.get("payment_hold")) and not e.get("collection_released_at")

    payment_col = [
        _board_ready_card(e, ticket_assign_map.get(e.get("order_id", "")), status="awaiting_payment",
                          created_by_name=ticket_creator_map.get(e.get("order_id", "")))
        for e in board_complete if _held(e)
    ]

    quotes_col     = [_ticket_card(t, ticket_value_map.get(str(t.get("order_id")))) for t in open_quotes]
    deposit_col    = [_ticket_card(t, ticket_value_map.get(str(t.get("order_id")))) for t in awaiting_deposit_tickets]
    collection_col = [
        _collection_card(t, board_coll_map.get(t.get("orders_ticket_ref", ""), {}))
        for t in collection_tickets
    ] + [
        _board_ready_card(e, ticket_assign_map.get(e.get("order_id", "")),
                          created_by_name=ticket_creator_map.get(e.get("order_id", "")))
        for e in board_complete
        if e.get("order_id") not in covered_order_ids and not _held(e)
    ]

    # Sort all columns oldest-first so the most urgent card is always at the top
    for lst in [quotes_col, deposit_col, packing_col, qa_col, rp_col, payment_col, collection_col]:
        lst.sort(key=lambda x: x["hours_elapsed"], reverse=True)

    # ── KPIs ──────────────────────────────────────────────────────────────────
    all_active    = quotes_col + deposit_col + packing_col + qa_col + rp_col + payment_col + collection_col
    overdue_count = sum(1 for c in all_active if c["age_tier"] == "overdue")
    at_risk_count = sum(1 for c in all_active if c["age_tier"] == "urgent")
    oldest_hours  = max((c["hours_elapsed"] for c in all_active), default=None)

    # Revenue tied up per stage (2026-09-20) — the sum of each column's own
    # order_value, whether that came from Mongo (packing/qa/rp/collection,
    # stamped at packing-board creation) or the live sale.order read above
    # (quotes/deposit). A card with no known value (e.g. a bare inquiry with
    # no draft order yet) contributes 0, not an error.
    def _col_total(cards: list) -> float:
        return round(sum(c["order_value"] or 0 for c in cards), 2)

    column_totals = {
        "quotes":     _col_total(quotes_col),
        "deposit":    _col_total(deposit_col),
        "packing":    _col_total(packing_col),
        "qa":         _col_total(qa_col),
        "rp":         _col_total(rp_col),
        "payment":    _col_total(payment_col),
        "collection": _col_total(collection_col),
    }
    pipeline_value = round(sum(column_totals.values()), 2)

    # Revenue at risk (2026-09-20) — the rand value specifically tied up in
    # overdue-tier orders, not just the count. Deliberately not tied to any
    # one column (an overdue order can sit in any of the six), so unlike
    # column_totals above there's no single column heading this would
    # duplicate — this is the one figure a CFO/exco viewer actually wants
    # ("how much money is stuck," not just "how many orders").
    revenue_at_risk = round(sum(c["order_value"] or 0 for c in all_active if c["age_tier"] == "overdue"), 2)

    # KPI strip redesign (2026-09-20, same round as column_totals above) —
    # every per-column count that used to live here (open_quotes,
    # awaiting_deposit, in_packing, qa_pending, rp_pending,
    # awaiting_collection) is now shown directly on that column's own
    # heading badge, so repeating it a second time up here was pure
    # duplication. What's kept/added are only the figures that are NOT
    # visible on any single column heading: cross-column signals
    # (backorders, in_production), cross-column aggregates (overdue,
    # at_risk, compliance_hold, oldest_hours), and whole-pipeline financials
    # (pipeline_value, revenue_at_risk, completed_today_value).
    return {
        "kpis": {
            "overdue":                overdue_count,
            "at_risk":                at_risk_count,
            "compliance_hold":        len(qa_col) + len(rp_col),
            "completed_today":        completed_today,
            "completed_today_value":  completed_today_value,
            "backorders":             len(backorder_map),
            "in_production":          sum(1 for c in all_active if c["has_mo_pending"]),
            "oldest_hours":           round(oldest_hours, 1) if oldest_hours is not None else None,
            "pipeline_value":         pipeline_value,
            "revenue_at_risk":        revenue_at_risk,
            "awaiting_payment_value": _col_total(payment_col),
        },
        "columns": {
            "quotes":     quotes_col,
            "deposit":    deposit_col,
            "packing":    packing_col,
            "qa":         qa_col,
            "rp":         rp_col,
            "payment":    payment_col,
            "collection": collection_col,
        },
        "column_totals": column_totals,
        "server_time": now.isoformat(),
    }


# ── Public: Excel export rows (23.9) ──────────────────────────────────────────

_EXPORT_STAGES = [
    ("quotes",     "Open Quote"),
    ("deposit",    "Awaiting Deposit"),
    ("packing",    "Packing"),
    ("qa",         "QA Review"),
    ("rp",         "RP Review"),
    ("payment",    "Awaiting Payment"),
    ("collection", "Ready to Collect"),
]


@router.get("/export")
async def export_monitor_rows(token: str = Query("")):
    """One row per card on the board, in pipeline order, for the Excel export.

    Same cards as /data (it is called directly, so the two can never
    disagree), plus the figures the board itself doesn't need: the sale
    order number, value excl. VAT and units, read from Odoo in two bounded
    calls only when someone clicks Export, never on the 30s poll. Units are
    the packing entry's own count once an order is on the packing board
    (what this delivery has to pack, which for a backorder is only the
    remainder), otherwise the order's product quantities. An Odoo failure
    degrades to blank figures with odoo_unavailable set, never a failed export.
    """
    data = await get_monitor_data(token)   # verifies the token
    columns = data["columns"]

    order_ids = sorted({c["odoo_order_id"] for key, _ in _EXPORT_STAGES
                        for c in columns.get(key, []) if c.get("odoo_order_id")})
    orders: dict = {}
    line_units: dict = {}
    odoo_unavailable = False
    if order_ids:
        try:
            odoo = get_odoo_client()
            for r in odoo.search_read(
                "sale.order", domain=[("id", "in", order_ids)],
                fields=["id", "name", "amount_untaxed", "amount_tax", "amount_total", "date_order"],
                limit=len(order_ids),
            ):
                orders[r["id"]] = r
            try:
                lines = odoo.search_read(
                    "sale.order.line", domain=[("order_id", "in", order_ids)],
                    fields=["order_id", "product_uom_qty", "display_type", "is_downpayment"],
                    limit=20000,
                )
            except Exception:
                lines = odoo.search_read(
                    "sale.order.line", domain=[("order_id", "in", order_ids)],
                    fields=["order_id", "product_uom_qty", "display_type"],
                    limit=20000,
                )
            for ln in lines:
                if ln.get("display_type") or ln.get("is_downpayment"):
                    continue
                oid = ln["order_id"][0] if ln.get("order_id") else None
                if oid:
                    line_units[oid] = line_units.get(oid, 0) + float(ln.get("product_uom_qty") or 0)
        except Exception as e:
            logger.warning("monitor_export_odoo_failed error=%s", e)
            odoo_unavailable = True

    rows = []
    for key, label in _EXPORT_STAGES:
        for c in columns.get(key, []):
            oid = c.get("odoo_order_id")
            so = orders.get(oid) if oid else None
            units = c.get("total_units") or 0
            if not units and oid in line_units:
                units = line_units[oid]
            ref = (so or {}).get("name") or c.get("so_ref") or ""
            # A bare numeric so_ref is an Odoo record id, not an order number.
            if not so and str(ref).isdigit():
                ref = ""
            rows.append({
                "stage_key":       key,
                "status":          label,
                "sale_order":      ref,
                "customer_name":   c.get("customer_name") or "",
                "created_by":      c.get("created_by_name") or "",
                "units":           units if (units or so) else None,
                "value_excl_vat":  float(so["amount_untaxed"]) if so else None,
                "vat":             float(so["amount_tax"]) if so else None,
                "value_incl_vat":  float(so["amount_total"]) if so else c.get("order_value"),
                "order_date":      (so or {}).get("date_order") or None,
                "sales_agent":     c.get("reseller_name") or "",
                "assigned_to":     c.get("assigned_name") or "",
                "packer":          c.get("packer_name") or "",
                "warehouse":       c.get("warehouse_name") or "",
                "waiting_since":   c.get("clock_start"),
                "hours_waiting":   c.get("hours_elapsed"),
                "deadline_hours":  c.get("deadline_hours"),
                "age_tier":        c.get("age_tier"),
                "backorder":       bool(c.get("has_backorder")),
                "in_production":   bool(c.get("has_mo_pending")),
                "sample":          bool(c.get("is_sample")),
            })

    return {
        "rows": rows,
        "kpis": data["kpis"],
        "column_totals": data["column_totals"],
        "odoo_unavailable": odoo_unavailable,
        "server_time": data["server_time"],
    }
