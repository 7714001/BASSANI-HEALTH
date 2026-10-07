"""
Staff discount request/approval flow (8.61). Staff quote-builder only —
resellers and customers never request a discount. A draft SO is created (or
already exists) at normal pricing; a request here freezes the requested
percentages against it and blocks Send Quote / Confirm Order
(order_routes.py::_confirm_order_core, ticket_routes.py::send_quote) until a
holder of `discounts.approve` approves, rejects, or approves a different
percentage ("counters"). Approve/counter write `discount` directly onto the
existing sale.order.line rows in Odoo — no new SO is ever created here.

Separation of duties is enforced unconditionally (including for super_admin):
nobody decides their own request. Every request is decided manually — there
are no auto-approve thresholds.
"""
import logging
from datetime import datetime, timezone
from typing import List, Optional

from bson import ObjectId
from fastapi import APIRouter, BackgroundTasks, Depends, HTTPException
from pydantic import BaseModel

from auth import require_permission, require_any_permission
from database import col
from middleware.audit import audit_log
from odoo_client import get_odoo_client
from routes.settings_routes import get_email_routing
from services.email_service import (
    send_discount_request_notification,
    send_discount_decision_notification,
)

router = APIRouter(prefix="/api/discount-requests", tags=["discount-requests"])
logger = logging.getLogger(__name__)


class DiscountRequestLineIn(BaseModel):
    """Represents ONE line on the order — every line, not just the ones being
    discounted (8.61 follow-up, 2026-09-28). requested_pct is 0 for a line
    the requester left alone; this is what lets the approval queue show the
    full order in context (which lines were and weren't asked about) instead
    of only the discounted lines in isolation."""
    product_id: int
    product_name: str = ""
    qty: float = 0
    unit_price: float = 0
    requested_pct: float = 0


class DiscountRequestCreate(BaseModel):
    ticket_id: str
    lines: List[DiscountRequestLineIn]
    reason: str


class DiscountDecisionBody(BaseModel):
    note: Optional[str] = None


class DiscountCounterLine(BaseModel):
    product_id: int
    approved_pct: float


class DiscountCounterBody(BaseModel):
    lines: List[DiscountCounterLine]
    note: Optional[str] = None


def _actor(user: dict) -> str:
    return user.get("name") or user.get("username") or "unknown"


# Odoo stores sale.order.line.discount to the "Discount" decimal.precision
# (2 decimals on Bassani's instance as of 2026-10-07, asked to be raised to
# 4). Read live rather than assumed so the portal follows the setting the
# moment it changes; cached briefly since it's read on every request create.
_DIGITS_CACHE: dict = {"value": None, "at": 0.0}


def _discount_digits(odoo) -> int:
    import time
    if _DIGITS_CACHE["value"] is not None and time.time() - _DIGITS_CACHE["at"] < 600:
        return _DIGITS_CACHE["value"]
    digits = 2
    try:
        rows = odoo.search_read("decimal.precision", [("name", "=", "Discount")], fields=["digits"], limit=1)
        if rows and rows[0].get("digits") is not None:
            digits = int(rows[0]["digits"])
    except Exception as e:
        logger.warning("discount_digits_read_failed error=%s", e)
    _DIGITS_CACHE.update(value=digits, at=time.time())
    return digits


def _round_pct(pct: float, digits: int) -> float:
    """The % Odoo will actually store. Every Rand figure the portal shows is
    computed from this, never from the unrounded figure a Rand entry converts
    to, so what an approver sees is exactly what the customer gets."""
    return round(float(pct or 0), digits)


def _in_request(line: dict) -> bool:
    """A line is part of the request if it asks for a discount OR asks for an
    existing discount to be removed (2026-10-07). Before this, a line whose
    discount was cleared to 0 in a re-request was treated as "left alone",
    so approval never wrote it and the old discount silently stayed on."""
    return (line.get("requested_pct") or 0) > 0 or bool(line.get("is_removal"))


def _decision_stats(doc_lines: list, pct_by_product: dict) -> tuple:
    """(lines discounted, avg %, Rand off excl. VAT, lines with discount
    removed) for a decision. Removals (0%) are counted separately so they
    don't drag the average down or read as "N lines discounted"."""
    granted = {pid: pct for pid, pct in pct_by_product.items() if pct > 0}
    n = len(granted)
    avg = sum(granted.values()) / n if n else 0
    return n, avg, _discount_amount(doc_lines, granted), len(pct_by_product) - n


def _effective_pct(line: dict, pct_by_product: dict) -> float:
    """The discount a line ends up with after a decision: the decided % for a
    line in the request, otherwise whatever was already on it (approve/
    counter only ever write the lines they decide)."""
    if line["product_id"] in pct_by_product:
        return pct_by_product[line["product_id"]]
    return line.get("current_pct") or 0


