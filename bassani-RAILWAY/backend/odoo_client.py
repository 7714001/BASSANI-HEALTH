import xmlrpc.client
import threading
from config import get_settings

settings = get_settings()

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
    print(f"Odoo connected — UID {_uid}")

def odoo(model, method, args=None, kwargs=None):
    global _uid, _models
    with _lock:
        if _uid is None:
            _connect()
    try:
        return _models.execute_kw(settings.odoo_db, _uid, settings.odoo_password, model, method, args or [], kwargs or {})
    except Exception:
        with _lock:
            _uid = None
        _connect()
        return _models.execute_kw(settings.odoo_db, _uid, settings.odoo_password, model, method, args or [], kwargs or {})

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
    def search_read(self, model, domain=None, fields=None, limit=100, offset=0, order=""):
        kwargs = {"fields": fields or [], "limit": limit, "offset": offset}
        if order:
            kwargs["order"] = order
        return odoo(model, "search_read", [domain or []], kwargs)

    def read(self, model, ids, fields=None):
        return odoo(model, "read", [ids], {"fields": fields or []})

    def search(self, model, domain=None, limit=100):
        return odoo(model, "search", [domain or []], {"limit": limit})

    def count(self, model, domain=None):
        return odoo(model, "search_count", [domain or []])

    def create(self, model, vals):
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
