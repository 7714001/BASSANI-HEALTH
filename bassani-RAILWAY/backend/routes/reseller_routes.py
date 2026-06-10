from fastapi import APIRouter, Depends, HTTPException, Query
from typing import Optional
from pydantic import BaseModel
from datetime import datetime, timezone
from auth import get_current_user, require_admin, hash_password
from odoo_client import get_odoo_client
from database import col, NO_ID

router = APIRouter(prefix="/api/resellers", tags=["resellers"])

# ── Pydantic models ───────────────────────────────────────────────────────────

COMMISSION_RATE = 12.5   # Flat rate for all resellers — no per-category breakdown

class ResellerCreate(BaseModel):
    name: str
    type: str = "Distributor"               # Distributor|Agent|Broker
    seller_code: str                         # e.g. JOE001 — unique lookup key
    contact_person: Optional[str] = ""
    email: Optional[str] = ""
    phone: Optional[str] = ""
    address: Optional[str] = ""
    odoo_partner_id: Optional[int] = None   # Odoo vendor partner for commission billing — optional
    username: str                           # Login username for the reseller portal
    password: str                           # Hashed immediately — never stored plain
    vat_registered: bool = False
    vat_number: Optional[str] = ""
    bank_name: Optional[str] = ""
    bank_account_holder: Optional[str] = ""
    bank_account_number: Optional[str] = ""
    bank_branch_code: Optional[str] = ""

class ResellerUpdate(BaseModel):
    name: Optional[str] = None
    type: Optional[str] = None
    contact_person: Optional[str] = None
    email: Optional[str] = None
    phone: Optional[str] = None
    address: Optional[str] = None
    active: Optional[bool] = None
    vat_registered: Optional[bool] = None
    vat_number: Optional[str] = None
    bank_name: Optional[str] = None
    bank_account_holder: Optional[str] = None
    bank_account_number: Optional[str] = None
    bank_branch_code: Optional[str] = None

# ── Endpoints ─────────────────────────────────────────────────────────────────

@router.get("/")
async def list_resellers(
    search: Optional[str] = None,
    limit: int = Query(50, le=200),
    offset: int = 0,
    current_user: dict = Depends(require_admin),
):
    """List all resellers. Admin only."""
    query = {"active": {"$ne": False}}
    if search:
        query["$or"] = [
            {"name": {"$regex": search, "$options": "i"}},
            {"seller_code": {"$regex": search, "$options": "i"}},
            {"contact_person": {"$regex": search, "$options": "i"}},
        ]
    cursor = col("resellers").find(query, NO_ID).skip(offset).limit(limit)
    resellers = await cursor.to_list(length=limit)
    total = await col("resellers").count_documents(query)
    return {"resellers": resellers, "total": total}


@router.get("/by-code/{seller_code}")
async def get_reseller_by_code(
    seller_code: str,
    current_user: dict = Depends(get_current_user),
):
    """
    Quick lookup by seller code (e.g. JOE001).
    Used during order entry to auto-apply commission rates.
    """
    reseller = await col("resellers").find_one(
        {"seller_code": seller_code.upper(), "active": {"$ne": False}}, NO_ID
    )
    if not reseller:
        raise HTTPException(status_code=404, detail=f"No reseller found with code '{seller_code}'")
    return reseller


@router.get("/{reseller_id}")
async def get_reseller(
    reseller_id: str,
    current_user: dict = Depends(get_current_user),
):
    """Get a single reseller. Resellers can only view their own record."""
    # Reseller role — restrict to own record
    if current_user.get("role") == "reseller":
        reseller = await col("resellers").find_one(
            {"user_id": current_user["id"]}, NO_ID
        )
        if not reseller or reseller["id"] != reseller_id:
            raise HTTPException(status_code=403, detail="Access denied")
        return reseller

    reseller = await col("resellers").find_one({"id": reseller_id}, NO_ID)
    if not reseller:
        raise HTTPException(status_code=404, detail="Reseller not found")
    return reseller


