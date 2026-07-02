from fastapi import APIRouter, Depends, HTTPException, Query
from typing import Optional
from auth import get_current_user, require_permission
from odoo_client import get_odoo_client

router = APIRouter(prefix="/api/suppliers", tags=["suppliers"])

SUPPLIER_FIELDS = [
    "id", "name", "ref", "email", "phone", "street", "city", "zip",
    "country_id", "supplier_rank", "customer_rank", "vat",
    "property_supplier_payment_term_id", "active",
]


def _normalise(record: dict) -> dict:
    for k, v in record.items():
        if v is False:
            record[k] = None
    pt = record.pop("property_supplier_payment_term_id", None)
    record["payment_term_name"] = pt[1] if pt else None
    record["payment_term_id"]   = pt[0] if pt else None
    cid = record.get("country_id")
    record["country_name"] = cid[1] if cid else None
    record["country_id"]   = cid[0] if cid else None
    return record


@router.get("/")
async def list_suppliers(
    search: Optional[str] = None,
    limit: int = Query(100, le=200),
    offset: int = 0,
    current_user: dict = Depends(require_permission("suppliers.view")),
):
    odoo = get_odoo_client()
    domain: list = [("supplier_rank", ">", 0), ("active", "=", True)]
    if search:
        domain += ["|", ("name", "ilike", search), ("email", "ilike", search)]
    try:
        suppliers = odoo.search_read(
            "res.partner",
            domain=domain,
            fields=SUPPLIER_FIELDS,
            limit=limit,
            offset=offset,
            order="name asc",
        )
        for s in suppliers:
            _normalise(s)
        total = odoo.count("res.partner", domain)
        return {"suppliers": suppliers, "total": total}
    except Exception as e:
        raise HTTPException(status_code=502, detail=f"Odoo error: {str(e)}")


@router.get("/{supplier_id}/profile")
async def supplier_profile(
    supplier_id: int,
    current_user: dict = Depends(require_permission("suppliers.view")),
):
    odoo = get_odoo_client()

    # Partner info
    records = odoo.read("res.partner", [supplier_id], fields=SUPPLIER_FIELDS)
    if not records:
        raise HTTPException(status_code=404, detail="Supplier not found")
    supplier = _normalise(records[0])
    if not (supplier.get("supplier_rank") or 0) > 0:
        raise HTTPException(status_code=404, detail="Supplier not found")

    # Vendor bills (posted — includes credit notes)
    vendor_bills = odoo.search_read(
        "account.move",
        domain=[
            ("partner_id", "=", supplier_id),
            ("move_type", "in", ["in_invoice", "in_refund"]),
            ("state", "=", "posted"),
        ],
        fields=["id", "name", "invoice_date", "invoice_date_due",
                "amount_total", "amount_residual", "payment_state", "move_type"],
        limit=50,
        order="invoice_date desc",
    )
    for b in vendor_bills:
        for k, v in b.items():
            if v is False:
                b[k] = None

    # Purchase orders
    purchase_orders = odoo.search_read(
        "purchase.order",
        domain=[("partner_id", "=", supplier_id)],
        fields=["id", "name", "date_order", "date_approve",
                "amount_untaxed", "amount_total", "state"],
        limit=50,
        order="date_order desc",
    )
    for po in purchase_orders:
        for k, v in po.items():
            if v is False:
                po[k] = None

    # Goods receipts (completed incoming pickings)
    receipts = odoo.search_read(
        "stock.picking",
        domain=[
            ("partner_id", "=", supplier_id),
            ("picking_type_code", "=", "incoming"),
            ("state", "=", "done"),
        ],
        fields=["id", "name", "scheduled_date", "date_done", "origin", "state"],
        limit=50,
        order="date_done desc",
    )
    for r in receipts:
        for k, v in r.items():
            if v is False:
                r[k] = None

    # Products supplied (via product.supplierinfo)
    supplierinfos = odoo.search_read(
        "product.supplierinfo",
        domain=[("partner_id", "=", supplier_id)],
        fields=["product_tmpl_id"],
        limit=200,
    )
    seen: set = set()
    tmpl_ids: list = []
    for si in supplierinfos:
        tmpl = si.get("product_tmpl_id")
        if tmpl and tmpl[0] not in seen:
            seen.add(tmpl[0])
            tmpl_ids.append(tmpl[0])

    products_supplied: list = []
    if tmpl_ids:
        tmpl_records = odoo.read(
            "product.template",
            tmpl_ids,
            fields=["id", "name", "default_code", "active", "type"],
        )
        for t in tmpl_records:
            for k, v in t.items():
                if v is False:
                    t[k] = None
        products_supplied = sorted(tmpl_records, key=lambda x: x.get("name") or "")

    # Stats
    confirmed_pos = [po for po in purchase_orders if po.get("state") in ("purchase", "done")]
    unpaid_bills  = [b for b in vendor_bills
                     if b.get("move_type") == "in_invoice"
                     and b.get("payment_state") in ("not_paid", "partial")]

    stats = {
        "total_purchase_orders": len(confirmed_pos),
        "total_po_spend":        sum((po.get("amount_total") or 0) for po in confirmed_pos),
        "outstanding_balance":   sum((b.get("amount_residual") or 0) for b in unpaid_bills),
        "open_bills":            len(unpaid_bills),
        "goods_receipts":        len(receipts),
        "products_supplied":     len(products_supplied),
    }

    return {
        "supplier":          supplier,
        "stats":             stats,
        "vendor_bills":      vendor_bills,
        "purchase_orders":   purchase_orders,
        "receipts":          receipts,
        "products_supplied": products_supplied,
    }
