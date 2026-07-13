"""
Bassani Health Transactional Email Service

All emails use Resend. If RESEND_API_KEY is not set or is a placeholder,
sends are logged to stdout and skipped (graceful degradation, no crash,
no blocked response).

All public functions are synchronous and intended to be called via
FastAPI's BackgroundTasks so they never block an API response:

    background_tasks.add_task(send_welcome_email, username=..., ...)
"""

import os
import resend
from config import get_settings

settings = get_settings()

# Base send

def _send(
    to: "str | list[str]",
    subject: str,
    html: str,
    reply_to: str = None,
    attachments: list = None,
    cc: "str | list[str] | None" = None,
) -> None:
    """Core send. Sync — always called from a BackgroundTask thread."""
    key = settings.resend_api_key
    if not key or key.startswith("re_your"):
        recipients = to if isinstance(to, str) else ", ".join(to)
        print(f"[email skipped - no API key] to={recipients} subject={subject}")
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
        if attachments:
            payload["attachments"] = attachments
        if cc:
            payload["cc"] = cc if isinstance(cc, list) else [cc]
        resend.Emails.send(payload)
    except Exception as exc:
        print(f"Email send failed [{subject}]: {exc}")


# HTML primitives

def _wrap(body_html: str, footer_note: str = "") -> str:
    """Branded email shell. Table-based for cross-client compatibility.
    footer_note overrides the default 'do not reply' line when the email
    intentionally invites a reply (e.g. onboarding documents).
    """
    _footer = footer_note or (
        "This is an automated message from the Bassani Health operations portal. "
        "Please do not reply directly to this email."
    )
    return f"""<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width,initial-scale=1.0">
  <meta http-equiv="X-UA-Compatible" content="IE=edge">
  <style>
    @media only screen and (max-width:480px) {{
      .bh-body   {{ padding: 24px 16px 20px !important; }}
      .bh-footer {{ padding: 16px 20px !important; }}
    }}
  </style>
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
          <td style="border-radius:12px 12px 0 0;overflow:hidden;line-height:0;font-size:0;padding:0;">
            <img src="https://portal.bassanihealth.com/logo.png"
                 alt="Bassani Health"
                 width="600"
                 style="width:100%;max-width:600px;height:auto;display:block;border:0;outline:none;" />
          </td>
        </tr>

        <!-- Body -->
        <tr>
          <td class="bh-body" style="padding:32px 28px 24px;">
            {body_html}
          </td>
        </tr>

        <!-- Footer -->
        <tr>
          <td class="bh-footer" style="background:#f8fafc;border-top:1px solid #e2e8f0;
                     padding:18px 28px;border-radius:0 0 12px 12px;">
            <p style="margin:0;font-size:11px;color:#94a3b8;line-height:1.6;">
              Bassani Health &nbsp;&middot;&nbsp; Cnr Dytchley &amp; Marcius Roads, Kyalami
            </p>
            <p style="margin:5px 0 0;font-size:11px;color:#cbd5e1;line-height:1.6;">
              {_footer}
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


# Account emails

def send_welcome_email(username: str, name: str, email: str) -> None:
    """Sent when an admin creates a new portal account."""
    if not email:
        return
    url = settings.portal_url
    body = (
        _h1("Welcome to Bassani Health")
        + _p(f"Hi {name or username},")
        + _p("Your account on the Bassani Health operations portal has been created. "
             "Use the credentials below to sign in. You will be prompted to set a new "
             "password the first time you access the portal.")
        + _info_box([
            ("Username", _mono(username)),
            ("Temporary password", "Provided to you separately by your administrator"),
            ("Portal", f'<a href="{url}" style="color:#0f6e56;text-decoration:none;">{url}</a>'),
        ])
        + _button("Sign in to the portal", url)
        + _divider()
        + _p("Keep your password private and do not share it with anyone. "
             f'If you need assistance, contact <a href="mailto:{settings.support_email}" '
             f'style="color:#0f6e56;">{settings.support_email}</a>.', muted=True)
    )
    _send(email, "Your Bassani Health portal account is ready",
          _wrap(body))


# Order emails

def send_order_placed(
    order_ref: str,
    customer_name: str,
    order_total: float,
    reseller_name: str,
    reseller_email: str,
    cc: "list[str] | None" = None,
) -> None:
    """Sent to the reseller when their portal order is submitted."""
    if not reseller_email:
        return
    body = (
        _h1("Order received")
        + _p(f"Hi {reseller_name},")
        + _p("Your order has been submitted and is now with the Bassani Health team for processing.")
        + _info_box([
            ("Order reference", f"<strong>{order_ref}</strong>"),
            ("Customer", customer_name),
            ("Order total", f"R{order_total:,.2f}"),
            ("Status", _badge("Awaiting confirmation")),
        ])
        + _button("View order", f"{settings.portal_url}/orders")
        + _divider()
        + _p("You will receive a notification once the order has been confirmed "
             "and is in the fulfilment queue.", muted=True)
    )
    _send(reseller_email, f"Order Received: {order_ref}",
          _wrap(body), cc=cc or None)


def send_order_confirmed(
    order_ref: str,
    customer_name: str,
    order_total: float,
    reseller_name: str,
    reseller_email: str,
    cc: "list[str] | None" = None,
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
        + _p("You will be notified as soon as the order is ready for collection.", muted=True)
    )
    _send(reseller_email, f"Order Confirmed: {order_ref}",
          _wrap(body), cc=cc or None)


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
        + _p("We would like to let you know that the following order has been cancelled. "
             "Please review the details below.")
        + _info_box([
            ("Order reference", f"<strong>{order_ref}</strong>"),
            ("Customer", customer_name),
            ("Status", _badge("Cancelled", "#dc2626")),
        ], tint="#fef2f2", border="#fca5a5")
        + _button("View orders", f"{settings.portal_url}/orders")
        + _divider()
        + _p(f'If you believe this is an error, please contact us at '
             f'<a href="mailto:{settings.support_email}" style="color:#0f6e56;">'
             f'{settings.support_email}</a>.', muted=True)
    )
    _send(reseller_email, f"Order Cancellation: {order_ref}",
          _wrap(body))


# Ticket emails

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
        + _p("The following sales ticket has been assigned to you and requires your attention.")
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
    _send(assignee_email, f"New Assignment: {customer_name}",
          _wrap(body))


# Customer onboarding emails

def send_onboarding_submitted(
    company_name: str,
    reseller_name: str,
    app_ref: str,
    to: "str | list[str] | None" = None,
    source: str = "reseller",
) -> None:
    """Sent to configured recipients when an application is submitted for review."""
    resolved_to = to or settings.support_email
    if source == "self_service":
        intro = "A customer has submitted a self-service registration application for review."
        via_label = "Direct (self-service)"
    else:
        intro = "A reseller has submitted a customer onboarding application for review."
        via_label = reseller_name
    body = (
        _h1("New customer application received")
        + _p(intro)
        + _info_box([
            ("Customer", f"<strong>{company_name}</strong>"),
            ("Submitted by", via_label),
            ("Reference", _mono(app_ref)),
        ])
        + _button("Review application", f"{settings.portal_url}/applications")
        + _divider()
        + _p("Log in to the portal to review and action this application.", muted=True)
    )
    _send(resolved_to, f"New Application: {company_name}",
          _wrap(body))


def send_registration_confirmation(
    company_name: str,
    contact_name: str,
    contact_email: str,
    app_ref: str,
) -> None:
    """Sent to the applicant immediately after a self-service registration is submitted."""
    body = (
        _h1("We have received your application")
        + _p(f"Dear {contact_name},")
        + _p(
            f"Thank you for registering with Bassani Health. "
            f"Your application for <strong>{company_name}</strong> has been received "
            f"and is currently under review by our team."
        )
        + _info_box([
            ("Organisation",       f"<strong>{company_name}</strong>"),
            ("Application number", _mono(app_ref)),
            ("Status",             _badge("Under review", "#0f6e56")),
        ], tint="#f0fdf4", border="#86efac")
        + _p(
            "We aim to process applications within 2 to 3 business days. "
            "If we require any additional information, a member of our team will contact you directly."
        )
        + _divider()
        + _p(
            f'For any questions, please contact us at '
            f'<a href="mailto:{settings.healthcare_email}" style="color:#0f6e56;">'
            f'{settings.healthcare_email}</a>. '
            f'Please quote your application number <strong>{app_ref}</strong> in all correspondence.',
            muted=True,
        )
    )
    _send(
        contact_email,
        f"Application Received: {company_name}",
        _wrap(body),
    )


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
            + _p("The customer's account has been created and linked to your reseller profile.",
                 muted=True)
        )
        _send(reseller_email, f"Customer Approved: {company_name}",
              _wrap(body))

    if customer_contact_email:
        c_body = (
            _h1("Your account has been activated")
            + _p(f"Dear {company_name},")
            + _p("We are pleased to confirm that your account with Bassani Health has been activated. "
                 "Your assigned representative will be in touch shortly to assist you.")
            + _info_box([
                ("Organisation", company_name),
                ("Your representative", reseller_name),
                ("Status", _badge("Active", "#059669")),
            ], tint="#f0fdf4", border="#86efac")
            + _divider()
            + _p(f'Should you have any questions, please contact us at '
                 f'<a href="mailto:{settings.healthcare_email}" '
                 f'style="color:#0f6e56;">{settings.healthcare_email}</a>.', muted=True)
        )
        _send(customer_contact_email, "Your Bassani Health account is active",
              _wrap(c_body))


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
        _h1("Application not approved")
        + _p(f"Hi {reseller_name},")
        + _p("Unfortunately, the following customer application could not be approved at this time.")
        + _info_box([
            ("Customer", f"<strong>{company_name}</strong>"),
            ("Status", _badge("Declined", "#dc2626")),
        ] + extra, tint="#fef2f2", border="#fca5a5")
        + _button("View applications", f"{settings.portal_url}/applications")
        + _divider()
        + _p(f'If you have any questions, please reach out to the Bassani Health team at '
             f'<a href="mailto:{settings.healthcare_email}" style="color:#0f6e56;">'
             f'{settings.healthcare_email}</a>.', muted=True)
    )
    _send(reseller_email, f"Application Update: {company_name}",
          _wrap(body))


def send_onboarding_docs_received_reseller(
    company_name: str,
    reseller_name: str,
    reseller_email: str,
    app_id: str,
) -> None:
    """Sent to the reseller when admin saves signed docs to their awaiting_docs application."""
    if not reseller_email:
        return
    name_str = company_name or "your customer"
    body = (
        _h1("Onboarding documents received")
        + _p(f"Hi {reseller_name},")
        + _p(f"The signed onboarding documents for {name_str} have been received and saved to the application. "
             "You can now complete the remaining details and submit it for review.")
        + _info_box([
            ("Customer", f"<strong>{name_str}</strong>"),
            ("Documents", _badge("On file", "#059669")),
        ], tint="#f0fdf4", border="#86efac")
        + _button("Complete application", f"{settings.portal_url}/onboard?resume={app_id}")
        + _divider()
        + _p("Log in to complete the remaining details and submit the application.", muted=True)
    )
    _send(reseller_email, f"Docs Received: {name_str}",
          _wrap(body))


# Commission emails

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
        _h1(f"Commission statement for {month_label}")
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
             "You will receive a confirmation once payment has been made.", muted=True)
    )
    _send(reseller_email, f"Commission Statement Ready: {month_label}",
          _wrap(body))


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
        + _p(f"Your commission payment for <strong>{month_label}</strong> has been processed "
             "and is on its way to you.")
        + _info_box([
            ("Period", month_label),
            ("Amount paid",
             f'<strong style="font-size:16px;color:#059669;">R{commission_amount:,.2f}</strong>'),
            ("Payment reference", payment_reference or "Not provided"),
            ("Payment date", payment_date or "Not provided"),
            ("Status", _badge("Paid", "#059669")),
        ], tint="#f0fdf4", border="#86efac")
        + _button("View commission history", f"{settings.portal_url}/commission")
        + _divider()
        + _p(f"Payment was processed through {settings.bank_name}, "
             f"account number {settings.bank_account}, "
             f"branch code {settings.bank_branch}.", muted=True)
    )
    _send(reseller_email, f"Commission Paid: {month_label}",
          _wrap(body))


def send_dispute_resolved(
    month_label: str,
    resolve_notes: str,
    reseller_name: str,
    reseller_email: str,
) -> None:
    """Sent to the reseller when an admin resolves their commission dispute."""
    if not reseller_email:
        return
    body = (
        _h1("Commission dispute resolved")
        + _p(f"Hi {reseller_name},")
        + _p(f"Your dispute for the <strong>{month_label}</strong> commission statement "
             "has been reviewed and resolved by our finance team.")
        + _info_box([
            ("Period", month_label),
            ("Resolution", resolve_notes or "No additional notes provided"),
        ])
        + _button("View statement", f"{settings.portal_url}/commission")
        + _divider()
        + _p("If you have any further questions, please contact your account manager.", muted=True)
    )
    _send(reseller_email, f"Commission Dispute Update: {month_label}",
          _wrap(body))


# 2FA / OTP emails and account security emails

def send_password_reset_email(email: str, name: str, reset_url: str) -> None:
    """Sent when a user requests a self-service password reset."""
    body = (
        _h1("Reset your password")
        + _p(f"Hi {name},")
        + _p(
            "We received a request to reset the password for your Bassani Health account. "
            "Click the button below to set a new password. This link expires in "
            "<strong>15 minutes</strong> and can only be used once."
        )
        + _button("Reset password", reset_url)
        + _divider()
        + _p(
            "If you did not request a password reset, you can ignore this email. "
            "Your password will not change.",
            muted=True,
        )
        + _p(
            "For security, never share this link with anyone. "
            "Bassani Health staff will never ask you to forward it.",
            muted=True,
        )
    )
    _send(email, "Reset your Bassani Health password", _wrap(body))


def send_otp_email(email: str, name: str, otp: str) -> None:
    """Sent when a staff member's login triggers the email OTP 2FA step."""
    body = (
        _h1("Your sign-in code")
        + _p(f"Hi {name},")
        + _p("Enter the code below to complete your sign-in. It expires in <strong>10 minutes</strong> "
             "and can only be used once.")
        + (
            '<table width="100%" cellpadding="0" cellspacing="0" border="0" style="margin:28px 0;">'
            '<tr><td align="center">'
            '<table cellpadding="0" cellspacing="0" border="0">'
            '<tr><td style="background:#f8fafc;border:1px solid #e2e8f0;border-radius:12px;'
            'padding:18px 32px;text-align:center;">'
            f'<span style="font-size:36px;font-weight:800;letter-spacing:8px;color:#0f172a;'
            f'font-family:\'Courier New\',monospace;">{otp}</span>'
            '</td></tr></table>'
            '</td></tr></table>'
        )
        + _divider()
        + _p("Do not share this code with anyone. Bassani Health staff will never ask you for it.", muted=True)
        + _p(
            f'If you did not request this code, please ignore this email and consider '
            f'updating your password as a precaution at '
            f'<a href="{settings.portal_url}" style="color:#0f6e56;">{settings.portal_url}</a>.',
            muted=True,
        )
    )
    _send(email, "Your Bassani Health sign-in code", _wrap(body))


