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


def get_company_id(odoo_client, warehouse_id: Optional[int]) -> Optional[int]:
    """Return the Odoo company_id that owns this warehouse.

    Required whenever creating a new Odoo record (sale.order, account.move,
    account.payment) so the service account's default company does not override
    the correct entity in a multi-company setup.  Always call this before any
    odoo.create() or wizard call that involves a specific warehouse.
    """
    if not warehouse_id:
        return None
    try:
        wh = odoo_client.read("stock.warehouse", [warehouse_id], fields=["company_id"])
        if wh and wh[0].get("company_id"):
            return wh[0]["company_id"][0]
    except Exception:
        pass
    return None


def company_context(company_id: Optional[int]) -> dict:
    """Odoo context dict that scopes a create/wizard call to the correct company.
    Merge this into any existing context dict before passing to Odoo."""
    if not company_id:
        return {}
    return {"company_id": company_id, "allowed_company_ids": [company_id]}


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
