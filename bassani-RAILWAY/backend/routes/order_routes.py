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
    partner_id: int                             # Odoo res.partner ID (customer)
    order_line: List[OrderLine]
    reseller_id: Optional[str] = None          # MongoDB reseller ID
    note: Optional[str] = ""
    delivery_address: Optional[str] = ""
    commission_override: Optional[float] = None # Reseller can reduce their rate to pass savings to customer

class StatusUpdate(BaseModel):
    status: str                                 # Pending|Processing|Shipped|Delivered

# ── Helpers ───────────────────────────────────────────────────────────────────

VAT_RATE = 0.15
COMMISSION_CAP = 12.5    # System-wide hard cap — no reseller can earn more than this %

async def calculate_commission(reseller_id: str, order_lines: list, odoo, override_rate: Optional[float] = None) -> dict:
    """
    Commission logic:
    1. override_rate (per-order reseller adjustment) — if provided, applies to all lines
    2. Product-specific rate from commission_matrix (admin-set exception for specific products)
    3. Flat system cap (12.5%) for everything else
    Commission is always calculated on the original list price, regardless of any customer discount applied.
    """
    if not reseller_id:
        return {"commission_total": 0, "lines": order_lines}

    commission_total = 0
    enriched_lines = []

    for line in order_lines:
        product_id = line.get("product_id")
        subtotal = line.get("product_uom_qty", 0) * line.get("price_unit", 0)

        if override_rate is not None:
            rate = override_rate
        else:
            matrix_entry = await col("commission_matrix").find_one(
                {"reseller_id": reseller_id, "product_id": str(product_id)}, NO_ID
            )
            if matrix_entry and matrix_entry.get("is_blocked"):
                rate = 0
            elif matrix_entry and matrix_entry.get("commission_rate") is not None:
                rate = matrix_entry["commission_rate"]
            else:
                rate = COMMISSION_CAP

        rate = min(rate, COMMISSION_CAP)
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
    sort_by: str = Query("date_order"),
    sort_dir: str = Query("desc"),
    current_user: dict = Depends(get_current_user),
):
    """List orders from Odoo. Reseller users only see their own orders."""
    _SORTABLE = {"date_order", "name", "amount_untaxed", "amount_total"}
    sort_by  = sort_by  if sort_by  in _SORTABLE          else "date_order"
    sort_dir = sort_dir if sort_dir in ("asc", "desc")    else "desc"
    odoo = get_odoo_client()

    allowed_odoo_ids: Optional[list] = None

    # Reseller can only see their own orders
    if current_user.get("role") == "reseller":
        reseller = await col("resellers").find_one(
            {"user_id": current_user["id"]}, NO_ID
        )
        reseller_id = reseller["id"] if reseller else None
        commission_records = await col("order_commissions").find(
            {"reseller_id": reseller_id}, NO_ID
        ).to_list(length=10000)
        allowed_odoo_ids = [int(r["odoo_order_id"]) for r in commission_records]
        if not allowed_odoo_ids:
            return {"orders": [], "total": 0}

    domain = []
    if allowed_odoo_ids is not None:
        domain.append(("id", "in", allowed_odoo_ids))
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
            order=f"{sort_by} {sort_dir}",
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
        # Reseller access check — must own this order
        if current_user.get("role") == "reseller":
            reseller = await col("resellers").find_one(
                {"user_id": current_user["id"]}, NO_ID
            )
            reseller_id = reseller["id"] if reseller else None
            comm_check = await col("order_commissions").find_one(
                {"odoo_order_id": str(order_id), "reseller_id": reseller_id}, NO_ID
            )
            if not comm_check:
                raise HTTPException(status_code=403, detail="Access denied")

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

    effective_partner_id = order.partner_id
    reseller_profile = None
    override_rate = None

    if current_user.get("role") == "reseller":
        reseller_profile = await col("resellers").find_one(
            {"user_id": current_user["id"]}, NO_ID
        )
        if not reseller_profile:
            raise HTTPException(status_code=400, detail="Reseller account not found")
        if not order.partner_id or order.partner_id <= 0:
            raise HTTPException(status_code=400, detail="Select a customer to place the order for")
        # Pin reseller_id so commission is always recorded
        order = order.model_copy(update={"reseller_id": reseller_profile["id"]})

        # Validate and apply commission override — capped at system hard cap (12.5%)
        if order.commission_override is not None:
            override_rate = max(0.0, min(float(order.commission_override), COMMISSION_CAP))

    # Discount to customer = gap between system cap (12.5%) and chosen rate
    # Bassani's net is constant at list_price × (1 − COMMISSION_CAP%)
    discount_factor = 1.0
    if override_rate is not None and reseller_profile:
        discount_pct = COMMISSION_CAP - override_rate
        discount_factor = 1.0 - (discount_pct / 100.0)

    lines = [
        (0, 0, {
            "product_id": l.product_id,
            "product_uom_qty": l.product_uom_qty,
            "price_unit": round(l.price_unit * discount_factor, 2),
            "name": l.name or "",
        })
        for l in order.order_line
    ]

    vals = {
        "partner_id": effective_partner_id,
        "order_line": lines,
        "note": order.note or "",
    }

    try:
        odoo_order_id = odoo.create("sale.order", vals)
    except Exception as e:
        raise HTTPException(status_code=400, detail=f"Odoo error: {str(e)}")

    # Calculate and store commission in MongoDB
    comm = {"commission_total": 0, "lines": []}
    if order.reseller_id:
        raw_lines = [l.model_dump() for l in order.order_line]
        comm = await calculate_commission(order.reseller_id, raw_lines, odoo, override_rate=override_rate)

        reseller = await col("resellers").find_one({"id": order.reseller_id}, NO_ID)
        reseller_name = reseller["name"] if reseller else ""

        # Resolve customer name for the record
        customer_name = ""
        try:
            partners = odoo.read("res.partner", [effective_partner_id], fields=["name"])
            customer_name = partners[0]["name"] if partners else ""
        except Exception:
            pass

        original_subtotal = sum(l.product_uom_qty * l.price_unit for l in order.order_line)
        adjusted_subtotal = round(original_subtotal * discount_factor, 2)

        await col("order_commissions").insert_one({
            "odoo_order_id": str(odoo_order_id),
            "reseller_id": order.reseller_id,
            "reseller_name": reseller_name,
            "customer_partner_id": effective_partner_id,
            "customer_name": customer_name,
            "original_subtotal": original_subtotal,
            "adjusted_subtotal": adjusted_subtotal,
            "commission_rate_override": override_rate,
            "commission_total": comm["commission_total"],
            "payout_status": "pending",
            "lines": comm["lines"],
            "created_at": datetime.now(timezone.utc),
        })

        # Update reseller lifetime totals
        await col("resellers").update_one(
            {"id": order.reseller_id},
            {"$inc": {
                "total_sales": original_subtotal,
                "total_commission": comm["commission_total"],
            }},
        )

    return {
        "success": True,
        "odoo_order_id": odoo_order_id,
        "commission_total": comm["commission_total"],
    }