# Onboarding document emails

def send_signing_invitation(
    to_email: str,
    customer_name: str,
    signing_url: str,
    expiry_date: str,
) -> None:
    """
    Sent to a customer when an admin clicks 'Generate and Send Documents'.
    Contains a unique link to sign the NDA and Store Onboarding Agreement
    in-browser. The link is valid for 30 days.
    """
    if not to_email:
        return
    name = customer_name or "there"
    body = (
        _h1("Your documents are ready to sign")
        + _p(f"Hi {name},")
        + _p(
            "Thank you for submitting your registration. We have reviewed your application "
            "and prepared the remaining documents for your signature."
        )
        + _p(
            "Please use the secure link below to review and sign the Non-Disclosure Agreement "
            "and Store Onboarding Agreement. Your details have already been filled in."
        )
        + _button("Review and sign documents", signing_url)
        + _info_box([
            ("Documents to sign", "Non-Disclosure Agreement, Store Onboarding Agreement"),
            ("Link expires",      expiry_date),
        ])
        + _divider()
        + _p(
            "If you have any questions, please reply to this email and a member "
            "of the team will assist you.",
            muted=True,
        )
    )
    _send(to_email, "Bassani Health: Documents ready to sign", _wrap(body))


def send_onboarding_templates(to_email: str, reseller_name: str, reply_to: str = "") -> None:
    """
    Emails the Customer Information Form template to a customer's email address.
    Called by the reseller from Step 0 of the onboarding wizard, and by admin from
    the customer listing page.
    When reply_to is set (the onboarding mailbox address), the customer is instructed
    to reply directly to this email with their signed documents so replies land in the
    Onboarding Inbox for staff to pick up and link to the customer profile.
    Gracefully skips any template file that has not yet been placed in the static directory.
    """
    if not to_email:
        return

    _TEMPLATE_DIR = os.path.join(os.path.dirname(__file__), "..", "static", "onboarding-templates")
    _TEMPLATES = [
        ("customer-information-form.pdf",  "Bassani Health Customer Information Form"),
    ]

    attachments = []
    for filename, display_name in _TEMPLATES:
        fpath = os.path.join(_TEMPLATE_DIR, filename)
        if os.path.exists(fpath):
            with open(fpath, "rb") as f:
                attachments.append({"filename": f"{display_name}.pdf", "content": list(f.read())})
        else:
            print(f"Onboarding template not found, skipping: {filename}")

    if reply_to:
        return_instruction = _p(
            "Please complete and sign the form, then "
            "<strong>reply directly to this email</strong> with the signed form "
            "and your CIPC company registration certificate attached. "
            "Our team will review your submission and send you the remaining documents to sign."
        )
    else:
        return_instruction = _p(
            "Please complete and sign the Customer Information Form, then return it along with your "
            f"CIPC company registration certificate to your Bassani Health representative, "
            f"<strong>{reseller_name}</strong>."
        )

    info_rows = [
        ("Attached",           "Customer Information Form"),
        ("Also required",      "CIPC Company Registration Certificate"),
        ("Your representative", reseller_name),
    ]
    if reply_to:
        info_rows.append(("Return to", f'<a href="mailto:{reply_to}" style="color:#0f6e56;">{reply_to}</a>'))
    else:
        info_rows.append(("Queries", f'<a href="mailto:{settings.healthcare_email}" style="color:#0f6e56;">{settings.healthcare_email}</a>'))

    body = (
        _h1("Your onboarding documents")
        + _p("Please find the Customer Information Form attached to this email.")
        + return_instruction
        + _info_box(info_rows)
        + _divider()
        + _p("Once your documents are received and reviewed, we will send you a secure link "
             "to complete the remaining signing steps.", muted=True)
    )
    _send(
        to_email,
        "Bassani Health: Onboarding Documents",
        _wrap(body),
        reply_to=reply_to or None,
        attachments=attachments if attachments else None,
    )


