import { useState, useEffect } from "react";
import { useParams, useNavigate, useLocation } from "react-router-dom";
import { useAuth } from "../AuthContext";
import api from "../api";
import toast from "react-hot-toast";
import {
  ChevronLeft, Package, FileText, Truck, AlertTriangle,
  CheckCircle2, Clock, ExternalLink, RefreshCw,
} from "lucide-react";
import { fmtDate, BtnSecondary, LoadingState } from "../components/UI";

const fmtR = (n) =>
  `R ${(n || 0).toLocaleString("en-ZA", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;

// ── Overall status colour mapping ─────────────────────────────────────────────
const STATUS_COLOURS = {
  green:  { bg: "bg-green-50",  border: "border-green-200", text: "text-green-800",  dot: "bg-green-500"  },
  blue:   { bg: "bg-blue-50",   border: "border-blue-200",  text: "text-blue-800",   dot: "bg-blue-500"   },
  amber:  { bg: "bg-amber-50",  border: "border-amber-200", text: "text-amber-800",  dot: "bg-amber-500"  },
  orange: { bg: "bg-orange-50", border: "border-orange-200",text: "text-orange-800", dot: "bg-orange-500" },
  red:    { bg: "bg-red-50",    border: "border-red-200",   text: "text-red-800",    dot: "bg-red-500"    },
  gray:   { bg: "bg-gray-50",   border: "border-gray-200",  text: "text-gray-600",   dot: "bg-gray-400"   },
};

// ── Pipeline steps ────────────────────────────────────────────────────────────
const PIPELINE_STEPS = [
  { key: "quote",     label: "Quote",     statuses: ["open", "quote"] },
  { key: "order",     label: "Order",     statuses: ["sale_order"] },
  { key: "deposit",   label: "Deposit",   statuses: ["invoice", "confirmed_wip"] },
  { key: "packing",   label: "Packing",   statuses: ["queued", "packing", "ready_for_collection"] },
  { key: "complete",  label: "Complete",  statuses: [] }, // reached via exit_status
];

function pipelineStep(ticket) {
  if (!ticket) return -1;
  if (ticket.exit_status === "complete") return 4;
  if (ticket.exit_status) return -1; // cancelled/not_interested — no active step
  const status = ticket.status || "open";
  for (let i = 0; i < PIPELINE_STEPS.length; i++) {
    if (PIPELINE_STEPS[i].statuses.includes(status)) return i;
  }
  return 0;
}

function PipelineBar({ ticket, orderState }) {
  if (!ticket || orderState === "cancel" || orderState === "draft") return null;
  const active = pipelineStep(ticket);
  const cancelled = ticket.exit_status && ticket.exit_status !== "complete";
  return (
    <div className="flex items-center gap-0 w-full">
      {PIPELINE_STEPS.map((step, i) => {
        const done    = active > i;
        const current = active === i && !cancelled;
        const isLast  = i === PIPELINE_STEPS.length - 1;
        return (
          <div key={step.key} className="flex items-center flex-1 min-w-0">
            <div className="flex flex-col items-center">
              <div className={`w-7 h-7 rounded-full flex items-center justify-center text-xs font-bold transition-colors
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
              <div className={`flex-1 h-0.5 mx-1 mb-4 transition-colors
                ${done ? "bg-bassani-600" : "bg-gray-200"}`} />
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

const PICKING_COLOUR = {
  done:      "bg-green-50 text-green-700",
  assigned:  "bg-blue-50 text-blue-700",
  confirmed: "bg-amber-50 text-amber-700",
  waiting:   "bg-orange-50 text-orange-700",
  cancel:    "bg-gray-100 text-gray-400",
};

