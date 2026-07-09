"""
Phase 22 — Bank Reconciliation.

22.0  Permission: finance.bank_reconciliation
22.2  Import endpoint: CSV upload → auto-match
22.3  Manual match / exclude / unmatch endpoints
22.5  FNB Business and Nedbank Business CSV parsers
"""
import csv
import io
import logging
from datetime import datetime, date as date_type, timezone
from typing import Optional
from bson import ObjectId

from fastapi import APIRouter, Depends, File, Form, HTTPException, UploadFile
from pydantic import BaseModel

from auth import require_permission
from database import col
from middleware.audit import audit_log
from odoo_client import get_odoo_client, odoo as odoo_call

logger = logging.getLogger(__name__)

router = APIRouter(prefix="/api/finance", tags=["bank_recon"])

RECON_PERM = Depends(require_permission("finance.bank_reconciliation"))

# ── CSV parsers (Phase 22.5) ──────────────────────────────────────────────────

def _parse_amount(val: str) -> float:
    """Strip currency symbols, commas, spaces, then cast to float."""
    return float(val.replace("R", "").replace(",", "").replace(" ", "").strip() or "0")


def _detect_format(headers: list[str]) -> str:
    """Return 'fnb', 'nedbank', or 'unknown' based on CSV column headers."""
    h = [c.strip().lower() for c in headers]
    if "transaction type" in h and "running balance" in h:
        return "fnb"
    if "description" in h and ("debit" in h or "credit" in h):
        return "nedbank"
    return "unknown"


def _parse_fnb_date(val: str) -> Optional[str]:
    """'01 Jan 2024' → '2024-01-01'"""
    try:
        return datetime.strptime(val.strip(), "%d %b %Y").date().isoformat()
    except ValueError:
        return None


def _parse_nedbank_date(val: str) -> Optional[str]:
    """'2024-01-01' or '01/01/2024' → '2024-01-01'"""
    v = val.strip()
    for fmt in ("%Y-%m-%d", "%d/%m/%Y", "%Y/%m/%d"):
        try:
            return datetime.strptime(v, fmt).date().isoformat()
        except ValueError:
            continue
    return None


def _parse_fnb_csv(text: str) -> list[dict]:
    reader = csv.DictReader(io.StringIO(text))
    rows = []
    for row in reader:
        amount_str = (row.get("Amount") or "").strip()
        if not amount_str:
            continue
        amount = _parse_amount(amount_str)
        if amount <= 0:
            continue
        rows.append({
            "date": _parse_fnb_date(row.get("Date", "")),
            "reference": (row.get("Reference") or "").strip(),
            "description": (row.get("Transaction Type") or "").strip(),
            "amount": amount,
        })
    return rows


def _parse_nedbank_csv(text: str) -> list[dict]:
    reader = csv.DictReader(io.StringIO(text))
    rows = []
    for row in reader:
        credit_str = (row.get("Credit") or "").strip()
        if not credit_str or credit_str == "0" or credit_str == "0.00":
            continue
        amount = _parse_amount(credit_str)
        if amount <= 0:
            continue
        rows.append({
            "date": _parse_nedbank_date(row.get("Date", "")),
            "reference": (row.get("Reference") or "").strip(),
            "description": (row.get("Description") or "").strip(),
            "amount": amount,
        })
    return rows


def _parse_csv(content: bytes) -> tuple[str, list[dict]]:
    """Detect format and parse. Returns (format_name, lines)."""
    text = content.decode("utf-8-sig", errors="replace")
    reader = csv.reader(io.StringIO(text))
    headers = next(reader, [])
    fmt = _detect_format(headers)
    if fmt == "fnb":
        return "fnb", _parse_fnb_csv(text)
    if fmt == "nedbank":
        return "nedbank", _parse_nedbank_csv(text)
    raise HTTPException(
        status_code=400,
        detail="Unrecognised CSV format. Supported: FNB Business, Nedbank Business.",
    )


# ── Auto-match algorithm (Phase 22.2) ────────────────────────────────────────