# Packing floor emails

def send_doc_upload_request(
    to_email: str,
    to_name: str,
    company_name: str,
    upload_url: str,
    expiry_days: int = 7,
) -> None:
    """Sent to a customer contact when an admin requests outstanding documents."""
    if not to_email:
        return
    body = (
        _h1("Action required: please upload your documents")
        + _p(f"Hi {to_name or company_name},")
        + _p(
            f"Our team requires outstanding documentation for {company_name}. "
            "Please use the secure link below to upload your documents at your convenience."
        )
        + _info_box([
            ("Account",      company_name),
            ("Recipient",    "Bassani Health onboarding team"),
            ("Link expires", f"In {expiry_days} days"),
        ], tint="#fffbeb", border="#fcd34d")
        + _button("Upload your documents", upload_url)
        + _divider()
        + _p(
            f"This link is unique to your account and expires after {expiry_days} days. "
            "You may upload multiple files in a single session. "
            "If you have any questions, please reply to this email.",
            muted=True,
        )
    )
    _send(
        to_email,
        f"Documents required: {company_name}",
        _wrap(
            body,
            footer_note=(
                "This message was sent on behalf of Bassani Health. "
                "Reply to this email if you need assistance."
            ),
        ),
    )


def send_doc_upload_notification(
    to_emails: list,
    company_name: str,
    uploaded_by_email: str,
    file_list: list,
    uploaded_at: str,
) -> None:
    """Sent to the onboarding team when a customer uploads documents via a secure link."""
    if not to_emails:
        return
    file_rows = "".join(
        f'<tr><td style="padding:5px 0;font-size:13px;color:#0f172a;">'
        f'{i + 1}. {name}</td></tr>'
        for i, name in enumerate(file_list)
    )
    file_table = (
        '<table width="100%" cellpadding="0" cellspacing="0" border="0" '
        'style="background:#f0fdf9;border:1px solid #bbf7d0;border-radius:8px;'
        'margin:16px 0;padding:4px 20px;">'
        '<tr><td><table width="100%" cellpadding="0" cellspacing="0" border="0">'
        f'{file_rows}'
        '</table></td></tr></table>'
    )
    body = (
        _h1("Documents uploaded")
        + _p(f"Documents have been submitted for <strong>{company_name}</strong>.")
        + _info_box([
            ("Account",     company_name),
            ("Uploaded by", uploaded_by_email or "Not provided"),
            ("Date",        uploaded_at),
            ("Files",       str(len(file_list))),
        ])
        + _p(f"<strong>Files received ({len(file_list)}):</strong>")
        + file_table
        + _divider()
        + _p("These files are now available on the customer profile.", muted=True)
    )
    _send(
        to_emails,
        f"Documents uploaded: {company_name}",
        _wrap(body),
    )


