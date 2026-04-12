from fastapi import APIRouter, Depends, HTTPException, Query, UploadFile, File
from typing import Optional, List
from pydantic import BaseModel
from datetime import datetime, timezone
from auth import get_current_user, require_admin
from database import col, NO_ID
from odoo_client import get_odoo_client
import io

router = APIRouter(prefix="/api/commission", tags=["commission"])

# ── Constants ─────────────────────────────────────────────────────────────────

MIN_RATE = 10.0
MAX_RATE = 50.0
SYSTEM_DEFAULT = 10.0

# ── Pydantic models ───────────────────────────────────────────────────────────

class MatrixEntry(BaseModel):
    reseller_id: str
    product_id: str                 # Odoo product ID as string
    commission_rate: float
    is_blocked: bool = False

class MatrixUpdate(BaseModel):
    commission_rate: Optional[float] = None
    is_blocked: Optional[bool] = None

class CommissionLimits(BaseModel):
    min_rate: float = MIN_RATE
    max_rate: float = MAX_RATE

# ── Helpers ───────────────────────────────────────────────────────────────────

def clamp_rate(rate: float) -> float:
    return max(MIN_RATE, min(MAX_RATE, rate))

async def get_effective_rate(reseller_id: str, product_id: str, product_cat: str) -> dict:
    """
    Three-tier commission resolution:
    1. Product-specific rate in commission_matrix
    2. Reseller category default rate
    3. System default (10%)
    Returns dict with rate, source, and is_blocked.
    """
    # Tier 1 — product-specific
    entry = await col("commission_matrix").find_one(
        {"reseller_id": reseller_id, "product_id": str(product_id)}, NO_ID
    )
    if entry:
        if entry.get("is_blocked"):
            return {"rate": 0, "source": "blocked", "is_blocked": True}
        return {
            "rate": entry["commission_rate"],
            "source": "custom",
            "is_blocked": False,
        }

    # Tier 2 — reseller category default
    reseller = await col("resellers").find_one({"id": reseller_id}, NO_ID)
    if reseller:
        rates = reseller.get("commission_rates", {})
        if product_cat in rates:
            return {
                "rate": rates[product_cat],
                "source": "category_default",
                "is_blocked": False,
            }
        fallback = reseller.get("default_commission", SYSTEM_DEFAULT)
        return {"rate": fallback, "source": "reseller_default", "is_blocked": False}

    # Tier 3 — system default
    return {"rate": SYSTEM_DEFAULT, "source": "system_default", "is_blocked": False}

# ── Endpoints ─────────────────────────────────────────────────────────────────

@router.get("/{reseller_id}/matrix")
async def get_commission_matrix(
    reseller_id: str,
    search: Optional[str] = None,
    category: Optional[str] = None,
    current_user: dict = Depends(get_current_user),
):
    """
    Full commission matrix for a reseller.
    Shows every product with its effective rate and source (custom/default/blocked).
    """
    # Resellers can only see their own matrix
    if current_user.get("role") == "reseller":
        reseller = await col("resellers").find_one(
            {"user_id": current_user["id"]}, NO_ID
        )
        if not reseller or reseller["id"] != reseller_id:
            raise HTTPException(status_code=403, detail="Access denied")

    reseller = await col("resellers").find_one({"id": reseller_id}, NO_ID)
    if not reseller:
        raise HTTPException(status_code=404, detail="Reseller not found")

    # Fetch all products from Odoo
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

    # Get all matrix overrides for this reseller in one query
    cursor = col("commission_matrix").find(
        {"reseller_id": reseller_id}, NO_ID
    )
    overrides = {entry["product_id"]: entry async for entry in cursor}

    # Build matrix response
    matrix = []
    for p in products:
        pid = str(p["id"])
        cat_name = p.get("categ_id", [None, ""])[1] if p.get("categ_id") else ""
        override = overrides.get(pid)

        if override:
            if override.get("is_blocked"):
                source = "blocked"
                rate = reseller.get("commission_rates", {}).get(cat_name, SYSTEM_DEFAULT)
                effective_rate = 0
            else:
                source = "custom"
                rate = override["commission_rate"]
                effective_rate = rate
        else:
            cat_rates = reseller.get("commission_rates", {})
            rate = cat_rates.get(cat_name, reseller.get("default_commission", SYSTEM_DEFAULT))
            source = "category_default"
            effective_rate = rate

        matrix.append({
            "product_id": pid,
            "product_name": p["name"],
            "product_sku": p.get("default_code", ""),
            "category": cat_name,
            "list_price": p.get("list_price", 0),
            "commission_rate": rate,
            "effective_rate": effective_rate,
            "source": source,
            "is_blocked": source == "blocked",
            "is_custom": source == "custom",
        })

    # Summary stats
    custom_count  = sum(1 for m in matrix if m["source"] == "custom")
    blocked_count = sum(1 for m in matrix if m["is_blocked"])
    active        = [m for m in matrix if not m["is_blocked"]]
    avg_rate      = sum(m["effective_rate"] for m in active) / len(active) if active else 0

    return {
        "reseller_id": reseller_id,
        "reseller_name": reseller["name"],
        "seller_code": reseller.get("seller_code", ""),
        "category_defaults": reseller.get("commission_rates", {}),
        "default_commission": reseller.get("default_commission", SYSTEM_DEFAULT),
        "matrix": matrix,
        "summary": {
            "total_products": len(matrix),
            "custom_rates": custom_count,
            "blocked_products": blocked_count,
            "avg_effective_rate": round(avg_rate, 2),
        },
    }


