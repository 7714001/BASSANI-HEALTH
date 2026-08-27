import { Fragment } from "react";
import {
  FileText, CheckCircle2, X, Package, ClipboardCheck, Truck, Check, Clock, History,
} from "lucide-react";
import { fmtDate } from "./UI";

// Extracted from OrderPassport.js (2026-08-26) once SalesTickets.js needed
// the identical timeline — one shared implementation so the two pages can
// never disagree about what stage an order/ticket is actually at.

const TICKET_STATUS_LABEL = {
  open: "Inquiry Open", quote: "Building Quote",
  sale_order: "Awaiting Deposit", awaiting_deposit: "Awaiting Deposit",
  invoice: "Invoice Raised", confirmed_wip: "In Progress",
  ready_for_collection: "Ready for Collection", incomplete: "Incomplete",
  queued: "Queued for Packing", packing: "Being Packed", waiting_stock: "Awaiting Stock",
};

// Exported — also used directly by OrderPassport.js's Sales Ticket card
// (StagePill) so the ticket's stage text can never drift from what this
// timeline itself uses for the same value.
export function ticketStageLabel(ticket) {
  return ticket.exit_status
    ? ticket.exit_status.charAt(0).toUpperCase() + ticket.exit_status.slice(1).replace(/_/g, " ")
    : (TICKET_STATUS_LABEL[ticket.status] || ticket.status || "");
}

