"""
IMAP/SMTP mailbox client — Phase 11 alternative backend.

Provider-agnostic: works with Xneelo, Microsoft 365 (outlook.office365.com),
Gmail, or any standard IMAP/SMTP server. Activated when mailbox credentials
are configured by a super admin in Settings > Mailbox, or via Railway env vars
as a fallback.

Credentials are loaded from MongoDB at startup and cached in memory.
Call load_config_from_db() on startup and after any settings save.
"""
import asyncio
import email as email_lib
import email.header
import email.utils
import html
import imaplib
import logging
import re
import smtplib
from datetime import datetime, timedelta, timezone
from email import encoders as email_encoders
from email.mime.base import MIMEBase
from email.mime.multipart import MIMEMultipart
from email.mime.text import MIMEText
from typing import Optional

logger = logging.getLogger(__name__)

# Per-mailbox IMAP configs and Graph mailbox addresses.
# Keyed by mailbox slug ("sales", "onboarding").
_configs: dict[str, Optional[dict]] = {}
_graph_addresses: dict[str, Optional[str]] = {}

# MongoDB settings key per mailbox slug (sales keeps the original key for backward compat).
_SETTINGS_KEYS: dict[str, str] = {
    "sales":      "mailbox_config",
    "onboarding": "mailbox_config_onboarding",
}


def _env_config() -> Optional[dict]:
    """Build IMAP config from Railway env vars — sales mailbox fallback only."""
    try:
        from config import get_settings
        s = get_settings()
        if s.imap_host and s.imap_username and s.imap_password:
            return {
                "imap_host":      s.imap_host,
                "imap_port":      s.imap_port or 993,
                "imap_username":  s.imap_username,
                "imap_password":  s.imap_password,
                "smtp_host":      s.smtp_host or s.imap_host,
                "smtp_port":      s.smtp_port or 587,
                "smtp_username":  s.smtp_username or s.imap_username,
                "smtp_password":  s.smtp_password or s.imap_password,
                "mailbox_address": s.imap_username,
            }
    except Exception:
        pass
    return None


def _parse_imap_doc(doc: dict) -> Optional[dict]:
    """Extract IMAP credentials from a portal_settings document."""
    if doc.get("imap_host") and doc.get("imap_username") and doc.get("imap_password"):
        return {
            "imap_host":      doc["imap_host"].strip(),
            "imap_port":      int(doc.get("imap_port") or 993),
            "imap_username":  doc["imap_username"].strip(),
            "imap_password":  doc["imap_password"],
            "smtp_host":      (doc.get("smtp_host") or doc["imap_host"]).strip(),
            "smtp_port":      int(doc.get("smtp_port") or 587),
            "smtp_username":  (doc.get("smtp_username") or doc["imap_username"]).strip(),
            "smtp_password":  doc.get("smtp_password") or doc["imap_password"],
            "mailbox_address": (doc.get("mailbox_address") or doc["imap_username"]).strip(),
        }
    return None


async def load_config_from_db(mailbox: str = "sales") -> None:
    """
    Load config for one mailbox from MongoDB, falling back to env vars for sales.
    Call at startup and after any settings save for the relevant mailbox.
    """
    settings_key = _SETTINGS_KEYS.get(mailbox, f"mailbox_config_{mailbox}")
    try:
        from database import col
        doc = await col("portal_settings").find_one({"_id": settings_key})
        if doc:
            provider = doc.get("provider", "imap")
            if provider == "graph":
                _configs[mailbox] = None
                addr = doc.get("graph_mailbox_address") or None
                _graph_addresses[mailbox] = addr
                # Feed DB credentials to graph_client so it uses them instead of env vars
                from services.graph_client import set_runtime_credentials
                if (doc.get("ms_tenant_id") and doc.get("ms_client_id")
                        and doc.get("ms_client_secret")):
                    set_runtime_credentials({
                        "tenant_id":       doc["ms_tenant_id"],
                        "client_id":       doc["ms_client_id"],
                        "client_secret":   doc["ms_client_secret"],
                        "mailbox_address": addr or "",
                    })
                else:
                    set_runtime_credentials(None)
                logger.info("graph_mailbox_loaded mailbox=%s address=%s",
                            mailbox, addr)
                return
            cfg = _parse_imap_doc(doc)
            if cfg:
                _configs[mailbox] = cfg
                _graph_addresses[mailbox] = None
                logger.info("imap_config_loaded_from_db mailbox=%s host=%s user=%s",
                            mailbox, cfg["imap_host"], cfg["imap_username"])
                return
    except Exception as exc:
        logger.warning("imap_config_db_load_failed mailbox=%s error=%s", mailbox, exc)

    # Env-var fallback for sales only
    if mailbox == "sales":
        cfg = _env_config()
        _configs[mailbox] = cfg
        _graph_addresses[mailbox] = None
        if cfg:
            logger.info("imap_config_loaded_from_env host=%s", cfg["imap_host"])
    else:
        _configs[mailbox] = None
        _graph_addresses[mailbox] = None


def get_config(mailbox: str = "sales") -> Optional[dict]:
    return _configs.get(mailbox)


