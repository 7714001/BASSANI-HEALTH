"""
GTIN Pool — Phase 12.5.

Manages Bassani's purchased GS1 GTIN codes. Each GTIN is stored in MongoDB
with an availability status and, when assigned, a reference to the Odoo
product it is linked to. Assignment writes to the Odoo product variant's
barcode (product.product), the same record the Products list, GS1 labels and
the product page's own barcode endpoint use. Fixed 2026-10-11: it used to
write to product.template with the variant's id; variant and template ids
differ for almost every product (1,673 of 1,689 live), so the write failed
with "Record does not exist" (and could have hit an unrelated template whose
id happened to match; a live check found none had).

Lifecycle (12.10, 2026-10-11) — GS1: a GTIN allocated to a trade item is never
reallocated to a different one (healthcare: never reused).
  available -> assigned            (Assign)
  assigned  -> assigned            (Relink: same physical product, new Odoo
                                    record, e.g. Bassani deleted and recreated
                                    the product. Not reuse.)
  assigned  -> retired             (Retire: product discontinued; the GTIN is
                                    kept on record and never reissued)
  assigned  -> available           (Release: only when assigned by mistake and
                                    never used; settings.manage + reason)
Every change is pushed onto the doc's `history` and audit-logged.
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


class RelinkBody(BaseModel):
    odoo_product_id: int
    product_name: str
    reason: Optional[str] = None


class ReasonBody(BaseModel):
    reason: Optional[str] = None


class BulkRelinkItem(BaseModel):
    gtin: str
    odoo_product_id: int
    product_name: str


class BulkRelinkBody(BaseModel):
    items: list[BulkRelinkItem]
    reason: Optional[str] = None


def _history_entry(action: str, user: dict, **extra) -> dict:
    return {"action": action, "by": user.get("username"), "by_name": user.get("name") or user.get("username"),
            "at": datetime.now(timezone.utc), **extra}


def _existing_variant_ids(odoo, ids: list) -> set:
    """Which of these product.product ids still exist in Odoo (archived
    counts as existing — only a deleted record is gone)."""
    if not ids:
        return set()
    rows = odoo.search_read(
        "product.product", ["&", ("id", "in", list(ids)), "|", ("active", "=", True), ("active", "=", False)],
        fields=["id"], limit=len(ids),
    )
    return {r["id"] for r in rows}


# ── Stats (defined before /{gtin} to avoid path conflict) ─────────────────────

@router.get("/stats")
async def get_stats(_: dict = Depends(require_admin)):
    total     = await col("gtin_pool").count_documents({})
    available = await col("gtin_pool").count_documents({"status": "available"})
    assigned  = await col("gtin_pool").count_documents({"status": "assigned"})
    retired   = await col("gtin_pool").count_documents({"status": "retired"})
    return {"total": total, "available": available, "assigned": assigned, "retired": retired}


# ── Orphans: assigned to a product that no longer exists in Odoo ──────────────

@router.get("/orphans")
async def list_orphans(_: dict = Depends(require_admin)):
    """GTINs still assigned to an Odoo variant that has been deleted (e.g.
    Bassani deleted and recreated their products). Each comes with suggested
    replacement variants: same name, not already carrying a barcode first."""
    docs = await col("gtin_pool").find(
        {"status": "assigned", "odoo_product_id": {"$ne": None}},
        {"_id": 0, "gtin": 1, "odoo_product_id": 1, "product_name": 1, "assigned_at": 1},
    ).to_list(5000)
    if not docs:
        return {"items": []}
    odoo = get_odoo_client()
    try:
        alive = _existing_variant_ids(odoo, [d["odoo_product_id"] for d in docs])
    except Exception as e:
        raise HTTPException(status_code=502, detail=f"Could not check products in Odoo: {e}")
    claimed = {d["odoo_product_id"] for d in docs if d["odoo_product_id"] in alive}
    out = []
    for d in docs:
        if d["odoo_product_id"] in alive:
            continue
        candidates = []
        name = (d.get("product_name") or "").strip()
        if name:
            try:
                rows = odoo.search_read(
                    "product.product", [("name", "=", name)],
                    fields=["id", "display_name", "default_code", "barcode"], limit=10,
                )
                if not rows:
                    rows = odoo.search_read(
                        "product.product", [("name", "ilike", name)],
                        fields=["id", "display_name", "default_code", "barcode"], limit=10,
                    )
            except Exception:
                rows = []
            for r in rows:
                candidates.append({
                    "id": r["id"], "display_name": r["display_name"],
                    "default_code": r.get("default_code") or None,
                    "barcode": r.get("barcode") or None,
                    "has_pool_gtin": r["id"] in claimed,
                })
            candidates.sort(key=lambda c: (bool(c["barcode"]) or c["has_pool_gtin"], c["display_name"]))
        out.append({**d, "candidates": candidates})
    return {"items": out}


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
    if status in ("available", "assigned", "retired"):
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
            detail=f"GTIN {gtin} is currently assigned to {doc.get('product_name', 'a product')}.",
        )
    if doc.get("status") == "retired":
        raise HTTPException(status_code=409, detail="Retired GTINs are kept on record for traceability and can't be removed.")
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
    if doc.get("status") == "retired":
        raise HTTPException(status_code=409, detail=f"GTIN {gtin} is retired and can never be reissued.")
    other = await col("gtin_pool").find_one({"status": "assigned", "odoo_product_id": body.odoo_product_id})
    if other:
        raise HTTPException(
            status_code=409,
            detail=f"This product already has GTIN {other['gtin']} from the pool. A product carries one GTIN.",
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
        get_odoo_client().write("product.product", [body.odoo_product_id], {"barcode": gtin})
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
        },
         "$push": {"history": _history_entry("assigned", current_user, product_id=body.odoo_product_id,
                                             product_name=body.product_name)}},
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
        get_odoo_client().write("product.product", [doc["odoo_product_id"]], {"barcode": gtin})
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


# ── Relink: same product, new Odoo record ─────────────────────────────────────

async def _relink(doc: dict, new_id: int, new_name: str, reason: Optional[str], current_user: dict, odoo) -> dict:
    gtin = doc["gtin"]
    if doc.get("status") != "assigned":
        raise HTTPException(status_code=409, detail=f"GTIN {gtin} is not assigned, so there is nothing to relink.")
    if doc.get("odoo_product_id") == new_id:
        raise HTTPException(status_code=400, detail=f"GTIN {gtin} is already linked to that product.")
    other = await col("gtin_pool").find_one({"status": "assigned", "odoo_product_id": new_id, "gtin": {"$ne": gtin}})
    if other:
        raise HTTPException(status_code=409,
                            detail=f"{new_name} already has GTIN {other['gtin']} from the pool.")
    old_id = doc.get("odoo_product_id")
    # Clear the barcode from the old variant if it still exists (Odoo won't
    # allow the same barcode on two products); usually it has been deleted.
    if old_id and old_id in _existing_variant_ids(odoo, [old_id]):
        try:
            odoo.write("product.product", [old_id], {"barcode": False})
        except Exception:
            pass
    odoo_synced, sync_error = True, None
    try:
        odoo.write("product.product", [new_id], {"barcode": gtin})
    except Exception as exc:
        odoo_synced, sync_error = False, str(exc)
    await col("gtin_pool").update_one(
        {"gtin": gtin},
        {"$set": {"odoo_product_id": new_id, "product_name": new_name,
                  "odoo_synced": odoo_synced, "sync_error": sync_error},
         "$push": {"history": _history_entry(
             "relinked", current_user, from_product_id=old_id, from_product_name=doc.get("product_name"),
             product_id=new_id, product_name=new_name, reason=reason or None)}},
    )
    await audit_log(
        "gtin_pool.relinked", "gtin_pool", gtin, entity_label=gtin, user=current_user,
        before={"product_id": old_id, "product_name": doc.get("product_name")},
        after={"product_id": new_id, "product_name": new_name},
        detail={"reason": reason, "odoo_synced": odoo_synced, "sync_error": sync_error},
    )
    return {"gtin": gtin, "odoo_synced": odoo_synced, "sync_error": sync_error}


@router.post("/relink-bulk")
async def relink_bulk(body: BulkRelinkBody, current_user: dict = Depends(require_admin)):
    """Relink several GTINs at once — the "products were deleted and
    recreated in Odoo" clean-up. Each item is independent: one failure
    doesn't stop the rest."""
    odoo = get_odoo_client()
    targets = [i.odoo_product_id for i in body.items]
    if len(targets) != len(set(targets)):
        raise HTTPException(status_code=400, detail="Two GTINs can't be linked to the same product.")
    results = []
    for item in body.items:
        doc = await col("gtin_pool").find_one({"gtin": item.gtin})
        if not doc:
            results.append({"gtin": item.gtin, "error": "Not in the pool"})
            continue
        try:
            results.append(await _relink(doc, item.odoo_product_id, item.product_name, body.reason, current_user, odoo))
        except HTTPException as e:
            results.append({"gtin": item.gtin, "error": e.detail})
    return {"results": results,
            "relinked": sum(1 for r in results if not r.get("error")),
            "not_synced": sum(1 for r in results if r.get("odoo_synced") is False)}


