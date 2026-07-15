"""
Operations monitor — read-only live board for TV / big-screen display.

Public endpoints (token-verified, no login required):
  GET /api/monitor/validate?token=   — check token validity
  GET /api/monitor/data?token=       — full board data + KPIs

Admin endpoints (JWT):
  GET  /api/monitor/token            — retrieve current token
  POST /api/monitor/token            — generate / rotate token
"""
import secrets
from datetime import datetime, timezone

from fastapi import APIRouter, Depends, HTTPException, Query

from auth import require_admin
from database import col

router = APIRouter(prefix="/api/monitor", tags=["monitor"])

NO_ID         = {"_id": 0}
OVERDUE_HOURS = 72
QUOTE_HOURS   = 48   # softer deadline for unconfirmed quotes
_TERMINAL     = {"complete", "cancelled", "collected", "cleared"}


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


def _board_card(entry: dict, deadline: int = OVERDUE_HOURS, assigned_name: str | None = None) -> dict:
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
    }


# Ticket statuses shown in the Quotes column, with their deadlines.
# open/quote = soft 48h (not yet a confirmed order)
# sale_order = hard 72h (order confirmed, awaiting packing board)
_QUOTE_STATUS_DEADLINE = {
    "open":       QUOTE_HOURS,
    "quote":      QUOTE_HOURS,
    "sale_order": OVERDUE_HOURS,
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
    }


# ── Public: validate ──────────────────────────────────────────────────────────

@router.get("/validate")
async def validate_token(token: str = Query("")):
    if not await _verify_token(token):
        raise HTTPException(status_code=403, detail="Invalid monitor token")
    return {"valid": True}


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

    collection_tickets = await col("tickets").find(
        {"type": "sales", "status": "ready_for_collection",
         "exit_status": None, "payment_confirmed_at": None},
        NO_ID,
    ).to_list(length=500)

    # Board lookup for collection clock + value
    coll_refs = [t.get("orders_ticket_ref") for t in collection_tickets if t.get("orders_ticket_ref")]
    board_coll_map: dict = {}
    if coll_refs:
        extra = await col("packing_board").find(
            {"order_id": {"$in": coll_refs}},
            {"order_id": 1, "queued_at": 1, "order_value": 1,
             "total_units": 1, "ps_num": 1, "warehouse_name": 1, "_id": 0},
        ).to_list(length=500)
        board_coll_map = {e["order_id"]: e for e in extra}

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

    # ── Build columns ─────────────────────────────────────────────────────────
    packing_col    = []
    qa_col         = []
    rp_col         = []

    for entry in board_active:
        status    = entry.get("status", "")
        order_id  = entry.get("order_id", "")
        a_name    = ticket_assign_map.get(order_id)
        if status in ("queued", "packing"):
            packing_col.append(_board_card(entry, assigned_name=a_name))
        elif status == "ready":
            if not entry.get("qa_approved_at"):
                qa_col.append(_board_card(entry, assigned_name=a_name))
            else:
                rp_col.append(_board_card(entry, assigned_name=a_name))

    quotes_col     = [_ticket_card(t) for t in open_quotes]
    collection_col = [
        _collection_card(t, board_coll_map.get(t.get("orders_ticket_ref", ""), {}))
        for t in collection_tickets
    ]

    # Sort all columns oldest-first so the most urgent card is always at the top
    for lst in [quotes_col, packing_col, qa_col, rp_col, collection_col]:
        lst.sort(key=lambda x: x["hours_elapsed"], reverse=True)

    # ── KPIs ──────────────────────────────────────────────────────────────────
    all_active    = quotes_col + packing_col + qa_col + rp_col + collection_col
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
            "in_packing":          len(packing_col),
            "qa_pending":          len(qa_col),
            "rp_pending":          len(rp_col),
            "awaiting_collection": len(collection_col),
            "oldest_hours":        round(oldest_hours, 1) if oldest_hours is not None else None,
        },
        "columns": {
            "quotes":     quotes_col,
            "packing":    packing_col,
            "qa":         qa_col,
            "rp":         rp_col,
            "collection": collection_col,
        },
        "server_time": now.isoformat(),
    }
