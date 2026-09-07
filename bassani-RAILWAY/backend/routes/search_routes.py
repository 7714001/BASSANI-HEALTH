from fastapi import APIRouter, Depends, HTTPException, Query
from auth import get_current_user, ADMIN_ROLES, TICKET_ROLES, PRODUCTION_ROLES
from odoo_client import get_odoo_client
from warehouse_context import resolve_warehouse_id, get_company_id, odoo_context
from database import col
import re

router = APIRouter(prefix="/api/search", tags=["search"])

_GTIN_RE = re.compile(r"^\d{13,14}$")
_TKT_REF_RE = re.compile(r"^TKT-([0-9a-fA-F]{8})$")


async def _require_search_access(current_user: dict = Depends(get_current_user)) -> dict:
    """Every internal role reaches the search bar (2026-09-07, opened up from
    admin-only) — warehouse_supervisor/packer excluded not by a role check
    here but because they never render the app shell this search bar lives
    in at all (App.js routes them straight to the packing-floor screen).
    Reseller/customer are external and stay excluded. What each internal
    role actually SEES is filtered per-entity inside the endpoints below via
    _has_perm(), reusing the exact same permissions already on the user
    record (orders.view, invoices.view, tickets.*) — this dependency only
    answers "can this user use the search bar at all", not "what can they
    see in it"."""
    if current_user.get("is_super_admin") or current_user.get("role") in (ADMIN_ROLES | TICKET_ROLES | PRODUCTION_ROLES):
        return current_user
    raise HTTPException(status_code=403, detail="Access denied")


def _has_perm(user: dict, domain: str, action: str) -> bool:
    """Same check require_permission()'s dependency closure uses internally,
    factored out for inline per-entity soft-gating within one multi-entity
    endpoint — a hard FastAPI dependency can only gate an entire endpoint on
    one fixed check, not "include orders if X, invoices if Y" in the same
    response."""
    if user.get("is_super_admin") or user.get("role") == "super_admin":
        return True
    perms = user.get("permissions") or {}
    return bool(perms.get(domain, {}).get(action, False))


def _can_search_tickets(user: dict) -> bool:
    """Sales Ticket visibility here is deliberately broader than
    ticket_routes.py's own _require_ticket_viewer (sales/finance_confirm
    only) — every one of the five ticket roles already sees ticket summary
    data somewhere in the app (orders_clerk/qa_manager/responsible_pharmacist
    via the packing board's own Sales Ticket card), so this is just a
    faster way to reach the same information, not a new exposure."""
    if user.get("is_super_admin") or user.get("role") == "super_admin":
        return True
    perms = (user.get("permissions") or {}).get("tickets", {})
    return any(perms.get(k) for k in ("sales", "orders", "finance_confirm", "qa_approve", "rp_approve"))


_TICKET_STATUS_LABEL = {
    "open": "Open", "quote": "Quote", "sale_order": "Sale Order",
    "awaiting_deposit": "Awaiting Deposit", "invoice": "Invoice",
    "confirmed_wip": "In Fulfilment", "ready_for_collection": "Ready for Collection",
    "incomplete": "Incomplete",
}
_TICKET_EXIT_LABEL = {"not_interested": "Not Interested", "cancelled": "Cancelled", "complete": "Complete"}


def _ticket_ref(ticket_id) -> str:
    return f"TKT-{str(ticket_id)[-8:].upper()}"


def _ticket_sub(t: dict) -> str:
    exit_status = t.get("exit_status")
    if exit_status:
        return _TICKET_EXIT_LABEL.get(exit_status, exit_status)
    return _TICKET_STATUS_LABEL.get(t.get("status"), t.get("status", ""))


def _luhn_check(digits: str) -> bool:
    """GS1 GTIN check digit validation (Luhn variant)."""
    d = [int(c) for c in digits]
    total = sum(
        v * (3 if i % 2 == (len(d) % 2) else 1)
        for i, v in enumerate(d[:-1])
    )
    return (10 - (total % 10)) % 10 == d[-1]


