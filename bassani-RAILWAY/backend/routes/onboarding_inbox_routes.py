"""
Onboarding Inbox — Phase 11 (multi-mailbox extension).

Surfaces a second shared mailbox dedicated to customer onboarding documents.
Staff with the onboarding.inbox permission can read threads, reply, link an
incoming email to an existing onboarding application, and save attachments
directly to a customer's document profile in R2.

Key differences from the sales inbox:
- Collection: onboarding_inbox (separate from sales_inbox)
- Mailbox slug: "onboarding"
- No ticket creation — onboarding threads go through the application workflow
- Adds a link-application action and a save-attachment-to-profile action
"""
import logging
import os
import re as _re
import uuid
from datetime import datetime, timedelta, timezone
from typing import List, Optional

from bson import ObjectId
from fastapi import APIRouter, BackgroundTasks, Depends, HTTPException, Query, Request
from fastapi.responses import Response
from pydantic import BaseModel

from auth import require_permission
from database import col, NO_ID
from middleware.audit import audit_log
from services.graph_client import graph_configured, send_reply as graph_send_reply
from services.graph_subscription import get_client_state
from services.imap_client import (
    get_config as get_imap_config,
    imap_configured,
    send_new_email as imap_send_new_email,
    send_reply as imap_send_reply,
)
from services.inbox_service import (
    ingest_graph_message,
    ingest_imap_message,
    mark_thread_read,
    resolve_customer,
    save_attachment_to_profile,
)

logger = logging.getLogger(__name__)
router = APIRouter(prefix="/api/onboarding-inbox", tags=["onboarding-inbox"])

_COLLECTION = "onboarding_inbox"
_MAILBOX    = "onboarding"


# ── Pydantic models ───────────────────────────────────────────────────────────

class ReplyBody(BaseModel):
    body_html: str


class LinkApplicationBody(BaseModel):
    application_id: str


class SaveAttachmentBody(BaseModel):
    label: Optional[str] = None


class SendDocsBody(BaseModel):
    to_email: str
    customer_name: Optional[str] = ""
    odoo_partner_id: Optional[int] = None  # when set, pre-stamps customer on the thread


class DocAssignment(BaseModel):
    attachment_id: str
    label: str               # human-readable label for the document
    doc_type: Optional[str] = None  # structured type if one of the five standard slots


class SaveDocumentsBody(BaseModel):
    assignments: List[DocAssignment]


class LinkCustomerBody(BaseModel):
    odoo_partner_id: int


class DocMapping(BaseModel):
    attachment_id: str   # att.id (Graph) or att.imap_attachment_id (IMAP)
    doc_type: str        # one of the five REQUIRED_DOC_TYPES keys


class CreateCustomerSessionBody(BaseModel):
    mappings: List[DocMapping]


class SaveToApplicationBody(BaseModel):
    app_id: str
    assignments: List[DocAssignment]


# ── Helpers ───────────────────────────────────────────────────────────────────

def _onboarding_configured() -> bool:
    from services.imap_client import imap_configured as _ic, get_graph_mailbox_address
    return _ic(_MAILBOX) or bool(get_graph_mailbox_address(_MAILBOX))


def _active_onboarding_mailbox_address() -> str:
    from services.imap_client import get_graph_mailbox_address, get_config
    addr = get_graph_mailbox_address(_MAILBOX)
    if addr:
        return addr
    cfg = get_config(_MAILBOX)
    if cfg:
        return cfg.get("mailbox_address") or cfg.get("imap_username", "")
    return ""


def _not_configured() -> None:
    raise HTTPException(
        status_code=503,
        detail=(
            "Onboarding Inbox is not yet active. A super admin must connect a mailbox "
            "in Settings > Onboarding Mailbox."
        ),
    )


def _oid(id_str: str) -> ObjectId:
    try:
        return ObjectId(id_str)
    except Exception:
        raise HTTPException(status_code=404, detail="Inbox item not found")


def _fmt(doc: dict) -> dict:
    doc["id"] = str(doc.pop("_id"))
    return doc


def _actor(user: dict) -> str:
    return user.get("name") or user.get("username") or "unknown"


# ── Graph webhook ─────────────────────────────────────────────────────────────

@router.post("/graph-webhook", include_in_schema=False)
async def graph_webhook(
    request: Request,
    background_tasks: BackgroundTasks,
    validationToken: Optional[str] = Query(None),
):
    if validationToken:
        return Response(content=validationToken, media_type="text/plain", status_code=200)

    try:
        body = await request.json()
    except Exception:
        raise HTTPException(status_code=400, detail="Invalid JSON")

    stored_client_state = await get_client_state(_MAILBOX)

    for notification in body.get("value", []):
        notification_state = notification.get("clientState", "")
        if not notification_state or notification_state != stored_client_state:
            logger.warning(
                "onboarding_inbox_webhook_invalid_state received=%s expected=%s",
                notification_state, stored_client_state,
            )
            continue

        if notification.get("changeType") != "created":
            continue

        graph_message_id = notification.get("resourceData", {}).get("id", "")
        if not graph_message_id:
            continue

        background_tasks.add_task(ingest_graph_message, _COLLECTION, _MAILBOX, graph_message_id)

    return Response(status_code=202)


# ── Manual poll ───────────────────────────────────────────────────────────────

