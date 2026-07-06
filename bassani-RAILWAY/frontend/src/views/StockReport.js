import { useState, useEffect, useCallback } from "react";
import { Loader2, Search, X, ChevronLeft, Clock, AlertTriangle } from "lucide-react";
import api from "../api";
import toast from "react-hot-toast";
import { TopBar, fmtDate } from "../components/UI";

const MOVE_LABELS = {
  receipt:        { label: "Received",              cls: "text-green-700 bg-green-50 border-green-200"   },
  delivery:       { label: "Dispatched",            cls: "text-red-700 bg-red-50 border-red-200"         },
  return:         { label: "Customer Return",       cls: "text-amber-700 bg-amber-50 border-amber-200"   },
  vendor_return:  { label: "Vendor Return",         cls: "text-orange-700 bg-orange-50 border-orange-200"},
  transfer:       { label: "Internal Transfer",     cls: "text-blue-700 bg-blue-50 border-blue-200"      },
  adjustment_in:  { label: "Adjustment (In)",       cls: "text-green-700 bg-green-50 border-green-200"   },
  adjustment_out: { label: "Adjustment (Out)",      cls: "text-red-700 bg-red-50 border-red-200"         },
  consumed:       { label: "Used in Production",    cls: "text-purple-700 bg-purple-50 border-purple-200"},
  produced:       { label: "Manufactured",          cls: "text-teal-700 bg-teal-50 border-teal-200"      },
  other:          { label: "Other",                 cls: "text-gray-600 bg-gray-50 border-gray-200"      },
};