_STATE_LABEL = {
    "draft": "Quotation", "sent": "Quotation Sent", "sale": "Confirmed",
    "done": "Done", "cancel": "Cancelled",
}
_PAYMENT_LABEL = {
    "not_paid": "Unpaid", "in_payment": "In Payment", "paid": "Paid",
    "partial": "Partial", "reversed": "Reversed",
}


@router.get("/suggest")
async def global_search_suggest(
    q: str = Query(..., min_length=2, max_length=200),
    current_user: dict = Depends(_require_search_access),
):
    """
    Predictive suggestions for the TopBar scanner input as the user types a
    partial reference (2026-08-27) — a genuinely different job from
    global_search below, which resolves one exact/best match for a scanned
    barcode or a fully-typed reference and navigates immediately on Enter.
    This endpoint never navigates anything itself; it just returns a short
    candidate list for a dropdown, matching the "type SO142, see options,
    pick one" ask rather than "scan a full code, hit Enter."

    Deliberately does not attempt GTIN/barcode matching — a barcode is
    always entered as a complete scanned string, never typed partially, so
    there's nothing meaningful to predict there; global_search's exact-match
    path already handles a scanned barcode + Enter correctly on its own.

    Every internal role can call this (2026-09-07, opened up from admin-only
    via _require_search_access), but each entity type is independently
    gated by the caller's own real permissions (orders.view/invoices.view/
    any ticket permission) via _has_perm()/_can_search_tickets() — a role
    with none of those (there isn't one among the roles that reach this
    endpoint today, but the check stays real rather than assumed) simply
    gets an empty list back, not a 403, since a legitimate query with zero
    visible entity types isn't an error.

    Returns {"results": [{type, id, ref, name, navigate_to, sub, state?}, ...]},
    capped small (8 orders + 5 invoices + 5 tickets) since this fires on
    every keystroke (debounced client-side) and only needs to fill a
    dropdown, not paginate.
    """
    q = q.strip()
    if not q:
        return {"results": []}
    odoo = get_odoo_client()
    results: list = []

    can_orders   = _has_perm(current_user, "orders", "view")
    can_invoices = _has_perm(current_user, "invoices", "view")
    can_tickets  = _can_search_tickets(current_user)

    # Company-name matching (2026-09-07) mirrors the fix already shipped for
    # the Orders/Invoices list pages: an order/invoice's own partner_id is
    # often a specific child contact (e.g. "Stuart Oakes" under "Cannex"),
    # not the company itself, so matching only the order/invoice's own
    # reference number left a company-name search finding nothing here at
    # all. Deliberately only added to /suggest, not /global's exact-match
    # dispatch below — a company name can match many orders/invoices, so it
    # belongs in a pick-one dropdown, not a single-result auto-navigate.
    if can_orders:
        try:
            order_rows = odoo.search_read(
                "sale.order",
                domain=["|", ("name", "ilike", q), "|", ("partner_id.name", "ilike", q), ("commercial_partner_id.name", "ilike", q)],
                fields=["id", "name", "partner_id", "state", "amount_total"],
                limit=8,
                order="date_order desc",
            )
        except Exception:
            order_rows = []
        for o in order_rows:
            results.append({
                "type": "order",
                "id": o["id"],
                "ref": o["name"],
                "name": o.get("partner_id", [None, ""])[1] or "",
                "sub": f"{_STATE_LABEL.get(o['state'], o['state'])} · R{o.get('amount_total', 0):,.2f}",
                "navigate_to": f"/orders/{o['id']}/passport",
            })

    if can_invoices:
        # Resolve matching partner ids via res.partner rather than filtering
        # account.move by commercial_partner_id directly — that field/model
        # combination has never been live-verified on this Odoo instance
        # (see invoice_routes.py::list_invoices's identical concern, fixed
        # the same way for exactly this model).
        try:
            matched_partner_ids = list(odoo.search("res.partner", [("name", "ilike", q)], limit=200))
            if matched_partner_ids:
                matched_partner_ids += list(odoo.search("res.partner", [("parent_id", "in", matched_partner_ids)], limit=500))
        except Exception:
            matched_partner_ids = []
        try:
            inv_rows = odoo.search_read(
                "account.move",
                domain=[
                    ("move_type", "in", ["out_invoice", "out_refund"]),
                    "|", ("name", "ilike", q), "|", ("invoice_origin", "ilike", q), ("partner_id", "in", matched_partner_ids),
                ],
                fields=["id", "name", "partner_id", "payment_state", "amount_total", "invoice_origin"],
                limit=5,
                order="invoice_date desc",
            )
        except Exception:
            inv_rows = []
        for inv in inv_rows:
            nav = "/invoices"
            origin = inv.get("invoice_origin") or ""
            if origin:
                try:
                    so_rows = odoo.search_read("sale.order", domain=[("name", "=", origin)], fields=["id"], limit=1)
                    if so_rows:
                        nav = f"/orders/{so_rows[0]['id']}/passport"
                except Exception:
                    pass
            results.append({
                "type": "invoice",
                "id": inv["id"],
                "ref": inv["name"],
                "name": inv.get("partner_id", [None, ""])[1] or "",
                "sub": f"{_PAYMENT_LABEL.get(inv['payment_state'], inv['payment_state'])} · R{inv.get('amount_total', 0):,.2f}",
                "navigate_to": nav,
            })

    if can_tickets:
        # The one entity type this search couldn't reach at all before
        # (2026-09-07) — a Sales ticket with no order_id yet (a still-open
        # direct inquiry) had no reference this search bar ever queried.
        # Matches customer_name (case-insensitive substring) or an exact
        # "TKT-XXXXXXXX" ref (the same ref format used throughout the app,
        # e.g. OrdersTickets.js/SalesTickets.js's cross-links).
        tkt_match = _TKT_REF_RE.match(q.upper())
        ticket_query: dict = {"type": "sales"}
        if tkt_match:
            suffix = tkt_match.group(1).lower()
            ticket_query["$expr"] = {"$eq": [{"$toLower": {"$substrCP": [{"$toString": "$_id"}, 16, 8]}}, suffix]}
        else:
            ticket_query["customer_name"] = {"$regex": re.escape(q), "$options": "i"}
        try:
            cursor = col("tickets").find(
                ticket_query,
                {"customer_name": 1, "status": 1, "exit_status": 1, "order_id": 1},
            ).sort("created_at", -1).limit(5)
            async for t in cursor:
                results.append({
                    "type": "ticket",
                    "id": str(t["_id"]),
                    "ref": _ticket_ref(t["_id"]),
                    "name": t.get("customer_name") or "",
                    "sub": _ticket_sub(t),
                    "navigate_to": "/tickets/sales",
                    "state": {"openTicketId": str(t["_id"])},
                })
        except Exception:
            pass

    return {"results": results}


