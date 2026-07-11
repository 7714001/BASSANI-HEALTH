// ─────────────────────────────────────────────────────────────────────────────
// Shared product line row — used by the Sales Ticket quote builder and the
// reseller order cart. Each row fires its own debounced Odoo search so
// results are always live and catalogue size is never a constraint (no
// preload, no item cap). Stock is resolved server-side: pass `warehouseId`
// to pin a specific vault (quote builder), or omit it to let the backend
// resolve the current user's own warehouse automatically (reseller cart).
// ─────────────────────────────────────────────────────────────────────────────
import { useState, useEffect, useRef, useLayoutEffect } from "react";
import { createPortal } from "react-dom";
import { X } from "lucide-react";
import api from "../api";
import { fmtR, parseDisplayName } from "./UI";

export default function ProductLineRow({ line, onUpdate, onRemove, autoFocus, warehouseId }) {
  const [prodSearch, setProdSearch]     = useState(line._product_label || "");
  const [dropdownOpen, setDropdownOpen] = useState(false);
  const [searching, setSearching]       = useState(false);
  const [searchResults, setSearchResults] = useState([]);
  const [dropdownRect, setDropdownRect] = useState(null);
  const debounceRef = useRef(null);
  const inputWrapRef = useRef(null);

  // The line-items table sits inside an `overflow-x-auto` card (needed for
  // mobile horizontal scroll — Phase 10.4). A plain `position: absolute`
  // dropdown gets clipped by that ancestor's scroll box instead of floating
  // above the page. Rendering it through a portal at document.body, positioned
  // from the input's real screen coordinates, escapes that clipping entirely.
  useLayoutEffect(() => {
    if (!dropdownOpen) return;
    const updateRect = () => {
      if (!inputWrapRef.current) return;
      const r = inputWrapRef.current.getBoundingClientRect();
      setDropdownRect({ top: r.bottom + 4, left: r.left });
    };
    updateRect();
    window.addEventListener("scroll", updateRect, true);
    window.addEventListener("resize", updateRect);
    return () => {
      window.removeEventListener("scroll", updateRect, true);
      window.removeEventListener("resize", updateRect);
    };
  }, [dropdownOpen]);

  useEffect(() => {
    if (debounceRef.current) clearTimeout(debounceRef.current);
    const q = prodSearch.trim();
    if (q.length < 2) { setSearchResults([]); return; }
    debounceRef.current = setTimeout(async () => {
      setSearching(true);
      try {
        const params = { search: q, limit: 30 };
        if (warehouseId) params.warehouse_id = warehouseId;
        const r = await api.get("/api/products/", { params });
        const raw = r.data.products || [];
        raw.sort((a, b) => {
          const aIn = (a.virtual_available || 0) > 0;
          const bIn = (b.virtual_available || 0) > 0;
          return aIn === bIn ? 0 : aIn ? -1 : 1;
        });
        setSearchResults(raw);
        setDropdownOpen(true);
      } catch {
        setSearchResults([]);
      } finally {
        setSearching(false);
      }
    }, 300);
    return () => clearTimeout(debounceRef.current);
  }, [prodSearch, warehouseId]); // eslint-disable-line

  const selectProduct = (p) => {
    const label    = p.display_name || p.name;
    const baseName = parseDisplayName(label).base;
    const stock    = Math.max(0, Math.floor(p.virtual_available || 0));
    setProdSearch(label);
    setDropdownOpen(false);
    onUpdate({
      product_id:          p.id,
      _product_label:      label,
      name:                p.description_sale || baseName,
      _description_sale:   p.description_sale || "",
      price_unit:          p.list_price || 0,
      _tax_rate:           p.tax_rate   || 0,
      _sku:                p.default_code || "",
      _stock:              stock,
      product_uom_qty:     1,
    });
  };

  const inStockBadge = (p) => {
    const qty = p.virtual_available || 0;
    return qty > 0
      ? <span className="text-[10px] text-green-600 font-medium">{Math.floor(qty)} in stock</span>
      : <span className="text-[10px] text-red-500 font-medium">Out of stock</span>;
  };

  return (
    <tr className="border-b border-gray-100 group hover:bg-slate-50/50 transition-colors">

      {/* ── Product — search input until selected, then pill display ── */}
      <td className="p-2.5 relative">
        {line.product_id ? (() => {
          const { base, groups } = parseDisplayName(line._product_label || line.name || "");
          return (
            <div className="flex items-start justify-between gap-1">
              <div className="min-w-0 flex-1">
                <p className="text-sm font-medium text-gray-900 leading-tight">{base}</p>
                {(groups.length > 0 || line._sku) && (
                  <div className="flex items-center gap-1.5 mt-1 flex-wrap">
                    {groups.map((g, i) => (
                      <span key={i} className="text-[10px] bg-bassani-50 text-bassani-700 rounded px-1.5 py-0.5 font-medium leading-none">{g}</span>
                    ))}
                    {line._sku && (
                      <span className="text-[10px] font-mono text-gray-400 leading-none">{line._sku}</span>
                    )}
                  </div>
                )}
              </div>
              <button
                onClick={() => {
                  setProdSearch("");
                  setSearchResults([]);
                  onUpdate({ product_id: null, _product_label: "", name: "", _description_sale: "", price_unit: 0, _tax_rate: 0, _stock: 0, _sku: "" });
                }}
                title="Change product"
                className="text-gray-300 hover:text-red-400 transition-colors flex-shrink-0 mt-0.5"
              >
                <X size={13} />
              </button>
            </div>
          );
        })() : (
          <>
            <div ref={inputWrapRef} className="relative">
              <input
                autoFocus={autoFocus}
                value={prodSearch}
                onChange={e => {
                  const v = e.target.value;
                  setProdSearch(v);
                  if (!v) {
                    setSearchResults([]);
                    setDropdownOpen(false);
                    onUpdate({ product_id: null, _product_label: "", name: "", price_unit: 0, _tax_rate: 0 });
                  }
                }}
                onFocus={() => { if (searchResults.length > 0) setDropdownOpen(true); }}
                onBlur={() => setTimeout(() => setDropdownOpen(false), 150)}
                placeholder="Type product name or SKU…"
                className="w-full text-sm bg-transparent border-0 focus:outline-none placeholder-gray-300"
              />
              {searching && (
                <span className="absolute right-2 top-1/2 -translate-y-1/2 text-[10px] text-gray-300 animate-pulse">searching…</span>
              )}
            </div>
            {dropdownOpen && searchResults.length > 0 && dropdownRect && createPortal(
              <div
                style={{ position: "fixed", top: dropdownRect.top, left: dropdownRect.left, width: 320 }}
                className="z-[9999] bg-white border border-gray-200 rounded-xl shadow-2xl max-h-64 overflow-y-auto"
              >
                {searchResults.map(p => {
                  const outOfStock = (p.virtual_available || 0) <= 0;
                  return (
                    <button
                      key={p.id}
                      onMouseDown={() => { if (!outOfStock) selectProduct(p); }}
                      disabled={outOfStock}
                      title={outOfStock ? "No forecasted stock — cannot add to quote" : undefined}
                      className={`w-full text-left px-3 py-2.5 flex items-start justify-between gap-3 border-b border-gray-50 last:border-0 transition-colors ${outOfStock ? "opacity-50 cursor-not-allowed bg-gray-50" : "hover:bg-bassani-50"}`}
                    >
                      <div className="min-w-0">
                        {(() => {
                          const { base, groups } = parseDisplayName(p.display_name || p.name || "");
                          return (
                            <>
                              <p className="text-sm font-medium text-gray-900">{base}</p>
                              {groups.length > 0 && (
                                <div className="flex flex-wrap gap-1 mt-0.5">
                                  {groups.map((g, i) => (
                                    <span key={i} className="text-[10px] bg-bassani-50 text-bassani-700 rounded px-1.5 py-0.5 font-medium leading-none">{g}</span>
                                  ))}
                                </div>
                              )}
                            </>
                          );
                        })()}
                        {p.default_code && <p className="text-[10px] font-mono text-gray-400 mt-0.5">{p.default_code}</p>}
                        {p.description_sale && <p className="text-[10px] text-gray-500 mt-0.5 line-clamp-2">{p.description_sale}</p>}
                      </div>
                      <div className="text-right shrink-0">
                        <p className="text-xs font-semibold text-gray-800">{fmtR(p.list_price)}</p>
                        {inStockBadge(p)}
                      </div>
                    </button>
                  );
                })}
              </div>,
              document.body
            )}
          </>
        )}
      </td>

      {/* ── Description ── */}
      <td className="p-2.5">
        <input
          value={line.name}
          onChange={e => onUpdate({ name: e.target.value })}
          placeholder="Description…"
          className="w-full text-sm bg-transparent border-0 focus:outline-none placeholder-gray-300 text-gray-600"
        />
      </td>

      {/* ── Qty ── */}
      <td className="p-2 w-24">
        {(() => {
          const noStock = line.product_id && line._stock === 0;
          const maxQty  = line._stock > 0 ? line._stock : null;
          const atMax   = maxQty !== null && line.product_uom_qty >= maxQty;
          const overMax = maxQty !== null && line.product_uom_qty > maxQty;
          return (
            <div>
              <input
                type="number"
                min="1"
                step="1"
                max={maxQty ?? undefined}
                value={line.product_uom_qty}
                onChange={e => {
                  const v = parseFloat(e.target.value) || 1;
                  onUpdate({ product_uom_qty: maxQty ? Math.min(v, maxQty) : v });
                }}
                className={`w-full text-sm text-center border rounded-lg px-2 py-1.5 focus:outline-none focus:ring-1 bg-white ${
                  noStock  ? "border-red-300 focus:ring-red-200 text-red-600" :
                  overMax  ? "border-red-400 focus:ring-red-300 text-red-600" :
                  atMax    ? "border-amber-300 focus:ring-amber-300" :
                             "border-gray-200 focus:ring-bassani-300"
                }`}
              />
              {noStock && (
                <p className="text-[10px] text-red-500 text-center mt-0.5 leading-none">0 available</p>
              )}
              {!noStock && atMax && (
                <p className="text-[10px] text-amber-500 text-center mt-0.5 leading-none">max available</p>
              )}
            </div>
          );
        })()}
      </td>

      {/* ── Unit Price ── */}
      <td className="p-2 w-36">
        <div className="flex items-center border border-gray-200 rounded-lg bg-white px-2 py-1.5 focus-within:ring-1 focus-within:ring-bassani-300">
          <span className="text-xs text-gray-400 mr-1 shrink-0">R</span>
          <input
            type="number"
            min="0"
            step="0.01"
            value={line.price_unit}
            onChange={e => onUpdate({ price_unit: parseFloat(e.target.value) || 0 })}
            className="w-full text-sm text-right border-0 bg-transparent focus:outline-none [appearance:textfield] [&::-webkit-outer-spin-button]:appearance-none [&::-webkit-inner-spin-button]:appearance-none"
          />
        </div>
      </td>

      {/* ── Tax % ── */}
      <td className="p-2 w-16 text-center">
        {line._tax_rate
          ? <span className="text-xs bg-slate-100 text-slate-500 rounded-full px-2 py-0.5 font-medium">{line._tax_rate}%</span>
          : <span className="text-xs text-gray-300">—</span>}
      </td>

      {/* ── Line subtotal ── */}
      <td className="p-2.5 w-36 text-right">
        <span className="text-sm font-semibold text-gray-900">
          {fmtR(line.product_uom_qty * line.price_unit)}
        </span>
      </td>

      {/* ── Remove ── */}
      <td className="p-2 w-8">
        <button
          onClick={onRemove}
          className="opacity-0 group-hover:opacity-100 text-gray-300 hover:text-red-400 transition-all p-0.5 rounded"
        >
          <X size={13} />
        </button>
      </td>
    </tr>
  );
}
