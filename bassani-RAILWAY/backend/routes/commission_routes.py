import calendar as _cal
from fastapi import APIRouter, Depends, HTTPException, Query
from typing import Optional, List
from pydantic import BaseModel
from datetime import datetime, date, timezone
from auth import get_current_user, require_admin
from database import col, NO_ID
from odoo_client import get_odoo_client

router = APIRouter(prefix="/api/commission", tags=["commission"])


# ── Default tier bands ────────────────────────────────────────────────────────
# Turnover thresholds are fixed; rates are admin-configurable via /tiers PUT.

DEFAULT_TIERS = [
    {"tier": 1, "min": 0,          "max": 300_000,      "rate": 2.5,  "label": "Tier 1", "range": "R0 – <R300k"},
    {"tier": 2, "min": 300_000,    "max": 500_000,      "rate": 5.0,  "label": "Tier 2", "range": "R300k – <R500k"},
    {"tier": 3, "min": 500_000,    "max": 750_000,      "rate": 7.5,  "label": "Tier 3", "range": "R500k – <R750k"},
    {"tier": 4, "min": 750_000,    "max": 1_000_000,    "rate": 10.0, "label": "Tier 4", "range": "R750k – <R1m"},
    {"tier": 5, "min": 1_000_000,  "max": float("inf"), "rate": 12.5, "label": "Tier 5", "range": "R1m+"},
]


async def get_tiers_config() -> list:
    """Load tier config from DB settings; fall back to hardcoded defaults."""
    doc = await col("settings").find_one({"key": "commission_tiers"})
    if doc and doc.get("value"):
        return doc["value"]
    return DEFAULT_TIERS


def apply_tier(tiers: list, turnover: float) -> dict:
    for t in tiers:
        if t["min"] <= turnover < t["max"]:
            return t
    return tiers[-1]


# ── Pydantic models ───────────────────────────────────────────────────────────

class TiersUpdate(BaseModel):
    rates: List[float]   # Must be exactly 5 values, one per tier in ascending order

class MarkPaidPayload(BaseModel):
    payment_reference: Optional[str] = ""
    payment_date: Optional[str] = ""

class GeneratePayload(BaseModel):
    year: int
    month: int
    reseller_id: Optional[str] = None   # None = generate for all resellers


# ── Helpers ───────────────────────────────────────────────────────────────────

async def _get_commission_account(odoo):
    """
    Return Odoo expense account ID for commission vendor bills.
    Preference: cached setting → account named 'commission' → first expense account.
    """
    cached = await col("settings").find_one({"key": "commission_account_id"})
    if cached and cached.get("value"):
        return int(cached["value"])

    searches = [
        [("account_type", "=", "expense"), ("deprecated", "=", False), ("name", "ilike", "commission")],
        [("account_type", "=", "expense"), ("deprecated", "=", False)],
    ]
    for domain in searches:
        try:
            accounts = odoo.search_read(
                "account.account",
                domain=domain,
                fields=["id", "code", "name"],
                limit=1,
                order="code asc",
            )
            if accounts:
                account_id = int(accounts[0]["id"])
                await col("settings").update_one(
                    {"key": "commission_account_id"},
                    {"$set": {
                        "key": "commission_account_id",
                        "value": account_id,
                        "account_name": accounts[0]["name"],
                        "account_code": accounts[0]["code"],
                        "updated_at": datetime.now(timezone.utc),
                    }},
                    upsert=True,
                )
                return account_id
        except Exception:
            continue
    return None


def _stmt_id(reseller_id: str, year: int, month: int) -> str:
    return f"stmt_{reseller_id}_{year}_{month:02d}"


def _month_bounds(year: int, month: int):
    start = datetime(year, month, 1, tzinfo=timezone.utc)
    if month == 12:
        end = datetime(year + 1, 1, 1, tzinfo=timezone.utc)
    else:
        end = datetime(year, month + 1, 1, tzinfo=timezone.utc)
    return start, end


# ── Tier configuration endpoints ──────────────────────────────────────────────

@router.get("/tiers")
async def get_tiers(current_user: dict = Depends(get_current_user)):
    """Return current tier band configuration (rates may have been customised)."""
    tiers = await get_tiers_config()
    return {"tiers": tiers, "is_custom": tiers is not DEFAULT_TIERS}