@router.post("/{gtin}/relink")
async def relink_gtin(gtin: str, body: RelinkBody, current_user: dict = Depends(require_admin)):
    doc = await col("gtin_pool").find_one({"gtin": gtin})
    if not doc:
        raise HTTPException(status_code=404, detail="GTIN not found in pool")
    r = await _relink(doc, body.odoo_product_id, body.product_name, body.reason, current_user, get_odoo_client())
    result = {"success": True, **r}
    if r["odoo_synced"] is False:
        result["warning"] = (f"Relinked in the portal, but the barcode could not be updated in Odoo ({r['sync_error']}). "
                             "Use Retry Sync once resolved.")
    return result


# ── Retire: discontinued product, never reissued ──────────────────────────────

@router.post("/{gtin}/retire")
async def retire_gtin(gtin: str, body: ReasonBody, current_user: dict = Depends(require_permission("settings.manage"))):
    reason = (body.reason or "").strip()
    if not reason:
        raise HTTPException(status_code=400, detail="A reason is required (e.g. product discontinued)")
    doc = await col("gtin_pool").find_one({"gtin": gtin})
    if not doc:
        raise HTTPException(status_code=404, detail="GTIN not found in pool")
    if doc.get("status") != "assigned":
        raise HTTPException(status_code=409, detail="Only an assigned GTIN can be retired.")
    odoo = get_odoo_client()
    cleared = None
    pid = doc.get("odoo_product_id")
    if pid and doc.get("odoo_synced") is not False and pid in _existing_variant_ids(odoo, [pid]):
        try:
            odoo.write("product.product", [pid], {"barcode": False})
            cleared = True
        except Exception:
            cleared = False
    now = datetime.now(timezone.utc)
    await col("gtin_pool").update_one(
        {"gtin": gtin},
        {"$set": {"status": "retired", "retired_at": now, "retired_by": current_user.get("username"),
                  "retired_reason": reason, "odoo_synced": None, "sync_error": None},
         "$push": {"history": _history_entry("retired", current_user, product_id=pid,
                                             product_name=doc.get("product_name"), reason=reason)}},
    )
    await audit_log("gtin_pool.retired", "gtin_pool", gtin, entity_label=gtin, user=current_user,
                    detail={"product_id": pid, "product_name": doc.get("product_name"), "reason": reason,
                            "odoo_barcode_cleared": cleared})
    result = {"success": True, "gtin": gtin}
    if cleared is False:
        result["warning"] = "Retired, but the barcode could not be cleared from the product in Odoo. Clear it manually if needed."
    return result


