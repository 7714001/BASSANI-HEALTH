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


class ParentCategoryUpdate(BaseModel):
    name: Optional[str] = None
    sort_order: Optional[int] = None
    odoo_category_ids: Optional[List[int]] = None
    product_ids: Optional[List[int]] = None
    active: Optional[bool] = None


class ParentCategoryPreviewRequest(BaseModel):
    odoo_category_ids: List[int] = []
    product_ids: List[int] = []


def _serialize(doc: dict) -> dict:
    return {
        "id": str(doc["_id"]),
        "name": doc.get("name", ""),
        "sort_order": doc.get("sort_order", 0),
        "odoo_category_ids": doc.get("odoo_category_ids", []),
        "product_ids": doc.get("product_ids", []),
        "active": doc.get("active", True),
        "created_by": doc.get("created_by"),
        "updated_by": doc.get("updated_by"),
        "created_at": doc.get("created_at"),
        "updated_at": doc.get("updated_at"),
    }


@router.get("/")
async def list_parent_categories(current_user: dict = Depends(get_current_user)):
    """Admin/staff see every doc (incl. inactive) for management purposes.
    Resellers see only active docs, trimmed to id/name/sort_order, plus a
    synthetic 'Uncategorised' bucket so a catalog-visible product can never
    silently disappear just because nobody's grouped its category yet."""
    docs = await col("parent_categories").find({}).sort([("sort_order", 1), ("name", 1)]).to_list(None)

    if current_user.get("role") == "reseller":
        active = [d for d in docs if d.get("active", True)]
        result = [
            {"id": str(d["_id"]), "name": d.get("name", ""), "sort_order": d.get("sort_order", 0)}
            for d in active
        ]
        odoo = get_odoo_client()
        if await has_uncategorised_products(odoo):
            result.append({"id": UNCATEGORISED, "name": "Uncategorised", "sort_order": max([r["sort_order"] for r in result], default=0) + 1})
        return {"categories": result}

    return {"categories": [_serialize(d) for d in docs]}


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
    now = datetime.now(timezone.utc)
    vals = {
        "name": body.name,
        "sort_order": body.sort_order,
        "odoo_category_ids": body.odoo_category_ids,
        "product_ids": body.product_ids,
        "active": body.active,
        "created_by": current_user["username"],
        "updated_by": current_user["username"],
        "created_at": now,
        "updated_at": now,
    }
    result = await col("parent_categories").insert_one(vals)

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
        after=vals,
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
