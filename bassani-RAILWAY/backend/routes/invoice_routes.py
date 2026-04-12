from fastapi import APIRouter, Depends, HTTPException, Query
from typing import Optional, List
from pydantic import BaseModel
from auth import get_current_user, require_admin
from odoo_client import get_odoo_client

router = APIRouter(prefix="/api/invoices", tags=["invoices"])

# ── Pydantic models ───────────────────────────────────────────────────────────

class InvoiceLine(BaseModel):
    name: str
    quantity: float = 1.0
    price_unit: float
    product_id: Optional[int] = None

class InvoiceCreate(BaseModel):
    partner_id: int
    move_type: str = "out_invoice"          # out_invoice|in_invoice|out_refund
    invoice_date: Optional[str] = None
    invoice_line_ids: List[InvoiceLine]
    narration: Optional[str] = ""

# ── Shared fields ─────────────────────────────────────────────────────────────

INVOICE_FIELDS = [
    "id", "name", "partner_id", "invoice_date", "invoice_date_due",
    "amount_total", "amount_tax", "amount_residual",
    "state", "move_type", "payment_state",
]

INVOICE_DOMAIN = [("move_type", "in", ["out_invoice", "in_invoice", "out_refund", "in_refund"])]

# ── Endpoints ─────────────────────────────────────────────────────────────────

@router.get("/")
def list_invoices(
    move_type: Optional[str] = None,
    state: Optional[str] = None,
    search: Optional[str] = None,
    limit: int = Query(20, le=100),
    offset: int = 0,
    current_user: dict = Depends(get_current_user),
):
    """List invoices and bills from Odoo."""
    odoo = get_odoo_client()
    domain = INVOICE_DOMAIN.copy()
    if move_type:
        domain = [("move_type", "=", move_type)]
    if state:
        domain.append(("state", "=", state))
    if search:
        domain.append(("name", "ilike", search))
    try:
        invoices = odoo.search_read(
            "account.move",
            domain=domain,
            fields=INVOICE_FIELDS,
            limit=limit,
            offset=offset,
            order="invoice_date desc",
        )
        total = odoo.count("account.move", domain)
        return {"invoices": invoices, "total": total}
    except Exception as e:
        raise HTTPException(status_code=502, detail=f"Odoo error: {str(e)}")


@router.get("/summary")
def invoice_summary(current_user: dict = Depends(get_current_user)):
    """Dashboard invoice stats — counts and outstanding balance."""
    odoo = get_odoo_client()
    try:
        customer_invoices = odoo.count("account.move", [("move_type", "=", "out_invoice")])
        vendor_bills      = odoo.count("account.move", [("move_type", "=", "in_invoice")])
        unpaid            = odoo.count("account.move", [
            ("move_type", "in", ["out_invoice", "in_invoice"]),
            ("payment_state", "=", "not_paid"),
            ("state", "=", "posted"),
        ])
        overdue_invoices = odoo.search_read(
            "account.move",
            domain=[
                ("move_type", "=", "out_invoice"),
                ("payment_state", "=", "not_paid"),
                ("state", "=", "posted"),
            ],
            fields=["amount_residual"],
            limit=5000,
        )
        overdue_amount = sum(i["amount_residual"] for i in overdue_invoices)

        return {
            "customer_invoices": customer_invoices,
            "vendor_bills": vendor_bills,
            "unpaid": unpaid,
            "overdue_amount": overdue_amount,
        }
    except Exception as e:
        raise HTTPException(status_code=502, detail=f"Odoo error: {str(e)}")


@router.get("/{invoice_id}")
def get_invoice(invoice_id: int, current_user: dict = Depends(get_current_user)):
    """Get a single invoice with line items."""
    odoo = get_odoo_client()
    try:
        records = odoo.read(
            "account.move",
            [invoice_id],
            fields=INVOICE_FIELDS + ["invoice_line_ids", "narration"],
        )
        if not records:
            raise HTTPException(status_code=404, detail="Invoice not found")
        invoice = records[0]

        if invoice.get("invoice_line_ids"):
            lines = odoo.read(
                "account.move.line",
                invoice["invoice_line_ids"],
                fields=["product_id", "name", "quantity", "price_unit", "price_subtotal"],
            )
            invoice["lines"] = [l for l in lines if l.get("name")]

        return invoice
    except HTTPException:
        raise
    except Exception as e:
        raise HTTPException(status_code=502, detail=f"Odoo error: {str(e)}")


@router.post("/")
def create_invoice(
    invoice: InvoiceCreate,
    current_user: dict = Depends(require_admin),
):
    """Create an invoice in Odoo. Admin only."""
    odoo = get_odoo_client()
    lines = []
    for l in invoice.invoice_line_ids:
        line_vals = {"name": l.name, "quantity": l.quantity, "price_unit": l.price_unit}
        if l.product_id:
            line_vals["product_id"] = l.product_id
        lines.append((0, 0, line_vals))

    vals = {
        "partner_id": invoice.partner_id,
        "move_type": invoice.move_type,
        "invoice_line_ids": lines,
        "narration": invoice.narration or "",
    }
    if invoice.invoice_date:
        vals["invoice_date"] = invoice.invoice_date

    try:
        invoice_id = odoo.create("account.move", vals)
        return {"success": True, "invoice_id": invoice_id}
    except Exception as e:
        raise HTTPException(status_code=400, detail=f"Odoo error: {str(e)}")


@router.put("/{invoice_id}/post")
def post_invoice(invoice_id: int, current_user: dict = Depends(require_admin)):
    """Post/validate an invoice in Odoo."""
    odoo = get_odoo_client()
    try:
        odoo.call("account.move", "action_post", [invoice_id])
        return {"success": True}
    except Exception as e:
        raise HTTPException(status_code=400, detail=f"Odoo error: {str(e)}")


@router.put("/{invoice_id}/reset")
def reset_invoice(invoice_id: int, current_user: dict = Depends(require_admin)):
    """Reset a posted invoice back to draft."""
    odoo = get_odoo_client()
    try:
        odoo.call("account.move", "button_draft", [invoice_id])
        return {"success": True}
    except Exception as e:
        raise HTTPException(status_code=400, detail=f"Odoo error: {str(e)}")
