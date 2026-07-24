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

from fastapi import APIRouter, Depends, HTTPException, Query
from pydantic import BaseModel

from auth import require_permission, require_any_permission, require_super_admin
from database import col
from middleware.audit import audit_log
from odoo_client import get_odoo_client
from config import get_settings
from services.batch_id import (
    FAMILIES, FAMILY_LABELS, STAGE_SUFFIXES,
    build_batch_id, derive_stage_id, format_date_code, split_stage,
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


class BatchCreate(BaseModel):
    family: str                       # single | api | blend | gummy
    product_code: str
    date_code: Optional[str] = None   # DDMMYY; defaults to today


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
        "ops":             [get_vault_writer().op_ensure_lot(child_id, parent["product_name"])],
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


# ── Batch registry + generator ────────────────────────────────────────────────

@router.get("/meta")
async def production_meta(_: dict = Depends(PROD_READ)):
    """Static vocabulary for the frontend: families, stage suffixes, writer mode."""
    return {
        "families": [{"key": k, "prefix": v, "label": FAMILY_LABELS[k]} for k, v in FAMILIES.items()],
        "stage_suffixes": [{"suffix": s, "label": l} for s, l in STAGE_SUFFIXES.items()],
        "odoo_writes_live": get_vault_writer().live,
    }


@router.get("/batches/preview")
async def preview_batch_id(
    family: str = Query(...),
    product_code: str = Query(...),
    _: dict = Depends(PROD_READ),
):
    if family not in FAMILIES:
        raise HTTPException(status_code=422, detail="Unknown batch family")
    seq = await _next_sequence(family, product_code.strip().upper())
    try:
        batch_id = build_batch_id(family, product_code, seq, format_date_code())
    except ValueError as e:
        raise HTTPException(status_code=422, detail=str(e))
    return {"batch_id": batch_id, "sequence": seq, "date_code": format_date_code()}


@router.post("/batches")
async def create_batch(
    body: BatchCreate,
    current_user: dict = Depends(require_permission("production.batch_generate")),
):
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
    ops = [writer.op_ensure_lot(batch_id, product["name"])]
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
    writer = get_vault_writer()
    product_name = batch["product_name"]
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
                writer.op_ensure_lot(batch["batch_id"], product_name),
                writer.op_internal_transfer(batch["batch_id"], doc["qty_g"],
                                            LOC_PRODUCTION, LOC_VAULT, product_name),
            ]
        else:
            dest = LOC_PACKING if body.type == "issue_packing" else LOC_MANICURING
            doc["ops"] = [
                writer.op_internal_transfer(batch["batch_id"], doc["qty_g"],
                                            LOC_VAULT, dest, product_name),
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
            {"lot_name": o["batch_id"], "qty_g": o["qty_g"], "product_hint": product_name}
            for o in outputs
        ]
        split = writer.op_manufacture_split(batch["batch_id"],
                                            (doc["waste_g"] or 0) + m_qty + t_qty,
                                            op_outputs, doc["waste_g"] or 0)
        split["input_hint"] = product_name
        doc["ops"] = [split]

    if writer.live:
        try:
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
        elif m["type"] == "return_manicuring":
            for out in m.get("outputs") or []:
                bump(out["batch_id"], out.get("qty_g") or 0, when)

    ids = list(balances.keys())
    reg = await col("batch_registry").find({"batch_id": {"$in": ids}}).to_list(len(ids) or 1)
    names = {r["batch_id"]: r.get("product_name") for r in reg}
    rows = sorted(balances.values(), key=lambda b: -abs(b["qty_g"]))
    for r in rows:
        r["product_name"] = names.get(r["batch_id"], "")
    staged = await col("vault_movements").count_documents({"odoo_sync": "staged"})
    return {"rows": rows, "staged_movements": staged,
            "odoo_writes_live": get_vault_writer().live}


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
            res = writer.execute_ops(b.get("ops") or [])
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
            res = writer.execute_ops(m.get("ops") or [])
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
    await audit_log(
        "production.test_data_purged", "vault_purge", "purge",
        entity_label="Production test data purge", user=current_user,
        detail={"batches_deleted": batches.deleted_count,
                "movements_deleted": movements.deleted_count},
    )
    return {"batches_deleted": batches.deleted_count,
            "movements_deleted": movements.deleted_count}
