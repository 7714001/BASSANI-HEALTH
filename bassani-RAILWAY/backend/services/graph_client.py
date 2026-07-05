"""
Microsoft Graph API client for shared mailboxes.

Uses OAuth2 client_credentials flow (application permissions, not delegated).
Required Azure app permissions: Mail.Read, Mail.Send, Mail.ReadWrite.

Credentials are resolved in priority order:
  1. Runtime credentials set from MongoDB settings (via set_runtime_credentials)
  2. Railway environment variables (backward-compat fallback for existing deployments)

Call set_runtime_credentials() whenever the settings doc is saved or loaded so
the in-memory token cache is kept in sync. All public function signatures are
unchanged — existing callers need no modification.
"""
import asyncio
import base64
import logging
import time
from typing import Optional

import httpx

logger = logging.getLogger(__name__)

GRAPH_BASE = "https://graph.microsoft.com/v1.0"

# Runtime credentials loaded from MongoDB; override env vars when set.
_runtime_creds: Optional[dict] = None

# Token cache — reset when credentials change.
_token_cache: dict = {"access_token": None, "expires_at": 0.0}


def set_runtime_credentials(creds: Optional[dict]) -> None:
    """
    Called by imap_client.load_config_from_db when provider=='graph'.
    creds: { tenant_id, client_id, client_secret, mailbox_address } or None to clear.
    Invalidates the in-memory token cache so the next call fetches a fresh token.
    """
    global _runtime_creds, _token_cache
    _runtime_creds = creds
    _token_cache = {"access_token": None, "expires_at": 0.0}
    logger.info(
        "graph_client.credentials_updated source=%s",
        "db" if creds else "cleared",
    )


# ── Credential helpers (prefer runtime over env vars) ─────────────────────────

def _tenant_id() -> str:
    if _runtime_creds and _runtime_creds.get("tenant_id"):
        return _runtime_creds["tenant_id"]
    try:
        from config import get_settings
        return get_settings().ms_tenant_id or ""
    except Exception:
        return ""


def _client_id() -> str:
    if _runtime_creds and _runtime_creds.get("client_id"):
        return _runtime_creds["client_id"]
    try:
        from config import get_settings
        return get_settings().ms_client_id or ""
    except Exception:
        return ""


def _client_secret() -> str:
    if _runtime_creds and _runtime_creds.get("client_secret"):
        return _runtime_creds["client_secret"]
    try:
        from config import get_settings
        return get_settings().ms_client_secret or ""
    except Exception:
        return ""


def _default_mailbox() -> str:
    if _runtime_creds and _runtime_creds.get("mailbox_address"):
        return _runtime_creds["mailbox_address"]
    try:
        from config import get_settings
        return get_settings().ms_shared_mailbox or ""
    except Exception:
        return ""


# ── Public helpers ─────────────────────────────────────────────────────────────

def graph_configured() -> bool:
    return bool(_tenant_id() and _client_id() and _client_secret() and _default_mailbox())


def _resolve_mailbox(mailbox_address: Optional[str]) -> str:
    return mailbox_address or _default_mailbox()


async def get_access_token() -> str:
    now = time.time()
    if _token_cache["access_token"] and _token_cache["expires_at"] > now + 60:
        return _token_cache["access_token"]

    token_url = f"https://login.microsoftonline.com/{_tenant_id()}/oauth2/v2.0/token"
    async with httpx.AsyncClient(timeout=15) as client:
        r = await client.post(
            token_url,
            data={
                "grant_type":    "client_credentials",
                "client_id":     _client_id(),
                "client_secret": _client_secret(),
                "scope":         "https://graph.microsoft.com/.default",
            },
        )
        r.raise_for_status()
        data = r.json()

    _token_cache["access_token"] = data["access_token"]
    _token_cache["expires_at"]   = now + data.get("expires_in", 3600)
    return _token_cache["access_token"]


async def _headers() -> dict:
    token = await get_access_token()
    return {"Authorization": f"Bearer {token}", "Content-Type": "application/json"}


async def _with_retry(coro_fn, max_retries: int = 3):
    """
    Execute an httpx coroutine; retry up to max_retries times on 429,
    honouring the Retry-After header. Re-raises on any other error.
    coro_fn: zero-argument async callable that returns an httpx.Response.
    """
    for attempt in range(max_retries):
        r = await coro_fn()
        if r.status_code == 429:
            retry_after = int(r.headers.get("Retry-After", 10))
            logger.warning(
                "graph_rate_limited attempt=%d/%d retry_after=%ds",
                attempt + 1, max_retries, retry_after,
            )
            await asyncio.sleep(retry_after)
            continue
        r.raise_for_status()
        return r
    # Final attempt — let raise_for_status propagate
    r = await coro_fn()
    r.raise_for_status()
    return r


