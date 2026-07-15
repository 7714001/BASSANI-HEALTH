// ─────────────────────────────────────────────────────────────────────────────
// Sales Tickets — Phase 8.5 / 8.6 / 8.7
// Three-view flow: list → detail (full page) → quote-builder (full page)
// The detail page embeds the live Odoo order document alongside ticket actions,
// keeping the sales clerk in one place for the entire inquiry-to-payment cycle.
// ─────────────────────────────────────────────────────────────────────────────
import { useState, useEffect, useCallback, useRef, useMemo } from "react";
import bwipjs from "bwip-js";
import { useLocation, useNavigate } from "react-router-dom";
import { useAuth } from "../AuthContext";
import api from "../api";
import toast from "react-hot-toast";
import {
  Plus, CreditCard, XCircle, CheckCircle2, Clock,
  UserPlus, ShoppingCart, Ban, DollarSign, Send, ChevronDown,
  Mail, Paperclip, ExternalLink, ChevronUp, AlertTriangle,
  Search, Loader2, Link2, Pencil, Package,
  Download, RotateCcw, FileX, ReceiptText,
} from "lucide-react";
import {
  TopBar, DataTable, Modal, FormGroup, Input, Select, Textarea,
  BtnPrimary, BtnSecondary, BtnDanger, Badge, LoadingState, EmptyState, fmtDate,
  SearchBar, ChipRow, FilterPill, parseDisplayName,
} from "../components/UI";
import ProductLineRow from "../components/ProductLineRow";
import ProductPickerDrawer from "../components/ProductPickerDrawer";
import OrderView from "./OrderView";

