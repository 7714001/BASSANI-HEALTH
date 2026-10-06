"""
Signed access links for customers WITHOUT a portal login (Phase 28).

Most Bassani customers have no portal account and only ever deal with us by
email. They still need to be able to raise a query or complaint against a
specific order and follow up on it, so two kinds of link are embedded in the
emails they already receive:

  - an ORDER link (/help/order/<token>) — scoped to one sale order: raise a
    new request about it, see the requests already raised on it, leave
    feedback once it's collected. Embedded in the pro-forma, invoice, ready-
    for-collection and post-collection feedback emails.
  - a CASE link (/help/case/<token>) — scoped to one support case: read the
    (non-internal) thread, reply, reopen, rate the outcome. Embedded in every
    support email sent to the customer.

Stateless signed JWTs rather than stored tokens, so any email template can
build a link synchronously with nothing to persist. Deliberately unusable as a
login token: they carry an `aud` claim (get_current_user decodes without an
audience, which PyJWT rejects for an aud-bearing token) and no `sub`.
Root-level module (same precedent as ownership.py/contacts.py) so both
email_service.py and the route files can import it without a cycle.
"""
from datetime import datetime, timedelta, timezone
from typing import Optional

import jwt

from config import get_settings

settings = get_settings()

_AUDIENCE = "bassani-support-link"
ORDER_LINK_DAYS = 180
CASE_LINK_DAYS = 180


def _sign(claims: dict, days: int) -> str:
    now = datetime.now(timezone.utc)
    payload = {**claims, "aud": _AUDIENCE, "iat": now, "exp": now + timedelta(days=days)}
    return jwt.encode(payload, settings.jwt_secret, algorithm=settings.jwt_algorithm)


def _verify(token: str, purpose: str) -> Optional[dict]:
    try:
        payload = jwt.decode(
            token, settings.jwt_secret, algorithms=[settings.jwt_algorithm], audience=_AUDIENCE,
        )
    except jwt.InvalidTokenError:
        return None
    return payload if payload.get("p") == purpose else None


def make_order_token(order_id: int) -> str:
    return _sign({"p": "order", "oid": int(order_id)}, ORDER_LINK_DAYS)


def make_case_token(case_id: str) -> str:
    return _sign({"p": "case", "cid": str(case_id)}, CASE_LINK_DAYS)


def verify_order_token(token: str) -> Optional[int]:
    payload = _verify(token, "order")
    return int(payload["oid"]) if payload else None


def verify_case_token(token: str) -> Optional[str]:
    payload = _verify(token, "case")
    return payload["cid"] if payload else None


def order_help_url(order_id) -> Optional[str]:
    """Public order help link, or None if order_id isn't a real Odoo id —
    callers pass it straight into an email template, which simply omits the
    help line when this is None."""
    try:
        return f"{settings.portal_url}/help/order/{make_order_token(int(order_id))}"
    except (TypeError, ValueError):
        return None


def case_help_url(case_id: str) -> str:
    return f"{settings.portal_url}/help/case/{make_case_token(case_id)}"