def _totals_for(lines: list, pct_of) -> Optional[dict]:
    """Excl. VAT / VAT / incl. VAT totals for the snapshot lines at the
    discount pct_of(line) returns, rounded per line to the cent like Odoo.
    None when any line lacks a recorded tax_rate (requests made before
    2026-10-07), so nothing pretends to know an incl. VAT figure it doesn't."""
    if not lines or any("tax_rate" not in l for l in lines):
        return None
    untaxed = tax = 0.0
    for l in lines:
        net = round(l["qty"] * l["unit_price"] * (1 - pct_of(l) / 100), 2)
        untaxed += net
        tax += net * l["tax_rate"] / 100
    # VAT rounded on the total, not per line: matches Odoo's own totals on
    # Bassani's live orders (checked read-only 2026-10-07).
    untaxed, tax = round(untaxed, 2), round(tax, 2)
    return {"untaxed": untaxed, "tax": tax, "total": round(untaxed + tax, 2)}


def _order_line_context(odoo, order_id: int) -> dict:
    """{product_id: {"tax_rate", "current_pct"}} from the order's live lines.

    tax_rate is the sum of the line's own configured percentage taxes
    (Bassani's sales taxes are all price-exclusive percentages, live-checked
    2026-10-07; some lines carry more than one, e.g. VAT + Compliance Levy).
    Falls back to Odoo's computed price_tax / price_subtotal only if the
    tax records can't be read — that ratio comes from an already-rounded
    figure, so it drifts slightly (e.g. 14.9996%)."""
    out: dict = {}
    try:
        rows = odoo.read("sale.order", [order_id], fields=["order_line"])
        line_ids = rows[0].get("order_line") if rows else []
        if not line_ids:
            return out
        lines = odoo.read(
            "sale.order.line", line_ids,
            fields=["product_id", "discount", "price_subtotal", "price_tax", "tax_ids", "display_type", "is_downpayment"],
        )
        tax_ids_needed = {t for l in lines for t in (l.get("tax_ids") or [])}
        tax_pct: dict = {}
        if tax_ids_needed:
            try:
                for t in odoo.read("account.tax", list(tax_ids_needed), fields=["amount", "amount_type"]):
                    tax_pct[t["id"]] = t["amount"] if t.get("amount_type") == "percent" else 0
            except Exception as e:
                logger.warning("discount_tax_read_failed order_id=%s error=%s", order_id, e)
        for l in lines:
            if l.get("display_type") or l.get("is_downpayment") or not l.get("product_id"):
                continue
            pid = l["product_id"][0] if isinstance(l["product_id"], (list, tuple)) else l["product_id"]
            line_taxes = l.get("tax_ids") or []
            if all(t in tax_pct for t in line_taxes):
                rate = sum(tax_pct[t] for t in line_taxes)
            elif l.get("price_subtotal"):
                rate = (l.get("price_tax") or 0) / l["price_subtotal"] * 100
            else:
                rate = 0
            out.setdefault(pid, {"tax_rate": round(rate, 4), "current_pct": l.get("discount") or 0})
    except Exception as e:
        logger.warning("discount_line_context_failed order_id=%s error=%s", order_id, e)
    return out


def _serialize(doc: dict) -> dict:
    doc["id"] = str(doc.pop("_id"))
    return doc


async def _resolve_user_email(user_id: Optional[str]) -> Optional[str]:
    if not user_id:
        return None
    try:
        u = await col("users").find_one({"_id": ObjectId(user_id)}, {"email": 1})
    except Exception:
        return None
    return (u or {}).get("email") or None


def _write_line_discounts(odoo, order_id: int, pct_by_product: dict) -> None:
    """Writes `discount` onto each sale.order.line on `order_id` whose
    product_id appears in pct_by_product — never touches a line for a
    product that isn't in the map (e.g. a line added to the quote after the
    request was raised). Section/down-payment lines have no product_id key
    matching a real request, so the display_type/is_downpayment filter other
    order-line reads in this codebase use isn't needed here for correctness,
    but is kept as defense in depth."""
    rows = odoo.read("sale.order", [order_id], fields=["order_line"])
    if not rows or not rows[0].get("order_line"):
        raise HTTPException(status_code=502, detail="Could not read the order's line items from Odoo")
    lines = odoo.read("sale.order.line", rows[0]["order_line"], fields=["product_id", "display_type", "is_downpayment"])
    matched = 0
    for l in lines:
        if l.get("display_type") or l.get("is_downpayment"):
            continue
        pid = l["product_id"][0] if isinstance(l.get("product_id"), (list, tuple)) else l.get("product_id")
        if pid in pct_by_product:
            odoo.write("sale.order.line", [l["id"]], {"discount": pct_by_product[pid]})
            matched += 1
    if matched == 0:
        raise HTTPException(status_code=502, detail="None of the requested products were found on the order's current lines")


async def _load_pending_request(request_id: str) -> dict:
    try:
        oid = ObjectId(request_id)
    except Exception:
        raise HTTPException(status_code=400, detail="Invalid request ID")
    doc = await col("discount_requests").find_one({"_id": oid})
    if not doc:
        raise HTTPException(status_code=404, detail="Discount request not found")
    if doc["status"] != "pending":
        raise HTTPException(status_code=400, detail=f"This request has already been {doc['status']}")
    return doc


