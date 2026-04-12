"""Batch/lot tracking — cannabis cultivation batches per product."""
from fastapi import APIRouter, Depends, HTTPException
from pydantic import BaseModel
from typing import Optional, List
from datetime import datetime, timezone, date
from auth import require_admin, get_current_user
from database import col, NO_ID
import uuid

router = APIRouter(prefix="/api/batches", tags=["batches"])

class BatchIn(BaseModel):
    product_id: int
    product_name: str
    batch_number: str          # e.g. BATCH-2026-0047
    cultivation_date: Optional[str] = None
    harvest_date: Optional[str] = None
    manufacture_date: str
    expiry_date: str           # YYYY-MM-DD
    quantity: float
    unit: str = "units"
    thc_content: Optional[float] = None   # % for compliance
    cbd_content: Optional[float] = None
    supplier: Optional[str] = None
    notes: str = ""

class BatchUpdate(BaseModel):
    quantity_remaining: Optional[float] = None
    notes: Optional[str] = None
    quarantined: Optional[bool] = None

@router.post("/")
async def create_batch(b: BatchIn, current_user: dict = Depends(require_admin)):
    doc = {**b.model_dump(), "id": str(uuid.uuid4()), "quantity_remaining": b.quantity,
           "quarantined": False, "created_by": current_user["username"],
           "created_at": datetime.now(timezone.utc)}
    await col("batches").insert_one(doc)
    return {"success": True, "batch_id": doc["id"]}

@router.get("/")
async def list_batches(product_id: int = 0, include_expired: bool = False,
                       _: dict = Depends(get_current_user)):
    query: dict = {}
    if product_id: query["product_id"] = product_id
    if not include_expired:
        today = date.today().isoformat()
        query["expiry_date"] = {"$gte": today}
    batches = await col("batches").find(query, NO_ID).sort("expiry_date", 1).to_list(200)
    return {"batches": batches}

@router.get("/expiring")
async def expiring_batches(days: int = 90, _: dict = Depends(require_admin)):
    """Batches expiring within N days."""
    from datetime import timedelta
    cutoff = (date.today() + timedelta(days=days)).isoformat()
    today  = date.today().isoformat()
    batches = await col("batches").find(
        {"expiry_date": {"$gte": today, "$lte": cutoff}, "quarantined": False, "quantity_remaining": {"$gt": 0}},
        NO_ID).sort("expiry_date", 1).to_list(100)
    return {"batches": batches, "count": len(batches)}

@router.put("/{batch_id}")
async def update_batch(batch_id: str, upd: BatchUpdate, _: dict = Depends(require_admin)):
    changes = {k: v for k, v in upd.model_dump().items() if v is not None}
    if not changes: raise HTTPException(400, "Nothing to update")
    changes["updated_at"] = datetime.now(timezone.utc)
    await col("batches").update_one({"id": batch_id}, {"$set": changes})
    return {"success": True}

@router.put("/{batch_id}/quarantine")
async def quarantine_batch(batch_id: str, reason: str = "", _: dict = Depends(require_admin)):
    await col("batches").update_one({"id": batch_id},
        {"$set": {"quarantined": True, "quarantine_reason": reason, "updated_at": datetime.now(timezone.utc)}})
    return {"success": True}

@router.get("/{batch_id}/traceability")
async def batch_traceability(batch_id: str, _: dict = Depends(require_admin)):
    """Which delivery notes / orders used this batch — for recalls."""
    batch = await col("batches").find_one({"id": batch_id}, NO_ID)
    if not batch: raise HTTPException(404, "Batch not found")
    dn_refs = await col("delivery_notes").find({"batch_id": batch_id}, NO_ID).to_list(200)
    return {"batch": batch, "used_in": dn_refs, "total_dispensed": len(dn_refs)}
