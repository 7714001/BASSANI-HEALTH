"""Aged debtors — unpaid Odoo invoices bucketed by days overdue."""
from fastapi import APIRouter, Depends
from datetime import datetime, timezone
from auth import require_admin
from odoo_client import odoo_execute_kw

router = APIRouter(prefix="/api/aged-debtors", tags=["aged-debtors"])

def _days(due_str: str) -> int:
    if not due_str: return 0
    try:
        due = datetime.strptime(due_str, "%Y-%m-%d").date()
        return max((datetime.now(timezone.utc).date() - due).days, 0)
    except Exception: return 0

def _bucket(days: int) -> str:
    if days <= 30: return "0_30"
    if days <= 60: return "31_60"
    if days <= 90: return "61_90"
    return "90_plus"

@router.get("/")
async def aged_debtors(_: dict = Depends(require_admin)):
    invoices = odoo_execute_kw("account.move", "search_read",
        [[["move_type","=","out_invoice"],["payment_state","in",["not_paid","partial"]],["state","=","posted"]]],
        {"fields":["name","partner_id","invoice_date","invoice_date_due","amount_total","amount_residual","payment_state"],"limit":500})
    buckets = {"0_30":[],"31_60":[],"61_90":[],"90_plus":[]}
    totals  = {"0_30":0, "31_60":0, "61_90":0, "90_plus":0}
    grand   = 0
    for inv in invoices:
        days = _days(inv.get("invoice_date_due",""))
        b = _bucket(days)
        rec = {"invoice_id":inv["id"],"invoice_num":inv["name"],
               "customer":inv["partner_id"][1] if inv.get("partner_id") else "—",
               "invoice_date":inv.get("invoice_date"),"due_date":inv.get("invoice_date_due"),
               "days_overdue":days,"total":inv["amount_total"],
               "outstanding":inv["amount_residual"],"payment_state":inv["payment_state"]}
        buckets[b].append(rec); totals[b] += inv["amount_residual"]; grand += inv["amount_residual"]
    return {"buckets":buckets,"totals":totals,"grand_total":grand,"invoice_count":len(invoices)}

@router.get("/summary")
async def summary(_: dict = Depends(require_admin)):
    r = await aged_debtors(_)
    return {"grand_total":r["grand_total"],"invoice_count":r["invoice_count"],
            "critical":r["totals"]["90_plus"],"overdue":r["totals"]["61_90"]+r["totals"]["90_plus"]}