def _assert_not_own_request(doc: dict, current_user: dict) -> None:
    """Separation of duties, enforced unconditionally — including for
    super_admin, which require_permission() itself would otherwise let bypass
    entirely. This is a business rule, not a permission gate."""
    if doc.get("requested_by", {}).get("id") == current_user.get("id"):
        raise HTTPException(status_code=403, detail="You cannot decide your own discount request")


def _discount_amount(doc_lines: list, pct_by_product: dict) -> float:
    return sum(
        l["qty"] * l["unit_price"] * (pct_by_product[l["product_id"]] / 100)
        for l in doc_lines if l["product_id"] in pct_by_product
    )


def _build_final_lines(doc_lines: list, pct_by_product: dict) -> list:
    """The 8.63 reporting/Customer-360 data model needs a durable record of
    what was *actually* granted (approve → the requested %; counter → the
    approver's own %), separate from `lines[]` which stays the immutable
    original ask. Built the same way for both approve and counter so a
    report can treat every granted line identically regardless of which
    path produced it."""
    return [
        {
            "product_id": l["product_id"], "product_name": l["product_name"],
            "qty": l["qty"], "unit_price": l["unit_price"],
            "final_pct": pct_by_product[l["product_id"]],
            "final_amount": l["qty"] * l["unit_price"] * (pct_by_product[l["product_id"]] / 100),
        }
        # A 0% outcome (a removal, or a counter down to nothing) grants no
        # discount, so it isn't a "granted line" for reporting.
        for l in doc_lines if pct_by_product.get(l["product_id"], 0) > 0
    ]


async def _push_ticket_activity(ticket_id: str, current_user: dict, note: str) -> None:
    """Adds a note-only stage_history entry (status/exit_status unchanged) so
    the ticket's Activity Log (frontend/src/components/OrderTimeline.js's
    ActivityLogCard) shows a discount *decision*, not just the original
    request (create_discount_request already pushes one of these for the
    request itself, same shape). Best-effort and silent on failure — this
    must never block a decision that already wrote to Odoo."""
    try:
        ticket = await col("tickets").find_one({"_id": ObjectId(ticket_id)}, {"status": 1, "exit_status": 1})
        if not ticket:
            return
        await col("tickets").update_one(
            {"_id": ticket["_id"]},
            {"$push": {"stage_history": {
                "status": ticket.get("status"), "exit_status": ticket.get("exit_status"),
                "actor_id": current_user["id"], "actor_name": _actor(current_user),
                "at": datetime.now(timezone.utc), "note": note,
            }}},
        )
    except Exception as exc:
        logger.warning("discount_activity_log_failed ticket_id=%s error=%s", ticket_id, exc)


async def _clear_ticket_flag(ticket_id: str, last_decision: Optional[dict] = None) -> None:
    """Clears the blocking pending-request flag (discount_status/
    discount_request_id) — this is what unblocks Send Quote/Confirm Order,
    unchanged. `last_decision`, when given (approve/reject/counter, never
    cancel/withdraw — there's nothing to relay to a customer about a request
    that was simply withdrawn), is separately stamped as `last_discount_decision`
    and is NEVER cleared here or anywhere else — it's the durable record the
    Sales Ticket detail page's decision banner and the ticket list's badge
    read from, and it must keep showing the latest outcome even once the
    blocking flag above is gone (2026-09-30, requested so sales staff always
    know, at a glance, whether to contact the customer about a counter and
    why)."""
    try:
        update: dict = {"$unset": {"discount_status": "", "discount_request_id": ""}}
        if last_decision:
            update["$set"] = {"last_discount_decision": last_decision}
        await col("tickets").update_one({"_id": ObjectId(ticket_id)}, update)
    except Exception:
        pass  # Best-effort — the request doc's own status is the durable source of truth


