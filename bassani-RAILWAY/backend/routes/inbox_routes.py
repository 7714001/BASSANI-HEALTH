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
from datetime import datetime, timezone
from typing import Optional

from bson import ObjectId
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
from services.imap_client import (
    imap_configured,
    send_reply as imap_send_reply,
)
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


async def _resolve_customer(from_email: str) -> tuple[Optional[int], Optional[str]]:
    """Look up sender email in Odoo res.partner. Returns (partner_id, name)."""
    try:
        odoo = get_odoo_client()
        results = odoo.search_read(
            "res.partner",
            domain=[["email", "=", from_email], ["active", "=", True]],
            fields=["id", "name"],
            limit=1,
        )
        if results:
            return int(results[0]["id"]), results[0]["name"]
    except Exception as exc:
        logger.warning("inbox_customer_lookup_failed email=%s error=%s", from_email, exc)
    return None, None


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

    # Thread detection via In-Reply-To header
    is_reply = False
    thread_root_id: Optional[str] = None
    linked_ticket_id: Optional[str] = None
    if in_reply_to:
        parent = await col("sales_inbox").find_one(
            {"imap_message_id": in_reply_to},
            {"_id": 1, "ticket_id": 1, "thread_root_id": 1},
        )
        if parent:
            is_reply = True
            thread_root_id = str(parent.get("thread_root_id") or parent["_id"])
            linked_ticket_id = parent.get("ticket_id")

    doc = {
        "imap_message_id":   message_id,
        "imap_uid":          imap_uid,
        "imap_in_reply_to":  in_reply_to,
        "imap_references":   references,
        "from_email":        from_email,
        "from_name":         from_name,
        "subject":           subject,
        "body_preview":      body_preview,
        "body_html":         body_html,
        "received_at":       received_at,
        "has_attachments":   has_att,
        "attachments":       attachments,
        "customer_id":       customer_id,
        "customer_name":     customer_name,
        "is_unknown_sender": is_unknown,
        "ticket_id":         linked_ticket_id if is_reply else None,
        "is_reply":          is_reply,
        "thread_root_id":    thread_root_id,
        "status":            "reply" if is_reply else "unhandled",
        "created_at":        datetime.now(timezone.utc),
        "handled_by":        None,
        "handled_at":        None,
    }
    await col("sales_inbox").insert_one(doc)

    # Mark read via IMAP so the mailbox stays clean
    if imap_uid:
        try:
            from services.imap_client import mark_as_read as imap_mark_read
            await imap_mark_read(imap_uid)
        except Exception:
            pass

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
            msgs = await list_messages(filter_str="isRead eq false", top=25)
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
    count = await col("sales_inbox").count_documents({"status": "unhandled"})
    return {"count": count}


# ── List ──────────────────────────────────────────────────────────────────────

@router.get("")
async def list_inbox(
    status: Optional[str] = Query(
        None,
        description="unhandled | reply | pending_onboarding | ticket_created | archived | all",
    ),
    unknown_only: bool = Query(False),
    skip: int = Query(0, ge=0),
    limit: int = Query(50, le=100),
    current_user: dict = Depends(require_permission("inbox.view")),
):
    if not inbox_configured():
        return {"items": [], "total": 0, "configured": False}

    filt: dict = {}
    if status and status != "all":
        filt["status"] = status
    elif not status:
        # Default: exclude archived so the list stays clean
        filt["status"] = {"$ne": "archived"}
    if unknown_only:
        filt["is_unknown_sender"] = True

    total = await col("sales_inbox").count_documents(filt)
    cursor = (
        col("sales_inbox")
        .find(filt, {"body_html": 0})
        .sort("received_at", -1)
        .skip(skip)
        .limit(limit)
    )
    items = [_fmt(doc) async for doc in cursor]
    return {"items": items, "total": total, "configured": True}


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


@router.get("/{item_id}/thread")
async def get_thread(
    item_id: str,
    current_user: dict = Depends(require_permission("inbox.view")),
):
    """All messages in the same email thread, oldest first."""
    if not inbox_configured():
        _not_configured()
    item = await col("sales_inbox").find_one(
        {"_id": _oid(item_id)},
        {"graph_conversation_id": 1, "thread_root_id": 1, "imap_message_id": 1},
    )
    if not item:
        raise HTTPException(status_code=404, detail="Inbox item not found")

    conv_id      = item.get("graph_conversation_id")
    root_id      = item.get("thread_root_id")
    imap_mid     = item.get("imap_message_id")

    if conv_id:
        filt = {"graph_conversation_id": conv_id}
    elif root_id:
        filt = {"thread_root_id": root_id}
    elif imap_mid:
        filt = {"$or": [{"imap_message_id": imap_mid}, {"thread_root_id": str(item["_id"])}]}
    else:
        return {"thread": [_fmt(item)]}

    cursor = col("sales_inbox").find(filt, {"body_html": 0}).sort("received_at", 1)
    return {"thread": [_fmt(doc) async for doc in cursor]}


# ── Attachment download ───────────────────────────────────────────────────────

@router.get("/{item_id}/attachment/{attachment_id}")
async def download_attachment(
    item_id: str,
    attachment_id: str,
    current_user: dict = Depends(require_permission("inbox.view")),
):
    if not graph_configured():
        _not_configured()

    item = await col("sales_inbox").find_one(
        {"_id": _oid(item_id)}, {"graph_message_id": 1, "attachments": 1}
    )
    if not item:
        raise HTTPException(status_code=404, detail="Inbox item not found")

    # Verify the attachment belongs to this message before fetching
    meta = next((a for a in item.get("attachments", []) if a["id"] == attachment_id), None)
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

    if item.get("ticket_id"):
        raise HTTPException(
            status_code=409,
            detail=f"A ticket has already been created for this email (id: {item['ticket_id']})",
        )

    customer_id = item.get("customer_id")
    if not customer_id:
        raise HTTPException(
            status_code=422,
            detail=(
                "Customer not identified — link this email to an existing customer "
                "or start the onboarding process before creating a ticket."
            ),
        )

    customer_name = item.get("customer_name", "Unknown")
    now = datetime.now(timezone.utc)
    actor = _actor(current_user)

    doc = {
        "type":                "sales",
        "source":              "email",
        "customer_id":         customer_id,
        "customer_name":       customer_name,
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
        "inbox_item_id": item_id,
        "created_at":    now,
        "updated_at":    now,
    }
    result = await col("tickets").insert_one(doc)
    ticket_id = str(result.inserted_id)

    await col("sales_inbox").update_one(
        {"_id": _oid(item_id)},
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

    try:
        if graph_configured() and item.get("graph_message_id"):
            await graph_send_reply(item["graph_message_id"], body.body_html)
        else:
            subj = item.get("subject", "")
            if not subj.lower().startswith("re:"):
                subj = f"Re: {subj}"
            await imap_send_reply(
                to_email=item["from_email"],
                subject=subj,
                body_html=body.body_html,
                in_reply_to=item.get("imap_message_id") or item.get("imap_in_reply_to", ""),
                references=item.get("imap_references", ""),
            )
    except Exception as exc:
        raise HTTPException(status_code=502, detail=f"Could not send reply: {exc}")

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

    now = datetime.now(timezone.utc)
    await col("sales_inbox").update_one(
        {"_id": _oid(item_id)},
        {
            "$set": {
                "status":     "archived",
                "handled_by": current_user.get("username"),
                "handled_at": now,
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
