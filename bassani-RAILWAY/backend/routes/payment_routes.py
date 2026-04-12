"""Record payments against Odoo invoices and sync reconciliation."""
from fastapi import APIRouter, Depends, HTTPException
from pydantic import BaseModel
from typing import Optional
from datetime import datetime, timezone
from auth import require_admin, get_current_user
from database import col, NO_ID
from odoo_client import odoo_execute_kw

router = APIRouter(prefix="/api/payments", tags=["payments"])

class PaymentIn(BaseModel):
    invoice_id: int
    invoice_num: str
    customer_name: str
    amount: float
    payment_date: str          # YYYY-MM-DD
    method: str = "EFT"        # EFT | Cash | Card
    reference: str = ""
    notes: str = ""

class PartialPaymentIn(BaseModel):
    invoice_id: int
    amount: float
    payment_date: str
    reference: str = ""

@router.post("/record")
async def record_payment(p: PaymentIn, current_user: dict = Depends(require_admin)):
    """Post a payment to Odoo and log to MongoDB."""
    # Register payment in Odoo
    try:
        journal_id = odoo_execute_kw("account.journal","search",
            [[["type","=","bank"],["company_id.active","=",True]]],{"limit":1})
        if journal_id:
            payment_vals = {
                "payment_type": "inbound",
                "partner_type": "customer",
                "amount": p.amount,
                "date": p.payment_date,
                "journal_id": journal_id[0],
                "ref": p.reference or p.invoice_num,
                "memo": p.notes,
            }
            pay_id = odoo_execute_kw("account.payment","create",[[payment_vals]])
            odoo_execute_kw("account.payment","action_post",[[pay_id]])
    except Exception as e:
        # Log failure but don't block — manual reconcile in Odoo
        print(f"Odoo payment post failed: {e}")

    doc = {
        "invoice_id": p.invoice_id, "invoice_num": p.invoice_num,
        "customer_name": p.customer_name, "amount": p.amount,
        "payment_date": p.payment_date, "method": p.method,
        "reference": p.reference, "notes": p.notes,
        "recorded_by": current_user["username"],
        "created_at": datetime.now(timezone.utc),
    }
    await col("payments").insert_one(doc)
    return {"success": True, "message": f"Payment of R {p.amount:.2f} recorded against {p.invoice_num}"}

@router.get("/invoice/{invoice_id}")
async def payments_for_invoice(invoice_id: int, _: dict = Depends(get_current_user)):
    payments = await col("payments").find({"invoice_id":invoice_id}, NO_ID).to_list(100)
    total_paid = sum(p["amount"] for p in payments)
    return {"payments": payments, "total_paid": total_paid}

@router.get("/recent")
async def recent_payments(limit: int = 20, _: dict = Depends(require_admin)):
    payments = await col("payments").find({},NO_ID).sort("created_at",-1).limit(limit).to_list(limit)
    return {"payments": payments}
