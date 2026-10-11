"""
GMP Supply (8.70) — /api/supply.

The portal side of getting stock from GMP (the supplying company) to La
Farmacia (the receiving warehouse) and backordered customer orders packed,
with no Odoo login. Odoo logic lives in services/supply_service.py; this file
handles settings, permissions, audit, and what happens after stock arrives
(reserve waiting deliveries, re-queue backorders, refresh Order Ticket lines).

Permissions (domain `supply`, off by default, granted to existing users):
  view      work list, GMP deliveries, in-transit receipts
  request   raise a stock request (purchase order) to GMP
  book_in   add stock at GMP (inventory adjustment on a batch)
  dispatch  dispatch GMP deliveries, receive in-transit stock, reconcile
Settings: PUT needs settings.manage.
"""
import logging
from datetime import datetime, timezone
from typing import List, Optional

from fastapi import APIRouter, BackgroundTasks, Depends, HTTPException
from fastapi.concurrency import run_in_threadpool
from pydantic import BaseModel

from auth import require_any_permission, require_permission
from database import col
from middleware.audit import audit_log
from odoo_client import get_odoo_client
from services import supply_service as svc

logger = logging.getLogger(__name__)
router = APIRouter(prefix="/api/supply", tags=["supply"])

SETTINGS_ID = "supply_settings"


async def _settings() -> dict:
    return await col("portal_settings").find_one({"_id": SETTINGS_ID}, {"_id": 0}) or {}


async def _config(odoo) -> dict:
    try:
        return await run_in_threadpool(svc.resolve_config, odoo, await _settings())
    except svc.SupplyNotConfigured as e:
        raise HTTPException(status_code=409, detail=str(e))
    except Exception as e:
        raise HTTPException(status_code=502, detail=f"Could not read the supply setup from Odoo: {e}")


async def _run(fn, *args):
    try:
        return await run_in_threadpool(fn, *args)
    except svc.SupplyError as e:
        raise HTTPException(status_code=400, detail=str(e))
    except HTTPException:
        raise
    except Exception as e:
        raise HTTPException(status_code=502, detail=f"Odoo error: {e}")


async def _ticket_ids_by_order(order_ids: list) -> dict:
    if not order_ids:
        return {}
    out = {}
    async for t in col("tickets").find({"type": "sales", "order_id": {"$in": order_ids}, "exit_status": None},
                                       {"order_id": 1}):
        out[t["order_id"]] = str(t["_id"])
    return out


async def quarantine_blocks(lot_names) -> list:
    """Schedule 6 control shared with the Vault Logbook: an imported batch
    (registered by S6 Receiving) can't be booked in, dispatched or received
    until the Responsible Pharmacist has released it. Deny by default when the
    registry knows it's an import but no receipt is found. Batches the
    registry doesn't know (legacy names created before the portal) can't be
    checked and are allowed, as agreed 2026-10-11."""
    blocks = []
    for name in sorted({n for n in lot_names if n}):
        batch = await col("batch_registry").find_one({"batch_id": name}, {"family": 1, "base_batch_id": 1, "batch_id": 1})
        if not batch or batch.get("family") != "import":
            continue
        lineage = batch.get("base_batch_id") or batch["batch_id"]
        receipt = await col("s6_receipts").find_one({"$or": [{"base_batch_id": lineage}, {"batch_id": lineage}]},
                                                     sort=[("created_at", -1)])
        if not receipt:
            blocks.append(f"{name} has no S6 receiving record on file.")
        elif receipt.get("status") != "released":
            blocks.append(f"{name} is awaiting Responsible Pharmacist release (S6 Releases).")
    return blocks


async def _require_released(lot_names) -> None:
    blocks = await quarantine_blocks(lot_names)
    if blocks:
        raise HTTPException(status_code=409, detail="Schedule 6 quarantine: " + " ".join(blocks))