// ── Timeline ─────────────────────────────────────────────────────────────────
// The single authoritative telling of an order's story, built only from
// fields the caller already has — never invents a timestamp it doesn't have.
export function buildTimelineSteps({ order, ticket, packing, invoices, manufacturing_orders }) {
  const steps = [];

  steps.push({ key: "placed", label: "Order Placed", icon: FileText, state: "done", at: order.date_order });

  const orderConfirmed = ["sale", "done"].includes(order.state);
  if (order.state === "cancel") {
    steps.push({ key: "confirmed", label: "Order Confirmed", icon: CheckCircle2, state: "skipped" });
    steps.push({ key: "cancelled", label: "Order Cancelled", icon: X, state: "skipped", terminal: true });
    return steps;
  }
  steps.push({
    key: "confirmed", label: "Order Confirmed", icon: CheckCircle2,
    state: orderConfirmed ? "done" : "current",
    sub: !orderConfirmed ? "Awaiting confirmation" : null,
  });

  if (!ticket) return steps;

  // "sale_order" is an older/transitional status value still written by a
  // couple of other code paths (ticket creation, the Odoo-state auto-sync);
  // the live confirm flow (_confirm_order_core, order_routes.py) writes
  // "awaiting_deposit" directly — both mean the same thing here: confirmed,
  // deposit not yet registered.
  const AWAITING_DEPOSIT_STATUSES = ["sale_order", "awaiting_deposit"];
  const depositDone = !!packing || !["open", "quote", ...AWAITING_DEPOSIT_STATUSES].includes(ticket.status);
  steps.push({
    key: "deposit", label: "Deposit Registered", icon: FileText,
    state: depositDone ? "done" : (AWAITING_DEPOSIT_STATUSES.includes(ticket.status) ? "current" : "pending"),
    sub: !depositDone && AWAITING_DEPOSIT_STATUSES.includes(ticket.status) ? "Awaiting Finance" : null,
  });

  const ticketHalted = ticket.exit_status && ticket.exit_status !== "complete";
  if (ticketHalted) {
    steps.push({
      key: "halted", label: `Ticket ${ticketStageLabel(ticket)}`, icon: X, state: "skipped", terminal: true,
      sub: ticket.incomplete_reason,
    });
    return steps;
  }

  // Every remaining step is always pushed, defaulting to "pending" via
  // `packing?.` throughout, rather than stopping early — so the full
  // lifecycle is visible from the moment an order is placed.
  steps.push({
    key: "queued", label: "Queued for Packing", icon: Package,
    state: !packing ? "pending"
      : packing.status === "waiting_stock" ? "pending"
      : packing.status === "queued" ? "current"
      : "done",
  });

  // packingWorkDone = the physical pack itself is finished (status has
  // reached "ready", i.e. ready for QA/RP inspection, or later) — this is
  // NOT the same thing as the order being ready for the customer to collect.
  // "ready" on the packing board means "Ready for Inspection" (see
  // OrdersTickets.js's own STATUS_LABEL); only "complete" means "Ready for
  // Collection." Conflating the two here was a real bug (found live
  // 2026-08-27): the moment packing reached "ready" — before QA/RP had
  // signed off and before Mark Complete had ever run — the "Ready for
  // Collection" step, the final invoice read, and "Balance Payment
  // Received" all lit up as done, off the strength of the 50% deposit
  // invoice (the only invoice that exists at that point, and one Odoo marks
  // paid immediately on registration) being mistaken for the final one.
  const packingWorkDone = !!packing && ["ready", "complete", "collected"].includes(packing.status);
  const readyForCollection = !!packing && ["complete", "collected"].includes(packing.status);
  const packingStep = {
    key: "packing", label: "Packing", icon: Package,
    state: !packing ? "pending" : packingWorkDone ? "done" : (packing.status === "packing" ? "current" : "pending"),
    by: packing?.packer_name,
  };
  if (packing?.status === "waiting_stock") {
    packingStep.state = "current";
    packingStep.sub = "Awaiting stock";
  } else if (manufacturing_orders?.length > 0) {
    packingStep.sub = `${manufacturing_orders.length} item(s) awaiting production`;
  }
  steps.push(packingStep);

  if (packing && ["incomplete", "cancelled"].includes(packing.status)) {
    steps.push({
      key: "packing_halted",
      label: packing.status === "cancelled" ? "Packing Cancelled" : "Packing Incomplete",
      icon: X, state: "skipped", terminal: true, sub: packing.incomplete_reason,
    });
    return steps;
  }

  steps.push({
    key: "qa", label: "QA Approved", icon: ClipboardCheck,
    state: packing?.qa_approved_at ? "done" : (packingWorkDone || packing?.status === "packing" ? "current" : "pending"),
    at: packing?.qa_approved_at, by: packing?.qa_approved_by,
  });
  steps.push({
    key: "rp", label: "RP Approved", icon: ClipboardCheck,
    state: packing?.rp_approved_at ? "done" : (packing?.qa_approved_at ? "current" : "pending"),
    at: packing?.rp_approved_at, by: packing?.rp_approved_by,
  });
  steps.push({
    key: "ready", label: "Ready for Collection", icon: Truck,
    state: readyForCollection ? "done" : "pending",
    at: packing?.completed_at,
  });

  // The real "final" delivery invoice is only ever created in Odoo at
  // mark_complete, after QA+RP sign-off — its Odoo id is stamped onto
  // packing.invoice_id at that exact point (_create_final_invoice /
  // complete_entry in packing_board_routes.py), and ONLY then. Matching on
  // that id specifically, rather than assuming "the last invoice in the
  // array is the final one," is required, not just tidier: found live
  // 2026-08-27 — an order that reached "complete" but whose invoice
  // creation FAILED (see that file's own create_invoices() TypeError
  // incident) still has readyForCollection=true with only the already-paid
  // deposit invoice in `invoices`. "Last item in the array" picked that
  // deposit invoice, mistook it for the final one, and showed Balance
  // Payment Received as done before any balance had actually been
  // invoiced, let alone paid. No packing.invoice_id means no final invoice
  // exists yet, full stop — never fall back to guessing from the array.
  const finalInv = (readyForCollection && packing?.invoice_id)
    ? invoices?.find(i => i.invoice_id === packing.invoice_id)
    : null;

  if (finalInv) {
    steps.push({ key: "invoice", label: "Invoice Raised", icon: FileText, state: "done", at: finalInv.invoice_date, sub: finalInv.name });
    steps.push({
      key: "paid", label: finalInv.payment_state === "paid" ? "Balance Payment Received" : "Balance Payment Pending",
      icon: Check, state: finalInv.payment_state === "paid" ? "done" : "current",
    });
  } else {
    steps.push({ key: "invoice", label: "Invoice Raised", icon: FileText, state: "pending" });
    steps.push({ key: "paid", label: "Balance Payment Received", icon: Check, state: "pending" });
  }

  steps.push({
    key: "collected", label: "Collected", icon: CheckCircle2,
    state: packing?.collected_at ? "done" : (finalInv?.payment_state === "paid" || packing?.status === "complete" ? "current" : "pending"),
    at: packing?.collected_at, by: packing?.collected_by,
  });

  return steps;
}