def send_order_ready_for_collection(
    order_ref: str,
    customer_name: str,
    packer_name: str,
    supervisor_emails: list,
) -> None:
    """Sent to warehouse supervisors when an order completes QA and RP review and is ready."""
    if not supervisor_emails:
        return
    body = (
        _h1("Order ready for collection")
        + _p("An order has passed QA and RP review and is cleared for collection.")
        + _info_box([
            ("Order reference", f"<strong>{order_ref}</strong>"),
            ("Customer", customer_name),
            ("Packed by", packer_name or "Not provided"),
            ("Status", _badge("Ready for collection", "#059669")),
        ], tint="#f0fdf4", border="#86efac")
        + _divider()
        + _p("Please arrange collection or dispatch at your earliest convenience.", muted=True)
    )
    _send(supervisor_emails, f"Ready for Collection: {order_ref}",
          _wrap(body))


# ── Partial fulfilment and backorder emails (Phase 8.23) ──────────────────────

def _item_rows(items: list, qty_key: str = "qty") -> str:
    """Render a list of {name, qty_key} dicts as a simple HTML item list."""
    rows = "".join(
        f'<tr>'
        f'<td style="padding:6px 0;font-size:13px;color:#0f172a;border-bottom:1px solid #f1f5f9;">'
        f'{item.get("name", "Unknown item")}</td>'
        f'<td style="padding:6px 0 6px 12px;font-size:13px;color:#475569;text-align:right;'
        f'border-bottom:1px solid #f1f5f9;white-space:nowrap;">'
        f'{item.get(qty_key, item.get("qty", 0)):g} units</td>'
        f'</tr>'
        for item in items
    )
    return (
        f'<table width="100%" cellpadding="0" cellspacing="0" border="0" '
        f'style="margin:4px 0 0;">{rows}</table>'
    )


