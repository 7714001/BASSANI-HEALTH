from fastapi import APIRouter, Depends, HTTPException, Query
from typing import Optional
from pydantic import BaseModel
from auth import get_current_user, require_admin
from odoo_client import get_odoo_client

router = APIRouter(prefix="/api/stock", tags=["stock"])

# ── Pydantic models ───────────────────────────────────────────────────────────

class StockAdjustment(BaseModel):
    product_id: int
    location_id: int
    quantity: float
    reason: Optional[str] = ""

# ── Endpoints ─────────────────────────────────────────────────────────────────

@router.get("/levels")
def stock_levels(
    location_id: Optional[int] = None,
    limit: int = Query(100, le=500),
    offset: int = 0,
    current_user: dict = Depends(get_current_user),
):
    """Current stock levels across all internal locations."""
    odoo = get_odoo_client()
    domain = [("location_id.usage", "=", "internal"), ("quantity", ">", 0)]
    if location_id:
        domain.append(("location_id", "=", location_id))
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
def stock_locations(current_user: dict = Depends(get_current_user)):
    """All internal warehouse locations."""
    odoo = get_odoo_client()
    try:
        locations = odoo.search_read(
            "stock.location",
            domain=[("usage", "=", "internal"), ("active", "=", True)],
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
