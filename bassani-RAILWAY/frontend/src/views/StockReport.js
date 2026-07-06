import { useState, useEffect, useCallback, useMemo } from "react";
import {
  Loader2, Search, X, ChevronLeft, Clock,
  AlertTriangle, CheckCircle2, AlertCircle,
} from "lucide-react";
import api from "../api";
import toast from "react-hot-toast";
import { TopBar, fmtDate, FilterPill } from "../components/UI";

const MOVE_LABELS = {
  receipt:        { label: "Received",           cls: "text-green-700 bg-green-50 border-green-200"    },
  delivery:       { label: "Dispatched",         cls: "text-red-700 bg-red-50 border-red-200"          },
  return:         { label: "Customer Return",    cls: "text-amber-700 bg-amber-50 border-amber-200"    },
  vendor_return:  { label: "Vendor Return",      cls: "text-orange-700 bg-orange-50 border-orange-200" },
  transfer:       { label: "Internal Transfer",  cls: "text-blue-700 bg-blue-50 border-blue-200"       },
  adjustment_in:  { label: "Adjustment (In)",    cls: "text-green-700 bg-green-50 border-green-200"    },
  adjustment_out: { label: "Adjustment (Out)",   cls: "text-red-700 bg-red-50 border-red-200"          },
  consumed:       { label: "Used in Production", cls: "text-purple-700 bg-purple-50 border-purple-200" },
  produced:       { label: "Manufactured",       cls: "text-teal-700 bg-teal-50 border-teal-200"       },
  other:          { label: "Other",              cls: "text-gray-600 bg-gray-50 border-gray-200"       },
};

const INBOUND_TYPES = new Set(["receipt", "adjustment_in", "produced", "return"]);

function StatCard({ label, value, sub, accent }) {
  return (
    <div className={`rounded-xl border px-4 py-3.5 flex flex-col gap-0.5 ${
      accent
        ? "bg-bassani-50/60 border-bassani-200"
        : "bg-white border-gray-100"
    }`}>
      <p className="text-xs font-medium text-gray-500">{label}</p>
      <p className={`text-2xl font-bold tracking-tight ${accent ? "text-bassani-700" : "text-gray-900"}`}>
        {value}
      </p>
      {sub && <p className="text-xs text-gray-400">{sub}</p>}
    </div>
  );
}

