"""
Manufacturing Orders monitor — read-only live board for TV / big-screen
display at the GACP manufacturing facility (Phase 23.3, companion to
monitor_routes.py's order-pipeline board and onboarding_monitor_routes.py's
onboarding board). Same token-gated architecture as those two: a token in
`portal_settings` (no login, URL query-token only), admin generate/rotate,
public validate + data, 30s poll, no WebSocket.

Genuine difference from the other two monitors: this is the first board
whose data lives only in Odoo — there is no Mongo mirror of `mrp.production`
— so `GET /data` makes live Odoo calls every poll, the same class of
deliberate exception `scheduler.py::run_mo_digest` already is (its own
comment calls it out as "the one digest that queries Odoo directly").
Domain is scoped identically to that digest (`state not in [done, cancel]`,
`origin like "S0"`) so this board and the daily email never disagree about
what counts as an open, sale-order-driven MO — and, just as importantly,
both correctly exclude the unrelated vault/manicuring-lab MOs
(services/vault_odoo.py's `_manufacture_split()`), which are created with
no sale-order `origin` at all and are a different feature entirely.

Public endpoints (token-verified, no login required):
  GET /api/manufacturing-monitor/validate?token=   — check token validity
  GET /api/manufacturing-monitor/data?token=       — full board data + KPIs

Admin endpoints (JWT):
  GET  /api/manufacturing-monitor/token            — retrieve current token
  POST /api/manufacturing-monitor/token            — generate / rotate token
"""
import secrets
from datetime import datetime, timezone

from fastapi import APIRouter, Depends, HTTPException, Query

from auth import require_admin
from database import col
from odoo_client import get_odoo_client

router = APIRouter(prefix="/api/manufacturing-monitor", tags=["manufacturing-monitor"])

NO_ID = {"_id": 0}

# Columns are keyed directly to Odoo's own mrp.production state machine
# (done/cancel excluded by the domain itself) rather than a derived stage —
# unlike the onboarding monitor, the state field IS the stage here. These
# four values (draft/confirmed/progress/to_close) are already live-verified
# elsewhere in this codebase (label maps exist in email_service.py,
# Backorders.js, OrderPassport.js, OrderView.js, SalesTickets.js,
# OrdersTickets.js) — not a fresh assumption.
_COLUMN_KEYS = ["draft", "confirmed", "progress", "to_close"]

# Proposed defaults, not confirmed business policy — no GACP production SLA
# data exists anywhere in this codebase yet (unlike the other two monitors,
# which each have at least one real anchor). Revisit once real usage shows
# what's actually urgent.
_DEADLINES = {
    "draft":     24,
    "confirmed": 48,
    "progress":  72,
    "to_close":  24,
}


# ── Token helpers (identical shape to the other two monitors) ─────────────────

async def _verify_token(token: str) -> bool:
    if not token:
        return False
    rec = await col("portal_settings").find_one({"_id": "manufacturing_monitor_display_token"})
    return bool(rec and rec.get("token") == token)


