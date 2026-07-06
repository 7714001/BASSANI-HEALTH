from fastapi import APIRouter, Depends
from pydantic import BaseModel
from auth import get_current_user, require_permission
from database import col
from middleware.audit import audit_log

router = APIRouter(prefix="/api/reseller-catalog", tags=["reseller-catalog"])

_DOC = "global"  # single document id for the catalog config


class MoqBody(BaseModel):
    moq: int = 0


async def _get_catalog_doc() -> dict:
    doc = await col("reseller_catalog").find_one({"_id": _DOC})
    return doc or {}


async def _get_catalog_ids() -> set:
    doc = await _get_catalog_doc()
    return set(doc.get("product_ids", []))


@router.get("/")
async def get_reseller_catalog(current_user: dict = Depends(get_current_user)):
    doc = await _get_catalog_doc()
    return {
        "product_ids": sorted(doc.get("product_ids", [])),
        "moq": doc.get("moq", {}),
    }


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


@router.put("/{product_id}/moq")
async def set_product_moq(
    product_id: int,
    body: MoqBody,
    current_user: dict = Depends(require_permission("products.manage")),
):
    moq_val = max(0, body.moq)
    doc = await _get_catalog_doc()
    moq = {str(k): v for k, v in (doc.get("moq") or {}).items()}
    if moq_val > 0:
        moq[str(product_id)] = moq_val
    else:
        moq.pop(str(product_id), None)
    await col("reseller_catalog").update_one(
        {"_id": _DOC},
        {"$set": {"moq": moq}},
        upsert=True,
    )
    await audit_log(
        action="reseller_catalog.moq_set",
        entity_type="product",
        entity_id=str(product_id),
        entity_label=str(product_id),
        user=current_user,
        detail={"product_id": product_id, "moq": moq_val},
    )
    return {"product_id": product_id, "moq": moq_val}
