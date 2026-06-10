from fastapi import APIRouter, Depends, HTTPException, Query
from typing import Optional
from pydantic import BaseModel
from datetime import datetime, timezone
from auth import get_current_user, require_admin
from database import col, NO_ID
from odoo_client import get_odoo_client

router = APIRouter(prefix="/api/commission", tags=["commission"])

COMMISSION_CAP = 12.5   # Flat rate for all resellers — matrix only controls blocked products

class PayoutMarkPaid(BaseModel):
    payment_reference: Optional[str] = ""
    payment_date: Optional[str] = ""   # ISO date string e.g. "2025-06-10"

# ── Payout endpoints (defined before /{reseller_id} routes to avoid capture) ──

@router.get("/payouts")
async def get_payouts_summary(current_user: dict = Depends(require_admin)):
    """
    Pending commission payouts grouped by reseller.
    Includes banking details so admin can process EFT without leaving the portal.
    """
    pipeline = [
        {"$match": {"payout_status": "pending", "commission_total": {"$gt": 0}}},
        {"$group": {
            "_id": "$reseller_id",
            "reseller_name": {"$first": "$reseller_name"},
            "total_pending": {"$sum": "$commission_total"},
            "order_count": {"$sum": 1},
            "oldest_order": {"$min": "$created_at"},
            "latest_order": {"$max": "$created_at"},
        }},
        {"$sort": {"total_pending": -1}},
    ]
    rows = await col("order_commissions").aggregate(pipeline).to_list(200)

    # Enrich with banking details from reseller profiles
    reseller_ids = [r["_id"] for r in rows]
    resellers = await col("resellers").find(
        {"id": {"$in": reseller_ids}}, NO_ID
    ).to_list(200)
    reseller_map = {r["id"]: r for r in resellers}

    result = []
    for r in rows:
        res = reseller_map.get(r["_id"], {})
        result.append({
            "reseller_id": r["_id"],
            "reseller_name": r["reseller_name"],
            "total_pending": round(r["total_pending"], 2),
            "order_count": r["order_count"],
            "oldest_order": r["oldest_order"],
            "latest_order": r["latest_order"],
            "email": res.get("email", ""),
            "bank_name": res.get("bank_name", ""),
            "bank_account_holder": res.get("bank_account_holder", ""),
            "bank_account_number": res.get("bank_account_number", ""),
            "bank_branch_code": res.get("bank_branch_code", ""),
            "odoo_partner_id": res.get("odoo_partner_id"),
        })

    return {
        "resellers": result,
        "grand_total": round(sum(r["total_pending"] for r in result), 2),
        "total_resellers": len(result),
    }


@router.get("/payouts/{reseller_id}/orders")
async def get_pending_payout_orders(
    reseller_id: str,
    current_user: dict = Depends(require_admin),
):
    """Individual pending commission records for a single reseller."""
    records = await col("order_commissions").find(
        {"reseller_id": reseller_id, "payout_status": "pending", "commission_total": {"$gt": 0}},
        NO_ID,
    ).sort("created_at", -1).to_list(500)

    return {
        "reseller_id": reseller_id,
        "orders": records,
        "total": round(sum(r["commission_total"] for r in records), 2),
    }


@router.put("/payouts/{reseller_id}/mark-paid")
async def mark_payout_paid(
    reseller_id: str,
    payload: PayoutMarkPaid,
    current_user: dict = Depends(require_admin),
):
    """
    Mark all pending commissions for a reseller as paid in one batch.
    Records who paid, when, and the payment reference for audit trail.
    """
    now = datetime.now(timezone.utc)
    result = await col("order_commissions").update_many(
        {"reseller_id": reseller_id, "payout_status": "pending"},
        {"$set": {
            "payout_status": "paid",
            "paid_at": now,
            "paid_by": current_user.get("username", "admin"),
            "payment_reference": payload.payment_reference or "",
            "payment_date": payload.payment_date or now.strftime("%Y-%m-%d"),
        }},
    )
    if result.matched_count == 0:
        raise HTTPException(status_code=404, detail="No pending commissions found for this reseller")
    return {"success": True, "updated": result.modified_count}


# ── Matrix / block endpoints ───────────────────────────────────────────────────

