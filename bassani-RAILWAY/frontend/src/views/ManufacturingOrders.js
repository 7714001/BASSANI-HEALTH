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
import { RefreshCw } from "lucide-react";
import toast from "react-hot-toast";
import api from "../api";
import { TopBar, DataTable, FilterPill, SearchBar, BtnSecondary } from "../components/UI";
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

function fmtQty(n) {
  if (n === null || n === undefined) return "—";
  return Number(n).toLocaleString("en-ZA", { maximumFractionDigits: 2 });
}

function ageDays(createDate) {
  if (!createDate) return null;
  const ms = Date.now() - new Date(createDate.replace(" ", "T") + "Z").getTime();
  return Math.max(0, Math.floor(ms / 86_400_000));
}

export default function ManufacturingOrders() {
  const navigate = useNavigate();
  const location = useLocation();
  const [data,        setData       ] = useState([]);
  const [loading,     setLoading    ] = useState(true);
  const [stateFilter, setStateFilter] = useState("");
  const [search,      setSearch     ] = useState("");
  const [soFilter,    setSoFilter   ] = useState(location.state?.soName || "");

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

  return (
    <div className="flex flex-col h-full overflow-hidden">
      <TopBar
        title="Manufacturing Orders"
        subtitle={`${filtered.length} open MO${filtered.length !== 1 ? "s" : ""}`}
        actions={
          <BtnSecondary onClick={load} disabled={loading}>
            <RefreshCw size={14} className={loading ? "animate-spin" : ""} />
            Refresh
          </BtnSecondary>
        }
      />

      <div className="flex-1 overflow-y-auto p-6 space-y-5">
        {/* Stats row */}
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
              ]}
            />
          )}
        </div>
      </div>
    </div>
  );
}
