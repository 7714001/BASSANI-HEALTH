from fastapi import APIRouter, Depends, HTTPException, Query
from typing import Optional
from pydantic import BaseModel
from datetime import datetime, timezone
from auth import get_current_user, require_admin
from odoo_client import get_odoo_client
from database import col, NO_ID

router = APIRouter(prefix="/api/customers", tags=["customers"])

# ── Pydantic models ───────────────────────────────────────────────────────────

class CustomerCreate(BaseModel):
    name: str
    company_type: str = "company"
    email: Optional[str] = None
    phone: Optional[str] = None
    street: Optional[str] = None
    city: Optional[str] = None
    zip: Optional[str] = None
    customer_type: Optional[str] = "Pharmacy"
    section21_registered: bool = False
    credit_limit: float = 0.0
    property_payment_term_id: Optional[int] = None

class CustomerUpdate(BaseModel):
    name: Optional[str] = None
    email: Optional[str] = None
    phone: Optional[str] = None
    street: Optional[str] = None
    city: Optional[str] = None
    zip: Optional[str] = None
    credit_limit: Optional[float] = None
    active: Optional[bool] = None

# ── Shared fields ─────────────────────────────────────────────────────────────

CUSTOMER_FIELDS = [
    "id", "name", "ref", "email", "phone", "street", "city", "zip",
    "country_id", "customer_rank", "credit_limit",
    "property_payment_term_id", "active", "comment",
]

# ── Endpoints ─────────────────────────────────────────────────────────────────

@router.get("/")
async def list_customers(
    search: Optional[str] = None,
    customer_type: Optional[str] = None,
    limit: int = Query(50, le=200),
    offset: int = 0,
    sort_by: str = Query("name"),
    sort_dir: str = Query("asc"),
    current_user: dict = Depends(get_current_user),
):
    _SORTABLE = {"name", "email", "city", "credit_limit"}
    sort_by  = sort_by  if sort_by  in _SORTABLE       else "name"
    sort_dir = sort_dir if sort_dir in ("asc", "desc") else "asc"
    odoo = get_odoo_client()
    domain = [("customer_rank", ">", 0), ("active", "=", True)]

    if search:
        domain.append("|")
        domain.append(("name", "ilike", search))
        domain.append(("email", "ilike", search))

    if customer_type and customer_type != "all":
        domain.append(("comment", "ilike", customer_type))

    # Resellers only see customers they created
    if current_user.get("role") == "reseller":
        reseller = await col("resellers").find_one({"user_id": current_user["id"]}, NO_ID)
        reseller_id = reseller["id"] if reseller else None
        owned = await col("customer_ownership").find(
            {"reseller_id": reseller_id}, NO_ID
        ).to_list(length=5000)
        owned_ids = [o["odoo_partner_id"] for o in owned]
        if not owned_ids:
            return {"customers": [], "total": 0}
        domain.append(("id", "in", owned_ids))

    try:
        customers = odoo.search_read(
            "res.partner",
            domain=domain,
            fields=CUSTOMER_FIELDS,
            limit=limit,
            offset=offset,
            order=f"{sort_by} {sort_dir}",
        )
        for c in customers:
            for k, v in c.items():
                if v is False and k != "active":
                    c[k] = None
        total = odoo.count("res.partner", domain)

        # Overlay ownership data so the admin can see which reseller created each account
        ownership_records = await col("customer_ownership").find({}, NO_ID).to_list(length=10000)
        ownership_map = {o["odoo_partner_id"]: o for o in ownership_records}
        for c in customers:
            match = ownership_map.get(c["id"])
            c["created_by_reseller_name"] = match["reseller_name"] if match else None
            c["created_by_reseller_id"]   = match["reseller_id"]   if match else None

        return {"customers": customers, "total": total}
    except Exception as e:
        raise HTTPException(status_code=502, detail=f"Odoo error: {str(e)}")


@router.get("/{customer_id}")
def get_customer(customer_id: int, current_user: dict = Depends(get_current_user)):
    odoo = get_odoo_client()
    try:
        records = odoo.read("res.partner", [customer_id], fields=CUSTOMER_FIELDS)
        if not records:
            raise HTTPException(status_code=404, detail="Customer not found")
        return records[0]
    except HTTPException:
        raise
    except Exception as e:
        raise HTTPException(status_code=502, detail=f"Odoo error: {str(e)}")


@router.get("/{customer_id}/orders")
def get_customer_orders(
    customer_id: int,
    limit: int = 20,
    current_user: dict = Depends(get_current_user),
):
    odoo = get_odoo_client()
    try:
        orders = odoo.search_read(
            "sale.order",
            domain=[("partner_id", "=", customer_id)],
            fields=["id", "name", "date_order", "amount_total", "state", "invoice_status"],
            limit=limit,
            order="date_order desc",
        )
        return {"orders": orders, "total": len(orders)}
    except Exception as e:
        raise HTTPException(status_code=502, detail=f"Odoo error: {str(e)}")


@router.post("/")
async def create_customer(
    customer: CustomerCreate,
    current_user: dict = Depends(get_current_user),
):
    """Create a new customer in Odoo. Admins and resellers can create customers."""
    if current_user.get("role") not in ("admin", "reseller"):
        raise HTTPException(status_code=403, detail="Not authorised")

    odoo = get_odoo_client()
    notes = f"Type: {customer.customer_type}"
    if customer.section21_registered:
        notes += " | Section 21: Registered"

    vals = {
        "name": customer.name,
        "company_type": customer.company_type,
        "customer_rank": 1,
        "credit_limit": customer.credit_limit,
        "comment": notes,
    }
    if customer.email:    vals["email"]  = customer.email
    if customer.phone:    vals["phone"]  = customer.phone
    if customer.street:   vals["street"] = customer.street
    if customer.city:     vals["city"]   = customer.city
    if customer.zip:      vals["zip"]    = customer.zip
    if customer.property_payment_term_id:
        vals["property_payment_term_id"] = customer.property_payment_term_id

    try:
        customer_id = odoo.create("res.partner", vals)
    except Exception as e:
        raise HTTPException(status_code=400, detail=f"Odoo error: {str(e)}")

    # Record which reseller created this customer
    if current_user.get("role") == "reseller":
        reseller = await col("resellers").find_one({"user_id": current_user["id"]}, NO_ID)
        await col("customer_ownership").insert_one({
            "odoo_partner_id":      customer_id,
            "reseller_id":          reseller["id"]   if reseller else None,
            "reseller_name":        reseller["name"] if reseller else current_user.get("username", ""),
            "created_at":           datetime.now(timezone.utc),
            "created_by_username":  current_user.get("username", ""),
        })

    return {"success": True, "customer_id": customer_id}


@router.put("/{customer_id}")
def update_customer(
    customer_id: int,
    customer: CustomerUpdate,
    current_user: dict = Depends(require_admin),
):
    odoo = get_odoo_client()
    vals = {k: v for k, v in customer.model_dump().items() if v is not None}
    if not vals:
        raise HTTPException(status_code=400, detail="No fields to update")
    try:
        odoo.write("res.partner", [customer_id], vals)
        return {"success": True}
    except Exception as e:
        raise HTTPException(status_code=400, detail=f"Odoo error: {str(e)}")


@router.delete("/{customer_id}")
def archive_customer(
    customer_id: int,
    current_user: dict = Depends(require_admin),
):
    odoo = get_odoo_client()
    try:
        odoo.write("res.partner", [customer_id], {"active": False})
        return {"success": True, "message": "Customer archived"}
    except Exception as e:
        raise HTTPException(status_code=400, detail=f"Odoo error: {str(e)}")
