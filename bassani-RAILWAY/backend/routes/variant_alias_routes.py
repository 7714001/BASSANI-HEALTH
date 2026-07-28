"""
Variant Label Aliases — portal-only friendly names for cryptic Odoo
attribute-value codes shown to resellers (e.g. "GD" -> "Greendoor", "EXO" ->
"Exotic"). These abbreviations come straight from Odoo's product.attribute
values and appear verbatim in display_name, but resellers have no way to
know what "GD" or "IND" means. Admin-configurable rather than hardcoded
because the codes aren't even consistent across Odoo's own configuration
over time — this is a small key/value dictionary Bassani maintains
themselves, same portal-layer philosophy as Parent Categories (7.12).

Never writes to Odoo. Applied client-side (see UI.js's applyVariantAlias)
wherever a variant chip/dropdown label is rendered on reseller-facing
surfaces (ResellerCatalog.js, the reseller order cart in Views.js) —
staff-facing views intentionally keep showing the raw Odoo codes.
"""
from typing import Dict
from fastapi import APIRouter, Depends
from pydantic import BaseModel

from auth import get_current_user, require_permission
from database import col
from middleware.audit import audit_log

router = APIRouter(prefix="/api/variant-aliases", tags=["variant-aliases"])

_DOC_ID = "variant_label_aliases"


class VariantAliasesUpdate(BaseModel):
    aliases: Dict[str, str]


@router.get("/")
async def get_variant_aliases(current_user: dict = Depends(get_current_user)):
    """Any authenticated user can read — resellers need this client-side to
    relabel variant chips/dropdowns."""
    doc = await col("portal_settings").find_one({"_id": _DOC_ID})
    return {"aliases": (doc or {}).get("aliases", {})}


@router.put("/")
async def set_variant_aliases(
    body: VariantAliasesUpdate,
    current_user: dict = Depends(require_permission("products.manage")),
):
    """Full replace, matching the simple key/value editor on the frontend.
    Keys normalized to uppercase/trimmed so lookups are case-insensitive and
    immune to stray whitespace on either side."""
    cleaned = {k.strip().upper(): v.strip() for k, v in body.aliases.items() if k.strip() and v.strip()}
    before_doc = await col("portal_settings").find_one({"_id": _DOC_ID})
    await col("portal_settings").update_one(
        {"_id": _DOC_ID},
        {"$set": {"aliases": cleaned, "updated_by": current_user["username"]}},
        upsert=True,
    )
    await audit_log(
        action="variant_aliases.update",
        entity_type="portal_settings",
        entity_id=_DOC_ID,
        entity_label="Variant Label Aliases",
        user=current_user,
        before=(before_doc or {}).get("aliases", {}),
        after=cleaned,
    )
    return {"aliases": cleaned}
