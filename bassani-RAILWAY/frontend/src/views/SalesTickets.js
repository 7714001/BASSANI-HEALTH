// ─────────────────────────────────────────────────────────────────────────────
// Sales Tickets — Phase 8.5 / 8.6 / 8.7
// Three-view flow: list → detail (full page) → quote-builder (full page)
// The detail page embeds the live Odoo order document alongside ticket actions,
// keeping the sales clerk in one place for the entire inquiry-to-payment cycle.
// ─────────────────────────────────────────────────────────────────────────────
import { useState, useEffect, useCallback } from "react";
import { useLocation } from "react-router-dom";
import { useAuth } from "../AuthContext";
import api from "../api";
import toast from "react-hot-toast";
import {
  Plus, CreditCard, XCircle, CheckCircle2, Clock,
  UserPlus, ShoppingCart, Ban, DollarSign, Send, ChevronDown,
  Mail, Paperclip, ExternalLink, ChevronUp, FileText, Receipt,
} from "lucide-react";
import {
  TopBar, DataTable, Modal, FormGroup, Input, Select, Textarea,
  BtnPrimary, BtnSecondary, Badge, LoadingState, EmptyState, fmtDate,
} from "../components/UI";
import ProductLineRow from "../components/ProductLineRow";

const fmtR = (n) =>
  `R ${(n || 0).toLocaleString("en-ZA", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;

const STATUS_LABEL = {
  open: "Open (RFQ)", quote: "Quote", sale_order: "Sale Order", invoice: "Invoice",
  confirmed_wip: "Confirmed — WIP", ready_for_collection: "Ready for Collection", incomplete: "Incomplete",
};
const STATUS_COLOR = {
  open: "gray", quote: "amber", sale_order: "blue", invoice: "indigo",
  confirmed_wip: "teal", ready_for_collection: "green", incomplete: "orange",
};
const EXIT_LABEL  = { not_interested: "Not Interested", cancelled: "Cancelled", complete: "Complete" };
const EXIT_COLOR  = { not_interested: "gray", cancelled: "red", complete: "green" };
const FORWARD_STATUSES = ["open", "quote", "sale_order", "invoice", "confirmed_wip", "ready_for_collection", "incomplete"];
const PRE_CONFIRM = new Set(["open", "quote", "sale_order", "invoice"]);

const ORDER_STATE_LABEL = {
  draft: "Quotation", sent: "Quotation Sent", sale: "Sale Order", done: "Locked", cancel: "Cancelled",
};

const ROLE_LABEL = {
  super_admin: "Super Admin", admin: "Admin", sales: "Sales",
  orders_clerk: "Orders Clerk", finance: "Finance",
  qa_manager: "QA Manager", responsible_pharmacist: "RP",
};
const ORDER_STATE_COLOR = {
  draft: "gray", sent: "amber", sale: "blue", done: "green", cancel: "red",
};

// ── Main component ────────────────────────────────────────────────────────────
export default function SalesTickets() {
  const { can, user } = useAuth();
  const canDrive        = can("tickets.sales");
  const canFinance      = can("tickets.finance_confirm");
  const canManage       = can("tickets.manage");
  const canConfirmOrder = can("orders.confirm");

  // ── List state ────────────────────────────────────────────────────────────
  const [view, setView]       = useState("list"); // "list" | "detail" | "quote-builder"
  const [tickets, setTickets] = useState([]);
  const [loading, setLoading] = useState(true);

  const location = useLocation();

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const r = await api.get("/api/tickets/");
      setTickets(r.data.tickets || []);
    } catch { toast.error("Failed to load tickets"); }
    finally { setLoading(false); }
  }, []);
  useEffect(() => { load(); }, [load]);

  // Auto-open a specific ticket when navigated from the Invoices page
  useEffect(() => {
    const targetId = location.state?.openTicketId;
    if (!targetId || loading) return;
    const match = tickets.find(t => t.id === targetId);
    if (match) openDetail(match);
  }, [loading]); // eslint-disable-line

  // ── Create modal ──────────────────────────────────────────────────────────
  const [createModal, setCreateModal]       = useState(false);
  const [customerSearch, setCustomerSearch] = useState("");
  const [customerResults, setCustomerResults] = useState([]);
  const [selectedCustomer, setSelectedCustomer] = useState(null);
  const [createNote, setCreateNote]         = useState("");
  const [creating, setCreating]             = useState(false);

  useEffect(() => {
    if (!createModal || customerSearch.length < 2) { setCustomerResults([]); return; }
    const t = setTimeout(async () => {
      try {
        const r = await api.get("/api/customers/search", { params: { q: customerSearch, limit: 8 } });
        setCustomerResults(r.data.customers || []);
      } catch { setCustomerResults([]); }
    }, 300);
    return () => clearTimeout(t);
  }, [customerSearch, createModal]);

  const openCreate = () => {
    setSelectedCustomer(null); setCustomerSearch(""); setCustomerResults([]); setCreateNote("");
    setCreateModal(true);
  };

  const createTicket = async () => {
    if (!selectedCustomer) return toast.error("Select a customer first");
    setCreating(true);
    try {
      await api.post("/api/tickets/", { customer_id: selectedCustomer.id, note: createNote || undefined });
      toast.success("Ticket created");
      setCreateModal(false); load();
    } catch (e) { toast.error(e.response?.data?.detail || "Create failed"); }
    finally { setCreating(false); }
  };

  // ── Detail page state ─────────────────────────────────────────────────────
  const [detail, setDetail]             = useState(null);
  const [detailLoading, setDetailLoading] = useState(false);
  const [detailOrder, setDetailOrder]   = useState(null);
  const [detailOrderLoading, setDetailOrderLoading] = useState(false);
  const [inboxItem, setInboxItem]       = useState(null);
  const [showInboxPanel, setShowInboxPanel] = useState(true);
  const [deliveries,        setDeliveries       ] = useState([]);
  const [deliveriesLoading, setDeliveriesLoading] = useState(false);
  const [stageForm, setStageForm]       = useState({ status: "", order_id: "", invoice_id: "", note: "", incomplete_reason: "" });
  const [saving, setSaving]             = useState(false);
  const [confirming, setConfirming]     = useState(false);
  const [sending, setSending]           = useState(false);
  const [overrideOpen, setOverrideOpen] = useState(false);

  const openDetail = async (t) => {
    setDetail(null);
    setDetailOrder(null);
    setInboxItem(null);
    setShowInboxPanel(true);
    setDetailLoading(true);
    setView("detail");
    try {
      const r = await api.get(`/api/tickets/${t.id}`);
      const ticket = r.data;
      setDetail(ticket);
      setStageForm({
        status: ticket.status, order_id: ticket.order_id || "",
        invoice_id: ticket.invoice_id || "", note: "", incomplete_reason: "",
      });
      if (ticket.order_id) {
        setDetailOrderLoading(true);
        try {
          const or = await api.get(`/api/orders/${ticket.order_id}`);
          setDetailOrder(or.data);
        } catch { /* non-fatal — show fallback */ }
        finally { setDetailOrderLoading(false); }
      }
      if (ticket.inbox_item_id) {
        api.get(`/api/inbox/${ticket.inbox_item_id}`)
          .then(ir => setInboxItem(ir.data))
          .catch(() => {});
      }
    } catch {
      toast.error("Failed to load ticket");
      setView("list");
    } finally {
      setDetailLoading(false);
    }
  };

  // Refresh in-place after actions — stays on detail page
  const refreshDetail = async (ticketId) => {
    try {
      const r = await api.get(`/api/tickets/${ticketId}`);
      const ticket = r.data;
      setDetail(ticket);
      setStageForm({
        status: ticket.status, order_id: ticket.order_id || "",
        invoice_id: ticket.invoice_id || "", note: "", incomplete_reason: "",
      });
      if (ticket.order_id) {
        setDetailOrderLoading(true);
        try {
          const or = await api.get(`/api/orders/${ticket.order_id}`);
          setDetailOrder(or.data);
        } catch { setDetailOrder(null); }
        finally { setDetailOrderLoading(false); }
      } else {
        setDetailOrder(null);
      }
    } catch { toast.error("Failed to refresh ticket"); }
    load(); // silently refresh list in background
  };

  // Load deliveries whenever a ticket with an order is opened/refreshed
  useEffect(() => {
    const orderId = detail?.order_id;
    if (!orderId) { setDeliveries([]); return; }
    setDeliveriesLoading(true);
    api.get(`/api/orders/${orderId}/deliveries`)
      .then(r => setDeliveries(r.data.deliveries || []))
      .catch(() => setDeliveries([]))
      .finally(() => setDeliveriesLoading(false));
  }, [detail?.order_id]);

  const advance = async () => {
    if (stageForm.status === "incomplete" && !stageForm.incomplete_reason)
      return toast.error("A reason is required when marking incomplete");
    setSaving(true);
    const tid = detail.id;
    try {
      const body = { note: stageForm.note || undefined };
      if (stageForm.status !== detail.status) body.status = stageForm.status;
      if (stageForm.order_id)          body.order_id          = parseInt(stageForm.order_id);
      if (stageForm.invoice_id)        body.invoice_id        = parseInt(stageForm.invoice_id);
      if (stageForm.incomplete_reason) body.incomplete_reason = stageForm.incomplete_reason;
      await api.put(`/api/tickets/${tid}/stage`, body);
      toast.success("Ticket updated");
      refreshDetail(tid);
    } catch (e) { toast.error(e.response?.data?.detail || "Update failed"); }
    finally { setSaving(false); }
  };

  const markExit = async (exit_status) => {
    if (!window.confirm(`Mark this ticket as "${EXIT_LABEL[exit_status]}"? This closes the ticket.`)) return;
    setSaving(true);
    try {
      await api.put(`/api/tickets/${detail.id}/stage`, { exit_status });
      toast.success("Ticket closed");
      setDetail(null); setView("list"); load();
    } catch (e) { toast.error(e.response?.data?.detail || "Update failed"); }
    finally { setSaving(false); }
  };

  const assignToMe = async (ticketId) => {
    try {
      await api.put(`/api/tickets/${ticketId}/stage`, { assigned_to: user.id });
      toast.success("Ticket assigned to you");
      if (detail?.id === ticketId) refreshDetail(ticketId);
      else load();
    } catch (e) { toast.error(e.response?.data?.detail || "Assignment failed"); }
  };

  const confirmPayment = async () => {
    setSaving(true);
    const tid = detail.id;
    try {
      const r = await api.put(`/api/tickets/${tid}/confirm-payment`);
      toast.success(`Payment confirmed (Odoo: ${r.data.payment_state})`);
      refreshDetail(tid);
    } catch (e) { toast.error(e.response?.data?.detail || "Could not confirm payment"); }
    finally { setSaving(false); }
  };

  const sendQuote = async () => {
    setSending(true);
    try {
      const r = await api.post(`/api/tickets/${detail.id}/send-quote`);
      if (r.data.warning) {
        toast(`Quote marked sent — ${r.data.warning}`, { icon: "⚠️", duration: 8000 });
      } else {
        toast.success("Quote sent to customer");
      }
      refreshDetail(detail.id);
    } catch (e) {
      toast.error(e.response?.data?.detail || "Failed to send quote");
    } finally {
      setSending(false);
    }
  };

  const confirmOrder = async (overrideCredit = false) => {
    setConfirming(true);
    try {
      const { data } = await api.put(
        `/api/orders/${detail.order_id}/confirm`,
        null,
        { params: overrideCredit ? { override_credit: true } : {} },
      );
      if (data.invoice_name) {
        toast.success(`Order confirmed · Invoice ${data.invoice_name} created`);
      } else {
        toast.success("Order confirmed — ticket moved to WIP");
      }
      if (data.warnings?.length) {
        data.warnings.forEach(w => toast(w, { icon: "⚠️", duration: 8000 }));
      }
      refreshDetail(detail.id);
    } catch (e) {
      if (e.response?.status === 402) {
        setConfirming(false);
        if (window.confirm(`${e.response.data.detail}\n\nConfirm anyway?`)) {
          await confirmOrder(true);
        }
        return;
      }
      toast.error(e.response?.data?.detail || "Failed to confirm order");
    } finally {
      setConfirming(false);
    }
  };

  // ── Quote Builder ─────────────────────────────────────────────────────────
  const [quoteTicket, setQuoteTicket]           = useState(null);
  const [quoteLines, setQuoteLines]             = useState([]);
  const [quoteWarehouses, setQuoteWarehouses]   = useState([]);
  const [quoteWarehouseId, setQuoteWarehouseId] = useState("");
  const [quoteNote, setQuoteNote]               = useState("");
  const [quoteSaving, setQuoteSaving]           = useState(false);
  const [lastAddedId, setLastAddedId]           = useState(null);
  const [quoteMode, setQuoteMode]               = useState("create"); // "create" | "edit"
  const [quoteCustomer, setQuoteCustomer]               = useState(null); // {id, name} — edit mode only
  const [quoteCustomerSearch, setQuoteCustomerSearch]   = useState("");
  const [quoteCustomerResults, setQuoteCustomerResults] = useState([]);
  const [quoteCustomerEditing, setQuoteCustomerEditing] = useState(false);
  const [quoteAddresses, setQuoteAddresses]     = useState([]); // delivery addresses for current customer
  const [quoteShippingId, setQuoteShippingId]   = useState("");

  useEffect(() => {
    if (quoteMode !== "edit" || quoteCustomerSearch.length < 2) { setQuoteCustomerResults([]); return; }
    const t = setTimeout(async () => {
      try {
        const r = await api.get("/api/customers/search", { params: { q: quoteCustomerSearch, limit: 8 } });
        setQuoteCustomerResults(r.data.customers || []);
      } catch { setQuoteCustomerResults([]); }
    }, 300);
    return () => clearTimeout(t);
  }, [quoteCustomerSearch, quoteMode]);

  const newLine = () => ({
    _id: Date.now() + Math.random(),
    product_id: null, _product_label: "",
    name: "", product_uom_qty: 1,
    price_unit: 0, _tax_rate: 0, _sku: "", _stock: 0,
  });

  const loadQuoteAddresses = async (customerId) => {
    if (!customerId) { setQuoteAddresses([]); setQuoteShippingId(""); return; }
    try {
      const r = await api.get(`/api/customers/${customerId}/addresses`);
      const addrs = r.data.addresses || [];
      setQuoteAddresses(addrs);
      const delivery = addrs.find(a => a.type === "delivery");
      setQuoteShippingId(delivery ? String(delivery.id) : addrs.length > 0 ? String(addrs[0].id) : "");
    } catch {
      setQuoteAddresses([]);
      setQuoteShippingId("");
    }
  };

  const openQuoteBuilder = async (ticket) => {
    const firstLine = newLine();
    setQuoteTicket(ticket);
    setQuoteLines([firstLine]);
    setLastAddedId(firstLine._id);
    setQuoteNote("");
    setQuoteMode("create");
    setView("quote-builder");
    loadQuoteAddresses(ticket?.customer_id);

    if (quoteWarehouses.length === 0) {
      try {
        const r = await api.get("/api/warehouses/");
        const whs = r.data.warehouses || [];
        setQuoteWarehouses(whs);
        if (whs.length > 0) setQuoteWarehouseId(String(whs[0].id));
      } catch {
        console.warn("Quote builder — warehouses load failed (non-fatal)");
      }
    }
  };

  const openQuoteEdit = () => {
    const lines = (detailOrder?.lines || []).map(l => ({
      _id: Date.now() + Math.random(),
      product_id:      Array.isArray(l.product_id) ? l.product_id[0] : l.product_id,
      _product_label:  l.name,
      name:            l.name,
      product_uom_qty: l.product_uom_qty,
      price_unit:      l.price_unit,
      _tax_rate: 0, _sku: "", _stock: 0,
    }));
    // Init customer from the live Odoo order, not the stale ticket field
    const currentCustomer = {
      id:   Array.isArray(detailOrder?.partner_id) ? detailOrder.partner_id[0] : null,
      name: detailOrder?.partner_detail?.name || (Array.isArray(detailOrder?.partner_id) ? detailOrder.partner_id[1] : ""),
    };
    setQuoteCustomer(currentCustomer);
    setQuoteCustomerSearch("");
    setQuoteCustomerResults([]);
    setQuoteCustomerEditing(false);
    setQuoteTicket(detail);
    setQuoteLines(lines.length > 0 ? lines : [newLine()]);
    setLastAddedId(null);
    setQuoteNote("");
    setQuoteMode("edit");
    setView("quote-builder");
    const customerId = Array.isArray(detailOrder?.partner_id) ? detailOrder.partner_id[0] : detail?.customer_id;
    loadQuoteAddresses(customerId);
  };

  const addLine = () => {
    const l = newLine();
    setLastAddedId(l._id);
    setQuoteLines(prev => [...prev, l]);
  };

  const updateLine = (id, updates) =>
    setQuoteLines(prev => prev.map(l => l._id === id ? { ...l, ...updates } : l));

  const removeLine = (id) =>
    setQuoteLines(prev => {
      if (prev.length === 1) return [newLine()];
      return prev.filter(l => l._id !== id);
    });

  const cancelQuote = async () => {
    if (!window.confirm("Cancel this quote?\n\nThe Odoo draft order will be cancelled and the ticket closed.")) return;
    setSaving(true);
    try {
      await api.post(`/api/tickets/${detail.id}/cancel-order`);
      toast.success("Quote cancelled");
      setDetail(null); setView("list"); load();
    } catch (e) { toast.error(e.response?.data?.detail || "Cancel failed"); }
    finally { setSaving(false); }
  };

  const submitQuote = async () => {
    const validLines = quoteLines.filter(l => l.product_id);
    if (validLines.length === 0) return toast.error("Add at least one product before saving");
    setQuoteSaving(true);
    const tid = quoteTicket?.id;
    const linePayload = validLines.map(l => ({
      product_id: l.product_id, product_uom_qty: l.product_uom_qty,
      price_unit: l.price_unit, name: l.name,
    }));
    try {
      const shippingId = quoteShippingId ? parseInt(quoteShippingId) : undefined;
      if (quoteMode === "edit") {
        await api.put(`/api/tickets/${tid}/update-order`, {
          order_line: linePayload,
          customer_id: quoteCustomer?.id || undefined,
          partner_shipping_id: shippingId,
          note: quoteNote || undefined,
        });
        toast.success("Quote updated in Odoo");
      } else {
        await api.post(`/api/tickets/${tid}/create-order`, {
          order_line: linePayload,
          warehouse_id: quoteWarehouseId ? parseInt(quoteWarehouseId) : undefined,
          partner_shipping_id: shippingId,
          note: quoteNote || undefined,
        });
        toast.success("Quote created in Odoo — ticket advanced to Quote stage");
      }
      setQuoteMode("create");
      setView("detail");
      refreshDetail(tid);
    } catch (e) { toast.error(e.response?.data?.detail || "Failed to save quote"); }
    finally { setQuoteSaving(false); }
  };

  // ── Odoo document viewer ─────────────────────────────────────────────────
  const [docLoading, setDocLoading] = useState(null); // "quote" | "invoice" | null

  const openDocument = async (docType) => {
    setDocLoading(docType);
    try {
      const res = await api.get(`/api/tickets/${detail.id}/documents/${docType}`, { responseType: "blob" });
      const url = URL.createObjectURL(res.data);
      window.open(url, "_blank", "noopener,noreferrer");
      // Revoke after a short delay to allow the tab to load the blob
      setTimeout(() => URL.revokeObjectURL(url), 10000);
    } catch (e) {
      const msg = e.response?.data
        ? await e.response.data.text?.()
        : null;
      try { toast.error(JSON.parse(msg)?.detail || "Could not load document from Odoo"); }
      catch { toast.error("Could not load document from Odoo"); }
    } finally {
      setDocLoading(null);
    }
  };

  // ── Deposit Registration ──────────────────────────────────────────────────
  const [depositModal, setDepositModal]     = useState(false);
  const [depositJournals, setDepositJournals] = useState([]);
  const [depositForm, setDepositForm]       = useState({ amount: "", date: "", journal_id: "", note: "" });
  const [depositSaving, setDepositSaving]   = useState(false);

  const openDepositModal = async () => {
    const today = new Date().toISOString().split("T")[0];
    setDepositForm({ amount: "", date: today, journal_id: "", note: "" });
    try {
      const [journalRes, orderRes] = await Promise.all([
        api.get("/api/tickets/payment-journals"),
        detail?.order_id ? api.get(`/api/orders/${detail.order_id}`) : Promise.resolve(null),
      ]);
      const journals = journalRes.data.journals || [];
      setDepositJournals(journals);
      const orderTotal = orderRes?.data?.amount_total || 0;
      setDepositForm(f => ({
        ...f,
        amount:     orderTotal ? (orderTotal / 2).toFixed(2) : "",
        journal_id: journals[0]?.id ? String(journals[0].id) : "",
      }));
    } catch { toast.error("Failed to load deposit details"); }
    setDepositModal(true);
  };

  const registerDeposit = async () => {
    if (!depositForm.amount || !depositForm.date || !depositForm.journal_id)
      return toast.error("Amount, date and payment method are required");
    setDepositSaving(true);
    const tid = detail.id;
    try {
      await api.post(`/api/tickets/${tid}/register-deposit`, {
        amount:     parseFloat(depositForm.amount),
        date:       depositForm.date,
        journal_id: parseInt(depositForm.journal_id),
        note:       depositForm.note || undefined,
      });
      toast.success("Deposit registered and invoice created in Odoo");
      setDepositModal(false);
      refreshDetail(tid);
    } catch (e) { toast.error(e.response?.data?.detail || "Deposit registration failed"); }
    finally { setDepositSaving(false); }
  };

  // ── Balance Payment Registration ─────────────────────────────────────────
  const [balanceModal, setBalanceModal]     = useState(false);
  const [balanceJournals, setBalanceJournals] = useState([]);
  const [balanceForm, setBalanceForm]       = useState({ amount: "", date: "", journal_id: "", note: "" });
  const [balanceSaving, setBalanceSaving]   = useState(false);
  const [balanceInfo, setBalanceInfo]       = useState(null); // {amount_residual, invoice_name}

  const openBalanceModal = async () => {
    const today = new Date().toISOString().split("T")[0];
    setBalanceForm({ amount: "", date: today, journal_id: "", note: "" });
    setBalanceInfo(null);
    try {
      const [journalRes, balanceRes] = await Promise.all([
        api.get("/api/tickets/payment-journals"),
        api.get(`/api/tickets/${detail.id}/invoice-balance`),
      ]);
      const journals = journalRes.data.journals || [];
      setBalanceJournals(journals);
      const info = balanceRes.data;
      setBalanceInfo(info);
      setBalanceForm(f => ({
        ...f,
        amount:     info.amount_residual > 0 ? info.amount_residual.toFixed(2) : "",
        journal_id: journals[0]?.id ? String(journals[0].id) : "",
      }));
    } catch { toast.error("Failed to load invoice balance"); }
    setBalanceModal(true);
  };

  const registerBalance = async () => {
    if (!balanceForm.amount || !balanceForm.date || !balanceForm.journal_id)
      return toast.error("Amount, date and payment method are required");
    setBalanceSaving(true);
    const tid = detail.id;
    try {
      const r = await api.post(`/api/tickets/${tid}/register-payment`, {
        amount:     parseFloat(balanceForm.amount),
        date:       balanceForm.date,
        journal_id: parseInt(balanceForm.journal_id),
        note:       balanceForm.note || undefined,
      });
      const residual = r.data.amount_residual;
      if (residual > 0) {
        toast.success(`Payment registered — R${residual.toLocaleString("en-ZA", { minimumFractionDigits: 2 })} still outstanding`);
      } else {
        toast.success("Payment registered — invoice fully paid in Odoo");
      }
      setBalanceModal(false);
      refreshDetail(tid);
    } catch (e) { toast.error(e.response?.data?.detail || "Payment registration failed"); }
    finally { setBalanceSaving(false); }
  };

  // ── Quote totals ──────────────────────────────────────────────────────────
  const quoteSubtotal = quoteLines.reduce((s, l) => s + l.product_uom_qty * l.price_unit, 0);
  const quoteVat      = quoteLines.reduce((s, l) => s + l.product_uom_qty * l.price_unit * (l._tax_rate / 100), 0);
  const quoteTotal    = quoteSubtotal + quoteVat;
  const hasValidLines = quoteLines.some(l => l.product_id);
  const today         = new Date().toLocaleDateString("en-ZA", { day: "2-digit", month: "short", year: "numeric" });


  // ── Detail — full-page ticket view ────────────────────────────────────────
  if (view === "detail") {
    const orderStateLabel = ORDER_STATE_LABEL[detailOrder?.state] || "—";
    const orderStateColor = ORDER_STATE_COLOR[detailOrder?.state] || "gray";

    return (
      <div className="flex flex-col flex-1 overflow-hidden bg-slate-50">
        <TopBar
          title={detail?.customer_name || "Loading…"}
          subtitle={
            detail
              ? detail.exit_status
                ? EXIT_LABEL[detail.exit_status]
                : (STATUS_LABEL[detail.status] || detail.status)
              : ""
          }
          actions={
            <BtnSecondary onClick={() => { setDetail(null); setDetailOrder(null); setView("list"); }}>
              ← Back to Tickets
            </BtnSecondary>
          }
        />

        {detailLoading || !detail ? (
          <div className="flex-1 flex items-center justify-center"><LoadingState /></div>
        ) : (
          <main className="flex-1 overflow-y-auto p-6">
            <div className="max-w-7xl mx-auto">
              <div className="grid grid-cols-1 lg:grid-cols-3 gap-6 items-start">

                {/* ── Left: Order document (2/3 width) ── */}
                <div className="lg:col-span-2 space-y-4">
                  {detail.order_id ? (
                    detailOrderLoading ? (
                      <div className="bg-white rounded-2xl shadow-sm border border-gray-100 p-12">
                        <LoadingState />
                      </div>
                    ) : detailOrder ? (
                      <>
                      <div className="bg-white rounded-2xl shadow-sm border border-gray-100 overflow-hidden">

                        {/* Document header */}
                        <div className="p-6 border-b border-gray-100">
                          <div className="flex items-start justify-between mb-5">
                            <div>
                              <h2 className="text-2xl font-bold tracking-tight text-gray-900">
                                {orderStateLabel.toUpperCase()}
                              </h2>
                              <p className="text-sm font-mono text-gray-400 mt-0.5">{detailOrder.name}</p>
                            </div>
                            <div className="text-right">
                              <Badge color={orderStateColor}>{orderStateLabel}</Badge>
                              <p className="text-xs text-gray-400 mt-1.5">
                                {detailOrder.date_order
                                  ? new Date(detailOrder.date_order).toLocaleDateString("en-ZA", {
                                      day: "2-digit", month: "short", year: "numeric",
                                    })
                                  : "—"}
                              </p>
                            </div>
                          </div>
                          <div className="grid grid-cols-1 sm:grid-cols-2 gap-6 pt-4 border-t border-gray-50">
                            <div>
                              <p className="text-xs font-semibold text-gray-400 uppercase tracking-wide mb-1.5">Bill To</p>
                              <p className="text-sm font-semibold text-gray-900">
                                {detailOrder.partner_detail?.name || detailOrder.partner_id?.[1] || "—"}
                              </p>
                              {detailOrder.partner_detail?.street && (
                                <p className="text-xs text-gray-400 mt-0.5">{detailOrder.partner_detail.street}</p>
                              )}
                              {(detailOrder.partner_detail?.city || detailOrder.partner_detail?.zip) && (
                                <p className="text-xs text-gray-400">
                                  {[detailOrder.partner_detail.city, detailOrder.partner_detail.zip].filter(Boolean).join(", ")}
                                </p>
                              )}
                              {detailOrder.partner_detail?.vat && (
                                <p className="text-xs text-gray-400">VAT: {detailOrder.partner_detail.vat}</p>
                              )}
                            </div>
                            <div>
                              <p className="text-xs font-semibold text-gray-400 uppercase tracking-wide mb-1.5">Warehouse</p>
                              <p className="text-sm font-semibold text-gray-900">
                                {Array.isArray(detailOrder.warehouse_id) ? detailOrder.warehouse_id[1] : "—"}
                              </p>
                              <p className="text-xs text-gray-400 mt-0.5">Stock deducted from this location</p>
                            </div>
                          </div>
                        </div>

                        {/* Line items table */}
                        <div className="overflow-x-auto">
                        <table className="w-full">
                          <thead>
                            <tr className="border-b border-gray-100 bg-slate-50/50">
                              <th className="text-left p-3 pl-6 text-xs font-semibold text-gray-400 uppercase tracking-wide">Product</th>
                              <th className="text-center p-3 text-xs font-semibold text-gray-400 uppercase tracking-wide w-20">Qty</th>
                              <th className="text-right p-3 text-xs font-semibold text-gray-400 uppercase tracking-wide w-36">Unit Price</th>
                              <th className="text-right p-3 pr-6 text-xs font-semibold text-gray-400 uppercase tracking-wide w-36">Subtotal</th>
                            </tr>
                          </thead>
                          <tbody>
                            {(detailOrder.lines || []).map((line, i) => {
                              const full       = line.name || line.product_id?.[1] || "";
                              const bracketIdx = full.indexOf(" (");
                              const base       = bracketIdx !== -1 ? full.slice(0, bracketIdx) : full;
                              const variant    = bracketIdx !== -1 ? full.slice(bracketIdx + 2, -1) : null;
                              return (
                              <tr key={i} className="border-b border-gray-50 hover:bg-slate-50/30">
                                <td className="p-3 pl-6">
                                  <p className="text-sm font-medium text-gray-900">{base}</p>
                                  {variant && (
                                    <span className="text-[10px] bg-bassani-50 text-bassani-700 rounded px-1.5 py-0.5 font-medium leading-none mt-1 inline-block">{variant}</span>
                                  )}
                                </td>
                                <td className="p-3 text-center text-sm text-gray-600">{line.product_uom_qty}</td>
                                <td className="p-3 text-right text-sm text-gray-600">{fmtR(line.price_unit)}</td>
                                <td className="p-3 pr-6 text-right text-sm font-semibold text-gray-900">{fmtR(line.price_subtotal)}</td>
                              </tr>
                            ); })}
                          </tbody>
                        </table>
                        </div>

                        {/* Totals */}
                        <div className="p-6 border-t border-gray-100 flex justify-end">
                          <div className="w-60 space-y-2">
                            <div className="flex justify-between text-sm text-gray-600">
                              <span>Subtotal</span>
                              <span className="font-medium">{fmtR(detailOrder.amount_untaxed)}</span>
                            </div>
                            <div className="flex justify-between text-sm text-gray-400">
                              <span>Tax</span>
                              <span>{fmtR(detailOrder.amount_tax)}</span>
                            </div>
                            <div className="pt-3 border-t border-gray-100 flex justify-between">
                              <span className="text-base font-bold text-gray-900">Total</span>
                              <span className="text-base font-bold text-bassani-700">{fmtR(detailOrder.amount_total)}</span>
                            </div>
                          </div>
                        </div>
                      </div>

                      {/* Delivery & Fulfilment — 7.1 + 7.5 */}
                      {(deliveriesLoading || deliveries.length > 0) && (
                        <div className="bg-white rounded-2xl shadow-sm border border-gray-100 overflow-hidden">
                          <div className="px-5 py-3 border-b border-gray-50 flex items-center gap-2">
                            <span className="text-xs font-semibold text-gray-600">Delivery & Fulfilment</span>
                            {deliveries.some(d => d.is_backorder) && (
                              <span className="text-[10px] bg-orange-50 text-orange-600 border border-orange-100 px-1.5 py-0.5 rounded-full font-semibold">Backorders present</span>
                            )}
                          </div>
                          {deliveriesLoading ? (
                            <p className="px-5 py-4 text-xs text-gray-400">Loading deliveries…</p>
                          ) : (
                            <div className="divide-y divide-gray-50">
                              {deliveries.map(d => (
                                <div key={d.id} className="px-5 py-3 space-y-2">
                                  <div className="flex flex-wrap items-center gap-3">
                                    <span className="font-mono text-xs font-semibold text-bassani-700">{d.name}</span>
                                    {d.is_backorder && (
                                      <span className="text-[10px] bg-orange-50 text-orange-600 border border-orange-100 px-1.5 py-0.5 rounded-full font-semibold">Backorder</span>
                                    )}
                                    <span className={`text-[10px] px-2 py-0.5 rounded-full font-semibold ${
                                      d.state === "done"     ? "bg-green-50 text-green-700"  :
                                      d.state === "assigned" ? "bg-blue-50 text-blue-700"    :
                                      d.state === "cancel"   ? "bg-gray-100 text-gray-400"   :
                                                               "bg-amber-50 text-amber-700"
                                    }`}>{d.state_label}</span>
                                    {d.date_done && <span className="text-xs text-gray-400">Delivered {fmtDate(d.date_done)}</span>}
                                    {d.scheduled_date && d.state !== "done" && <span className="text-xs text-gray-400">Expected {fmtDate(d.scheduled_date)}</span>}
                                    {d.tracking_ref && <span className="text-xs text-gray-500 font-mono">{d.tracking_ref}</span>}
                                  </div>
                                  {d.lines.length > 0 && (
                                    <div className="space-y-0.5 pl-1">
                                      {d.lines.map((l, i) => (
                                        <div key={i} className="flex items-center gap-2 text-xs text-gray-500">
                                          <span className="flex-1 truncate">{l.product_name}</span>
                                          <span className="shrink-0 tabular-nums">
                                            {l.qty_done}/{l.qty_ordered} units
                                            {l.qty_done < l.qty_ordered && (
                                              <span className="text-orange-500 ml-1">({l.qty_ordered - l.qty_done} outstanding)</span>
                                            )}
                                          </span>
                                        </div>
                                      ))}
                                    </div>
                                  )}
                                </div>
                              ))}
                            </div>
                          )}
                        </div>
                      )}
                      </>
                    ) : (
                      <div className="bg-white rounded-2xl shadow-sm border border-gray-100 p-8 text-center">
                        <p className="text-sm text-gray-400">Order #{detail.order_id} — could not load from Odoo.</p>
                        <p className="text-xs text-gray-300 mt-1">The ticket data above is still accurate.</p>
                      </div>
                    )
                  ) : (
                    /* No order yet */
                    <div className="bg-white rounded-2xl shadow-sm border border-gray-100 p-14 flex flex-col items-center justify-center gap-3">
                      <ShoppingCart size={36} className="text-gray-200" />
                      <p className="text-sm font-medium text-gray-300">No quote built yet</p>
                      {detail.source === "direct" && canDrive && !detail.exit_status && (
                        <div className="mt-2">
                          <BtnPrimary onClick={() => openQuoteBuilder(detail)}>
                            <ShoppingCart size={14} />Build Quote
                          </BtnPrimary>
                        </div>
                      )}
                      {detail.source === "portal" && (
                        <p className="text-xs text-gray-300 mt-1">Portal order — quote placed by the customer</p>
                      )}
                    </div>
                  )}
                </div>

                {/* ── Right sidebar: status + actions + timeline ── */}
                <div className="space-y-4">

                  {/* Status & Details */}
                  <div className="bg-white rounded-2xl shadow-sm border border-gray-100 p-4 space-y-3">
                    <div className="flex flex-wrap gap-2">
                      {detail.exit_status
                        ? <Badge color={EXIT_COLOR[detail.exit_status]}>{EXIT_LABEL[detail.exit_status]}</Badge>
                        : <Badge color={STATUS_COLOR[detail.status]}>{STATUS_LABEL[detail.status] || detail.status}</Badge>}
                      <Badge color={detail.source === "portal" ? "blue" : "gray"}>
                        {detail.source === "portal" ? "Portal Order" : "Direct Inquiry"}
                      </Badge>
                    </div>
                    <div className="space-y-1.5">
                      {detail.order_id   && <p className="text-xs text-gray-400">Odoo SO #{detail.order_id}</p>}
                      {detail.invoice_id && <p className="text-xs text-gray-400">Invoice #{detail.invoice_id}</p>}
                      {detail.quote_sent_at && (
                        <p className="text-xs text-blue-600 flex items-center gap-1.5">
                          <Send size={11} />Quote sent {fmtDate(detail.quote_sent_at)}
                        </p>
                      )}
                      {detail.payment_confirmed_at && (
                        <p className="text-xs text-green-600 flex items-center gap-1.5">
                          <CheckCircle2 size={11} />Payment confirmed {fmtDate(detail.payment_confirmed_at)}
                        </p>
                      )}
                    </div>
                    <div className="pt-2 border-t border-gray-100 flex items-center justify-between gap-2">
                      {detail.assigned_to_name
                        ? <span className="text-xs text-gray-500">Assigned to <span className="font-medium text-gray-700">{detail.assigned_to_name}</span>{detail.assigned_to_role && <span className="ml-1 text-gray-400">({ROLE_LABEL[detail.assigned_to_role] || detail.assigned_to_role})</span>}</span>
                        : <span className="text-xs text-amber-600 flex items-center gap-1"><UserPlus size={11} />Unassigned</span>}
                      {!detail.assigned_to && canDrive && (
                        <BtnSecondary size="sm" onClick={() => assignToMe(detail.id)}>
                          <UserPlus size={12} />Assign to me
                        </BtnSecondary>
                      )}
                    </div>
                  </div>

                  {/* Documents */}
                  {detail.order_id && (
                    <div className="bg-white rounded-2xl shadow-sm border border-gray-100 overflow-hidden">
                      <div className="px-4 py-3 border-b border-gray-50">
                        <p className="text-xs font-semibold text-gray-400 uppercase tracking-wide">Documents</p>
                      </div>
                      <div className="p-2">
                        <button
                          onClick={() => openDocument("quote")}
                          disabled={docLoading === "quote"}
                          className="w-full flex items-center gap-3 px-3 py-2 text-sm text-gray-700 hover:bg-gray-50 rounded-lg transition-colors text-left"
                        >
                          <FileText size={14} className="text-gray-400 shrink-0" />
                          {docLoading === "quote" ? "Loading…" : "View Quote PDF"}
                          <ExternalLink size={11} className="ml-auto text-gray-300" />
                        </button>
                        {detailOrder?.state === "sale" && (
                          <button
                            onClick={() => openDocument("invoice")}
                            disabled={docLoading === "invoice"}
                            className="w-full flex items-center gap-3 px-3 py-2 text-sm text-gray-700 hover:bg-gray-50 rounded-lg transition-colors text-left"
                          >
                            <Receipt size={14} className="text-gray-400 shrink-0" />
                            {docLoading === "invoice" ? "Loading…" : "View Invoice PDF"}
                            <ExternalLink size={11} className="ml-auto text-gray-300" />
                          </button>
                        )}
                      </div>
                    </div>
                  )}

                  {/* Actions */}
                  {!detail.exit_status && (
                    <div className="bg-white rounded-2xl shadow-sm border border-gray-100 overflow-hidden">
                      <div className="px-4 py-3 border-b border-gray-50">
                        <p className="text-xs font-semibold text-gray-400 uppercase tracking-wide">Actions</p>
                      </div>
                      <div className="p-2">

                        {detailOrder && ["draft", "sent"].includes(detailOrder.state) && canDrive && (
                          <button onClick={openQuoteEdit} className="w-full flex items-center gap-3 px-3 py-2 text-sm text-gray-700 hover:bg-gray-50 rounded-lg transition-colors text-left">
                            <ShoppingCart size={14} className="text-gray-400 shrink-0" />Edit Quote
                          </button>
                        )}

                        {detail.order_id && detailOrder && ["draft", "sent"].includes(detailOrder.state) && canDrive && (
                          <button onClick={sendQuote} disabled={sending} className={`w-full flex items-center gap-3 px-3 py-2 text-sm rounded-lg transition-colors text-left ${detailOrder.state === "draft" && detail.quote_sent_at ? "text-amber-700 hover:bg-amber-50" : "text-gray-700 hover:bg-gray-50"}`}>
                            <Send size={14} className={`shrink-0 ${detailOrder.state === "draft" && detail.quote_sent_at ? "text-amber-400" : "text-gray-400"}`} />
                            <span className="flex-1">{sending ? "Sending…" : (detail.quote_sent_at ? (detailOrder.state === "draft" ? "Send Updated Quote" : "Resend Quote") : "Send Quote")}</span>
                            {detail.quote_sent_at && !sending && (
                              <span className="text-[10px] text-gray-400 shrink-0">{detailOrder.state === "draft" ? "edited" : fmtDate(detail.quote_sent_at)}</span>
                            )}
                          </button>
                        )}

                        {detail.order_id && detailOrder && ["draft", "sent"].includes(detailOrder.state) && canConfirmOrder && (
                          <button onClick={() => confirmOrder()} disabled={confirming} className="w-full flex items-center gap-3 px-3 py-2 text-sm font-medium text-green-700 hover:bg-green-50 rounded-lg transition-colors text-left">
                            <CheckCircle2 size={14} className="text-green-500 shrink-0" />
                            {confirming ? "Confirming…" : "Confirm Order"}
                          </button>
                        )}

                        {detail.order_id && detailOrder?.state === "sale" && !detail.invoice_id && !detail.payment_confirmed_at && canFinance && (
                          <button onClick={openDepositModal} className="w-full flex items-center gap-3 px-3 py-2 text-sm text-amber-700 hover:bg-amber-50 rounded-lg transition-colors text-left">
                            <DollarSign size={14} className="text-amber-500 shrink-0" />Register Deposit
                          </button>
                        )}

                        {detail.invoice_id && !detail.payment_confirmed_at && canFinance && (
                          <button onClick={confirmPayment} disabled={saving} className="w-full flex items-center gap-3 px-3 py-2 text-sm text-amber-700 hover:bg-amber-50 rounded-lg transition-colors text-left">
                            <CreditCard size={14} className="text-amber-500 shrink-0" />
                            {saving ? "Confirming…" : "Confirm Payment"}
                          </button>
                        )}

                        {detail.payment_confirmed_at && detail.order_id && canFinance && (
                          <button onClick={openBalanceModal} className="w-full flex items-center gap-3 px-3 py-2 text-sm text-blue-700 hover:bg-blue-50 rounded-lg transition-colors text-left">
                            <CreditCard size={14} className="text-blue-500 shrink-0" />Register Balance Payment
                          </button>
                        )}

                        {/* Divider before destructive actions */}
                        {((detail.order_id && PRE_CONFIRM.has(detail.status) && canDrive) || (!detail.order_id && canDrive)) && (
                          <div className="my-1 border-t border-gray-100" />
                        )}

                        {detail.order_id && PRE_CONFIRM.has(detail.status) && canDrive && (
                          <button onClick={cancelQuote} disabled={saving} className="w-full flex items-center gap-3 px-3 py-2 text-sm text-red-500 hover:bg-red-50 rounded-lg transition-colors text-left">
                            <Ban size={14} className="shrink-0" />Cancel Quote
                          </button>
                        )}

                        {!detail.order_id && canDrive && (
                          <button onClick={() => markExit("not_interested")} disabled={saving} className="w-full flex items-center gap-3 px-3 py-2 text-sm text-gray-400 hover:bg-gray-50 rounded-lg transition-colors text-left">
                            <XCircle size={14} className="shrink-0" />Not Interested
                          </button>
                        )}

                        {/* Admin override — collapsible */}
                        {canManage && (
                          <>
                            <div className="my-1 border-t border-gray-100" />
                            <button onClick={() => setOverrideOpen(o => !o)} className="w-full flex items-center justify-between gap-2 px-3 py-2 text-xs text-gray-400 hover:bg-gray-50 rounded-lg transition-colors">
                              <span className="font-semibold uppercase tracking-wide">Admin Override</span>
                              <ChevronDown size={12} className={`transition-transform duration-150 ${overrideOpen ? "rotate-180" : ""}`} />
                            </button>
                            {overrideOpen && (
                              <div className="px-3 pb-2 pt-1 space-y-3">
                                <FormGroup label="Stage">
                                  <Select value={stageForm.status} onChange={e => setStageForm({ ...stageForm, status: e.target.value })}>
                                    {FORWARD_STATUSES.map(s => <option key={s} value={s}>{STATUS_LABEL[s]}</option>)}
                                  </Select>
                                </FormGroup>
                                <div className="grid grid-cols-1 sm:grid-cols-2 gap-2">
                                  <FormGroup label="Order ID">
                                    <Input type="number" value={stageForm.order_id} onChange={e => setStageForm({ ...stageForm, order_id: e.target.value })} placeholder="Odoo id" />
                                  </FormGroup>
                                  <FormGroup label="Invoice ID">
                                    <Input type="number" value={stageForm.invoice_id} onChange={e => setStageForm({ ...stageForm, invoice_id: e.target.value })} placeholder="Odoo id" />
                                  </FormGroup>
                                </div>
                                {stageForm.status === "incomplete" && (
                                  <FormGroup label="Reason" required>
                                    <Input
                                      value={stageForm.incomplete_reason}
                                      onChange={e => setStageForm({ ...stageForm, incomplete_reason: e.target.value })}
                                      placeholder="Why incomplete?"
                                    />
                                  </FormGroup>
                                )}
                                <FormGroup label="Note">
                                  <Input
                                    value={stageForm.note}
                                    onChange={e => setStageForm({ ...stageForm, note: e.target.value })}
                                    placeholder="Optional note for the timeline"
                                  />
                                </FormGroup>
                                <BtnPrimary onClick={advance} loading={saving} className="w-full justify-center">Save</BtnPrimary>
                              </div>
                            )}
                          </>
                        )}

                      </div>
                    </div>
                  )}

                  {/* Timeline */}
                  <div className="bg-white rounded-2xl shadow-sm border border-gray-100 p-4">
                    <p className="text-xs font-semibold text-gray-400 uppercase tracking-wide mb-3">Timeline</p>
                    <div className="space-y-2.5 max-h-80 overflow-y-auto">
                      {(detail.stage_history || []).length === 0 ? (
                        <p className="text-xs text-gray-300">No history yet.</p>
                      ) : (
                        (detail.stage_history || []).slice().reverse().map((h, i) => (
                          <div key={i} className="flex items-start gap-2 text-xs">
                            <Clock size={12} className="text-gray-300 mt-0.5 shrink-0" />
                            <div>
                              <p className="text-gray-700">
                                <span className="font-medium">{h.actor_name}</span>
                                {" "}→ {h.exit_status ? EXIT_LABEL[h.exit_status] : (STATUS_LABEL[h.status] || h.status)}
                              </p>
                              {h.note && <p className="text-gray-400 mt-0.5">{h.note}</p>}
                              <p className="text-gray-300 mt-0.5">{fmtDate(h.at)}</p>
                            </div>
                          </div>
                        ))
                      )}
                    </div>
                  </div>

                  {/* Source email (Phase 11 — only shown when ticket was created from inbox) */}
                  {inboxItem && (
                    <div className="bg-white rounded-2xl shadow-sm border border-bassani-100 overflow-hidden">
                      <button
                        onClick={() => setShowInboxPanel(v => !v)}
                        className="w-full flex items-center justify-between px-4 py-3 hover:bg-gray-50 transition-colors"
                      >
                        <span className="flex items-center gap-2 text-xs font-semibold text-gray-600">
                          <Mail size={12} className="text-bassani-500" />
                          Source Email
                        </span>
                        {showInboxPanel
                          ? <ChevronUp size={12} className="text-gray-400" />
                          : <ChevronDown size={12} className="text-gray-400" />
                        }
                      </button>
                      {showInboxPanel && (
                        <div className="px-4 pb-4 border-t border-gray-50 space-y-2">
                          <div className="pt-2 space-y-1">
                            <p className="text-xs font-medium text-gray-800 truncate">{inboxItem.subject}</p>
                            <p className="text-[11px] text-gray-500">{inboxItem.from_name} &lt;{inboxItem.from_email}&gt;</p>
                            <p className="text-[11px] text-gray-400">{fmtDate(inboxItem.received_at)}</p>
                          </div>
                          <p className="text-xs text-gray-600 line-clamp-4 leading-relaxed">{inboxItem.body_preview}</p>
                          {inboxItem.attachments && inboxItem.attachments.length > 0 && (
                            <div className="flex flex-wrap gap-1.5 pt-1">
                              {inboxItem.attachments.map(att => (
                                <a
                                  key={att.id}
                                  href={`/api/inbox/${inboxItem.id}/attachment/${att.id}`}
                                  target="_blank"
                                  rel="noreferrer"
                                  className="inline-flex items-center gap-1 px-2 py-1 bg-gray-50 border border-gray-200 rounded text-[10px] text-gray-600 hover:bg-gray-100 transition-colors"
                                >
                                  <Paperclip size={9} className="text-gray-400" />
                                  {att.name}
                                  <ExternalLink size={8} className="text-gray-400" />
                                </a>
                              ))}
                            </div>
                          )}
                          <a
                            href="/inbox"
                            className="inline-flex items-center gap-1 text-[11px] text-bassani-600 hover:text-bassani-700 font-medium transition-colors"
                          >
                            <Mail size={10} /> View in Sales Inbox
                          </a>
                        </div>
                      )}
                    </div>
                  )}

                </div>
              </div>
            </div>
          </main>
        )}

        {/* Deposit modal overlays the detail page */}
        {depositModal && (
          <Modal title="Register Deposit" onClose={() => setDepositModal(false)}>
            <p className="text-xs text-gray-500 mb-4">
              Creates a down payment invoice in Odoo and registers payment against it — Odoo remains the financial source of truth.
            </p>
            <FormGroup label="Amount (ZAR)" required>
              <Input
                type="number" step="0.01" min="0.01"
                value={depositForm.amount}
                onChange={e => setDepositForm(f => ({ ...f, amount: e.target.value }))}
                placeholder="e.g. 15000.00"
                autoFocus
              />
            </FormGroup>
            <FormGroup label="Payment Date" required>
              <Input
                type="date"
                value={depositForm.date}
                onChange={e => setDepositForm(f => ({ ...f, date: e.target.value }))}
              />
            </FormGroup>
            <FormGroup label="Payment Method" required>
              <Select
                value={depositForm.journal_id}
                onChange={e => setDepositForm(f => ({ ...f, journal_id: e.target.value }))}
              >
                <option value="">— Select —</option>
                {depositJournals.map(j => (
                  <option key={j.id} value={j.id}>{j.display_label || j.name}</option>
                ))}
              </Select>
            </FormGroup>
            <FormGroup label="Note">
              <Input
                value={depositForm.note}
                onChange={e => setDepositForm(f => ({ ...f, note: e.target.value }))}
                placeholder="e.g. EFT received 2026-06-21"
              />
            </FormGroup>
            <div className="flex justify-end gap-2 mt-4">
              <BtnSecondary onClick={() => setDepositModal(false)} disabled={depositSaving}>Cancel</BtnSecondary>
              <BtnPrimary onClick={registerDeposit} loading={depositSaving}>Register in Odoo</BtnPrimary>
            </div>
          </Modal>
        )}

        {/* Balance payment modal */}
        {balanceModal && (
          <Modal title="Register Balance Payment" onClose={() => setBalanceModal(false)}>
            <p className="text-xs text-gray-500 mb-1">
              Registers payment directly against the full sale invoice in Odoo. Use this for the remaining balance after the deposit — or for any partial payment toward the outstanding amount.
            </p>
            {balanceInfo?.invoice_name && (
              <p className="text-xs text-blue-600 mb-4">
                Invoice: {balanceInfo.invoice_name}
                {balanceInfo.amount_residual > 0 && (
                  <> — Outstanding: R{balanceInfo.amount_residual.toLocaleString("en-ZA", { minimumFractionDigits: 2 })}</>
                )}
              </p>
            )}
            <FormGroup label="Amount (ZAR)" required>
              <Input
                type="number" step="0.01" min="0.01"
                value={balanceForm.amount}
                onChange={e => setBalanceForm(f => ({ ...f, amount: e.target.value }))}
                placeholder="e.g. 15000.00"
                autoFocus
              />
            </FormGroup>
            <FormGroup label="Payment Date" required>
              <Input
                type="date"
                value={balanceForm.date}
                onChange={e => setBalanceForm(f => ({ ...f, date: e.target.value }))}
              />
            </FormGroup>
            <FormGroup label="Payment Method" required>
              <Select
                value={balanceForm.journal_id}
                onChange={e => setBalanceForm(f => ({ ...f, journal_id: e.target.value }))}
              >
                <option value="">— Select —</option>
                {balanceJournals.map(j => (
                  <option key={j.id} value={j.id}>{j.display_label || j.name}</option>
                ))}
              </Select>
            </FormGroup>
            <FormGroup label="Note">
              <Input
                value={balanceForm.note}
                onChange={e => setBalanceForm(f => ({ ...f, note: e.target.value }))}
                placeholder="e.g. EFT received 2026-07-04"
              />
            </FormGroup>
            <div className="flex justify-end gap-2 mt-4">
              <BtnSecondary onClick={() => setBalanceModal(false)} disabled={balanceSaving}>Cancel</BtnSecondary>
              <BtnPrimary onClick={registerBalance} loading={balanceSaving}>Register in Odoo</BtnPrimary>
            </div>
          </Modal>
        )}
      </div>
    );
  }


  // ── Quote Builder — full-page document view ───────────────────────────────
  if (view === "quote-builder") {
    return (
      <div className="flex flex-col flex-1 overflow-hidden bg-slate-50">
        <TopBar
          title="Quote Builder"
          subtitle={quoteMode === "edit" ? (quoteCustomer?.name || quoteTicket?.customer_name) : quoteTicket?.customer_name}
          actions={
            <div className="flex items-center gap-2">
              <BtnSecondary onClick={() => setView("detail")}>← Back to Ticket</BtnSecondary>
              <BtnPrimary
                onClick={submitQuote}
                loading={quoteSaving}
                disabled={!hasValidLines || quoteSaving}
              >
                {quoteMode === "edit" ? "Update Quote in Odoo →" : "Create Quote in Odoo →"}
              </BtnPrimary>
            </div>
          }
        />

        <main className="flex-1 overflow-y-auto p-6">
          <div className="max-w-5xl mx-auto space-y-4">

            {/* ── Document header ── */}
            <div className="bg-white rounded-2xl shadow-sm border border-gray-100 p-6">
              <div className="flex items-start justify-between mb-5">
                <div>
                  <h2 className="text-2xl font-bold tracking-tight text-gray-900">
                    {quoteMode === "edit" ? "EDIT QUOTATION" : "QUOTATION"}
                  </h2>
                  <p className="text-xs text-gray-400 mt-0.5">
                    {quoteMode === "edit" ? "Revising live draft in Odoo" : "Draft — not yet confirmed in Odoo"}
                  </p>
                </div>
                <div className="text-right">
                  <p className="text-xs text-gray-400 uppercase tracking-wide font-semibold mb-0.5">Date</p>
                  <p className="text-sm font-medium text-gray-700">{today}</p>
                </div>
              </div>
              <div className="pt-5 border-t border-gray-100 grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4 sm:gap-8">
                <div>
                  <p className="text-xs font-semibold text-gray-400 uppercase tracking-wide mb-1">Bill To</p>
                  {quoteMode === "edit" ? (
                    quoteCustomerEditing ? (
                      <div className="space-y-1.5">
                        <Input
                          value={quoteCustomerSearch}
                          onChange={e => setQuoteCustomerSearch(e.target.value)}
                          placeholder="Search customers…"
                          autoFocus
                        />
                        {quoteCustomerResults.length > 0 && (
                          <div className="border border-gray-200 rounded-lg divide-y divide-gray-100 max-h-36 overflow-y-auto">
                            {quoteCustomerResults.map(c => (
                              <button
                                key={c.id}
                                onClick={() => {
                                  setQuoteCustomer(c);
                                  setQuoteCustomerEditing(false);
                                  setQuoteCustomerSearch("");
                                  setQuoteCustomerResults([]);
                                }}
                                className="w-full text-left px-3 py-2 text-sm hover:bg-gray-50 transition-colors"
                              >
                                {c.name}{c.city && <span className="text-xs text-gray-400"> — {c.city}</span>}
                              </button>
                            ))}
                          </div>
                        )}
                        <button
                          onClick={() => { setQuoteCustomerEditing(false); setQuoteCustomerSearch(""); setQuoteCustomerResults([]); }}
                          className="text-xs text-gray-400 hover:text-gray-600"
                        >
                          Cancel
                        </button>
                      </div>
                    ) : (
                      <div>
                        <p className="text-base font-semibold text-gray-900">{quoteCustomer?.name}</p>
                        <button
                          onClick={() => setQuoteCustomerEditing(true)}
                          className="text-xs text-bassani-600 hover:text-bassani-700 mt-0.5"
                        >
                          Change customer
                        </button>
                      </div>
                    )
                  ) : (
                    <div>
                      <p className="text-base font-semibold text-gray-900">{quoteTicket?.customer_name}</p>
                      <p className="text-xs text-gray-400 mt-0.5">Customer locked — from ticket</p>
                    </div>
                  )}
                </div>
                <div>
                  <p className="text-xs font-semibold text-gray-400 uppercase tracking-wide mb-1.5">Warehouse</p>
                  {quoteMode === "edit" ? (
                    <p className="text-sm text-gray-400 italic">Locked to existing order</p>
                  ) : quoteWarehouses.length > 0 ? (
                    <>
                    <Select
                      value={quoteWarehouseId}
                      onChange={e => setQuoteWarehouseId(e.target.value)}
                      disabled={hasValidLines}
                    >
                      {quoteWarehouses.map(w => (
                        <option key={w.id} value={w.id}>{w.name}</option>
                      ))}
                    </Select>
                    {hasValidLines && (
                      <p className="text-[10px] text-gray-400 mt-1">Locked — remove all lines to change warehouse</p>
                    )}
                    </>
                  ) : (
                    <p className="text-sm text-gray-400">Default warehouse</p>
                  )}
                </div>
                <div>
                  <p className="text-xs font-semibold text-gray-400 uppercase tracking-wide mb-1.5">Deliver To</p>
                  {quoteAddresses.length > 0 ? (
                    <Select
                      value={quoteShippingId}
                      onChange={e => setQuoteShippingId(e.target.value)}
                    >
                      {quoteAddresses.map(a => (
                        <option key={a.id} value={a.id}>
                          {a.name}{a.type === "delivery" ? "" : ` (${a.type})`}{a.city ? ` — ${a.city}` : ""}
                        </option>
                      ))}
                    </Select>
                  ) : (
                    <p className="text-sm text-gray-400 italic">No addresses — same as billing</p>
                  )}
                </div>
              </div>
            </div>

            {/* ── Line items ── */}
            <div className="bg-white rounded-2xl shadow-sm border border-gray-100 overflow-x-auto">
              <table className="w-full">
                <thead>
                  <tr className="border-b-2 border-gray-100">
                    <th className="text-left p-3 pl-4 text-xs font-semibold text-gray-400 uppercase tracking-wide">Product</th>
                    <th className="text-left p-3 text-xs font-semibold text-gray-400 uppercase tracking-wide">Description</th>
                    <th className="text-center p-3 text-xs font-semibold text-gray-400 uppercase tracking-wide w-20">Qty</th>
                    <th className="text-right p-3 text-xs font-semibold text-gray-400 uppercase tracking-wide w-36">Unit Price</th>
                    <th className="text-center p-3 text-xs font-semibold text-gray-400 uppercase tracking-wide w-16">Tax</th>
                    <th className="text-right p-3 text-xs font-semibold text-gray-400 uppercase tracking-wide w-36">Subtotal</th>
                    <th className="w-8" />
                  </tr>
                </thead>
                <tbody>
                  {quoteLines.map(line => (
                    <ProductLineRow
                      key={line._id}
                      line={line}
                      onUpdate={(updates) => updateLine(line._id, updates)}
                      onRemove={() => removeLine(line._id)}
                      autoFocus={line._id === lastAddedId}
                      warehouseId={quoteWarehouseId ? parseInt(quoteWarehouseId) : undefined}
                    />
                  ))}
                </tbody>
                <tfoot>
                  <tr className="border-t border-gray-50">
                    <td colSpan={7} className="p-2 pl-3">
                      <button
                        onClick={addLine}
                        className="flex items-center gap-1.5 text-sm text-bassani-600 hover:text-bassani-700 font-medium px-2 py-1.5 rounded-lg hover:bg-bassani-50 transition-colors"
                      >
                        <Plus size={14} />Add a line
                      </button>
                    </td>
                  </tr>
                </tfoot>
              </table>
            </div>

            {/* ── Notes + Totals ── */}
            <div className="grid grid-cols-1 lg:grid-cols-5 gap-4">

              {/* Notes */}
              <div className="lg:col-span-3 bg-white rounded-2xl shadow-sm border border-gray-100 p-4">
                <p className="text-xs font-semibold text-gray-400 uppercase tracking-wide mb-2">Notes</p>
                <textarea
                  value={quoteNote}
                  onChange={e => setQuoteNote(e.target.value)}
                  rows={4}
                  placeholder="Delivery instructions, special requirements, terms…"
                  className="w-full text-sm border-0 focus:outline-none resize-none text-gray-600 placeholder-gray-300"
                />
              </div>

              {/* Totals */}
              <div className="lg:col-span-2 bg-white rounded-2xl shadow-sm border border-gray-100 p-5 flex flex-col justify-between">
                <div className="space-y-2.5">
                  <div className="flex justify-between text-sm text-gray-600">
                    <span>Subtotal</span>
                    <span className="font-medium text-gray-800">{fmtR(quoteSubtotal)}</span>
                  </div>
                  <div className="flex justify-between text-sm text-gray-500">
                    <span>VAT (per product rate)</span>
                    <span>{fmtR(quoteVat)}</span>
                  </div>
                  <div className="pt-3 border-t border-gray-100 flex justify-between">
                    <span className="text-base font-bold text-gray-900">Total</span>
                    <span className="text-base font-bold text-bassani-700">{fmtR(quoteTotal)}</span>
                  </div>
                </div>
                <p className="text-[10px] text-gray-300 mt-4 leading-relaxed">
                  Indicative only. Odoo applies fiscal position and tax rules on confirmation.
                </p>
              </div>
            </div>

          </div>
        </main>
      </div>
    );
  }


  // ── List + create modal ───────────────────────────────────────────────────
  return (
    <div className="flex flex-col flex-1 overflow-hidden">
      <TopBar
        title="Sales Tickets"
        subtitle="PO/RFQ → Quote → Sale Order → Invoice → Payment → Complete"
        onRefresh={load}
        actions={canDrive && (
          <BtnPrimary onClick={openCreate}><Plus size={14} />New Direct Inquiry</BtnPrimary>
        )}
      />
      <main className="flex-1 overflow-y-auto p-6">
        {loading ? <LoadingState /> : tickets.length === 0 ? (
          <EmptyState message="No sales tickets yet." />
        ) : (
          <DataTable
            data={tickets}
            onRowClick={openDetail}
            columns={[
              { accessorKey: "customer_name", header: "Customer", cell: ({ row: { original: t } }) => (
                <div>
                  <p className="font-medium text-gray-900">{t.customer_name}</p>
                  <Badge color={t.source === "portal" ? "blue" : "gray"} className="mt-0.5">
                    {t.source === "portal" ? "Portal Order" : "Direct Inquiry"}
                  </Badge>
                </div>
              )},
              { id: "status", header: "Stage", cell: ({ row: { original: t } }) =>
                t.exit_status
                  ? <Badge color={EXIT_COLOR[t.exit_status]}>{EXIT_LABEL[t.exit_status]}</Badge>
                  : <Badge color={STATUS_COLOR[t.status]}>{STATUS_LABEL[t.status] || t.status}</Badge>
              },
              { id: "assigned", header: "Assigned To", cell: ({ row: { original: t } }) =>
                t.assigned_to_name
                  ? <span className="text-xs text-gray-600">{t.assigned_to_name}</span>
                  : <span className="text-xs text-amber-500 flex items-center gap-1"><UserPlus size={11} />Unassigned</span>
              },
              { id: "payment", header: "Payment", cell: ({ row: { original: t } }) =>
                t.payment_confirmed_at
                  ? <span className="text-xs text-green-600 flex items-center gap-1"><CheckCircle2 size={12} />Confirmed</span>
                  : <span className="text-xs text-gray-400">—</span>
              },
              { accessorKey: "updated_at", header: "Last Updated", cell: ({ row: { original: t } }) =>
                <span className="text-xs text-gray-400">{fmtDate(t.updated_at)}</span>
              },
            ]}
          />
        )}
      </main>

      {/* ── Create modal ── */}
      {createModal && (
        <Modal title="New Direct Inquiry" onClose={() => setCreateModal(false)}>
          <FormGroup label="Customer" required>
            {selectedCustomer ? (
              <div className="flex items-center justify-between bg-bassani-50 border border-bassani-100 rounded-lg px-3 py-2">
                <span className="text-sm font-medium text-bassani-800">{selectedCustomer.name}</span>
                <button onClick={() => setSelectedCustomer(null)} className="text-xs text-gray-400 hover:text-gray-600">Change</button>
              </div>
            ) : (
              <>
                <Input value={customerSearch} onChange={e => setCustomerSearch(e.target.value)} placeholder="Search customers…" />
                {customerResults.length > 0 && (
                  <div className="mt-1 border border-gray-200 rounded-lg divide-y divide-gray-100 max-h-40 overflow-y-auto">
                    {customerResults.map(c => (
                      <button key={c.id} onClick={() => setSelectedCustomer(c)}
                        className="w-full text-left px-3 py-2 text-sm hover:bg-gray-50 transition-colors">
                        {c.name} {c.city && <span className="text-xs text-gray-400">— {c.city}</span>}
                      </button>
                    ))}
                  </div>
                )}
              </>
            )}
          </FormGroup>
          <FormGroup label="Note">
            <Textarea value={createNote} onChange={e => setCreateNote(e.target.value)} rows={2} placeholder="What the PO/RFQ asked for" />
          </FormGroup>
          <div className="flex justify-end gap-2 mt-4">
            <BtnSecondary onClick={() => setCreateModal(false)} disabled={creating}>Cancel</BtnSecondary>
            <BtnPrimary onClick={createTicket} loading={creating}>Create Ticket</BtnPrimary>
          </div>
        </Modal>
      )}
    </div>
  );
}
