"""
Parent Categories — portal-only product grouping for reseller browsing.

Odoo's product.category is a single flat taxonomy shared by the whole
business and is not reshuffled for reseller merchandising. Parent categories
group Odoo categories and/or individually hand-picked product variants into
portal-only buckets (e.g. "Flower", or a weekly-rotating "Specials") that
resellers browse by instead of raw Odoo categories. See CLAUDE.md / roadmap
7.12. This never writes to Odoo — contrast with routes/product_routes.py's
/categories endpoints, which manage real product.category records.

Membership is a union, not exclusive: a product belongs to a parent category
if its categ_id is in odoo_category_ids OR its own id is in product_ids.
Visibility to resellers is still governed exclusively by the reseller_catalog
collection (Phase 7.7) — parent categories are a grouping layer on top of it,
never a bypass (see parent_categories.sync_reseller_catalog_additions).

Categories can nest one level deep via parent_id — e.g. "Flower" (top-level,
usually with no direct Odoo categories of its own) containing "Indoor" /
"Exotic" / "Greendoor" / "Greenhouse" (each a child wrapping its own real
Odoo categories). Enforced two levels deep here (_validate_parent_id): a
category already nested can't be chosen as a parent, and a category that
already has children can't itself be nested under another.
"""
from datetime import datetime, timezone
from typing import Optional, List
from bson import ObjectId
from fastapi import APIRouter, Depends, HTTPException
from pydantic import BaseModel

from auth import get_current_user, require_permission
from database import col
from middleware.audit import audit_log
from odoo_client import get_odoo_client
from parent_categories import (
    UNCATEGORISED,
    has_uncategorised_products,
    resolve_membership_ids,
    resolve_parent_category_product_ids,
    sync_reseller_catalog_additions,
)

PREVIEW_LIMIT = 300

router = APIRouter(prefix="/api/parent-categories", tags=["parent-categories"])


class ParentCategoryCreate(BaseModel):
    name: str
    sort_order: int = 0
    odoo_category_ids: List[int] = []
    product_ids: List[int] = []
    active: bool = True
    parent_id: Optional[str] = None


class ParentCategoryUpdate(BaseModel):
    name: Optional[str] = None
    sort_order: Optional[int] = None
    odoo_category_ids: Optional[List[int]] = None
    product_ids: Optional[List[int]] = None
    active: Optional[bool] = None
    parent_id: Optional[str] = None
    clear_parent: bool = False  # explicit flag — Optional[str]=None can't tell "unchanged" from "unparent"


class ParentCategoryPreviewRequest(BaseModel):
    odoo_category_ids: List[int] = []
    product_ids: List[int] = []


class CategoryMappingUpdate(BaseModel):
    target_id: Optional[str] = None  # parent_categories doc id (top-level or child), or null to unassign


def _serialize(doc: dict) -> dict:
    return {
        "id": str(doc["_id"]),
        "name": doc.get("name", ""),
        "sort_order": doc.get("sort_order", 0),
        "odoo_category_ids": doc.get("odoo_category_ids", []),
        "product_ids": doc.get("product_ids", []),
        "active": doc.get("active", True),
        "parent_id": doc.get("parent_id"),
        "created_by": doc.get("created_by"),
        "updated_by": doc.get("updated_by"),
        "created_at": doc.get("created_at"),
        "updated_at": doc.get("updated_at"),
    }


async def _validate_parent_id(parent_id: Optional[str], self_id: Optional[str] = None):
    """Enforce exactly two levels of nesting: the chosen parent must itself be
    top-level, and a category that already has children can't be nested under
    another (would make an existing 2nd-level chip ambiguous — is it a parent
    or a child?)."""
    if parent_id is None:
        return
    try:
        poid = ObjectId(parent_id)
    except Exception:
        raise HTTPException(status_code=400, detail="Invalid parent category")
    if self_id and parent_id == self_id:
        raise HTTPException(status_code=400, detail="A category cannot be its own parent")
    parent_doc = await col("parent_categories").find_one({"_id": poid})
    if not parent_doc:
        raise HTTPException(status_code=400, detail="Parent category not found")
    if parent_doc.get("parent_id"):
        raise HTTPException(status_code=400, detail="That category is already nested under another — only two levels are supported")
    if self_id:
        has_children = await col("parent_categories").find_one({"parent_id": self_id})
        if has_children:
            raise HTTPException(status_code=400, detail="This category already has sub-categories of its own and can't be nested under another category")


