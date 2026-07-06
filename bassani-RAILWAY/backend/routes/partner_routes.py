"""
Partner Directory — surfaces ALL active res.partner records from Odoo,
not just those with customer_rank > 0.  Lets admins find and remediate
orphaned contacts (individuals with no parent company link).
"""
from fastapi import APIRouter, Depends, Query, HTTPException
from auth import require_admin, require_permission
from odoo_client import get_odoo_client
from middleware.audit import audit_log
from pydantic import BaseModel

router = APIRouter(prefix="/api/partners", tags=["partners"])

PARTNER_FIELDS = [
    "id", "name", "email", "phone", "is_company",
    "parent_id", "customer_rank", "supplier_rank",
]


class LinkCompanyBody(BaseModel):
    company_id: int


def _fmt(p: dict) -> dict:
    parent = p.get("parent_id")
    return {
        "id":              p["id"],
        "name":            p["name"] or "",
        "email":           p.get("email") or None,
        "phone":           p.get("phone") or None,
        "is_company":      bool(p.get("is_company")),
        "parent_id":       parent[0] if parent and parent is not False else None,
        "parent_name":     parent[1] if parent and parent is not False else None,
        "customer_rank":   p.get("customer_rank") or 0,
        "supplier_rank":   p.get("supplier_rank") or 0,
    }


def _domain_for(filter_type: str, search: str | None) -> list:
    base = [("active", "=", True)]
    if filter_type == "company":
        base.append(("is_company", "=", True))
    elif filter_type == "linked":
        base += [("is_company", "=", False), ("parent_id", "!=", False)]
    elif filter_type == "unlinked":
        base += [("is_company", "=", False), ("parent_id", "=", False)]

    if search:
        base += ["|", ("name", "ilike", search), ("email", "ilike", search)]
    return base


@router.get("/counts")
def partner_counts(current_user: dict = Depends(require_admin)):
    """Return record counts for each filter pill — called once on page load."""
    odoo = get_odoo_client()
    try:
        return {
            "all":      odoo.count("res.partner", [("active", "=", True)]),
            "company":  odoo.count("res.partner", [("active", "=", True), ("is_company", "=", True)]),
            "linked":   odoo.count("res.partner", [("active", "=", True), ("is_company", "=", False), ("parent_id", "!=", False)]),
            "unlinked": odoo.count("res.partner", [("active", "=", True), ("is_company", "=", False), ("parent_id", "=", False)]),
        }
    except Exception as e:
        raise HTTPException(status_code=502, detail=f"Odoo error: {str(e)}")


@router.get("/")
def list_partners(
    filter: str = Query("all", pattern="^(all|company|linked|unlinked)$"),
    search: str | None = Query(None),
    limit: int = Query(50, le=200),
    offset: int = Query(0, ge=0),
    current_user: dict = Depends(require_admin),
):
    odoo = get_odoo_client()
    domain = _domain_for(filter, search.strip() if search else None)
    try:
        partners = odoo.search_read(
            "res.partner", domain=domain, fields=PARTNER_FIELDS,
            limit=limit, offset=offset, order="name asc",
        )
        total = odoo.count("res.partner", domain)
        return {"partners": [_fmt(p) for p in partners], "total": total}
    except Exception as e:
        raise HTTPException(status_code=502, detail=f"Odoo error: {str(e)}")


@router.patch("/{partner_id}/link-company")
async def link_partner_to_company(
    partner_id: int,
    body: LinkCompanyBody,
    current_user: dict = Depends(require_permission("customers.manage")),
):
    """Set parent_id on an individual partner record, making them a child
    contact of the specified company."""
    odoo = get_odoo_client()

    contacts = odoo.read("res.partner", [partner_id], fields=["name", "email", "parent_id", "is_company"])
    if not contacts:
        raise HTTPException(status_code=404, detail="Partner not found")
    contact = contacts[0]
    if contact.get("is_company"):
        raise HTTPException(status_code=422, detail="This record is a company — only individual contacts can be linked")

    companies = odoo.read("res.partner", [body.company_id], fields=["name", "is_company"])
    if not companies:
        raise HTTPException(status_code=404, detail="Company not found")
    if not companies[0].get("is_company"):
        raise HTTPException(status_code=422, detail="Target must be a company record")

    before_parent = contact.get("parent_id")
    before = {
        "company_id":   before_parent[0] if before_parent and before_parent is not False else None,
        "company_name": before_parent[1] if before_parent and before_parent is not False else None,
    }

    try:
        odoo.write("res.partner", [partner_id], {"parent_id": body.company_id, "type": "contact"})
    except Exception as e:
        raise HTTPException(status_code=502, detail=f"Odoo error: {str(e)}")

    await audit_log(
        "partner.link_company", "partner", str(partner_id),
        entity_label=contact["name"],
        user=current_user,
        before=before,
        after={"company_id": body.company_id, "company_name": companies[0]["name"]},
    )

    return {
        "success":      True,
        "contact_name": contact["name"],
        "company_id":   body.company_id,
        "company_name": companies[0]["name"],
    }
