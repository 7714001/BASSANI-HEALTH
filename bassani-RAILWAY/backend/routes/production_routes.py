"""
Phase 13.0 — Vault Movement Module (Track A starter).

Batch ID generation + registry, vault transaction logbook, vault ledger,
GACP readiness probe, and the staged-queue sync. Replaces the paper/Excel
"Vault Transaction Logbook" (Patricia) with portal-enforced batch IDs and
real Odoo stock movements.

Odoo writes go exclusively through services/vault_odoo.py (VaultOdooWriter).
While GACP_ODOO_WRITES=off, every write is recorded with its exact intended
Odoo operation list and stamped odoo_sync="staged" — a temporary outbox that
the sync endpoint flushes once GACP access is confirmed.

MongoDB collections (portal layer only — stock truth lives in Odoo once live):
  product_shortcodes  {name, code, created_at, created_by}
  batch_registry     {batch_id, family, product_code, product_name, sequence,
                      date_code, stage_suffix, base_batch_id, parent_batch_id,
                      origin, ops, odoo_sync, odoo_lot_id, odoo_error, ...}
  vault_movements    {type, batch_id, product_name, qty_g, source, outputs,
                      waste_g, notes, ops, odoo_sync, odoo_error, ...}
"""
import json
import os
from datetime import datetime, timezone
from typing import Optional

from bson import ObjectId
from fastapi import APIRouter, BackgroundTasks, Depends, HTTPException, Query
from pydantic import BaseModel

from auth import require_permission, require_any_permission, require_super_admin
from database import col
from middleware.audit import audit_log
from routes.settings_routes import get_email_routing
from services.email_service import send_s6_flag_notification
from odoo_client import get_odoo_client
from config import get_settings
from services.batch_id import (
    FAMILIES, FAMILY_LABELS, STAGE_SUFFIXES, IMPORT_TYPES, IMPORT_SUBCATS,
    build_batch_id, build_import_batch_id, derive_stage_id, format_date_code, split_stage,
)
from services.vault_odoo import (
    get_vault_writer, LOC_VAULT, LOC_MANICURING, LOC_PACKING, LOC_PRODUCTION,
)

router = APIRouter(prefix="/api/production", tags=["production"])

PROD_READ = require_any_permission("production.batch_generate", "production.vault", "production.manage")

MOVEMENT_TYPES = {"receive", "issue_packing", "issue_manicuring", "return_manicuring"}
RECEIVE_SOURCES = {"production", "external_supplier", "opening_balance"}


# ── Pydantic bodies ───────────────────────────────────────────────────────────

class ProductAdd(BaseModel):
    name: str
    code: str


class ProductLink(BaseModel):
    odoo_product_id: int
    odoo_product_name: str


class BatchCreate(BaseModel):
    family: str                       # single | api | blend | gummy | import
    product_code: str
    date_code: Optional[str] = None   # DDMMYY; defaults to today
    # import family only:
    supplier_code: Optional[str] = None
    type_digit: Optional[int] = None  # 1-9, see IMPORT_TYPES
    subcat: Optional[str] = None      # L | P | S


class SupplierAdd(BaseModel):
    name: str
    code: str


class SupplierLink(BaseModel):
    odoo_partner_id: int
    odoo_partner_name: str


class ImportReceipt(BaseModel):
    """One S6 register row = one action: BI batch + vault receive + register entry.
    Every receipt must either link an existing Odoo purchase order or explicitly
    flag that none exists (which holds the batch for investigation)."""
    supplier_code: str
    product_code: str
    type_digit: int
    subcat: Optional[str] = None
    date_code: Optional[str] = None       # date received, DDMMYY; defaults today
    qty_quoted: Optional[float] = None    # grams or units as quoted by the supplier
    qty_received: float                   # grams (or units) actually received
    po_id: Optional[int] = None           # linked Odoo purchase.order id
    po_name: Optional[str] = None
    po_flag: bool = False                 # True = no PO found, flag for investigation
    doc_invoice: bool = False
    doc_coa: bool = False
    doc_delivery_note: bool = False
    doc_s6_transfer: bool = False
    comment: Optional[str] = None


class ReleaseNote(BaseModel):
    note: Optional[str] = None
    # resolve-flag only: the PO raised in Odoo during the investigation
    po_id: Optional[int] = None
    po_name: Optional[str] = None


class MovementCreate(BaseModel):
    type: str                         # receive | issue_packing | issue_manicuring | return_manicuring
    batch_id: str                     # for return_manicuring: the parent (issued) batch
    qty_g: Optional[float] = None     # receive / issue types
    source: Optional[str] = None      # receive only: production | external_supplier | opening_balance
    m_qty_g: Optional[float] = None   # return_manicuring: manicured output
    t_qty_g: Optional[float] = None   # return_manicuring: trim output
    notes: Optional[str] = None


# ── Helpers ───────────────────────────────────────────────────────────────────

def _now():
    return datetime.now(timezone.utc)


def _clean(doc: dict) -> dict:
    doc["id"] = str(doc.pop("_id"))
    return doc


async def _seed_products_if_empty():
    if await col("product_shortcodes").count_documents({}) > 0:
        return
    path = os.path.join(os.path.dirname(os.path.dirname(__file__)), "data", "product_shortcodes.json")
    try:
        with open(path, encoding="utf-8") as f:
            items = json.load(f)
    except Exception:
        return
    now = _now()
    if items:
        await col("product_shortcodes").insert_many([
            {"name": i["name"], "code": i["code"], "created_at": now, "created_by": "seed"}
            for i in items
        ])


async def _seed_imports_if_empty():
    """Seed the import suppliers (13 from the S6 Look Up Table) and apply the
    per-product import ref numbers (01-59) onto the product master list —
    inserting lookup products that are not in the V6 shortcode list yet."""
    data_dir = os.path.join(os.path.dirname(os.path.dirname(__file__)), "data")
    now = _now()
    if await col("import_suppliers").count_documents({}) == 0:
        try:
            with open(os.path.join(data_dir, "import_suppliers.json"), encoding="utf-8") as f:
                suppliers = json.load(f)
            if suppliers:
                await col("import_suppliers").insert_many([
                    {"name": s["name"], "code": s["code"], "active": True,
                     "created_at": now, "created_by": "seed"}
                    for s in suppliers
                ])
        except Exception:
            pass
    # Import refs are idempotent: only set where missing.
    if await col("product_shortcodes").count_documents({"import_ref": {"$exists": True}}) == 0:
        try:
            with open(os.path.join(data_dir, "import_product_refs.json"), encoding="utf-8") as f:
                refs = json.load(f)
            for r in refs:
                existing = await col("product_shortcodes").find_one({"code": r["code"]})
                if existing:
                    if not existing.get("import_ref"):
                        await col("product_shortcodes").update_one(
                            {"code": r["code"]}, {"$set": {"import_ref": r["import_ref"]}})
                else:
                    await col("product_shortcodes").insert_one({
                        "name": r["name"], "code": r["code"], "active": True,
                        "import_ref": r["import_ref"], "created_at": now, "created_by": "seed_s6",
                    })
        except Exception:
            pass


async def _next_import_ref() -> int:
    """Next free 2-digit import reference — assigned once per product, forever."""
    latest = await col("product_shortcodes").find_one(
        {"import_ref": {"$gt": 0}}, sort=[("import_ref", -1)])
    return (latest["import_ref"] + 1) if latest else 1


