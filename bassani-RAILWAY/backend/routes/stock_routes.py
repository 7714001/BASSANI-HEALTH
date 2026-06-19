from fastapi import APIRouter, Depends, HTTPException, Query
from typing import Optional
from pydantic import BaseModel
from auth import get_current_user, require_admin
from odoo_client import get_odoo_client
from warehouse_context import resolve_warehouse_id

router = APIRouter(prefix="/api/stock", tags=["stock"])

# ── Pydantic models ───────────────────────────────────────────────────────────

class StockAdjustment(BaseModel):
    product_id: int
    location_id: int
    quantity: float
    reason: Optional[str] = ""

# ── Endpoints ─────────────────────────────────────────────────────────────────

@router.get("/levels")
async def stock_levels(
    location_id: Optional[int] = None,
    limit: int = Query(100, le=500),
    offset: int = 0,
    current_user: dict = Depends(get_current_user),
):
    """Current stock levels — defaults to the caller's resolved warehouse
    (their assigned vault, or the admin's active selection) unless an explicit
    location_id override is given."""
    odoo = get_odoo_client()
    domain = [("location_id.usage", "=", "internal"), ("quantity", ">", 0)]
    if location_id:
        domain.append(("location_id", "=", location_id))
    else:
        warehouse_id = await resolve_warehouse_id(current_user)
        if warehouse_id:
            wh = odoo.read("stock.warehouse", [warehouse_id], fields=["lot_stock_id"])
            if wh and wh[0].get("lot_stock_id"):
                domain.append(("location_id", "child_of", wh[0]["lot_stock_id"][0]))
    try:
        quants = odoo.search_read(
            "stock.quant",
            domain=domain,
            fields=[
                "product_id", "location_id", "quantity",
                "reserved_quantity", "available_quantity",
            ],
            limit=limit,
            offset=offset,
        )
        return {"stock": quants, "total": len(quants)}
    except Exception as e:
        raise HTTPException(status_code=502, detail=f"Odoo error: {str(e)}")


@router.get("/locations")
async def stock_locations(current_user: dict = Depends(get_current_user)):
    """Internal warehouse locations — scoped to the caller's resolved warehouse
    when one is set, otherwise all internal locations."""
    odoo = get_odoo_client()
    domain = [("usage", "=", "internal"), ("active", "=", True)]
    warehouse_id = await resolve_warehouse_id(current_user)
    if warehouse_id:
        wh = odoo.read("stock.warehouse", [warehouse_id], fields=["lot_stock_id"])
        if wh and wh[0].get("lot_stock_id"):
            domain.append(("id", "child_of", wh[0]["lot_stock_id"][0]))
    try:
        locations = odoo.search_read(
            "stock.location",
            domain=domain,
            fields=["id", "name", "complete_name"],
            limit=200,
        )
        return {"locations": locations}
    except Exception as e:
        raise HTTPException(status_code=502, detail=f"Odoo error: {str(e)}")


@router.get("/movements")
def stock_movements(
    state: Optional[str] = None,
    limit: int = Query(50, le=200),
    offset: int = 0,
    current_user: dict = Depends(get_current_user),
):
    """Stock picking movements (transfers, receipts, deliveries)."""
    odoo = get_odoo_client()
    domain = []
    if state:
        domain.append(("state", "=", state))
    try:
        moves = odoo.search_read(
            "stock.picking",
            domain=domain,
            fields=[
                "id", "name", "picking_type_id", "partner_id",
                "scheduled_date", "date_done", "state", "origin",
            ],
            limit=limit,
            offset=offset,
            order="scheduled_date desc",
        )
        total = odoo.count("stock.picking", domain)
        return {"movements": moves, "total": total}
    except Exception as e:
        raise HTTPException(status_code=502, detail=f"Odoo error: {str(e)}")


@router.post("/adjustment")
def stock_adjustment(
    adj: StockAdjustment,
    current_user: dict = Depends(require_admin),
):
    """
    Manual stock adjustment via Odoo inventory adjustment.
    Admin only.
    """
    odoo = get_odoo_client()
    try:
        quant_id = odoo.create(
            "stock.quant",
            {
                "product_id": adj.product_id,
                "location_id": adj.location_id,
                "inventory_quantity": adj.quantity,
            },
        )
        odoo.call("stock.quant", "action_apply_inventory", [quant_id])
        return {"success": True, "quant_id": quant_id}
    except Exception as e:
        raise HTTPException(status_code=400, detail=f"Odoo error: {str(e)}")