async def after_stock_arrival(odoo, cfg: dict, product_ids: list, background_tasks: BackgroundTasks,
                              actor: Optional[dict]) -> dict:
    """Stock just landed at the receiving warehouse: reserve it on waiting
    customer deliveries, re-queue backorders that are now ready, and refresh
    the per-line stock status on active Order Tickets. Best-effort: the
    dispatch/receipt itself is already committed in Odoo."""
    out = {"deliveries_checked": 0, "backorders_requeued": 0}
    try:
        out["deliveries_checked"] = await run_in_threadpool(svc.reserve_waiting_deliveries, odoo, cfg, product_ids)
    except Exception as e:
        logger.warning("supply_reserve_failed", extra={"error": str(e)})
    try:
        from routes.packing_board_routes import _check_and_notify_backorder_stock, _refresh_active_item_backorder_flags
        res = await _check_and_notify_backorder_stock(background_tasks, actor)
        out["backorders_requeued"] = len(res.get("updated", []) or []) if isinstance(res, dict) else 0
        await _refresh_active_item_backorder_flags()
    except Exception as e:
        logger.warning("supply_backorder_recheck_failed", extra={"error": str(e)})
    return out


# ── Settings ──────────────────────────────────────────────────────────────────

class SupplySettingsBody(BaseModel):
    supplier_company_id: int
    receiving_warehouse_id: int
    supplier_warehouse_id: Optional[int] = None
    # Raise the GMP request automatically once a customer order clears the
    # deposit gate (deposit registered or released on account), 2026-10-11.
    auto_request_on_deposit: bool = True


@router.get("/settings")
async def get_supply_settings(current_user: dict = Depends(require_any_permission("supply.view", "settings.manage"))):
    odoo = get_odoo_client()
    settings = await _settings()
    config, error = None, None
    try:
        config = await run_in_threadpool(svc.resolve_config, odoo, settings)
    except svc.SupplyNotConfigured as e:
        error = str(e)
    except Exception as e:
        error = f"Could not read the supply setup from Odoo: {e}"
    try:
        options = await run_in_threadpool(svc.settings_options, odoo)
    except Exception:
        options = {"companies": [], "warehouses": [], "suggested": {}}
    if config:
        config.pop("internal_partner_ids", None)
    return {"settings": settings, "config": config, "error": error, "options": options}


@router.put("/settings")
async def save_supply_settings(body: SupplySettingsBody, current_user: dict = Depends(require_permission("settings.manage"))):
    odoo = get_odoo_client()
    new = body.model_dump()
    try:
        cfg = await run_in_threadpool(svc.resolve_config, odoo, new)
    except svc.SupplyNotConfigured as e:
        raise HTTPException(status_code=400, detail=str(e))
    before = await _settings()
    await col("portal_settings").update_one(
        {"_id": SETTINGS_ID},
        {"$set": {**new, "updated_at": datetime.now(timezone.utc), "updated_by": current_user.get("username")}},
        upsert=True,
    )
    await audit_log("supply.settings_saved", "supply", "settings", entity_label="Supply settings",
                    user=current_user, before=before or None, after=new)
    warnings = []
    if not cfg["auto_sales_orders"]:
        warnings.append(f"Odoo isn't set to create {cfg['supplier_company_name']}'s sales orders from purchase orders automatically. Stock requests will need that turned on.")
    if not cfg["receipt_sync"]:
        warnings.append("Odoo isn't syncing deliveries to receipts. The portal will validate receipts itself after each dispatch.")
    return {"success": True, "warnings": warnings}


# ── Reads ─────────────────────────────────────────────────────────────────────

