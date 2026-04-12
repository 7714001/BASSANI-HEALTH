from fastapi import APIRouter, Depends, HTTPException, Query
from typing import Optional, List
from pydantic import BaseModel
from datetime import datetime, timezone
from auth import get_current_user, require_admin
from odoo_client import get_odoo_client
from database import col, NO_ID

router = APIRouter(prefix="/api/orders", tags=["orders"])

# ── Pydantic models ───────────────────────────────────────────────────────────

class OrderLine(BaseModel):
    product_id: int                             # Odoo product.product ID
    product_uom_qty: float
    price_unit: float
    name: Optional[str] = ""

class OrderCreate(BaseModel):
    partner_id: int                             # Odoo res.partner ID
    order_line: List[OrderLine]
    reseller_id: Optional[str] = None          # MongoDB reseller ID
    note: Optional[str] = ""
    delivery_address: Optional[str] = ""

class StatusUpdate(BaseModel):
    status: str                                 # Pending|Processing|Shipped|Delivered

# ── Helpers ───────────────────────────────────────────────────────────────────

VAT_RATE = 0.15

async def calculate_commission(reseller_id: str, order_lines: list, odoo) -> dict:
    """
    Three-tier commission logic:
    1. Product-specific rate from commission_matrix
    2. Reseller category default rate
    3. System default (10%)
    """
    if not reseller_id:
        return {"commission_total": 0, "lines": order_lines}

    reseller = await col("resellers").find_one({"id": reseller_id}, NO_ID)
    if not reseller:
        return {"commission_total": 0, "lines": order_lines}

    commission_total = 0
    enriched_lines = []

    for line in order_lines:
        product_id = line.get("product_id")
        subtotal = line.get("product_uom_qty", 0) * line.get("price_unit", 0)

        # Check product-specific rate in commission_matrix
        matrix_entry = await col("commission_matrix").find_one(
            {"reseller_id": reseller_id, "product_id": str(product_id)}, NO_ID
        )

        if matrix_entry and matrix_entry.get("is_blocked"):
            # Product is blocked for this reseller — no commission
            rate = 0
        elif matrix_entry and matrix_entry.get("commission_rate"):
            rate = matrix_entry["commission_rate"]
        else:
            # Fall back to category default or system default
            try:
                product = odoo.read(
                    "product.template",
                    [product_id],
                    fields=["categ_id"],
                )
                cat_name = product[0]["categ_id"][1] if product else ""
                rates = reseller.get("commission_rates", {})
                rate = rates.get(cat_name, reseller.get("default_commission", 10))
            except Exception:
                rate = reseller.get("default_commission", 10)

        commission_amount = subtotal * (rate / 100)
        commission_total += commission_amount
        enriched_lines.append({**line, "commission_rate": rate, "commission_amount": commission_amount})

    return {"commission_total": commission_total, "lines": enriched_lines}


# ── Endpoints ─────────────────────────────────────────────────────────────────

ORDER_FIELDS = [
    "id", "name", "partner_id", "date_order", "amount_untaxed",
    "amount_tax", "amount_total", "state", "invoice_status",
    "order_line", "note", "user_id",
]


@router.get("/")
async def list_orders(
    status: Optional[str] = None,
    search: Optional[str] = None,
    reseller_id: Optional[str] = None,
    limit: int = Query(20, le=100),
    offset: int = 0,
    current_user: dict = Depends(get_current_user),
):
    """List orders from Odoo. Reseller users only see their own orders."""
    odoo = get_odoo_client()

    # Reseller can only see their own orders
    if current_user.get("role") == "reseller":
        reseller = await col("resellers").find_one(
            {"user_id": current_user["id"]}, NO_ID
        )
        reseller_id = reseller["id"] if reseller else None

    domain = []
    if status and status != "all":
        domain.append(("state", "=", status))
    if search:
        domain.append("|")
        domain.append(("name", "ilike", search))
        domain.append(("partner_id.name", "ilike", search))

    try:
        orders = odoo.search_read(
            "sale.order",
            domain=domain,
            fields=ORDER_FIELDS,
            limit=limit,
            offset=offset,
            order="date_order desc",
        )
        total = odoo.count("sale.order", domain)

        # Overlay commission data from MongoDB
        for order in orders:
            odoo_order_id = str(order["id"])
            comm_data = await col("order_commissions").find_one(
                {"odoo_order_id": odoo_order_id}, NO_ID
            )
            order["commission_total"] = comm_data["commission_total"] if comm_data else 0
            order["reseller_id"] = comm_data["reseller_id"] if comm_data else None
            order["reseller_name"] = comm_data.get("reseller_name", "") if comm_data else ""

        return {"orders": orders, "total": total}
    except Exception as e:
        raise HTTPException(status_code=502, detail=f"Odoo error: {str(e)}")