def _section_heading(text: str) -> str:
    return (
        f'<p style="margin:20px 0 6px;font-size:11px;font-weight:700;color:#64748b;'
        f'text-transform:uppercase;letter-spacing:0.5px;">{text}</p>'
    )


def send_order_confirmed_partial(
    order_ref: str,
    customer_name: str,
    order_total: float,
    reseller_name: str,
    reseller_email: str,
    shipped_lines: list,
    backorder_lines: list,
    cc: "list[str] | None" = None,
) -> None:
    """Sent to the reseller when their order is confirmed but some items are on backorder.
    shipped_lines: [{name, qty}] — items available now.
    backorder_lines: [{name, qty_ordered, qty_short}] — items not currently in stock.
    """
    if not reseller_email:
        return
    shipped_html = _item_rows(shipped_lines)
    backorder_html = _item_rows(backorder_lines, qty_key="qty_short")
    body = (
        _h1("Order confirmed with partial availability")
        + _p(f"Hi {reseller_name},")
        + _p(
            f"Your order for <strong>{customer_name}</strong> has been confirmed. "
            "We have the items listed below in stock and will begin fulfilment immediately. "
            "A number of items are not currently available and have been placed on backorder."
        )
        + _info_box([
            ("Order reference", f"<strong>{order_ref}</strong>"),
            ("Customer", customer_name),
            ("Order total", f"R{order_total:,.2f}"),
            ("Status", _badge("Partially available", "#d97706")),
        ], tint="#fffbeb", border="#fde68a")
        + _section_heading("Items being fulfilled now")
        + shipped_html
        + _section_heading("Items on backorder")
        + backorder_html
        + _p(
            "We will contact you as soon as the backordered items are available so "
            "your customer can collect the remainder. No additional steps are required from you.",
            muted=True,
        )
        + _button("Track your order", f"{settings.portal_url}/tickets/sales")
    )
    _send(reseller_email, f"Order Confirmed: {order_ref}",
          _wrap(body), cc=cc or None)