@router.get("/work-list")
async def get_work_list(current_user: dict = Depends(require_permission("supply.view"))):
    odoo = get_odoo_client()
    cfg = await _config(odoo)
    data = await _run(svc.work_list, odoo, cfg)
    order_ids = sorted({o["sale_order_id"] for r in data["products"] + data["external"] for o in r["orders"] if o["sale_order_id"]})
    tickets = await _ticket_ids_by_order(order_ids)
    for r in data["products"] + data["external"]:
        for o in r["orders"]:
            o["ticket_id"] = tickets.get(o["sale_order_id"])
    data["config"] = {k: cfg[k] for k in ("supplier_company_name", "supplier_warehouse_name", "receiving_company_name",
                                         "receiving_warehouse_name", "supplier_stock_location_id", "receipt_sync")}
    return data


@router.get("/deliveries")
async def get_supplier_deliveries(include_waiting: bool = True, current_user: dict = Depends(require_permission("supply.view"))):
    odoo = get_odoo_client()
    cfg = await _config(odoo)
    deliveries = await _run(svc.supplier_deliveries, odoo, cfg, include_waiting)
    return {"deliveries": deliveries, "supplier_stock_location_id": cfg["supplier_stock_location_id"]}


@router.get("/transit")
async def get_transit_receipts(current_user: dict = Depends(require_permission("supply.view"))):
    odoo = get_odoo_client()
    cfg = await _config(odoo)
    return {"receipts": await _run(svc.transit_receipts, odoo, cfg)}


# ── Request stock from GMP ────────────────────────────────────────────────────

class RequestLine(BaseModel):
    product_id: int
    qty: float


class RequestBody(BaseModel):
    lines: List[RequestLine]
    origin_orders: List[str] = []
    note: Optional[str] = None


@router.post("/request")
async def request_stock(body: RequestBody, current_user: dict = Depends(require_permission("supply.request"))):
    odoo = get_odoo_client()
    cfg = await _config(odoo)
    lines = [l.model_dump() for l in body.lines]
    res = await _run(svc.request_from_supplier, odoo, cfg, lines, body.origin_orders, (body.note or "").strip() or None)
    await audit_log("supply.requested", "supply", res["purchase_order"], entity_label=res["purchase_order"],
                    user=current_user, detail={"lines": lines, "origin_orders": body.origin_orders,
                                               "supplier_sale_order": res["supplier_sale_order"]})
    return {"success": True, **res}


# ── Automatic request once an order clears the deposit gate ──────────────────

SYSTEM_ACTOR = {"id": None, "username": "system", "name": "System (automatic GMP request)", "role": "system"}


async def auto_request_for_order(order_id: int) -> Optional[dict]:
    """Run as a background task from order_routes._queue_packing_board, i.e.
    once the order has a registered deposit or was released on account
    (product owner, 2026-10-11: GMP only makes stock for committed orders).
    Requests the order's uncovered shortfall from GMP through the same
    purchase-order path as the Request from GMP button, so Odoo's inter-company
    rules create GMP's sales order. Never raises: a failure only leaves the
    product on the GMP Work List as Needs requesting, as before."""
    try:
        settings = await _settings()
        if settings.get("auto_request_on_deposit") is False:
            return None
        odoo = get_odoo_client()
        try:
            cfg = await run_in_threadpool(svc.resolve_config, odoo, settings)
        except svc.SupplyNotConfigured:
            return None
        plan = await run_in_threadpool(svc.order_request_plan, odoo, cfg, int(order_id))
        if not plan["lines"]:
            return {"requested": False, **plan}
        res = await run_in_threadpool(
            svc.request_from_supplier, odoo, cfg,
            [{"product_id": l["product_id"], "qty": l["qty"]} for l in plan["lines"]],
            [plan["order_name"]], "Raised automatically when the customer order cleared the deposit stage.",
        )
        await audit_log("supply.auto_requested", "supply", res["purchase_order"], entity_label=res["purchase_order"],
                        user=SYSTEM_ACTOR, detail={"order_id": str(order_id), "order_name": plan["order_name"],
                                                   "lines": plan["lines"], "external": plan["external"],
                                                   "supplier_sale_order": res["supplier_sale_order"]})
        summary = ", ".join(f"{l['product_name']} x {l['qty']:g}" for l in plan["lines"])
        note = f"Stock requested from {cfg['supplier_company_name']} automatically ({res['purchase_order']}): {summary}"
        if plan["external"]:
            note += ". Not requested (bought from outside suppliers): " + ", ".join(e["product_name"] for e in plan["external"])
        await col("tickets").update_one(
            {"type": "sales", "order_id": {"$in": [int(order_id), str(order_id)]}, "exit_status": None},
            {"$push": {"stage_history": {
                "status": None, "exit_status": None, "actor_id": None, "actor_name": SYSTEM_ACTOR["name"],
                "at": datetime.now(timezone.utc), "note": note,
            }}},
        )
        return {"requested": True, **plan, **res}
    except Exception as e:
        logger.warning("supply_auto_request_failed", extra={"order_id": order_id, "error": str(e)})
        return None