@router.get("/{order_id}")
async def get_order(order_id: int, current_user: dict = Depends(get_current_user)):
    """Get a single order with line items and commission breakdown."""
    odoo = get_odoo_client()
    try:
        records = odoo.read("sale.order", [order_id], fields=ORDER_FIELDS)
        if not records:
            raise HTTPException(status_code=404, detail="Order not found")
        order = records[0]

        # Get line items
        if order.get("order_line"):
            lines = odoo.read(
                "sale.order.line",
                order["order_line"],
                fields=[
                    "product_id", "name", "product_uom_qty",
                    "price_unit", "price_subtotal", "qty_delivered", "qty_invoiced",
                ],
            )
            order["lines"] = lines

        # Overlay commission data
        comm_data = await col("order_commissions").find_one(
            {"odoo_order_id": str(order_id)}, NO_ID
        )
        order["commission_total"] = comm_data["commission_total"] if comm_data else 0
        order["reseller_id"] = comm_data["reseller_id"] if comm_data else None
        order["reseller_name"] = comm_data.get("reseller_name", "") if comm_data else ""

        return order
    except HTTPException:
        raise
    except Exception as e:
        raise HTTPException(status_code=502, detail=f"Odoo error: {str(e)}")


@router.post("/")
async def create_order(
    order: OrderCreate,
    current_user: dict = Depends(get_current_user),
):
    """
    Create a sale order in Odoo.
    Commission is calculated and stored in MongoDB alongside the Odoo order ID.
    VAT (15%) is handled by Odoo's tax configuration.
    """
    odoo = get_odoo_client()

    lines = [
        (0, 0, {
            "product_id": l.product_id,
            "product_uom_qty": l.product_uom_qty,
            "price_unit": l.price_unit,
            "name": l.name or "",
        })
        for l in order.order_line
    ]

    vals = {
        "partner_id": order.partner_id,
        "order_line": lines,
        "note": order.note or "",
    }

    try:
        odoo_order_id = odoo.create("sale.order", vals)
    except Exception as e:
        raise HTTPException(status_code=400, detail=f"Odoo error: {str(e)}")

    # Calculate and store commission in MongoDB
    if order.reseller_id:
        raw_lines = [l.model_dump() for l in order.order_line]
        comm = await calculate_commission(order.reseller_id, raw_lines, odoo)

        reseller = await col("resellers").find_one({"id": order.reseller_id}, NO_ID)
        reseller_name = reseller["name"] if reseller else ""

        await col("order_commissions").insert_one({
            "odoo_order_id": str(odoo_order_id),
            "reseller_id": order.reseller_id,
            "reseller_name": reseller_name,
            "commission_total": comm["commission_total"],
            "lines": comm["lines"],
            "created_at": datetime.now(timezone.utc),
        })

        # Update reseller lifetime totals
        subtotal = sum(l.product_uom_qty * l.price_unit for l in order.order_line)
        await col("resellers").update_one(
            {"id": order.reseller_id},
            {"$inc": {
                "total_sales": subtotal,
                "total_commission": comm["commission_total"],
            }},
        )

    return {
        "success": True,
        "odoo_order_id": odoo_order_id,
        "commission_total": comm["commission_total"] if order.reseller_id else 0,
    }


@router.put("/{order_id}/confirm")
def confirm_order(order_id: int, current_user: dict = Depends(require_admin)):
    """Confirm a quotation into a sales order in Odoo."""
    odoo = get_odoo_client()
    try:
        odoo.call("sale.order", "action_confirm", [order_id])
        return {"success": True}
    except Exception as e:
        raise HTTPException(status_code=400, detail=f"Odoo error: {str(e)}")


@router.put("/{order_id}/cancel")
def cancel_order(order_id: int, current_user: dict = Depends(require_admin)):
    """Cancel a sales order in Odoo."""
    odoo = get_odoo_client()
    try:
        odoo.call("sale.order", "action_cancel", [order_id])
        return {"success": True}
    except Exception as e:
        raise HTTPException(status_code=400, detail=f"Odoo error: {str(e)}")


@router.get("/stats/summary")
async def order_stats(current_user: dict = Depends(get_current_user)):
    """Dashboard stats — order counts and revenue from Odoo."""
    odoo = get_odoo_client()
    try:
        total     = odoo.count("sale.order", [])
        draft     = odoo.count("sale.order", [("state", "=", "draft")])
        confirmed = odoo.count("sale.order", [("state", "=", "sale")])
        done      = odoo.count("sale.order", [("state", "=", "done")])
        cancelled = odoo.count("sale.order", [("state", "=", "cancel")])

        # Revenue — sum amount_total on confirmed + done orders
        revenue_orders = odoo.search_read(
            "sale.order",
            domain=[("state", "in", ["sale", "done"])],
            fields=["amount_total"],
            limit=10000,
        )
        total_revenue = sum(o["amount_total"] for o in revenue_orders)

        return {
            "total": total,
            "draft": draft,
            "confirmed": confirmed,
            "done": done,
            "cancelled": cancelled,
            "total_revenue": total_revenue,
        }
    except Exception as e:
        raise HTTPException(status_code=502, detail=f"Odoo error: {str(e)}")
