"""
8.72 — Deposit and payment integrity: Odoo is the source of truth, and the
portal never creates a second payment or invoice when Odoo already holds one
that could be used.

Found live 2026-10-14 (S01205, then a read-only scan of every order): 90 of
120 deposit (down payment) invoices had been cancelled by hand in Odoo
because they only show a "Down Payment" line, not the products. Cancelling a
deposit invoice unhooks its payment (left unallocated on the customer's
account) and leaves the final invoice nothing to deduct, so it charges the
full amount; a second payment was then often recorded against it, so the
same money appears twice.

This module is the single place that answers, from Odoo:
  * order_deposit_state(): which deposit invoices an order has (posted,
    cancelled), whether the final invoice will be missing its deduction, and
    which unallocated payments came from a cancelled deposit;
  * customer_unallocated(): unallocated payments and credit notes on a
    customer's account, so every "record a payment" path can offer to apply
    one instead of recording a new payment;
  * invoice_outstanding() / apply_credit(): Odoo's own outstanding-credits
    widget and js_assign_outstanding_line, the public way to match an
    existing payment or credit to an invoice (live-checked on Odoo 19, 7.17).

Root-level module (like ownership.py / contacts.py) because ticket_routes,
invoice_routes and packing_board_routes all need it.
"""
import logging
from typing import Optional

from odoo_client import odoo as odoo_call

logger = logging.getLogger(__name__)

UNALLOCATED_CODE = "unallocated_payments"


def _m2o_id(v):
    return v[0] if isinstance(v, (list, tuple)) and v else (v or None)


def customer_unallocated(odoo, partner_id: int, company_id: Optional[int] = None) -> list:
    """Unallocated payments and credit notes on a customer's receivable
    account (the commercial partner and every contact under it), newest
    first. Each: {line_id, reference, memo, amount, date, kind}."""
    if not partner_id:
        return []
    try:
        cp = odoo.read("res.partner", [int(partner_id)], fields=["commercial_partner_id"])
        cp_id = _m2o_id(cp[0].get("commercial_partner_id")) if cp else int(partner_id)
        domain = [
            ("partner_id", "child_of", cp_id or int(partner_id)),
            ("account_type", "=", "asset_receivable"),
            ("parent_state", "=", "posted"),
            ("credit", ">", 0),
            ("amount_residual", "<", -0.005),
        ]
        if company_id:
            domain.append(("company_id", "=", int(company_id)))
        rows = odoo.search_read(
            "account.move.line", domain,
            fields=["move_name", "date", "credit", "amount_residual", "payment_id", "move_id", "company_id"],
            limit=50, order="date desc, id desc",
        )
    except Exception as e:
        logger.warning("customer_unallocated_failed partner=%s error=%s", partner_id, e)
        return []
    pay_ids = list({_m2o_id(r.get("payment_id")) for r in rows if r.get("payment_id")})
    memos = {}
    if pay_ids:
        try:
            memos = {p["id"]: p.get("memo") or "" for p in odoo.read("account.payment", pay_ids, fields=["memo"])}
        except Exception:
            memos = {}
    out = []
    for r in rows:
        pid = _m2o_id(r.get("payment_id"))
        out.append({
            "line_id": r["id"],
            "reference": r.get("move_name") or "",
            "memo": memos.get(pid, "") if pid else "",
            "amount": round(-float(r.get("amount_residual") or 0), 2),
            "date": r.get("date"),
            "kind": "payment" if pid else "credit",
            "company": (r.get("company_id") or [None, ""])[1] if isinstance(r.get("company_id"), list) else "",
        })
    return out