def send_backorder_alert_internal(
    to: "str | list[str]",
    order_ref: str,
    customer_name: str,
    reseller_name: "str | None",
    backorder_lines: list,
) -> None:
    """Internal alert sent to the fulfilment team when a confirmed order has stock shortfalls.
    backorder_lines: [{name, qty_ordered, qty_available, qty_short}].
    """
    if not to:
        return
    shortfall_rows = "".join(
        f'<tr>'
        f'<td style="padding:6px 0;font-size:13px;color:#0f172a;border-bottom:1px solid #f1f5f9;">'
        f'{item.get("name", "Unknown")}</td>'
        f'<td style="padding:6px 0 6px 12px;font-size:13px;color:#64748b;text-align:right;'
        f'border-bottom:1px solid #f1f5f9;white-space:nowrap;">'
        f'Ordered: {item.get("qty_ordered", 0):g} / Available: {item.get("qty_available", 0):g} / '
        f'<strong style="color:#dc2626;">Short: {item.get("qty_short", 0):g}</strong></td>'
        f'</tr>'
        for item in backorder_lines
    )
    shortfall_table = (
        f'<table width="100%" cellpadding="0" cellspacing="0" border="0" '
        f'style="margin:4px 0 0;">{shortfall_rows}</table>'
    )
    via = f" via {reseller_name}" if reseller_name else ""
    body = (
        _h1("Order confirmed with stock shortfall")
        + _p(
            f"Order <strong>{order_ref}</strong> for <strong>{customer_name}</strong>{via} "
            "has been confirmed. The items below cannot be fully fulfilled from current stock "
            "and will require a backorder."
        )
        + _info_box([
            ("Order reference", f"<strong>{order_ref}</strong>"),
            ("Customer", customer_name),
            ("Via", reseller_name or "Direct"),
        ], tint="#fff7ed", border="#fed7aa")
        + _section_heading("Stock shortfalls")
        + shortfall_table
        + _divider()
        + _p("The order has been queued on the packing board. Pack what is available "
             "and the system will create a backorder automatically when the delivery is validated.",
             muted=True)
        + _button("Open packing board", f"{settings.portal_url}/orders-tickets")
    )
    _send(to, f"Backorder Required: {order_ref}",
          _wrap(body))


