"""
Stock Report — Phase 15.

Exposes Odoo's stock data as a two-level report mirroring the Odoo stock
report view: a product list with aggregated on-hand quantities, a per-product
lot/batch breakdown, and a full movement-history trail per lot (traceability).

All reads are scoped to the caller's resolved warehouse and its Odoo company
via warehouse_context.py. Requires products.view permission (admin roles).
"""
from fastapi import APIRouter, Depends, HTTPException, Query
from typing import Optional

from auth import require_permission
from odoo_client import get_odoo_client
from warehouse_context import get_company_id, resolve_warehouse_id

router = APIRouter(prefix="/api/stock-report", tags=["stock-report"])


def _classify(from_usage: str, to_usage: str) -> str:
    if from_usage == "supplier":                             return "receipt"
    if to_usage   == "customer":                             return "delivery"
    if from_usage == "customer":                             return "return"
    if to_usage   == "supplier":                             return "vendor_return"
    if to_usage   == "inventory":                            return "adjustment_out"
    if from_usage == "inventory":                            return "adjustment_in"
    if to_usage   == "production":                           return "consumed"
    if from_usage == "production":                           return "produced"
    if from_usage == "internal" and to_usage == "internal":  return "transfer"
    return "other"


def _warehouse_domain(odoo, warehouse_id: Optional[int], company_id: Optional[int]) -> list:
    domain = [("location_id.usage", "=", "internal"), ("quantity", ">", 0)]
    if warehouse_id:
        try:
            wh = odoo.read("stock.warehouse", [warehouse_id], fields=["lot_stock_id"])
            if wh and wh[0].get("lot_stock_id"):
                domain.append(("location_id", "child_of", wh[0]["lot_stock_id"][0]))
        except Exception:
            pass
    if company_id:
        domain.append(("company_id", "=", company_id))
    return domain


@router.get("")
async def stock_report_products(
    search: Optional[str] = Query(None),
    limit:  int           = Query(100, le=500),
    offset: int           = Query(0, ge=0),
    current_user: dict = Depends(require_permission("products.view")),
):
    """
    Product-level stock summary from stock.quant.
    Aggregated on-hand, reserved, and available quantities per product,
    scoped to the caller's resolved warehouse.
    """
    odoo         = get_odoo_client()
    warehouse_id = await resolve_warehouse_id(current_user)
    company_id   = get_company_id(odoo, warehouse_id)
    domain       = _warehouse_domain(odoo, warehouse_id, company_id)

    try:
        quants = odoo.search_read(
            "stock.quant",
            domain=domain,
            fields=["product_id", "lot_id", "quantity", "reserved_quantity"],
            limit=5000,
        )
    except Exception as e:
        raise HTTPException(status_code=502, detail=f"Odoo error: {e}")

    agg: dict = {}
    for q in quants:
        if not q.get("product_id"):
            continue
        pid   = q["product_id"][0]
        pname = q["product_id"][1]
        if pid not in agg:
            agg[pid] = {"product_id": pid, "product_name": pname,
                        "qty_onhand": 0.0, "qty_reserved": 0.0, "lot_ids": set()}
        agg[pid]["qty_onhand"]   += q.get("quantity", 0)
        agg[pid]["qty_reserved"] += q.get("reserved_quantity", 0)
        if q.get("lot_id"):
            agg[pid]["lot_ids"].add(q["lot_id"][0])

    if agg:
        try:
            prods = odoo.search_read(
                "product.product",
                domain=[("id", "in", list(agg.keys()))],
                fields=["id", "default_code", "categ_id"],
                limit=5000,
            )
            for p in prods:
                if p["id"] in agg:
                    agg[p["id"]]["product_ref"] = p.get("default_code") or ""
                    agg[p["id"]]["category"]    = p["categ_id"][1] if p.get("categ_id") else ""
        except Exception:
            pass

    rows = []
    for pid, r in agg.items():
        rows.append({
            "product_id":    pid,
            "product_name":  r["product_name"],
            "product_ref":   r.get("product_ref", ""),
            "category":      r.get("category", ""),
            "qty_onhand":    round(r["qty_onhand"],                      4),
            "qty_reserved":  round(r["qty_reserved"],                     4),
            "qty_available": round(r["qty_onhand"] - r["qty_reserved"],   4),
            "lot_count":     len(r["lot_ids"]),
        })

    if search:
        sl = search.lower()
        rows = [r for r in rows
                if sl in r["product_name"].lower()
                or sl in r["product_ref"].lower()
                or sl in r["category"].lower()]

    rows.sort(key=lambda r: r["product_name"].lower())
    total = len(rows)
    return {"items": rows[offset: offset + limit], "total": total}


