from fastapi import APIRouter, Depends, HTTPException, Query
from typing import Optional
from pydantic import BaseModel
from datetime import datetime, timezone
from auth import get_current_user, require_admin
from odoo_client import get_odoo_client
from database import col, NO_ID
from credit import credit_status

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
    "country_id", "customer_rank", "credit_limit", "credit",
    "property_payment_term_id", "active", "comment",
]


def _attach_credit_hold(customers: list) -> None:
    """Flags each customer with `credit_hold` (over their Odoo credit_limit
    right now) so it can be shown in the portal without an extra round trip
    per row — same `credit`/`credit_limit` fields order confirmation checks."""
    for c in customers:
        status = credit_status(c.get("credit") or 0, c.get("credit_limit") or 0)
        c["credit_hold"] = status["over_limit"]

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
        _attach_credit_hold(customers)
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


@router.get("/{customer_id}/profile")
async def customer_profile(
    customer_id: int,
    current_user: dict = Depends(get_current_user),
):
    """
    Customer 360 view — aggregates Odoo orders + invoices + MongoDB ownership.
    Admins can view any customer; resellers can only view their own customers.
    """
    reseller_order_ids: Optional[list] = None
    if current_user.get("role") == "reseller":
        reseller = await col("resellers").find_one({"user_id": current_user["id"]}, NO_ID)
        if not reseller:
            raise HTTPException(status_code=403, detail="Access denied")
        ownership = await col("customer_ownership").find_one({
            "reseller_id": reseller["id"],
            "odoo_partner_id": customer_id,
        })
        if not ownership:
            raise HTTPException(status_code=403, detail="Access denied")
        # Only show orders this reseller placed
        comm_records = await col("order_commissions").find(
            {"reseller_id": reseller["id"]}, {"odoo_order_id": 1, "_id": 0}
        ).to_list(5000)
        reseller_order_ids = [int(r["odoo_order_id"]) for r in comm_records if r.get("odoo_order_id")]

    from datetime import date
    odoo = get_odoo_client()

    # Customer info
    records = odoo.read("res.partner", [customer_id], fields=CUSTOMER_FIELDS)
    if not records:
        raise HTTPException(status_code=404, detail="Customer not found")
    customer = records[0]
    for k, v in customer.items():
        if v is False and k != "active":
            customer[k] = None
    _attach_credit_hold([customer])

    # Orders — resellers see only what they placed; admins see everything
    if reseller_order_ids is not None and not reseller_order_ids:
        all_orders = []  # reseller exists but has placed no orders
    else:
        order_domain = [("partner_id", "=", customer_id), ("state", "not in", ["cancel"])]
        if reseller_order_ids:
            order_domain.append(("id", "in", reseller_order_ids))
        all_orders = odoo.search_read(
            "sale.order",
            domain=order_domain,
            fields=["id", "name", "date_order", "amount_untaxed", "amount_total", "state", "invoice_status"],
            limit=2000,
            order="date_order desc",
        )

    # Stats
    this_month = date.today().replace(day=1).isoformat()
    confirmed = [o for o in all_orders if o["state"] in ("sale", "done")]
    orders_this_month = [o for o in confirmed if (o.get("date_order") or "") >= this_month]

    stats = {
        "total_orders":        len(confirmed),
        "total_spend":         sum(o["amount_total"] for o in confirmed),
        "orders_this_month":   len(orders_this_month),
        "revenue_this_month":  sum(o["amount_total"] for o in orders_this_month),
    }

    # Outstanding invoices
    invoices = odoo.search_read(
        "account.move",
        domain=[
            ("partner_id", "=", customer_id),
            ("move_type", "=", "out_invoice"),
            ("state", "=", "posted"),
            ("payment_state", "in", ["not_paid", "partial"]),
        ],
        fields=["id", "name", "invoice_date", "invoice_date_due",
                "amount_total", "amount_residual", "payment_state"],
        limit=50,
        order="invoice_date_due asc",
    )
    stats["outstanding_balance"]  = sum(i["amount_residual"] for i in invoices)
    stats["outstanding_invoices"] = len(invoices)

    # Credit utilisation
    credit_limit = customer.get("credit_limit") or 0
    stats["credit_limit"]       = credit_limit
    stats["credit_utilisation"] = round(stats["outstanding_balance"] / credit_limit * 100, 1) if credit_limit else None

    # Ownership
    ownership = await col("customer_ownership").find_one({"odoo_partner_id": customer_id}, NO_ID)

    return {
        "customer":             customer,
        "stats":                stats,
        "recent_orders":        all_orders[:10],
        "outstanding_invoices": invoices,
        "ownership":            ownership,
    }