@router.get("/")
async def list_parent_categories(current_user: dict = Depends(get_current_user)):
    """Admin/staff see every doc (incl. inactive) for management purposes.
    Resellers and customers (Phase 25) see only active docs, trimmed to
    id/name/sort_order, plus a synthetic 'Uncategorised' bucket so a
    catalog-visible product can never silently disappear just because
    nobody's grouped its category yet.

    **Fixed 2026-08-21:** this was keyed literally on `role == "reseller"`,
    the same latent-bug pattern found and fixed elsewhere for the customer
    role — a `customer` login fell through to the admin/staff branch below
    and got the full untrimmed payload (raw `odoo_category_ids`/`product_ids`,
    inactive draft categories, `created_by`/`updated_by` usernames)."""
    docs = await col("parent_categories").find({}).sort([("sort_order", 1), ("name", 1)]).to_list(None)

    if current_user.get("role") in ("reseller", "customer"):
        active = [d for d in docs if d.get("active", True)]
        result = [
            {"id": str(d["_id"]), "name": d.get("name", ""), "sort_order": d.get("sort_order", 0), "parent_id": d.get("parent_id")}
            for d in active
        ]
        odoo = get_odoo_client()
        if await has_uncategorised_products(odoo):
            result.append({"id": UNCATEGORISED, "name": "Uncategorised", "sort_order": max([r["sort_order"] for r in result], default=0) + 1, "parent_id": None})
        return {"categories": result}

    return {"categories": [_serialize(d) for d in docs]}


@router.get("/product-groups")
async def get_parent_category_product_groups(current_user: dict = Depends(get_current_user)):
    """
    Product-id membership per top-level active parent category, plus the
    'Uncategorised' bucket — powers the reseller/customer order cart's
    grouped-by-category browsing view (2026-08-21). IDs only, not full
    product data — the cart already has the full product list loaded from
    GET /api/products/ and groups it client-side against these id sets,
    so this stays a cheap, cacheable-later lookup rather than duplicating
    the product read.

    Each top-level group's `product_ids` is the full union (itself + every
    child folded in, via resolve_parent_category_product_ids) — unchanged
    behaviour, matching how selecting that top-level category in the filter
    dropdown behaves. Each group also carries its own `children` — Brand/
    Grade sub-categories (e.g. Pre-Rolls -> Indoor/Exotic/Greendoor/
    Greenhouse/Budget) with their own independently-resolved membership
    (2026-08-21) — powering a second-level sub-heading within each top-level
    cart section. A top-level category with no children returns an empty
    `children` list; the cart renders its products directly under the
    top-level heading in that case rather than a redundant single sub-section.
    """
    odoo = get_odoo_client()
    docs = await col("parent_categories").find({"active": True}).sort([("sort_order", 1), ("name", 1)]).to_list(None)
    top_level = [d for d in docs if not d.get("parent_id")]

    groups = []
    for d in top_level:
        top_id = str(d["_id"])
        product_ids = await resolve_parent_category_product_ids(odoo, top_id)
        if not product_ids:
            continue
        children = []
        for c in docs:
            if c.get("parent_id") != top_id:
                continue
            child_ids = await resolve_parent_category_product_ids(odoo, str(c["_id"]))
            if child_ids:
                children.append({"id": str(c["_id"]), "name": c.get("name", ""), "product_ids": child_ids})
        groups.append({"id": top_id, "name": d.get("name", ""), "product_ids": product_ids, "children": children})

    uncategorised_ids = await resolve_parent_category_product_ids(odoo, UNCATEGORISED)

    return {"groups": groups, "uncategorised_ids": uncategorised_ids}


