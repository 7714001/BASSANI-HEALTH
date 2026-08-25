import os
import secrets
import uuid
from fastapi import APIRouter, BackgroundTasks, Depends, HTTPException, Query, UploadFile, File
from typing import Optional
from pydantic import BaseModel
from datetime import datetime, timezone
from bson import ObjectId
from auth import get_current_user, require_admin, require_permission, hash_password
from odoo_client import get_odoo_client
from database import col, NO_ID
from credit import credit_status
from services.r2_client import r2_put, r2_delete, r2_presign
from middleware.audit import audit_log
from routes.ticket_routes import ticket_manager
from routes.auth_routes import create_password_reset_token

router = APIRouter(prefix="/api/customers", tags=["customers"])

# ── Pydantic models ───────────────────────────────────────────────────────────

class SamplesAccountBody(BaseModel):
    samples_account: bool


class CustomerCreate(BaseModel):
    name: str
    company_type: str = "company"
    email: Optional[str] = None
    phone: Optional[str] = None
    street: Optional[str] = None
    city: Optional[str] = None
    zip: Optional[str] = None
    vat: Optional[str] = None
    customer_type: Optional[str] = "Pharmacy"
    section21_registered: bool = False
    credit_limit: float = 0.0
    property_payment_term_id: Optional[int] = None
    document_session_id: Optional[str] = None
    documents: Optional[list] = []

class CustomerUpdate(BaseModel):
    name: Optional[str] = None
    email: Optional[str] = None
    phone: Optional[str] = None
    street: Optional[str] = None
    city: Optional[str] = None
    zip: Optional[str] = None
    credit_limit: Optional[float] = None
    active: Optional[bool] = None

class AddressCreate(BaseModel):
    name: str
    type: str = "delivery"   # delivery | invoice | other
    street: Optional[str] = None
    street2: Optional[str] = None   # suburb
    city: Optional[str] = None
    province: Optional[str] = None  # resolved to state_id before writing to Odoo
    zip: Optional[str] = None
    phone: Optional[str] = None
    email: Optional[str] = None

class AddressUpdate(BaseModel):
    name: Optional[str] = None
    type: Optional[str] = None
    street: Optional[str] = None
    street2: Optional[str] = None   # suburb
    city: Optional[str] = None
    province: Optional[str] = None  # resolved to state_id before writing to Odoo
    zip: Optional[str] = None
    phone: Optional[str] = None
    email: Optional[str] = None

class ContactCreate(BaseModel):
    name: str
    function: Optional[str] = None
    email: Optional[str] = None
    phone: Optional[str] = None

class CustomerTypeUpdate(BaseModel):
    is_company: bool

class LinkCompanyBody(BaseModel):
    company_id: int

class PortalAccessGrantBody(BaseModel):
    contact_ids: list[int]

class CustomerWarehouseBody(BaseModel):
    warehouse_id: Optional[int] = None

# ── Shared fields ─────────────────────────────────────────────────────────────

CUSTOMER_FIELDS = [
    "id", "name", "ref", "email", "phone", "street", "city", "zip",
    "country_id", "customer_rank", "supplier_rank", "credit_limit", "credit",
    "property_payment_term_id", "active", "comment", "is_company", "parent_id", "vat",
]

ADDRESS_FIELDS = ["id", "name", "type", "street", "street2", "city", "state_id", "zip", "country_id", "phone", "email", "function"]


def _format_address(r: dict) -> dict:
    for k, v in list(r.items()):
        if v is False:
            r[k] = None
    cid = r.get("country_id")
    r["country_name"] = cid[1] if cid else None
    r["country_id"]   = cid[0] if cid else None
    sid = r.get("state_id")
    r["state_name"] = sid[1] if sid else None
    r["state_id"]   = sid[0] if sid else None
    return r


def _resolve_za_state_id(odoo, province_name: str) -> Optional[int]:
    """Return the Odoo res.country.state id for a South African province name, or None."""
    if not province_name:
        return None
    try:
        ids = odoo.search(
            "res.country.state",
            [["country_id.code", "=", "ZA"], ["name", "ilike", province_name]],
            limit=1,
        )
        return ids[0] if ids else None
    except Exception:
        return None