@router.get("/{customer_id}/statement")
async def customer_account_statement(
    customer_id: int,
    date_from: Optional[str] = None,
    date_to:   Optional[str] = None,
    current_user: dict = Depends(get_current_user),
):
    """
    Full account statement for a customer: all posted invoices and credit notes
    with running balance summary. Resellers can view statements for their own customers.
    """
    # Access control — resellers may only view their own customers' statements
    if current_user.get("role") == "reseller":
        reseller = await col("resellers").find_one({"user_id": current_user["id"]}, NO_ID)
        if not reseller:
            raise HTTPException(status_code=403, detail="Access denied")
        ownership = await col("customer_ownership").find_one({
            "reseller_id": reseller["id"],
            "odoo_partner_id": customer_id,
        })
        if not ownership:
            raise HTTPException(status_code=403, detail="Access denied")

    odoo = get_odoo_client()
    domain = [
        ("partner_id", "=", customer_id),
        ("move_type", "in", ["out_invoice", "out_refund"]),
        ("state", "=", "posted"),
    ]
    if date_from:
        domain.append(("invoice_date", ">=", date_from))
    if date_to:
        domain.append(("invoice_date", "<=", date_to))

    try:
        invoices = odoo.search_read(
            "account.move",
            domain=domain,
            fields=["id", "name", "move_type", "invoice_date", "invoice_date_due",
                    "amount_total", "amount_residual", "payment_state"],
            order="invoice_date desc",
            limit=200,
        )
    except Exception as e:
        raise HTTPException(status_code=502, detail=f"Odoo error: {str(e)}")

    total_invoiced    = round(sum(i["amount_total"] for i in invoices if i["move_type"] == "out_invoice"), 2)
    total_credits     = round(sum(i["amount_total"] for i in invoices if i["move_type"] == "out_refund"), 2)
    total_outstanding = round(sum(i["amount_residual"] for i in invoices), 2)

    return {
        "customer_id": customer_id,
        "invoices":    invoices,
        "summary": {
            "total_invoiced":    total_invoiced,
            "total_credits":     total_credits,
            "total_outstanding": total_outstanding,
            "net_balance":       round(total_invoiced - total_credits, 2),
        },
        "date_from": date_from,
        "date_to":   date_to,
    }


@router.get("/search")
def search_all_customers(
    q: str = Query(..., min_length=2),
    limit: int = Query(8, le=20),
    current_user: dict = Depends(get_current_user),
):
    """
    Search all Odoo customers by name — used in the add-customer modal so resellers
    can find existing Bassani customers before deciding to create a new one.
    No ownership filter applied.
    """
    odoo = get_odoo_client()
    domain = [
        ("customer_rank", ">", 0),
        ("active", "=", True),
        "|",
        ("name", "ilike", q),
        ("email", "ilike", q),
    ]
    try:
        customers = odoo.search_read(
            "res.partner",
            domain=domain,
            fields=["id", "name", "email", "city"],
            limit=limit,
            order="name asc",
        )
        for c in customers:
            for k, v in c.items():
                if v is False:
                    c[k] = None
        return {"customers": customers}
    except Exception as e:
        raise HTTPException(status_code=502, detail=f"Odoo error: {str(e)}")


@router.get("/{customer_id}")
def get_customer(customer_id: int, current_user: dict = Depends(get_current_user)):
    odoo = get_odoo_client()
    try:
        records = odoo.read("res.partner", [customer_id], fields=CUSTOMER_FIELDS)
        if not records:
            raise HTTPException(status_code=404, detail="Customer not found")
        _attach_credit_hold(records)
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


@router.post("/{customer_id}/claim")
async def claim_customer(
    customer_id: int,
    current_user: dict = Depends(get_current_user),
):
    """
    Reseller claims an existing Odoo customer as their account.
    Creates a customer_ownership record without touching Odoo — no duplicate created.
    """
    if current_user.get("role") != "reseller":
        raise HTTPException(status_code=403, detail="Only resellers can claim customers")

    # Verify the customer exists in Odoo
    odoo = get_odoo_client()
    records = odoo.read("res.partner", [customer_id], fields=["id", "name"])
    if not records:
        raise HTTPException(status_code=404, detail="Customer not found")

    # Check not already claimed by anyone
    existing = await col("customer_ownership").find_one({"odoo_partner_id": customer_id})
    if existing:
        if existing.get("reseller_id") == (await col("resellers").find_one({"user_id": current_user["id"]}, NO_ID) or {}).get("id"):
            return {"success": True, "message": "Already your customer"}
        raise HTTPException(status_code=409, detail=f"This customer is already linked to another reseller ({existing.get('reseller_name', 'unknown')})")

    reseller = await col("resellers").find_one({"user_id": current_user["id"]}, NO_ID)
    await col("customer_ownership").insert_one({
        "odoo_partner_id":     customer_id,
        "reseller_id":         reseller["id"]   if reseller else None,
        "reseller_name":       reseller["name"] if reseller else current_user.get("username", ""),
        "created_at":          datetime.now(timezone.utc),
        "created_by_username": current_user.get("username", ""),
        "claimed":             True,
    })
    return {"success": True, "customer_name": records[0]["name"]}


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