def imap_configured(mailbox: str = "sales") -> bool:
    return _configs.get(mailbox) is not None


def get_graph_mailbox_address(mailbox: str = "sales") -> Optional[str]:
    """Return the Graph UPN for this mailbox, or None if not a Graph-configured mailbox."""
    addr = _graph_addresses.get(mailbox)
    if addr:
        return addr
    # Sales falls back to the env var shared mailbox address
    if mailbox == "sales":
        try:
            from config import get_settings
            return get_settings().ms_shared_mailbox or None
        except Exception:
            pass
    return None


# ── Header decode ─────────────────────────────────────────────────────────────

def _decode_header(value: str) -> str:
    parts = []
    for decoded, charset in email.header.decode_header(value or ""):
        if isinstance(decoded, bytes):
            parts.append(decoded.decode(charset or "utf-8", errors="replace"))
        else:
            parts.append(decoded or "")
    return "".join(parts)


# ── Body extraction ───────────────────────────────────────────────────────────

def _extract_body(msg) -> tuple:
    """Return (body_html, body_preview)."""
    body_html = ""
    body_text = ""
    if msg.is_multipart():
        for part in msg.walk():
            ct = part.get_content_type()
            cd = str(part.get("Content-Disposition", ""))
            if "attachment" in cd:
                continue
            payload = part.get_payload(decode=True)
            if not payload:
                continue
            charset = part.get_content_charset() or "utf-8"
            text = payload.decode(charset, errors="replace")
            if ct == "text/html" and not body_html:
                body_html = text
            elif ct == "text/plain" and not body_text:
                body_text = text
    else:
        ct = msg.get_content_type()
        payload = msg.get_payload(decode=True)
        if payload:
            charset = msg.get_content_charset() or "utf-8"
            text = payload.decode(charset, errors="replace")
            if ct == "text/html":
                body_html = text
            else:
                body_text = text
    if not body_html and body_text:
        body_html = f"<pre style='white-space:pre-wrap'>{html.escape(body_text)}</pre>"
    preview = re.sub(r"<[^>]+>", "", body_html or body_text)[:500].strip()
    return body_html, preview


# ── Sync IMAP helpers (run via asyncio.to_thread) ────────────────────────────

def _open_imap(cfg: dict) -> imaplib.IMAP4_SSL:
    return imaplib.IMAP4_SSL(cfg["imap_host"], cfg["imap_port"])


def _fetch_new_messages_sync(cfg: dict) -> list:
    conn = _open_imap(cfg)
    try:
        conn.login(cfg["imap_username"], cfg["imap_password"])
        conn.select("INBOX")
        # Search by date rather than SEEN flag. If a staff member opens an email
        # in their mail client before the 60 s poll fires, that message becomes
        # SEEN in the mailbox and an UNSEEN search would silently miss it.
        # Deduplication is handled by the unique imap_message_id index in MongoDB.
        since_date = (datetime.now(timezone.utc) - timedelta(hours=72)).strftime("%d-%b-%Y")
        _, data = conn.search(None, f"SINCE {since_date}")
        uid_list = data[0].split() if data[0] else []
        messages = []
        for uid_bytes in uid_list[-50:]:  # cap to 50 — avoids thundering-herd on first run
            uid = uid_bytes.decode()
            _, raw = conn.fetch(uid_bytes, "(RFC822)")
            if not raw or raw[0] is None:
                continue
            raw_bytes = raw[0][1] if isinstance(raw[0], tuple) else raw[0]
            if not isinstance(raw_bytes, bytes):
                continue
            msg = email_lib.message_from_bytes(raw_bytes)
            from_name, from_addr = email.utils.parseaddr(msg.get("From", ""))
            from_name = _decode_header(from_name) if from_name else from_addr
            subject    = _decode_header(msg.get("Subject", "(no subject)"))
            message_id = msg.get("Message-ID", "").strip()
            in_reply_to = msg.get("In-Reply-To", "").strip()
            references  = msg.get("References", "").strip()
            date_str    = msg.get("Date", "")
            try:
                received_at = email.utils.parsedate_to_datetime(date_str).astimezone(timezone.utc)
            except Exception:
                received_at = datetime.now(timezone.utc)
            body_html, preview = _extract_body(msg)
            attachments = []
            if msg.is_multipart():
                for part in msg.walk():
                    cd = str(part.get("Content-Disposition", ""))
                    if "attachment" not in cd:
                        continue
                    filename = _decode_header(part.get_filename() or "attachment")
                    payload  = part.get_payload(decode=True) or b""
                    attachments.append({
                        "name":         filename,
                        "content_type": part.get_content_type(),
                        "size_bytes":   len(payload),
                        # bytes stored temporarily — _ingest_imap_message persists
                        # them to sales_inbox_attachments and drops this key
                        "_content":     payload if len(payload) <= 15_000_000 else b"",
                    })
            messages.append({
                "imap_uid":     uid,
                "message_id":   message_id,
                "in_reply_to":  in_reply_to,
                "references":   references,
                "from_email":   from_addr.lower().strip(),
                "from_name":    from_name,
                "subject":      subject,
                "body_html":    body_html,
                "body_preview": preview,
                "received_at":  received_at,
                "has_attachments": bool(attachments),
                "attachments":  attachments,
            })
        return messages
    finally:
        try:
            conn.logout()
        except Exception:
            pass