@router.post("/")
async def create_discount_request(
    body: DiscountRequestCreate,
    background_tasks: BackgroundTasks,
    current_user: dict = Depends(require_permission("tickets.sales")),
):
    try:
        oid = ObjectId(body.ticket_id)
    except Exception:
        raise HTTPException(status_code=400, detail="Invalid ticket ID")
    ticket = await col("tickets").find_one({"_id": oid})
    if not ticket:
        raise HTTPException(status_code=404, detail="Ticket not found")
    if ticket.get("exit_status"):
        raise HTTPException(status_code=400, detail=f"Ticket is already closed as '{ticket['exit_status']}'")
    if not ticket.get("order_id"):
        raise HTTPException(status_code=400, detail="Build a quote before requesting a discount")
    if ticket.get("discount_status") == "pending":
        raise HTTPException(status_code=400, detail="A discount request is already pending on this quote")
    if not body.lines:
        raise HTTPException(status_code=400, detail="At least one line is required")
    if not (body.reason or "").strip():
        raise HTTPException(status_code=400, detail="A reason is required")
    for l in body.lines:
        if not (0 <= l.requested_pct <= 100):
            raise HTTPException(status_code=400, detail="Discount percentage must be between 0 and 100")

    odoo = get_odoo_client()
    try:
        order_rows = odoo.read("sale.order", [ticket["order_id"]], fields=["name", "amount_total", "amount_untaxed", "amount_tax"])
    except Exception as e:
        raise HTTPException(status_code=502, detail=f"Odoo error: {str(e)}")
    order_name = order_rows[0]["name"] if order_rows else str(ticket["order_id"])
    order_total = order_rows[0]["amount_total"] if order_rows else None

    # 2026-10-07: round each % to what Odoo will actually store, and record
    # each line's tax rate + the discount already on it, so every screen can
    # show Rand figures and a true before/after total (incl. VAT) without
    # going back to Odoo. tax_rate/current_pct come from the server's own
    # read of the order, never from the client.
    digits = _discount_digits(odoo)
    line_ctx = _order_line_context(odoo, ticket["order_id"])
    snapshot_lines = []
    for l in body.lines:
        d = l.model_dump()
        d["requested_pct"] = _round_pct(l.requested_pct, digits)
        ctx = line_ctx.get(l.product_id)
        if ctx:
            d["tax_rate"] = ctx["tax_rate"]
            d["current_pct"] = ctx["current_pct"]
            # Cleared a discount that's on the quote now: that's a request
            # to remove it, decided like any other line (server-side, from
            # Odoo's own current figure, never trusted from the client).
            if d["requested_pct"] == 0 and (ctx["current_pct"] or 0) > 0:
                d["is_removal"] = True
        snapshot_lines.append(d)
    if not any(_in_request(d) for d in snapshot_lines):
        if any(l.requested_pct > 0 for l in body.lines):
            raise HTTPException(status_code=400, detail="The discount entered rounds to 0%. Enter a larger discount.")
        raise HTTPException(status_code=400, detail="Enter a discount on at least one line, or clear an existing discount to remove it")

    now = datetime.now(timezone.utc)
    doc = {
        "ticket_id": body.ticket_id,
        "order_id": ticket["order_id"],
        "order_name": order_name,
        "order_total": order_total,
        "order_untaxed": order_rows[0]["amount_untaxed"] if order_rows else None,
        "order_tax": order_rows[0]["amount_tax"] if order_rows else None,
        "discount_digits": digits,
        "customer_name": ticket.get("customer_name", ""),
        # Resolved the same way ticket_routes.py::_ticket_customer_partner_id
        # does (prefer the resolved-company id over a contact-person id) —
        # inlined rather than imported to avoid a route-importing-route risk,
        # matching this codebase's precedent for trivial one-liners shared
        # across route files. Lets 8.63's reporting/Customer 360 features
        # group reliably by company rather than matching on customer_name
        # text. May be None for a ticket predating this field or with no
        # resolved customer id at all — reporting groups those separately
        # rather than merging them under different customers by mistake.
        "customer_partner_id": ticket.get("customer_company_id") or ticket.get("customer_id"),
        "requested_by": {"id": current_user["id"], "name": _actor(current_user)},
        "reason": body.reason.strip(),
        "status": "pending",
        # Every line on the order, not just the discounted ones (2026-09-28) —
        # requested_pct is 0 for a line the requester left alone. This is what
        # lets the approval queue show the full order in context rather than
        # only the discounted lines in isolation.
        "lines": snapshot_lines,
        # Populated only on approve/counter (8.63) — the *actual* discount
        # granted, distinct from `lines[]` (the immutable original ask).
        # Reject/cancel leave this empty since nothing was ever given.
        "final_lines": [],
        "decision": None,
        "created_at": now,
        "updated_at": now,
    }
    result = await col("discount_requests").insert_one(doc)
    request_id = str(result.inserted_id)
    n = sum(1 for d in snapshot_lines if _in_request(d))
    await col("tickets").update_one(
        {"_id": oid},
        {
            "$set": {"discount_status": "pending", "discount_request_id": request_id, "updated_at": now},
            "$push": {"stage_history": {
                "status": ticket["status"], "exit_status": None,
                "actor_id": current_user["id"], "actor_name": _actor(current_user),
                "at": now, "note": f"Discount requested ({n} line{'s' if n != 1 else ''}): {body.reason.strip()}",
            }},
        },
    )
    await audit_log(
        "discount_request.create", "discount_request", request_id,
        entity_label=f"{order_name} - {ticket.get('customer_name','')}",
        user=current_user, after=doc,
    )
    routing = await get_email_routing()
    to = routing.get("discount_request_to") or []
    if to:
        requested = {d["product_id"]: d["requested_pct"] for d in snapshot_lines if _in_request(d)}
        after = _totals_for(snapshot_lines, lambda l: _effective_pct(l, requested))
        background_tasks.add_task(
            send_discount_request_notification, to, order_name, ticket.get("customer_name", ""),
            _actor(current_user), body.reason.strip(),
            [
                {
                    "product_name": d["product_name"], "requested_pct": d["requested_pct"],
                    "per_unit_off": d["unit_price"] * d["requested_pct"] / 100,
                    "line_off": d["qty"] * d["unit_price"] * d["requested_pct"] / 100,
                    "qty": d["qty"],
                    "is_removal": bool(d.get("is_removal")),
                    "current_pct": d.get("current_pct"),
                }
                for d in snapshot_lines if _in_request(d)
            ],
            request_id,
            total_now=order_total,
            total_after=after["total"] if after else None,
        )
    return {"success": True, "request_id": request_id}


