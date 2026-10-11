// GMP Supply (8.70) — /supply/gmp, supply.view.
// What La Farmacia is short of for customer orders, what's on its way from
// GMP, and the actions to move it: request stock from GMP, book stock in at
// GMP, dispatch GMP deliveries, receive stock in transit, reconcile the
// backlog. Data and actions: backend/routes/supply_routes.py.
import { useState, useEffect, useCallback, useMemo, Fragment } from "react";
import { useNavigate } from "react-router-dom";
import toast from "react-hot-toast";
import { Loader2, Settings, Truck, PackagePlus, ClipboardCheck, ChevronDown, ChevronRight, Monitor, Download, Send, ExternalLink } from "lucide-react";
import api from "../api";
import { useAuth } from "../AuthContext";
import { TopBar, FilterPill, ChipRow, Badge, BtnPrimary, BtnSecondary, Modal, EmptyState, SearchBar, fmtDate, openMonitorDisplay } from "../components/UI";
import { SupplySettingsModal, RequestStockModal, BookInModal, DispatchModal, ReconcileModal } from "../components/SupplyModals";

const qtyFmt = (n) => Number(n || 0).toLocaleString("en-ZA", { maximumFractionDigits: 3 });

const STATUS = {
  needs_requesting:  { label: "Needs requesting",            color: "red",    hint: "Not covered by any request to GMP yet." },
  requested:         { label: "Requested, waiting on GMP",    color: "amber",  hint: "On a purchase order to GMP; GMP has no stock for it yet." },
  ready_to_dispatch: { label: "Ready to dispatch",           color: "teal",   hint: "GMP has stock for it. Dispatch it from GMP Deliveries." },
  in_transit:        { label: "In transit",                  color: "blue",   hint: "Left GMP but not received at La Farmacia. Receive it from In Transit." },
  stock_here:        { label: "In stock, not reserved",      color: "green",  hint: "La Farmacia has the stock. Open the Order Ticket and click Check Availability." },
  external_needs_ordering: { label: "Order from supplier",   color: "red",    hint: "Supplied by an outside vendor; no open purchase order." },
  external_on_order: { label: "On order from supplier",      color: "amber",  hint: "On an open purchase order from an outside vendor." },
};

// Furthest behind first: used to roll an order's items up to one status.
const STATUS_RANK = { needs_requesting: 0, requested: 1, ready_to_dispatch: 2, in_transit: 3, stock_here: 4 };
const daysSince = (d) => d ? Math.max(0, Math.floor((Date.now() - new Date(d).getTime()) / 86400000)) : null;

function StatusBadge({ status }) {
  const s = STATUS[status] || { label: status, color: "gray" };
  return <span title={s.hint}><Badge color={s.color}>{s.label}</Badge></span>;
}

function OrderLinks({ orders, navigate }) {
  return (
    <table className="w-full text-xs">
      <thead><tr className="text-gray-400"><th className="text-left py-1 pr-3">Order</th><th className="text-left py-1 pr-3">Customer</th>
        <th className="text-left py-1 pr-3">Delivery</th><th className="text-right py-1 pr-3">Short</th><th className="text-left py-1">Waiting since</th></tr></thead>
      <tbody>
        {orders.map(o => (
          <tr key={`${o.picking_id}-${o.qty_short}`} className="border-t border-gray-100">
            <td className="py-1 pr-3">
              {o.sale_order_id ? (
                <button onClick={() => navigate(`/orders/${o.sale_order_id}/passport`)} className="font-mono font-semibold text-bassani-700 hover:underline">{o.order_name}</button>
              ) : o.order_name}
              {o.ticket_id && (
                <button onClick={() => navigate("/tickets/sales", { state: { openTicketId: o.ticket_id } })} className="ml-2 text-gray-400 hover:text-gray-600" title="Open Sales ticket">
                  <ExternalLink size={11} className="inline" />
                </button>
              )}
            </td>
            <td className="py-1 pr-3 text-gray-600">{o.customer_name}</td>
            <td className="py-1 pr-3 text-gray-500">{o.picking_name}{o.is_backorder && <span className="ml-1 text-amber-600">(backorder)</span>}</td>
            <td className="py-1 pr-3 text-right font-semibold">{qtyFmt(o.qty_short)}</td>
            <td className="py-1 text-gray-500">{fmtDate(o.since)}</td>
          </tr>
        ))}
      </tbody>
    </table>
  );
}

