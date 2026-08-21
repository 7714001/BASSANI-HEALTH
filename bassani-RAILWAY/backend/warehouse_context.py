"""Resolves which Odoo stock.warehouse a request should be scoped to.

Single source of truth for warehouse scoping, used by every route that reads
or writes warehouse-specific stock data (products, forecasts, reports, stock
levels, orders, order/packing-board creation):

  - reseller           — external role, no self-service switcher. Fixed to
                          `warehouse_id` on their reseller profile, falling
                          back to the global admin-set default.
  - customer           — external role (Phase 25), no self-service switcher.
                          Fixed to an admin-pinned `warehouse_id` on
                          `customer_metadata` (keyed by the customer's
                          `customer_company_partner_id`, not any one login),
                          falling back to the global admin-set default.
                          Deliberately does not inherit a linked reseller's
                          warehouse — the two are independent pins.
  - every internal role — self-service `active_warehouse_id` selected in the
                          top-nav switcher (2026-08-04: opened up from
                          admin/super_admin-only to every internal role).
                          Falls back to a fixed `warehouse_id` assignment for
                          roles that have one pinned on their user document
                          (e.g. warehouse_supervisor/packer's assigned floor),
                          then the global admin-set default.
"""
from typing import Optional
from database import col


async def _get_global_default_warehouse_id() -> Optional[int]:
    doc = await col("portal_settings").find_one({"_id": "default_warehouse"})
    return doc.get("warehouse_id") if doc else None


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

    # Reseller: external role, no self-service switcher — fixed to their
    # profile warehouse, falling back to the global default.
    if role == "reseller":
        reseller = await col("resellers").find_one(
            {"user_id": current_user.get("id")}, {"_id": 0, "warehouse_id": 1}
        )
        wh_id = reseller.get("warehouse_id") if reseller else None
        return wh_id or await _get_global_default_warehouse_id()

    # Customer: external role, no self-service switcher — fixed to an
    # admin-pinned warehouse on the company's customer_metadata doc (shared
    # by every login under that company), falling back to the global default.
    # No reseller-derived fallback even if the company is linked to one.
    if role == "customer":
        meta = await col("customer_metadata").find_one(
            {"odoo_partner_id": current_user.get("customer_company_partner_id")},
            {"_id": 0, "warehouse_id": 1},
        )
        wh_id = meta.get("warehouse_id") if meta else None
        return wh_id or await _get_global_default_warehouse_id()

    # Every internal role: the top-nav switcher is the self-service
    # preference. Falls back to a fixed assignment for roles that have one
    # pinned (warehouse_supervisor/packer/vault_custodian's assigned floor,
    # set by an admin), then the global admin-set default.
    return (
        current_user.get("active_warehouse_id")
        or current_user.get("warehouse_id")
        or await _get_global_default_warehouse_id()
    )


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
