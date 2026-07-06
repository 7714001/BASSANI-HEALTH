"""
Shared inbox logic — parameterised by collection name and mailbox slug.
Used by both sales_inbox and onboarding_inbox routes so they share
identical ingest, thread-grouping, and read-state logic without duplication.
"""
import logging
import time
import uuid
from datetime import datetime, timedelta, timezone
from typing import Optional

from bson import Binary as BsonBinary, ObjectId

from database import col
from odoo_client import get_odoo_client

logger = logging.getLogger(__name__)

# ── Customer resolution cache ─────────────────────────────────────────────────
_customer_cache: dict[str, tuple] = {}
_CUSTOMER_CACHE_TTL = 600  # 10 minutes


async def resolve_customer(from_email: str) -> tuple[Optional[int], Optional[str]]:
    """Look up sender email in Odoo res.partner. Cached for 10 minutes."""
    cached = _customer_cache.get(from_email)
    if cached:
        cid, cname, expires = cached
        if expires > time.monotonic():
            return cid, cname

    cid, cname = None, None
    try:
        odoo = get_odoo_client()
        results = odoo.search_read(
            "res.partner",
            domain=[["email", "=", from_email], ["active", "=", True]],
            fields=["id", "name"],
            limit=1,
        )
        if results:
            cid, cname = int(results[0]["id"]), results[0]["name"]
    except Exception as exc:
        logger.warning("inbox_customer_lookup_failed email=%s error=%s", from_email, exc)

    _customer_cache[from_email] = (cid, cname, time.monotonic() + _CUSTOMER_CACHE_TTL)
    return cid, cname


# ── Thread read ───────────────────────────────────────────────────────────────

async def mark_thread_read(collection: str, item_id: str) -> None:
    try:
        item = await col(collection).find_one({"_id": ObjectId(item_id)}, {"thread_root_id": 1})
        if not item:
            return
        thread_root = item.get("thread_root_id") or str(item["_id"])
        await col(collection).update_many(
            {"$or": [{"_id": ObjectId(thread_root)}, {"thread_root_id": thread_root}]},
            {"$set": {"is_read": True}},
        )
    except Exception as exc:
        logger.warning("mark_thread_read_failed collection=%s item_id=%s error=%s",
                       collection, item_id, exc)


# ── Thread aggregation pipeline ───────────────────────────────────────────────

