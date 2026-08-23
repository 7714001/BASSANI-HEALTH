// Manufacturing Orders — authenticated admin list, companion to Backorders.js.
// Distinct from Backorders (delivery-level: only shows orders where a
// packer has already attempted and split a delivery) — this shows every
// open Odoo Manufacturing Order tied to a customer sale order directly,
// which can exist well before any delivery is attempted (Odoo often
// creates the MO the moment the sale order is confirmed, depending on the
// product's routing). Also distinct from the public /manufacturing-monitor
// TV board: this page is logged-in, searchable, and filterable, for staff
// who need to look something up rather than glance at a screen.
import { useState, useEffect, useMemo } from "react";
import { useLocation, useNavigate } from "react-router-dom";
import { RefreshCw, Monitor, HelpCircle, PlayCircle, CheckCircle2, ClipboardEdit, ChevronDown, ChevronRight, ExternalLink } from "lucide-react";
import toast from "react-hot-toast";
import api from "../api";
import { useAuth } from "../AuthContext";
import { TopBar, DataTable, FilterPill, SearchBar, BtnSecondary, BtnPrimary, Modal, FormGroup, Input, Pager, openMonitorDisplay } from "../components/UI";
import { MO_STATE_LABEL } from "./Backorders";

const STATE_STYLE = {
  draft:     "bg-gray-100   text-gray-500",
  confirmed: "bg-amber-100  text-amber-700",
  progress:  "bg-green-100  text-green-700",
  to_close:  "bg-blue-100   text-blue-700",
};

function StatePill({ state }) {
  return (
    <span className={`inline-flex items-center px-2 py-0.5 rounded text-[11px] font-semibold ${STATE_STYLE[state] || "bg-gray-100 text-gray-500"}`}>
      {MO_STATE_LABEL[state] || state}
    </span>
  );
}

// Least-advanced-wins: an order isn't actually ready until every one of its
// products is, so the parent row's single rollup status is whichever
// product is furthest BEHIND, not the furthest ahead — that's the thing
// actually blocking the order. Draft is the earliest stage, to_close the
// latest, matching STATE_STYLE/MO_STATE_LABEL's own ordering.
const STATE_PRIORITY = { draft: 0, confirmed: 1, progress: 2, to_close: 3 };

function rollupState(mos) {
  return mos.reduce((worst, m) =>
    (STATE_PRIORITY[m.state] ?? 0) < (STATE_PRIORITY[worst.state] ?? 0) ? m : worst
  , mos[0]).state;
}

function fmtQty(n) {
  if (n === null || n === undefined) return "—";
  return Number(n).toLocaleString("en-ZA", { maximumFractionDigits: 2 });
}

function round2(n) {
  return Math.round(n * 100) / 100;
}

function ageDays(createDate) {
  if (!createDate) return null;
  const ms = Date.now() - new Date(createDate.replace(" ", "T") + "Z").getTime();
  return Math.max(0, Math.floor(ms / 86_400_000));
}

// ── "How is this created?" guide ────────────────────────────────────────────
// Same self-contained button + reference modal shape as
// ProductionGuideButton (frontend/src/components/ProductionGuide.js) and
// Backorders.js's BackorderGuideButton.

