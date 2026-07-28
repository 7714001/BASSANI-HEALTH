"""
Shared helpers for the Parent Categories portal-layer grouping feature.

Kept out of both routes/parent_category_routes.py and routes/product_routes.py
to avoid a route-importing-route circular import — both import from here.

A parent category groups products for reseller browsing via a union of two
membership rules: whole Odoo categories (odoo_category_ids) and individually
hand-picked variants (product_ids). This is a display/grouping layer only —
visibility to resellers is still governed exclusively by the reseller_catalog
collection (Phase 7.7); see sync_reseller_catalog_additions().

Parent categories can also nest one level deep via parent_id (e.g. "Flower"
containing "Indoor"/"Exotic"/"Greendoor"/"Greenhouse", each of which wraps its
own set of real Odoo categories). Selecting a top-level category resolves
itself PLUS all of its children recursively — see resolve_parent_category_product_ids.
Nesting is enforced two levels deep at the API layer (routes/parent_category_routes.py),
though the resolution logic here is depth-agnostic.
"""
from typing import Optional
from database import col
from middleware.audit import audit_log

UNCATEGORISED = "uncategorised"


def resolve_membership_ids(odoo, odoo_category_ids: list, product_ids: list) -> tuple:
    """Raw union resolution from category ids + hand-picked ids, kept separate
    from the doc-based resolver below so the /preview endpoint can resolve an
    in-progress (possibly unsaved) selection the same way a saved doc would.
    Returns (category_matched_ids, handpicked_ids) as two sets — kept apart
    rather than merged so callers can explain *why* each product matched
    (needed by /preview's visibility warning: category-matched products are
    NOT auto-added to reseller_catalog, only hand-picked ones are)."""
    category_ids = set()
    if odoo_category_ids:
        prods = odoo.search_read(
            "product.product",
            domain=[("categ_id", "in", odoo_category_ids), ("active", "=", True)],
            fields=["id"],
            limit=5000,
        )
        category_ids = {p["id"] for p in prods}
    return category_ids, set(product_ids or [])


def _collect_family_ids(docs_by_id: dict, root_id: str) -> set:
    """root doc's id + every active descendant's id, via parent_id, at any
    depth. Docs are keyed by str(_id); parent_id is stored as that same
    string form so comparison never needs an ObjectId round-trip."""
    family = {root_id}
    changed = True
    while changed:
        changed = False
        for did, d in docs_by_id.items():
            if did in family:
                continue
            if d.get("parent_id") in family:
                family.add(did)
                changed = True
    return family


async def resolve_parent_category_product_ids(odoo, parent_category_id: str) -> list:
    """Resolve the full product.product id membership for a parent category —
    itself plus all of its (currently: one level of) children recursively —
    or for the synthetic 'uncategorised' bucket (catalog-visible products not
    covered by any active parent category, at any level). One Odoo call per
    resolution, batched over the full category-id union — never one call per
    doc, and never one call per level of nesting."""
    if parent_category_id == UNCATEGORISED:
        catalog_doc = await col("reseller_catalog").find_one({"_id": "global"})
        catalog_ids = set(catalog_doc.get("product_ids", [])) if catalog_doc else set()
        if not catalog_ids:
            return []
        active_docs = await col("parent_categories").find({"active": True}).to_list(None)
        all_categ_ids = {c for d in active_docs for c in d.get("odoo_category_ids", [])}
        covered = {p for d in active_docs for p in d.get("product_ids", [])}
        if all_categ_ids:
            prods = odoo.search_read(
                "product.product",
                domain=[("categ_id", "in", list(all_categ_ids)), ("active", "=", True)],
                fields=["id"],
                limit=5000,
            )
            covered |= {p["id"] for p in prods}
        return list(catalog_ids - covered)

    all_docs = await col("parent_categories").find({"active": True}).to_list(None)
    docs_by_id = {str(d["_id"]): d for d in all_docs}
    if parent_category_id not in docs_by_id:
        return []
    family = _collect_family_ids(docs_by_id, parent_category_id)

    all_categ_ids, all_product_ids = set(), set()
    for did in family:
        d = docs_by_id[did]
        all_categ_ids |= set(d.get("odoo_category_ids", []))
        all_product_ids |= set(d.get("product_ids", []))

    category_ids, handpicked_ids = resolve_membership_ids(odoo, list(all_categ_ids), list(all_product_ids))
    return list(category_ids | handpicked_ids)


async def has_uncategorised_products(odoo) -> bool:
    ids = await resolve_parent_category_product_ids(odoo, UNCATEGORISED)
    return len(ids) > 0


async def sync_reseller_catalog_additions(
    added_ids: set,
    current_user: dict,
    parent_category_id: Optional[str],
    parent_category_name: str,
):
    """Idempotently ensure hand-picked parent-category products are also
    visible to resellers — a parent category is a grouping layer, never a
    silent bypass of the reseller_catalog visibility gate."""
    if not added_ids:
        return
    await col("reseller_catalog").update_one(
        {"_id": "global"},
        {
            "$addToSet": {"product_ids": {"$each": list(added_ids)}},
            "$set": {"updated_by": current_user["username"]},
        },
        upsert=True,
    )
    for pid in added_ids:
        await audit_log(
            action="reseller_catalog.auto_added",
            entity_type="product",
            entity_id=str(pid),
            entity_label=str(pid),
            user=current_user,
            detail={
                "source": "parent_category",
                "parent_category_id": parent_category_id,
                "parent_category_name": parent_category_name,
            },
        )
