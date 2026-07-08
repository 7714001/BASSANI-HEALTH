"""
Orders Inbox — shared mailbox for order-related email communications.

Used by orders_clerk, qa_manager, and responsible_pharmacist to handle
inbound email about active orders: delivery queries, compliance questions,
supplier comms, etc.

Architecture mirrors the onboarding inbox:
- Collection: orders_inbox
- Mailbox slug: orders
- Permission: orders_inbox.view
"""
import logging
import re as _re
from datetime import datetime, timedelta, timezone
from typing import Optional

from bson import ObjectId
from fastapi import APIRouter, BackgroundTasks, Depends, HTTPException, Query, Request
from fastapi.responses import Response
from pydantic import BaseModel

from auth import require_permission
from database import col
from middleware.audit import audit_log
from services.graph_client import graph_configured, send_reply as graph_send_reply
from services.graph_subscription import get_client_state
from services.imap_client import (
    get_config as get_imap_config,
    imap_configured,
    send_reply as imap_send_reply,
)
from services.inbox_service import ingest_graph_message, ingest_imap_message, mark_thread_read

logger = logging.getLogger(__name__)
router = APIRouter(prefix="/api/orders-inbox", tags=["orders-inbox"])

_COLLECTION = "orders_inbox"
_MAILBOX    = "orders"


# ── Helpers ───────────────────────────────────────────────────────────────────

def _configured() -> bool:
    from services.imap_client import imap_configured as _ic, get_graph_mailbox_address
    return _ic(_MAILBOX) or bool(get_graph_mailbox_address(_MAILBOX))


def _active_mailbox_address() -> str:
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
            "Orders Inbox is not yet active. A super admin must connect a mailbox "
            "in Settings > Connected Mailboxes > Orders Mailbox."
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
        if stored_client_state:
            if notification.get("clientState", "") != stored_client_state:
                logger.warning(
                    "orders_inbox_webhook_invalid_state received=%s",
                    notification.get("clientState"),
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
    current_user: dict = Depends(require_permission("orders_inbox.view")),
):
    if not _configured():
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
    current_user: dict = Depends(require_permission("orders_inbox.view")),
):
    if not _configured():
        return {"count": 0}
    count_filter: dict = {"status": "unhandled"}
    addr = _active_mailbox_address()
    if addr:
        count_filter["mailbox_address"] = addr
    count = await col(_COLLECTION).count_documents(count_filter)
    return {"count": count}


# ── List ──────────────────────────────────────────────────────────────────────

@router.get("")
async def list_inbox(
    status: Optional[str] = Query(None),
    q: Optional[str] = Query(None),
    skip: int = Query(0, ge=0),
    limit: int = Query(50, le=100),
    current_user: dict = Depends(require_permission("orders_inbox.view")),
):
    if not _configured():
        return {"items": [], "total": 0, "configured": False}

    match: dict = {"$or": [
        {"is_outgoing": {"$ne": True}},
        {
            "is_outgoing": True,
            "$expr": {"$eq": ["$thread_root_id", {"$toString": "$_id"}]},
        },
    ]}
    addr = _active_mailbox_address()
    if addr:
        match["mailbox_address"] = addr

    if status == "open" or not status:
        match["status"] = {"$nin": ["archived"]}
    elif status and status != "all":
        match["status"] = status

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
            "doc":           {"$first": "$$ROOT"},
            "message_count": {"$sum": 1},
            "unread_count":  {"$sum": {
                "$cond": [{"$eq": [{"$ifNull": ["$is_read", True]}, False]}, 1, 0]
            }},
        }},
        {"$sort": {"doc.received_at": -1}},
        {"$skip": skip},
        {"$limit": limit},
        {"$replaceRoot": {
            "newRoot": {
                "$mergeObjects": ["$doc", {
                    "message_count": "$message_count",
                    "unread_count":  "$unread_count",
                    "has_unread":    {"$gt": ["$unread_count", 0]},
                }]
            }
        }},
        {"$project": {"body_html": 0}},
    ]

    results = await col(_COLLECTION).aggregate(pipeline).to_list(limit)
    items = [_fmt(doc) for doc in results]
    return {"items": items, "total": total, "configured": True, "mailbox_address": _active_mailbox_address()}


# ── Detail ────────────────────────────────────────────────────────────────────

@router.get("/{item_id}")
async def get_inbox_item(
    item_id: str,
    current_user: dict = Depends(require_permission("orders_inbox.view")),
):
    if not _configured():
        _not_configured()
    doc = await col(_COLLECTION).find_one({"_id": _oid(item_id)})
    if not doc:
        raise HTTPException(status_code=404, detail="Inbox item not found")
    return _fmt(doc)


@router.post("/{item_id}/mark-read")
async def mark_read(
    item_id: str,
    current_user: dict = Depends(require_permission("orders_inbox.view")),
):
    await mark_thread_read(_COLLECTION, item_id)
    return {"success": True}


@router.get("/{item_id}/thread")
async def get_thread(
    item_id: str,
    background_tasks: BackgroundTasks,
    current_user: dict = Depends(require_permission("orders_inbox.view")),
):
    if not _configured():
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
    current_user: dict = Depends(require_permission("orders_inbox.view")),
):
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
    current_user: dict = Depends(require_permission("orders_inbox.view")),
):
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


# ── Reply ─────────────────────────────────────────────────────────────────────

class ReplyBody(BaseModel):
    body_html: str


@router.post("/{item_id}/reply")
async def reply_to_email(
    item_id: str,
    body: ReplyBody,
    background_tasks: BackgroundTasks,
    current_user: dict = Depends(require_permission("orders_inbox.view")),
):
    if not _configured():
        _not_configured()

    if not body.body_html.strip():
        raise HTTPException(status_code=400, detail="Reply body cannot be empty")

    item = await col(_COLLECTION).find_one({"_id": _oid(item_id)})
    if not item:
        raise HTTPException(status_code=404, detail="Inbox item not found")

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
            parent_mid  = item.get("imap_message_id", "")
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

    now   = datetime.now(timezone.utc)
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
        "is_unknown_sender":     False,
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
        "orders_inbox.reply_sent", "orders_inbox_item", item_id,
        entity_label=item.get("subject", ""),
        user=current_user,
        detail={"to": item.get("from_email"), "preview": body.body_html[:300]},
    )

    return {"success": True}


# ── Archive ───────────────────────────────────────────────────────────────────

@router.post("/{item_id}/archive")
async def archive_item(
    item_id: str,
    background_tasks: BackgroundTasks,
    current_user: dict = Depends(require_permission("orders_inbox.view")),
):
    if not _configured():
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
        "orders_inbox.archived", "orders_inbox_item", item_id,
        entity_label=item.get("subject", ""),
        user=current_user,
    )

    return {"success": True}
