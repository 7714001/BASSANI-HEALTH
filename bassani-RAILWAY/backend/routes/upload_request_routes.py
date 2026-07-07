"""
Document upload request endpoints.

Admins can request outstanding documents from an existing customer by generating
a secure, time-limited upload link that is emailed to the selected recipient.
The upload endpoint is unauthenticated — only the token gates access.

Collection: doc_upload_requests
"""
import os
import uuid
import secrets
from fastapi import APIRouter, BackgroundTasks, Depends, File, Form, HTTPException, UploadFile
from typing import List, Optional
from pydantic import BaseModel
from datetime import datetime, timedelta

from auth import get_current_user, require_permission
from database import col
from odoo_client import get_odoo_client
from services.r2_client import r2_put
from middleware.audit import audit_log
from config import get_settings

settings = get_settings()
router = APIRouter(prefix="/api/upload-requests", tags=["upload-requests"])

EXPIRY_DAYS = 7

DOC_LABELS = {
    "store_onboarding_agreement": "Signed Store Onboarding Agreement",
    "customer_information_form":  "Signed Customer Information Form",
    "nda":                        "Signed NDA",
    "tqa":                        "Signed TQA Document",
    "cipc_certificate":           "CIPC Company Registration Certificate",
}
ALL_DOC_TYPES = list(DOC_LABELS.keys())


class CreateUploadRequestBody(BaseModel):
    partner_id: int
    send_to_email: str
    send_to_name: str
    requested_doc_types: Optional[List[str]] = None


def _derive_status(doc: dict) -> str:
    raw = doc.get("status", "pending")
    if raw == "uploaded":
        return "uploaded"
    if doc.get("expires_at") and datetime.utcnow() > doc["expires_at"]:
        return "expired"
    return raw


def _serialize(doc: dict) -> dict:
    if doc is None:
        return None
    return {
        "id":                   str(doc["_id"]),
        "partner_id":           doc.get("partner_id"),
        "partner_name":         doc.get("partner_name"),
        "sent_to_email":        doc.get("sent_to_email"),
        "sent_to_name":         doc.get("sent_to_name"),
        "sent_by_user_id":      doc.get("sent_by_user_id"),
        "sent_by_name":         doc.get("sent_by_name"),
        "created_at":           doc["created_at"].isoformat() if doc.get("created_at") else None,
        "expires_at":           doc["expires_at"].isoformat() if doc.get("expires_at") else None,
        "first_accessed_at":    doc["first_accessed_at"].isoformat() if doc.get("first_accessed_at") else None,
        "completed_at":         doc["completed_at"].isoformat() if doc.get("completed_at") else None,
        "status":               _derive_status(doc),
        "files":                doc.get("files", []),
        "requested_doc_types":  doc.get("requested_doc_types", ALL_DOC_TYPES),
    }


# ── Admin: create upload request ───────────────────────────────────────────────

