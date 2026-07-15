// ─────────────────────────────────────────────────────────────────────────────
// Orders Tickets view — Phase 8.8
// Full-page detail with strictly linear role-gated pipeline.
// orders_clerk: queued → packing → ready → complete / incomplete
// qa_manager: QA Approve (when ready)
// responsible_pharmacist: RP Approve (when ready)
// tickets.manage: Override Stage
// ─────────────────────────────────────────────────────────────────────────────
import { useState, useEffect, useCallback } from "react";
import { useAuth } from "../AuthContext";
import api from "../api";
import toast from "react-hot-toast";
import bwipjs from "bwip-js";
import {
  ShieldCheck, Stethoscope, CheckCircle2, XCircle,
  AlertTriangle, Package, Clock, Truck, RefreshCw, Printer,
} from "lucide-react";
import {
  TopBar, DataTable, Modal, FormGroup, Select, Textarea,
  BtnPrimary, BtnSecondary, BtnDanger, Badge, LoadingState, EmptyState, fmtDate,
} from "../components/UI";

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
  complete:        "Complete",
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
  const { can, user } = useAuth();
  const canOrders = can("tickets.orders");
  const canQa     = can("tickets.qa_approve");
  const canRp     = can("tickets.rp_approve");
  const canManage = can("tickets.manage");

  // ── List state ──────────────────────────────────────────────────────────────
  const [view, setView]       = useState("list");
  const [entries, setEntries] = useState([]);
  const [loading, setLoading] = useState(true);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const r = await api.get("/api/packing/board");
      setEntries(r.data.entries || []);
    } catch { toast.error("Failed to load orders tickets"); }
    finally { setLoading(false); }
  }, []);
  useEffect(() => { load(); }, [load]);

  // ── Detail state ────────────────────────────────────────────────────────────
  const [detail, setDetail]               = useState(null);
  const [detailLoading, setDetailLoading] = useState(false);
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
  const [qtyPackedEdits,  setQtyPackedEdits ] = useState({});  // sku → draft string
  const [qtyPackedSaving, setQtyPackedSaving] = useState(new Set());
  const [purgeConfirm,    setPurgeConfirm   ] = useState(false);
  const [purging,         setPurging        ] = useState(false);

  // Fetch MOs when viewing a waiting_stock backorder entry
  useEffect(() => {
    const orderId = detail?.order_id;
    if (!orderId || detail?.status !== "waiting_stock") { setMos([]); return; }
    setMosLoading(true);
    api.get(`/api/orders/${orderId}/manufacturing-orders`)
      .then(r => setMos(r.data.manufacturing_orders || []))
      .catch(() => setMos([]))
      .finally(() => setMosLoading(false));
  }, [detail?.order_id, detail?.status]);

  // Fetch confirmed lot assignments for on-screen display (done pickings only)
  useEffect(() => {
    if (!detail?.order_id) { setOrderLotMap({}); return; }
    api.get(`/api/orders/${detail.order_id}`)
      .then(r => setOrderLotMap(r.data.lot_map || {}))
      .catch(() => {});
  }, [detail?.order_id]);

  const openDetail = async (entry) => {
    setDetail(null);
    setDetailLoading(true);
    setView("detail");
    setQtyPackedEdits({});
    try {
      const r = await api.get(`/api/packing/entry/${entry.order_id}`);
      setDetail(r.data);
      setOverrideStatus(r.data.status);
    } catch {
      toast.error("Failed to load order");
      setView("list");
    } finally {
      setDetailLoading(false);
    }
  };

  const refreshDetail = async (order_id) => {
    try {
      const r = await api.get(`/api/packing/entry/${order_id}`);
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
      await api.put(`/api/packing/${path}`, { order_id, ...extra });
      toast.success("Updated");
      await refreshDetail(order_id);
    } catch (e) { toast.error(e.response?.data?.detail || "Action failed"); }
    finally { setBusyId(null); }
  };

  const handleComplete = async () => {
    setBusyId(detail.order_id);
    try {
      const r = await api.put("/api/packing/complete", { order_id: detail.order_id });
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

  const submitIncomplete = async () => {
    if (!incompleteReason.trim()) return toast.error("A reason is required");
    setBusyId(detail.order_id);
    try {
      await api.put("/api/packing/incomplete", { order_id: detail.order_id, reason: incompleteReason.trim() });
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
      await api.put("/api/packing/update-item-qty", { order_id: detail.order_id, sku, qty_packed: val });
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
      await api.put("/api/packing/override-status", { order_id: detail.order_id, status: overrideStatus });
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
      await api.put(`/api/packing/tick?order_id=${encodeURIComponent(detail.order_id)}&sku=${encodeURIComponent(sku)}&ticked=${!currentlyTicked}`);
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
      await api.put("/api/packing/assign-packer", { order_id: detail.order_id, packer_name: packerInput.trim() });
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
      });
      toast.success(`Batch ${data.lot_name} assigned`);
    } catch (e) { toast.error(e.response?.data?.detail || "Failed to assign lot"); }
    finally { setLotSaving(null); }
  };


  // ── Packing slip print ──────────────────────────────────────────────────────
  // Generates barcode inline (no DOM ref / timing dependency) by calling bwip-js
  // directly and converting the canvas to a data URL before writing the window.
  // Async so we can fetch lot/batch assignments from Odoo before rendering.
  const printSlip = async () => {
    if (!detail) return;

    let barcodeHtml = "";
    if (detail.ps_num) {
      const canvas = document.createElement("canvas");
      try {
        bwipjs.toCanvas(canvas, {
          bcid: "code128", text: detail.ps_num, scale: 2, height: 12,
          includetext: true, textxalign: "center", padding: 2, backgroundcolor: "ffffff",
        });
        barcodeHtml = `<img src="${canvas.toDataURL("image/png")}" alt="${detail.ps_num}" style="display:block;max-height:52px;margin-left:auto" />`;
      } catch {}
    }

    // Fetch lot/batch assignments — best-effort, non-blocking on failure
    let lotMap = {};
    if (detail.order_id) {
      try {
        const { data } = await api.get(`/api/orders/${detail.order_id}`);
        lotMap = data.lot_map || {};
      } catch {}
    }

    const itemRows = (detail.items || []).map(item => {
      const lots = item.product_id && lotMap[item.product_id] ? lotMap[item.product_id] : [];
      const lotHtml = lots.length > 0
        ? `<div style="font-size:9.5px;color:#6b7280;font-family:monospace;margin-top:2px">Batch: ${lots.join(", ")}</div>`
        : "";
      return `
      <tr>
        <td>${item.name || item.sku || ""}${lotHtml}</td>
        <td style="font-size:10px;color:#888;font-family:monospace">${item.sku || ""}</td>
        <td class="r">${item.qty_ordered ?? item.qty ?? "—"}</td>
        <td class="r">${item.qty_reserved ?? "—"}</td>
        <td class="r">${detail.item_ticks?.[item.sku] ? "✓" : ""}</td>
      </tr>`;
    }).join("");

    const metaRows = [
      ["Order Ref", detail.ps_num],
      ["Invoice", detail.inv_num || "—"],
      ["Delivery Note", detail.dn_num || "—"],
      ["Warehouse", detail.warehouse_name || "—"],
      ["Packer", detail.packer_name || "Unassigned"],
      ["Status", STATUS_LABEL[detail.status] || detail.status],
    ].map(([k, v]) => `<div style="margin-bottom:4px"><span style="font-size:9px;font-weight:700;text-transform:uppercase;color:#999;letter-spacing:.5px">${k}</span><br/><span style="font-size:12px;font-weight:600">${v}</span></div>`).join("");

    const win = window.open("", "_blank", "width=900,height=1200");
    win.document.write(`<!DOCTYPE html><html><head><meta charset="utf-8"/>
      <title>Packing Slip ${detail.ps_num || ""}</title>
      <style>*{box-sizing:border-box;margin:0;padding:0}body{font-family:-apple-system,BlinkMacSystemFont,"Segoe UI",sans-serif;font-size:12px;color:#111;background:#fff}.page{width:794px;min-height:1123px;margin:0 auto;padding:48px;display:flex;flex-direction:column}table{width:100%;border-collapse:collapse}thead th{font-size:10px;font-weight:700;text-transform:uppercase;color:#999;letter-spacing:.5px;padding:8px 6px;border-bottom:2px solid #e5e7eb;text-align:left}thead th.r,td.r{text-align:center}tbody td{padding:9px 6px;border-bottom:1px solid #f3f4f6;font-size:11.5px;color:#333}</style>
      </head><body><div class="page">
        <div style="display:flex;justify-content:space-between;align-items:flex-start;margin-bottom:32px">
          <div>
            <img src="/logo.png" alt="Bassani Health" style="height:40px" onerror="this.style.display='none';this.nextSibling.style.display='block'" /><div style="display:none;font-size:20px;font-weight:800;color:#0f6e56">BASSANI HEALTH</div>
            <div style="margin-top:8px"><p style="font-size:12px;font-weight:700">Bassani Health (PTY) LTD</p><p style="font-size:11px;color:#666">VAT NO: 4430323131</p></div>
          </div>
          <div style="text-align:right">
            <p style="font-size:20px;font-weight:800;margin-bottom:8px">PACKING SLIP</p>
            ${barcodeHtml}
          </div>
        </div>
        <div style="margin-bottom:24px">
          <p style="font-size:9px;font-weight:700;text-transform:uppercase;color:#999;letter-spacing:.5px;margin-bottom:4px">Customer</p>
          <p style="font-size:16px;font-weight:700">${detail.customer_name || "—"}</p>
          ${detail.reseller_name ? `<p style="font-size:11px;color:#6d28d9">via ${detail.reseller_name}</p>` : ""}
        </div>
        <div style="display:grid;grid-template-columns:repeat(3,1fr);gap:12px;border-top:1px solid #e5e7eb;border-bottom:1px solid #e5e7eb;padding:12px 0;margin-bottom:28px">${metaRows}</div>
        <table>
          <thead><tr>
            <th>Description</th>
            <th>SKU</th>
            <th class="r">Ordered</th>
            <th class="r">Reserved</th>
            <th class="r">Packed ✓</th>
          </tr></thead>
          <tbody>${itemRows}</tbody>
        </table>
        <div style="margin-top:auto;padding-top:24px;border-top:1px solid #e5e7eb;font-size:10px;color:#888">
          <p>Payment is due upon collection. &nbsp; 4 days to collect orders once ready.</p>
        </div>
      </div></body></html>`);
    win.document.close();
    win.focus();
    setTimeout(() => { win.print(); win.close(); }, 400);
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

    return (
      <div className="flex flex-col flex-1 overflow-hidden bg-slate-50">
        <TopBar
          title={detail?.customer_name || "Loading…"}
          subtitle={detail ? `${detail.ps_num} — ${STATUS_LABEL[detail.status] || detail.status}` : ""}
          actions={
            <div className="flex items-center gap-2">
              {user?.is_super_admin && (
                <BtnDanger onClick={() => setPurgeConfirm(true)} disabled={purging}>
                  {purging ? "Purging…" : "Purge Test Data"}
                </BtnDanger>
              )}
              {detail && (
                <BtnSecondary onClick={printSlip}>
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
              <div className="grid grid-cols-1 lg:grid-cols-3 gap-6 items-start">

                {/* ── Left: Order document ── */}
                <div className="lg:col-span-2 space-y-4">
                  <div className="bg-white rounded-2xl shadow-sm border border-gray-100 overflow-hidden">

                    {/* Document header */}
                    <div className="p-6 border-b border-gray-100">
                      <div className="flex items-start justify-between mb-5">
                        <div>
                          <h2 className="text-2xl font-bold tracking-tight text-gray-900">
                            {(STATUS_LABEL[detail.status] || detail.status).toUpperCase()}
                          </h2>
                          <p className="text-sm font-mono text-gray-400 mt-0.5">{detail.ps_num}</p>
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
                            <div className="flex justify-between text-xs">
                              <span className="text-gray-400 uppercase font-semibold tracking-wide">Invoice</span>
                              <span className="font-mono text-gray-700">{detail.inv_num}</span>
                            </div>
                          )}
                          {detail.dn_num && (
                            <div className="flex justify-between text-xs">
                              <span className="text-gray-400 uppercase font-semibold tracking-wide">DN</span>
                              <span className="font-mono text-gray-700">{detail.dn_num}</span>
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

                  {/* Status + timestamps */}
                  <div className="bg-white rounded-2xl shadow-sm border border-gray-100 p-4 space-y-3">
                    <div className="flex flex-wrap gap-2 items-center">
                      <Badge color={STATUS_COLOR[detail.status]}>{STATUS_LABEL[detail.status] || detail.status}</Badge>
                      {detail.total_units != null && (
                        <span className="text-xs text-gray-400">{detail.total_units} unit{detail.total_units !== 1 ? "s" : ""}</span>
                      )}
                    </div>
                    <div className="pt-2 border-t border-gray-100 space-y-1.5">
                      {[
                        { label: "Queued",     at: detail.queued_at },
                        { label: "Packing",    at: detail.assigned_at },
                        { label: "Ready",      at: detail.ready_at },
                        { label: "Completed",  at: detail.completed_at },
                        { label: "Incomplete", at: detail.incomplete_at },
                      ].filter(e => e.at).map((e, i) => (
                        <div key={i} className="flex items-center gap-1.5 text-xs">
                          <Clock size={10} className="text-gray-300 shrink-0" />
                          <span className="text-gray-500 font-medium">{e.label}:</span>
                          <span className="text-gray-400">{fmtDate(e.at)}</span>
                        </div>
                      ))}
                      {detail.status === "complete" && detail.delivery_validated === true && (
                        <div className="flex items-center gap-1.5 text-xs pt-0.5">
                          <Truck size={10} className="text-green-400 shrink-0" />
                          <span className="text-green-600 font-medium">Delivery validated in Odoo</span>
                        </div>
                      )}
                      {detail.status === "complete" && detail.delivery_validated === false && (
                        <div className="flex items-center gap-1.5 text-xs pt-0.5">
                          <Truck size={10} className="text-amber-400 shrink-0" />
                          <span className="text-amber-600 font-medium">Delivery not validated in Odoo</span>
                        </div>
                      )}
                    </div>
                  </div>

                  {/* QA + RP approval status */}
                  <div className="bg-white rounded-2xl shadow-sm border border-gray-100 divide-y divide-gray-100">
                    <div className="px-4 py-3 flex items-center justify-between gap-3">
                      <span className="text-xs text-gray-500 flex items-center gap-1.5 shrink-0">
                        <ShieldCheck size={13} />QA
                      </span>
                      {detail.qa_approved_at
                        ? <span className="text-xs text-green-600 text-right">{detail.qa_approved_by} — {fmtDate(detail.qa_approved_at)}</span>
                        : <span className="text-xs text-gray-400">Pending</span>}
                    </div>
                    <div className="px-4 py-3 flex items-center justify-between gap-3">
                      <span className="text-xs text-gray-500 flex items-center gap-1.5 shrink-0">
                        <Stethoscope size={13} />RP
                      </span>
                      {detail.rp_approved_at
                        ? <span className="text-xs text-green-600 text-right">{detail.rp_approved_by} — {fmtDate(detail.rp_approved_at)}</span>
                        : <span className="text-xs text-gray-400">Pending</span>}
                    </div>
                  </div>

                  {/* Role-gated action cards */}
                  {!isTerminal && (
                    <div className="space-y-3">

                      {/* orders_clerk: queued → packing */}
                      {canOrders && detail.status === "queued" && (
                        <div className="bg-blue-50 border border-blue-100 rounded-2xl p-4">
                          <p className="text-xs text-blue-700 mb-3">
                            Assign a packer above, then move to active packing. The floor board will update.
                          </p>
                          <BtnPrimary
                            onClick={() => act("mark-packing", detail.order_id)}
                            loading={busyId === detail.order_id}
                            className="w-full justify-center"
                          >
                            <Package size={13} />Mark as Packing
                          </BtnPrimary>
                        </div>
                      )}

                      {/* orders_clerk: packing → ready */}
                      {canOrders && detail.status === "packing" && (
                        <div className="bg-amber-50 border border-amber-100 rounded-2xl p-4">
                          <p className="text-xs text-amber-700 mb-3">
                            Once the packer has reported back and all items are ticked, move to Ready for QA and RP inspection.
                          </p>
                          <BtnPrimary
                            onClick={() => act("mark-ready", detail.order_id)}
                            loading={busyId === detail.order_id}
                            className="w-full justify-center"
                          >
                            <CheckCircle2 size={13} />Mark as Ready
                          </BtnPrimary>
                        </div>
                      )}

                      {/* orders_clerk: ready → complete (only once both approved) */}
                      {canOrders && detail.status === "ready" && (
                        <div className={`rounded-2xl p-4 ${bothApproved ? "bg-green-50 border border-green-100" : "bg-white shadow-sm border border-gray-100"}`}>
                          {bothApproved ? (
                            <>
                              <p className="text-xs text-green-700 mb-3">
                                Both QA and RP have signed off. Complete this order.
                              </p>
                              <BtnPrimary
                                onClick={handleComplete}
                                loading={busyId === detail.order_id}
                                className="w-full justify-center"
                              >
                                <CheckCircle2 size={13} />Mark Complete
                              </BtnPrimary>
                            </>
                          ) : (
                            <div className="flex items-start gap-2">
                              <AlertTriangle size={14} className="text-amber-500 mt-0.5 shrink-0" />
                              <p className="text-xs text-gray-500">
                                Waiting for QA and RP to approve before this order can be completed.
                              </p>
                            </div>
                          )}
                        </div>
                      )}

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

                      {/* qa_manager: approve when ready */}
                      {canQa && detail.status === "ready" && !detail.qa_approved_at && (
                        <div className="bg-indigo-50 border border-indigo-100 rounded-2xl p-4">
                          <p className="text-xs text-indigo-700 mb-3">
                            Review the packed order and confirm QA sign-off.
                          </p>
                          <BtnPrimary
                            onClick={() => act("qa-approve", detail.order_id)}
                            loading={busyId === detail.order_id}
                            className="w-full justify-center"
                          >
                            <ShieldCheck size={13} />QA Approve
                          </BtnPrimary>
                        </div>
                      )}

                      {/* responsible_pharmacist: approve when ready */}
                      {canRp && detail.status === "ready" && !detail.rp_approved_at && (
                        <div className="bg-purple-50 border border-purple-100 rounded-2xl p-4">
                          <p className="text-xs text-purple-700 mb-3">
                            Review and provide Responsible Pharmacist sign-off.
                          </p>
                          <BtnPrimary
                            onClick={() => act("rp-approve", detail.order_id)}
                            loading={busyId === detail.order_id}
                            className="w-full justify-center"
                          >
                            <Stethoscope size={13} />RP Approve
                          </BtnPrimary>
                        </div>
                      )}

                      {/* orders_clerk: mark as collected (partial orders only — creates invoice) */}
                      {canOrders && detail.status === "complete" && detail.has_pending_invoice && !detail.collected_at && (
                        <div className="bg-teal-50 border border-teal-100 rounded-2xl p-4">
                          <p className="text-xs text-teal-700 mb-3">
                            Customer has collected this delivery. Marking as collected will create the invoice in Odoo for the items delivered.
                          </p>
                          {detail.collected_at ? (
                            <p className="text-xs text-green-600 flex items-center gap-1.5">
                              <CheckCircle2 size={12} />Collected {fmtDate(detail.collected_at)} by {detail.collected_by}
                            </p>
                          ) : (
                            <BtnPrimary
                              onClick={() => handleCollect(detail.odoo_picking_id || null)}
                              loading={busyId === detail.order_id}
                              className="w-full justify-center"
                            >
                              <Truck size={13} />Mark as Collected
                            </BtnPrimary>
                          )}
                        </div>
                      )}

                      {/* Waiting stock — backorder entry info + check stock button */}
                      {detail.status === "waiting_stock" && (
                        <div className="bg-amber-50 border border-amber-100 rounded-2xl p-4 space-y-3">
                          <div className="flex items-start gap-2">
                            <AlertTriangle size={14} className="text-amber-500 mt-0.5 shrink-0" />
                            <div>
                              <p className="text-xs font-semibold text-amber-800">Awaiting stock reservation</p>
                              <p className="text-xs text-amber-700 mt-0.5">
                                This is a backorder. The items below will be fulfilled when stock becomes available in Odoo.
                              </p>
                            </div>
                          </div>
                          {canOrders && (
                            <BtnSecondary
                              onClick={handleCheckStock}
                              loading={busyId === "check-stock"}
                              className="w-full justify-center text-amber-700 border-amber-200 hover:bg-amber-100"
                            >
                              <RefreshCw size={13} />Check stock availability
                            </BtnSecondary>
                          )}
                          {/* Production orders replenishing this backorder */}
                          {(mosLoading || mos.length > 0) && (
                            <div className="border-t border-amber-100 pt-3 space-y-2">
                              <p className="text-[10px] font-semibold text-amber-800 uppercase tracking-wide flex items-center gap-1">
                                <Package size={10} />Production orders
                              </p>
                              {mosLoading ? (
                                <p className="text-xs text-amber-600">Loading...</p>
                              ) : mos.map(mo => {
                                const MO_COLOURS = {
                                  draft:     "bg-gray-100 text-gray-500",
                                  confirmed: "bg-amber-100 text-amber-800",
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
                                      <span className="font-mono font-medium text-amber-900">{mo.mo_name}</span>
                                      <span className="ml-1.5 text-amber-700 truncate">{mo.product_name}</span>
                                      {mo.qty_producing > 0 && (
                                        <span className="ml-1.5 text-green-700">{mo.qty_producing}/{mo.product_qty} producing</span>
                                      )}
                                      {mo.date_planned_finished && (
                                        <span className="ml-1.5 text-amber-600">· due {fmtDate(mo.date_planned_finished)}</span>
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

                      {/* collected_at display for complete backorder entries */}
                      {detail.status === "complete" && detail.collected_at && (
                        <div className="bg-green-50 border border-green-100 rounded-2xl p-4">
                          <p className="text-xs text-green-700 flex items-center gap-1.5">
                            <CheckCircle2 size={13} className="shrink-0" />
                            Collected {fmtDate(detail.collected_at)} by {detail.collected_by}
                            {detail.invoice_name && (
                              <span className="ml-1 font-mono text-green-600">· {detail.invoice_name}</span>
                            )}
                          </p>
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
          hasWaitingStock && canOrders ? (
            <BtnSecondary
              onClick={handleCheckStock}
              loading={busyId === "check-stock"}
              className="text-amber-700 border-amber-200 hover:bg-amber-50"
            >
              <RefreshCw size={13} />Check backorder stock
            </BtnSecondary>
          ) : undefined
        }
      />
      <main className="flex-1 overflow-y-auto p-6">
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
