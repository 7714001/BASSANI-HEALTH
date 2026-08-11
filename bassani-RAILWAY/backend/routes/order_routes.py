import logging
from fastapi import APIRouter, BackgroundTasks, Depends, HTTPException, Query
from typing import Optional, List
from pydantic import BaseModel
from datetime import datetime, timezone
from auth import get_current_user, require_permission, ADMIN_ROLES, TICKET_ROLES
from odoo_client import get_odoo_client, OdooClient, odoo as odoo_call
from database import col, NO_ID
from middleware.audit import audit_log
from warehouse_context import resolve_warehouse_id, odoo_context, get_company_id, company_context
from credit import credit_status
from routes.settings_routes import get_email_routing
from ownership import get_owned_partner_ids, get_owning_reseller_id, is_partner_owned_by
from services.email_service import (
    send_order_confirmed, send_order_cancelled,
    send_order_confirmed_partial, send_backorder_alert_internal,
    send_deposit_due_proforma,
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
    "partner_invoice_id", "partner_shipping_id", "payment_term_id",
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
    """List orders from Odoo. Reseller users only see their own orders.
    Warehouse-scoped for every role via resolve_warehouse_id() — the same
    self-service top-nav selection Products/Reports already use."""
    _SORTABLE = {"date_order", "name", "amount_untaxed", "amount_total"}
    sort_by  = sort_by  if sort_by  in _SORTABLE          else "date_order"
    sort_dir = sort_dir if sort_dir in ("asc", "desc")    else "desc"
    odoo = get_odoo_client()

    # Reseller sees every order for their linked customers, not just ones they
    # personally placed (Phase 7.13) — ownership of the customer, not who
    # placed the order, is what determines visibility.
    if current_user.get("role") == "reseller":
        reseller = await col("resellers").find_one(
            {"user_id": current_user["id"]}, NO_ID
        )
        reseller_id = reseller["id"] if reseller else None
        owned_partner_ids = await get_owned_partner_ids(reseller_id)
        if not owned_partner_ids:
            return {"orders": [], "total": 0}

    warehouse_id = await resolve_warehouse_id(current_user)

    domain = []
    if warehouse_id:
        domain.append(("warehouse_id", "=", warehouse_id))
    if current_user.get("role") == "reseller":
        domain.append(("commercial_partner_id", "in", list(owned_partner_ids)))
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
        comm_map: dict = {}
        odoo_ids_str = [str(o["id"]) for o in orders]
        async for c in col("order_commissions").find(
            {"odoo_order_id": {"$in": odoo_ids_str}}, NO_ID
        ):
            comm_map[c["odoo_order_id"]] = c
        for order in orders:
            comm_data = comm_map.get(str(order["id"]))
            order["commission_total"] = comm_data["commission_total"] if comm_data else 0
            order["reseller_id"]   = comm_data["reseller_id"] if comm_data else None
            order["reseller_name"] = comm_data.get("reseller_name", "") if comm_data else ""

        # Batch-fetch linked Sales tickets — also used as reseller fallback for
        # non-commission-eligible resellers who have no order_commissions record
        order_ids = [o["id"] for o in orders]
        ticket_map: dict = {}
        if order_ids:
            async for t in col("tickets").find(
                {"order_id": {"$in": order_ids}, "type": "sales"},
                {"order_id": 1, "status": 1, "exit_status": 1,
                 "reseller_id": 1, "reseller_name": 1},
            ):
                ticket_map[t["order_id"]] = {
                    "id":           str(t["_id"]),
                    "status":       t.get("exit_status") or t.get("status"),
                    "exit_status":  t.get("exit_status"),
                    "reseller_id":  t.get("reseller_id"),
                    "reseller_name": t.get("reseller_name"),
                }
        for order in orders:
            tk = ticket_map.get(order["id"])
            order["linked_ticket"] = tk
            # Fill reseller info from ticket when commission record is absent
            if not order["reseller_name"] and tk and tk.get("reseller_name"):
                order["reseller_name"] = tk["reseller_name"]
                order["reseller_id"]   = tk.get("reseller_id")

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


# ── Literal-path routes — MUST stay before /{order_id} ──────────────────────
# FastAPI matches routes top-down. Any literal segment (e.g. /backorders,
# /stats/summary) must be registered before /{order_id} or it will be swallowed
# and FastAPI will 422 when it tries to cast the segment to int.

@router.get("/stats/summary")
async def order_stats(_: dict = Depends(get_current_user)):
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


@router.get("/backorders")
async def list_backorders(current_user: dict = Depends(require_permission("orders.view"))):
    """All pending backorder delivery pickings, with per-line outstanding qty and linked ticket/MO."""
    odoo = get_odoo_client()
    try:
        pickings = odoo.search_read(
            "stock.picking",
            domain=[
                ("backorder_id", "!=", False),
                ("state", "in", ["confirmed", "assigned", "waiting"]),
                ("picking_type_code", "=", "outgoing"),
            ],
            fields=["id", "name", "origin", "state", "scheduled_date", "partner_id", "move_ids", "sale_id"],
            order="scheduled_date asc",
            limit=200,
        )
    except Exception as e:
        raise HTTPException(status_code=502, detail=f"Odoo error: {str(e)}")

    if not pickings:
        return {"backorders": [], "total": 0}

    # Read move lines for outstanding quantities
    all_move_ids = [mid for p in pickings for mid in (p.get("move_ids") or [])]
    move_by_picking: dict = {}
    if all_move_ids:
        try:
            moves = odoo_call("stock.move", "read", [all_move_ids], {"fields": [
                "id", "product_id", "product_uom_qty", "picking_id",
            ]})
            for m in moves:
                pid = m["picking_id"][0] if isinstance(m["picking_id"], list) else m["picking_id"]
                move_by_picking.setdefault(pid, []).append({
                    "product_id":   m["product_id"][0] if isinstance(m["product_id"], list) else m["product_id"],
                    "product_name": m["product_id"][1] if isinstance(m["product_id"], list) else "",
                    "qty_outstanding": m["product_uom_qty"],
                })
        except Exception:
            pass

    # Look up linked portal tickets by Odoo order ID
    sale_order_ids = list({
        (p["sale_id"][0] if isinstance(p.get("sale_id"), list) and p["sale_id"] else None)
        for p in pickings if p.get("sale_id")
    } - {None})
    ticket_map: dict = {}
    if sale_order_ids:
        try:
            tickets_cur = col("tickets").find(
                {"order_id": {"$in": [str(s) for s in sale_order_ids]}},
                {"_id": 1, "order_id": 1},
            )
            async for t in tickets_cur:
                tid = str(t["_id"])
                ticket_map[str(t["order_id"])] = {
                    "ticket_id": tid,
                    "ref": f"TKT-{tid[-8:].upper()}",
                }
        except Exception:
            pass

    # Look up MRP production orders via sale order name in origin field
    sale_names = list({
        (p["sale_id"][1] if isinstance(p.get("sale_id"), list) and p["sale_id"] else p.get("origin", ""))
        for p in pickings if p.get("sale_id") or p.get("origin")
    } - {""})
    mrp_by_sale: dict = {}
    if sale_names:
        try:
            mrp_orders = odoo.search_read(
                "mrp.production",
                domain=[
                    ("origin", "in", sale_names),
                    ("state", "not in", ["done", "cancel"]),
                ],
                # 'date_start'/'date_finished' not 'date_planned_start'/
                # 'date_planned_finished' (2026-08-11, live-verified against
                # production Odoo 19 — see _queue_packing_board for the fuller
                # field-drift writeup). The old names don't exist here at all.
                fields=["id", "name", "product_id", "product_qty", "qty_producing", "state", "origin", "date_start", "date_finished"],
                limit=500,
            )
            for mo in mrp_orders:
                origin = mo.get("origin") or ""
                mrp_by_sale.setdefault(origin, []).append({
                    "mo_id":       mo["id"],
                    "mo_name":     mo["name"],
                    "state":       mo["state"],
                    "product_id":  mo["product_id"][0] if isinstance(mo.get("product_id"), list) else None,
                    "product_name": mo["product_id"][1] if isinstance(mo.get("product_id"), list) else "",
                    "qty":            mo["product_qty"],
                    "qty_producing":  mo.get("qty_producing", 0),
                    "date":        mo.get("date_start"),
                    "date_planned_finished": mo.get("date_finished"),
                })
        except Exception:
            pass  # mrp module may not be installed

    _BACKORDER_STATE_LABELS = {
        "confirmed": "Confirmed",
        "assigned":  "Ready",
        "waiting":   "Waiting",
    }

    result = []
    for p in pickings:
        sale_raw = p.get("sale_id")
        sale_order_id   = sale_raw[0] if isinstance(sale_raw, list) and sale_raw else None
        sale_order_name = sale_raw[1] if isinstance(sale_raw, list) and sale_raw else p.get("origin", "")
        partner = p.get("partner_id")
        customer_name = partner[1] if isinstance(partner, list) and partner else ""

        lines = move_by_picking.get(p["id"], [])
        sale_mos = mrp_by_sale.get(sale_order_name, [])
        mo_by_product = {mo["product_id"]: mo for mo in sale_mos}
        for line in lines:
            line["manufacturing_order"] = mo_by_product.get(line["product_id"])

        result.append({
            "picking_id":       p["id"],
            "picking_name":     p["name"],
            "sale_order_id":    sale_order_id,
            "sale_order_name":  sale_order_name,
            "customer_name":    customer_name,
            "state":            p["state"],
            "state_label":      _BACKORDER_STATE_LABELS.get(p["state"], p["state"]),
            "scheduled_date":   p.get("scheduled_date"),
            "lines":            lines,
            "ticket":           ticket_map.get(str(sale_order_id)) if sale_order_id else None,
        })

    return {"backorders": result, "total": len(result)}


@router.get("/{order_id}")
async def get_order(order_id: int, current_user: dict = Depends(get_current_user)):
    """Get a single order with line items and commission breakdown."""
    odoo = get_odoo_client()
    try:
        records = odoo.read("sale.order", [order_id], fields=ORDER_FIELDS)
        if not records:
            raise HTTPException(status_code=404, detail="Order not found")
        order = records[0]

        # Reseller access check — must own this order's customer (Phase 7.13:
        # ownership of the linked customer, not who physically placed the order).
        if current_user.get("role") == "reseller":
            reseller = await col("resellers").find_one(
                {"user_id": current_user["id"]}, NO_ID
            )
            reseller_id = reseller["id"] if reseller else None
            partner = order.get("partner_id")
            if not partner or not await is_partner_owned_by(reseller_id, partner[0]):
                raise HTTPException(status_code=403, detail="Access denied")

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

        # Lot/batch numbers — read from stock.move.line via the first outgoing picking.
        # Lots are only assigned after packing, so this may be empty for un-packed orders.
        order["lot_map"] = {}
        try:
            pick_rows = odoo.search_read(
                "stock.picking",
                domain=[("sale_id", "=", order_id), ("state", "=", "done")],
                fields=["move_line_ids"],
                limit=10,
            )
            all_ml_ids = [ml for p in pick_rows for ml in p.get("move_line_ids", [])]
            if all_ml_ids:
                move_lines = odoo.read(
                    "stock.move.line", all_ml_ids,
                    fields=["product_id", "lot_id"],
                )
                lot_map: dict = {}
                for ml in move_lines:
                    if not ml.get("lot_id"):
                        continue
                    pid = ml["product_id"][0] if isinstance(ml["product_id"], list) else ml["product_id"]
                    lot_name = ml["lot_id"][1] if isinstance(ml["lot_id"], list) else str(ml["lot_id"])
                    lot_map.setdefault(pid, [])
                    if lot_name not in lot_map[pid]:
                        lot_map[pid].append(lot_name)
                order["lot_map"] = lot_map
        except Exception:
            pass  # Non-fatal — lot display degrades gracefully

        # Overlay commission data
        comm_data = await col("order_commissions").find_one(
            {"odoo_order_id": str(order_id)}, NO_ID
        )
        order["commission_total"] = comm_data["commission_total"] if comm_data else 0
        order["reseller_id"]   = comm_data["reseller_id"] if comm_data else None
        order["reseller_name"] = comm_data.get("reseller_name", "") if comm_data else ""

        # Fallback: non-commission resellers have no commission record — use ticket
        if not order["reseller_name"]:
            tk = await col("tickets").find_one(
                {"type": "sales", "order_id": order_id},
                {"reseller_id": 1, "reseller_name": 1, "_id": 0},
            )
            if tk and tk.get("reseller_name"):
                order["reseller_name"] = tk["reseller_name"]
                order["reseller_id"]   = tk.get("reseller_id")

        return order
    except HTTPException:
        raise
    except Exception as e:
        raise HTTPException(status_code=502, detail=f"Odoo error: {str(e)}")


# ── Order line preview (for link-existing-order modal) ───────────────────────

@router.get("/{order_id}/lines")
async def get_order_lines(
    order_id: int,
    current_user: dict = Depends(get_current_user),
):
    """Return order line items for a sale order — used by the link-order preview."""
    odoo = get_odoo_client()
    try:
        rows = odoo.search_read(
            "sale.order",
            domain=[("id", "=", order_id)],
            fields=["name", "partner_id", "state", "amount_total", "order_line"],
            limit=1,
        )
    except Exception as e:
        raise HTTPException(status_code=502, detail=f"Odoo error: {str(e)}")
    if not rows:
        raise HTTPException(status_code=404, detail="Order not found")
    order = rows[0]
    lines = []
    if order.get("order_line"):
        try:
            lines = odoo.read(
                "sale.order.line",
                order["order_line"],
                fields=["product_id", "name", "product_uom_qty", "price_unit", "price_subtotal"],
            )
        except Exception as e:
            raise HTTPException(status_code=502, detail=f"Odoo line error: {str(e)}")
    return {
        "order_name":  order["name"],
        "partner_name": order["partner_id"][1] if order.get("partner_id") else "—",
        "state":       order.get("state"),
        "amount_total": order.get("amount_total", 0),
        "lines":       lines,
    }


# ── Deliveries (7.1 + 7.5) ───────────────────────────────────────────────────

_PICKING_STATE_LABEL = {
    "draft":     "Draft",
    "waiting":   "Waiting for Stock",
    "confirmed": "Confirmed",
    "assigned":  "Ready to Pick",
    "done":      "Delivered",
    "cancel":    "Cancelled",
}


def _order_int_id(odoo, raw: str) -> int:
    """Resolve a URL param to an Odoo sale.order integer ID.
    Accepts a numeric string ('1234') or an SO name ('S00602', 'S/00602').
    Raises HTTP 404 if the name cannot be matched.
    """
    try:
        return int(raw)
    except ValueError:
        rows = odoo.search_read("sale.order", [["name", "=", raw]], fields=["id"], limit=1)
        if not rows:
            raise HTTPException(status_code=404, detail=f"Order not found: {raw}")
        return rows[0]["id"]


@router.get("/{order_id}/deliveries")
async def get_order_deliveries(
    order_id: str,
    current_user: dict = Depends(get_current_user),
):
    """
    Return stock.picking records linked to a sale order, including move-line
    detail so callers can show partially delivered quantities (backorders).
    Accepts an Odoo integer ID or a sale.order name (e.g. S00602).
    """
    odoo = get_odoo_client()
    try:
        resolved_id = _order_int_id(odoo, order_id)
    except HTTPException:
        raise
    except Exception as e:
        raise HTTPException(status_code=502, detail=f"Odoo error: {str(e)}")
    try:
        orders = odoo.search_read(
            "sale.order",
            domain=[("id", "=", resolved_id)],
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
            # 'quantity' not 'quantity_done' (2026-08-11) — the live Odoo
            # instance is actually 19.0, not v17; 'quantity_done' does not
            # exist on stock.move there. 'quantity' holds the done amount once
            # the move is complete (verified live), which is what this display
            # wants. See order_routes.py::_queue_packing_board for the fuller
            # field-semantics writeup.
            moves = odoo_call("stock.move", "read", [all_move_ids], {"fields": [
                "id", "product_id", "product_uom_qty", "quantity", "picking_id", "state",
            ]})
            for m in moves:
                pid = m["picking_id"][0] if isinstance(m["picking_id"], list) else m["picking_id"]
                move_by_picking.setdefault(pid, []).append({
                    "product_id":   m["product_id"][0] if isinstance(m["product_id"], list) else m["product_id"],
                    "product_name": m["product_id"][1] if isinstance(m["product_id"], list) else "",
                    "qty_ordered":  m["product_uom_qty"],
                    "qty_done":     m["quantity"],
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


@router.get("/{order_id}/manufacturing-orders")
async def get_order_manufacturing_orders(
    order_id: int,
    current_user: dict = Depends(get_current_user),
):
    """Return active mrp.production records linked to a sale order (via origin field)."""
    odoo = get_odoo_client()
    try:
        orders = odoo.read("sale.order", [order_id], fields=["name"])
    except Exception as e:
        raise HTTPException(status_code=502, detail=f"Odoo error: {str(e)}")
    if not orders:
        return {"manufacturing_orders": []}

    so_name = orders[0]["name"]
    try:
        # 'date_start'/'date_finished' — see the field-drift note in
        # _queue_packing_board (2026-08-11).
        mos = odoo.search_read(
            "mrp.production",
            domain=[("origin", "=", so_name), ("state", "not in", ["done", "cancel"])],
            fields=[
                "id", "name", "product_id", "product_qty", "qty_producing",
                "state", "origin", "date_start", "date_finished",
            ],
            limit=100,
        )
    except Exception:
        mos = []  # mrp module may not be installed

    result = []
    for mo in mos:
        result.append({
            "mo_id":     mo["id"],
            "mo_name":   mo["name"],
            "state":     mo["state"],
            "product_id":   mo["product_id"][0] if isinstance(mo["product_id"], list) else mo["product_id"],
            "product_name": mo["product_id"][1] if isinstance(mo["product_id"], list) else "",
            "product_qty":         mo.get("product_qty", 0),
            "qty_producing":       mo.get("qty_producing", 0),
            "date_planned_start":    mo.get("date_start"),
            "date_planned_finished": mo.get("date_finished"),
        })

    return {"manufacturing_orders": result}


# ── Passport ──────────────────────────────────────────────────────────────────

def _passport_status(order: dict, ticket: dict | None, invoice: dict | None, deliveries: list) -> dict:
    """Derive a single human-readable overall status from all sources."""
    state = order.get("state", "")

    if state == "cancel":
        return {"label": "Cancelled", "color": "red", "detail": "Order was cancelled in Odoo."}
    if state == "draft":
        return {"label": "Draft Quotation", "color": "gray", "detail": "Quotation not yet confirmed by customer."}
    if state == "sent":
        return {"label": "Quotation Sent", "color": "blue", "detail": "Awaiting customer acceptance."}

    inv_note = ""
    if invoice:
        pstate = invoice.get("payment_state", "")
        inv_name = invoice.get("name", "")
        if pstate == "paid":
            inv_note = f" Invoice {inv_name} is paid."
        elif pstate in ("not_paid", "partial"):
            inv_note = f" Invoice {inv_name} is outstanding."

    if not ticket:
        return {"label": "Confirmed — Not in Pipeline", "color": "amber",
                "detail": f"Order confirmed but no portal ticket exists.{inv_note}"}

    status = ticket.get("status", "open")
    exit_status = ticket.get("exit_status") or ""

    if exit_status == "complete":
        return {"label": "Complete", "color": "green", "detail": f"Order fulfilled and completed.{inv_note}"}
    if exit_status == "cancelled":
        reason = ticket.get("incomplete_reason") or ""
        return {"label": "Cancelled", "color": "red", "detail": f"Cancelled.{' ' + reason if reason else ''}"}
    if exit_status == "not_interested":
        return {"label": "Not Interested", "color": "gray", "detail": "Customer did not proceed."}

    has_backorder = any(d.get("is_backorder") for d in deliveries)
    _MAP = {
        "open":                 ("Inquiry Open",             "blue",  "Sales team is working on this inquiry."),
        "quote":                ("Building Quote",           "blue",  "Quotation is being prepared."),
        "sale_order":           ("Confirmed — Awaiting Packing", "blue", "Order confirmed. Packing will begin shortly."),
        "confirmed_wip":        ("In Fulfilment",            "green", "Order is on the packing floor."),
        "ready_for_collection": ("Ready for Collection",     "green", "Order packed and approved — invoice issued, awaiting customer collection."),
        "incomplete":           ("Marked Incomplete",     "orange", ticket.get("incomplete_reason") or "Order was marked incomplete."),
        "queued":               ("Queued for Packing",   "blue",   "Sent to packing board — awaiting packer assignment."),
        "packing":              ("Being Packed",          "blue",   "Packing in progress."),
        "waiting_stock":        ("Awaiting Stock",        "orange", "Backorder — items will be dispatched when stock is available."),
    }
    label, color, detail = _MAP.get(status, (status, "gray", ""))
    if has_backorder and status not in ("waiting_stock",):
        detail += " Partial backorder exists."
    return {"label": label, "color": color, "detail": detail + inv_note}


@router.get("/{order_id}/passport")
async def get_order_passport(order_id: str, current_user: dict = Depends(get_current_user)):
    """Aggregated lifecycle view of a single order — order + ticket + invoice + deliveries + MOs.
    Accepts an Odoo integer ID or a sale.order name (e.g. S00602).
    """
    odoo = get_odoo_client()

    # Resolve SO name → integer Odoo ID
    try:
        resolved_id = _order_int_id(odoo, order_id)
    except HTTPException:
        raise
    except Exception as e:
        raise HTTPException(status_code=502, detail=f"Odoo error: {str(e)}")

    # ── Sale order ────────────────────────────────────────────────────────────
    try:
        orders = odoo.read("sale.order", [resolved_id], fields=[
            "name", "state", "partner_id", "date_order", "amount_total",
            "amount_tax", "invoice_ids", "picking_ids", "payment_term_id",
            "order_line",
        ])
    except Exception as e:
        raise HTTPException(status_code=502, detail=f"Odoo error: {e}")
    if not orders:
        raise HTTPException(status_code=404, detail="Order not found")
    order = orders[0]

    # Reseller access check — same rule as GET /{order_id}: must own this
    # order's customer (Phase 7.13), not have personally placed it.
    if current_user.get("role") == "reseller":
        reseller = await col("resellers").find_one({"user_id": current_user["id"]}, {"id": 1})
        reseller_id = reseller["id"] if reseller else None
        partner = order.get("partner_id")
        if not partner or not await is_partner_owned_by(reseller_id, partner[0]):
            raise HTTPException(status_code=403, detail="Access denied")

    # Partner detail
    if order.get("partner_id"):
        try:
            partners = odoo.read("res.partner", [order["partner_id"][0]],
                fields=["name", "street", "city", "zip", "email", "phone", "vat"])
            if partners:
                order["partner_detail"] = partners[0]
        except Exception:
            pass

    # Order lines
    if order.get("order_line"):
        try:
            lines = odoo.read("sale.order.line", order["order_line"], fields=[
                "product_id", "name", "product_uom_qty", "price_unit",
                "price_subtotal", "qty_delivered", "qty_invoiced",
            ])
            order["lines"] = lines
        except Exception:
            order["lines"] = []

    # ── Sales ticket ──────────────────────────────────────────────────────────
    ticket = await col("tickets").find_one(
        {"type": "sales", "order_id": {"$in": [resolved_id, order_id]}},
        {"_id": 1, "status": 1, "exit_status": 1, "assigned_to": 1,
         "incomplete_reason": 1, "created_at": 1, "updated_at": 1, "source": 1,
         "reseller_id": 1, "reseller_name": 1, "customer_name": 1, "notes": 1},
    )
    ticket_out = None
    if ticket:
        _reseller_name = ticket.get("reseller_name")
        _source = ticket.get("source")
        # Backfill: old tickets have reseller_id but no reseller_name
        if not _reseller_name and ticket.get("reseller_id"):
            _res_doc = await col("resellers").find_one(
                {"id": ticket["reseller_id"]}, {"name": 1, "_id": 0}
            )
            _reseller_name = _res_doc["name"] if _res_doc else None
            _source = "reseller"  # old tickets used "portal" — normalise for the UI
        ticket_out = {
            "ticket_id":    str(ticket["_id"]),
            "ref":          f"TKT-{str(ticket['_id'])[-8:].upper()}",
            "status":       ticket.get("status"),
            "exit_status":  ticket.get("exit_status"),
            "assigned_to":  ticket.get("assigned_to"),
            "incomplete_reason": ticket.get("incomplete_reason"),
            "created_at":   ticket.get("created_at"),
            "updated_at":   ticket.get("updated_at"),
            "source":       _source,
            "reseller_name": _reseller_name,
            "customer_name": ticket.get("customer_name"),
            "notes":        ticket.get("notes"),
        }

    # ── Packing board entry ───────────────────────────────────────────────────
    packing_entry = await col("packing_board").find_one(
        {"order_id": order.get("name", order_id)},
        {"_id": 0, "status": 1, "packer_name": 1, "ps_num": 1,
         "qa_approved_by": 1, "qa_approved_at": 1,
         "rp_approved_by": 1, "rp_approved_at": 1,
         "collected_by": 1, "collected_at": 1,
         "completed_at": 1, "incomplete_reason": 1, "updated_at": 1},
    )
    packing_out = None
    if packing_entry:
        def _dt(v):
            if v is None: return None
            return v.isoformat() if hasattr(v, "isoformat") else str(v)
        packing_out = {
            "status":         packing_entry.get("status"),
            "packer_name":    packing_entry.get("packer_name"),
            "ps_num":         packing_entry.get("ps_num"),
            "qa_approved_by": packing_entry.get("qa_approved_by"),
            "qa_approved_at": _dt(packing_entry.get("qa_approved_at")),
            "rp_approved_by": packing_entry.get("rp_approved_by"),
            "rp_approved_at": _dt(packing_entry.get("rp_approved_at")),
            "collected_by":   packing_entry.get("collected_by"),
            "collected_at":   _dt(packing_entry.get("collected_at")),
            "completed_at":   _dt(packing_entry.get("completed_at")),
            "incomplete_reason": packing_entry.get("incomplete_reason"),
            "updated_at":     _dt(packing_entry.get("updated_at")),
        }

    # ── Invoices (all, not just first) ────────────────────────────────────────
    invoices_out = []
    invoice_ids = order.get("invoice_ids") or []
    if invoice_ids:
        try:
            inv_rows = odoo.read("account.move", invoice_ids, fields=[
                "name", "state", "payment_state", "amount_total",
                "amount_residual", "invoice_date", "invoice_date_due", "move_type",
            ])
            for inv in inv_rows:
                invoices_out.append({
                    "invoice_id":      inv["id"],
                    "name":            inv["name"],
                    "state":           inv["state"],
                    "move_type":       inv.get("move_type"),
                    "payment_state":   inv["payment_state"],
                    "amount_total":    inv["amount_total"],
                    "amount_residual": inv.get("amount_residual", 0),
                    "invoice_date":    inv.get("invoice_date"),
                    "due_date":        inv.get("invoice_date_due"),
                })
        except Exception:
            pass
    invoice_out = invoices_out[0] if invoices_out else None  # kept for backwards compat

    # ── Deliveries ────────────────────────────────────────────────────────────
    # Use search_read to resolve picking_ids — same as get_order_deliveries,
    # which is proven to work. order.picking_ids from read() can return []
    # because sale.order.picking_ids is a computed field.
    deliveries = []
    try:
        so_rows = odoo.search_read("sale.order", domain=[("id", "=", resolved_id)], fields=["picking_ids"], limit=1)
        picking_ids = so_rows[0]["picking_ids"] if so_rows else []
    except Exception:
        picking_ids = []
    if picking_ids:
        try:
            pickings = odoo_call("stock.picking", "read", [picking_ids], {"fields": [
                "id", "name", "state", "scheduled_date", "date_done",
                "backorder_id", "picking_type_code", "move_ids",
            ]})
            pickings = [p for p in pickings if p.get("picking_type_code") == "outgoing"]
            all_move_ids = [mid for p in pickings for mid in p.get("move_ids", [])]
            move_by_picking: dict = {}
            if all_move_ids:
                # 'quantity' not 'quantity_done' — see _queue_packing_board's
                # field-semantics comment further down this file (2026-08-11).
                moves = odoo_call("stock.move", "read", [all_move_ids], {"fields": [
                    "id", "product_id", "product_uom_qty", "quantity", "picking_id",
                ]})
                for m in moves:
                    pid = m["picking_id"][0] if isinstance(m["picking_id"], list) else m["picking_id"]
                    move_by_picking.setdefault(pid, []).append({
                        "product_id":   m["product_id"][0] if isinstance(m["product_id"], list) else m["product_id"],
                        "product_name": m["product_id"][1] if isinstance(m["product_id"], list) else "",
                        "qty_ordered":  m["product_uom_qty"],
                        "qty_done":     m["quantity"],
                    })

            _STATE_LABEL = {
                "draft": "Draft", "waiting": "Waiting for Stock",
                "confirmed": "Confirmed", "assigned": "Ready to Pick",
                "done": "Delivered", "cancel": "Cancelled",
            }
            for p in pickings:
                deliveries.append({
                    "id":           p["id"],
                    "name":         p["name"],
                    "state":        p["state"],
                    "state_label":  _STATE_LABEL.get(p["state"], p["state"]),
                    "scheduled_date": p.get("scheduled_date"),
                    "date_done":    p.get("date_done"),
                    "is_backorder": bool(p.get("backorder_id")),
                    "backorder_ref": p["backorder_id"][1] if isinstance(p.get("backorder_id"), list) and p["backorder_id"] else None,
                    "lines":        move_by_picking.get(p["id"], []),
                })
        except Exception:
            pass

    # ── Lot map (fully independent — cannot be silenced by delivery block) ────
    lot_map: dict = {}
    try:
        lot_pick_rows = odoo.search_read(
            "stock.picking",
            domain=[("sale_id", "=", resolved_id), ("state", "=", "done")],
            fields=["move_line_ids"],
            limit=20,
        )
        all_ml_ids = [ml for p in lot_pick_rows for ml in p.get("move_line_ids", [])]
        if all_ml_ids:
            mls = odoo.read("stock.move.line", all_ml_ids, fields=["product_id", "lot_id"])
            for ml in mls:
                if not ml.get("lot_id"):
                    continue
                pid = ml["product_id"][0] if isinstance(ml["product_id"], list) else ml["product_id"]
                lot_name = ml["lot_id"][1] if isinstance(ml["lot_id"], list) else str(ml["lot_id"])
                lot_map.setdefault(pid, [])
                if lot_name not in lot_map[pid]:
                    lot_map[pid].append(lot_name)
    except Exception:
        pass

    # ── Manufacturing orders ──────────────────────────────────────────────────
    mos = []
    has_backorder = any(d["is_backorder"] for d in deliveries)
    if has_backorder:
        try:
            so_name = order["name"]
            # 'date_finished' — see the field-drift note in
            # _queue_packing_board (2026-08-11).
            mo_rows = odoo.search_read(
                "mrp.production",
                domain=[("origin", "=", so_name), ("state", "not in", ["done", "cancel"])],
                fields=["id", "name", "product_id", "product_qty", "qty_producing", "state", "date_finished"],
                limit=50,
            )
            for mo in mo_rows:
                mos.append({
                    "mo_id":     mo["id"],
                    "mo_name":   mo["name"],
                    "state":     mo["state"],
                    "product_name": mo["product_id"][1] if isinstance(mo.get("product_id"), list) else "",
                    "product_qty":     mo.get("product_qty", 0),
                    "qty_producing":   mo.get("qty_producing", 0),
                    "date_planned_finished": mo.get("date_finished"),
                })
        except Exception:
            pass

    overall_status = _passport_status(order, ticket_out, invoice_out, deliveries)

    return {
        "order":          order,
        "ticket":         ticket_out,
        "packing":        packing_out,
        "invoice":        invoice_out,
        "invoices":       invoices_out,
        "deliveries":     deliveries,
        "lot_map":        lot_map,
        "manufacturing_orders": mos,
        "overall_status": overall_status,
    }


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
            # 'quantity' (2026-08-11, verified live via fields_get against
            # production Odoo — this instance actually runs Odoo 19.0, not the
            # v17 previously documented) is the modern replacement for the old
            # Odoo <=16 'reserved_availability' field: before a move is picked
            # it holds the currently-reserved amount (0 if nothing reserved,
            # equal to product_uom_qty once fully reserved, in between for a
            # partial reservation); once picked/done it holds the actual done
            # quantity. Confirmed against live moves in every relevant state
            # (waiting/confirmed/assigned/partially_available/done). Do not
            # revert to 'reserved_availability' — it does not exist here.
            moves = odoo.read(
                "stock.move", move_ids,
                fields=["product_id", "product_uom_qty", "quantity"],
            )
            for m in moves:
                ordered = float(m.get("product_uom_qty", 0))
                reserved = float(m.get("quantity", 0))
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

    # Server-side enforcement that a reseller may only place orders for their
    # own linked customers (Phase 7.13) — previously frontend-filtering only.
    # Checked against effective_partner_id (post commercial_partner_id
    # resolution), not the raw submitted id, so ordering against a contact
    # person under an owned company is never incorrectly rejected.
    if current_user.get("role") == "reseller":
        if not await is_partner_owned_by(reseller_profile["id"], effective_partner_id):
            raise HTTPException(status_code=403, detail="You can only place orders for your own customers")

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
        _reseller_name: str | None = None
        if _is_reseller_order:
            _res_doc = await col("resellers").find_one(
                {"id": order.reseller_id}, {"name": 1, "_id": 0}
            )
            _reseller_name = _res_doc["name"] if _res_doc else None
        _note = (
            f"Quote created by {_reseller_name or order.reseller_id}"
            if _is_reseller_order
            else f"Portal order — {_role} ({current_user.get('username', '')})"
        )
        await col("tickets").insert_one({
            "type": "sales",
            "source": "reseller" if _is_reseller_order else "portal",
            "customer_id": effective_partner_id,
            "customer_name": _ticket_customer_name,
            "order_id": odoo_order_id,
            "invoice_id": None,
            "orders_ticket_ref": None,
            "status": _ticket_status,
            "exit_status": None,
            "reseller_id": order.reseller_id or None,
            "reseller_name": _reseller_name,
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
    # Matches require_permission()'s role membership check (auth.py) — admin-tier
    # AND the narrow ticketing roles (sales, etc.) are eligible for the granular
    # permission check below. This previously checked ADMIN_ROLES alone, which
    # meant a "sales" user could never confirm an order even with orders.confirm
    # explicitly granted, since "sales" isn't an admin-tier role.
    if current_user.get("role") not in (ADMIN_ROLES | TICKET_ROLES):
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
    """Staff/reseller-driven entry point. See _confirm_order_core for the full
    sequence — recurring_order_routes.py's accept endpoint (Phase 8.46) calls
    _confirm_order_core directly for the customer-triggered auto-confirm path,
    with a synthetic system actor in place of current_user."""
    return await _confirm_order_core(order_id, current_user, background_tasks, override_credit)


async def _confirm_order_core(
    order_id: int,
    current_user: dict,
    background_tasks: BackgroundTasks,
    override_credit: bool = False,
) -> dict:
    """
    Confirm a quotation. On success, further steps run in sequence:
      1. Advance the linked ticket to awaiting_deposit (Phase 8.47 — a 50%
         deposit must be registered before the order reaches the packing board)
      2. Create a reseller commission record if applicable
      3. Email the customer a pro-forma invoice stating the deposit due
    Steps 2-3 are non-fatal: failures are returned as warnings so the admin can
    resolve them manually in Odoo without needing to re-confirm.

    current_user's role gates the reseller-ownership check below — a synthetic
    system actor (role not "reseller") skips it, since the recurring-order
    accept path already confirmed the order belongs to an already-linked
    customer at setup time.
    """
    odoo = get_odoo_client()
    warnings: List[str] = []

    # ── Step 0: Read order — needed by both the ownership check and the credit check ──
    try:
        pre_rows = odoo.read("sale.order", [order_id], fields=["partner_id", "amount_total", "amount_untaxed", "company_id", "warehouse_id", "name"])
    except Exception as e:
        raise HTTPException(status_code=502, detail=f"Could not read order: {str(e)}")
    if not pre_rows:
        raise HTTPException(status_code=404, detail="Order not found")
    _co = pre_rows[0].get("company_id")
    order_company_id = _co[0] if _co else None
    partner = pre_rows[0].get("partner_id")

    # ── Reseller ownership check ───────────────────────────────────────────────
    # Resellers may confirm any order for a customer linked to them (Phase 7.13),
    # not just quotes they personally placed. _sales_ticket is still fetched here
    # (for is_sample and, further below, packing-board/traceability display).
    _sales_ticket = await col("tickets").find_one(
        {"type": "sales", "order_id": order_id, "exit_status": None}, {"reseller_id": 1, "is_sample": 1}
    )
    if current_user.get("role") == "reseller":
        _res_doc = await col("resellers").find_one({"user_id": current_user["id"]}, {"id": 1, "_id": 0})
        _my_rid = _res_doc["id"] if _res_doc else None
        if not partner or not await is_partner_owned_by(_my_rid, partner[0]):
            raise HTTPException(status_code=403, detail="Access denied")

    # ── Credit check — hard gate unless explicitly overridden ──────────────────
    # Unlike the warning at order creation, this blocks: confirming commits to
    # an invoice, so it's the point where being over limit actually matters.
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

    # Resolve reseller ID early — needed by the ticket handoff, proforma CC, and
    # commission steps below.
    _ticket_reseller_id = _sales_ticket.get("reseller_id") if _sales_ticket else None
    _order_ref_str = pre_rows[0].get("name", f"#{order_id}") if pre_rows else f"#{order_id}"

    # ── Ticket handoff — advance to awaiting_deposit ───────────────────────────
    # Phase 8.47: a confirmed order can no longer reach the packing board
    # immediately. A 50% deposit must be registered first (register-deposit,
    # ticket_routes.py) — that's the step that actually creates the packing
    # board entry ("order ticket"), via _queue_packing_board() below. Stock
    # shortfall detection and packing-board creation are both deferred to that
    # point too, since a deposit can take days to arrive and stock reservations
    # can shift in the meantime — recomputing then is more accurate than reusing
    # a snapshot taken here.
    #
    # Sample tickets are the one structural exception: every line is forced to
    # price_unit = 0.0 at quote-build time (create_order_from_ticket), so "50%
    # of the order total" is always zero — there is nothing to deposit. They
    # skip straight to the packing board here, unchanged from Phase 8.38's
    # original design (no Finance action at any stage of a sample order).
    _is_sample_ticket = bool(_sales_ticket.get("is_sample")) if _sales_ticket else False
    if _sales_ticket and _is_sample_ticket:
        try:
            await _queue_packing_board(order_id, background_tasks)
        except Exception as e:
            _pb_error = str(e)
            warnings.append(f"Could not queue sample order for packing: {_pb_error}")
            await col("tickets").update_one(
                {"_id": _sales_ticket["_id"]},
                {"$set": {"packing_board_queue_error": _pb_error, "packing_board_queue_failed_at": datetime.now(timezone.utc)}},
            )
    elif _sales_ticket:
        try:
            _now_c = datetime.now(timezone.utc)
            await col("tickets").update_one(
                {"_id": _sales_ticket["_id"]},
                {
                    "$set": {"status": "awaiting_deposit", "updated_at": _now_c},
                    "$push": {"stage_history": {
                        "status": "awaiting_deposit", "exit_status": None,
                        "actor_id": None, "actor_name": "system",
                        "at": _now_c, "note": "Order confirmed — awaiting 50% deposit",
                    }},
                },
            )
        except Exception as e:
            warnings.append(f"Could not advance ticket to awaiting_deposit: {str(e)}")

    # ── Commission record ─────────────────────────────────────────────────────
    # Phase 7.13: credited to whichever reseller the order's customer is
    # currently linked to (customer_ownership), NOT to whoever physically
    # placed the order (_ticket_reseller_id — still used above for the
    # packing-board/traceability display only, never for commission credit).
    # Resolved fresh right here, at confirm time — the same "resolve now, gate
    # the insert, never revisit" pattern already used for commission_eligible
    # below, which is what makes this non-retroactive with zero extra code:
    # order_commissions records are only ever created going forward, so a
    # customer linked today can never generate a record for an order that was
    # already confirmed before the link existed.
    comm_lookup = await col("order_commissions").find_one({"odoo_order_id": str(order_id)}, NO_ID)
    _owning_reseller_id = await get_owning_reseller_id(partner[0]) if partner else None
    if _owning_reseller_id and not comm_lookup:
        try:
            _reseller_doc = await col("resellers").find_one({"id": _owning_reseller_id}, NO_ID)
            if _reseller_doc and _reseller_doc.get("commission_eligible") is not False:
                _reseller_name_val = _reseller_doc["name"] if _reseller_doc else ""
                _cust_name_val = partner[1] if partner else ""
                _order_subtotal = float(pre_rows[0].get("amount_untaxed", 0)) if pre_rows else 0
                _comm_doc = {
                    "odoo_order_id": str(order_id),
                    "reseller_id": _owning_reseller_id,
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
                    {"id": _owning_reseller_id},
                    {"$inc": {"total_sales": _order_subtotal}},
                )
                comm_lookup = _comm_doc
        except Exception as _ce:
            print(f"⚠️  Commission record creation failed at confirm for order {order_id}: {_ce}")

    await audit_log("order.confirm", "order", order_id,
                    entity_label=pre_rows[0].get("name", "") if pre_rows else "",
                    user=current_user,
                    detail={"warnings": warnings},
                    reseller_id=comm_lookup.get("reseller_id") if comm_lookup else None)

    # ── Proforma invoice — automatic, tells the customer what to pay ──────────
    # Phase 8.47: Odoo's native Pro-Forma Invoice report (must be enabled in
    # Odoo's Sales settings — group_proforma_sales) is fetched live via XML-RPC
    # and emailed straight to the customer, with the reseller CC'd if this is a
    # reseller-placed order, so nobody has to open Odoo to produce this document.
    # Non-fatal: a missing/disabled report degrades to a warning, not a failed
    # confirm — the order is already confirmed in Odoo at this point regardless.
    # Skipped for sample orders — every line is priced at R0.00, so there is no
    # deposit due and no invoice for the customer to act on.
    try:
        if not _is_sample_ticket:
            _customer_email = None
            if partner:
                _p_rows = odoo.read("res.partner", [partner[0]], fields=["email"])
                _customer_email = _p_rows[0].get("email") if _p_rows else None
            if not _customer_email:
                warnings.append("Customer has no email on file — proforma invoice was not sent")
            else:
                _pdf_result = odoo.execute(
                    "ir.actions.report", "_render_qweb_pdf",
                    "sale.report_saleorder_pro_forma_invoice", [order_id],
                )
                _pdf_bytes = _pdf_result[0]
                if hasattr(_pdf_bytes, "data"):
                    _pdf_bytes = _pdf_bytes.data
                _reseller_email_cc = None
                if _ticket_reseller_id:
                    _res_email_doc = await col("resellers").find_one({"id": _ticket_reseller_id}, {"email": 1, "_id": 0})
                    _reseller_email_cc = _res_email_doc.get("email") if _res_email_doc else None
                background_tasks.add_task(
                    send_deposit_due_proforma,
                    customer_email=_customer_email,
                    customer_name=partner[1] if partner else "",
                    order_ref=_order_ref_str,
                    order_total=float(pre_rows[0].get("amount_total", 0)) if pre_rows else 0,
                    pdf_bytes=bytes(_pdf_bytes),
                    cc=[_reseller_email_cc] if _reseller_email_cc else None,
                )
    except Exception as e:
        logger.warning("proforma_invoice_failed", extra={"order_id": order_id, "error": str(e)})
        warnings.append(f"Could not send proforma invoice: {str(e)}")

    return {
        "success": True,
        "warnings": warnings,
    }


async def _queue_packing_board(order_id: int, background_tasks: BackgroundTasks) -> None:
    """
    Create the packing board entry ("order ticket") for a confirmed sale order
    and advance its linked Sales ticket to confirmed_wip.

    Phase 8.47: this used to run inline inside confirm_order. It now only runs
    once a 50% deposit has been registered (register-deposit, ticket_routes.py)
    — a confirmed order sits at awaiting_deposit until then. Stock reservations
    are re-read fresh here rather than reused from confirm time, since a deposit
    can take days to arrive and reservations can shift in that window.

    Raises RuntimeError (or lets an Odoo exception propagate) on any failure —
    most commonly Odoo not having generated the order's delivery yet. Callers
    must not swallow this silently: register_deposit (ticket_routes.py) keeps
    the deposit itself successful regardless (it's already committed in Odoo
    by the time this runs) but persists the failure on the ticket
    (packing_board_queue_error) so it's visible until someone retries — via
    the Admin Override "Stage" action (update_ticket_stage, ticket_routes.py),
    which re-calls this function when moving a ticket to confirmed_wip with no
    existing packing_board entry for its order.
    """
    odoo = get_odoo_client()
    try:
        rows = odoo.read(
            "sale.order", [order_id],
            fields=["name", "partner_id", "picking_ids", "note", "warehouse_id", "amount_total"],
        )
    except Exception as e:
        raise RuntimeError(f"Could not read order from Odoo: {e}")
    order_data = rows[0] if rows else None
    if not order_data:
        raise RuntimeError("Order not found in Odoo")
    if not order_data.get("picking_ids"):
        raise RuntimeError("Odoo has not generated a delivery for this order yet")

    sales_ticket = await col("tickets").find_one(
        {"type": "sales", "order_id": order_id, "exit_status": None}
    )
    _ticket_reseller_id = sales_ticket.get("reseller_id") if sales_ticket else None
    _is_sample_ticket = bool(sales_ticket.get("is_sample")) if sales_ticket else False

    # ── Shortfall detection — check if all stock is currently reserved ────────
    is_partial = False
    shortfalls: List[dict] = []
    try:
        _pick_for_check = order_data["picking_ids"][0]
        _pick_rows = odoo.read("stock.picking", [_pick_for_check], fields=["move_ids"])
        if _pick_rows and _pick_rows[0].get("move_ids"):
            # 'quantity' — see the items-loop below for the verified field
            # semantics (2026-08-11).
            _check_moves = odoo.read(
                "stock.move", _pick_rows[0]["move_ids"],
                fields=["product_id", "product_uom_qty", "quantity"],
            )
            for _cm in _check_moves:
                _ordered  = float(_cm.get("product_uom_qty", 0))
                _reserved = float(_cm.get("quantity", 0))
                if _reserved < _ordered:
                    is_partial = True
                    shortfalls.append({
                        "name":          _cm["product_id"][1] if _cm.get("product_id") else "Unknown",
                        "qty_ordered":   _ordered,
                        "qty_available": _reserved,
                        "qty_short":     round(_ordered - _reserved, 4),
                    })
    except Exception as _se:
        logger.warning("queue_packing_board_shortfall_check_failed",
                       extra={"order_id": order_id, "error": str(_se)})

    picking_id = order_data["picking_ids"][0]
    pickings = odoo.read("stock.picking", [picking_id], fields=["name", "origin", "move_ids"])
    picking = pickings[0] if pickings else None
    if not picking:
        raise RuntimeError("Delivery record not found in Odoo")

    items = []
    if picking.get("move_ids"):
        # 'quantity' — verified 2026-08-11 via fields_get + live read against
        # production Odoo (actually 19.0, not the v17 previously documented —
        # see CLAUDE.md Tech Stack). It's the direct replacement for the old
        # Odoo <=16 'reserved_availability': reserved-but-not-picked amount
        # before completion, actual done amount after. 'reserved_availability'
        # does not exist on this instance at all — do not reintroduce it.
        moves = odoo.read(
            "stock.move", picking["move_ids"],
            fields=["product_id", "product_uom_qty", "product_uom", "quantity"],
        )
        for m in moves:
            pname = m["product_id"][1] if m.get("product_id") else "Unknown"
            prod = (
                odoo.read("product.product", [m["product_id"][0]], fields=["default_code"])
                if m.get("product_id") else []
            )
            sku = prod[0].get("default_code") or str(m["product_id"][0]) if prod else ""
            qty_ordered  = float(m.get("product_uom_qty", 0))
            qty_reserved = float(m.get("quantity", 0))
            items.append({
                "name": pname, "sku": sku,
                "product_id": m["product_id"][0] if m.get("product_id") else None,
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
        "inv_num": "",
        "is_sample": _is_sample_ticket,
        "dn_num": picking["name"],
        "ps_num": order_data["name"],
        "notes": order_data.get("note") or "",
        "is_reseller": is_reseller_order,
        "reseller_id": _ticket_reseller_id or None,
        "reseller_name": reseller_name_val,
        "order_value": float(order_data.get("amount_total") or 0),
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

    if sales_ticket:
        await col("tickets").update_one(
            {"_id": sales_ticket["_id"]},
            {
                "$set": {
                    "status": "confirmed_wip", "orders_ticket_ref": str(order_id), "updated_at": now,
                    "packing_board_queue_error": None, "packing_board_queue_failed_at": None,
                },
                "$push": {"stage_history": {
                    "status": "confirmed_wip", "exit_status": None,
                    "actor_id": None, "actor_name": "system",
                    "at": now, "note": "Deposit registered — order queued for packing",
                }},
            },
        )

    # ── Reseller "order confirmed" / partial notifications, and the internal
    # backorder alert — deferred to this point (deposit registered) since the
    # order only actually enters the fulfilment pipeline now.
    comm_lookup = await col("order_commissions").find_one({"odoo_order_id": str(order_id)}, NO_ID)
    _routing = await get_email_routing()
    _order_ref_str = order_data.get("name", f"#{order_id}")

    if comm_lookup and comm_lookup.get("reseller_id"):
        _reseller = await col("resellers").find_one({"id": comm_lookup["reseller_id"]}, {"email": 1, "name": 1, "_id": 0})
        if _reseller and _reseller.get("email"):
            if is_partial:
                _shipped_lines = [
                    {"name": i["name"], "qty": i.get("qty_reserved", i.get("qty", 0))}
                    for i in items if not i.get("is_backordered")
                ]
                background_tasks.add_task(
                    send_order_confirmed_partial,
                    order_ref=_order_ref_str,
                    customer_name=comm_lookup.get("customer_name", ""),
                    order_total=float(order_data.get("amount_total", 0)),
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
                    order_total=float(order_data.get("amount_total", 0)),
                    reseller_name=comm_lookup.get("reseller_name", ""),
                    reseller_email=_reseller["email"],
                    cc=_routing["order_cc"] or None,
                )

    if is_partial and _routing.get("order_to"):
        background_tasks.add_task(
            send_backorder_alert_internal,
            to=_routing["order_to"],
            order_ref=_order_ref_str,
            customer_name=comm_lookup.get("customer_name", "") if comm_lookup else "",
            reseller_name=comm_lookup.get("reseller_name") if comm_lookup else None,
            backorder_lines=shortfalls,
        )


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
