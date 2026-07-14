"""
Document template management endpoints.

Allows super_admin to upload, version, and activate the three Bassani-issued
onboarding template PDFs (Store Onboarding Agreement, Customer Information Form,
NDA). The Welcome Pack is managed as a multi-file bundle — one or more files
(PDF or Excel) uploaded together as a single versioned unit.

Collection: doc_templates
Single-file fields: doc_type, version, label, filename, r2_key, file_size,
                    uploaded_at, uploaded_by_id, uploaded_by_name, is_active, notes
Bundle fields (welcome_pack): doc_type, version, is_bundle=True, files[],
                    total_file_size, uploaded_at, uploaded_by_id, uploaded_by_name,
                    is_active, notes
"""
import io
import json
from datetime import datetime
from fastapi import APIRouter, Depends, File, Form, HTTPException, UploadFile
from fastapi.responses import StreamingResponse
from typing import List, Optional

from auth import require_admin, require_permission
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
    "welcome_pack": {
        "label":     "Welcome Pack",
        "is_bundle": True,   # multi-file bundle — uses /welcome_pack/upload-bundle
    },
}

# Reverse map: filename → doc_type key (used by existing download endpoints)
FILENAME_TO_DOC_TYPE: dict[str, str] = {
    meta["filename"]: key
    for key, meta in DOC_TYPES.items()
    if "filename" in meta
}

BUNDLE_DOC_TYPES = {k for k, v in DOC_TYPES.items() if v.get("is_bundle")}

_ALLOWED_BUNDLE = {".pdf", ".xlsx", ".xls"}


def _content_type(filename: str) -> str:
    fn = (filename or "").lower()
    if fn.endswith(".pdf"):   return "application/pdf"
    if fn.endswith(".xlsx"):  return "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet"
    if fn.endswith(".xls"):   return "application/vnd.ms-excel"
    return "application/octet-stream"


# ── Shared helpers ──────────────────────────────────────────────────────────────

async def get_active_template_bytes(doc_type: str) -> Optional[bytes]:
    """
    Return bytes of the current active template from R2, or None if no managed
    version has been uploaded yet (falls back to static file).
    Not applicable to bundle doc types — use get_active_bundle_files() instead.
    """
    if doc_type in BUNDLE_DOC_TYPES:
        return None
    doc = await col("doc_templates").find_one({"doc_type": doc_type, "is_active": True})
    if not doc:
        return None
    try:
        return await r2_get(doc["r2_key"])
    except Exception:
        return None


async def get_active_bundle_files(doc_type: str) -> list[dict]:
    """
    Return a list of {filename, label, content_type, data: bytes} for every file
    in the active bundle version, or [] if no bundle has been uploaded yet.
    """
    doc = await col("doc_templates").find_one(
        {"doc_type": doc_type, "is_active": True, "is_bundle": True}
    )
    if not doc:
        return []
    result = []
    for f in doc.get("files", []):
        try:
            data = await r2_get(f["r2_key"])
            if data:
                result.append({
                    "filename":     f["filename"],
                    "label":        f.get("label", f["filename"]),
                    "content_type": f.get("content_type", "application/octet-stream"),
                    "data":         data,
                })
        except Exception:
            pass
    return result


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


def _serialize_bundle(doc: dict) -> dict:
    return {
        "id":               str(doc["_id"]),
        "doc_type":         doc.get("doc_type"),
        "version":          doc.get("version"),
        "is_bundle":        True,
        "files":            doc.get("files", []),
        "total_file_size":  doc.get("total_file_size", 0),
        "uploaded_at":      doc["uploaded_at"].isoformat() if doc.get("uploaded_at") else None,
        "uploaded_by_id":   doc.get("uploaded_by_id"),
        "uploaded_by_name": doc.get("uploaded_by_name"),
        "is_active":        doc.get("is_active", False),
        "notes":            doc.get("notes", ""),
    }


# ── Welcome-pack bundle endpoints (defined before generic /{doc_type} routes) ──

