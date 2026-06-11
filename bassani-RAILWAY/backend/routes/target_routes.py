"""Monthly sales targets — set by admins, compared against Odoo actuals."""
from fastapi import APIRouter, Depends, HTTPException
from pydantic import BaseModel
from typing import Optional
from datetime import datetime, timezone, date
import calendar as _cal
from collections import defaultdict
from auth import require_admin
from odoo_client import get_odoo_client
from database import col, NO_ID

router = APIRouter(prefix="/api/targets", tags=["targets"])


class TargetUpsert(BaseModel):
    target_revenue: float = 0.0
    target_orders:  int   = 0
    notes:          Optional[str] = ""


# ── Helpers ───────────────────────────────────────────────────────────────────

def _fy_months(today: date) -> list:
    """SA FY: March Y → February Y+1. Returns list of (year, month) tuples."""
    fy_start_year = today.year if today.month >= 3 else today.year - 1
    months = [(fy_start_year, m) for m in range(3, 13)]
    months += [(fy_start_year + 1, m) for m in range(1, 3)]
    return months

def _fy_label(today: date) -> str:
    y = today.year if today.month >= 3 else today.year - 1
    return f"FY{y}/{str(y + 1)[2:]}"

def _month_name(year: int, month: int) -> str:
    return date(year, month, 1).strftime("%b %Y")


# ── Endpoints ─────────────────────────────────────────────────────────────────

@router.get("/current")
async def current_target(_: dict = Depends(require_admin)):
    """Current month's target + live actuals from Odoo — used by the dashboard tile."""
    today = date.today()
    odoo  = get_odoo_client()

    target = await col("monthly_targets").find_one(
        {"year": today.year, "month": today.month}, NO_ID
    )

    last_day   = _cal.monthrange(today.year, today.month)[1]
    from_date  = f"{today.year}-{today.month:02d}-01"
    to_date    = f"{today.year}-{today.month:02d}-{last_day:02d}"

    actual_revenue = 0.0
    actual_orders  = 0
    try:
        orders = odoo.search_read(
            "sale.order",
            domain=[
                ("state", "in", ["sale", "done"]),
                ("date_order", ">=", from_date),
                ("date_order", "<=", to_date),
            ],
            fields=["amount_total"],
            limit=5000,
        )
        actual_revenue = sum(o["amount_total"] for o in orders)
        actual_orders  = len(orders)
    except Exception:
        pass

    return {
        "year":           today.year,
        "month":          today.month,
        "month_name":     today.strftime("%B %Y"),
        "days_elapsed":   today.day,
        "days_in_month":  last_day,
        "target_revenue": target["target_revenue"] if target else None,
        "target_orders":  target["target_orders"]  if target else None,
        "notes":          target.get("notes", "")  if target else "",
        "actual_revenue": actual_revenue,
        "actual_orders":  actual_orders,
    }


@router.get("/")
async def list_targets(_: dict = Depends(require_admin)):
    """
    All 12 months of the current SA FY with targets + actuals.
    Fetches all FY orders from Odoo in a single call and groups by month.
    """
    today     = date.today()
    odoo      = get_odoo_client()
    fy_months = _fy_months(today)

    # ── Targets from MongoDB ──────────────────────────────────────────────────
    fy_years  = list({y for y, _ in fy_months})
    raw_targets = await col("monthly_targets").find(
        {"year": {"$in": fy_years}}, NO_ID
    ).to_list(50)
    target_map  = {(t["year"], t["month"]): t for t in raw_targets}

    # ── Actuals from Odoo (single query for the whole FY) ────────────────────
    fy_start_str = f"{fy_months[0][0]}-{fy_months[0][1]:02d}-01"
    last_fy_y, last_fy_m = fy_months[-1]
    last_fy_day  = _cal.monthrange(last_fy_y, last_fy_m)[1]
    fy_end_str   = f"{last_fy_y}-{last_fy_m:02d}-{last_fy_day:02d}"

    monthly_actuals: dict = defaultdict(lambda: {"revenue": 0.0, "orders": 0})
    try:
        all_orders = odoo.search_read(
            "sale.order",
            domain=[
                ("state", "in", ["sale", "done"]),
                ("date_order", ">=", fy_start_str),
                ("date_order", "<=", fy_end_str),
            ],
            fields=["amount_total", "date_order"],
            limit=50000,
        )
        for o in all_orders:
            ds = (o.get("date_order") or "")[:10]
            if len(ds) == 10:
                dt = datetime.strptime(ds, "%Y-%m-%d")
                k  = (dt.year, dt.month)
                monthly_actuals[k]["revenue"] += o["amount_total"]
                monthly_actuals[k]["orders"]  += 1
    except Exception:
        pass

    # ── Build result ──────────────────────────────────────────────────────────
    results = []
    for (y, m) in fy_months:
        first_of_month = date(y, m, 1)
        is_future  = first_of_month > today.replace(day=1)
        is_current = y == today.year and m == today.month
        days_in    = _cal.monthrange(y, m)[1]
        tgt        = target_map.get((y, m))

        actual_revenue = monthly_actuals[(y, m)]["revenue"] if not is_future else None
        actual_orders  = monthly_actuals[(y, m)]["orders"]  if not is_future else None

        target_revenue = tgt["target_revenue"] if tgt else None
        target_orders  = tgt["target_orders"]  if tgt else None

        rev_pct = round(actual_revenue / target_revenue * 100, 1) if (target_revenue and actual_revenue is not None) else None
        ord_pct = round(actual_orders  / target_orders  * 100, 1) if (target_orders  and actual_orders  is not None) else None

        results.append({
            "year":           y,
            "month":          m,
            "month_name":     _month_name(y, m),
            "is_current":     is_current,
            "is_future":      is_future,
            "days_elapsed":   today.day if is_current else (days_in if not is_future else 0),
            "days_in_month":  days_in,
            "target_revenue": target_revenue,
            "target_orders":  target_orders,
            "notes":          tgt.get("notes", "") if tgt else "",
            "actual_revenue": actual_revenue,
            "actual_orders":  actual_orders,
            "revenue_pct":    rev_pct,
            "orders_pct":     ord_pct,
        })

    return {"fy_label": _fy_label(today), "months": results}


@router.put("/{year}/{month}")
async def upsert_target(
    year:  int,
    month: int,
    body:  TargetUpsert,
    current_user: dict = Depends(require_admin),
):
    """Create or update a monthly revenue and order-count target."""
    if not (1 <= month <= 12):
        raise HTTPException(status_code=400, detail="Invalid month")

    await col("monthly_targets").update_one(
        {"year": year, "month": month},
        {"$set": {
            "year":           year,
            "month":          month,
            "target_revenue": body.target_revenue,
            "target_orders":  body.target_orders,
            "notes":          body.notes or "",
            "updated_at":     datetime.now(timezone.utc),
            "updated_by":     current_user.get("username", ""),
        }},
        upsert=True,
    )
    return {"success": True}
