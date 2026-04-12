"""Demand forecasting — velocity-based stock predictions from Odoo order history."""
from fastapi import APIRouter, Depends
from datetime import datetime, timezone, timedelta
from auth import require_admin, get_current_user
from odoo_client import odoo_execute_kw

router = APIRouter(prefix="/api/forecast", tags=["forecast"])

@router.get("/")
async def demand_forecast(weeks_history: int = 12, _: dict = Depends(get_current_user)):
    """
    For each product, calculate:
    - Average weekly sales velocity
    - Days until stockout at current rate
    - Recommended reorder quantity
    """
    since = (datetime.now(timezone.utc) - timedelta(weeks=weeks_history)).strftime("%Y-%m-%d")

    # Get confirmed order lines from Odoo
    lines = odoo_execute_kw("sale.order.line", "search_read",
        [[["order_id.state","in",["sale","done"]],["order_id.date_order",">=",since]]],
        {"fields":["product_id","product_uom_qty","order_id"],"limit":2000})

    # Get current stock
    products = odoo_execute_kw("product.template","search_read",
        [[["type","=","product"],["active","=",True]]],
        {"fields":["id","name","qty_available","virtual_available"],"limit":200})

    prod_map = {p["id"]: p for p in products}

    # Aggregate weekly velocity per product
    velocity: dict = {}
    for line in lines:
        pid = line["product_id"][0] if line.get("product_id") else None
        if not pid: continue
        velocity[pid] = velocity.get(pid, 0) + line["product_uom_qty"]

    forecasts = []
    for pid, total_sold in velocity.items():
        prod = prod_map.get(pid)
        if not prod: continue
        weekly_velocity = total_sold / max(weeks_history, 1)
        daily_velocity  = weekly_velocity / 7
        stock = prod.get("qty_available", 0)
        days_until_out  = round(stock / daily_velocity) if daily_velocity > 0 else 999
        recommended_qty = round(weekly_velocity * 4)  # 4 weeks buffer
        forecasts.append({
            "product_id":         pid,
            "product_name":       prod["name"],
            "current_stock":      stock,
            "weekly_velocity":    round(weekly_velocity, 1),
            "days_until_stockout": days_until_out,
            "recommended_reorder": recommended_qty,
            "alert":              days_until_out <= 14,
            "critical":           days_until_out <= 7,
        })

    forecasts.sort(key=lambda x: x["days_until_stockout"])
    alerts  = [f for f in forecasts if f["alert"]]
    critical = [f for f in forecasts if f["critical"]]

    return {
        "forecasts":      forecasts,
        "alerts":         alerts,
        "critical":       critical,
        "weeks_analysed": weeks_history,
        "generated_at":   datetime.now(timezone.utc).isoformat(),
    }

@router.get("/alerts")
async def forecast_alerts(_: dict = Depends(get_current_user)):
    """Quick list of products needing attention within 14 days."""
    r = await demand_forecast(12, _)
    return {"alerts": r["alerts"], "critical_count": len(r["critical"])}