async def _resolve_import_parts(supplier_code: str, product_code: str) -> tuple[dict, dict, int]:
    """Supplier doc, product doc, and the product's import ref (assigning the
    next free number on first import). Raises HTTPException on unknowns."""
    sup = await col("import_suppliers").find_one({"code": supplier_code.strip().upper()})
    if not sup:
        raise HTTPException(status_code=422, detail=f"Supplier shortcode {supplier_code} is not in the supplier list")
    if sup.get("active", True) is False:
        raise HTTPException(status_code=422, detail=f"{sup['name']} ({sup['code']}) is archived")
    prod = await col("product_shortcodes").find_one({"code": product_code.strip().upper()})
    if not prod:
        raise HTTPException(status_code=422, detail=f"Shortcode {product_code} is not in the product master list")
    if prod.get("active", True) is False:
        raise HTTPException(status_code=422, detail=f"{prod['name']} ({prod['code']}) is archived")
    ref = prod.get("import_ref")
    if not ref:
        ref = await _next_import_ref()
        await col("product_shortcodes").update_one({"code": prod["code"]}, {"$set": {"import_ref": ref}})
        prod["import_ref"] = ref
    return sup, prod, ref


async def _refresh_product_pins(ops: list[dict]) -> list[dict]:
    """Re-resolve product_id on every op (and manufacture_split outputs) from
    the CURRENT product link (13.0.8), not whatever was baked in at creation
    time. This is what lets an op staged before a product was linked still
    execute against the right Odoo record once it is — called immediately
    before every writer.execute_ops() call, live or via sync-staged."""
    codes = set()
    for op in ops:
        if op.get("product_code"):
            codes.add(op["product_code"])
        for out in op.get("outputs") or []:
            if out.get("product_code"):
                codes.add(out["product_code"])
        if op.get("input_product_code"):
            codes.add(op["input_product_code"])
    if not codes:
        return ops
    docs = await col("product_shortcodes").find({"code": {"$in": list(codes)}}).to_list(len(codes))
    pins = {d["code"]: d.get("odoo_product_id") for d in docs}
    for op in ops:
        if op.get("product_code") and pins.get(op["product_code"]):
            op["product_id"] = pins[op["product_code"]]
        for out in op.get("outputs") or []:
            if out.get("product_code") and pins.get(out["product_code"]):
                out["product_id"] = pins[out["product_code"]]
        if op.get("input_product_code") and pins.get(op["input_product_code"]):
            op["input_product_id"] = pins[op["input_product_code"]]
    return ops


async def _next_sequence(family: str, product_code: str) -> int:
    latest = await col("batch_registry").find_one(
        {"family": family, "product_code": product_code, "origin": "generated"},
        sort=[("sequence", -1)],
    )
    return (latest["sequence"] + 1) if latest else 1


async def _get_batch_or_404(batch_id: str) -> dict:
    doc = await col("batch_registry").find_one({"batch_id": batch_id})
    if not doc:
        raise HTTPException(status_code=404, detail=f"Batch {batch_id} is not in the registry")
    return doc


async def _register_derived(parent: dict, suffix: str, current_user: dict) -> dict:
    """Create (or return) the derived-stage registry entry for a parent batch."""
    child_id = derive_stage_id(parent["batch_id"], suffix)
    existing = await col("batch_registry").find_one({"batch_id": child_id})
    if existing:
        return existing
    doc = {
        "batch_id":        child_id,
        "family":          parent["family"],
        "product_code":     parent["product_code"],
        "product_name":     parent["product_name"],
        "sequence":        parent["sequence"],
        "date_code":       parent["date_code"],
        "stage_suffix":    suffix,
        "base_batch_id":   parent["base_batch_id"],
        "parent_batch_id": parent["batch_id"],
        "origin":          "derived",
        "ops":             [get_vault_writer().op_ensure_lot(child_id, parent["product_name"],
                                                            product_code=parent["product_code"])],
        "odoo_sync":       "staged",
        "odoo_lot_id":     None,
        "odoo_error":      None,
        "created_by":      current_user.get("id"),
        "created_by_name": current_user.get("name") or current_user.get("username"),
        "created_at":      _now(),
    }
    await col("batch_registry").insert_one(dict(doc))
    return doc


# ── Product shortcodes ─────────────────────────────────────────────────────────

@router.get("/products")
async def list_products(
    include_archived: bool = Query(False),
    _: dict = Depends(PROD_READ),
):
    """Active products by default (what the batch generator picker shows).
    include_archived=true adds archived ones — used by the manage-products UI.
    Archived products stay resolvable for historical batches; they are only
    hidden from new-batch selection."""
    await _seed_products_if_empty()
    filt = {} if include_archived else {"active": {"$ne": False}}
    docs = await col("product_shortcodes").find(filt).sort("name", 1).to_list(500)
    out = []
    for d in docs:
        d = _clean(d)
        d["active"] = d.get("active", True) is not False
        out.append(d)
    return {"products": out}


@router.post("/products")
async def add_product(body: ProductAdd, current_user: dict = Depends(require_permission("production.manage"))):
    name, code = body.name.strip(), body.code.strip().upper()
    if not name or not code.isalnum() or not (2 <= len(code) <= 4):
        raise HTTPException(status_code=422, detail="Shortcode must be 2-4 letters/digits and the name must not be empty")
    if await col("product_shortcodes").find_one({"code": code}):
        raise HTTPException(status_code=409, detail=f"Shortcode {code} is already in use")
    await col("product_shortcodes").insert_one({
        "name": name, "code": code, "active": True, "created_at": _now(),
        "created_by": current_user.get("username"),
    })
    await audit_log("production.product_added", "product_shortcode", code,
                    entity_label=f"{name} ({code})", user=current_user)
    return {"success": True, "code": code}


@router.post("/products/{code}/archive")
async def archive_product(code: str, current_user: dict = Depends(require_permission("production.manage"))):
    """Hide a product from the batch generator picker. Existing batches keep
    resolving it; this only stops new batches being created for it."""
    code = code.strip().upper()
    doc = await col("product_shortcodes").find_one({"code": code})
    if not doc:
        raise HTTPException(status_code=404, detail=f"Shortcode {code} not found")
    await col("product_shortcodes").update_one({"code": code}, {"$set": {"active": False}})
    await audit_log("production.product_archived", "product_shortcode", code,
                    entity_label=f"{doc['name']} ({code})", user=current_user)
    return {"success": True, "code": code}


@router.post("/products/{code}/restore")
async def restore_product(code: str, current_user: dict = Depends(require_permission("production.manage"))):
    code = code.strip().upper()
    doc = await col("product_shortcodes").find_one({"code": code})
    if not doc:
        raise HTTPException(status_code=404, detail=f"Shortcode {code} not found")
    await col("product_shortcodes").update_one({"code": code}, {"$set": {"active": True}})
    await audit_log("production.product_restored", "product_shortcode", code,
                    entity_label=f"{doc['name']} ({code})", user=current_user)
    return {"success": True, "code": code}


@router.delete("/products/{code}")
async def delete_product(code: str, current_user: dict = Depends(require_permission("production.manage"))):
    """Permanent removal — only allowed when no batch has ever used the code.
    Once a batch ID embeds the shortcode, the traceability chain needs it to
    stay resolvable, so used products can only be archived."""
    code = code.strip().upper()
    doc = await col("product_shortcodes").find_one({"code": code})
    if not doc:
        raise HTTPException(status_code=404, detail=f"Shortcode {code} not found")
    used = await col("batch_registry").count_documents({"product_code": code})
    if used > 0:
        raise HTTPException(
            status_code=409,
            detail=f"{doc['name']} ({code}) is used by {used} batch{'es' if used != 1 else ''} and cannot be deleted. Archive it instead to hide it from the picker.",
        )
    await col("product_shortcodes").delete_one({"code": code})
    await audit_log("production.product_deleted", "product_shortcode", code,
                    entity_label=f"{doc['name']} ({code})", user=current_user)
    return {"success": True, "code": code}