@router.get("/{product_id}/lots")
async def product_lot_breakdown(
    product_id: int,
    current_user: dict = Depends(require_permission("products.view")),
):
    """
    Lot/batch breakdown for one product from stock.quant, enriched with
    expiry dates and receipt dates from stock.lot.
    """
    odoo         = get_odoo_client()
    warehouse_id = await resolve_warehouse_id(current_user)
    company_id   = get_company_id(odoo, warehouse_id)

    domain = [
        ("product_id", "=", product_id),
        ("location_id.usage", "=", "internal"),
        ("quantity", ">", 0),
    ]
    if warehouse_id:
        try:
            wh = odoo.read("stock.warehouse", [warehouse_id], fields=["lot_stock_id"])
            if wh and wh[0].get("lot_stock_id"):
                domain.append(("location_id", "child_of", wh[0]["lot_stock_id"][0]))
        except Exception:
            pass
    if company_id:
        domain.append(("company_id", "=", company_id))

    try:
        quants = odoo.search_read(
            "stock.quant",
            domain=domain,
            fields=["lot_id", "location_id", "quantity", "reserved_quantity", "in_date"],
            limit=500,
        )
    except Exception as e:
        raise HTTPException(status_code=502, detail=f"Odoo error: {e}")

    lot_ids = [q["lot_id"][0] for q in quants if q.get("lot_id")]
    lot_meta: dict = {}
    if lot_ids:
        try:
            lots = odoo.search_read(
                "stock.lot",
                domain=[("id", "in", lot_ids)],
                fields=["id", "name", "expiration_date", "use_date", "ref", "create_date"],
                limit=500,
            )
            lot_meta = {l["id"]: l for l in lots}
        except Exception:
            pass

    result = []
    for q in quants:
        lot_id   = q["lot_id"][0] if q.get("lot_id") else None
        lot_name = q["lot_id"][1] if q.get("lot_id") else None
        lot      = lot_meta.get(lot_id, {}) if lot_id else {}
        qty_on   = round(q.get("quantity", 0),           4)
        qty_res  = round(q.get("reserved_quantity", 0),   4)
        result.append({
            "lot_id":        lot_id,
            "lot_name":      lot_name or lot.get("name") or "No Lot",
            "lot_ref":       lot.get("ref") or "",
            "location":      q["location_id"][1] if q.get("location_id") else "",
            "location_id":   q["location_id"][0] if q.get("location_id") else None,
            "qty_onhand":    qty_on,
            "qty_reserved":  qty_res,
            "qty_available": round(qty_on - qty_res, 4),
            "in_date":       q.get("in_date"),
            "expiry_date":   lot.get("expiration_date") or lot.get("use_date"),
            "created_date":  lot.get("create_date"),
        })

    result.sort(key=lambda r: r["lot_name"] or "")
    return {"lots": result, "product_id": product_id}


@router.get("/lots/{lot_id}/movements")
async def lot_movement_history(
    lot_id: int,
    limit: int = Query(200, le=500),
    current_user: dict = Depends(require_permission("products.view")),
):
    """
    Full movement history (traceability trail) for a lot/batch.
    Uses stock.move.line for lot-level granularity; classifies each
    movement by location type so the UI can label it as receipt,
    delivery, transfer, adjustment, etc.
    """
    odoo = get_odoo_client()

    try:
        lines = odoo.search_read(
            "stock.move.line",
            domain=[("lot_id", "=", lot_id), ("state", "=", "done")],
            fields=["date", "qty_done", "location_id", "location_dest_id",
                    "reference", "picking_id", "product_id"],
            order="date desc",
            limit=limit,
        )
    except Exception as e:
        raise HTTPException(status_code=502, detail=f"Odoo error: {e}")

    loc_ids: set = set()
    for l in lines:
        if l.get("location_id"):      loc_ids.add(l["location_id"][0])
        if l.get("location_dest_id"): loc_ids.add(l["location_dest_id"][0])

    locations: dict = {}
    if loc_ids:
        try:
            recs = odoo.search_read(
                "stock.location",
                domain=[("id", "in", list(loc_ids))],
                fields=["id", "name", "complete_name", "usage"],
                limit=200,
            )
            locations = {r["id"]: r for r in recs}
        except Exception:
            pass

    result = []
    for l in lines:
        fid   = l["location_id"][0]      if l.get("location_id")      else None
        tid   = l["location_dest_id"][0] if l.get("location_dest_id") else None
        loc_f = locations.get(fid, {})   if fid else {}
        loc_t = locations.get(tid, {})   if tid else {}
        result.append({
            "date":          l.get("date"),
            "qty":           round(l.get("qty_done", 0), 4),
            "from_location": loc_f.get("complete_name") or loc_f.get("name") or "Unknown",
            "to_location":   loc_t.get("complete_name") or loc_t.get("name") or "Unknown",
            "reference":     l.get("reference") or "",
            "picking_ref":   l["picking_id"][1] if l.get("picking_id") else "",
            "move_type":     _classify(loc_f.get("usage", ""), loc_t.get("usage", "")),
        })

    return {"movements": result, "lot_id": lot_id}
