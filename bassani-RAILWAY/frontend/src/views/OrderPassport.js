import { useState, useEffect } from "react";
import { useParams, useNavigate, useLocation } from "react-router-dom";
import { useAuth } from "../AuthContext";
import api from "../api";
import toast from "react-hot-toast";
import {
  ChevronLeft, Package, FileText, Truck,
  CheckCircle2, Clock, ExternalLink, RefreshCw, Check, ClipboardCheck,
} from "lucide-react";
import {
  fmtDate, BtnSecondary, BtnPrimary, Modal,
  FormGroup, Input, Select, LoadingState,
} from "../components/UI";

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

const MO_COLOURS = {
  draft: "bg-gray-100 text-gray-500",
  confirmed: "bg-amber-50 text-amber-700",
  progress: "bg-green-50 text-green-700",
  to_close: "bg-blue-50 text-blue-700",
};
const MO_LABELS = { draft: "Draft", confirmed: "Confirmed", progress: "In Progress", to_close: "To Close" };

const TICKET_STATUS_LABEL = {
  open: "Inquiry Open", quote: "Building Quote", sale_order: "Awaiting Deposit",
  invoice: "Invoice Raised", confirmed_wip: "In Progress",
  ready_for_collection: "Ready for Collection", incomplete: "Incomplete",
  queued: "Queued for Packing", packing: "Being Packed", waiting_stock: "Awaiting Stock",
};

// ── Pipeline stepper ──────────────────────────────────────────────────────────
const PIPELINE_STEPS = [
  { key: "quote",    label: "Quote",    statuses: ["open", "quote"] },
  { key: "order",    label: "Order",    statuses: ["sale_order"] },
  { key: "deposit",  label: "Deposit",  statuses: ["invoice", "confirmed_wip"] },
  { key: "packing",  label: "Packing",  statuses: ["queued", "packing", "ready_for_collection"] },
  { key: "complete", label: "Complete", statuses: [] },
];

function pipelineStep(ticket) {
  if (!ticket) return -1;
  if (ticket.exit_status === "complete") return 4;
  if (ticket.exit_status) return -1;
  const status = ticket.status || "open";
  for (let i = 0; i < PIPELINE_STEPS.length; i++) {
    if (PIPELINE_STEPS[i].statuses.includes(status)) return i;
  }
  return 0;
}

