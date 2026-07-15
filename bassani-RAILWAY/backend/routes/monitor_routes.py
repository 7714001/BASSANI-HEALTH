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
from db import col

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


def _board_card(entry: dict, deadline: int = OVERDUE_HOURS) -> dict:
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
        "warehouse_name": entry.get("warehouse_name"),
    }


def _ticket_card(ticket: dict) -> dict:
    clock   = ticket.get("created_at", datetime.now(timezone.utc))
    elapsed = _hours_elapsed(clock)
    return {
        "id":             str(ticket.get("_id", "")),
        "type":           "quote",
        "customer_name":  ticket.get("customer_name", ""),
        "so_ref":         "",
        "clock_start":    _iso(clock),
        "deadline_hours": QUOTE_HOURS,
        "hours_elapsed":  round(elapsed, 2),
        "age_tier":       _age_tier(elapsed, QUOTE_HOURS),
        "total_units":    0,
        "order_value":    None,
        "is_sample":      ticket.get("is_sample", False),
        "is_reseller":    bool(ticket.get("reseller_id")),
        "reseller_name":  ticket.get("reseller_name"),
        "status":         ticket.get("status", ""),
        "qa_approved_at": None,
        "rp_approved_at": None,
        "packer_name":    ticket.get("assigned_to_name"),
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
    month_start = now.replace(day=1, hour=0, minute=0, second=0, microsecond=0)

    # ── Queries (all MongoDB — no Odoo call) ──────────────────────────────────
    board_active = await col("packing_board").find(
        {"status": {"$nin": list(_TERMINAL) + ["cleared", "waiting_stock"]}},
        NO_ID,
    ).to_list(length=1000)

    board_done_today = await col("packing_board").find(
        {"status": "complete", "completed_at": {"$gte": today_start}},
        NO_ID,
    ).to_list(length=1000)

    board_done_month = await col("packing_board").find(
        {"status": "complete", "completed_at": {"$gte": month_start}},
        {"order_value": 1, "_id": 0},
    ).to_list(length=5000)

    open_quotes = await col("tickets").find(
        {"type": "sales", "status": {"$in": ["open", "quote"]},
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

    # ── Build columns ─────────────────────────────────────────────────────────
    packing_col    = []
    qa_col         = []
    rp_col         = []

    for entry in board_active:
        status = entry.get("status", "")
        if status in ("queued", "packing"):
            packing_col.append(_board_card(entry))
        elif status == "ready":
            if not entry.get("qa_approved_at"):
                qa_col.append(_board_card(entry))
            else:
                rp_col.append(_board_card(entry))

    quotes_col     = [_ticket_card(t) for t in open_quotes]
    collection_col = [
        _collection_card(t, board_coll_map.get(t.get("orders_ticket_ref", ""), {}))
        for t in collection_tickets
    ]

    # Sort all columns oldest-first so the most urgent card is always at the top
    for lst in [quotes_col, packing_col, qa_col, rp_col, collection_col]:
        lst.sort(key=lambda x: x["hours_elapsed"], reverse=True)

    # ── KPIs ──────────────────────────────────────────────────────────────────
    pipeline_cards = packing_col + qa_col + rp_col
    overdue_count  = sum(1 for c in pipeline_cards if c["age_tier"] == "overdue")
    at_risk_count  = sum(1 for c in pipeline_cards if c["age_tier"] == "urgent")

    units_today = sum(e.get("total_units", 0) for e in board_done_today)

    times = []
    for e in board_done_today:
        q, c = e.get("queued_at"), e.get("completed_at")
        if q and c:
            times.append((_utc(c) - _utc(q)).total_seconds() / 3600)
    avg_time = round(sum(times) / len(times), 1) if times else None

    pipeline_value = sum(
        (c.get("order_value") or 0)
        for c in pipeline_cards + collection_col
    )
    revenue_today = sum((e.get("order_value") or 0) for e in board_done_today)
    mtd_revenue   = sum((e.get("order_value") or 0) for e in board_done_month)

    return {
        "kpis": {
            "overdue":         overdue_count,
            "at_risk":         at_risk_count,
            "in_pipeline":     len(pipeline_cards) + len(collection_col),
            "completed_today": len(board_done_today),
            "units_today":     units_today,
            "open_quotes":     len(open_quotes),
            "avg_time_hours":  avg_time,
            "pipeline_value":  pipeline_value,
            "revenue_today":   revenue_today,
            "mtd_revenue":     mtd_revenue,
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