async def list_messages(
    folder: str = "inbox",
    top: int = 50,
    skip: int = 0,
    filter_str: str = "",
    mailbox_address: Optional[str] = None,
) -> list:
    mailbox = _resolve_mailbox(mailbox_address)
    url = f"{GRAPH_BASE}/users/{mailbox}/mailFolders/{folder}/messages"
    params: dict = {
        "$top":     top,
        "$skip":    skip,
        "$orderby": "receivedDateTime desc",
        "$select":  "id,conversationId,subject,from,bodyPreview,receivedDateTime,hasAttachments,isRead",
    }
    if filter_str:
        params["$filter"] = filter_str

    async with httpx.AsyncClient(timeout=20) as client:
        async def _call():
            return await client.get(url, headers=await _headers(), params=params)
        r = await _with_retry(_call)
        return r.json().get("value", [])


async def get_message(message_id: str, mailbox_address: Optional[str] = None) -> dict:
    mailbox = _resolve_mailbox(mailbox_address)
    url = f"{GRAPH_BASE}/users/{mailbox}/messages/{message_id}"
    params = {
        "$select": (
            "id,conversationId,subject,from,body,bodyPreview,"
            "receivedDateTime,hasAttachments,isRead,replyTo,internetMessageHeaders"
        )
    }
    async with httpx.AsyncClient(timeout=20) as client:
        async def _call():
            return await client.get(url, headers=await _headers(), params=params)
        r = await _with_retry(_call)
        return r.json()


async def list_attachments(message_id: str, mailbox_address: Optional[str] = None) -> list:
    mailbox = _resolve_mailbox(mailbox_address)
    url = f"{GRAPH_BASE}/users/{mailbox}/messages/{message_id}/attachments"
    params = {"$select": "id,name,contentType,size"}
    async with httpx.AsyncClient(timeout=20) as client:
        async def _call():
            return await client.get(url, headers=await _headers(), params=params)
        r = await _with_retry(_call)
        return r.json().get("value", [])


async def get_attachment_content(
    message_id: str,
    attachment_id: str,
    mailbox_address: Optional[str] = None,
) -> tuple[bytes, str, str]:
    """Returns (content_bytes, content_type, filename)."""
    mailbox = _resolve_mailbox(mailbox_address)
    url = f"{GRAPH_BASE}/users/{mailbox}/messages/{message_id}/attachments/{attachment_id}"
    async with httpx.AsyncClient(timeout=30) as client:
        async def _call():
            return await client.get(url, headers=await _headers())
        r = await _with_retry(_call)
        data = r.json()

    content = base64.b64decode(data.get("contentBytes", ""))
    return (
        content,
        data.get("contentType", "application/octet-stream"),
        data.get("name", "attachment"),
    )


async def send_reply(
    message_id: str,
    body_html: str,
    mailbox_address: Optional[str] = None,
) -> None:
    mailbox = _resolve_mailbox(mailbox_address)
    url = f"{GRAPH_BASE}/users/{mailbox}/messages/{message_id}/reply"
    payload = {"message": {"body": {"contentType": "HTML", "content": body_html}}}
    async with httpx.AsyncClient(timeout=20) as client:
        async def _call():
            return await client.post(url, headers=await _headers(), json=payload)
        await _with_retry(_call)


async def send_mail(
    to_email: str,
    subject: str,
    body_html: str,
    file_attachments: Optional[list] = None,
    mailbox_address: Optional[str] = None,
) -> None:
    """
    Send a new outgoing email (not a reply) via Graph sendMail API.
    file_attachments: list of { filename, content: bytes, content_type }
    Saves to the mailbox Sent Items automatically.
    """
    mailbox = _resolve_mailbox(mailbox_address)
    url = f"{GRAPH_BASE}/users/{mailbox}/sendMail"

    att_payload = [
        {
            "@odata.type": "#microsoft.graph.fileAttachment",
            "name":         att["filename"],
            "contentType":  att.get("content_type", "application/octet-stream"),
            "contentBytes": base64.b64encode(att["content"]).decode("utf-8"),
        }
        for att in (file_attachments or [])
    ]

    payload = {
        "message": {
            "subject": subject,
            "body":    {"contentType": "HTML", "content": body_html},
            "toRecipients": [{"emailAddress": {"address": to_email}}],
            "attachments":  att_payload,
        },
        "saveToSentItems": True,
    }

    async with httpx.AsyncClient(timeout=30) as client:
        async def _call():
            return await client.post(url, headers=await _headers(), json=payload)
        await _with_retry(_call)


async def mark_as_read(message_id: str, mailbox_address: Optional[str] = None) -> None:
    mailbox = _resolve_mailbox(mailbox_address)
    url = f"{GRAPH_BASE}/users/{mailbox}/messages/{message_id}"
    async with httpx.AsyncClient(timeout=10) as client:
        async def _call():
            return await client.patch(url, headers=await _headers(), json={"isRead": True})
        await _with_retry(_call)