def _mark_read_sync(cfg: dict, uid: str) -> None:
    conn = _open_imap(cfg)
    try:
        conn.login(cfg["imap_username"], cfg["imap_password"])
        conn.select("INBOX")
        conn.store(uid, "+FLAGS", "\\Seen")
    finally:
        try:
            conn.logout()
        except Exception:
            pass


def _send_smtp_sync(
    cfg: dict,
    to_email: str,
    subject: str,
    body_html: str,
    in_reply_to: str = "",
    references: str = "",
    file_attachments: Optional[list] = None,
) -> str:
    """Send via SMTP and return the generated Message-ID.

    file_attachments: list of {"filename": str, "content": bytes, "content_type": str}
    """
    domain = cfg["mailbox_address"].split("@")[-1] if "@" in cfg["mailbox_address"] else "bassanihealth.com"
    message_id = email.utils.make_msgid(domain=domain)

    if file_attachments:
        msg = MIMEMultipart("mixed")
        alt = MIMEMultipart("alternative")
        alt.attach(MIMEText(body_html, "html"))
        msg.attach(alt)
        for att in file_attachments:
            main_type, sub_type = att["content_type"].split("/", 1)
            part = MIMEBase(main_type, sub_type)
            part.set_payload(att["content"])
            email_encoders.encode_base64(part)
            part.add_header("Content-Disposition", "attachment", filename=att["filename"])
            msg.attach(part)
    else:
        msg = MIMEMultipart("alternative")
        msg.attach(MIMEText(body_html, "html"))

    msg["Message-ID"] = message_id
    msg["From"]       = email.utils.formataddr(("Bassani Health", cfg["mailbox_address"]))
    msg["To"]         = to_email
    msg["Subject"]    = subject
    if in_reply_to:
        msg["In-Reply-To"] = in_reply_to
    refs = references
    if in_reply_to and in_reply_to not in (references or ""):
        refs = f"{in_reply_to} {references}".strip()
    if refs:
        msg["References"] = refs

    smtp_host = cfg["smtp_host"]
    smtp_port = cfg["smtp_port"]
    smtp_user = cfg["smtp_username"]
    smtp_pass = cfg["smtp_password"]
    raw       = msg.as_string()

    if smtp_port == 465:
        # Implicit SSL — Xneelo and some other providers
        with smtplib.SMTP_SSL(smtp_host, smtp_port) as server:
            server.login(smtp_user, smtp_pass)
            server.sendmail(cfg["mailbox_address"], [to_email], raw)
    else:
        # STARTTLS — M365 (587), standard
        with smtplib.SMTP(smtp_host, smtp_port) as server:
            server.ehlo()
            server.starttls()
            server.login(smtp_user, smtp_pass)
            server.sendmail(cfg["mailbox_address"], [to_email], raw)

    return message_id


def _test_connection_sync(cfg: dict) -> None:
    """Attempt IMAP login and logout. Raises on failure."""
    conn = _open_imap(cfg)
    try:
        conn.login(cfg["imap_username"], cfg["imap_password"])
        conn.select("INBOX")
    finally:
        try:
            conn.logout()
        except Exception:
            pass


# ── Public async API ──────────────────────────────────────────────────────────

async def fetch_new_messages(mailbox: str = "sales") -> list:
    cfg = get_config(mailbox)
    if not cfg:
        return []
    return await asyncio.to_thread(_fetch_new_messages_sync, cfg)


async def mark_as_read(uid: str, mailbox: str = "sales") -> None:
    cfg = get_config(mailbox)
    if not cfg:
        return
    await asyncio.to_thread(_mark_read_sync, cfg, uid)


async def send_reply(
    to_email: str,
    subject: str,
    body_html: str,
    in_reply_to: str = "",
    references: str = "",
    mailbox: str = "sales",
) -> str:
    """Send reply and return the generated Message-ID for thread tracking."""
    cfg = get_config(mailbox)
    if not cfg:
        raise RuntimeError(f"IMAP/SMTP not configured for mailbox '{mailbox}'")
    return await asyncio.to_thread(_send_smtp_sync, cfg, to_email, subject, body_html, in_reply_to, references)


async def send_new_email(
    to_email: str,
    subject: str,
    body_html: str,
    file_attachments: Optional[list] = None,
    mailbox: str = "sales",
) -> str:
    """Send a fresh outgoing email (not a reply) and return the Message-ID."""
    cfg = get_config(mailbox)
    if not cfg:
        raise RuntimeError(f"IMAP/SMTP not configured for mailbox '{mailbox}'")
    return await asyncio.to_thread(
        _send_smtp_sync, cfg, to_email, subject, body_html, "", "", file_attachments
    )


async def test_connection(cfg: dict) -> None:
    """Test IMAP credentials without touching the module-level config."""
    await asyncio.to_thread(_test_connection_sync, cfg)
