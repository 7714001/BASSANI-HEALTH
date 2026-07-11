from fastapi import APIRouter, Depends, HTTPException, Query
from auth import require_admin
from odoo_client import get_odoo_client
from warehouse_context import resolve_warehouse_id, get_company_id, odoo_context
import re

router = APIRouter(prefix="/api/search", tags=["search"])

_GTIN_RE = re.compile(r"^\d{13,14}$")


def _luhn_check(digits: str) -> bool:
    """GS1 GTIN check digit validation (Luhn variant)."""
    d = [int(c) for c in digits]
    total = sum(
        v * (3 if i % 2 == (len(d) % 2) else 1)
        for i, v in enumerate(d[:-1])
    )
    return (10 - (total % 10)) % 10 == d[-1]


@router.get("/global")
async def global_search(
    q: str = Query(..., min_length=1, max_length=200),
    current_user: dict = Depends(require_admin),
):
    """
    Smart global search for the TopBar scanner input.

    Resolution order:
      1. 13-14 digit string with valid GS1 check digit → product barcode lookup
      2. Matches sale.order name pattern (S\\d+ or any non-numeric prefix) → order + ticket
      3. Matches account.move name → invoice detail
      4. Fallback: try sale.order name ilike search

    Returns { type, id, ref, navigate_to } or 404.
    """
    q = q.strip()
    odoo = get_odoo_client()
    warehouse_id = await resolve_warehouse_id(current_user)
    company_id   = get_company_id(odoo, warehouse_id)
    ctx          = odoo_context(warehouse_id, company_id)

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
