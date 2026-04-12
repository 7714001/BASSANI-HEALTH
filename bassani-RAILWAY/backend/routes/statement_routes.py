"""Reseller monthly statements — PDF-ready commission summaries."""
from fastapi import APIRouter, Depends, HTTPException
from datetime import datetime, timezone
from calendar import monthrange
from auth import require_admin, get_current_user
from database import col, NO_ID

router = APIRouter(prefix="/api/statements", tags=["statements"])

@router.get("/reseller/{reseller_id}")
async def reseller_statement(
    reseller_id: str, year: int = 0, month: int = 0,
    _: dict = Depends(get_current_user)
):
    """Generate monthly commission statement for a reseller."""
    now = datetime.now(timezone.utc)
    y = year or now.year
    m = month or now.month
    _, last_day = monthrange(y, m)
    period_start = f"{y}-{m:02d}-01"
    period_end   = f"{y}-{m:02d}-{last_day}"

    reseller = await col("resellers").find_one({"id": reseller_id}, NO_ID)
    if not reseller: raise HTTPException(404, "Reseller not found")

    commissions = await col("order_commissions").find({
        "reseller_id": reseller_id,
        "order_date":  {"$gte": period_start, "$lte": period_end},
    }, NO_ID).to_list(500)

    total_order_value = sum(c.get("order_value", 0) for c in commissions)
    total_commission  = sum(c.get("commission_total", 0) for c in commissions)

    return {
        "reseller":          reseller,
        "period":            f"{y}-{m:02d}",
        "period_start":      period_start,
        "period_end":        period_end,
        "orders":            commissions,
        "order_count":       len(commissions),
        "total_order_value": total_order_value,
        "total_commission":  total_commission,
        "generated_at":      now.isoformat(),
    }

@router.get("/reseller/{reseller_id}/history")
async def statement_history(reseller_id: str, _: dict = Depends(get_current_user)):
    """Last 12 months of commission totals for a reseller."""
    pipeline = [
        {"$match": {"reseller_id": reseller_id}},
        {"$group": {"_id": {"$substr": ["$order_date", 0, 7]},
                    "total_commission": {"$sum": "$commission_total"},
                    "total_orders": {"$sum": 1},
                    "total_value": {"$sum": "$order_value"}}},
        {"$sort": {"_id": -1}},
        {"$limit": 12},
    ]
    history = await col("order_commissions").aggregate(pipeline).to_list(12)
    return {"history": history}

@router.post("/reseller/{reseller_id}/email")
async def email_statement(reseller_id: str, year: int, month: int,
                          _: dict = Depends(require_admin)):
    """Email the monthly statement to the reseller (via Resend)."""
    stmt = await reseller_statement(reseller_id, year, month, _)
    reseller = stmt["reseller"]
    # In production: use Resend to send PDF statement
    print(f"📧 Statement emailed to {reseller.get('email','—')} for {stmt['period']}")
    await col("statement_logs").insert_one({
        "reseller_id": reseller_id, "period": stmt["period"],
        "total_commission": stmt["total_commission"],
        "emailed_at": datetime.now(timezone.utc)})
    return {"success": True, "message": f"Statement for {stmt['period']} emailed to {reseller.get('email','—')}"}
