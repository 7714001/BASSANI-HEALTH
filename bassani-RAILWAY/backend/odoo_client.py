import xmlrpc.client
import threading
import logging
import time
import httpx
from config import get_settings

settings = get_settings()
logger = logging.getLogger(__name__)

_lock = threading.Lock()
_uid = None
_models = None

def _connect():
    global _uid, _models
    url = settings.odoo_url.rstrip("/")
    common = xmlrpc.client.ServerProxy(f"{url}/xmlrpc/2/common", allow_none=True)
    _models = xmlrpc.client.ServerProxy(f"{url}/xmlrpc/2/object", allow_none=True)
    _uid = common.authenticate(settings.odoo_db, settings.odoo_username, settings.odoo_password, {})
    if not _uid:
        raise RuntimeError("Odoo authentication failed")
    logger.info("odoo_connected", extra={"uid": _uid})

def odoo(model, method, args=None, kwargs=None):
    global _uid, _models
    start = time.monotonic()
    with _lock:
        if _uid is None:
            _connect()
        try:
            result = _models.execute_kw(settings.odoo_db, _uid, settings.odoo_password, model, method, args or [], kwargs or {})
        except xmlrpc.client.Fault:
            # Odoo returned a structured error response (including response-serialisation
            # faults). Do NOT retry — the call reached Odoo and may have already written
            # data. Retrying a write would create duplicate records.
            raise
        except Exception:
            # Connection / socket failure — safe to reconnect and retry.
            _uid = None
            _connect()
            result = _models.execute_kw(settings.odoo_db, _uid, settings.odoo_password, model, method, args or [], kwargs or {})
    duration_ms = round((time.monotonic() - start) * 1000)
    logger.info("odoo_call", extra={"model": model, "method": method, "duration_ms": duration_ms})
    return result

def odoo_execute_kw(model, method, args=None, kwargs=None):
    return odoo(model, method, args, kwargs)

def odoo_search_read(model, domain=None, fields=None, limit=100, offset=0, order=""):
    kwargs = {"fields": fields or [], "limit": limit, "offset": offset}
    if order:
        kwargs["order"] = order
    return odoo(model, "search_read", [domain or []], kwargs)

def odoo_create(model, vals):
    return odoo(model, "create", [vals])

def odoo_write(model, ids, vals):
    return odoo(model, "write", [ids, vals])

def odoo_search_count(model, domain=None):
    return odoo(model, "search_count", [domain or []])

def odoo_search(model, domain=None, limit=100):
    return odoo(model, "search", [domain or []], {"limit": limit})

def odoo_read(model, ids, fields=None):
    return odoo(model, "read", [ids], {"fields": fields or []})

class OdooClient:
    def search_read(self, model, domain=None, fields=None, limit=100, offset=0, order="", context=None):
        kwargs = {"fields": fields or [], "limit": limit, "offset": offset}
        if order:
            kwargs["order"] = order
        if context:
            kwargs["context"] = context
        return odoo(model, "search_read", [domain or []], kwargs)

    def read(self, model, ids, fields=None, context=None):
        kwargs = {"fields": fields or []}
        if context:
            kwargs["context"] = context
        return odoo(model, "read", [ids], kwargs)

    def search(self, model, domain=None, limit=100, context=None):
        kwargs = {"limit": limit}
        if context:
            kwargs["context"] = context
        return odoo(model, "search", [domain or []], kwargs)

    def count(self, model, domain=None, context=None):
        kwargs = {"context": context} if context else {}
        return odoo(model, "search_count", [domain or []], kwargs)

    def create(self, model, vals, context=None):
        if context:
            return odoo(model, "create", [vals], {"context": context})
        return odoo(model, "create", [vals])

    def write(self, model, ids, vals):
        return odoo(model, "write", [ids, vals])

    def unlink(self, model, ids):
        return odoo(model, "unlink", [ids])

    def execute(self, model, method, *args):
        return odoo(model, method, list(args))

_client = OdooClient()

def get_odoo_client() -> OdooClient:
    return _client


def fetch_odoo_report_pdf(report_name: str, record_id: int) -> bytes:
    """Fetch an Odoo report PDF via HTTP session auth.

    render_qweb_pdf is private in Odoo v17 and not callable via XML-RPC.
    Authenticates via the JSON-RPC web session endpoint, extracts session_id
    from the response body (more reliable than relying on httpx cookie carry),
    and GETs the report controller URL with the session_id cookie set explicitly.
    """
    cfg = get_settings()
    base = cfg.odoo_url.rstrip("/")
    with httpx.Client(timeout=60, follow_redirects=True) as client:
        auth_resp = client.post(
            f"{base}/web/session/authenticate",
            json={"jsonrpc": "2.0", "method": "call", "params": {
                "db": cfg.odoo_db,
                "login": cfg.odoo_username,
                "password": cfg.odoo_password,
            }},
        )
        auth_resp.raise_for_status()
        auth_data = auth_resp.json()
        result = auth_data.get("result") or {}
        uid = result.get("uid")
        if not uid:
            raise RuntimeError(
                f"Odoo web session authentication failed — check ODOO_USERNAME/ODOO_PASSWORD. "
                f"Error: {auth_data.get('error', 'no uid returned')}"
            )
        # Extract session_id from body; fall back to Set-Cookie if absent
        session_id = result.get("session_id") or auth_resp.cookies.get("session_id")
        if not session_id:
            raise RuntimeError("Odoo did not return a session_id after authentication")

        pdf_resp = client.get(
            f"{base}/report/pdf/{report_name}/{record_id}",
            cookies={"session_id": session_id},
        )
        pdf_resp.raise_for_status()
        content_type = pdf_resp.headers.get("content-type", "")
        if not content_type.startswith("application/pdf"):
            raise RuntimeError(
                f"Odoo returned {content_type!r} for report '{report_name}' — "
                f"check the report name is correct for this Odoo instance"
            )
        return pdf_resp.content
