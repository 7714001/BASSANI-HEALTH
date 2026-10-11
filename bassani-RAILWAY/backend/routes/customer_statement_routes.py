"""
Customer statement of account (7.17) — view, download (PDF/Excel), email.

Replaces the old 7.3 invoice-list "statement" in customer_routes.py. Data is
built by services/customer_statement.py from the customer's receivable
journal items, one Odoo company at a time; files are built by
services/statement_export.py, so a download and an email are always the
same document.

Access:
  - staff with customers.view or invoices.view (any company)
  - a reseller, for customers it owns (customer_ownership)
  - a customer login, for its own active company
Emailing additionally requires customers.send_statement (staff only).
"""
import io
import re
import uuid
from datetime import datetime, timezone
from typing import List, Optional

from fastapi import APIRouter, BackgroundTasks, Depends, HTTPException, Query, Request
from fastapi.concurrency import run_in_threadpool
from fastapi.responses import StreamingResponse
from pydantic import BaseModel

from auth import ADMIN_ROLES, TICKET_ROLES, get_current_user, require_permission
from database import NO_ID, col
from middleware.audit import audit_log
from odoo_client import get_odoo_client
from ownership import is_partner_owned_by
from services.customer_statement import (
    build_statement, resolve_commercial_partner, statement_filename, statement_period_label,
)
from services.email_service import send_customer_statement
from services.statement_export import build_statement_pdf, build_statement_xlsx

router = APIRouter(prefix="/api/customers", tags=["customer-statements"])

EMAIL_RE = re.compile(r"^[^\s@]+@[^\s@]+\.[^\s@]+$")
_MEDIA = {
    "pdf": "application/pdf",
    "xlsx": "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
}


def _has_perm(user: dict, domain: str, action: str) -> bool:
    if user.get("is_super_admin") or user.get("role") == "super_admin":
        return True
    return bool((user.get("permissions") or {}).get(domain, {}).get(action))


async def _assert_statement_access(current_user: dict, customer_id: int, odoo) -> dict:
    """Resolve the customer's company and confirm the caller may see its
    statement. Returns the commercial partner record. Covers the customer
    role too, which the old 7.3 endpoint never checked (any customer login
    could read any company's statement by id)."""
    try:
        customer = await run_in_threadpool(resolve_commercial_partner, odoo, customer_id)
    except LookupError:
        raise HTTPException(status_code=404, detail="Customer not found")
    except Exception as e:
        raise HTTPException(status_code=502, detail=f"Could not load customer: {e}")
    cid = customer["id"]
    role = current_user.get("role")
    if role == "reseller":
        reseller = await col("resellers").find_one({"user_id": current_user["id"]}, NO_ID)
        if not reseller or not await is_partner_owned_by(reseller["id"], cid):
            raise HTTPException(status_code=403, detail="Access denied")
    elif role == "customer":
        if cid != current_user.get("customer_company_partner_id"):
            raise HTTPException(status_code=403, detail="Access denied")
    elif role == "super_admin" or current_user.get("is_super_admin"):
        pass
    elif role in (ADMIN_ROLES | TICKET_ROLES) and (
        _has_perm(current_user, "customers", "view") or _has_perm(current_user, "invoices", "view")
    ):
        pass
    else:
        raise HTTPException(status_code=403, detail="Access denied")
    return customer


async def _build(odoo, customer_id, company_id, date_from, date_to, mode) -> dict:
    try:
        stmt = await run_in_threadpool(
            build_statement, odoo, customer_id, company_id, date_from, date_to, mode,
        )
    except ValueError as e:
        raise HTTPException(status_code=400, detail=str(e))
    except Exception as e:
        raise HTTPException(status_code=502, detail=f"Could not build statement: {e}")
    if company_id is not None and not any(c["id"] == company_id for c in stmt["companies"]):
        # No receivable activity with that company — still a valid (empty)
        # statement, but only for a company this customer actually trades
        # with; never let an arbitrary company id through.
        raise HTTPException(status_code=400, detail="This customer has no account with that company")
    return stmt


def _strip_for_external(stmt: dict, current_user: dict) -> dict:
    """Resellers/customers see the statement document, not internal fields."""
    if current_user.get("role") in ("reseller", "customer") and stmt.get("company"):
        stmt["company"].get("bank", {}).pop("source", None)
    return stmt


@router.get("/{customer_id}/statement")
async def get_customer_statement(
    customer_id: int,
    company_id: Optional[int] = None,
    date_from: Optional[str] = None,
    date_to: Optional[str] = None,
    mode: str = Query("activity", pattern="^(activity|open)$"),
    current_user: dict = Depends(get_current_user),
):
    odoo = get_odoo_client()
    await _assert_statement_access(current_user, customer_id, odoo)
    stmt = await _build(odoo, customer_id, company_id, date_from, date_to, mode)
    stmt["period_label"] = statement_period_label(stmt)
    return _strip_for_external(stmt, current_user)


