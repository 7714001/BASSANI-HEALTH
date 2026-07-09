import { useState, useEffect, useRef, useMemo } from "react";
import { Search, X, Package, Loader2, CheckCircle2 } from "lucide-react";
import api from "../api";
import { fmtR } from "./UI";

export default function ProductPickerDrawer({ open, onClose, warehouseId, onAdd }) {
  const [categories,      setCategories     ] = useState([]);
  const [catLoaded,       setCatLoaded      ] = useState(false);
  const [selectedCat,     setSelectedCat    ] = useState(null);
  const [search,          setSearch         ] = useState("");
  const [products,        setProducts       ] = useState([]);
  const [loading,         setLoading        ] = useState(false);
  const [selectedVariant, setSelectedVariant] = useState(null);
  const [addedIds,        setAddedIds       ] = useState(new Set());
  const debounceRef = useRef(null);
  const searchRef   = useRef(null);

  // Load categories once on first open
  useEffect(() => {
    if (!open || catLoaded) return;
    api.get("/api/products/categories", { params: warehouseId ? { warehouse_id: warehouseId } : {} })
      .then(r => setCategories(r.data.categories || []))
      .catch(() => {})
      .finally(() => setCatLoaded(true));
  }, [open, catLoaded, warehouseId]);

  // Focus search on open; reset state on close
  useEffect(() => {
    if (open) {
      setTimeout(() => searchRef.current?.focus(), 60);
    } else {
      setSearch("");
      setSelectedCat(null);
      setSelectedVariant(null);
      setProducts([]);
      setAddedIds(new Set());
    }
  }, [open]);

  // Fetch products whenever search or category changes
  useEffect(() => {
    if (!open) return;
    if (debounceRef.current) clearTimeout(debounceRef.current);

    const q = search.trim();
    if (!q && !selectedCat) {
      setProducts([]);
      setSelectedVariant(null);
      return;
    }

    const delay = q ? 300 : 0;
    debounceRef.current = setTimeout(async () => {
      setLoading(true);
      setSelectedVariant(null);
      try {
        const params = { limit: 150 };
        if (warehouseId) params.warehouse_id = warehouseId;
        if (q)           params.search       = q;
        if (selectedCat) params.category_id  = selectedCat;
        const r = await api.get("/api/products/", { params });
        setProducts(r.data.products || []);
      } catch {
        setProducts([]);
      } finally {
        setLoading(false);
      }
    }, delay);

    return () => clearTimeout(debounceRef.current);
  }, [open, search, selectedCat, warehouseId]);

  // Derive unique variant labels from the current product set
  const variants = useMemo(() => {
    const seen = new Set();
    products.forEach(p => {
      const m = (p.display_name || p.name || "").match(/\((.+)\)$/);
      if (m) seen.add(m[1]);
    });
    return [...seen].sort();
  }, [products]);

  // Client-side variant filter on top of the API results
  const displayed = useMemo(() => {
    if (!selectedVariant) return products;
    return products.filter(p =>
      (p.display_name || p.name || "").includes(`(${selectedVariant})`)
    );
  }, [products, selectedVariant]);

  const handleAdd = (product) => {
    onAdd(product);
    setAddedIds(prev => new Set([...prev, product.id]));
    setTimeout(() => {
      setAddedIds(prev => {
        const next = new Set(prev);
        next.delete(product.id);
        return next;
      });
    }, 1800);
  };

  if (!open) return null;

  const activeCatName = selectedCat
    ? (categories.find(c => c.id === selectedCat)?.name ?? "")
    : "";

  return (
    <div className="fixed inset-0 z-50 flex justify-end">
      {/* Backdrop */}
      <div
        className="absolute inset-0 bg-black/25 backdrop-blur-[1px]"
        onClick={onClose}
      />

      {/* Drawer panel */}
      <div className="relative w-[520px] max-w-full bg-white h-full flex flex-col shadow-2xl">

        {/* ── Header ── */}
        <div className="flex items-center justify-between px-5 py-4 border-b border-gray-100 shrink-0">
          <div>
            <h2 className="text-sm font-bold text-gray-900">Browse Products</h2>
            <p className="text-xs text-gray-400 mt-0.5">
              Select a category or search to add lines to the quote
            </p>
          </div>
          <button
            onClick={onClose}
            className="text-gray-400 hover:text-gray-600 transition-colors p-1.5 rounded-lg hover:bg-gray-100"
          >
            <X size={15} />
          </button>
        </div>

        {/* ── Search bar ── */}
        <div className="px-4 pt-3.5 pb-3 border-b border-gray-50 shrink-0">
          <div className="relative">
            <Search size={13} className="absolute left-3 top-1/2 -translate-y-1/2 text-gray-400 pointer-events-none" />
            <input
              ref={searchRef}
              type="text"
              value={search}
              onChange={e => setSearch(e.target.value)}
              placeholder="Search by product name or SKU…"
              className="w-full text-sm pl-9 pr-8 py-2.5 border border-gray-200 rounded-xl focus:outline-none focus:ring-2 focus:ring-bassani-200 focus:border-bassani-400 bg-white placeholder-gray-400"
            />
            {search && (
              <button
                onClick={() => setSearch("")}
                className="absolute right-3 top-1/2 -translate-y-1/2 text-gray-300 hover:text-gray-500 transition-colors"
              >
                <X size={12} />
              </button>
            )}
          </div>
        </div>

        {/* ── Category pills ── */}
        {categories.length > 0 && (
          <div className="px-4 py-3 border-b border-gray-50 shrink-0">
            <p className="text-[10px] font-semibold text-gray-400 uppercase tracking-wide mb-2">
              Category
            </p>
            <div className="flex flex-wrap gap-1.5">
              <button
                onClick={() => { setSelectedCat(null); setSelectedVariant(null); }}
                className={`text-xs px-3 py-1.5 rounded-full font-medium transition-colors border ${
                  !selectedCat
                    ? "bg-bassani-600 text-white border-bassani-600"
                    : "bg-white text-gray-600 border-gray-200 hover:border-bassani-300 hover:text-bassani-700"
                }`}
              >
                All
              </button>
              {categories.map(c => (
                <button
                  key={c.id}
                  onClick={() => { setSelectedCat(c.id); setSelectedVariant(null); }}
                  className={`text-xs px-3 py-1.5 rounded-full font-medium transition-colors border ${
                    selectedCat === c.id
                      ? "bg-bassani-600 text-white border-bassani-600"
                      : "bg-white text-gray-600 border-gray-200 hover:border-bassani-300 hover:text-bassani-700"
                  }`}
                >
                  {c.name}
                </button>
              ))}
            </div>
          </div>
        )}

        {/* ── Variant chips (only when multiple variants present in results) ── */}
        {variants.length > 1 && (
          <div className="px-4 py-2.5 border-b border-gray-50 bg-gray-50/60 shrink-0">
            <p className="text-[10px] font-semibold text-gray-400 uppercase tracking-wide mb-1.5">
              Variant
            </p>
            <div className="flex flex-wrap gap-1.5">
              <button
                onClick={() => setSelectedVariant(null)}
                className={`text-xs px-2.5 py-1 rounded-full font-medium transition-colors border ${
                  !selectedVariant
                    ? "bg-gray-700 text-white border-gray-700"
                    : "bg-white text-gray-500 border-gray-200 hover:border-gray-400"
                }`}
              >
                All variants
              </button>
              {variants.map(v => (
                <button
                  key={v}
                  onClick={() => setSelectedVariant(v === selectedVariant ? null : v)}
                  className={`text-xs px-2.5 py-1 rounded-full font-medium transition-colors border ${
                    selectedVariant === v
                      ? "bg-gray-700 text-white border-gray-700"
                      : "bg-white text-gray-500 border-gray-200 hover:border-gray-400"
                  }`}
                >
                  {v}
                </button>
              ))}
            </div>
          </div>
        )}

        {/* ── Results ── */}
        <div className="flex-1 overflow-y-auto">

          {/* Prompt state — nothing selected yet */}
          {!loading && !selectedCat && !search.trim() && (
            <div className="flex flex-col items-center justify-center h-full text-center px-10 py-16">
              <div className="w-12 h-12 bg-gray-100 rounded-2xl flex items-center justify-center mb-3">
                <Package size={20} className="text-gray-400" />
              </div>
              <p className="text-sm font-semibold text-gray-500">Select a category or search</p>
              <p className="text-xs text-gray-400 mt-1 leading-relaxed">
                Choose a product category from the filters above, or type a name or SKU to search across all products.
              </p>
            </div>
          )}

          {/* Loading */}
          {loading && (
            <div className="flex items-center justify-center py-16">
              <Loader2 size={18} className="animate-spin text-gray-300" />
            </div>
          )}

          {/* No results */}
          {!loading && (selectedCat || search.trim()) && displayed.length === 0 && (
            <div className="flex flex-col items-center justify-center py-16 text-center px-8">
              <p className="text-sm font-semibold text-gray-500">No products found</p>
              <p className="text-xs text-gray-400 mt-1">
                {selectedVariant
                  ? "Try clearing the variant filter or adjusting your search."
                  : "Try a different category or search term."}
              </p>
            </div>
          )}

          {/* Product list */}
          {!loading && displayed.length > 0 && (
            <div className="divide-y divide-gray-50">
              {displayed.map(p => {
                const fullName   = p.display_name || p.name || "";
                const bracketIdx = fullName.indexOf(" (");
                const base       = bracketIdx !== -1 ? fullName.slice(0, bracketIdx) : fullName;
                const variant    = bracketIdx !== -1 ? fullName.slice(bracketIdx + 2, -1) : null;
                const stock      = Math.max(0, Math.floor(p.virtual_available || 0));
                const inStock    = stock > 0;
                const added      = addedIds.has(p.id);

                return (
                  <div
                    key={p.id}
                    className="flex items-start justify-between px-5 py-3.5 hover:bg-slate-50/70 transition-colors"
                  >
                    <div className="min-w-0 flex-1 pr-4">
                      <p className="text-sm font-semibold text-gray-900 leading-tight">{base}</p>
                      <div className="flex items-center gap-2 mt-1 flex-wrap">
                        {variant && (
                          <span className="text-[10px] bg-bassani-50 text-bassani-700 rounded px-1.5 py-0.5 font-medium leading-none">
                            {variant}
                          </span>
                        )}
                        {p.default_code && (
                          <span className="text-[10px] font-mono text-gray-400 leading-none">
                            {p.default_code}
                          </span>
                        )}
                      </div>
                      <div className="flex items-center gap-2 mt-1.5">
                        <span className={`text-[10px] font-medium ${inStock ? "text-green-600" : "text-red-500"}`}>
                          {inStock ? `${stock} in stock` : "Out of stock"}
                        </span>
                        {p.tax_rate > 0 && (
                          <span className="text-[10px] text-gray-400">+{p.tax_rate}% VAT</span>
                        )}
                      </div>
                    </div>

                    <div className="flex flex-col items-end gap-2 shrink-0">
                      <p className="text-sm font-bold text-gray-900">{fmtR(p.list_price)}</p>
                      <button
                        disabled={!inStock}
                        onClick={() => handleAdd(p)}
                        className={`text-xs font-semibold px-3 py-1.5 rounded-lg transition-all flex items-center gap-1.5 min-w-[62px] justify-center ${
                          added
                            ? "bg-green-50 text-green-700 border border-green-200"
                            : inStock
                              ? "bg-bassani-600 hover:bg-bassani-700 text-white"
                              : "bg-gray-100 text-gray-400 cursor-not-allowed border border-gray-200"
                        }`}
                      >
                        {added
                          ? <><CheckCircle2 size={11} />Added</>
                          : "+ Add"
                        }
                      </button>
                    </div>
                  </div>
                );
              })}
            </div>
          )}
        </div>

        {/* ── Footer count ── */}
        {!loading && displayed.length > 0 && (
          <div className="px-5 py-2.5 border-t border-gray-100 bg-gray-50/50 shrink-0">
            <p className="text-[10px] text-gray-400 text-center">
              {displayed.length} product{displayed.length !== 1 ? "s" : ""}
              {activeCatName ? ` in ${activeCatName}` : ""}
              {selectedVariant ? ` · ${selectedVariant}` : ""}
            </p>
          </div>
        )}
      </div>
    </div>
  );
}