def build_list_pipeline(match: dict, skip: int, limit: int) -> list:
    """Thread-grouped inbox list — one row per conversation, newest first."""
    group_key = {"$ifNull": ["$thread_root_id", {"$toString": "$_id"}]}
    return [
        {"$match": match},
        {"$sort": {"received_at": -1}},
        {"$group": {
            "_id": group_key,
            "doc":            {"$first": "$$ROOT"},
            "message_count":  {"$sum": 1},
            "unread_count":   {"$sum": {
                "$cond": [{"$eq": [{"$ifNull": ["$is_read", True]}, False]}, 1, 0]
            }},
            # Pull these from whichever message in the thread has them set.
            # $max treats null < string, so a single non-null value wins.
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


# ── Graph message ingest ──────────────────────────────────────────────────────

async def ingest_graph_message(collection: str, mailbox: str, graph_message_id: str) -> None:
    """Fetch one Graph message and persist it to the given collection. Idempotent."""
    from services.graph_client import get_message, list_attachments, get_attachment_content, mark_as_read
    from services.imap_client import get_graph_mailbox_address

    existing = await col(collection).find_one({"graph_message_id": graph_message_id}, {"_id": 1})
    if existing:
        return

    mailbox_address = get_graph_mailbox_address(mailbox)

    try:
        msg = await get_message(graph_message_id, mailbox_address=mailbox_address)
    except Exception as exc:
        logger.error("inbox_graph_fetch_failed mailbox=%s gid=%s error=%s",
                     mailbox, graph_message_id, exc)
        return

    from_addr    = msg.get("from", {}).get("emailAddress", {})
    from_email   = (from_addr.get("address") or "").lower().strip()
    from_name    = from_addr.get("name") or from_email
    conv_id      = msg.get("conversationId", "")
    subject      = msg.get("subject", "(no subject)")
    body_preview = msg.get("bodyPreview", "")[:500]
    body_html    = msg.get("body", {}).get("content", "")
    received_str = msg.get("receivedDateTime", "")
    has_att      = msg.get("hasAttachments", False)

    try:
        received_at = datetime.fromisoformat(received_str.replace("Z", "+00:00"))
    except Exception:
        received_at = datetime.now(timezone.utc)

    attachments: list = []
    if has_att:
        try:
            raw = await list_attachments(graph_message_id, mailbox_address=mailbox_address)
            attachments = [
                {"id": a["id"], "name": a.get("name", ""),
                 "content_type": a.get("contentType", ""), "size_bytes": a.get("size", 0)}
                for a in raw
            ]
        except Exception as exc:
            logger.warning("inbox_graph_attachments_failed mailbox=%s error=%s", mailbox, exc)

    customer_id, customer_name = await resolve_customer(from_email)
    is_unknown = customer_id is None

    is_reply = False
    thread_root_id: Optional[str] = None
    linked_ticket_id: Optional[str] = None
    linked_application_id: Optional[str] = None

    if conv_id:
        prior = await col(collection).find_one(
            {"graph_conversation_id": conv_id},
            {"_id": 1, "ticket_id": 1, "application_id": 1, "thread_root_id": 1},
            sort=[("received_at", 1)],
        )
        if prior:
            is_reply = True
            # Propagate thread_root_id the same way IMAP does — walk to the root
            thread_root_id = str(prior.get("thread_root_id") or prior["_id"])
            linked_ticket_id = prior.get("ticket_id")
            linked_application_id = prior.get("application_id")

    doc = {
        "graph_message_id":      graph_message_id,
        "graph_conversation_id": conv_id,
        "mailbox_address":       mailbox_address,
        "from_email":            from_email,
        "from_name":             from_name,
        "subject":               subject,
        "body_preview":          body_preview,
        "body_html":             body_html,
        "received_at":           received_at,
        "has_attachments":       has_att,
        "attachments":           attachments,
        "customer_id":           customer_id,
        "customer_name":         customer_name,
        "is_unknown_sender":     is_unknown,
        "ticket_id":             linked_ticket_id if is_reply else None,
        "application_id":        linked_application_id if is_reply else None,
        "is_reply":              is_reply,
        "thread_root_id":        thread_root_id,
        "status":                "reply" if is_reply else "unhandled",
        "is_read":               False,
        "created_at":            datetime.now(timezone.utc),
        "handled_by":            None,
        "handled_at":            None,
    }
    result = await col(collection).insert_one(doc)

    # Eagerly download attachment bytes to R2 so "Save to Profile" never
    # depends on Graph API availability at an arbitrary future point in time.
    if attachments:
        from services.r2_client import r2_put as _r2_put
        for i, att in enumerate(attachments):
            if not att.get("id"):
                continue
            try:
                raw, ct, _ = await get_attachment_content(
                    graph_message_id, att["id"], mailbox_address=mailbox_address
                )
                r2_key = f"inbox/{collection}/{graph_message_id}/atts/{att['id']}"
                await _r2_put(r2_key, raw, ct or att.get("content_type", "application/octet-stream"))
                await col(collection).update_one(
                    {"_id": result.inserted_id},
                    {"$set": {f"attachments.{i}.r2_key": r2_key}},
                )
            except Exception as exc:
                logger.warning("inbox_graph_att_r2_store_failed name=%s error=%s",
                               att.get("name"), exc)

    try:
        await mark_as_read(graph_message_id, mailbox_address=mailbox_address)
    except Exception:
        pass

    logger.info("inbox_graph_stored collection=%s from=%s reply=%s known=%s",
                collection, from_email, is_reply, not is_unknown)


# ── IMAP message ingest ───────────────────────────────────────────────────────

async def ingest_imap_message(collection: str, mailbox: str, msg: dict) -> None:
    """Persist one IMAP-sourced message to the given collection. Idempotent."""
    from services.imap_client import mark_as_read as imap_mark_read, get_graph_mailbox_address, get_config as _imap_get_cfg
    _imap_cfg = _imap_get_cfg(mailbox) or {}
    _mailbox_address = get_graph_mailbox_address(mailbox) or _imap_cfg.get("mailbox_address") or _imap_cfg.get("imap_username", "")

    message_id = msg.get("message_id")
    if message_id:
        existing = await col(collection).find_one({"imap_message_id": message_id}, {"_id": 1})
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

    customer_id, customer_name = await resolve_customer(from_email)
    is_unknown = customer_id is None

    is_reply = False
    thread_root_id: Optional[str] = None
    linked_ticket_id: Optional[str] = None
    linked_application_id: Optional[str] = None

    ancestor = None
    if in_reply_to:
        ancestor = await col(collection).find_one(
            {"imap_message_id": in_reply_to},
            {"_id": 1, "ticket_id": 1, "application_id": 1, "thread_root_id": 1},
        )
    if not ancestor and references:
        for ref_mid in reversed(references.split()):
            ancestor = await col(collection).find_one(
                {"imap_message_id": ref_mid.strip()},
                {"_id": 1, "ticket_id": 1, "application_id": 1, "thread_root_id": 1},
            )
            if ancestor:
                break

    if ancestor:
        is_reply = True
        thread_root_id = str(ancestor.get("thread_root_id") or ancestor["_id"])
        linked_ticket_id = ancestor.get("ticket_id")
        linked_application_id = ancestor.get("application_id")

    att_collection = f"{collection}_attachments"
    attachments_meta = [{k: v for k, v in a.items() if k != "_content"} for a in attachments]

    doc = {
        "imap_message_id":   message_id,
        "imap_uid":          imap_uid,
        "imap_in_reply_to":  in_reply_to,
        "imap_references":   references,
        "mailbox_address":   _mailbox_address,
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
        "application_id":    linked_application_id if is_reply else None,
        "is_reply":          is_reply,
        "thread_root_id":    thread_root_id,
        "status":            "reply" if is_reply else "unhandled",
        "is_read":           False,
        "created_at":        datetime.now(timezone.utc),
        "handled_by":        None,
        "handled_at":        None,
    }
    result = await col(collection).insert_one(doc)
    item_id_str = str(result.inserted_id)

    # Mark read in IMAP immediately after successful MongoDB write.
    if imap_uid:
        try:
            await imap_mark_read(imap_uid, mailbox=mailbox)
        except Exception as exc:
            logger.warning("imap_mark_read_failed uid=%s error=%s", imap_uid, exc)

    for i, att in enumerate(attachments):
        content = att.get("_content", b"")
        if not content:
            continue
        try:
            att_result = await col(att_collection).insert_one({
                "inbox_item_id": item_id_str,
                "collection":    collection,
                "name":          att["name"],
                "content_type":  att["content_type"],
                "size_bytes":    att["size_bytes"],
                "content":       BsonBinary(content),
            })
            await col(collection).update_one(
                {"_id": result.inserted_id},
                {"$set": {f"attachments.{i}.imap_attachment_id": str(att_result.inserted_id)}},
            )
        except Exception as exc:
            logger.warning("imap_attachment_store_failed inbox_id=%s name=%s error=%s",
                           item_id_str, att.get("name"), exc)

    logger.info("inbox_imap_stored collection=%s from=%s reply=%s known=%s",
                collection, from_email, is_reply, not is_unknown)


# ── Save attachment to customer R2 profile ────────────────────────────────────

async def save_attachment_to_profile(
    collection: str,
    mailbox: str,
    item_id: str,
    attachment_id: str,
    label: str,
) -> dict:
    """
    Fetch an inbox attachment (Graph or IMAP) and write it to R2 as a
    customer document. Returns the new customer_documents record.
    Raises ValueError for caller to convert to HTTPException.
    """
    from services.r2_client import r2_put, r2_get
    from services.graph_client import get_attachment_content, graph_configured
    from services.imap_client import get_graph_mailbox_address

    item = await col(collection).find_one({"_id": ObjectId(item_id)})
    if not item:
        raise ValueError("Inbox item not found")

    customer_id = item.get("customer_id")
    if not customer_id:
        raise ValueError("No customer linked to this thread — link a customer first")

    att_meta = next(
        (a for a in item.get("attachments", []) if
         a.get("id") == attachment_id or a.get("imap_attachment_id") == attachment_id),
        None,
    )
    if not att_meta:
        raise ValueError("Attachment not found")

    filename = att_meta.get("name", "attachment")
    content_type = att_meta.get("content_type", "application/octet-stream")

    # Fetch bytes — R2 preferred (set at ingest for Graph messages), then IMAP store,
    # then live Graph API fallback for messages ingested before eager-R2 was added.
    content: bytes = b""
    if att_meta.get("r2_key"):
        content = await r2_get(att_meta["r2_key"])
    elif graph_configured() and item.get("graph_message_id") and att_meta.get("id"):
        mailbox_address = get_graph_mailbox_address(mailbox)
        raw, ct, fn = await get_attachment_content(
            item["graph_message_id"], att_meta["id"], mailbox_address=mailbox_address
        )
        content = raw
        content_type = ct or content_type
        filename = fn or filename
    elif att_meta.get("imap_attachment_id"):
        att_collection = f"{collection}_attachments"
        stored = await col(att_collection).find_one(
            {"_id": ObjectId(att_meta["imap_attachment_id"])}
        )
        if not stored:
            raise ValueError("Attachment bytes not found — may have expired")
        content = bytes(stored["content"])
    else:
        raise ValueError("Cannot retrieve attachment bytes for this message type")

    if not content:
        raise ValueError("Attachment is empty or could not be retrieved")

    doc_id = str(uuid.uuid4())
    r2_key = f"customers/{customer_id}/inbox-documents/{doc_id}/{filename}"
    await r2_put(r2_key, content, content_type)

    record = {
        "id":              doc_id,
        "odoo_partner_id": customer_id,
        "label":           label or filename,
        "filename":        filename,
        "r2_key":          r2_key,
        "size":            len(content),
        "doc_type":        "inbox_attachment",
        "uploaded_at":     datetime.now(timezone.utc),
        "source":          "inbox",
        "inbox_collection": collection,
        "inbox_item_id":   item_id,
    }
    await col("customer_documents").insert_one(record)
    record.pop("_id", None)
    return record