@router.get("/{customer_id}/statement/export")
async def export_customer_statement(
    customer_id: int,
    format: str = Query("pdf", pattern="^(pdf|xlsx)$"),
    company_id: Optional[int] = None,
    date_from: Optional[str] = None,
    date_to: Optional[str] = None,
    mode: str = Query("activity", pattern="^(activity|open)$"),
    current_user: dict = Depends(get_current_user),
):
    odoo = get_odoo_client()
    customer = await _assert_statement_access(current_user, customer_id, odoo)
    stmt = await _build(odoo, customer_id, company_id, date_from, date_to, mode)
    if not stmt.get("company"):
        raise HTTPException(status_code=400, detail="This customer has no account activity to put on a statement")
    builder = build_statement_pdf if format == "pdf" else build_statement_xlsx
    content = await run_in_threadpool(builder, stmt)
    filename = statement_filename(stmt, format)
    await audit_log(
        "customer.statement_downloaded", "customer", customer["id"],
        entity_label=customer.get("name"), user=current_user,
        detail={"format": format, "company_id": stmt["company"]["id"], "mode": mode,
                "date_from": stmt.get("date_from"), "date_to": stmt.get("date_to")},
    )
    return StreamingResponse(
        io.BytesIO(content), media_type=_MEDIA[format],
        headers={"Content-Disposition": f'attachment; filename="{filename}"'},
    )


class StatementEmailBody(BaseModel):
    company_id: int
    mode: str = "activity"
    date_from: Optional[str] = None
    date_to: Optional[str] = None
    recipients: List[str]
    formats: List[str] = ["pdf"]


@router.post("/{customer_id}/statement/email")
async def email_customer_statement(
    customer_id: int,
    body: StatementEmailBody,
    request: Request,
    background_tasks: BackgroundTasks,
    current_user: dict = Depends(require_permission("customers.send_statement")),
):
    """Email the statement to the recipients picked in the portal (first is
    To, the rest CC — same convention as Send Invoice/Send Quote)."""
    if body.mode not in ("activity", "open"):
        raise HTTPException(status_code=400, detail="Invalid statement type")
    recipients = []
    for r in body.recipients:
        r = (r or "").strip()
        if not EMAIL_RE.match(r):
            raise HTTPException(status_code=400, detail=f"'{r}' is not a valid email address")
        if r.lower() not in [x.lower() for x in recipients]:
            recipients.append(r)
    if not recipients:
        raise HTTPException(status_code=400, detail="Choose at least one recipient")
    formats = [f for f in dict.fromkeys(body.formats) if f in _MEDIA]
    if not formats:
        raise HTTPException(status_code=400, detail="Choose PDF, Excel or both")

    odoo = get_odoo_client()
    customer = await _assert_statement_access(current_user, customer_id, odoo)
    stmt = await _build(odoo, customer_id, body.company_id, body.date_from, body.date_to, body.mode)
    company = stmt["company"]

    attachments = []
    for f in formats:
        builder = build_statement_pdf if f == "pdf" else build_statement_xlsx
        content = await run_in_threadpool(builder, stmt)
        attachments.append({"filename": statement_filename(stmt, f), "content": content})

    ageing = stmt.get("ageing") or {}
    bank = company.get("bank") or {}
    period_label = statement_period_label(stmt)
    background_tasks.add_task(
        send_customer_statement,
        customer_email=recipients[0],
        cc=recipients[1:] or None,
        customer_name=customer.get("name") or "",
        company_name=company.get("name") or "",
        period_label=period_label,
        total_due=float(ageing.get("total_due") or 0),
        overdue=float(ageing.get("overdue") or 0),
        payment_reference=customer.get("ref") or customer.get("name") or "",
        bank_details=bank.get("account") or "",
        attachments=attachments,
        is_open_items=body.mode == "open",
        reply_to=company.get("email"),
    )

    now = datetime.now(timezone.utc)
    send_doc = {
        "id": str(uuid.uuid4()),
        "customer_partner_id": customer["id"],
        "customer_name": customer.get("name"),
        "company_id": company["id"],
        "company_name": company.get("name"),
        "mode": body.mode,
        "date_from": stmt.get("date_from"),
        "date_to": stmt.get("date_to"),
        "period_label": period_label,
        "recipients": recipients,
        "formats": formats,
        "total_due": ageing.get("total_due"),
        "overdue": ageing.get("overdue"),
        "sent_by": {"id": current_user.get("id"), "name": current_user.get("name") or current_user.get("username")},
        "sent_at": now,
    }
    await col("statement_sends").insert_one(dict(send_doc))

    # Chatter note on the customer, so the send is visible from either side.
    try:
        odoo.message_post(
            "res.partner", customer["id"],
            f"Statement ({period_label}, {company.get('name')}) sent to {', '.join(recipients)} "
            "via the Bassani Health Portal.",
        )
    except Exception:
        pass

    await audit_log(
        "customer.statement_sent", "customer", customer["id"],
        entity_label=customer.get("name"), user=current_user,
        ip=request.client.host if request.client else None,
        detail={k: send_doc[k] for k in ("company_id", "mode", "date_from", "date_to",
                                          "recipients", "formats", "total_due")},
    )
    send_doc["sent_at"] = now.isoformat()
    return {"success": True, "send": send_doc}


@router.get("/{customer_id}/statement/sends")
async def list_statement_sends(
    customer_id: int,
    limit: int = Query(10, ge=1, le=50),
    current_user: dict = Depends(get_current_user),
):
    """Recent statement emails for this customer (staff only)."""
    if current_user.get("role") in ("reseller", "customer"):
        raise HTTPException(status_code=403, detail="Access denied")
    odoo = get_odoo_client()
    customer = await _assert_statement_access(current_user, customer_id, odoo)
    rows = await col("statement_sends").find(
        {"customer_partner_id": customer["id"]}, NO_ID,
    ).sort("sent_at", -1).to_list(limit)
    for r in rows:
        dt = r.get("sent_at")
        if isinstance(dt, datetime):
            # Mongo hands back naive UTC; mark it so the browser doesn't read it as local time.
            r["sent_at"] = (dt if dt.tzinfo else dt.replace(tzinfo=timezone.utc)).isoformat()
    return {"sends": rows}
