from fastapi import APIRouter, BackgroundTasks, Depends, HTTPException, Query
from typing import Optional
from pydantic import BaseModel
from datetime import datetime, timezone
from auth import get_current_user, require_admin, hash_password
from odoo_client import get_odoo_client
from database import col, NO_ID
from middleware.audit import audit_log
from services.email_service import send_welcome_email

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
    warehouse_id: Optional[int] = None      # Odoo stock.warehouse this reseller's orders draw from
    username: str                           # Login username for the reseller portal
    password: str                           # Hashed immediately — never stored plain
    company_reg_number: Optional[str] = ""
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
    odoo_partner_id: Optional[int] = None     # nullable — set to link, omit to leave unchanged
    warehouse_id: Optional[int] = None
    company_reg_number: Optional[str] = None
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
    background_tasks: BackgroundTasks,
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
        "must_change_password": True,
    }
    if reseller.email:
        user_doc["email"] = reseller.email
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
        "warehouse_id": reseller.warehouse_id,
        "user_id": user_id,
        "company_reg_number": reseller.company_reg_number or "",
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

    await audit_log("reseller.create", "reseller", reseller_id, entity_label=reseller.name,
                    user=current_user, after={"seller_code": reseller.seller_code.upper(), "username": reseller.username},
                    reseller_id=reseller_id)
    if reseller.email:
        background_tasks.add_task(
            send_welcome_email,
            username=reseller.username,
            name=reseller.name,
            email=reseller.email,
        )
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

    # odoo_partner_id can be explicitly set to null (to clear the link) — handle separately
    # since the `if v is not None` filter above would silently drop a null value.
    if "odoo_partner_id" in reseller.model_fields_set:
        new_pid = reseller.odoo_partner_id
        if new_pid is not None:
            try:
                partners = get_odoo_client().read("res.partner", [new_pid], fields=["id", "name"])
                if not partners:
                    raise HTTPException(status_code=400, detail="Odoo partner not found — check the partner ID")
            except HTTPException:
                raise
            except Exception:
                pass  # don't block save if Odoo is temporarily unreachable
            conflict = await col("resellers").find_one({"odoo_partner_id": new_pid, "id": {"$ne": reseller_id}})
            if conflict:
                raise HTTPException(status_code=400, detail="This Odoo partner is already linked to another reseller")
        updates["odoo_partner_id"] = new_pid  # None clears the link, int sets it

    if not updates:
        raise HTTPException(status_code=400, detail="No fields to update")

    updates["updated_at"] = datetime.now(timezone.utc)
    await col("resellers").update_one({"id": reseller_id}, {"$set": updates})

    before = {k: existing.get(k) for k in updates if k != "updated_at"}
    await audit_log("reseller.update", "reseller", reseller_id, entity_label=existing.get("name", ""),
                    user=current_user, before=before,
                    after={k: v for k, v in updates.items() if k != "updated_at"},
                    reseller_id=reseller_id)
    return {"success": True}


@router.delete("/{reseller_id}")
async def deactivate_reseller(
    reseller_id: str,
    current_user: dict = Depends(require_admin),
):
    """Soft-delete a reseller. Admin only."""
    existing = await col("resellers").find_one({"id": reseller_id}, NO_ID)
    result = await col("resellers").update_one(
        {"id": reseller_id},
        {"$set": {"active": False, "updated_at": datetime.now(timezone.utc)}},
    )
    if result.matched_count == 0:
        raise HTTPException(status_code=404, detail="Reseller not found")
    await audit_log("reseller.delete", "reseller", reseller_id,
                    entity_label=existing.get("name", "") if existing else "", user=current_user,
                    reseller_id=reseller_id)
    return {"success": True, "message": "Reseller deactivated"}