@router.get("/global")
async def global_search(
    q: str = Query(..., min_length=1, max_length=200),
    current_user: dict = Depends(_require_search_access),
):
    """
    Smart global search for the TopBar scanner input.

    Resolution order:
      0. Exact "TKT-XXXXXXXX" ref → Sales ticket (2026-09-07)
      1. 13-14 digit string with valid GS1 check digit → product barcode lookup
      2. Matches sale.order name pattern (S\\d+ or any non-numeric prefix) → order + ticket
      3. Matches account.move name → invoice detail
      4. Fallback: try sale.order name ilike search

    Order/invoice steps are skipped entirely (falling through toward 404)
    for a caller without orders.view/invoices.view — same per-entity
    permission model as /suggest above, via _has_perm()/_can_search_tickets().

    Returns { type, id, ref, navigate_to } or 404.
    """
    q = q.strip()
    odoo = get_odoo_client()
    warehouse_id = await resolve_warehouse_id(current_user)
    company_id   = get_company_id(odoo, warehouse_id)
    ctx          = odoo_context(warehouse_id, company_id)

    can_orders   = _has_perm(current_user, "orders", "view")
    can_invoices = _has_perm(current_user, "invoices", "view")

    # ── 0. Exact Sales Ticket ref ─────────────────────────────────────────────
    tkt_match = _TKT_REF_RE.match(q.upper())
    if tkt_match and _can_search_tickets(current_user):
        suffix = tkt_match.group(1).lower()
        try:
            t = await col("tickets").find_one({
                "type": "sales",
                "$expr": {"$eq": [{"$toLower": {"$substrCP": [{"$toString": "$_id"}, 16, 8]}}, suffix]},
            })
        except Exception:
            t = None
        if t:
            return {
                "type": "ticket",
                "id": str(t["_id"]),
                "ref": _ticket_ref(t["_id"]),
                "name": t.get("customer_name") or "",
                "navigate_to": "/tickets/sales",
                "state": {"openTicketId": str(t["_id"])},
            }

    # ── 1. GTIN barcode ───────────────────────────────────────────────────────
    if _GTIN_RE.match(q) and _luhn_check(q):
        try:
            matches = odoo.search_read(
                "product.product",
                domain=[("barcode", "=", q), ("active", "=", True)],
                fields=["id", "name", "display_name", "default_code", "barcode",
                        "qty_available", "virtual_available"],
                limit=1,
                context=ctx,
            )
        except Exception as e:
            raise HTTPException(status_code=502, detail=f"Odoo error: {e}")
        if matches:
            p = matches[0]
            return {
                "type":        "product",
                "id":          p["id"],
                "ref":         p.get("default_code") or str(p["id"]),
                "name":        p.get("display_name") or p["name"],
                "navigate_to": f"/products?q={p.get('default_code') or p['barcode']}",
                "product":     p,
            }

    # ── 2. Sale order ref ─────────────────────────────────────────────────────
    if can_orders:
        # Accept exact match or flexible ilike for e.g. typing "S142"
        order_domain = [("name", "=ilike", q)]
        # Also try exact match which is faster
        try:
            order_rows = odoo.search_read(
                "sale.order",
                domain=[("name", "=", q)],
                fields=["id", "name", "partner_id", "state", "amount_total"],
                limit=1,
            )
            if not order_rows:
                order_rows = odoo.search_read(
                    "sale.order",
                    domain=order_domain,
                    fields=["id", "name", "partner_id", "state", "amount_total"],
                    limit=1,
                )
        except Exception as e:
            raise HTTPException(status_code=502, detail=f"Odoo error: {e}")

        if order_rows:
            order    = order_rows[0]
            order_id = order["id"]
            return {
                "type":        "order",
                "id":          order_id,
                "ref":         order["name"],
                "name":        order.get("partner_id", [None, ""])[1] or "",
                "navigate_to": f"/orders/{order_id}/passport",
            }

    # ── 3. Invoice ref ────────────────────────────────────────────────────────
    if can_invoices:
        try:
            inv_rows = odoo.search_read(
                "account.move",
                domain=[("name", "=", q), ("move_type", "in", ["out_invoice", "out_refund"])],
                fields=["id", "name", "partner_id", "payment_state", "amount_total", "invoice_origin"],
                limit=1,
            )
            if not inv_rows:
                inv_rows = odoo.search_read(
                    "account.move",
                    domain=[("name", "=ilike", q), ("move_type", "in", ["out_invoice", "out_refund"])],
                    fields=["id", "name", "partner_id", "payment_state", "amount_total", "invoice_origin"],
                    limit=1,
                )
        except Exception as e:
            raise HTTPException(status_code=502, detail=f"Odoo error: {e}")

        if inv_rows:
            inv = inv_rows[0]
            # If invoice has a linked sale order, go straight to its passport
            origin = inv.get("invoice_origin") or ""
            nav = "/invoices"
            if origin:
                try:
                    so_rows = odoo.search_read("sale.order", domain=[("name", "=", origin)], fields=["id"], limit=1)
                    if so_rows:
                        nav = f"/orders/{so_rows[0]['id']}/passport"
                except Exception:
                    pass
            return {
                "type":        "invoice",
                "id":          inv["id"],
                "ref":         inv["name"],
                "name":        inv.get("partner_id", [None, ""])[1] or "",
                "navigate_to": nav,
            }

    raise HTTPException(status_code=404, detail=f"No match found for: {q}")
