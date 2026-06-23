"""
Bassani Health — Transactional Email Service

All emails use Resend. If RESEND_API_KEY is not set or is a placeholder,
sends are logged to stdout and skipped (graceful degradation — no crash,
no blocked response).

All public functions are synchronous and intended to be called via
FastAPI's BackgroundTasks so they never block an API response:

    background_tasks.add_task(send_welcome_email, username=..., ...)
"""

import resend
from config import get_settings

settings = get_settings()

# ── Base send ──────────────────────────────────────────────────────────────────

def _send(to: "str | list[str]", subject: str, html: str, reply_to: str = None) -> None:
    """Core send. Sync — always called from a BackgroundTask thread."""
    key = settings.resend_api_key
    if not key or key.startswith("re_your"):
        recipients = to if isinstance(to, str) else ", ".join(to)
        print(f"📧 [email skipped — no API key] → {recipients} | {subject}")
        return
    try:
        resend.api_key = key
        payload = {
            "from": f"Bassani Health <{settings.sender_email}>",
            "to":   to if isinstance(to, list) else [to],
            "subject": subject,
            "html": html,
        }
        if reply_to:
            payload["reply_to"] = reply_to
        resend.Emails.send(payload)
    except Exception as exc:
        print(f"⚠️  Email send failed [{subject}]: {exc}")


# ── HTML primitives ────────────────────────────────────────────────────────────

def _wrap(subtitle: str, body_html: str) -> str:
    """Branded email shell. Table-based for cross-client compatibility."""
    return f"""<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width,initial-scale=1.0">
  <meta http-equiv="X-UA-Compatible" content="IE=edge">
</head>
<body style="margin:0;padding:0;background:#f1f5f9;font-family:Arial,Helvetica,sans-serif;-webkit-font-smoothing:antialiased;">
  <table width="100%" cellpadding="0" cellspacing="0" border="0" style="background:#f1f5f9;">
    <tr><td align="center" style="padding:40px 16px 48px;">

      <!-- Card -->
      <table width="600" cellpadding="0" cellspacing="0" border="0"
             style="max-width:600px;width:100%;background:#ffffff;border-radius:12px;
                    box-shadow:0 1px 4px rgba(0,0,0,0.08);">

        <!-- Header -->
        <tr>
          <td style="background:#0f6e56;padding:26px 36px;border-radius:12px 12px 0 0;">
            <table width="100%" cellpadding="0" cellspacing="0" border="0">
              <tr>
                <td>
                  <p style="margin:0;color:#ffffff;font-size:17px;font-weight:700;
                             letter-spacing:-0.2px;line-height:1;">Bassani Health</p>
                  <p style="margin:5px 0 0;color:rgba(255,255,255,0.6);font-size:11px;
                             letter-spacing:0.8px;text-transform:uppercase;">{subtitle}</p>
                </td>
                <td align="right" style="vertical-align:middle;">
                  <table cellpadding="0" cellspacing="0" border="0">
                    <tr>
                      <td style="width:36px;height:36px;background:rgba(255,255,255,0.12);
                                  border-radius:8px;text-align:center;vertical-align:middle;">
                        <span style="color:#ffffff;font-size:18px;line-height:36px;">&#9679;</span>
                      </td>
                    </tr>
                  </table>
                </td>
              </tr>
            </table>
          </td>
        </tr>

        <!-- Body -->
        <tr>
          <td style="padding:36px 36px 28px;">
            {body_html}
          </td>
        </tr>

        <!-- Footer -->
        <tr>
          <td style="background:#f8fafc;border-top:1px solid #e2e8f0;
                     padding:18px 36px;border-radius:0 0 12px 12px;">
            <p style="margin:0;font-size:11px;color:#94a3b8;line-height:1.6;">
              Bassani Health &nbsp;&middot;&nbsp; 15 Innovation Drive, Midrand, 1685
              &nbsp;&middot;&nbsp; VAT: {settings.vat_number}
            </p>
            <p style="margin:5px 0 0;font-size:11px;color:#cbd5e1;line-height:1.6;">
              This is an automated message from the Bassani Health operations portal.
              Please do not reply to this email.
            </p>
          </td>
        </tr>

      </table>
    </td></tr>
  </table>
</body>
</html>"""