@router.put("/{reseller_id}/matrix/{product_id}")
async def update_matrix_entry(
    reseller_id: str,
    product_id: str,
    update: MatrixUpdate,
    current_user: dict = Depends(require_admin),
):
    """
    Set or update a product-specific commission rate for a reseller.
    Admin only. Rate must be between 10% and 50%.
    """
    if update.commission_rate is not None:
        if update.commission_rate < MIN_RATE or update.commission_rate > MAX_RATE:
            raise HTTPException(
                status_code=400,
                detail=f"Commission rate must be between {MIN_RATE}% and {MAX_RATE}%"
            )

    existing = await col("commission_matrix").find_one(
        {"reseller_id": reseller_id, "product_id": str(product_id)}
    )

    now = datetime.now(timezone.utc)

    if existing:
        set_vals = {"updated_at": now}
        if update.commission_rate is not None:
            set_vals["commission_rate"] = update.commission_rate
        if update.is_blocked is not None:
            set_vals["is_blocked"] = update.is_blocked
        await col("commission_matrix").update_one(
            {"reseller_id": reseller_id, "product_id": str(product_id)},
            {"$set": set_vals},
        )
    else:
        await col("commission_matrix").insert_one({
            "reseller_id": reseller_id,
            "product_id": str(product_id),
            "commission_rate": update.commission_rate or SYSTEM_DEFAULT,
            "is_blocked": update.is_blocked or False,
            "created_at": now,
            "updated_at": now,
        })

    return {"success": True}


@router.put("/{reseller_id}/matrix/{product_id}/block")
async def block_product(
    reseller_id: str,
    product_id: str,
    current_user: dict = Depends(require_admin),
):
    """Block a product for a specific reseller. Admin only."""
    now = datetime.now(timezone.utc)
    await col("commission_matrix").update_one(
        {"reseller_id": reseller_id, "product_id": str(product_id)},
        {"$set": {"is_blocked": True, "updated_at": now}},
        upsert=True,
    )
    return {"success": True, "message": "Product blocked"}


@router.put("/{reseller_id}/matrix/{product_id}/unblock")
async def unblock_product(
    reseller_id: str,
    product_id: str,
    current_user: dict = Depends(require_admin),
):
    """Unblock a product for a specific reseller. Admin only."""
    now = datetime.now(timezone.utc)
    await col("commission_matrix").update_one(
        {"reseller_id": reseller_id, "product_id": str(product_id)},
        {"$set": {"is_blocked": False, "updated_at": now}},
        upsert=True,
    )
    return {"success": True, "message": "Product unblocked"}


@router.delete("/{reseller_id}/matrix/{product_id}")
async def reset_matrix_entry(
    reseller_id: str,
    product_id: str,
    current_user: dict = Depends(require_admin),
):
    """
    Remove a product-specific override — reverts to category default rate.
    Admin only.
    """
    await col("commission_matrix").delete_one(
        {"reseller_id": reseller_id, "product_id": str(product_id)}
    )
    return {"success": True, "message": "Reset to category default"}