@router.put("/tiers")
async def update_tiers(
    payload: TiersUpdate,
    current_user: dict = Depends(require_admin),
):
    """
    Update commission rates for all 5 tiers.
    Thresholds (turnover bands) remain fixed; only rates change.
    """
    if len(payload.rates) != 5:
        raise HTTPException(status_code=400, detail="Exactly 5 rates required (one per tier)")
    for r in payload.rates:
        if not (0 <= r <= 100):
            raise HTTPException(status_code=400, detail=f"Rate {r} is out of range — must be 0–100")

    updated = [
        {**DEFAULT_TIERS[i], "rate": round(payload.rates[i], 4)}
        for i in range(5)
    ]

    await col("settings").update_one(
        {"key": "commission_tiers"},
        {"$set": {
            "key": "commission_tiers",
            "value": updated,
            "updated_at": datetime.now(timezone.utc),
            "updated_by": current_user.get("username", "admin"),
        }},
        upsert=True,
    )
    return {"success": True, "tiers": updated}


@router.delete("/tiers/reset")
async def reset_tiers(current_user: dict = Depends(require_admin)):
    """Reset tier rates back to system defaults."""
    await col("settings").delete_one({"key": "commission_tiers"})
    return {"success": True, "tiers": DEFAULT_TIERS}


# ── Statement endpoints ───────────────────────────────────────────────────────

@router.post("/statements/generate")
async def generate_statements(
    payload: GeneratePayload,
    current_user: dict = Depends(require_admin),
):
    """
    Generate (or re-generate) monthly commission statements for a given month.
    Aggregates order_commissions, applies the current tier bands, and upserts
    one statement per reseller. Paid statements are skipped.
    """
    year, month = payload.year, payload.month
    start, end = _month_bounds(year, month)
    month_label = f"{_cal.month_abbr[month]} {year}"
    tiers = await get_tiers_config()

    match: dict = {
        "created_at": {"$gte": start, "$lt": end},
        "payout_status": {"$ne": "cancelled"},
    }
    if payload.reseller_id:
        match["reseller_id"] = payload.reseller_id

    pipeline = [
        {"$match": match},
        {"$group": {
            "_id": "$reseller_id",
            "reseller_name":  {"$first": "$reseller_name"},
            "total_turnover": {"$sum": "$original_subtotal"},
            "order_count":    {"$sum": 1},
        }},
    ]
    rows = await col("order_commissions").aggregate(pipeline).to_list(500)

    generated, skipped = [], []
    for row in rows:
        rid = row["_id"]
        stmt_id = _stmt_id(rid, year, month)

        existing = await col("monthly_commission_statements").find_one({"id": stmt_id}, NO_ID)
        if existing and existing.get("status") == "paid":
            skipped.append(stmt_id)
            continue

        turnover = round(row["total_turnover"], 2)
        tier     = apply_tier(tiers, turnover)
        commission_amount = round(turnover * (tier["rate"] / 100), 2)

        now = datetime.now(timezone.utc)
        stmt = {
            "id":               stmt_id,
            "reseller_id":      rid,
            "reseller_name":    row["reseller_name"] or "—",
            "year":             year,
            "month":            month,
            "month_label":      month_label,
            "total_turnover":   turnover,
            "order_count":      row["order_count"],
            "tier":             tier["tier"],
            "tier_label":       tier["label"],
            "tier_range":       tier["range"],
            "commission_rate":  tier["rate"],
            "commission_amount": commission_amount,
            "status":           "pending",
            "generated_at":     now,
            "paid_at":          None,
            "paid_by":          None,
            "payment_reference": None,
            "payment_date":     None,
            "odoo_bill_id":     None,
            "updated_at":       now,
        }
        await col("monthly_commission_statements").update_one(
            {"id": stmt_id},
            {"$set": stmt, "$setOnInsert": {"created_at": now}},
            upsert=True,
        )
        generated.append(stmt)

    return {
        "generated":   len(generated),
        "skipped_paid": skipped,
        "statements":  generated,
        "year":        year,
        "month":       month,
        "month_label": month_label,
    }


@router.get("/statements")
async def list_statements(
    reseller_id: Optional[str] = None,
    status: Optional[str] = None,
    year: Optional[int] = None,
    month: Optional[int] = None,
    limit: int = Query(50, le=200),
    offset: int = Query(0, ge=0),
    current_user: dict = Depends(get_current_user),
):
    """List monthly commission statements. Resellers see only their own."""
    match: dict = {}

    if current_user.get("role") == "reseller":
        reseller = await col("resellers").find_one({"user_id": current_user["id"]}, NO_ID)
        if not reseller:
            return {"statements": [], "total": 0}
        match["reseller_id"] = reseller["id"]
    elif reseller_id:
        match["reseller_id"] = reseller_id

    if status and status != "all":
        match["status"] = status
    if year:
        match["year"] = year
    if month:
        match["month"] = month

    total = await col("monthly_commission_statements").count_documents(match)
    rows  = await col("monthly_commission_statements").find(
        match, NO_ID
    ).sort([("year", -1), ("month", -1)]).skip(offset).limit(limit).to_list(limit)

    return {"statements": rows, "total": total}


