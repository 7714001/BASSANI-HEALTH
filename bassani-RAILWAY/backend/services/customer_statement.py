"""
Customer statement of account (7.17).

Built from the customer's receivable journal items in Odoo
(account.move.line on an asset_receivable account, posted), not from
account.move invoices. That is the accounting source a real statement is
drawn from: it carries invoices, credit notes, payments, unallocated
payments and manual adjustments, so the running balance always agrees with
Odoo's own receivable balance for the customer. The old 7.3 statement read
invoices only and so could never show a payment.

Scoped to one Odoo company at a time. Bassani trades through several
companies, each its own legal entity with its own banking details, so a
statement never mixes them. Matches the customer's company and every
contact under it (`child_of`), so an invoice raised against a contact
person still appears on the company's statement.

All field names were checked live against Odoo 19 (2026-10-11).
Plain sync functions; callers run them the same way every other Odoo read
in the route files does.
"""
from datetime import date, datetime
from typing import Optional

from config import get_settings
from odoo_client import odoo as odoo_call

settings = get_settings()

# Ageing buckets, oldest last. "current" = not yet due.
AGE_BUCKETS = [
    ("current", "Current"),
    ("d30",     "1-30 days"),
    ("d60",     "31-60 days"),
    ("d90",     "61-90 days"),
    ("d120",    "91-120 days"),
    ("older",   "Over 120 days"),
]

# Hard ceiling on journal items read for one statement. A statement that
# hits it says so (`truncated`) rather than silently dropping rows, which is
# what the 7.3 statement's flat limit=200 used to do.
MAX_LINES = 5000
_PAGE = 500

_LINE_FIELDS = [
    "move_id", "move_name", "move_type", "date", "date_maturity",
    "debit", "credit", "balance", "amount_residual",
    "name", "ref", "payment_id", "company_id",
]


def _clean(v):
    """Odoo returns False for an unset field over XML-RPC."""
    return None if v is False else v


def _parse_date(s: Optional[str]) -> Optional[date]:
    if not s:
        return None
    try:
        return datetime.strptime(str(s)[:10], "%Y-%m-%d").date()
    except ValueError:
        return None


def resolve_commercial_partner(odoo, partner_id: int) -> dict:
    """The company (commercial partner) a partner id belongs to, with the
    details a statement header needs."""
    rows = odoo.read("res.partner", [partner_id], fields=["commercial_partner_id"])
    if not rows:
        raise LookupError("Customer not found")
    cid = rows[0]["commercial_partner_id"][0] if rows[0].get("commercial_partner_id") else partner_id
    p = odoo.read(
        "res.partner", [cid],
        fields=["name", "vat", "ref", "email", "phone", "street", "street2", "city", "zip"],
    )[0]
    return {k: _clean(v) for k, v in p.items()}


def _base_domain(commercial_id: int) -> list:
    return [
        ("partner_id", "child_of", commercial_id),
        ("account_type", "=", "asset_receivable"),
        ("parent_state", "=", "posted"),
    ]


def statement_companies(odoo, commercial_id: int) -> list:
    """Every Odoo company this customer has receivable activity with, with
    each company's current balance. Most active first."""
    groups = odoo_call(
        "account.move.line", "read_group",
        [_base_domain(commercial_id), ["balance:sum"], ["company_id"]],
        {"lazy": False},
    )
    out = []
    for g in groups:
        if not g.get("company_id"):
            continue
        out.append({
            "id": g["company_id"][0],
            "name": g["company_id"][1],
            "balance": round(g.get("balance") or 0.0, 2),
            "line_count": g.get("__count", 0),
        })
    out.sort(key=lambda c: -c["line_count"])
    return out


def company_details(odoo, company_id: int) -> dict:
    """Letterhead and banking for one company. Banking comes from the
    company's own bank account in Odoo (each company has its own), falling
    back to the portal's configured banking only when Odoo has none."""
    rows = odoo.read(
        "res.company", [company_id],
        fields=["name", "vat", "company_registry", "street", "street2", "city",
                "zip", "phone", "email", "bank_ids"],
    )
    if not rows:
        return {"id": company_id, "name": f"Company {company_id}"}
    c = {k: _clean(v) for k, v in rows[0].items()}
    bank = None
    if c.get("bank_ids"):
        try:
            b = odoo.read("res.partner.bank", c["bank_ids"][:1],
                          fields=["acc_number", "acc_holder_name", "bank_id"])
            if b:
                bank = {
                    "account": _clean(b[0].get("acc_number")),
                    "holder": _clean(b[0].get("acc_holder_name")) or c.get("name"),
                    "bank": b[0]["bank_id"][1] if b[0].get("bank_id") else None,
                    "source": "odoo",
                }
        except Exception:
            bank = None
    if not bank:
        bank = {
            "account": f"{settings.bank_name}, account {settings.bank_account}, branch {settings.bank_branch}",
            "holder": c.get("name"),
            "bank": settings.bank_name,
            "source": "portal_default",
        }
    c.pop("bank_ids", None)
    c["bank"] = bank
    address = ", ".join(x for x in [c.get("street"), c.get("street2"), c.get("city"), c.get("zip")] if x)
    c["address"] = address or None
    return c