@router.get("/{reseller_id}/matrix")
async def get_commission_matrix(
    reseller_id: str,
    search: Optional[str] = None,
    category: Optional[str] = None,
    current_user: dict = Depends(get_current_user),
):
    """
    Full product list for a reseller showing which products are blocked.
    All non-blocked products earn the flat 12.5% commission rate.
    """
    if current_user.get("role") == "reseller":
        reseller = await col("resellers").find_one(
            {"user_id": current_user["id"]}, NO_ID
        )
        if not reseller or reseller["id"] != reseller_id:
            raise HTTPException(status_code=403, detail="Access denied")

    reseller = await col("resellers").find_one({"id": reseller_id}, NO_ID)
    if not reseller:
        raise HTTPException(status_code=404, detail="Reseller not found")

    odoo = get_odoo_client()
    domain = [("type", "in", ["product", "consu"]), ("active", "=", True)]
    if search:
        domain.append(("name", "ilike", search))
    if category and category != "all":
        domain.append(("categ_id.name", "ilike", category))

    try:
        products = odoo.search_read(
            "product.template",
            domain=domain,
            fields=["id", "name", "default_code", "categ_id", "list_price"],
            limit=500,
            order="name asc",
        )
    except Exception as e:
        raise HTTPException(status_code=502, detail=f"Odoo error: {str(e)}")

    # Load all blocks for this reseller in one query
    cursor = col("commission_matrix").find({"reseller_id": reseller_id}, NO_ID)
    blocks = {entry["product_id"]: entry async for entry in cursor}

    matrix = []
    for p in products:
        pid = str(p["id"])
        cat_name = p.get("categ_id", [None, ""])[1] if p.get("categ_id") else ""
        is_blocked = bool(blocks.get(pid, {}).get("is_blocked", False))
        matrix.append({
            "product_id": pid,
            "product_name": p["name"],
            "product_sku": p.get("default_code", ""),
            "category": cat_name,
            "list_price": p.get("list_price", 0),
            "is_blocked": is_blocked,
            "commission_rate": 0 if is_blocked else COMMISSION_CAP,
        })

    blocked_count = sum(1 for m in matrix if m["is_blocked"])

    return {
        "reseller_id": reseller_id,
        "reseller_name": reseller["name"],
        "seller_code": reseller.get("seller_code", ""),
        "matrix": matrix,
        "summary": {
            "total_products": len(matrix),
            "blocked_products": blocked_count,
            "active_products": len(matrix) - blocked_count,
            "default_rate": COMMISSION_CAP,
        },
    }


@router.put("/{reseller_id}/matrix/{product_id}/block")
async def block_product(
    reseller_id: str,
    product_id: str,
    current_user: dict = Depends(require_admin),
):
    """Block a product for a specific reseller — earns 0% commission. Admin only."""
    now = datetime.now(timezone.utc)
    await col("commission_matrix").update_one(
        {"reseller_id": reseller_id, "product_id": product_id},
        {"$set": {"is_blocked": True, "updated_at": now}, "$setOnInsert": {"created_at": now}},
        upsert=True,
    )
    return {"success": True}


@router.put("/{reseller_id}/matrix/{product_id}/unblock")
async def unblock_product(
    reseller_id: str,
    product_id: str,
    current_user: dict = Depends(require_admin),
):
    """Unblock a product — restores the flat 12.5% commission. Admin only."""
    now = datetime.now(timezone.utc)
    await col("commission_matrix").update_one(
        {"reseller_id": reseller_id, "product_id": product_id},
        {"$set": {"is_blocked": False, "updated_at": now}},
    )
    return {"success": True}


@router.delete("/{reseller_id}/matrix/{product_id}")
async def reset_matrix_entry(
    reseller_id: str,
    product_id: str,
    current_user: dict = Depends(require_admin),
):
    """Remove the block entry entirely — same effect as unblock. Admin only."""
    await col("commission_matrix").delete_one(
        {"reseller_id": reseller_id, "product_id": product_id}
    )
    return {"success": True}


@router.get("/{reseller_id}/history")
async def get_commission_history(
    reseller_id: str,
    limit: int = Query(50, le=200),
    offset: int = Query(0, ge=0),
    current_user: dict = Depends(get_current_user),
):
    """Commission order history for a reseller. Resellers see only their own."""
    if current_user.get("role") == "reseller":
        reseller = await col("resellers").find_one(
            {"user_id": current_user["id"]}, NO_ID
        )
        if not reseller or reseller["id"] != reseller_id:
            raise HTTPException(status_code=403, detail="Access denied")

    records = await col("order_commissions").find(
        {"reseller_id": reseller_id}, NO_ID
    ).sort("created_at", -1).skip(offset).limit(limit).to_list(length=limit)

    total = await col("order_commissions").count_documents({"reseller_id": reseller_id})

    return {
        "reseller_id": reseller_id,
        "records": records,
        "total": total,
    }
