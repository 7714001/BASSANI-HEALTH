"""
Document template management endpoints.

Allows super_admin to upload, version, and activate the four Bassani-issued
onboarding template PDFs (Store Onboarding Agreement, Customer Information Form,
NDA, TQA). Versions are stored in R2; the active version is served by the public
and onboarding download endpoints instead of the baked-in static files.

Collection: doc_templates
Fields: doc_type, version, label, filename, r2_key, file_size,
        uploaded_at, uploaded_by_id, uploaded_by_name, is_active, notes
"""
import io
from datetime import datetime
from fastapi import APIRouter, Depends, File, Form, HTTPException, UploadFile
from fastapi.responses import StreamingResponse
from typing import Optional

from auth import get_current_user, require_admin
from database import col
from services.r2_client import r2_put, r2_get
from middleware.audit import audit_log

router = APIRouter(prefix="/api/doc-templates", tags=["doc-templates"])

# The four Bassani-issued template documents managed by this module.
DOC_TYPES: dict[str, dict] = {
    "store_onboarding_agreement": {
        "label":    "Store Onboarding Agreement",
        "filename": "store-onboarding-agreement.pdf",
    },
    "customer_information_form": {
        "label":    "Customer Information Form",
        "filename": "customer-information-form.pdf",
    },
    "nda": {
        "label":    "NDA",
        "filename": "nda.pdf",
    },
    "tqa": {
        "label":    "TQA Document",
        "filename": "tqa.pdf",
    },
}

# Reverse map: filename → doc_type key (used by existing download endpoints)
FILENAME_TO_DOC_TYPE: dict[str, str] = {
    meta["filename"]: key for key, meta in DOC_TYPES.items()
}


# ── Shared helper — used by public and onboarding download endpoints ────────────

async def get_active_template_bytes(doc_type: str) -> Optional[bytes]:
    """
    Return bytes of the current active template from R2, or None if no managed
    version has been uploaded yet (falls back to static file).
    """
    doc = await col("doc_templates").find_one({"doc_type": doc_type, "is_active": True})
    if not doc:
        return None
    try:
        return await r2_get(doc["r2_key"])
    except Exception:
        return None


def _require_super_admin(current_user: dict):
    if not current_user.get("is_super_admin") and current_user.get("role") != "super_admin":
        raise HTTPException(status_code=403, detail="Super admin access required")


def _serialize(doc: dict) -> dict:
    return {
        "id":               str(doc["_id"]),
        "doc_type":         doc.get("doc_type"),
        "label":            doc.get("label"),
        "filename":         doc.get("filename"),
        "version":          doc.get("version"),
        "file_size":        doc.get("file_size"),
        "r2_key":           doc.get("r2_key"),
        "uploaded_at":      doc["uploaded_at"].isoformat() if doc.get("uploaded_at") else None,
        "uploaded_by_id":   doc.get("uploaded_by_id"),
        "uploaded_by_name": doc.get("uploaded_by_name"),
        "is_active":        doc.get("is_active", False),
        "notes":            doc.get("notes", ""),
    }


# ── List all doc types with their active version ───────────────────────────────

@router.get("/", dependencies=[Depends(require_admin)])
async def list_doc_templates():
    result = []
    for doc_type, meta in DOC_TYPES.items():
        active = await col("doc_templates").find_one({"doc_type": doc_type, "is_active": True})
        count  = await col("doc_templates").count_documents({"doc_type": doc_type})
        result.append({
            "doc_type":      doc_type,
            "label":         meta["label"],
            "filename":      meta["filename"],
            "version_count": count,
            "active":        _serialize(active) if active else None,
        })
    return {"templates": result}


# ── Version history for a doc type ─────────────────────────────────────────────

@router.get("/{doc_type}/history", dependencies=[Depends(require_admin)])
async def get_version_history(doc_type: str):
    if doc_type not in DOC_TYPES:
        raise HTTPException(status_code=404, detail="Unknown document type")
    cursor = col("doc_templates").find(
        {"doc_type": doc_type},
        sort=[("version", -1)],
    )
    docs = [_serialize(d) async for d in cursor]
    return {"doc_type": doc_type, "versions": docs}


# ── Upload a new version ────────────────────────────────────────────────────────