def order_deposit_state(odoo, order_id: int) -> dict:
    """The deposit side of one sale order, read from Odoo.

    Returns {posted, cancelled, final_invoices, problem, restorable,
    stranded, message}. `problem` is True when the order's deposit invoice(s)
    were all cancelled: the final invoice will then charge the full amount.
    `restorable` is True when no final invoice exists yet, so restoring the
    cancelled deposit invoice and re-applying its payment fixes it cleanly.
    Never raises: on an Odoo error returns problem False with `error` set."""
    state = {"posted": [], "cancelled": [], "final_invoices": [], "problem": False,
             "restorable": False, "stranded": [], "message": None, "error": None}
    try:
        so = odoo.read("sale.order", [int(order_id)], fields=["name", "invoice_ids", "partner_id", "company_id"])
        if not so:
            return state
        so = so[0]
        dp_lines = odoo.search_read(
            "sale.order.line",
            [("order_id", "=", int(order_id)), ("is_downpayment", "=", True), ("display_type", "=", False)],
            fields=["invoice_lines"],
        )
        aml_ids = [i for l in dp_lines for i in (l.get("invoice_lines") or [])]
        dp_move_ids = set()
        if aml_ids:
            dp_move_ids = {_m2o_id(a["move_id"]) for a in odoo.read("account.move.line", aml_ids, fields=["move_id"])
                           if a.get("move_id")}
        inv_ids = set(so.get("invoice_ids") or []) | dp_move_ids
        moves = odoo.read("account.move", list(inv_ids),
                          fields=["name", "state", "move_type", "amount_total", "amount_residual", "payment_state"]) if inv_ids else []
    except Exception as e:
        logger.warning("order_deposit_state_failed order_id=%s error=%s", order_id, e)
        state["error"] = str(e)
        return state

    def _row(m):
        return {"id": m["id"], "name": m.get("name") or f"#{m['id']}", "amount": float(m.get("amount_total") or 0),
                "residual": float(m.get("amount_residual") or 0), "payment_state": m.get("payment_state"),
                "state": m.get("state")}

    for m in moves:
        if m.get("move_type") != "out_invoice":
            continue
        if m["id"] in dp_move_ids:
            if m.get("state") == "posted":
                state["posted"].append(_row(m))
            elif m.get("state") == "cancel":
                state["cancelled"].append(_row(m))
        elif m.get("state") == "posted":
            state["final_invoices"].append(_row(m))

    if state["cancelled"] and not state["posted"]:
        state["problem"] = True
        state["restorable"] = not state["final_invoices"]
        names = {c["name"] for c in state["cancelled"]}
        unalloc = customer_unallocated(odoo, _m2o_id(so.get("partner_id")), _m2o_id(so.get("company_id")))
        state["stranded"] = [u for u in unalloc if any(n and n in (u.get("memo") or "") for n in names)]
        cancelled_txt = ", ".join(sorted(names))
        if state["restorable"]:
            state["message"] = (
                f"The deposit invoice {cancelled_txt} was cancelled in Odoo, so its payment is no longer "
                "linked to this order and the final invoice would charge the full amount. Finance needs to "
                "restore the deposit invoice (Restore Deposit on the Sales ticket) before this order is "
                "marked complete."
            )
        else:
            state["message"] = (
                f"The deposit invoice {cancelled_txt} was cancelled in Odoo after the final invoice was raised "
                "without deducting it. Finance needs to check this order in Odoo: the deposit payment may now "
                "be unallocated and the customer's money recorded twice."
            )
    return state


def invoice_outstanding(odoo, invoice_id: int) -> tuple:
    """(invoice, items): Odoo's own list of payments and credit notes on the
    customer's account that could be applied to this invoice."""
    rows = odoo.read(
        "account.move", [int(invoice_id)],
        fields=["name", "state", "move_type", "amount_residual", "partner_id",
                "invoice_has_outstanding", "invoice_outstanding_credits_debits_widget"],
    )
    if not rows:
        return None, []
    inv = rows[0]
    widget = inv.get("invoice_outstanding_credits_debits_widget") or {}
    items = []
    if isinstance(widget, dict) and widget.get("outstanding"):
        for c in widget.get("content") or []:
            items.append({
                "line_id": c.get("id"),
                "reference": c.get("journal_name") or c.get("move_ref") or "",
                "amount": c.get("amount") or 0.0,
                "date": c.get("date"),
                "is_payment": bool(c.get("account_payment_id")),
            })
    return inv, items


def apply_credit(odoo, invoice_id: int, line_id: int) -> dict:
    """Match an existing payment or credit (an account.move.line) to an
    invoice with Odoo's js_assign_outstanding_line. Returns {before, after,
    payment_state}. Raises RuntimeError if Odoo didn't reduce the balance.
    Same marshalling quirk as register_deposit: the call can succeed even
    though the reply fails to marshal, so success is judged by the balance."""
    rows = odoo.read("account.move", [int(invoice_id)], fields=["amount_residual"])
    before = float(rows[0].get("amount_residual") or 0) if rows else 0.0
    err = None
    try:
        odoo_call("account.move", "js_assign_outstanding_line", [[int(invoice_id)], int(line_id)])
    except Exception as e:
        err = e
    after_rows = odoo.read("account.move", [int(invoice_id)], fields=["amount_residual", "payment_state"])
    after = float(after_rows[0].get("amount_residual") or 0) if after_rows else before
    if not (after < before - 0.005):
        raise RuntimeError(f"Odoo did not apply the payment{': ' + str(err) if err else ''}")
    return {"before": before, "after": after, "payment_state": after_rows[0].get("payment_state") if after_rows else None}


def restore_deposit_invoice(odoo, invoice_id: int) -> None:
    """Bring a cancelled deposit invoice back: reset to draft, then post. It
    keeps its original number. Raises on an Odoo error."""
    odoo.execute("account.move", "button_draft", [int(invoice_id)])
    odoo.execute("account.move", "action_post", [int(invoice_id)])


def unallocated_detail(credits: list, what: str) -> dict:
    """The 409 body every payment path returns when unallocated payments
    exist and the caller hasn't confirmed this is a separate new payment."""
    total = round(sum(c.get("amount") or 0 for c in credits), 2)
    return {
        "code": UNALLOCATED_CODE,
        "message": (f"This customer already has R{total:,.2f} in payments or credits on their account that "
                    f"aren't allocated to anything. If the money for this {what} is one of these, apply it "
                    "instead of recording a new payment, so it isn't recorded twice."),
        "credits": credits,
    }
