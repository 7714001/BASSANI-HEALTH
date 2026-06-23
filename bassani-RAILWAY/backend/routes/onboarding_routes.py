from fastapi import APIRouter, BackgroundTasks, Depends, HTTPException, Query
from typing import Optional
from pydantic import BaseModel
from datetime import datetime, timezone
import uuid
from auth import get_current_user, require_admin, require_permission
from odoo_client import get_odoo_client
from database import col, NO_ID
from middleware.audit import audit_log
from services.email_service import send_onboarding_submitted, send_onboarding_approved, send_onboarding_rejected

router = APIRouter(prefix="/api/onboarding", tags=["onboarding"])

SA_PROVINCES = [
    "Gauteng", "Western Cape", "KwaZulu-Natal", "Eastern Cape",
    "Limpopo", "Mpumalanga", "North West", "Free State", "Northern Cape",
]

# ── Pydantic models ───────────────────────────────────────────────────────────

class OnboardingApplication(BaseModel):
    # Step 1 — Business details
    company_name:        str
    trading_name:        Optional[str] = ""
    registration_number: Optional[str] = ""
    vat_number:          Optional[str] = ""
    business_type:       str = "Pharmacy"   # Pharmacy | Dispensary | Healthcare Provider | Wellness Centre | Private Practice | Other

    # Step 2 — Primary contact
    contact_name:      str
    contact_position:  Optional[str] = ""
    contact_email:     str
    contact_phone:     str
    contact_alt_phone: Optional[str] = ""

    # Step 3 — Business address
    street:      str
    suburb:      Optional[str] = ""
    city:        str
    province:    Optional[str] = ""
    postal_code: Optional[str] = ""
    country:     str = "South Africa"

    # Step 4 — Additional information
    ordering_volume:  Optional[str] = ""   # < 10 / 10-50 / 50-100 / 100+
    referral_source:  Optional[str] = ""
    notes:            Optional[str] = ""


class RejectBody(BaseModel):
    reason: str


# ── Endpoints ─────────────────────────────────────────────────────────────────

@router.post("/")
async def submit_application(
    application: OnboardingApplication,
    background_tasks: BackgroundTasks,
    current_user: dict = Depends(get_current_user),
):
    """Reseller submits a customer onboarding application for admin review."""
    if current_user.get("role") != "reseller":
        raise HTTPException(status_code=403, detail="Only resellers can submit onboarding applications")

    reseller = await col("resellers").find_one({"user_id": current_user["id"]}, NO_ID)
    if not reseller:
        raise HTTPException(status_code=400, detail="Reseller profile not found")

    ref = f"APP-{str(uuid.uuid4())[:8].upper()}"

    doc = {
        "id":           ref,
        "reseller_id":  reseller["id"],
        "reseller_name": reseller.get("name", current_user.get("username", "")),
        "status":       "pending",
        "submitted_at": datetime.now(timezone.utc),
        "reviewed_at":  None,
        "reviewed_by":  None,
        "rejection_reason": None,
        "odoo_partner_id":  None,
        **application.model_dump(),
    }
    await col("customer_onboarding").insert_one(doc)
    await audit_log("onboarding.submit", "customer_onboarding", ref,
                    entity_label=application.company_name, user=current_user,
                    reseller_id=reseller["id"])
    background_tasks.add_task(
        send_onboarding_submitted,
        company_name=application.company_name,
        reseller_name=reseller.get("name", current_user.get("username", "")),
        app_ref=ref,
    )
    return {"success": True, "reference": ref}


@router.get("/pending-count")
async def pending_count(current_user: dict = Depends(require_admin)):
    """Used by the admin nav badge."""
    count = await col("customer_onboarding").count_documents({"status": "pending"})
    return {"count": count}


@router.get("/")
async def list_applications(
    status: Optional[str] = None,
    limit:  int = Query(50, le=200),
    offset: int = 0,
    current_user: dict = Depends(get_current_user),
):
    query: dict = {}

    if current_user.get("role") == "reseller":
        reseller = await col("resellers").find_one({"user_id": current_user["id"]}, NO_ID)
        query["reseller_id"] = reseller["id"] if reseller else "__none__"

    if status and status != "all":
        query["status"] = status

    total = await col("customer_onboarding").count_documents(query)
    apps = await (
        col("customer_onboarding")
        .find(query, NO_ID)
        .sort("submitted_at", -1)
        .skip(offset)
        .limit(limit)
        .to_list(length=limit)
    )
    return {"applications": apps, "total": total}


@router.get("/{app_id}")
async def get_application(app_id: str, current_user: dict = Depends(get_current_user)):
    app = await col("customer_onboarding").find_one({"id": app_id}, NO_ID)
    if not app:
        raise HTTPException(status_code=404, detail="Application not found")
    if current_user.get("role") == "reseller":
        reseller = await col("resellers").find_one({"user_id": current_user["id"]}, NO_ID)
        if not reseller or app.get("reseller_id") != reseller["id"]:
            raise HTTPException(status_code=403, detail="Access denied")
    return app