@router.post("/welcome_pack/upload-bundle")
async def upload_welcome_pack_bundle(
    files:  List[UploadFile] = File(...),
    labels: str              = Form("[]"),   # JSON-encoded list of labels, one per file
    notes:  str              = Form(""),
    current_user: dict       = Depends(require_permission("settings.manage")),
):
    """Upload a new welcome pack bundle version (one or more PDF/Excel files)."""
    if not files:
        raise HTTPException(status_code=422, detail="At least one file is required")

    try:
        label_list: list[str] = json.loads(labels)
    except Exception:
        label_list = []

    for f in files:
        name = f.filename or ""
        ext  = ("." + name.rsplit(".", 1)[-1].lower()) if "." in name else ""
        if ext not in _ALLOWED_BUNDLE:
            raise HTTPException(
                status_code=422,
                detail=f"'{name}' is not allowed. Accepted formats: PDF, XLSX, XLS.",
            )

    now = datetime.utcnow()

    latest = await col("doc_templates").find_one(
        {"doc_type": "welcome_pack"},
        sort=[("version", -1)],
    )
    version = (latest["version"] + 1) if latest else 1

    bundle_files = []
    total_size   = 0
    for i, upload in enumerate(files):
        contents = await upload.read()
        if not contents:
            raise HTTPException(status_code=422, detail=f"File '{upload.filename}' is empty")
        ct     = _content_type(upload.filename)
        r2_key = f"doc-templates/welcome_pack/v{version}/{upload.filename}"
        await r2_put(r2_key, contents, content_type=ct)
        label = (label_list[i] if i < len(label_list) else "").strip() or (
            (upload.filename or "").rsplit(".", 1)[0].replace("-", " ").replace("_", " ")
        )
        bundle_files.append({
            "label":        label,
            "filename":     upload.filename,
            "r2_key":       r2_key,
            "file_size":    len(contents),
            "content_type": ct,
        })
        total_size += len(contents)

    await col("doc_templates").update_many(
        {"doc_type": "welcome_pack"},
        {"$set": {"is_active": False}},
    )

    new_doc = {
        "doc_type":         "welcome_pack",
        "is_bundle":        True,
        "version":          version,
        "files":            bundle_files,
        "total_file_size":  total_size,
        "uploaded_at":      now,
        "uploaded_by_id":   str(current_user.get("_id") or current_user.get("username", "unknown")),
        "uploaded_by_name": current_user.get("name") or current_user.get("username"),
        "is_active":        True,
        "notes":            notes.strip(),
    }
    result = await col("doc_templates").insert_one(new_doc)

    await audit_log(
        user=current_user,
        action="doc_template.bundle_uploaded",
        entity_type="doc_template",
        entity_id=str(result.inserted_id),
        entity_label=f"Welcome Pack v{version} ({len(files)} file{'s' if len(files) != 1 else ''})",
        after={"version": version, "file_count": len(files), "total_size": total_size, "notes": notes.strip()},
    )

    return {"success": True, "version": version, "id": str(result.inserted_id), "file_count": len(files)}


@router.get("/welcome_pack/bundle/{bundle_id}/file/{file_idx}", dependencies=[Depends(require_admin)])
async def download_bundle_file(bundle_id: str, file_idx: int):
    """Download a single file from a specific welcome pack bundle version."""
    from bson import ObjectId
    try:
        oid = ObjectId(bundle_id)
    except Exception:
        raise HTTPException(status_code=422, detail="Invalid bundle ID")

    doc = await col("doc_templates").find_one({"_id": oid, "doc_type": "welcome_pack"})
    if not doc:
        raise HTTPException(status_code=404, detail="Bundle version not found")

    files = doc.get("files", [])
    if file_idx < 0 or file_idx >= len(files):
        raise HTTPException(status_code=404, detail="File index out of range")

    f = files[file_idx]
    try:
        data = await r2_get(f["r2_key"])
    except Exception:
        raise HTTPException(status_code=502, detail="Could not retrieve file from storage")

    ct = f.get("content_type", "application/octet-stream")
    return StreamingResponse(
        io.BytesIO(data),
        media_type=ct,
        headers={"Content-Disposition": f'attachment; filename="{f["filename"]}"'},
    )