@router.post("/{reseller_id}/matrix/upload")
async def bulk_upload_matrix(
    reseller_id: str,
    file: UploadFile = File(...),
    current_user: dict = Depends(require_admin),
):
    """
    Bulk upload commission rates via CSV or Excel.
    Admin only.

    Expected columns (flexible matching):
      product_id | product_name | sku | commission_rate | is_blocked

    Returns a report of successes and errors.
    """
    try:
        import pandas as pd
    except ImportError:
        raise HTTPException(status_code=500, detail="pandas not installed")

    content = await file.read()

    try:
        if file.filename.endswith(".csv"):
            df = pd.read_csv(io.BytesIO(content))
        else:
            df = pd.read_excel(io.BytesIO(content))
    except Exception as e:
        raise HTTPException(status_code=400, detail=f"Could not read file: {str(e)}")

    # Normalise column names
    df.columns = [c.strip().lower().replace(" ", "_") for c in df.columns]

    results = {"success": [], "errors": [], "skipped": []}
    now = datetime.now(timezone.utc)

    for idx, row in df.iterrows():
        row_num = idx + 2  # 1-indexed + header

        # Find product_id column
        pid = None
        for col_name in ["product_id", "odoo_id", "id"]:
            if col_name in row and row[col_name]:
                pid = str(int(row[col_name]))
                break
        if not pid:
            results["errors"].append({"row": row_num, "error": "Missing product_id"})
            continue

        # Find commission rate
        rate = None
        for col_name in ["commission_rate", "rate", "commission"]:
            if col_name in row and row[col_name]:
                try:
                    rate = float(row[col_name])
                except (ValueError, TypeError):
                    pass
                break

        if rate is not None and (rate < MIN_RATE or rate > MAX_RATE):
            results["errors"].append({
                "row": row_num,
                "product_id": pid,
                "error": f"Rate {rate}% out of range ({MIN_RATE}%–{MAX_RATE}%)"
            })
            continue

        is_blocked = bool(row.get("is_blocked", False))

        set_vals = {"updated_at": now}
        if rate is not None:
            set_vals["commission_rate"] = rate
        set_vals["is_blocked"] = is_blocked

        await col("commission_matrix").update_one(
            {"reseller_id": reseller_id, "product_id": pid},
            {"$set": set_vals, "$setOnInsert": {"created_at": now}},
            upsert=True,
        )
        results["success"].append({"row": row_num, "product_id": pid, "rate": rate})

    return {
        "success_count": len(results["success"]),
        "error_count": len(results["errors"]),
        "skipped_count": len(results["skipped"]),
        "details": results,
    }


@router.get("/limits")
async def get_commission_limits(current_user: dict = Depends(get_current_user)):
    """Get the current system-wide commission min/max limits."""
    settings_doc = await col("settings").find_one({"key": "commission_limits"}, NO_ID)
    if settings_doc:
        return {
            "min_rate": settings_doc.get("min_rate", MIN_RATE),
            "max_rate": settings_doc.get("max_rate", MAX_RATE),
        }
    return {"min_rate": MIN_RATE, "max_rate": MAX_RATE}


@router.put("/limits")
async def update_commission_limits(
    limits: CommissionLimits,
    current_user: dict = Depends(require_admin),
):
    """Update system-wide commission limits. Admin only."""
    if limits.min_rate >= limits.max_rate:
        raise HTTPException(status_code=400, detail="min_rate must be less than max_rate")
    if limits.min_rate < 0 or limits.max_rate > 100:
        raise HTTPException(status_code=400, detail="Rates must be between 0% and 100%")

    await col("settings").update_one(
        {"key": "commission_limits"},
        {"$set": {
            "key": "commission_limits",
            "min_rate": limits.min_rate,
            "max_rate": limits.max_rate,
            "updated_at": datetime.now(timezone.utc),
        }},
        upsert=True,
    )
    return {"success": True}


@router.get("/{reseller_id}/product/{product_id}")
async def get_product_commission(
    reseller_id: str,
    product_id: str,
    current_user: dict = Depends(get_current_user),
):
    """
    Get the effective commission rate for a single product + reseller combo.
    Used during order creation to preview commission before saving.
    """
    odoo = get_odoo_client()
    try:
        product = odoo.read(
            "product.template",
            [int(product_id)],
            fields=["name", "categ_id", "list_price"],
        )
        if not product:
            raise HTTPException(status_code=404, detail="Product not found in Odoo")
        cat_name = product[0]["categ_id"][1] if product[0].get("categ_id") else ""
    except HTTPException:
        raise
    except Exception as e:
        raise HTTPException(status_code=502, detail=f"Odoo error: {str(e)}")

    result = await get_effective_rate(reseller_id, product_id, cat_name)
    return {
        "reseller_id": reseller_id,
        "product_id": product_id,
        "product_name": product[0]["name"],
        "category": cat_name,
        **result,
    }
