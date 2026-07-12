import { useState, useEffect, useMemo } from "react";
import { useNavigate, useLocation } from "react-router-dom";
import { RefreshCw, ExternalLink, ChevronDown, ChevronRight } from "lucide-react";
import toast from "react-hot-toast";
import api from "../api";
import { TopBar, FilterPill, fmtDate, BtnSecondary } from "../components/UI";

const STATE_STYLE = {
  confirmed: "bg-orange-100 text-orange-700",
  assigned:  "bg-green-100  text-green-700",
  waiting:   "bg-gray-100   text-gray-500",
};

const MO_STATE_LABEL = {
  draft:       "Draft",
  confirmed:   "Confirmed",
  progress:    "In Progress",
  to_close:    "To Close",
  done:        "Done",
};

function StatePill({ state, label }) {
  return (
    <span className={`inline-flex items-center px-2 py-0.5 rounded text-[11px] font-semibold ${STATE_STYLE[state] || "bg-gray-100 text-gray-500"}`}>
      {label}
    </span>
  );
}

function ProductRow({ line }) {
  const mo = line.manufacturing_order;
  return (
    <div className="flex items-start gap-2 py-0.5">
      <span className="text-sm text-gray-800 min-w-0 flex-1">{line.product_name}</span>
      <span className="text-sm font-semibold text-orange-600 whitespace-nowrap shrink-0">
        {Number(line.qty_outstanding) % 1 === 0
          ? Number(line.qty_outstanding)
          : Number(line.qty_outstanding).toFixed(2)} outstanding
      </span>
      {mo && (
        <span className="text-[11px] text-blue-600 bg-blue-50 px-1.5 py-0.5 rounded font-medium whitespace-nowrap shrink-0">
          {mo.mo_name} · {MO_STATE_LABEL[mo.state] || mo.state}
          {mo.qty_producing > 0 && ` · ${mo.qty_producing}/${mo.qty} producing`}
          {mo.date_planned_finished && ` · due ${fmtDate(mo.date_planned_finished)}`}
        </span>
      )}
    </div>
  );
}

// ── By-Order view ─────────────────────────────────────────────────────────────

function OrderRow({ entry, navigate }) {
  const [expanded, setExpanded] = useState(false);
  const multiLine = entry.lines.length > 1;

  return (
    <tr className="border-b border-gray-100 hover:bg-gray-50 transition-colors">
      {/* Expand toggle (only when multiple lines) */}
      <td className="p-3 w-8">
        {multiLine ? (
          <button onClick={() => setExpanded(v => !v)} className="text-gray-400 hover:text-gray-600">
            {expanded ? <ChevronDown size={14} /> : <ChevronRight size={14} />}
          </button>
        ) : null}
      </td>

      {/* Sale order ref — links to Order Passport */}
      <td className="p-3 font-mono text-sm whitespace-nowrap">
        {entry.sale_order_id ? (
          <button
            onClick={() => navigate(`/orders/${entry.sale_order_id}/passport`)}
            className="text-bassani-700 hover:text-bassani-900 hover:underline font-medium flex items-center gap-1"
          >
            {entry.sale_order_name || `#${entry.sale_order_id}`}
            <ExternalLink size={11} className="text-bassani-400" />
          </button>
        ) : (
          <span className="text-gray-900">{entry.sale_order_name || "—"}</span>
        )}
      </td>

      {/* Backorder picking ref */}
      <td className="p-3 font-mono text-xs text-gray-500 whitespace-nowrap">
        {entry.picking_name}
      </td>

      {/* Customer */}
      <td className="p-3 text-sm text-gray-700 max-w-[180px] truncate">
        {entry.customer_name || "—"}
      </td>

      {/* Products outstanding */}
      <td className="p-3 min-w-[220px]">
        {expanded ? (
          <div className="space-y-0.5">
            {entry.lines.map((l, i) => <ProductRow key={i} line={l} />)}
          </div>
        ) : (
          <ProductRow line={entry.lines[0] || { product_name: "—", qty_outstanding: 0 }} />
        )}
        {!expanded && multiLine && (
          <button
            onClick={() => setExpanded(true)}
            className="text-[11px] text-bassani-600 hover:underline mt-0.5 block"
          >
            +{entry.lines.length - 1} more product{entry.lines.length > 2 ? "s" : ""}
          </button>
        )}
      </td>

      {/* State */}
      <td className="p-3 whitespace-nowrap">
        <StatePill state={entry.state} label={entry.state_label} />
      </td>

      {/* Expected date */}
      <td className="p-3 text-sm text-gray-500 whitespace-nowrap">
        {entry.scheduled_date ? fmtDate(entry.scheduled_date) : "—"}
      </td>

      {/* Linked ticket */}
      <td className="p-3 whitespace-nowrap">
        {entry.ticket ? (
          <button
            onClick={() => navigate(`/tickets/sales?ticket=${entry.ticket.ticket_id}`)}
            className="inline-flex items-center gap-1 text-xs text-bassani-600 hover:underline font-medium"
          >
            {entry.ticket.ref}
            <ExternalLink size={11} />
          </button>
        ) : (
          <span className="text-xs text-gray-300">—</span>
        )}
      </td>
    </tr>
  );
}