def send_partial_delivery_ready(
    reseller_email: str,
    order_ref: str,
    customer_name: str,
    reseller_name: str,
    shipped_lines: list,
    backorder_lines: list,
    cc: "list[str] | None" = None,
) -> None:
    """Sent to the reseller when the first (partial) delivery is ready for collection.
    shipped_lines: [{name, qty}] — items packed and ready.
    backorder_lines: [{name, qty}] — items still pending.
    """
    if not reseller_email:
        return
    body = (
        _h1("Partial delivery ready for collection")
        + _p(f"Hi {reseller_name},")
        + _p(
            f"The items listed below for <strong>{customer_name}</strong> are packed and ready "
            "for collection. Please arrange collection at your convenience."
        )
        + _info_box([
            ("Order reference", f"<strong>{order_ref}</strong>"),
            ("Customer", customer_name),
            ("Status", _badge("Ready for collection", "#059669")),
        ], tint="#f0fdf4", border="#86efac")
        + _section_heading("Ready for collection")
        + _item_rows(shipped_lines)
        + _section_heading("Still on backorder")
        + _item_rows(backorder_lines)
        + _p(
            "You will receive a separate notification when the backordered items are available. "
            "Your customer is welcome to collect the available items now and return for the remainder.",
            muted=True,
        )
        + _button("Track your order", f"{settings.portal_url}/tickets/sales")
    )
    _send(reseller_email, f"Ready for Collection: {order_ref}",
          _wrap(body), cc=cc or None)


def send_backorder_created_internal(
    to: "str | list[str]",
    order_ref: str,
    customer_name: str,
    backorder_ref: str,
    backorder_lines: list,
) -> None:
    """Internal notification when a backorder picking is created in Odoo.
    backorder_lines: [{name, qty}].
    """
    if not to:
        return
    body = (
        _h1("Backorder created")
        + _p(
            f"A backorder has been created in Odoo for order <strong>{order_ref}</strong> "
            f"({customer_name}). The picking below contains the items that could not be "
            "fulfilled in the initial delivery."
        )
        + _info_box([
            ("Original order", f"<strong>{order_ref}</strong>"),
            ("Backorder picking", _mono(backorder_ref)),
            ("Customer", customer_name),
            ("Status", _badge("Waiting for stock", "#d97706")),
        ], tint="#fff7ed", border="#fed7aa")
        + _section_heading("Items on backorder")
        + _item_rows(backorder_lines)
        + _divider()
        + _p(
            "These items will appear on the packing board automatically once stock is available. "
            "Use the portal to check stock availability or monitor the picking in Odoo.",
            muted=True,
        )
        + _button("Open packing board", f"{settings.portal_url}/orders-tickets")
    )
    _send(to, f"Backorder Created: {order_ref}",
          _wrap(body))


