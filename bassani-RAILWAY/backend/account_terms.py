"""Customer account terms — Phase 8.68.

An approved account customer can have a confirmed order "released on account":
it skips the 50% deposit, runs the normal packing/QA/RP pipeline, and is
invoiced unpaid at Mark Complete with a due date from their payment terms.

Approval is a portal decision (customer_metadata.account_terms, keyed by the
customer's commercial partner); the financial facts it rests on — payment
terms, credit limit, receivable balance, overdue amount — are always read live
from Odoo, which stays the source of truth. If someone changes the terms or
removes the credit limit in Odoo, release stops working without any portal
change.

Odoo stores `credit_limit` and `property_payment_term_id` per company
(company_dependent, live-verified 2026-10-10), and Bassani trades through more
than one company, so approval lists the trading companies it covers and every
check runs in the order's own company context.

Kept at root level (like ownership.py/contacts.py) because customer_routes,
ticket_routes and order_routes all need it — importing it from a route file
would create a route-importing-route cycle.
"""
import time
from datetime import date, datetime, timezone
from typing import Optional

from database import col
from warehouse_context import company_context

_TRADING_COMPANIES_CACHE: dict = {"at": 0.0, "rows": []}
_CACHE_SECONDS = 600


def _f(v):
    """Odoo returns False for an unset field — normalise to None."""
    return None if v is False else v


def commercial_partner_id(odoo, partner_id: int) -> int:
    """Resolve any partner (a contact person or the company) to its commercial
    partner — account terms are always held at company level."""
    try:
        rows = odoo.read("res.partner", [partner_id], fields=["commercial_partner_id"])
        cp = rows[0].get("commercial_partner_id") if rows else None
        return cp[0] if cp else partner_id
    except Exception:
        return partner_id


def trading_companies(odoo) -> list:
    """Companies that own at least one warehouse — the only companies an order
    can ever be placed under, and so the only ones account terms can apply to."""
    now = time.time()
    if _TRADING_COMPANIES_CACHE["rows"] and now - _TRADING_COMPANIES_CACHE["at"] < _CACHE_SECONDS:
        return _TRADING_COMPANIES_CACHE["rows"]
    rows = odoo.search_read("stock.warehouse", [], fields=["company_id"], limit=200)
    seen: dict = {}
    for w in rows:
        co = w.get("company_id")
        if co and co[0] not in seen:
            seen[co[0]] = {"id": co[0], "name": co[1]}
    result = sorted(seen.values(), key=lambda c: c["name"])
    _TRADING_COMPANIES_CACHE.update(at=now, rows=result)
    return result


def payment_terms_catalog(odoo) -> list:
    """Every active Odoo payment term, flagged `is_credit` when any part of the
    balance is due later than invoice date (e.g. "30 Days", "End of Following
    Month"). "Immediate Payment" — a single 0-day line — is not a credit term."""
    terms = odoo.search_read("account.payment.term", [], fields=["id", "name", "line_ids"], limit=200)
    line_ids = [lid for t in terms for lid in (t.get("line_ids") or [])]
    lines = {}
    if line_ids:
        for ln in odoo.read("account.payment.term.line", line_ids, fields=["nb_days", "delay_type"]):
            lines[ln["id"]] = ln
    out = []
    for t in terms:
        tl = [lines[i] for i in (t.get("line_ids") or []) if i in lines]
        is_credit = any(
            (ln.get("nb_days") or 0) > 0 or (ln.get("delay_type") or "days_after") != "days_after"
            for ln in tl
        )
        out.append({"id": t["id"], "name": t["name"], "is_credit": is_credit})
    return out


def is_credit_term(odoo, term_id: Optional[int]) -> bool:
    if not term_id:
        return False
    return any(t["id"] == term_id and t["is_credit"] for t in payment_terms_catalog(odoo))


async def get_account_terms(partner_id: int) -> Optional[dict]:
    meta = await col("customer_metadata").find_one({"odoo_partner_id": partner_id}, {"account_terms": 1, "_id": 0})
    return (meta or {}).get("account_terms")


def review_overdue(terms: Optional[dict]) -> bool:
    rd = (terms or {}).get("review_date")
    if not rd:
        return False
    try:
        return date.fromisoformat(str(rd)[:10]) < datetime.now(timezone.utc).date()
    except ValueError:
        return False


def is_approved_for_company(terms: Optional[dict], company_id: Optional[int]) -> bool:
    """Portal-side approval only (status, company coverage, review date) — no
    Odoo call. Used where a cheap yes/no is enough, e.g. choosing which email
    to send at confirm time. Release itself always uses evaluate_release()."""
    if not terms or terms.get("status") != "approved":
        return False
    if company_id and company_id not in (terms.get("company_ids") or []):
        return False
    return not review_overdue(terms)