// ── By-Product view ───────────────────────────────────────────────────────────

function ProductGroupRow({ group, navigate }) {
  const [expanded, setExpanded] = useState(false);
  const hasMO = group.orders.some(o => o.mo);

  return (
    <>
      <tr className="border-b border-gray-100 hover:bg-gray-50 cursor-pointer transition-colors" onClick={() => setExpanded(v => !v)}>
        <td className="p-3 w-8">
          {expanded ? <ChevronDown size={14} className="text-gray-400" /> : <ChevronRight size={14} className="text-gray-400" />}
        </td>
        <td className="p-3 text-sm font-medium text-gray-900">{group.product_name}</td>
        <td className="p-3 text-sm font-semibold text-orange-600">
          {group.total_outstanding % 1 === 0 ? group.total_outstanding : group.total_outstanding.toFixed(2)} units
        </td>
        <td className="p-3 text-sm text-gray-500">{group.orders.length} order{group.orders.length !== 1 ? "s" : ""} waiting</td>
        <td className="p-3">
          {hasMO ? (
            <span className="text-[11px] text-blue-600 bg-blue-50 px-1.5 py-0.5 rounded font-medium">
              MO linked
            </span>
          ) : (
            <span className="text-xs text-gray-300">No MO</span>
          )}
        </td>
      </tr>
      {expanded && group.orders.map((o, i) => (
        <tr key={i} className="bg-gray-50 border-b border-gray-100">
          <td className="p-3" />
          <td className="p-3 pl-8 font-mono text-xs text-gray-600">{o.sale_order_name}</td>
          <td className="p-3 text-xs text-orange-600 font-medium">
            {o.qty % 1 === 0 ? o.qty : o.qty.toFixed(2)} outstanding
          </td>
          <td className="p-3 text-xs text-gray-500">{o.customer_name}</td>
          <td className="p-3">
            {o.ticket ? (
              <button
                onClick={e => { e.stopPropagation(); navigate(`/tickets/sales?ticket=${o.ticket.ticket_id}`); }}
                className="inline-flex items-center gap-1 text-xs text-bassani-600 hover:underline"
              >
                {o.ticket.ref} <ExternalLink size={10} />
              </button>
            ) : (
              <span className="text-xs text-gray-300">—</span>
            )}
          </td>
        </tr>
      ))}
    </>
  );
}

// ── Main view ─────────────────────────────────────────────────────────────────