@router.get("/odoo-products")
async def search_odoo_products(
    q: str = Query(..., min_length=2),
    _: dict = Depends(require_permission("production.manage")),
):
    """Search Odoo product.product records for the product-link picker.
    Read-only. The portal never creates products — it only ever links to
    products that already exist in Odoo (created there, same rule as
    suppliers/purchase orders)."""
    try:
        odoo = get_odoo_client()
        rows = odoo.search_read(
            "product.product",
            domain=[("name", "ilike", q)],
            fields=["id", "name", "default_code"], limit=15, order="name asc",
        )
        for r in rows:
            for k, v in r.items():
                if v is False:
                    r[k] = None
        return {"products": rows}
    except Exception as e:
        raise HTTPException(status_code=502, detail=f"Could not search stock system products: {e}")


@router.post("/products/{code}/link")
async def link_product(
    code: str,
    body: ProductLink,
    current_user: dict = Depends(require_permission("production.manage")),
):
    """Pin this portal product to its Odoo product.product record. Every
    writer op for this product then carries the pinned id deterministically —
    never a name match (which is only ever a read-time fallback used until a
    link exists, or for ops staged before one did)."""
    code = code.strip().upper()
    doc = await col("product_shortcodes").find_one({"code": code})
    if not doc:
        raise HTTPException(status_code=404, detail=f"Shortcode {code} not found")
    await col("product_shortcodes").update_one({"code": code}, {"$set": {
        "odoo_product_id":   body.odoo_product_id,
        "odoo_product_name": body.odoo_product_name,
    }})
    await audit_log("production.product_linked", "product_shortcode", code,
                    entity_label=f"{doc['name']} ({code})", user=current_user,
                    detail={"odoo_product_id": body.odoo_product_id,
                            "odoo_product_name": body.odoo_product_name})
    return {"success": True}


@router.post("/products/{code}/unlink")
async def unlink_product(
    code: str,
    current_user: dict = Depends(require_permission("production.manage")),
):
    code = code.strip().upper()
    doc = await col("product_shortcodes").find_one({"code": code})
    if not doc:
        raise HTTPException(status_code=404, detail=f"Shortcode {code} not found")
    await col("product_shortcodes").update_one({"code": code}, {"$unset": {
        "odoo_product_id": "", "odoo_product_name": "",
    }})
    await audit_log("production.product_unlinked", "product_shortcode", code,
                    entity_label=f"{doc['name']} ({code})", user=current_user,
                    detail={"was_linked_to": doc.get("odoo_product_name")})
    return {"success": True}


# ── Batch registry + generator ────────────────────────────────────────────────

@router.get("/meta")
async def production_meta(_: dict = Depends(PROD_READ)):
    """Static vocabulary for the frontend: families, stage suffixes, import
    types/sub-categories, writer mode."""
    return {
        "families": [{"key": k, "prefix": v, "label": FAMILY_LABELS[k]} for k, v in FAMILIES.items()],
        "stage_suffixes": [{"suffix": s, "label": l} for s, l in STAGE_SUFFIXES.items()],
        "import_types": [{"digit": d, "label": l} for d, l in IMPORT_TYPES.items()],
        "import_subcats": [{"char": c, "label": l} for c, l in IMPORT_SUBCATS.items()],
        "odoo_writes_live": get_vault_writer().live,
    }


# ── Import suppliers (S6) ─────────────────────────────────────────────────────

@router.get("/suppliers")
async def list_import_suppliers(
    include_archived: bool = Query(False),
    _: dict = Depends(PROD_READ),
):
    await _seed_imports_if_empty()
    filt = {} if include_archived else {"active": {"$ne": False}}
    docs = await col("import_suppliers").find(filt).sort("name", 1).to_list(100)
    out = []
    for d in docs:
        d = _clean(d)
        d["active"] = d.get("active", True) is not False
        out.append(d)
    return {"suppliers": out}


@router.post("/suppliers")
async def add_import_supplier(body: SupplierAdd, current_user: dict = Depends(require_permission("production.manage"))):
    name, code = body.name.strip(), body.code.strip().upper()
    if not name or not code.isalpha() or len(code) != 2:
        raise HTTPException(status_code=422, detail="Supplier shortcode must be exactly 2 letters and the name must not be empty")
    if await col("import_suppliers").find_one({"code": code}):
        raise HTTPException(status_code=409, detail=f"Supplier shortcode {code} is already in use")
    await col("import_suppliers").insert_one({
        "name": name, "code": code, "active": True, "created_at": _now(),
        "created_by": current_user.get("username"),
    })
    await audit_log("production.supplier_added", "import_supplier", code,
                    entity_label=f"{name} ({code})", user=current_user)
    return {"success": True, "code": code}


@router.post("/suppliers/{code}/archive")
async def archive_import_supplier(code: str, current_user: dict = Depends(require_permission("production.manage"))):
    code = code.strip().upper()
    doc = await col("import_suppliers").find_one({"code": code})
    if not doc:
        raise HTTPException(status_code=404, detail=f"Supplier {code} not found")
    await col("import_suppliers").update_one({"code": code}, {"$set": {"active": False}})
    await audit_log("production.supplier_archived", "import_supplier", code,
                    entity_label=f"{doc['name']} ({code})", user=current_user)
    return {"success": True}


@router.post("/suppliers/{code}/restore")
async def restore_import_supplier(code: str, current_user: dict = Depends(require_permission("production.manage"))):
    code = code.strip().upper()
    doc = await col("import_suppliers").find_one({"code": code})
    if not doc:
        raise HTTPException(status_code=404, detail=f"Supplier {code} not found")
    await col("import_suppliers").update_one({"code": code}, {"$set": {"active": True}})
    await audit_log("production.supplier_restored", "import_supplier", code,
                    entity_label=f"{doc['name']} ({code})", user=current_user)
    return {"success": True}


@router.get("/odoo-vendors")
async def search_odoo_vendors(
    q: str = Query(..., min_length=2),
    _: dict = Depends(require_permission("production.manage")),
):
    """Search Odoo vendor accounts (supplier_rank > 0) for the supplier-link
    picker. Read-only."""
    try:
        odoo = get_odoo_client()
        rows = odoo.search_read(
            "res.partner",
            domain=[("supplier_rank", ">", 0), ("name", "ilike", q)],
            fields=["id", "name", "city", "email"], limit=15, order="name asc",
        )
        for r in rows:
            for k, v in r.items():
                if v is False:
                    r[k] = None
        return {"vendors": rows}
    except Exception as e:
        raise HTTPException(status_code=502, detail=f"Could not search supplier accounts: {e}")


@router.post("/suppliers/{code}/link")
async def link_import_supplier(
    code: str,
    body: SupplierLink,
    current_user: dict = Depends(require_permission("production.manage")),
):
    """Pin this portal supplier to its Odoo vendor account. All PO lookups and
    goods receipts for the supplier then use this ID deterministically —
    never a name match (which is only ever a read-time fallback)."""
    code = code.strip().upper()
    doc = await col("import_suppliers").find_one({"code": code})
    if not doc:
        raise HTTPException(status_code=404, detail=f"Supplier {code} not found")
    await col("import_suppliers").update_one({"code": code}, {"$set": {
        "odoo_partner_id":   body.odoo_partner_id,
        "odoo_partner_name": body.odoo_partner_name,
    }})
    await audit_log("production.supplier_linked", "import_supplier", code,
                    entity_label=f"{doc['name']} ({code})", user=current_user,
                    detail={"odoo_partner_id": body.odoo_partner_id,
                            "odoo_partner_name": body.odoo_partner_name})
    return {"success": True}