@router.get("/statements/{stmt_id}")
async def get_statement(
    stmt_id: str,
    current_user: dict = Depends(get_current_user),
):
    """Statement detail with the individual order records that make up the turnover."""
    stmt = await col("monthly_commission_statements").find_one({"id": stmt_id}, NO_ID)
    if not stmt:
        raise HTTPException(status_code=404, detail="Statement not found")

    if current_user.get("role") == "reseller":
        reseller = await col("resellers").find_one({"user_id": current_user["id"]}, NO_ID)
        if not reseller or reseller["id"] != stmt["reseller_id"]:
            raise HTTPException(status_code=403, detail="Access denied")

    start, end = _month_bounds(stmt["year"], stmt["month"])
    orders = await col("order_commissions").find(
        {
            "reseller_id":   stmt["reseller_id"],
            "created_at":    {"$gte": start, "$lt": end},
            "payout_status": {"$ne": "cancelled"},
        },
        NO_ID,
    ).sort("created_at", 1).to_list(500)

    return {**stmt, "orders": orders}


@router.put("/statements/{stmt_id}/mark-paid")
async def mark_statement_paid(
    stmt_id: str,
    payload: MarkPaidPayload,
    current_user: dict = Depends(require_admin),
):
    """
    Mark a monthly statement as paid and create an Odoo vendor bill.
    Also batch-marks all contributing order_commissions records as paid.
    """
    stmt = await col("monthly_commission_statements").find_one({"id": stmt_id}, NO_ID)
    if not stmt:
        raise HTTPException(status_code=404, detail="Statement not found")
    if stmt.get("status") == "paid":
        raise HTTPException(status_code=400, detail="Statement is already paid")

    now    = datetime.now(timezone.utc)
    odoo   = get_odoo_client()
    bill_id = None
    warning = None

    reseller = await col("resellers").find_one({"id": stmt["reseller_id"]}, NO_ID)
    odoo_partner_id = int(reseller["odoo_partner_id"]) if reseller and reseller.get("odoo_partner_id") else None

    if odoo_partner_id:
        try:
            account_id = await _get_commission_account(odoo)
            if account_id:
                bill_id = odoo.create("account.move", {
                    "move_type":       "in_invoice",
                    "partner_id":      odoo_partner_id,
                    "invoice_origin":  stmt["month_label"],
                    "ref":             f"Commission — {stmt['month_label']} · {stmt['tier_label']} @ {stmt['commission_rate']}%",
                    "invoice_line_ids": [(0, 0, {
                        "name": (
                            f"Reseller commission — {stmt['month_label']} | "
                            f"Turnover: R{stmt['total_turnover']:,.2f} | "
                            f"{stmt['tier_label']} ({stmt['tier_range']}) @ {stmt['commission_rate']}%"
                        ),
                        "quantity":   1.0,
                        "price_unit": round(float(stmt["commission_amount"]), 2),
                        "account_id": account_id,
                    })],
                })
                odoo.execute("account.move", "action_post", [bill_id])
            else:
                warning = "No expense account found in Odoo — bill skipped. Commission is recorded in the portal."
        except Exception as e:
            warning = f"Odoo bill failed: {str(e)} — commission recorded in portal only."
    else:
        warning = "Reseller has no Odoo vendor account linked — bill skipped."

    await col("monthly_commission_statements").update_one(
        {"id": stmt_id},
        {"$set": {
            "status":            "paid",
            "paid_at":           now,
            "paid_by":           current_user.get("username", "admin"),
            "payment_reference": payload.payment_reference or "",
            "payment_date":      payload.payment_date or now.strftime("%Y-%m-%d"),
            "odoo_bill_id":      str(bill_id) if bill_id else None,
            "updated_at":        now,
        }},
    )

    # Batch-mark contributing orders
    start, end = _month_bounds(stmt["year"], stmt["month"])
    await col("order_commissions").update_many(
        {
            "reseller_id":   stmt["reseller_id"],
            "created_at":    {"$gte": start, "$lt": end},
            "payout_status": "pending",
        },
        {"$set": {
            "payout_status":     "paid",
            "paid_at":           now,
            "paid_by":           current_user.get("username", "admin"),
            "payment_reference": payload.payment_reference or "",
        }},
    )

    return {"success": True, "odoo_bill_id": bill_id, "warning": warning}