@router.get("/")
async def list_discount_requests(
    status: Optional[str] = None,
    customer_partner_id: Optional[int] = None,
    product_id: Optional[int] = None,
    requested_by_id: Optional[str] = None,
    date_from: Optional[str] = None,
    date_to: Optional[str] = None,
    current_user: dict = Depends(require_permission("discounts.approve")),
):
    """8.63: filters for the Discount Approvals screen's filter bar (Customer
    360's own drill-through uses customer_partner_id alone). product_id
    matches against the full lines[] snapshot, not just final_lines, so a
    still-pending or rejected request involving that product is still
    findable — reporting is what cares specifically about *granted*
    discounts, not this list."""
    query: dict = {}
    if status:
        query["status"] = status
    if customer_partner_id is not None:
        query["customer_partner_id"] = customer_partner_id
    if product_id is not None:
        query["lines.product_id"] = product_id
    if requested_by_id:
        query["requested_by.id"] = requested_by_id
    if date_from or date_to:
        date_query: dict = {}
        if date_from:
            date_query["$gte"] = datetime.strptime(date_from, "%Y-%m-%d").replace(tzinfo=timezone.utc)
        if date_to:
            # End-of-day, inclusive — a bare "$lte" on midnight would exclude
            # every request created later that same day (matches
            # report_routes.py::parse_date_str's own end_of_day convention).
            date_query["$lte"] = datetime.strptime(date_to, "%Y-%m-%d").replace(
                hour=23, minute=59, second=59, tzinfo=timezone.utc
            )
        query["created_at"] = date_query
    docs = await col("discount_requests").find(query).sort("created_at", -1).to_list(length=500)
    return {"requests": [_serialize(d) for d in docs]}


def _fetch_costs(odoo, product_ids: list) -> dict:
    """Batch-reads product.product.standard_price for a set of ids, returning
    {product_id: cost_or_None}. A cost of exactly 0 is treated as "not set"
    (2026-09-29 live probe: 100% of Bassani's 1,592 active sellable products
    have standard_price == 0 — nobody has entered cost data in Odoo yet) —
    every consumer of this must show "not set" rather than a fabricated
    R0.00/100%-margin figure. Never raises; a failed Odoo read degrades every
    id to unknown rather than failing the whole request."""
    if not product_ids:
        return {}
    try:
        rows = odoo.read("product.product", product_ids, fields=["standard_price"])
        return {r["id"]: (r["standard_price"] or None) for r in rows}
    except Exception as exc:
        logger.warning("discount_cost_lookup_failed product_ids=%s error=%s", product_ids, exc)
        return {pid: None for pid in product_ids}


@router.get("/precision")
async def get_discount_precision(
    current_user: dict = Depends(require_any_permission("discounts.approve", "tickets.sales")),
):
    """How many decimals Odoo keeps on a discount %, so the request and
    counter modals can show exactly the % (and Rand) that will be applied.
    Literal path: must stay registered before /{request_id}."""
    return {"discount_digits": _discount_digits(get_odoo_client())}


@router.get("/{request_id}/financial-detail")
async def get_discount_financial_detail(
    request_id: str,
    current_user: dict = Depends(require_permission("discounts.approve")),
):
    """8.63 — cost price per line (every line, matching the existing
    full-order-context convention) plus a request-level rollup, fetched once
    when an approver expands a row rather than per-product-click. BOM detail
    is deliberately a separate, on-demand endpoint (get_discount_bom below)
    since most products have none and it isn't worth an mrp.bom search per
    line on every row expansion."""
    try:
        oid = ObjectId(request_id)
    except Exception:
        raise HTTPException(status_code=400, detail="Invalid request ID")
    doc = await col("discount_requests").find_one({"_id": oid})
    if not doc:
        raise HTTPException(status_code=404, detail="Discount request not found")

    odoo = get_odoo_client()
    product_ids = list({l["product_id"] for l in doc["lines"]})
    costs = _fetch_costs(odoo, product_ids)

    lines_out = []
    discounted_known = []  # lines with requested_pct > 0 AND a known cost
    total_requested_discount = 0.0
    for l in doc["lines"]:
        cost = costs.get(l["product_id"])
        lines_out.append({
            **l, "cost_price": cost, "cost_set": cost is not None,
        })
        if l.get("requested_pct"):
            amt = l["qty"] * l["unit_price"] * (l["requested_pct"] / 100)
            total_requested_discount += amt
            if cost is not None:
                discounted_known.append({**l, "cost_price": cost})

    rollup = {
        "order_total": doc.get("order_total"),
        "total_requested_discount": total_requested_discount,
        "discounted_lines_count": sum(1 for l in doc["lines"] if (l.get("requested_pct") or 0) > 0),
        "lines_with_known_cost": sum(1 for c in costs.values() if c is not None),
        "lines_total": len(product_ids),
        "margin": None,
    }
    if discounted_known:
        unit_value = sum(l["qty"] * l["unit_price"] for l in discounted_known)
        discounted_value = sum(l["qty"] * l["unit_price"] * (1 - l["requested_pct"] / 100) for l in discounted_known)
        cost_value = sum(l["qty"] * l["cost_price"] for l in discounted_known)
        margin_impact = sum(l["qty"] * l["unit_price"] * (l["requested_pct"] / 100) for l in discounted_known)
        rollup["margin"] = {
            "lines_covered": len(discounted_known),
            "lines_discounted_total": rollup["discounted_lines_count"],
            "margin_before_pct": (unit_value - cost_value) / unit_value * 100 if unit_value else None,
            "margin_after_pct": (discounted_value - cost_value) / discounted_value * 100 if discounted_value else None,
            "margin_impact_total": margin_impact,
        }
    return {"lines": lines_out, "rollup": rollup}