def send_backorder_stock_ready(
    reseller_email: "str | None",
    internal_to: "str | list[str] | None",
    order_ref: str,
    customer_name: str,
    reseller_name: "str | None",
    backorder_lines: list,
) -> None:
    """Sent when a backorder picking has been assigned stock and is ready to pack.
    Fires two sends: one to the reseller and one internal alert to the fulfilment team.
    """
    if reseller_email and reseller_name:
        r_body = (
            _h1("Backordered items are now available")
            + _p(f"Hi {reseller_name},")
            + _p(
                f"The items that were on backorder for <strong>{customer_name}</strong> "
                "are now available and our team will begin packing them shortly. "
                "We will notify you when they are ready for collection."
            )
            + _info_box([
                ("Order reference", f"<strong>{order_ref}</strong>"),
                ("Customer", customer_name),
                ("Status", _badge("Now in stock", "#059669")),
            ], tint="#f0fdf4", border="#86efac")
            + _section_heading("Items now available")
            + _item_rows(backorder_lines)
            + _button("Track your order", f"{settings.portal_url}/tickets/sales")
        )
        _send(reseller_email, f"Backorder Update: {order_ref}",
              _wrap(r_body))

    if internal_to:
        i_body = (
            _h1("Backorder items ready to pack")
            + _p(
                f"Stock has been assigned to the backorder for order "
                f"<strong>{order_ref}</strong> ({customer_name}). "
                "The backorder entry has been moved to the packing queue."
            )
            + _info_box([
                ("Order reference", f"<strong>{order_ref}</strong>"),
                ("Customer", customer_name),
                ("Via", reseller_name or "Direct"),
                ("Status", _badge("Ready to pack", "#059669")),
            ], tint="#f0fdf4", border="#86efac")
            + _section_heading("Items to pack")
            + _item_rows(backorder_lines)
            + _button("Open packing board", f"{settings.portal_url}/orders-tickets")
        )
        _send(internal_to, f"Backorder Ready to Pack: {order_ref}",
              _wrap(i_body))


# ── Auto-payment confirmation digest (Phase 22.1) ────────────────────────────

def send_payment_auto_confirmed(to: list, confirmed_items: list) -> None:
    """
    Digest sent to Finance when the background payment check auto-confirms
    one or more invoices from Odoo bank reconciliation.
    """
    if not to or not confirmed_items:
        return
    count = len(confirmed_items)
    rows = "".join(
        f'<tr>'
        f'<td style="padding:8px 0;font-size:13px;color:#0f172a;'
        f'border-bottom:1px solid #f1f5f9;">'
        f'{item.get("customer_name", "Unknown")}</td>'
        f'<td style="padding:8px 0 8px 16px;font-size:13px;color:#475569;'
        f'border-bottom:1px solid #f1f5f9;">'
        f'Order #{item.get("order_id", "")}</td>'
        f'<td style="padding:8px 0 8px 16px;font-size:13px;color:#475569;'
        f'text-align:right;border-bottom:1px solid #f1f5f9;white-space:nowrap;">'
        f'{item.get("invoice_name", "")}</td>'
        f'</tr>'
        for item in confirmed_items
    )
    body = (
        _h1(f"Payment confirmed: {count} invoice{'s' if count != 1 else ''}")
        + _p(
            f"{count} invoice{'s' if count != 1 else ''} "
            "matched bank records and were confirmed automatically. "
            "No action is required."
        )
        + f'<table width="100%" cellpadding="0" cellspacing="0" border="0" style="margin:16px 0;">'
        + f'<thead><tr>'
        + f'<th style="text-align:left;font-size:11px;font-weight:700;color:#64748b;'
        + f'text-transform:uppercase;letter-spacing:0.5px;padding-bottom:8px;">Customer</th>'
        + f'<th style="text-align:left;font-size:11px;font-weight:700;color:#64748b;'
        + f'text-transform:uppercase;letter-spacing:0.5px;padding-bottom:8px;padding-left:16px;">Order</th>'
        + f'<th style="text-align:right;font-size:11px;font-weight:700;color:#64748b;'
        + f'text-transform:uppercase;letter-spacing:0.5px;padding-bottom:8px;padding-left:16px;">Invoice</th>'
        + f'</tr></thead>'
        + f'<tbody>{rows}</tbody>'
        + f'</table>'
        + _divider()
        + _p("Log in to view full payment details for each order.", muted=True)
    )
    subject = f"Payments Confirmed: {count} invoice{'s' if count != 1 else ''} matched bank records"
    _send(to, subject, _wrap(body))
