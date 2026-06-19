"""Warehouse / vault registry — backs every warehouse selector in the portal
(admin top-nav switcher, reseller assignment, packing-floor staff assignment)."""
import secrets
from datetime import datetime, timezone
from fastapi import APIRouter, Depends, HTTPException
from auth import get_current_user, require_admin
from odoo_client import get_odoo_client
from database import col

router = APIRouter(prefix="/api/warehouses", tags=["warehouses"])

WAREHOUSE_FIELDS = ["id", "name", "code", "lot_stock_id"]


@router.get("/")
def list_warehouses(current_user: dict = Depends(get_current_user)):
    """All active Odoo stock.warehouse records."""
    odoo = get_odoo_client()
    try:
        warehouses = odoo.search_read(
            "stock.warehouse",
            domain=[("active", "=", True)],
            fields=WAREHOUSE_FIELDS,
            limit=50,
            order="name asc",
        )
        return {"warehouses": warehouses}
    except Exception as e:
        raise HTTPException(status_code=502, detail=f"Odoo error: {str(e)}")


# ── Display-screen tokens ────────────────────────────────────────────────────
# Each 85" packing-floor screen authenticates its WebSocket connection with a
# long-lived token tied to exactly one warehouse — stored in Mongo (not env
# vars) since warehouses are defined dynamically in Odoo, not at deploy time.

@router.get("/{warehouse_id}/display-token")
async def get_display_token(warehouse_id: int, current_user: dict = Depends(require_admin)):
    """Return the current display token for this warehouse, if one exists."""
    record = await col("warehouse_display_tokens").find_one(
        {"warehouse_id": warehouse_id}, {"_id": 0, "token": 1, "created_at": 1}
    )
    return {"warehouse_id": warehouse_id, "token": record["token"] if record else None}


@router.post("/{warehouse_id}/display-token")
async def generate_display_token(warehouse_id: int, current_user: dict = Depends(require_admin)):
    """Generate (or rotate) the display token for this warehouse's packing-floor
    screen. Rotating immediately invalidates the old token."""
    token = secrets.token_urlsafe(32)
    await col("warehouse_display_tokens").update_one(
        {"warehouse_id": warehouse_id},
        {"$set": {"token": token, "rotated_at": datetime.now(timezone.utc)},
         "$setOnInsert": {"created_at": datetime.now(timezone.utc)}},
        upsert=True,
    )
    return {"warehouse_id": warehouse_id, "token": token}
