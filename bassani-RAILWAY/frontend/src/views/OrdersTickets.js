// ─────────────────────────────────────────────────────────────────────────────
// Orders Tickets view — Phase 8.8
// Full-page detail with strictly linear role-gated pipeline.
// orders_clerk: queued → packing → ready → complete / incomplete
// qa_manager: QA Approve (when ready)
// responsible_pharmacist: RP Approve (when ready)
// tickets.manage: Override Stage
// ─────────────────────────────────────────────────────────────────────────────
import { useState, useEffect, useCallback } from "react";
import { useNavigate, useLocation } from "react-router-dom";
import { useAuth } from "../AuthContext";
import api from "../api";
import toast from "react-hot-toast";
import bwipjs from "bwip-js";
import {
  ShieldCheck, Stethoscope, CheckCircle2, XCircle,
  AlertTriangle, Package, Clock, Truck, RefreshCw, Printer, FileSearch, Monitor,
} from "lucide-react";
import {
  TopBar, DataTable, Modal, FormGroup, Select, Textarea,
  BtnPrimary, BtnSecondary, BtnDanger, Badge, LoadingState, EmptyState, fmtDate,
  OdooPdfViewerModal, openMonitorDisplay,
  AgeTierBadge, AgePriorityStrip,
} from "../components/UI";
import { HorizontalTimelineCard } from "../components/OrderTimeline";

// canvas → PNG data URL so the barcode survives innerHTML → new window print copy
function BarcodeImg({ text, style }) {
  const [src, setSrc] = useState("");
  useEffect(() => {
    if (!text) return;
    const canvas = document.createElement("canvas");
    try {
      bwipjs.toCanvas(canvas, {
        bcid: "code128", text, scale: 2, height: 12,
        includetext: true, textxalign: "center", padding: 2, backgroundcolor: "ffffff",
      });
      setSrc(canvas.toDataURL("image/png"));
    } catch { /* non-fatal */ }
  }, [text]);
  if (!src) return null;
  return <img src={src} alt={text} style={{ display: "block", maxHeight: 52, ...style }} />;
}

const STATUS_LABEL = {
  queued:          "Queued",
  packing:         "Packing In Progress",
  ready:           "Ready for Inspection",
  collected:       "Collected",
  complete:        "Ready for Collection",
  incomplete:      "Incomplete",
  cancelled:       "Cancelled",
  cleared:         "Cleared",
  waiting_stock:   "Waiting for Stock",
};
const STATUS_COLOR = {
  queued: "gray", packing: "blue", ready: "amber", collected: "teal",
  complete: "green", incomplete: "orange", cancelled: "red", cleared: "gray",
  waiting_stock: "amber",
};
const TERMINAL = new Set(["complete", "incomplete", "cancelled", "collected", "cleared"]);
const ALL_STATUSES = ["queued", "packing", "ready", "collected", "complete", "incomplete", "cancelled", "cleared", "waiting_stock"];