export default function SupplyGMP() {
  const { can } = useAuth();
  const navigate = useNavigate();
  const canRequest = can("supply.request"), canBookIn = can("supply.book_in"), canDispatch = can("supply.dispatch");
  const canSettings = can("settings.manage");

  const [tab, setTab] = useState("work");
  const [wl, setWl] = useState(null);
  const [deliveries, setDeliveries] = useState(null);
  const [transit, setTransit] = useState(null);
  const [locationId, setLocationId] = useState(null);
  const [notConfigured, setNotConfigured] = useState(null);
  const [loading, setLoading] = useState(true);
  const [statusFilter, setStatusFilter] = useState("all");
  // By order is the default: Sales/La Farmacia think in customer orders;
  // By product is GMP's "what do we need to make" view.
  const [groupBy, setGroupBy] = useState("order");
  const [collapsedOrders, setCollapsedOrders] = useState(new Set());
  const [search, setSearch] = useState("");
  const [expanded, setExpanded] = useState(new Set());
  const [selected, setSelected] = useState(new Set());

  const [settingsOpen, setSettingsOpen] = useState(false);
  const [requestRows, setRequestRows] = useState(null);
  const [bookIn, setBookIn] = useState(null); // {product?} | null
  const [dispatchOf, setDispatchOf] = useState(null);
  const [reconcileOpen, setReconcileOpen] = useState(false);
  const [receiveConfirm, setReceiveConfirm] = useState(null);
  const [receiving, setReceiving] = useState(false);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const [w, d, t] = await Promise.all([
        api.get("/api/supply/work-list"),
        api.get("/api/supply/deliveries"),
        api.get("/api/supply/transit"),
      ]);
      setWl(w.data); setDeliveries(d.data.deliveries); setTransit(t.data.receipts);
      setLocationId(d.data.supplier_stock_location_id);
      setNotConfigured(null);
      setSelected(new Set());
    } catch (e) {
      if (e.response?.status === 409) setNotConfigured(e.response.data.detail);
      else toast.error(e.response?.data?.detail || "Could not load GMP supply");
    } finally { setLoading(false); }
  }, []);

  useEffect(() => { load(); }, [load]);

  const cfg = wl?.config;
  const supplierName = cfg?.supplier_warehouse_name || "GMP";
  const receivingName = cfg?.receiving_warehouse_name || "La Farmacia";

  const rows = useMemo(() => {
    if (!wl) return [];
    const q = search.trim().toLowerCase();
    return wl.products.filter(r => (statusFilter === "all" || r.status === statusFilter)
      && (!q || r.product_name.toLowerCase().includes(q) || r.orders.some(o => (o.order_name || "").toLowerCase().includes(q) || (o.customer_name || "").toLowerCase().includes(q))));
  }, [wl, statusFilter, search]);

  const byOrder = useMemo(() => {
    const m = new Map();
    for (const r of rows) for (const o of r.orders) {
      const k = o.sale_order_id || o.order_name;
      if (!m.has(k)) m.set(k, { key: k, sale_order_id: o.sale_order_id, order_name: o.order_name, customer_name: o.customer_name,
                                ticket_id: o.ticket_id, since: o.since, has_backorder: false, lines: [] });
      const g = m.get(k);
      if (o.since && (!g.since || o.since < g.since)) g.since = o.since;
      g.has_backorder = g.has_backorder || o.is_backorder;
      g.lines.push({ product: r, product_id: r.product_id, product_name: r.product_name, qty_short: o.qty_short,
                     qty_ordered: o.qty_ordered, status: r.status, picking_name: o.picking_name, is_backorder: o.is_backorder });
    }
    // An order is only as ready as its furthest-behind item.
    return [...m.values()].map(g => {
      const worst = g.lines.reduce((w, l) => (STATUS_RANK[l.status] ?? 9) < (STATUS_RANK[w] ?? 9) ? l.status : w, g.lines[0].status);
      const covered = g.lines.filter(l => l.status === "stock_here" || l.status === "in_transit" || l.status === "ready_to_dispatch").length;
      return { ...g, status: worst, covered, mixed: new Set(g.lines.map(l => l.status)).size > 1 };
    }).sort((a, b) => (a.since || "").localeCompare(b.since || ""));
  }, [rows]);

  const requestForOrder = (o) => setRequestRows(o.lines.filter(l => l.status === "needs_requesting").map(l => ({
    ...l.product,
    uncovered: Math.min(l.qty_short, l.product.uncovered || l.qty_short),
    orders: [{ order_name: o.order_name }],
  })));

  const toggle = (set, setter, k) => setter(s => { const n = new Set(s); n.has(k) ? n.delete(k) : n.add(k); return n; });
  const selectedRows = (wl?.products || []).filter(r => selected.has(r.product_id));

  const exportExcel = async () => {
    const XLSX = await import("xlsx");
    const data = (wl?.products || []).concat(wl?.external || []).flatMap(r => r.orders.map(o => ({
      Product: r.product_name, Status: STATUS[r.status]?.label || r.status, Order: o.order_name, Customer: o.customer_name,
      Delivery: o.picking_name, Backorder: o.is_backorder ? "Yes" : "", "Qty short": o.qty_short,
      "Product needed (total)": r.needed, "Requested from GMP": r.requested ?? "", "In transit": r.in_transit ?? "",
      "GMP free stock": r.supplier_free ?? "", Vendor: r.vendor || "", "Waiting since": o.since ? o.since.slice(0, 10) : "",
    })));
    const wb = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(wb, XLSX.utils.json_to_sheet(data), "GMP Work List");
    XLSX.writeFile(wb, `GMP Work List ${new Date().toISOString().slice(0, 10)}.xlsx`);
  };

  const doReceive = async () => {
    const r = receiveConfirm;
    setReceiving(true);
    try {
      const { data } = await api.post("/api/supply/receive", { picking_id: r.picking_id });
      toast.success(`${data.picking} received at ${receivingName}.` + (data.backorders_requeued ? ` ${data.backorders_requeued} backorder(s) back on the packing board.` : ""));
      setReceiveConfirm(null);
      load();
    } catch (e) { toast.error(e.response?.data?.detail || "Receive failed"); }
    finally { setReceiving(false); }
  };

  const s = wl?.summary;
  const actions = (
    <>
      {canBookIn && !notConfigured && <BtnSecondary size="sm" onClick={() => setBookIn({})}><PackagePlus size={13} />Book In at GMP</BtnSecondary>}
      {canDispatch && !notConfigured && <BtnSecondary size="sm" onClick={() => setReconcileOpen(true)}><ClipboardCheck size={13} />Reconcile Backlog</BtnSecondary>}
      {!notConfigured && <BtnSecondary size="sm" onClick={() => openMonitorDisplay("/api/supply-monitor/token", "/supply-monitor", navigate)}><Monitor size={13} />Monitor</BtnSecondary>}
      {canSettings && <BtnSecondary size="sm" onClick={() => setSettingsOpen(true)}><Settings size={13} />Settings</BtnSecondary>}
    </>
  );

  return (
    <div className="flex flex-col h-full">
      <TopBar title="GMP Supply" subtitle={cfg ? `${supplierName} → ${receivingName}` : "Stock from GMP for customer orders"} onRefresh={load} actions={actions} />
      <main className="flex-1 overflow-y-auto p-4 sm:p-6">
        <div className="w-full space-y-4">
          {loading && !wl && !notConfigured ? (
            <div className="py-16 flex items-center justify-center text-sm text-gray-400 gap-2"><Loader2 size={16} className="animate-spin" />Reading Odoo…</div>
          ) : notConfigured ? (
            <EmptyState heading="GMP supply isn't set up yet" message={notConfigured}
              action={canSettings ? <BtnPrimary onClick={() => setSettingsOpen(true)}>Open Supply settings</BtnPrimary> : null} />
          ) : (
            <>
              <div className="grid grid-cols-2 sm:grid-cols-5 gap-3">
                {[
                  ["Products short", s.products_short, "text-gray-800"],
                  ["Customer orders waiting", s.orders_waiting, "text-gray-800"],
                  ["Needs requesting", s.needs_requesting, s.needs_requesting ? "text-red-600" : "text-gray-400"],
                  ["Ready to dispatch", s.ready_to_dispatch, s.ready_to_dispatch ? "text-teal-600" : "text-gray-400"],
                  ["In transit", s.in_transit, s.in_transit ? "text-blue-600" : "text-gray-400"],
                ].map(([label, v, c]) => (
                  <div key={label} className="bg-white rounded-xl border border-gray-100 px-4 py-3">
                    <p className="text-[11px] text-gray-400">{label}</p>
                    <p className={`text-xl font-bold ${c}`}>{v}</p>
                  </div>
                ))}
              </div>

              <ChipRow>
                <FilterPill label={`Work List (${wl.products.length})`} active={tab === "work"} onClick={() => setTab("work")} />
                <FilterPill label={`GMP Deliveries (${deliveries?.length || 0})`} active={tab === "deliveries"} onClick={() => setTab("deliveries")} />
                <FilterPill label={`In Transit (${transit?.length || 0})`} active={tab === "transit"} onClick={() => setTab("transit")} />
                {wl.external.length > 0 && <FilterPill label={`Other suppliers (${wl.external.length})`} active={tab === "external"} onClick={() => setTab("external")} />}
              </ChipRow>

              {tab === "work" && (
                <div className="bg-white rounded-xl border border-gray-100 overflow-hidden">
                  <div className="px-4 py-3 border-b border-gray-50 flex flex-wrap items-center gap-2">
                    <SearchBar value={search} onChange={setSearch} placeholder="Search product, order or customer…" />
                    <ChipRow>
                      {["all", "needs_requesting", "requested", "ready_to_dispatch", "in_transit", "stock_here"].map(k => (
                        <FilterPill key={k} label={k === "all" ? "All" : STATUS[k].label} active={statusFilter === k} onClick={() => setStatusFilter(k)} />
                      ))}
                    </ChipRow>
                    <div className="ml-auto flex items-center gap-2">
                      <FilterPill label="By customer order" active={groupBy === "order"} onClick={() => setGroupBy("order")} />
                      <FilterPill label="By product (GMP)" active={groupBy === "product"} onClick={() => setGroupBy("product")} />
                      <BtnSecondary size="sm" onClick={exportExcel}><Download size={13} />Export</BtnSecondary>
                      {canRequest && selected.size > 0 && (
                        <BtnPrimary size="sm" onClick={() => setRequestRows(selectedRows)}><Send size={13} />Request from GMP ({selected.size})</BtnPrimary>
                      )}
                    </div>
                  </div>

                  {rows.length === 0 ? (
                    <p className="px-5 py-8 text-sm text-gray-400 text-center">Nothing short for customer orders{statusFilter !== "all" ? " in this view" : ""}.</p>
                  ) : groupBy === "product" ? (
                    <div className="overflow-x-auto">
                      <table className="w-full text-sm min-w-[900px]">
                        <thead><tr className="bg-gray-50 text-[10px] uppercase tracking-wider text-gray-400">
                          <th className="w-8 px-3 py-2.5"></th><th className="text-left px-3 py-2.5">Product</th><th className="text-left px-3 py-2.5">Status</th>
                          <th className="text-right px-3 py-2.5">Needed</th><th className="text-right px-3 py-2.5">Requested</th><th className="text-right px-3 py-2.5">In transit</th>
                          <th className="text-right px-3 py-2.5">GMP stock</th><th className="text-left px-3 py-2.5">Customer orders waiting</th><th className="text-left px-3 py-2.5">Waiting since</th><th className="px-3 py-2.5"></th>
                        </tr></thead>
                        <tbody>
                          {rows.map(r => {
                            const open = expanded.has(r.product_id);
                            return (
                              <Fragment key={r.product_id}>
                                <tr className="border-t border-gray-50 hover:bg-gray-50">
                                  <td className="px-3 py-2.5">
                                    {canRequest && r.status === "needs_requesting" ? (
                                      <input type="checkbox" checked={selected.has(r.product_id)} onChange={() => toggle(selected, setSelected, r.product_id)} className="accent-bassani-600" />
                                    ) : null}
                                  </td>
                                  <td className="px-3 py-2.5">
                                    <button onClick={() => toggle(expanded, setExpanded, r.product_id)} className="flex items-center gap-1 text-left font-medium text-gray-900">
                                      {open ? <ChevronDown size={14} /> : <ChevronRight size={14} />}{r.product_name}
                                    </button>
                                  </td>
                                  <td className="px-3 py-2.5"><StatusBadge status={r.status} /></td>
                                  <td className="px-3 py-2.5 text-right font-semibold">{qtyFmt(r.needed)}
                                    {r.stock_here_unreserved > 0 && <p className="text-[10px] text-green-700 font-normal">{qtyFmt(r.stock_here_unreserved)} at La Farmacia</p>}
                                  </td>
                                  <td className="px-3 py-2.5 text-right text-gray-600">{qtyFmt(r.requested)}</td>
                                  <td className="px-3 py-2.5 text-right text-gray-600">{qtyFmt(r.in_transit)}</td>
                                  <td className="px-3 py-2.5 text-right text-gray-600">{qtyFmt(r.supplier_free)}</td>
                                  <td className="px-3 py-2.5">
                                    <div className="flex flex-wrap gap-1 max-w-[16rem]">
                                      {[...new Map(r.orders.map(o => [o.sale_order_id || o.order_name, o])).values()].slice(0, 4).map(o => (
                                        <button key={o.sale_order_id || o.order_name} title={`${o.customer_name}: short ${qtyFmt(o.qty_short)}`}
                                          onClick={() => o.sale_order_id && navigate(`/orders/${o.sale_order_id}/passport`)}
                                          className="font-mono text-[11px] px-1.5 py-0.5 rounded bg-gray-100 text-bassani-700 hover:bg-bassani-50">
                                          {o.order_name}
                                        </button>
                                      ))}
                                      {r.order_count > 4 && (
                                        <button onClick={() => toggle(expanded, setExpanded, r.product_id)} className="text-[11px] text-gray-500 hover:underline">+{r.order_count - 4} more</button>
                                      )}
                                    </div>
                                  </td>
                                  <td className="px-3 py-2.5 text-gray-500 whitespace-nowrap">{fmtDate(r.oldest_since)}</td>
                                  <td className="px-3 py-2.5 text-right whitespace-nowrap">
                                    {r.status === "needs_requesting" && canRequest && <button onClick={() => setRequestRows([r])} className="text-xs text-bassani-700 hover:underline">Request</button>}
                                    {r.status === "ready_to_dispatch" && <button onClick={() => setTab("deliveries")} className="text-xs text-teal-700 hover:underline">Dispatch</button>}
                                    {r.status === "in_transit" && <button onClick={() => setTab("transit")} className="text-xs text-blue-700 hover:underline">Receive</button>}
                                    {r.status === "requested" && canBookIn && r.supplier_free <= 0 && (
                                      <button onClick={() => setBookIn({ product: { id: r.product_id, name: r.product_name, display_name: r.product_name } })} className="text-xs text-gray-600 hover:underline">Book in</button>
                                    )}
                                  </td>
                                </tr>
                                {open && (
                                  <tr className="bg-gray-50/60"><td colSpan={10} className="px-10 py-3">
                                    <p className="text-xs text-gray-500 mb-2">{STATUS[r.status]?.hint}</p>
                                    <OrderLinks orders={r.orders} navigate={navigate} />
                                  </td></tr>
                                )}
                              </Fragment>
                            );
                          })}
                        </tbody>
                      </table>
                    </div>
                  ) : (
                    <div className="overflow-x-auto">
                      <table className="w-full text-sm min-w-[860px]">
                        <thead><tr className="bg-gray-50 text-[10px] uppercase tracking-wider text-gray-400">
                          <th className="w-8 px-3 py-2.5"></th><th className="text-left px-3 py-2.5">Order / Product</th><th className="text-left px-3 py-2.5">Customer / Delivery</th>
                          <th className="text-left px-3 py-2.5">Status</th><th className="text-right px-3 py-2.5">Short</th><th className="text-left px-3 py-2.5">Waiting</th><th className="px-3 py-2.5"></th>
                        </tr></thead>
                        <tbody>
                          {byOrder.map(o => {
                            const open = !collapsedOrders.has(o.key);
                            const days = daysSince(o.since);
                            const canRequestOrder = canRequest && o.lines.some(l => l.status === "needs_requesting");
                            return (
                              <Fragment key={o.key}>
                                <tr className="border-t-2 border-gray-100 bg-white hover:bg-gray-50">
                                  <td className="px-3 py-3">
                                    <button onClick={() => toggle(collapsedOrders, setCollapsedOrders, o.key)} className="text-gray-400 hover:text-gray-600">
                                      {open ? <ChevronDown size={15} /> : <ChevronRight size={15} />}
                                    </button>
                                  </td>
                                  <td className="px-3 py-3">
                                    <button onClick={() => o.sale_order_id && navigate(`/orders/${o.sale_order_id}/passport`)} className="font-mono font-semibold text-bassani-700 hover:underline">{o.order_name}</button>
                                    {o.ticket_id && (
                                      <button onClick={() => navigate("/tickets/sales", { state: { openTicketId: o.ticket_id } })} className="ml-2 text-gray-400 hover:text-gray-600" title="Open Sales ticket">
                                        <ExternalLink size={12} className="inline" />
                                      </button>
                                    )}
                                    <p className="text-[11px] text-gray-500 mt-0.5">
                                      {o.lines.length} short item{o.lines.length !== 1 ? "s" : ""} · {o.covered} of {o.lines.length} on the way or in stock
                                      {o.has_backorder && <span className="text-amber-600"> · backorder</span>}
                                    </p>
                                  </td>
                                  <td className="px-3 py-3 font-medium text-gray-800">{o.customer_name}</td>
                                  <td className="px-3 py-3">
                                    <StatusBadge status={o.status} />
                                    {o.mixed && <p className="text-[10px] text-gray-400 mt-0.5">Furthest-behind item shown</p>}
                                  </td>
                                  <td className="px-3 py-3"></td>
                                  <td className={`px-3 py-3 whitespace-nowrap ${days > 14 ? "text-red-600 font-semibold" : days > 7 ? "text-amber-600 font-medium" : "text-gray-500"}`}>
                                    {days != null ? `${days} day${days !== 1 ? "s" : ""}` : "—"}
                                    <p className="text-[10px] text-gray-400 font-normal">since {fmtDate(o.since)}</p>
                                  </td>
                                  <td className="px-3 py-3 text-right whitespace-nowrap">
                                    {canRequestOrder && <BtnSecondary size="sm" onClick={() => requestForOrder(o)}><Send size={12} />Request for this order</BtnSecondary>}
                                  </td>
                                </tr>
                                {open && o.lines.map((l, i) => (
                                  <tr key={`${o.key}-${l.product_id}-${i}`} className="bg-gray-50/50 hover:bg-gray-50">
                                    <td></td>
                                    <td className="px-3 py-2 pl-6 text-gray-800">{l.product_name}</td>
                                    <td className="px-3 py-2 text-xs text-gray-500">{l.picking_name}{l.is_backorder && <span className="text-amber-600"> (backorder)</span>}</td>
                                    <td className="px-3 py-2"><StatusBadge status={l.status} /></td>
                                    <td className="px-3 py-2 text-right font-semibold">{qtyFmt(l.qty_short)}<span className="text-[10px] text-gray-400 font-normal"> of {qtyFmt(l.qty_ordered)}</span></td>
                                    <td className="px-3 py-2 text-[11px] text-gray-500">{STATUS[l.status]?.hint}</td>
                                    <td className="px-3 py-2 text-right whitespace-nowrap">
                                      {l.status === "needs_requesting" && canRequest && <button onClick={() => setRequestRows([{ ...l.product, uncovered: Math.min(l.qty_short, l.product.uncovered || l.qty_short), orders: [{ order_name: o.order_name }] }])} className="text-xs text-bassani-700 hover:underline">Request</button>}
                                      {l.status === "ready_to_dispatch" && <button onClick={() => setTab("deliveries")} className="text-xs text-teal-700 hover:underline">Dispatch</button>}
                                      {l.status === "in_transit" && <button onClick={() => setTab("transit")} className="text-xs text-blue-700 hover:underline">Receive</button>}
                                      {l.status === "requested" && canBookIn && l.product.supplier_free <= 0 && (
                                        <button onClick={() => setBookIn({ product: { id: l.product_id, name: l.product_name, display_name: l.product_name } })} className="text-xs text-gray-600 hover:underline">Book in</button>
                                      )}
                                    </td>
                                  </tr>
                                ))}
                              </Fragment>
                            );
                          })}
                        </tbody>
                      </table>
                    </div>
                  )}
                </div>
              )}

              {tab === "deliveries" && (
                <div className="bg-white rounded-xl border border-gray-100 overflow-x-auto">
                  <p className="px-4 py-3 text-xs text-gray-500 border-b border-gray-50">
                    {supplierName}'s open deliveries to {receivingName}. "Waiting" means Odoo shows no GMP stock for it: book the stock in at GMP, then dispatch.
                  </p>
                  {(deliveries || []).length === 0 ? <p className="px-5 py-8 text-sm text-gray-400 text-center">No open GMP deliveries.</p> : (
                    <table className="w-full text-sm min-w-[760px]">
                      <thead><tr className="bg-gray-50 text-[10px] uppercase tracking-wider text-gray-400">
                        <th className="text-left px-3 py-2.5">Delivery</th><th className="text-left px-3 py-2.5">Purchase order</th><th className="text-left px-3 py-2.5">Created</th>
                        <th className="text-left px-3 py-2.5">Readiness</th><th className="text-right px-3 py-2.5">Reserved</th><th className="text-right px-3 py-2.5">Lines</th><th className="px-3 py-2.5"></th>
                      </tr></thead>
                      <tbody>
                        {deliveries.map(d => (
                          <tr key={d.picking_id} className="border-t border-gray-50 hover:bg-gray-50">
                            <td className="px-3 py-2.5 font-mono text-xs">{d.name}</td>
                            <td className="px-3 py-2.5 text-gray-600">{d.purchase_order || "—"}</td>
                            <td className="px-3 py-2.5 text-gray-500 whitespace-nowrap">{fmtDate(d.created)}</td>
                            <td className="px-3 py-2.5">
                              <Badge color={d.readiness === "ready" ? "teal" : d.readiness === "partial" ? "amber" : "gray"}>
                                {d.readiness === "ready" ? "Ready" : d.readiness === "partial" ? "Partly reserved" : "Waiting on GMP stock"}
                              </Badge>
                            </td>
                            <td className="px-3 py-2.5 text-right">{qtyFmt(d.reserved)} / {qtyFmt(d.demand)}</td>
                            <td className="px-3 py-2.5 text-right">{d.lines.length}</td>
                            <td className="px-3 py-2.5 text-right">
                              {canDispatch && <button onClick={() => setDispatchOf(d)} className="text-xs text-teal-700 hover:underline flex items-center gap-1 ml-auto"><Truck size={12} />{d.readiness === "waiting" ? "Open" : "Dispatch"}</button>}
                            </td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  )}
                </div>
              )}

              {tab === "transit" && (
                <div className="bg-white rounded-xl border border-gray-100 overflow-x-auto">
                  <p className="px-4 py-3 text-xs text-gray-500 border-b border-gray-50">
                    Stock Odoo shows as having left GMP but never received at {receivingName}. Receive it once it has physically arrived.
                  </p>
                  {(transit || []).length === 0 ? <p className="px-5 py-8 text-sm text-gray-400 text-center">Nothing in transit.</p> : (
                    <table className="w-full text-sm">
                      <thead><tr className="bg-gray-50 text-[10px] uppercase tracking-wider text-gray-400">
                        <th className="text-left px-3 py-2.5">Receipt</th><th className="text-left px-3 py-2.5">Purchase order</th><th className="text-left px-3 py-2.5">Since</th>
                        <th className="text-right px-3 py-2.5">Lines</th><th className="text-right px-3 py-2.5">Units</th><th className="px-3 py-2.5"></th>
                      </tr></thead>
                      <tbody>
                        {transit.map(r => (
                          <tr key={r.picking_id} className="border-t border-gray-50">
                            <td className="px-3 py-2.5 font-mono text-xs">{r.name}</td>
                            <td className="px-3 py-2.5 text-gray-600">{r.origin || "—"}</td>
                            <td className="px-3 py-2.5 text-gray-500">{fmtDate(r.created)}</td>
                            <td className="px-3 py-2.5 text-right">{r.lines}</td>
                            <td className="px-3 py-2.5 text-right">{qtyFmt(r.qty)}</td>
                            <td className="px-3 py-2.5 text-right">{canDispatch && <button onClick={() => setReceiveConfirm(r)} className="text-xs text-blue-700 hover:underline">Receive</button>}</td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  )}
                </div>
              )}

              {tab === "external" && (
                <div className="bg-white rounded-xl border border-gray-100 overflow-x-auto">
                  <p className="px-4 py-3 text-xs text-gray-500 border-b border-gray-50">Products supplied by outside vendors. Shown for visibility; order them from the supplier as usual.</p>
                  <table className="w-full text-sm min-w-[700px]">
                    <thead><tr className="bg-gray-50 text-[10px] uppercase tracking-wider text-gray-400">
                      <th className="text-left px-3 py-2.5">Product</th><th className="text-left px-3 py-2.5">Vendor</th><th className="text-left px-3 py-2.5">Status</th>
                      <th className="text-right px-3 py-2.5">Needed</th><th className="text-right px-3 py-2.5">On order</th><th className="text-left px-3 py-2.5">Purchase orders</th><th className="text-right px-3 py-2.5">Orders waiting</th>
                    </tr></thead>
                    <tbody>
                      {wl.external.map(r => (
                        <tr key={r.product_id} className="border-t border-gray-50">
                          <td className="px-3 py-2.5 font-medium">{r.product_name}</td><td className="px-3 py-2.5 text-gray-600">{r.vendor}</td>
                          <td className="px-3 py-2.5"><StatusBadge status={r.status} /></td>
                          <td className="px-3 py-2.5 text-right">{qtyFmt(r.needed)}</td><td className="px-3 py-2.5 text-right">{qtyFmt(r.external_on_order)}</td>
                          <td className="px-3 py-2.5 text-xs text-gray-500">{(r.external_orders || []).join(", ") || "—"}</td><td className="px-3 py-2.5 text-right">{r.order_count}</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              )}
            </>
          )}
        </div>
      </main>

      {settingsOpen && <SupplySettingsModal onClose={() => setSettingsOpen(false)} onSaved={load} />}
      {requestRows && <RequestStockModal rows={requestRows} supplierName={supplierName} onClose={() => setRequestRows(null)} onDone={load} />}
      {bookIn && <BookInModal initialProduct={bookIn.product || null} supplierName={supplierName} supplierLocationId={locationId} onClose={() => setBookIn(null)} onDone={load} />}
      {dispatchOf && (
        <DispatchModal delivery={dispatchOf} supplierLocationId={locationId} receivingName={receivingName}
          onClose={() => setDispatchOf(null)} onDone={load}
          onBookIn={canBookIn ? () => { const l = dispatchOf.lines[0]; setDispatchOf(null); setBookIn({ product: l ? { id: l.product_id, name: l.product_name, display_name: l.product_name } : null }); } : null} />
      )}
      {reconcileOpen && <ReconcileModal onClose={() => setReconcileOpen(false)} onDone={load} />}
      {receiveConfirm && (
        <Modal title={`Receive ${receiveConfirm.name}?`} onClose={() => setReceiveConfirm(null)}>
          <p className="text-sm text-gray-600">
            Books {qtyFmt(receiveConfirm.qty)} units ({receiveConfirm.lines} lines) into {receivingName} in Odoo, then reserves them for waiting customer orders.
            Only do this if the stock has physically arrived.
          </p>
          <div className="flex justify-end gap-2 mt-4">
            <BtnSecondary onClick={() => setReceiveConfirm(null)} disabled={receiving}>Cancel</BtnSecondary>
            <BtnPrimary onClick={doReceive} loading={receiving}>It has arrived: Receive</BtnPrimary>
          </div>
        </Modal>
      )}
    </div>
  );
}