def _h1(text: str) -> str:
    return (f'<h1 style="margin:0 0 10px;font-size:22px;font-weight:700;'
            f'color:#0f172a;line-height:1.25;letter-spacing:-0.4px;">{text}</h1>')


def _p(text: str, *, muted: bool = False, margin_bottom: str = "16px") -> str:
    color = "#94a3b8" if muted else "#475569"
    return (f'<p style="margin:0 0 {margin_bottom};font-size:14px;'
            f'color:{color};line-height:1.65;">{text}</p>')


def _info_box(rows: list, *, tint: str = "#f0fdf9", border: str = "#bbf7d0") -> str:
    """Key-value summary block inside a tinted card."""
    cells = "".join(
        f'<tr>'
        f'<td style="padding:7px 0;font-size:13px;color:#64748b;'
        f'width:42%;vertical-align:top;border-bottom:1px solid {border}30;">{k}</td>'
        f'<td style="padding:7px 0 7px 12px;font-size:13px;color:#0f172a;'
        f'font-weight:600;vertical-align:top;border-bottom:1px solid {border}30;">{v}</td>'
        f'</tr>'
        for k, v in rows
    )
    return (
        f'<table width="100%" cellpadding="0" cellspacing="0" border="0" '
        f'style="background:{tint};border:1px solid {border};border-radius:8px;'
        f'margin:20px 0;padding:4px 20px;">'
        f'<tr><td><table width="100%" cellpadding="0" cellspacing="0" border="0">'
        f'{cells}</table></td></tr></table>'
    )


def _button(label: str, url: str) -> str:
    return (
        f'<table cellpadding="0" cellspacing="0" border="0" style="margin:26px 0 10px;">'
        f'<tr><td style="background:#0f6e56;border-radius:8px;">'
        f'<a href="{url}" style="display:inline-block;padding:13px 26px;color:#ffffff;'
        f'font-size:14px;font-weight:600;text-decoration:none;letter-spacing:0.1px;">'
        f'{label} &rarr;</a></td></tr></table>'
    )


def _divider() -> str:
    return ('<table width="100%" cellpadding="0" cellspacing="0" border="0" '
            'style="margin:22px 0;"><tr>'
            '<td style="border-top:1px solid #e2e8f0;font-size:0;line-height:0;">'
            '&nbsp;</td></tr></table>')


def _badge(label: str, color: str = "#0f6e56") -> str:
    return (f'<span style="display:inline-block;background:{color}18;'
            f'border:1px solid {color}50;color:{color};font-size:11px;'
            f'font-weight:700;padding:3px 10px;border-radius:20px;'
            f'letter-spacing:0.4px;text-transform:uppercase;">{label}</span>')


def _mono(text: str) -> str:
    return (f'<code style="font-family:\'Courier New\',monospace;background:#f1f5f9;'
            f'color:#0f172a;padding:2px 7px;border-radius:4px;font-size:13px;">{text}</code>')


# ── Account emails ─────────────────────────────────────────────────────────────

def send_welcome_email(username: str, name: str, email: str) -> None:
    """Sent when an admin creates a new portal account."""
    if not email:
        return
    url = settings.portal_url
    body = (
        _h1("Welcome to Bassani Health")
        + _p(f"Hi {name or username},")
        + _p("Your account on the Bassani Health operations portal has been created. "
             "Use the credentials below to sign in — you will be asked to set a new "
             "password before you can access the portal.")
        + _info_box([
            ("Username", _mono(username)),
            ("Temporary password", "Provided to you separately by your administrator"),
            ("Portal", f'<a href="{url}" style="color:#0f6e56;text-decoration:none;">{url}</a>'),
        ])
        + _button("Sign in to the portal", url)
        + _divider()
        + _p("Keep your password private and do not share it. "
             f'If you need help, contact <a href="mailto:{settings.support_email}" '
             f'style="color:#0f6e56;">{settings.support_email}</a>.', muted=True)
    )
    _send(email, "Your Bassani Health portal account is ready",
          _wrap("Account created", body))