@router.post("/suppliers/{code}/unlink")
async def unlink_import_supplier(
    code: str,
    current_user: dict = Depends(require_permission("production.manage")),
):
    code = code.strip().upper()
    doc = await col("import_suppliers").find_one({"code": code})
    if not doc:
        raise HTTPException(status_code=404, detail=f"Supplier {code} not found")
    await col("import_suppliers").update_one({"code": code}, {"$unset": {
        "odoo_partner_id": "", "odoo_partner_name": "",
    }})
    await audit_log("production.supplier_unlinked", "import_supplier", code,
                    entity_label=f"{doc['name']} ({code})", user=current_user,
                    detail={"was_linked_to": doc.get("odoo_partner_name")})
    return {"success": True}


@router.get("/batches/preview")
async def preview_batch_id(
    family: str = Query(...),
    product_code: str = Query(...),
    supplier_code: Optional[str] = Query(None),
    type_digit: Optional[int] = Query(None),
    subcat: Optional[str] = Query(None),
    _: dict = Depends(PROD_READ),
):
    if family == "import":
        if not supplier_code or not type_digit:
            raise HTTPException(status_code=422, detail="Supplier and stock type are required for an import batch")
        _sup, _prod, ref = await _resolve_import_parts(supplier_code, product_code)
        try:
            batch_id = build_import_batch_id(supplier_code, product_code, type_digit, ref, subcat, format_date_code())
        except ValueError as e:
            raise HTTPException(status_code=422, detail=str(e))
        return {"batch_id": batch_id, "import_ref": ref, "date_code": format_date_code()}
    if family not in FAMILIES:
        raise HTTPException(status_code=422, detail="Unknown batch family")
    seq = await _next_sequence(family, product_code.strip().upper())
    try:
        batch_id = build_batch_id(family, product_code, seq, format_date_code())
    except ValueError as e:
        raise HTTPException(status_code=422, detail=str(e))
    return {"batch_id": batch_id, "sequence": seq, "date_code": format_date_code()}


async def _create_import_batch(body: BatchCreate, current_user: dict) -> dict:
    """Registry entry for a BI (imported) batch. Shared by the generator and
    the one-shot S6 receive flow. Returns the stored doc (without _id)."""
    if not body.supplier_code or not body.type_digit:
        raise HTTPException(status_code=422, detail="Supplier and stock type are required for an import batch")
    sup, prod, ref = await _resolve_import_parts(body.supplier_code, body.product_code)
    date_code = body.date_code or format_date_code()
    try:
        batch_id = build_import_batch_id(sup["code"], prod["code"], body.type_digit, ref, body.subcat, date_code)
    except ValueError as e:
        raise HTTPException(status_code=422, detail=str(e))
    existing = await col("batch_registry").find_one({"batch_id": batch_id})
    if existing:
        raise HTTPException(status_code=409, detail=f"Batch {batch_id} already exists (same supplier, product, type and date)")

    writer = get_vault_writer()
    ops = [writer.op_ensure_lot(batch_id, prod["name"], product_code=prod["code"],
                                product_id=prod.get("odoo_product_id"))]
    doc = {
        "batch_id":        batch_id,
        "family":          "import",
        "product_code":    prod["code"],
        "product_name":    prod["name"],
        "sequence":        None,
        "date_code":       date_code,
        "stage_suffix":    None,
        "base_batch_id":   batch_id,
        "parent_batch_id": None,
        "origin":          "generated",
        "supplier_code":   sup["code"],
        "supplier_name":   sup["name"],
        "type_digit":      body.type_digit,
        "type_label":      IMPORT_TYPES[body.type_digit],
        "subcat":          (body.subcat or "").strip().upper() or None,
        "import_ref":      ref,
        "ops":             ops,
        "odoo_sync":       "staged",
        "odoo_lot_id":     None,
        "odoo_error":      None,
        "created_by":      current_user.get("id"),
        "created_by_name": current_user.get("name") or current_user.get("username"),
        "created_at":      _now(),
    }
    if writer.live:
        try:
            await _refresh_product_pins(ops)
            results = writer.execute_ops(ops)
            doc["odoo_sync"] = "done"
            doc["odoo_lot_id"] = results[0].get("lot_id")
        except Exception as e:
            doc["odoo_sync"] = "error"
            doc["odoo_error"] = str(e)
    await col("batch_registry").insert_one(dict(doc))
    await audit_log("production.batch_generated", "batch", batch_id,
                    entity_label=batch_id, user=current_user,
                    detail={"family": "import", "product": prod["name"],
                            "supplier": sup["name"], "import_ref": ref})
    doc.pop("_id", None)
    return doc


@router.post("/batches")
async def create_batch(
    body: BatchCreate,
    current_user: dict = Depends(require_permission("production.batch_generate")),
):
    if body.family == "import":
        doc = await _create_import_batch(body, current_user)
        return {"success": True, "batch": doc}
    if body.family not in FAMILIES:
        raise HTTPException(status_code=422, detail="Unknown batch family")
    code = body.product_code.strip().upper()
    product = await col("product_shortcodes").find_one({"code": code})
    if not product:
        raise HTTPException(status_code=422, detail=f"Shortcode {code} is not in the product master list")
    if product.get("active", True) is False:
        raise HTTPException(status_code=422, detail=f"{product['name']} ({code}) is archived. Restore it in Manage Products to create new batches for it.")
    date_code = body.date_code or format_date_code()
    seq = await _next_sequence(body.family, code)
    try:
        batch_id = build_batch_id(body.family, code, seq, date_code)
    except ValueError as e:
        raise HTTPException(status_code=422, detail=str(e))
    if await col("batch_registry").find_one({"batch_id": batch_id}):
        raise HTTPException(status_code=409, detail=f"Batch {batch_id} already exists")

    writer = get_vault_writer()
    ops = [writer.op_ensure_lot(batch_id, product["name"], product_code=code,
                                product_id=product.get("odoo_product_id"))]
    doc = {
        "batch_id":        batch_id,
        "family":          body.family,
        "product_code":     code,
        "product_name":     product["name"],
        "sequence":        seq,
        "date_code":       date_code,
        "stage_suffix":    None,
        "base_batch_id":   batch_id,
        "parent_batch_id": None,
        "origin":          "generated",
        "ops":             ops,
        "odoo_sync":       "staged",
        "odoo_lot_id":     None,
        "odoo_error":      None,
        "created_by":      current_user.get("id"),
        "created_by_name": current_user.get("name") or current_user.get("username"),
        "created_at":      _now(),
    }
    if writer.live:
        try:
            await _refresh_product_pins(ops)
            results = writer.execute_ops(ops)
            doc["odoo_sync"] = "done"
            doc["odoo_lot_id"] = results[0].get("lot_id")
        except Exception as e:
            doc["odoo_sync"] = "error"
            doc["odoo_error"] = str(e)
    await col("batch_registry").insert_one(dict(doc))
    await audit_log("production.batch_generated", "batch", batch_id,
                    entity_label=batch_id, user=current_user,
                    detail={"family": body.family, "product": product["name"], "sequence": seq})
    doc.pop("_id", None)
    return {"success": True, "batch": doc}


@router.get("/batches")
async def list_batches(
    q: Optional[str] = Query(None),
    family: Optional[str] = Query(None),
    skip: int = Query(0, ge=0),
    limit: int = Query(100, le=500),
    _: dict = Depends(PROD_READ),
):
    filt: dict = {}
    if q:
        filt["$or"] = [
            {"batch_id":    {"$regex": q, "$options": "i"}},
            {"product_name": {"$regex": q, "$options": "i"}},
        ]
    if family in FAMILIES:
        filt["family"] = family
    total = await col("batch_registry").count_documents(filt)
    docs = await col("batch_registry").find(filt).sort("created_at", -1).skip(skip).limit(limit).to_list(limit)
    return {"items": [_clean(d) for d in docs], "total": total}