# ── Payouts summary (pending statements) ─────────────────────────────────────

@router.get("/payouts")
async def get_payouts_summary(current_user: dict = Depends(require_admin)):
    """Pending monthly statements enriched with reseller banking details."""
    rows = await col("monthly_commission_statements").find(
        {"status": "pending"}, NO_ID
    ).sort([("year", -1), ("month", -1)]).to_list(500)

    reseller_ids = list({r["reseller_id"] for r in rows})
    resellers = await col("resellers").find(
        {"id": {"$in": reseller_ids}}, NO_ID
    ).to_list(200)
    reseller_map = {r["id"]: r for r in resellers}

    result = []
    for s in rows:
        res = reseller_map.get(s["reseller_id"], {})
        result.append({
            **s,
            "email":               res.get("email", ""),
            "bank_name":           res.get("bank_name", ""),
            "bank_account_holder": res.get("bank_account_holder", ""),
            "bank_account_number": res.get("bank_account_number", ""),
            "bank_branch_code":    res.get("bank_branch_code", ""),
            "odoo_partner_id":     res.get("odoo_partner_id"),
        })

    return {
        "statements":   result,
        "grand_total":  round(sum(r["commission_amount"] for r in result), 2),
        "total_pending": len(result),
    }


# ── Per-reseller endpoints ────────────────────────────────────────────────────

@router.get("/{reseller_id}/history")
async def get_commission_history(
    reseller_id: str,
    limit: int = Query(24, le=60),
    offset: int = Query(0, ge=0),
    current_user: dict = Depends(get_current_user),
):
    """Monthly statement history for a reseller. Resellers see only their own."""
    if current_user.get("role") == "reseller":
        reseller = await col("resellers").find_one({"user_id": current_user["id"]}, NO_ID)
        if not reseller or reseller["id"] != reseller_id:
            raise HTTPException(status_code=403, detail="Access denied")

    total = await col("monthly_commission_statements").count_documents({"reseller_id": reseller_id})
    records = await col("monthly_commission_statements").find(
        {"reseller_id": reseller_id}, NO_ID
    ).sort([("year", -1), ("month", -1)]).skip(offset).limit(limit).to_list(limit)

    return {"reseller_id": reseller_id, "records": records, "total": total}


@router.get("/{reseller_id}/current-month")
async def current_month_progress(
    reseller_id: str,
    current_user: dict = Depends(get_current_user),
):
    """
    Current month's turnover and projected commission tier for a reseller.
    Used by the reseller Commission page to show live progress.
    """
    if current_user.get("role") == "reseller":
        reseller = await col("resellers").find_one({"user_id": current_user["id"]}, NO_ID)
        if not reseller or reseller["id"] != reseller_id:
            raise HTTPException(status_code=403, detail="Access denied")

    today = date.today()
    start, end = _month_bounds(today.year, today.month)

    pipeline = [
        {"$match": {
            "reseller_id": reseller_id,
            "created_at":  {"$gte": start, "$lt": end},
            "payout_status": {"$ne": "cancelled"},
        }},
        {"$group": {
            "_id":            None,
            "total_turnover": {"$sum": "$original_subtotal"},
            "order_count":    {"$sum": 1},
        }},
    ]
    result = await col("order_commissions").aggregate(pipeline).to_list(1)
    turnover    = result[0]["total_turnover"] if result else 0.0
    order_count = result[0]["order_count"]    if result else 0

    tiers = await get_tiers_config()
    tier  = apply_tier(tiers, turnover)
    commission_projected = round(turnover * (tier["rate"] / 100), 2)

    next_tier = next((t for t in tiers if t["tier"] == tier["tier"] + 1), None)

    return {
        "month_label":          f"{_cal.month_abbr[today.month]} {today.year}",
        "year":                 today.year,
        "month":                today.month,
        "total_turnover":       round(turnover, 2),
        "order_count":          order_count,
        "tier":                 tier,
        "commission_rate":      tier["rate"],
        "commission_projected": commission_projected,
        "next_tier":            next_tier,
        "next_tier_gap":        round(next_tier["min"] - turnover, 2) if next_tier else None,
        "next_tier_pct":        min(round(turnover / next_tier["min"] * 100, 1), 100.0) if next_tier else 100.0,
        "all_tiers":            tiers,
    }