# ── Order emails ───────────────────────────────────────────────────────────────

def send_order_placed(
    order_ref: str,
    customer_name: str,
    order_total: float,
    reseller_name: str,
    reseller_email: str,
) -> None:
    """Sent to the reseller when their portal order is submitted."""
    if not reseller_email:
        return
    body = (
        _h1("Order received")
        + _p(f"Hi {reseller_name},")
        + _p("Your order has been submitted and is now with the Bassani Health team for review.")
        + _info_box([
            ("Order reference", f"<strong>{order_ref}</strong>"),
            ("Customer", customer_name),
            ("Order total", f"R{order_total:,.2f}"),
            ("Status", _badge("Awaiting confirmation")),
        ])
        + _button("View order", f"{settings.portal_url}/orders")
        + _divider()
        + _p("You will receive a follow-up notification once the order has been confirmed "
             "and is in the fulfilment queue.", muted=True)
    )
    _send(reseller_email, f"Order received — {order_ref}",
          _wrap("Order submitted", body))


def send_order_confirmed(
    order_ref: str,
    customer_name: str,
    order_total: float,
    reseller_name: str,
    reseller_email: str,
) -> None:
    """Sent to the reseller when a quotation is confirmed."""
    if not reseller_email:
        return
    body = (
        _h1("Order confirmed")
        + _p(f"Hi {reseller_name},")
        + _p("Your order has been confirmed and has entered the fulfilment pipeline.")
        + _info_box([
            ("Order reference", f"<strong>{order_ref}</strong>"),
            ("Customer", customer_name),
            ("Order total", f"R{order_total:,.2f}"),
            ("Status", _badge("Confirmed", "#059669")),
        ], tint="#f0fdf4", border="#86efac")
        + _button("Track your order", f"{settings.portal_url}/orders")
        + _divider()
        + _p("You will be notified once the order is ready for collection.", muted=True)
    )
    _send(reseller_email, f"Order confirmed — {order_ref}",
          _wrap("Order confirmed", body))


def send_order_cancelled(
    order_ref: str,
    customer_name: str,
    reseller_name: str,
    reseller_email: str,
) -> None:
    """Sent to the reseller when an order is cancelled."""
    if not reseller_email:
        return
    body = (
        _h1("Order cancelled")
        + _p(f"Hi {reseller_name},")
        + _p("The following order has been cancelled.")
        + _info_box([
            ("Order reference", f"<strong>{order_ref}</strong>"),
            ("Customer", customer_name),
            ("Status", _badge("Cancelled", "#dc2626")),
        ], tint="#fef2f2", border="#fca5a5")
        + _button("View orders", f"{settings.portal_url}/orders")
        + _divider()
        + _p(f'If you believe this is an error, contact us at '
             f'<a href="mailto:{settings.support_email}" style="color:#0f6e56;">'
             f'{settings.support_email}</a>.', muted=True)
    )
    _send(reseller_email, f"Order cancelled — {order_ref}",
          _wrap("Order cancelled", body))


# ── Ticket emails ──────────────────────────────────────────────────────────────

_STAGE_LABELS = {
    "open": "New Inquiry",
    "quote": "Quote",
    "sale_order": "Sale Order",
    "invoice": "Invoice",
    "confirmed_wip": "In Progress",
    "ready_for_collection": "Ready for Collection",
}


