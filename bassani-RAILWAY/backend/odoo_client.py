import xmlrpc.client
import threading
import logging
import time
import json
import urllib.parse
import httpx
from config import get_settings

settings = get_settings()
logger = logging.getLogger(__name__)

_lock = threading.Lock()
_uid = None
_models = None

# ── Report PDF fetch (session-based HTTP, not XML-RPC) ────────────────────
# Odoo's XML-RPC dispatcher rejects calls to "private" (underscore-prefixed)
# methods — e.g. ir.actions.report._render_qweb_pdf — with "Private methods
# ... cannot be called remotely" (hit live 2026-08-14). This was never
# officially supported; it only ever worked because older Odoo XML-RPC
# didn't enforce the public/private boundary. There is no public XML-RPC
# equivalent for fetching a rendered report's PDF bytes — Odoo's own web
# client fetches reports via a plain authenticated HTTP GET on
# /report/pdf/<report>/<ids>, which is what this replicates. Kept as a
# separate session (cookie-based, JSON-RPC login) from the XML-RPC uid used
# everywhere else in this module.
_report_session_id = None
_report_allowed_company_ids = None

def _report_web_authenticate() -> tuple:
    """Log in via Odoo's web session endpoint and return (session_id,
    allowed_company_ids). A fresh session's default company context is just
    the user's single primary company — on this multi-company instance,
    fetching a report for a record in any other company 403s ("doesn't have
    'read' access ... multi-company issue") unless every allowed company is
    explicitly passed back in on each request (see fetch_report_pdf). This is
    unrelated to the XML-RPC uid's own access rights, which are already
    correctly multi-company scoped for every other call in this module."""
    url = settings.odoo_url.rstrip("/")
    resp = httpx.post(
        f"{url}/web/session/authenticate",
        json={
            "jsonrpc": "2.0", "method": "call",
            "params": {"db": settings.odoo_db, "login": settings.odoo_username, "password": settings.odoo_password},
        },
        timeout=30,
    )
    resp.raise_for_status()
    body = resp.json()
    session_id = resp.cookies.get("session_id")
    if body.get("error") or not session_id:
        raise RuntimeError(f"Odoo web session authentication failed: {body.get('error')}")
    allowed_ids = [int(cid) for cid in (body.get("result") or {}).get("user_companies", {}).get("allowed_companies", {})]
    return session_id, allowed_ids

def fetch_report_pdf(report_name: str, res_ids: list) -> bytes:
    """Fetch a QWeb report as PDF bytes via Odoo's report controller.
    report_name is the report's technical name (ir.actions.report.report_name,
    e.g. 'sale.report_saleorder_pro_forma') — verify it directly against
    ir.actions.report if unsure, these have drifted before (2026-08-14: the
    pro-forma invoice report's name changed from the previously-documented
    'sale.report_saleorder_pro_forma_invoice' to 'sale.report_saleorder_pro_forma')."""
    global _report_session_id, _report_allowed_company_ids
    url = settings.odoo_url.rstrip("/")
    ids_str = ",".join(str(i) for i in res_ids)
    ctx = urllib.parse.quote(json.dumps({"allowed_company_ids": _report_allowed_company_ids or []}))
    report_url = f"{url}/report/pdf/{report_name}/{ids_str}?context={ctx}"

    def _fetch():
        return httpx.get(report_url, cookies={"session_id": _report_session_id}, timeout=60, follow_redirects=True)

    with _lock:
        if _report_session_id is None:
            _report_session_id, _report_allowed_company_ids = _report_web_authenticate()
        resp = _fetch()
        if "pdf" not in resp.headers.get("content-type", "").lower():
            # Session likely expired, or was never valid for this request —
            # re-authenticate once and retry before giving up.
            _report_session_id, _report_allowed_company_ids = _report_web_authenticate()
            resp = _fetch()

    if "pdf" not in resp.headers.get("content-type", "").lower():
        raise RuntimeError(
            f"Odoo did not return a PDF report (status {resp.status_code}, "
            f"content-type {resp.headers.get('content-type')})"
        )
    return resp.content

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

    def message_post(self, model, res_id, body, internal_only=True):
        """Log a chatter entry on a record. `execute()` above can't do this —
        its (*args)-only signature has no way to send the kwargs mail.thread's
        message_post() requires (body is keyword-only on this Odoo version).
        internal_only posts as a plain log note (subtype_xmlid='mail.mt_note'),
        the same as clicking "Log note" in Odoo's UI — it will not re-notify
        the record's followers by email, only the quote/invoice send itself
        does that. Best-effort by design; callers should never let a failure
        here affect the actual send."""
        kwargs = {"body": body}
        if internal_only:
            kwargs["subtype_xmlid"] = "mail.mt_note"
        return odoo(model, "message_post", [res_id], kwargs)

_client = OdooClient()

def get_odoo_client() -> OdooClient:
    return _client