@router.post("/", dependencies=[Depends(require_permission("customers.manage"))])
async def create_upload_request(
    body: CreateUploadRequestBody,
    background_tasks: BackgroundTasks,
    current_user: dict = Depends(get_current_user),
):
    odoo = get_odoo_client()
    partners = odoo.search_read(
        "res.partner",
        domain=[("id", "=", body.partner_id), ("active", "=", True)],
        fields=["name"],
        limit=1,
    )
    if not partners:
        raise HTTPException(status_code=404, detail="Partner not found")

    partner_name = partners[0]["name"]

    # Verify onboarding mailbox is configured before creating the request
    from services.imap_client import get_config as _imap_cfg, get_graph_mailbox_address
    from services.graph_client import graph_configured
    from services.email_service import _wrap as _email_wrap, _h1, _p, _divider, _info_box, _button

    onboarding_graph_address = get_graph_mailbox_address("onboarding")
    imap_cfg = _imap_cfg("onboarding")
    use_graph = graph_configured() and bool(onboarding_graph_address)

    if not use_graph and not imap_cfg:
        raise HTTPException(
            status_code=503,
            detail="Onboarding mailbox not configured. Set up the mailbox in Settings before sending document upload links.",
        )

    from_address = onboarding_graph_address if use_graph else (
        imap_cfg.get("mailbox_address") or imap_cfg.get("imap_username", "")
    )

    now      = datetime.utcnow()
    expires  = now + timedelta(days=EXPIRY_DAYS)
    token    = secrets.token_urlsafe(32)

    req_types = [t for t in (body.requested_doc_types or []) if t in DOC_LABELS] or ALL_DOC_TYPES

    doc = {
        "token":                token,
        "partner_id":           body.partner_id,
        "partner_name":         partner_name,
        "sent_to_email":        body.send_to_email,
        "sent_to_name":         body.send_to_name,
        "sent_by_user_id":      str(current_user.get("_id") or current_user.get("username", "unknown")),
        "sent_by_name":         current_user.get("name") or current_user.get("username"),
        "created_at":           now,
        "expires_at":           expires,
        "first_accessed_at":    None,
        "completed_at":         None,
        "status":               "pending",
        "files":                [],
        "requested_doc_types":  req_types,
    }
    result = await col("doc_upload_requests").insert_one(doc)

    await audit_log(
        user=current_user,
        action="doc_upload_request.sent",
        entity_type="doc_upload_request",
        entity_id=str(result.inserted_id),
        entity_label=partner_name,
        after={"sent_to": body.send_to_email, "expires": expires.isoformat()},
    )

    upload_url = f"{settings.portal_url}/upload-docs/{token}"

    greeting = f"Hi {body.send_to_name}," if body.send_to_name else "Hi,"
    subject  = f"Documents required: {partner_name}"
    body_html = _email_wrap(
        _h1("Action required: please upload your documents")
        + _p(greeting)
        + _p(
            f"Our team requires outstanding documentation for {partner_name}. "
            "Please use the secure link below to upload your documents at your convenience."
        )
        + _info_box([
            ("Account",      partner_name),
            ("Link expires", f"In {EXPIRY_DAYS} days"),
        ], tint="#fffbeb", border="#fcd34d")
        + _button("Upload your documents", upload_url)
        + _divider()
        + _p(
            f"This link is unique to your account and expires after {EXPIRY_DAYS} days. "
            "If you have any questions, please reply to this email.",
            muted=True,
        ),
        footer_note="This message was sent on behalf of Bassani Health. Reply to this email if you need assistance.",
    )

    thread_doc = {
        "mailbox_address": from_address,
        "from_email":      from_address,
        "from_name":       "Bassani Health",
        "to_email":        body.send_to_email,
        "subject":         subject,
        "body_html":       body_html,
        "body_preview":    f"Document upload link sent to {body.send_to_email}",
        "is_outgoing":     True,
        "status":          "sent",
        "received_at":     now,
        "has_attachments": False,
        "attachments":     [],
        "thread_root_id":  None,
        "is_read":         True,
        "created_at":      now,
        "sent_by":         current_user.get("username"),
    }
    inbox_result = await col("onboarding_inbox").insert_one(thread_doc)
    inbox_id_str = str(inbox_result.inserted_id)
    await col("onboarding_inbox").update_one(
        {"_id": inbox_result.inserted_id},
        {"$set": {"thread_root_id": inbox_id_str}},
    )

    async def _do_send():
        try:
            if use_graph:
                from services.graph_client import send_mail as graph_send_mail
                await graph_send_mail(
                    to_email=body.send_to_email,
                    subject=subject,
                    body_html=body_html,
                    mailbox_address=onboarding_graph_address,
                )
            else:
                from services.imap_client import send_new_email as imap_send_new
                message_id = await imap_send_new(
                    to_email=body.send_to_email,
                    subject=subject,
                    body_html=body_html,
                    mailbox="onboarding",
                )
                await col("onboarding_inbox").update_one(
                    {"_id": inbox_result.inserted_id},
                    {"$set": {"imap_message_id": message_id}},
                )
        except Exception as exc:
            import logging as _log
            _log.getLogger(__name__).error(
                "doc_upload_request.send_failed to=%s error=%s", body.send_to_email, exc
            )

    background_tasks.add_task(_do_send)
    return {"success": True, "id": str(result.inserted_id)}


# ── Admin: fetch most recent upload request for a customer ─────────────────────

@router.get("/customer/{partner_id}", dependencies=[Depends(require_permission("customers.manage"))])
async def get_upload_request_for_customer(partner_id: int):
    doc = await col("doc_upload_requests").find_one(
        {"partner_id": partner_id},
        sort=[("created_at", -1)],
    )
    return {"request": _serialize(doc) if doc else None}


