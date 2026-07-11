import { useState, useEffect, useRef, useMemo } from "react";
import { Search, X, Package, Loader2, CheckCircle2, ChevronDown } from "lucide-react";
import api from "../api";
import { fmtR, parseDisplayName } from "./UI";

// ── Searchable dropdown select ────────────────────────────────────────────────
function SearchableSelect({ value, onChange, options, placeholder, searchPlaceholder, disabled }) {
  const [open, setOpen]   = useState(false);
  const [query, setQuery] = useState("");
  const containerRef      = useRef(null);
  const inputRef          = useRef(null);

  // Close on outside click
  useEffect(() => {
    if (!open) return;
    const handler = (e) => {
      if (containerRef.current && !containerRef.current.contains(e.target)) setOpen(false);
    };
    document.addEventListener("mousedown", handler);
    return () => document.removeEventListener("mousedown", handler);
  }, [open]);

  // Close on Escape
  useEffect(() => {
    if (!open) return;
    const handler = (e) => { if (e.key === "Escape") setOpen(false); };
    document.addEventListener("keydown", handler);
    return () => document.removeEventListener("keydown", handler);
  }, [open]);

  // Focus search input when panel opens; clear query on close
  useEffect(() => {
    if (open) setTimeout(() => inputRef.current?.focus(), 30);
    else setQuery("");
  }, [open]);

  const selectedLabel = value != null ? (options.find(o => o.value === value)?.label ?? null) : null;
  const filtered = options.filter(o => o.label.toLowerCase().includes(query.toLowerCase()));

  return (
    <div ref={containerRef} className="relative">
      {/* Trigger */}
      <button
        type="button"
        disabled={disabled}
        onClick={() => { if (!disabled) setOpen(v => !v); }}
        className={[
          "flex items-center gap-1.5 text-xs font-medium px-3 py-2 rounded-lg border transition-colors whitespace-nowrap",
          disabled
            ? "text-gray-300 border-gray-100 bg-gray-50 cursor-not-allowed"
            : value != null
              ? "text-bassani-700 border-bassani-300 bg-bassani-50"
              : "text-gray-600 border-gray-200 bg-white hover:border-gray-300 hover:text-gray-700",
        ].join(" ")}
      >
        <span className="max-w-[140px] truncate">
          {selectedLabel ?? placeholder}
        </span>
        {value != null ? (
          <span
            role="button"
            tabIndex={0}
            onClick={(e) => { e.stopPropagation(); onChange(null); }}
            onKeyDown={(e) => { if (e.key === "Enter" || e.key === " ") { e.stopPropagation(); onChange(null); } }}
            className="ml-0.5 text-bassani-400 hover:text-bassani-700 transition-colors cursor-pointer"
            aria-label="Clear selection"
          >
            <X size={11} />
          </span>
        ) : (
          <ChevronDown
            size={11}
            className={`shrink-0 transition-transform duration-150 ${open ? "rotate-180" : ""}`}
          />
        )}
      </button>

      {/* Dropdown panel */}
      {open && (
        <div className="absolute top-full left-0 mt-1.5 w-60 bg-white border border-gray-200 rounded-xl shadow-xl z-10 overflow-hidden">
          {/* Search input */}
          <div className="p-2 border-b border-gray-100">
            <div className="relative">
              <Search size={11} className="absolute left-2.5 top-1/2 -translate-y-1/2 text-gray-400 pointer-events-none" />
              <input
                ref={inputRef}
                type="text"
                value={query}
                onChange={e => setQuery(e.target.value)}
                placeholder={searchPlaceholder}
                className="w-full text-xs pl-7 pr-3 py-1.5 border border-gray-200 rounded-lg focus:outline-none focus:ring-1 focus:ring-bassani-300 focus:border-bassani-400 placeholder-gray-400 bg-gray-50/50"
              />
            </div>
          </div>

          {/* Option list */}
          <div className="max-h-56 overflow-y-auto py-1">
            {/* "All" row — only show when not filtering by query */}
            {!query && (
              <button
                type="button"
                onClick={() => { onChange(null); setOpen(false); }}
                className={[
                  "w-full text-left px-3 py-2 text-xs transition-colors flex items-center justify-between",
                  value == null
                    ? "bg-bassani-50 text-bassani-700 font-semibold"
                    : "text-gray-500 hover:bg-gray-50",
                ].join(" ")}
              >
                All
                {value == null && <CheckCircle2 size={11} className="text-bassani-500 shrink-0" />}
              </button>
            )}

            {filtered.length === 0 && (
              <p className="text-xs text-gray-400 text-center py-3 px-3">No matches</p>
            )}

            {filtered.map(o => (
              <button
                key={o.value}
                type="button"
                onClick={() => { onChange(o.value); setOpen(false); }}
                className={[
                  "w-full text-left px-3 py-2 text-xs transition-colors flex items-center justify-between",
                  value === o.value
                    ? "bg-bassani-50 text-bassani-700 font-semibold"
                    : "text-gray-700 hover:bg-gray-50",
                ].join(" ")}
              >
                <span className="truncate pr-2">{o.label}</span>
                {value === o.value && <CheckCircle2 size={11} className="text-bassani-500 shrink-0" />}
              </button>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}

// ── Main drawer ───────────────────────────────────────────────────────────────
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

  // Category options for the select
  const categoryOptions = useMemo(
    () => categories.map(c => ({ value: c.id, label: c.name })),
    [categories]
  );

  // Derive unique variant labels from the current product set
  const variantOptions = useMemo(() => {
    const seen = new Set();
    products.forEach(p => {
      const m = (p.display_name || p.name || "").match(/\((.+)\)$/);
      if (m) seen.add(m[1]);
    });
    return [...seen].sort().map(v => ({ value: v, label: v }));
  }, [products]);

  // Client-side variant filter + in-stock-first sort
  const displayed = useMemo(() => {
    const list = selectedVariant
      ? products.filter(p => (p.display_name || p.name || "").includes(`(${selectedVariant})`))
      : products;
    return [...list].sort((a, b) => {
      const aIn = (a.virtual_available || 0) > 0;
      const bIn = (b.virtual_available || 0) > 0;
      return aIn === bIn ? 0 : aIn ? -1 : 1;
    });
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
              Search or filter by category and variant to add lines to the quote
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
        <div className="px-4 pt-3.5 pb-3 shrink-0">
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

        {/* ── Filter bar ── */}
        <div className="flex items-center gap-2 px-4 pb-3 border-b border-gray-100 shrink-0">
          <SearchableSelect
            value={selectedCat}
            onChange={(v) => { setSelectedCat(v); setSelectedVariant(null); }}
            options={categoryOptions}
            placeholder="All categories"
            searchPlaceholder="Search categories…"
            disabled={false}
          />
          <SearchableSelect
            value={selectedVariant}
            onChange={setSelectedVariant}
            options={variantOptions}
            placeholder="All variants"
            searchPlaceholder="Search variants…"
            disabled={variantOptions.length === 0}
          />
        </div>

        {/* ── Results ── */}
        <div className="flex-1 overflow-y-auto">

          {/* Prompt state */}
          {!loading && !selectedCat && !search.trim() && (
            <div className="flex flex-col items-center justify-center h-full text-center px-10 py-16">
              <div className="w-12 h-12 bg-gray-100 rounded-2xl flex items-center justify-center mb-3">
                <Package size={20} className="text-gray-400" />
              </div>
              <p className="text-sm font-semibold text-gray-500">Select a category or search</p>
              <p className="text-xs text-gray-400 mt-1 leading-relaxed">
                Choose a category from the filter above, or type a name or SKU to search across all products.
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
                const { base, groups } = parseDisplayName(p.display_name || p.name || "");
                const stock            = Math.max(0, Math.floor(p.virtual_available || 0));
                const inStock          = stock > 0;
                const added            = addedIds.has(p.id);

                return (
                  <div
                    key={p.id}
                    className="flex items-start justify-between px-5 py-3.5 hover:bg-slate-50/70 transition-colors"
                  >
                    <div className="min-w-0 flex-1 pr-4">
                      <p className="text-sm font-semibold text-gray-900 leading-tight">{base}</p>
                      <div className="flex items-center gap-2 mt-1 flex-wrap">
                        {groups.map((g, i) => (
                          <span key={i} className="text-[10px] bg-bassani-50 text-bassani-700 rounded px-1.5 py-0.5 font-medium leading-none">
                            {g}
                          </span>
                        ))}
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
                        {added ? <><CheckCircle2 size={11} />Added</> : "+ Add"}
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