@router.get("/token")
async def get_token(current_user: dict = Depends(require_admin)):
    rec = await col("portal_settings").find_one(
        {"_id": "manufacturing_monitor_display_token"},
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
        {"_id": "manufacturing_monitor_display_token"},
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


def _parse_odoo_dt(s) -> datetime | None:
    """Odoo's XML-RPC layer returns datetimes as 'YYYY-MM-DD HH:MM:SS'
    strings, not ISO — fromisoformat handles that shape fine, but guard
    against False/None (an unset Odoo datetime field reads as False)."""
    if not s:
        return None
    try:
        return _utc(datetime.fromisoformat(s))
    except (ValueError, TypeError):
        return None


def _hours_elapsed(since: datetime) -> float:
    return (datetime.now(timezone.utc) - _utc(since)).total_seconds() / 3600


def _age_tier(elapsed: float, deadline: float) -> str:
    pct = elapsed / deadline
    if pct >= 1.0:   return "overdue"
    if pct >= 0.66:  return "urgent"
    if pct >= 0.33:  return "warning"
    return "ok"


def _mo_card(mo: dict, sale_info: dict | None, ticket_info: dict | None) -> dict:
    # create_date is a standard Odoo magic field, always populated on every
    # record regardless of module/routing config — unlike a custom field,
    # there's no schema-drift risk reading it here.
    clock    = _parse_odoo_dt(mo.get("create_date")) or datetime.now(timezone.utc)
    state    = mo.get("state") or "draft"
    deadline = _DEADLINES.get(state, 24)
    elapsed  = _hours_elapsed(clock)
    product  = mo.get("product_id")
    qty_total     = mo.get("product_qty") or 0
    qty_producing = mo.get("qty_producing") or 0
    return {
        "id":             mo["id"],
        "mo_name":        mo.get("name", ""),
        "product_id":     product[0] if isinstance(product, list) else None,
        "product_name":   product[1] if isinstance(product, list) else "",
        "qty_total":      qty_total,
        "qty_producing":  qty_producing,
        "qty_remaining":  round(qty_total - qty_producing, 3),
        "state":          state,
        "order_ref":      mo.get("origin") or "",
        "sale_order_id":  sale_info.get("id") if sale_info else None,
        "customer_name":  sale_info.get("customer_name") if sale_info else "",
        "ticket":         ticket_info,
        "clock_start":    _iso(clock),
        "deadline_hours": deadline,
        "hours_elapsed":  round(elapsed, 2),
        "age_tier":       _age_tier(elapsed, deadline),
        "date_finished":  _iso(_parse_odoo_dt(mo.get("date_finished"))),
    }


# ── Public: validate ──────────────────────────────────────────────────────────

@router.get("/validate")
async def validate_token(token: str = Query("")):
    if not await _verify_token(token):
        raise HTTPException(status_code=403, detail="Invalid monitor token")
    return {"valid": True}


# ── Public: full board data ───────────────────────────────────────────────────

@router.get("/data")
async def get_manufacturing_monitor_data(token: str = Query("")):
    if not await _verify_token(token):
        raise HTTPException(status_code=403, detail="Invalid monitor token")

    now = datetime.now(timezone.utc)
    odoo = get_odoo_client()

    # Same domain as scheduler.py::run_mo_digest, deliberately — this board
    # and the daily email must never disagree about what counts as an open,
    # sale-order-driven MO. date_start/date_finished are the confirmed
    # correct Odoo-19 field names (order_routes.py's 2026-08-11 fix) —
    # date_planned_start/date_planned_finished do not exist on this instance.
    try:
        mos = odoo.search_read(
            "mrp.production",
            domain=[("state", "not in", ["done", "cancel"]), ("origin", "like", "S0")],
            fields=["id", "name", "product_id", "product_qty", "qty_producing", "state",
                    "origin", "create_date", "date_start", "date_finished"],
            limit=500,
            order="create_date asc",
        )
    except Exception as e:
        raise HTTPException(status_code=502, detail=f"Odoo error: {str(e)}")

    # Batch-resolve the sale orders these MOs came from (by name, via
    # `origin`) — degrade to missing enrichment rather than fail the whole
    # board on a secondary lookup, same pattern order_routes.py's backorders
    # endpoint already uses for its own mrp.production/tickets lookups.
    sale_by_name: dict = {}
    sale_names = list({mo["origin"] for mo in mos if mo.get("origin")})
    if sale_names:
        try:
            sale_orders = odoo.search_read(
                "sale.order",
                domain=[("name", "in", sale_names)],
                fields=["id", "name", "partner_id"],
                limit=len(sale_names),
            )
            for so in sale_orders:
                partner = so.get("partner_id")
                sale_by_name[so["name"]] = {
                    "id":            so["id"],
                    "customer_name": partner[1] if isinstance(partner, list) else "",
                }
        except Exception:
            pass

    ticket_map: dict = {}
    sale_ids = [s["id"] for s in sale_by_name.values()]
    if sale_ids:
        try:
            async for t in col("tickets").find(
                {"order_id": {"$in": [str(i) for i in sale_ids]}},
                {"_id": 1, "order_id": 1},
            ):
                tid = str(t["_id"])
                ticket_map[str(t["order_id"])] = {"ticket_id": tid, "ref": f"TKT-{tid[-8:].upper()}"}
        except Exception:
            pass

    columns: dict = {k: [] for k in _COLUMN_KEYS}
    for mo in mos:
        origin    = mo.get("origin") or ""
        sale_info = sale_by_name.get(origin)
        ticket_info = ticket_map.get(str(sale_info["id"])) if sale_info else None
        card = _mo_card(mo, sale_info, ticket_info)
        # setdefault rather than a plain columns[state] append: an MO state
        # outside the four expected values would otherwise KeyError instead
        # of just landing in an extra bucket the frontend doesn't render —
        # still counted in the KPI roll-ups below via all_active, just not
        # in any named per-column KPI (same graceful-degradation approach
        # the onboarding monitor uses for its excluded awaiting_docs stage).
        columns.setdefault(card["state"], []).append(card)

    for lst in columns.values():
        lst.sort(key=lambda c: c["hours_elapsed"], reverse=True)

    all_active = [c for lst in columns.values() for c in lst]
    overdue      = sum(1 for c in all_active if c["age_tier"] == "overdue")
    at_risk      = sum(1 for c in all_active if c["age_tier"] == "urgent")
    oldest_hours = max((c["hours_elapsed"] for c in all_active), default=None)
    total_units_remaining = round(sum(c["qty_remaining"] for c in all_active), 2)

    return {
        "kpis": {
            "overdue":               overdue,
            "at_risk":               at_risk,
            "draft":                 len(columns.get("draft", [])),
            "confirmed":             len(columns.get("confirmed", [])),
            "in_progress":           len(columns.get("progress", [])),
            "to_close":              len(columns.get("to_close", [])),
            "total_units_remaining": total_units_remaining,
            "oldest_hours":          round(oldest_hours, 1) if oldest_hours is not None else None,
        },
        "columns": columns,
        "server_time": now.isoformat(),
    }