const NODE_STYLE = {
  done:    "bg-bassani-600 border-bassani-600 text-white",
  current: "bg-white border-bassani-500 text-bassani-600 ring-4 ring-bassani-50",
  pending: "bg-white border-gray-200 text-gray-300",
  skipped: "bg-white border-red-200 text-red-400",
};
const LABEL_STYLE = {
  done: "text-gray-800", current: "text-bassani-700", pending: "text-gray-400", skipped: "text-red-600",
};

// ── Step collapse — buildTimelineSteps() tracks every operational sub-stage
// individually; this trims a couple that carry no independently useful
// state, so the strip stays scannable. Runs AFTER buildTimelineSteps()
// rather than duplicating its state logic — it only ever merges/drops nodes
// from that same already-computed array, so this view can never disagree
// about what state an order is actually in, only display it coarser.
export function collapseTimelineSteps(steps) {
  const byKey = Object.fromEntries(steps.map(s => [s.key, s]));
  const merge = (aKey, bKey, label) => {
    const a = byKey[aKey], b = byKey[bKey];
    if (!a || !b) return null;
    const state = b.state === "done" ? "done" : (a.state !== "pending" ? "current" : "pending");
    return {
      key: `${aKey}_${bKey}`, label, icon: b.icon,
      state, at: b.at || a.at, by: b.by || a.by,
      sub: state === "current" ? (b.sub || a.sub) : undefined,
    };
  };
  const result = [];
  for (const s of steps) {
    if (s.key === "rp" && byKey.qa) continue; // folded into the merge below
    if (s.key === "invoice") continue; // dropped — always "done" the instant any invoice exists, carries no state worth surfacing on its own
    if (s.key === "qa") { result.push(merge("qa", "rp", "Compliance Sign-Off") || s); continue; }
    result.push(s);
  }
  return result;
}

// ── Horizontal timeline — an at-a-glance lifecycle overview with future
// steps visibly greyed out, the familiar horizontal-stepper pattern
// (courier tracking, e-commerce order status). Shared by OrderPassport.js
// (every role) and SalesTickets.js (2026-08-26, replacing that page's
// separate reseller-only vertical stepper and staff-only Packing Status
// card) so every screen that shows an order's lifecycle agrees on its shape.
export function HorizontalTimelineCard({ order, ticket, packing, invoices, manufacturing_orders, onUploadPop, title = "Order Timeline" }) {
  const steps = collapseTimelineSteps(
    buildTimelineSteps({ order, ticket, packing, invoices, manufacturing_orders })
  );
  return (
    <div className="bg-white rounded-2xl shadow-sm border border-gray-100 p-4 sm:p-5">
      <p className="text-xs font-semibold text-gray-500 uppercase tracking-wide mb-4 flex items-center gap-1.5">
        <Clock size={12} />{title}
      </p>
      {/* Connectors are direct flex-grow siblings of the step blocks in this
          row — they were previously nested one level deeper, inside each
          step's own [block+connector] wrapper div, which had no flex-grow
          relative to this outer row, so the connector's flex-1 had no
          leftover space to expand into. Flattened so connectors properly
          compete for the row's real available width. */}
      <div className="flex items-start overflow-x-auto pb-1 -mx-1 px-1">
        {steps.map((s, i) => {
          const Icon = s.icon;
          const isLast = i === steps.length - 1;
          const connectorDone = s.state === "done";
          return (
            <Fragment key={s.key}>
              <div className="flex flex-col items-center text-center w-[84px] shrink-0">
                <div className={`w-8 h-8 rounded-full border-2 flex items-center justify-center shrink-0 ${NODE_STYLE[s.state]}`}>
                  {s.state === "done" ? <Check size={14} /> : s.state === "skipped" ? <X size={14} /> : <Icon size={14} />}
                </div>
                <p className={`text-[11px] font-semibold mt-1.5 leading-tight ${LABEL_STYLE[s.state]}`}>{s.label}</p>
                {/* Deposit step, currently awaiting Finance: surface a direct
                    call-to-action rather than passive "Awaiting Finance"
                    text, when the caller has one to offer (customer/reseller
                    self-service POP upload on Order Passport; omitted on
                    SalesTickets.js, which has no such upload trigger). */}
                {s.state === "current" && s.key === "deposit" && onUploadPop ? (
                  <button
                    onClick={onUploadPop}
                    className="text-[10px] font-semibold text-bassani-600 hover:text-bassani-800 underline underline-offset-2 mt-0.5 leading-tight"
                  >
                    Upload proof of payment
                  </button>
                ) : (
                  s.state === "current" && s.sub && (
                    <p className="text-[10px] text-bassani-600 mt-0.5 leading-tight">{s.sub}</p>
                  )
                )}
                {s.at && <p className="text-[10px] text-gray-400 mt-0.5">{fmtDate(s.at)}</p>}
                {/* Actor caption (2026-08-27) — already computed by
                    buildTimelineSteps() for Packing/QA/RP/Collected (packer
                    name, qa/rp approver, who marked collected) but never
                    rendered until now. Only shown once the step has actually
                    started (not "pending"), same gate as the date above. */}
                {s.by && s.state !== "pending" && (
                  <p className="text-[10px] text-gray-400 truncate max-w-[84px]" title={s.by}>by {s.by}</p>
                )}
              </div>
              {!isLast && (
                <div className={`h-0.5 flex-1 min-w-[20px] mt-4 ${connectorDone ? "bg-bassani-600" : "bg-gray-200"}`} />
              )}
            </Fragment>
          );
        })}
      </div>
    </div>
  );
}