@router.post("/poll")
async def poll_inbox(
    background_tasks: BackgroundTasks,
    current_user: dict = Depends(require_permission("onboarding.inbox")),
):
    if not _onboarding_configured():
        _not_configured()

    from services.imap_client import get_graph_mailbox_address
    mailbox_address = get_graph_mailbox_address(_MAILBOX)

    if graph_configured() and mailbox_address:
        from services.graph_client import list_messages
        try:
            cutoff = (datetime.now(timezone.utc) - timedelta(hours=72)).strftime("%Y-%m-%dT%H:%M:%SZ")
            msgs = await list_messages(filter_str=f"receivedDateTime ge {cutoff}", top=50, mailbox_address=mailbox_address)
        except Exception as exc:
            raise HTTPException(status_code=502, detail=f"Graph API error: {exc}")
        count = 0
        for m in msgs:
            mid = m.get("id", "")
            if mid:
                background_tasks.add_task(ingest_graph_message, _COLLECTION, _MAILBOX, mid)
                count += 1
        return {"queued": count, "backend": "graph"}

    from services.imap_client import fetch_new_messages
    try:
        msgs = await fetch_new_messages(_MAILBOX)
    except Exception as exc:
        raise HTTPException(status_code=502, detail=f"IMAP error: {exc}")
    count = 0
    for m in msgs:
        background_tasks.add_task(ingest_imap_message, _COLLECTION, _MAILBOX, m)
        count += 1
    return {"queued": count, "backend": "imap"}


# ── Counts ────────────────────────────────────────────────────────────────────

@router.get("/unhandled-count")
async def unhandled_count(
    current_user: dict = Depends(require_permission("onboarding.inbox")),
):
    if not _onboarding_configured():
        return {"count": 0}
    count_filter: dict = {"status": "unhandled"}
    addr = _active_onboarding_mailbox_address()
    if addr:
        count_filter["mailbox_address"] = addr
    count = await col(_COLLECTION).count_documents(count_filter)
    return {"count": count}


# ── List ──────────────────────────────────────────────────────────────────────

@router.get("")
async def list_inbox(
    status: Optional[str] = Query(
        None,
        description="open | unhandled | pending_onboarding | application_linked | archived | all",
    ),
    unknown_only: bool = Query(False),
    q: Optional[str] = Query(None),
    skip: int = Query(0, ge=0),
    limit: int = Query(50, le=100),
    current_user: dict = Depends(require_permission("onboarding.inbox")),
):
    if not _onboarding_configured():
        return {"items": [], "total": 0, "configured": False}

    # Include inbound messages + outgoing thread roots that are linked to
    # an application (portal confirmation emails, admin-initiated contacts).
    # Outgoing replies are still excluded — they belong inside the thread view.
    # Thread roots are identified by thread_root_id == str(_id) (self-referential).
    match: dict = {"$or": [
        {"is_outgoing": {"$ne": True}},
        {
            "is_outgoing":  True,
            "application_id": {"$exists": True, "$ne": None},
            "$expr": {"$eq": ["$thread_root_id", {"$toString": "$_id"}]},
        },
    ]}
    addr = _active_onboarding_mailbox_address()
    if addr:
        match["mailbox_address"] = addr

    if status == "open" or not status:
        match["status"] = {"$nin": ["archived"]}
    elif status and status != "all":
        match["status"] = status

    if unknown_only:
        match["is_unknown_sender"] = True

    if q:
        pattern = {"$regex": _re.escape(q), "$options": "i"}
        match["$or"] = [
            {"from_name": pattern},
            {"from_email": pattern},
            {"subject": pattern},
            {"body_preview": pattern},
        ]

    group_key = {"$ifNull": ["$thread_root_id", {"$toString": "$_id"}]}

    count_result = await col(_COLLECTION).aggregate([
        {"$match": match},
        {"$group": {"_id": group_key}},
        {"$count": "total"},
    ]).to_list(1)
    total = count_result[0]["total"] if count_result else 0

    pipeline = [
        {"$match": match},
        {"$sort": {"received_at": -1}},
        {"$group": {
            "_id": group_key,
            "doc":            {"$first": "$$ROOT"},
            "message_count":  {"$sum": 1},
            "unread_count":   {"$sum": {
                "$cond": [{"$eq": [{"$ifNull": ["$is_read", True]}, False]}, 1, 0]
            }},
            "application_id": {"$max": "$application_id"},
        }},
        {"$sort": {"doc.received_at": -1}},
        {"$skip": skip},
        {"$limit": limit},
        {"$replaceRoot": {
            "newRoot": {
                "$mergeObjects": ["$doc", {
                    "message_count":  "$message_count",
                    "unread_count":   "$unread_count",
                    "has_unread":     {"$gt": ["$unread_count", 0]},
                    "application_id": "$application_id",
                }]
            }
        }},
        {"$project": {"body_html": 0}},
    ]

    results = await col(_COLLECTION).aggregate(pipeline).to_list(limit)
    items = [_fmt(doc) for doc in results]
    return {"items": items, "total": total, "configured": True, "mailbox_address": _active_onboarding_mailbox_address()}


# ── Detail ────────────────────────────────────────────────────────────────────

@router.get("/{item_id}")
async def get_inbox_item(
    item_id: str,
    current_user: dict = Depends(require_permission("onboarding.inbox")),
):
    if not _onboarding_configured():
        _not_configured()
    doc = await col(_COLLECTION).find_one({"_id": _oid(item_id)})
    if not doc:
        raise HTTPException(status_code=404, detail="Inbox item not found")
    return _fmt(doc)


@router.post("/{item_id}/mark-read")
async def mark_read(
    item_id: str,
    current_user: dict = Depends(require_permission("onboarding.inbox")),
):
    await mark_thread_read(_COLLECTION, item_id)
    return {"success": True}


