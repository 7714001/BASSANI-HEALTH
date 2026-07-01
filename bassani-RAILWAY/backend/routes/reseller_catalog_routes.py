from fastapi import APIRouter, Depends
from auth import get_current_user, require_permission
from database import col
from middleware.audit import audit_log

router = APIRouter(prefix="/api/reseller-catalog", tags=["reseller-catalog"])

_DOC = "global"  # single document id for the catalog config


async def _get_catalog_ids() -> set:
    doc = await col("reseller_catalog").find_one({"_id": _DOC})
    return set(doc.get("product_ids", [])) if doc else set()


@router.get("/")
async def get_reseller_catalog(current_user: dict = Depends(get_current_user)):
    ids = await _get_catalog_ids()
    return {"product_ids": sorted(ids)}


@router.post("/toggle/{product_id}")
async def toggle_catalog_product(
    product_id: int,
    current_user: dict = Depends(require_permission("products.manage")),
):
    ids = await _get_catalog_ids()
    if product_id in ids:
        ids.discard(product_id)
        action = "removed"
    else:
        ids.add(product_id)
        action = "added"

    sorted_ids = sorted(ids)
    await col("reseller_catalog").update_one(
        {"_id": _DOC},
        {"$set": {"product_ids": sorted_ids, "updated_by": current_user["username"]}},
        upsert=True,
    )
    await audit_log(
        action=f"reseller_catalog.{action}",
        entity_type="product",
        entity_id=str(product_id),
        entity_label=str(product_id),
        user=current_user,
        detail={"product_id": product_id, "catalog_size": len(sorted_ids)},
    )
    return {"product_ids": sorted_ids, "action": action}
