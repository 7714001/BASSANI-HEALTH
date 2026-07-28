"""
Shared customer_ownership lookups — Phase 7.13.

Kept out of routes/order_routes.py, routes/ticket_routes.py, and
routes/customer_routes.py to avoid a route-importing-route circular import;
all three import from here. This is the single place that should query the
customer_ownership collection for access-control and commission-crediting
purposes going forward.

customer_ownership (one doc per linked customer, one-reseller-per-customer
enforced at write time — see routes/reseller_routes.py) is the sole source of
truth for "which reseller does this customer belong to." A reseller sees and
earns commission on ALL of that customer's orders/tickets, regardless of who
physically placed each one — see order_routes.py's confirm_order commission
block and PRODUCTION_ROADMAP.md 7.13. order.reseller_id / ticket.reseller_id
("who placed this") are separate, unrelated fields kept for Phase 8.34's
traceability display only — never used here.
"""
from typing import Optional
from database import col


async def get_owned_partner_ids(reseller_id: Optional[str]) -> set:
    """All odoo_partner_id values currently linked to this reseller.
    Empty set if the reseller owns nothing or reseller_id is falsy."""
    if not reseller_id:
        return set()
    docs = await col("customer_ownership").find(
        {"reseller_id": reseller_id}, {"odoo_partner_id": 1, "_id": 0}
    ).to_list(length=10000)
    return {d["odoo_partner_id"] for d in docs}


async def get_owning_reseller_id(odoo_partner_id: Optional[int]) -> Optional[str]:
    """The single reseller_id currently linked to this customer, or None.
    One-reseller-per-customer is enforced at write time, so find_one is safe."""
    if not odoo_partner_id:
        return None
    doc = await col("customer_ownership").find_one(
        {"odoo_partner_id": odoo_partner_id}, {"reseller_id": 1, "_id": 0}
    )
    return doc["reseller_id"] if doc else None


async def is_partner_owned_by(reseller_id: Optional[str], odoo_partner_id: Optional[int]) -> bool:
    """True if this exact reseller owns this exact customer. Thin wrapper so
    call sites read as an assertion rather than a manual comparison."""
    if not reseller_id or not odoo_partner_id:
        return False
    doc = await col("customer_ownership").find_one(
        {"reseller_id": reseller_id, "odoo_partner_id": odoo_partner_id}, {"_id": 1}
    )
    return doc is not None
