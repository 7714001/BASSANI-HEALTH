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
from fastapi import APIRouter, BackgroundTasks, Depends, File, HTTPException, UploadFile
from typing import List
from pydantic import BaseModel
from datetime import datetime, timezone, timedelta

from auth import get_current_user, require_permission
from database import col
from odoo_client import get_odoo_client
from services.r2_client import r2_put
from middleware.audit import audit_log
from config import get_settings

settings = get_settings()
router = APIRouter(prefix="/api/upload-requests", tags=["upload-requests"])

EXPIRY_DAYS = 7


class CreateUploadRequestBody(BaseModel):
    partner_id: int
    send_to_email: str
    send_to_name: str


def _derive_status(doc: dict) -> str:
    raw = doc.get("status", "pending")
    if raw == "uploaded":
        return "uploaded"
    if doc.get("expires_at") and datetime.now(timezone.utc) > doc["expires_at"]:
        return "expired"
    return raw


def _serialize(doc: dict) -> dict:
    if doc is None:
        return None
    return {
        "id":                str(doc["_id"]),
        "partner_id":        doc.get("partner_id"),
        "partner_name":      doc.get("partner_name"),
        "sent_to_email":     doc.get("sent_to_email"),
        "sent_to_name":      doc.get("sent_to_name"),
        "sent_by_user_id":   doc.get("sent_by_user_id"),
        "sent_by_name":      doc.get("sent_by_name"),
        "created_at":        doc["created_at"].isoformat() if doc.get("created_at") else None,
        "expires_at":        doc["expires_at"].isoformat() if doc.get("expires_at") else None,
        "first_accessed_at": doc["first_accessed_at"].isoformat() if doc.get("first_accessed_at") else None,
        "completed_at":      doc["completed_at"].isoformat() if doc.get("completed_at") else None,
        "status":            _derive_status(doc),
        "files":             doc.get("files", []),
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
    now      = datetime.now(timezone.utc)
    expires  = now + timedelta(days=EXPIRY_DAYS)
    token    = secrets.token_urlsafe(32)

    doc = {
        "token":             token,
        "partner_id":        body.partner_id,
        "partner_name":      partner_name,
        "sent_to_email":     body.send_to_email,
        "sent_to_name":      body.send_to_name,
        "sent_by_user_id":   str(current_user["_id"]),
        "sent_by_name":      current_user.get("name") or current_user.get("username"),
        "created_at":        now,
        "expires_at":        expires,
        "first_accessed_at": None,
        "completed_at":      None,
        "status":            "pending",
        "files":             [],
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
    from services.email_service import send_doc_upload_request
    background_tasks.add_task(
        send_doc_upload_request,
        to_email=body.send_to_email,
        to_name=body.send_to_name,
        company_name=partner_name,
        upload_url=upload_url,
        expiry_days=EXPIRY_DAYS,
    )

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

    now = datetime.now(timezone.utc)
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
        "valid":            True,
        "partner_name":     doc.get("partner_name"),
        "already_uploaded": len(doc.get("files", [])) > 0,
    }


# ── Public: upload files (unauthenticated) ─────────────────────────────────────

@router.post("/{token}/files")
async def upload_files_public(
    token: str,
    background_tasks: BackgroundTasks,
    files: List[UploadFile] = File(...),
):
    doc = await col("doc_upload_requests").find_one({"token": token})
    if not doc:
        raise HTTPException(status_code=404, detail="Link not found")

    now = datetime.now(timezone.utc)
    if doc.get("expires_at") and now > doc["expires_at"]:
        raise HTTPException(status_code=410, detail="This upload link has expired.")

    if not files:
        raise HTTPException(status_code=422, detail="No files provided.")

    uploaded = []
    for file in files:
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

    # Mirror into customer_documents so files appear on the admin profile immediately
    for f in uploaded:
        await col("customer_documents").insert_one({
            "id":              f["file_id"],
            "odoo_partner_id": doc["partner_id"],
            "label":           f["filename"],
            "doc_type":        "customer_upload",
            "filename":        f["filename"],
            "r2_key":          f["r2_key"],
            "source":          "customer_upload",
            "uploaded_at":     now.isoformat(),
            "uploaded_by":     doc.get("sent_to_email"),
        })

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