def _auto_match(line: dict, open_invoices: list[dict]) -> dict | None:
    """
    Score each open invoice against a statement line.
    Returns the best match dict or None if nothing crosses the threshold.
    """
    amount = line["amount"]
    ref = (line["reference"] + " " + line["description"]).upper()
    best = None
    best_score = 0

    for inv in open_invoices:
        residual = inv.get("amount_residual", 0)
        score = 0

        # Exact amount match
        if abs(amount - residual) < 0.01:
            score += 60
        elif abs(amount - residual) / max(residual, 0.01) < 0.01:
            score += 40

        # Invoice name in reference
        inv_name = (inv.get("name") or "").upper()
        if inv_name and inv_name in ref:
            score += 40

        # Customer name words in reference
        partner = (inv.get("partner_id") or [None, ""])[1].upper() if isinstance(inv.get("partner_id"), list) else ""
        if partner:
            words = [w for w in partner.split() if len(w) > 3]
            matched_words = sum(1 for w in words if w in ref)
            score += min(matched_words * 10, 20)

        if score > best_score:
            best_score = score
            best = {**inv, "_score": score}

    if not best or best_score < 40:
        return None

    confidence = "high" if best_score >= 80 else "medium" if best_score >= 50 else "low"
    return {
        "invoice_id": best["id"],
        "invoice_name": best.get("name", ""),
        "customer_name": (best.get("partner_id") or [None, ""])[1] if isinstance(best.get("partner_id"), list) else "",
        "confidence": confidence,
    }


# ── Bank journals ─────────────────────────────────────────────────────────────

@router.get("/bank-journals")
def list_bank_journals(current_user: dict = RECON_PERM):
    """List Odoo bank/cash journals for the import form."""
    odoo = get_odoo_client()
    journals = odoo.search_read(
        "account.journal",
        [("type", "in", ["bank", "cash"])],
        fields=["id", "name", "type", "currency_id"],
        limit=50,
    )
    return {"journals": journals}


# ── Open invoices ─────────────────────────────────────────────────────────────

@router.get("/invoices/open")
def list_open_invoices(current_user: dict = RECON_PERM):
    """List unpaid Odoo invoices for manual match selection."""
    odoo = get_odoo_client()
    invoices = odoo.search_read(
        "account.move",
        [
            ("move_type", "=", "out_invoice"),
            ("state", "=", "posted"),
            ("payment_state", "in", ["not_paid", "partial"]),
        ],
        fields=["id", "name", "partner_id", "amount_residual", "invoice_date_due", "currency_id"],
        limit=500,
        order="invoice_date_due asc",
    )
    return {"invoices": invoices}


# ── Import statement (Phase 22.2 + 22.5) ─────────────────────────────────────

@router.post("/bank-statements/import")
async def import_statement(
    file: UploadFile = File(...),
    journal_id: int = Form(...),
    current_user: dict = RECON_PERM,
):
    """
    Upload a bank CSV, auto-detect FNB/Nedbank format, auto-match credits to
    open invoices, and save the statement + lines to MongoDB.
    """
    content = await file.read()
    fmt, raw_lines = _parse_csv(content)

    if not raw_lines:
        raise HTTPException(status_code=400, detail="No credit transactions found in this file.")

    # Deduplicate against existing lines for this journal
    existing_refs = set()
    async for existing in col("bank_statement_lines").find(
        {}, {"reference": 1, "date": 1, "amount": 1}
    ):
        key = f"{existing.get('date')}|{existing.get('reference')}|{existing.get('amount')}"
        existing_refs.add(key)

    deduped = []
    for ln in raw_lines:
        key = f"{ln['date']}|{ln['reference']}|{ln['amount']}"
        if key not in existing_refs:
            deduped.append(ln)

    if not deduped:
        raise HTTPException(status_code=400, detail="All lines in this file have already been imported.")

    # Load open invoices once for auto-matching
    odoo = get_odoo_client()
    open_invoices = odoo.search_read(
        "account.move",
        [
            ("move_type", "=", "out_invoice"),
            ("state", "=", "posted"),
            ("payment_state", "in", ["not_paid", "partial"]),
        ],
        fields=["id", "name", "partner_id", "amount_residual"],
        limit=500,
    )

    # Resolve journal name
    journal_info = odoo.read("account.journal", [journal_id], fields=["id", "name"])
    journal_name = journal_info[0]["name"] if journal_info else f"Journal {journal_id}"

    now = datetime.now(timezone.utc)
    dates = [ln["date"] for ln in deduped if ln["date"]]
    date_from = min(dates) if dates else None
    date_to   = max(dates) if dates else None
    total_credits = sum(ln["amount"] for ln in deduped)

    # Create statement record
    stmt_doc = {
        "name": f"{journal_name} — {date_from or '?'} to {date_to or '?'}",
        "journal_id": journal_id,
        "journal_name": journal_name,
        "format": fmt,
        "date_from": date_from,
        "date_to": date_to,
        "imported_by": current_user.get("id") or current_user.get("_id", ""),
        "imported_by_name": current_user.get("display_name") or current_user.get("username", ""),
        "imported_at": now,
        "line_count": len(deduped),
        "matched_count": 0,
        "auto_matched_count": 0,
        "excluded_count": 0,
        "total_credits": total_credits,
    }
    result = await col("bank_statements").insert_one(stmt_doc)
    statement_id = str(result.inserted_id)

    # Build line docs with auto-match
    auto_matched = 0
    line_docs = []
    for ln in deduped:
        match = _auto_match(ln, open_invoices)
        status = "auto_matched" if match and match["confidence"] in ("high", "medium") else "unmatched"
        if status == "auto_matched":
            auto_matched += 1
        line_docs.append({
            "statement_id": statement_id,
            "date": ln["date"],
            "reference": ln["reference"],
            "description": ln["description"],
            "amount": ln["amount"],
            "status": status,
            "match_invoice_id": match["invoice_id"] if match else None,
            "match_invoice_name": match["invoice_name"] if match else None,
            "match_confidence": match["confidence"] if match else None,
            "match_customer_name": match["customer_name"] if match else None,
            "odoo_payment_id": None,
            "matched_by": None,
            "matched_at": None,
            "excluded_reason": None,
        })

    if line_docs:
        await col("bank_statement_lines").insert_many(line_docs)

    await col("bank_statements").update_one(
        {"_id": result.inserted_id},
        {"$set": {"auto_matched_count": auto_matched, "matched_count": auto_matched}},
    )

    await audit_log(
        "bank_recon.import", "bank_statement", statement_id,
        entity_label=stmt_doc["name"],
        user=current_user,
        detail={"format": fmt, "lines": len(deduped), "auto_matched": auto_matched},
    )

    return {
        "statement_id": statement_id,
        "format": fmt,
        "lines_imported": len(deduped),
        "auto_matched": auto_matched,
        "name": stmt_doc["name"],
    }