@router.get("/{request_id}/bom/{product_id}")
async def get_discount_bom(
    request_id: str,
    product_id: int,
    current_user: dict = Depends(require_permission("discounts.approve")),
):
    """8.63 — on-demand BOM breakdown behind the Cost Price column's click
    target. Live probe (2026-09-29, read-only): mrp.bom/mrp.bom.line are
    accessible with the fields used here, but coverage for what's actually
    sold is almost nonexistent (2 of 147 recently-ordered products had any
    BOM at all) — this degrades to found: false rather than erroring, since
    "no BOM" is the expected common case, not a failure."""
    try:
        ObjectId(request_id)  # validated for consistency with sibling endpoints; not otherwise used
    except Exception:
        raise HTTPException(status_code=400, detail="Invalid request ID")

    odoo = get_odoo_client()
    prod_rows = odoo.read("product.product", [product_id], fields=["name", "standard_price", "product_tmpl_id"])
    if not prod_rows:
        raise HTTPException(status_code=404, detail="Product not found in Odoo")
    prod = prod_rows[0]
    cost = prod["standard_price"] or None
    tmpl_id = prod["product_tmpl_id"][0] if prod.get("product_tmpl_id") else None

    bom_out = {"found": False, "bom_id": None, "type": None, "components": [], "total_component_cost": None,
               "components_with_cost": 0, "components_total": 0}
    if tmpl_id:
        try:
            boms = odoo.search_read(
                "mrp.bom", domain=[["product_tmpl_id", "=", tmpl_id], ["active", "=", True]],
                fields=["type", "bom_line_ids"], limit=1,
            )
        except Exception as exc:
            logger.warning("discount_bom_lookup_failed product_id=%s error=%s", product_id, exc)
            boms = []
        if boms and boms[0].get("bom_line_ids"):
            bom = boms[0]
            bom_lines = odoo.read("mrp.bom.line", bom["bom_line_ids"], fields=["product_id", "product_qty"])
            comp_ids = list({bl["product_id"][0] for bl in bom_lines if bl.get("product_id")})
            comp_costs = _fetch_costs(odoo, comp_ids)
            comp_names = {r["id"]: r["name"] for r in (odoo.read("product.product", comp_ids, fields=["name"]) if comp_ids else [])}
            components = []
            total_known = 0.0
            known_count = 0
            for bl in bom_lines:
                pid = bl["product_id"][0] if bl.get("product_id") else None
                c_cost = comp_costs.get(pid)
                components.append({
                    "product_id": pid, "name": comp_names.get(pid, ""),
                    "qty_per_unit": bl["product_qty"], "unit_cost": c_cost, "cost_set": c_cost is not None,
                })
                if c_cost is not None:
                    total_known += bl["product_qty"] * c_cost
                    known_count += 1
            bom_out = {
                "found": True, "bom_id": bom["id"], "type": bom.get("type"),
                "components": components,
                "total_component_cost": total_known if known_count else None,
                "components_with_cost": known_count, "components_total": len(components),
            }
    return {
        "product_id": product_id, "product_name": prod["name"],
        "cost_price": cost, "cost_set": cost is not None,
        "bom": bom_out,
    }


@router.get("/customer-summary/{customer_partner_id}")
async def get_customer_discount_summary(
    customer_partner_id: int,
    current_user: dict = Depends(require_permission("discounts.approve")),
):
    """8.63 — backs the Customer 360 Discounts card. Only counts requests
    that actually granted something (approved/countered) toward the total R
    figure — a rejected or still-pending request never discounted anything,
    so it would be misleading to include it in "how much this customer has
    been given"."""
    docs = await col("discount_requests").find({"customer_partner_id": customer_partner_id}).to_list(length=500)
    granted = [d for d in docs if d["status"] in ("approved", "countered")]
    total_amount = sum(fl["final_amount"] for d in granted for fl in d.get("final_lines", []))
    all_pcts = [fl["final_pct"] for d in granted for fl in d.get("final_lines", [])]
    return {
        "total_requests": len(docs),
        "approved_count": sum(1 for d in docs if d["status"] == "approved"),
        "countered_count": sum(1 for d in docs if d["status"] == "countered"),
        "rejected_count": sum(1 for d in docs if d["status"] == "rejected"),
        "pending_count": sum(1 for d in docs if d["status"] == "pending"),
        "total_discount_amount": total_amount,
        "avg_pct": sum(all_pcts) / len(all_pcts) if all_pcts else 0,
    }