def _read_lines(odoo, domain: list, order: str) -> tuple:
    """All journal items for a domain, paged, capped at MAX_LINES."""
    lines, offset = [], 0
    while True:
        batch = odoo.search_read(
            "account.move.line", domain=domain, fields=_LINE_FIELDS,
            limit=_PAGE, offset=offset, order=order,
        )
        lines.extend(batch)
        if len(batch) < _PAGE:
            return lines, False
        offset += _PAGE
        if offset >= MAX_LINES:
            return lines[:MAX_LINES], True


def _kind(line: dict) -> str:
    mt = line.get("move_type")
    if mt == "out_invoice":
        return "invoice"
    if mt == "out_refund":
        return "credit_note"
    if line.get("payment_id"):
        return "payment" if (line.get("balance") or 0) <= 0 else "refund"
    return "adjustment"


_KIND_LABEL = {
    "invoice": "Invoice",
    "credit_note": "Credit note",
    "payment": "Payment received",
    "refund": "Payment refunded",
    "adjustment": "Adjustment",
}


def _group_by_move(lines: list) -> list:
    """One statement row per journal entry. An invoice with instalment
    payment terms has several receivable lines; the customer sees one
    document, due on its earliest instalment."""
    rows, index = [], {}
    for l in lines:
        mid = l["move_id"][0] if l.get("move_id") else l["id"]
        r = index.get(mid)
        if r is None:
            kind = _kind(l)
            r = {
                "move_id": mid,
                "number": _clean(l.get("move_name")) or (l["move_id"][1] if l.get("move_id") else ""),
                "kind": kind,
                "type_label": _KIND_LABEL[kind],
                "date": _clean(l.get("date")),
                "due_date": _clean(l.get("date_maturity")),
                "reference": _clean(l.get("ref")) or _clean(l.get("name")) or "",
                "debit": 0.0, "credit": 0.0, "balance": 0.0, "residual": 0.0,
                # Invoices and credit notes open in the portal's invoice
                # detail; payments and adjustments have nothing to open.
                "openable": kind in ("invoice", "credit_note"),
            }
            index[mid] = r
            rows.append(r)
        r["debit"] += l.get("debit") or 0.0
        r["credit"] += l.get("credit") or 0.0
        r["balance"] += l.get("balance") or 0.0
        r["residual"] += l.get("amount_residual") or 0.0
        due = _clean(l.get("date_maturity"))
        if due and (not r["due_date"] or due < r["due_date"]):
            r["due_date"] = due
    for r in rows:
        for k in ("debit", "credit", "balance", "residual"):
            r[k] = round(r[k], 2)
    return rows


def _bucket_for(days_overdue: int) -> str:
    if days_overdue <= 0:
        return "current"
    if days_overdue <= 30:
        return "d30"
    if days_overdue <= 60:
        return "d60"
    if days_overdue <= 90:
        return "d90"
    if days_overdue <= 120:
        return "d120"
    return "older"


def _open_items(odoo, domain: list, as_of: date) -> tuple:
    """Everything still open (not fully matched) as at today, with ageing."""
    lines, truncated = _read_lines(
        odoo, domain + [("reconciled", "=", False), ("amount_residual", "!=", 0)],
        "date_maturity asc, date asc, id asc",
    )
    rows = [r for r in _group_by_move(lines) if abs(r["residual"]) >= 0.005]
    ageing = {key: 0.0 for key, _ in AGE_BUCKETS}
    unallocated = 0.0
    for r in rows:
        due = _parse_date(r["due_date"]) or _parse_date(r["date"]) or as_of
        r["days_overdue"] = max((as_of - due).days, 0)
        if r["residual"] < 0:
            # A payment or credit note not yet matched to an invoice.
            unallocated += r["residual"]
            r["bucket"] = None
        else:
            b = _bucket_for((as_of - due).days)
            r["bucket"] = b
            ageing[b] += r["residual"]
    ageing = {k: round(v, 2) for k, v in ageing.items()}
    total_due = round(sum(r["residual"] for r in rows), 2)
    overdue = round(sum(v for k, v in ageing.items() if k != "current"), 2)
    return rows, {
        "buckets": [{"key": k, "label": lbl, "amount": ageing[k]} for k, lbl in AGE_BUCKETS],
        "unallocated": round(unallocated, 2),
        "overdue": overdue,
        "total_due": total_due,
    }, truncated


