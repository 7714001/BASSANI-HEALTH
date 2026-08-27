"""
Shared helper for resolving a company's contact list for the purposes of
choosing an email recipient (Send Quote / Send Invoice recipient pickers,
2026-08-27). Kept as its own small root-level module — same precedent as
ownership.py / parent_categories.py — to avoid a route-importing-route
circular import, since this is needed by both ticket_routes.py and
invoice_routes.py.
"""


def resolve_company_contacts(odoo, partner_id: int) -> list:
    """Given any partner id (a contact person or the company itself),
    resolves to the commercial/company partner first, then returns that
    company's own record plus every active child contact that has an email
    on file — the set of people a quote/invoice email could reasonably go
    to. Mirrors packing_board_routes.py's
    _resolve_customer_notification_recipients, but returns full contact rows
    (id/name/email) for a UI picker instead of two flat email lists for an
    automatic notification."""
    rows = odoo.read("res.partner", [partner_id], fields=["commercial_partner_id"])
    if not rows:
        return []
    cp = rows[0].get("commercial_partner_id")
    company_id = cp[0] if cp else partner_id

    company_rows = odoo.read("res.partner", [company_id], fields=["id", "name", "email"])
    if not company_rows:
        return []
    company = company_rows[0]

    contacts = []
    if company.get("email"):
        contacts.append({
            "id": company["id"], "name": company["name"],
            "email": company["email"], "is_company_record": True,
        })

    contact_ids = odoo.search(
        "res.partner", [["parent_id", "=", company_id], ["active", "=", True]], limit=100,
    )
    if contact_ids:
        raw = odoo.read("res.partner", contact_ids, fields=["id", "name", "email"])
        for c in raw:
            if c.get("email"):
                contacts.append({
                    "id": c["id"], "name": c["name"],
                    "email": c["email"], "is_company_record": False,
                })
    return contacts
