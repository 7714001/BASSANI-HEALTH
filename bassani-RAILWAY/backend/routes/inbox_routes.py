"""
Sales Inbox — Phase 11.

Surfaces the orders@bassanihealth.com shared mailbox inside the portal so
sales staff can identify customers, convert POs/RFQs into Sales Tickets, and
reply to senders without leaving the portal.

Architecture notes:
- All inbound messages are persisted in the sales_inbox MongoDB collection.
- Microsoft Graph pushes a change notification to POST /api/inbox/graph-webhook
  when a new message arrives.  The webhook responds within 200 ms (Graph
  requirement) by immediately returning 202 and processing the message in a
  BackgroundTask.
- If the subscription has lapsed (e.g. after a cold restart), POST /api/inbox/poll
  triggers a one-off poll of unread inbox messages — staff or a cron call this
  until the subscription is re-established.
- Customer matching is best-effort: we look up the sender's email against
  res.partner in Odoo.  Unknown senders are flagged is_unknown_sender=True and
  must be linked or onboarded before a ticket can be created.
- Attachment bytes are never stored; they are fetched on-demand from Graph.
"""
import logging
from datetime import datetime, timedelta, timezone
from typing import Optional

from bson import Binary as BsonBinary, ObjectId
from fastapi import APIRouter, BackgroundTasks, Depends, HTTPException, Query, Request
from fastapi.responses import Response
from pydantic import BaseModel

from auth import require_permission, require_any_permission
from database import col
from middleware.audit import audit_log
from odoo_client import get_odoo_client
from services.graph_client import (
    get_attachment_content,
    get_message,
    graph_configured,
    list_attachments,
    mark_as_read,
    send_reply as graph_send_reply,
)
from services.graph_subscription import get_client_state
import re as _re

from services.imap_client import (
    get_config as get_imap_config,
    imap_configured,
    send_reply as imap_send_reply,
)
from services.inbox_service import resolve_customer as _resolve_customer
from services.notification_service import notify_ticket_assigned

logger = logging.getLogger(__name__)
router = APIRouter(prefix="/api/inbox", tags=["inbox"])


# ── Pydantic models ───────────────────────────────────────────────────────────

class ReplyBody(BaseModel):
    body_html: str


class LinkCustomerBody(BaseModel):
    customer_id: int


class StartOnboardingBody(BaseModel):
    note: Optional[str] = None


# ── Helpers ───────────────────────────────────────────────────────────────────

def inbox_configured() -> bool:
    """True when either the Graph (M365) or IMAP backend is active."""
    return graph_configured() or imap_configured()


def _active_mailbox_address() -> str:
    """Return the email address of the currently configured sales mailbox."""
    from services.imap_client import get_graph_mailbox_address, get_config
    addr = get_graph_mailbox_address("sales")
    if addr:
        return addr
    cfg = get_config("sales")
    if cfg:
        return cfg.get("mailbox_address") or cfg.get("imap_username", "")
    return ""


def _graph_catchup_filter() -> str:
    """OData filter equivalent to IMAP's 72-hour SINCE window."""
    cutoff = datetime.now(timezone.utc) - timedelta(hours=72)
    return f"receivedDateTime ge {cutoff.strftime('%Y-%m-%dT%H:%M:%SZ')}"