function MOGuideButton() {
  const [open, setOpen] = useState(false);
  return (
    <>
      <BtnSecondary onClick={() => setOpen(true)}>
        <HelpCircle size={14} />How are these created?
      </BtnSecondary>
      {open && (
        <Modal title="How a Manufacturing Order is created" onClose={() => setOpen(false)} width="max-w-lg">
          <div className="space-y-3 text-sm text-gray-600">
            <p>
              A Manufacturing Order (MO) appears here automatically, created by Odoo the moment a customer's
              sale order is confirmed, whenever a product's own routing configuration says more of it needs
              to be made before it can be delivered. <span className="font-semibold text-gray-700">The portal
              never creates an MO itself</span> — it only shows the ones Odoo's own configuration already
              generated.
            </p>
            <p>
              An MO can exist well before any delivery is attempted, which is why you may see one here for an
              order that hasn't shown up on the Backorders page yet — a backorder only appears once a packer
              has actually tried to pick the delivery and come up short.
            </p>
            <p className="font-semibold text-gray-700">Moving an order through its stages</p>
            <p>
              There are two actions. <span className="font-medium">Confirm</span> moves a Draft MO to
              Confirmed in Odoo, reserving the components it needs. <span className="font-medium">Update
              Status</span> handles everything after that: enter how many have actually been produced and
              save. Leave it at the full amount to finish the order in one step, or lower it to log partial
              progress and come back later — either way, Odoo works out whether that puts the order In
              Progress, To Close, or fully Complete. Both actions write directly to the same record you'd
              otherwise need to open Odoo to change — if Odoo can't complete one (for example, a component is
              genuinely out of stock), the error it gives is shown here exactly as Odoo reports it.
            </p>
            <p>
              Once an order is marked complete, any backorders waiting on that stock are automatically
              rechecked — no need to click "Check backorder stock" separately.
            </p>
          </div>
        </Modal>
      )}
    </>
  );
}

// ── Row actions — shared by the flat (By Product) and grouped (By Order)
// views so Confirm / Update Status behave identically in both.

function MOActions({ m, canManage, busyId, doConfirm, openUpdate }) {
  if (!canManage) return null;
  const isBusy = busyId === m.mo_id;
  if (m.state === "draft") {
    return (
      <BtnSecondary
        onClick={e => { e.stopPropagation(); doConfirm(m); }}
        loading={isBusy}
        disabled={isBusy}
      >
        <PlayCircle size={13} />Confirm
      </BtnSecondary>
    );
  }
  if (["confirmed", "progress", "to_close"].includes(m.state)) {
    return (
      <BtnPrimary
        onClick={e => { e.stopPropagation(); openUpdate(m); }}
        loading={isBusy}
        disabled={isBusy}
      >
        <ClipboardEdit size={13} />Update Status
      </BtnPrimary>
    );
  }
  return null;
}

// ── By-Order view (default) — mirrors Backorders.js's OrderRow/groupBy
// pattern exactly, so staff can see at a glance whether every product on an
// order is ready, not just one MO in isolation, while each product's status
// is still tracked and updated individually via MOActions above.

function OrderGroupRow({ group, defaultExpanded, navigate, canManage, busyId, doConfirm, openUpdate }) {
  const [expanded, setExpanded] = useState(defaultExpanded);
  const isMixed = new Set(group.mos.map(m => m.state)).size > 1;
  const overall = rollupState(group.mos);

  return (
    <>
      <tr className="border-b border-gray-100 hover:bg-gray-50 transition-colors">
        <td className="p-3 w-8">
          <button onClick={() => setExpanded(v => !v)} className="text-gray-400 hover:text-gray-600">
            {expanded ? <ChevronDown size={14} /> : <ChevronRight size={14} />}
          </button>
        </td>
        <td className="p-3 font-mono text-sm whitespace-nowrap">
          {group.sale_order_id ? (
            <button
              onClick={() => navigate(`/orders/${group.sale_order_id}/passport`)}
              className="text-bassani-700 hover:text-bassani-900 hover:underline font-medium flex items-center gap-1"
            >
              {group.order_ref}
              <ExternalLink size={11} className="text-bassani-400" />
            </button>
          ) : (
            <span className="text-gray-900">{group.order_ref || "—"}</span>
          )}
        </td>
        <td className="p-3 text-sm text-gray-700 max-w-[180px] truncate">
          {group.customer_name || "—"}
        </td>
        <td className="p-3 whitespace-nowrap">
          <span className={`text-xs font-semibold ${group.oldestAgeDays > 3 ? "text-red-600" : group.oldestAgeDays > 1 ? "text-amber-600" : "text-gray-500"}`}>
            {group.oldestAgeDays}d
          </span>
        </td>
        <td
          className="p-3 min-w-[200px]"
          title={isMixed ? group.mos.map(m => `${m.product_name || m.mo_name}: ${MO_STATE_LABEL[m.state] || m.state}`).join("\n") : undefined}
        >
          <div className="flex items-center gap-2">
            <StatePill state={overall} />
            <span className="text-xs text-gray-400">{group.mos.length} product{group.mos.length !== 1 ? "s" : ""}</span>
          </div>
          {isMixed && <p className="text-[10px] text-gray-400 mt-0.5">Mixed — least advanced shown</p>}
        </td>
        <td className="p-3 whitespace-nowrap">
          {group.ticket ? (
            <button
              onClick={() => navigate(`/tickets/sales?ticket=${group.ticket.ticket_id}`)}
              className="inline-flex items-center gap-1 text-xs text-bassani-600 hover:underline font-medium"
            >
              {group.ticket.ref}
              <ExternalLink size={11} />
            </button>
          ) : (
            <span className="text-xs text-gray-300">—</span>
          )}
        </td>
      </tr>
      {expanded && group.mos.map(m => (
        <tr key={m.mo_id} className="bg-gray-50 border-b border-gray-100">
          <td className="p-3" />
          <td className="p-3 pl-8" colSpan={3}>
            <p className="text-sm font-medium text-gray-900">{m.product_name || "—"}</p>
            <p className="text-[10px] font-mono text-gray-400">{m.mo_name}</p>
          </td>
          <td className="p-3">
            <div className="text-sm">
              <span className="font-semibold text-gray-900">{fmtQty(m.qty_remaining)}</span>
              <span className="text-gray-400"> remaining</span>
              <p className="text-[10px] text-gray-400">{fmtQty(m.qty_producing)} / {fmtQty(m.qty_total)} produced</p>
            </div>
          </td>
          <td className="p-3">
            <MOActions m={m} canManage={canManage} busyId={busyId} doConfirm={doConfirm} openUpdate={openUpdate} />
          </td>
        </tr>
      ))}
    </>
  );
}