@router.get("/batches/{batch_id}/timeline")
async def batch_timeline(batch_id: str, _: dict = Depends(PROD_READ)):
    """Everything known about one batch: registry entry, derived stages, and
    every vault movement that touched it — the traceability drill-down."""
    doc = await _get_batch_or_404(batch_id)
    base_id = doc.get("base_batch_id") or split_stage(batch_id)[0]
    related = await col("batch_registry").find({"base_batch_id": base_id}).sort("created_at", 1).to_list(50)
    related_ids = [r["batch_id"] for r in related]
    movements = await col("vault_movements").find({
        "$or": [
            {"batch_id": {"$in": related_ids}},
            {"outputs.batch_id": {"$in": related_ids}},
        ]
    }).sort("created_at", 1).to_list(500)
    return {
        "batch":     _clean(dict(doc)),
        "stages":    [_clean(dict(r)) for r in related],
        "movements": [_clean(m) for m in movements],
    }


# ── Vault movements ───────────────────────────────────────────────────────────

@router.post("/vault/movements")
async def create_movement(
    body: MovementCreate,
    current_user: dict = Depends(require_permission("production.vault")),
):
    if body.type not in MOVEMENT_TYPES:
        raise HTTPException(status_code=422, detail="Unknown movement type")
    batch = await _get_batch_or_404(body.batch_id.strip())

    # Schedule 6 quarantine gate: imported stock cannot leave the vault until
    # the Responsible Pharmacist has released its receipt.
    if body.type != "receive" and batch.get("family") == "import":
        receipt = await col("s6_receipts").find_one(
            {"batch_id": batch.get("base_batch_id") or batch["batch_id"]},
            sort=[("created_at", -1)],
        )
        if receipt and receipt.get("status") != "released":
            raise HTTPException(
                status_code=409,
                detail=f"Batch {batch['batch_id']} is awaiting Responsible Pharmacist release and cannot be issued yet.",
            )

    writer = get_vault_writer()
    product_name = batch["product_name"]
    product_code = batch["product_code"]
    # Current link (13.0.8) — batch_registry only stores the name/code, not a
    # live pin, so fetch the product doc fresh for the Odoo product id.
    product_doc = await col("product_shortcodes").find_one({"code": product_code}) or {}
    product_id = product_doc.get("odoo_product_id")
    now = _now()

    doc = {
        "type":         body.type,
        "batch_id":     batch["batch_id"],
        "product_name":  product_name,
        "qty_g":        None,
        "source":       None,
        "outputs":      [],
        "waste_g":      None,
        "notes":        (body.notes or "").strip() or None,
        "ops":          [],
        "odoo_sync":    "staged",
        "odoo_error":   None,
        "odoo_result":  None,
        "warehouse_id": writer.warehouse_id or None,
        "actor_id":     current_user.get("id"),
        "actor_name":   current_user.get("name") or current_user.get("username"),
        "created_at":   now,
    }

    if body.type in ("receive", "issue_packing", "issue_manicuring"):
        if not body.qty_g or body.qty_g <= 0:
            raise HTTPException(status_code=422, detail="Quantity (grams) must be greater than zero")
        doc["qty_g"] = round(float(body.qty_g), 3)
        if body.type == "receive":
            source = body.source or "production"
            if source not in RECEIVE_SOURCES:
                raise HTTPException(status_code=422, detail="Unknown receive source")
            doc["source"] = source
            doc["ops"] = [
                writer.op_ensure_lot(batch["batch_id"], product_name,
                                     product_code=product_code, product_id=product_id),
                writer.op_internal_transfer(batch["batch_id"], doc["qty_g"],
                                            LOC_PRODUCTION, LOC_VAULT, product_name,
                                            product_code=product_code, product_id=product_id),
            ]
        else:
            dest = LOC_PACKING if body.type == "issue_packing" else LOC_MANICURING
            doc["ops"] = [
                writer.op_internal_transfer(batch["batch_id"], doc["qty_g"],
                                            LOC_VAULT, dest, product_name,
                                            product_code=product_code, product_id=product_id),
            ]

    else:  # return_manicuring
        m_qty = round(float(body.m_qty_g or 0), 3)
        t_qty = round(float(body.t_qty_g or 0), 3)
        if m_qty < 0 or t_qty < 0 or (m_qty + t_qty) <= 0:
            raise HTTPException(status_code=422, detail="Enter the manicured and trim weights received back (grams)")
        m_batch = await _register_derived(batch, "M", current_user)
        t_batch = None
        outputs = [{"batch_id": m_batch["batch_id"], "qty_g": m_qty, "kind": "M"}]
        if t_qty > 0:
            t_batch = await _register_derived(batch, "T", current_user)
            outputs.append({"batch_id": t_batch["batch_id"], "qty_g": t_qty, "kind": "T"})
        doc["outputs"] = outputs

        # Waste = what was issued to manicuring minus what came back, when the
        # issue was recorded through the portal. Left null otherwise.
        issued = await col("vault_movements").aggregate([
            {"$match": {"type": "issue_manicuring", "batch_id": batch["batch_id"]}},
            {"$group": {"_id": None, "total": {"$sum": "$qty_g"}}},
        ]).to_list(1)
        if issued and issued[0]["total"]:
            doc["waste_g"] = max(round(issued[0]["total"] - m_qty - t_qty, 3), 0)

        op_outputs = [
            {"lot_name": o["batch_id"], "qty_g": o["qty_g"], "product_hint": product_name,
             "product_code": product_code, "product_id": product_id}
            for o in outputs
        ]
        split = writer.op_manufacture_split(batch["batch_id"],
                                            (doc["waste_g"] or 0) + m_qty + t_qty,
                                            op_outputs, doc["waste_g"] or 0,
                                            input_product_code=product_code,
                                            input_product_id=product_id)
        split["input_hint"] = product_name
        doc["ops"] = [split]

    if writer.live:
        try:
            await _refresh_product_pins(doc["ops"])
            doc["odoo_result"] = writer.execute_ops(doc["ops"])
            doc["odoo_sync"] = "done"
        except Exception as e:
            doc["odoo_sync"] = "error"
            doc["odoo_error"] = str(e)

    await col("vault_movements").insert_one(dict(doc))
    await audit_log("production.vault_movement", "vault_movement", batch["batch_id"],
                    entity_label=f"{body.type} {batch['batch_id']}", user=current_user,
                    detail={"type": body.type, "qty_g": doc["qty_g"],
                            "outputs": doc["outputs"], "odoo_sync": doc["odoo_sync"]})
    doc.pop("_id", None)
    return {"success": True, "movement": doc}


@router.get("/vault/movements")
async def list_movements(
    q: Optional[str] = Query(None),
    type: Optional[str] = Query(None),
    skip: int = Query(0, ge=0),
    limit: int = Query(100, le=500),
    _: dict = Depends(PROD_READ),
):
    filt: dict = {}
    if q:
        filt["$or"] = [
            {"batch_id":    {"$regex": q, "$options": "i"}},
            {"product_name": {"$regex": q, "$options": "i"}},
        ]
    if type in MOVEMENT_TYPES:
        filt["type"] = type
    total = await col("vault_movements").count_documents(filt)
    docs = await col("vault_movements").find(filt).sort("created_at", -1).skip(skip).limit(limit).to_list(limit)
    return {"items": [_clean(d) for d in docs], "total": total}