@router.get("/{reseller_id}/profile")
async def reseller_profile(
    reseller_id: str,
    current_user: dict = Depends(require_admin),
):
    """
    Reseller 360 — aggregates MongoDB profile, commission history,
    linked customers, and recent orders for the admin profile page.
    """
    from datetime import date

    reseller = await col("resellers").find_one({"id": reseller_id}, NO_ID)
    if not reseller:
        raise HTTPException(status_code=404, detail="Reseller not found")

    odoo = get_odoo_client()
    today = date.today()

    # SA financial year: 1 March
    fy_start_year = today.year if today.month >= 3 else today.year - 1
    fy_start = datetime(fy_start_year, 3, 1, tzinfo=timezone.utc)
    fy_label = f"FY{fy_start_year}/{str(fy_start_year + 1)[-2:]}"

    start_of_month = datetime(today.year, today.month, 1, tzinfo=timezone.utc)

    # ── Commission aggregation ─────────────────────────────────────────────────
    pipeline_all = [
        {"$match": {"reseller_id": reseller_id}},
        {"$group": {
            "_id": None,
            "total_commission": {"$sum": "$commission_total"},
            "total_orders":     {"$sum": 1},
        }},
    ]
    all_result = await col("order_commissions").aggregate(pipeline_all).to_list(1)
    total_commission = all_result[0]["total_commission"] if all_result else 0
    total_orders     = all_result[0]["total_orders"]     if all_result else 0

    pipeline_month = [
        {"$match": {"reseller_id": reseller_id, "created_at": {"$gte": start_of_month}}},
        {"$group": {"_id": None, "v": {"$sum": "$commission_total"}, "c": {"$sum": 1}}},
    ]
    month_result      = await col("order_commissions").aggregate(pipeline_month).to_list(1)
    month_commission  = month_result[0]["v"] if month_result else 0
    month_orders      = month_result[0]["c"] if month_result else 0

    pipeline_fy = [
        {"$match": {"reseller_id": reseller_id, "created_at": {"$gte": fy_start}}},
        {"$group": {"_id": None, "v": {"$sum": "$commission_total"}, "c": {"$sum": 1}}},
    ]
    fy_result    = await col("order_commissions").aggregate(pipeline_fy).to_list(1)
    fy_commission = fy_result[0]["v"] if fy_result else 0
    fy_orders     = fy_result[0]["c"] if fy_result else 0

    # ── Linked customers ──────────────────────────────────────────────────────
    ownership_records = await col("customer_ownership").find(
        {"reseller_id": reseller_id}, NO_ID
    ).to_list(length=5000)
    odoo_partner_ids = [o["odoo_partner_id"] for o in ownership_records]
    customer_total   = len(odoo_partner_ids)

    customers = []
    if odoo_partner_ids:
        try:
            rows = odoo.read(
                "res.partner", odoo_partner_ids,
                fields=["id", "name", "email", "city", "phone"],
            )
            customers = [
                {k: (None if v is False else v) for k, v in r.items()}
                for r in rows
            ]
        except Exception:
            pass

    # ── Recent orders (last 10) ───────────────────────────────────────────────
    recent_commissions = await col("order_commissions").find(
        {"reseller_id": reseller_id}, NO_ID
    ).sort("created_at", -1).limit(10).to_list(10)

    recent_orders = []
    if recent_commissions:
        odoo_ids = [int(c["odoo_order_id"]) for c in recent_commissions if c.get("odoo_order_id")]
        if odoo_ids:
            try:
                odoo_orders = odoo.read(
                    "sale.order", odoo_ids,
                    fields=["id", "name", "date_order", "amount_untaxed", "amount_total", "state", "partner_id"],
                )
                order_map = {o["id"]: o for o in odoo_orders}
                for comm in recent_commissions:
                    oid = int(comm.get("odoo_order_id", 0))
                    o   = order_map.get(oid, {})
                    recent_orders.append({
                        "order_id":        oid,
                        "order_name":      o.get("name", str(oid)),
                        "date_order":      o.get("date_order", ""),
                        "amount_total":    o.get("amount_total", 0),
                        "amount_untaxed":  o.get("amount_untaxed", 0),
                        "state":           o.get("state", ""),
                        "customer_name":   (o.get("partner_id") or [None, "—"])[1],
                        "commission":      comm.get("commission_total", 0),
                    })
            except Exception:
                pass

    # ── Commission vendor bills from Odoo ─────────────────────────────────────
    commission_bills = []
    odoo_partner_id = reseller.get("odoo_partner_id")
    if odoo_partner_id:
        try:
            bills = odoo.search_read(
                "account.move",
                domain=[
                    ("move_type", "=", "in_invoice"),
                    ("partner_id", "=", int(odoo_partner_id)),
                    ("state", "=", "posted"),
                ],
                fields=["id", "name", "invoice_date", "invoice_date_due",
                        "amount_total", "amount_residual", "payment_state"],
                limit=10,
                order="invoice_date desc",
            )
            commission_bills = [{k: (None if v is False else v) for k, v in b.items()} for b in bills]
        except Exception:
            pass

    # ── Pending onboarding applications ──────────────────────────────────────
    pending_applications = await col("customer_onboarding").count_documents(
        {"reseller_id": reseller_id, "status": "pending"}
    )

    return {
        "reseller":            reseller,
        "fy_label":            fy_label,
        "stats": {
            "total_orders":      total_orders,
            "total_commission":  total_commission,
            "month_orders":      month_orders,
            "month_commission":  month_commission,
            "fy_orders":         fy_orders,
            "fy_commission":     fy_commission,
            "customer_total":    customer_total,
            "pending_applications": pending_applications,
        },
        "customers":           customers,
        "recent_orders":       recent_orders,
        "commission_bills":    commission_bills,
    }


