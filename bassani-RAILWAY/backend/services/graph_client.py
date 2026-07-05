"""
Microsoft Graph API client for shared mailboxes.

Uses OAuth2 client_credentials flow (application permissions, not delegated).
Required Azure app permissions: Mail.Read, Mail.Send, Mail.ReadWrite.

All public functions accept an optional mailbox_address parameter. When omitted
they fall back to settings.ms_shared_mailbox (the sales mailbox), preserving
backward compatibility with all existing callers.
"""
import base64
import logging
import time
from typing import Optional

import httpx

from config import get_settings

logger = logging.getLogger(__name__)
settings = get_settings()

GRAPH_BASE = "https://graph.microsoft.com/v1.0"

_token_cache: dict = {"access_token": None, "expires_at": 0.0}


def graph_configured() -> bool:
    return bool(
        settings.ms_tenant_id
        and settings.ms_client_id
        and settings.ms_client_secret
        and settings.ms_shared_mailbox
    )


def _resolve_mailbox(mailbox_address: Optional[str]) -> str:
    return mailbox_address or settings.ms_shared_mailbox


async def get_access_token() -> str:
    now = time.time()
    if _token_cache["access_token"] and _token_cache["expires_at"] > now + 60:
        return _token_cache["access_token"]

    token_url = (
        f"https://login.microsoftonline.com/{settings.ms_tenant_id}/oauth2/v2.0/token"
    )
    async with httpx.AsyncClient(timeout=15) as client:
        r = await client.post(
            token_url,
            data={
                "grant_type":    "client_credentials",
                "client_id":     settings.ms_client_id,
                "client_secret": settings.ms_client_secret,
                "scope":         "https://graph.microsoft.com/.default",
            },
        )
        r.raise_for_status()
        data = r.json()

    _token_cache["access_token"] = data["access_token"]
    _token_cache["expires_at"] = now + data.get("expires_in", 3600)
    return _token_cache["access_token"]


async def _headers() -> dict:
    token = await get_access_token()
    return {"Authorization": f"Bearer {token}", "Content-Type": "application/json"}


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
        r = await client.get(url, headers=await _headers(), params=params)
        r.raise_for_status()
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
        r = await client.get(url, headers=await _headers(), params=params)
        r.raise_for_status()
        return r.json()


async def list_attachments(message_id: str, mailbox_address: Optional[str] = None) -> list:
    mailbox = _resolve_mailbox(mailbox_address)
    url = f"{GRAPH_BASE}/users/{mailbox}/messages/{message_id}/attachments"
    params = {"$select": "id,name,contentType,size"}
    async with httpx.AsyncClient(timeout=20) as client:
        r = await client.get(url, headers=await _headers(), params=params)
        r.raise_for_status()
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
        r = await client.get(url, headers=await _headers())
        r.raise_for_status()
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
        r = await client.post(url, headers=await _headers(), json=payload)
        r.raise_for_status()


async def mark_as_read(message_id: str, mailbox_address: Optional[str] = None) -> None:
    mailbox = _resolve_mailbox(mailbox_address)
    url = f"{GRAPH_BASE}/users/{mailbox}/messages/{message_id}"
    async with httpx.AsyncClient(timeout=10) as client:
        r = await client.patch(url, headers=await _headers(), json={"isRead": True})
        r.raise_for_status()