@router.get("/vault/ledger")
async def vault_ledger(_: dict = Depends(PROD_READ)):
    """Current vault holdings per batch, computed from the movement log.

    While GACP_ODOO_WRITES=off this is the staged view (badged "pending sync"
    in the UI). Once live and flushed, Odoo stock.quant at the Vault location
    is the authoritative figure — this computed view remains as the running
    balance Patricia's Excel never had."""
    movements = await col("vault_movements").find({}).sort("created_at", 1).to_list(5000)
    balances: dict[str, dict] = {}
    # Weight currently out at the manicuring room per batch (issued minus what
    # came back as outputs + waste) — drives the guided next-step logic in the UI.
    manicuring_out: dict[str, float] = {}

    def bump(batch_id: str, delta: float, when):
        b = balances.setdefault(batch_id, {"batch_id": batch_id, "qty_g": 0.0,
                                           "movements": 0, "last_movement_at": None})
        b["qty_g"] = round(b["qty_g"] + delta, 3)
        b["movements"] += 1
        b["last_movement_at"] = when

    for m in movements:
        when = m.get("created_at")
        if m["type"] == "receive":
            bump(m["batch_id"], m.get("qty_g") or 0, when)
        elif m["type"] in ("issue_packing", "issue_manicuring"):
            bump(m["batch_id"], -(m.get("qty_g") or 0), when)
            if m["type"] == "issue_manicuring":
                manicuring_out[m["batch_id"]] = manicuring_out.get(m["batch_id"], 0) + (m.get("qty_g") or 0)
        elif m["type"] == "return_manicuring":
            back = (m.get("waste_g") or 0)
            for out in m.get("outputs") or []:
                bump(out["batch_id"], out.get("qty_g") or 0, when)
                back += out.get("qty_g") or 0
            manicuring_out[m["batch_id"]] = manicuring_out.get(m["batch_id"], 0) - back

    ids = list(balances.keys())
    reg = await col("batch_registry").find({"batch_id": {"$in": ids}}).to_list(len(ids) or 1)
    names = {r["batch_id"]: r.get("product_name") for r in reg}
    rows = sorted(balances.values(), key=lambda b: -abs(b["qty_g"]))
    for r in rows:
        r["product_name"] = names.get(r["batch_id"], "")
    staged = await col("vault_movements").count_documents({"odoo_sync": "staged"})
    # Imported base batch IDs still awaiting RP release — the UI greys out
    # issue movements for these (server-side gate in create_movement).
    unreleased = await col("s6_receipts").find(
        {"status": {"$ne": "released"}}, {"_id": 0, "batch_id": 1}
    ).to_list(500)
    return {"rows": rows, "staged_movements": staged,
            "manicuring_out": {k: round(v, 3) for k, v in manicuring_out.items() if v > 0.001},
            "unreleased_imports": [u["batch_id"] for u in unreleased],
            "odoo_writes_live": get_vault_writer().live}


# ── S6 receiving (13.0.6) ─────────────────────────────────────────────────────

@router.post("/vault/receive-import")
async def receive_import(
    body: ImportReceipt,
    background_tasks: BackgroundTasks,
    current_user: dict = Depends(require_permission("production.vault")),
):
    """One S6 register row in one action: creates the BI batch, the S6 register
    entry, and the vault Receive movement. Replaces the Excel Register row and
    the manual "Loaded on Odoo" step (staged purchase-order goods receipt).

    The receipt lands in QUARANTINE: the batch cannot be issued out of the
    vault until the Responsible Pharmacist releases it (Schedule 6 control).
    A receipt with no purchase order must be explicitly flagged; flagged
    receipts additionally cannot be released until the flag is resolved."""
    if body.qty_received is None or body.qty_received <= 0:
        raise HTTPException(status_code=422, detail="Quantity received must be greater than zero")
    if not body.po_id and not body.po_flag:
        raise HTTPException(status_code=422, detail="Link the purchase order for this delivery, or flag that no purchase order was found")

    batch = await _create_import_batch(BatchCreate(
        family="import", product_code=body.product_code, date_code=body.date_code,
        supplier_code=body.supplier_code, type_digit=body.type_digit, subcat=body.subcat,
    ), current_user)

    qty = round(float(body.qty_received), 3)
    qty_quoted = round(float(body.qty_quoted), 3) if body.qty_quoted else None
    discrepancy = round(qty_quoted - qty, 3) if qty_quoted is not None else None
    now = _now()
    writer = get_vault_writer()
    sup_doc = await col("import_suppliers").find_one({"code": batch["supplier_code"]}) or {}
    prod_doc = await col("product_shortcodes").find_one({"code": batch["product_code"]}) or {}

    # Vault movement: Odoo side is a supplier PO receipt, not an internal transfer
    movement = {
        "type":         "receive",
        "batch_id":     batch["batch_id"],
        "product_name": batch["product_name"],
        "qty_g":        qty,
        "source":       "external_supplier",
        "outputs":      [],
        "waste_g":      None,
        "notes":        (body.comment or "").strip() or None,
        "ops":          [writer.op_po_receipt(batch["supplier_name"], batch["batch_id"], qty,
                                              batch["product_name"], po_id=body.po_id, po_name=body.po_name,
                                              supplier_partner_id=sup_doc.get("odoo_partner_id"),
                                              product_code=batch["product_code"],
                                              product_id=prod_doc.get("odoo_product_id"))],
        "odoo_sync":    "staged",
        "odoo_error":   None,
        "odoo_result":  None,
        "warehouse_id": writer.warehouse_id or None,
        "actor_id":     current_user.get("id"),
        "actor_name":   current_user.get("name") or current_user.get("username"),
        "created_at":   now,
    }
    if writer.live:
        try:
            await _refresh_product_pins(movement["ops"])
            movement["odoo_result"] = writer.execute_ops(movement["ops"])
            movement["odoo_sync"] = "done"
        except Exception as e:
            movement["odoo_sync"] = "error"
            movement["odoo_error"] = str(e)
    await col("vault_movements").insert_one(dict(movement))

    receipt = {
        "batch_id":        batch["batch_id"],
        "date_code":       batch["date_code"],
        "supplier_code":   batch["supplier_code"],
        "supplier_name":   batch["supplier_name"],
        "product_code":    batch["product_code"],
        "product_name":    batch["product_name"],
        "type_digit":      batch["type_digit"],
        "type_label":      batch["type_label"],
        "subcat":          batch["subcat"],
        "import_ref":      batch["import_ref"],
        "qty_quoted":      qty_quoted,
        "qty_received":    qty,
        "discrepancy":     discrepancy,
        # Schedule 6 control: received stock is quarantined until the
        # Responsible Pharmacist releases it. Issues out of the vault are
        # blocked while status != "released".
        "status":          "quarantine",   # quarantine | queried | released
        "released_by":     None,
        "released_by_name": None,
        "released_at":     None,
        "query_note":      None,
        "po_id":           body.po_id,
        "po_name":         body.po_name,
        "po_flag": {
            "flagged":     bool(body.po_flag),
            "resolved":    False,
            "note":        None,
            "resolved_by": None,
            "resolved_at": None,
        } if body.po_flag else None,
        "docs": {
            "invoice":       body.doc_invoice,
            "coa":           body.doc_coa,
            "delivery_note": body.doc_delivery_note,
            "s6_transfer":   body.doc_s6_transfer,
        },
        "comment":         (body.comment or "").strip() or None,
        "actor_id":        current_user.get("id"),
        "actor_name":      current_user.get("name") or current_user.get("username"),
        "created_at":      now,
    }
    await col("s6_receipts").insert_one(dict(receipt))
    await audit_log("production.import_received", "s6_receipt", batch["batch_id"],
                    entity_label=f"{batch['supplier_name']} {batch['product_name']} {batch['batch_id']}",
                    user=current_user,
                    detail={"qty_received": qty, "qty_quoted": qty_quoted,
                            "discrepancy": discrepancy, "docs": receipt["docs"],
                            "po": body.po_name or ("FLAGGED: no PO" if body.po_flag else None)})

    if body.po_flag:
        routing = await get_email_routing()
        recipients = routing.get("s6_flag_to") or []
        if recipients:
            background_tasks.add_task(
                send_s6_flag_notification, recipients,
                batch["supplier_name"], batch["product_name"], batch["batch_id"],
                f"{qty} g/units", receipt["actor_name"],
            )

    receipt.pop("_id", None)
    return {"success": True, "receipt": receipt, "batch": batch}