def _get_za_country_id(odoo) -> Optional[int]:
    """Return the Odoo res.country id for South Africa."""
    try:
        ids = odoo.search("res.country", [["code", "=", "ZA"]], limit=1)
        return ids[0] if ids else None
    except Exception:
        return None


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
    mode: Optional[str] = None,
    has_orders: bool = Query(False),
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

    # mode=partner: search all active partners — used by reseller wizard.
    # Includes companies (any rank), individual contacts linked to a company (parent_id set),
    # plus standalone customers/suppliers. Individual contacts are surfaced so users can
    # search by person name — the frontend auto-resolves to the parent company on selection.
    if mode == "partner":
        domain = [("active", "=", True), "|", "|", "|", ("customer_rank", ">", 0), ("supplier_rank", ">", 0), ("is_company", "=", True), ("parent_id", "!=", False)]
    elif has_orders:
        # Explicit filter: only accounts that have at least one confirmed sale order
        domain = [("customer_rank", ">", 0), ("active", "=", True)]
    else:
        # Default: all active companies — newly onboarded accounts appear before their first order
        domain = [("active", "=", True), "|", ("customer_rank", ">", 0), ("is_company", "=", True)]

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

        # Overlay portal-access status (2026-08-22) — a lightweight per-page
        # summary for the list view, not the full per-contact breakdown
        # get_portal_access below builds (that one round-trips to Odoo per
        # customer and is only ever called for a single company at a time).
        # A company's portal_access is "active" the moment ANY of its logins'
        # `companies[]` entries for it is active — one company can have
        # several logins (2026-08-21 multi-login model) and only needs one
        # live to count as having access; "deactivated" only when every
        # entry that ever existed for it has been switched off.
        customer_ids = [c["id"] for c in customers]
        access_map: dict[int, str] = {}
        if customer_ids:
            async for u in col("users").find(
                {"role": "customer", "companies.customer_company_partner_id": {"$in": customer_ids}},
                {"companies": 1, "_id": 0},
            ):
                for entry in u.get("companies") or []:
                    pid = entry.get("customer_company_partner_id")
                    if pid not in customer_ids:
                        continue
                    if entry.get("active"):
                        access_map[pid] = "active"
                    elif access_map.get(pid) != "active":
                        access_map[pid] = "deactivated"
        for c in customers:
            c["portal_access"] = access_map.get(c["id"], "none")

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
    # Phase 7.13: once access is granted (customer linked to this reseller),
    # the reseller sees every order for this customer, not just ones they
    # personally placed — no further narrowing of the order list below.
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

    # Orders — every order for this customer, same for resellers and admins
    # once access is granted above (Phase 7.13).
    order_domain = [("partner_id", "=", customer_id), ("state", "not in", ["cancel"])]
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

    # Contact persons — all active child res.partner records (any type)
    contact_ids = odoo.search(
        "res.partner",
        [["parent_id", "=", customer_id], ["active", "=", True]],
        limit=50,
    )
    contacts = []
    if contact_ids:
        raw_contacts = odoo.read("res.partner", contact_ids, fields=["id", "name", "email", "phone", "function"])
        for ct in raw_contacts:
            contacts.append({k: (v if v is not False else None) for k, v in ct.items()})

    meta = await col("customer_metadata").find_one({"odoo_partner_id": customer_id}, {"_id": 0})
    samples_account = bool(meta.get("samples_account")) if meta else False
    warehouse_id = meta.get("warehouse_id") if meta else None

    return {
        "customer":             customer,
        "contacts":             contacts,
        "stats":                stats,
        "recent_orders":        all_orders[:10],
        "outstanding_invoices": invoices,
        "ownership":            ownership,
        "samples_account":      samples_account,
        "warehouse_id":         warehouse_id,
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


@router.get("/check-duplicate")
def check_duplicate_customer(
    email: Optional[str] = Query(None),
    vat: Optional[str] = Query(None),
    current_user: dict = Depends(get_current_user),
):
    """
    Exact-match check for email or VAT before creating a new customer.
    Returns any existing Odoo partners that match — used by the wizard to hard-block duplicates.
    """
    if not email and not vat:
        return {"duplicates": []}
    odoo = get_odoo_client()
    domain = [("active", "=", True), "|", ("customer_rank", ">", 0), ("is_company", "=", True)]
    conditions = []
    if email:
        conditions.append(("email", "=", email.strip().lower()))
    if vat:
        conditions.append(("vat", "=", vat.strip()))
    if len(conditions) == 2:
        domain += ["|"] + conditions
    else:
        domain += conditions
    try:
        matches = odoo.search_read(
            "res.partner",
            domain=domain,
            fields=["id", "name", "email", "vat", "city"],
            limit=5,
        )
        for c in matches:
            for k, v in c.items():
                if v is False:
                    c[k] = None
        return {"duplicates": matches}
    except Exception as e:
        raise HTTPException(status_code=502, detail=f"Odoo error: {str(e)}")


@router.get("/search")
async def search_all_customers(
    q: str = Query(..., min_length=2),
    limit: int = Query(8, le=20),
    current_user: dict = Depends(get_current_user),
):
    """
    Search Odoo partners by name/email — used in the quote builder and add-customer
    modal. Includes any active company record (not just those with confirmed orders)
    so sales clerks can raise a first order against a newly created Odoo contact.
    Individuals with no order history are excluded (they're typically vendor contacts
    or employees, not customers).
    No ownership filter applied. Overlays samples_account flag from customer_metadata.
    """
    odoo = get_odoo_client()
    # Match: (name or email) AND active AND (customer_rank > 0 OR is a company record)
    # The is_company arm catches new customers added directly in Odoo before their
    # first order (which would otherwise have customer_rank = 0 and be invisible).
    domain = [
        ("active", "=", True),
        "|", ("name", "ilike", q), ("email", "ilike", q),
        "|", "|", ("customer_rank", ">", 0), ("is_company", "=", True), ("parent_id", "!=", False),
    ]
    try:
        customers = odoo.search_read(
            "res.partner",
            domain=domain,
            fields=["id", "name", "email", "city", "parent_id", "is_company"],
            limit=limit,
            order="name asc",
        )
        for c in customers:
            for k, v in c.items():
                if v is False:
                    c[k] = None
        # Overlay samples_account flag
        ids = [c["id"] for c in customers]
        meta_map = {}
        async for m in col("customer_metadata").find({"odoo_partner_id": {"$in": ids}}, {"odoo_partner_id": 1, "samples_account": 1, "_id": 0}):
            meta_map[m["odoo_partner_id"]] = m
        for c in customers:
            meta = meta_map.get(c["id"])
            c["samples_account"] = bool(meta.get("samples_account")) if meta else False
        return {"customers": customers}
    except Exception as e:
        raise HTTPException(status_code=502, detail=f"Odoo error: {str(e)}")


@router.get("/portal-logins/{email}")
async def get_portal_login_by_email(
    email: str,
    current_user: dict = Depends(require_permission("customers.manage_portal_access")),
):
    """
    Management view for a customer portal login, looked up by email rather
    than scoped to one company's own profile page — the Portal Access table
    on a single customer profile only ever shows that one company's own
    status for a contact, with no way to see the *other* companies the same
    login has (a company is only surfaced there via the narrower
    `linked_elsewhere` hint). This endpoint returns the login's full
    `companies` list in one place, for the "Manage" button on that table.

    Uses `.find()`, not `.find_one()`, deliberately: `grant_portal_access`'s
    existing-login check (`find_one` before insert) isn't race-proof against
    two near-simultaneous grants on two different company profiles for the
    same email — there's no unique index on `username` itself, only on
    `companies.odoo_partner_id`. If that ever happens, two separate login
    documents end up sharing one email, each holding only the company it was
    granted against — exactly the state that makes a customer's own company
    switcher only ever show one store no matter how many grants admins think
    they've made. Returning every match here (instead of silently picking
    one, the way login's own `authenticate_user` does) surfaces that split
    directly so it can be merged via the endpoint below, rather than only
    being discoverable by reading raw Mongo documents.
    """
    username = email.strip().lower()
    docs = await col("users").find({"role": "customer", "username": username}).to_list(length=10)
    if not docs:
        raise HTTPException(status_code=404, detail="No portal login found for this email")
    return {
        "username": username,
        "duplicate_logins": len(docs) > 1,
        "logins": [
            {
                "id": str(d["_id"]),
                "name": d.get("name"),
                "active": d.get("active", True),
                "last_login_at": d.get("last_login_at"),
                "created_at": d.get("created_at"),
                "companies": d.get("companies") or [],
            }
            for d in docs
        ],
    }


class PortalLoginMergeBody(BaseModel):
    keep_user_id: str
    remove_user_id: str


@router.post("/portal-logins/{email}/merge")
async def merge_portal_logins(
    email: str,
    body: PortalLoginMergeBody,
    current_user: dict = Depends(require_permission("customers.manage_portal_access")),
):
    """
    Repairs the duplicate-login split `get_portal_login_by_email` above can
    surface: folds `remove_user_id`'s `companies` entries into
    `keep_user_id`'s (skipping any `odoo_partner_id` already present — the
    unique partial index on that field means a genuine overlap can't exist,
    but a defensive skip costs nothing), then deletes the now-redundant
    document. `keep_user_id` survives with its own password/login history
    intact; whichever one the customer wasn't logging in with is the one to
    remove — both usually work, but keeping the one with a real
    `last_login_at` avoids resetting a password the customer already knows.
    """
    username = email.strip().lower()
    try:
        keep_oid, remove_oid = ObjectId(body.keep_user_id), ObjectId(body.remove_user_id)
    except Exception:
        raise HTTPException(status_code=400, detail="Invalid user ID")
    if keep_oid == remove_oid:
        raise HTTPException(status_code=400, detail="Cannot merge a login into itself")

    keep_doc = await col("users").find_one({"_id": keep_oid, "role": "customer", "username": username})
    remove_doc = await col("users").find_one({"_id": remove_oid, "role": "customer", "username": username})
    if not keep_doc or not remove_doc:
        raise HTTPException(status_code=404, detail="Both logins must exist and match this email")

    existing_ids = {c.get("odoo_partner_id") for c in (keep_doc.get("companies") or [])}
    to_add = [c for c in (remove_doc.get("companies") or []) if c.get("odoo_partner_id") not in existing_ids]

    if to_add:
        await col("users").update_one({"_id": keep_oid}, {"$push": {"companies": {"$each": to_add}}})
    if not keep_doc.get("active_company_partner_id") and to_add:
        await col("users").update_one(
            {"_id": keep_oid},
            {"$set": {"active_company_partner_id": to_add[0]["customer_company_partner_id"]}},
        )
    await col("users").delete_one({"_id": remove_oid})

    await audit_log(
        "customer.portal_logins_merged", "customer_portal_access", str(keep_oid),
        entity_label=keep_doc.get("name") or username,
        user=current_user,
        detail={"removed_user_id": str(remove_oid), "companies_added": to_add},
    )
    return {"success": True, "companies_added": len(to_add)}


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


@router.get("/{customer_id}/has-documents")
async def customer_has_documents(
    customer_id: int,
    current_user: dict = Depends(get_current_user),
):
    """Quick check for the reseller/customer wizard — does this partner already have onboarding docs on file?"""
    admin_count = await col("customer_documents").count_documents({"odoo_partner_id": customer_id})
    if admin_count > 0:
        return {"has_documents": True}
    ownership = await col("customer_ownership").find_one({"odoo_partner_id": customer_id}, NO_ID)
    if ownership and ownership.get("onboarding_ref"):
        app = await col("customer_onboarding").find_one(
            {"id": ownership["onboarding_ref"], "documents.0": {"$exists": True}},
            {"_id": 1},
        )
        if app:
            return {"has_documents": True}
    return {"has_documents": False}


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
    """Create a new customer in Odoo. Resellers can always create; staff need customers.manage."""
    role  = current_user.get("role")
    perms = current_user.get("permissions", {})
    if role != "reseller" and not current_user.get("is_super_admin") and not perms.get("customers", {}).get("manage"):
        raise HTTPException(status_code=403, detail="Not authorised")

    odoo = get_odoo_client()

    # Hard duplicate block — admin path only (resellers use claim flow instead)
    if role != "reseller":
        dup_conditions = []
        if customer.email:
            dup_conditions.append(("email", "=", customer.email.strip().lower()))
        if customer.vat:
            dup_conditions.append(("vat", "=", customer.vat.strip()))
        if dup_conditions:
            dup_domain = [("active", "=", True), "|", ("customer_rank", ">", 0), ("is_company", "=", True)]
            if len(dup_conditions) == 2:
                dup_domain += ["|"] + dup_conditions
            else:
                dup_domain += dup_conditions
            try:
                matches = odoo.search_read(
                    "res.partner", domain=dup_domain,
                    fields=["id", "name", "email", "vat"], limit=1,
                )
                if matches:
                    m = {k: (None if v is False else v) for k, v in matches[0].items()}
                    raise HTTPException(
                        status_code=409,
                        detail={
                            "message": "A customer with this email or VAT number already exists.",
                            "existing": m,
                        },
                    )
            except HTTPException:
                raise
            except Exception as e:
                raise HTTPException(status_code=502, detail=f"Odoo error: {str(e)}")

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
    if customer.vat:      vals["vat"]    = customer.vat
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
        if reseller:
            await ticket_manager.refresh_reseller(reseller["id"])

    # Persist staged onboarding documents into customer_documents
    for doc in (customer.documents or []):
        if doc.get("r2_key"):
            await col("customer_documents").insert_one({
                "id":              str(uuid.uuid4()),
                "odoo_partner_id": customer_id,
                "label":           doc.get("label") or doc.get("doc_type") or "Document",
                "filename":        doc.get("filename"),
                "r2_key":          doc.get("r2_key"),
                "size":            doc.get("size"),
                "doc_type":        doc.get("doc_type"),
                "uploaded_at":     datetime.now(timezone.utc),
                "uploaded_by":     current_user.get("username", ""),
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
    if reseller:
        await ticket_manager.refresh_reseller(reseller["id"])
    return {"success": True, "customer_name": records[0]["name"]}


@router.put("/{customer_id}")
def update_customer(
    customer_id: int,
    customer: CustomerUpdate,
    current_user: dict = Depends(require_permission("customers.manage")),
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


@router.get("/{customer_id}/addresses")
async def list_customer_addresses(customer_id: int, current_user: dict = Depends(get_current_user)):
    """
    Fixed 2026-08-21: previously had no ownership check at all — any
    authenticated reseller/customer could read any company's saved delivery
    addresses just by knowing (or guessing) its Odoo partner id. Mirrors the
    same ownership pattern used by customer_profile above. Needed now that
    the reseller/customer cart offers a delivery-address picker at checkout.
    """
    if current_user.get("role") == "reseller":
        reseller = await col("resellers").find_one({"user_id": current_user["id"]}, NO_ID)
        if not reseller:
            raise HTTPException(status_code=403, detail="Access denied")
        ownership = await col("customer_ownership").find_one({
            "reseller_id": reseller["id"], "odoo_partner_id": customer_id,
        })
        if not ownership:
            raise HTTPException(status_code=403, detail="Access denied")
    elif current_user.get("role") == "customer":
        if customer_id != current_user.get("customer_company_partner_id"):
            raise HTTPException(status_code=403, detail="Access denied")

    odoo = get_odoo_client()
    try:
        child_ids = odoo.search("res.partner", [["parent_id", "=", customer_id]], limit=50)
        if not child_ids:
            return {"addresses": []}
        rows = odoo.read("res.partner", child_ids, fields=ADDRESS_FIELDS)
        return {"addresses": [_format_address(r) for r in rows]}
    except Exception as e:
        raise HTTPException(status_code=502, detail=f"Odoo error: {str(e)}")


@router.post("/{customer_id}/addresses")
def create_customer_address(
    customer_id: int,
    body: AddressCreate,
    current_user: dict = Depends(require_permission("customers.manage")),
):
    odoo = get_odoo_client()
    try:
        exists = odoo.read("res.partner", [customer_id], fields=["id"])
    except Exception as e:
        raise HTTPException(status_code=502, detail=f"Odoo error: {str(e)}")
    if not exists:
        raise HTTPException(status_code=404, detail="Customer not found")
    vals: dict = {"parent_id": customer_id, "name": body.name, "type": body.type}
    for f in ("street", "street2", "city", "zip", "phone", "email"):
        v = getattr(body, f)
        if v:
            vals[f] = v
    if body.province:
        sid = _resolve_za_state_id(odoo, body.province)
        if sid:
            vals["state_id"] = sid
    za_id = _get_za_country_id(odoo)
    if za_id:
        vals["country_id"] = za_id
    try:
        address_id = odoo.create("res.partner", vals)
        return {"success": True, "address_id": address_id}
    except Exception as e:
        raise HTTPException(status_code=502, detail=f"Odoo error: {str(e)}")


@router.put("/{customer_id}/addresses/{address_id}")
def update_customer_address(
    customer_id: int,
    address_id: int,
    body: AddressUpdate,
    current_user: dict = Depends(require_permission("customers.manage")),
):
    odoo = get_odoo_client()
    try:
        existing = odoo.read("res.partner", [address_id], fields=["parent_id"])
    except Exception as e:
        raise HTTPException(status_code=502, detail=f"Odoo error: {str(e)}")
    if not existing:
        raise HTTPException(status_code=404, detail="Address not found")
    parent = existing[0].get("parent_id")
    pid = parent[0] if isinstance(parent, (list, tuple)) else parent
    if pid != customer_id:
        raise HTTPException(status_code=404, detail="Address not found on this customer")
    vals = {k: v for k, v in body.model_dump().items() if v is not None and k != "province"}
    if body.province:
        sid = _resolve_za_state_id(odoo, body.province)
        if sid:
            vals["state_id"] = sid
        za_id = _get_za_country_id(odoo)
        if za_id:
            vals["country_id"] = za_id
    if not vals:
        raise HTTPException(status_code=400, detail="No fields to update")
    try:
        odoo.write("res.partner", [address_id], vals)
        return {"success": True}
    except Exception as e:
        raise HTTPException(status_code=502, detail=f"Odoo error: {str(e)}")


@router.patch("/{customer_id}/samples-account")
async def update_samples_account(
    customer_id: int,
    body: SamplesAccountBody,
    current_user: dict = Depends(require_permission("customers.manage")),
):
    odoo = get_odoo_client()
    try:
        partner = odoo.read("res.partner", [customer_id], fields=["id", "name"])
    except Exception as e:
        raise HTTPException(status_code=502, detail=f"Odoo error: {str(e)}")
    if not partner:
        raise HTTPException(status_code=404, detail="Customer not found")

    meta = await col("customer_metadata").find_one({"odoo_partner_id": customer_id}, {"_id": 0})
    before_val = bool(meta.get("samples_account")) if meta else False

    await col("customer_metadata").update_one(
        {"odoo_partner_id": customer_id},
        {"$set": {"samples_account": body.samples_account}},
        upsert=True,
    )

    await audit_log(
        "customer.samples_account_change", "customer", customer_id,
        entity_label=partner[0]["name"],
        user=current_user,
        before={"samples_account": before_val},
        after={"samples_account": body.samples_account},
    )
    return {"success": True, "samples_account": body.samples_account}


@router.patch("/{customer_id}/type")
async def update_customer_type(
    customer_id: int,
    body: CustomerTypeUpdate,
    current_user: dict = Depends(require_permission("customers.manage")),
):
    odoo = get_odoo_client()
    try:
        partner = odoo.read("res.partner", [customer_id], fields=["id", "name", "is_company"])
    except Exception as e:
        raise HTTPException(status_code=502, detail=f"Odoo error: {str(e)}")
    if not partner:
        raise HTTPException(status_code=404, detail="Customer not found")

    current_is_company = bool(partner[0].get("is_company"))
    if current_is_company == body.is_company:
        return {"success": True, "is_company": body.is_company}

    # Changing Company → Individual is only safe when no child contacts exist.
    if current_is_company and not body.is_company:
        child_ids = odoo.search("res.partner", [["parent_id", "=", customer_id], ["active", "=", True]], limit=1)
        if child_ids:
            raise HTTPException(
                status_code=400,
                detail="Cannot convert to Individual: this customer has linked contacts. Remove or reassign them first.",
            )

    try:
        odoo.write("res.partner", [customer_id], {"is_company": body.is_company})
    except Exception as e:
        raise HTTPException(status_code=502, detail=f"Odoo error: {str(e)}")

    await audit_log(
        "customer.type_change", "customer", customer_id,
        entity_label=partner[0]["name"],
        user=current_user,
        before={"is_company": current_is_company},
        after={"is_company": body.is_company},
    )
    return {"success": True, "is_company": body.is_company}


@router.post("/{customer_id}/contacts")
def create_customer_contact(
    customer_id: int,
    body: ContactCreate,
    current_user: dict = Depends(require_permission("customers.manage")),
):
    odoo = get_odoo_client()
    try:
        parent = odoo.read("res.partner", [customer_id], fields=["id", "is_company"])
    except Exception as e:
        raise HTTPException(status_code=502, detail=f"Odoo error: {str(e)}")
    if not parent:
        raise HTTPException(status_code=404, detail="Customer not found")
    if not parent[0].get("is_company"):
        raise HTTPException(status_code=400, detail="Contacts can only be added to company-type customers")
    vals: dict = {"parent_id": customer_id, "name": body.name, "type": "contact"}
    if body.function:
        vals["function"] = body.function
    if body.email:
        vals["email"] = body.email
    if body.phone:
        vals["phone"] = body.phone
    try:
        contact_id = odoo.create("res.partner", vals)
        return {"success": True, "contact_id": contact_id}
    except Exception as e:
        raise HTTPException(status_code=502, detail=f"Odoo error: {str(e)}")


@router.get("/{customer_id}/portal-access")
async def get_portal_access(
    customer_id: int,
    current_user: dict = Depends(require_permission("customers.manage_portal_access")),
):
    """
    Portal-login state for a customer company. For a business (is_company),
    always includes the company's own record as a candidate (many Bassani
    customers only ever have an email/phone on the company itself, with no
    separate contact person split out in Odoo) plus every active Odoo child
    contact, each with its provisioning status — a company can grant a login
    against its own details, a contact's, or both. For an individual,
    returns a single synthetic row for the partner itself.
    """
    odoo = get_odoo_client()
    try:
        partner = odoo.read("res.partner", [customer_id], fields=["id", "name", "is_company", "email", "phone"])
    except Exception as e:
        raise HTTPException(status_code=502, detail=f"Odoo error: {str(e)}")
    if not partner:
        raise HTTPException(status_code=404, detail="Customer not found")
    partner = partner[0]
    is_company = bool(partner.get("is_company"))

    if is_company:
        contacts = [{
            "id": partner["id"], "name": partner["name"],
            "email": partner.get("email") or None, "phone": partner.get("phone") or None,
            "function": None, "is_company_record": True,
        }]
        contact_ids = odoo.search(
            "res.partner",
            [["parent_id", "=", customer_id], ["active", "=", True]],
            limit=200,
        )
        raw_contacts = odoo.read("res.partner", contact_ids, fields=["id", "name", "email", "phone", "function"]) if contact_ids else []
        contacts += [
            {**{k: (v if v is not False else None) for k, v in c.items()}, "is_company_record": False}
            for c in raw_contacts
        ]
    else:
        contacts = [{
            "id": partner["id"], "name": partner["name"],
            "email": partner.get("email") or None, "phone": partner.get("phone") or None,
            "function": None, "is_company_record": False,
        }]

    contact_ids_list = [c["id"] for c in contacts]

    # Multi-company logins (2026-08-21): a contact's portal status now lives
    # inside the matching entry of that user's `companies` array, not a
    # top-level `active` flag — one login can be active for this company and
    # deactivated for another. Match on the array's own fields via Mongo's
    # implicit array-element matching (works the same as a flat-field query).
    users_map = {}
    if contact_ids_list:
        async for u in col("users").find(
            {"role": "customer", "companies.customer_company_partner_id": customer_id,
             "companies.odoo_partner_id": {"$in": contact_ids_list}},
            {"companies": 1, "username": 1, "_id": 0},
        ):
            for entry in u.get("companies") or []:
                if entry.get("customer_company_partner_id") == customer_id and entry.get("odoo_partner_id") in contact_ids_list:
                    users_map[entry["odoo_partner_id"]] = {"active": entry.get("active", True), "username": u.get("username")}

    # linked_elsewhere (2026-08-21) — surfaces, before an admin ever clicks
    # Grant, that a candidate's email already has active portal access to a
    # DIFFERENT company. Looked up per-email since that's the actual identity
    # a login is keyed on — two different Odoo contact records (this
    # company's vs another's) can share the same email, exactly the "one
    # person, two branches" pattern CLAUDE.md already documents elsewhere.
    linked_map = {}
    emails = list({c["email"] for c in contacts if c.get("email")})
    if emails:
        async for u in col("users").find(
            {"role": "customer", "username": {"$in": [e.strip().lower() for e in emails]}},
            {"username": 1, "companies": 1, "_id": 0},
        ):
            # odoo_partner_id included so the admin UI can deactivate one of
            # these other companies directly from the grant confirm dialog
            # (e.g. a duplicate/phased-out profile being deliberately
            # excluded) without a separate trip to that company's own
            # profile page.
            others = [
                {
                    "company_name": e.get("company_name"),
                    "customer_company_partner_id": e.get("customer_company_partner_id"),
                    "odoo_partner_id": e.get("odoo_partner_id"),
                }
                for e in (u.get("companies") or [])
                if e.get("active") and e.get("customer_company_partner_id") != customer_id
            ]
            if others:
                linked_map[u["username"]] = others

    for c in contacts:
        u = users_map.get(c["id"])
        if not u:
            c["portal_status"] = "not_provisioned"
            c["linked_username"] = None
        else:
            c["portal_status"] = "active" if u.get("active", True) else "deactivated"
            # 2026-08-25: surfaces which login this status actually belongs
            # to — found live that this can genuinely differ from the
            # contact's own email above (a login mistakenly provisioned
            # under the wrong address), which otherwise reads as "this
            # contact's real email is provisioned" when it isn't.
            c["linked_username"] = u.get("username")
        c["linked_elsewhere"] = linked_map.get((c.get("email") or "").strip().lower()) or []

    return {
        "is_company": is_company,
        "contacts": contacts,
        # True only when nothing here — not even the company record itself —
        # has an email on file, i.e. there is genuinely no login candidate
        # yet. Kept as its own flag rather than an empty `contacts` list
        # since `contacts` always has at least one row now (the company
        # record for a business, the partner itself for an individual).
        "has_no_contacts": not any(c.get("email") for c in contacts),
    }


@router.post("/{customer_id}/portal-access")
async def grant_portal_access(
    customer_id: int,
    body: PortalAccessGrantBody,
    background_tasks: BackgroundTasks,
    current_user: dict = Depends(require_permission("customers.manage_portal_access")),
):
    """
    Bulk-enable portal logins for one or more contacts under a customer
    company (or the partner itself, for an individual). Idempotent —
    already-active contacts are skipped, not errored, so re-running after
    adding a new Odoo contact is safe. Each newly provisioned login gets a
    random, never-surfaced password and an emailed set-password invite
    (reusing the same token mechanism as self-service forgot-password).
    """
    odoo = get_odoo_client()
    try:
        partner = odoo.read("res.partner", [customer_id], fields=["id", "name", "is_company"])
    except Exception as e:
        raise HTTPException(status_code=502, detail=f"Odoo error: {str(e)}")
    if not partner:
        raise HTTPException(status_code=404, detail="Customer not found")
    partner = partner[0]
    company_name = partner["name"]

    if partner.get("is_company"):
        # The company record itself is always a valid target too — matches
        # get_portal_access always offering it as a candidate row.
        child_ids = odoo.search("res.partner", [["parent_id", "=", customer_id], ["active", "=", True]], limit=200)
        valid_ids = set(child_ids) | {customer_id}
    else:
        valid_ids = {customer_id}

    granted, company_added, skipped_existing, errors = [], [], [], []
    for contact_id in body.contact_ids:
        if contact_id not in valid_ids:
            errors.append({"contact_id": contact_id, "detail": "Not a contact of this company"})
            continue

        contact_records = odoo.read("res.partner", [contact_id], fields=["id", "name", "email"])
        contact = contact_records[0] if contact_records else None
        if not contact or not contact.get("email"):
            errors.append({
                "contact_id": contact_id,
                "detail": "This contact has no email address on file. Add one to the contact in Odoo before granting portal access.",
            })
            continue

        # Multi-company logins (2026-08-21): the old check here was
        # `{"odoo_partner_id": contact_id}` — a specific Odoo contact record
        # can still only ever back one login (enforced below by the unique
        # index on companies.odoo_partner_id too), so this stays a
        # per-contact idempotency check, just against the array field.
        # **2026-08-25 fix:** this used to treat any existing match as a
        # silent no-op ("already granted, nothing to do") — correct only
        # when the existing login's own email matches this contact's own
        # email. A real incident showed the other case: this exact contact
        # id already claimed by a DIFFERENT email's login entirely (e.g. an
        # internal/test email used by mistake instead of the customer's real
        # one), which is a genuine conflict an admin needs to know about and
        # go resolve, not something safe to silently swallow — the intended
        # grant never actually happens, and there was previously no signal
        # that anything was wrong.
        existing_for_contact = await col("users").find_one({"role": "customer", "companies.odoo_partner_id": contact_id})
        if existing_for_contact:
            this_email = contact["email"].strip().lower()
            if existing_for_contact.get("username") == this_email:
                skipped_existing.append(contact_id)
            else:
                errors.append({
                    "contact_id": contact_id,
                    "detail": f"This contact is already linked to a different portal login ({existing_for_contact.get('username')}). "
                              f"Remove it from that login (Manage → Deactivate/remove that company) before granting it here.",
                })
            continue

        username = contact["email"].strip().lower()
        existing_login = await col("users").find_one({"username": username})

        if existing_login and existing_login.get("role") != "customer":
            errors.append({"contact_id": contact_id, "detail": f"An account already exists for {username}"})
            continue

        if existing_login:
            # Same email already has a customer portal login for a different
            # company — add this company to that same login instead of
            # failing. No new password: they already have one. A distinct
            # email explains the new access rather than asking them to set a
            # password they already have.
            new_entry = {
                "odoo_partner_id": contact_id,
                "customer_company_partner_id": customer_id,
                "company_name": company_name,
                "active": True,
            }
            await col("users").update_one(
                {"_id": existing_login["_id"]},
                {"$push": {"companies": new_entry}},
            )
            # First company ever added to a login somehow missing one — keep
            # the pointer sane. Harmless no-op otherwise (won't override a
            # deliberately-chosen active company).
            if not existing_login.get("active_company_partner_id"):
                await col("users").update_one(
                    {"_id": existing_login["_id"]},
                    {"$set": {"active_company_partner_id": customer_id}},
                )

            from services.email_service import send_customer_company_added
            from config import get_settings as _gs
            background_tasks.add_task(
                send_customer_company_added,
                contact["email"], contact["name"], company_name, _gs().portal_url,
            )

            await audit_log(
                "customer.portal_access_company_added", "customer_portal_access", str(existing_login["_id"]),
                entity_label=f"{contact['name']} ({company_name})",
                user=current_user,
                after=new_entry,
            )
            company_added.append(contact_id)
            continue

        user_doc = {
            "username": username,
            "email": username,
            "password": hash_password(secrets.token_urlsafe(32)),
            "role": "customer",
            "name": contact["name"],
            "companies": [{
                "odoo_partner_id": contact_id,
                "customer_company_partner_id": customer_id,
                "company_name": company_name,
                "active": True,
            }],
            "active_company_partner_id": customer_id,
            "commission_eligible": False,
            "active": True,
            "must_change_password": True,
            "created_at": datetime.now(timezone.utc),
        }
        result = await col("users").insert_one(user_doc)

        token = await create_password_reset_token(username)
        from config import get_settings as _gs
        invite_url = f"{_gs().portal_url}/reset-password?token={token}"
        from services.email_service import send_customer_portal_invite
        background_tasks.add_task(
            send_customer_portal_invite,
            contact["email"], contact["name"], company_name, invite_url,
        )

        await audit_log(
            "customer.portal_access_granted", "customer_portal_access", str(result.inserted_id),
            entity_label=f"{contact['name']} ({company_name})",
            user=current_user,
            after={"odoo_partner_id": contact_id, "customer_company_partner_id": customer_id},
        )
        granted.append(contact_id)

    return {
        "success": True, "granted": granted, "company_added": company_added,
        "skipped_existing": skipped_existing, "errors": errors,
    }


@router.post("/{customer_id}/portal-access/{contact_id}/deactivate")
async def deactivate_portal_access(
    customer_id: int,
    contact_id: int,
    current_user: dict = Depends(require_permission("customers.manage_portal_access")),
):
    """Revokes access to ONE company (2026-08-21) — toggles that company's
    entry inside `companies`, not the whole login's top-level `active` flag.
    A login shared across several companies must keep working for the
    others; suspending the entire account is a separate, explicit action
    elsewhere, not a side effect of revoking one company. If the customer is
    mid-session on the company being revoked, their next request self-heals
    onto another active company (or is cleanly denied if none remain) via
    auth.py's resolve_customer_active_company()."""
    user = await col("users").find_one({"role": "customer", "companies.odoo_partner_id": contact_id, "companies.customer_company_partner_id": customer_id})
    if not user:
        raise HTTPException(status_code=404, detail="No portal login found for this contact")
    await col("users").update_one(
        {"_id": user["_id"]},
        {"$set": {"companies.$[c].active": False}},
        array_filters=[{"c.odoo_partner_id": contact_id, "c.customer_company_partner_id": customer_id}],
    )
    await audit_log(
        "customer.portal_access_deactivated", "customer_portal_access", str(user["_id"]),
        entity_label=user.get("name") or user.get("username"),
        user=current_user,
        detail={"customer_company_partner_id": customer_id},
    )
    return {"success": True}


@router.post("/{customer_id}/portal-access/{contact_id}/reactivate")
async def reactivate_portal_access(
    customer_id: int,
    contact_id: int,
    current_user: dict = Depends(require_permission("customers.manage_portal_access")),
):
    """Mirror of deactivate above — restores this one company's entry only."""
    user = await col("users").find_one({"role": "customer", "companies.odoo_partner_id": contact_id, "companies.customer_company_partner_id": customer_id})
    if not user:
        raise HTTPException(status_code=404, detail="No portal login found for this contact")
    await col("users").update_one(
        {"_id": user["_id"]},
        {"$set": {"companies.$[c].active": True}},
        array_filters=[{"c.odoo_partner_id": contact_id, "c.customer_company_partner_id": customer_id}],
    )
    await audit_log(
        "customer.portal_access_reactivated", "customer_portal_access", str(user["_id"]),
        entity_label=user.get("name") or user.get("username"),
        user=current_user,
        detail={"customer_company_partner_id": customer_id},
    )
    return {"success": True}


@router.delete("/{customer_id}/portal-access/{contact_id}")
async def remove_portal_access_link(
    customer_id: int,
    contact_id: int,
    current_user: dict = Depends(require_permission("customers.manage_portal_access")),
):
    """
    Permanently unlinks one company/contact pair from whichever login
    currently holds it — deliberately distinct from deactivate/reactivate
    above, which only flip the entry's `active` flag and leave it (and its
    claim on the unique `companies.odoo_partner_id` index) in place.

    Built after a real incident: a contact got granted portal access under
    the wrong email (an internal address used by mistake instead of the
    customer's real one), which silently blocked ever granting it correctly
    afterward — `grant_portal_access`'s idempotency check matches on
    `odoo_partner_id` alone, regardless of `active`, so deactivating the
    wrong entry doesn't free it up. This does: it fully removes the array
    element so the contact id can be granted again, to the right login.
    """
    user = await col("users").find_one(
        {"role": "customer", "companies.odoo_partner_id": contact_id, "companies.customer_company_partner_id": customer_id}
    )
    if not user:
        raise HTTPException(status_code=404, detail="No portal login found for this contact")
    removed_entry = next(
        (c for c in (user.get("companies") or [])
         if c.get("odoo_partner_id") == contact_id and c.get("customer_company_partner_id") == customer_id),
        None,
    )
    await col("users").update_one(
        {"_id": user["_id"]},
        {"$pull": {"companies": {"odoo_partner_id": contact_id, "customer_company_partner_id": customer_id}}},
    )
    await audit_log(
        "customer.portal_access_removed", "customer_portal_access", str(user["_id"]),
        entity_label=user.get("name") or user.get("username"),
        user=current_user,
        before=removed_entry,
    )
    return {"success": True, "username": user.get("username")}


@router.put("/{customer_id}/warehouse")
async def set_customer_warehouse(
    customer_id: int,
    body: CustomerWarehouseBody,
    current_user: dict = Depends(require_permission("customers.manage_portal_access")),
):
    """
    Admin-pinned warehouse override for a customer company, read by
    warehouse_context.py::resolve_warehouse_id for role "customer". Falls
    back to the global admin default when unset — same shape as the
    existing samples_account toggle on customer_metadata.

    Permission changed from customers.manage to customers.manage_portal_access
    (2026-08-21) — this setting only ever matters once a customer login
    actually exists, so the frontend folded it into the Portal Access section
    (CustomerProfile.js), gated the same way that section already is. Kept in
    sync here rather than leaving a frontend/backend permission mismatch where
    someone could see the field but 403 trying to save it.
    """
    odoo = get_odoo_client()
    try:
        partner = odoo.read("res.partner", [customer_id], fields=["id", "name"])
    except Exception as e:
        raise HTTPException(status_code=502, detail=f"Odoo error: {str(e)}")
    if not partner:
        raise HTTPException(status_code=404, detail="Customer not found")

    meta = await col("customer_metadata").find_one({"odoo_partner_id": customer_id}, {"_id": 0})
    before_val = meta.get("warehouse_id") if meta else None

    await col("customer_metadata").update_one(
        {"odoo_partner_id": customer_id},
        {"$set": {"warehouse_id": body.warehouse_id}},
        upsert=True,
    )
    await audit_log(
        "customer.warehouse_change", "customer", customer_id,
        entity_label=partner[0]["name"],
        user=current_user,
        before={"warehouse_id": before_val},
        after={"warehouse_id": body.warehouse_id},
    )
    return {"success": True, "warehouse_id": body.warehouse_id}


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


# ── Customer documents ────────────────────────────────────────────────────────

@router.get("/{customer_id}/documents")
async def list_customer_documents(
    customer_id: int,
    current_user: dict = Depends(get_current_user),
):
    """
    Return all documents linked to a customer profile:
    - Signed onboarding docs submitted via the wizard (from customer_onboarding via customer_ownership)
    - Any docs manually uploaded by admins (from customer_documents collection)
    Presigned R2 download URLs are generated for each.
    """
    if current_user.get("role") == "reseller":
        reseller = await col("resellers").find_one({"user_id": current_user["id"]}, NO_ID)
        if not reseller:
            raise HTTPException(status_code=403, detail="Access denied")
        ownership_check = await col("customer_ownership").find_one({
            "reseller_id": reseller["id"],
            "odoo_partner_id": customer_id,
        })
        if not ownership_check:
            raise HTTPException(status_code=403, detail="Access denied")

    docs = []

    # Onboarding docs — resolve via customer_ownership → customer_onboarding
    ownership = await col("customer_ownership").find_one({"odoo_partner_id": customer_id}, NO_ID)
    if ownership and ownership.get("onboarding_ref"):
        app = await col("customer_onboarding").find_one({"id": ownership["onboarding_ref"]}, NO_ID)
        if app:
            for d in (app.get("documents") or []):
                key = d.get("r2_key")
                url = None
                if key:
                    try:
                        url = await r2_presign(key)
                    except Exception:
                        pass
                docs.append({**d, "source": "onboarding", "download_url": url})

    # Admin-uploaded docs
    admin_docs = await col("customer_documents").find(
        {"odoo_partner_id": customer_id}, NO_ID
    ).to_list(length=100)
    for d in admin_docs:
        key = d.get("r2_key")
        url = None
        if key:
            try:
                url = await r2_presign(key)
            except Exception:
                pass
        docs.append({
            "id":           d["id"],
            "doc_type":     d.get("doc_type"),
            "label":        d.get("label") or d.get("filename") or "Document",
            "filename":     d.get("filename"),
            "r2_key":       key,
            "size":         d.get("size"),
            "uploaded_at":  d.get("uploaded_at"),
            "uploaded_by":  d.get("uploaded_by"),
            "source":       d.get("source", "admin"),
            "download_url": url,
        })

    return {"documents": docs, "total": len(docs)}


@router.post("/{customer_id}/documents/upload")
async def upload_customer_document(
    customer_id: int,
    label: str = Query(..., description="Document label"),
    doc_type: Optional[str] = Query(None, description="Structured doc type key — if provided, any existing doc of this type is replaced"),
    file: UploadFile = File(...),
    current_user: dict = Depends(require_permission("customers.manage")),
):
    """Admin uploads a document directly to a customer profile, stored in R2.
    When doc_type is provided, any existing document of that type is deleted first (overwrite)."""
    from services.r2_client import r2_delete as _r2_delete

    # Overwrite: delete existing doc of this type before inserting the new one
    if doc_type:
        existing = await col("customer_documents").find_one(
            {"odoo_partner_id": customer_id, "doc_type": doc_type}
        )
        if existing:
            if existing.get("r2_key"):
                try:
                    await _r2_delete(existing["r2_key"])
                except Exception:
                    pass
            await col("customer_documents").delete_one({"id": existing["id"]})
            await audit_log(
                "customers.document_replaced", "customer_documents", existing["id"],
                entity_label=f"customer:{customer_id} doc_type:{doc_type}",
                user=current_user,
                before={
                    "doc_type":    existing.get("doc_type"),
                    "filename":    existing.get("filename"),
                    "label":       existing.get("label"),
                    "source":      existing.get("source"),
                    "uploaded_by": existing.get("uploaded_by"),
                    "uploaded_at": str(existing.get("uploaded_at", "")),
                },
            )

    contents = await file.read()
    ext      = os.path.splitext(file.filename or "")[1] or ".pdf"
    doc_id   = str(uuid.uuid4())
    key      = f"customers/{customer_id}/{doc_id}{ext}"

    await r2_put(key, contents, content_type=file.content_type or "application/octet-stream")

    doc = {
        "id":              doc_id,
        "odoo_partner_id": customer_id,
        "label":           label.strip(),
        "filename":        file.filename,
        "r2_key":          key,
        "doc_type":        doc_type,
        "size":            len(contents),
        "source":          "admin",
        "uploaded_at":     datetime.now(timezone.utc),
        "uploaded_by":     current_user.get("username", ""),
    }
    await col("customer_documents").insert_one({**doc})
    await audit_log(
        "customers.document_uploaded", "customer_documents", doc_id,
        entity_label=f"customer:{customer_id} doc_type:{doc_type or 'custom'}",
        user=current_user,
        after={
            "doc_type":  doc_type,
            "filename":  file.filename,
            "label":     label.strip(),
            "source":    "admin",
        },
    )
    return {"success": True, "doc": doc}


@router.delete("/{customer_id}/documents/{doc_id}")
async def delete_customer_document(
    customer_id: int,
    doc_id: str,
    current_user: dict = Depends(require_permission("customers.manage")),
):
    """Delete an admin-uploaded customer document from R2 and MongoDB."""
    doc = await col("customer_documents").find_one({"id": doc_id, "odoo_partner_id": customer_id})
    if not doc:
        raise HTTPException(status_code=404, detail="Document not found")
    key = doc.get("r2_key")
    if key:
        try:
            await r2_delete(key)
        except Exception:
            pass
    await col("customer_documents").delete_one({"id": doc_id})
    await audit_log(
        "customers.document_deleted", "customer_documents", doc_id,
        entity_label=f"customer:{customer_id} doc_type:{doc.get('doc_type') or 'custom'}",
        user=current_user,
        before={
            "doc_type":    doc.get("doc_type"),
            "filename":    doc.get("filename"),
            "label":       doc.get("label"),
            "source":      doc.get("source"),
            "uploaded_by": doc.get("uploaded_by"),
            "uploaded_at": str(doc.get("uploaded_at", "")),
            "inbox_item_id": doc.get("inbox_item_id"),
        },
    )
    return {"success": True}


@router.get("/{customer_id}/docs-sent-history")
async def get_docs_sent_history(
    customer_id: int,
    current_user: dict = Depends(require_permission("onboarding.inbox")),
):
    """
    Return the most recent onboarding docs send event for this customer.
    Matches by odoo_partner_id first, falls back to the customer's email address.
    """
    # Try by odoo_partner_id stamp (set when sent from customer profile)
    record = await col("onboarding_inbox").find_one(
        {"odoo_partner_id": customer_id, "is_outgoing": True},
        sort=[("created_at", -1)],
        projection={"created_at": 1, "sent_by": 1, "to_email": 1},
    )

    if not record:
        # Fallback: match by email for sends from the customers list modal
        from odoo_client import get_odoo_client
        odoo = get_odoo_client()
        partners = odoo.read("res.partner", [customer_id], fields=["email"])
        customer_email = (partners[0].get("email") or "").strip().lower() if partners else ""
        if customer_email:
            record = await col("onboarding_inbox").find_one(
                {
                    "to_email": {"$regex": f"^{customer_email}$", "$options": "i"},
                    "is_outgoing": True,
                },
                sort=[("created_at", -1)],
                projection={"created_at": 1, "sent_by": 1, "to_email": 1},
            )

    if not record:
        return {"sent": False}

    return {
        "sent":     True,
        "sent_at":  record["created_at"].isoformat(),
        "sent_by":  record.get("sent_by") or "Unknown",
        "to_email": record.get("to_email", ""),
    }


@router.patch("/{partner_id}/link-company")
async def link_contact_to_company(
    partner_id: int,
    body: LinkCompanyBody,
    current_user: dict = Depends(require_permission("customers.manage")),
):
    """Set parent_id on a standalone Odoo contact, making them a child contact
    of the specified company. This is reversible — the contact can be unlinked
    later by setting parent_id to False via this endpoint with company_id=0."""
    odoo = get_odoo_client()

    # Validate the contact exists
    contacts = odoo.read("res.partner", [partner_id], fields=["name", "email", "parent_id", "is_company"])
    if not contacts:
        raise HTTPException(status_code=404, detail="Contact not found")
    contact = contacts[0]
    if contact.get("is_company"):
        raise HTTPException(status_code=422, detail="This record is a company, not a contact")

    before_parent = contact.get("parent_id")
    before_company_id   = before_parent[0] if before_parent and before_parent is not False else None
    before_company_name = before_parent[1] if before_parent and before_parent is not False else None

    # Validate the target company
    companies = odoo.read("res.partner", [body.company_id], fields=["name", "customer_rank", "is_company"])
    if not companies:
        raise HTTPException(status_code=404, detail="Company not found")
    company = companies[0]
    if not company.get("is_company"):
        raise HTTPException(status_code=422, detail="Target must be a company record")

    try:
        odoo.write("res.partner", [partner_id], {
            "parent_id": body.company_id,
            "type": "contact",
        })
    except Exception as e:
        raise HTTPException(status_code=502, detail=f"Odoo error: {str(e)}")

    await audit_log(
        "customer.link_company", "partner", str(partner_id),
        entity_label=contact["name"],
        user=current_user,
        before={"company_id": before_company_id, "company_name": before_company_name},
        after={"company_id": body.company_id, "company_name": company["name"]},
    )

    return {
        "success": True,
        "contact_name":  contact["name"],
        "company_id":    body.company_id,
        "company_name":  company["name"],
    }


# ── 8.27 — Archive address ────────────────────────────────────────────────────

@router.delete("/{customer_id}/addresses/{address_id}")
async def archive_customer_address(
    customer_id: int,
    address_id: int,
    current_user: dict = Depends(require_permission("customers.manage")),
):
    """Archive (soft-delete) a child address. Blocks archiving the main contact record."""
    odoo = get_odoo_client()
    try:
        existing = odoo.read("res.partner", [address_id], fields=["parent_id", "type", "name"])
    except Exception as e:
        raise HTTPException(status_code=502, detail=f"Odoo error: {str(e)}")
    if not existing:
        raise HTTPException(status_code=404, detail="Address not found")
    row = existing[0]
    parent = row.get("parent_id")
    parent_id = parent[0] if isinstance(parent, list) else parent
    if parent_id != customer_id:
        raise HTTPException(status_code=400, detail="Address does not belong to this customer")
    if row.get("type") == "contact":
        raise HTTPException(status_code=400, detail="Cannot archive the main contact address")
    try:
        odoo.write("res.partner", [address_id], {"active": False})
    except Exception as e:
        raise HTTPException(status_code=502, detail=f"Odoo error: {str(e)}")
    await audit_log(
        "customer.archive_address", "customer", customer_id,
        entity_label=row.get("name", ""),
        user=current_user,
        detail={"address_id": address_id, "type": row.get("type")},
    )
    return {"success": True}


# ── 8.28 — Customer payment terms ─────────────────────────────────────────────

@router.get("/{customer_id}/payment-terms")
def get_customer_payment_terms(
    customer_id: int,
    current_user: dict = Depends(get_current_user),
):
    """Return the customer's configured Odoo payment terms."""
    odoo = get_odoo_client()
    try:
        records = odoo.read("res.partner", [customer_id], fields=["property_payment_term_id"])
    except Exception as e:
        raise HTTPException(status_code=502, detail=f"Odoo error: {str(e)}")
    if not records:
        raise HTTPException(status_code=404, detail="Customer not found")
    term = records[0].get("property_payment_term_id")
    if isinstance(term, list) and len(term) == 2:
        return {"payment_term": {"id": term[0], "name": term[1]}}
    return {"payment_term": None}
