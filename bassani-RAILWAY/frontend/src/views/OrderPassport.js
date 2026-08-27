import { useState, useEffect, useRef, Fragment } from "react";
import { useParams, useNavigate, useLocation } from "react-router-dom";
import { useAuth } from "../AuthContext";
import api from "../api";
import toast from "react-hot-toast";
import {
  ChevronLeft, Package, FileText, Truck, FileSearch,
  CheckCircle2, Clock, ExternalLink, RefreshCw, Check, ClipboardCheck,
  Repeat, RotateCcw, Upload, Loader2, Factory, X, AlertTriangle, XCircle, Mail, Pencil,
} from "lucide-react";
import {
  fmtDate, BtnSecondary, BtnPrimary, BtnDanger, Modal,
  FormGroup, Input, Select, LoadingState, OdooPdfViewerModal, StatCard,
  ageTierTextClass, AgeTierBadge,
} from "../components/UI";
import RecurringOrderSetupModal from "../components/RecurringOrderSetupModal";
import { HorizontalTimelineCard, ticketStageLabel } from "../components/OrderTimeline";
import DeliveryFulfilmentCard from "../components/DeliveryFulfilmentCard";

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
// Wording matches OrdersTickets.js's own STATUS_LABEL exactly (2026-08-27
// fix, found live) — "ready" on the packing board means ready for QA/RP
// inspection, not ready for the customer to collect; only "complete" means
// that. This card had the two swapped, so a card sitting at "ready" (before
// any QA/RP sign-off) showed "Ready for Collection" — the same "ready" vs
// "complete" mix-up already fixed in OrderTimeline.js, just a second,
// independent copy of the mistake in a plain label map rather than the
// timeline's own state logic.
const PACK_LABEL = {
  queued: "Queued", packing: "Packing In Progress", ready: "Ready for Inspection",
  complete: "Ready for Collection", incomplete: "Incomplete", cancelled: "Cancelled",
  collected: "Collected", cleared: "Cleared", waiting_stock: "Awaiting Stock",
};

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