# ── Public: validate token (unauthenticated) ───────────────────────────────────

@router.get("/{token}")
async def get_upload_request_public(token: str):
    doc = await col("doc_upload_requests").find_one({"token": token})
    if not doc:
        raise HTTPException(status_code=404, detail="Link not found")

    now = datetime.utcnow()
    if doc.get("expires_at") and now > doc["expires_at"]:
        return {
            "valid": False,
            "reason": "expired",
            "partner_name": doc.get("partner_name"),
        }

    if not doc.get("first_accessed_at"):
        await col("doc_upload_requests").update_one(
            {"_id": doc["_id"]},
            {"$set": {"first_accessed_at": now, "status": "accessed"}},
        )

    return {
        "valid":                True,
        "partner_name":         doc.get("partner_name"),
        "already_uploaded":     len(doc.get("files", [])) > 0,
        "requested_doc_types":  doc.get("requested_doc_types", ALL_DOC_TYPES),
    }


# ── Public: upload files (unauthenticated) ─────────────────────────────────────

@router.post("/{token}/files")
async def upload_files_public(
    token: str,
    background_tasks: BackgroundTasks,
    files: List[UploadFile] = File(...),
    doc_types: List[str]    = Form(...),
):
    doc = await col("doc_upload_requests").find_one({"token": token})
    if not doc:
        raise HTTPException(status_code=404, detail="Link not found")

    now = datetime.utcnow()
    if doc.get("expires_at") and now > doc["expires_at"]:
        raise HTTPException(status_code=410, detail="This upload link has expired.")

    if not files:
        raise HTTPException(status_code=422, detail="No files provided.")

    if len(files) != len(doc_types):
        raise HTTPException(status_code=422, detail="files and doc_types counts must match.")

    invalid = [t for t in doc_types if t not in DOC_LABELS]
    if invalid:
        raise HTTPException(status_code=422, detail=f"Unknown document type(s): {invalid}")

    uploaded = []
    for file, doc_type in zip(files, doc_types):
        contents = await file.read()
        if not contents:
            continue
        ext     = os.path.splitext(file.filename or "")[1].lower() or ".pdf"
        file_id = str(uuid.uuid4())
        key     = f"customers/{doc['partner_id']}/uploads/{file_id}{ext}"
        await r2_put(key, contents, content_type=file.content_type or "application/octet-stream")
        uploaded.append({
            "file_id":     file_id,
            "filename":    file.filename or f"document{ext}",
            "r2_key":      key,
            "doc_type":    doc_type,
            "uploaded_at": now.isoformat(),
        })

    if not uploaded:
        raise HTTPException(status_code=422, detail="No valid files were received.")

    await col("doc_upload_requests").update_one(
        {"_id": doc["_id"]},
        {
            "$set":  {"status": "uploaded", "completed_at": now},
            "$push": {"files": {"$each": uploaded}},
        },
    )

    # Mirror into customer_documents — upsert by (partner_id, doc_type) to overwrite existing
    for f in uploaded:
        label = DOC_LABELS.get(f["doc_type"], f["filename"])
        await col("customer_documents").update_one(
            {"odoo_partner_id": doc["partner_id"], "doc_type": f["doc_type"]},
            {"$set": {
                "id":              f["file_id"],
                "odoo_partner_id": doc["partner_id"],
                "label":           label,
                "doc_type":        f["doc_type"],
                "filename":        f["filename"],
                "r2_key":          f["r2_key"],
                "source":          "customer_upload",
                "uploaded_at":     now.isoformat(),
                "uploaded_by":     doc.get("sent_to_email"),
            }},
            upsert=True,
        )

    # Notify the onboarding inbox
    from services.email_service import send_doc_upload_notification
    from routes.settings_routes import get_email_routing
    routing = await get_email_routing()
    notify_emails = routing.get("application_submitted_to") or []
    if notify_emails:
        background_tasks.add_task(
            send_doc_upload_notification,
            to_emails=notify_emails,
            company_name=doc.get("partner_name", ""),
            uploaded_by_email=doc.get("sent_to_email", ""),
            file_list=[f["filename"] for f in uploaded],
            uploaded_at=now.strftime("%d %b %Y at %H:%M UTC"),
        )

    return {"success": True, "uploaded": len(uploaded)}