@router.put("/{app_id}/approve")
async def approve_application(app_id: str, background_tasks: BackgroundTasks, current_user: dict = Depends(require_permission("customers.approve_onboarding"))):
    """
    Approve an onboarding application:
    1. Create res.partner in Odoo
    2. Insert customer_ownership record linking partner to reseller
    3. Mark application as approved
    """
    app = await col("customer_onboarding").find_one({"id": app_id}, NO_ID)
    if not app:
        raise HTTPException(status_code=404, detail="Application not found")
    if app["status"] != "pending":
        raise HTTPException(status_code=400, detail=f"Application is already {app['status']}")

    odoo = get_odoo_client()
    notes_parts = [f"Type: {app.get('business_type', '')}"]
    if app.get("registration_number"):
        notes_parts.append(f"Reg: {app['registration_number']}")
    if app.get("vat_number"):
        notes_parts.append(f"VAT: {app['vat_number']}")
    if app.get("trading_name"):
        notes_parts.append(f"Trading as: {app['trading_name']}")
    notes_parts.append(f"Onboarded via: {app_id}")

    vals: dict = {
        "name":          app["company_name"],
        "company_type":  "company",
        "customer_rank": 1,
        "comment":       " | ".join(notes_parts),
    }
    if app.get("contact_email"):  vals["email"]  = app["contact_email"]
    if app.get("contact_phone"):  vals["phone"]  = app["contact_phone"]
    if app.get("street"):         vals["street"] = app["street"]
    if app.get("suburb"):         vals["street2"] = app["suburb"]
    if app.get("city"):           vals["city"]   = app["city"]
    if app.get("postal_code"):    vals["zip"]    = app["postal_code"]
    if app.get("vat_number"):     vals["vat"]    = app["vat_number"]

    try:
        partner_id = odoo.create("res.partner", vals)
    except Exception as e:
        raise HTTPException(status_code=502, detail=f"Failed to create Odoo customer: {str(e)}")

    await col("customer_ownership").insert_one({
        "odoo_partner_id":     partner_id,
        "reseller_id":         app["reseller_id"],
        "reseller_name":       app.get("reseller_name", ""),
        "created_at":          datetime.now(timezone.utc),
        "created_by_username": current_user.get("username", ""),
        "onboarding_ref":      app_id,
    })

    await col("customer_onboarding").update_one(
        {"id": app_id},
        {"$set": {
            "status":          "approved",
            "odoo_partner_id": partner_id,
            "reviewed_at":     datetime.now(timezone.utc),
            "reviewed_by":     current_user.get("username", ""),
        }},
    )
    await audit_log("onboarding.approve", "customer_onboarding", app_id,
                    entity_label=app.get("company_name", ""), user=current_user,
                    detail={"odoo_partner_id": partner_id},
                    reseller_id=app.get("reseller_id"))

    _res = await col("resellers").find_one({"id": app.get("reseller_id")}, {"email": 1, "_id": 0})
    if _res and _res.get("email"):
        background_tasks.add_task(
            send_onboarding_approved,
            company_name=app.get("company_name", ""),
            reseller_name=app.get("reseller_name", ""),
            reseller_email=_res["email"],
            customer_contact_email=app.get("contact_email"),
        )

    return {"success": True, "odoo_partner_id": partner_id}


@router.put("/{app_id}/reject")
async def reject_application(
    app_id: str,
    body:   RejectBody,
    background_tasks: BackgroundTasks,
    current_user: dict = Depends(require_permission("customers.reject_onboarding")),
):
    app = await col("customer_onboarding").find_one({"id": app_id}, NO_ID)
    if not app:
        raise HTTPException(status_code=404, detail="Application not found")
    if app["status"] != "pending":
        raise HTTPException(status_code=400, detail=f"Application is already {app['status']}")

    await col("customer_onboarding").update_one(
        {"id": app_id},
        {"$set": {
            "status":           "rejected",
            "rejection_reason": body.reason,
            "reviewed_at":      datetime.now(timezone.utc),
            "reviewed_by":      current_user.get("username", ""),
        }},
    )
    await audit_log("onboarding.reject", "customer_onboarding", app_id,
                    entity_label=app.get("company_name", ""), user=current_user,
                    detail={"reason": body.reason},
                    reseller_id=app.get("reseller_id"))

    _res = await col("resellers").find_one({"id": app.get("reseller_id")}, {"email": 1, "_id": 0})
    if _res and _res.get("email"):
        background_tasks.add_task(
            send_onboarding_rejected,
            company_name=app.get("company_name", ""),
            reseller_name=app.get("reseller_name", ""),
            reseller_email=_res["email"],
            reason=body.reason,
        )

    return {"success": True}
