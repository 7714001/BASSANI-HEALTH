"""Resolves which Odoo stock.warehouse a request should be scoped to.

Single source of truth for warehouse scoping, used by every route that reads
or writes warehouse-specific stock data (products, forecasts, reports, stock
levels, order/packing-board creation):

  - warehouse_supervisor / packer — fixed `warehouse_id` on their user document
  - reseller                       — `warehouse_id` on their reseller profile
  - admin / super_admin            — `active_warehouse_id` they've selected in
                                      the top-nav switcher (None = all warehouses)
"""
from typing import Optional
from database import col


async def resolve_warehouse_id(current_user: dict) -> Optional[int]:
    role = current_user.get("role")
    if role in ("warehouse_supervisor", "packer"):
        return current_user.get("warehouse_id")
    if role == "reseller":
        reseller = await col("resellers").find_one(
            {"user_id": current_user.get("id")}, {"_id": 0, "warehouse_id": 1}
        )
        return reseller.get("warehouse_id") if reseller else None
    if role in ("admin", "super_admin"):
        return current_user.get("active_warehouse_id")
    return None


def odoo_context(warehouse_id: Optional[int], company_id: Optional[int] = None) -> Optional[dict]:
    """Odoo `context` kwarg that scopes stock quantities and fiscal rules to a
    specific warehouse/company. Without company_id, Odoo sums across all
    companies the service account can access — wrong in multi-company setups."""
    ctx: dict = {}
    if warehouse_id:
        ctx["warehouse"] = warehouse_id
    if company_id:
        ctx["company_id"] = company_id
        ctx["allowed_company_ids"] = [company_id]
    return ctx if ctx else None