function PipelineBar({ ticket, orderState }) {
  if (!ticket || orderState === "cancel" || orderState === "draft") return null;
  const active    = pipelineStep(ticket);
  const cancelled = ticket.exit_status && ticket.exit_status !== "complete";
  return (
    <div className="flex items-center w-full mt-2">
      {PIPELINE_STEPS.map((step, i) => {
        const done    = active > i;
        const current = active === i && !cancelled;
        const isLast  = i === PIPELINE_STEPS.length - 1;
        return (
          <div key={step.key} className="flex items-center flex-1 min-w-0">
            <div className="flex flex-col items-center">
              <div className={`w-7 h-7 rounded-full flex items-center justify-center text-xs font-bold
                ${done || current ? "bg-bassani-600 text-white" : "bg-gray-100 text-gray-400"}
                ${cancelled ? "!bg-red-100 !text-red-400" : ""}`}>
                {done ? <CheckCircle2 size={14} /> : i + 1}
              </div>
              <span className={`text-[10px] mt-1 font-medium whitespace-nowrap
                ${done || current ? "text-bassani-700" : "text-gray-400"}
                ${cancelled ? "!text-red-400" : ""}`}>
                {step.label}
              </span>
            </div>
            {!isLast && (
              <div className={`flex-1 h-0.5 mx-1 mb-4 ${done ? "bg-bassani-600" : "bg-gray-200"}`} />
            )}
          </div>
        );
      })}
    </div>
  );
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

// ── Status rail — all signals at a glance ─────────────────────────────────────
function StatusRail({ order, ticket, packing, invoices }) {
  const pills = [];

  const [oLabel, oColor] = [
    ODOO_STATE_LABEL[order.state] || order.state,
    { draft: "amber", sent: "blue", sale: "green", done: "gray", cancel: "red" }[order.state] || "gray",
  ];
  pills.push({ label: `Order: ${oLabel}`, color: oColor });

  if (ticket) {
    const tLabel = ticket.exit_status
      ? ticket.exit_status.charAt(0).toUpperCase() + ticket.exit_status.slice(1).replace(/_/g, " ")
      : (TICKET_STATUS_LABEL[ticket.status] || ticket.status || "");
    const tColor = ticket.exit_status === "complete" ? "green"
      : ticket.exit_status ? "red"
      : ["confirmed_wip", "ready_for_collection"].includes(ticket.status) ? "green"
      : ["queued", "packing"].includes(ticket.status) ? "blue"
      : "amber";
    pills.push({ label: `Ticket: ${tLabel}`, color: tColor });
  }

  if (packing) {
    pills.push({
      label: `Packing: ${PACK_LABEL[packing.status] || packing.status}`,
      color: packing.status === "complete" || packing.status === "collected" ? "green"
           : packing.status === "ready" ? "blue"
           : packing.status === "packing" ? "amber"
           : packing.status === "incomplete" || packing.status === "waiting_stock" ? "orange"
           : "gray",
    });
    pills.push({ label: packing.qa_approved_at ? "QA: Approved" : "QA: Pending",   color: packing.qa_approved_at ? "green" : "amber" });
    pills.push({ label: packing.rp_approved_at ? "RP: Approved" : "RP: Pending",   color: packing.rp_approved_at ? "green" : "amber" });
  }

  if (invoices.length > 0) {
    const inv = invoices[0];
    const INV_MAP = {
      paid: ["Payment: Paid", "green"], not_paid: ["Payment: Outstanding", "red"],
      partial: ["Payment: Partial", "amber"], in_payment: ["Payment: In Payment", "blue"],
    };
    const [iLabel, iColor] = INV_MAP[inv.payment_state] || [`Payment: ${inv.payment_state}`, "gray"];
    pills.push({ label: iLabel, color: iColor });
  }

  return (
    <div className="flex flex-wrap gap-1.5 pt-3 border-t border-gray-50">
      {pills.map((p, i) => {
        const c = STATUS_COLOURS[p.color] || STATUS_COLOURS.gray;
        return (
          <span key={i} className={`inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-[11px] font-semibold border ${c.bg} ${c.border} ${c.text}`}>
            <span className={`w-1.5 h-1.5 rounded-full shrink-0 ${c.dot}`} />
            {p.label}
          </span>
        );
      })}
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

// ── Main component ────────────────────────────────────────────────────────────
export default function OrderPassport() {
  const { orderId } = useParams();
  const navigate    = useNavigate();
  const location    = useLocation();
  const { can }     = useAuth();

  const [data,    setData   ] = useState(null);
  const [loading, setLoading] = useState(true);

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

  const { order, ticket, packing, invoices = [], deliveries, lot_map, manufacturing_orders, overall_status } = data;
  const partner            = order.partner_detail || {};
  const hasPartialDelivery = deliveries.some(d => d.state === "done");
  const outstandingLines   = (order.lines || []).filter(
    l => hasPartialDelivery && (l.qty_delivered || 0) < (l.product_uom_qty || 0)
  );
  const hasBackorder =
    deliveries.some(d => d.is_backorder) ||
    packing?.status === "waiting_stock" ||
    (hasPartialDelivery && outstandingLines.length > 0);

  return (
    <div className="flex flex-col h-full overflow-hidden">
      {/* Toolbar */}
      <div className="flex items-center justify-between px-6 py-3 bg-white border-b border-gray-200 shrink-0">
        <button onClick={goBack}
          className="flex items-center gap-1.5 text-sm text-gray-500 hover:text-gray-800 transition-colors">
          <ChevronLeft size={14} />Back
        </button>
        <BtnSecondary onClick={load}>
          <RefreshCw size={13} />Refresh
        </BtnSecondary>
      </div>

      {/* Body */}
      <div className="flex-1 overflow-y-auto py-6 px-4">
        <div className="max-w-4xl mx-auto w-full space-y-4">

          {/* ── Header card ─────────────────────────────────────────────────── */}
          <div className="bg-white rounded-2xl shadow-sm border border-gray-100 p-5">
            <div className="flex flex-wrap items-start justify-between gap-3 mb-4">
              <div>
                <p className="text-xs text-gray-400 mb-0.5">Order Reference</p>
                <div className="flex items-center gap-2 flex-wrap">
                  <h1 className="text-2xl font-mono font-bold text-gray-900">{order.name}</h1>
                  <span className={`text-[11px] font-semibold px-2 py-0.5 rounded-full border ${ODOO_STATE_STYLE[order.state] || "bg-gray-50 text-gray-500 border-gray-200"}`}>
                    {ODOO_STATE_LABEL[order.state] || order.state}
                  </span>
                </div>
                <p className="text-sm text-gray-600 mt-0.5">
                  {order.partner_id?.[1] || "Unknown customer"}
                  {partner.email && <span className="text-gray-400 ml-2">· {partner.email}</span>}
                </p>
              </div>
              <div className="text-right">
                <StatusBadge overall={overall_status} />
                <p className="text-xs text-gray-400 mt-1.5">{overall_status.detail}</p>
              </div>
            </div>

            {/* Meta row */}
            <div className="flex flex-wrap gap-x-6 gap-y-1 text-xs text-gray-500 mb-4 border-t border-gray-50 pt-3">
              {order.date_order   && <span>Date: <span className="text-gray-700 font-medium">{fmtDate(order.date_order)}</span></span>}
              <span>Total: <span className="text-gray-700 font-medium">{fmtR(order.amount_total)}</span></span>
              {order.payment_term_id && <span>Terms: <span className="text-gray-700 font-medium">{order.payment_term_id[1]}</span></span>}
              {partner.phone     && <span>Phone: <span className="text-gray-700 font-medium">{partner.phone}</span></span>}
              {partner.vat       && <span>VAT: <span className="text-gray-700 font-medium">{partner.vat}</span></span>}
            </div>

            {/* Pipeline bar */}
            <PipelineBar ticket={ticket} orderState={order.state} />

            {/* Status rail — all signals at a glance */}
            <StatusRail order={order} ticket={ticket} packing={packing} invoices={invoices} />
          </div>

          {/* ── Ticket + Packing grid ────────────────────────────────────────── */}
          <div className="grid grid-cols-1 md:grid-cols-2 gap-4">

            {/* Sales Ticket card */}
            <div className="bg-white rounded-2xl shadow-sm border border-gray-100 p-4 space-y-3">
              <div className="flex items-center justify-between">
                <p className="text-xs font-semibold text-gray-500 uppercase tracking-wide flex items-center gap-1.5">
                  <FileText size={12} />Sales Ticket
                </p>
                {ticket && (
                  <button
                    onClick={() => navigate("/tickets/sales", { state: { openTicketId: ticket.ticket_id } })}
                    className="flex items-center gap-1 text-xs text-bassani-600 hover:text-bassani-800 font-medium">
                    Open <ExternalLink size={11} />
                  </button>
                )}
              </div>
              {ticket ? (
                <div className="space-y-1.5 text-sm">
                  <div className="flex items-center justify-between">
                    <span className="text-gray-500">Ref</span>
                    <span className="font-mono font-medium text-gray-700">{ticket.ref}</span>
                  </div>
                  <div className="flex items-center justify-between">
                    <span className="text-gray-500">Stage</span>
                    <span className="text-gray-800 font-medium">
                      {ticket.exit_status
                        ? ticket.exit_status.charAt(0).toUpperCase() + ticket.exit_status.slice(1).replace(/_/g, " ")
                        : (TICKET_STATUS_LABEL[ticket.status] || ticket.status)}
                    </span>
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
            </div>

            {/* Packing card */}
            <div className="bg-white rounded-2xl shadow-sm border border-gray-100 p-4 space-y-3">
              <div className="flex items-center justify-between">
                <p className="text-xs font-semibold text-gray-500 uppercase tracking-wide flex items-center gap-1.5">
                  <Package size={12} />Packing
                </p>
                {packing && (
                  <button
                    onClick={() => navigate("/tickets/orders")}
                    className="flex items-center gap-1 text-xs text-bassani-600 hover:text-bassani-800 font-medium">
                    Open board <ExternalLink size={11} />
                  </button>
                )}
              </div>
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
            </div>
          </div>

          {/* ── Invoice(s) ───────────────────────────────────────────────────── */}
          {invoices.length > 0 ? (
            <div className="bg-white rounded-2xl shadow-sm border border-gray-100 p-4 space-y-3">
              <p className="text-xs font-semibold text-gray-500 uppercase tracking-wide flex items-center gap-1.5">
                <FileText size={12} />Invoice{invoices.length > 1 ? `s (${invoices.length})` : ""}
              </p>
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
              </div>
            </div>
          ) : (
            order.state === "sale" && (
              <div className="bg-white rounded-2xl shadow-sm border border-gray-100 p-4">
                <p className="text-xs font-semibold text-gray-500 uppercase tracking-wide flex items-center gap-1.5 mb-2">
                  <FileText size={12} />Invoice
                </p>
                <p className="text-xs text-gray-400">No invoice raised yet.</p>
              </div>
            )
          )}

          {/* ── Delivery & Fulfilment ────────────────────────────────────────── */}
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

          {/* ── Order lines ──────────────────────────────────────────────────── */}
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
                      const pid         = line.product_id?.[0];
                      const lots        = pid && lot_map[pid] ? lot_map[pid] : [];
                      const ordered     = line.product_uom_qty || 0;
                      const delivered   = line.qty_delivered   || 0;
                      const isOutstanding = hasPartialDelivery && delivered < ordered;
                      return (
                        <tr
                          key={i}
                          className={`${isOutstanding ? "bg-orange-50/40 cursor-pointer hover:bg-orange-100/60 transition-colors" : ""}`}
                          onClick={isOutstanding ? () => navigate("/orders/backorders", { state: { soName: order.name } }) : undefined}
                        >
                          <td className="py-2 pr-3">
                            <p className="text-gray-800 font-medium leading-snug">{line.name || line.product_id?.[1]}</p>
                            {lots.length > 0 && (
                              <p className="font-mono text-[10px] text-bassani-600 mt-0.5">Batch: {lots.join(", ")}</p>
                            )}
                            {isOutstanding && (
                              <span className="inline-block mt-0.5 text-[10px] font-semibold text-orange-700 bg-orange-100 px-1.5 py-0.5 rounded-full">
                                {ordered - delivered} outstanding
                              </span>
                            )}
                          </td>
                          <td className="py-2 text-right tabular-nums text-gray-700">{ordered}</td>
                          <td className="py-2 text-right tabular-nums">
                            <span className={delivered >= ordered ? "text-green-700 font-medium" : "text-orange-600 font-medium"}>
                              {delivered}
                            </span>
                            {delivered >= ordered && ordered > 0 && (
                              <Check size={10} className="inline ml-1 text-green-500" />
                            )}
                          </td>
                          <td className="py-2 text-right tabular-nums text-gray-600 hidden sm:table-cell">{fmtR(line.price_unit)}</td>
                          <td className="py-2 text-right tabular-nums font-medium text-gray-800">{fmtR(line.price_subtotal)}</td>
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

          {/* ── Quick links ──────────────────────────────────────────────────── */}
          <div className="flex flex-wrap gap-2 pb-6">
            <BtnSecondary onClick={() => navigate("/orders")}>
              <Truck size={13} />All Orders
            </BtnSecondary>
            {ticket && (
              <BtnSecondary onClick={() => navigate("/tickets/sales", { state: { openTicketId: ticket.ticket_id } })}>
                <FileText size={13} />Open Ticket
              </BtnSecondary>
            )}
            {packing && (
              <BtnSecondary onClick={openPackingBoard} loading={packingBoardLoading}>
                <Package size={13} />Packing Board
              </BtnSecondary>
            )}
            {invoices.length > 0 && (
              <BtnSecondary onClick={() => navigate("/invoices", { state: { openInvoiceId: invoices[0]?.invoice_id, filter: "all" } })}>
                <FileText size={13} />Invoices
              </BtnSecondary>
            )}
            {hasBackorder && (
              <BtnSecondary onClick={() => navigate("/orders/backorders")}>
                <Clock size={13} />Backorders
              </BtnSecondary>
            )}
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
    </div>
  );
}