def _not_configured() -> None:
    raise HTTPException(
        status_code=503,
        detail=(
            "Sales Inbox is not yet active. A super admin must connect a mailbox "
            "in Settings > Mailbox, or configure Microsoft 365 credentials "
            "(MS_TENANT_ID / MS_CLIENT_ID / MS_CLIENT_SECRET) in Railway."
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



async def _ingest_message(graph_message_id: str) -> None:
    """
    Fetch one Graph message and persist it to sales_inbox.
    Called from BackgroundTasks — never raises; logs errors instead.
    Idempotent: duplicate graph_message_id is silently skipped.
    """
    existing = await col("sales_inbox").find_one(
        {"graph_message_id": graph_message_id}, {"_id": 1}
    )
    if existing:
        return

    try:
        msg = await get_message(graph_message_id)
    except Exception as exc:
        logger.error(
            "inbox_message_fetch_failed graph_message_id=%s error=%s",
            graph_message_id,
            exc,
        )
        return

    from_addr   = msg.get("from", {}).get("emailAddress", {})
    from_email  = (from_addr.get("address") or "").lower().strip()
    from_name   = from_addr.get("name") or from_email
    conv_id     = msg.get("conversationId", "")
    subject     = msg.get("subject", "(no subject)")
    body_preview = msg.get("bodyPreview", "")[:500]
    body_html   = msg.get("body", {}).get("content", "")
    received_str = msg.get("receivedDateTime", "")
    has_att     = msg.get("hasAttachments", False)

    try:
        received_at = datetime.fromisoformat(received_str.replace("Z", "+00:00"))
    except Exception:
        received_at = datetime.now(timezone.utc)

    # Fetch attachment metadata (not content — content is on-demand via download endpoint)
    attachments: list = []
    if has_att:
        try:
            raw = await list_attachments(graph_message_id)
            attachments = [
                {
                    "id": a["id"],
                    "name": a.get("name", ""),
                    "content_type": a.get("contentType", ""),
                    "size_bytes": a.get("size", 0),
                }
                for a in raw
            ]
        except Exception as exc:
            logger.warning("inbox_attachments_fetch_failed error=%s", exc)

    customer_id, customer_name = await _resolve_customer(from_email)
    is_unknown = customer_id is None

    # Thread detection — is this a reply to an existing conversation?
    is_reply = False
    thread_root_id: Optional[str] = None
    linked_ticket_id: Optional[str] = None
    if conv_id:
        prior = await col("sales_inbox").find_one(
            {"graph_conversation_id": conv_id, "is_reply": False},
            {"_id": 1, "ticket_id": 1},
            sort=[("received_at", 1)],
        )
        if prior:
            is_reply = True
            thread_root_id = str(prior["_id"])
            linked_ticket_id = prior.get("ticket_id")

    doc = {
        "graph_message_id":    graph_message_id,
        "graph_conversation_id": conv_id,
        "mailbox_address":     _active_mailbox_address(),
        "from_email":          from_email,
        "from_name":           from_name,
        "subject":             subject,
        "body_preview":        body_preview,
        "body_html":           body_html,
        "received_at":         received_at,
        "has_attachments":     has_att,
        "attachments":         attachments,
        "customer_id":         customer_id,
        "customer_name":       customer_name,
        "is_unknown_sender":   is_unknown,
        "ticket_id":           linked_ticket_id if is_reply else None,
        "is_reply":            is_reply,
        "thread_root_id":      thread_root_id,
        "status":              "reply" if is_reply else "unhandled",
        "is_read":             False,
        "created_at":          datetime.now(timezone.utc),
        "handled_by":          None,
        "handled_at":          None,
    }
    await col("sales_inbox").insert_one(doc)

    if is_reply:
        logger.info(
            "inbox_reply_appended conv_id=%s linked_ticket=%s", conv_id, linked_ticket_id
        )
    else:
        logger.info(
            "inbox_message_stored from=%s subject=%s customer_found=%s",
            from_email,
            subject,
            not is_unknown,
        )

    # Mark read in Outlook so staff don't see duplicates there
    try:
        await mark_as_read(graph_message_id)
    except Exception:
        pass


async def _ingest_imap_message(msg: dict) -> None:
    """
    Persist one IMAP-sourced message to sales_inbox.
    Idempotent: duplicate message_id is silently skipped.
    Called from the polling loop — never raises; logs errors instead.
    """
    message_id = msg.get("message_id")
    if message_id:
        existing = await col("sales_inbox").find_one(
            {"imap_message_id": message_id}, {"_id": 1}
        )
        if existing:
            return

    from_email   = msg.get("from_email", "").lower().strip()
    from_name    = msg.get("from_name", from_email)
    subject      = msg.get("subject", "(no subject)")
    in_reply_to  = msg.get("in_reply_to", "")
    references   = msg.get("references", "")
    received_at  = msg.get("received_at") or datetime.now(timezone.utc)
    body_html    = msg.get("body_html", "")
    body_preview = msg.get("body_preview", "")[:500]
    has_att      = msg.get("has_attachments", False)
    attachments  = msg.get("attachments", [])
    imap_uid     = msg.get("imap_uid", "")

    customer_id, customer_name = await _resolve_customer(from_email)
    is_unknown = customer_id is None

    # Thread detection: walk In-Reply-To then References to find any ancestor
    # already in the inbox, even when the immediate parent is missing.
    is_reply = False
    thread_root_id: Optional[str] = None
    linked_ticket_id: Optional[str] = None

    ancestor = None
    if in_reply_to:
        ancestor = await col("sales_inbox").find_one(
            {"imap_message_id": in_reply_to},
            {"_id": 1, "ticket_id": 1, "thread_root_id": 1},
        )
    if not ancestor and references:
        # Walk references newest-first to find the closest known ancestor
        for ref_mid in reversed(references.split()):
            ancestor = await col("sales_inbox").find_one(
                {"imap_message_id": ref_mid.strip()},
                {"_id": 1, "ticket_id": 1, "thread_root_id": 1},
            )
            if ancestor:
                break
    if ancestor:
        is_reply = True
        thread_root_id = str(ancestor.get("thread_root_id") or ancestor["_id"])
        linked_ticket_id = ancestor.get("ticket_id")

    # Strip attachment bytes before inserting the inbox doc — they're too large
    # to embed and will be stored separately in sales_inbox_attachments.
    attachments_meta = [
        {k: v for k, v in att.items() if k != "_content"}
        for att in attachments
    ]
    doc = {
        "imap_message_id":   message_id,
        "imap_uid":          imap_uid,
        "imap_in_reply_to":  in_reply_to,
        "imap_references":   references,
        "mailbox_address":   _active_mailbox_address(),
        "from_email":        from_email,
        "from_name":         from_name,
        "subject":           subject,
        "body_preview":      body_preview,
        "body_html":         body_html,
        "received_at":       received_at,
        "has_attachments":   has_att,
        "attachments":       attachments_meta,
        "customer_id":       customer_id,
        "customer_name":     customer_name,
        "is_unknown_sender": is_unknown,
        "ticket_id":         linked_ticket_id if is_reply else None,
        "is_reply":          is_reply,
        "thread_root_id":    thread_root_id,
        "status":            "reply" if is_reply else "unhandled",
        "is_read":           False,
        "created_at":        datetime.now(timezone.utc),
        "handled_by":        None,
        "handled_at":        None,
    }
    result = await col("sales_inbox").insert_one(doc)
    item_id_str = str(result.inserted_id)

    # Mark read in IMAP immediately after the message is safely in MongoDB.
    # This ordering guarantees we never mark an email read without having stored
    # it. Attachment failures below are non-fatal and must not block this step.
    if imap_uid:
        try:
            from services.imap_client import mark_as_read as imap_mark_read
            await imap_mark_read(imap_uid)
        except Exception as exc:
            logger.warning("imap_mark_read_failed uid=%s error=%s", imap_uid, exc)

    # Persist attachment bytes to sales_inbox_attachments (separate collection).
    # Wrapped individually — a single bad attachment must not orphan the message.
    for i, att in enumerate(attachments):
        content = att.get("_content", b"")
        if not content:
            continue
        try:
            att_result = await col("sales_inbox_attachments").insert_one({
                "inbox_item_id": item_id_str,
                "name":          att["name"],
                "content_type":  att["content_type"],
                "size_bytes":    att["size_bytes"],
                "content":       BsonBinary(content),
            })
            await col("sales_inbox").update_one(
                {"_id": result.inserted_id},
                {"$set": {f"attachments.{i}.imap_attachment_id": str(att_result.inserted_id)}},
            )
        except Exception as exc:
            logger.warning(
                "imap_attachment_store_failed inbox_id=%s name=%s error=%s",
                item_id_str, att.get("name"), exc,
            )

    logger.info(
        "inbox_imap_message_stored from=%s subject=%s reply=%s customer_found=%s",
        from_email, subject, is_reply, not is_unknown,
    )


# ── Graph webhook ─────────────────────────────────────────────────────────────

@router.post("/graph-webhook", include_in_schema=False)
async def graph_webhook(
    request: Request,
    background_tasks: BackgroundTasks,
    validationToken: Optional[str] = Query(None),
):
    """
    Microsoft Graph change-notification receiver.

    Two modes:
    1. Subscription validation (validationToken query param present): return the
       token as plain text within 10 seconds — Graph verifies our endpoint exists.
    2. Normal notification (POST body): acknowledge within 3 seconds by returning
       202 immediately; process message IDs in background tasks.
    """
    if validationToken:
        return Response(content=validationToken, media_type="text/plain", status_code=200)

    try:
        body = await request.json()
    except Exception:
        raise HTTPException(status_code=400, detail="Invalid JSON")

    stored_client_state = await get_client_state()

    for notification in body.get("value", []):
        # Verify the notification actually came from our subscription
        if stored_client_state:
            if notification.get("clientState", "") != stored_client_state:
                logger.warning(
                    "inbox_webhook_invalid_client_state received=%s",
                    notification.get("clientState"),
                )
                continue

        if notification.get("changeType") != "created":
            continue

        graph_message_id = notification.get("resourceData", {}).get("id", "")
        if not graph_message_id:
            continue

        background_tasks.add_task(_ingest_message, graph_message_id)

    return Response(status_code=202)


# ── Manual poll (fallback) ────────────────────────────────────────────────────

@router.post("/poll")
async def poll_inbox(
    background_tasks: BackgroundTasks,
    current_user: dict = Depends(require_permission("inbox.view")),
):
    """
    Manually trigger a mailbox poll.
    Graph backend: fetches unread messages via Graph API.
    IMAP backend: fetches UNSEEN messages via IMAP.
    Responds immediately; ingestion happens in background.
    """
    if not inbox_configured():
        _not_configured()

    if graph_configured():
        from services.graph_client import list_messages
        try:
            msgs = await list_messages(filter_str=_graph_catchup_filter(), top=50)
        except Exception as exc:
            raise HTTPException(status_code=502, detail=f"Graph API error: {exc}")
        count = 0
        for m in msgs:
            mid = m.get("id", "")
            if mid:
                background_tasks.add_task(_ingest_message, mid)
                count += 1
        return {"queued": count, "backend": "graph"}

    # IMAP backend
    from services.imap_client import fetch_new_messages
    try:
        msgs = await fetch_new_messages()
    except Exception as exc:
        raise HTTPException(status_code=502, detail=f"IMAP error: {exc}")
    count = 0
    for m in msgs:
        background_tasks.add_task(_ingest_imap_message, m)
        count += 1
    return {"queued": count, "backend": "imap"}


# ── Counts ────────────────────────────────────────────────────────────────────

@router.get("/unhandled-count")
async def unhandled_count(
    current_user: dict = Depends(require_permission("inbox.view")),
):
    if not inbox_configured():
        return {"count": 0}
    count_filter: dict = {"status": "unhandled"}
    addr = _active_mailbox_address()
    if addr:
        count_filter["mailbox_address"] = addr
    count = await col("sales_inbox").count_documents(count_filter)
    return {"count": count}


# ── List ──────────────────────────────────────────────────────────────────────

@router.get("")
async def list_inbox(
    status: Optional[str] = Query(
        None,
        description="open | unhandled | pending_onboarding | ticket_created | archived | all",
    ),
    unknown_only: bool = Query(False),
    q: Optional[str] = Query(None),
    skip: int = Query(0, ge=0),
    limit: int = Query(50, le=100),
    current_user: dict = Depends(require_permission("inbox.view")),
):
    """Thread-grouped inbox list. One row per conversation, ordered by most recent activity."""
    if not inbox_configured():
        return {"items": [], "total": 0, "configured": False}

    match: dict = {"is_outgoing": {"$ne": True}}
    addr = _active_mailbox_address()
    if addr:
        match["mailbox_address"] = addr

    if status == "open" or not status:
        match["status"] = {"$nin": ["archived", "ticket_created"]}
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

    # Group by thread: replies share thread_root_id with their root message.
    # Roots have no thread_root_id, so we fall back to their own _id as the key.
    group_key = {"$ifNull": ["$thread_root_id", {"$toString": "$_id"}]}

    count_result = await col("sales_inbox").aggregate([
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
            "doc": {"$first": "$$ROOT"},
            "message_count": {"$sum": 1},
            "unread_count": {"$sum": {
                "$cond": [
                    {"$eq": [{"$ifNull": ["$is_read", True]}, False]},
                    1, 0,
                ]
            }},
            # $max picks the first non-null value across all messages in the thread,
            # so ticket_id is visible even when the newest doc is a reply without it.
            "ticket_id":      {"$max": "$ticket_id"},
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
                    "ticket_id":      "$ticket_id",
                    "application_id": "$application_id",
                }]
            }
        }},
        {"$project": {"body_html": 0}},
    ]

    results = await col("sales_inbox").aggregate(pipeline).to_list(limit)
    items = [_fmt(doc) for doc in results]
    return {"items": items, "total": total, "configured": True, "mailbox_address": _active_mailbox_address()}


