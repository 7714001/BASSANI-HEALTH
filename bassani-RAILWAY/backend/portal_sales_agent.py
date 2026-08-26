"""
Bassani Portal Sales Agent sync — 2026-08-26.

Tristan (Bassani) added a custom field on the customer contact record in
Odoo Studio, `res.partner.x_studio_bassani_portal_sales_agent` (plain
stored text), purely for Bassani's own internal accounting/reporting: who
at Bassani (or which reseller) is responsible for a given customer's
business. He also added a field of the same label on account.move
(invoices) — confirmed live via fields_get() (2026-08-26) that this is an
Odoo Studio *related* field (`related: partner_id.x_studio_bassani_portal_sales_agent`,
`store: False`), not a separate stored value — it automatically mirrors
whatever is on the invoice's contact, live, forever. The portal therefore
never needs to write to invoices directly for this; writing the contact
once is sufficient and every current/future invoice for that contact picks
it up automatically.

Because the field lives on the contact (one value per customer), not per
order/ticket, it can only ever hold one *current* value — confirmed and
accepted with the product owner as a deliberate simplification (not a true
per-invoice historical snapshot; see CLAUDE.md's OrderPassport-adjacent
notes on this exact limitation). Rule, confirmed 2026-08-26:

- Reseller-sourced ticket: the customer's *owning* reseller (customer_ownership,
  not ticket.reseller_id/reseller_name directly) — a reseller earns
  commission on and effectively owns all of a linked customer's business
  regardless of who physically placed a given ticket (see ownership.py's
  own docstring), so resolving the current owner is more durable than
  trusting a possibly-stale placement field. Falls back to the ticket's own
  stored reseller_name if the ownership lookup comes up empty.
- Direct/internal or customer-self-service ticket: whoever the ticket is
  currently assigned to. Unassigned → no write at all — never blanks an
  existing value, and never writes a placeholder ("if it isn't assigned to
  anyone, nothing gets populated").
- Last write wins: a new ticket's own determination simply overwrites
  whatever was already on the customer's contact. Deliberately not
  history-preserving — the underlying Odoo field itself can't be either
  (see above), and this was explicitly accepted as-is rather than asking
  Tristan to convert it to a true per-invoice stored snapshot.

Kept as its own small module (not inside ticket_routes.py) so both
ticket_routes.py and order_routes.py can call it without a
route-importing-route circular import — same reasoning as ownership.py
and parent_categories.py.
"""
import logging
from typing import Optional

from database import col
from odoo_client import get_odoo_client
from ownership import get_owning_reseller_id

logger = logging.getLogger(__name__)

ODOO_FIELD = "x_studio_bassani_portal_sales_agent"


def _customer_partner_id(ticket: dict) -> Optional[int]:
    """Mirrors ticket_routes.py's own _ticket_customer_partner_id() exactly
    (duplicated rather than imported, to avoid importing from a route file
    into a shared helper) — prefers the resolved company id when present,
    falling back to the raw customer_id."""
    return ticket.get("customer_company_id") or ticket.get("customer_id")


async def sync_portal_sales_agent(ticket: dict) -> None:
    """Best-effort, non-fatal — a failure here must never block or roll
    back the ticket action that triggered it (creation, reassignment,
    stage update). Call with the ticket dict already reflecting whatever
    just changed (e.g. the freshly-set assigned_to/assigned_to_name)."""
    partner_id = _customer_partner_id(ticket)
    if not partner_id:
        return

    agent_name: Optional[str] = None
    if ticket.get("reseller_id"):
        try:
            owning_reseller_id = await get_owning_reseller_id(partner_id)
            if owning_reseller_id:
                res_doc = await col("resellers").find_one({"id": owning_reseller_id}, {"name": 1, "_id": 0})
                agent_name = res_doc["name"] if res_doc else None
        except Exception as e:
            logger.warning("portal_sales_agent_ownership_lookup_failed partner_id=%s error=%s", partner_id, e)
        if not agent_name:
            # Ownership lookup absent/failed — fall back to the ticket's own
            # stored reseller_name rather than writing nothing at all.
            agent_name = ticket.get("reseller_name")
    elif ticket.get("assigned_to"):
        agent_name = ticket.get("assigned_to_name")

    if not agent_name:
        return  # unassigned, no reseller — leave the field untouched

    try:
        odoo = get_odoo_client()
        odoo.write("res.partner", [partner_id], {ODOO_FIELD: agent_name})
    except Exception as e:
        logger.warning("portal_sales_agent_sync_failed partner_id=%s error=%s", partner_id, e)
