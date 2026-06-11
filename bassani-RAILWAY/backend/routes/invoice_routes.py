from fastapi import APIRouter, Depends, HTTPException, Query
from typing import Optional, List
from pydantic import BaseModel
from datetime import date as date_type
from auth import get_current_user, require_admin
from odoo_client import get_odoo_client, odoo as odoo_call
from database import col, NO_ID

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
async def list_invoices(
    move_type: Optional[str] = None,
    state: Optional[str] = None,
    payment_state: Optional[str] = None,
    search: Optional[str] = None,
    limit: int = Query(25, le=200),
    offset: int = 0,
    sort_by: str = Query("invoice_date"),
    sort_dir: str = Query("desc"),
    current_user: dict = Depends(get_current_user),
):
    """List invoices from Odoo. Resellers only see invoices for their own orders."""
    _SORTABLE = {"invoice_date", "invoice_date_due", "name", "amount_total", "amount_residual"}
    sort_by  = sort_by  if sort_by  in _SORTABLE       else "invoice_date"
    sort_dir = sort_dir if sort_dir in ("asc", "desc") else "desc"

    odoo = get_odoo_client()
    domain = [("move_type", "=", move_type)] if move_type else [("move_type", "=", "out_invoice"), ("state", "=", "posted")]
    if state:
        domain.append(("state", "=", state))
    if payment_state:
        if payment_state == "unpaid":
            domain.append(("payment_state", "in", ["not_paid", "partial"]))
        else:
            domain.append(("payment_state", "=", payment_state))
    if search:
        domain.append("|")
        domain.append(("name", "ilike", search))
        domain.append(("partner_id.name", "ilike", search))

    # Reseller: restrict to invoices where they are the customer in Odoo
    if current_user.get("role") == "reseller":
        reseller = await col("resellers").find_one({"user_id": current_user["id"]}, NO_ID)
        odoo_partner_id = reseller.get("odoo_partner_id") if reseller else None
        if not odoo_partner_id:
            return {"invoices": [], "total": 0}
        domain.append(("partner_id", "=", odoo_partner_id))

    try:
        invoices = odoo.search_read(
            "account.move",
            domain=domain,
            fields=INVOICE_FIELDS,
            limit=limit,
            offset=offset,
            order=f"{sort_by} {sort_dir}",
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


@router.get("/payment-journals")
def list_payment_journals(current_user: dict = Depends(require_admin)):
    """
    Return bank and cash journals with enough detail to distinguish between them.
    Fetches code + bank_account_id so the frontend can show account numbers
    instead of the generic 'Bank' label that all bank journals share.
    """
    odoo = get_odoo_client()
    try:
        journals = odoo.search_read(
            "account.journal",
            domain=[("type", "in", ["bank", "cash"]), ("active", "=", True)],
            fields=["id", "name", "type", "code", "bank_account_id", "company_id"],
            limit=50,
            order="company_id asc, type asc, name asc",
        )

        # Build a label that uniquely identifies each journal:
        # Prefer bank account number, fall back to code, always append company name
        # when there are multiple companies so the admin can tell them apart.
        company_ids = {j["company_id"][0] for j in journals if j.get("company_id")}
        multi_company = len(company_ids) > 1

        for j in journals:
            bank_account = j.get("bank_account_id")
            acc_display  = bank_account[1] if bank_account and bank_account is not False else None
            base         = acc_display or j.get("code") or j["name"]
            company_name = j["company_id"][1] if j.get("company_id") else None
            j["display_label"] = f"{base} — {company_name}" if (multi_company and company_name) else base

        return {"journals": journals}
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
        odoo.execute("account.move", "action_post", [invoice_id])
        return {"success": True}
    except Exception as e:
        raise HTTPException(status_code=400, detail=f"Odoo error: {str(e)}")


@router.put("/{invoice_id}/reset")
def reset_invoice(invoice_id: int, current_user: dict = Depends(require_admin)):
    """Reset a posted invoice back to draft."""
    odoo = get_odoo_client()
    try:
        odoo.execute("account.move", "button_draft", [invoice_id])
        return {"success": True}
    except Exception as e:
        raise HTTPException(status_code=400, detail=f"Odoo error: {str(e)}")


class PaymentRegister(BaseModel):
    journal_id: int
    payment_date: Optional[str] = None   # ISO date string, defaults to today
    amount: Optional[float] = None       # defaults to full outstanding amount


@router.put("/{invoice_id}/pay")
def register_payment(
    invoice_id: int,
    body: PaymentRegister,
    current_user: dict = Depends(require_admin),
):
    """
    Register a payment against an invoice using Odoo's account.payment.register wizard.
    Creates the payment and reconciles it with the invoice in one step.
    """
    odoo = get_odoo_client()
    payment_date = body.payment_date or date_type.today().isoformat()

    # Resolve outstanding amount if not provided
    amount = body.amount
    if amount is None:
        records = odoo.read("account.move", [invoice_id], fields=["amount_residual"])
        if not records:
            raise HTTPException(status_code=404, detail="Invoice not found")
        amount = records[0]["amount_residual"]

    try:
        # Create the payment register wizard in the context of this invoice
        wizard_id = odoo_call(
            "account.payment.register",
            "create",
            [{"journal_id": body.journal_id, "payment_date": payment_date, "amount": amount}],
            {"context": {
                "active_model": "account.move",
                "active_ids": [invoice_id],
                "active_id": invoice_id,
            }},
        )
        # Apply: creates the payment and reconciles it against the invoice
        odoo_call(
            "account.payment.register",
            "action_create_payments",
            [[wizard_id]],
            {},
        )
        return {"success": True}
    except Exception as e:
        raise HTTPException(status_code=400, detail=f"Odoo error: {str(e)}")