@router.get("/{request_id}")
async def get_discount_request(
    request_id: str,
    current_user: dict = Depends(require_any_permission("discounts.approve", "tickets.sales")),
):
    try:
        oid = ObjectId(request_id)
    except Exception:
        raise HTTPException(status_code=400, detail="Invalid request ID")
    doc = await col("discount_requests").find_one({"_id": oid})
    if not doc:
        raise HTTPException(status_code=404, detail="Discount request not found")
    return _serialize(doc)


@router.post("/{request_id}/approve")
async def approve_discount_request(
    request_id: str,
    body: DiscountDecisionBody,
    background_tasks: BackgroundTasks,
    current_user: dict = Depends(require_permission("discounts.approve")),
):
    doc = await _load_pending_request(request_id)
    _assert_not_own_request(doc, current_user)
    # doc["lines"] is the full order snapshot (2026-09-28) — only the lines
    # actually in the request get written: a requested discount, or 0% for a
    # requested removal (2026-10-07).
    pct_by_product = {l["product_id"]: l.get("requested_pct") or 0 for l in doc["lines"] if _in_request(l)}
    odoo = get_odoo_client()
    _write_line_discounts(odoo, doc["order_id"], pct_by_product)

    now = datetime.now(timezone.utc)
    note = (body.note or "").strip() or None
    decision = {"by": {"id": current_user["id"], "name": _actor(current_user)}, "at": now, "note": note}
    n, avg_pct, amount, removed = _decision_stats(doc["lines"], pct_by_product)
    final_lines = _build_final_lines(doc["lines"], pct_by_product)
    await col("discount_requests").update_one(
        {"_id": doc["_id"]}, {"$set": {"status": "approved", "decision": decision, "final_lines": final_lines, "updated_at": now}},
    )
    await _clear_ticket_flag(doc["ticket_id"], last_decision={
        "request_id": request_id, "status": "approved",
        "decided_by": _actor(current_user), "decided_at": now, "note": note,
        "lines_count": n, "avg_pct": avg_pct, "total_amount": amount, "removed_count": removed,
    })
    activity_note = f"Discount approved: {n} line{'s' if n != 1 else ''}, R{amount:,.2f} excl. VAT (avg {avg_pct:.1f}%)"
    if removed:
        activity_note += f"; discount removed from {removed} line{'s' if removed != 1 else ''}"
    if note:
        activity_note += f' (note: "{note}")'
    await _push_ticket_activity(doc["ticket_id"], current_user, activity_note)
    await audit_log(
        "discount_request.approve", "discount_request", request_id,
        entity_label=doc["order_name"], user=current_user, after=decision,
    )
    requester_email = await _resolve_user_email(doc.get("requested_by", {}).get("id"))
    if requester_email:
        routing = await get_email_routing()
        cc = [e for e in (routing.get("discount_request_to") or []) if e != requester_email]
        background_tasks.add_task(
            send_discount_decision_notification, requester_email, doc["order_name"], doc["customer_name"],
            "approved", _actor(current_user), request_id, note or "", cc,
        )
    return {"success": True}


@router.post("/{request_id}/reject")
async def reject_discount_request(
    request_id: str,
    body: DiscountDecisionBody,
    background_tasks: BackgroundTasks,
    current_user: dict = Depends(require_permission("discounts.approve")),
):
    doc = await _load_pending_request(request_id)
    _assert_not_own_request(doc, current_user)
    # A reason is mandatory (2026-09-30) — sales staff read this straight off
    # the ticket's decision banner to know what to tell the customer; a
    # rejection with no reason leaves them unable to explain why.
    note = (body.note or "").strip()
    if not note:
        raise HTTPException(status_code=400, detail="A reason is required so sales staff can explain the rejection to the customer")

    now = datetime.now(timezone.utc)
    decision = {"by": {"id": current_user["id"], "name": _actor(current_user)}, "at": now, "note": note}
    await col("discount_requests").update_one(
        {"_id": doc["_id"]}, {"$set": {"status": "rejected", "decision": decision, "updated_at": now}},
    )
    await _clear_ticket_flag(doc["ticket_id"], last_decision={
        "request_id": request_id, "status": "rejected",
        "decided_by": _actor(current_user), "decided_at": now, "note": note,
    })
    activity_note = "Discount request rejected"
    if note:
        activity_note += f' (reason: "{note}")'
    await _push_ticket_activity(doc["ticket_id"], current_user, activity_note)
    await audit_log(
        "discount_request.reject", "discount_request", request_id,
        entity_label=doc["order_name"], user=current_user, after=decision,
    )
    requester_email = await _resolve_user_email(doc.get("requested_by", {}).get("id"))
    if requester_email:
        routing = await get_email_routing()
        cc = [e for e in (routing.get("discount_request_to") or []) if e != requester_email]
        background_tasks.add_task(
            send_discount_decision_notification, requester_email, doc["order_name"], doc["customer_name"],
            "rejected", _actor(current_user), request_id, note or "", cc,
        )
    return {"success": True}