# ── Detail ────────────────────────────────────────────────────────────────────

@router.get("/{item_id}")
async def get_inbox_item(
    item_id: str,
    current_user: dict = Depends(require_permission("inbox.view")),
):
    if not inbox_configured():
        _not_configured()
    doc = await col("sales_inbox").find_one({"_id": _oid(item_id)})
    if not doc:
        raise HTTPException(status_code=404, detail="Inbox item not found")
    return _fmt(doc)


async def _mark_thread_read(item_id: str) -> None:
    """Mark every message in a thread as read. Safe to call as a BackgroundTask."""
    try:
        item = await col("sales_inbox").find_one(
            {"_id": _oid(item_id)}, {"thread_root_id": 1}
        )
        if not item:
            return
        thread_root = item.get("thread_root_id") or str(item["_id"])
        await col("sales_inbox").update_many(
            {"$or": [
                {"_id": ObjectId(thread_root)},
                {"thread_root_id": thread_root},
            ]},
            {"$set": {"is_read": True}},
        )
    except Exception as exc:
        logger.warning("mark_thread_read_failed item_id=%s error=%s", item_id, exc)


@router.post("/{item_id}/mark-read")
async def mark_read(
    item_id: str,
    current_user: dict = Depends(require_permission("inbox.view")),
):
    """Explicitly mark a thread as read."""
    await _mark_thread_read(item_id)
    return {"success": True}