# ── List all doc types with their active version ───────────────────────────────

@router.get("/", dependencies=[Depends(require_admin)])
async def list_doc_templates():
    result = []
    for doc_type, meta in DOC_TYPES.items():
        active    = await col("doc_templates").find_one({"doc_type": doc_type, "is_active": True})
        count     = await col("doc_templates").count_documents({"doc_type": doc_type})
        is_bundle = meta.get("is_bundle", False)
        result.append({
            "doc_type":      doc_type,
            "label":         meta["label"],
            "filename":      meta.get("filename", ""),
            "is_bundle":     is_bundle,
            "version_count": count,
            "active": (
                _serialize_bundle(active) if (active and is_bundle)
                else (_serialize(active) if active else None)
            ),
        })
    return {"templates": result}


# ── Version history for a doc type ─────────────────────────────────────────────

@router.get("/{doc_type}/history", dependencies=[Depends(require_admin)])
async def get_version_history(doc_type: str):
    if doc_type not in DOC_TYPES:
        raise HTTPException(status_code=404, detail="Unknown document type")
    is_bundle = DOC_TYPES[doc_type].get("is_bundle", False)
    cursor = col("doc_templates").find(
        {"doc_type": doc_type},
        sort=[("version", -1)],
    )
    docs = [
        _serialize_bundle(d) if is_bundle else _serialize(d)
        async for d in cursor
    ]
    return {"doc_type": doc_type, "versions": docs}


# ── Upload a new single-file version ───────────────────────────────────────────

@router.post("/{doc_type}/upload")
async def upload_template_version(
    doc_type: str,
    file:  UploadFile = File(...),
    notes: str        = Form(""),
    current_user: dict = Depends(require_permission("settings.manage")),
):
    if doc_type not in DOC_TYPES:
        raise HTTPException(status_code=404, detail="Unknown document type")
    if doc_type in BUNDLE_DOC_TYPES:
        raise HTTPException(
            status_code=422,
            detail=f"'{doc_type}' is a multi-file bundle. Use POST /{doc_type}/upload-bundle instead.",
        )
    if not file.filename or not file.filename.lower().endswith(".pdf"):
        raise HTTPException(status_code=422, detail="Only PDF files are accepted")

    contents = await file.read()
    if not contents:
        raise HTTPException(status_code=422, detail="Uploaded file is empty")

    meta = DOC_TYPES[doc_type]
    now  = datetime.utcnow()

    latest = await col("doc_templates").find_one(
        {"doc_type": doc_type},
        sort=[("version", -1)],
    )
    version = (latest["version"] + 1) if latest else 1

    r2_key = f"doc-templates/{doc_type}/v{version}/{meta['filename']}"
    await r2_put(r2_key, contents, content_type="application/pdf")

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

@router.post("/{doc_type}/activate/{version_id}")
async def activate_template_version(
    doc_type:   str,
    version_id: str,
    current_user: dict = Depends(require_permission("settings.manage")),
):
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


# ── Download active version (single-file types only) ───────────────────────────

@router.get("/{doc_type}/download", dependencies=[Depends(require_admin)])
async def download_active_template(doc_type: str):
    if doc_type not in DOC_TYPES:
        raise HTTPException(status_code=404, detail="Unknown document type")
    if doc_type in BUNDLE_DOC_TYPES:
        raise HTTPException(
            status_code=400,
            detail="Welcome Pack is a multi-file bundle. Download individual files via GET /welcome_pack/bundle/{id}/file/{idx}",
        )
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
    if doc_type in BUNDLE_DOC_TYPES:
        raise HTTPException(
            status_code=400,
            detail="Welcome Pack is a multi-file bundle. Download individual files via GET /welcome_pack/bundle/{id}/file/{idx}",
        )

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