@router.post("/{request_id}/counter")
async def counter_discount_request(
    request_id: str,
    body: DiscountCounterBody,
    background_tasks: BackgroundTasks,
    current_user: dict = Depends(require_permission("discounts.approve")),
):
    doc = await _load_pending_request(request_id)
    _assert_not_own_request(doc, current_user)
    if not body.lines:
        raise HTTPException(status_code=400, detail="At least one line is required")
    # A reason is mandatory (2026-09-30) — a counter is exactly the case
    # sales staff must go back to the customer about, so there must always
    # be something to tell them.
    note = (body.note or "").strip()
    if not note:
        raise HTTPException(status_code=400, detail="A reason is required so sales staff can explain the counter-offer to the customer")
    # Only lines that were actually asked about can be countered — a line the
    # requester left alone (requested_pct 0, kept only for full-order context)
    # is not a candidate. Every originally-requested line must be resolved by
    # this one counter call, no more and no less (2026-09-29 tightening) — an
    # approver leaving a requested line out used to silently skip a decision
    # on it (no discount written, no record it was ever considered), which
    # isn't acceptable for an approval workflow. Reject/Approve stay whole-
    # request decisions already; Counter now is too, just at a per-line rate.
    requested_pids = {l["product_id"] for l in doc["lines"] if _in_request(l)}
    submitted_pids = {l.product_id for l in body.lines}
    if submitted_pids - requested_pids:
        raise HTTPException(status_code=400, detail="Cannot counter a product that wasn't part of the original request")
    if requested_pids - submitted_pids:
        raise HTTPException(status_code=400, detail="Every originally requested line must be included in the counter-offer")
    odoo = get_odoo_client()
    digits = _discount_digits(odoo)
    pct_by_product: dict = {}
    for l in body.lines:
        if not (0 <= l.approved_pct <= 100):
            raise HTTPException(status_code=400, detail="Discount percentage must be between 0 and 100")
        # Rounded to what Odoo stores, so the recorded decision and every
        # Rand figure derived from it match what the customer is charged.
        pct_by_product[l.product_id] = _round_pct(l.approved_pct, digits)

    _write_line_discounts(odoo, doc["order_id"], pct_by_product)

    now = datetime.now(timezone.utc)
    decision = {
        "by": {"id": current_user["id"], "name": _actor(current_user)}, "at": now, "note": note,
        "applied_lines": [{"product_id": pid, "approved_pct": pct} for pid, pct in pct_by_product.items()],
    }
    n, avg_pct, amount, removed = _decision_stats(doc["lines"], pct_by_product)
    final_lines = _build_final_lines(doc["lines"], pct_by_product)
    await col("discount_requests").update_one(
        {"_id": doc["_id"]}, {"$set": {"status": "countered", "decision": decision, "final_lines": final_lines, "updated_at": now}},
    )
    await _clear_ticket_flag(doc["ticket_id"], last_decision={
        "request_id": request_id, "status": "countered",
        "decided_by": _actor(current_user), "decided_at": now, "note": note,
        "lines_count": n, "avg_pct": avg_pct, "total_amount": amount, "removed_count": removed,
    })
    activity_note = f"Discount countered: {n} line{'s' if n != 1 else ''} discounted, R{amount:,.2f} excl. VAT (avg {avg_pct:.1f}%)"
    if removed:
        activity_note += f"; no discount on {removed} line{'s' if removed != 1 else ''}"
    if note:
        activity_note += f' (note: "{note}")'
    await _push_ticket_activity(doc["ticket_id"], current_user, activity_note)
    await audit_log(
        "discount_request.counter", "discount_request", request_id,
        entity_label=doc["order_name"], user=current_user, after=decision,
    )
    requester_email = await _resolve_user_email(doc.get("requested_by", {}).get("id"))
    if requester_email:
        routing = await get_email_routing()
        cc = [e for e in (routing.get("discount_request_to") or []) if e != requester_email]
        background_tasks.add_task(
            send_discount_decision_notification, requester_email, doc["order_name"], doc["customer_name"],
            "countered", _actor(current_user), request_id, note or "", cc,
        )
    return {"success": True}


@router.post("/{request_id}/cancel")
async def cancel_discount_request(
    request_id: str,
    current_user: dict = Depends(require_permission("tickets.sales")),
):
    """Withdraws a still-pending request — the requester changed their mind,
    or is about to edit the quote's lines (the frontend also calls this, or
    relies on the same-shape auto-cancel in update_order_from_ticket, before
    saving an edit while a request is pending). The requester or an admin
    can withdraw; nobody else."""
    doc = await _load_pending_request(request_id)
    is_owner = doc.get("requested_by", {}).get("id") == current_user.get("id")
    if not (is_owner or current_user.get("is_super_admin") or current_user.get("role") in ("super_admin", "admin")):
        raise HTTPException(status_code=403, detail="Only the requester or an admin can withdraw this request")

    now = datetime.now(timezone.utc)
    decision = {"by": {"id": current_user["id"], "name": _actor(current_user)}, "at": now, "note": "Withdrawn"}
    await col("discount_requests").update_one(
        {"_id": doc["_id"]}, {"$set": {"status": "cancelled", "decision": decision, "updated_at": now}},
    )
    await _clear_ticket_flag(doc["ticket_id"])
    await audit_log(
        "discount_request.cancel", "discount_request", request_id,
        entity_label=doc["order_name"], user=current_user,
    )
    return {"success": True}
