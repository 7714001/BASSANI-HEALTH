from fastapi import APIRouter, Depends, HTTPException, Query
from typing import Optional, List
from pydantic import BaseModel
from datetime import datetime, timezone
from auth import get_current_user, require_permission
from odoo_client import get_odoo_client, OdooClient, odoo as odoo_call
from database import col, NO_ID
from middleware.audit import audit_log
from warehouse_context import resolve_warehouse_id, odoo_context
from credit import credit_status

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

class StatusUpdate(BaseModel):
    status: str                                 # Pending|Processing|Shipped|Delivered


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

        # Batch-fetch linked Sales tickets so the Orders table can show pipeline status
        order_ids = [o["id"] for o in orders]
        ticket_map: dict = {}
        if order_ids:
            async for t in col("tickets").find(
                {"order_id": {"$in": order_ids}, "type": "sales"},
                {"order_id": 1, "status": 1, "exit_status": 1},
            ):
                ticket_map[t["order_id"]] = {
                    "id": str(t["_id"]),
                    "status": t.get("exit_status") or t.get("status"),
                    "exit_status": t.get("exit_status"),
                }
        for order in orders:
            order["linked_ticket"] = ticket_map.get(order["id"])

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

        # Fetch partner address + VAT for order view header
        if order.get("partner_id"):
            partners = odoo.read(
                "res.partner", [order["partner_id"][0]],
                fields=["name", "street", "street2", "city", "zip", "state_id", "country_id", "vat"],
            )
            if partners:
                order["partner_detail"] = partners[0]

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

    Tax is intentionally never set on the order line payload below — Odoo's
    `sale.order.line.tax_id` is a stored compute field (`@api.depends`, not
    just an onchange), so it's resolved automatically from each product's own
    `taxes_id`/fiscal position the moment the line is created via RPC, the
    same as it would be from the Odoo UI. Overriding it here would risk
    fighting Odoo's own tax/fiscal-position logic instead of trusting it.
    """
    odoo = get_odoo_client()

    effective_partner_id = order.partner_id
    reseller_profile = None

    # Resolved once — used both for the stock check below and to tag the order
    # with the warehouse it should draw from (the reseller's assigned vault,
    # staff's fixed vault, or the admin's active top-nav selection).
    warehouse_id = await resolve_warehouse_id(current_user)

    if current_user.get("role") == "reseller":
        reseller_profile = await col("resellers").find_one(
            {"user_id": current_user["id"]}, NO_ID
        )
        if not reseller_profile:
            raise HTTPException(status_code=400, detail="Reseller account not found")
        if not order.partner_id or order.partner_id <= 0:
            raise HTTPException(status_code=400, detail="Select a customer to place the order for")
        order = order.model_copy(update={"reseller_id": reseller_profile["id"]})

    # Stock check — block the whole order if any line exceeds what's actually
    # available to promise (on-hand minus what's already reserved by other
    # orders), scoped to the resolved warehouse. The cart already disables
    # "Add to Order" for out-of-stock items, but this is the authoritative
    # check: it covers direct API calls and stock that changed after the cart
    # was loaded.
    product_ids = [l.product_id for l in order.order_line]
    try:
        stock_rows = odoo.read(
            "product.product", product_ids,
            fields=["display_name", "virtual_available"],
            context=odoo_context(warehouse_id),
        )
    except Exception as e:
        raise HTTPException(status_code=502, detail=f"Odoo error checking stock: {str(e)}")
    stock_map = {p["id"]: p for p in stock_rows}

    shortfalls = []
    for l in order.order_line:
        p = stock_map.get(l.product_id)
        available = p["virtual_available"] if p else 0
        if l.product_uom_qty > available:
            name = p["display_name"] if p else f"Product #{l.product_id}"
            shortfalls.append(f"{name} (requested {l.product_uom_qty:g}, only {available:g} available)")
    if shortfalls:
        raise HTTPException(
            status_code=400,
            detail="Not enough stock to fulfil this order: " + "; ".join(shortfalls),
        )

    # Credit check — non-blocking here, since an order is just a quotation
    # until an admin confirms it. Surfaces a warning early so the reseller/
    # admin sees it before confirm time, where it becomes a hard gate.
    order_subtotal = sum(l.product_uom_qty * l.price_unit for l in order.order_line)
    credit_warning = None
    credit_partner_name = ""
    try:
        partner_rows = odoo.read("res.partner", [effective_partner_id], fields=["name", "credit", "credit_limit"])
        if partner_rows:
            credit_partner_name = partner_rows[0].get("name", "")
            status = credit_status(
                partner_rows[0].get("credit") or 0,
                partner_rows[0].get("credit_limit") or 0,
                additional=order_subtotal,
            )
            if status["over_limit"]:
                credit_warning = status
    except Exception:
        pass  # Non-fatal — credit info shouldn't block placing a quotation

    lines = [
        (0, 0, {
            "product_id": l.product_id,
            "product_uom_qty": l.product_uom_qty,
            "price_unit": round(l.price_unit, 2),
            **({"name": l.name} if l.name else {}),
        })
        for l in order.order_line
    ]

    vals = {
        "partner_id": effective_partner_id,
        "order_line": lines,
        "note": order.note or "",
    }
    if warehouse_id:
        vals["warehouse_id"] = warehouse_id

    try:
        odoo_order_id = odoo.create("sale.order", vals)
    except Exception as e:
        raise HTTPException(status_code=400, detail=f"Odoo error: {str(e)}")

    # Auto-create a Sales ticket — unified pipeline: every portal order (reseller
    # or staff) enters the ticket workflow so the team processes everything in one
    # place. Best-effort / non-blocking: a failure here never blocks the order.
    try:
        _ticket_customer_name = credit_partner_name  # set by credit check above
        if not _ticket_customer_name:
            try:
                _p = odoo.read("res.partner", [effective_partner_id], fields=["name"])
                _ticket_customer_name = _p[0]["name"] if _p else ""
            except Exception:
                pass
        _now_t = datetime.now(timezone.utc)
        _role = current_user.get("role", "")
        _assigned = current_user["id"] if _role == "sales" else None
        _assigned_name = (
            (current_user.get("name") or current_user.get("username"))
            if _assigned else None
        )
        _note = (
            f"Portal order — reseller {order.reseller_id}"
            if order.reseller_id
            else f"Portal order — {_role} ({current_user.get('username', '')})"
        )
        await col("tickets").insert_one({
            "type": "sales",
            "source": "portal",
            "customer_id": effective_partner_id,
            "customer_name": _ticket_customer_name,
            "order_id": odoo_order_id,
            "invoice_id": None,
            "orders_ticket_ref": None,
            "status": "sale_order",
            "exit_status": None,
            "assigned_to": _assigned,
            "assigned_to_name": _assigned_name,
            "payment_confirmed_by": None,
            "payment_confirmed_at": None,
            "incomplete_reason": None,
            "stage_history": [{
                "status": "sale_order",
                "exit_status": None,
                "actor_id": current_user["id"],
                "actor_name": current_user.get("name") or current_user.get("username") or "unknown",
                "at": _now_t,
                "note": _note,
            }],
            "created_at": _now_t,
            "updated_at": _now_t,
        })
    except Exception as _te:
        print(f"⚠️  Auto-ticket creation failed for order {odoo_order_id}: {_te}")

    # Record order for commission tracking — amount calculated at month-end via tier bands
    if order.reseller_id:
        reseller = await col("resellers").find_one({"id": order.reseller_id}, NO_ID)
        reseller_name = reseller["name"] if reseller else ""

        customer_name = ""
        try:
            partners = odoo.read("res.partner", [effective_partner_id], fields=["name"])
            customer_name = partners[0]["name"] if partners else ""
        except Exception:
            pass

        original_subtotal = sum(l.product_uom_qty * l.price_unit for l in order.order_line)

        await col("order_commissions").insert_one({
            "odoo_order_id": str(odoo_order_id),
            "reseller_id": order.reseller_id,
            "reseller_name": reseller_name,
            "customer_partner_id": effective_partner_id,
            "customer_name": customer_name,
            "original_subtotal": original_subtotal,
            "commission_total": 0,      # Set when monthly statement is generated
            "payout_status": "pending",
            "created_at": datetime.now(timezone.utc),
        })

        await col("resellers").update_one(
            {"id": order.reseller_id},
            {"$inc": {"total_sales": original_subtotal}},
        )

    await audit_log("order.create", "order", odoo_order_id, entity_label=customer_name if order.reseller_id else "",
                    user=current_user, after={"partner_id": effective_partner_id, "lines": len(order.order_line)},
                    reseller_id=order.reseller_id)

    if credit_warning:
        await audit_log("order.credit_warning", "order", odoo_order_id, entity_label=credit_partner_name,
                        user=current_user, detail=credit_warning, reseller_id=order.reseller_id)

    return {"success": True, "odoo_order_id": odoo_order_id, "credit_warning": credit_warning}


@router.put("/{order_id}/confirm")
async def confirm_order(
    order_id: int,
    override_credit: bool = Query(False),
    current_user: dict = Depends(require_permission("orders.confirm")),
):
    """
    Confirm a quotation. On success, three further steps run in sequence:
      1. Create + post the customer invoice (out_invoice) in Odoo
      2. Create + post a reseller commission vendor bill (in_invoice) if applicable
      3. Queue the order on the packing board
    Steps 2–4 are non-fatal: failures are returned as warnings so the admin can
    resolve them manually in Odoo without needing to re-confirm.
    """
    odoo = get_odoo_client()
    warnings: List[str] = []

    # ── Step 0: Credit check — hard gate unless explicitly overridden ──────────
    # Unlike the warning at order creation, this blocks: confirming commits to
    # an invoice, so it's the point where being over limit actually matters.
    try:
        pre_rows = odoo.read("sale.order", [order_id], fields=["partner_id", "amount_total"])
    except Exception as e:
        raise HTTPException(status_code=502, detail=f"Could not read order: {str(e)}")
    if not pre_rows:
        raise HTTPException(status_code=404, detail="Order not found")
    partner = pre_rows[0].get("partner_id")
    if partner:
        partner_rows = odoo.read("res.partner", [partner[0]], fields=["credit", "credit_limit"])
        if partner_rows:
            status = credit_status(
                partner_rows[0].get("credit") or 0,
                partner_rows[0].get("credit_limit") or 0,
                additional=pre_rows[0].get("amount_total") or 0,
            )
            if status["over_limit"] and not override_credit:
                await audit_log("order.credit_block", "order", order_id, entity_label=partner[1],
                                user=current_user, detail=status)
                raise HTTPException(
                    status_code=402,
                    detail=f"{partner[1]} is over their credit limit by R{status['shortfall']:.2f} "
                           f"(credit R{status['credit']:.2f} of R{status['credit_limit']:.2f} limit). "
                           "An admin must explicitly override to confirm this order.",
                )
            if status["over_limit"] and override_credit:
                await audit_log("order.credit_override", "order", order_id, entity_label=partner[1],
                                user=current_user, detail=status)

    # ── Step 1: Confirm (hard fail — nothing else runs if this fails) ──────────
    try:
        odoo.execute("sale.order", "action_confirm", [order_id])
    except Exception as e:
        raise HTTPException(status_code=400, detail=f"Could not confirm order: {str(e)}")

    # Read order data needed by all subsequent steps
    order_data = None
    try:
        rows = odoo.read(
            "sale.order",
            [order_id],
            fields=["name", "partner_id", "picking_ids", "note", "warehouse_id"],
        )
        order_data = rows[0] if rows else None
    except Exception as e:
        warnings.append(f"Could not read order after confirm: {str(e)}")

    # ── Step 2: Customer invoice — create and post ─────────────────────────────
    invoice_id: Optional[int] = None
    invoice_name: Optional[str] = None
    try:
        # Use the advance payment wizard — the only public XML-RPC route for
        # creating invoices from a sale order (_create_invoices is private).
        ctx = {"active_ids": [order_id], "active_model": "sale.order", "active_id": order_id}
        wizard_id = odoo_call(
            "sale.advance.payment.inv", "create",
            [{"advance_payment_method": "delivered"}],
            {"context": ctx},
        )
        odoo_call(
            "sale.advance.payment.inv", "create_invoices",
            [[wizard_id]],
            {"context": ctx},
        )

        refreshed = odoo.read("sale.order", [order_id], fields=["invoice_ids"])
        inv_ids = refreshed[0].get("invoice_ids", []) if refreshed else []
        invoice_id = inv_ids[0] if inv_ids else None

        if invoice_id:
            odoo.execute("account.move", "action_post", [invoice_id])
            inv_rows = odoo.read("account.move", [invoice_id], fields=["name"])
            invoice_name = inv_rows[0]["name"] if inv_rows else None
        else:
            warnings.append(
                "Customer invoice could not be created automatically — "
                "please create it manually from the sale order in Odoo."
            )
    except Exception as e:
        warnings.append(
            f"Invoice creation failed: {str(e)} — "
            "create the customer invoice manually in Odoo."
        )

    # ── Step 3: Packing board (non-blocking) ─────────────────────────────────
    try:
        if order_data and order_data.get("picking_ids"):
            picking_id = order_data["picking_ids"][0]
            pickings = odoo.read(
                "stock.picking",
                [picking_id],
                fields=["name", "origin", "move_ids"],
            )
            picking = pickings[0] if pickings else None

            if picking:
                items = []
                if picking.get("move_ids"):
                    moves = odoo.read(
                        "stock.move",
                        picking["move_ids"],
                        fields=["product_id", "product_uom_qty", "product_uom"],
                    )
                    for m in moves:
                        pname = m["product_id"][1] if m.get("product_id") else "Unknown"
                        prod = (
                            odoo.read("product.product", [m["product_id"][0]], fields=["default_code"])
                            if m.get("product_id") else []
                        )
                        sku = prod[0].get("default_code") or str(m["product_id"][0]) if prod else ""
                        items.append({"name": pname, "sku": sku, "qty": m["product_uom_qty"], "location": ""})

                partner_name = order_data["partner_id"][1] if order_data.get("partner_id") else ""
                comm_data = await col("order_commissions").find_one(
                    {"odoo_order_id": str(order_id)}, NO_ID
                )
                is_reseller_order = bool(comm_data)
                reseller_name_val = comm_data.get("reseller_name") if comm_data else None

                from routes.packing_board_routes import manager
                now = datetime.now(timezone.utc)
                doc = {
                    "order_id": str(order_id),
                    "warehouse_id": order_data["warehouse_id"][0] if order_data.get("warehouse_id") else None,
                    "customer_name": partner_name,
                    "customer_city": "",
                    "items": items,
                    "total_units": int(sum(i["qty"] for i in items)),
                    "inv_num": invoice_name or "",
                    "dn_num": picking["name"],
                    "ps_num": order_data["name"],
                    "notes": order_data.get("note") or "",
                    "is_reseller": is_reseller_order,
                    "reseller_name": reseller_name_val,
                    "packer_name": None,
                    "status": "queued",
                    "queued_at": now,
                    "packed_at": None,
                    "ready_at": None,
                    "collected_at": None,
                    "cancelled_at": None,
                    "incomplete_at": None,
                    "completed_at": None,
                    "incomplete_reason": None,
                    "qa_approved_by": None, "qa_approved_at": None,
                    "rp_approved_by": None, "rp_approved_at": None,
                    "item_ticks": {i["sku"]: False for i in items},
                }
                await col("packing_board").replace_one({"order_id": str(order_id)}, doc, upsert=True)
                await manager.broadcast({"type": "entry_update", "data": {**doc, "queued_at": now.isoformat()}})

                # Phase 8.4 — hand off to the linked Sales ticket, if one exists.
                # The Orders side has no separate collection (see packing_board
                # above); orders_ticket_ref just flags that the handoff happened.
                sales_ticket = await col("tickets").find_one(
                    {"type": "sales", "order_id": order_id, "exit_status": None}
                )
                if sales_ticket:
                    await col("tickets").update_one(
                        {"_id": sales_ticket["_id"]},
                        {
                            "$set": {"status": "confirmed_wip", "orders_ticket_ref": str(order_id), "updated_at": now},
                            "$push": {"stage_history": {
                                "status": "confirmed_wip", "exit_status": None,
                                "actor_id": None, "actor_name": "system",
                                "at": now, "note": "Auto-linked to Orders on order confirmation",
                            }},
                        },
                    )
    except Exception as e:
        print(f"⚠️  Packing board auto-queue failed for order {order_id}: {e}")

    comm_lookup = await col("order_commissions").find_one({"odoo_order_id": str(order_id)}, NO_ID)
    await audit_log("order.confirm", "order", order_id,
                    entity_label=order_data.get("name", "") if order_data else "",
                    user=current_user,
                    detail={"invoice_id": invoice_id, "invoice_name": invoice_name, "warnings": warnings},
                    reseller_id=comm_lookup.get("reseller_id") if comm_lookup else None)

    return {
        "success": True,
        "invoice_id": invoice_id,
        "invoice_name": invoice_name,
        "warnings": warnings,
    }


@router.put("/{order_id}/cancel")
async def cancel_order(order_id: int, current_user: dict = Depends(require_permission("orders.cancel"))):
    """Cancel a sales order in Odoo and void the related commission record.
    Only quotations (draft/sent) may be cancelled — a confirmed order already has
    an invoice and possibly a packing board entry in flight, so it must be handled
    manually rather than silently voided."""
    odoo = get_odoo_client()
    rows = odoo.read("sale.order", [order_id], fields=["state"])
    if not rows:
        raise HTTPException(status_code=404, detail="Order not found")
    if rows[0]["state"] not in ("draft", "sent"):
        raise HTTPException(
            status_code=400,
            detail="Only quotations (not yet confirmed) can be cancelled this way",
        )
    try:
        odoo.execute("sale.order", "action_cancel", [order_id])
    except Exception as e:
        raise HTTPException(status_code=400, detail=f"Odoo error: {str(e)}")

    comm_lookup = await col("order_commissions").find_one({"odoo_order_id": str(order_id)}, NO_ID)

    # Void the commission record so it never appears in the payout queue
    await col("order_commissions").update_one(
        {"odoo_order_id": str(order_id), "payout_status": "pending"},
        {"$set": {
            "payout_status": "cancelled",
            "cancelled_at": datetime.now(timezone.utc),
            "cancelled_by": current_user.get("username", "admin"),
        }},
    )
    await audit_log("order.cancel", "order", order_id, user=current_user,
                    reseller_id=comm_lookup.get("reseller_id") if comm_lookup else None)
    return {"success": True}


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
