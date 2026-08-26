"""
Shared age/priority-tier logic (2026-08-26).

Originally lived only inside monitor_routes.py, feeding the public Operations
Monitor TV board. Extracted here so the admin-facing Sales Tickets and Orders
Tickets screens (list + detail) and Order Passport's Order Age KPI tile can
show the exact same overdue/at-risk signal a viewer already sees on the
monitor, rather than a second, differently-tuned one — these numbers must
never be able to disagree about what counts as overdue.

Deadlines and thresholds are unchanged from their original monitor_routes.py
values: a confirmed order gets 72h, an unconfirmed quote gets a softer 48h;
a tier is "ok" under 33% of the deadline elapsed, "warning" 33-66%, "urgent"
66-100%, "overdue" at or past 100%.
"""
from datetime import datetime, timezone

OVERDUE_HOURS = 72
QUOTE_HOURS   = 48   # softer deadline for unconfirmed quotes


def utc(dt: datetime) -> datetime:
    if dt is None:
        return datetime.now(timezone.utc)
    return dt if dt.tzinfo else dt.replace(tzinfo=timezone.utc)


def hours_elapsed(since: datetime) -> float:
    return (datetime.now(timezone.utc) - utc(since)).total_seconds() / 3600


def age_tier(elapsed: float, deadline: float) -> str:
    pct = elapsed / deadline
    if pct >= 1.0:   return "overdue"
    if pct >= 0.66:  return "urgent"
    if pct >= 0.33:  return "warning"
    return "ok"


# Deadlines a Sales ticket's own status is judged against, on the ticket's
# own created_at clock — identical to monitor_routes.py's
# _QUOTE_STATUS_DEADLINE. Deliberately does not cover confirmed_wip/
# ready_for_collection/incomplete: once an order has a packing board entry,
# THAT entry's own queued_at clock is the authoritative "how long has this
# actually been waiting" signal, not the ticket's original created_at.
TICKET_AGE_DEADLINE = {
    "open": QUOTE_HOURS, "quote": QUOTE_HOURS,
    "sale_order": OVERDUE_HOURS, "awaiting_deposit": OVERDUE_HOURS,
}

# Packing-board statuses with no meaningful "still waiting" signal left —
# collected/incomplete/cancelled/cleared are all done, one way or another.
NO_BOARD_AGE_STATUSES = {"collected", "incomplete", "cancelled", "cleared"}


def board_entry_age_fields(entry: dict) -> dict:
    """Same clock/deadline choice as monitor_routes.py's _board_card /
    _board_ready_card: "complete" (ready for collection) clocks off
    completed_at, everything else off queued_at. Returns {} (no age fields)
    for a terminal status with nothing left to be urgent about."""
    if not entry or entry.get("status") in NO_BOARD_AGE_STATUSES:
        return {"age_tier": None}
    clock = entry.get("completed_at") if entry.get("status") == "complete" else entry.get("queued_at")
    return age_fields(clock or entry.get("queued_at"), OVERDUE_HOURS)


def ticket_age_fields(ticket: dict) -> dict:
    """Age fields for a Sales ticket not yet on the packing board. Returns
    {"age_tier": None} for a status/exit_status this deadline map doesn't
    cover (see TICKET_AGE_DEADLINE's own comment)."""
    deadline = TICKET_AGE_DEADLINE.get((ticket or {}).get("status"))
    if not deadline or (ticket or {}).get("exit_status"):
        return {"age_tier": None}
    return age_fields(ticket.get("created_at"), deadline)


def age_fields(since: datetime, deadline: float = OVERDUE_HOURS) -> dict:
    """The three fields every consumer attaches to a card/row: how long it's
    been waiting, what the deadline is, and the derived tier. `since=None`
    is treated as "now" (0 elapsed, tier "ok"), matching the monitor's own
    fallback for a record with no clock-start timestamp yet."""
    elapsed = hours_elapsed(since)
    return {
        "hours_elapsed":  round(elapsed, 2),
        "deadline_hours": deadline,
        "age_tier":       age_tier(elapsed, deadline),
    }
