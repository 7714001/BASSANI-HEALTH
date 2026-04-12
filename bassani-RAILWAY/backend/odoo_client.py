"""
Odoo XML-RPC client — optimised for Odoo.sh / SaaS instances.

Bassani Health live instance:
  URL:  https://multisaas-odoo-bassani-health.odoo.com
  DB:   multisaas_odoo_bassani_health_production_26851697
  User: support@multisaas.co.za

Connection is authenticated once at startup and the UID is cached.
Thread-safe — Motor/asyncio safe because xmlrpc.client is synchronous
but calls are short and non-blocking in practice.
"""
import xmlrpc.client
import threading
from functools import lru_cache
from config import get_settings

settings = get_settings()

# ── Singletons ────────────────────────────────────────────────────────────────
_lock   = threading.Lock()
_uid    = None
_common = None
_models = None


def _connect():
    """Establish connection and authenticate. Called once."""
    global _uid, _common, _models
    url = settings.odoo_url.rstrip("/")
    _common = xmlrpc.client.ServerProxy(
        f"{url}/xmlrpc/2/common",
        allow_none=True,
        context=_ssl_context(),
    )
    _models = xmlrpc.client.ServerProxy(
        f"{url}/xmlrpc/2/object",
        allow_none=True,
        context=_ssl_context(),
    )
    _uid = _common.authenticate(
        settings.odoo_db,
        settings.odoo_username,
        settings.odoo_password,
        {},
    )
    if not _uid:
        raise RuntimeError(
            "Odoo authentication failed — check ODOO_USERNAME and ODOO_PASSWORD in .env"
        )
    print(f"✅ Odoo connected — UID {_uid} @ {url}")


def _ssl_context():
    """Return an SSL context that works with Odoo.sh certificates."""
    import ssl
    ctx = ssl.create_default_context()
    ctx.check_hostname = True
    ctx.verify_mode    = ssl.CERT_REQUIRED
    return ctx


def odoo(model: str, method: str, args=None, kwargs=None):
    """
    Execute an Odoo RPC call.

    Usage:
        partners = odoo("res.partner", "search_read",
            [[["customer_rank", ">", 0]]],
            {"fields": ["name","email"], "limit": 50}
        )
    """
    global _uid, _models
    with _lock:
        if _uid is None:
            _connect()
    try:
        return _models.execute_kw(
            settings.odoo_db,
            _uid,
            settings.odoo_password,
            model,
            method,
            args  or [],
            kwargs or {},
        )
    except xmlrpc.client.Fault as e:
        raise RuntimeError(f"Odoo RPC fault [{model}.{method}]: {e.faultString}") from e
    except Exception as e:
        # Connection dropped — re-authenticate and retry once
        print(f"⚠️  Odoo connection error, retrying: {e}")
        with _lock:
            _uid = None
        _connect()
        return _models.execute_kw(
            settings.odoo_db,
            _uid,
            settings.odoo_password,
            model,
            method,
            args  or [],
            kwargs or {},
        )


def odoo_create(model: str, vals: dict) -> int:
    """Shorthand for create — returns new record ID."""
    return odoo(model, "create", [vals])


def odoo_write(model: str, ids: list, vals: dict) -> bool:
    return odoo(model, "write", [ids, vals])


def odoo_search(model: str, domain: list, limit: int = 100) -> list:
    return odoo(model, "search", [domain], {"limit": limit})


def odoo_read(model: str, ids: list, fields: list) -> list:
    return odoo(model, "read", [ids], {"fields": fields})


def odoo_search_read(model: str, domain: list, fields: list, limit: int = 100, order: str = "") -> list:
    kwargs = {"fields": fields, "limit": limit}
    if order:
        kwargs["order"] = order
    return odoo(model, "search_read", [domain], kwargs)


def odoo_count(model: str, domain: list) -> int:
    return odoo(model, "search_count", [domain])


# ── Bassani-specific helpers ──────────────────────────────────────────────────

def get_stock_location_id(name: str = "WH/Stock") -> int:
    """Return the internal location ID by name — cached."""
    locs = odoo_search_read(
        "stock.location",
        [["complete_name", "ilike", name], ["usage", "=", "internal"]],
        ["id", "complete_name"],
        limit=1,
    )
    return locs[0]["id"] if locs else 8   # fallback to Odoo default


def get_journal_id(journal_type: str = "bank") -> int:
    """Return the first journal of the given type."""
    journals = odoo_search_read(
        "account.journal",
        [["type", "=", journal_type]],
        ["id", "name"],
        limit=1,
    )
    return journals[0]["id"] if journals else 1


def get_pricelist_id() -> int:
    """Return the default ZAR pricelist."""
    pl = odoo_search_read(
        "product.pricelist",
        [["currency_id.name", "=", "ZAR"]],
        ["id", "name"],
        limit=1,
    )
    return pl[0]["id"] if pl else 1


def get_payment_term_id(name: str = "Net 30") -> int:
    """Return a payment term ID by name."""
    terms = odoo_search_read(
        "account.payment.term",
        [["name", "ilike", name]],
        ["id", "name"],
        limit=1,
    )
    return terms[0]["id"] if terms else False


def health_check() -> dict:
    """Quick liveness check — returns Odoo server info."""
    try:
        url = settings.odoo_url.rstrip("/")
        common = xmlrpc.client.ServerProxy(f"{url}/xmlrpc/2/common", allow_none=True)
        v = common.version()
        return {
            "status":  "ok",
            "version": v.get("server_version", "unknown"),
            "uid":     _uid,
        }
    except Exception as e:
        return {"status": "error", "message": str(e)}