async def _uninvoiced_on_account_exposure(partner_id: int, company_id: Optional[int],
                                          exclude_ticket_id=None) -> float:
    """Orders already released on account but not yet invoiced aren't in
    Odoo's receivable balance (`credit`) yet, so they're added to the exposure
    here — otherwise several releases in a row could each pass the credit check
    and together blow through the limit. Once an order's final invoice exists,
    Odoo's balance covers it and it drops out of this sum."""
    query: dict = {
        "type": "sales",
        "payment_arrangement": "on_account",
        "exit_status": None,
        "$or": [{"customer_company_id": partner_id}, {"customer_id": partner_id}],
    }
    if company_id:
        query["on_account_company_id"] = company_id
    if exclude_ticket_id:
        query["_id"] = {"$ne": exclude_ticket_id}
    tickets = await col("tickets").find(query, {"order_id": 1, "on_account_amount": 1}).to_list(500)
    if not tickets:
        return 0.0
    order_ids = [str(t["order_id"]) for t in tickets if t.get("order_id")]
    invoiced = set()
    async for e in col("packing_board").find(
        {"order_id": {"$in": order_ids}, "invoice_id": {"$nin": [None, False]}}, {"order_id": 1}
    ):
        invoiced.add(e["order_id"])
    return round(sum(float(t.get("on_account_amount") or 0)
                     for t in tickets if str(t.get("order_id")) not in invoiced), 2)


def read_company_credit(odoo, partner_id: int, company_id: Optional[int]) -> dict:
    """The customer's Odoo credit position in one company."""
    ctx = company_context(company_id) or None
    rows = odoo.read(
        "res.partner", [partner_id],
        fields=["property_payment_term_id", "credit_limit", "credit", "total_overdue"],
        context=ctx,
    )
    r = rows[0] if rows else {}
    term = _f(r.get("property_payment_term_id"))
    return {
        "payment_term": {"id": term[0], "name": term[1]} if term else None,
        "credit_limit": float(r.get("credit_limit") or 0),
        "credit": float(r.get("credit") or 0),
        "total_overdue": float(r.get("total_overdue") or 0),
    }


async def evaluate_release(odoo, partner_id: int, company_id: Optional[int],
                           order_total: float, exclude_ticket_id=None) -> dict:
    """Can this order be released on account right now? `blocks` stop release;
    `warnings` are shown but don't. Always reads Odoo live."""
    terms = await get_account_terms(partner_id)
    blocks: list = []
    warnings: list = []
    company_name = None
    try:
        company_name = next((c["name"] for c in trading_companies(odoo) if c["id"] == company_id), None)
    except Exception:
        pass

    if not terms:
        blocks.append("This customer is not approved for account terms. Approve them on the customer profile first.")
    elif terms.get("status") != "approved":
        blocks.append(
            "This customer's account terms are suspended"
            + (f": {terms.get('suspended_reason')}" if terms.get("suspended_reason") else ".")
        )
    else:
        if company_id and company_id not in (terms.get("company_ids") or []):
            blocks.append(f"Account terms are not approved for {company_name or 'this order’s company'}.")
        if review_overdue(terms):
            blocks.append(
                f"The account terms review date ({terms.get('review_date')}) has passed. "
                "Re-approve the account terms on the customer profile to continue."
            )

    credit = {"payment_term": None, "credit_limit": 0.0, "credit": 0.0, "total_overdue": 0.0}
    try:
        credit = read_company_credit(odoo, partner_id, company_id)
    except Exception as e:
        blocks.append(f"Could not read the customer's credit position: {e}")

    pending = await _uninvoiced_on_account_exposure(partner_id, company_id, exclude_ticket_id)
    exposure = round(credit["credit"] + pending + float(order_total or 0), 2)
    available = round(credit["credit_limit"] - credit["credit"] - pending, 2)

    if terms and terms.get("status") == "approved":
        term = credit["payment_term"]
        if not term or not is_credit_term(odoo, term["id"]):
            blocks.append(
                "The customer has no credit payment terms set for this company "
                f"(currently {term['name'] if term else 'none'}). Re-approve the account terms to set them."
            )
        if credit["credit_limit"] <= 0:
            blocks.append("The customer has no credit limit set for this company.")
        elif exposure > credit["credit_limit"]:
            blocks.append(
                f"This order would take the customer over their credit limit by "
                f"R{exposure - credit['credit_limit']:,.2f} (limit R{credit['credit_limit']:,.2f}, "
                f"available R{max(available, 0):,.2f}, order R{float(order_total or 0):,.2f})."
            )
    if credit["total_overdue"] > 0:
        warnings.append(f"The customer has R{credit['total_overdue']:,.2f} in overdue invoices.")

    return {
        "eligible": not blocks,
        "blocks": blocks,
        "warnings": warnings,
        "company_id": company_id,
        "company_name": company_name,
        "order_total": float(order_total or 0),
        "payment_term": credit["payment_term"],
        "credit_limit": credit["credit_limit"],
        "balance": credit["credit"],
        "pending_on_account": pending,
        "available_credit": available,
        "total_overdue": credit["total_overdue"],
        "terms": {
            "status": (terms or {}).get("status"),
            "reference": (terms or {}).get("reference"),
            "review_date": (terms or {}).get("review_date"),
            "approved_by_name": (terms or {}).get("approved_by_name"),
        } if terms else None,
    }