// ── Timeline — moved to components/OrderTimeline.js (2026-08-26) once
// SalesTickets.js needed the identical buildTimelineSteps() /
// collapseTimelineSteps() / HorizontalTimelineCard, so the two pages can
// never disagree about what stage an order/ticket is at. Imported at the
// top of this file.

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

  // Edit Quote (2026-08-25) — reuses the exact same cart editQuote flow
  // SalesTickets.js's reseller-only Edit Quote button already hands off to
  // (same navigation state shape: ticketId/orderId/customerName/customerId/
  // lines), just reachable from Order Passport instead, and extended to
  // customer too (see ticket_routes.py::_require_ticket_editor for the
  // matching backend access change). Draft-only — Odoo locks a confirmed
  // order's lines, same gate as Confirm/Cancel Order in the toolbar.
  const doEditQuote = () => {
    if (!data?.ticket?.ticket_id || !data?.order) return;
    const order = data.order;
    navigate("/orders", {
      state: {
        editQuote: {
          ticketId:     data.ticket.ticket_id,
          orderId:      order.id,
          customerName: order.partner_id?.[1] || "",
          customerId:   order.partner_id?.[0],
          lines: (order.lines || []).map(l => ({
            product_id:      Array.isArray(l.product_id) ? l.product_id[0] : l.product_id,
            product_uom_qty: l.product_uom_qty,
            price_unit:      l.price_unit,
            name:            l.name,
            _sku:            "",
            _taxRate:        0,
          })),
        },
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
          toast.error(e.response.data?.detail || "This order is over your credit limit. Please contact us to proceed.", { duration: 10000 });
        }
      } else {
        toast.error(e.response?.data?.detail || "Failed to confirm order");
      }
    } finally {
      setConfirming(false);
    }
  };

  // Self-cancel (2026-08-25) — reseller/customer, draft-only. Deliberately a
  // separate, narrower endpoint (PUT /{order_id}/self-cancel) from the
  // staff-only PUT /{order_id}/cancel — once an order is confirmed it can
  // carry stock reservations/deposit-gate/commission implications a customer
  // shouldn't be able to unilaterally undo, so that stays a "contact
  // Bassani" case, same as every other confirmed-order edge case in this app.
  const [cancelConfirm, setCancelConfirm] = useState(false);
  const [cancelling,    setCancelling   ] = useState(false);

  const doCancelOrder = async () => {
    if (!data?.order?.id) return;
    setCancelling(true);
    try {
      await api.put(`/api/orders/${data.order.id}/self-cancel`);
      toast.success("Order cancelled");
      setCancelConfirm(false);
      load();
    } catch (e) {
      toast.error(e.response?.data?.detail || "Failed to cancel order");
    } finally {
      setCancelling(false);
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

  const { order, ticket, packing, invoices = [], deliveries, lot_map, product_images = {}, manufacturing_orders, overall_status, support_email, age_tier } = data;
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
  // Outstanding (2026-08-25 fix, refined same day) — the real running
  // balance still owed on the WHOLE order, not the sum of open invoice
  // residuals. Those aren't the same thing: the down-payment invoice
  // registered at deposit time is for the deposit amount only (e.g. 50% of
  // the order) and shows residual 0 the moment it's paid, so summing
  // residuals alone would read "R0 outstanding" immediately after the
  // deposit, while the real remaining balance is still the other 50%.
  // Subtracting total-paid-so-far from the order total is correct
  // regardless of how many invoices exist or how Odoo splits the
  // deposit/final amounts across them — and it's well-defined even before
  // any invoice exists at all: if nothing has been registered yet,
  // totalPaid is 0 and the full order total is, correctly, outstanding
  // (nothing has been paid). No longer hidden behind a null/"—" state
  // pre-deposit — that undersold what's actually owed.
  // Known limitation, not handled: a credit note (move_type "out_refund")
  // is summed the same as a normal invoice here rather than netted off
  // separately — same limitation the Invoice(s) card below already has.
  const totalPaid = invoices.reduce((s, i) => s + ((i.amount_total || 0) - (i.amount_residual || 0)), 0);
  const outstandingTotal = Math.max(0, (order.amount_total || 0) - totalPaid);
  // Order age (2026-08-25, replaces the old "Fulfilled %" tile — see below).
  const orderAgeDays = order.date_order
    ? Math.max(0, Math.floor((Date.now() - new Date(order.date_order).getTime()) / 86400000))
    : null;

  // Proof of Payment card (2026-08-21; reverted to its own card with its own
  // upload action 2026-08-25 — product owner's call that it reads better as
  // a standalone card than folded into Actions). Computed once here, rather
  // than inline in the sidebar JSX, so it can be *positioned* differently by
  // role without duplicating its content logic — reseller/customer see it
  // first in the sidebar (2026-08-25, product owner's call — it's the one
  // thing most likely to need their attention), staff see it in its
  // original position further down. Reseller/customer: shown once there's
  // an active ticket to upload against, with the upload action and an
  // explicit "this is optional" line so it never reads as a required step
  // blocking their order. Staff/anyone without upload access: only shown
  // once something has actually been uploaded (nothing to act on
  // otherwise), read-only. The timeline's own "Upload proof of payment"
  // quick-access link on the current Deposit step is unrelated and
  // unaffected — same underlying upload trigger, just a second entry point.
  // `canUploadPop` also requires the order to actually be confirmed
  // (`["sale","done"]`, matching the Pro-Forma Invoice button's own gate)
  // — found live 2026-08-25: a ticket exists the moment any order is
  // created, draft or not (create_order always auto-creates one), so this
  // card was incorrectly offering "upload proof of payment" on a still-
  // draft order that has no deposit obligation yet at all.
  const canUploadPop = (isReseller || isCustomer) && ["sale", "done"].includes(order.state) && ticket?.ticket_id && !ticket.exit_status;
  const popCard = (canUploadPop || ticket?.pop_uploads?.length > 0) ? (
    <SideCard
      icon={Upload} title="Proof of Payment"
      action={canUploadPop && (
        <BtnSecondary onClick={() => popFileInputRef.current?.click()} loading={popUploading} size="sm">
          <Upload size={12} />Upload
        </BtnSecondary>
      )}
    >
      {canUploadPop && (
        <p className="text-xs text-gray-400">
          This is optional. We'll still confirm your payment through the usual process either way,
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
  ) : null;

  return (
    <div className="flex flex-col h-full overflow-hidden">
      {/* Toolbar */}
      <div className="flex items-center justify-between px-6 py-3 bg-white border-b border-gray-200 shrink-0">
        <button onClick={goBack}
          className="flex items-center gap-1.5 text-sm text-gray-500 hover:text-gray-800 transition-colors">
          <ChevronLeft size={14} />Back
        </button>
        <div className="flex items-center gap-2">
          {/* Edit Quote (2026-08-25) — draft only, same gate as Confirm/
              Cancel below (Odoo locks a confirmed order's lines). Hands off
              to the same cart editQuote flow SalesTickets.js's reseller-only
              Edit Quote button already used, now also open to customer. */}
          {(isReseller || isCustomer) && order.state === "draft" && ticket?.ticket_id && (
            <BtnSecondary onClick={doEditQuote}>
              <Pencil size={13} />Edit Quote
            </BtnSecondary>
          )}
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
          {/* Self-cancel (2026-08-25) — draft only, matches the Confirm
              Order gate exactly; a confirmed order still goes through
              Bassani (contact via the Need Help card below). */}
          {(isReseller || isCustomer) && order.state === "draft" && (
            <BtnDanger onClick={() => setCancelConfirm(true)}>
              <X size={13} />Cancel Order
            </BtnDanger>
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
          {/* View Quotation / Pro-Forma Invoice both moved into the
              "Quotes & Invoices" sidebar card for reseller/customer
              (2026-08-25) — that's where this role actually looks for order
              billing documents, consolidated with the real invoice list
              rather than split between the toolbar and a sidebar card.
              Staff's own "View Quote (Odoo)" moved out of the toolbar too
              (2026-08-27, product owner: too easy to miss up here) — now
              lives as a top-right action on the Order Lines card itself. */}
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
              <div className="min-w-0">
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
                  {partner.phone && <span className="text-gray-400 ml-2">· {partner.phone}</span>}
                </p>
                {/* Address / Deliver To / Terms+VAT (2026-08-25) — folded into
                    this compact block instead of a separate bordered "meta
                    row" section below the KPI tiles, to keep the hero card
                    shorter overall. "Date" was dropped entirely rather than
                    repositioned — it's already shown as the Order Age tile's
                    own "Placed {date}" caption below, so repeating it here
                    added height without adding information. */}
                {partner.street && (
                  <p className="text-xs text-gray-400 mt-1">
                    {[partner.street, partner.city, partner.zip].filter(Boolean).join(", ")}
                  </p>
                )}
                {order.shipping_detail && (
                  <p className="text-xs text-bassani-700 font-semibold mt-0.5">
                    Deliver to: {[order.shipping_detail.name, order.shipping_detail.street, order.shipping_detail.street2, order.shipping_detail.city, order.shipping_detail.zip].filter(Boolean).join(", ")}
                  </p>
                )}
                {(order.payment_term_id || partner.vat) && (
                  <p className="text-xs text-gray-400 mt-1">
                    {order.payment_term_id && <span>Terms: {order.payment_term_id[1]}</span>}
                    {order.payment_term_id && partner.vat && <span className="mx-1.5">·</span>}
                    {partner.vat && <span>VAT: {partner.vat}</span>}
                  </p>
                )}
              </div>
              <div className="text-right shrink-0">
                <StatusBadge overall={overall_status} />
                <p className="text-xs text-gray-400 mt-1.5 max-w-[220px]">{overall_status.detail}</p>
              </div>
            </div>

            {/* KPI stat tiles */}
            <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
              <StatCard label="Order Total" value={fmtR(order.amount_total)} />
              <StatCard
                label="Outstanding"
                value={fmtR(outstandingTotal)}
                sub={outstandingTotal === 0 ? "Paid in full" : totalPaid === 0 ? "No deposit registered yet" : "Balance still due"}
                accent={outstandingTotal > 0 ? "text-red-600" : "text-green-700"}
              />
              {/* Items (2026-08-25, icon added same day) — carries the
                  stock-availability signal "Fulfilled %" used to gesture at,
                  honestly this time: whether everything will ship together,
                  from the same hasBackorder data the rest of the page
                  already uses (Delivery & Fulfilment's own badge, the More
                  Actions Backorders link). */}
              <StatCard
                label="Items"
                value={order.lines?.length || 0}
                sub={hasBackorder ? (
                  <span className="inline-flex items-center gap-1 text-amber-600 font-medium">
                    <AlertTriangle size={11} />
                    {outstandingLines.length > 0 ? `${outstandingLines.length} backordered` : "Some items backordered"}
                  </span>
                ) : (
                  <span className="inline-flex items-center gap-1 text-green-600 font-medium">
                    <CheckCircle2 size={11} />
                    All in stock
                  </span>
                )}
              />
              {/* Order Age (2026-08-25) — replaces "Fulfilled %", which read
                  as "your order is X% done" when it actually only reflected
                  Odoo's qty_delivered (updated at pick/delivery time, not
                  order time) — a customer could see "100% Fulfilled" once
                  packed and ready, before ever collecting or paying the
                  balance, and reasonably conclude the order was finished.
                  Age is a safe, unambiguous, non-redundant signal instead. */}
              <StatCard
                label="Order Age"
                value={orderAgeDays === null ? "—" : orderAgeDays === 0 ? "Today" : orderAgeDays === 1 ? "1 day" : `${orderAgeDays} days`}
                accent={ageTierTextClass(age_tier)}
                sub={
                  <span className="flex items-center gap-1.5">
                    {order.date_order && `Placed ${fmtDate(order.date_order)}`}
                    <AgeTierBadge tier={age_tier} />
                  </span>
                }
              />
            </div>
          </div>

          {/* ── Order Timeline — full width (2026-08-25) ─────────────────────
              Previously lived inside the two-column grid's main column,
              squeezed to roughly (page width - 360px sidebar); the horizontal
              stepper needs the room now that it always renders the full
              8-11 step lifecycle rather than truncating early (see the
              buildTimelineSteps() fix above). Sits above the two-column
              grid instead, spanning the full max-w-6xl width. */}
          <div className="mb-4">
            {/* Staff now get the same horizontal timeline as reseller/customer
                (2026-08-26, product owner: the two views were needlessly
                different) — the old dense/dated vertical TimelineCard was
                removed outright rather than kept unused (unused React
                component definitions trip react-app's no-unused-vars ESLint
                rule, which CRA promotes to a build-breaking error under
                CI=true). onUploadPop stays reseller/customer-only since
                staff already have their own Register Deposit action
                elsewhere on this page; the CTA link just doesn't render
                when it's not passed. */}
            <HorizontalTimelineCard
              order={order} ticket={ticket} packing={packing} invoices={invoices} manufacturing_orders={manufacturing_orders}
              onUploadPop={(isReseller || isCustomer) && ticket?.ticket_id && !ticket.exit_status ? () => popFileInputRef.current?.click() : null}
            />
          </div>

          {/* ── Two-column body: record (order lines/deliveries) + sidebar ─── */}
          <div className="grid grid-cols-1 lg:grid-cols-[1fr_360px] gap-4 items-start">

            {/* Main column */}
            <div className="space-y-4 min-w-0">

              {/* ── Order lines ──────────────────────────────────────────────── */}
              {order.lines?.length > 0 && (
                <div className="bg-white rounded-2xl shadow-sm border border-gray-100 p-4">
                  <div className="flex items-center justify-between gap-2 mb-3">
                    <p className="text-xs font-semibold text-gray-500 uppercase tracking-wide flex items-center gap-1.5">
                      <ClipboardCheck size={12} />Order Lines
                    </p>
                    {/* Staff-only "View Quote (Odoo)" (2026-08-27, moved out
                        of the toolbar — too easy to miss up there). */}
                    {!isReseller && !isCustomer && (
                      <button
                        onClick={() => setPdfView({ url: `/api/orders/${orderId}/quote-pdf`, title: `${order.name} — Quotation` })}
                        className="flex items-center gap-1 text-xs text-bassani-600 hover:text-bassani-800 font-medium shrink-0"
                      >
                        <FileSearch size={11} />View Quote (Odoo)
                      </button>
                    )}
                  </div>
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
                          // Backorders (/orders/backorders) is a staff-only
                          // permission-gated page — clicking through was a
                          // dead link for reseller/customer even before this
                          // pass; the "outstanding" badge itself still shows
                          // for every role, just not clickable for this one.
                          const canOpenBackorder = isOutstanding && !isReseller && !isCustomer;
                          return (
                            <tr
                              key={i}
                              className={`${isOutstanding ? "bg-orange-50/40" : ""} ${canOpenBackorder ? "cursor-pointer hover:bg-orange-100/60 transition-colors" : ""}`}
                              onClick={canOpenBackorder ? () => navigate("/orders/backorders", { state: { soName: order.name } }) : undefined}
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
                          <td colSpan={4} className="pt-2 text-right text-gray-400 pr-3 hidden sm:table-cell">Subtotal (excl. VAT)</td>
                          <td colSpan={2} className="pt-2 text-right text-gray-400 pr-3 sm:hidden">Subtotal (excl. VAT)</td>
                          <td className="pt-2 text-right tabular-nums text-gray-600">{fmtR((order.amount_total || 0) - (order.amount_tax || 0))}</td>
                        </tr>
                        <tr>
                          <td colSpan={4} className="pt-1 text-right text-gray-400 pr-3 hidden sm:table-cell">VAT</td>
                          <td colSpan={2} className="pt-1 text-right text-gray-400 pr-3 sm:hidden">VAT</td>
                          <td className="pt-1 text-right tabular-nums text-gray-600">{fmtR(order.amount_tax)}</td>
                        </tr>
                        <tr>
                          <td colSpan={4} className="pt-1 text-right text-gray-500 font-semibold uppercase tracking-wide text-[10px] pr-3 hidden sm:table-cell">Order Total</td>
                          <td colSpan={2} className="pt-1 text-right text-gray-500 font-semibold uppercase tracking-wide text-[10px] pr-3 sm:hidden">Order Total</td>
                          <td className="pt-1 text-right tabular-nums font-bold text-gray-900">{fmtR(order.amount_total)}</td>
                        </tr>
                        {/* Deposit/payment breakdown (2026-08-26) — once a
                            payment exists against this order (typically the
                            50% deposit), show the running invoice-style calc
                            rather than just the flat order total, so the
                            deposit and what's still owed are visible right
                            next to the line items rather than only on the
                            Outstanding KPI tile further up the page. Reuses
                            totalPaid/outstandingTotal, already computed
                            above for that tile — same numbers, just shown in
                            context here too, never a second calculation. */}
                        {totalPaid > 0 && (
                          <>
                            <tr>
                              <td colSpan={4} className="pt-1 text-right text-green-700 pr-3 hidden sm:table-cell">Less: Payments Received</td>
                              <td colSpan={2} className="pt-1 text-right text-green-700 pr-3 sm:hidden">Less: Payments Received</td>
                              <td className="pt-1 text-right tabular-nums text-green-700">-{fmtR(totalPaid)}</td>
                            </tr>
                            <tr className="border-t border-gray-200">
                              <td colSpan={4} className="pt-1 text-right text-gray-500 font-semibold uppercase tracking-wide text-[10px] pr-3 hidden sm:table-cell">Balance Due</td>
                              <td colSpan={2} className="pt-1 text-right text-gray-500 font-semibold uppercase tracking-wide text-[10px] pr-3 sm:hidden">Balance Due</td>
                              <td className={`pt-1 text-right tabular-nums font-bold ${outstandingTotal > 0 ? "text-red-600" : "text-green-700"}`}>{fmtR(outstandingTotal)}</td>
                            </tr>
                          </>
                        )}
                      </tfoot>
                    </table>
                  </div>
                  {/* Paid-in-full-via-deposit note (2026-08-26) — found live:
                      a staff member registering 100% upfront (the "Fixed
                      Amount" deposit option already supports this) saw only
                      the down-payment invoice and its single line item, and
                      reasonably asked whether a proper final invoice would
                      ever be generated. It will — automatically, at
                      mark_complete, same as every order regardless of
                      deposit % (see the "Invoice timing" business rule) —
                      this just sets that expectation up front rather than
                      leaving it to be discovered/asked about. Heuristic:
                      exactly one invoice exists and it already covers the
                      full order total — this note naturally stops appearing
                      the moment a second (final) invoice is created. */}
                  {invoices.length === 1 && totalPaid > 0 && outstandingTotal === 0 && (
                    <p className="text-[11px] text-gray-400 mt-2 px-1">
                      Paid in full via deposit. The final invoice reflecting the completed order will be generated automatically once packing, QA, and RP sign-off are complete.
                    </p>
                  )}
                </div>
              )}

              {/* ── Delivery & Fulfilment (2026-08-25: staff only) ─────────────
                  Picking references, raw Odoo delivery state, and the
                  delivery-slip PDF are internal warehouse/operations detail —
                  a reseller/customer already gets the milestones that matter
                  to them (Queued/Packing/Ready for Collection/Collected) from
                  the timeline above, without the Odoo-facing mechanics.
                  Shared component (2026-08-26) with SalesTickets.js's
                  identical card — see DeliveryFulfilmentCard.js for the
                  redesign rationale. */}
              {!isReseller && !isCustomer && (
                <DeliveryFulfilmentCard
                  deliveries={deliveries}
                  lotMap={lot_map}
                  onViewSlip={d => setPdfView({ url: `/api/orders/${orderId}/deliveries/${d.id}/pdf`, title: `${d.name} — Odoo delivery slip` })}
                />
              )}
            </div>

            {/* Sidebar — status/action cards, sticky on desktop */}
            <div className="space-y-4 lg:sticky lg:top-4">

              {/* Proof of Payment first for reseller/customer (2026-08-25,
                  product owner's call) — content/logic defined once above as
                  popCard; staff see it further down, in its original
                  position, unchanged. */}
              {(isReseller || isCustomer) && popCard}

              {/* Actions card (2026-08-25) — reseller/customer only, replaces
                  the internal-only Sales Ticket card at this position in the
                  sidebar. Reorder/Make Recurring moved here from the toolbar;
                  Confirm Order stays in the toolbar since it's urgent/primary
                  for a draft order rather than a routine management action.
                  Kept to order-level actions only (2026-08-25, reverted the
                  same-day Upload Proof of Payment move) — POP is its own
                  card again below, product owner's own call on how it reads
                  visually; this card stays scoped to "actions on the order
                  itself." */}
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

              {/* Packing card (2026-08-25: staff only) — packer name, packing
                  slip number, and QA/RP approver names are internal
                  operational detail; the horizontal timeline's merged
                  "Packing" and "Compliance Sign-Off" steps already give
                  reseller/customer the milestones that matter (has it
                  started, has it been approved) without the operational
                  detail behind them. */}
              {!isReseller && !isCustomer && (
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
              )}

              {/* Proof of Payment, staff position (2026-08-25) — content/
                  logic defined once above as popCard; reseller/customer see
                  it first in the sidebar instead (above the Actions card). */}
              {!isReseller && !isCustomer && popCard}

              {/* ── Quotes & Invoices (reseller/customer) / Invoice(s) (staff)
                  ─────────────────────────────────────────────────────────
                  2026-08-25: consolidated for reseller/customer into a
                  single always-present card — View Quotation and View
                  Pro-Forma Invoice moved here from the toolbar (View
                  Quotation) and the invoice empty-state (Pro-Forma), so
                  every order document lives in one place instead of split
                  across the app bar and two different card states. Staff
                  keep the original Invoice(s)/Invoice card unchanged below,
                  reached via the "View Quote (Odoo)" action on the Order
                  Lines card (2026-08-27, moved out of the toolbar itself)
                  for the quotation instead. */}
              {(isReseller || isCustomer) ? (
                <SideCard
                  icon={FileText} title="Quotes & Invoices"
                  action={invoices.length > 0 && (
                    <button
                      onClick={() => navigate("/invoices", { state: { openInvoiceId: invoices[0]?.invoice_id, filter: "all" } })}
                      className="flex items-center gap-1 text-xs text-bassani-600 hover:text-bassani-800 font-medium">
                      Open <ExternalLink size={11} />
                    </button>
                  )}
                >
                  <div className="space-y-3">
                    <div className="flex flex-col gap-1.5 pb-2.5 border-b border-gray-50">
                      <button
                        onClick={() => setPdfView({ url: `/api/orders/${orderId}/quote-pdf`, title: `${order.name} — Quotation` })}
                        className="flex items-center gap-1.5 text-xs font-medium text-bassani-600 hover:text-bassani-800"
                      >
                        <FileSearch size={12} />View Quotation
                      </button>
                      {/* Pro-forma is only ever real once the order's been
                          confirmed — send_deposit_due_proforma() fires at
                          that exact moment (8.47). */}
                      {["sale", "done"].includes(order.state) && (
                        <button
                          onClick={() => setPdfView({ url: `/api/orders/${orderId}/proforma-pdf`, title: `${order.name} — Pro-Forma Invoice` })}
                          className="flex items-center gap-1.5 text-xs font-medium text-bassani-600 hover:text-bassani-800"
                        >
                          <FileText size={12} />View Pro-Forma Invoice
                        </button>
                      )}
                    </div>
                    {invoices.length > 0 ? (
                      invoices.map(inv => (
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
                        </div>
                      ))
                    ) : (
                      <p className="text-xs text-gray-400">
                        No final invoice yet — we raise this once your order has been packed and approved.
                      </p>
                    )}
                  </div>
                </SideCard>
              ) : invoices.length > 0 ? (
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
                  </div>
                </SideCard>
              ) : (
                ["sale", "done"].includes(order.state) && (
                  <SideCard icon={FileText} title="Invoice">
                    <p className="text-xs text-gray-400">No invoice raised yet.</p>
                  </SideCard>
                )
              )}

              {/* ── More actions (2026-08-25: staff only) ───────────────────
                  Navigation not already covered by an inline "Open" link on
                  one of the cards above (Ticket/Packing/Invoices each carry
                  their own now) — the packing-board *display* screen is a
                  distinct destination from the packing board work queue
                  ("Open board" above), so both stay. Hidden entirely for
                  reseller/customer — Packing Board Display/Backorders/
                  Manufacturing Orders are all staff-only (orders.view,
                  which those roles structurally never have), leaving only
                  "All Orders" for this role, not worth a whole card on its
                  own; "Back" in the toolbar already covers that navigation. */}
              {!isReseller && !isCustomer && (
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
              )}

              {/* ── Need Help (2026-08-25) ────────────────────────────────────
                  Reseller/customer only. Every error toast on this page and
                  in the checkout flow ("contact Bassani directly") previously
                  pointed the customer somewhere with no actual contact detail
                  on screen — this closes that gap with the same address
                  already used as the fallback recipient across the backend's
                  own notification emails (settings.support_email). */}
              {(isReseller || isCustomer) && support_email && (
                <div className="bg-white rounded-2xl shadow-sm border border-gray-100 p-4 space-y-2">
                  <p className="text-xs font-semibold text-gray-500 uppercase tracking-wide mb-1 flex items-center gap-1.5">
                    <Mail size={12} />Need Help?
                  </p>
                  <p className="text-xs text-gray-500">
                    Questions about this order? Get in touch and we'll help.
                  </p>
                  <a
                    href={`mailto:${support_email}?subject=${encodeURIComponent(`Order ${order.name}`)}`}
                    className="flex items-center justify-center gap-1.5 text-xs font-medium text-bassani-600 hover:text-bassani-800 border border-bassani-100 bg-bassani-50 rounded-xl px-3 py-2"
                  >
                    <Mail size={13} />{support_email}
                  </a>
                </div>
              )}

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
                      This order cannot be partially fulfilled at this time. Please contact us directly to resolve the issue before confirming.
                    </p>
                  </div>
                </div>
              )}
              <div className="flex items-start gap-3 bg-amber-50 border border-amber-100 rounded-xl p-3 mb-4">
                <AlertTriangle size={15} className="text-amber-500 mt-0.5 shrink-0" />
                <div>
                  <p className="text-sm font-semibold text-amber-800">Some items are not in stock</p>
                  <p className="text-xs text-amber-700 mt-0.5">
                    We'll ship available items now and fulfil the rest as soon as stock arrives. You'll receive a separate confirmation when the backorder is ready.
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
      {cancelConfirm && (
        <Modal title="Cancel Order" onClose={() => setCancelConfirm(false)}>
          <p className="text-sm text-gray-600 mb-4">
            Cancel order <strong>{order.name}</strong>? This can't be undone — you'll need to place a new order if you change your mind.
          </p>
          <div className="flex justify-end gap-2">
            <BtnSecondary onClick={() => setCancelConfirm(false)}>Keep Order</BtnSecondary>
            <BtnDanger onClick={doCancelOrder} loading={cancelling}>Cancel Order</BtnDanger>
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