# ── Book in at GMP ────────────────────────────────────────────────────────────

async def _registry_batches_for(product_id: int) -> list:
    """Batch Registry batches whose product is linked to this Odoo product."""
    codes = [d["code"] async for d in col("product_shortcodes").find({"odoo_product_id": product_id}, {"code": 1})]
    if not codes:
        return []
    rows = await col("batch_registry").find(
        {"product_code": {"$in": codes}},
        {"_id": 0, "batch_id": 1, "family": 1, "stage_suffix": 1, "base_batch_id": 1, "created_at": 1, "product_name": 1},
    ).sort("created_at", -1).to_list(200)
    for r in rows:
        r["quarantine_block"] = None
        if r.get("family") == "import":
            b = await quarantine_blocks([r["batch_id"]])
            r["quarantine_block"] = b[0] if b else None
        if hasattr(r.get("created_at"), "isoformat"):
            r["created_at"] = r["created_at"].isoformat()
    return rows


def _read_product(odoo, product_id: int, fields: list):
    return odoo.read("product.product", [product_id], fields=fields)


def _read_lot(odoo, lot_id: int):
    return odoo.read("stock.lot", [lot_id], fields=["name", "product_id"])


@router.get("/book-in/batches")
async def book_in_batch_options(product_id: int, current_user: dict = Depends(require_permission("supply.book_in"))):
    """The batches stock can be booked in on: one registered in the Batch
    Registry / S6 Receiving for this product, or one already in Odoo. Typing a
    new batch name isn't allowed (batch standard, 2026-10-11)."""
    odoo = get_odoo_client()
    cfg = await _config(odoo)
    prod = await _run(_read_product, odoo, product_id, ["display_name", "tracking"])
    if not prod:
        raise HTTPException(status_code=404, detail="Product not found")
    existing = await _run(svc.product_lots, odoo, product_id, cfg["supplier_stock_location_id"])
    registered = await _registry_batches_for(product_id)
    linked = await col("product_shortcodes").find_one({"odoo_product_id": product_id}, {"code": 1})
    return {"tracking": prod[0].get("tracking") or "none", "registered": registered, "existing": existing,
            "product_linked": bool(linked)}


class BookInBody(BaseModel):
    product_id: int
    qty: float
    registry_batch_id: Optional[str] = None   # a Batch Registry / S6 Receiving batch
    odoo_lot_id: Optional[int] = None         # a batch already in Odoo
    expiration_date: Optional[str] = None
    reason: str