# ── Release: assigned by mistake, never used ──────────────────────────────────

@router.post("/{gtin}/unassign")
async def unassign_gtin(
    gtin: str,
    body: ReasonBody = ReasonBody(),
    current_user: dict = Depends(require_permission("settings.manage")),
):
    """Return a GTIN to the available pool. Only for a GTIN assigned by
    mistake that was never printed or used: GS1 doesn't allow a GTIN to move
    to a different product once it has identified one. For a recreated
    product use Relink; for a discontinued one use Retire."""
    reason = (body.reason or "").strip()
    if not reason:
        raise HTTPException(status_code=400, detail="A reason is required (e.g. assigned to the wrong product, never printed)")
    doc = await col("gtin_pool").find_one({"gtin": gtin})
    if not doc:
        raise HTTPException(status_code=404, detail="GTIN not found in pool")
    if doc.get("status") != "assigned":
        raise HTTPException(status_code=409, detail="This GTIN is not currently assigned.")

    odoo = get_odoo_client()
    odoo_synced, sync_error = True, None
    pid = doc.get("odoo_product_id")
    if doc.get("odoo_synced") is not False and pid and pid in _existing_variant_ids(odoo, [pid]):
        try:
            odoo.write("product.product", [pid], {"barcode": False})
        except Exception as exc:
            odoo_synced, sync_error = False, str(exc)

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
        },
         "$push": {"history": _history_entry("released_in_error", current_user, product_id=pid,
                                             product_name=prev_product, reason=reason)}},
    )
    await audit_log(
        "gtin_pool.unassigned", "gtin_pool", gtin,
        entity_label=gtin, user=current_user,
        detail={"product_id": pid, "product_name": prev_product, "reason": reason,
                "odoo_clear_synced": odoo_synced, "sync_error": sync_error},
    )
    result = {"success": True, "gtin": gtin}
    if not odoo_synced:
        result["warning"] = (
            f"Released in the portal, but the barcode could not be cleared from the product in Odoo ({sync_error}). "
            "Clear it manually in Odoo if needed."
        )
    return result