@router.get("/{item_id}/thread")
async def get_thread(
    item_id: str,
    background_tasks: BackgroundTasks,
    current_user: dict = Depends(require_permission("inbox.view")),
):
    """All messages in the same email thread, oldest first. Auto-marks thread as read."""
    if not inbox_configured():
        _not_configured()
    item = await col("sales_inbox").find_one(
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
        # Include root itself (no thread_root_id) + all replies
        filt = {"$or": [{"_id": ObjectId(root_id)}, {"thread_root_id": root_id}]}
    elif imap_mid:
        filt = {"$or": [{"imap_message_id": imap_mid}, {"thread_root_id": str(item["_id"])}]}
    else:
        return {"thread": [_fmt(item)]}

    # Include body_html so the frontend can render full email content in bubbles
    cursor = col("sales_inbox").find(filt).sort("received_at", 1)
    thread = [_fmt(doc) async for doc in cursor]

    background_tasks.add_task(_mark_thread_read, item_id)

    return {"thread": thread}


# ── Attachment download ───────────────────────────────────────────────────────

@router.get("/{item_id}/attachment/{attachment_id}")
async def download_attachment(
    item_id: str,
    attachment_id: str,
    current_user: dict = Depends(require_permission("inbox.view")),
):
    """Download an attachment from a Graph-sourced inbox message."""
    if not graph_configured():
        _not_configured()

    item = await col("sales_inbox").find_one(
        {"_id": _oid(item_id)}, {"graph_message_id": 1, "attachments": 1}
    )
    if not item:
        raise HTTPException(status_code=404, detail="Inbox item not found")

    meta = next((a for a in item.get("attachments", []) if a.get("id") == attachment_id), None)
    if not meta:
        raise HTTPException(status_code=404, detail="Attachment not found")

    try:
        content, content_type, filename = await get_attachment_content(
            item["graph_message_id"], attachment_id
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
    current_user: dict = Depends(require_permission("inbox.view")),
):
    """Download an attachment stored from an IMAP-sourced inbox message."""
    try:
        att_oid = ObjectId(attachment_id)
    except Exception:
        raise HTTPException(status_code=404, detail="Attachment not found")

    att = await col("sales_inbox_attachments").find_one(
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

@router.post("/{item_id}/create-ticket")
async def create_ticket_from_inbox(
    item_id: str,
    background_tasks: BackgroundTasks,
    current_user: dict = Depends(
        require_any_permission("tickets.sales", "tickets.manage")
    ),
):
    """Convert an inbox email into a Sales Ticket."""
    if not inbox_configured():
        _not_configured()

    item = await col("sales_inbox").find_one({"_id": _oid(item_id)})
    if not item:
        raise HTTPException(status_code=404, detail="Inbox item not found")

    # Resolve thread root — the representative doc from the aggregation may be
    # a reply, so resolve to the root and check ticket_id there too.
    thread_root_str = item.get("thread_root_id") or str(item["_id"])
    root_doc = item if not item.get("thread_root_id") else (
        await col("sales_inbox").find_one({"_id": ObjectId(thread_root_str)})
        or item
    )

    existing_ticket_id = root_doc.get("ticket_id") or item.get("ticket_id")
    if existing_ticket_id:
        raise HTTPException(
            status_code=409,
            detail=f"A ticket has already been created for this thread (id: {existing_ticket_id})",
        )

    customer_id = root_doc.get("customer_id") or item.get("customer_id")
    if not customer_id:
        raise HTTPException(
            status_code=422,
            detail=(
                "Customer not identified — link this email to an existing customer "
                "or start the onboarding process before creating a ticket."
            ),
        )

    customer_name = root_doc.get("customer_name") or item.get("customer_name", "Unknown")
    now = datetime.now(timezone.utc)
    actor = _actor(current_user)

    _from_email = root_doc.get("from_email") or item.get("from_email") or None

    doc = {
        "type":                "sales",
        "source":              "email",
        "customer_id":         customer_id,
        "customer_name":       customer_name,
        "customer_email":      _from_email,
        "order_id":            None,
        "invoice_id":          None,
        "orders_ticket_ref":   None,
        "status":              "open",
        "exit_status":         None,
        "assigned_to":         current_user["id"],
        "assigned_to_name":    actor,
        "assigned_to_role":    current_user.get("role", ""),
        "payment_confirmed_by": None,
        "payment_confirmed_at": None,
        "incomplete_reason":   None,
        "stage_history": [{
            "status":      "open",
            "exit_status": None,
            "actor_id":    current_user["id"],
            "actor_name":  actor,
            "at":          now,
            "note":        f"Ticket created from email: {item.get('subject', '')}",
        }],
        "inbox_item_id": thread_root_str,
        "created_at":    now,
        "updated_at":    now,
    }
    result = await col("tickets").insert_one(doc)
    ticket_id = str(result.inserted_id)

    # Stamp ticket_id and status on ALL messages in the thread so the
    # aggregation (which picks the newest doc) always sees ticket_id regardless
    # of which message ends up as the thread representative.
    await col("sales_inbox").update_many(
        {"$or": [
            {"_id": ObjectId(thread_root_str)},
            {"thread_root_id": thread_root_str},
        ]},
        {
            "$set": {
                "ticket_id":  ticket_id,
                "status":     "ticket_created",
                "handled_by": current_user.get("username"),
                "handled_at": now,
            }
        },
    )

    background_tasks.add_task(
        audit_log,
        "inbox.ticket_created", "inbox_item", item_id,
        entity_label=item.get("subject", ""),
        user=current_user,
        detail={
            "customer_id":  customer_id,
            "customer_name": customer_name,
            "ticket_id":    ticket_id,
            "from_email":   item.get("from_email"),
        },
    )
    background_tasks.add_task(
        notify_ticket_assigned, "sales", customer_name, current_user["id"]
    )

    return {"success": True, "ticket_id": ticket_id}


@router.post("/{item_id}/link-customer")
async def link_customer(
    item_id: str,
    body: LinkCustomerBody,
    background_tasks: BackgroundTasks,
    current_user: dict = Depends(require_permission("inbox.view")),
):
    """Associate an unknown-sender email with an existing Odoo customer."""
    if not inbox_configured():
        _not_configured()

    item = await col("sales_inbox").find_one({"_id": _oid(item_id)})
    if not item:
        raise HTTPException(status_code=404, detail="Inbox item not found")

    try:
        odoo = get_odoo_client()
        partners = odoo.read("res.partner", [body.customer_id], fields=["id", "name"])
        if not partners:
            raise HTTPException(status_code=404, detail="Customer not found in Odoo")
        customer_name = partners[0]["name"]
    except HTTPException:
        raise
    except Exception as exc:
        raise HTTPException(status_code=502, detail=f"Odoo error: {exc}")

    await col("sales_inbox").update_one(
        {"_id": _oid(item_id)},
        {
            "$set": {
                "customer_id":       body.customer_id,
                "customer_name":     customer_name,
                "is_unknown_sender": False,
                "status":            "unhandled",
            }
        },
    )

    background_tasks.add_task(
        audit_log,
        "inbox.customer_linked", "inbox_item", item_id,
        entity_label=item.get("subject", ""),
        user=current_user,
        detail={
            "customer_id":   body.customer_id,
            "customer_name": customer_name,
            "from_email":    item.get("from_email"),
        },
    )

    return {"success": True, "customer_name": customer_name}


@router.post("/{item_id}/start-onboarding")
async def start_onboarding(
    item_id: str,
    body: StartOnboardingBody,
    background_tasks: BackgroundTasks,
    current_user: dict = Depends(require_permission("inbox.view")),
):
    """Flag an unknown-sender email as pending customer onboarding."""
    if not inbox_configured():
        _not_configured()

    item = await col("sales_inbox").find_one({"_id": _oid(item_id)})
    if not item:
        raise HTTPException(status_code=404, detail="Inbox item not found")

    await col("sales_inbox").update_one(
        {"_id": _oid(item_id)},
        {"$set": {"status": "pending_onboarding"}},
    )

    background_tasks.add_task(
        audit_log,
        "inbox.onboarding_started", "inbox_item", item_id,
        entity_label=item.get("from_email", ""),
        user=current_user,
        detail={
            "from_email": item.get("from_email"),
            "from_name":  item.get("from_name"),
            "note":       body.note,
        },
    )

    return {"success": True}


@router.post("/{item_id}/reply")
async def reply_to_email(
    item_id: str,
    body: ReplyBody,
    background_tasks: BackgroundTasks,
    current_user: dict = Depends(require_permission("inbox.view")),
):
    """Send a reply from the shared mailbox — Graph backend or SMTP, whichever is active."""
    if not inbox_configured():
        _not_configured()

    if not body.body_html.strip():
        raise HTTPException(status_code=400, detail="Reply body cannot be empty")

    item = await col("sales_inbox").find_one({"_id": _oid(item_id)})
    if not item:
        raise HTTPException(status_code=404, detail="Inbox item not found")

    # Guard against two staff members sending simultaneous replies to the same thread.
    thread_root_check = item.get("thread_root_id") or item_id
    recent_reply = await col("sales_inbox").find_one({
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

    sent_message_id = None
    try:
        if graph_configured() and item.get("graph_message_id"):
            await graph_send_reply(item["graph_message_id"], body.body_html)
        else:
            subj = item.get("subject", "")
            if not subj.lower().startswith("re:"):
                subj = f"Re: {subj}"
            # Build references chain so email clients thread correctly
            parent_mid = item.get("imap_message_id", "")
            parent_refs = item.get("imap_references", "")
            refs = f"{parent_refs} {parent_mid}".strip() if parent_mid else parent_refs
            sent_message_id = await imap_send_reply(
                to_email=item["from_email"],
                subject=subj,
                body_html=body.body_html,
                in_reply_to=parent_mid,
                references=refs,
            )
    except Exception as exc:
        raise HTTPException(status_code=502, detail=f"Could not send reply: {exc}")

    # Persist the outgoing reply so it appears in the thread view.
    # imap_message_id is stored so that the customer's next reply (which will
    # carry In-Reply-To: <our message id>) is correctly detected as a thread
    # reply rather than a new unhandled message.
    now = datetime.now(timezone.utc)
    actor = _actor(current_user)
    preview = _re.sub(r"<[^>]+>", "", body.body_html)[:500].strip()
    imap_cfg = get_imap_config()
    from_email_out = imap_cfg["mailbox_address"] if imap_cfg else item.get("from_email", "")
    thread_root = item.get("thread_root_id") or item_id
    outgoing = {
        "mailbox_address":     from_email_out,
        "imap_references":     item.get("imap_message_id", ""),
        "from_email":          from_email_out,
        "from_name":           actor,
        "subject":             ("Re: " + item.get("subject", "")).replace("Re: Re: ", "Re: "),
        "body_html":           body.body_html,
        "body_preview":        preview,
        "received_at":         now,
        "is_outgoing":         True,
        "is_reply":            True,
        "has_attachments":     False,
        "attachments":         [],
        "thread_root_id":      thread_root,
        "graph_conversation_id": item.get("graph_conversation_id"),
        "customer_id":         item.get("customer_id"),
        "customer_name":       item.get("customer_name"),
        "is_unknown_sender":   False,
        "ticket_id":           item.get("ticket_id"),
        "status":              "sent",
        "is_read":             True,
        "created_at":          now,
        "handled_by":          current_user.get("username"),
        "handled_at":          now,
    }
    if sent_message_id:
        outgoing["imap_message_id"] = sent_message_id
    await col("sales_inbox").insert_one(outgoing)

    background_tasks.add_task(
        audit_log,
        "inbox.reply_sent", "inbox_item", item_id,
        entity_label=item.get("subject", ""),
        user=current_user,
        detail={"to": item.get("from_email"), "preview": body.body_html[:300]},
    )

    return {"success": True}


@router.post("/{item_id}/archive")
async def archive_item(
    item_id: str,
    background_tasks: BackgroundTasks,
    current_user: dict = Depends(require_permission("inbox.view")),
):
    """Dismiss an inbox item without creating a ticket."""
    if not inbox_configured():
        _not_configured()

    item = await col("sales_inbox").find_one({"_id": _oid(item_id)})
    if not item:
        raise HTTPException(status_code=404, detail="Inbox item not found")

    thread_root_str = item.get("thread_root_id") or str(item["_id"])
    now = datetime.now(timezone.utc)
    await col("sales_inbox").update_many(
        {"$or": [
            {"_id": ObjectId(thread_root_str)},
            {"thread_root_id": thread_root_str},
        ]},
        {
            "$set": {
                "status":     "archived",
                "handled_by": current_user.get("username"),
                "handled_at": now,
                # TTL index on this field auto-deletes archived threads after 180 days.
                "expires_at": now + timedelta(days=180),
            }
        },
    )

    background_tasks.add_task(
        audit_log,
        "inbox.archived", "inbox_item", item_id,
        entity_label=item.get("subject", ""),
        user=current_user,
    )

    return {"success": True}