export default function OrdersTickets() {
  const navigate = useNavigate();
  const location = useLocation();
  const { can, user } = useAuth();
  const canOrders  = can("tickets.orders");
  const canQa      = can("tickets.qa_approve");
  const canRp      = can("tickets.rp_approve");
  const canManage  = can("tickets.manage");
  const canFinance = can("tickets.finance_confirm");

  // ── List state ──────────────────────────────────────────────────────────────
  const [view, setView]       = useState("list");
  const [entries, setEntries] = useState([]);
  const [loading, setLoading] = useState(true);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const r = await api.get("/api/packing/board");
      // The backend's get_board_state() sorts oldest-first (queued_at
      // ascending) — correct and deliberate for the physical warehouse-
      // floor display it also feeds via WebSocket (packers should tackle
      // the oldest job first), but the opposite of every other admin list
      // in this portal, including Sales Tickets. Re-sorted here, on this
      // page only, rather than changing the shared backend function and
      // risking the floor display's genuinely correct FIFO order
      // (2026-08-26, found live — newest-queued orders were landing at the
      // bottom of this table).
      const sorted = [...(r.data.entries || [])].sort((a, b) =>
        new Date(b.queued_at || 0) - new Date(a.queued_at || 0)
      );
      setEntries(sorted);
    } catch { toast.error("Failed to load orders tickets"); }
    finally { setLoading(false); }
  }, []);
  useEffect(() => { load(); }, [load]);

  // ── Detail state ────────────────────────────────────────────────────────────
  const [detail, setDetail]               = useState(null);
  const [detailLoading, setDetailLoading] = useState(false);
  const [pdfView, setPdfView]             = useState(null); // {url, title} | null — Odoo-native PDF viewer
  const [busyId, setBusyId]               = useState(null);
  const [incompleteModal, setIncompleteModal]   = useState(false);
  const [incompleteReason, setIncompleteReason] = useState("");
  const [overrideStatus, setOverrideStatus]     = useState("");
  const [tickingSkus,  setTickingSkus ] = useState(new Set());
  const [packerInput,  setPackerInput ] = useState("");
  const [savingPacker, setSavingPacker] = useState(false);
  const [itemLots,     setItemLots    ] = useState({});   // { product_id: [{ id, name, expiry }] }
  const [lotSaving,    setLotSaving   ] = useState(null); // product_id being saved
  const [statusFilter, setStatusFilter] = useState(new Set());
  const [mos,        setMos       ] = useState([]);
  const [mosLoading, setMosLoading] = useState(false);
  const [orderLotMap, setOrderLotMap] = useState({});
  const [detailOrder, setDetailOrder] = useState(null);
  const [qtyPackedEdits,  setQtyPackedEdits ] = useState({});  // sku → draft string
  const [qtyPackedSaving, setQtyPackedSaving] = useState(new Set());
  const [purgeConfirm,    setPurgeConfirm   ] = useState(false);
  const [purging,         setPurging        ] = useState(false);

  // Fetch MOs whenever the entry has an order — previously gated on the
  // entry already being a waiting_stock backorder, which meant an MO that
  // exists BEFORE any backorder forms (the common case — Odoo often creates
  // one the moment the sale order confirms) was invisible to the packer/
  // clerk working this ticket, even though the Operations Monitor's
  // has_mo_pending badge already showed it above them (2026-08-23 fix).
  useEffect(() => {
    const orderId = detail?.order_id;
    if (!orderId) { setMos([]); return; }
    setMosLoading(true);
    api.get(`/api/orders/${orderId}/manufacturing-orders`)
      .then(r => setMos(r.data.manufacturing_orders || []))
      .catch(() => setMos([]))
      .finally(() => setMosLoading(false));
  }, [detail?.order_id]);

  // Fetch confirmed lot assignments for on-screen display (done pickings only)
  // — also captures the full order response (2026-08-26) so the shared
  // Order Timeline (below) can read order.state/date_order/invoices without
  // a second fetch.
  useEffect(() => {
    if (!detail?.order_id) { setOrderLotMap({}); setDetailOrder(null); return; }
    api.get(`/api/orders/${detail.order_id}`)
      .then(r => { setOrderLotMap(r.data.lot_map || {}); setDetailOrder(r.data); })
      .catch(() => {});
  }, [detail?.order_id]);

  // picking_id (Odoo's own stock.picking id, unique per delivery) disambiguates
  // which packing_board document an action targets when a backorder and its
  // primary entry share the same order_id (2026-08-23) — omitted, every
  // endpoint below defaults to the primary (non-backorder) entry, so this is
  // a no-op for the overwhelmingly common case of an order with no backorder.
  const openDetail = async (entry) => {
    setDetail(null);
    setDetailLoading(true);
    setView("detail");
    setQtyPackedEdits({});
    try {
      const r = await api.get(`/api/packing/entry/${entry.order_id}${entry.odoo_picking_id ? `?picking_id=${entry.odoo_picking_id}` : ""}`);
      setDetail(r.data);
      setOverrideStatus(r.data.status);
    } catch {
      toast.error("Failed to load order");
      setView("list");
    } finally {
      setDetailLoading(false);
    }
  };

  // Deep-link support (2026-08-26) — SalesTickets.js and OrderPassport.js can
  // now jump straight to a specific Order Ticket instead of dropping staff on
  // the bare list and making them hunt for it. openDetail() only ever needs
  // order_id (optionally odoo_picking_id, omitted here — resolves to the
  // primary entry, the same default every packing_board endpoint already
  // falls back to), so this fires immediately on mount rather than waiting
  // for the board's own list to load first, matching SalesTickets.js's
  // equivalent openTicketId pattern in spirit but simpler since no local
  // match lookup is needed.
  useEffect(() => {
    const targetOrderId = location.state?.openOrderId;
    if (targetOrderId) openDetail({ order_id: targetOrderId, odoo_picking_id: location.state?.openPickingId });
  }, []); // eslint-disable-line

  const refreshDetail = async (order_id, pickingId = detail?.odoo_picking_id) => {
    try {
      const r = await api.get(`/api/packing/entry/${order_id}${pickingId ? `?picking_id=${pickingId}` : ""}`);
      setDetail(r.data);
      setOverrideStatus(r.data.status);
      setPackerInput("");
      setItemLots({});
      setQtyPackedEdits({});
    } catch { toast.error("Failed to refresh order"); }
    load(); // silently refresh list in background
  };

  const act = async (path, order_id, extra = {}) => {
    setBusyId(order_id);
    try {
      await api.put(`/api/packing/${path}`, { order_id, picking_id: detail?.odoo_picking_id, ...extra });
      toast.success("Updated");
      await refreshDetail(order_id);
    } catch (e) { toast.error(e.response?.data?.detail || "Action failed"); }
    finally { setBusyId(null); }
  };

  const handleComplete = async () => {
    setBusyId(detail.order_id);
    try {
      const r = await api.put("/api/packing/complete", { order_id: detail.order_id, picking_id: detail.odoo_picking_id });
      if (r.data.is_partial) {
        toast.success("Partial delivery validated — backorder entry created");
      } else if (r.data.warning) {
        toast.success("Order marked complete");
        toast.error(`Delivery not validated in Odoo: ${r.data.warning}`, { duration: 8000 });
      } else {
        toast.success("Order complete — delivery validated in Odoo");
      }
      load();
      await refreshDetail(detail.order_id);
    } catch (e) { toast.error(e.response?.data?.detail || "Action failed"); }
    finally { setBusyId(null); }
  };

  const handleCollect = async (pickingId = null) => {
    setBusyId(detail.order_id);
    try {
      const r = await api.put("/api/packing/mark-collected", {
        order_id: detail.order_id,
        ...(pickingId ? { picking_id: pickingId } : {}),
      });
      if (r.data.invoice_name) {
        toast.success(`Collected. Invoice ${r.data.invoice_name} created.`);
      } else if (r.data.warning) {
        toast.success("Marked as collected");
        toast.error(`Invoice: ${r.data.warning}`, { duration: 8000 });
      } else {
        toast.success("Marked as collected");
      }
      if (r.data.order_complete) toast.success("All deliveries collected — order complete");
      load();
      await refreshDetail(detail.order_id);
    } catch (e) { toast.error(e.response?.data?.detail || "Action failed"); }
    finally { setBusyId(null); }
  };

  const handleCheckStock = async () => {
    setBusyId("check-stock");
    try {
      const r = await api.get("/api/packing/backorders/check-stock");
      if (r.data.ready > 0) {
        toast.success(`${r.data.ready} backorder${r.data.ready !== 1 ? "s" : ""} now have stock — notifications sent`);
        load();
      } else {
        toast("No backorders have stock available yet", { icon: "ℹ️" });
      }
    } catch (e) { toast.error(e.response?.data?.detail || "Stock check failed"); }
    finally { setBusyId(null); }
  };

  // Recovery action (2026-08-27) for an order that reached "complete" with
  // no final invoice ever created — most commonly the create_invoices()
  // TypeError incident. Backend refuses to run once an invoice already
  // exists, so this can never create a duplicate.
  const retryInvoiceCreation = async () => {
    setBusyId("retry-invoice");
    try {
      const r = await api.put("/api/packing/retry-invoice-creation", { order_id: detail.order_id, picking_id: detail.odoo_picking_id });
      toast.success(`Invoice ${r.data.invoice_name} created`);
      if (r.data.warning) toast.error(r.data.warning, { duration: 8000 });
      await refreshDetail(detail.order_id);
    } catch (e) { toast.error(e.response?.data?.detail || "Invoice creation failed"); }
    finally { setBusyId(null); }
  };

  const submitIncomplete = async () => {
    if (!incompleteReason.trim()) return toast.error("A reason is required");
    setBusyId(detail.order_id);
    try {
      await api.put("/api/packing/incomplete", { order_id: detail.order_id, reason: incompleteReason.trim(), picking_id: detail.odoo_picking_id });
      toast.success("Marked incomplete");
      setIncompleteModal(false);
      setIncompleteReason("");
      await refreshDetail(detail.order_id);
    } catch (e) { toast.error(e.response?.data?.detail || "Action failed"); }
    finally { setBusyId(null); }
  };

  const saveQtyPacked = async (sku, item) => {
    const raw = qtyPackedEdits[sku];
    if (raw === undefined || raw === "") return;
    const val = parseFloat(raw);
    const maxQty = item.qty_reserved ?? item.qty ?? 0;
    if (isNaN(val) || val < 0 || val > maxQty) {
      toast.error(`Qty packed must be between 0 and ${maxQty}`);
      setQtyPackedEdits(prev => { const n = { ...prev }; delete n[sku]; return n; });
      return;
    }
    setQtyPackedSaving(prev => new Set(prev).add(sku));
    try {
      await api.put("/api/packing/update-item-qty", { order_id: detail.order_id, sku, qty_packed: val, picking_id: detail.odoo_picking_id });
      setQtyPackedEdits(prev => { const n = { ...prev }; delete n[sku]; return n; });
      await refreshDetail(detail.order_id);
    } catch (e) {
      toast.error(e.response?.data?.detail || "Failed to save qty");
    } finally {
      setQtyPackedSaving(prev => { const n = new Set(prev); n.delete(sku); return n; });
    }
  };

  const submitOverride = async () => {
    setBusyId(detail.order_id);
    try {
      await api.put("/api/packing/override-status", { order_id: detail.order_id, status: overrideStatus, picking_id: detail.odoo_picking_id });
      toast.success("Stage overridden");
      await refreshDetail(detail.order_id);
    } catch (e) { toast.error(e.response?.data?.detail || "Override failed"); }
    finally { setBusyId(null); }
  };

  // ── Item tick ───────────────────────────────────────────────────────────────
  const toggleTick = async (sku, currentlyTicked) => {
    if (!detail || tickingSkus.has(sku)) return;
    setTickingSkus(s => new Set(s).add(sku));
    // Optimistic update
    setDetail(d => ({ ...d, item_ticks: { ...d.item_ticks, [sku]: !currentlyTicked } }));
    try {
      await api.put(`/api/packing/tick?order_id=${encodeURIComponent(detail.order_id)}&sku=${encodeURIComponent(sku)}&ticked=${!currentlyTicked}${detail.odoo_picking_id ? `&picking_id=${detail.odoo_picking_id}` : ""}`);
    } catch (e) {
      // Revert on failure
      setDetail(d => ({ ...d, item_ticks: { ...d.item_ticks, [sku]: currentlyTicked } }));
      toast.error(e.response?.data?.detail || "Failed to update item");
    } finally {
      setTickingSkus(s => { const n = new Set(s); n.delete(sku); return n; });
    }
  };

  // ── Packer assignment ───────────────────────────────────────────────────────
  const savePacker = async () => {
    if (!packerInput.trim() || !detail) return;
    setSavingPacker(true);
    try {
      await api.put("/api/packing/assign-packer", { order_id: detail.order_id, packer_name: packerInput.trim(), picking_id: detail.odoo_picking_id });
      toast.success("Packer assigned");
      await refreshDetail(detail.order_id);
      setPackerInput("");
    } catch (e) { toast.error(e.response?.data?.detail || "Failed to assign packer"); }
    finally { setSavingPacker(false); }
  };

  // ── Lot assignment per item ─────────────────────────────────────────────────
  const fetchLotsForItem = async (productId) => {
    if (!productId || itemLots[productId]) return;
    try {
      const { data } = await api.get(`/api/products/${productId}/lots`);
      setItemLots(prev => ({ ...prev, [productId]: data.lots || [] }));
    } catch { setItemLots(prev => ({ ...prev, [productId]: [] })); }
  };
  const assignLot = async (productId, lotId) => {
    if (!lotId || !detail) return;
    setLotSaving(productId);
    try {
      const { data } = await api.put("/api/packing/assign-lot", {
        order_id: detail.order_id,
        product_id: productId,
        lot_id: parseInt(lotId),
        picking_id: detail.odoo_picking_id,
      });
      toast.success(`Batch ${data.lot_name} assigned`);
    } catch (e) { toast.error(e.response?.data?.detail || "Failed to assign lot"); }
    finally { setLotSaving(null); }
  };


  const doPurgeOrder = async () => {
    setPurgeConfirm(false);
    setPurging(true);
    try {
      const r = await api.delete("/api/packing/purge", { data: { order_id: detail.order_id } });
      const { purged, order_id, customer_name } = r.data;
      toast.success(`Purged: ${customer_name || order_id} — ${purged.packing_board} packing entr${purged.packing_board === 1 ? "y" : "ies"}${purged.ticket ? ", 1 sales ticket" : ""}, ${purged.audit_logs} audit logs`);
      setDetail(null); setView("list"); load();
    } catch (e) {
      toast.error(e.response?.data?.detail || "Purge failed");
    } finally {
      setPurging(false);
    }
  };

  // ── Detail — full-page view ─────────────────────────────────────────────────
  if (view === "detail") {
    const isTerminal   = detail ? TERMINAL.has(detail.status) : false;
    const bothApproved = !!(detail?.qa_approved_at && detail?.rp_approved_at);

    // ── Next Step (2026-08-26) — every role-gated primary action this page
    // can offer collapses into one computed action, same pattern as
    // SalesTickets.js's own Next Step hero, rather than up to six stacked
    // cards (one per role/status combination) all fighting for attention.
    // `waitingText` covers the case where something is genuinely next, just
    // not for the viewer's own role, or nothing further is needed at all.
    let nextAction = null;
    let waitingText = null;
    if (detail) {
      if (detail.status === "queued") {
        if (canOrders) {
          nextAction = {
            label: "Mark as Packing", icon: Package,
            onClick: () => act("mark-packing", detail.order_id),
            desc: "Assign a packer above, then move to active packing. The floor board will update.",
          };
        } else {
          waitingText = "Queued for packing.";
        }
      } else if (detail.status === "packing") {
        if (canOrders) {
          nextAction = {
            label: "Mark as Ready", icon: CheckCircle2,
            onClick: () => act("mark-ready", detail.order_id),
            desc: "Once the packer has reported back and all items are ticked, move to Ready for QA and RP inspection.",
          };
        } else {
          waitingText = "Currently being packed.";
        }
      } else if (detail.status === "ready") {
        if (canQa && !detail.qa_approved_at) {
          nextAction = {
            label: "QA Approve", icon: ShieldCheck,
            onClick: () => act("qa-approve", detail.order_id),
            desc: "Review the packed order and confirm QA sign-off.",
          };
        } else if (canRp && !detail.rp_approved_at) {
          nextAction = {
            label: "RP Approve", icon: Stethoscope,
            onClick: () => act("rp-approve", detail.order_id),
            desc: "Review and provide Responsible Pharmacist sign-off.",
          };
        } else if (!bothApproved) {
          waitingText = "Waiting for QA and RP to approve before this order can be completed.";
        } else if (canOrders) {
          nextAction = {
            label: "Mark Complete", icon: CheckCircle2, onClick: handleComplete,
            desc: "Both QA and RP have signed off. Complete this order.",
          };
        } else {
          waitingText = "Packed and approved. Waiting for an Orders Clerk to mark this order complete.";
        }
      } else if (detail.status === "complete" && !detail.collected_at) {
        if (canOrders) {
          nextAction = {
            label: "Mark as Collected", icon: Truck,
            onClick: () => handleCollect(detail.odoo_picking_id || null),
            desc: detail.has_pending_invoice
              ? "Customer has collected this delivery. Marking as collected will create the invoice in Odoo for the items delivered."
              : "Confirm the customer has collected this order.",
          };
        } else {
          waitingText = "Ready for collection.";
        }
      } else if (detail.status === "complete" && detail.collected_at) {
        waitingText = `Collected ${fmtDate(detail.collected_at)} by ${detail.collected_by}${detail.invoice_name ? ` · Invoice ${detail.invoice_name}` : ""}.`;
      } else if (detail.status === "waiting_stock") {
        if (canOrders) {
          nextAction = {
            label: "Check Stock Availability", icon: RefreshCw, onClick: handleCheckStock,
            desc: "This is a backorder. Check whether stock has become available in Odoo.",
          };
        } else {
          waitingText = "Backorder, awaiting stock reservation in Odoo.";
        }
      }
    }

    return (
      <div className="flex flex-col flex-1 overflow-hidden bg-slate-50">
        <TopBar
          title={detail?.customer_name || "Loading…"}
          subtitle={detail ? `${detail.ps_num} — ${STATUS_LABEL[detail.status] || detail.status}` : ""}
          actions={
            <div className="flex items-center gap-2">
              {detail && detail.order_id && detail.odoo_picking_id && (
                <BtnSecondary
                  onClick={() => setPdfView({ url: `/api/orders/${detail.order_id}/deliveries/${detail.odoo_picking_id}/pdf`, title: `${detail.dn_num || detail.ps_num} — Odoo original` })}
                >
                  <Printer size={14} /> Print Packing Slip
                </BtnSecondary>
              )}
              <BtnSecondary onClick={() => { setDetail(null); setView("list"); }}>
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

              {/* Invoice creation failure banner (2026-08-27) — persistent,
                  not just a one-off toast, so an order stuck at "complete"
                  with no invoice (e.g. the create_invoices() TypeError
                  incident) stays visibly flagged until retried. Gated on
                  status + missing invoice_id, NOT on invoice_creation_error
                  being set (fixed same day, found live) — an order that
                  completed before this error-persistence code even existed
                  has no invoice_creation_error stored at all, only a
                  now-long-gone one-off toast, so gating on that field alone
                  left genuinely broken older orders with no banner and no
                  way to retry. invoice_creation_error is shown when present,
                  but its absence is never treated as "nothing's wrong."
                  Deliberately outside the (!isTerminal || complete) gate the
                  rest of the action area sits inside, since this can matter
                  even once the order has moved on to "collected". */}
              {["complete", "collected"].includes(detail.status) && !detail.invoice_id && (
                <div className="mb-4 bg-red-50 border border-red-200 rounded-2xl p-4 flex items-start justify-between gap-4 flex-wrap">
                  <div className="flex items-start gap-2">
                    <AlertTriangle size={16} className="text-red-500 mt-0.5 shrink-0" />
                    <div>
                      <p className="text-sm font-semibold text-red-700">No invoice was created for this order</p>
                      <p className="text-xs text-red-600 mt-0.5">
                        {detail.invoice_creation_error || "No error was recorded (this order likely completed before failure tracking was added) — click Retry to create it now."}
                      </p>
                    </div>
                  </div>
                  {(canOrders || canFinance) && (
                    <BtnSecondary
                      onClick={retryInvoiceCreation}
                      loading={busyId === "retry-invoice"}
                      className="text-red-700 border-red-200 hover:bg-red-100 shrink-0"
                    >
                      <RefreshCw size={13} />Retry Invoice Creation
                    </BtnSecondary>
                  )}
                </div>
              )}

              {/* Order Timeline (2026-08-26) — full width, same placement
                  OrderPassport.js and SalesTickets.js already use for this
                  shared component, rather than squeezed into the 1/3-width
                  sidebar column below. `ticket` is synthesized rather than
                  fetched: a packing_board entry existing at all already
                  guarantees (8.47's universal deposit gate) the linked
                  ticket is at confirmed_wip with no exit_status, so this is
                  accurate, not a guess. */}
              <div className="mb-4">
                <HorizontalTimelineCard
                  order={detailOrder || { state: "sale", date_order: detail.queued_at }}
                  ticket={{ status: "confirmed_wip", exit_status: null, incomplete_reason: null }}
                  packing={detail}
                  invoices={detailOrder?.invoices || []}
                  manufacturing_orders={mos}
                />
              </div>

              <div className="grid grid-cols-1 lg:grid-cols-3 gap-6 items-start">

                {/* ── Left: Order document ── */}
                <div className="lg:col-span-2 space-y-4">
                  <div className="bg-white rounded-2xl shadow-sm border border-gray-100 overflow-hidden">

                    {/* Document header */}
                    <div className="p-6 border-b border-gray-100">
                      <div className="flex items-start justify-between mb-5">
                        <div>
                          <h2 className="text-2xl font-bold tracking-tight text-gray-900 flex items-center gap-2">
                            {(STATUS_LABEL[detail.status] || detail.status).toUpperCase()}
                            {detail.is_backorder && (
                              <span className="text-[11px] font-semibold text-amber-700 bg-amber-100 rounded px-2 py-0.5 align-middle">
                                Backorder
                              </span>
                            )}
                          </h2>
                          <p className="text-sm font-mono text-gray-400 mt-0.5 flex items-center gap-2">
                            {detail.ps_num}
                            {detail.order_id && (
                              <button
                                onClick={() => setPdfView({ url: `/api/orders/${detail.order_id}/quote-pdf`, title: `${detail.ps_num} — Odoo original` })}
                                className="flex items-center gap-0.5 text-[11px] font-sans font-semibold text-bassani-600 hover:text-bassani-700"
                              >
                                <FileSearch size={11} />View
                              </button>
                            )}
                          </p>
                        </div>
                        <div className="text-right">
                          <Badge color={STATUS_COLOR[detail.status]}>{STATUS_LABEL[detail.status] || detail.status}</Badge>
                          <p className="text-xs text-gray-400 mt-1.5">Queued {fmtDate(detail.queued_at)}</p>
                          {detail.ps_num && <BarcodeImg text={detail.ps_num} style={{ marginLeft: "auto", marginTop: 8 }} />}
                        </div>
                      </div>

                      <div className="grid grid-cols-1 sm:grid-cols-2 gap-6 pt-4 border-t border-gray-50">
                        <div>
                          <p className="text-xs font-semibold text-gray-400 uppercase tracking-wide mb-1.5">Customer</p>
                          <p className="text-sm font-semibold text-gray-900">{detail.customer_name}</p>
                          {detail.customer_city && (
                            <p className="text-xs text-gray-400 mt-0.5">{detail.customer_city}</p>
                          )}
                          {detail.reseller_name && (
                            <p className="text-xs text-purple-600 font-medium mt-0.5">via {detail.reseller_name}</p>
                          )}
                        </div>
                        <div className="space-y-1.5">
                          {detail.inv_num && (
                            <div className="flex justify-between items-center text-xs">
                              <span className="text-gray-400 uppercase font-semibold tracking-wide">Invoice</span>
                              <span className="flex items-center gap-2">
                                <span className="font-mono text-gray-700">{detail.inv_num}</span>
                                {detail.invoice_id && (
                                  <button
                                    onClick={() => setPdfView({ url: `/api/invoices/${detail.invoice_id}/pdf`, title: `${detail.inv_num} — Odoo original` })}
                                    className="flex items-center gap-0.5 text-bassani-600 hover:text-bassani-700 font-semibold"
                                  >
                                    <FileSearch size={11} />View
                                  </button>
                                )}
                              </span>
                            </div>
                          )}
                          {detail.dn_num && (
                            <div className="flex justify-between items-center text-xs">
                              <span className="text-gray-400 uppercase font-semibold tracking-wide">DN</span>
                              <span className="flex items-center gap-2">
                                <span className="font-mono text-gray-700">{detail.dn_num}</span>
                                {detail.order_id && detail.odoo_picking_id && (
                                  <button
                                    onClick={() => setPdfView({ url: `/api/orders/${detail.order_id}/deliveries/${detail.odoo_picking_id}/pdf`, title: `${detail.dn_num} — Odoo original` })}
                                    className="flex items-center gap-0.5 text-bassani-600 hover:text-bassani-700 font-semibold"
                                  >
                                    <FileSearch size={11} />View
                                  </button>
                                )}
                              </span>
                            </div>
                          )}
                          <div className="flex justify-between items-center text-xs gap-2">
                            <span className="text-gray-400 uppercase font-semibold tracking-wide shrink-0">Packer</span>
                            {canOrders && !isTerminal ? (
                              <div className="flex items-center gap-1">
                                <input
                                  value={packerInput || detail.packer_name || ""}
                                  onChange={e => setPackerInput(e.target.value)}
                                  onBlur={savePacker}
                                  onKeyDown={e => e.key === "Enter" && savePacker()}
                                  placeholder="Assign packer…"
                                  className="text-xs border border-gray-200 rounded px-2 py-0.5 w-28 focus:outline-none focus:ring-1 focus:ring-bassani-400 text-right"
                                  disabled={savingPacker}
                                />
                                {savingPacker && <span className="text-[10px] text-gray-400">…</span>}
                              </div>
                            ) : (
                              <span className="font-medium text-gray-700">{detail.packer_name || "—"}</span>
                            )}
                          </div>
                          <div className="flex justify-between text-xs">
                            <span className="text-gray-400 uppercase font-semibold tracking-wide">Warehouse</span>
                            <span className="font-medium text-gray-700">{detail.warehouse_name || "—"}</span>
                          </div>
                        </div>
                      </div>
                    </div>

                    {/* Items table */}
                    <div className="overflow-x-auto">
                    <table className="w-full">
                      <thead>
                        <tr className="border-b border-gray-100 bg-slate-50/50">
                          <th className="text-left p-3 pl-6 text-xs font-semibold text-gray-400 uppercase tracking-wide">Item</th>
                          <th className="text-center p-3 text-xs font-semibold text-gray-400 uppercase tracking-wide w-20">Ordered</th>
                          <th className="text-center p-3 text-xs font-semibold text-gray-400 uppercase tracking-wide w-20">Reserved</th>
                          {canOrders && !isTerminal && (
                            <th className="text-center p-3 text-xs font-semibold text-gray-400 uppercase tracking-wide w-24">Qty Packed</th>
                          )}
                          {canOrders && !isTerminal && (
                            <th className="text-left p-3 text-xs font-semibold text-gray-400 uppercase tracking-wide">Batch / Lot</th>
                          )}
                          <th className="text-center p-3 pr-6 text-xs font-semibold text-gray-400 uppercase tracking-wide w-20">Packed</th>
                        </tr>
                      </thead>
                      <tbody>
                        {(detail.items || []).map((item, i) => {
                          const ticked = detail.item_ticks?.[item.sku];
                          const isBackordered = item.is_backordered;
                          const isPacking = detail.status === "packing";
                          const canTick = canOrders && isPacking && item.sku;
                          const lots = item.product_id ? (itemLots[item.product_id] || null) : null;
                          return (
                            <tr key={i} className={`border-b border-gray-50 hover:bg-slate-50/30 ${isBackordered ? "bg-amber-50/40" : ""}`}>
                              <td className="p-3 pl-6">
                                <div className="flex items-center gap-2">
                                  <p className="text-sm font-medium text-gray-900">{item.name || item.description || item.sku}</p>
                                  {isBackordered && (
                                    <span className="text-[10px] font-semibold text-amber-600 bg-amber-100 rounded px-1.5 py-0.5 shrink-0">Backorder</span>
                                  )}
                                </div>
                                {item.sku && (
                                  <p className="text-[10px] font-mono text-gray-400 mt-0.5">{item.sku}</p>
                                )}
                              </td>
                              <td className="p-3 text-center text-sm text-gray-600">
                                {item.qty_ordered ?? item.qty ?? item.product_uom_qty ?? "—"}
                              </td>
                              <td className="p-3 text-center text-sm">
                                {item.qty_reserved != null
                                  ? <span className={item.is_backordered ? "text-amber-600 font-medium" : "text-gray-600"}>{item.qty_reserved}</span>
                                  : <span className="text-gray-300">—</span>}
                              </td>
                              {canOrders && !isTerminal && (
                                <td className="p-3 text-center">
                                  {isBackordered ? (
                                    <span className="text-gray-300 text-sm">—</span>
                                  ) : (
                                    <div className="flex flex-col items-center gap-0.5">
                                      <input
                                        type="number"
                                        min={0}
                                        max={item.qty_reserved ?? item.qty ?? 0}
                                        step={1}
                                        value={
                                          qtyPackedEdits[item.sku] !== undefined
                                            ? qtyPackedEdits[item.sku]
                                            : (item.qty_packed ?? item.qty_reserved ?? item.qty ?? "")
                                        }
                                        onChange={e => setQtyPackedEdits(prev => ({ ...prev, [item.sku]: e.target.value }))}
                                        onBlur={() => saveQtyPacked(item.sku, item)}
                                        onKeyDown={e => e.key === "Enter" && saveQtyPacked(item.sku, item)}
                                        disabled={!isPacking || qtyPackedSaving.has(item.sku) || !item.sku}
                                        className="w-16 text-center text-sm border border-gray-200 rounded px-1 py-0.5 focus:outline-none focus:ring-1 focus:ring-bassani-400 disabled:opacity-40"
                                      />
                                      {item.qty_packed != null && item.qty_packed < (item.qty_reserved ?? item.qty ?? 0) && qtyPackedEdits[item.sku] === undefined && (
                                        <span className="text-[10px] text-amber-600 font-medium">
                                          Short {(item.qty_reserved ?? item.qty ?? 0) - item.qty_packed}
                                        </span>
                                      )}
                                    </div>
                                  )}
                                </td>
                              )}
                              {canOrders && !isTerminal && (
                                <td className="p-3 text-sm min-w-[160px]">
                                  {item.product_id ? (
                                    orderLotMap[item.product_id]?.length > 0 ? (
                                      // Confirmed batch from a done picking — always show
                                      <span className="font-mono text-[11px] text-bassani-700 font-medium">
                                        {orderLotMap[item.product_id].join(", ")}
                                      </span>
                                    ) : isPacking ? (
                                      // Lot selection only available while actively packing
                                      lots === null ? (
                                        <button
                                          onClick={() => fetchLotsForItem(item.product_id)}
                                          className="text-[10px] text-bassani-600 hover:underline"
                                        >
                                          Load batches
                                        </button>
                                      ) : lots.length === 0 ? (
                                        <span className="text-[10px] text-gray-300">No stock lots</span>
                                      ) : (
                                        <div className="flex items-center gap-1.5">
                                          <Select
                                            value=""
                                            onChange={e => assignLot(item.product_id, e.target.value)}
                                            className="text-xs py-0.5 pr-6"
                                            disabled={lotSaving === item.product_id}
                                          >
                                            <option value="">Select batch…</option>
                                            {lots.map(l => (
                                              <option key={l.id} value={l.id}>
                                                {l.name}{l.expiry ? ` · ${l.expiry.split("T")[0]}` : ""}
                                              </option>
                                            ))}
                                          </Select>
                                          {lotSaving === item.product_id && (
                                            <span className="text-[10px] text-gray-400">Saving…</span>
                                          )}
                                        </div>
                                      )
                                    ) : (
                                      <span className="text-[10px] text-gray-300">—</span>
                                    )
                                  ) : (
                                    <span className="text-[10px] text-gray-300">—</span>
                                  )}
                                </td>
                              )}
                              <td className="p-3 pr-6 text-center">
                                {canTick ? (
                                  <button
                                    onClick={() => toggleTick(item.sku, ticked)}
                                    disabled={tickingSkus.has(item.sku)}
                                    className="mx-auto block disabled:opacity-50"
                                    title={ticked ? "Mark as not packed" : "Mark as packed"}
                                  >
                                    {ticked
                                      ? <CheckCircle2 size={16} className="text-green-500" />
                                      : <XCircle size={16} className="text-gray-300 hover:text-gray-400" />}
                                  </button>
                                ) : (
                                  ticked
                                    ? <CheckCircle2 size={16} className="text-green-500 mx-auto" />
                                    : <XCircle size={16} className="text-gray-200 mx-auto" />
                                )}
                              </td>
                            </tr>
                          );
                        })}
                      </tbody>
                    </table>
                    </div>

                    {/* Notes / incomplete reason */}
                    {(detail.notes || detail.incomplete_reason) && (
                      <div className="p-6 border-t border-gray-100 space-y-3">
                        {detail.notes && (
                          <div>
                            <p className="text-xs font-semibold text-gray-400 uppercase tracking-wide mb-1">Notes</p>
                            <p className="text-sm text-gray-600">{detail.notes}</p>
                          </div>
                        )}
                        {detail.incomplete_reason && (
                          <div className="flex items-start gap-2 bg-amber-50 border border-amber-100 rounded-xl p-3">
                            <AlertTriangle size={14} className="text-amber-500 mt-0.5 shrink-0" />
                            <div>
                              <p className="text-xs font-semibold text-amber-700">Packing issue reported</p>
                              <p className="text-sm text-amber-600 mt-0.5">{detail.incomplete_reason}</p>
                            </div>
                          </div>
                        )}
                      </div>
                    )}
                  </div>
                </div>

                {/* ── Right sidebar ── */}
                <div className="space-y-4">

                  {/* Next Step (2026-08-26) — the single computed primary
                      action for this page, replacing what used to be up to
                      six separately-colored role-gated cards stacked on top
                      of each other. Same pattern as SalesTickets.js's own
                      Next Step hero. Rendered under the same "complete still
                      counts as active" gate the old action stack used, since
                      Mark as Collected still needs to show at that stage. */}
                  {(!isTerminal || detail.status === "complete") && (
                    <div className="bg-white rounded-2xl shadow-sm border-2 border-bassani-100 p-4 space-y-2">
                      <div className="flex items-center justify-between gap-2">
                        <p className="text-xs font-semibold text-bassani-600 uppercase tracking-wide flex items-center gap-1.5">
                          <Clock size={12} />Next Step
                        </p>
                        <AgeTierBadge tier={detail.age_tier} />
                      </div>
                      {nextAction ? (
                        <>
                          <p className="text-xs text-gray-500">{nextAction.desc}</p>
                          <BtnPrimary
                            onClick={nextAction.onClick}
                            loading={busyId === detail.order_id || busyId === "check-stock"}
                            className="w-full justify-center mt-1"
                          >
                            <nextAction.icon size={13} />{nextAction.label}
                          </BtnPrimary>
                        </>
                      ) : (
                        <p className="text-xs text-gray-500 flex items-center gap-1.5">
                          {waitingText || "No action needed right now."}
                        </p>
                      )}
                    </div>
                  )}

                  {/* Sign-Off Detail — the full-width timeline above merges
                      QA+RP into a single "Compliance Sign-Off" node and only
                      ever keeps one approver's name, which isn't enough for
                      a compliance-adjacent record where QA and RP are always
                      two different people. Kept as its own compact card,
                      same reasoning as SalesTickets.js's "Packing Detail"
                      card alongside its own copy of this timeline. */}
                  <div className="bg-white rounded-2xl shadow-sm border border-gray-100 divide-y divide-gray-100">
                    {detail.total_units != null && (
                      <div className="px-4 py-2.5 flex items-center justify-between gap-3">
                        <span className="text-xs text-gray-400">Units</span>
                        <span className="text-xs text-gray-600 font-medium">{detail.total_units}</span>
                      </div>
                    )}
                    <div className="px-4 py-2.5 flex items-center justify-between gap-3">
                      <span className="text-xs text-gray-500 flex items-center gap-1.5 shrink-0">
                        <ShieldCheck size={13} />QA
                      </span>
                      {detail.qa_approved_at
                        ? <span className="text-xs text-green-600 text-right">{detail.qa_approved_by} — {fmtDate(detail.qa_approved_at)}</span>
                        : <span className="text-xs text-gray-400">Pending</span>}
                    </div>
                    <div className="px-4 py-2.5 flex items-center justify-between gap-3">
                      <span className="text-xs text-gray-500 flex items-center gap-1.5 shrink-0">
                        <Stethoscope size={13} />RP
                      </span>
                      {detail.rp_approved_at
                        ? <span className="text-xs text-green-600 text-right">{detail.rp_approved_by} — {fmtDate(detail.rp_approved_at)}</span>
                        : <span className="text-xs text-gray-400">Pending</span>}
                    </div>
                    {detail.status === "complete" && detail.delivery_validated != null && (
                      <div className="px-4 py-2.5 flex items-center gap-1.5">
                        <Truck size={12} className={detail.delivery_validated ? "text-green-400 shrink-0" : "text-amber-400 shrink-0"} />
                        <span className={`text-xs font-medium ${detail.delivery_validated ? "text-green-600" : "text-amber-600"}`}>
                          {detail.delivery_validated ? "Delivery validated in Odoo" : "Delivery not validated in Odoo"}
                        </span>
                      </div>
                    )}
                  </div>

                  {/* Secondary / less-frequent actions */}
                  {(!isTerminal || detail.status === "complete") && (
                    <div className="space-y-3">

                      {/* orders_clerk: report packing issue (packing or ready) */}
                      {canOrders && ["packing", "ready"].includes(detail.status) && (
                        <div className="bg-white rounded-2xl shadow-sm border border-gray-100 p-4">
                          <p className="text-xs text-gray-400 mb-3">
                            For stock shortfalls, use the Qty Packed column above. Use this only when the entire order cannot proceed — damaged goods, wrong products received, or a QA failure.
                          </p>
                          <BtnSecondary
                            onClick={() => { setIncompleteReason(""); setIncompleteModal(true); }}
                            className="w-full justify-center text-amber-600 border-amber-200 hover:bg-amber-50"
                          >
                            <AlertTriangle size={13} />Report Packing Issue
                          </BtnSecondary>
                        </div>
                      )}

                      {/* Production Status — any MO linked to this order, shown as soon as
                          one exists (2026-08-23), not just once it's already caused a
                          backorder. Standalone now (previously nested inside, and only
                          ever fetched for, the waiting_stock panel below) so a packer
                          working a queued/packing entry can see it too. */}
                      {(mosLoading || mos.length > 0) && (
                        <div className="bg-white rounded-2xl shadow-sm border border-gray-100 p-4 space-y-2">
                          <p className="text-xs font-semibold text-gray-500 uppercase tracking-wide flex items-center gap-1.5">
                            <Package size={12} />Production Status
                          </p>
                          {mosLoading ? (
                            <p className="text-xs text-gray-400">Loading production orders...</p>
                          ) : mos.map(mo => {
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

                      {/* Waiting stock — backorder entry info. The "Check stock
                          availability" action itself now lives in the Next
                          Step hero above (same status, canOrders-gated), so
                          this card is informational only. */}
                      {detail.status === "waiting_stock" && (
                        <div className="bg-amber-50 border border-amber-100 rounded-2xl p-4">
                          <div className="flex items-start gap-2">
                            <AlertTriangle size={14} className="text-amber-500 mt-0.5 shrink-0" />
                            <div>
                              <p className="text-xs font-semibold text-amber-800">Awaiting stock reservation</p>
                              <p className="text-xs text-amber-700 mt-0.5">
                                This is a backorder. The items below will be fulfilled when stock becomes available in Odoo.
                              </p>
                            </div>
                          </div>
                        </div>
                      )}

                      {/* Override stage (tickets.manage only) */}
                      {canManage && (
                        <div className="bg-white rounded-2xl shadow-sm border border-gray-100 p-4 space-y-3">
                          <p className="text-xs font-semibold text-gray-400 uppercase tracking-wide">Override Stage</p>
                          <FormGroup label="Stage">
                            <Select value={overrideStatus} onChange={e => setOverrideStatus(e.target.value)}>
                              {ALL_STATUSES.map(s => (
                                <option key={s} value={s}>{STATUS_LABEL[s]}</option>
                              ))}
                            </Select>
                          </FormGroup>
                          <BtnPrimary
                            onClick={submitOverride}
                            loading={busyId === detail.order_id}
                            className="w-full justify-center"
                          >
                            Save
                          </BtnPrimary>
                        </div>
                      )}
                    </div>
                  )}

                  {/* Danger Zone (super_admin only) — moved out of the TopBar
                      (2026-08-26) to sit with the other secondary/destructive
                      actions, and deliberately NOT inside the isTerminal gate
                      above: purging test data is most useful on exactly the
                      broken/terminal entries that gate hides everything else
                      for. */}
                  {user?.is_super_admin && (
                    <div className="bg-white rounded-2xl shadow-sm border border-red-100 p-4 space-y-2">
                      <p className="text-xs font-semibold text-red-400 uppercase tracking-wide">Danger Zone</p>
                      <BtnDanger
                        onClick={() => setPurgeConfirm(true)}
                        disabled={purging}
                        className="w-full justify-center"
                      >
                        {purging ? "Purging…" : "Purge Test Data"}
                      </BtnDanger>
                    </div>
                  )}
                </div>
              </div>
            </div>
          </main>
        )}

        {/* Packing issue modal overlays the detail page */}
        {incompleteModal && (
          <Modal title="Report a Packing Issue" onClose={() => setIncompleteModal(false)}>
            <p className="text-xs text-gray-500 mb-4">
              This will halt the order and notify Sales so they can follow up with the client. Use this for issues that prevent the order from proceeding — not for simple qty shortfalls (use the Qty Packed column for those).
            </p>
            <FormGroup label="Reason" required>
              <Textarea
                value={incompleteReason}
                onChange={e => setIncompleteReason(e.target.value)}
                rows={3}
                placeholder="e.g. Item X out of stock — awaiting restock from supplier"
                autoFocus
              />
            </FormGroup>
            <div className="flex justify-end gap-2 mt-4">
              <BtnSecondary onClick={() => setIncompleteModal(false)}>Cancel</BtnSecondary>
              <BtnDanger onClick={submitIncomplete} loading={busyId === detail?.order_id}>
                Confirm Issue
              </BtnDanger>
            </div>
          </Modal>
        )}
        {purgeConfirm && (
          <Modal title="Purge Test Data" onClose={() => setPurgeConfirm(false)}>
            <p className="text-sm text-gray-700 font-medium mb-2">
              Permanently delete this packing entry and all traces of it from the database.
            </p>
            <ul className="text-sm text-gray-600 list-disc list-inside space-y-1 mb-3">
              <li>All packing board entries for order {detail.order_id} (including backorders)</li>
              <li>Linked sales ticket (if any)</li>
              <li>All audit log records for the above</li>
            </ul>
            <p className="text-xs text-red-600 font-medium">This cannot be undone. Use only for test data cleanup.</p>
            <div className="flex justify-end gap-2 mt-4">
              <BtnSecondary onClick={() => setPurgeConfirm(false)}>Cancel</BtnSecondary>
              <BtnDanger onClick={doPurgeOrder}>Permanently Delete</BtnDanger>
            </div>
          </Modal>
        )}
        {pdfView && (
          <OdooPdfViewerModal url={pdfView.url} title={pdfView.title} onClose={() => setPdfView(null)} />
        )}
      </div>
    );
  }


  // ── List view ───────────────────────────────────────────────────────────────
  const toggleStatus = (s) => setStatusFilter(prev => {
    const next = new Set(prev); next.has(s) ? next.delete(s) : next.add(s); return next;
  });
  const filteredEntries = statusFilter.size === 0 ? entries
    : entries.filter(e => statusFilter.has(e.status));
  const hasWaitingStock = entries.some(e => e.status === "waiting_stock");

  return (
    <div className="flex flex-col flex-1 overflow-hidden">
      <TopBar
        title="Orders Tickets"
        subtitle="Queued → Packing → Ready → QA + RP Approved → Complete"
        onRefresh={load}
        actions={
          <div className="flex items-center gap-2">
            <BtnSecondary onClick={() => openMonitorDisplay("/api/monitor/token", "/monitor", navigate)}>
              <Monitor size={14} />Order Monitor
            </BtnSecondary>
            {hasWaitingStock && canOrders && (
              <BtnSecondary
                onClick={handleCheckStock}
                loading={busyId === "check-stock"}
                className="text-amber-700 border-amber-200 hover:bg-amber-50"
              >
                <RefreshCw size={13} />Check backorder stock
              </BtnSecondary>
            )}
          </div>
        }
      />
      <main className="flex-1 overflow-y-auto p-6">
        {/* Priority strip (2026-08-26) — same overdue/at-risk counts a
            viewer would see rolled up on the Operations Monitor for these
            same orders. */}
        {!loading && <AgePriorityStrip items={entries} className="mb-3" />}
        {!loading && entries.length > 0 && (
          <div className="mb-4 flex flex-wrap gap-1.5">
            {["queued", "packing", "ready", "complete", "incomplete", "waiting_stock"].map(s => (
              <button
                key={s}
                onClick={() => toggleStatus(s)}
                className={`px-3 py-1 rounded-full text-xs font-medium border transition-colors ${
                  statusFilter.has(s)
                    ? "bg-bassani-600 text-white border-bassani-600"
                    : "bg-white text-gray-500 border-gray-200 hover:border-bassani-300"
                }`}
              >
                {STATUS_LABEL[s] || s}
                {s === "waiting_stock" && entries.filter(e => e.status === s).length > 0 && (
                  <span className="ml-1.5 bg-amber-500 text-white rounded-full px-1.5 text-[10px]">
                    {entries.filter(e => e.status === s).length}
                  </span>
                )}
              </button>
            ))}
            {statusFilter.size > 0 && (
              <button onClick={() => setStatusFilter(new Set())} className="text-xs text-gray-400 hover:text-gray-600 ml-1 transition-colors">
                Clear
              </button>
            )}
          </div>
        )}
        {loading ? <LoadingState /> : filteredEntries.length === 0 ? (
          <EmptyState message={entries.length === 0 ? "No active orders on the board." : "No orders match the selected filter."} />
        ) : (
          <DataTable
            data={filteredEntries}
            onRowClick={openDetail}
            columns={[
              { accessorKey: "customer_name", header: "Customer", cell: ({ row: { original: e } }) => (
                <div>
                  <p className="font-medium text-gray-900">{e.customer_name}</p>
                  <p className="text-[10px] font-mono text-gray-400">{e.ps_num}</p>
                </div>
              )},
              { id: "status", header: "Stage", cell: ({ row: { original: e } }) => (
                <div className="flex items-center gap-1.5">
                  <Badge color={STATUS_COLOR[e.status]}>{STATUS_LABEL[e.status] || e.status}</Badge>
                  {e.is_backorder && (
                    <span className="text-[10px] font-semibold text-amber-600 bg-amber-100 rounded px-1.5 py-0.5 shrink-0">Backorder</span>
                  )}
                </div>
              )},
              { id: "age", header: "Age", cell: ({ row: { original: e } }) =>
                e.age_tier ? <AgeTierBadge tier={e.age_tier} /> : <span className="text-xs text-gray-300">—</span>
              },
              { accessorKey: "packer_name", header: "Packer", cell: ({ row: { original: e } }) =>
                e.packer_name || <span className="text-gray-300">—</span>
              },
              { id: "qa", header: "QA", cell: ({ row: { original: e } }) =>
                e.qa_approved_at
                  ? <span className="text-xs text-green-600 flex items-center gap-1"><CheckCircle2 size={12} />{e.qa_approved_by}</span>
                  : <span className="text-xs text-gray-400">Pending</span>
              },
              { id: "rp", header: "RP", cell: ({ row: { original: e } }) =>
                e.rp_approved_at
                  ? <span className="text-xs text-green-600 flex items-center gap-1"><CheckCircle2 size={12} />{e.rp_approved_by}</span>
                  : <span className="text-xs text-gray-400">Pending</span>
              },
              { accessorKey: "queued_at", header: "Queued", cell: ({ row: { original: e } }) =>
                <span className="text-xs text-gray-400">{fmtDate(e.queued_at)}</span>
              },
            ]}
          />
        )}
      </main>
    </div>
  );
}
