"""Credit limit checks against Odoo's res.partner `credit`/`credit_limit` fields.

Single source of truth for "is this customer over their limit" — used by the
customer list/profile (credit_hold display) and by order creation/confirmation
(warn early, block at confirm unless an admin overrides).
"""
from typing import Optional


def credit_status(credit: float, credit_limit: float, additional: float = 0.0) -> dict:
    """
    `additional` lets a caller check "would this push them over" using an
    amount not yet reflected in Odoo's `credit` total — e.g. a draft order
    that hasn't been invoiced yet.

    A `credit_limit` of 0 means no limit is configured in Odoo — never over.
    """
    over_limit = bool(credit_limit) and (credit + additional) > credit_limit
    return {
        "credit": credit,
        "credit_limit": credit_limit,
        "over_limit": over_limit,
        "shortfall": round((credit + additional) - credit_limit, 2) if over_limit else 0,
    }