@router.get("/{item_id}/thread")
async def get_thread(
    item_id: str,
    background_tasks: BackgroundTasks,
    current_user: dict = Depends(require_permission("onboarding.inbox")),
):
    """All messages in the thread, oldest first. Auto-marks as read."""
    if not _onboarding_configured():
        _not_configured()
    item = await col(_COLLECTION).find_one(
        {"_id": _oid(item_id)},
        {"graph_conversation_id": 1, "thread_root_id": 1, "imap_message_id": 1},
    )
    if not item:
        raise HTTPException(status_code=404, detail="Inbox item not found")

    conv_id  = item.get("graph_conversation_id")
    root_id  = item.get("thread_root_id")
    imap_mid = item.get("imap_message_id")

    if conv_id:
        filt = {"graph_conversation_id": conv_id}
    elif root_id:
        filt = {"$or": [{"_id": ObjectId(root_id)}, {"thread_root_id": root_id}]}
    elif imap_mid:
        filt = {"$or": [{"imap_message_id": imap_mid}, {"thread_root_id": str(item["_id"])}]}
    else:
        return {"thread": [_fmt(item)]}

    cursor = col(_COLLECTION).find(filt).sort("received_at", 1)
    thread = [_fmt(doc) async for doc in cursor]

    background_tasks.add_task(mark_thread_read, _COLLECTION, item_id)

    return {"thread": thread}


# ── Attachment download ───────────────────────────────────────────────────────

@router.get("/{item_id}/attachment/{attachment_id}")
async def download_attachment(
    item_id: str,
    attachment_id: str,
    current_user: dict = Depends(require_permission("onboarding.inbox")),
):
    """Download a Graph attachment on-demand."""
    from services.imap_client import get_graph_mailbox_address
    from services.graph_client import get_attachment_content

    item = await col(_COLLECTION).find_one(
        {"_id": _oid(item_id)}, {"graph_message_id": 1, "attachments": 1}
    )
    if not item:
        raise HTTPException(status_code=404, detail="Inbox item not found")
    if not item.get("graph_message_id"):
        raise HTTPException(status_code=400, detail="This message was not received via Graph")

    meta = next((a for a in item.get("attachments", []) if a.get("id") == attachment_id), None)
    if not meta:
        raise HTTPException(status_code=404, detail="Attachment not found")

    mailbox_address = get_graph_mailbox_address(_MAILBOX)
    try:
        content, content_type, filename = await get_attachment_content(
            item["graph_message_id"], attachment_id, mailbox_address=mailbox_address
        )
    except Exception as exc:
        raise HTTPException(status_code=502, detail=f"Could not fetch attachment: {exc}")

    return Response(
        content=content,
        media_type=content_type,
        headers={"Content-Disposition": f'attachment; filename="{filename}"'},
    )


@router.get("/{item_id}/imap-attachment/{attachment_id}")
async def download_imap_attachment(
    item_id: str,
    attachment_id: str,
    current_user: dict = Depends(require_permission("onboarding.inbox")),
):
    """Download an IMAP-stored attachment."""
    try:
        att_oid = ObjectId(attachment_id)
    except Exception:
        raise HTTPException(status_code=404, detail="Attachment not found")

    att = await col(f"{_COLLECTION}_attachments").find_one(
        {"_id": att_oid, "inbox_item_id": item_id}
    )
    if not att:
        raise HTTPException(status_code=404, detail="Attachment not found")

    return Response(
        content=bytes(att["content"]),
        media_type=att.get("content_type", "application/octet-stream"),
        headers={"Content-Disposition": f'attachment; filename="{att["name"]}"'},
    )


# ── Actions ───────────────────────────────────────────────────────────────────

@router.post("/{item_id}/reply")
async def reply_to_email(
    item_id: str,
    body: ReplyBody,
    background_tasks: BackgroundTasks,
    current_user: dict = Depends(require_permission("onboarding.inbox")),
):
    if not _onboarding_configured():
        _not_configured()

    if not body.body_html.strip():
        raise HTTPException(status_code=400, detail="Reply body cannot be empty")

    item = await col(_COLLECTION).find_one({"_id": _oid(item_id)})
    if not item:
        raise HTTPException(status_code=404, detail="Inbox item not found")

    # Concurrent reply guard
    thread_root_check = item.get("thread_root_id") or item_id
    recent_reply = await col(_COLLECTION).find_one({
        "$or": [
            {"_id": ObjectId(thread_root_check)},
            {"thread_root_id": thread_root_check},
        ],
        "is_outgoing": True,
        "created_at": {"$gt": datetime.now(timezone.utc) - timedelta(seconds=30)},
    }, {"_id": 1})
    if recent_reply:
        raise HTTPException(
            status_code=409,
            detail="A reply was just sent to this thread. Wait a moment before sending another.",
        )

    from services.imap_client import get_graph_mailbox_address
    mailbox_address = get_graph_mailbox_address(_MAILBOX)

    sent_message_id = None
    try:
        if graph_configured() and item.get("graph_message_id") and mailbox_address:
            await graph_send_reply(item["graph_message_id"], body.body_html, mailbox_address=mailbox_address)
        else:
            subj = item.get("subject", "")
            if not subj.lower().startswith("re:"):
                subj = f"Re: {subj}"
            parent_mid = item.get("imap_message_id", "")
            parent_refs = item.get("imap_references", "")
            refs = f"{parent_refs} {parent_mid}".strip() if parent_mid else parent_refs
            sent_message_id = await imap_send_reply(
                to_email=item["from_email"],
                subject=subj,
                body_html=body.body_html,
                in_reply_to=parent_mid,
                references=refs,
                mailbox=_MAILBOX,
            )
    except Exception as exc:
        raise HTTPException(status_code=502, detail=f"Could not send reply: {exc}")

    now = datetime.now(timezone.utc)
    actor = _actor(current_user)
    preview = _re.sub(r"<[^>]+>", "", body.body_html)[:500].strip()
    imap_cfg = get_imap_config(_MAILBOX)
    from_email_out = imap_cfg["mailbox_address"] if imap_cfg else item.get("from_email", "")
    thread_root = item.get("thread_root_id") or item_id
    outgoing = {
        "mailbox_address":       from_email_out,
        "imap_references":       item.get("imap_message_id", ""),
        "from_email":            from_email_out,
        "from_name":             actor,
        "subject":               ("Re: " + item.get("subject", "")).replace("Re: Re: ", "Re: "),
        "body_html":             body.body_html,
        "body_preview":          preview,
        "received_at":           now,
        "is_outgoing":           True,
        "is_reply":              True,
        "has_attachments":       False,
        "attachments":           [],
        "thread_root_id":        thread_root,
        "graph_conversation_id": item.get("graph_conversation_id"),
        "customer_id":           item.get("customer_id"),
        "customer_name":         item.get("customer_name"),
        "is_unknown_sender":     False,
        "application_id":        item.get("application_id"),
        "status":                "sent",
        "is_read":               True,
        "created_at":            now,
        "handled_by":            current_user.get("username"),
        "handled_at":            now,
    }
    if sent_message_id:
        outgoing["imap_message_id"] = sent_message_id
    await col(_COLLECTION).insert_one(outgoing)

    background_tasks.add_task(
        audit_log,
        "onboarding_inbox.reply_sent", "onboarding_inbox_item", item_id,
        entity_label=item.get("subject", ""),
        user=current_user,
        detail={"to": item.get("from_email"), "preview": body.body_html[:300]},
    )

    return {"success": True}


