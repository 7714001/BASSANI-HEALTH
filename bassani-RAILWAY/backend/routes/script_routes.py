"""SAHPRA script expiry tracking — alerts, renewal reminders, order blocking."""
from fastapi import APIRouter, Depends, HTTPException
from pydantic import BaseModel
from typing import Optional
from datetime import datetime, timezone, date, timedelta
from auth import require_admin, get_current_user
from database import col, NO_ID

router = APIRouter(prefix="/api/scripts", tags=["scripts"])

class ScriptUpdate(BaseModel):
    new_script_number: str
    new_expiry_date: str       # YYYY-MM-DD
    prescribing_doctor: Optional[str] = None
    notes: str = ""

@router.get("/expiring")
async def expiring_scripts(days: int = 60, _: dict = Depends(require_admin)):
    """Return all private patients with scripts expiring within N days."""
    cutoff = (date.today() + timedelta(days=days)).isoformat()
    today  = date.today().isoformat()
    patients = await col("customers").find(
        {"is_private": True, "s21script": {"$exists": True, "$ne": ""},
         "expiry_date": {"$gte": today, "$lte": cutoff}},
        NO_ID).sort("expiry_date", 1).to_list(200)

    expired = await col("customers").find(
        {"is_private": True, "expiry_date": {"$lt": today}},
        NO_ID).to_list(100)

    for p in patients:
        exp = datetime.strptime(p["expiry_date"], "%Y-%m-%d").date()
        p["days_remaining"] = (exp - date.today()).days

    return {"expiring_soon": patients, "expired": expired,
            "expiring_count": len(patients), "expired_count": len(expired)}

@router.get("/check/{patient_id}")
async def check_script(patient_id: int, product_id: int = 0,
                       _: dict = Depends(get_current_user)):
    """Check if a patient's script is valid before placing an order."""
    patient = await col("customers").find_one({"id": patient_id}, NO_ID)
    if not patient: raise HTTPException(404, "Patient not found")
    if not patient.get("is_private"):
        return {"valid": True, "reason": "Not a private patient — no script required"}

    script   = patient.get("s21script", "")
    expiry   = patient.get("expiry_date", "")
    today    = date.today().isoformat()

    if not script:
        return {"valid": False, "reason": "No Section 21 script on file", "block_order": True}
    if expiry and expiry < today:
        return {"valid": False, "reason": f"Script {script} expired on {expiry}", "block_order": True}
    if expiry:
        days_left = (datetime.strptime(expiry, "%Y-%m-%d").date() - date.today()).days
        if days_left <= 30:
            return {"valid": True, "warn": True,
                    "reason": f"Script expires in {days_left} days — renewal recommended",
                    "block_order": False}
    return {"valid": True, "script": script, "expiry": expiry, "block_order": False}

@router.put("/{patient_id}/renew")
async def renew_script(patient_id: int, upd: ScriptUpdate, _: dict = Depends(require_admin)):
    """Update a patient's Section 21 script after renewal."""
    result = await col("customers").update_one(
        {"id": patient_id},
        {"$set": {"s21script": upd.new_script_number, "expiry_date": upd.new_expiry_date,
                  "doctor": upd.prescribing_doctor or None,
                  "script_renewed_at": datetime.now(timezone.utc)}})
    if result.matched_count == 0: raise HTTPException(404, "Patient not found")
    return {"success": True, "message": f"Script renewed → {upd.new_script_number}, expires {upd.new_expiry_date}"}

@router.get("/dashboard")
async def script_dashboard(_: dict = Depends(require_admin)):
    """Summary card counts for the dashboard."""
    today  = date.today().isoformat()
    warn30 = (date.today() + timedelta(days=30)).isoformat()
    warn60 = (date.today() + timedelta(days=60)).isoformat()
    expired  = await col("customers").count_documents({"is_private":True,"expiry_date":{"$lt":today}})
    warn30c  = await col("customers").count_documents({"is_private":True,"expiry_date":{"$gte":today,"$lte":warn30}})
    warn60c  = await col("customers").count_documents({"is_private":True,"expiry_date":{"$gte":today,"$lte":warn60}})
    total_pp = await col("customers").count_documents({"is_private":True})
    return {"total_private_patients":total_pp,"expired":expired,"expiring_30":warn30c,"expiring_60":warn60c}
