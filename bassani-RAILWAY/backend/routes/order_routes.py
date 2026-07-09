import logging
from fastapi import APIRouter, BackgroundTasks, Depends, HTTPException, Query
from typing import Optional, List
from pydantic import BaseModel
from datetime import datetime, timezone
from auth import get_current_user, require_permission, ADMIN_ROLES
from odoo_client import get_odoo_client, OdooClient, odoo as odoo_call
from database import col, NO_ID
from middleware.audit import audit_log
from warehouse_context import resolve_warehouse_id, odoo_context, get_company_id, company_context
from credit import credit_status
from routes.settings_routes import get_email_routing
from services.email_service import (
    send_order_confirmed, send_order_cancelled,
    send_order_confirmed_partial, send_backorder_alert_internal,
)

logger = logging.getLogger(__name__)

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
    "order_line", "note", "user_id", "warehouse_id",
]


@router.get("/")
async def list_orders(
    status: Optional[str] = None,
    search: Optional[str] = None,
    partner_id: Optional[int] = None,
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
    if partner_id:
        # Resolve to the top-level company so orders placed against a child contact
        # (e.g. Stuart Oakes under Cannex) are still found.
        try:
            _pr = odoo.read("res.partner", [partner_id], fields=["commercial_partner_id"])
            if _pr and _pr[0].get("commercial_partner_id") and _pr[0]["commercial_partner_id"] is not False:
                partner_id = _pr[0]["commercial_partner_id"][0]
        except Exception:
            pass
        domain.append(("commercial_partner_id", "=", partner_id))
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

        # Batch-fetch packing board entries to surface pipeline status in the list
        packing_map: dict = {}
        if order_ids:
            async for pb in col("packing_board").find(
                {"order_id": {"$in": [str(oid) for oid in order_ids]}},
                {"order_id": 1, "status": 1},
            ):
                packing_map[pb["order_id"]] = pb.get("status")
        for order in orders:
            order["packing_status"] = packing_map.get(str(order["id"]))

        return {"orders": orders, "total": total}
    except Exception as e:
        raise HTTPException(status_code=502, detail=f"Odoo error: {str(e)}")


@router.get("/{order_id}")
async def get_order(order_id: int, current_user: dict = Depends(get_current_user)):
    """Get a single order with line items and commission breakdown."""
    odoo = get_odoo_client()
    try:
        # Reseller access check — must own this order.
        # Commission records only exist post-confirmation, so for draft quotes
        # we fall back to checking the sales ticket's reseller_id.
        if current_user.get("role") == "reseller":
            reseller = await col("resellers").find_one(
                {"user_id": current_user["id"]}, NO_ID
            )
            reseller_id = reseller["id"] if reseller else None
            comm_check = await col("order_commissions").find_one(
                {"odoo_order_id": str(order_id), "reseller_id": reseller_id}, NO_ID
            )
            if not comm_check:
                ticket_check = await col("tickets").find_one(
                    {"type": "sales", "order_id": order_id, "reseller_id": reseller_id},
                    {"_id": 1},
                )
                if not ticket_check:
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


# ── Deliveries (7.1 + 7.5) ───────────────────────────────────────────────────

_PICKING_STATE_LABEL = {
    "draft":     "Draft",
    "waiting":   "Waiting for Stock",
    "confirmed": "Confirmed",
    "assigned":  "Ready to Pick",
    "done":      "Delivered",
    "cancel":    "Cancelled",
}

@router.get("/{order_id}/deliveries")
async def get_order_deliveries(
    order_id: int,
    current_user: dict = Depends(get_current_user),
):
    """
    Return stock.picking records linked to a sale order, including move-line
    detail so callers can show partially delivered quantities (backorders).
    """
    odoo = get_odoo_client()
    try:
        orders = odoo.search_read(
            "sale.order",
            domain=[("id", "=", order_id)],
            fields=["picking_ids"],
            limit=1,
        )
    except Exception as e:
        raise HTTPException(status_code=502, detail=f"Odoo error: {str(e)}")

    if not orders or not orders[0].get("picking_ids"):
        return {"deliveries": [], "has_backorder": False, "count": 0}

    picking_ids = orders[0]["picking_ids"]
    try:
        pickings = odoo_call("stock.picking", "read", [picking_ids], {"fields": [
            "id", "name", "origin", "state", "scheduled_date", "date_done",
            "carrier_id", "carrier_tracking_ref", "backorder_id", "partner_id", "move_ids",
        ]})
    except Exception as e:
        raise HTTPException(status_code=502, detail=f"Odoo picking error: {str(e)}")

    all_move_ids = [mid for p in pickings for mid in p.get("move_ids", [])]
    move_by_picking: dict = {}
    if all_move_ids:
        try:
            moves = odoo_call("stock.move", "read", [all_move_ids], {"fields": [
                "id", "product_id", "product_uom_qty", "quantity_done", "picking_id", "state",
            ]})
            for m in moves:
                pid = m["picking_id"][0] if isinstance(m["picking_id"], list) else m["picking_id"]
                move_by_picking.setdefault(pid, []).append({
                    "product_id":   m["product_id"][0] if isinstance(m["product_id"], list) else m["product_id"],
                    "product_name": m["product_id"][1] if isinstance(m["product_id"], list) else "",
                    "qty_ordered":  m["product_uom_qty"],
                    "qty_done":     m["quantity_done"],
                })
        except Exception:
            pass  # move lines are informational — non-fatal

    has_backorder = False
    result = []
    for p in pickings:
        is_backorder = bool(p.get("backorder_id"))
        if is_backorder:
            has_backorder = True
        result.append({
            "id":           p["id"],
            "name":         p["name"],
            "origin":       p.get("origin"),
            "state":        p["state"],
            "state_label":  _PICKING_STATE_LABEL.get(p["state"], p["state"]),
            "scheduled_date": p.get("scheduled_date"),
            "date_done":    p.get("date_done"),
            "carrier":      p["carrier_id"][1] if isinstance(p.get("carrier_id"), list) and p["carrier_id"] else None,
            "tracking_ref": p.get("carrier_tracking_ref") or None,
            "is_backorder": is_backorder,
            "backorder_ref": p["backorder_id"][1] if isinstance(p.get("backorder_id"), list) and p["backorder_id"] else None,
            "lines":        move_by_picking.get(p["id"], []),
        })

    return {"deliveries": result, "has_backorder": has_backorder, "count": len(result)}


@router.get("/{order_id}/stock-check")
async def stock_check(order_id: int, current_user: dict = Depends(require_permission("orders.read"))):
    """Return per-line stock availability for a confirmed Odoo SO (before packing board entry is created).
    Used by the reseller pre-confirm modal so they see what will ship vs be backordered."""
    odoo = get_odoo_client()
    try:
        order_rows = odoo.read("sale.order", [order_id], fields=["name", "state", "picking_ids", "partner_id", "amount_total"])
    except Exception as e:
        raise HTTPException(status_code=502, detail=f"Odoo read failed: {e}")
    if not order_rows:
        raise HTTPException(status_code=404, detail="Order not found in Odoo")

    order = order_rows[0]
    if order["state"] not in ("draft", "sent", "sale"):
        raise HTTPException(status_code=400, detail="Order is not in a quotable state")

    picking_ids = order.get("picking_ids") or []
    lines = []
    is_partial = False

    if picking_ids:
        # SO already confirmed — read actual stock.move reservations
        pick_rows = odoo.read("stock.picking", [picking_ids[0]], fields=["move_ids"])
        move_ids = pick_rows[0]["move_ids"] if pick_rows and pick_rows[0].get("move_ids") else []
        if move_ids:
            moves = odoo.read(
                "stock.move", move_ids,
                fields=["product_id", "product_uom_qty", "reserved_availability"],
            )
            for m in moves:
                ordered = float(m.get("product_uom_qty", 0))
                reserved = float(m.get("reserved_availability", 0))
                short = ordered - reserved > 0
                if short:
                    is_partial = True
                lines.append({
                    "name": m["product_id"][1] if m.get("product_id") else "Unknown",
                    "qty_ordered": ordered,
                    "qty_available": reserved,
                    "qty_short": round(ordered - reserved, 4) if short else 0,
                    "will_backorder": short,
                })
    else:
        # Draft quote — read order lines and check on-hand stock
        ol_rows = odoo.search_read(
            "sale.order.line",
            [["order_id", "=", order_id]],
            fields=["product_id", "product_uom_qty", "qty_delivered"],
        )
        product_ids = [l["product_id"][0] for l in ol_rows if l.get("product_id")]
        quants = odoo.search_read(
            "stock.quant",
            [["product_id", "in", product_ids], ["location_id.usage", "=", "internal"]],
            fields=["product_id", "quantity", "reserved_quantity"],
        ) if product_ids else []
        available_by_product: dict = {}
        for q in quants:
            pid = q["product_id"][0]
            net = float(q.get("quantity", 0)) - float(q.get("reserved_quantity", 0))
            available_by_product[pid] = available_by_product.get(pid, 0.0) + net

        for l in ol_rows:
            if not l.get("product_id"):
                continue
            pid = l["product_id"][0]
            pname = l["product_id"][1]
            ordered = float(l.get("product_uom_qty", 0))
            avail = available_by_product.get(pid, 0.0)
            short = avail < ordered
            if short:
                is_partial = True
            lines.append({
                "name": pname,
                "qty_ordered": ordered,
                "qty_available": round(avail, 4),
                "qty_short": round(ordered - avail, 4) if short else 0,
                "will_backorder": short,
            })

    invoice_policy_block = False
    invoice_policy_blocked_products: list[str] = []
    if is_partial:
        try:
            if picking_ids:
                _ip = list({m["product_id"][0] for m in moves if m.get("product_id")})
            else:
                _ip = [l["product_id"][0] for l in ol_rows if l.get("product_id")]
            if _ip:
                prods = odoo.read("product.product", _ip, fields=["name", "invoice_policy"])
                invoice_policy_blocked_products = [p["name"] for p in prods if p.get("invoice_policy") == "order"]
                invoice_policy_block = bool(invoice_policy_blocked_products)
        except Exception:
            pass  # never block a user if the policy check itself fails

    return {
        "order_ref": order.get("name", f"#{order_id}"),
        "is_partial": is_partial,
        "lines": lines,
        "invoice_policy_block": invoice_policy_block,
        "invoice_policy_blocked_products": invoice_policy_blocked_products,
    }


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

    # Resolve individual contacts to their parent company. The company is the
    # account holder — orders and invoices must be against the company, not the
    # contact person. Odoo's commercial_partner_id field returns the top-level
    # company for any contact; it equals self for company-type partners.
    try:
        _cpr = odoo.read("res.partner", [effective_partner_id], fields=["commercial_partner_id"])
        if _cpr:
            _cp = _cpr[0].get("commercial_partner_id")
            if _cp and _cp is not False and _cp[0] != effective_partner_id:
                effective_partner_id = _cp[0]
    except Exception:
        pass  # Non-fatal — keep original partner_id if Odoo call fails

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

    cid = get_company_id(odoo, warehouse_id)

    vals = {
        "partner_id": effective_partner_id,
        "order_line": lines,
        "note": order.note or "",
    }
    if warehouse_id:
        vals["warehouse_id"] = warehouse_id

    try:
        odoo_order_id = odoo.create("sale.order", vals, context=company_context(cid) or None)
    except Exception as e:
        raise HTTPException(status_code=400, detail=f"Odoo error: {str(e)}")

    # Auto-create a Sales ticket — unified pipeline: every portal order (reseller
    # or staff) enters the ticket workflow so the team processes everything in one
    # place. Reseller orders start at 'quote' so the reseller can edit/send before
    # Bassani staff pick it up. Best-effort / non-blocking.
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
        _is_reseller_order = bool(order.reseller_id)
        _ticket_status = "quote" if _is_reseller_order else "sale_order"
        _assigned = current_user["id"] if _role == "sales" else None
        _assigned_name = (
            (current_user.get("name") or current_user.get("username"))
            if _assigned else None
        )
        _note = (
            f"Quote created by reseller {order.reseller_id}"
            if _is_reseller_order
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
            "status": _ticket_status,
            "exit_status": None,
            "reseller_id": order.reseller_id or None,
            "assigned_to": _assigned,
            "assigned_to_name": _assigned_name,
            "payment_confirmed_by": None,
            "payment_confirmed_at": None,
            "incomplete_reason": None,
            "stage_history": [{
                "status": _ticket_status,
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

    # Commission record, total_sales, and the "order placed" email are deferred
    # to confirm_order for reseller orders — the quote is a draft until confirmed
    # and may be cancelled or revised before then.

    await audit_log("order.create", "order", odoo_order_id, entity_label=credit_partner_name if order.reseller_id else "",
                    user=current_user, after={"partner_id": effective_partner_id, "lines": len(order.order_line)},
                    reseller_id=order.reseller_id)

    if credit_warning:
        await audit_log("order.credit_warning", "order", odoo_order_id, entity_label=credit_partner_name,
                        user=current_user, detail=credit_warning, reseller_id=order.reseller_id)

    return {"success": True, "odoo_order_id": odoo_order_id, "credit_warning": credit_warning}


async def _require_confirm_access(current_user: dict = Depends(get_current_user)) -> dict:
    """Allow staff with orders.confirm permission OR resellers (ownership checked in endpoint)."""
    if current_user.get("is_super_admin") or current_user.get("role") == "super_admin":
        return current_user
    if current_user.get("role") == "reseller":
        return current_user
    if current_user.get("role") not in ADMIN_ROLES:
        raise HTTPException(status_code=403, detail="Access denied")
    perms = current_user.get("permissions") or {}
    if perms.get("orders", {}).get("confirm"):
        return current_user
    raise HTTPException(status_code=403, detail="Access denied")


@router.put("/{order_id}/confirm")
async def confirm_order(
    order_id: int,
    background_tasks: BackgroundTasks,
    override_credit: bool = Query(False),
    current_user: dict = Depends(_require_confirm_access),
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

    # ── Reseller ownership check ───────────────────────────────────────────────
    # Resellers may only confirm their own quotes (those whose ticket carries their reseller_id).
    _sales_ticket = await col("tickets").find_one(
        {"type": "sales", "order_id": order_id, "exit_status": None}, {"reseller_id": 1}
    )
    if current_user.get("role") == "reseller":
        _res_doc = await col("resellers").find_one({"user_id": current_user["id"]}, {"id": 1, "_id": 0})
        _my_rid = _res_doc["id"] if _res_doc else None
        if not _my_rid or not _sales_ticket or _sales_ticket.get("reseller_id") != _my_rid:
            raise HTTPException(status_code=403, detail="Access denied")

    # ── Step 0: Credit check — hard gate unless explicitly overridden ──────────
    # Unlike the warning at order creation, this blocks: confirming commits to
    # an invoice, so it's the point where being over limit actually matters.
    try:
        pre_rows = odoo.read("sale.order", [order_id], fields=["partner_id", "amount_total", "amount_untaxed", "company_id", "warehouse_id", "name"])
    except Exception as e:
        raise HTTPException(status_code=502, detail=f"Could not read order: {str(e)}")
    if not pre_rows:
        raise HTTPException(status_code=404, detail="Order not found")
    _co = pre_rows[0].get("company_id")
    order_company_id = _co[0] if _co else None
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
        # action_confirm may return an action dict with None values that Odoo's
        # XML-RPC marshaller rejects, even though the confirm itself succeeded.
        # Verify the order state before treating this as a failure.
        try:
            state_check = odoo.read("sale.order", [order_id], fields=["state"])
            if state_check and state_check[0].get("state") == "sale":
                logger.warning("confirm_response_error_but_confirmed",
                               extra={"order_id": order_id, "error": str(e)})
            else:
                raise HTTPException(status_code=400, detail=f"Could not confirm order: {str(e)}")
        except HTTPException:
            raise
        except Exception:
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

    # Resolve reseller ID early — needed by both packing board and commission steps.
    _ticket_reseller_id = _sales_ticket.get("reseller_id") if _sales_ticket else None

    # ── Shortfall detection — check if all stock was reserved ─────────────────
    # Odoo reserves stock on confirm. If reserved_availability < product_uom_qty
    # on any move, the order can only be partially fulfilled. Invoice creation is
    # deferred to collection time for partial orders so we never invoice for goods
    # that haven't shipped yet.
    is_partial = False
    shortfalls: List[dict] = []
    try:
        if order_data and order_data.get("picking_ids"):
            _pick_for_check = order_data["picking_ids"][0]
            _pick_rows = odoo.read("stock.picking", [_pick_for_check], fields=["move_ids"])
            if _pick_rows and _pick_rows[0].get("move_ids"):
                _check_moves = odoo.read(
                    "stock.move", _pick_rows[0]["move_ids"],
                    fields=["product_id", "product_uom_qty", "reserved_availability"],
                )
                for _cm in _check_moves:
                    _ordered  = float(_cm.get("product_uom_qty", 0))
                    _reserved = float(_cm.get("reserved_availability", 0))
                    if _reserved < _ordered:
                        is_partial = True
                        shortfalls.append({
                            "name":          _cm["product_id"][1] if _cm.get("product_id") else "Unknown",
                            "qty_ordered":   _ordered,
                            "qty_available": _reserved,
                            "qty_short":     round(_ordered - _reserved, 4),
                        })
    except Exception as _se:
        logger.warning("confirm_shortfall_check_failed",
                       extra={"order_id": order_id, "error": str(_se)})

    # ── Step 2: Customer invoice — create and post ─────────────────────────────
    # Skipped for partial orders: invoicing is deferred to collection time so
    # we only invoice for what the customer actually receives in each delivery.
    invoice_id: Optional[int] = None
    invoice_name: Optional[str] = None
    if not is_partial:
        try:
            # Use the advance payment wizard — the only public XML-RPC route for
            # creating invoices from a sale order (_create_invoices is private).
            ctx = {
                "active_ids": [order_id], "active_model": "sale.order", "active_id": order_id,
                **company_context(order_company_id),
            }
            wizard_id = odoo_call(
                "sale.advance.payment.inv", "create",
                [{"advance_payment_method": "delivered"}],
                {"context": ctx},
            )
        except Exception as e:
            warnings.append(
                f"Invoice creation failed: {str(e)} — "
                "create the customer invoice manually in Odoo."
            )
            wizard_id = None

        if wizard_id is not None:
            try:
                odoo_call(
                    "sale.advance.payment.inv", "create_invoices",
                    [[wizard_id]],
                    {"context": ctx},
                )
            except Exception as e:
                logger.warning("confirm_create_invoices_response_error",
                               extra={"order_id": order_id, "error": str(e)})

            try:
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
                    f"Invoice post/read failed: {str(e)} — "
                    "check the invoice in Odoo."
                )
    else:
        warnings.append(
            "Invoice deferred: this order has items on backorder. "
            "An invoice will be created for each delivery at collection time."
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
                        fields=["product_id", "product_uom_qty", "reserved_availability", "product_uom"],
                    )
                    for m in moves:
                        pname = m["product_id"][1] if m.get("product_id") else "Unknown"
                        prod = (
                            odoo.read("product.product", [m["product_id"][0]], fields=["default_code"])
                            if m.get("product_id") else []
                        )
                        sku = prod[0].get("default_code") or str(m["product_id"][0]) if prod else ""
                        qty_ordered   = float(m.get("product_uom_qty", 0))
                        qty_reserved  = float(m.get("reserved_availability", qty_ordered))
                        items.append({
                            "name": pname, "sku": sku,
                            "qty": qty_ordered,           # backward-compat alias
                            "qty_ordered": qty_ordered,
                            "qty_reserved": qty_reserved,
                            "is_backordered": qty_reserved < qty_ordered,
                            "location": "",
                        })

                partner_name = order_data["partner_id"][1] if order_data.get("partner_id") else ""
                is_reseller_order = bool(_ticket_reseller_id)
                reseller_name_val = None
                if _ticket_reseller_id:
                    _res_pb = await col("resellers").find_one({"id": _ticket_reseller_id}, {"name": 1, "_id": 0})
                    reseller_name_val = _res_pb["name"] if _res_pb else None

                from routes.packing_board_routes import manager
                now = datetime.now(timezone.utc)
                doc = {
                    "order_id": str(order_id),
                    "odoo_picking_id": picking_id,
                    "picking_name": picking["name"],
                    "is_backorder": False,
                    "parent_packing_id": None,
                    "waiting_stock": False,
                    "has_pending_invoice": is_partial,
                    "warehouse_id":   order_data["warehouse_id"][0] if order_data.get("warehouse_id") else None,
                    "warehouse_name": order_data["warehouse_id"][1] if order_data.get("warehouse_id") else None,
                    "customer_name": partner_name,
                    "customer_city": "",
                    "items": items,
                    "total_units": int(sum(i["qty_ordered"] for i in items)),
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
                    "collected_by": None,
                    "cancelled_at": None,
                    "incomplete_at": None,
                    "completed_at": None,
                    "incomplete_reason": None,
                    "delivery_validated": None,
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

    # ── Commission record ─────────────────────────────────────────────────────
    # For reseller quotes the record was deferred from order creation — create it
    # now at the first moment the order is financially committed.
    # (_ticket_reseller_id is already resolved above, before the packing board step.)
    comm_lookup = await col("order_commissions").find_one({"odoo_order_id": str(order_id)}, NO_ID)
    if _ticket_reseller_id and not comm_lookup:
        try:
            _reseller_doc = await col("resellers").find_one({"id": _ticket_reseller_id}, NO_ID)
            _reseller_name_val = _reseller_doc["name"] if _reseller_doc else ""
            _cust_name_val = order_data["partner_id"][1] if order_data and order_data.get("partner_id") else ""
            _order_subtotal = float(pre_rows[0].get("amount_untaxed", 0)) if pre_rows else 0
            _comm_doc = {
                "odoo_order_id": str(order_id),
                "reseller_id": _ticket_reseller_id,
                "reseller_name": _reseller_name_val,
                "customer_partner_id": partner[0] if partner else None,
                "customer_name": _cust_name_val,
                "original_subtotal": _order_subtotal,
                "commission_total": 0,
                "payout_status": "pending",
                "created_at": datetime.now(timezone.utc),
            }
            await col("order_commissions").insert_one(_comm_doc)
            await col("resellers").update_one(
                {"id": _ticket_reseller_id},
                {"$inc": {"total_sales": _order_subtotal}},
            )
            comm_lookup = _comm_doc
        except Exception as _ce:
            print(f"⚠️  Commission record creation failed at confirm for order {order_id}: {_ce}")

    await audit_log("order.confirm", "order", order_id,
                    entity_label=order_data.get("name", "") if order_data else "",
                    user=current_user,
                    detail={"invoice_id": invoice_id, "invoice_name": invoice_name, "warnings": warnings},
                    reseller_id=comm_lookup.get("reseller_id") if comm_lookup else None)

    _order_ref_str = pre_rows[0].get("name", f"#{order_id}") if pre_rows else f"#{order_id}"
    _routing = await get_email_routing()

    if comm_lookup and comm_lookup.get("reseller_id"):
        _reseller = await col("resellers").find_one({"id": comm_lookup["reseller_id"]}, {"email": 1, "name": 1, "_id": 0})
        if _reseller and _reseller.get("email"):
            if is_partial:
                _pb_entry = await col("packing_board").find_one({"order_id": str(order_id)}, {"items": 1})
                _shipped_lines = [
                    {"name": i["name"], "qty": i.get("qty_reserved", i.get("qty", 0))}
                    for i in (_pb_entry or {}).get("items", [])
                    if not i.get("is_backordered")
                ]
                background_tasks.add_task(
                    send_order_confirmed_partial,
                    order_ref=_order_ref_str,
                    customer_name=comm_lookup.get("customer_name", ""),
                    order_total=float(pre_rows[0].get("amount_total", 0)) if pre_rows else 0,
                    reseller_name=comm_lookup.get("reseller_name", ""),
                    reseller_email=_reseller["email"],
                    shipped_lines=_shipped_lines,
                    backorder_lines=shortfalls,
                    cc=_routing["order_cc"] or None,
                )
            else:
                background_tasks.add_task(
                    send_order_confirmed,
                    order_ref=_order_ref_str,
                    customer_name=comm_lookup.get("customer_name", ""),
                    order_total=float(pre_rows[0].get("amount_total", 0)) if pre_rows else 0,
                    reseller_name=comm_lookup.get("reseller_name", ""),
                    reseller_email=_reseller["email"],
                    cc=_routing["order_cc"] or None,
                )

    # Internal backorder alert — fire for any partial order regardless of reseller
    if is_partial and _routing.get("order_to"):
        background_tasks.add_task(
            send_backorder_alert_internal,
            to=_routing["order_to"],
            order_ref=_order_ref_str,
            customer_name=comm_lookup.get("customer_name", "") if comm_lookup else "",
            reseller_name=comm_lookup.get("reseller_name") if comm_lookup else None,
            backorder_lines=shortfalls,
        )

    return {
        "success": True,
        "invoice_id": invoice_id,
        "invoice_name": invoice_name,
        "warnings": warnings,
    }


@router.put("/{order_id}/cancel")
async def cancel_order(order_id: int, background_tasks: BackgroundTasks, current_user: dict = Depends(require_permission("orders.cancel"))):
    """Cancel a sales order in Odoo and void the related commission record.
    Only quotations (draft/sent) may be cancelled — a confirmed order already has
    an invoice and possibly a packing board entry in flight, so it must be handled
    manually rather than silently voided."""
    odoo = get_odoo_client()
    rows = odoo.read("sale.order", [order_id], fields=["state", "name"])
    if not rows:
        raise HTTPException(status_code=404, detail="Order not found")
    if rows[0]["state"] not in ("draft", "sent"):
        raise HTTPException(
            status_code=400,
            detail="Only quotations (not yet confirmed) can be cancelled this way",
        )
    order_ref = rows[0].get("name", f"#{order_id}")
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

    if comm_lookup and comm_lookup.get("reseller_id"):
        _reseller = await col("resellers").find_one({"id": comm_lookup["reseller_id"]}, {"email": 1, "name": 1, "_id": 0})
        if _reseller and _reseller.get("email"):
            background_tasks.add_task(
                send_order_cancelled,
                order_ref=order_ref,
                customer_name=comm_lookup.get("customer_name", ""),
                reseller_name=comm_lookup.get("reseller_name", ""),
                reseller_email=_reseller["email"],
            )

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