const PAYMENT_COLOUR = {
  paid:         "bg-green-50 text-green-700",
  not_paid:     "bg-red-50 text-red-700",
  partial:      "bg-amber-50 text-amber-700",
  in_payment:   "bg-blue-50 text-blue-700",
  reversed:     "bg-gray-100 text-gray-500",
};
const PAYMENT_LABEL = {
  paid: "Paid", not_paid: "Outstanding", partial: "Partially Paid",
  in_payment: "In Payment", reversed: "Reversed",
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

export default function OrderPassport() {
  const { orderId } = useParams();
  const navigate    = useNavigate();
  const location    = useLocation();
  const { can }     = useAuth();

  const [data,    setData   ] = useState(null);
  const [loading, setLoading] = useState(true);

  const load = async () => {
    setLoading(true);
    try {
      const r = await api.get(`/api/orders/${orderId}/passport`);
      setData(r.data);
    } catch (e) {
      toast.error(e.response?.data?.detail || "Failed to load order");
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => { load(); }, [orderId]);

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

  const { order, ticket, invoice, deliveries, lot_map, manufacturing_orders, overall_status } = data;
  const partner = order.partner_detail || {};
  const hasBackorder = deliveries.some(d => d.is_backorder);

  return (
    <div className="flex flex-col h-full overflow-hidden">
      {/* Toolbar */}
      <div className="flex items-center justify-between px-6 py-3 bg-white border-b border-gray-200 shrink-0">
        <button onClick={goBack}
          className="flex items-center gap-1.5 text-sm text-gray-500 hover:text-gray-800 transition-colors">
          <ChevronLeft size={14} />Back
        </button>
        <div className="flex items-center gap-2">
          <BtnSecondary onClick={load}>
            <RefreshCw size={13} />Refresh
          </BtnSecondary>
        </div>
      </div>

      {/* Body */}
      <div className="flex-1 overflow-y-auto py-6 px-4">
        <div className="max-w-4xl mx-auto w-full space-y-4">

          {/* ── Header card ─────────────────────────────────────────────────── */}
          <div className="bg-white rounded-2xl shadow-sm border border-gray-100 p-5">
            <div className="flex flex-wrap items-start justify-between gap-3 mb-4">
              <div>
                <p className="text-xs text-gray-400 mb-0.5">Order Reference</p>
                <h1 className="text-2xl font-mono font-bold text-gray-900">{order.name}</h1>
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
            <div className="flex flex-wrap gap-x-6 gap-y-1 text-xs text-gray-500 mb-5 border-t border-gray-50 pt-3">
              {order.date_order && <span>Order date: <span className="text-gray-700 font-medium">{fmtDate(order.date_order)}</span></span>}
              <span>Total: <span className="text-gray-700 font-medium">{fmtR(order.amount_total)}</span></span>
              {order.payment_term_id && <span>Terms: <span className="text-gray-700 font-medium">{order.payment_term_id[1]}</span></span>}
              {partner.phone && <span>Phone: <span className="text-gray-700 font-medium">{partner.phone}</span></span>}
            </div>

            {/* Pipeline bar */}
            <PipelineBar ticket={ticket} orderState={order.state} />
          </div>

          {/* ── Two-column grid ──────────────────────────────────────────────── */}
          <div className="grid grid-cols-1 md:grid-cols-2 gap-4">

            {/* Sales Ticket */}
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
                        ? ticket.exit_status.charAt(0).toUpperCase() + ticket.exit_status.slice(1)
                        : (TICKET_STATUS_LABEL[ticket.status] || ticket.status)}
                    </span>
                  </div>
                  {ticket.assigned_to && (
                    <div className="flex items-center justify-between">
                      <span className="text-gray-500">Assigned to</span>
                      <span className="text-gray-700">{ticket.assigned_to}</span>
                    </div>
                  )}
                  {ticket.incomplete_reason && (
                    <p className="text-xs text-orange-700 bg-orange-50 rounded-lg px-2 py-1.5 mt-1">
                      {ticket.incomplete_reason}
                    </p>
                  )}
                  {ticket.updated_at && (
                    <p className="text-[11px] text-gray-400 pt-1">Last updated {fmtDate(ticket.updated_at)}</p>
                  )}
                </div>
              ) : (
                <div className="text-center py-4">
                  <p className="text-xs text-gray-400">No portal ticket for this order.</p>
                  {can("tickets.manage") && (
                    <p className="text-xs text-gray-400 mt-1">Create one from the Sales Tickets page.</p>
                  )}
                </div>
              )}
            </div>

            {/* Invoice */}
            <div className="bg-white rounded-2xl shadow-sm border border-gray-100 p-4 space-y-3">
              <div className="flex items-center justify-between">
                <p className="text-xs font-semibold text-gray-500 uppercase tracking-wide flex items-center gap-1.5">
                  <FileText size={12} />Invoice
                </p>
                {invoice && (
                  <button
                    onClick={() => navigate("/invoices")}
                    className="flex items-center gap-1 text-xs text-bassani-600 hover:text-bassani-800 font-medium">
                    View invoices <ExternalLink size={11} />
                  </button>
                )}
              </div>
              {invoice ? (
                <div className="space-y-1.5 text-sm">
                  <div className="flex items-center justify-between">
                    <span className="text-gray-500">Reference</span>
                    <span className="font-mono font-medium text-gray-700">{invoice.name}</span>
                  </div>
                  <div className="flex items-center justify-between">
                    <span className="text-gray-500">Amount</span>
                    <span className="font-medium text-gray-800">{fmtR(invoice.amount_total)}</span>
                  </div>
                  <div className="flex items-center justify-between">
                    <span className="text-gray-500">Status</span>
                    <span className={`text-xs px-2 py-0.5 rounded-full font-semibold ${PAYMENT_COLOUR[invoice.payment_state] || "bg-gray-100 text-gray-500"}`}>
                      {PAYMENT_LABEL[invoice.payment_state] || invoice.payment_state}
                    </span>
                  </div>
                  {invoice.payment_state === "not_paid" && invoice.amount_residual > 0 && (
                    <div className="flex items-center justify-between">
                      <span className="text-gray-500">Outstanding</span>
                      <span className="font-medium text-red-700">{fmtR(invoice.amount_residual)}</span>
                    </div>
                  )}
                  {invoice.due_date && (
                    <div className="flex items-center justify-between">
                      <span className="text-gray-500">Due date</span>
                      <span className="text-gray-700">{fmtDate(invoice.due_date)}</span>
                    </div>
                  )}
                </div>
              ) : (
                <p className="text-xs text-gray-400 py-4 text-center">No invoice raised yet.</p>
              )}
            </div>
          </div>

          {/* ── Delivery & Batches ───────────────────────────────────────────── */}
          <div className="bg-white rounded-2xl shadow-sm border border-gray-100 p-4 space-y-3">
            <p className="text-xs font-semibold text-gray-500 uppercase tracking-wide flex items-center gap-1.5">
              <Truck size={12} />Delivery & Fulfilment
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
                        <span className={`text-[10px] px-2 py-0.5 rounded-full font-semibold ${colour}`}>
                          {d.state_label}
                        </span>
                        {d.date_done && (
                          <span className="text-xs text-gray-400">Delivered {fmtDate(d.date_done)}</span>
                        )}
                        {d.scheduled_date && d.state !== "done" && (
                          <span className="text-xs text-gray-400">Expected {fmtDate(d.scheduled_date)}</span>
                        )}
                      </div>
                      {d.lines.length > 0 && (
                        <div className="space-y-0.5 border-t border-gray-50 pt-2">
                          {d.lines.map((l, i) => {
                            const lots = lot_map[l.product_id] || [];
                            return (
                              <div key={i} className="flex items-start gap-2 text-xs text-gray-500">
                                <span className="flex-1 truncate">{l.product_name}</span>
                                <span className="shrink-0 tabular-nums">
                                  {l.qty_done}/{l.qty_ordered} units
                                  {l.qty_done < l.qty_ordered && (
                                    <span className="text-orange-500 ml-1">({l.qty_ordered - l.qty_done} outstanding)</span>
                                  )}
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

          {/* ── Backorder / Production ───────────────────────────────────────── */}
          {(hasBackorder || manufacturing_orders.length > 0) && (
            <div className="bg-amber-50 border border-amber-100 rounded-2xl p-4 space-y-3">
              <p className="text-xs font-semibold text-amber-800 uppercase tracking-wide flex items-center gap-1.5">
                <AlertTriangle size={12} />Backorder & Production
              </p>
              <p className="text-xs text-amber-700">
                This order has outstanding items on backorder. They will be dispatched when stock becomes available.
              </p>
              {manufacturing_orders.length > 0 && (
                <div className="space-y-2 border-t border-amber-100 pt-3">
                  <p className="text-[10px] font-semibold text-amber-800 uppercase tracking-wide flex items-center gap-1">
                    <Package size={10} />Production orders replenishing this backorder
                  </p>
                  {manufacturing_orders.map(mo => {
                    const colour = MO_COLOURS[mo.state] || "bg-gray-100 text-gray-500";
                    return (
                      <div key={mo.mo_id} className="flex items-start justify-between gap-2 text-xs">
                        <div className="min-w-0">
                          <span className="font-mono font-medium text-amber-900">{mo.mo_name}</span>
                          <span className="ml-1.5 text-amber-700">{mo.product_name}</span>
                          {mo.qty_producing > 0 && (
                            <span className="ml-1.5 text-green-700">{mo.qty_producing}/{mo.product_qty} producing</span>
                          )}
                          {mo.date_planned_finished && (
                            <span className="ml-1.5 text-amber-500">· due {fmtDate(mo.date_planned_finished)}</span>
                          )}
                        </div>
                        <span className={`shrink-0 px-1.5 py-0.5 rounded text-[10px] font-medium ${colour}`}>
                          {MO_LABELS[mo.state] || mo.state}
                        </span>
                      </div>
                    );
                  })}
                </div>
              )}
            </div>
          )}

          {/* ── Order lines ──────────────────────────────────────────────────── */}
          {order.lines?.length > 0 && (
            <div className="bg-white rounded-2xl shadow-sm border border-gray-100 p-4">
              <p className="text-xs font-semibold text-gray-500 uppercase tracking-wide mb-3">Order Lines</p>
              <div className="overflow-x-auto">
                <table className="w-full text-xs">
                  <thead>
                    <tr className="border-b border-gray-100">
                      <th className="text-left text-gray-400 font-semibold pb-2 uppercase tracking-wide">Product</th>
                      <th className="text-right text-gray-400 font-semibold pb-2 uppercase tracking-wide">Qty</th>
                      <th className="text-right text-gray-400 font-semibold pb-2 uppercase tracking-wide">Unit Price</th>
                      <th className="text-right text-gray-400 font-semibold pb-2 uppercase tracking-wide">Subtotal</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-gray-50">
                    {order.lines.map((line, i) => {
                      const pid = line.product_id?.[0];
                      const lots = pid && lot_map[pid] ? lot_map[pid] : [];
                      return (
                        <tr key={i}>
                          <td className="py-2 pr-4">
                            <p className="text-gray-800 font-medium">{line.name || line.product_id?.[1]}</p>
                            {lots.length > 0 && (
                              <p className="font-mono text-[10px] text-bassani-600 mt-0.5">Batch: {lots.join(", ")}</p>
                            )}
                          </td>
                          <td className="py-2 text-right tabular-nums text-gray-700">{line.product_uom_qty}</td>
                          <td className="py-2 text-right tabular-nums text-gray-700">{fmtR(line.price_unit)}</td>
                          <td className="py-2 text-right tabular-nums font-medium text-gray-800">{fmtR(line.price_subtotal)}</td>
                        </tr>
                      );
                    })}
                  </tbody>
                  <tfoot>
                    <tr className="border-t-2 border-gray-200">
                      <td colSpan={3} className="pt-2 text-right text-gray-500 font-semibold uppercase tracking-wide text-[10px] pr-4">Total</td>
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
            {invoice && (
              <BtnSecondary onClick={() => navigate("/invoices")}>
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
    </div>
  );
}