@router.post("/book-in")
async def book_in_stock(body: BookInBody, current_user: dict = Depends(require_permission("supply.book_in"))):
    if not (body.reason or "").strip():
        raise HTTPException(status_code=400, detail="Give a reason (e.g. production batch completed)")
    odoo = get_odoo_client()
    cfg = await _config(odoo)
    prod = await _run(_read_product, odoo, body.product_id, ["tracking"])
    if not prod:
        raise HTTPException(status_code=404, detail="Product not found")
    lot_name = None
    if (prod[0].get("tracking") or "none") != "none":
        if bool(body.registry_batch_id) == bool(body.odoo_lot_id):
            raise HTTPException(status_code=400, detail="Choose one batch: a registered batch or an existing Odoo batch.")
        if body.registry_batch_id:
            reg = await col("batch_registry").find_one({"batch_id": body.registry_batch_id.strip()}, {"product_code": 1, "batch_id": 1})
            if not reg:
                raise HTTPException(status_code=400, detail="That batch isn't in the Batch Registry.")
            link = await col("product_shortcodes").find_one({"code": reg.get("product_code")}, {"odoo_product_id": 1})
            if not link or link.get("odoo_product_id") != body.product_id:
                raise HTTPException(status_code=400, detail="That batch belongs to a different product. If it's the same item, link the product under Batch Registry, Manage Products.")
            lot_name = reg["batch_id"]
        else:
            lot = await _run(_read_lot, odoo, body.odoo_lot_id)
            if not lot or (lot[0].get("product_id") or [None])[0] != body.product_id:
                raise HTTPException(status_code=400, detail="That batch belongs to a different product.")
            lot_name = lot[0]["name"]
        await _require_released([lot_name])
    res = await _run(svc.book_in, odoo, cfg, body.product_id, body.qty, lot_name, body.expiration_date)
    await audit_log("supply.booked_in", "product", body.product_id, entity_label=res["product_name"], user=current_user,
                    before={"qty": res["before"]}, after={"qty": res["after"]},
                    detail={"warehouse": cfg["supplier_warehouse_name"], "lot": res["lot_name"], "added": body.qty,
                            "expiration_date": body.expiration_date, "reason": body.reason.strip()})
    return {"success": True, **res}


# ── Dispatch to La Farmacia / receive in-transit stock ────────────────────────

class DispatchLine(BaseModel):
    move_line_id: int
    quantity: float
    lot_id: Optional[int] = None


class DispatchBody(BaseModel):
    picking_id: int
    lines: Optional[List[DispatchLine]] = None


@router.post("/dispatch")
async def dispatch_delivery(body: DispatchBody, background_tasks: BackgroundTasks,
                            current_user: dict = Depends(require_permission("supply.dispatch"))):
    odoo = get_odoo_client()
    cfg = await _config(odoo)
    lines = [l.model_dump() for l in body.lines] if body.lines else None
    await _require_released(await _run(svc.picking_lot_names, odoo, body.picking_id, lines))
    res = await _run(svc.dispatch, odoo, cfg, body.picking_id, lines)
    follow = await after_stock_arrival(odoo, cfg, res["product_ids"], background_tasks, current_user)
    await audit_log("supply.dispatched", "supply", res["picking"], entity_label=res["picking"], user=current_user,
                    detail={"lines": lines, "backorder": res["backorder"], "received": res["received"],
                            "receipt_errors": res["receipt_errors"], **follow})
    warning = None
    if res["receipt_errors"]:
        warning = (f"Dispatched, but {cfg['receiving_company_name']}'s receipt didn't complete: "
                   + "; ".join(res["receipt_errors"]) + ". Receive it from In Transit once resolved.")
    return {"success": True, **res, **follow, "warning": warning}


class ReceiveBody(BaseModel):
    picking_id: int


@router.post("/receive")
async def receive_in_transit(body: ReceiveBody, background_tasks: BackgroundTasks,
                             current_user: dict = Depends(require_permission("supply.dispatch"))):
    odoo = get_odoo_client()
    cfg = await _config(odoo)
    await _require_released(await _run(svc.picking_lot_names, odoo, body.picking_id))
    res = await _run(svc.receive_transit, odoo, cfg, body.picking_id)
    follow = await after_stock_arrival(odoo, cfg, res["product_ids"], background_tasks, current_user)
    await audit_log("supply.received", "supply", res["picking"], entity_label=res["picking"], user=current_user, detail=follow)
    return {"success": True, **res, **follow}