export default function StockReport() {
  const [products,         setProducts        ] = useState([]);
  const [total,            setTotal           ] = useState(0);
  const [loading,          setLoading         ] = useState(true);
  const [search,           setSearch          ] = useState("");

  const [selectedProduct,  setSelectedProduct ] = useState(null);
  const [lots,             setLots            ] = useState([]);
  const [lotsLoading,      setLotsLoading     ] = useState(false);

  const [historyLot,       setHistoryLot      ] = useState(null);
  const [movements,        setMovements       ] = useState([]);
  const [movementsLoading, setMovementsLoading] = useState(false);

  const loadProducts = useCallback(async () => {
    setLoading(true);
    try {
      const r = await api.get("/api/stock-report", {
        params: { search: search || undefined, limit: 300 },
      });
      setProducts(r.data.items || []);
      setTotal(r.data.total   || 0);
    } catch {
      toast.error("Failed to load stock report");
    } finally {
      setLoading(false);
    }
  }, [search]);

  useEffect(() => {
    const t = setTimeout(loadProducts, search ? 350 : 0);
    return () => clearTimeout(t);
  }, [loadProducts, search]);

  const openLots = async (product) => {
    setSelectedProduct(product);
    setLots([]);
    setHistoryLot(null);
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

  const backToProducts = () => {
    setSelectedProduct(null);
    setLots([]);
    setHistoryLot(null);
  };

  const closeHistory = () => {
    setHistoryLot(null);
    setMovements([]);
  };

  // ── Products list ──────────────────────────────────────────────────────────
  if (!selectedProduct) {
    return (
      <div className="flex flex-col flex-1 overflow-hidden">
        <TopBar
          title="Stock Report"
          subtitle={`${total} product${total === 1 ? "" : "s"} with stock on hand`}
        />

        <div className="px-6 py-3 bg-white border-b border-gray-100 flex items-center gap-3 shrink-0">
          <div className="relative max-w-sm w-full">
            <Search size={14} className="absolute left-3 top-1/2 -translate-y-1/2 text-gray-400 pointer-events-none" />
            <input
              value={search}
              onChange={e => setSearch(e.target.value)}
              placeholder="Search by product name, ref, or category…"
              className="w-full pl-8 pr-8 py-2 text-sm border border-gray-200 rounded-xl outline-none focus:border-bassani-400 focus:ring-2 focus:ring-bassani-100"
            />
            {search && (
              <button onClick={() => setSearch("")} className="absolute right-3 top-1/2 -translate-y-1/2 text-gray-400 hover:text-gray-600">
                <X size={13} />
              </button>
            )}
          </div>
        </div>

        <div className="flex-1 overflow-y-auto p-6 bg-gray-50">
          {loading ? (
            <div className="flex items-center justify-center h-48">
              <Loader2 size={22} className="animate-spin text-bassani-500" />
            </div>
          ) : products.length === 0 ? (
            <div className="text-center py-20 text-gray-400 text-sm">
              {search ? "No products match your search." : "No stock on hand."}
            </div>
          ) : (
            <div className="bg-white rounded-2xl border border-gray-100 overflow-hidden">
              <table className="w-full text-sm">
                <thead>
                  <tr className="border-b border-gray-100 bg-gray-50/80">
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
                  {products.map(p => (
                    <tr
                      key={p.product_id}
                      onClick={() => openLots(p)}
                      className="hover:bg-gray-50 cursor-pointer transition-colors"
                    >
                      <td className="px-5 py-3.5">
                        <p className="font-medium text-gray-900">{p.product_name}</p>
                        {p.product_ref && <p className="text-xs text-gray-400 mt-0.5 font-mono">{p.product_ref}</p>}
                      </td>
                      <td className="px-4 py-3.5 text-xs text-gray-500 hidden sm:table-cell">{p.category || "—"}</td>
                      <td className="px-4 py-3.5 text-right font-semibold text-gray-900">{p.qty_onhand}</td>
                      <td className="px-4 py-3.5 text-right text-gray-500 hidden md:table-cell">{p.qty_reserved}</td>
                      <td className="px-4 py-3.5 text-right">
                        <span className={`font-medium ${p.qty_available > 0 ? "text-green-700" : "text-red-600"}`}>
                          {p.qty_available}
                        </span>
                      </td>
                      <td className="px-4 py-3.5 text-center">
                        <span className="inline-flex items-center justify-center w-7 h-7 rounded-lg bg-bassani-50 text-bassani-700 text-xs font-bold">
                          {p.lot_count}
                        </span>
                      </td>
                      <td className="px-5 py-3.5 text-right text-xs text-bassani-600 font-medium whitespace-nowrap">
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
        subtitle={`${lots.length} lot${lots.length === 1 ? "" : "s"} · ${selectedProduct.qty_onhand} units on hand`}
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

      <div className="flex-1 overflow-y-auto p-6 bg-gray-50">
        {lotsLoading ? (
          <div className="flex items-center justify-center h-48">
            <Loader2 size={22} className="animate-spin text-bassani-500" />
          </div>
        ) : lots.length === 0 ? (
          <div className="text-center py-20 text-gray-400 text-sm">No lots found for this product.</div>
        ) : (
          <div className="bg-white rounded-2xl border border-gray-100 overflow-hidden">
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b border-gray-100 bg-gray-50/80">
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
                {lots.map((lot, idx) => {
                  const isExpired = lot.expiry_date && new Date(lot.expiry_date) < new Date();
                  return (
                    <tr key={`${lot.lot_id}-${idx}`} className="hover:bg-gray-50 transition-colors">
                      <td className="px-5 py-3.5">
                        <p className="font-medium text-gray-900 font-mono text-sm">{lot.lot_name}</p>
                        {lot.lot_ref && <p className="text-xs text-gray-400 mt-0.5">{lot.lot_ref}</p>}
                      </td>
                      <td className="px-4 py-3.5 text-xs text-gray-500 hidden sm:table-cell">{lot.location || "—"}</td>
                      <td className="px-4 py-3.5 text-right font-semibold text-gray-900">{lot.qty_onhand}</td>
                      <td className="px-4 py-3.5 text-right text-gray-500 hidden md:table-cell">{lot.qty_reserved}</td>
                      <td className="px-4 py-3.5 text-right">
                        <span className={`font-medium ${lot.qty_available > 0 ? "text-green-700" : "text-red-600"}`}>
                          {lot.qty_available}
                        </span>
                      </td>
                      <td className="px-4 py-3.5 text-xs text-gray-500 hidden lg:table-cell">
                        {lot.in_date ? fmtDate(lot.in_date) : "—"}
                      </td>
                      <td className="px-4 py-3.5 hidden lg:table-cell">
                        {lot.expiry_date ? (
                          <span className={`inline-flex items-center gap-1 text-xs font-medium ${isExpired ? "text-red-600" : "text-gray-600"}`}>
                            {isExpired && <AlertTriangle size={11} />}
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
          className="fixed inset-0 z-50 flex items-end sm:items-center justify-center p-4 bg-black/30"
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
                    const ml = MOVE_LABELS[m.move_type] || MOVE_LABELS.other;
                    const sign = ["receipt", "adjustment_in", "produced", "return"].includes(m.move_type) ? "+" : "-";
                    return (
                      <div key={i} className="flex items-start gap-3 p-3.5 rounded-xl border border-gray-100 bg-gray-50">
                        <div className="flex-1 min-w-0">
                          <div className="flex items-center gap-2 flex-wrap">
                            <span className={`inline-flex items-center px-2 py-0.5 rounded-md text-[11px] font-semibold border ${ml.cls}`}>
                              {ml.label}
                            </span>
                            <span className="text-xs font-bold text-gray-900">{sign}{m.qty} units</span>
                            {m.reference && (
                              <span className="text-xs text-gray-400 font-mono">{m.reference}</span>
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
