"""
GMP Supply monitor (8.70e) — token-gated public TV board for the GMP
facility, fourth in the monitor family (monitor_routes, onboarding_monitor_
routes, manufacturing_monitor_routes) and built the same way: a token in
portal_settings, admin generate/rotate, public validate + data, 30s poll.

Like the Manufacturing Monitor, its data lives only in Odoo, so each poll
reads Odoo live — here via supply_service.work_list(), the same function the
GMP Work List page uses, so the board and the page never disagree. Product-
first cards: what La Farmacia needs from GMP, and how many customer orders
are waiting on it. Age deadlines are proposed defaults, not agreed SLAs.

Public:  GET /api/supply-monitor/validate?token=  ·  GET /api/supply-monitor/data?token=
Admin:   GET/POST /api/supply-monitor/token
"""
import secrets
from datetime import datetime, timezone

from fastapi import APIRouter, Depends, HTTPException, Query
from fastapi.concurrency import run_in_threadpool

from auth import require_admin
from database import col
from odoo_client import get_odoo_client
from services import supply_service as svc

router = APIRouter(prefix="/api/supply-monitor", tags=["supply-monitor"])

TOKEN_ID = "supply_monitor_display_token"
COLUMNS = ["needs_requesting", "requested", "ready_to_dispatch", "in_transit"]
DEADLINE_HOURS = {"needs_requesting": 24, "requested": 72, "ready_to_dispatch": 24, "in_transit": 24}


async def _verify(token: str) -> bool:
    if not token:
        return False
    rec = await col("portal_settings").find_one({"_id": TOKEN_ID})
    return bool(rec and rec.get("token") == token)


@router.get("/token")
async def get_token(current_user: dict = Depends(require_admin)):
    rec = await col("portal_settings").find_one({"_id": TOKEN_ID}, {"token": 1, "rotated_at": 1, "_id": 0})
    return {"token": rec.get("token") if rec else None,
            "rotated_at": rec["rotated_at"].isoformat() if rec and rec.get("rotated_at") else None}


@router.post("/token")
async def rotate_token(current_user: dict = Depends(require_admin)):
    token = secrets.token_urlsafe(32)
    now = datetime.now(timezone.utc)
    await col("portal_settings").update_one(
        {"_id": TOKEN_ID},
        {"$set": {"token": token, "rotated_at": now}, "$setOnInsert": {"created_at": now}},
        upsert=True,
    )
    return {"token": token}


@router.get("/validate")
async def validate(token: str = Query(...)):
    return {"valid": await _verify(token)}


def _parse(s):
    if not s:
        return None
    try:
        d = datetime.fromisoformat(str(s))
        return d if d.tzinfo else d.replace(tzinfo=timezone.utc)
    except (ValueError, TypeError):
        return None


def _tier(hours: float, deadline: float) -> str:
    pct = hours / deadline if deadline else 0
    if pct >= 1.0:
        return "overdue"
    if pct >= 0.66:
        return "urgent"
    if pct >= 0.33:
        return "warning"
    return "ok"


@router.get("/data")
async def data(token: str = Query(...)):
    if not await _verify(token):
        raise HTTPException(status_code=401, detail="Invalid or expired display token")
    settings = await col("portal_settings").find_one({"_id": "supply_settings"}, {"_id": 0}) or {}
    odoo = get_odoo_client()
    try:
        cfg = await run_in_threadpool(svc.resolve_config, odoo, settings)
        wl = await run_in_threadpool(svc.work_list, odoo, cfg)
    except svc.SupplyNotConfigured as e:
        raise HTTPException(status_code=409, detail=str(e))
    except Exception as e:
        raise HTTPException(status_code=502, detail=f"Could not read from Odoo: {e}")

    now = datetime.now(timezone.utc)
    columns = {k: [] for k in COLUMNS}
    overdue = 0
    for r in wl["products"]:
        if r["status"] not in columns:
            continue
        since = _parse(r.get("oldest_since")) or now
        hours = (now - since).total_seconds() / 3600
        tier = _tier(hours, DEADLINE_HOURS[r["status"]])
        overdue += tier == "overdue"
        columns[r["status"]].append({
            "product_id": r["product_id"], "product_name": r["product_name"],
            "needed": r["needed"], "still_needed": r["still_needed"], "uncovered": r["uncovered"],
            "requested": r["requested"], "in_transit": r["in_transit"], "supplier_free": r["supplier_free"],
            "order_count": r["order_count"],
            "orders": [o["order_name"] for o in r["orders"] if o.get("order_name")][:4],
            "oldest_since": since.isoformat(), "clock_start": since.isoformat(), "hours_waiting": round(hours, 1),
            "deadline_hours": DEADLINE_HOURS[r["status"]], "age_tier": tier,
        })
    for cards in columns.values():
        cards.sort(key=lambda c: -c["hours_waiting"])
    oldest = max((c["hours_waiting"] for cards in columns.values() for c in cards), default=0)
    return {
        "columns": columns,
        "kpis": {
            "products_short": wl["summary"]["products_short"],
            "orders_waiting": wl["summary"]["orders_waiting"],
            "needs_requesting": len(columns["needs_requesting"]),
            "ready_to_dispatch": len(columns["ready_to_dispatch"]),
            "in_transit": len(columns["in_transit"]),
            "overdue": overdue,
            "oldest_hours": oldest,
        },
        "supplier": cfg["supplier_company_name"], "receiving": cfg["receiving_warehouse_name"],
        "generated_at": now.isoformat(),
    }
