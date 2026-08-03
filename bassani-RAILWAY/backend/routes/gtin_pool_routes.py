"""
GTIN Pool — Phase 12.5.

Manages Bassani's purchased GS1 GTIN codes. Each GTIN is stored in MongoDB
with an availability status and, when assigned, a reference to the Odoo
product it is linked to. Assignment writes to Odoo's product.template.barcode
field so GS1 label printing continues to work unchanged.
"""
from datetime import datetime, timezone
from typing import Optional

from fastapi import APIRouter, Depends, HTTPException, Query
from pydantic import BaseModel

from auth import require_permission, require_admin
from database import col
from middleware.audit import audit_log
from odoo_client import get_odoo_client
from services.gs1 import validate_gtin

router = APIRouter(prefix="/api/gtin-pool", tags=["gtin-pool"])


class BulkAddBody(BaseModel):
    gtins: list[str]


class AssignBody(BaseModel):
    odoo_product_id: int
    product_name: str


# ── Stats (defined before /{gtin} to avoid path conflict) ─────────────────────

@router.get("/stats")
async def get_stats(_: dict = Depends(require_admin)):
    total     = await col("gtin_pool").count_documents({})
    available = await col("gtin_pool").count_documents({"status": "available"})
    assigned  = await col("gtin_pool").count_documents({"status": "assigned"})
    return {"total": total, "available": available, "assigned": assigned}


# ── List ───────────────────────────────────────────────────────────────────────

@router.get("")
async def list_gtins(
    status: Optional[str] = Query(None),
    q: Optional[str] = Query(None),
    skip: int = Query(0, ge=0),
    limit: int = Query(200, le=500),
    _: dict = Depends(require_admin),
):
    filt: dict = {}
    if status in ("available", "assigned"):
        filt["status"] = status
    if q:
        filt["gtin"] = {"$regex": q, "$options": "i"}
    total = await col("gtin_pool").count_documents(filt)
    docs = await col("gtin_pool").find(filt).sort("gtin", 1).skip(skip).limit(limit).to_list(limit)
    for d in docs:
        d["id"] = str(d.pop("_id"))
    return {"items": docs, "total": total}


# ── Bulk add (settings.manage only) ───────────────────────────────────────────

@router.post("/bulk-add")
async def bulk_add(
    body: BulkAddBody,
    current_user: dict = Depends(require_permission("settings.manage")),
):
    added, skipped, invalid = [], [], []
    now = datetime.now(timezone.utc)
    for raw in body.gtins:
        gtin = raw.strip()
        if not gtin:
            continue
        if not validate_gtin(gtin):
            invalid.append(gtin)
            continue
        exists = await col("gtin_pool").find_one({"gtin": gtin}, {"_id": 1})
        if exists:
            skipped.append(gtin)
            continue
        await col("gtin_pool").insert_one({
            "gtin":            gtin,
            "status":          "available",
            "odoo_product_id": None,
            "product_name":    None,
            "assigned_at":     None,
            "assigned_by":     None,
            "odoo_synced":     None,
            "sync_error":      None,
            "created_at":      now,
        })
        added.append(gtin)

    await audit_log(
        "gtin_pool.bulk_add", "gtin_pool", "pool",
        entity_label="GTIN Pool",
        user=current_user,
        detail={"added": len(added), "skipped": len(skipped), "invalid": len(invalid)},
    )
    return {"added": len(added), "skipped": len(skipped), "invalid": invalid}


# ── Single GTIN lookup ─────────────────────────────────────────────────────────

@router.get("/{gtin}")
async def get_gtin(gtin: str, _: dict = Depends(require_admin)):
    doc = await col("gtin_pool").find_one({"gtin": gtin})
    if not doc:
        raise HTTPException(status_code=404, detail="GTIN not found in pool")
    doc["id"] = str(doc.pop("_id"))
    return doc


# ── Delete (available only) ────────────────────────────────────────────────────

@router.delete("/{gtin}")
async def remove_gtin(
    gtin: str,
    current_user: dict = Depends(require_permission("settings.manage")),
):
    doc = await col("gtin_pool").find_one({"gtin": gtin})
    if not doc:
        raise HTTPException(status_code=404, detail="GTIN not found in pool")
    if doc.get("status") == "assigned":
        raise HTTPException(
            status_code=409,
            detail=f"GTIN {gtin} is currently assigned to {doc.get('product_name', 'a product')}. Unassign it first.",
        )
    await col("gtin_pool").delete_one({"gtin": gtin})
    await audit_log(
        "gtin_pool.removed", "gtin_pool", gtin,
        entity_label=gtin, user=current_user,
    )
    return {"success": True}


# ── Assign to product ──────────────────────────────────────────────────────────