@router.post("/preview")
async def preview_parent_category(
    body: ParentCategoryPreviewRequest,
    current_user: dict = Depends(require_permission("products.manage")),
):
    """Resolve an in-progress (possibly unsaved) category/hand-pick selection
    into the actual product list — lets the admin see what a parent category
    will contain before saving it. Also flags whether each match is already
    visible to resellers, since category-matched products are NOT auto-added
    to the reseller catalog the way hand-picked ones are (see
    sync_reseller_catalog_additions) — a product can match the grouping rule
    here and still be invisible to resellers until separately toggled on."""
    odoo = get_odoo_client()
    category_ids, handpicked_ids = resolve_membership_ids(odoo, body.odoo_category_ids, body.product_ids)
    all_ids = category_ids | handpicked_ids
    if not all_ids:
        return {"count": 0, "truncated": False, "products": []}

    catalog_doc = await col("reseller_catalog").find_one({"_id": "global"})
    catalog_ids = set(catalog_doc.get("product_ids", [])) if catalog_doc else set()

    id_list = list(all_ids)
    truncated = len(id_list) > PREVIEW_LIMIT
    fetch_ids = id_list[:PREVIEW_LIMIT]
    prods = odoo.search_read(
        "product.product",
        domain=[("id", "in", fetch_ids)],
        fields=["id", "name", "display_name", "default_code", "categ_id"],
        limit=PREVIEW_LIMIT,
        order="name asc",
    )
    products = [
        {
            "id": p["id"],
            "name": p.get("display_name") or p.get("name"),
            "sku": p.get("default_code"),
            "category": p["categ_id"][1] if p.get("categ_id") else None,
            # Hand-pick wins the explanation when a product matches both ways —
            # that's the path that actually guarantees reseller visibility.
            "source": "handpick" if p["id"] in handpicked_ids else "category",
            "catalog_visible": p["id"] in catalog_ids,
        }
        for p in prods
    ]
    return {"count": len(all_ids), "truncated": truncated, "products": products}


@router.post("/")
async def create_parent_category(
    body: ParentCategoryCreate,
    current_user: dict = Depends(require_permission("products.manage")),
):
    await _validate_parent_id(body.parent_id)

    now = datetime.now(timezone.utc)
    vals = {
        "name": body.name,
        "sort_order": body.sort_order,
        "odoo_category_ids": body.odoo_category_ids,
        "product_ids": body.product_ids,
        "active": body.active,
        "parent_id": body.parent_id,
        "created_by": current_user["username"],
        "updated_by": current_user["username"],
        "created_at": now,
        "updated_at": now,
    }
    result = await col("parent_categories").insert_one(vals)
    # insert_one() mutates vals in place, adding a raw ObjectId `_id` key — pass a
    # copy without it to the audit log, not the same dict, so `after` never ends
    # up with a value the API layer can't JSON-encode back out (see 2026-07-30 fix).
    audit_vals = {k: v for k, v in vals.items() if k != "_id"}

    if body.product_ids:
        await sync_reseller_catalog_additions(
            set(body.product_ids), current_user, str(result.inserted_id), body.name
        )

    await audit_log(
        action="parent_category.create",
        entity_type="parent_category",
        entity_id=str(result.inserted_id),
        entity_label=body.name,
        user=current_user,
        after=audit_vals,
    )
    doc = await col("parent_categories").find_one({"_id": result.inserted_id})
    return {"success": True, "category": _serialize(doc)}