@router.put("/{order_id}/confirm")
async def confirm_order(order_id: int, current_user: dict = Depends(require_admin)):
    """Confirm a quotation into a sales order in Odoo, then auto-queue the pink slip."""
    odoo = get_odoo_client()
    try:
        odoo.execute("sale.order", "action_confirm", [order_id])
    except Exception as e:
        raise HTTPException(status_code=400, detail=f"Odoo error: {str(e)}")

    # Auto-queue pink slip to packing board — non-blocking, never fails the confirmation
    try:
        orders = odoo.read(
            "sale.order",
            [order_id],
            fields=["name", "partner_id", "picking_ids", "invoice_ids", "note"],
        )
        order_data = orders[0] if orders else None

        if order_data and order_data.get("picking_ids"):
            picking_id = order_data["picking_ids"][0]
            pickings = odoo.read(
                "stock.picking",
                [picking_id],
                fields=["name", "origin", "move_ids"],
            )
            picking = pickings[0] if pickings else None

            if picking:
                # Read move lines for item detail
                items = []
                if picking.get("move_ids"):
                    moves = odoo.read(
                        "stock.move",
                        picking["move_ids"],
                        fields=["product_id", "product_uom_qty", "product_uom"],
                    )
                    for m in moves:
                        pname = m["product_id"][1] if m.get("product_id") else "Unknown"
                        # derive SKU from product default_code if available
                        prod = odoo.read("product.product", [m["product_id"][0]], fields=["default_code"]) if m.get("product_id") else []
                        sku = prod[0].get("default_code") or str(m["product_id"][0]) if prod else ""
                        items.append({
                            "name": pname,
                            "sku": sku,
                            "qty": m["product_uom_qty"],
                            "location": "",
                        })

                partner_name = order_data["partner_id"][1] if order_data.get("partner_id") else ""
                inv_num = ""
                if order_data.get("invoice_ids"):
                    invs = odoo.read("account.move", [order_data["invoice_ids"][0]], fields=["name"])
                    inv_num = invs[0]["name"] if invs else ""

                # Resolve reseller info from commission record
                comm_data = await col("order_commissions").find_one(
                    {"odoo_order_id": str(order_id)}, NO_ID
                )
                is_reseller = bool(comm_data)
                reseller_name = comm_data.get("reseller_name") if comm_data else None

                entry = {
                    "order_id": str(order_id),
                    "customer_name": partner_name,
                    "customer_city": "",
                    "items": items,
                    "total_units": int(sum(i["qty"] for i in items)),
                    "inv_num": inv_num,
                    "dn_num": picking["name"],
                    "ps_num": order_data["name"],
                    "notes": order_data.get("note") or "",
                    "is_reseller": is_reseller,
                    "reseller_name": reseller_name,
                }
                # Import here to avoid circular dependency at module load time
                from routes.packing_board_routes import manager
                now = datetime.now(timezone.utc)
                doc = {**entry, "packer_name": None, "status": "queued", "queued_at": now,
                       "packed_at": None, "ready_at": None, "collected_at": None,
                       "item_ticks": {i["sku"]: False for i in items}}
                await col("packing_board").replace_one(
                    {"order_id": str(order_id)}, doc, upsert=True
                )
                await manager.broadcast({"type": "entry_update", "data": {
                    **doc, "queued_at": now.isoformat()
                }})
    except Exception as e:
        print(f"⚠️  Packing board auto-queue failed for order {order_id}: {e}")

    return {"success": True}


@router.put("/{order_id}/cancel")
def cancel_order(order_id: int, current_user: dict = Depends(require_admin)):
    """Cancel a sales order in Odoo."""
    odoo = get_odoo_client()
    try:
        odoo.execute("sale.order", "action_cancel", [order_id])
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