@router.post("/{item_id}/link-application")
async def link_application(
    item_id: str,
    body: LinkApplicationBody,
    background_tasks: BackgroundTasks,
    current_user: dict = Depends(require_permission("onboarding.inbox")),
):
    """Link a thread to an existing customer onboarding application."""
    item = await col(_COLLECTION).find_one({"_id": _oid(item_id)})
    if not item:
        raise HTTPException(status_code=404, detail="Inbox item not found")

    application = await col("onboarding_applications").find_one(
        {"_id": ObjectId(body.application_id)}, {"_id": 1, "company_name": 1}
    )
    if not application:
        raise HTTPException(status_code=404, detail="Application not found")

    thread_root_str = item.get("thread_root_id") or str(item["_id"])
    await col(_COLLECTION).update_many(
        {"$or": [
            {"_id": ObjectId(thread_root_str)},
            {"thread_root_id": thread_root_str},
        ]},
        {"$set": {
            "application_id": body.application_id,
            "status":         "application_linked",
        }},
    )

    background_tasks.add_task(
        audit_log,
        "onboarding_inbox.application_linked", "onboarding_inbox_item", item_id,
        entity_label=item.get("subject", ""),
        user=current_user,
        detail={
            "application_id":   body.application_id,
            "application_name": application.get("company_name", ""),
        },
    )

    return {"success": True, "application_id": body.application_id}


@router.post("/{item_id}/save-attachment/{attachment_id}")
async def save_attachment(
    item_id: str,
    attachment_id: str,
    body: SaveAttachmentBody,
    background_tasks: BackgroundTasks,
    current_user: dict = Depends(require_permission("onboarding.inbox")),
):
    """Stream an inbox attachment to R2 and create a customer_documents record."""
    try:
        record = await save_attachment_to_profile(
            _COLLECTION, _MAILBOX, item_id, attachment_id, body.label or ""
        )
    except ValueError as exc:
        raise HTTPException(status_code=422, detail=str(exc))
    except Exception as exc:
        raise HTTPException(status_code=502, detail=f"Could not save attachment: {exc}")

    background_tasks.add_task(
        audit_log,
        "onboarding_inbox.attachment_saved", "onboarding_inbox_item", item_id,
        user=current_user,
        detail={
            "attachment_id": attachment_id,
            "label":         body.label,
            "r2_key":        record.get("r2_key"),
        },
    )

    return {"success": True, "document": record}


@router.post("/{item_id}/archive")
async def archive_item(
    item_id: str,
    background_tasks: BackgroundTasks,
    current_user: dict = Depends(require_permission("onboarding.inbox")),
):
    if not _onboarding_configured():
        _not_configured()

    item = await col(_COLLECTION).find_one({"_id": _oid(item_id)})
    if not item:
        raise HTTPException(status_code=404, detail="Inbox item not found")

    thread_root_str = item.get("thread_root_id") or str(item["_id"])
    now = datetime.now(timezone.utc)
    await col(_COLLECTION).update_many(
        {"$or": [
            {"_id": ObjectId(thread_root_str)},
            {"thread_root_id": thread_root_str},
        ]},
        {"$set": {
            "status":     "archived",
            "handled_by": current_user.get("username"),
            "handled_at": now,
            "expires_at": now + timedelta(days=180),
        }},
    )

    background_tasks.add_task(
        audit_log,
        "onboarding_inbox.archived", "onboarding_inbox_item", item_id,
        entity_label=item.get("subject", ""),
        user=current_user,
    )

    return {"success": True}


# ── Send onboarding docs from mailbox ─────────────────────────────────────────