# ── Customer link / unlink (admin) ───────────────────────────────────────────

class LinkCustomerBody(BaseModel):
    odoo_partner_id: int

@router.post("/{reseller_id}/customers/link")
async def link_customer_to_reseller(
    reseller_id: str,
    body: LinkCustomerBody,
    current_user: dict = Depends(require_admin),
):
    """Admin links an existing Odoo customer to a reseller's account."""
    reseller = await col("resellers").find_one({"id": reseller_id}, NO_ID)
    if not reseller:
        raise HTTPException(status_code=404, detail="Reseller not found")

    odoo = get_odoo_client()
    records = odoo.read("res.partner", [body.odoo_partner_id], fields=["id", "name"])
    if not records:
        raise HTTPException(status_code=404, detail="Customer not found in Odoo")

    existing = await col("customer_ownership").find_one({"odoo_partner_id": body.odoo_partner_id})
    if existing:
        if existing.get("reseller_id") == reseller_id:
            raise HTTPException(status_code=409, detail="Customer is already linked to this reseller")
        raise HTTPException(
            status_code=409,
            detail=f"Customer is already linked to reseller '{existing.get('reseller_name', 'another reseller')}'"
        )

    await col("customer_ownership").insert_one({
        "odoo_partner_id":     body.odoo_partner_id,
        "reseller_id":         reseller_id,
        "reseller_name":       reseller["name"],
        "created_at":          datetime.now(timezone.utc),
        "created_by_username": current_user.get("username", ""),
        "linked_by_admin":     True,
    })
    await audit_log(
        "reseller.customer_linked", "customer_ownership", reseller_id,
        entity_label=records[0]["name"], user=current_user,
        detail={"odoo_partner_id": body.odoo_partner_id},
    )
    return {"success": True, "customer_name": records[0]["name"]}


@router.delete("/{reseller_id}/customers/{odoo_partner_id}/unlink")
async def unlink_customer_from_reseller(
    reseller_id: str,
    odoo_partner_id: int,
    current_user: dict = Depends(require_admin),
):
    """Admin removes a customer link from a reseller. Does not affect the Odoo customer record."""
    ownership = await col("customer_ownership").find_one({
        "odoo_partner_id": odoo_partner_id,
        "reseller_id":     reseller_id,
    })
    if not ownership:
        raise HTTPException(status_code=404, detail="Customer is not linked to this reseller")

    await col("customer_ownership").delete_one({
        "odoo_partner_id": odoo_partner_id,
        "reseller_id":     reseller_id,
    })

    odoo = get_odoo_client()
    try:
        records = odoo.read("res.partner", [odoo_partner_id], fields=["name"])
        customer_name = records[0]["name"] if records else str(odoo_partner_id)
    except Exception:
        customer_name = str(odoo_partner_id)

    await audit_log(
        "reseller.customer_unlinked", "customer_ownership", reseller_id,
        entity_label=customer_name, user=current_user,
        detail={"odoo_partner_id": odoo_partner_id},
    )
    return {"success": True}


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