// ── Activity Log — "who did what, when" (2026-08-27) ────────────────────────
// Extracted from SalesTickets.js's own inline "Timeline" card, which read a
// ticket's stage_history array directly — every ticket-level status push
// already carries a real actor_name (ticket create, confirm, deposit/balance
// payment registration, admin overrides, exit statuses), so this needed no
// new backend field, only fixing two write sites that had been hardcoding
// "system" regardless of who actually acted (_confirm_order_core,
// packing_board_routes.py's _sync_sales_ticket). A separate card from the
// HorizontalTimelineCard above on purpose: that one is a compact, sleek
// lifecycle-stage stepper (only 4 of its ~9 nodes carry a free actor caption
// via `by`); this one is the genuinely complete, chronological "who did
// what" record, scrollable rather than cramped into a stepper node.
//
// `labelFor` defaults to ticketStageLabel (this file's own status
// vocabulary) but SalesTickets.js passes its own richer STATUS_LABEL/
// EXIT_LABEL maps (e.g. "In Fulfilment" vs this file's "In Progress") so
// wording already established as this app's ticket-status copy on that page
// doesn't silently change just because the card was shared.
export function ActivityLogCard({ history = [], title = "Activity Log", labelFor = ticketStageLabel }) {
  const entries = (history || []).slice().reverse();
  return (
    <div className="bg-white rounded-2xl shadow-sm border border-gray-100 p-4">
      <p className="text-xs font-semibold text-gray-400 uppercase tracking-wide mb-3 flex items-center gap-1.5">
        <History size={12} />{title}
      </p>
      <div className="space-y-2.5 max-h-80 overflow-y-auto">
        {entries.length === 0 ? (
          <p className="text-xs text-gray-300">No activity yet.</p>
        ) : (
          entries.map((h, i) => (
            <div key={i} className="flex items-start gap-2 text-xs">
              <Clock size={12} className="text-gray-300 mt-0.5 shrink-0" />
              <div>
                <p className="text-gray-700">
                  <span className="font-medium">{h.actor_name}</span>
                  {" "}→ {labelFor({ status: h.status, exit_status: h.exit_status })}
                </p>
                {h.note && <p className="text-gray-400 mt-0.5">{h.note}</p>}
                <p className="text-gray-300 mt-0.5">{fmtDate(h.at)}</p>
              </div>
            </div>
          ))
        )}
      </div>
    </div>
  );
}