@router.post("/send-docs")
async def send_docs(
    body: SendDocsBody,
    background_tasks: BackgroundTasks,
    current_user: dict = Depends(require_permission("onboarding.inbox")),
):
    """
    Send onboarding template PDFs from the configured onboarding SMTP mailbox.
    Creates a thread root doc in onboarding_inbox so the customer's reply
    auto-threads via In-Reply-To matching.
    """
    import os
    if not _onboarding_configured():
        _not_configured()

    from services.imap_client import get_graph_mailbox_address
    imap_cfg = get_imap_config(_MAILBOX)
    onboarding_graph_address = get_graph_mailbox_address(_MAILBOX)
    use_graph = graph_configured() and bool(onboarding_graph_address)

    if not use_graph and not imap_cfg:
        raise HTTPException(status_code=503, detail="Onboarding mailbox not configured")

    _TEMPLATE_DIR = os.path.join(os.path.dirname(__file__), "..", "static", "onboarding-templates")
    _TEMPLATES = [
        ("store-onboarding-agreement.pdf", "Bassani Health Store Onboarding Agreement"),
        ("customer-information-form.pdf",  "Bassani Health Customer Information Form"),
        ("nda.pdf",                        "Bassani Health NDA"),
        ("tqa.pdf",                        "Bassani Health TQA Document"),
    ]
    file_attachments = []
    for filename, display_name in _TEMPLATES:
        fpath = os.path.join(_TEMPLATE_DIR, filename)
        if os.path.exists(fpath):
            with open(fpath, "rb") as f:
                file_attachments.append({
                    "filename":     f"{display_name}.pdf",
                    "content":      f.read(),
                    "content_type": "application/pdf",
                })

    from services.email_service import _wrap as _email_wrap, _h1, _p, _info_box, _divider
    greeting = f"Dear {body.customer_name}," if body.customer_name else "Dear Customer,"
    body_html = _email_wrap(
        _p(greeting)
        + _h1("Your onboarding documents")
        + _p("Please find your Bassani Health onboarding documents attached to this email.")
        + _p(
            "Once you have completed and signed all documents, please "
            "<strong>reply directly to this email</strong> with all five signed documents "
            "attached. Your reply will be received in our secure onboarding inbox and reviewed "
            "by our team promptly."
        )
        + _info_box([
            ("Attached templates",   f"{len(file_attachments)} documents"),
            ("Also required",        "CIPC Company Registration Certificate"),
            ("How to return signed docs", "Reply directly to this email with all five attached"),
        ])
        + _divider()
        + _p(
            "If you have any questions before returning your documents, please reply to this email "
            "and a member of the team will assist you.", muted=True
        ),
        footer_note=(
            "Please reply to this email with your five completed documents attached. "
            "Bassani Health &nbsp;&middot;&nbsp; Cnr Dytchley &amp; Marcius Roads, Kyalami"
        ),
    )
    subject = "Bassani Health: Onboarding Documents"
    now = datetime.now(timezone.utc)
    if use_graph:
        from_address = onboarding_graph_address
    else:
        from_address = imap_cfg.get("mailbox_address") or imap_cfg.get("imap_username", "") if imap_cfg else ""

    # Create thread root before sending so we have the item_id for the update
    preview = f"Onboarding documents sent to {body.to_email}"
    thread_doc = {
        "from_email":       from_address,
        "from_name":        "Bassani Health",
        "to_email":         body.to_email,
        "subject":          subject,
        "body_html":        body_html,
        "body_preview":     preview,
        "is_outgoing":      True,
        "status":           "sent",
        "received_at":      now,
        "has_attachments":  bool(file_attachments),
        "attachments":      [{"name": a["filename"]} for a in file_attachments],
        "thread_root_id":   None,
        "customer_name":    body.customer_name or "",
        "is_read":          True,
        "created_at":       now,
        "sent_by":          current_user.get("username"),
    }
    result = await col(_COLLECTION).insert_one(thread_doc)
    item_id = str(result.inserted_id)
    stamp = {"thread_root_id": item_id}
    if body.odoo_partner_id:
        stamp["customer_id"] = body.odoo_partner_id
    await col(_COLLECTION).update_one(
        {"_id": result.inserted_id},
        {"$set": stamp},
    )

    async def _do_send():
        try:
            if use_graph:
                from services.graph_client import send_mail as graph_send_mail
                await graph_send_mail(
                    to_email=body.to_email,
                    subject=subject,
                    body_html=body_html,
                    file_attachments=file_attachments,
                    mailbox_address=onboarding_graph_address,
                )
            else:
                message_id = await imap_send_new_email(
                    to_email=body.to_email,
                    subject=subject,
                    body_html=body_html,
                    file_attachments=file_attachments,
                    mailbox=_MAILBOX,
                )
                await col(_COLLECTION).update_one(
                    {"_id": result.inserted_id},
                    {"$set": {"imap_message_id": message_id}},
                )
        except Exception as exc:
            logger.error("onboarding_inbox.send_docs_error item=%s error=%s", item_id, exc)

    background_tasks.add_task(_do_send)

    background_tasks.add_task(
        audit_log,
        "onboarding_inbox.docs_sent", _COLLECTION, item_id,
        entity_label=body.to_email,
        user=current_user,
        after={"to_email": body.to_email, "customer_name": body.customer_name},
    )

    return {"success": True, "item_id": item_id}


# ── Link thread to an existing Odoo customer ──────────────────────────────────

@router.post("/{item_id}/link-customer")
async def link_customer(
    item_id: str,
    body: LinkCustomerBody,
    background_tasks: BackgroundTasks,
    current_user: dict = Depends(require_permission("onboarding.inbox")),
):
    """Manually link a thread to an existing Odoo customer profile."""
    item = await col(_COLLECTION).find_one({"_id": _oid(item_id)})
    if not item:
        raise HTTPException(status_code=404, detail="Inbox item not found")

    from odoo_client import get_odoo_client
    odoo = get_odoo_client()
    try:
        partners = odoo.read("res.partner", [body.odoo_partner_id], fields=["name", "email"])
    except Exception as exc:
        raise HTTPException(status_code=502, detail=f"Odoo error: {exc}")
    if not partners:
        raise HTTPException(status_code=404, detail="Customer not found in Odoo")

    customer_name = partners[0]["name"]
    thread_root_str = item.get("thread_root_id") or str(item["_id"])

    await col(_COLLECTION).update_many(
        {"$or": [
            {"_id": ObjectId(thread_root_str)},
            {"thread_root_id": thread_root_str},
        ]},
        {"$set": {
            "customer_id":   body.odoo_partner_id,
            "customer_name": customer_name,
        }},
    )

    background_tasks.add_task(
        audit_log,
        "onboarding_inbox.customer_linked", _COLLECTION, item_id,
        entity_label=customer_name,
        user=current_user,
        after={"customer_id": body.odoo_partner_id, "customer_name": customer_name},
    )

    return {"success": True, "customer_name": customer_name}