@router.post("/")
async def create_reseller(
    reseller: ResellerCreate,
    current_user: dict = Depends(require_admin),
):
    """
    Create a reseller. Admin only.
    Validates the Odoo partner exists, then atomically creates:
      1. A login account in the users collection
      2. The reseller record linked to both the user and the Odoo partner
    Rolls back the user account if the reseller insert fails.
    """
    odoo = get_odoo_client()

    # Validate Odoo partner exists when provided
    if reseller.odoo_partner_id:
        try:
            partners = odoo.read(
                "res.partner",
                [reseller.odoo_partner_id],
                fields=["id", "name", "email"],
            )
            if not partners:
                raise HTTPException(status_code=400, detail="Odoo partner not found — check the partner ID")
        except HTTPException:
            raise
        except Exception as e:
            raise HTTPException(status_code=502, detail=f"Could not verify Odoo partner: {str(e)}")

    # Uniqueness checks before any writes
    if await col("resellers").find_one({"seller_code": reseller.seller_code.upper()}):
        raise HTTPException(status_code=400, detail=f"Seller code '{reseller.seller_code}' already exists")
    if reseller.odoo_partner_id and await col("resellers").find_one({"odoo_partner_id": reseller.odoo_partner_id}):
        raise HTTPException(status_code=400, detail="This Odoo partner is already linked to a reseller")
    if await col("users").find_one({"username": reseller.username}):
        raise HTTPException(status_code=400, detail=f"Username '{reseller.username}' is already taken")

    now = datetime.now(timezone.utc)
    reseller_id = f"reseller_{reseller.seller_code.lower()}"

    # Step 1 — create login account
    user_doc = {
        "username": reseller.username,
        "password": hash_password(reseller.password),
        "role": "reseller",
        "name": reseller.name,
        "reseller_id": reseller_id,
        "active": True,
        "created_at": now,
    }
    user_result = await col("users").insert_one(user_doc)
    user_id = str(user_result.inserted_id)

    # Step 2 — create reseller record (rollback user if this fails)
    reseller_doc = {
        "id": reseller_id,
        "name": reseller.name,
        "type": reseller.type,
        "seller_code": reseller.seller_code.upper(),
        "contact_person": reseller.contact_person,
        "email": reseller.email,
        "phone": reseller.phone,
        "address": reseller.address,
        "default_commission": COMMISSION_RATE,
        "odoo_partner_id": reseller.odoo_partner_id,
        "user_id": user_id,
        "vat_registered": reseller.vat_registered,
        "vat_number": reseller.vat_number or "",
        "bank_name": reseller.bank_name or "",
        "bank_account_holder": reseller.bank_account_holder or "",
        "bank_account_number": reseller.bank_account_number or "",
        "bank_branch_code": reseller.bank_branch_code or "",
        "total_sales": 0.0,
        "total_commission": 0.0,
        "active": True,
        "created_at": now,
        "updated_at": now,
    }
    try:
        await col("resellers").insert_one(reseller_doc)
    except Exception as e:
        await col("users").delete_one({"_id": user_result.inserted_id})
        raise HTTPException(status_code=500, detail=f"Reseller creation failed — login account rolled back: {str(e)}")

    return {"success": True, "reseller_id": reseller_id, "user_id": user_id}


@router.put("/{reseller_id}")
async def update_reseller(
    reseller_id: str,
    reseller: ResellerUpdate,
    current_user: dict = Depends(require_admin),
):
    """Update a reseller. Admin only."""
    existing = await col("resellers").find_one({"id": reseller_id})
    if not existing:
        raise HTTPException(status_code=404, detail="Reseller not found")

    updates = {k: v for k, v in reseller.model_dump().items() if v is not None}
    if not updates:
        raise HTTPException(status_code=400, detail="No fields to update")

    updates["updated_at"] = datetime.now(timezone.utc)
    await col("resellers").update_one({"id": reseller_id}, {"$set": updates})
    return {"success": True}


@router.delete("/{reseller_id}")
async def deactivate_reseller(
    reseller_id: str,
    current_user: dict = Depends(require_admin),
):
    """Soft-delete a reseller. Admin only."""
    result = await col("resellers").update_one(
        {"id": reseller_id},
        {"$set": {"active": False, "updated_at": datetime.now(timezone.utc)}},
    )
    if result.matched_count == 0:
        raise HTTPException(status_code=404, detail="Reseller not found")
    return {"success": True, "message": "Reseller deactivated"}


@router.get("/{reseller_id}/stats")
async def reseller_stats(
    reseller_id: str,
    current_user: dict = Depends(get_current_user),
):
    """Commission and sales summary for a reseller."""
    reseller = await col("resellers").find_one({"id": reseller_id}, NO_ID)
    if not reseller:
        raise HTTPException(status_code=404, detail="Reseller not found")

    # Count orders linked to this reseller
    total_orders = await col("order_commissions").count_documents(
        {"reseller_id": reseller_id}
    )

    # Sum commission this month
    from datetime import date
    start_of_month = datetime(date.today().year, date.today().month, 1, tzinfo=timezone.utc)
    pipeline = [
        {"$match": {"reseller_id": reseller_id, "created_at": {"$gte": start_of_month}}},
        {"$group": {"_id": None, "month_commission": {"$sum": "$commission_total"}}},
    ]
    result = await col("order_commissions").aggregate(pipeline).to_list(1)
    month_commission = result[0]["month_commission"] if result else 0

    return {
        "reseller_id": reseller_id,
        "name": reseller["name"],
        "total_sales": reseller.get("total_sales", 0),
        "total_commission": reseller.get("total_commission", 0),
        "total_orders": total_orders,
        "month_commission": month_commission,
    }