export default function ManufacturingOrders() {
  const navigate = useNavigate();
  const location = useLocation();
  const { can } = useAuth();
  const canManage = can("orders.manufacturing_manage");
  const [data,        setData       ] = useState([]);
  const [loading,     setLoading    ] = useState(true);
  const [groupBy,     setGroupBy    ] = useState("order"); // "order" | "product" — defaults to order so staff see whether everything on an SO is ready, not just one product
  const [stateFilter, setStateFilter] = useState("");
  const [search,      setSearch     ] = useState("");
  const [soFilter,    setSoFilter   ] = useState(location.state?.soName || "");
  const [busyId,       setBusyId      ] = useState(null); // mo_id currently mid-action
  const [updateTarget, setUpdateTarget] = useState(null); // mo pending Update Status
  const [updateQty,    setUpdateQty   ] = useState("");
  const [groupPageIndex, setGroupPageIndex] = useState(0); // By Order view's own pagination — DataTable (By Product) already paginates itself
  const [groupPageSize,  setGroupPageSize ] = useState(25);

  const load = async () => {
    setLoading(true);
    try {
      const r = await api.get("/api/orders/manufacturing-orders");
      setData(r.data.manufacturing_orders || []);
    } catch (e) {
      toast.error(e.response?.data?.detail || "Failed to load manufacturing orders");
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => { load(); }, []);

  const doConfirm = async (mo) => {
    setBusyId(mo.mo_id);
    try {
      await api.put(`/api/orders/manufacturing-orders/${mo.mo_id}/confirm`);
      toast.success(`${mo.mo_name} confirmed`);
      setData(d => d.map(m => m.mo_id === mo.mo_id ? { ...m, state: "confirmed" } : m));
    } catch (e) {
      toast.error(e.response?.data?.detail || "Failed to confirm manufacturing order");
    } finally {
      setBusyId(null);
    }
  };

  // Defaults to the full order quantity — the common case ("it's all done")
  // needs zero typing, just open the modal and save. Reducing the number is
  // the deliberate opt-in for logging partial progress instead.
  const openUpdate = (mo) => {
    setUpdateQty(String(mo.qty_total ?? ""));
    setUpdateTarget(mo);
  };

  const parsedUpdateQty = parseFloat(updateQty);
  const updateIsComplete = updateTarget && Number.isFinite(parsedUpdateQty) && parsedUpdateQty >= updateTarget.qty_total;

  const doUpdateStatus = async () => {
    const mo  = updateTarget;
    const qty = parsedUpdateQty;
    if (!Number.isFinite(qty) || qty <= 0) {
      toast.error("Enter a quantity greater than zero");
      return;
    }
    if (qty > mo.qty_total) {
      toast.error(`Cannot exceed the order quantity of ${fmtQty(mo.qty_total)}`);
      return;
    }
    if (qty < mo.qty_total && qty <= mo.qty_producing) {
      toast.error(`Enter a quantity greater than what's already recorded (${fmtQty(mo.qty_producing)})`);
      return;
    }
    setUpdateTarget(null);
    setBusyId(mo.mo_id);
    try {
      if (qty >= mo.qty_total) {
        await api.put(`/api/orders/manufacturing-orders/${mo.mo_id}/complete`);
        toast.success(`${mo.mo_name} marked complete`);
        // A done MO no longer matches the open-MO domain this list reads —
        // remove it immediately rather than waiting for the next refresh.
        setData(d => d.filter(m => m.mo_id !== mo.mo_id));
      } else {
        const r = await api.put(`/api/orders/manufacturing-orders/${mo.mo_id}/record-production`, { qty_producing: qty });
        toast.success(`${mo.mo_name} updated — ${MO_STATE_LABEL[r.data.state] || r.data.state}`);
        setData(d => d.map(m => m.mo_id === mo.mo_id
          ? { ...m, state: r.data.state, qty_producing: r.data.qty_producing, qty_remaining: round2(m.qty_total - r.data.qty_producing) }
          : m));
      }
    } catch (e) {
      toast.error(e.response?.data?.detail || "Failed to update manufacturing order");
    } finally {
      setBusyId(null);
    }
  };

  const stateCounts = useMemo(() => {
    const c = { draft: 0, confirmed: 0, progress: 0, to_close: 0 };
    data.forEach(m => { if (c[m.state] !== undefined) c[m.state]++; });
    return c;
  }, [data]);

  const filtered = useMemo(() => {
    let d = soFilter ? data.filter(m => m.order_ref === soFilter) : data;
    if (stateFilter) d = d.filter(m => m.state === stateFilter);
    if (search.trim()) {
      const q = search.trim().toLowerCase();
      d = d.filter(m =>
        m.product_name?.toLowerCase().includes(q) ||
        m.mo_name?.toLowerCase().includes(q) ||
        m.order_ref?.toLowerCase().includes(q) ||
        m.customer_name?.toLowerCase().includes(q)
      );
    }
    return d;
  }, [data, stateFilter, soFilter, search]);

  // Groups filtered MOs by sale order — one group per SO, sorted oldest-first
  // by its oldest member (matches the age-first convention used everywhere
  // else in this app) so a group with one urgent product is never buried
  // behind a calmer multi-product one.
  const orderGroups = useMemo(() => {
    const map = new Map();
    filtered.forEach(m => {
      const key = m.order_ref || `mo-${m.mo_id}`;
      if (!map.has(key)) {
        map.set(key, {
          order_ref: m.order_ref, sale_order_id: m.sale_order_id,
          customer_name: m.customer_name, ticket: m.ticket, mos: [],
        });
      }
      map.get(key).mos.push(m);
    });
    // oldestAgeDays is precomputed once here (not just used for sorting) so
    // OrderGroupRow can show it directly as the parent row's Age column.
    const groups = Array.from(map.values()).map(g => ({
      ...g,
      oldestAgeDays: Math.max(...g.mos.map(m => ageDays(m.create_date) ?? 0)),
    }));
    // Sort by oldest (most urgent) member, not newest — a group with one
    // urgent product must never get buried under a newer product just
    // because they share an order (2026-08-23 fix: this was previously
    // Math.min, ranking groups by their newest/least-urgent member instead).
    return groups.sort((a, b) => b.oldestAgeDays - a.oldestAgeDays);
  }, [filtered]);

  // Reset to page 1 whenever the underlying group list changes shape —
  // otherwise a filter/search that shrinks the result set can strand the
  // view on a now-empty page.
  useEffect(() => { setGroupPageIndex(0); }, [orderGroups.length, groupPageSize]);

  const pagedGroups = useMemo(() => {
    const start = groupPageIndex * groupPageSize;
    return orderGroups.slice(start, start + groupPageSize);
  }, [orderGroups, groupPageIndex, groupPageSize]);

  // Summary stats — mirrors the public Manufacturing Monitor's own KPI row
  // (units remaining, oldest open) so this admin page never shows less
  // summary information than the public TV board does, plus the one this
  // page was specifically missing: how many distinct orders have open MOs,
  // not just how many MOs exist (one order can have several).
  const summaryStats = useMemo(() => {
    const orderKeys = new Set(filtered.map(m => m.order_ref || `mo-${m.mo_id}`));
    const unitsRemaining = filtered.reduce((sum, m) => sum + (Number(m.qty_remaining) || 0), 0);
    const oldestDays = filtered.reduce((max, m) => Math.max(max, ageDays(m.create_date) ?? 0), 0);
    return { ordersAffected: orderKeys.size, unitsRemaining: round2(unitsRemaining), oldestDays };
  }, [filtered]);

  return (
    <div className="flex flex-col h-full overflow-hidden">
      <TopBar
        title="Manufacturing Orders"
        subtitle={`${filtered.length} open MO${filtered.length !== 1 ? "s" : ""}`}
        actions={
          <div className="flex items-center gap-2">
            <MOGuideButton />
            <BtnSecondary onClick={() => openMonitorDisplay("/api/manufacturing-monitor/token", "/manufacturing-monitor", navigate)}>
              <Monitor size={14} />Manufacturing Monitor
            </BtnSecondary>
            <BtnSecondary onClick={load} disabled={loading}>
              <RefreshCw size={14} className={loading ? "animate-spin" : ""} />
              Refresh
            </BtnSecondary>
          </div>
        }
      />

      <div className="flex-1 overflow-y-auto p-6 space-y-5">
        {/* Summary row — mirrors the public Manufacturing Monitor's own KPI
            row, so this admin page is never less informative than the TV
            board it's the searchable counterpart to. */}
        <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
          <div className="bg-white rounded-xl border border-gray-200 p-4">
            <p className="text-xs text-gray-400 uppercase font-semibold tracking-wide mb-1">Orders Affected</p>
            <p className="text-2xl font-bold text-gray-900">{summaryStats.ordersAffected}</p>
          </div>
          <div className="bg-white rounded-xl border border-gray-200 p-4">
            <p className="text-xs text-gray-400 uppercase font-semibold tracking-wide mb-1">Units Remaining</p>
            <p className="text-2xl font-bold text-gray-900">{fmtQty(summaryStats.unitsRemaining)}</p>
          </div>
          <div className="bg-white rounded-xl border border-gray-200 p-4">
            <p className="text-xs text-gray-400 uppercase font-semibold tracking-wide mb-1">Oldest Open</p>
            <p className={`text-2xl font-bold ${summaryStats.oldestDays > 3 ? "text-red-600" : summaryStats.oldestDays > 1 ? "text-amber-600" : "text-gray-900"}`}>
              {summaryStats.oldestDays}d
            </p>
          </div>
        </div>

        {/* Stage breakdown row */}
        <div className="grid grid-cols-2 sm:grid-cols-4 gap-4">
          {[
            { label: "Draft",       value: stateCounts.draft,     color: "text-gray-600" },
            { label: "Confirmed",   value: stateCounts.confirmed, color: "text-amber-600" },
            { label: "In Progress", value: stateCounts.progress,  color: "text-green-600" },
            { label: "To Close",    value: stateCounts.to_close,  color: "text-blue-600" },
          ].map(s => (
            <div key={s.label} className="bg-white rounded-xl border border-gray-200 p-4">
              <p className="text-xs text-gray-400 uppercase font-semibold tracking-wide mb-1">{s.label}</p>
              <p className={`text-2xl font-bold ${s.color}`}>{s.value}</p>
            </div>
          ))}
        </div>

        {/* SO filter chip — shown when arriving from Order Passport */}
        {soFilter && (
          <div className="flex items-center gap-3 bg-orange-50 border border-orange-200 rounded-xl px-4 py-2.5">
            <span className="text-sm text-orange-800">
              Manufacturing orders for <span className="font-mono font-semibold">{soFilter}</span>
            </span>
            <button
              onClick={() => setSoFilter("")}
              className="text-xs font-semibold text-orange-600 hover:text-orange-900 underline ml-auto"
            >
              View all
            </button>
          </div>
        )}

        {/* Controls */}
        <div className="flex flex-wrap items-center gap-3">
          <div className="flex items-center bg-white border border-gray-200 rounded-lg p-1 gap-1">
            <button
              onClick={() => setGroupBy("order")}
              className={`px-3 py-1.5 rounded-md text-xs font-medium transition-colors ${groupBy === "order" ? "bg-bassani-600 text-white" : "text-gray-500 hover:text-gray-700"}`}
            >
              By Order
            </button>
            <button
              onClick={() => setGroupBy("product")}
              className={`px-3 py-1.5 rounded-md text-xs font-medium transition-colors ${groupBy === "product" ? "bg-bassani-600 text-white" : "text-gray-500 hover:text-gray-700"}`}
            >
              By Product
            </button>
          </div>
          <FilterPill label="All" active={stateFilter === ""} onClick={() => setStateFilter("")} />
          {[
            { key: "draft",     label: `Draft (${stateCounts.draft})` },
            { key: "confirmed", label: `Confirmed (${stateCounts.confirmed})` },
            { key: "progress",  label: `In Progress (${stateCounts.progress})` },
            { key: "to_close",  label: `To Close (${stateCounts.to_close})` },
          ].filter(f => stateCounts[f.key] > 0).map(f => (
            <FilterPill key={f.key} label={f.label} active={stateFilter === f.key} onClick={() => setStateFilter(f.key)} />
          ))}
          <div className="ml-auto">
            <SearchBar value={search} onChange={setSearch} placeholder="Search product, order, customer…" />
          </div>
        </div>

        {/* Table */}
        <div className="bg-white rounded-xl border border-gray-200 overflow-hidden">
          {filtered.length === 0 && !loading ? (
            <div className="py-16 text-center">
              <p className="text-sm font-medium text-gray-500">No manufacturing orders</p>
              <p className="text-xs text-gray-400 mt-1">Nothing currently needs producing for a customer order.</p>
            </div>
          ) : groupBy === "order" ? (
            <>
              <div className="overflow-x-auto">
                <table className="w-full">
                  <thead>
                    <tr className="bg-gray-50 border-b border-gray-200">
                      <th className="p-3 w-8" />
                      <th className="p-3 text-left text-xs font-semibold text-gray-400 uppercase tracking-wide">SO Ref</th>
                      <th className="p-3 text-left text-xs font-semibold text-gray-400 uppercase tracking-wide">Customer</th>
                      <th className="p-3 text-left text-xs font-semibold text-gray-400 uppercase tracking-wide">Age</th>
                      <th className="p-3 text-left text-xs font-semibold text-gray-400 uppercase tracking-wide">Status</th>
                      <th className="p-3 text-left text-xs font-semibold text-gray-400 uppercase tracking-wide">Ticket</th>
                    </tr>
                  </thead>
                  <tbody>
                    {pagedGroups.map((group, i) => (
                      <OrderGroupRow
                        key={group.order_ref || group.mos[0]?.mo_id}
                        group={group}
                        defaultExpanded={i === 0}
                        navigate={navigate}
                        canManage={canManage}
                        busyId={busyId}
                        doConfirm={doConfirm}
                        openUpdate={openUpdate}
                      />
                    ))}
                  </tbody>
                </table>
              </div>
              <Pager
                pageIndex={groupPageIndex}
                pageSize={groupPageSize}
                total={orderGroups.length}
                onPageChange={setGroupPageIndex}
                onPageSizeChange={setGroupPageSize}
              />
            </>
          ) : (
            <DataTable
              loading={loading}
              data={filtered}
              total={filtered.length}
              onRowClick={m => m.sale_order_id && navigate(`/orders/${m.sale_order_id}/passport`)}
              columns={[
                { accessorKey: "product_name", header: "Product",
                  cell: ({ row: { original: m } }) => (
                    <div>
                      <p className="font-medium text-gray-900">{m.product_name || "—"}</p>
                      <p className="text-[10px] font-mono text-gray-400">{m.mo_name}</p>
                    </div>
                  ) },
                { id: "qty", header: "Qty", enableSorting: false,
                  cell: ({ row: { original: m } }) => (
                    <div className="text-sm">
                      <span className="font-semibold text-gray-900">{fmtQty(m.qty_remaining)}</span>
                      <span className="text-gray-400"> remaining</span>
                      <p className="text-[10px] text-gray-400">{fmtQty(m.qty_producing)} / {fmtQty(m.qty_total)} produced</p>
                    </div>
                  ) },
                { accessorKey: "state", header: "State",
                  cell: ({ row: { original: m } }) => <StatePill state={m.state} /> },
                { id: "order", header: "Order / Customer", enableSorting: false,
                  cell: ({ row: { original: m } }) => (
                    <div>
                      <p className="text-sm text-gray-700">{m.order_ref || "—"}</p>
                      {m.customer_name && <p className="text-[10px] text-gray-400">{m.customer_name}</p>}
                    </div>
                  ) },
                { id: "ticket", header: "Ticket", enableSorting: false,
                  cell: ({ row: { original: m } }) => m.ticket
                    ? <span className="text-xs font-mono text-teal-600">{m.ticket.ref}</span>
                    : <span className="text-xs text-gray-300">—</span> },
                { id: "age", header: "Age", enableSorting: false,
                  cell: ({ row: { original: m } }) => {
                    const d = ageDays(m.create_date);
                    return <span className="text-xs text-gray-500">{d === null ? "—" : `${d}d`}</span>;
                  } },
                { id: "due", header: "Due", enableSorting: false,
                  cell: ({ row: { original: m } }) => (
                    <span className="text-xs text-gray-500">
                      {m.date_finished ? m.date_finished.split(" ")[0] : "—"}
                    </span>
                  ) },
                ...(canManage ? [{
                  id: "actions", header: "", enableSorting: false,
                  cell: ({ row: { original: m } }) => (
                    <MOActions m={m} canManage={canManage} busyId={busyId} doConfirm={doConfirm} openUpdate={openUpdate} />
                  ),
                }] : []),
              ]}
            />
          )}
        </div>
      </div>

      {updateTarget && (
        <Modal title="Update production status" onClose={() => setUpdateTarget(null)} width="max-w-md">
          <p className="text-sm text-gray-600 mb-4">
            How much of <span className="font-mono font-semibold">{updateTarget.mo_name}</span> ({updateTarget.product_name}) has actually been
            produced so far? Defaults to the full order amount — reduce it to log partial progress instead of finishing the order now.
          </p>
          <FormGroup label={`Quantity produced (out of ${fmtQty(updateTarget.qty_total)})`} required>
            <Input
              type="number"
              min={0}
              max={updateTarget.qty_total}
              step="any"
              value={updateQty}
              onChange={e => setUpdateQty(e.target.value)}
              autoFocus
            />
          </FormGroup>
          {updateIsComplete && (
            <p className="text-xs text-amber-700 bg-amber-50 border border-amber-200 rounded-lg px-3 py-2 mt-1">
              This will mark the order complete in Odoo — the finished stock moves in and this can't be undone from here. If a component is out
              of stock, Odoo will refuse and nothing changes.
            </p>
          )}
          <div className="flex justify-end gap-2 mt-4">
            <BtnSecondary onClick={() => setUpdateTarget(null)}>Cancel</BtnSecondary>
            <BtnPrimary onClick={doUpdateStatus}>
              {updateIsComplete ? <CheckCircle2 size={14} /> : <ClipboardEdit size={14} />}
              {updateIsComplete ? "Mark Complete" : "Save Progress"}
            </BtnPrimary>
          </div>
        </Modal>
      )}
    </div>
  );
}