# ── List statements ───────────────────────────────────────────────────────────

@router.get("/bank-statements")
async def list_statements(current_user: dict = RECON_PERM):
    docs = await col("bank_statements").find(
        {}, {"_id": 1, "name": 1, "journal_name": 1, "format": 1,
             "date_from": 1, "date_to": 1, "imported_at": 1,
             "line_count": 1, "matched_count": 1, "auto_matched_count": 1,
             "excluded_count": 1, "total_credits": 1, "imported_by_name": 1}
    ).sort("imported_at", -1).to_list(length=200)

    for d in docs:
        d["id"] = str(d.pop("_id"))
    return {"statements": docs}


# ── Statement lines ───────────────────────────────────────────────────────────

@router.get("/bank-statements/{statement_id}/lines")
async def get_statement_lines(statement_id: str, current_user: dict = RECON_PERM):
    try:
        oid = ObjectId(statement_id)
    except Exception:
        raise HTTPException(status_code=400, detail="Invalid statement ID")

    stmt = await col("bank_statements").find_one({"_id": oid})
    if not stmt:
        raise HTTPException(status_code=404, detail="Statement not found")

    lines = await col("bank_statement_lines").find(
        {"statement_id": statement_id}
    ).sort("date", 1).to_list(length=None)

    for ln in lines:
        ln["id"] = str(ln.pop("_id"))

    stmt["id"] = str(stmt.pop("_id"))
    return {"statement": stmt, "lines": lines}


# ── Match a line (Phase 22.3) ─────────────────────────────────────────────────

class MatchBody(BaseModel):
    invoice_id: int
    journal_id: int
    payment_date: Optional[str] = None
    amount: Optional[float] = None