@router.put("/{category_id}")
async def update_parent_category(
    category_id: str,
    body: ParentCategoryUpdate,
    current_user: dict = Depends(require_permission("products.manage")),
):
    try:
        oid = ObjectId(category_id)
    except Exception:
        raise HTTPException(status_code=404, detail="Parent category not found")

    doc = await col("parent_categories").find_one({"_id": oid})
    if not doc:
        raise HTTPException(status_code=404, detail="Parent category not found")

    before = _serialize(doc)
    vals = {}
    if body.name is not None:
        vals["name"] = body.name
    if body.sort_order is not None:
        vals["sort_order"] = body.sort_order
    if body.odoo_category_ids is not None:
        vals["odoo_category_ids"] = body.odoo_category_ids
    if body.product_ids is not None:
        vals["product_ids"] = body.product_ids
    if body.active is not None:
        vals["active"] = body.active
    if body.clear_parent:
        vals["parent_id"] = None
    elif body.parent_id is not None:
        await _validate_parent_id(body.parent_id, self_id=category_id)
        vals["parent_id"] = body.parent_id

    if not vals:
        raise HTTPException(status_code=400, detail="Nothing to update")

    vals["updated_by"] = current_user["username"]
    vals["updated_at"] = datetime.now(timezone.utc)
    await col("parent_categories").update_one({"_id": oid}, {"$set": vals})

    # Only sync newly-added hand-picked products into the reseller catalog —
    # removing a product from a parent category must never revoke its
    # independently-managed catalog visibility.
    if body.product_ids is not None:
        added = set(body.product_ids) - set(doc.get("product_ids", []))
        name = vals.get("name", doc.get("name", ""))
        await sync_reseller_catalog_additions(added, current_user, category_id, name)

    updated = await col("parent_categories").find_one({"_id": oid})
    await audit_log(
        action="parent_category.update",
        entity_type="parent_category",
        entity_id=category_id,
        entity_label=updated.get("name", ""),
        user=current_user,
        before=before,
        after=_serialize(updated),
    )
    return {"success": True, "category": _serialize(updated)}


@router.delete("/{category_id}")
async def delete_parent_category(
    category_id: str,
    current_user: dict = Depends(require_permission("products.manage")),
):
    try:
        oid = ObjectId(category_id)
    except Exception:
        raise HTTPException(status_code=404, detail="Parent category not found")

    doc = await col("parent_categories").find_one({"_id": oid})
    if not doc:
        raise HTTPException(status_code=404, detail="Parent category not found")

    has_children = await col("parent_categories").find_one({"parent_id": category_id})
    if has_children:
        raise HTTPException(status_code=400, detail="This category still has sub-categories under it — delete or reassign those first")

    await col("parent_categories").delete_one({"_id": oid})
    await audit_log(
        action="parent_category.delete",
        entity_type="parent_category",
        entity_id=category_id,
        entity_label=doc.get("name", ""),
        user=current_user,
        before=_serialize(doc),
    )
    return {"success": True}


@router.put("/category-mapping/{odoo_category_id}")
async def set_category_mapping(
    odoo_category_id: int,
    body: CategoryMappingUpdate,
    current_user: dict = Depends(require_permission("products.manage")),
):
    """Bulk-setup tool (the Category Mapping page): assign a single Odoo
    category directly to a Parent Category or one of its sub-categories, in
    one action. This is a MOVE, not an add — the category is removed from
    every doc it currently belongs to before being added to the new target,
    so the bulk table's one-category-has-one-home mental model always holds
    even though the underlying schema still allows many-to-many (used by the
    per-category edit modal's hand-pick flow, e.g. Specials)."""
    target_oid = None
    if body.target_id:
        try:
            target_oid = ObjectId(body.target_id)
        except Exception:
            raise HTTPException(status_code=400, detail="Invalid target category")
        target_doc = await col("parent_categories").find_one({"_id": target_oid})
        if not target_doc:
            raise HTTPException(status_code=400, detail="Target category not found")

    previous_docs = await col("parent_categories").find({"odoo_category_ids": odoo_category_id}).to_list(None)
    previous_ids = [str(d["_id"]) for d in previous_docs]
    now = datetime.now(timezone.utc)

    if previous_ids:
        await col("parent_categories").update_many(
            {"odoo_category_ids": odoo_category_id},
            {"$pull": {"odoo_category_ids": odoo_category_id}, "$set": {"updated_by": current_user["username"], "updated_at": now}},
        )
    if target_oid:
        await col("parent_categories").update_one(
            {"_id": target_oid},
            {"$addToSet": {"odoo_category_ids": odoo_category_id}, "$set": {"updated_by": current_user["username"], "updated_at": now}},
        )

    await audit_log(
        action="parent_category.category_mapped",
        entity_type="odoo_category",
        entity_id=str(odoo_category_id),
        entity_label=str(odoo_category_id),
        user=current_user,
        detail={"from": previous_ids, "to": body.target_id},
    )
    return {"success": True}