@router.get("/suppliers/{code}/open-pos")
async def supplier_open_pos(code: str, _: dict = Depends(PROD_READ)):
    """Open Odoo purchase orders for an import supplier, for linking a receipt.
    Read-only, works in staged mode. Degrades to an empty list (flagged) when
    Odoo is unreachable or the supplier has no Odoo partner yet."""
    sup = await col("import_suppliers").find_one({"code": code.strip().upper()})
    if not sup:
        raise HTTPException(status_code=404, detail=f"Supplier {code} not found")
    try:
        odoo = get_odoo_client()
        linked = bool(sup.get("odoo_partner_id"))
        if linked:
            # Deterministic: the admin-pinned Odoo vendor account.
            partner_id = sup["odoo_partner_id"]
            partner_name = sup.get("odoo_partner_name")
        else:
            # Read-time fallback only — writes never rely on a name match.
            partners = odoo.search_read(
                "res.partner", domain=[("name", "ilike", sup["name"])],
                fields=["id", "name"], limit=1,
            )
            if not partners:
                return {"purchase_orders": [], "odoo_partner_found": False, "linked": False}
            partner_id = partners[0]["id"]
            partner_name = partners[0]["name"]
        pos = odoo.search_read(
            "purchase.order",
            domain=[("partner_id", "=", partner_id),
                    ("state", "in", ["draft", "sent", "purchase"])],
            fields=["id", "name", "date_order", "amount_total", "state"],
            limit=30, order="date_order desc",
        )
        for po in pos:
            for k, v in po.items():
                if v is False:
                    po[k] = None
        return {"purchase_orders": pos, "odoo_partner_found": True,
                "linked": linked, "partner_name": partner_name}
    except Exception:
        return {"purchase_orders": [], "odoo_partner_found": None, "odoo_unavailable": True}


async def _get_receipt_or_404(receipt_id: str) -> dict:
    try:
        oid = ObjectId(receipt_id)
    except Exception:
        raise HTTPException(status_code=404, detail="Receipt not found")
    doc = await col("s6_receipts").find_one({"_id": oid})
    if not doc:
        raise HTTPException(status_code=404, detail="Receipt not found")
    return doc


@router.post("/s6/{receipt_id}/release")
async def release_receipt(
    receipt_id: str,
    current_user: dict = Depends(require_permission("production.rp_release")),
):
    """Responsible Pharmacist release: the Schedule 6 sign-off that moves an
    imported batch out of quarantine so it can be issued from the vault.

    NOTE (Annex 11): recorded as a signature_event with method "session" — the
    re-authentication e-signature upgrade is the known Phase 13 gap shared with
    the packing board approvals, and replaces this method in place when built."""
    doc = await _get_receipt_or_404(receipt_id)
    if doc.get("status") == "released":
        raise HTTPException(status_code=409, detail="This receipt has already been released")
    flag = doc.get("po_flag")
    if flag and flag.get("flagged") and not flag.get("resolved"):
        raise HTTPException(
            status_code=409,
            detail="This receipt is flagged: no purchase order was found. The flag must be investigated and resolved before the batch can be released.",
        )
    now = _now()
    await col("s6_receipts").update_one({"_id": doc["_id"]}, {"$set": {
        "status": "released",
        "released_by": current_user.get("id"),
        "released_by_name": current_user.get("name") or current_user.get("username"),
        "released_at": now,
    }})
    await col("signature_events").insert_one({
        "action":      "s6_release",
        "entity_type": "s6_receipt",
        "entity_id":   str(doc["_id"]),
        "batch_id":    doc["batch_id"],
        "actor_id":    current_user.get("id"),
        "actor_name":  current_user.get("name") or current_user.get("username"),
        "actor_role":  current_user.get("role"),
        "signed_at":   now,
        "method":      "session",   # upgraded to re-auth e-signature by the Annex 11 module
    })
    await audit_log("production.s6_released", "s6_receipt", str(doc["_id"]),
                    entity_label=doc["batch_id"], user=current_user,
                    before={"status": doc.get("status")}, after={"status": "released"})
    return {"success": True, "batch_id": doc["batch_id"]}


@router.post("/s6/{receipt_id}/query")
async def query_receipt(
    receipt_id: str,
    body: ReleaseNote,
    current_user: dict = Depends(require_permission("production.rp_release")),
):
    """RP queries a receipt instead of releasing it — the note goes on record
    and the batch stays locked in quarantine."""
    doc = await _get_receipt_or_404(receipt_id)
    if doc.get("status") == "released":
        raise HTTPException(status_code=409, detail="This receipt has already been released")
    note = (body.note or "").strip()
    if not note:
        raise HTTPException(status_code=422, detail="A note explaining the query is required")
    await col("s6_receipts").update_one({"_id": doc["_id"]}, {"$set": {
        "status": "queried", "query_note": note,
    }})
    await audit_log("production.s6_queried", "s6_receipt", str(doc["_id"]),
                    entity_label=doc["batch_id"], user=current_user,
                    detail={"note": note})
    return {"success": True}


@router.post("/s6/{receipt_id}/resolve-flag")
async def resolve_receipt_flag(
    receipt_id: str,
    body: ReleaseNote,
    current_user: dict = Depends(require_permission("production.manage")),
):
    """Compliance resolution of a no-purchase-order flag, with a mandatory note.
    The investigation normally concludes with a PO raised in Odoo — pass its
    id/name to link it to the receipt (the portal never creates POs itself);
    the pending stock-system operation is updated to receive against it.
    Only after resolution can the RP release the batch."""
    doc = await _get_receipt_or_404(receipt_id)
    flag = doc.get("po_flag")
    if not flag or not flag.get("flagged"):
        raise HTTPException(status_code=409, detail="This receipt is not flagged")
    if flag.get("resolved"):
        raise HTTPException(status_code=409, detail="This flag has already been resolved")
    note = (body.note or "").strip()
    if not note:
        raise HTTPException(status_code=422, detail="A note explaining the resolution is required")
    updates = {
        "po_flag.resolved": True,
        "po_flag.note": note,
        "po_flag.resolved_by": current_user.get("name") or current_user.get("username"),
        "po_flag.resolved_at": _now(),
    }
    if body.po_id:
        updates["po_id"] = body.po_id
        updates["po_name"] = body.po_name
        # Point the still-staged receive movement at the linked PO so the sync
        # books the goods receipt against it (the sync refuses PO-less receipts).
        await col("vault_movements").update_one(
            {"batch_id": doc["batch_id"], "type": "receive", "odoo_sync": {"$ne": "done"}},
            {"$set": {"ops.$[op].po_id": body.po_id, "ops.$[op].po_name": body.po_name}},
            array_filters=[{"op.op": "po_receipt"}],
        )
    await col("s6_receipts").update_one({"_id": doc["_id"]}, {"$set": updates})
    await audit_log("production.s6_flag_resolved", "s6_receipt", str(doc["_id"]),
                    entity_label=doc["batch_id"], user=current_user,
                    detail={"note": note, "po_linked": body.po_name})
    return {"success": True}