# ── Backlog reconciliation ────────────────────────────────────────────────────

@router.get("/reconcile/preview")
async def reconcile_preview(current_user: dict = Depends(require_permission("supply.dispatch"))):
    """What's stuck between GMP and La Farmacia in Odoo. Read-only."""
    odoo = get_odoo_client()
    cfg = await _config(odoo)
    receipts = await _run(svc.transit_receipts, odoo, cfg)
    deliveries = await _run(svc.supplier_deliveries, odoo, cfg, True)
    dispatchable = [d for d in deliveries if d["readiness"] in ("ready", "partial")]
    waiting = [d for d in deliveries if d["readiness"] == "waiting"]
    return {
        "transit_receipts": receipts,
        "dispatchable": [{k: d[k] for k in ("picking_id", "name", "readiness", "purchase_order", "sale_order", "created", "demand", "reserved")}
                         for d in dispatchable],
        "waiting_count": len(waiting),
        "waiting_oldest": [{k: d[k] for k in ("picking_id", "name", "purchase_order", "created", "demand")} for d in waiting[:15]],
        "supplier_company_name": cfg["supplier_company_name"],
        "receiving_company_name": cfg["receiving_company_name"],
    }


class ReconcileBody(BaseModel):
    receive_picking_ids: List[int] = []
    dispatch_picking_ids: List[int] = []
    confirmation: str


@router.post("/reconcile")
async def reconcile(body: ReconcileBody, background_tasks: BackgroundTasks,
                    current_user: dict = Depends(require_permission("supply.dispatch"))):
    """Receive in-transit receipts and dispatch reserved GMP deliveries in
    bulk, each independently. Only for stock that has physically arrived at
    La Farmacia, which the caller confirms."""
    if (body.confirmation or "").strip().upper() != "ARRIVED":
        raise HTTPException(status_code=400, detail="Type ARRIVED to confirm this stock has physically arrived at La Farmacia")
    if not body.receive_picking_ids and not body.dispatch_picking_ids:
        raise HTTPException(status_code=400, detail="Choose at least one document")
    odoo = get_odoo_client()
    cfg = await _config(odoo)
    results, product_ids = [], set()
    for pid in body.receive_picking_ids:
        try:
            blocks = await quarantine_blocks(await run_in_threadpool(svc.picking_lot_names, odoo, pid))
            if blocks:
                raise svc.SupplyError("Schedule 6 quarantine: " + " ".join(blocks))
            r = await run_in_threadpool(svc.receive_transit, odoo, cfg, pid)
            product_ids.update(r["product_ids"])
            results.append({"picking_id": pid, "name": r["picking"], "action": "received", "ok": True})
        except Exception as e:
            results.append({"picking_id": pid, "action": "receive", "ok": False, "error": str(e)})
    for pid in body.dispatch_picking_ids:
        try:
            blocks = await quarantine_blocks(await run_in_threadpool(svc.picking_lot_names, odoo, pid))
            if blocks:
                raise svc.SupplyError("Schedule 6 quarantine: " + " ".join(blocks))
            r = await run_in_threadpool(svc.dispatch, odoo, cfg, pid, None)
            product_ids.update(r["product_ids"])
            results.append({"picking_id": pid, "name": r["picking"], "action": "dispatched", "ok": True,
                            "backorder": r["backorder"], "receipt_errors": r["receipt_errors"]})
        except Exception as e:
            results.append({"picking_id": pid, "action": "dispatch", "ok": False, "error": str(e)})
    follow = await after_stock_arrival(odoo, cfg, sorted(product_ids), background_tasks, current_user) if product_ids else {}
    await audit_log("supply.reconciled", "supply", "reconcile", entity_label="GMP backlog reconciliation",
                    user=current_user, detail={"results": results, **follow})
    return {"results": results, "ok": sum(1 for r in results if r["ok"]),
            "failed": sum(1 for r in results if not r["ok"]), **follow}