def send_ticket_assigned(
    ticket_ref: str,
    customer_name: str,
    stage: str,
    assignee_name: str,
    assignee_email: str,
) -> None:
    """Sent to the staff member a Sales ticket is assigned to."""
    if not assignee_email:
        return
    stage_label = _STAGE_LABELS.get(stage, stage.replace("_", " ").title())
    body = (
        _h1("A ticket has been assigned to you")
        + _p(f"Hi {assignee_name},")
        + _p("The following sales ticket requires your attention.")
        + _info_box([
            ("Ticket", f"<strong>{ticket_ref}</strong>"),
            ("Customer", customer_name),
            ("Stage", _badge(stage_label)),
        ])
        + _button("Open ticket", f"{settings.portal_url}/tickets/sales")
        + _divider()
        + _p("Log in to the portal to view the full ticket history and take action.",
             muted=True)
    )
    _send(assignee_email, f"Ticket assigned — {customer_name}",
          _wrap("Ticket assignment", body))


# ── Customer onboarding emails ─────────────────────────────────────────────────

def send_onboarding_submitted(
    company_name: str,
    reseller_name: str,
    app_ref: str,
) -> None:
    """Sent to the admin support inbox when a reseller submits an onboarding application."""
    body = (
        _h1("New customer application received")
        + _p("A reseller has submitted a customer onboarding application for review.")
        + _info_box([
            ("Customer", f"<strong>{company_name}</strong>"),
            ("Submitted by", reseller_name),
            ("Reference", _mono(app_ref)),
        ])
        + _button("Review application", f"{settings.portal_url}/applications")
        + _divider()
        + _p("Log in to the portal to approve or reject this application.", muted=True)
    )
    _send(settings.support_email, f"New application — {company_name}",
          _wrap("Customer onboarding", body))


def send_onboarding_approved(
    company_name: str,
    reseller_name: str,
    reseller_email: str,
    customer_contact_email: str = None,
) -> None:
    """Sent to the reseller (and optionally customer contact) on approval."""
    if reseller_email:
        body = (
            _h1("Customer application approved")
            + _p(f"Hi {reseller_name},")
            + _p("The following customer has been approved and is now active in the system. "
                 "You can begin placing orders on their behalf.")
            + _info_box([
                ("Customer", f"<strong>{company_name}</strong>"),
                ("Status", _badge("Approved", "#059669")),
            ], tint="#f0fdf4", border="#86efac")
            + _button("View customers", f"{settings.portal_url}/customers")
            + _divider()
            + _p("The customer's Odoo record has been created and linked to your reseller profile.",
                 muted=True)
        )
        _send(reseller_email, f"Customer approved — {company_name}",
              _wrap("Onboarding approved", body))

    if customer_contact_email:
        c_body = (
            _h1("Your account has been activated")
            + _p(f"Dear {company_name},")
            + _p("We are pleased to confirm that your account with Bassani Health has been activated. "
                 "Your assigned representative will be in touch to assist you.")
            + _info_box([
                ("Organisation", company_name),
                ("Your representative", reseller_name),
                ("Status", _badge("Active", "#059669")),
            ], tint="#f0fdf4", border="#86efac")
            + _divider()
            + _p(f'For queries, contact us at <a href="mailto:{settings.healthcare_email}" '
                 f'style="color:#0f6e56;">{settings.healthcare_email}</a>.', muted=True)
        )
        _send(customer_contact_email, "Your Bassani Health account is active",
              _wrap("Account activated", c_body))


def send_onboarding_rejected(
    company_name: str,
    reseller_name: str,
    reseller_email: str,
    reason: str = "",
) -> None:
    """Sent to the reseller when an onboarding application is rejected."""
    if not reseller_email:
        return
    extra = [("Reason", reason)] if reason else []
    body = (
        _h1("Customer application not approved")
        + _p(f"Hi {reseller_name},")
        + _p("Unfortunately, the following customer application could not be approved at this time.")
        + _info_box([
            ("Customer", f"<strong>{company_name}</strong>"),
            ("Status", _badge("Not approved", "#dc2626")),
        ] + extra, tint="#fef2f2", border="#fca5a5")
        + _button("View applications", f"{settings.portal_url}/applications")
        + _divider()
        + _p(f'If you have questions, contact the Bassani Health team at '
             f'<a href="mailto:{settings.healthcare_email}" style="color:#0f6e56;">'
             f'{settings.healthcare_email}</a>.', muted=True)
    )
    _send(reseller_email, f"Customer application update — {company_name}",
          _wrap("Application update", body))


