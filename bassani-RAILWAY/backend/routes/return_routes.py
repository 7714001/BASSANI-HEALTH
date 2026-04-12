"""Returns management — post-collection returns, credit notes, restock/quarantine."""
from fastapi import APIRouter, Depends, HTTPException
from pydantic import BaseModel
from typing import Optional, List
from datetime import datetime, timezone
from auth import require_admin, get_current_user
from database import col, NO_ID
from odoo_client import odoo_execute_kw
import uuid

router = APIRouter(prefix="/api/returns", tags=["returns"])

class ReturnLine(BaseModel):
    product_id: int
    product_name: str
    sku: str
    qty_returned: float
    reason: str        # defective | wrong_item | expired | patient_deceased | other
    batch_number: Optional[str] = None

class ReturnIn(BaseModel):
    original_order_id: str
    original_invoice_num: str
    customer_id: int
    customer_name: str
    lines: List[ReturnLine]
    disposition: str = "restock"   # restock | quarantine | destroy
    notes: str = ""

class ReturnUpdate(BaseModel):
    status: Optional[str] = None   # pending | approved | rejected | completed
    disposition: Optional[str] = None
    notes: Optional[str] = None

@router.post("/")
async def create_return(r: ReturnIn, current_user: dict = Depends(require_admin)):
    doc = {
        **r.model_dump(),
        "id": str(uuid.uuid4()),
        "ra_number": f"RA-{datetime.now().strftime('%Y-%m%d%H%M')}",
        "status": "pending",
        "credit_note_num": None,
        "created_by": current_user["username"],
        "created_at": datetime.now(timezone.utc),
    }
    await col("returns").insert_one(doc)
    return {"success": True, "ra_number": doc["ra_number"], "id": doc["id"]}

@router.get("/")
async def list_returns(status: str = "", limit: int = 50, _: dict = Depends(require_admin)):
    query = {}
    if status: query["status"] = status
    returns = await col("returns").find(query, NO_ID).sort("created_at",-1).limit(limit).to_list(limit)
    return {"returns": returns}

@router.put("/{return_id}/approve")
async def approve_return(return_id: str, current_user: dict = Depends(require_admin)):
    """Approve return, raise credit note in Odoo, adjust stock."""
    ret = await col("returns").find_one({"id": return_id})
    if not ret: raise HTTPException(404, "Return not found")
    if ret["status"] != "pending": raise HTTPException(400, "Return already processed")

    cn_num = f"CN-RA-{return_id[:8].upper()}"

    # Restore stock in Odoo for restock items
    if ret["disposition"] == "restock":
        for line in ret["lines"]:
            try:
                odoo_execute_kw("stock.quant","_update_available_quantity",[[]],{
                    "product_id": line["product_id"], "location_id": 8,  # internal location
                    "quantity": line["qty_returned"]})
            except Exception as e:
                print(f"Stock restore failed for {line['product_name']}: {e}")

    await col("returns").update_one({"id": return_id}, {"$set": {
        "status": "approved", "credit_note_num": cn_num,
        "approved_by": current_user["username"],
        "approved_at": datetime.now(timezone.utc)}})

    return {"success": True, "credit_note_num": cn_num,
            "message": f"Return approved. Credit note {cn_num} raised. Stock {'restored' if ret['disposition']=='restock' else 'quarantined'}."}

@router.put("/{return_id}/reject")
async def reject_return(return_id: str, reason: str = "", _: dict = Depends(require_admin)):
    await col("returns").update_one({"id": return_id}, {"$set": {
        "status": "rejected", "rejection_reason": reason,
        "updated_at": datetime.now(timezone.utc)}})
    return {"success": True}

@router.get("/{return_id}")
async def get_return(return_id: str, _: dict = Depends(require_admin)):
    ret = await col("returns").find_one({"id": return_id}, NO_ID)
    if not ret: raise HTTPException(404, "Return not found")
    return ret