@router.get("/s6-register")
async def s6_register(
    q: Optional[str] = Query(None),
    supplier_code: Optional[str] = Query(None),
    status: Optional[str] = Query(None),   # quarantine | queried | released | pending (= not released)
    skip: int = Query(0, ge=0),
    limit: int = Query(100, le=500),
    _: dict = Depends(PROD_READ),
):
    """The digital S6 Stock Receiving Register — the Schedule 6 compliance
    record of every imported receipt, filterable for inspection."""
    filt: dict = {}
    if q:
        filt["$or"] = [
            {"batch_id":      {"$regex": q, "$options": "i"}},
            {"product_name":  {"$regex": q, "$options": "i"}},
            {"supplier_name": {"$regex": q, "$options": "i"}},
        ]
    if supplier_code:
        filt["supplier_code"] = supplier_code.strip().upper()
    if status == "pending":
        filt["status"] = {"$ne": "released"}
    elif status in ("quarantine", "queried", "released"):
        filt["status"] = status
    total = await col("s6_receipts").count_documents(filt)
    docs = await col("s6_receipts").find(filt).sort("created_at", -1).skip(skip).limit(limit).to_list(limit)
    return {"items": [_clean(d) for d in docs], "total": total}


# ── GACP readiness probe (13.0.1) ─────────────────────────────────────────────

@router.get("/odoo-probe")
async def odoo_probe(_: dict = Depends(require_permission("production.manage"))):
    """Read-only diagnostic: what the Odoo service account can currently see.
    Answers "do we have GACP access yet?" empirically — companies, warehouses,
    location trees, and whether manufacturing is installed."""
    odoo = get_odoo_client()
    out: dict = {"companies": [], "mrp_installed": None,
                 "gacp_warehouse_id": get_settings().gacp_warehouse_id or None,
                 "odoo_writes_live": get_vault_writer().live}
    try:
        companies = odoo.search_read("res.company", domain=[], fields=["id", "name"], limit=20)
    except Exception as e:
        raise HTTPException(status_code=502, detail=f"Odoo error: {e}")
    try:
        warehouses = odoo.search_read("stock.warehouse", domain=[],
                                      fields=["id", "name", "code", "company_id", "view_location_id", "lot_stock_id"],
                                      limit=50)
    except Exception:
        warehouses = []
    for c in companies:
        entry = {"id": c["id"], "name": c["name"], "warehouses": []}
        for w in warehouses:
            if w.get("company_id") and w["company_id"][0] == c["id"]:
                wh = {"id": w["id"], "name": w["name"], "code": w.get("code"), "locations": []}
                try:
                    view_id = w["view_location_id"][0] if w.get("view_location_id") else None
                    if view_id:
                        locs = odoo.search_read(
                            "stock.location",
                            domain=[("id", "child_of", view_id)],
                            fields=["id", "complete_name", "usage"], limit=80,
                        )
                        wh["locations"] = [
                            {"id": l["id"], "name": l["complete_name"], "usage": l["usage"]}
                            for l in locs
                        ]
                except Exception as e:
                    wh["locations_error"] = str(e)
                entry["warehouses"].append(wh)
        out["companies"].append(entry)
    try:
        mods = odoo.search_read("ir.module.module", domain=[("name", "=", "mrp")],
                                fields=["state"], limit=1)
        out["mrp_installed"] = bool(mods) and mods[0]["state"] == "installed"
    except Exception:
        out["mrp_installed"] = None
    return out


# ── Staged-queue sync ─────────────────────────────────────────────────────────

@router.post("/sync-staged")
async def sync_staged(current_user: dict = Depends(require_permission("production.manage"))):
    """Replay the staged outbox against Odoo, oldest first: registry lots, then
    movements. Each item is marked done or error (with the message) so failed
    items can be fixed in Odoo and re-run. Only available once writes are on."""
    writer = get_vault_writer()
    if not writer.live:
        raise HTTPException(
            status_code=409,
            detail="Odoo writes for the GACP vault are not enabled yet. Set GACP_ODOO_WRITES=on once access is confirmed.",
        )
    synced, failed = 0, 0
    results = []

    batches = await col("batch_registry").find({"odoo_sync": "staged"}).sort("created_at", 1).to_list(1000)
    for b in batches:
        try:
            ops = await _refresh_product_pins(b.get("ops") or [])
            res = writer.execute_ops(ops)
            lot_id = next((r.get("lot_id") for r in res if r.get("lot_id")), None)
            await col("batch_registry").update_one(
                {"_id": b["_id"]},
                {"$set": {"odoo_sync": "done", "odoo_lot_id": lot_id, "odoo_error": None}},
            )
            synced += 1
        except Exception as e:
            await col("batch_registry").update_one(
                {"_id": b["_id"]}, {"$set": {"odoo_sync": "error", "odoo_error": str(e)}},
            )
            failed += 1
            results.append({"batch_id": b["batch_id"], "error": str(e)})

    movements = await col("vault_movements").find({"odoo_sync": {"$in": ["staged", "error"]}}).sort("created_at", 1).to_list(5000)
    for m in movements:
        try:
            ops = await _refresh_product_pins(m.get("ops") or [])
            res = writer.execute_ops(ops)
            await col("vault_movements").update_one(
                {"_id": m["_id"]},
                {"$set": {"odoo_sync": "done", "odoo_result": res, "odoo_error": None}},
            )
            synced += 1
        except Exception as e:
            await col("vault_movements").update_one(
                {"_id": m["_id"]}, {"$set": {"odoo_sync": "error", "odoo_error": str(e)}},
            )
            failed += 1
            results.append({"movement": f"{m['type']} {m['batch_id']}", "error": str(e)})

    await audit_log("production.sync_staged", "vault_sync", "sync",
                    entity_label="Staged vault sync", user=current_user,
                    detail={"synced": synced, "failed": failed})
    return {"synced": synced, "failed": failed, "errors": results}


# ── Test-data purge (super admin) ─────────────────────────────────────────────

@router.post("/purge-test-data")
async def purge_test_data(current_user: dict = Depends(require_super_admin)):
    """Wipe all batches and vault movements — for clearing demo/test data
    before real operation starts. The product master list is kept.

    Refuses to run if any record has already been written to Odoo: those are
    real stock records that must be reversed in Odoo, not deleted here. Audit
    trail entries are self-contained and are never touched by this purge.
    Batch sequences derive from the registry, so they reset automatically."""
    synced = (
        await col("batch_registry").count_documents({"odoo_sync": "done"})
        + await col("vault_movements").count_documents({"odoo_sync": "done"})
    )
    if synced:
        raise HTTPException(
            status_code=409,
            detail=f"{synced} record{'s have' if synced != 1 else ' has'} already been written to the stock system and cannot be purged. Those need to be reversed in the stock system first.",
        )
    batches = await col("batch_registry").delete_many({})
    movements = await col("vault_movements").delete_many({})
    receipts = await col("s6_receipts").delete_many({})
    await audit_log(
        "production.test_data_purged", "vault_purge", "purge",
        entity_label="Production test data purge", user=current_user,
        detail={"batches_deleted": batches.deleted_count,
                "movements_deleted": movements.deleted_count,
                "receipts_deleted": receipts.deleted_count},
    )
    return {"batches_deleted": batches.deleted_count,
            "movements_deleted": movements.deleted_count,
            "receipts_deleted": receipts.deleted_count}