# ── Commission emails ──────────────────────────────────────────────────────────

def send_statement_generated(
    month_label: str,
    total_turnover: float,
    commission_rate: float,
    tier_label: str,
    commission_amount: float,
    reseller_name: str,
    reseller_email: str,
) -> None:
    """Sent to the reseller when their monthly statement is generated."""
    if not reseller_email:
        return
    body = (
        _h1(f"Commission statement — {month_label}")
        + _p(f"Hi {reseller_name},")
        + _p(f"Your commission statement for <strong>{month_label}</strong> has been generated "
             "and is ready for review in the portal.")
        + _info_box([
            ("Period", month_label),
            ("Total turnover", f"R{total_turnover:,.2f}"),
            ("Commission tier", f"{tier_label} @ {commission_rate:.1f}%"),
            ("Commission due",
             f'<strong style="font-size:16px;color:#0f6e56;">R{commission_amount:,.2f}</strong>'),
        ])
        + _button("View statement", f"{settings.portal_url}/commission")
        + _divider()
        + _p("Payment will be processed by the Bassani Health finance team. "
             "You will receive a confirmation email once payment has been made.", muted=True)
    )
    _send(reseller_email, f"Commission statement ready — {month_label}",
          _wrap("Monthly commission", body))


def send_statement_paid(
    month_label: str,
    commission_amount: float,
    payment_reference: str,
    payment_date: str,
    reseller_name: str,
    reseller_email: str,
) -> None:
    """Sent to the reseller when their commission is marked as paid."""
    if not reseller_email:
        return
    body = (
        _h1("Commission payment confirmed")
        + _p(f"Hi {reseller_name},")
        + _p(f"Your commission payment for <strong>{month_label}</strong> has been processed.")
        + _info_box([
            ("Period", month_label),
            ("Amount paid",
             f'<strong style="font-size:16px;color:#059669;">R{commission_amount:,.2f}</strong>'),
            ("Payment reference", payment_reference or "—"),
            ("Payment date", payment_date or "—"),
            ("Status", _badge("Paid", "#059669")),
        ], tint="#f0fdf4", border="#86efac")
        + _button("View commission history", f"{settings.portal_url}/commission")
        + _divider()
        + _p(f"Payment was made via {settings.bank_name} · Account {settings.bank_account} "
             f"· Branch {settings.bank_branch}.", muted=True)
    )
    _send(reseller_email, f"Commission paid — {month_label}",
          _wrap("Commission payment", body))


# ── Packing floor emails ───────────────────────────────────────────────────────

def send_order_ready_for_collection(
    order_ref: str,
    customer_name: str,
    packer_name: str,
    supervisor_emails: list,
) -> None:
    """Sent to warehouse supervisors when an order completes QA + RP and is ready."""
    if not supervisor_emails:
        return
    body = (
        _h1("Order ready for collection")
        + _p("An order has passed QA and RP review and is cleared for collection.")
        + _info_box([
            ("Order reference", f"<strong>{order_ref}</strong>"),
            ("Customer", customer_name),
            ("Packed by", packer_name or "—"),
            ("Status", _badge("Ready for collection", "#059669")),
        ], tint="#f0fdf4", border="#86efac")
        + _divider()
        + _p("Please arrange collection or dispatch at your earliest convenience.", muted=True)
    )
    _send(supervisor_emails, f"Ready for collection — {order_ref}",
          _wrap("Packing floor", body))