# ── Save inbox attachments to an onboarding application ──────────────────────

@router.post("/{item_id}/save-documents-to-application")
async def save_documents_to_application(
    item_id: str,
    body: SaveToApplicationBody,
    background_tasks: BackgroundTasks,
    current_user: dict = Depends(require_permission("onboarding.inbox")),
):
    """
    Save inbox thread attachments directly to an onboarding application's document slots.
    Used for reseller-originated threads where the Odoo customer doesn't exist yet.
    Bytes are fetched from inbox storage and written to R2 under
    onboarding/applications/{app_id}/{doc_type}. Replaces any existing entry for
    the same doc_type in the application's documents array.
    On approval, the application's documents are referenced into customer_documents
    by key — no R2 copy is made at that point.
    """
    from services.graph_client import get_attachment_content, graph_configured
    from services.imap_client import get_graph_mailbox_address
    from services.r2_client import r2_put

    app = await col("customer_onboarding").find_one({"id": body.app_id})
    if not app:
        raise HTTPException(status_code=404, detail="Application not found")
    if app.get("status") not in {"pending", "awaiting_docs"}:
        raise HTTPException(status_code=400, detail="Application is not in a state that accepts document uploads")

    root_doc = await col(_COLLECTION).find_one({"_id": _oid(item_id)})
    if not root_doc:
        raise HTTPException(status_code=404, detail="Inbox item not found")

    thread_root_id = root_doc.get("thread_root_id") or str(root_doc["_id"])
    root_oid = ObjectId(thread_root_id)

    thread_items: list[dict] = []
    async for doc in col(_COLLECTION).find(
        {"$or": [{"_id": root_oid}, {"thread_root_id": thread_root_id}]}
    ):
        thread_items.append(doc)

    att_map: dict[str, tuple] = {}
    for ti in thread_items:
        for att in ti.get("attachments", []):
            key = att.get("id") or att.get("imap_attachment_id")
            if key and key not in att_map:
                att_map[key] = (att, ti)

    mailbox_address = get_graph_mailbox_address(_MAILBOX)
    saved_docs: list[dict] = []
    existing_docs = list(app.get("documents") or [])

    for assignment in body.assignments:
        if not assignment.doc_type or assignment.doc_type not in _REQUIRED_DOC_TYPES:
            continue

        pair = att_map.get(assignment.attachment_id)
        if not pair:
            logger.warning(
                "onboarding_inbox.save_to_app_att_missing att=%s app=%s",
                assignment.attachment_id, body.app_id,
            )
            continue

        att_meta, parent_item = pair
        filename     = att_meta.get("name", "attachment")
        content_type = att_meta.get("content_type", "application/octet-stream")
        content: bytes = b""

        if att_meta.get("r2_key"):
            from services.r2_client import r2_get
            try:
                content = await r2_get(att_meta["r2_key"])
            except Exception as exc:
                logger.error("onboarding_inbox.save_to_app_r2_error att=%s error=%s", assignment.attachment_id, exc)
                continue

        elif graph_configured() and parent_item.get("graph_message_id") and att_meta.get("id"):
            try:
                raw, ct, fn = await get_attachment_content(
                    parent_item["graph_message_id"], att_meta["id"],
                    mailbox_address=mailbox_address,
                )
                content = raw; content_type = ct or content_type; filename = fn or filename
            except Exception as exc:
                logger.error("onboarding_inbox.save_to_app_graph_error att=%s error=%s", assignment.attachment_id, exc)
                continue

        elif att_meta.get("imap_attachment_id"):
            stored = await col(f"{_COLLECTION}_attachments").find_one(
                {"_id": ObjectId(att_meta["imap_attachment_id"])}
            )
            if not stored:
                logger.warning("onboarding_inbox.save_to_app_att_expired att=%s", assignment.attachment_id)
                continue
            content = bytes(stored["content"])

        else:
            continue

        if not content:
            continue

        ext    = os.path.splitext(filename)[1] or ".pdf"
        r2_key = f"onboarding/applications/{body.app_id}/{assignment.doc_type}{ext}"
        await r2_put(r2_key, content, content_type)

        new_doc = {
            "doc_type":    assignment.doc_type,
            "label":       _REQUIRED_DOC_TYPES[assignment.doc_type],
            "r2_key":      r2_key,
            "filename":    filename,
            "size":        len(content),
            "uploaded_at": datetime.now(timezone.utc).isoformat(),
            "source":      "inbox",
        }
        existing_docs = [d for d in existing_docs if d.get("doc_type") != assignment.doc_type]
        existing_docs.append(new_doc)
        saved_docs.append(new_doc)

    if saved_docs:
        await col("customer_onboarding").update_one(
            {"id": body.app_id},
            {"$set": {"documents": existing_docs, "updated_at": datetime.now(timezone.utc)}},
        )
        # Notify the reseller that their customer's docs are on file and the application can be completed
        if app.get("reseller_id"):
            reseller_doc = await col("resellers").find_one({"id": app["reseller_id"]}, NO_ID)
            if reseller_doc:
                user_doc = await col("users").find_one({"id": reseller_doc.get("user_id")}, NO_ID)
                reseller_email = (user_doc or {}).get("email")
                if reseller_email:
                    from services.email_service import send_onboarding_docs_received_reseller
                    background_tasks.add_task(
                        send_onboarding_docs_received_reseller,
                        company_name=app.get("company_name") or "",
                        reseller_name=reseller_doc.get("name", ""),
                        reseller_email=reseller_email,
                        app_id=body.app_id,
                    )

    background_tasks.add_task(
        audit_log,
        "onboarding_inbox.docs_saved_to_application", _COLLECTION, str(root_oid),
        entity_label=f"app:{body.app_id}",
        user=current_user,
        after={
            "saved": len(saved_docs),
            "app_id": body.app_id,
            "documents": [{"doc_type": d["doc_type"], "filename": d["filename"]} for d in saved_docs],
        },
    )

    return {"saved": len(saved_docs), "docs": saved_docs}