const fmtR = (n) =>
  `R ${(n || 0).toLocaleString("en-ZA", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;

// Renders a compact Code 128 barcode for an Odoo order reference (e.g. "S00142").
// Visible on screen and in print — lets warehouse staff scan the ticket on a tablet.
function OrderBarcode({ orderRef }) {
  const canvasRef = useRef(null);
  useEffect(() => {
    if (!canvasRef.current || !orderRef) return;
    try {
      bwipjs.toCanvas(canvasRef.current, {
        bcid: "code128", text: orderRef, scale: 2, height: 8,
        includetext: false, padding: 0, backgroundcolor: "ffffff",
      });
    } catch { /* non-fatal — barcode just won't render */ }
  }, [orderRef]);
  if (!orderRef) return null;
  return (
    <div className="flex flex-col items-end gap-0.5 print:items-start">
      <canvas ref={canvasRef} className="block max-h-8" />
      <span className="text-[9px] font-mono text-gray-400 tracking-wider">{orderRef}</span>
    </div>
  );
}

const STATUS_LABEL = {
  open: "Open (RFQ)", quote: "Quote", sale_order: "Confirmed",
  confirmed_wip: "In Fulfilment", ready_for_collection: "Ready for Collection",
  incomplete: "Incomplete", partially_fulfilled: "Partially Fulfilled",
};
const STATUS_COLOR = {
  open: "gray", quote: "amber", sale_order: "blue",
  confirmed_wip: "teal", ready_for_collection: "green", incomplete: "orange",
  partially_fulfilled: "amber",
};
const EXIT_LABEL  = { not_interested: "Not Interested", cancelled: "Cancelled", complete: "Complete" };
const EXIT_COLOR  = { not_interested: "gray", cancelled: "red", complete: "green" };
const FORWARD_STATUSES = ["open", "quote", "sale_order", "confirmed_wip", "ready_for_collection", "partially_fulfilled", "incomplete"];
const PRE_CONFIRM = new Set(["open", "quote", "sale_order"]);

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

const PACK_STATUS_LABEL = {
  queued: "Queued", packing: "Packing", ready: "Ready for Inspection",
  complete: "Complete", incomplete: "Incomplete", cancelled: "Cancelled",
  waiting_stock: "Waiting for Stock",
};
const PACK_STATUS_COLOR = {
  queued: "gray", packing: "amber", ready: "blue",
  complete: "green", incomplete: "orange", cancelled: "red",
  waiting_stock: "amber",
};

// Reseller-facing labels — plain English, no internal system terms
const R_STATUS_LABEL = {
  quote:                "Draft",
  sale_order:           "Pending Confirmation",
  confirmed_wip:        "In Fulfilment",
  ready_for_collection: "Ready for Collection",
  partially_fulfilled:  "Partially Fulfilled",
  incomplete:           "Unable to Fulfil",
};
const R_STATUS_COLOR = {
  quote: "amber", sale_order: "amber", confirmed_wip: "teal",
  ready_for_collection: "green", partially_fulfilled: "amber", incomplete: "orange",
};
const R_EXIT_LABEL = { not_interested: "Cancelled", cancelled: "Cancelled", complete: "Complete" };
const R_PACK_LABEL = {
  queued: "Preparing your order", packing: "Being packed",
  ready: "Packed — awaiting final checks", complete: "Fulfilled",
  incomplete: "Issue — contact Bassani", cancelled: "Cancelled",
  waiting_stock: "Awaiting restocking",
};

// Steps shown in the reseller progress tracker (in detail view)
const R_STEPS = [
  { key: "draft",      label: "Quote Created"    },
  { key: "confirmed",  label: "Order Confirmed"  },
  { key: "packing",    label: "Being Packed"     },
  { key: "ready",      label: "Fulfilment Ready" },
  { key: "complete",   label: "Complete"         },
];
const resellerStep = (ticket, packing) => {
  if (ticket.exit_status === "complete")                                         return 4;
  if (ticket.exit_status)                                                        return -1;
  if (ticket.status === "partially_fulfilled")                                   return 3;
  if (ticket.status === "ready_for_collection" || packing?.status === "ready")  return 3;
  if (ticket.status === "confirmed_wip")    return packing ? 2 : 1;
  if (ticket.status === "sale_order")       return 1;
  return 0;
};

// ── Main component ────────────────────────────────────────────────────────────
export default function SalesTickets() {
  const { can, user, isAdmin } = useAuth();
  const navigate        = useNavigate();
  const isReseller      = user?.role === "reseller";
  const canDrive        = can("tickets.sales") || isReseller;
  const canFinance      = can("tickets.finance_confirm");
  const canManage       = can("tickets.manage");
  const canConfirmOrder = can("orders.confirm") || isReseller;

  // ── List state ────────────────────────────────────────────────────────────
  const [view, setView]       = useState("list"); // "list" | "detail" | "quote-builder"
  const [tickets, setTickets] = useState([]);
  const [loading, setLoading] = useState(true);
  const [listSearch,   setListSearch  ] = useState("");
  const [statusFilter, setStatusFilter] = useState(new Set());
  const [sourceFilter, setSourceFilter] = useState("all"); // "all" | "internal" | "external"

  const toggleStatus = (key) =>
    setStatusFilter(prev => {
      const next = new Set(prev);
      next.has(key) ? next.delete(key) : next.add(key);
      return next;
    });

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
  const [sampleRecipientSearch, setSampleRecipientSearch] = useState("");
  const [sampleRecipientResults, setSampleRecipientResults] = useState([]);
  const [selectedRecipient, setSelectedRecipient] = useState(null);

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

  useEffect(() => {
    if (!createModal || !selectedCustomer?.samples_account || sampleRecipientSearch.length < 2) {
      setSampleRecipientResults([]); return;
    }
    const t = setTimeout(async () => {
      try {
        const r = await api.get("/api/customers/search", { params: { q: sampleRecipientSearch, limit: 8 } });
        setSampleRecipientResults(r.data.customers || []);
      } catch { setSampleRecipientResults([]); }
    }, 300);
    return () => clearTimeout(t);
  }, [sampleRecipientSearch, selectedCustomer, createModal]);

  const openCreate = () => {
    setSelectedCustomer(null); setCustomerSearch(""); setCustomerResults([]); setCreateNote("");
    setSelectedRecipient(null); setSampleRecipientSearch(""); setSampleRecipientResults([]);
    setCreateModal(true);
  };

  const createTicket = async () => {
    if (!selectedCustomer) return toast.error("Select a customer first");
    if (selectedCustomer.samples_account && !selectedRecipient) return toast.error("Select a sample recipient");
    setCreating(true);
    try {
      await api.post("/api/tickets/", {
        customer_id: selectedCustomer.id,
        note: createNote || undefined,
        ...(selectedCustomer.samples_account && selectedRecipient ? {
          sample_recipient_id: selectedRecipient.id,
          sample_recipient_name: selectedRecipient.name,
        } : {}),
      });
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
  const [printOrderOpen, setPrintOrderOpen] = useState(false);
  const [inboxItem, setInboxItem]       = useState(null);
  const [showInboxPanel, setShowInboxPanel] = useState(true);
  const [deliveries,        setDeliveries       ] = useState([]);
  const [deliveriesLoading, setDeliveriesLoading] = useState(false);
  const [mos,        setMos       ] = useState([]);
  const [mosLoading, setMosLoading] = useState(false);
  const [packingEntry,   setPackingEntry  ] = useState(null);
  const [packingLoading, setPackingLoading] = useState(false);

  const [stageForm, setStageForm]       = useState({ status: "", order_id: "", invoice_id: "", note: "", incomplete_reason: "" });
  const [saving, setSaving]             = useState(false);
  const [confirming, setConfirming]     = useState(false);
  const [sending, setSending]           = useState(false);
  const [overrideOpen,       setOverrideOpen      ] = useState(false);
  const [exitConfirm,        setExitConfirm       ] = useState(null);
  const [confirmAnywayMsg,   setConfirmAnywayMsg  ] = useState(null);
  const [cancelQuoteOpen,    setCancelQuoteOpen   ] = useState(false);

  // ── Reseller pre-confirm stock-check modal ────────────────────────────────
  const [stockCheckModal, setStockCheckModal] = useState(false);
  const [stockCheckData,  setStockCheckData ] = useState(null); // {is_partial, lines}

  // ── Link existing order modal ─────────────────────────────────────────────
  const [linkOrderOpen,        setLinkOrderOpen       ] = useState(false);
  const [linkOrderQuery,       setLinkOrderQuery      ] = useState("");
  const [linkOrderResults,     setLinkOrderResults    ] = useState([]);
  const [linkOrderSearching,   setLinkOrderSearching  ] = useState(false);
  const [linkOrderSelected,    setLinkOrderSelected   ] = useState(null);
  const [linkOrderSubmitting,  setLinkOrderSubmitting ] = useState(false);
  const [linkOrderPreview,     setLinkOrderPreview    ] = useState(null);  // { lines, loading, order_id }
  const [linkOrderPreviewId,   setLinkOrderPreviewId  ] = useState(null);

  // ── Link contact to company modal ────────────────────────────────────────
  const [linkCompanyOpen,      setLinkCompanyOpen     ] = useState(false);
  const [linkCompanyQuery,     setLinkCompanyQuery    ] = useState("");
  const [linkCompanyResults,   setLinkCompanyResults  ] = useState([]);
  const [linkCompanySearching, setLinkCompanySearching] = useState(false);
  const [linkCompanySelected,  setLinkCompanySelected ] = useState(null);
  const [linkCompanySubmitting,setLinkCompanySubmitting] = useState(false);

  useEffect(() => {
    if (!linkCompanyOpen || !linkCompanyQuery.trim()) { setLinkCompanyResults([]); return; }
    const t = setTimeout(async () => {
      setLinkCompanySearching(true);
      try {
        const r = await api.get("/api/customers/search", { params: { q: linkCompanyQuery, limit: 8 } });
        setLinkCompanyResults(r.data.customers || []);
      } catch { setLinkCompanyResults([]); }
      finally { setLinkCompanySearching(false); }
    }, 300);
    return () => clearTimeout(t);
  }, [linkCompanyQuery, linkCompanyOpen]);

  const openLinkCompanyModal = () => {
    setLinkCompanyQuery(""); setLinkCompanyResults([]);
    setLinkCompanySelected(null); setLinkCompanyOpen(true);
  };

  const submitLinkCompany = async () => {
    if (!linkCompanySelected || !detail) return;
    setLinkCompanySubmitting(true);
    try {
      await api.patch(`/api/customers/${detail.customer_id}/link-company`, { company_id: linkCompanySelected.id });
      toast.success(`${detail.customer_name} linked to ${linkCompanySelected.name}`);
      setLinkCompanyOpen(false);
      // Re-fetch ticket so sidebar updates immediately
      const r = await api.get(`/api/tickets/${detail.id}`);
      setDetail(r.data);
    } catch (e) {
      toast.error(e.response?.data?.detail || "Failed to link contact");
    } finally {
      setLinkCompanySubmitting(false);
    }
  };

  // ── Reassign ticket ───────────────────────────────────────────────────────
  const [reassignOpen,      setReassignOpen     ] = useState(false);
  const [staffList,         setStaffList        ] = useState([]);
  const [staffSearch,       setStaffSearch      ] = useState("");
  const [reassignSubmitting,setReassignSubmitting] = useState(false);

  const openReassign = async () => {
    if (staffList.length === 0) {
      try {
        const r = await api.get("/api/users/");
        setStaffList((r.data.users || []).filter(u => u.role !== "reseller"));
      } catch { toast.error("Failed to load staff"); return; }
    }
    setStaffSearch(""); setReassignOpen(true);
  };

  const submitReassign = async (staffMember) => {
    if (!detail) return;
    setReassignSubmitting(true);
    try {
      await api.put(`/api/tickets/${detail.id}/reassign`, { assigned_to: staffMember.id });
      toast.success(`Reassigned to ${staffMember.name || staffMember.username}`);
      setReassignOpen(false);
      refreshDetail(detail.id);
    } catch (e) {
      toast.error(e.response?.data?.detail || "Failed to reassign ticket");
    } finally {
      setReassignSubmitting(false);
    }
  };

  const filteredStaff = staffList.filter(u => {
    const q = staffSearch.toLowerCase();
    return !q || (u.name || u.username || "").toLowerCase().includes(q) || (u.email || "").toLowerCase().includes(q);
  });

  // ── WebSocket real-time updates ───────────────────────────────────────────
  const wsRef        = useRef(null);
  const reconnectRef = useRef(null);
  const detailRef    = useRef(null);
  const [wsConnected, setWsConnected] = useState(false);

  useEffect(() => { detailRef.current = detail; }, [detail]);

  useEffect(() => {
    const token = localStorage.getItem("token");
    if (!token) return;
    let delay = 1000;
    const connect = () => {
      const protocol = window.location.protocol === "https:" ? "wss" : "ws";
      const ws = new WebSocket(`${protocol}://${window.location.host}/api/tickets/ws?token=${token}`);
      wsRef.current = ws;
      ws.onopen = () => { setWsConnected(true); delay = 1000; };
      ws.onmessage = (e) => {
        try {
          const msg = JSON.parse(e.data);
          if (msg.type !== "ticket_update") return;
          const changedId = msg.ticket_id;
          api.get(`/api/tickets/${changedId}`).then(r => {
            setTickets(prev => prev.map(t => t.id === changedId ? r.data : t));
            if (detailRef.current?.id === changedId) refreshDetail(changedId);
          }).catch(() => {});
        } catch { /* ignore parse errors */ }
      };
      ws.onclose = () => {
        setWsConnected(false);
        reconnectRef.current = setTimeout(connect, delay);
        delay = Math.min(delay * 2, 30000);
      };
      ws.onerror = () => ws.close();
    };
    connect();
    return () => {
      if (wsRef.current) wsRef.current.close();
      if (reconnectRef.current) clearTimeout(reconnectRef.current);
    };
  }, []); // eslint-disable-line

  // ── Packing sub-status (read-only for sales) ──────────────────────────────
  useEffect(() => {
    if (!detail?.orders_ticket_ref) { setPackingEntry(null); return; }
    let cancelled = false;
    setPackingLoading(true);
    api.get(`/api/packing/entry/${detail.orders_ticket_ref}`)
      .then(r => { if (!cancelled) setPackingEntry(r.data); })
      .catch(() => { if (!cancelled) setPackingEntry(null); })
      .finally(() => { if (!cancelled) setPackingLoading(false); });
    return () => { cancelled = true; };
  }, [detail?.orders_ticket_ref]);

  useEffect(() => {
    if (!linkOrderOpen || linkOrderQuery.length < 2) { setLinkOrderResults([]); return; }
    setLinkOrderSearching(true);
    const t = setTimeout(async () => {
      try {
        const params = { search: linkOrderQuery, limit: 10 };
      const r = await api.get("/api/orders/", { params });
        setLinkOrderResults(r.data.orders || []);
      } catch { setLinkOrderResults([]); }
      finally { setLinkOrderSearching(false); }
    }, 300);
    return () => { clearTimeout(t); setLinkOrderSearching(false); };
  }, [linkOrderQuery, linkOrderOpen]);

  const openLinkOrderModal = () => {
    setLinkOrderQuery(""); setLinkOrderResults([]); setLinkOrderSelected(null);
    setLinkOrderPreview(null); setLinkOrderPreviewId(null);
    setLinkOrderOpen(true);
  };

  const previewOrderLines = async (order) => {
    if (linkOrderPreviewId === order.id) {
      setLinkOrderPreview(null); setLinkOrderPreviewId(null);
      return;
    }
    setLinkOrderPreviewId(order.id);
    setLinkOrderPreview({ loading: true, lines: [], order_id: order.id });
    try {
      const r = await api.get(`/api/orders/${order.id}/lines`);
      setLinkOrderPreview({ loading: false, lines: r.data.lines || [], order_id: order.id });
    } catch {
      setLinkOrderPreview({ loading: false, lines: [], order_id: order.id, error: true });
    }
  };

  const linkOrder = async () => {
    if (!linkOrderSelected) return toast.error("Select an order first");
    setLinkOrderSubmitting(true);
    try {
      await api.post(`/api/tickets/${detail.id}/link-order`, { order_id: linkOrderSelected.id });
      toast.success(`Linked to order ${linkOrderSelected.name}`);
      setLinkOrderOpen(false);
      refreshDetail(detail.id);
    } catch (e) { toast.error(e.response?.data?.detail || "Failed to link order"); }
    finally { setLinkOrderSubmitting(false); }
  };

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
      // Auto-close was applied server-side — refresh list so it shows Cancelled immediately
      if (ticket.odoo_order_state === "cancel") {
        load();
      }
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

  // Fetch MOs when any delivery is a backorder
  useEffect(() => {
    const orderId = detail?.order_id;
    const hasBackorder = deliveries.some(d => d.is_backorder);
    if (!orderId || !hasBackorder) { setMos([]); return; }
    setMosLoading(true);
    api.get(`/api/orders/${orderId}/manufacturing-orders`)
      .then(r => setMos(r.data.manufacturing_orders || []))
      .catch(() => setMos([]))
      .finally(() => setMosLoading(false));
  }, [detail?.order_id, deliveries]);

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

  const markExit = (exit_status) => setExitConfirm(exit_status);

  const doMarkExit = async (exit_status) => {
    setExitConfirm(null);
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

  const confirmOrder = async (overrideCredit = false, skipStockCheck = false) => {
    // Show stock-check modal for all roles — a quote placed days ago may have stock gaps
    if (!skipStockCheck && detail.order_id) {
      setConfirming(true);
      try {
        const { data } = await api.get(`/api/orders/${detail.order_id}/stock-check`);
        setStockCheckData(data);
        setStockCheckModal(true);
      } catch {
        // If stock-check fails, proceed without it
        setStockCheckModal(false);
        await confirmOrder(overrideCredit, true);
      } finally {
        setConfirming(false);
      }
      return;
    }

    setConfirming(true);
    try {
      const { data } = await api.put(
        `/api/orders/${detail.order_id}/confirm`,
        null,
        { params: overrideCredit ? { override_credit: true } : {} },
      );
      if (data.invoice_name) {
        toast.success(`Order confirmed. Invoice ${data.invoice_name} created.`);
      } else if (data.warnings?.some(w => w.toLowerCase().includes("deferred"))) {
        toast.success("Order confirmed. Invoice will be created on collection.");
      } else {
        toast.success("Order confirmed — ticket moved to WIP");
      }
      if (data.warnings?.length) {
        data.warnings.filter(w => !w.toLowerCase().includes("deferred"))
          .forEach(w => toast(w, { icon: "⚠️", duration: 8000 }));
      }
      setStockCheckModal(false);
      refreshDetail(detail.id);
    } catch (e) {
      if (e.response?.status === 402) {
        setConfirming(false);
        setConfirmAnywayMsg(e.response.data.detail);
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
  const [pickerOpen,           setPickerOpen          ] = useState(false);
  const [quoteAddresses,       setQuoteAddresses      ] = useState([]);
  const [quoteShippingId,      setQuoteShippingId     ] = useState("");
  const [quoteInvoiceId,       setQuoteInvoiceId      ] = useState("");
  const [quotePaymentTerms,    setQuotePaymentTerms   ] = useState([]);
  const [quotePaymentTermId,   setQuotePaymentTermId  ] = useState("");

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

  const handlePickerAdd = (product) => {
    const label    = product.display_name || product.name;
    const baseName = parseDisplayName(label).base;
    const stock      = Math.max(0, Math.floor(product.virtual_available || 0));
    const populated  = {
      ...newLine(),
      product_id:        product.id,
      _product_label:    label,
      name:              product.description_sale || baseName,
      _description_sale: product.description_sale || "",
      price_unit:        product.list_price || 0,
      _tax_rate:         product.tax_rate   || 0,
      _sku:              product.default_code || "",
      _stock:            stock,
      product_uom_qty:   1,
    };
    setQuoteLines(prev => {
      const last = prev[prev.length - 1];
      // Replace the trailing empty line rather than stacking an empty + populated pair
      if (last && !last.product_id) return [...prev.slice(0, -1), populated];
      return [...prev, populated];
    });
  };

  const loadQuoteCustomerContext = async (customerId, preShippingId, preInvoiceId, prePaymentTermId) => {
    try {
      const [addrRes, termRes] = await Promise.all([
        api.get(`/api/customers/${customerId}/addresses`),
        api.get(`/api/customers/${customerId}/payment-terms`),
      ]);
      setQuoteAddresses(addrRes.data.addresses || []);
      const defaultTermId = termRes.data.payment_term?.id;
      setQuotePaymentTermId(prePaymentTermId ? String(prePaymentTermId) : (defaultTermId ? String(defaultTermId) : ""));
    } catch {
      setQuoteAddresses([]);
    }
    setQuoteShippingId(preShippingId ? String(preShippingId) : "");
    setQuoteInvoiceId(preInvoiceId ? String(preInvoiceId) : "");
  };

  const openQuoteBuilder = async (ticket) => {
    const firstLine = newLine();
    setQuoteTicket(ticket);
    setQuoteLines([firstLine]);
    setLastAddedId(firstLine._id);
    setQuoteNote("");
    setQuoteMode("create");
    setQuoteAddresses([]);
    setQuoteShippingId("");
    setQuoteInvoiceId("");
    setQuotePaymentTermId("");
    setView("quote-builder");
    const promises = [];
    if (quoteWarehouses.length === 0) {
      promises.push(
        api.get("/api/warehouses/").then(r => {
          const whs = r.data.warehouses || [];
          const defId = r.data.default_warehouse_id;
          setQuoteWarehouses(whs);
          if (whs.length > 0) {
            const preferred = defId && whs.find(w => w.id === defId) ? String(defId) : String(whs[0].id);
            setQuoteWarehouseId(preferred);
          }
        }).catch(() => console.warn("Quote builder — warehouses load failed (non-fatal)"))
      );
    }
    if (quotePaymentTerms.length === 0) {
      promises.push(
        api.get("/api/tickets/payment-terms").then(r => setQuotePaymentTerms(r.data.payment_terms || [])).catch(() => {})
      );
    }
    if (ticket?.customer_id) {
      promises.push(loadQuoteCustomerContext(ticket.customer_id));
    }
    await Promise.all(promises);
  };

  const openQuoteEdit = async () => {
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
    const customerId = currentCustomer.id;
    const preShippingId = Array.isArray(detailOrder?.partner_shipping_id) ? detailOrder.partner_shipping_id[0] : null;
    const preInvoiceId  = Array.isArray(detailOrder?.partner_invoice_id)  ? detailOrder.partner_invoice_id[0]  : null;
    const prePaymentTermId = Array.isArray(detailOrder?.payment_term_id)  ? detailOrder.payment_term_id[0]     : null;
    if (quotePaymentTerms.length === 0) {
      api.get("/api/tickets/payment-terms").then(r => setQuotePaymentTerms(r.data.payment_terms || [])).catch(() => {});
    }
    if (customerId) {
      await loadQuoteCustomerContext(customerId, preShippingId, preInvoiceId, prePaymentTermId);
    }
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

  const cancelQuote = () => setCancelQuoteOpen(true);

  const doCancelQuote = async () => {
    setCancelQuoteOpen(false);
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
      if (quoteMode === "edit") {
        await api.put(`/api/tickets/${tid}/update-order`, {
          order_line: linePayload,
          customer_id:        quoteCustomer?.id || undefined,
          partner_shipping_id: quoteShippingId ? parseInt(quoteShippingId) : undefined,
          partner_invoice_id:  quoteInvoiceId  ? parseInt(quoteInvoiceId)  : undefined,
          payment_term_id:     quotePaymentTermId ? parseInt(quotePaymentTermId) : undefined,
          note: quoteNote || undefined,
        });
        toast.success("Quote updated in Odoo");
      } else {
        await api.post(`/api/tickets/${tid}/create-order`, {
          order_line: linePayload,
          warehouse_id:        quoteWarehouseId ? parseInt(quoteWarehouseId) : undefined,
          partner_shipping_id: quoteShippingId  ? parseInt(quoteShippingId) : undefined,
          partner_invoice_id:  quoteInvoiceId   ? parseInt(quoteInvoiceId)  : undefined,
          payment_term_id:     quotePaymentTermId ? parseInt(quotePaymentTermId) : undefined,
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

  // ── Admin: queue for packing override (legacy / error recovery) ─────────────
  const [paymentOverrideConfirm, setPaymentOverrideConfirm] = useState(false);
  const [paymentOverrideSaving,  setPaymentOverrideSaving ] = useState(false);

  const adminOverridePayment = async () => {
    setPaymentOverrideSaving(true);
    try {
      await api.post(`/api/tickets/${detail.id}/admin-override-payment`);
      toast.success("Order queued for packing");
      setPaymentOverrideConfirm(false);
      refreshDetail(detail.id);
    } catch (e) { toast.error(e.response?.data?.detail || "Override failed"); }
    finally { setPaymentOverrideSaving(false); }
  };

  // ── Invoice lifecycle actions (8.24) ─────────────────────────────────────
  const [sendingInvoice, setSendingInvoice] = useState(false);
  const [resetDraftConfirm, setResetDraftConfirm] = useState(false);
  const [creditNoteModal, setCreditNoteModal] = useState(false);
  const [creditNoteJournals, setCreditNoteJournals] = useState([]);
  const [creditNoteForm, setCreditNoteForm] = useState({ reason: "", date: "", journal_id: "" });
  const [creditNoteSaving, setCreditNoteSaving] = useState(false);

  const sendInvoice = async () => {
    setSendingInvoice(true);
    try {
      const r = await api.post(`/api/tickets/${detail.id}/send-invoice`);
      if (r.data.warning) toast.error(r.data.warning, { duration: 6000 });
      else toast.success("Invoice sent to customer");
      refreshDetail(detail.id);
    } catch (e) { toast.error(e.response?.data?.detail || "Failed to send invoice"); }
    finally { setSendingInvoice(false); }
  };

  const resetToDraft = async () => {
    setResetDraftConfirm(false);
    try {
      await api.post(`/api/invoices/${detail.invoice_id}/reset-to-draft`);
      toast.success("Invoice reset to draft");
      refreshDetail(detail.id);
    } catch (e) { toast.error(e.response?.data?.detail || "Failed"); }
  };

  const openCreditNoteModal = async () => {
    const today = new Date().toISOString().split("T")[0];
    setCreditNoteForm({ reason: "", date: today, journal_id: "" });
    try {
      const r = await api.get("/api/invoices/credit-note-journals");
      const journals = r.data.journals || [];
      setCreditNoteJournals(journals);
      setCreditNoteForm(f => ({ ...f, journal_id: journals[0]?.id ? String(journals[0].id) : "" }));
    } catch { toast.error("Failed to load journals"); }
    setCreditNoteModal(true);
  };

  const createCreditNote = async () => {
    if (!creditNoteForm.reason) return toast.error("Reason is required");
    setCreditNoteSaving(true);
    try {
      const r = await api.post(`/api/invoices/${detail.invoice_id}/credit-note`, {
        reason:     creditNoteForm.reason,
        date:       creditNoteForm.date || undefined,
        journal_id: creditNoteForm.journal_id ? parseInt(creditNoteForm.journal_id) : undefined,
      });
      toast.success(`Credit note ${r.data.credit_note_name} created`);
      setCreditNoteModal(false);
      refreshDetail(detail.id);
    } catch (e) { toast.error(e.response?.data?.detail || "Failed to create credit note"); }
    finally { setCreditNoteSaving(false); }
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
          title={
            detail?.customer_name
              ? (detail.customer_company_name || detail.customer_name)
              : "Loading…"
          }
          subtitle={
            detail
              ? detail.exit_status
                ? EXIT_LABEL[detail.exit_status]
                : (STATUS_LABEL[detail.status] || detail.status)
              : ""
          }
          actions={
            <div className="flex items-center gap-2">
              {detailOrder && (
                <BtnSecondary onClick={() => setPrintOrderOpen(true)}>
                  <Download size={14} /> Print Order
                </BtnSecondary>
              )}
              <BtnSecondary onClick={() => { setDetail(null); setDetailOrder(null); setView("list"); }}>
                ← Back to Tickets
              </BtnSecondary>
            </div>
          }
        />

        {detailLoading || !detail ? (
          <div className="flex-1 flex items-center justify-center"><LoadingState /></div>
        ) : (
          <main className="flex-1 overflow-y-auto p-6">
            <div className="max-w-7xl mx-auto">
              {detail.odoo_order_state === "cancel" && (
                <div className="mb-5 bg-amber-50 border border-amber-200 rounded-xl p-3 flex items-center gap-2">
                  <AlertTriangle size={15} className="text-amber-500 flex-shrink-0" />
                  <p className="text-xs text-amber-700">
                    This ticket was automatically closed because the linked order was cancelled in the ERP.
                  </p>
                </div>
              )}
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
                            <div className="flex flex-col items-end gap-1.5">
                              <Badge color={orderStateColor}>{orderStateLabel}</Badge>
                              <p className="text-xs text-gray-400">
                                {detailOrder.date_order
                                  ? new Date(detailOrder.date_order).toLocaleDateString("en-ZA", {
                                      day: "2-digit", month: "short", year: "numeric",
                                    })
                                  : "—"}
                              </p>
                              <OrderBarcode orderRef={detailOrder.name} />
                            </div>
                          </div>
                          <div className={`grid ${isReseller ? "grid-cols-1" : "grid-cols-1 sm:grid-cols-2"} gap-6 pt-4 border-t border-gray-50`}>
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
                            {!isReseller && (
                              <div>
                                <p className="text-xs font-semibold text-gray-400 uppercase tracking-wide mb-1.5">Warehouse</p>
                                <p className="text-sm font-semibold text-gray-900">
                                  {Array.isArray(detailOrder.warehouse_id) ? detailOrder.warehouse_id[1] : "—"}
                                </p>
                                <p className="text-xs text-gray-400 mt-0.5">Stock deducted from this location</p>
                              </div>
                            )}
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
                              const { base, groups } = parseDisplayName(line.name || line.product_id?.[1] || "");
                              const pid = line.product_id?.[0];
                              const lots = pid && detailOrder.lot_map?.[pid] ? detailOrder.lot_map[pid] : [];
                              return (
                              <tr key={i} className="border-b border-gray-50 hover:bg-slate-50/30">
                                <td className="p-3 pl-6">
                                  <p className="text-sm font-medium text-gray-900">{base}</p>
                                  {groups.length > 0 && (
                                    <div className="flex flex-wrap gap-1 mt-1">
                                      {groups.map((g, gi) => (
                                        <span key={gi} className="text-[10px] bg-bassani-50 text-bassani-700 rounded px-1.5 py-0.5 font-medium leading-none">{g}</span>
                                      ))}
                                    </div>
                                  )}
                                  {lots.length > 0 && (
                                    <p className="font-mono text-[10px] text-bassani-600 mt-0.5">Batch: {lots.join(", ")}</p>
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
                                      {d.lines.map((l, i) => {
                                        const lineLots = detailOrder?.lot_map?.[l.product_id] || [];
                                        return (
                                        <div key={i} className="flex items-start gap-2 text-xs text-gray-500">
                                          <span className="flex-1 truncate">{l.product_name}</span>
                                          <span className="shrink-0 tabular-nums">
                                            {l.qty_done}/{l.qty_ordered} units
                                            {l.qty_done < l.qty_ordered && (
                                              <span className="text-orange-500 ml-1">({l.qty_ordered - l.qty_done} outstanding)</span>
                                            )}
                                          </span>
                                          {lineLots.length > 0 && (
                                            <span className="shrink-0 font-mono text-[10px] text-bassani-600 bg-bassani-50 px-1.5 py-0.5 rounded">{lineLots.join(", ")}</span>
                                          )}
                                        </div>
                                        );
                                      })}
                                    </div>
                                  )}
                                </div>
                              ))}
                            </div>
                          )}
                        </div>
                      )}

                      {/* Production Status — MOs linked to this order (backorder replenishment) */}
                      {(mosLoading || mos.length > 0) && (
                        <div className="bg-white rounded-2xl shadow-sm border border-gray-100 p-4 space-y-3">
                          <p className="text-xs font-semibold text-gray-500 uppercase tracking-wide flex items-center gap-1.5">
                            <Package size={12} />Production Status
                          </p>
                          {mosLoading ? (
                            <p className="text-xs text-gray-400">Loading production orders...</p>
                          ) : (
                            <div className="space-y-2">
                              {mos.map(mo => {
                                const MO_COLOURS = {
                                  draft:     "bg-gray-100 text-gray-500",
                                  confirmed: "bg-amber-50 text-amber-700",
                                  progress:  "bg-green-50 text-green-700",
                                  to_close:  "bg-blue-50 text-blue-700",
                                };
                                const MO_LABELS = {
                                  draft: "Draft", confirmed: "Confirmed",
                                  progress: "In Progress", to_close: "To Close",
                                };
                                const colour = MO_COLOURS[mo.state] || "bg-gray-100 text-gray-500";
                                return (
                                  <div key={mo.mo_id} className="flex items-start justify-between gap-2 text-xs">
                                    <div className="min-w-0">
                                      <span className="font-mono font-medium text-gray-700">{mo.mo_name}</span>
                                      <span className="ml-1.5 text-gray-500 truncate">{mo.product_name}</span>
                                      {mo.qty_producing > 0 && (
                                        <span className="ml-1.5 text-green-600">{mo.qty_producing}/{mo.product_qty} producing</span>
                                      )}
                                      {mo.date_planned_finished && (
                                        <span className="ml-1.5 text-gray-400">· due {fmtDate(mo.date_planned_finished)}</span>
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
                      {(detail.source === "direct" || detail.source === "email") && canDrive && !detail.exit_status && (
                        <div className="mt-2 flex flex-wrap gap-2 justify-center">
                          <BtnPrimary onClick={() => openQuoteBuilder(detail)}>
                            <ShoppingCart size={14} />Build Quote
                          </BtnPrimary>
                          <BtnSecondary onClick={openLinkOrderModal}>
                            <Link2 size={14} />Link Existing Order
                          </BtnSecondary>
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

                  {/* Reseller: progress tracker */}
                  {isReseller && (() => {
                    const step = resellerStep(detail, packingEntry);
                    const cancelled = step === -1;
                    return (
                      <div className="bg-white rounded-2xl shadow-sm border border-gray-100 p-4">
                        <p className="text-[10px] font-semibold text-gray-400 uppercase tracking-wider mb-3">Order Progress</p>
                        {cancelled ? (
                          <div className="flex items-center gap-2 text-sm text-red-500">
                            <XCircle size={16} />
                            <span className="font-medium">{R_EXIT_LABEL[detail.exit_status] || "Cancelled"}</span>
                          </div>
                        ) : (
                          <div className="space-y-2">
                            {R_STEPS.map((s, i) => {
                              const done   = i < step;
                              const active = i === step;
                              return (
                                <div key={s.key} className="flex items-center gap-2.5">
                                  <div className={`w-5 h-5 rounded-full flex items-center justify-center shrink-0 text-[10px] font-bold
                                    ${done   ? "bg-bassani-600 text-white"
                                    : active ? "bg-bassani-100 border-2 border-bassani-600 text-bassani-600"
                                             : "bg-gray-100 text-gray-300"}`}>
                                    {done ? "✓" : i + 1}
                                  </div>
                                  <span className={`text-xs ${done ? "text-gray-400 line-through" : active ? "font-semibold text-gray-800" : "text-gray-300"}`}>
                                    {s.label}
                                    {active && packingEntry && R_PACK_LABEL[packingEntry.status] && (
                                      <span className="block text-[10px] font-normal text-bassani-600 mt-0.5">
                                        {R_PACK_LABEL[packingEntry.status]}
                                      </span>
                                    )}
                                  </span>
                                </div>
                              );
                            })}
                          </div>
                        )}
                        {/* Partial fulfilment split — shown to reseller when first delivery is ready */}
                        {detail.status === "partially_fulfilled" && packingEntry?.items?.length > 0 && (
                          <div className="mt-3 pt-3 border-t border-gray-100 space-y-2">
                            {packingEntry.items.filter(i => !i.is_backordered).length > 0 && (
                              <div>
                                <p className="text-[10px] font-semibold text-green-600 uppercase tracking-wide mb-1">Shipping now</p>
                                {packingEntry.items.filter(i => !i.is_backordered).map((i, idx) => (
                                  <div key={idx} className="flex justify-between text-[11px] text-gray-600 py-0.5">
                                    <span>{i.name}</span>
                                    <span className="font-medium">{i.qty_reserved ?? i.qty} units</span>
                                  </div>
                                ))}
                              </div>
                            )}
                            {packingEntry.items.filter(i => i.is_backordered).length > 0 && (
                              <div>
                                <p className="text-[10px] font-semibold text-amber-600 uppercase tracking-wide mb-1">Backordered</p>
                                {packingEntry.items.filter(i => i.is_backordered).map((i, idx) => (
                                  <div key={idx} className="flex justify-between text-[11px] text-gray-500 py-0.5">
                                    <span>{i.name}</span>
                                    <span className="font-medium text-amber-600">{Math.round((i.qty_ordered ?? i.qty) - (i.qty_reserved ?? 0))} units</span>
                                  </div>
                                ))}
                              </div>
                            )}
                          </div>
                        )}
                        {detail.payment_confirmed_at && (
                          <p className="text-[11px] text-green-600 flex items-center gap-1.5 mt-3 pt-3 border-t border-gray-100">
                            <CheckCircle2 size={11} />
                            {detail.payment_confirmed_by === "auto"
                              ? <>Auto-confirmed from bank {fmtDate(detail.payment_confirmed_at)}</>
                              : <>Payment confirmed {fmtDate(detail.payment_confirmed_at)}</>
                            }
                          </p>
                        )}
                      </div>
                    );
                  })()}

                  {/* Status & Details */}
                  <div className="bg-white rounded-2xl shadow-sm border border-gray-100 p-4 space-y-3">
                    <div className="flex flex-wrap gap-2">
                      {detail.exit_status
                        ? <Badge color={EXIT_COLOR[detail.exit_status]}>{isReseller ? (R_EXIT_LABEL[detail.exit_status] || detail.exit_status) : EXIT_LABEL[detail.exit_status]}</Badge>
                        : <Badge color={isReseller ? (R_STATUS_COLOR[detail.status] || "gray") : (STATUS_COLOR[detail.status])}>{isReseller ? (R_STATUS_LABEL[detail.status] || detail.status) : (STATUS_LABEL[detail.status] || detail.status)}</Badge>}
                      {!isReseller && (
                        detail.source === "reseller" ? (
                          <Badge color="purple">Reseller Order</Badge>
                        ) : detail.source === "portal" ? (
                          <Badge color="blue">Portal Order</Badge>
                        ) : detail.source === "email" ? (
                          <Badge color="gray">Email Inquiry</Badge>
                        ) : (
                          <Badge color="gray">Direct Inquiry</Badge>
                        )
                      )}
                    </div>
                    {detail.is_sample && (
                      <div className="flex items-center gap-1.5 text-xs text-amber-700 bg-amber-50 border border-amber-100 rounded-lg px-2.5 py-1.5">
                        <span className="font-semibold">Sample order</span>
                        {detail.sample_recipient_name && (
                          <span className="text-amber-600">for {detail.sample_recipient_name}</span>
                        )}
                      </div>
                    )}
                    {!isReseller && detail.reseller_name && (
                      <div className="flex items-center gap-1.5 text-xs text-purple-700 bg-purple-50 border border-purple-100 rounded-lg px-2.5 py-1.5">
                        <span className="font-semibold">Via reseller:</span>
                        <span>{detail.reseller_name}</span>
                      </div>
                    )}
                    <div className="space-y-2">
                      {detail.customer_company_id ? (
                        <>
                          <div>
                            <p className="text-[10px] font-semibold text-gray-400 uppercase tracking-wide mb-0.5">Bill to</p>
                            <button
                              onClick={() => navigate(`/customers/${detail.customer_company_id}`)}
                              className="text-sm font-semibold text-bassani-700 hover:text-bassani-800 flex items-center gap-1 transition-colors"
                            >
                              <ExternalLink size={11} />{detail.customer_company_name}
                            </button>
                          </div>
                          <div>
                            <p className="text-[10px] font-semibold text-gray-400 uppercase tracking-wide mb-0.5">Contact person</p>
                            <p className="text-xs font-medium text-gray-700">{detail.customer_name}</p>
                            {detail.customer_email && (
                              <p className="text-xs text-gray-500 flex items-center gap-1.5 mt-0.5 min-w-0">
                                <Mail size={11} className="text-gray-400 shrink-0" />
                                <span className="truncate min-w-0">
                                  <a href={`mailto:${detail.customer_email}`} className="hover:text-bassani-600 transition-colors">{detail.customer_email}</a>
                                </span>
                              </p>
                            )}
                          </div>
                        </>
                      ) : (
                        <>
                          {detail.customer_email && (
                            <p className="text-xs text-gray-500 flex items-center gap-1.5 min-w-0">
                              <Mail size={11} className="text-gray-400 shrink-0" />
                              <span className="truncate min-w-0">
                                <a href={`mailto:${detail.customer_email}`} className="hover:text-bassani-600 transition-colors">{detail.customer_email}</a>
                              </span>
                            </p>
                          )}
                          {detail.customer_id && (
                            <div className="space-y-1">
                              <button
                                onClick={() => navigate(`/customers/${detail.customer_id}`)}
                                className="text-xs text-bassani-600 hover:text-bassani-700 flex items-center gap-1 transition-colors"
                              >
                                <ExternalLink size={11} />View customer profile
                              </button>
                              {can("customers.manage") && !detail.customer_is_company && (
                                <button
                                  onClick={openLinkCompanyModal}
                                  className="text-xs text-amber-600 hover:text-amber-700 flex items-center gap-1 transition-colors"
                                >
                                  <Link2 size={11} />Link to company
                                </button>
                              )}
                            </div>
                          )}
                        </>
                      )}
                      {detail.order_id   && <p className="text-xs text-gray-400">{isReseller ? "Order" : "Odoo SO"} #{detail.order_id}</p>}
                      {!isReseller && detail.invoice_id && <p className="text-xs text-gray-400">Invoice #{detail.invoice_id}</p>}
                      {!isReseller && detail.credit_note_name && (
                        <p className="text-xs text-orange-600 flex items-center gap-1.5">
                          <FileX size={11} />Credit note {detail.credit_note_name}
                        </p>
                      )}
                      {detail.quote_sent_at && (
                        <p className="text-xs text-blue-600 flex items-center gap-1.5">
                          <Send size={11} />Quote sent {fmtDate(detail.quote_sent_at)}
                        </p>
                      )}
                      {!isReseller && detail.invoice_sent_at && (
                        <p className="text-xs text-blue-600 flex items-center gap-1.5">
                          <ReceiptText size={11} />Invoice sent {fmtDate(detail.invoice_sent_at)}
                        </p>
                      )}
                      {!isReseller && detail.payment_confirmed_at && (
                        <p className="text-xs text-green-600 flex items-center gap-1.5">
                          <CheckCircle2 size={11} />
                          {detail.payment_confirmed_by === "auto"
                            ? <>Auto-confirmed from bank {fmtDate(detail.payment_confirmed_at)}</>
                            : <>Payment confirmed {fmtDate(detail.payment_confirmed_at)}</>
                          }
                        </p>
                      )}
                    </div>
                    {!isReseller && <div className="pt-2 border-t border-gray-100 space-y-1.5">
                      <div className="flex items-center justify-between gap-2">
                        {detail.assigned_to_name
                          ? <span className="text-xs text-gray-500">
                              Assigned to <span className="font-medium text-gray-700">{detail.assigned_to_name}</span>
                              {detail.assigned_to_role && <span className="ml-1 text-gray-400">({ROLE_LABEL[detail.assigned_to_role] || detail.assigned_to_role})</span>}
                            </span>
                          : <span className="text-xs text-amber-600 flex items-center gap-1"><UserPlus size={11} />Unassigned</span>}
                        {isAdmin && !detail.exit_status && (
                          <button
                            onClick={openReassign}
                            className="flex items-center gap-1 text-xs text-gray-400 hover:text-bassani-600 transition-colors"
                            title="Reassign ticket"
                          >
                            <Pencil size={11} />Reassign
                          </button>
                        )}
                      </div>
                      {!detail.assigned_to && canDrive && !isReseller && (
                        <BtnSecondary size="sm" onClick={() => assignToMe(detail.id)}>
                          <UserPlus size={12} />Assign to me
                        </BtnSecondary>
                      )}

                      {/* Inline reassign dropdown */}
                      {reassignOpen && (
                        <div className="mt-1 border border-gray-200 rounded-xl overflow-hidden shadow-md bg-white z-10">
                          <div className="p-2 border-b border-gray-100">
                            <div className="relative">
                              <Search size={12} className="absolute left-2.5 top-1/2 -translate-y-1/2 text-gray-400" />
                              <input
                                autoFocus
                                value={staffSearch}
                                onChange={e => setStaffSearch(e.target.value)}
                                placeholder="Search staff…"
                                className="w-full pl-7 pr-3 py-1.5 text-xs bg-gray-50 border border-gray-100 rounded-lg outline-none focus:border-bassani-300 focus:ring-1 focus:ring-bassani-100 placeholder-gray-400"
                                onKeyDown={e => e.key === "Escape" && setReassignOpen(false)}
                              />
                            </div>
                          </div>
                          <div className="max-h-48 overflow-y-auto">
                            {filteredStaff.length === 0
                              ? <p className="text-xs text-gray-400 px-3 py-2">No staff found</p>
                              : filteredStaff.map(u => (
                                <button
                                  key={u.id}
                                  disabled={reassignSubmitting}
                                  onClick={() => submitReassign(u)}
                                  className={`w-full flex items-center gap-2 px-3 py-2 hover:bg-bassani-50 text-left border-b border-gray-50 last:border-0 transition-colors ${u.id === detail.assigned_to ? "bg-bassani-50" : ""}`}
                                >
                                  <div className="w-6 h-6 rounded-full bg-bassani-100 flex items-center justify-center flex-shrink-0 text-[10px] font-bold text-bassani-700">
                                    {(u.name || u.username || "?")[0].toUpperCase()}
                                  </div>
                                  <div className="min-w-0">
                                    <p className="text-xs font-medium text-gray-900 truncate">{u.name || u.username}</p>
                                    <p className="text-[10px] text-gray-400 truncate">{ROLE_LABEL[u.role] || u.role}</p>
                                  </div>
                                  {u.id === detail.assigned_to && (
                                    <span className="ml-auto text-[10px] text-bassani-600 font-medium">Current</span>
                                  )}
                                </button>
                              ))
                            }
                          </div>
                          <div className="p-2 border-t border-gray-100">
                            <button onClick={() => setReassignOpen(false)} className="w-full text-xs text-gray-400 hover:text-gray-600 py-1 transition-colors">Cancel</button>
                          </div>
                        </div>
                      )}
                    </div>}
                  </div>

                  {/* Packing Status — read-only visibility for sales */}
                  {detail.orders_ticket_ref && (
                    <div className="bg-white rounded-2xl shadow-sm border border-gray-100 p-4 space-y-3">
                      <div className="flex items-center gap-1.5">
                        <Package size={13} className="text-gray-400" />
                        <p className="text-xs font-semibold text-gray-400 uppercase tracking-wide">Packing Status</p>
                      </div>
                      {packingLoading ? (
                        <p className="text-xs text-gray-400 flex items-center gap-1.5">
                          <Loader2 size={11} className="animate-spin" />Loading…
                        </p>
                      ) : packingEntry ? (
                        <div className="space-y-2">
                          <Badge color={PACK_STATUS_COLOR[packingEntry.status]}>{PACK_STATUS_LABEL[packingEntry.status] || packingEntry.status}</Badge>
                          <div className="space-y-1.5">
                            <p className="text-xs text-gray-500 flex items-center gap-1.5">
                              <UserPlus size={11} className="text-gray-400 shrink-0" />
                              {packingEntry.packer_name
                                ? packingEntry.packer_name
                                : <span className="text-amber-600">Awaiting packer assignment</span>}
                            </p>
                            <p className="text-xs flex items-center gap-1.5">
                              {packingEntry.qa_approved_at
                                ? <><CheckCircle2 size={11} className="text-green-500 shrink-0" /><span className="text-gray-500">QA approved by {packingEntry.qa_approved_by} {fmtDate(packingEntry.qa_approved_at)}</span></>
                                : <><Clock size={11} className="text-gray-400 shrink-0" /><span className="text-gray-400">QA approval pending</span></>}
                            </p>
                            <p className="text-xs flex items-center gap-1.5">
                              {packingEntry.rp_approved_at
                                ? <><CheckCircle2 size={11} className="text-green-500 shrink-0" /><span className="text-gray-500">RP approved by {packingEntry.rp_approved_by} {fmtDate(packingEntry.rp_approved_at)}</span></>
                                : <><Clock size={11} className="text-gray-400 shrink-0" /><span className="text-gray-400">RP approval pending</span></>}
                            </p>
                            {packingEntry.queued_at && <p className="text-[10px] text-gray-400">Queued {fmtDate(packingEntry.queued_at)}</p>}
                            {packingEntry.assigned_at && <p className="text-[10px] text-gray-400">Packing started {fmtDate(packingEntry.assigned_at)}</p>}
                            {packingEntry.ready_at && <p className="text-[10px] text-green-600">Ready {fmtDate(packingEntry.ready_at)}</p>}
                            {packingEntry.incomplete_reason && <p className="text-[10px] text-orange-600">Reason: {packingEntry.incomplete_reason}</p>}
                          </div>
                        </div>
                      ) : (
                        <p className="text-xs text-gray-400">Packing information unavailable.</p>
                      )}
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
                          <button
                            onClick={() => {
                              if (isReseller) {
                                navigate("/orders", {
                                  state: {
                                    editQuote: {
                                      ticketId:     detail.id,
                                      orderId:      detail.order_id,
                                      customerName: detail.customer_name,
                                      customerId:   Array.isArray(detailOrder?.partner_id) ? detailOrder.partner_id[0] : detail.customer_id,
                                      lines: (detailOrder?.lines || []).map(l => ({
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
                              } else {
                                openQuoteEdit();
                              }
                            }}
                            className="w-full flex items-center gap-3 px-3 py-2 text-sm text-gray-700 hover:bg-gray-50 rounded-lg transition-colors text-left"
                          >
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

                        {!detail.is_sample && detail.invoice_id && !detail.payment_confirmed_at && canFinance && (
                          <button onClick={confirmPayment} disabled={saving} className="w-full flex items-center gap-3 px-3 py-2 text-sm text-amber-700 hover:bg-amber-50 rounded-lg transition-colors text-left">
                            <CreditCard size={14} className="text-amber-500 shrink-0" />
                            {saving ? "Confirming…" : "Confirm Payment"}
                          </button>
                        )}

                        {!detail.is_sample && detail.payment_confirmed_at && detail.order_id && canFinance && (
                          <button onClick={openBalanceModal} className="w-full flex items-center gap-3 px-3 py-2 text-sm text-blue-700 hover:bg-blue-50 rounded-lg transition-colors text-left">
                            <CreditCard size={14} className="text-blue-500 shrink-0" />Register Balance Payment
                          </button>
                        )}

                        {/* 8.24 — Invoice lifecycle actions */}
                        {!detail.is_sample && detail.invoice_id && !isReseller && canFinance && (
                          <>
                            <button onClick={sendInvoice} disabled={sendingInvoice} className="w-full flex items-center gap-3 px-3 py-2 text-sm text-blue-700 hover:bg-blue-50 rounded-lg transition-colors text-left">
                              {sendingInvoice ? <Loader2 size={14} className="shrink-0 animate-spin" /> : <Send size={14} className="text-blue-500 shrink-0" />}
                              {detail.invoice_sent_at ? "Resend Invoice" : "Send Invoice"}
                            </button>

                            {!detail.payment_confirmed_at && (
                              <button onClick={() => setResetDraftConfirm(true)} className="w-full flex items-center gap-3 px-3 py-2 text-sm text-gray-500 hover:bg-gray-50 rounded-lg transition-colors text-left">
                                <RotateCcw size={14} className="shrink-0" />Reset Invoice to Draft
                              </button>
                            )}
                            <button onClick={openCreditNoteModal} className="w-full flex items-center gap-3 px-3 py-2 text-sm text-orange-700 hover:bg-orange-50 rounded-lg transition-colors text-left">
                              <FileX size={14} className="text-orange-500 shrink-0" />Raise Credit Note
                            </button>
                          </>
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
                          <button onClick={openLinkOrderModal} className="w-full flex items-center gap-3 px-3 py-2 text-sm text-gray-700 hover:bg-gray-50 rounded-lg transition-colors text-left">
                            <Link2 size={14} className="text-gray-400 shrink-0" />Link Existing Order
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

                                {detailOrder?.state === "sale" && !detail.orders_ticket_ref && (
                                  <>
                                    <div className="border-t border-gray-100 pt-3 mt-1">
                                      <p className="text-[10px] text-gray-400 mb-2">Use this only if the order was confirmed in Odoo but was not automatically queued for packing (e.g. legacy or pre-portal orders).</p>
                                      <BtnDanger onClick={() => setPaymentOverrideConfirm(true)} className="w-full justify-center">
                                        Queue for Packing
                                      </BtnDanger>
                                    </div>
                                  </>
                                )}
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

        {/* Print order overlay — full OrderView with barcode */}
        {printOrderOpen && detailOrder && (
          <OrderView
            order={detailOrder}
            onClose={() => setPrintOrderOpen(false)}
            isAdmin={isAdmin}
            canConfirmOrder={false}
            canCancelOrder={false}
          />
        )}

        {/* Reseller pre-confirm stock-check modal */}
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
                        {isReseller
                          ? "This order cannot be partially fulfilled at this time. Please contact Bassani directly to resolve the issue before confirming."
                          : "One or more products are set to invoice on ordered quantity, not delivered quantity. Update the invoice policy to \"Delivered quantities\" in Odoo, then retry."}
                      </p>
                    </div>
                  </div>
                )}
                <div className="flex items-start gap-3 bg-amber-50 border border-amber-100 rounded-xl p-3 mb-4">
                  <AlertTriangle size={15} className="text-amber-500 mt-0.5 shrink-0" />
                  <div>
                    <p className="text-sm font-semibold text-amber-800">Some items are not in stock</p>
                    <p className="text-xs text-amber-700 mt-0.5">
                      {isReseller
                        ? "Bassani will ship available items now and fulfil the rest as soon as stock arrives. You will receive a separate confirmation when the backorder is ready."
                        : "Confirming will create a partial delivery. Available items will ship immediately and a backorder will be created in Odoo for the remainder. The client and your team will be notified."}
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
                    <BtnPrimary className="flex-1 justify-center" loading={confirming} onClick={() => confirmOrder(false, true)}>
                      {isReseller ? "Confirm with Backorder" : "Confirm — Create Backorder"}
                    </BtnPrimary>
                  )}
                </div>
              </>
            ) : (
              <>
                <div className="flex items-start gap-3 bg-green-50 border border-green-100 rounded-xl p-3 mb-4">
                  <CheckCircle2 size={15} className="text-green-500 mt-0.5 shrink-0" />
                  <p className="text-sm text-green-800">
                    {isReseller
                      ? "All items are in stock. Your order will be fulfilled in full."
                      : "All items are in stock. This order will be fulfilled in full."}
                  </p>
                </div>
                <div className="flex gap-2">
                  <BtnSecondary className="flex-1 justify-center" onClick={() => { setStockCheckModal(false); setStockCheckData(null); }}>
                    Cancel
                  </BtnSecondary>
                  <BtnPrimary className="flex-1 justify-center" loading={confirming} onClick={() => confirmOrder(false, true)}>
                    Confirm Order
                  </BtnPrimary>
                </div>
              </>
            )}
          </Modal>
        )}

        {/* Queue for Packing override — error recovery for confirmed orders not auto-queued */}
        {paymentOverrideConfirm && (
          <Modal title="Queue for Packing" onClose={() => setPaymentOverrideConfirm(false)}>
            <p className="text-sm text-gray-600 mb-4">
              This will manually queue the order for packing. Only use this for orders where the order was confirmed in Odoo but was not automatically added to the packing board (e.g. legacy or pre-portal orders, or after a system error).
            </p>
            <div className="flex justify-end gap-2">
              <BtnSecondary onClick={() => setPaymentOverrideConfirm(false)}>Cancel</BtnSecondary>
              <BtnDanger onClick={adminOverridePayment} loading={paymentOverrideSaving} disabled={paymentOverrideSaving}>Queue for Packing</BtnDanger>
            </div>
          </Modal>
        )}

        {resetDraftConfirm && (
          <Modal title="Reset Invoice to Draft" onClose={() => setResetDraftConfirm(false)}>
            <p className="text-sm text-gray-600 mb-4">
              This will reset the posted invoice back to draft in Odoo. Use this to correct errors before the invoice has been paid.
              The invoice cannot be reset if a payment has already been registered against it.
            </p>
            <div className="flex justify-end gap-2">
              <BtnSecondary onClick={() => setResetDraftConfirm(false)}>Cancel</BtnSecondary>
              <BtnDanger onClick={resetToDraft}>Reset to Draft</BtnDanger>
            </div>
          </Modal>
        )}

        {/* 8.26 — Credit note modal */}
        {creditNoteModal && (
          <Modal title="Raise Credit Note" onClose={() => setCreditNoteModal(false)}>
            <p className="text-xs text-gray-500 mb-4">
              Creates a credit note in Odoo against invoice #{detail.invoice_id}. Use this for damaged goods, short deliveries, or pricing corrections.
            </p>
            <FormGroup label="Reason" required>
              <Input value={creditNoteForm.reason}
                onChange={e => setCreditNoteForm(f => ({ ...f, reason: e.target.value }))}
                placeholder="e.g. Goods returned — short delivery on 3 units"
                autoFocus />
            </FormGroup>
            <FormGroup label="Credit Note Date">
              <Input type="date" value={creditNoteForm.date}
                onChange={e => setCreditNoteForm(f => ({ ...f, date: e.target.value }))} />
            </FormGroup>
            <FormGroup label="Journal">
              <Select value={creditNoteForm.journal_id}
                onChange={e => setCreditNoteForm(f => ({ ...f, journal_id: e.target.value }))}>
                <option value="">— Default —</option>
                {creditNoteJournals.map(j => (
                  <option key={j.id} value={j.id}>{j.name}</option>
                ))}
              </Select>
            </FormGroup>
            <div className="flex justify-end gap-2 mt-4">
              <BtnSecondary onClick={() => setCreditNoteModal(false)} disabled={creditNoteSaving}>Cancel</BtnSecondary>
              <BtnDanger onClick={createCreditNote} disabled={creditNoteSaving}>
                {creditNoteSaving ? <Loader2 size={13} className="animate-spin mr-1.5" /> : null}
                Create Credit Note
              </BtnDanger>
            </div>
          </Modal>
        )}

        {/* Link contact to company modal */}
        {linkCompanyOpen && (
          <Modal title={`Link ${detail?.customer_name} to a Company`} onClose={() => setLinkCompanyOpen(false)}>
            <p className="text-xs text-gray-500 mb-4">
              Search for the company this contact belongs to. This updates their record so they appear as a contact under that company's profile.
            </p>
            <FormGroup label="Search companies">
              <div className="relative">
                <Search size={13} className="absolute left-3 top-1/2 -translate-y-1/2 text-gray-400" />
                <Input
                  value={linkCompanyQuery}
                  onChange={e => { setLinkCompanyQuery(e.target.value); setLinkCompanySelected(null); }}
                  placeholder="Type company name…"
                  className="pl-8"
                  autoFocus
                />
                {linkCompanySearching && <Loader2 size={13} className="absolute right-3 top-1/2 -translate-y-1/2 text-gray-400 animate-spin" />}
              </div>
            </FormGroup>
            {linkCompanyResults.length > 0 && !linkCompanySelected && (
              <div className="mt-1 border border-gray-100 rounded-xl overflow-hidden">
                {linkCompanyResults.map(c => (
                  <button
                    key={c.id}
                    onClick={() => setLinkCompanySelected(c)}
                    className="w-full flex items-center gap-2 px-4 py-2.5 hover:bg-bassani-50 text-left border-b border-gray-50 last:border-0 transition-colors"
                  >
                    <div>
                      <p className="text-sm font-medium text-gray-900">{c.name}</p>
                      {c.email && <p className="text-xs text-gray-400">{c.email}</p>}
                    </div>
                  </button>
                ))}
              </div>
            )}
            {linkCompanySelected && (
              <div className="mt-2 bg-bassani-50 border border-bassani-200 rounded-xl px-4 py-3 flex items-center justify-between">
                <div>
                  <p className="text-sm font-semibold text-bassani-800">{linkCompanySelected.name}</p>
                  {linkCompanySelected.email && <p className="text-xs text-bassani-600">{linkCompanySelected.email}</p>}
                </div>
                <button onClick={() => setLinkCompanySelected(null)} className="text-xs text-gray-400 hover:text-gray-600">Change</button>
              </div>
            )}
            <div className="flex justify-end gap-2 mt-5">
              <BtnSecondary onClick={() => setLinkCompanyOpen(false)}>Cancel</BtnSecondary>
              <BtnPrimary
                onClick={submitLinkCompany}
                disabled={!linkCompanySelected || linkCompanySubmitting}
              >
                {linkCompanySubmitting ? <Loader2 size={14} className="animate-spin" /> : <Link2 size={14} />}
                Link to {linkCompanySelected?.name || "Company"}
              </BtnPrimary>
            </div>
          </Modal>
        )}

        {/* Link existing order modal */}
        {linkOrderOpen && (
          <Modal title="Link Existing Order" onClose={() => setLinkOrderOpen(false)}>
            <p className="text-xs text-gray-500 mb-4">
              Search for an existing Odoo order to link to this ticket. The ticket stage will advance to match the order's current status.
            </p>

            {/* Order search */}
            <div className="relative mb-3">
              <Search size={14} className="absolute left-3 top-1/2 -translate-y-1/2 text-gray-400 pointer-events-none" />
              <input
                type="text"
                value={linkOrderQuery}
                onChange={e => { setLinkOrderQuery(e.target.value); setLinkOrderSelected(null); }}
                placeholder="Order ref (S00123) or customer name…"
                className="w-full pl-8 pr-8 py-2 text-sm border border-gray-200 rounded-lg focus:outline-none focus:ring-2 focus:ring-bassani-300 bg-white placeholder-gray-400"
                autoFocus
              />
              {linkOrderSearching && (
                <Loader2 size={13} className="absolute right-3 top-1/2 -translate-y-1/2 text-gray-400 animate-spin" />
              )}
            </div>

            {/* Search results */}
            {linkOrderResults.length > 0 && !linkOrderSelected && (
              <div className="border border-gray-200 rounded-xl divide-y divide-gray-100 mb-3 overflow-hidden">
                {linkOrderResults.map(o => (
                  <div key={o.id} className="bg-white">
                    <div className="flex items-center gap-2 px-3 py-2.5 hover:bg-gray-50">
                      <div className="min-w-0 flex-1">
                        <p className="text-sm font-semibold text-gray-900">{o.name}</p>
                        <p className="text-xs text-gray-500 truncate">{o.partner_id?.[1] || "—"}</p>
                      </div>
                      <div className="shrink-0 text-right mr-2">
                        <p className="text-xs font-medium text-gray-700">{fmtR(o.amount_total)}</p>
                        <p className="text-[10px] text-gray-400 mt-0.5">{ORDER_STATE_LABEL[o.state] || o.state}</p>
                      </div>
                      <button
                        onClick={() => previewOrderLines(o)}
                        title={linkOrderPreviewId === o.id ? "Hide lines" : "Preview line items"}
                        className={`shrink-0 flex items-center gap-1 text-xs px-2 py-1 rounded-lg border transition-colors ${
                          linkOrderPreviewId === o.id
                            ? "border-bassani-300 bg-bassani-50 text-bassani-700"
                            : "border-gray-200 text-gray-500 hover:border-bassani-300 hover:text-bassani-600"
                        }`}
                      >
                        {linkOrderPreviewId === o.id ? <ChevronUp size={11} /> : <ChevronDown size={11} />}
                        Lines
                      </button>
                      <button
                        onClick={() => { setLinkOrderSelected(o); setLinkOrderPreview(null); setLinkOrderPreviewId(null); setLinkOrderResults([]); }}
                        className="shrink-0 text-xs px-2.5 py-1 rounded-lg border border-bassani-300 bg-bassani-600 text-white hover:bg-bassani-700 transition-colors"
                      >
                        Select
                      </button>
                    </div>
                    {/* Inline line-item preview */}
                    {linkOrderPreviewId === o.id && (
                      <div className="border-t border-gray-100 bg-gray-50 px-3 py-2">
                        {linkOrderPreview?.loading ? (
                          <div className="flex items-center gap-2 py-2 text-xs text-gray-400">
                            <Loader2 size={12} className="animate-spin" /> Loading lines…
                          </div>
                        ) : linkOrderPreview?.error ? (
                          <p className="text-xs text-red-500 py-1">Could not load lines.</p>
                        ) : linkOrderPreview?.lines?.length === 0 ? (
                          <p className="text-xs text-gray-400 py-1">No line items found.</p>
                        ) : (
                          <table className="w-full text-xs">
                            <thead>
                              <tr className="text-left text-gray-400">
                                <th className="pb-1 font-medium">Product</th>
                                <th className="pb-1 font-medium text-right">Qty</th>
                                <th className="pb-1 font-medium text-right">Unit price</th>
                                <th className="pb-1 font-medium text-right">Subtotal</th>
                              </tr>
                            </thead>
                            <tbody className="divide-y divide-gray-100">
                              {(linkOrderPreview?.lines || []).map(l => (
                                <tr key={l.id}>
                                  <td className="py-1 pr-2 text-gray-700 max-w-[180px] truncate">
                                    {l.product_id?.[1] || l.name}
                                  </td>
                                  <td className="py-1 text-right text-gray-600 tabular-nums">
                                    {l.product_uom_qty}
                                  </td>
                                  <td className="py-1 pl-2 text-right text-gray-600 tabular-nums">
                                    {fmtR(l.price_unit)}
                                  </td>
                                  <td className="py-1 pl-2 text-right font-medium text-gray-800 tabular-nums">
                                    {fmtR(l.price_subtotal)}
                                  </td>
                                </tr>
                              ))}
                            </tbody>
                          </table>
                        )}
                      </div>
                    )}
                  </div>
                ))}
              </div>
            )}

            {/* Selected order confirmation */}
            {linkOrderSelected && (
              <div className="bg-bassani-50 border border-bassani-200 rounded-xl px-4 py-3 mb-4 flex items-start justify-between gap-3">
                <div className="min-w-0">
                  <p className="text-sm font-semibold text-bassani-900">{linkOrderSelected.name}</p>
                  <p className="text-xs text-bassani-700 mt-0.5">{linkOrderSelected.partner_id?.[1] || "—"}</p>
                  <p className="text-xs text-bassani-600 mt-0.5">{ORDER_STATE_LABEL[linkOrderSelected.state] || linkOrderSelected.state} · {fmtR(linkOrderSelected.amount_total)}</p>
                </div>
                <button onClick={() => setLinkOrderSelected(null)} className="text-bassani-400 hover:text-bassani-700 shrink-0 mt-0.5">
                  <XCircle size={15} />
                </button>
              </div>
            )}

            <div className="flex justify-end gap-2 mt-2">
              <BtnSecondary onClick={() => setLinkOrderOpen(false)} disabled={linkOrderSubmitting}>Cancel</BtnSecondary>
              <BtnPrimary onClick={linkOrder} loading={linkOrderSubmitting} disabled={!linkOrderSelected || linkOrderSubmitting}>
                <Link2 size={14} />Link Order
              </BtnPrimary>
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
                                  if (c.id) loadQuoteCustomerContext(c.id);
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
              </div>
              {/* ── Address + Payment Terms row ── */}
              <div className="grid grid-cols-1 md:grid-cols-3 gap-4 mt-4 pt-4 border-t border-gray-100">
                <div>
                  <p className="text-xs font-semibold text-gray-400 uppercase tracking-wide mb-1.5">Invoice Address</p>
                  <Select value={quoteInvoiceId} onChange={e => setQuoteInvoiceId(e.target.value)}>
                    <option value="">Default (same as customer)</option>
                    {quoteAddresses.filter(a => a.type === "invoice" || a.type === "contact").map(a => (
                      <option key={a.id} value={a.id}>{a.name}{a.city ? ` — ${a.city}` : ""}</option>
                    ))}
                  </Select>
                </div>
                <div>
                  <p className="text-xs font-semibold text-gray-400 uppercase tracking-wide mb-1.5">Delivery Address</p>
                  <Select value={quoteShippingId} onChange={e => setQuoteShippingId(e.target.value)}>
                    <option value="">Default (same as customer)</option>
                    {quoteAddresses.filter(a => a.type === "delivery" || a.type === "contact").map(a => (
                      <option key={a.id} value={a.id}>{a.name}{a.city ? ` — ${a.city}` : ""}</option>
                    ))}
                  </Select>
                </div>
                <div>
                  <p className="text-xs font-semibold text-gray-400 uppercase tracking-wide mb-1.5">Payment Terms</p>
                  <Select value={quotePaymentTermId} onChange={e => setQuotePaymentTermId(e.target.value)}>
                    <option value="">Default (from customer profile)</option>
                    {quotePaymentTerms.map(t => (
                      <option key={t.id} value={t.id}>{t.name}</option>
                    ))}
                  </Select>
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
                      isSample={!!quoteTicket?.is_sample}
                    />
                  ))}
                </tbody>
                <tfoot>
                  <tr className="border-t border-gray-50">
                    <td colSpan={7} className="p-2 pl-3">
                      <div className="flex items-center gap-1">
                        <button
                          onClick={addLine}
                          className="flex items-center gap-1.5 text-sm text-bassani-600 hover:text-bassani-700 font-medium px-2 py-1.5 rounded-lg hover:bg-bassani-50 transition-colors"
                        >
                          <Plus size={14} />Add a line
                        </button>
                        <span className="text-gray-200 select-none">|</span>
                        <button
                          onClick={() => setPickerOpen(true)}
                          className="flex items-center gap-1.5 text-sm text-gray-500 hover:text-bassani-700 font-medium px-2 py-1.5 rounded-lg hover:bg-bassani-50 transition-colors"
                        >
                          <Search size={13} />Browse Products
                        </button>
                      </div>
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

        <ProductPickerDrawer
          open={pickerOpen}
          onClose={() => setPickerOpen(false)}
          warehouseId={quoteWarehouseId ? parseInt(quoteWarehouseId) : undefined}
          onAdd={handlePickerAdd}
        />
      </div>
    );
  }


  // ── Filtered ticket list (client-side) ───────────────────────────────────
  const filteredTickets = useMemo(() => tickets.filter(t => {
    if (sourceFilter === "internal" &&  t.reseller_id) return false;
    if (sourceFilter === "external" && !t.reseller_id) return false;
    if (statusFilter.size > 0) {
      const key = t.exit_status ? `exit:${t.exit_status}` : t.status;
      if (!statusFilter.has(key)) return false;
    }
    if (listSearch.trim()) {
      const q = listSearch.trim().toLowerCase();
      if (
        !(t.customer_name         || "").toLowerCase().includes(q) &&
        !(t.customer_company_name || "").toLowerCase().includes(q) &&
        !String(t.order_id        || "").includes(q)
      ) return false;
    }
    return true;
  }), [tickets, sourceFilter, statusFilter, listSearch]);

  // ── List + create modal ───────────────────────────────────────────────────
  return (
    <div className="flex flex-col flex-1 overflow-hidden">
      <TopBar
        title={isReseller ? "My Quotes" : "Sales Tickets"}
        subtitle={isReseller ? "Build, send, and confirm your orders" : "PO/RFQ → Quote → Sale Order → Invoice → Payment → Complete"}
        onRefresh={load}
        actions={
          <div className="flex items-center gap-3">
            <span className="flex items-center gap-1.5 text-xs text-gray-500">
              <span className={`inline-block w-2 h-2 rounded-full ${wsConnected ? "bg-green-500" : "bg-gray-300"}`} />
              {wsConnected ? "Live" : "Reconnecting…"}
            </span>
            {canDrive && !isReseller && (
              <BtnPrimary onClick={openCreate}><Plus size={14} />New Direct Inquiry</BtnPrimary>
            )}
            {isReseller && (
              <BtnPrimary onClick={() => navigate("/orders", { state: { newQuote: true } })}>
                <Plus size={14} />New Quote
              </BtnPrimary>
            )}
          </div>
        }
      />
      <main className="flex-1 overflow-y-auto p-6">
        <div className="mb-4 flex flex-col gap-3">
          <div className="flex items-center gap-3 flex-wrap">
            <SearchBar
              value={listSearch}
              onChange={setListSearch}
              placeholder="Search customer or SO number…"
            />
            {!isReseller && (
              <div className="flex items-center gap-1">
                {[["all", "All"], ["internal", "Internal"], ["external", "Resellers"]].map(([val, label]) => (
                  <FilterPill key={val} label={label} active={sourceFilter === val} onClick={() => setSourceFilter(val)} />
                ))}
              </div>
            )}
            {(listSearch || statusFilter.size > 0 || (!isReseller && sourceFilter !== "all")) && (
              <button
                onClick={() => { setListSearch(""); setStatusFilter(new Set()); setSourceFilter("all"); }}
                className="text-xs text-gray-400 hover:text-gray-600 transition-colors shrink-0"
              >
                Clear filters
              </button>
            )}
            {!loading && (
              <span className="text-xs text-gray-400 ml-auto shrink-0">
                {filteredTickets.length} of {tickets.length} ticket{tickets.length !== 1 ? "s" : ""}
              </span>
            )}
          </div>
          {!loading && tickets.length > 0 && (
            <ChipRow>
              {FORWARD_STATUSES.map(s => (
                <FilterPill
                  key={s}
                  label={STATUS_LABEL[s] || s}
                  active={statusFilter.has(s)}
                  onClick={() => toggleStatus(s)}
                />
              ))}
              <span className="self-center text-gray-200 px-1 shrink-0 select-none">|</span>
              {Object.entries(EXIT_LABEL).map(([k, label]) => (
                <FilterPill
                  key={`exit:${k}`}
                  label={label}
                  active={statusFilter.has(`exit:${k}`)}
                  onClick={() => toggleStatus(`exit:${k}`)}
                />
              ))}
            </ChipRow>
          )}
        </div>
        {loading ? <LoadingState /> : filteredTickets.length === 0 ? (
          tickets.length === 0 && isReseller ? (
            <EmptyState
              icon={ShoppingCart}
              heading="No quotes yet"
              message="When you place a new order it will appear here. Use the New Quote button above to get started."
              action={{ label: "New Quote", onClick: () => navigate("/orders", { state: { newQuote: true } }) }}
            />
          ) : (
            <EmptyState message={tickets.length === 0 ? "No sales tickets yet." : "No tickets match your filters."} />
          )
        ) : (
          <DataTable
            data={filteredTickets}
            onRowClick={openDetail}
            columns={isReseller ? [
              { accessorKey: "customer_name", header: "Patient / Customer", cell: ({ row: { original: t } }) => (
                <p className="font-medium text-gray-900">
                  {t.customer_name}
                  {t.customer_company_name && (
                    <span className="font-normal text-gray-400 ml-1">({t.customer_company_name})</span>
                  )}
                </p>
              )},
              { id: "status", header: "Status", cell: ({ row: { original: t } }) =>
                t.exit_status
                  ? <Badge color={t.exit_status === "complete" ? "green" : "red"}>{R_EXIT_LABEL[t.exit_status] || t.exit_status}</Badge>
                  : <Badge color={R_STATUS_COLOR[t.status] || "gray"}>{R_STATUS_LABEL[t.status] || t.status}</Badge>
              },
              { id: "order_ref", header: "Order Ref", cell: ({ row: { original: t } }) =>
                t.order_name
                  ? <span className="text-xs font-mono text-gray-500">{t.order_name}</span>
                  : t.order_id
                    ? <span className="text-xs font-mono text-gray-500">#{t.order_id}</span>
                    : <span className="text-xs text-gray-300">—</span>
              },
              { accessorKey: "updated_at", header: "Last Updated", cell: ({ row: { original: t } }) =>
                <span className="text-xs text-gray-400">{fmtDate(t.updated_at)}</span>
              },
            ] : [
              { accessorKey: "customer_name", header: "Customer", cell: ({ row: { original: t } }) => (
                <div>
                  <p className="font-medium text-gray-900">
                    {t.customer_name}
                    {t.customer_company_name && (
                      <span className="font-normal text-gray-400 ml-1">({t.customer_company_name})</span>
                    )}
                  </p>
                  <div className="flex flex-wrap items-center gap-1 mt-0.5">
                    {t.is_sample ? (
                      <Badge color="amber">Sample</Badge>
                    ) : t.source === "reseller" ? (
                      <Badge color="purple">Reseller Order</Badge>
                    ) : t.source === "portal" ? (
                      <Badge color="blue">Portal Order</Badge>
                    ) : t.source === "email" ? (
                      <Badge color="gray">Email Inquiry</Badge>
                    ) : (
                      <Badge color="gray">Direct Inquiry</Badge>
                    )}
                    {t.reseller_name && (
                      <span className="text-[11px] text-purple-600 font-medium">{t.reseller_name}</span>
                    )}
                  </div>
                  {t.is_sample && t.sample_recipient_name && (
                    <p className="text-[11px] text-amber-600 mt-0.5">For: {t.sample_recipient_name}</p>
                  )}
                </div>
              )},
              { id: "status", header: "Stage", cell: ({ row: { original: t } }) =>
                t.exit_status
                  ? <Badge color={EXIT_COLOR[t.exit_status]}>{EXIT_LABEL[t.exit_status]}</Badge>
                  : t.odoo_order_state === "cancel"
                    ? (
                      <div className="flex flex-col gap-0.5">
                        <Badge color={STATUS_COLOR[t.status]}>{STATUS_LABEL[t.status] || t.status}</Badge>
                        <Badge color="red"><AlertTriangle size={9} className="inline mr-0.5" />Order Cancelled</Badge>
                      </div>
                    )
                    : <Badge color={STATUS_COLOR[t.status]}>{STATUS_LABEL[t.status] || t.status}</Badge>
              },
              { id: "so_ref", header: "SO #", meta: { className: "hidden md:table-cell" }, cell: ({ row: { original: t } }) =>
                t.order_name
                  ? (
                    <button
                      onClick={e => { e.stopPropagation(); navigate(`/orders/${t.order_id}/passport`); }}
                      className="inline-flex items-center gap-1 text-xs font-mono text-bassani-600 hover:text-bassani-800 hover:underline"
                    >
                      {t.order_name}
                      <ExternalLink size={10} />
                    </button>
                  )
                  : <span className="text-xs text-gray-300">—</span>
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
              <div className="space-y-1.5">
                <div className="flex items-center justify-between bg-bassani-50 border border-bassani-100 rounded-lg px-3 py-2">
                  <div className="flex items-center gap-2">
                    <span className="text-sm font-medium text-bassani-800">{selectedCustomer.name}</span>
                    {selectedCustomer.samples_account && (
                      <span className="text-[10px] font-semibold bg-amber-100 text-amber-700 rounded-full px-2 py-0.5 uppercase tracking-wide">Samples Account</span>
                    )}
                  </div>
                  <button onClick={() => { setSelectedCustomer(null); setSelectedRecipient(null); setSampleRecipientSearch(""); }} className="text-xs text-gray-400 hover:text-gray-600">Change</button>
                </div>
              </div>
            ) : (
              <>
                <Input value={customerSearch} onChange={e => setCustomerSearch(e.target.value)} placeholder="Search customers…" />
                {customerResults.length > 0 && (
                  <div className="mt-1 border border-gray-200 rounded-lg divide-y divide-gray-100 max-h-40 overflow-y-auto">
                    {customerResults.map(c => (
                      <button key={c.id} onClick={() => { setSelectedCustomer(c); setCustomerSearch(""); setCustomerResults([]); }}
                        className="w-full text-left px-3 py-2 text-sm hover:bg-gray-50 transition-colors flex items-center gap-2">
                        <span>{c.name}</span>
                        {c.city && <span className="text-xs text-gray-400">— {c.city}</span>}
                        {c.samples_account && <span className="ml-auto text-[10px] font-semibold bg-amber-100 text-amber-700 rounded-full px-2 py-0.5 uppercase tracking-wide">Samples</span>}
                      </button>
                    ))}
                  </div>
                )}
              </>
            )}
          </FormGroup>

          {selectedCustomer?.samples_account && (
            <FormGroup label="Sample recipient" required>
              <p className="text-xs text-amber-700 bg-amber-50 border border-amber-100 rounded-lg px-3 py-2 mb-2">
                This is a Samples Account. All line items will be priced at R0.00. Select the customer this sample is intended for.
              </p>
              {selectedRecipient ? (
                <div className="flex items-center justify-between bg-green-50 border border-green-100 rounded-lg px-3 py-2">
                  <span className="text-sm font-medium text-green-800">{selectedRecipient.name}</span>
                  <button onClick={() => { setSelectedRecipient(null); setSampleRecipientSearch(""); }} className="text-xs text-gray-400 hover:text-gray-600">Change</button>
                </div>
              ) : (
                <>
                  <Input value={sampleRecipientSearch} onChange={e => setSampleRecipientSearch(e.target.value)} placeholder="Search customers…" />
                  {sampleRecipientResults.length > 0 && (
                    <div className="mt-1 border border-gray-200 rounded-lg divide-y divide-gray-100 max-h-40 overflow-y-auto">
                      {sampleRecipientResults.map(c => (
                        <button key={c.id} onClick={() => { setSelectedRecipient(c); setSampleRecipientSearch(""); setSampleRecipientResults([]); }}
                          className="w-full text-left px-3 py-2 text-sm hover:bg-gray-50 transition-colors">
                          {c.name} {c.city && <span className="text-xs text-gray-400">— {c.city}</span>}
                        </button>
                      ))}
                    </div>
                  )}
                </>
              )}
            </FormGroup>
          )}

          <FormGroup label="Note">
            <Textarea value={createNote} onChange={e => setCreateNote(e.target.value)} rows={2} placeholder="What the PO/RFQ asked for" />
          </FormGroup>
          <div className="flex justify-end gap-2 mt-4">
            <BtnSecondary onClick={() => setCreateModal(false)} disabled={creating}>Cancel</BtnSecondary>
            <BtnPrimary onClick={createTicket} loading={creating}>Create Ticket</BtnPrimary>
          </div>
        </Modal>
      )}
      {exitConfirm && (
        <Modal title="Close Ticket" onClose={() => setExitConfirm(null)}>
          <p className="text-sm text-gray-600">Mark this ticket as <strong>{EXIT_LABEL[exitConfirm]}</strong>? This will close the ticket permanently.</p>
          <div className="flex justify-end gap-2 mt-4">
            <BtnSecondary onClick={() => setExitConfirm(null)}>Cancel</BtnSecondary>
            <BtnDanger onClick={() => doMarkExit(exitConfirm)}>Close Ticket</BtnDanger>
          </div>
        </Modal>
      )}
      {confirmAnywayMsg && (
        <Modal title="Credit Limit Exceeded" onClose={() => setConfirmAnywayMsg(null)}>
          <p className="text-sm text-gray-600 mb-3">{confirmAnywayMsg}</p>
          <p className="text-sm text-gray-500">Confirm the order anyway?</p>
          <div className="flex justify-end gap-2 mt-4">
            <BtnSecondary onClick={() => setConfirmAnywayMsg(null)}>Cancel</BtnSecondary>
            <BtnPrimary onClick={() => { setConfirmAnywayMsg(null); confirmOrder(true, true); }}>Confirm Anyway</BtnPrimary>
          </div>
        </Modal>
      )}
      {cancelQuoteOpen && (
        <Modal title="Cancel Quote" onClose={() => setCancelQuoteOpen(false)}>
          <p className="text-sm text-gray-600">Cancel this quote? The draft order will be cancelled in Odoo and the ticket will be closed.</p>
          <div className="flex justify-end gap-2 mt-4">
            <BtnSecondary onClick={() => setCancelQuoteOpen(false)}>Keep Quote</BtnSecondary>
            <BtnDanger onClick={doCancelQuote}>Cancel Quote</BtnDanger>
          </div>
        </Modal>
      )}
    </div>
  );
}