def build_statement(
    odoo,
    customer_id: int,
    company_id: Optional[int] = None,
    date_from: Optional[str] = None,
    date_to: Optional[str] = None,
    mode: str = "activity",
) -> dict:
    """
    mode "activity": opening balance at date_from, every transaction in the
      period with a running balance, closing balance at date_to.
    mode "open": every item still open today, oldest due first.
    Ageing (as at today) is always included.
    """
    if mode not in ("activity", "open"):
        raise ValueError("mode must be 'activity' or 'open'")
    customer = resolve_commercial_partner(odoo, customer_id)
    cid = customer["id"]
    companies = statement_companies(odoo, cid)
    today = date.today()

    base = {
        "customer": customer,
        "companies": companies,
        "mode": mode,
        "generated_at": datetime.now().isoformat(timespec="seconds"),
        "as_of": today.isoformat(),
    }
    if company_id is None:
        if not companies:
            return {**base, "company": None, "rows": [], "summary": None,
                    "ageing": None, "truncated": False,
                    "date_from": date_from, "date_to": date_to}
        company_id = companies[0]["id"]

    company = company_details(odoo, company_id)
    domain = _base_domain(cid) + [("company_id", "=", company_id)]

    open_rows, ageing, open_truncated = _open_items(odoo, domain, today)

    if mode == "open":
        return {
            **base, "company": company, "rows": open_rows, "ageing": ageing,
            "summary": {"total_due": ageing["total_due"], "overdue": ageing["overdue"],
                        "unallocated": ageing["unallocated"], "item_count": len(open_rows)},
            "truncated": open_truncated, "date_from": None, "date_to": today.isoformat(),
        }

    d_to = _parse_date(date_to) or today
    d_from = _parse_date(date_from)
    if d_from and d_from > d_to:
        raise ValueError("The start date is after the end date")

    opening = 0.0
    if d_from:
        g = odoo_call(
            "account.move.line", "read_group",
            [domain + [("date", "<", d_from.isoformat())], ["balance:sum"], []],
            {"lazy": False},
        )
        opening = round((g[0].get("balance") if g else 0.0) or 0.0, 2)

    period = domain + [("date", "<=", d_to.isoformat())]
    if d_from:
        period.append(("date", ">=", d_from.isoformat()))
    lines, truncated = _read_lines(odoo, period, "date asc, move_id asc, id asc")
    rows = _group_by_move(lines)

    running = opening
    totals = {"invoiced": 0.0, "credit_notes": 0.0, "payments": 0.0, "adjustments": 0.0}
    for r in rows:
        running = round(running + r["balance"], 2)
        r["running_balance"] = running
        if r["kind"] == "invoice":
            totals["invoiced"] += r["balance"]
        elif r["kind"] == "credit_note":
            totals["credit_notes"] += -r["balance"]
        elif r["kind"] in ("payment", "refund"):
            totals["payments"] += -r["balance"]
        else:
            totals["adjustments"] += r["balance"]

    return {
        **base, "company": company, "rows": rows, "ageing": ageing,
        "summary": {
            "opening_balance": opening,
            "invoiced": round(totals["invoiced"], 2),
            "credit_notes": round(totals["credit_notes"], 2),
            "payments": round(totals["payments"], 2),
            "adjustments": round(totals["adjustments"], 2),
            "closing_balance": running,
            "item_count": len(rows),
        },
        "truncated": truncated or open_truncated,
        "date_from": d_from.isoformat() if d_from else None,
        "date_to": d_to.isoformat(),
    }


def statement_period_label(stmt: dict) -> str:
    def fmt(s):
        d = _parse_date(s)
        return d.strftime("%d %b %Y").lstrip("0") if d else ""
    if stmt.get("mode") == "open":
        return f"Open items as at {fmt(stmt.get('as_of'))}"
    if stmt.get("date_from"):
        return f"{fmt(stmt['date_from'])} to {fmt(stmt['date_to'])}"
    return f"All transactions to {fmt(stmt.get('date_to'))}"


def statement_filename(stmt: dict, ext: str) -> str:
    cust = (stmt.get("customer") or {}).get("name") or "Customer"
    safe = "".join(ch if ch.isalnum() or ch in " -_" else "" for ch in cust).strip()[:60] or "Customer"
    stamp = stmt.get("date_to") or stmt.get("as_of") or date.today().isoformat()
    kind = "Open Items" if stmt.get("mode") == "open" else "Statement"
    return f"{safe} {kind} {stamp}.{ext}"