# ── Stage inbox attachments into an onboarding R2 session ────────────────────

_REQUIRED_DOC_TYPES: dict[str, str] = {
    "store_onboarding_agreement": "Signed Store Onboarding Agreement",
    "customer_information_form":  "Signed Customer Information Form",
    "nda":                        "Signed NDA",
    "tqa":                        "Signed TQA Document",
    "cipc_certificate":           "CIPC Company Registration Certificate",
}


@router.post("/{item_id}/create-customer-session")
async def create_customer_session(
    item_id: str,
    body: CreateCustomerSessionBody,
    current_user: dict = Depends(require_permission("onboarding.inbox")),
):
    """
    Fetch inbox attachments (Graph or IMAP) and write them into an R2 onboarding
    session so they can be passed straight to POST /api/customers/ as staged docs.

    Searches the full thread (root + all replies) for each requested attachment_id,
    so it works whether the customer sent docs in the original email or a reply.

    Returns { session_id, documents } in the same shape as the admin Add Customer
    modal expects — pass it directly to POST /api/customers/ with document_session_id.
    """
    from services.graph_client import get_attachment_content, graph_configured
    from services.imap_client import get_graph_mailbox_address
    from services.r2_client import r2_put

    # Resolve thread root — item_id may be a reply
    root_doc = await col(_COLLECTION).find_one({"_id": _oid(item_id)})
    if not root_doc:
        raise HTTPException(status_code=404, detail="Inbox item not found")

    thread_root_id = root_doc.get("thread_root_id") or str(root_doc["_id"])
    root_oid       = ObjectId(thread_root_id)

    # Collect all items in the thread
    thread_items: list[dict] = []
    async for doc in col(_COLLECTION).find(
        {"$or": [{"_id": root_oid}, {"thread_root_id": thread_root_id}]}
    ):
        thread_items.append(doc)

    # Build flat map: att_key → (att_meta, parent_item)
    att_map: dict[str, tuple] = {}
    for ti in thread_items:
        for att in ti.get("attachments", []):
            key = att.get("id") or att.get("imap_attachment_id")
            if key and key not in att_map:
                att_map[key] = (att, ti)

    session_id = str(uuid.uuid4())
    documents: list[dict] = []

    for mapping in body.mappings:
        if mapping.doc_type not in _REQUIRED_DOC_TYPES:
            raise HTTPException(status_code=400, detail=f"Unknown doc type: {mapping.doc_type}")

        pair = att_map.get(mapping.attachment_id)
        if not pair:
            raise HTTPException(
                status_code=404,
                detail=f"Attachment not found in thread: {mapping.attachment_id}",
            )

        att_meta, parent_item = pair
        filename     = att_meta.get("name", "attachment")
        content_type = att_meta.get("content_type", "application/octet-stream")
        content: bytes = b""

        # Fetch bytes — Graph path
        if (
            graph_configured()
            and parent_item.get("graph_message_id")
            and att_meta.get("id")
        ):
            mailbox_address = get_graph_mailbox_address(_MAILBOX)
            try:
                raw, ct, fn = await get_attachment_content(
                    parent_item["graph_message_id"],
                    att_meta["id"],
                    mailbox_address=mailbox_address,
                )
                content      = raw
                content_type = ct or content_type
                filename     = fn or filename
            except Exception as exc:
                raise HTTPException(status_code=502, detail=f"Could not fetch attachment: {exc}")

        # Fetch bytes — IMAP path
        elif att_meta.get("imap_attachment_id"):
            stored = await col(f"{_COLLECTION}_attachments").find_one(
                {"_id": ObjectId(att_meta["imap_attachment_id"])}
            )
            if not stored:
                raise HTTPException(
                    status_code=404,
                    detail=f"Attachment bytes not found (may have expired): {filename}",
                )
            content = bytes(stored["content"])

        else:
            raise HTTPException(
                status_code=400,
                detail=f"Cannot retrieve bytes for attachment: {filename}",
            )

        if not content:
            raise HTTPException(status_code=400, detail=f"Attachment is empty: {filename}")

        ext    = os.path.splitext(filename)[1] or ".pdf"
        r2_key = f"onboarding/sessions/{session_id}/{mapping.doc_type}{ext}"
        await r2_put(r2_key, content, content_type)

        documents.append({
            "doc_type":    mapping.doc_type,
            "label":       _REQUIRED_DOC_TYPES[mapping.doc_type],
            "r2_key":      r2_key,
            "filename":    filename,
            "size":        len(content),
            "uploaded_at": datetime.now(timezone.utc).isoformat(),
        })

    return {"session_id": session_id, "documents": documents}


# ── Save thread attachments to customer profile (batch) ───────────────────────