@router.post("/{doc_type}/upload", dependencies=[Depends(require_admin)])
async def upload_template_version(
    doc_type: str,
    file:  UploadFile = File(...),
    notes: str        = Form(""),
    current_user: dict = Depends(get_current_user),
):
    _require_super_admin(current_user)

    if doc_type not in DOC_TYPES:
        raise HTTPException(status_code=404, detail="Unknown document type")
    if not file.filename or not file.filename.lower().endswith(".pdf"):
        raise HTTPException(status_code=422, detail="Only PDF files are accepted")

    contents = await file.read()
    if not contents:
        raise HTTPException(status_code=422, detail="Uploaded file is empty")

    meta = DOC_TYPES[doc_type]
    now  = datetime.utcnow()

    # Next version number
    latest = await col("doc_templates").find_one(
        {"doc_type": doc_type},
        sort=[("version", -1)],
    )
    version = (latest["version"] + 1) if latest else 1

    r2_key = f"doc-templates/{doc_type}/v{version}/{meta['filename']}"
    await r2_put(r2_key, contents, content_type="application/pdf")

    # Deactivate all existing versions
    await col("doc_templates").update_many(
        {"doc_type": doc_type},
        {"$set": {"is_active": False}},
    )

    new_doc = {
        "doc_type":         doc_type,
        "label":            meta["label"],
        "filename":         meta["filename"],
        "version":          version,
        "r2_key":           r2_key,
        "file_size":        len(contents),
        "uploaded_at":      now,
        "uploaded_by_id":   str(current_user.get("_id") or current_user.get("username", "unknown")),
        "uploaded_by_name": current_user.get("name") or current_user.get("username"),
        "is_active":        True,
        "notes":            notes.strip(),
    }
    result = await col("doc_templates").insert_one(new_doc)

    await audit_log(
        user=current_user,
        action="doc_template.uploaded",
        entity_type="doc_template",
        entity_id=str(result.inserted_id),
        entity_label=f"{meta['label']} v{version}",
        after={"version": version, "file_size": len(contents), "notes": notes.strip()},
    )

    return {"success": True, "version": version, "id": str(result.inserted_id)}


# ── Activate (rollback to) a specific version ──────────────────────────────────

@router.post("/{doc_type}/activate/{version_id}", dependencies=[Depends(require_admin)])
async def activate_template_version(
    doc_type:   str,
    version_id: str,
    current_user: dict = Depends(get_current_user),
):
    _require_super_admin(current_user)

    if doc_type not in DOC_TYPES:
        raise HTTPException(status_code=404, detail="Unknown document type")

    from bson import ObjectId
    try:
        oid = ObjectId(version_id)
    except Exception:
        raise HTTPException(status_code=422, detail="Invalid version ID")

    target = await col("doc_templates").find_one({"_id": oid, "doc_type": doc_type})
    if not target:
        raise HTTPException(status_code=404, detail="Version not found")

    if target.get("is_active"):
        return {"success": True, "message": "Already the active version"}

    await col("doc_templates").update_many(
        {"doc_type": doc_type},
        {"$set": {"is_active": False}},
    )
    await col("doc_templates").update_one(
        {"_id": oid},
        {"$set": {"is_active": True}},
    )

    await audit_log(
        user=current_user,
        action="doc_template.activated",
        entity_type="doc_template",
        entity_id=version_id,
        entity_label=f"{DOC_TYPES[doc_type]['label']} v{target['version']}",
        after={"activated_version": target["version"]},
    )

    return {"success": True, "activated_version": target["version"]}


# ── Download a specific version (admin) ────────────────────────────────────────

@router.get("/{doc_type}/download", dependencies=[Depends(require_admin)])
async def download_active_template(doc_type: str):
    if doc_type not in DOC_TYPES:
        raise HTTPException(status_code=404, detail="Unknown document type")
    data = await get_active_template_bytes(doc_type)
    if data is None:
        raise HTTPException(status_code=404, detail="No managed version uploaded yet")
    filename = DOC_TYPES[doc_type]["filename"]
    return StreamingResponse(
        io.BytesIO(data),
        media_type="application/pdf",
        headers={"Content-Disposition": f'attachment; filename="{filename}"'},
    )


@router.get("/{doc_type}/download/{version_id}", dependencies=[Depends(require_admin)])
async def download_template_version(doc_type: str, version_id: str):
    if doc_type not in DOC_TYPES:
        raise HTTPException(status_code=404, detail="Unknown document type")

    from bson import ObjectId
    try:
        oid = ObjectId(version_id)
    except Exception:
        raise HTTPException(status_code=422, detail="Invalid version ID")

    doc = await col("doc_templates").find_one({"_id": oid, "doc_type": doc_type})
    if not doc:
        raise HTTPException(status_code=404, detail="Version not found")

    data = await r2_get(doc["r2_key"])
    meta = DOC_TYPES[doc_type]
    fname = f"{meta['filename'].replace('.pdf', '')}-v{doc['version']}.pdf"
    return StreamingResponse(
        io.BytesIO(data),
        media_type="application/pdf",
        headers={"Content-Disposition": f'attachment; filename="{fname}"'},
    )