@router.post("/{gtin}/assign")
async def assign_gtin(
    gtin: str,
    body: AssignBody,
    current_user: dict = Depends(require_admin),
):
    doc = await col("gtin_pool").find_one({"gtin": gtin})
    if not doc:
        raise HTTPException(status_code=404, detail="GTIN not found in pool")
    if doc.get("status") == "assigned":
        raise HTTPException(
            status_code=409,
            detail=f"GTIN {gtin} is already assigned to {doc.get('product_name', 'another product')}.",
        )

    # The Odoo write is best-effort, not a hard gate — if it fails (e.g. the API
    # service account lacks write access to this specific product's company),
    # the assignment still goes ahead in the portal so the GTIN isn't blocked on
    # an Odoo-side access-rights issue someone else needs to fix. odoo_synced
    # tracks whether the two sides actually agree; surfaced in the GTIN Pool
    # list and retryable via /retry-sync once the Odoo issue is resolved.
    odoo_synced = True
    sync_error = None
    try:
        get_odoo_client().write("product.template", [body.odoo_product_id], {"barcode": gtin})
    except Exception as exc:
        odoo_synced = False
        sync_error = str(exc)

    await col("gtin_pool").update_one(
        {"gtin": gtin},
        {"$set": {
            "status":          "assigned",
            "odoo_product_id": body.odoo_product_id,
            "product_name":    body.product_name,
            "assigned_at":     datetime.now(timezone.utc),
            "assigned_by":     current_user.get("username"),
            "odoo_synced":     odoo_synced,
            "sync_error":      sync_error,
        }},
    )
    await audit_log(
        "gtin_pool.assigned", "gtin_pool", gtin,
        entity_label=gtin, user=current_user,
        detail={"product_id": body.odoo_product_id, "product_name": body.product_name,
                "odoo_synced": odoo_synced, "sync_error": sync_error},
    )
    result = {"success": True, "gtin": gtin, "odoo_synced": odoo_synced}
    if not odoo_synced:
        result["warning"] = (
            f"Linked in the portal, but the barcode could not be updated in Odoo ({sync_error}). "
            "Labels for this product won't show the new GTIN until this is resolved and synced."
        )
    return result


@router.post("/{gtin}/retry-sync")
async def retry_gtin_sync(
    gtin: str,
    current_user: dict = Depends(require_admin),
):
    """Re-attempt the Odoo barcode write for a GTIN that assigned successfully
    in the portal but failed to sync to Odoo (see assign_gtin)."""
    doc = await col("gtin_pool").find_one({"gtin": gtin})
    if not doc:
        raise HTTPException(status_code=404, detail="GTIN not found in pool")
    if doc.get("status") != "assigned" or not doc.get("odoo_product_id"):
        raise HTTPException(status_code=400, detail="This GTIN is not currently assigned to a product")

    try:
        get_odoo_client().write("product.template", [doc["odoo_product_id"]], {"barcode": gtin})
    except Exception as exc:
        await col("gtin_pool").update_one({"gtin": gtin}, {"$set": {"sync_error": str(exc)}})
        raise HTTPException(status_code=502, detail=f"Still failed to update barcode in Odoo: {exc}")

    await col("gtin_pool").update_one(
        {"gtin": gtin},
        {"$set": {"odoo_synced": True, "sync_error": None}},
    )
    await audit_log(
        "gtin_pool.sync_retried", "gtin_pool", gtin,
        entity_label=gtin, user=current_user,
        detail={"product_id": doc["odoo_product_id"]},
    )
    return {"success": True, "gtin": gtin}


# ── Unassign from product ──────────────────────────────────────────────────────

@router.post("/{gtin}/unassign")
async def unassign_gtin(
    gtin: str,
    current_user: dict = Depends(require_admin),
):
    doc = await col("gtin_pool").find_one({"gtin": gtin})
    if not doc:
        raise HTTPException(status_code=404, detail="GTIN not found in pool")
    if doc.get("status") != "assigned":
        raise HTTPException(status_code=409, detail="This GTIN is not currently assigned.")

    # Same best-effort philosophy as assign: don't let an Odoo-side access
    # issue leave the GTIN stuck assigned in the portal with no way back to
    # the pool. If it was never actually synced to Odoo (odoo_synced is False),
    # there's nothing to clear there in the first place, so skip the write.
    odoo_synced = True
    sync_error = None
    if doc.get("odoo_synced") is not False:
        try:
            get_odoo_client().write("product.template", [doc["odoo_product_id"]], {"barcode": False})
        except Exception as exc:
            odoo_synced = False
            sync_error = str(exc)

    prev_product = doc.get("product_name")
    await col("gtin_pool").update_one(
        {"gtin": gtin},
        {"$set": {
            "status":          "available",
            "odoo_product_id": None,
            "product_name":    None,
            "assigned_at":     None,
            "assigned_by":     None,
            "odoo_synced":     None,
            "sync_error":      None,
        }},
    )
    await audit_log(
        "gtin_pool.unassigned", "gtin_pool", gtin,
        entity_label=gtin, user=current_user,
        detail={"product_id": doc.get("odoo_product_id"), "product_name": prev_product,
                "odoo_clear_synced": odoo_synced, "sync_error": sync_error},
    )
    result = {"success": True, "gtin": gtin}
    if not odoo_synced:
        result["warning"] = (
            f"Released in the portal, but the barcode could not be cleared from the product in Odoo ({sync_error}). "
            "Clear it manually in Odoo if needed."
        )
    return result