@router.post("/{item_id}/save-documents")
async def save_documents(
    item_id: str,
    body: SaveDocumentsBody,
    current_user: dict = Depends(require_permission("onboarding.inbox")),
):
    """
    Save one or more thread attachments directly to a linked customer's document
    profile. The thread must already have a customer_id stamped on it.

    Each assignment names the attachment by its Graph att-id or IMAP attachment-id,
    provides a human-readable label, and optionally a structured doc_type.

    Skips any assignment whose attachment bytes cannot be retrieved rather than
    failing the whole batch — returns { saved: N } so the caller can tell the user.
    """
    from services.graph_client import get_attachment_content, graph_configured
    from services.imap_client import get_graph_mailbox_address
    from services.r2_client import r2_put

    # Resolve thread root (item_id may be a reply)
    root_doc = await col(_COLLECTION).find_one({"_id": _oid(item_id)})
    if not root_doc:
        raise HTTPException(status_code=404, detail="Inbox item not found")

    thread_root_id = root_doc.get("thread_root_id") or str(root_doc["_id"])
    root_oid       = ObjectId(thread_root_id)

    # Customer must already be linked on the thread root
    root_thread = await col(_COLLECTION).find_one({"_id": root_oid})
    customer_id = (root_thread or root_doc).get("customer_id")
    if not customer_id:
        raise HTTPException(
            status_code=400,
            detail="No customer linked to this thread — link a customer first, then save documents",
        )

    # Collect all thread items
    thread_items: list[dict] = []
    async for doc in col(_COLLECTION).find(
        {"$or": [{"_id": root_oid}, {"thread_root_id": thread_root_id}]}
    ):
        thread_items.append(doc)

    # Build flat att_map: short_key → (att_meta, parent_item)
    att_map: dict[str, tuple] = {}
    for ti in thread_items:
        for att in ti.get("attachments", []):
            key = att.get("id") or att.get("imap_attachment_id")
            if key and key not in att_map:
                att_map[key] = (att, ti)

    mailbox_address = get_graph_mailbox_address(_MAILBOX)
    saved_docs: list[dict] = []

    for assignment in body.assignments:
        pair = att_map.get(assignment.attachment_id)
        if not pair:
            logger.warning(
                "onboarding_inbox.save_documents_att_missing att=%s thread=%s",
                assignment.attachment_id, thread_root_id,
            )
            continue

        att_meta, parent_item = pair
        filename     = att_meta.get("name", "attachment")
        content_type = att_meta.get("content_type", "application/octet-stream")
        content: bytes = b""

        # Fetch bytes — R2 preferred (set at ingest for Graph), then IMAP store,
        # then live Graph API fallback for messages ingested before eager-R2.
        if att_meta.get("r2_key"):
            from services.r2_client import r2_get
            try:
                content = await r2_get(att_meta["r2_key"])
            except Exception as exc:
                logger.error(
                    "onboarding_inbox.save_documents_r2_error att=%s error=%s",
                    assignment.attachment_id, exc,
                )
                continue

        elif (
            graph_configured()
            and parent_item.get("graph_message_id")
            and att_meta.get("id")
        ):
            try:
                raw, ct, fn = await get_attachment_content(
                    parent_item["graph_message_id"],
                    att_meta["id"],
                    mailbox_address=mailbox_address,
                )
                content      = raw
                content_type = ct or content_type
                filename     = fn or filename
            except Exception as exc:
                logger.error(
                    "onboarding_inbox.save_documents_graph_error att=%s error=%s",
                    assignment.attachment_id, exc,
                )
                continue

        # Fetch bytes — IMAP path
        elif att_meta.get("imap_attachment_id"):
            stored = await col(f"{_COLLECTION}_attachments").find_one(
                {"_id": ObjectId(att_meta["imap_attachment_id"])}
            )
            if not stored:
                logger.warning(
                    "onboarding_inbox.save_documents_att_expired att=%s",
                    assignment.attachment_id,
                )
                continue
            content = bytes(stored["content"])

        else:
            continue

        if not content:
            continue

        doc_id = str(uuid.uuid4())
        r2_key = f"customers/{customer_id}/inbox-documents/{doc_id}/{filename}"
        await r2_put(r2_key, content, content_type)

        record = {
            "id":               doc_id,
            "odoo_partner_id":  customer_id,
            "label":            assignment.label or filename,
            "filename":         filename,
            "r2_key":           r2_key,
            "size":             len(content),
            "doc_type":         assignment.doc_type or "inbox_attachment",
            "uploaded_at":      datetime.now(timezone.utc),
            "source":           "inbox",
            "inbox_collection": _COLLECTION,
            "inbox_item_id":    str(root_oid),
        }
        await col("customer_documents").insert_one(record)
        record.pop("_id", None)
        saved_docs.append(record)

    # Stamp received_doc_types on the thread root and advance workflow status.
    # in_progress = some required docs saved; docs_complete = all five present.
    _REQUIRED_DOC_KEYS = {
        "store_onboarding_agreement",
        "customer_information_form",
        "nda",
        "tqa",
        "cipc_certificate",
    }
    newly_saved_types = {
        r["doc_type"] for r in saved_docs
        if r.get("doc_type") and r["doc_type"] != "inbox_attachment"
    }
    if newly_saved_types:
        existing = set((root_thread or root_doc).get("received_doc_types") or [])
        all_received = sorted(existing | newly_saved_types)
        new_status = (
            "docs_complete" if _REQUIRED_DOC_KEYS.issubset(set(all_received))
            else "in_progress"
        )
        await col(_COLLECTION).update_many(
            {"$or": [{"_id": root_oid}, {"thread_root_id": thread_root_id}]},
            {"$set": {"received_doc_types": all_received, "status": new_status}},
        )

    await audit_log(
        "onboarding_inbox.documents_saved", _COLLECTION, str(root_oid),
        entity_label=f"customer:{customer_id} thread:{thread_root_id}",
        user=current_user,
        after={
            "saved":       len(saved_docs),
            "customer_id": customer_id,
            "thread_id":   thread_root_id,
            "documents": [
                {
                    "doc_type": r.get("doc_type"),
                    "filename": r.get("filename"),
                    "label":    r.get("label"),
                }
                for r in saved_docs
            ],
        },
    )

    return {"saved": len(saved_docs), "docs": saved_docs}