export default function StockReport() {
  const [products,         setProducts        ] = useState([]);
  const [loading,          setLoading         ] = useState(true);
  const [search,           setSearch          ] = useState("");
  const [categoryFilter,   setCategoryFilter  ] = useState("All");
  const [statusFilter,     setStatusFilter    ] = useState("all");

  const [selectedProduct,  setSelectedProduct ] = useState(null);
  const [lots,             setLots            ] = useState([]);
  const [lotsLoading,      setLotsLoading     ] = useState(false);
  const [lotExpiryFilter,  setLotExpiryFilter ] = useState("all");
  const [lotStatusFilter,  setLotStatusFilter ] = useState("all");

  const [historyLot,       setHistoryLot      ] = useState(null);
  const [movements,        setMovements       ] = useState([]);
  const [movementsLoading, setMovementsLoading] = useState(false);

  const loadProducts = useCallback(async () => {
    setLoading(true);
    try {
      const r = await api.get("/api/stock-report", { params: { limit: 500 } });
      setProducts(r.data.items || []);
    } catch {
      toast.error("Failed to load stock report");
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => { loadProducts(); }, [loadProducts]);

  // ── Derived values ─────────────────────────────────────────────────────────

  const categories = useMemo(() => {
    const cats = [...new Set(products.map(p => p.category).filter(Boolean))].sort();
    return ["All", ...cats];
  }, [products]);

  const stats = useMemo(() => ({
    products:  products.length,
    onHand:    products.reduce((s, p) => s + p.qty_onhand,    0),
    reserved:  products.reduce((s, p) => s + p.qty_reserved,  0),
    available: products.reduce((s, p) => s + p.qty_available, 0),
  }), [products]);

  const filtered = useMemo(() => {
    let rows = products;
    if (search) {
      const sl = search.toLowerCase();
      rows = rows.filter(p =>
        p.product_name.toLowerCase().includes(sl) ||
        (p.product_ref || "").toLowerCase().includes(sl) ||
        (p.category    || "").toLowerCase().includes(sl)
      );
    }
    if (categoryFilter !== "All") {
      rows = rows.filter(p => p.category === categoryFilter);
    }
    if (statusFilter === "available") {
      rows = rows.filter(p => p.qty_available > 0);
    } else if (statusFilter === "reserved") {
      rows = rows.filter(p => p.qty_available <= 0);
    }
    return rows;
  }, [products, search, categoryFilter, statusFilter]);

  const lotExpiryStats = useMemo(() => {
    const now  = new Date();
    const soon = new Date(now.getTime() + 90 * 24 * 60 * 60 * 1000);
    return {
      expiring: lots.filter(l => l.expiry_date && new Date(l.expiry_date) > now  && new Date(l.expiry_date) <= soon).length,
      expired:  lots.filter(l => l.expiry_date && new Date(l.expiry_date) < now).length,
    };
  }, [lots]);

  const filteredLots = useMemo(() => {
    const now  = new Date();
    const soon = new Date(now.getTime() + 90 * 24 * 60 * 60 * 1000);
    let rows = lots;
    if (lotExpiryFilter === "expiring") {
      rows = rows.filter(l => l.expiry_date && new Date(l.expiry_date) > now && new Date(l.expiry_date) <= soon);
    } else if (lotExpiryFilter === "expired") {
      rows = rows.filter(l => l.expiry_date && new Date(l.expiry_date) < now);
    }
    if (lotStatusFilter === "available") {
      rows = rows.filter(l => l.qty_available > 0);
    } else if (lotStatusFilter === "reserved") {
      rows = rows.filter(l => l.qty_available <= 0);
    }
    return rows;
  }, [lots, lotExpiryFilter, lotStatusFilter]);

  // ── Actions ────────────────────────────────────────────────────────────────

  const openLots = async (product) => {
    setSelectedProduct(product);
    setLots([]);
    setHistoryLot(null);
    setLotExpiryFilter("all");
    setLotStatusFilter("all");
    setLotsLoading(true);
    try {
      const r = await api.get(`/api/stock-report/${product.product_id}/lots`);
      setLots(r.data.lots || []);
    } catch {
      toast.error("Failed to load lot breakdown");
    } finally {
      setLotsLoading(false);
    }
  };

  const openHistory = async (lot) => {
    setHistoryLot(lot);
    setMovements([]);
    setMovementsLoading(true);
    try {
      const r = await api.get(`/api/stock-report/lots/${lot.lot_id}/movements`);
      setMovements(r.data.movements || []);
    } catch {
      toast.error("Failed to load movement history");
    } finally {
      setMovementsLoading(false);
    }
  };

  const backToProducts = () => { setSelectedProduct(null); setLots([]); setHistoryLot(null); };
  const closeHistory   = () => { setHistoryLot(null); setMovements([]); };

  function fmtNum(n) {
    const v = Math.round(n * 100) / 100;
    return Number.isInteger(v) ? v.toString() : v.toFixed(2);
  }

  // ── Product list ───────────────────────────────────────────────────────────
  if (!selectedProduct) {
    return (
      <div className="flex flex-col flex-1 overflow-hidden">
        <TopBar
          title="Stock Report"
          subtitle="Current on-hand positions by product, lot, and location"
        />

        {/* Stats + filters panel */}
        <div className="px-6 pt-4 pb-3 bg-white border-b border-gray-100 shrink-0 space-y-3">
          {/* Stat cards */}
          {!loading && (
            <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
              <StatCard
                label="Products on hand"
                value={stats.products}
              />
              <StatCard
                label="Total units on hand"
                value={fmtNum(stats.onHand)}
                accent
              />
              <StatCard
                label="Units reserved"
                value={fmtNum(stats.reserved)}
                sub="Committed to open orders"
              />
              <StatCard
                label="Available to promise"
                value={fmtNum(stats.available)}
                sub={stats.available > 0 ? "Ready to allocate" : "Fully committed"}
              />
            </div>
          )}

          {/* Search */}
          <div className="relative max-w-sm">
            <Search size={14} className="absolute left-3 top-1/2 -translate-y-1/2 text-gray-400 pointer-events-none" />
            <input
              value={search}
              onChange={e => setSearch(e.target.value)}
              placeholder="Search product, reference, or category…"
              className="w-full pl-8 pr-8 py-2 text-sm border border-gray-200 rounded-xl outline-none focus:border-bassani-400 focus:ring-2 focus:ring-bassani-100"
            />
            {search && (
              <button onClick={() => setSearch("")} className="absolute right-3 top-1/2 -translate-y-1/2 text-gray-400 hover:text-gray-600">
                <X size={13} />
              </button>
            )}
          </div>

          {/* Category + status filter chips */}
          {!loading && categories.length > 2 && (
            <div className="flex items-center gap-1.5 flex-wrap">
              {categories.map(cat => (
                <FilterPill
                  key={cat}
                  label={cat}
                  active={categoryFilter === cat}
                  onClick={() => setCategoryFilter(cat)}
                />
              ))}
              <span className="w-px h-4 bg-gray-200 mx-0.5" />
              <FilterPill
                label="Available"
                active={statusFilter === "available"}
                onClick={() => setStatusFilter(s => s === "available" ? "all" : "available")}
              />
              <FilterPill
                label="Fully Reserved"
                active={statusFilter === "reserved"}
                onClick={() => setStatusFilter(s => s === "reserved" ? "all" : "reserved")}
              />
            </div>
          )}
        </div>

        {/* Table */}
        <div className="flex-1 overflow-y-auto p-6 bg-gray-50">
          {loading ? (
            <div className="flex items-center justify-center h-48">
              <Loader2 size={22} className="animate-spin text-bassani-500" />
            </div>
          ) : filtered.length === 0 ? (
            <div className="text-center py-20 text-gray-400 text-sm">
              {search || categoryFilter !== "All" || statusFilter !== "all"
                ? "No products match the active filters."
                : "No stock on hand."}
            </div>
          ) : (
            <div className="bg-white rounded-2xl border border-gray-100 overflow-hidden">
              <div className="px-5 py-2.5 border-b border-gray-100 flex items-center">
                <p className="text-xs text-gray-500">
                  Showing{" "}
                  <span className="font-semibold text-gray-700">{filtered.length}</span>
                  {filtered.length !== products.length && (
                    <> of <span className="font-semibold text-gray-700">{products.length}</span></>
                  )}{" "}
                  product{filtered.length === 1 ? "" : "s"}
                </p>
              </div>
              <table className="w-full text-sm">
                <thead>
                  <tr className="border-b border-gray-100 bg-gray-50/60">
                    <th className="text-left px-5 py-3 text-xs font-semibold text-gray-500 uppercase tracking-wide">Product</th>
                    <th className="text-left px-4 py-3 text-xs font-semibold text-gray-500 uppercase tracking-wide hidden sm:table-cell">Category</th>
                    <th className="text-right px-4 py-3 text-xs font-semibold text-gray-500 uppercase tracking-wide">On Hand</th>
                    <th className="text-right px-4 py-3 text-xs font-semibold text-gray-500 uppercase tracking-wide hidden md:table-cell">Reserved</th>
                    <th className="text-right px-4 py-3 text-xs font-semibold text-gray-500 uppercase tracking-wide">Available</th>
                    <th className="text-center px-4 py-3 text-xs font-semibold text-gray-500 uppercase tracking-wide">Lots</th>
                    <th className="px-5 py-3" />
                  </tr>
                </thead>
                <tbody className="divide-y divide-gray-50">
                  {filtered.map(p => (
                    <tr
                      key={p.product_id}
                      onClick={() => openLots(p)}
                      className="hover:bg-bassani-50/30 cursor-pointer transition-colors group"
                    >
                      <td className="px-5 py-3.5">
                        <p className="font-medium text-gray-900 group-hover:text-bassani-700 transition-colors">{p.product_name}</p>
                        {p.product_ref && <p className="text-xs text-gray-400 mt-0.5 font-mono">{p.product_ref}</p>}
                      </td>
                      <td className="px-4 py-3.5 hidden sm:table-cell">
                        {p.category
                          ? <span className="inline-flex items-center px-2 py-0.5 rounded-md text-xs font-medium bg-gray-100 text-gray-600">{p.category}</span>
                          : <span className="text-xs text-gray-300">—</span>}
                      </td>
                      <td className="px-4 py-3.5 text-right">
                        <span className="font-semibold text-gray-900">{fmtNum(p.qty_onhand)}</span>
                        {p.uom_name && <span className="text-xs text-gray-400 ml-1">{p.uom_name}</span>}
                      </td>
                      <td className="px-4 py-3.5 text-right text-gray-500 hidden md:table-cell">
                        {fmtNum(p.qty_reserved)}
                        {p.uom_name && <span className="text-xs text-gray-400 ml-1">{p.uom_name}</span>}
                      </td>
                      <td className="px-4 py-3.5 text-right">
                        <span className={`inline-flex items-center gap-1 font-medium ${p.qty_available > 0 ? "text-green-700" : "text-red-600"}`}>
                          {p.qty_available > 0
                            ? <CheckCircle2 size={12} />
                            : <AlertCircle size={12} />}
                          {fmtNum(p.qty_available)}
                        </span>
                      </td>
                      <td className="px-4 py-3.5 text-center">
                        <span className="inline-flex items-center justify-center w-7 h-7 rounded-lg bg-bassani-50 text-bassani-700 text-xs font-bold">
                          {p.lot_count}
                        </span>
                      </td>
                      <td className="px-5 py-3.5 text-right text-xs text-bassani-600 font-medium whitespace-nowrap opacity-0 group-hover:opacity-100 transition-opacity">
                        View lots →
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </div>
      </div>
    );
  }

  // ── Lot breakdown ──────────────────────────────────────────────────────────
  return (
    <div className="flex flex-col flex-1 overflow-hidden">
      <TopBar
        title={selectedProduct.product_name}
        subtitle={`${lots.length} lot${lots.length === 1 ? "" : "s"} · ${fmtNum(selectedProduct.qty_onhand)} on hand · ${fmtNum(selectedProduct.qty_available)} available${selectedProduct.uom_name ? " " + selectedProduct.uom_name : ""}`}
        actions={
          <button
            onClick={backToProducts}
            className="flex items-center gap-1.5 text-sm text-gray-600 hover:text-gray-900 transition-colors px-3 py-1.5 rounded-lg hover:bg-gray-100"
          >
            <ChevronLeft size={15} />
            Stock Report
          </button>
        }
      />

      {/* Lot filters */}
      <div className="px-6 py-3 bg-white border-b border-gray-100 flex items-center gap-1.5 flex-wrap shrink-0">
        <FilterPill label="All lots"      active={lotExpiryFilter === "all"}      onClick={() => setLotExpiryFilter("all")} />
        <FilterPill
          label={`Expiring soon${lotExpiryStats.expiring > 0 ? ` (${lotExpiryStats.expiring})` : ""}`}
          active={lotExpiryFilter === "expiring"}
          onClick={() => setLotExpiryFilter(f => f === "expiring" ? "all" : "expiring")}
        />
        <FilterPill
          label={`Expired${lotExpiryStats.expired > 0 ? ` (${lotExpiryStats.expired})` : ""}`}
          active={lotExpiryFilter === "expired"}
          onClick={() => setLotExpiryFilter(f => f === "expired" ? "all" : "expired")}
        />
        <span className="w-px h-4 bg-gray-200 mx-0.5" />
        <FilterPill
          label="Available"
          active={lotStatusFilter === "available"}
          onClick={() => setLotStatusFilter(f => f === "available" ? "all" : "available")}
        />
        <FilterPill
          label="Fully Reserved"
          active={lotStatusFilter === "reserved"}
          onClick={() => setLotStatusFilter(f => f === "reserved" ? "all" : "reserved")}
        />
      </div>

      <div className="flex-1 overflow-y-auto p-6 bg-gray-50">
        {lotsLoading ? (
          <div className="flex items-center justify-center h-48">
            <Loader2 size={22} className="animate-spin text-bassani-500" />
          </div>
        ) : filteredLots.length === 0 ? (
          <div className="text-center py-20 text-gray-400 text-sm">
            {lots.length === 0 ? "No lots found for this product." : "No lots match the active filters."}
          </div>
        ) : (
          <div className="bg-white rounded-2xl border border-gray-100 overflow-hidden">
            {filteredLots.length !== lots.length && (
              <div className="px-5 py-2.5 border-b border-gray-100">
                <p className="text-xs text-gray-500">
                  Showing <span className="font-semibold text-gray-700">{filteredLots.length}</span> of{" "}
                  <span className="font-semibold text-gray-700">{lots.length}</span> lots
                </p>
              </div>
            )}
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b border-gray-100 bg-gray-50/60">
                  <th className="text-left px-5 py-3 text-xs font-semibold text-gray-500 uppercase tracking-wide">Lot / Batch</th>
                  <th className="text-left px-4 py-3 text-xs font-semibold text-gray-500 uppercase tracking-wide hidden sm:table-cell">Location</th>
                  <th className="text-right px-4 py-3 text-xs font-semibold text-gray-500 uppercase tracking-wide">On Hand</th>
                  <th className="text-right px-4 py-3 text-xs font-semibold text-gray-500 uppercase tracking-wide hidden md:table-cell">Reserved</th>
                  <th className="text-right px-4 py-3 text-xs font-semibold text-gray-500 uppercase tracking-wide">Available</th>
                  <th className="text-left px-4 py-3 text-xs font-semibold text-gray-500 uppercase tracking-wide hidden lg:table-cell">Received</th>
                  <th className="text-left px-4 py-3 text-xs font-semibold text-gray-500 uppercase tracking-wide hidden lg:table-cell">Expiry</th>
                  <th className="px-5 py-3" />
                </tr>
              </thead>
              <tbody className="divide-y divide-gray-50">
                {filteredLots.map((lot, idx) => {
                  const now      = new Date();
                  const soon     = new Date(now.getTime() + 90 * 24 * 60 * 60 * 1000);
                  const expDate  = lot.expiry_date ? new Date(lot.expiry_date) : null;
                  const isExpired      = expDate && expDate < now;
                  const isExpiringSoon = expDate && !isExpired && expDate <= soon;
                  return (
                    <tr
                      key={`${lot.lot_id}-${idx}`}
                      className={`hover:bg-gray-50 transition-colors ${isExpired ? "bg-red-50/20" : ""}`}
                    >
                      <td className="px-5 py-3.5">
                        <p className="font-mono font-medium text-gray-900 text-sm">{lot.lot_name}</p>
                        {lot.lot_ref && <p className="text-xs text-gray-400 mt-0.5">{lot.lot_ref}</p>}
                      </td>
                      <td className="px-4 py-3.5 text-xs text-gray-500 hidden sm:table-cell">{lot.location || "—"}</td>
                      <td className="px-4 py-3.5 text-right font-semibold text-gray-900">{fmtNum(lot.qty_onhand)}</td>
                      <td className="px-4 py-3.5 text-right text-gray-500 hidden md:table-cell">{fmtNum(lot.qty_reserved)}</td>
                      <td className="px-4 py-3.5 text-right">
                        <span className={`font-medium ${lot.qty_available > 0 ? "text-green-700" : "text-red-600"}`}>
                          {fmtNum(lot.qty_available)}
                        </span>
                      </td>
                      <td className="px-4 py-3.5 text-xs text-gray-500 hidden lg:table-cell">
                        {lot.in_date ? fmtDate(lot.in_date) : "—"}
                      </td>
                      <td className="px-4 py-3.5 hidden lg:table-cell">
                        {expDate ? (
                          <span className={`inline-flex items-center gap-1 px-2 py-0.5 rounded-md text-xs font-medium border ${
                            isExpired
                              ? "text-red-700 bg-red-50 border-red-200"
                              : isExpiringSoon
                              ? "text-amber-700 bg-amber-50 border-amber-200"
                              : "text-gray-600 bg-gray-50 border-gray-200"
                          }`}>
                            {(isExpired || isExpiringSoon) && <AlertTriangle size={10} />}
                            {fmtDate(lot.expiry_date)}
                          </span>
                        ) : <span className="text-xs text-gray-400">—</span>}
                      </td>
                      <td className="px-5 py-3.5 text-right">
                        {lot.lot_id && (
                          <button
                            onClick={() => openHistory(lot)}
                            className="inline-flex items-center gap-1.5 text-xs text-bassani-600 hover:text-bassani-800 font-medium transition-colors"
                          >
                            <Clock size={12} />
                            History
                          </button>
                        )}
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        )}
      </div>

      {/* Movement history modal */}
      {historyLot && (
        <div
          className="fixed inset-0 z-50 flex items-end sm:items-center justify-center p-4 bg-black/40"
          onClick={closeHistory}
        >
          <div
            className="bg-white rounded-2xl shadow-xl w-full max-w-2xl max-h-[80vh] flex flex-col overflow-hidden"
            onClick={e => e.stopPropagation()}
          >
            <div className="flex items-center justify-between px-5 py-4 border-b border-gray-100 shrink-0">
              <div>
                <p className="font-bold text-gray-900 text-sm">Movement History</p>
                <p className="text-xs text-gray-400 font-mono mt-0.5">{historyLot.lot_name}</p>
              </div>
              <button
                onClick={closeHistory}
                className="p-1.5 rounded-lg hover:bg-gray-100 text-gray-400 hover:text-gray-600 transition-colors"
              >
                <X size={16} />
              </button>
            </div>

            <div className="overflow-y-auto flex-1 p-5">
              {movementsLoading ? (
                <div className="flex items-center justify-center h-32">
                  <Loader2 size={20} className="animate-spin text-bassani-500" />
                </div>
              ) : movements.length === 0 ? (
                <p className="text-center text-sm text-gray-400 py-10">No movement history found for this lot.</p>
              ) : (
                <div className="space-y-2">
                  {movements.map((m, i) => {
                    const ml    = MOVE_LABELS[m.move_type] || MOVE_LABELS.other;
                    const isIn  = INBOUND_TYPES.has(m.move_type);
                    return (
                      <div key={i} className="flex items-start gap-3 p-3.5 rounded-xl border border-gray-100 bg-gray-50/60">
                        <div className="flex-1 min-w-0">
                          <div className="flex items-center gap-2 flex-wrap">
                            <span className={`inline-flex items-center px-2 py-0.5 rounded-md text-[11px] font-semibold border ${ml.cls}`}>
                              {ml.label}
                            </span>
                            <span className={`text-xs font-bold ${isIn ? "text-green-700" : "text-red-600"}`}>
                              {isIn ? "+" : "–"}{fmtNum(m.qty)} units
                            </span>
                            {m.reference && (
                              <span className="text-xs text-gray-400 font-mono truncate">{m.reference}</span>
                            )}
                          </div>
                          <p className="text-[11px] text-gray-500 mt-1.5 leading-relaxed">
                            {m.from_location} → {m.to_location}
                          </p>
                        </div>
                        <p className="text-[11px] text-gray-400 shrink-0 mt-0.5">{fmtDate(m.date)}</p>
                      </div>
                    );
                  })}
                </div>
              )}
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