export default function Backorders() {
  const navigate = useNavigate();
  const location = useLocation();
  const [data,    setData   ] = useState([]);
  const [loading, setLoading] = useState(true);
  const [groupBy, setGroupBy] = useState("order"); // "order" | "product"
  const [stateFilter, setStateFilter] = useState("");
  const [soFilter, setSoFilter] = useState(location.state?.soName || "");

  const load = async () => {
    setLoading(true);
    try {
      const r = await api.get("/api/orders/backorders");
      setData(r.data.backorders || []);
    } catch (e) {
      toast.error(e.response?.data?.detail || "Failed to load backorders");
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => { load(); }, []);

  const filtered = useMemo(() => {
    let d = soFilter ? data.filter(e => e.sale_order_name === soFilter) : data;
    return stateFilter ? d.filter(e => e.state === stateFilter) : d;
  }, [data, stateFilter, soFilter]);

  // Stats
  const totalProducts = useMemo(() => {
    const seen = new Set();
    data.forEach(e => e.lines.forEach(l => seen.add(l.product_id)));
    return seen.size;
  }, [data]);

  const hasMO = useMemo(() =>
    data.some(e => e.lines.some(l => l.manufacturing_order)),
    [data]
  );

  // Product-grouped data
  const productGroups = useMemo(() => {
    const map = new Map();
    filtered.forEach(entry => {
      entry.lines.forEach(line => {
        if (!map.has(line.product_id)) {
          map.set(line.product_id, {
            product_id: line.product_id,
            product_name: line.product_name,
            total_outstanding: 0,
            orders: [],
          });
        }
        const g = map.get(line.product_id);
        g.total_outstanding += Number(line.qty_outstanding || 0);
        g.orders.push({
          sale_order_name: entry.sale_order_name,
          customer_name:   entry.customer_name,
          qty:             Number(line.qty_outstanding || 0),
          ticket:          entry.ticket,
          mo:              line.manufacturing_order,
        });
      });
    });
    return Array.from(map.values()).sort((a, b) => b.total_outstanding - a.total_outstanding);
  }, [filtered]);

  const stateCounts = useMemo(() => {
    const c = { confirmed: 0, assigned: 0, waiting: 0 };
    data.forEach(e => { if (c[e.state] !== undefined) c[e.state]++; });
    return c;
  }, [data]);

  return (
    <div className="flex flex-col h-full overflow-hidden">
      <TopBar
        title="Backorders"
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
            { label: "Backorder Pickings", value: data.length, color: "text-orange-600" },
            { label: "Products Affected",  value: totalProducts, color: "text-gray-900" },
            { label: "Confirmed",          value: stateCounts.confirmed, color: "text-orange-500" },
            { label: "Ready to Ship",      value: stateCounts.assigned,  color: "text-green-600" },
          ].map(s => (
            <div key={s.label} className="bg-white rounded-xl border border-gray-200 p-4">
              <p className="text-xs text-gray-400 uppercase font-semibold tracking-wide mb-1">{s.label}</p>
              <p className={`text-2xl font-bold ${s.color}`}>{s.value}</p>
            </div>
          ))}
        </div>

        {/* MO note */}
        {hasMO && (
          <div className="bg-blue-50 border border-blue-200 rounded-xl px-4 py-3 text-sm text-blue-700">
            Some backorders have linked manufacturing orders. Phase 13 will add production scheduling directly from this view.
          </div>
        )}

        {/* SO filter chip — shown when arriving from Order Passport */}
        {soFilter && (
          <div className="flex items-center gap-3 bg-orange-50 border border-orange-200 rounded-xl px-4 py-2.5">
            <span className="text-sm text-orange-800">
              Backorders for <span className="font-mono font-semibold">{soFilter}</span>
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
            { key: "confirmed", label: `Confirmed (${stateCounts.confirmed})` },
            { key: "assigned",  label: `Ready (${stateCounts.assigned})` },
            { key: "waiting",   label: `Waiting (${stateCounts.waiting})` },
          ].filter(f => stateCounts[f.key] > 0).map(f => (
            <FilterPill key={f.key} label={f.label} active={stateFilter === f.key} onClick={() => setStateFilter(f.key)} />
          ))}
        </div>

        {/* Table */}
        <div className="bg-white rounded-xl border border-gray-200 overflow-hidden">
          {loading ? (
            <div className="py-16 text-center text-sm text-gray-400">Loading backorders…</div>
          ) : filtered.length === 0 ? (
            <div className="py-16 text-center">
              <p className="text-sm font-medium text-gray-500">No backorders</p>
              <p className="text-xs text-gray-400 mt-1">All customer orders are fully stocked.</p>
            </div>
          ) : groupBy === "order" ? (
            <div className="overflow-x-auto">
              <table className="w-full">
                <thead>
                  <tr className="bg-gray-50 border-b border-gray-200">
                    <th className="p-3 w-8" />
                    <th className="p-3 text-left text-xs font-semibold text-gray-400 uppercase tracking-wide">SO Ref</th>
                    <th className="p-3 text-left text-xs font-semibold text-gray-400 uppercase tracking-wide">Picking</th>
                    <th className="p-3 text-left text-xs font-semibold text-gray-400 uppercase tracking-wide">Customer</th>
                    <th className="p-3 text-left text-xs font-semibold text-gray-400 uppercase tracking-wide">Outstanding</th>
                    <th className="p-3 text-left text-xs font-semibold text-gray-400 uppercase tracking-wide">State</th>
                    <th className="p-3 text-left text-xs font-semibold text-gray-400 uppercase tracking-wide">Expected</th>
                    <th className="p-3 text-left text-xs font-semibold text-gray-400 uppercase tracking-wide">Ticket</th>
                  </tr>
                </thead>
                <tbody>
                  {filtered.map(entry => (
                    <OrderRow key={entry.picking_id} entry={entry} navigate={navigate} />
                  ))}
                </tbody>
              </table>
            </div>
          ) : (
            <div className="overflow-x-auto">
              <table className="w-full">
                <thead>
                  <tr className="bg-gray-50 border-b border-gray-200">
                    <th className="p-3 w-8" />
                    <th className="p-3 text-left text-xs font-semibold text-gray-400 uppercase tracking-wide">Product</th>
                    <th className="p-3 text-left text-xs font-semibold text-gray-400 uppercase tracking-wide">Total Outstanding</th>
                    <th className="p-3 text-left text-xs font-semibold text-gray-400 uppercase tracking-wide">Orders Waiting</th>
                    <th className="p-3 text-left text-xs font-semibold text-gray-400 uppercase tracking-wide">Manufacturing Order</th>
                  </tr>
                </thead>
                <tbody>
                  {productGroups.map(g => (
                    <ProductGroupRow key={g.product_id} group={g} navigate={navigate} />
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
