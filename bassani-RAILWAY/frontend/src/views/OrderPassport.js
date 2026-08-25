import { useState, useEffect, useRef } from "react";
import { useParams, useNavigate, useLocation } from "react-router-dom";
import { useAuth } from "../AuthContext";
import api from "../api";
import toast from "react-hot-toast";
import {
  ChevronLeft, Package, FileText, Truck, FileSearch,
  CheckCircle2, Clock, ExternalLink, RefreshCw, Check, ClipboardCheck,
  Repeat, RotateCcw, Upload, Loader2, Factory, X, AlertTriangle, XCircle,
} from "lucide-react";
import {
  fmtDate, BtnSecondary, BtnPrimary, Modal,
  FormGroup, Input, Select, LoadingState, OdooPdfViewerModal, StatCard,
} from "../components/UI";
import RecurringOrderSetupModal from "../components/RecurringOrderSetupModal";

const fmtR = (n) =>
  `R ${(n || 0).toLocaleString("en-ZA", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;

// ── Odoo order state — matches OrderView.js terminology exactly ───────────────
const ODOO_STATE_LABEL = {
  draft:  "Quotation",
  sent:   "Quotation Sent",
  sale:   "Sales Order",
  done:   "Locked",
  cancel: "Cancelled",
};
const ODOO_STATE_STYLE = {
  draft:  "bg-amber-50 text-amber-700 border-amber-200",
  sent:   "bg-blue-50 text-blue-700 border-blue-200",
  sale:   "bg-green-50 text-green-700 border-green-200",
  done:   "bg-gray-100 text-gray-500 border-gray-200",
  cancel: "bg-red-50 text-red-700 border-red-200",
};

// ── Colour maps ───────────────────────────────────────────────────────────────
const STATUS_COLOURS = {
  green:  { bg: "bg-green-50",  border: "border-green-200",  text: "text-green-800",  dot: "bg-green-500"  },
  blue:   { bg: "bg-blue-50",   border: "border-blue-200",   text: "text-blue-800",   dot: "bg-blue-500"   },
  amber:  { bg: "bg-amber-50",  border: "border-amber-200",  text: "text-amber-800",  dot: "bg-amber-500"  },
  orange: { bg: "bg-orange-50", border: "border-orange-200", text: "text-orange-800", dot: "bg-orange-500" },
  red:    { bg: "bg-red-50",    border: "border-red-200",    text: "text-red-800",    dot: "bg-red-500"    },
  gray:   { bg: "bg-gray-50",   border: "border-gray-200",   text: "text-gray-600",   dot: "bg-gray-400"   },
  purple: { bg: "bg-purple-50", border: "border-purple-200", text: "text-purple-800", dot: "bg-purple-500" },
};

const PICKING_COLOUR = {
  done:      "bg-green-50 text-green-700",
  assigned:  "bg-blue-50 text-blue-700",
  confirmed: "bg-amber-50 text-amber-700",
  waiting:   "bg-orange-50 text-orange-700",
  cancel:    "bg-gray-100 text-gray-400",
};

const PAYMENT_COLOUR = {
  paid:       "bg-green-50 text-green-700",
  not_paid:   "bg-red-50 text-red-700",
  partial:    "bg-amber-50 text-amber-700",
  in_payment: "bg-blue-50 text-blue-700",
  reversed:   "bg-gray-100 text-gray-500",
};
const PAYMENT_LABEL = {
  paid: "Paid", not_paid: "Outstanding", partial: "Partially Paid",
  in_payment: "In Payment", reversed: "Reversed",
};

const PACK_COLOUR = {
  queued:    "bg-blue-50 text-blue-700",
  packing:   "bg-amber-50 text-amber-700",
  ready:     "bg-indigo-50 text-indigo-700",
  complete:  "bg-green-50 text-green-700",
  incomplete:"bg-orange-50 text-orange-700",
  cancelled: "bg-red-50 text-red-600",
  collected: "bg-teal-50 text-teal-700",
  cleared:   "bg-gray-100 text-gray-500",
  waiting_stock: "bg-orange-50 text-orange-700",
};
const PACK_LABEL = {
  queued: "Queued", packing: "Packing", ready: "Ready for Collection",
  complete: "Complete", incomplete: "Incomplete", cancelled: "Cancelled",
  collected: "Collected", cleared: "Cleared", waiting_stock: "Awaiting Stock",
};

const TICKET_STATUS_LABEL = {
  open: "Inquiry Open", quote: "Building Quote",
  sale_order: "Awaiting Deposit", awaiting_deposit: "Awaiting Deposit",
  invoice: "Invoice Raised", confirmed_wip: "In Progress",
  ready_for_collection: "Ready for Collection", incomplete: "Incomplete",
  queued: "Queued for Packing", packing: "Being Packed", waiting_stock: "Awaiting Stock",
};

function ticketStageLabel(ticket) {
  return ticket.exit_status
    ? ticket.exit_status.charAt(0).toUpperCase() + ticket.exit_status.slice(1).replace(/_/g, " ")
    : (TICKET_STATUS_LABEL[ticket.status] || ticket.status || "");
}
function ticketStageColor(ticket) {
  if (ticket.exit_status === "complete") return "green";
  if (ticket.exit_status) return "red";
  if (["confirmed_wip", "ready_for_collection"].includes(ticket.status)) return "green";
  if (["queued", "packing"].includes(ticket.status)) return "blue";
  return "amber";
}

function StatusBadge({ overall }) {
  const c = STATUS_COLOURS[overall.color] || STATUS_COLOURS.gray;
  return (
    <div className={`inline-flex items-center gap-2 px-3 py-1.5 rounded-full border text-sm font-semibold ${c.bg} ${c.border} ${c.text}`}>
      <span className={`w-2 h-2 rounded-full ${c.dot}`} />
      {overall.label}
    </div>
  );
}

function StagePill({ color, children }) {
  const c = STATUS_COLOURS[color] || STATUS_COLOURS.gray;
  return (
    <span className={`inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-[11px] font-semibold border ${c.bg} ${c.border} ${c.text}`}>
      <span className={`w-1.5 h-1.5 rounded-full shrink-0 ${c.dot}`} />
      {children}
    </span>
  );
}

// ── Timeline ─────────────────────────────────────────────────────────────────
// The "passport" is a stamped chronological record — this is the single
// authoritative telling of the order's story, replacing what used to be four
// separately-computed, partly-redundant status widgets (pipeline stepper +
// status-pill rail + duplicated stage text in every card). Built only from
// fields the API already returns — never invents a timestamp it doesn't have.
function buildTimelineSteps({ order, ticket, packing, invoices, manufacturing_orders }) {
  const steps = [];
  const inv = invoices?.[0];

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
  // deposit not yet registered. Missing "awaiting_deposit" from this check
  // was a real bug (found 2026-08-25) that showed Deposit Registered as
  // already done the moment an order was confirmed, before Finance had
  // touched it.
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

  if (!packing) return steps;

  steps.push({ key: "queued", label: "Queued for Packing", icon: Package, state: "done" });

  const packingDone = ["ready", "complete", "collected"].includes(packing.status);
  const packingStep = {
    key: "packing", label: "Packing", icon: Package,
    state: packingDone ? "done" : (packing.status === "packing" ? "current" : "pending"),
    by: packing.packer_name,
  };
  if (packing.status === "waiting_stock") {
    packingStep.state = "current";
    packingStep.sub = "Awaiting stock";
  } else if (manufacturing_orders?.length > 0) {
    packingStep.sub = `${manufacturing_orders.length} item(s) awaiting production`;
  }
  steps.push(packingStep);

  if (["incomplete", "cancelled"].includes(packing.status)) {
    steps.push({
      key: "packing_halted",
      label: packing.status === "cancelled" ? "Packing Cancelled" : "Packing Incomplete",
      icon: X, state: "skipped", terminal: true, sub: packing.incomplete_reason,
    });
    return steps;
  }

  steps.push({
    key: "qa", label: "QA Approved", icon: ClipboardCheck,
    state: packing.qa_approved_at ? "done" : (packingDone || packing.status === "packing" ? "current" : "pending"),
    at: packing.qa_approved_at, by: packing.qa_approved_by,
  });
  steps.push({
    key: "rp", label: "RP Approved", icon: ClipboardCheck,
    state: packing.rp_approved_at ? "done" : (packing.qa_approved_at ? "current" : "pending"),
    at: packing.rp_approved_at, by: packing.rp_approved_by,
  });
  steps.push({
    key: "ready", label: "Ready for Collection", icon: Truck,
    state: packingDone ? "done" : "pending",
    at: packing.completed_at,
  });

  if (inv) {
    steps.push({ key: "invoice", label: "Invoice Raised", icon: FileText, state: "done", at: inv.invoice_date, sub: inv.name });
    steps.push({
      key: "paid", label: inv.payment_state === "paid" ? "Payment Received" : "Payment Pending",
      icon: Check, state: inv.payment_state === "paid" ? "done" : "current",
    });
  } else if (packingDone) {
    steps.push({ key: "invoice", label: "Invoice Raised", icon: FileText, state: "pending" });
  }

  steps.push({
    key: "collected", label: "Collected", icon: CheckCircle2,
    state: packing.collected_at ? "done" : (inv?.payment_state === "paid" || packing.status === "ready" ? "current" : "pending"),
    at: packing.collected_at, by: packing.collected_by,
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

function TimelineCard({ order, ticket, packing, invoices, manufacturing_orders }) {
  const steps = buildTimelineSteps({ order, ticket, packing, invoices, manufacturing_orders });
  return (
    <div className="bg-white rounded-2xl shadow-sm border border-gray-100 p-4 sm:p-5">
      <p className="text-xs font-semibold text-gray-500 uppercase tracking-wide mb-4 flex items-center gap-1.5">
        <Clock size={12} />Order Timeline
      </p>
      <div>
        {steps.map((s, i) => {
          const Icon = s.icon;
          const isLast = i === steps.length - 1;
          const connectorDone = s.state === "done";
          return (
            <div key={s.key} className="flex gap-3">
              <div className="flex flex-col items-center">
                <div className={`w-7 h-7 rounded-full border-2 flex items-center justify-center shrink-0 ${NODE_STYLE[s.state]}`}>
                  {s.state === "done" ? <Check size={13} /> : s.state === "skipped" ? <X size={13} /> : <Icon size={13} />}
                </div>
                {!isLast && <div className={`w-0.5 flex-1 min-h-[1.25rem] my-0.5 ${connectorDone ? "bg-bassani-600" : "bg-gray-200"}`} />}
              </div>
              <div className={`min-w-0 ${isLast ? "pb-0" : "pb-4"} flex-1`}>
                <div className="flex flex-wrap items-baseline justify-between gap-x-3 gap-y-0.5">
                  <p className={`text-sm font-semibold ${LABEL_STYLE[s.state]}`}>{s.label}</p>
                  {s.at && <span className="text-xs text-gray-400 shrink-0">{fmtDate(s.at)}</span>}
                </div>
                {s.sub && <p className="text-xs text-gray-500 mt-0.5">{s.sub}</p>}
                {s.by && <p className="text-xs text-gray-400 mt-0.5">by {s.by}</p>}
              </div>
            </div>
          );
        })}
      </div>
    </div>
  );
}

// ── Horizontal timeline (2026-08-25) — reseller/customer variant of
// TimelineCard above, same buildTimelineSteps() data so the two never
// disagree about what stage an order is at. A vertical, date-and-note-heavy
// timeline suits staff working the pipeline; a customer just wants an
// at-a-glance lifecycle overview with future steps visibly greyed out, the
// familiar horizontal-stepper pattern (courier tracking, e-commerce order
// status). Only the current step's "sub" note is shown, to keep the strip
// compact rather than repeating detail every step already carries on its
// own sidebar card (Packing, Invoice, etc).
function HorizontalTimelineCard({ order, ticket, packing, invoices, manufacturing_orders }) {
  const steps = buildTimelineSteps({ order, ticket, packing, invoices, manufacturing_orders });
  return (
    <div className="bg-white rounded-2xl shadow-sm border border-gray-100 p-4 sm:p-5">
      <p className="text-xs font-semibold text-gray-500 uppercase tracking-wide mb-4 flex items-center gap-1.5">
        <Clock size={12} />Order Timeline
      </p>
      <div className="flex items-start overflow-x-auto pb-1 -mx-1 px-1">
        {steps.map((s, i) => {
          const Icon = s.icon;
          const isLast = i === steps.length - 1;
          const connectorDone = s.state === "done";
          return (
            <div key={s.key} className="flex items-start">
              <div className="flex flex-col items-center text-center w-[84px] shrink-0">
                <div className={`w-8 h-8 rounded-full border-2 flex items-center justify-center shrink-0 ${NODE_STYLE[s.state]}`}>
                  {s.state === "done" ? <Check size={14} /> : s.state === "skipped" ? <X size={14} /> : <Icon size={14} />}
                </div>
                <p className={`text-[11px] font-semibold mt-1.5 leading-tight ${LABEL_STYLE[s.state]}`}>{s.label}</p>
                {s.state === "current" && s.sub && (
                  <p className="text-[10px] text-bassani-600 mt-0.5 leading-tight">{s.sub}</p>
                )}
                {s.at && <p className="text-[10px] text-gray-400 mt-0.5">{fmtDate(s.at)}</p>}
              </div>
              {!isLast && (
                <div className={`h-0.5 flex-1 min-w-[20px] mt-4 ${connectorDone ? "bg-bassani-600" : "bg-gray-200"}`} />
              )}
            </div>
          );
        })}
      </div>
    </div>
  );
}

// ── QA / RP approval row ──────────────────────────────────────────────────────
function ApprovalRow({ label, by, at }) {
  return (
    <div className="flex items-center justify-between py-1.5 border-b border-gray-50 last:border-0 gap-2">
      <span className="text-xs text-gray-500 shrink-0">{label}</span>
      {at ? (
        <div className="text-right min-w-0">
          <span className="flex items-center gap-1 text-xs text-green-700 font-medium justify-end">
            <Check size={10} />Approved
          </span>
          {by && <p className="text-[10px] text-gray-400 truncate">{by}</p>}
        </div>
      ) : (
        <span className="text-xs text-amber-600 font-medium shrink-0">Pending</span>
      )}
    </div>
  );
}

// ── Sidebar card shell ─────────────────────────────────────────────────────────
function SideCard({ icon: Icon, title, action, children }) {
  return (
    <div className="bg-white rounded-2xl shadow-sm border border-gray-100 p-4 space-y-3">
      <div className="flex items-center justify-between">
        <p className="text-xs font-semibold text-gray-500 uppercase tracking-wide flex items-center gap-1.5">
          <Icon size={12} />{title}
        </p>
        {action}
      </div>
      {children}
    </div>
  );
}

// ── Main component ────────────────────────────────────────────────────────────
export default function OrderPassport() {
  const { orderId } = useParams();
  const navigate    = useNavigate();
  const location    = useLocation();
  const { can, user } = useAuth();
  const isReseller  = user?.role === "reseller";
  const isCustomer  = user?.role === "customer";

  const [data,    setData   ] = useState(null);
  const [loading, setLoading] = useState(true);

  // Odoo-native PDF viewer — one shared modal for whichever document (quote,
  // a specific delivery slip) was last requested.
  const [pdfView, setPdfView] = useState(null); // {url, title} | null

  // Make Recurring (2026-08-21) — same modal/endpoint reseller/staff already
  // use from SalesTickets.js, now also reachable from the customer's own
  // Order Passport since a customer has no access to the ticket pipeline UI.
  const [recurringModalOpen, setRecurringModalOpen] = useState(false);

  // Reorder (2026-08-21) — prefills a fresh cart from this order's line
  // items and hands off to the cart, which re-fetches current pricing/stock
  // for each product rather than reusing this order's (possibly stale) ones.
  const doReorder = () => {
    const lines = (data.order.lines || [])
      .filter(l => l.product_id)
      .map(l => ({ product_id: Array.isArray(l.product_id) ? l.product_id[0] : l.product_id, qty: l.product_uom_qty }));
    if (lines.length === 0) return toast.error("No line items to reorder");
    const p = data.order.partner_id;
    navigate("/orders", {
      state: {
        reorderLines: lines,
        reorderCustomer: p ? { id: p[0], name: p[1] } : null,
      },
    });
  };

  // Proof of Payment upload (2026-08-21) — evidence and a trigger only;
  // Finance still explicitly registers the deposit/balance payment
  // afterward via the existing ticket-pipeline flow, this just gets it in
  // front of them faster than being told outside the portal.
  const popFileInputRef = useRef(null);
  const [popUploading, setPopUploading] = useState(false);
  const [popViewingId, setPopViewingId] = useState(null);

  const handlePopUpload = async (file) => {
    const ticketId = data?.ticket?.ticket_id;
    if (!file || !ticketId) return;
    setPopUploading(true);
    try {
      const form = new FormData();
      form.append("file", file);
      await api.post(`/api/tickets/${ticketId}/pop`, form, {
        headers: { "Content-Type": "multipart/form-data" },
      });
      toast.success("Proof of payment uploaded");
      load();
    } catch (e) {
      toast.error(e.response?.data?.detail || "Failed to upload file");
    } finally {
      setPopUploading(false);
      if (popFileInputRef.current) popFileInputRef.current.value = "";
    }
  };

  const viewPop = async (uploadId) => {
    const ticketId = data?.ticket?.ticket_id;
    if (!ticketId) return;
    setPopViewingId(uploadId);
    try {
      const { data: res } = await api.get(`/api/tickets/${ticketId}/pop/${uploadId}/download`);
      window.open(res.url, "_blank", "noopener,noreferrer");
    } catch (e) {
      toast.error(e.response?.data?.detail || "Failed to open file");
    } finally {
      setPopViewingId(null);
    }
  };

  // Create ticket
  const [creatingTicket,      setCreatingTicket     ] = useState(false);
  const [ticketPreflightModal, setTicketPreflightModal] = useState(null);

  const createTicket = async () => {
    setCreatingTicket(true);
    try {
      const pf = await api.get("/api/tickets/from-order/preflight", { params: { order_id: parseInt(orderId) } });
      const data = pf.data;
      if (data.has_linked_ticket || data.unlinked_tickets?.length > 0) {
        setTicketPreflightModal(data);
        return;
      }
      const r = await api.post("/api/tickets/from-order", { order_id: parseInt(orderId) });
      toast.success("Sales ticket created");
      navigate("/tickets/sales", { state: { openTicketId: r.data.ticket_id } });
    } catch (e) {
      toast.error(e.response?.data?.detail || "Failed to create ticket");
    } finally {
      setCreatingTicket(false);
    }
  };

  const doCreateTicketFromPreflight = async () => {
    setTicketPreflightModal(null);
    setCreatingTicket(true);
    try {
      const r = await api.post("/api/tickets/from-order", { order_id: parseInt(orderId) });
      toast.success("Sales ticket created");
      navigate("/tickets/sales", { state: { openTicketId: r.data.ticket_id } });
    } catch (e) {
      const detail = e.response?.data?.detail;
      const existingId = typeof detail === "object" ? detail?.existing_ticket_id : null;
      if (existingId) {
        navigate("/tickets/sales", { state: { openTicketId: existingId } });
      } else {
        toast.error((typeof detail === "object" ? detail?.message : detail) || "Failed to create ticket");
      }
    } finally {
      setCreatingTicket(false);
    }
  };

  const doLinkUnlinkedTicket = async (ticketId) => {
    setTicketPreflightModal(null);
    try {
      await api.post(`/api/tickets/${ticketId}/link-order`, { order_id: parseInt(orderId) });
      toast.success("Existing ticket linked to order");
      navigate("/tickets/sales", { state: { openTicketId: ticketId } });
    } catch (e) {
      toast.error(e.response?.data?.detail || "Failed to link ticket");
    }
  };

  // Packing board — open the per-warehouse display screen in a new tab
  const [packingBoardLoading, setPackingBoardLoading] = useState(false);
  const openPackingBoard = async () => {
    setPackingBoardLoading(true);
    try {
      const warehouseId = data?.packing?.warehouse_id;
      let tokenRes;
      if (warehouseId) {
        tokenRes = await api.get(`/api/warehouses/${warehouseId}/display-token`);
      } else {
        const defRes = await api.get("/api/settings/default-warehouse");
        const defId = defRes.data.warehouse_id;
        if (!defId) { toast.error("No default warehouse configured in Settings"); return; }
        tokenRes = await api.get(`/api/warehouses/${defId}/display-token`);
      }
      const token = tokenRes?.data?.token;
      if (!token) { toast.error("No packing board screen configured for this warehouse — generate a token in Settings > Warehouses"); return; }
      window.open(`${window.location.origin}/packing-board.html?token=${token}`, "_blank");
    } catch {
      toast.error("Failed to load packing board");
    } finally {
      setPackingBoardLoading(false);
    }
  };

  // Register payment — tracks which invoice is being paid
  const [payingInvoice, setPayingInvoice] = useState(null);
  const [payJournals,   setPayJournals  ] = useState([]);
  const [payForm,       setPayForm      ] = useState({ amount: "", date: "", journal_id: "" });
  const [paySaving,     setPaySaving    ] = useState(false);

  const openPayModal = async (inv) => {
    setPayingInvoice(inv);
    setPayForm({
      amount:     String(inv.amount_residual || inv.amount_total || ""),
      date:       new Date().toISOString().split("T")[0],
      journal_id: "",
    });
    try {
      const r = await api.get("/api/invoices/payment-journals");
      const journals = r.data.journals || [];
      setPayJournals(journals);
      if (journals.length > 0) setPayForm(f => ({ ...f, journal_id: String(journals[0].id) }));
    } catch { setPayJournals([]); }
  };

  const registerPayment = async () => {
    if (!payingInvoice) return;
    if (!payForm.journal_id) return toast.error("Select a payment journal");
    if (!payForm.amount || Number(payForm.amount) <= 0) return toast.error("Enter a valid amount");
    setPaySaving(true);
    try {
      await api.put(`/api/invoices/${payingInvoice.invoice_id}/pay`, {
        journal_id:   parseInt(payForm.journal_id),
        payment_date: payForm.date || undefined,
        amount:       parseFloat(payForm.amount),
      });
      toast.success("Payment registered");
      setPayingInvoice(null);
      load();
    } catch (e) {
      toast.error(e.response?.data?.detail || "Payment failed");
    } finally {
      setPaySaving(false);
    }
  };

  // Confirm Order (2026-08-25) — reseller/customer's "My Orders" list now
  // routes here for the order detail (previously the OrderView.js invoice
  // mockup), so Passport needs its own confirm entry point for a still-draft
  // order (e.g. one placed via Save as Draft). Ported from Views.js::Orders()'s
  // stock-check-first flow. Reseller gets the same "Confirm Anyway" credit
  // override SalesTickets.js's staff/reseller confirm already offers; a
  // customer does not and is told to contact Bassani instead (Phase 25
  // convention, unchanged from the old OrderView-based flow).
  const [confirming,        setConfirming       ] = useState(false);
  const [stockCheckModal,   setStockCheckModal  ] = useState(false);
  const [stockCheckData,    setStockCheckData   ] = useState(null);
  const [creditOverrideMsg, setCreditOverrideMsg] = useState(null);

  const doConfirmOrder = async (skipStockCheck = false, overrideCredit = false) => {
    if (!data?.order?.id) return;
    if (!skipStockCheck) {
      setConfirming(true);
      try {
        const { data: sc } = await api.get(`/api/orders/${data.order.id}/stock-check`);
        setStockCheckData(sc);
        setStockCheckModal(true);
      } catch {
        setStockCheckModal(false);
        await doConfirmOrder(true);
        return;
      } finally {
        setConfirming(false);
      }
      return;
    }
    setConfirming(true);
    try {
      await api.put(
        `/api/orders/${data.order.id}/confirm`,
        null,
        { params: overrideCredit ? { override_credit: true } : {} },
      );
      toast.success("Order confirmed. You'll receive an email shortly with your 50% deposit invoice.");
      setStockCheckModal(false);
      setStockCheckData(null);
      setCreditOverrideMsg(null);
      load();
    } catch (e) {
      if (e.response?.status === 402) {
        setStockCheckModal(false);
        if (isReseller) {
          setCreditOverrideMsg(e.response.data?.detail || "This order is over the customer's credit limit.");
        } else {
          toast.error(e.response.data?.detail || "This order is over your credit limit. Please contact Bassani to proceed.", { duration: 10000 });
        }
      } else {
        toast.error(e.response?.data?.detail || "Failed to confirm order");
      }
    } finally {
      setConfirming(false);
    }
  };

  const load = async () => {
    setLoading(true);
    try {
      const [passportRes, deliveriesRes] = await Promise.all([
        api.get(`/api/orders/${orderId}/passport`),
        api.get(`/api/orders/${orderId}/deliveries`),
      ]);
      setData({
        ...passportRes.data,
        deliveries: deliveriesRes.data.deliveries || [],
      });
    } catch (e) {
      const d = e.response?.data?.detail;
      toast.error(typeof d === "string" ? d : "Failed to load order");
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => { load(); }, [orderId]); // eslint-disable-line

  const goBack = () => {
    if (location.key !== "default") navigate(-1);
    else navigate("/orders");
  };

  if (loading) return (
    <div className="flex flex-col h-full">
      <div className="flex items-center gap-3 px-6 py-3 bg-white border-b border-gray-200 shrink-0">
        <button onClick={goBack} className="flex items-center gap-1.5 text-sm text-gray-500 hover:text-gray-800">
          <ChevronLeft size={14} />Back
        </button>
      </div>
      <LoadingState message="Loading order passport…" />
    </div>
  );

  if (!data) return null;

  const { order, ticket, packing, invoices = [], deliveries, lot_map, product_images = {}, manufacturing_orders, overall_status } = data;
  const partner            = order.partner_detail || {};
  const hasPartialDelivery = deliveries.some(d => d.state === "done");
  const outstandingLines   = (order.lines || []).filter(
    l => hasPartialDelivery && (l.qty_delivered || 0) < (l.product_uom_qty || 0)
  );
  const hasBackorder =
    deliveries.some(d => d.is_backorder) ||
    packing?.status === "waiting_stock" ||
    (hasPartialDelivery && outstandingLines.length > 0);

  // KPI tiles — computed once, not re-derived per render inside JSX.
  const outstandingTotal = invoices.length > 0
    ? invoices.reduce((s, i) => s + (i.amount_residual || 0), 0)
    : null;
  const totalOrderedQty   = (order.lines || []).reduce((s, l) => s + (l.product_uom_qty || 0), 0);
  const totalDeliveredQty = (order.lines || []).reduce((s, l) => s + (l.qty_delivered || 0), 0);
  const fulfilPct = totalOrderedQty > 0 ? Math.round((totalDeliveredQty / totalOrderedQty) * 100) : null;

  return (
    <div className="flex flex-col h-full overflow-hidden">
      {/* Toolbar */}
      <div className="flex items-center justify-between px-6 py-3 bg-white border-b border-gray-200 shrink-0">
        <button onClick={goBack}
          className="flex items-center gap-1.5 text-sm text-gray-500 hover:text-gray-800 transition-colors">
          <ChevronLeft size={14} />Back
        </button>
        <div className="flex items-center gap-2">
          {/* Confirm Order (2026-08-25) — a draft order (e.g. placed via Save
              as Draft) previously had no confirm path on Passport at all; it
              only existed inside the OrderView.js modal the order list no
              longer opens for this role. Stays in the toolbar (not the new
              Actions card below) since it's urgent/primary for a draft order,
              not a routine management action like Reorder/Make Recurring. */}
          {(isReseller || isCustomer) && order.state === "draft" && (
            <BtnPrimary onClick={() => doConfirmOrder(false)} loading={confirming}>
              <CheckCircle2 size={13} />Confirm Order
            </BtnPrimary>
          )}
          {/* Reorder / Make Recurring moved into the sidebar Actions card
              (2026-08-25, in place of the internal-only Sales Ticket card for
              this role) — kept toolbar down to just Confirm Order + document
              viewers, which is where a customer actually looks first. */}
          {/* Proof of Payment upload (2026-08-21) — moved out of the toolbar
              into its own card below (with room to explain it's optional),
              rather than a bare button here with no context. */}
          <input
            ref={popFileInputRef}
            type="file"
            accept="image/*,.pdf"
            className="hidden"
            onChange={e => handlePopUpload(e.target.files?.[0])}
          />
          {/* Pro-Forma Invoice viewer moved into the Invoice(s) sidebar card
              (2026-08-25) — that's where a customer actually looks for order
              billing documents, and it fills the "no invoice yet" gap there
              with something real to show instead of a bare empty state. */}
          <BtnSecondary onClick={() => setPdfView({ url: `/api/orders/${orderId}/quote-pdf`, title: `${order.name} — Quotation` })}>
            <FileSearch size={13} /><span className="hidden sm:inline">{(isReseller || isCustomer) ? "View Quotation" : "View Quote (Odoo)"}</span>
          </BtnSecondary>
          <BtnSecondary onClick={load}>
            <RefreshCw size={13} /><span className="hidden sm:inline">Refresh</span>
          </BtnSecondary>
        </div>
      </div>

      {/* Body */}
      <div className="flex-1 overflow-y-auto py-6 px-4">
        <div className="max-w-6xl mx-auto w-full">

          {/* ── Hero card ───────────────────────────────────────────────────── */}
          <div className="bg-white rounded-2xl shadow-sm border border-gray-100 p-5 lg:p-6 mb-4">
            <div className="flex flex-wrap items-start justify-between gap-3 mb-4">
              <div>
                <p className="text-xs text-gray-400 mb-0.5">Order Reference</p>
                <div className="flex items-center gap-2 flex-wrap">
                  <h1 className="text-2xl sm:text-3xl font-mono font-bold text-gray-900">{order.name}</h1>
                  <span className={`text-[11px] font-semibold px-2 py-0.5 rounded-full border ${ODOO_STATE_STYLE[order.state] || "bg-gray-50 text-gray-500 border-gray-200"}`}>
                    {ODOO_STATE_LABEL[order.state] || order.state}
                  </span>
                </div>
                <p className="text-sm text-gray-600 mt-1">
                  {order.partner_id?.[1] || "Unknown customer"}
                  {partner.email && <span className="text-gray-400 ml-2">· {partner.email}</span>}
                </p>
              </div>
              <div className="text-right">
                <StatusBadge overall={overall_status} />
                <p className="text-xs text-gray-400 mt-1.5 max-w-[220px]">{overall_status.detail}</p>
              </div>
            </div>

            {/* KPI stat tiles */}
            <div className="grid grid-cols-2 sm:grid-cols-4 gap-3 mb-4">
              <StatCard label="Order Total" value={fmtR(order.amount_total)} />
              <StatCard
                label="Outstanding"
                value={outstandingTotal === null ? "—" : fmtR(outstandingTotal)}
                accent={outstandingTotal > 0 ? "text-red-600" : outstandingTotal === 0 ? "text-green-700" : undefined}
              />
              <StatCard label="Items" value={order.lines?.length || 0} />
              <StatCard
                label="Fulfilled"
                value={fulfilPct === null ? "—" : `${fulfilPct}%`}
                accent={fulfilPct === 100 ? "text-green-700" : fulfilPct >= 1 ? "text-amber-600" : undefined}
              />
            </div>

            {/* Meta row */}
            <div className="flex flex-wrap gap-x-6 gap-y-1 text-xs text-gray-500 border-t border-gray-50 pt-3">
              {order.date_order   && <span>Date: <span className="text-gray-700 font-medium">{fmtDate(order.date_order)}</span></span>}
              {order.payment_term_id && <span>Terms: <span className="text-gray-700 font-medium">{order.payment_term_id[1]}</span></span>}
              {partner.phone     && <span>Phone: <span className="text-gray-700 font-medium">{partner.phone}</span></span>}
              {partner.vat       && <span>VAT: <span className="text-gray-700 font-medium">{partner.vat}</span></span>}
            </div>
          </div>

          {/* ── Two-column body: record (timeline/lines/deliveries) + sidebar ─── */}
          <div className="grid grid-cols-1 lg:grid-cols-[1fr_360px] gap-4 items-start">

            {/* Main column */}
            <div className="space-y-4 min-w-0">
              {(isReseller || isCustomer) ? (
                <HorizontalTimelineCard order={order} ticket={ticket} packing={packing} invoices={invoices} manufacturing_orders={manufacturing_orders} />
              ) : (
                <TimelineCard order={order} ticket={ticket} packing={packing} invoices={invoices} manufacturing_orders={manufacturing_orders} />
              )}

              {/* ── Order lines ──────────────────────────────────────────────── */}
              {order.lines?.length > 0 && (
                <div className="bg-white rounded-2xl shadow-sm border border-gray-100 p-4">
                  <p className="text-xs font-semibold text-gray-500 uppercase tracking-wide mb-3 flex items-center gap-1.5">
                    <ClipboardCheck size={12} />Order Lines
                  </p>
                  <div className="overflow-x-auto">
                    <table className="w-full text-xs">
                      <thead>
                        <tr className="border-b border-gray-100">
                          <th className="text-left text-gray-400 font-semibold pb-2 uppercase tracking-wide">Product</th>
                          <th className="text-right text-gray-400 font-semibold pb-2 uppercase tracking-wide w-16">Ordered</th>
                          <th className="text-right text-gray-400 font-semibold pb-2 uppercase tracking-wide w-20">Delivered</th>
                          <th className="text-right text-gray-400 font-semibold pb-2 uppercase tracking-wide hidden sm:table-cell">Unit Price</th>
                          <th className="text-right text-gray-400 font-semibold pb-2 uppercase tracking-wide">Subtotal</th>
                        </tr>
                      </thead>
                      <tbody className="divide-y divide-gray-50">
                        {order.lines.map((line, i) => {
                          const pid           = line.product_id?.[0];
                          const lots          = pid && lot_map[pid] ? lot_map[pid] : [];
                          const thumb         = pid && product_images[pid];
                          const ordered       = line.product_uom_qty || 0;
                          const delivered     = line.qty_delivered   || 0;
                          const isOutstanding = hasPartialDelivery && delivered < ordered;
                          return (
                            <tr
                              key={i}
                              className={`${isOutstanding ? "bg-orange-50/40 cursor-pointer hover:bg-orange-100/60 transition-colors" : ""}`}
                              onClick={isOutstanding ? () => navigate("/orders/backorders", { state: { soName: order.name } }) : undefined}
                            >
                              <td className="py-2 pr-3">
                                <div className="flex items-start gap-2.5">
                                  {thumb ? (
                                    <img src={`data:image/png;base64,${thumb}`} alt=""
                                      className="w-9 h-9 rounded-lg object-cover border border-gray-100 shrink-0" />
                                  ) : (
                                    <div className="w-9 h-9 rounded-lg bg-gray-100 flex items-center justify-center text-gray-300 border border-gray-100 shrink-0">
                                      <Package size={14} />
                                    </div>
                                  )}
                                  <div className="min-w-0">
                                    <p className="text-gray-800 font-medium leading-snug">{line.name || line.product_id?.[1]}</p>
                                    {lots.length > 0 && (
                                      <p className="font-mono text-[10px] text-bassani-600 mt-0.5">Batch: {lots.join(", ")}</p>
                                    )}
                                    {isOutstanding && (
                                      <span className="inline-block mt-0.5 text-[10px] font-semibold text-orange-700 bg-orange-100 px-1.5 py-0.5 rounded-full">
                                        {ordered - delivered} outstanding
                                      </span>
                                    )}
                                  </div>
                                </div>
                              </td>
                              <td className="py-2 text-right tabular-nums text-gray-700 align-top">{ordered}</td>
                              <td className="py-2 text-right tabular-nums align-top">
                                <span className={delivered >= ordered ? "text-green-700 font-medium" : "text-orange-600 font-medium"}>
                                  {delivered}
                                </span>
                                {delivered >= ordered && ordered > 0 && (
                                  <Check size={10} className="inline ml-1 text-green-500" />
                                )}
                              </td>
                              <td className="py-2 text-right tabular-nums text-gray-600 hidden sm:table-cell align-top">{fmtR(line.price_unit)}</td>
                              <td className="py-2 text-right tabular-nums font-medium text-gray-800 align-top">{fmtR(line.price_subtotal)}</td>
                            </tr>
                          );
                        })}
                      </tbody>
                      <tfoot>
                        <tr className="border-t-2 border-gray-200">
                          <td colSpan={4} className="pt-2 text-right text-gray-500 font-semibold uppercase tracking-wide text-[10px] pr-3 hidden sm:table-cell">Total</td>
                          <td colSpan={2} className="pt-2 text-right text-gray-500 font-semibold uppercase tracking-wide text-[10px] pr-3 sm:hidden">Total</td>
                          <td className="pt-2 text-right tabular-nums font-bold text-gray-900">{fmtR(order.amount_total)}</td>
                        </tr>
                      </tfoot>
                    </table>
                  </div>
                </div>
              )}

              {/* ── Delivery & Fulfilment ────────────────────────────────────── */}
              <div className="bg-white rounded-2xl shadow-sm border border-gray-100 p-4 space-y-3">
                <p className="text-xs font-semibold text-gray-500 uppercase tracking-wide flex items-center gap-1.5">
                  <Truck size={12} />Delivery & Fulfilment
                  {hasBackorder && (
                    <span className="ml-auto text-[10px] bg-orange-50 text-orange-600 border border-orange-100 px-1.5 py-0.5 rounded-full font-semibold normal-case tracking-normal">
                      Backorders present
                    </span>
                  )}
                </p>
                {deliveries.length === 0 ? (
                  <p className="text-xs text-gray-400 py-2">No deliveries created yet.</p>
                ) : (
                  <div className="space-y-3">
                    {deliveries.map(d => {
                      const colour = PICKING_COLOUR[d.state] || "bg-gray-100 text-gray-500";
                      return (
                        <div key={d.id} className="border border-gray-100 rounded-xl p-3 space-y-2">
                          <div className="flex flex-wrap items-center gap-2">
                            <span className="font-mono text-xs font-semibold text-gray-800">{d.name}</span>
                            {d.is_backorder && (
                              <span className="text-[10px] bg-orange-50 text-orange-600 border border-orange-100 px-1.5 py-0.5 rounded-full font-semibold">
                                Backorder
                              </span>
                            )}
                            {d.backorder_ref && (
                              <span className="text-[10px] text-gray-400">of {d.backorder_ref}</span>
                            )}
                            <span className={`text-[10px] px-2 py-0.5 rounded-full font-semibold ${colour}`}>
                              {d.state_label}
                            </span>
                            <button
                              onClick={() => setPdfView({ url: `/api/orders/${orderId}/deliveries/${d.id}/pdf`, title: `${d.name} — Odoo delivery slip` })}
                              className="flex items-center gap-1 text-[10px] font-semibold text-bassani-600 hover:text-bassani-700"
                            >
                              <FileSearch size={11} />Slip
                            </button>
                            {d.date_done && (
                              <span className="text-xs text-gray-400 ml-auto">Delivered {fmtDate(d.date_done)}</span>
                            )}
                            {d.scheduled_date && d.state !== "done" && (
                              <span className="text-xs text-gray-400 ml-auto">Expected {fmtDate(d.scheduled_date)}</span>
                            )}
                          </div>
                          {d.lines.length > 0 && (
                            <div className="space-y-0.5 border-t border-gray-50 pt-2">
                              {d.lines.map((l, i) => {
                                const lots = lot_map[l.product_id] || [];
                                const outstanding = l.qty_done < l.qty_ordered;
                                return (
                                  <div key={i} className="flex items-start gap-2 text-xs text-gray-500">
                                    <span className="flex-1 truncate">{l.product_name}</span>
                                    <span className={`shrink-0 tabular-nums ${outstanding ? "text-orange-600 font-medium" : ""}`}>
                                      {l.qty_done}/{l.qty_ordered}
                                      {outstanding && <span className="ml-1 text-[10px]">({l.qty_ordered - l.qty_done} outstanding)</span>}
                                    </span>
                                    {lots.length > 0 && (
                                      <span className="shrink-0 font-mono text-[10px] text-bassani-600 bg-bassani-50 px-1.5 py-0.5 rounded">
                                        {lots.join(", ")}
                                      </span>
                                    )}
                                  </div>
                                );
                              })}
                            </div>
                          )}
                        </div>
                      );
                    })}
                  </div>
                )}
              </div>
            </div>

            {/* Sidebar — status/action cards, sticky on desktop */}
            <div className="space-y-4 lg:sticky lg:top-4">

              {/* Actions card (2026-08-25) — reseller/customer only, replaces
                  the internal-only Sales Ticket card at this position in the
                  sidebar. Reorder/Make Recurring moved here from the toolbar;
                  Confirm Order stays in the toolbar since it's urgent/primary
                  for a draft order rather than a routine management action. */}
              {(isReseller || isCustomer) && (
                <SideCard icon={Repeat} title="Actions">
                  {(order.lines || []).length > 0 || (ticket?.ticket_id && !ticket.recurring_order_id) ? (
                    <div className="space-y-2">
                      {(order.lines || []).length > 0 && (
                        <BtnSecondary onClick={doReorder} className="w-full justify-center">
                          <RotateCcw size={13} />Reorder
                        </BtnSecondary>
                      )}
                      {ticket?.ticket_id && !ticket.recurring_order_id && (
                        <BtnSecondary onClick={() => setRecurringModalOpen(true)} className="w-full justify-center">
                          <Repeat size={13} />Make Recurring
                        </BtnSecondary>
                      )}
                    </div>
                  ) : (
                    <p className="text-xs text-gray-400 py-2">No actions available for this order yet.</p>
                  )}
                </SideCard>
              )}

              {/* Sales Ticket card — internal staff only. Reseller/customer
                  never had a use for Odoo/pipeline-internal fields here
                  (assigned staff, internal notes, "who placed this"), and
                  the Actions card above gives them the self-service actions
                  that actually matter to them. */}
              {!isReseller && !isCustomer && (
                <SideCard
                  icon={FileText} title="Sales Ticket"
                  action={ticket && (
                    <button
                      onClick={() => navigate("/tickets/sales", { state: { openTicketId: ticket.ticket_id } })}
                      className="flex items-center gap-1 text-xs text-bassani-600 hover:text-bassani-800 font-medium">
                      Open <ExternalLink size={11} />
                    </button>
                  )}
                >
                  {ticket ? (
                    <div className="space-y-1.5 text-sm">
                      <div className="flex items-center justify-between">
                        <span className="text-gray-500">Ref</span>
                        <span className="font-mono font-medium text-gray-700">{ticket.ref}</span>
                      </div>
                      <div className="flex items-center justify-between">
                        <span className="text-gray-500">Stage</span>
                        <StagePill color={ticketStageColor(ticket)}>{ticketStageLabel(ticket)}</StagePill>
                      </div>
                      {/* Order type — reseller vs internal */}
                      <div className="flex items-center justify-between">
                        <span className="text-gray-500">Type</span>
                        {ticket.source === "reseller" ? (
                          <span className="text-xs font-semibold text-purple-700 bg-purple-50 border border-purple-100 px-2 py-0.5 rounded-full">
                            Reseller Order
                          </span>
                        ) : (
                          <span className="text-xs font-semibold text-blue-700 bg-blue-50 border border-blue-100 px-2 py-0.5 rounded-full">
                            Internal Order
                          </span>
                        )}
                      </div>
                      {ticket.reseller_name && (
                        <div className="flex items-center justify-between">
                          <span className="text-gray-500">Reseller</span>
                          <span className="text-gray-700 font-medium">{ticket.reseller_name}</span>
                        </div>
                      )}
                      {ticket.customer_name && (
                        <div className="flex items-center justify-between">
                          <span className="text-gray-500">Customer</span>
                          <span className="text-gray-700">{ticket.customer_name}</span>
                        </div>
                      )}
                      {ticket.assigned_to && (
                        <div className="flex items-center justify-between">
                          <span className="text-gray-500">Assigned to</span>
                          <span className="text-gray-700">{ticket.assigned_to}</span>
                        </div>
                      )}
                      {ticket.notes && (
                        <p className="text-xs text-gray-600 bg-gray-50 rounded-lg px-2 py-1.5 mt-1 italic">
                          {ticket.notes}
                        </p>
                      )}
                      {ticket.incomplete_reason && (
                        <p className="text-xs text-orange-700 bg-orange-50 rounded-lg px-2 py-1.5 mt-1">
                          {ticket.incomplete_reason}
                        </p>
                      )}
                      <div className="flex items-center justify-between pt-1 text-[11px] text-gray-400">
                        {ticket.created_at && <span>Created {fmtDate(ticket.created_at)}</span>}
                        {ticket.updated_at && <span>Updated {fmtDate(ticket.updated_at)}</span>}
                      </div>
                    </div>
                  ) : (
                    <div className="text-center py-4 space-y-3">
                      <p className="text-xs text-gray-400">No portal ticket for this order.</p>
                      {can("tickets.sales") && order.state === "sale" && (
                        <BtnPrimary onClick={createTicket} loading={creatingTicket} className="w-full justify-center">
                          Create Sales Ticket
                        </BtnPrimary>
                      )}
                    </div>
                  )}
                </SideCard>
              )}

              {/* Packing card */}
              <SideCard
                icon={Package} title="Packing"
                action={packing && (
                  <button
                    onClick={() => navigate("/tickets/orders")}
                    className="flex items-center gap-1 text-xs text-bassani-600 hover:text-bassani-800 font-medium">
                    Open board <ExternalLink size={11} />
                  </button>
                )}
              >
                {packing ? (
                  <div className="space-y-0">
                    <div className="flex items-center justify-between pb-2 border-b border-gray-50 mb-2">
                      <span className="text-xs text-gray-500">Status</span>
                      <span className={`text-[11px] px-2 py-0.5 rounded-full font-semibold ${PACK_COLOUR[packing.status] || "bg-gray-100 text-gray-500"}`}>
                        {PACK_LABEL[packing.status] || packing.status}
                      </span>
                    </div>
                    {packing.packer_name && (
                      <div className="flex items-center justify-between py-1.5 border-b border-gray-50">
                        <span className="text-xs text-gray-500">Packer</span>
                        <span className="font-mono text-xs text-gray-700">{packing.packer_name}</span>
                      </div>
                    )}
                    {packing.ps_num && (
                      <div className="flex items-center justify-between py-1.5 border-b border-gray-50">
                        <span className="text-xs text-gray-500">Packing Slip</span>
                        <span className="font-mono text-xs text-gray-700">{packing.ps_num}</span>
                      </div>
                    )}
                    <div className="pt-2 space-y-0">
                      <p className="text-[10px] font-semibold text-gray-400 uppercase tracking-wide mb-1">Approvals</p>
                      <ApprovalRow label="QA Manager" by={packing.qa_approved_by} at={packing.qa_approved_at} />
                      <ApprovalRow label="Responsible Pharmacist" by={packing.rp_approved_by} at={packing.rp_approved_at} />
                    </div>
                    {packing.collected_at && (
                      <div className="flex items-center justify-between pt-2 border-t border-gray-50 text-xs">
                        <span className="text-gray-500">Collected by</span>
                        <span className="text-gray-700">
                          {packing.collected_by || "—"}
                          {packing.collected_at && <span className="text-gray-400 ml-1">· {fmtDate(packing.collected_at)}</span>}
                        </span>
                      </div>
                    )}
                    {packing.incomplete_reason && (
                      <p className="text-xs text-orange-700 bg-orange-50 rounded-lg px-2 py-1.5 mt-1">
                        {packing.incomplete_reason}
                      </p>
                    )}
                  </div>
                ) : (
                  <div className="text-center py-4">
                    <p className="text-xs text-gray-400">
                      {order.state === "sale" ? "Not yet queued for packing." : "No packing entry."}
                    </p>
                  </div>
                )}
              </SideCard>

              {/* ── Proof of Payment (2026-08-21) ─────────────────────────────
                  Reseller/customer: always shown once there's an active ticket
                  to upload against, with the upload action and an explicit
                  "this is optional" line so it never reads as a required step
                  blocking their order. Staff/anyone without upload access:
                  only shown once something has actually been uploaded
                  (nothing to act on otherwise), read-only. */}
              {((isReseller || isCustomer) && ticket?.ticket_id && !ticket.exit_status) || ticket?.pop_uploads?.length > 0 ? (
                <SideCard
                  icon={Upload} title="Proof of Payment"
                  action={(isReseller || isCustomer) && ticket?.ticket_id && !ticket.exit_status && (
                    <BtnSecondary onClick={() => popFileInputRef.current?.click()} loading={popUploading} size="sm">
                      <Upload size={12} />Upload
                    </BtnSecondary>
                  )}
                >
                  {(isReseller || isCustomer) && ticket?.ticket_id && !ticket.exit_status && (
                    <p className="text-xs text-gray-400">
                      This is optional. Bassani will still confirm your payment through the usual process either way,
                      but sharing proof of payment here can help speed things up.
                    </p>
                  )}
                  {ticket?.pop_uploads?.length > 0 ? (
                    <div className="space-y-2">
                      {ticket.pop_uploads.map(u => (
                        <div key={u.id} className="flex items-center justify-between gap-3 border border-gray-100 rounded-xl px-3 py-2">
                          <div className="min-w-0">
                            <p className="text-sm font-medium text-gray-800 truncate">{u.filename}</p>
                            <p className="text-[11px] text-gray-400">
                              {fmtDate(u.uploaded_at)}{u.uploaded_by_name ? ` · ${u.uploaded_by_name}` : ""}
                            </p>
                          </div>
                          <button
                            onClick={() => viewPop(u.id)}
                            disabled={popViewingId === u.id}
                            className="text-xs font-medium text-bassani-600 hover:text-bassani-800 shrink-0 flex items-center gap-1"
                          >
                            {popViewingId === u.id ? <Loader2 size={12} className="animate-spin" /> : <ExternalLink size={11} />}
                            View
                          </button>
                        </div>
                      ))}
                    </div>
                  ) : (
                    <p className="text-xs text-gray-300">No files uploaded yet.</p>
                  )}
                </SideCard>
              ) : null}

              {/* ── Invoice(s) ─────────────────────────────────────────────── */}
              {invoices.length > 0 ? (
                <SideCard
                  icon={FileText} title={`Invoice${invoices.length > 1 ? `s (${invoices.length})` : ""}`}
                  action={(
                    <button
                      onClick={() => navigate("/invoices", { state: { openInvoiceId: invoices[0]?.invoice_id, filter: "all" } })}
                      className="flex items-center gap-1 text-xs text-bassani-600 hover:text-bassani-800 font-medium">
                      Open <ExternalLink size={11} />
                    </button>
                  )}
                >
                  <div className="space-y-3">
                    {invoices.map(inv => (
                      <div key={inv.invoice_id} className="border border-gray-100 rounded-xl p-3 space-y-2">
                        <div className="flex items-start justify-between gap-2">
                          <div className="min-w-0">
                            <span className="font-mono text-sm font-semibold text-gray-800">{inv.name}</span>
                            {inv.move_type === "out_refund" && (
                              <span className="ml-2 text-[10px] bg-purple-50 text-purple-700 border border-purple-100 px-1.5 py-0.5 rounded-full font-semibold">
                                Credit Note
                              </span>
                            )}
                          </div>
                          <span className={`text-[11px] px-2 py-0.5 rounded-full font-semibold shrink-0 ${PAYMENT_COLOUR[inv.payment_state] || "bg-gray-100 text-gray-500"}`}>
                            {PAYMENT_LABEL[inv.payment_state] || inv.payment_state}
                          </span>
                        </div>
                        <div className="flex flex-wrap gap-x-4 gap-y-0.5 text-xs text-gray-500">
                          <span>Amount: <span className="font-medium text-gray-800">{fmtR(inv.amount_total)}</span></span>
                          {inv.payment_state !== "paid" && inv.amount_residual > 0 && (
                            <span className="text-red-600 font-medium">Outstanding: {fmtR(inv.amount_residual)}</span>
                          )}
                          {inv.invoice_date && <span>Issued: <span className="text-gray-700">{fmtDate(inv.invoice_date)}</span></span>}
                          {inv.due_date && <span>Due: <span className="font-medium text-gray-700">{fmtDate(inv.due_date)}</span></span>}
                        </div>
                        {["not_paid", "partial"].includes(inv.payment_state) && inv.move_type !== "out_refund" && can("invoices.record_payment") && (
                          <BtnPrimary onClick={() => openPayModal(inv)} className="w-full justify-center mt-1">
                            Register Payment
                          </BtnPrimary>
                        )}
                      </div>
                    ))}
                    {/* Pro-Forma Invoice (2026-08-25) — kept available here even
                        once a real invoice exists, as the historical record of
                        the deposit-due amount that was actually emailed at
                        confirm time; a real invoice covers the final amount,
                        not necessarily the same figure. */}
                    {(isReseller || isCustomer) && ["sale", "done"].includes(order.state) && (
                      <button
                        onClick={() => setPdfView({ url: `/api/orders/${orderId}/proforma-pdf`, title: `${order.name} — Pro-Forma Invoice` })}
                        className="flex items-center gap-1.5 text-xs font-medium text-bassani-600 hover:text-bassani-800 pt-1"
                      >
                        <FileText size={12} />View Pro-Forma Invoice
                      </button>
                    )}
                  </div>
                </SideCard>
              ) : (
                ["sale", "done"].includes(order.state) && (
                  <SideCard icon={FileText} title="Invoice">
                    {(isReseller || isCustomer) ? (
                      <div className="space-y-3">
                        <p className="text-xs text-gray-400">
                          No final invoice yet — Bassani raises this once your order has been packed and approved.
                          In the meantime, here's the pro-forma invoice showing the deposit amount due.
                        </p>
                        <BtnSecondary
                          onClick={() => setPdfView({ url: `/api/orders/${orderId}/proforma-pdf`, title: `${order.name} — Pro-Forma Invoice` })}
                          className="w-full justify-center"
                        >
                          <FileText size={13} />View Pro-Forma Invoice
                        </BtnSecondary>
                      </div>
                    ) : (
                      <p className="text-xs text-gray-400">No invoice raised yet.</p>
                    )}
                  </SideCard>
                )
              )}

              {/* ── More actions ─────────────────────────────────────────────
                  Navigation not already covered by an inline "Open" link on
                  one of the cards above (Ticket/Packing/Invoices each carry
                  their own now) — the packing-board *display* screen is a
                  distinct destination from the packing board work queue
                  ("Open board" above), so both stay. */}
              <div className="bg-white rounded-2xl shadow-sm border border-gray-100 p-4 space-y-2">
                <p className="text-xs font-semibold text-gray-500 uppercase tracking-wide mb-1">More Actions</p>
                <BtnSecondary onClick={() => navigate("/orders")} className="w-full justify-center">
                  <Truck size={13} />All Orders
                </BtnSecondary>
                {packing && (
                  <BtnSecondary onClick={openPackingBoard} loading={packingBoardLoading} className="w-full justify-center">
                    <Package size={13} />Packing Board Display
                  </BtnSecondary>
                )}
                {hasBackorder && (
                  <BtnSecondary onClick={() => navigate("/orders/backorders")} className="w-full justify-center">
                    <Clock size={13} />Backorders
                  </BtnSecondary>
                )}
                {manufacturing_orders?.length > 0 && (
                  <BtnSecondary onClick={() => navigate("/orders/manufacturing-orders", { state: { soName: order.name } })} className="w-full justify-center">
                    <Factory size={13} />Manufacturing Orders
                  </BtnSecondary>
                )}
              </div>

            </div>
          </div>

        </div>
      </div>

      {/* ── Register Payment modal ─────────────────────────────────────────── */}
      {payingInvoice && (
        <Modal title={`Register Payment — ${payingInvoice.name}`} onClose={() => setPayingInvoice(null)}>
          <div className="space-y-3">
            <FormGroup label="Journal">
              <Select
                value={payForm.journal_id}
                onChange={e => setPayForm(f => ({ ...f, journal_id: e.target.value }))}
              >
                <option value="">Select journal…</option>
                {payJournals.map(j => (
                  <option key={j.id} value={String(j.id)}>{j.name}</option>
                ))}
              </Select>
            </FormGroup>
            <FormGroup label="Amount (R)">
              <Input
                type="number" step="0.01" min="0"
                value={payForm.amount}
                onChange={e => setPayForm(f => ({ ...f, amount: e.target.value }))}
              />
            </FormGroup>
            <FormGroup label="Payment Date">
              <Input
                type="date"
                value={payForm.date}
                onChange={e => setPayForm(f => ({ ...f, date: e.target.value }))}
              />
            </FormGroup>
            <div className="flex justify-end gap-2 pt-2">
              <BtnSecondary onClick={() => setPayingInvoice(null)} disabled={paySaving}>Cancel</BtnSecondary>
              <BtnPrimary onClick={registerPayment} loading={paySaving} disabled={paySaving}>
                Register Payment
              </BtnPrimary>
            </div>
          </div>
        </Modal>
      )}

      {/* ── Ticket preflight modal ─────────────────────────────────────────── */}
      {ticketPreflightModal && (
        <Modal
          title={ticketPreflightModal.has_linked_ticket ? "Ticket Already Exists" : "Link Existing Ticket?"}
          onClose={() => setTicketPreflightModal(null)}
          width="max-w-lg"
        >
          {ticketPreflightModal.has_linked_ticket ? (
            <>
              <p className="text-sm text-gray-600 mb-4">
                A Sales Ticket already exists for order <strong>{ticketPreflightModal.order_name}</strong>.
                Open it to continue managing this order in the pipeline.
              </p>
              <div className="flex justify-end gap-2">
                <BtnSecondary onClick={() => setTicketPreflightModal(null)}>Cancel</BtnSecondary>
                <BtnPrimary onClick={() => {
                  navigate("/tickets/sales", { state: { openTicketId: ticketPreflightModal.existing_ticket_id } });
                  setTicketPreflightModal(null);
                }}>Open Existing Ticket</BtnPrimary>
              </div>
            </>
          ) : (
            <>
              <p className="text-sm text-gray-600 mb-4">
                The following open inquiry tickets have no order assigned yet. Link one to
                order <strong>{ticketPreflightModal.order_name}</strong>, or create a new ticket.
              </p>
              <div className="border border-gray-200 rounded-xl overflow-hidden mb-4">
                {ticketPreflightModal.unlinked_tickets.map(t => (
                  <div key={t.id} className="flex items-center justify-between px-4 py-3 border-b border-gray-100 last:border-0">
                    <div>
                      <p className="text-sm font-medium text-gray-900">{t.customer_name}</p>
                      <p className="text-xs text-gray-400 mt-0.5">
                        {t.source === "email" ? "Email inquiry" : "Direct inquiry"} · {t.created_at ? new Date(t.created_at).toLocaleDateString("en-ZA", { timeZone: "Africa/Johannesburg" }) : ""}
                      </p>
                    </div>
                    <BtnSecondary size="sm" onClick={() => doLinkUnlinkedTicket(t.id)}>Link This</BtnSecondary>
                  </div>
                ))}
              </div>
              <div className="flex justify-end gap-2">
                <BtnSecondary onClick={() => setTicketPreflightModal(null)}>Cancel</BtnSecondary>
                <BtnPrimary onClick={doCreateTicketFromPreflight}>Create New Ticket</BtnPrimary>
              </div>
            </>
          )}
        </Modal>
      )}
      {stockCheckModal && stockCheckData && (
        <Modal title="Confirm Order" onClose={() => { setStockCheckModal(false); setStockCheckData(null); }}>
          {stockCheckData.is_partial ? (
            <>
              {stockCheckData.invoice_policy_block && (
                <div className="flex items-start gap-3 bg-red-50 border border-red-100 rounded-xl p-3 mb-3">
                  <XCircle size={15} className="text-red-500 mt-0.5 shrink-0" />
                  <div>
                    <p className="text-sm font-semibold text-red-800">Partial fulfilment blocked</p>
                    <p className="text-xs text-red-700 mt-1">
                      This order cannot be partially fulfilled at this time. Please contact Bassani directly to resolve the issue before confirming.
                    </p>
                  </div>
                </div>
              )}
              <div className="flex items-start gap-3 bg-amber-50 border border-amber-100 rounded-xl p-3 mb-4">
                <AlertTriangle size={15} className="text-amber-500 mt-0.5 shrink-0" />
                <div>
                  <p className="text-sm font-semibold text-amber-800">Some items are not in stock</p>
                  <p className="text-xs text-amber-700 mt-0.5">
                    Bassani will ship available items now and fulfil the rest as soon as stock arrives. You will receive a separate confirmation when the backorder is ready.
                  </p>
                </div>
              </div>
              <div className="space-y-3 mb-4">
                {stockCheckData.lines.filter(l => !l.will_backorder).length > 0 && (
                  <div>
                    <p className="text-[10px] font-semibold text-green-600 uppercase tracking-wide mb-1.5">Ships now</p>
                    <div className="space-y-1">
                      {stockCheckData.lines.filter(l => !l.will_backorder).map((l, i) => (
                        <div key={i} className="flex items-center justify-between text-xs bg-green-50 rounded-lg px-3 py-1.5">
                          <span className="text-gray-700">{l.name}</span>
                          <span className="font-medium text-green-700">{l.qty_available} units</span>
                        </div>
                      ))}
                    </div>
                  </div>
                )}
                {stockCheckData.lines.filter(l => l.will_backorder).length > 0 && (
                  <div>
                    <p className="text-[10px] font-semibold text-amber-600 uppercase tracking-wide mb-1.5">Backordered</p>
                    <div className="space-y-1">
                      {stockCheckData.lines.filter(l => l.will_backorder).map((l, i) => (
                        <div key={i} className="flex items-center justify-between text-xs bg-amber-50 rounded-lg px-3 py-1.5">
                          <span className="text-gray-700">{l.name}</span>
                          <span className="font-medium text-amber-700">{l.qty_available} of {l.qty_ordered} in stock</span>
                        </div>
                      ))}
                    </div>
                  </div>
                )}
              </div>
              <div className="flex gap-2">
                <BtnSecondary className="flex-1 justify-center" onClick={() => { setStockCheckModal(false); setStockCheckData(null); }}>
                  Cancel
                </BtnSecondary>
                {!stockCheckData.invoice_policy_block && (
                  <BtnPrimary className="flex-1 justify-center" loading={confirming} onClick={() => doConfirmOrder(true)}>
                    Confirm — Create Backorder
                  </BtnPrimary>
                )}
              </div>
            </>
          ) : (
            <>
              <div className="flex items-start gap-3 bg-green-50 border border-green-100 rounded-xl p-3 mb-4">
                <CheckCircle2 size={15} className="text-green-500 mt-0.5 shrink-0" />
                <p className="text-sm text-green-800">All items are in stock. This order will be fulfilled in full.</p>
              </div>
              <div className="flex gap-2">
                <BtnSecondary className="flex-1 justify-center" onClick={() => { setStockCheckModal(false); setStockCheckData(null); }}>
                  Cancel
                </BtnSecondary>
                <BtnPrimary className="flex-1 justify-center" loading={confirming} onClick={() => doConfirmOrder(true)}>
                  Confirm Order
                </BtnPrimary>
              </div>
            </>
          )}
        </Modal>
      )}
      {creditOverrideMsg && (
        <Modal title="Over Credit Limit" onClose={() => setCreditOverrideMsg(null)}>
          <div className="flex items-start gap-3 bg-red-50 border border-red-100 rounded-xl p-3 mb-4">
            <XCircle size={15} className="text-red-500 mt-0.5 shrink-0" />
            <p className="text-sm text-red-800">{creditOverrideMsg}</p>
          </div>
          <div className="flex gap-2">
            <BtnSecondary className="flex-1 justify-center" onClick={() => setCreditOverrideMsg(null)}>Cancel</BtnSecondary>
            <BtnPrimary className="flex-1 justify-center" loading={confirming} onClick={() => { setCreditOverrideMsg(null); doConfirmOrder(true, true); }}>
              Confirm Anyway
            </BtnPrimary>
          </div>
        </Modal>
      )}
      {pdfView && (
        <OdooPdfViewerModal url={pdfView.url} title={pdfView.title} onClose={() => setPdfView(null)} />
      )}
      {recurringModalOpen && ticket?.ticket_id && (
        <RecurringOrderSetupModal
          ticketId={ticket.ticket_id}
          onClose={() => setRecurringModalOpen(false)}
          onCreated={() => { setRecurringModalOpen(false); load(); }}
        />
      )}
    </div>
  );
}