@router.post("/bank-statements/lines/{line_id}/match")
async def match_line(line_id: str, body: MatchBody, current_user: dict = RECON_PERM):
    """
    Confirm a match: register a payment in Odoo via account.payment.register,
    then stamp the line as manually_matched.
    """
    try:
        oid = ObjectId(line_id)
    except Exception:
        raise HTTPException(status_code=400, detail="Invalid line ID")

    line = await col("bank_statement_lines").find_one({"_id": oid})
    if not line:
        raise HTTPException(status_code=404, detail="Line not found")
    if line["status"] in ("manually_matched",):
        raise HTTPException(status_code=400, detail="Line is already matched")
    if line["status"] == "excluded":
        raise HTTPException(status_code=400, detail="Line is excluded — unmatch first")

    odoo = get_odoo_client()
    payment_date = body.payment_date or date_type.today().isoformat()
    amount = body.amount or line["amount"]

    # Verify invoice exists and is open
    inv_records = odoo.read(
        "account.move", [body.invoice_id],
        fields=["id", "name", "partner_id", "amount_residual", "payment_state"],
    )
    if not inv_records:
        raise HTTPException(status_code=404, detail="Invoice not found in Odoo")
    inv = inv_records[0]
    if inv["payment_state"] not in ("not_paid", "partial"):
        raise HTTPException(status_code=400, detail=f"Invoice is already {inv['payment_state']}")

    try:
        wizard_id = odoo_call(
            "account.payment.register", "create",
            [{"journal_id": body.journal_id, "payment_date": payment_date, "amount": amount}],
            {"context": {
                "active_model": "account.move",
                "active_ids": [body.invoice_id],
                "active_id": body.invoice_id,
            }},
        )
        odoo_call("account.payment.register", "action_create_payments", [[wizard_id]], {})
    except Exception as exc:
        raise HTTPException(status_code=400, detail=f"Odoo payment error: {exc}")

    # Retrieve the payment id that was just created
    payments = odoo.search_read(
        "account.payment",
        [("invoice_ids", "in", [body.invoice_id])],
        fields=["id"],
        limit=1,
        order="id desc",
    )
    odoo_payment_id = payments[0]["id"] if payments else None

    partner_name = inv["partner_id"][1] if isinstance(inv.get("partner_id"), list) else ""
    now = datetime.now(timezone.utc)
    await col("bank_statement_lines").update_one(
        {"_id": oid},
        {"$set": {
            "status": "manually_matched",
            "match_invoice_id": body.invoice_id,
            "match_invoice_name": inv["name"],
            "match_customer_name": partner_name,
            "match_confidence": "confirmed",
            "odoo_payment_id": odoo_payment_id,
            "matched_by": current_user.get("display_name") or current_user.get("username"),
            "matched_at": now,
        }},
    )

    # Update statement counts
    await _refresh_statement_counts(line["statement_id"])

    await audit_log(
        "bank_recon.match", "bank_statement_line", line_id,
        entity_label=inv["name"],
        user=current_user,
        detail={"invoice_id": body.invoice_id, "amount": amount, "odoo_payment_id": odoo_payment_id},
    )

    return {"success": True, "odoo_payment_id": odoo_payment_id}


# ── Exclude a line ────────────────────────────────────────────────────────────

class ExcludeBody(BaseModel):
    reason: Optional[str] = None


@router.post("/bank-statements/lines/{line_id}/exclude")
async def exclude_line(line_id: str, body: ExcludeBody, current_user: dict = RECON_PERM):
    try:
        oid = ObjectId(line_id)
    except Exception:
        raise HTTPException(status_code=400, detail="Invalid line ID")

    line = await col("bank_statement_lines").find_one({"_id": oid})
    if not line:
        raise HTTPException(status_code=404, detail="Line not found")
    if line["status"] == "manually_matched":
        raise HTTPException(status_code=400, detail="Cannot exclude a matched line — unmatch first")

    await col("bank_statement_lines").update_one(
        {"_id": oid},
        {"$set": {
            "status": "excluded",
            "excluded_reason": body.reason or "Excluded by Finance",
            "matched_by": None,
            "matched_at": None,
        }},
    )
    await _refresh_statement_counts(line["statement_id"])
    return {"success": True}


# ── Unmatch / un-exclude a line ───────────────────────────────────────────────

@router.post("/bank-statements/lines/{line_id}/unmatch")
async def unmatch_line(line_id: str, current_user: dict = RECON_PERM):
    """Reset a line to unmatched. Does NOT reverse the Odoo payment."""
    try:
        oid = ObjectId(line_id)
    except Exception:
        raise HTTPException(status_code=400, detail="Invalid line ID")

    line = await col("bank_statement_lines").find_one({"_id": oid})
    if not line:
        raise HTTPException(status_code=404, detail="Line not found")

    await col("bank_statement_lines").update_one(
        {"_id": oid},
        {"$set": {
            "status": "unmatched",
            "match_invoice_id": None,
            "match_invoice_name": None,
            "match_customer_name": None,
            "match_confidence": None,
            "odoo_payment_id": None,
            "matched_by": None,
            "matched_at": None,
            "excluded_reason": None,
        }},
    )
    await _refresh_statement_counts(line["statement_id"])
    return {"success": True}


# ── Helper ────────────────────────────────────────────────────────────────────

async def _refresh_statement_counts(statement_id: str):
    pipeline = [
        {"$match": {"statement_id": statement_id}},
        {"$group": {
            "_id": "$status",
            "count": {"$sum": 1},
        }},
    ]
    counts = {doc["_id"]: doc["count"] async for doc in col("bank_statement_lines").aggregate(pipeline)}
    total = sum(counts.values())
    matched = counts.get("manually_matched", 0) + counts.get("auto_matched", 0)
    try:
        oid = ObjectId(statement_id)
        await col("bank_statements").update_one(
            {"_id": oid},
            {"$set": {
                "matched_count": matched,
                "excluded_count": counts.get("excluded", 0),
                "line_count": total,
            }},
        )
    except Exception:
        pass
