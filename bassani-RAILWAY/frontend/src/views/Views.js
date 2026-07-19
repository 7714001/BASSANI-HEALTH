// ─────────────────────────────────────────────────────────────────────────────
// Products view
// ─────────────────────────────────────────────────────────────────────────────
import { useState, useEffect, useCallback } from "react";
import { useAuth } from "../AuthContext";
import { useNavigate, useLocation } from "react-router-dom";
import api from "../api";
import toast from "react-hot-toast";
import { Plus, Edit2, Archive, Trash2, ChevronDown, Loader2, PackageSearch, History, FileText, Download, Mail, Percent, X, Layers, Link2 } from "lucide-react";
import OrderView from "./OrderView";
import GS1LabelModal from "../components/GS1LabelModal";
import GTINPickerModal from "../components/GTINPickerModal";
import {
  TopBar, Table, Tr, Td, DataTable, Modal, FormGroup, Input, Select, Textarea,
  BtnPrimary, BtnSecondary, BtnDanger, SearchBar, FilterPill, ChipRow,
  LoadingState, EmptyState, Badge, fmtR, fmtDate, parseDisplayName,
} from "../components/UI";


const MOVE_TYPE_META = {
  receipt:        { label: "Receipt",        cls: "bg-green-100 text-green-800"   },
  delivery:       { label: "Delivery",       cls: "bg-red-100 text-red-800"       },
  return:         { label: "Return",         cls: "bg-blue-100 text-blue-800"     },
  vendor_return:  { label: "Vendor Return",  cls: "bg-gray-100 text-gray-700"     },
  adjustment_in:  { label: "Adj. +",         cls: "bg-teal-100 text-teal-800"    },
  adjustment_out: { label: "Adj. −",         cls: "bg-amber-100 text-amber-800"  },
  transfer:       { label: "Transfer",       cls: "bg-purple-100 text-purple-800" },
  consumed:       { label: "MFG Consumed",   cls: "bg-orange-100 text-orange-800" },
  produced:       { label: "MFG Output",     cls: "bg-indigo-100 text-indigo-800" },
  other:          { label: "Other",          cls: "bg-gray-100 text-gray-500"     },
};
const MOVE_OUT_TYPES = new Set(["delivery", "adjustment_out", "consumed", "vendor_return"]);

// Stable variant key for filter pill deduplication — joins all attribute groups.
const getVariantLabel = (p) => {
  const { groups } = parseDisplayName((p.display_name || p.name) || "");
  return groups.length > 0 ? groups.join(" / ") : null;
};

export function Products() {
  const { user, can } = useAuth();
  const { search: locationSearch } = useLocation();
  const [products,   setProducts  ] = useState([]);
  const [total,      setTotal     ] = useState(0);
  const [loading,    setLoading   ] = useState(true);
  const [search,      setSearch     ] = useState(() => new URLSearchParams(locationSearch).get("q") || "");
  const [cat,         setCat        ] = useState("all");
  const [variant,     setVariant    ] = useState("all");
  const [stockFilter, setStockFilter] = useState("in_stock");
  const [categories, setCategories] = useState([]);
  const [catalog,    setCatalog   ] = useState(new Set());
  const [moq,        setMoqMap    ] = useState({});
  const [uoms,        setUoms       ] = useState([]);
  const [taxes,       setTaxes      ] = useState([]);
  const [modal,       setModal      ] = useState(false);
  const [editing,     setEditing    ] = useState(null);
  const [form,        setForm       ] = useState({ name:"", default_code:"", categ_id:"", list_price:"", standard_price:"", type:"product", description:"", uom_id:"", tax_id:"", barcode:"" });
  const [saving,      setSaving     ] = useState(false);
  const [archivingId,    setArchivingId   ] = useState(null);
  const [archiveConfirm, setArchiveConfirm] = useState(null);
  const [gs1Product,      setGs1Product     ] = useState(null);
  const [gtinPickerProduct, setGtinPickerProduct] = useState(null);
  const [pagination, setPagination] = useState({ pageIndex: 0, pageSize: 25 });
  const [sorting,    setSorting   ] = useState([{ id: "name", desc: false }]);

  // Stock reservation drill-down — explains On Hand vs Forecasted gaps
  const [reservationsModal,   setReservationsModal  ] = useState(false);
  const [reservationsProduct,setReservationsProduct ] = useState(null);
  const [reservations,       setReservations        ] = useState([]);
  const [reservationsLoading,setReservationsLoading ] = useState(false);
  const [viewingOrder,       setViewingOrder        ] = useState(null);
  const [viewingOrderId,     setViewingOrderId      ] = useState(null); // tracks which row is loading

  const [historyModal,   setHistoryModal  ] = useState(false);
  const [historyProduct, setHistoryProduct] = useState(null);
  const [historyMoves,   setHistoryMoves  ] = useState([]);
  const [historyLoading, setHistoryLoading] = useState(false);
  const [historyFrom,    setHistoryFrom   ] = useState("");
  const [historyTo,      setHistoryTo     ] = useState("");

  const [lotsModal,   setLotsModal  ] = useState(false);
  const [lotsProduct, setLotsProduct] = useState(null);
  const [lots,        setLots       ] = useState([]);
  const [lotsLoading, setLotsLoading] = useState(false);

  const openReservationOrder = async (orderId) => {
    setViewingOrderId(orderId);
    try {
      const r = await api.get(`/api/orders/${orderId}`);
      setViewingOrder(r.data);
    } catch {
      toast.error("Failed to load order");
    } finally {
      setViewingOrderId(null);
    }
  };

  const openReservations = async (p) => {
    setReservationsProduct(p);
    setReservationsModal(true);
    setReservationsLoading(true);
    try {
      const r = await api.get(`/api/products/${p.id}/reservations`);
      setReservations(r.data.reservations || []);
    } catch {
      toast.error("Failed to load stock reservations");
      setReservations([]);
    } finally {
      setReservationsLoading(false);
    }
  };

  const openHistory = async (p) => {
    setHistoryProduct(p);
    setHistoryModal(true);
    setHistoryLoading(true);
    try {
      const params = {};
      if (historyFrom) params.from_date = historyFrom;
      if (historyTo)   params.to_date   = historyTo;
      const r = await api.get(`/api/products/${p.id}/movements`, { params });
      setHistoryMoves(r.data.movements || []);
    } catch {
      toast.error("Failed to load stock movements");
      setHistoryMoves([]);
    } finally {
      setHistoryLoading(false);
    }
  };

  const openLots = async (p) => {
    setLotsProduct(p);
    setLotsModal(true);
    setLotsLoading(true);
    try {
      const r = await api.get(`/api/products/${p.id}/lots`);
      setLots(r.data.lots || []);
    } catch {
      toast.error("Failed to load lot breakdown");
      setLots([]);
    } finally {
      setLotsLoading(false);
    }
  };

  useEffect(() => {
    api.get("/api/products/uoms").then(r => setUoms(r.data.uoms || [])).catch(() => {});
    api.get("/api/products/taxes").then(r => setTaxes(r.data.taxes || [])).catch(() => {});
    api.get("/api/reseller-catalog/")
      .then(r => { setCatalog(new Set(r.data.product_ids || [])); setMoqMap(r.data.moq || {}); })
      .catch(() => {});
  }, []);

  useEffect(() => {
    const params = stockFilter === "in_stock" ? { in_stock_only: true } : {};
    api.get("/api/products/categories", { params })
      .then(r => setCategories(r.data.categories || []))
      .catch(() => {});
    setCat("all");
    setVariant("all");
  }, [stockFilter, user?.active_warehouse_id]);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const sort = sorting[0];
      const params = { limit: pagination.pageSize, offset: pagination.pageIndex * pagination.pageSize };
      if (sort) { params.sort_by = sort.id; params.sort_dir = sort.desc ? "desc" : "asc"; }
      if (search) params.search = search;
      if (cat !== "all") params.category = cat;
      if (stockFilter === "in_stock") params.in_stock_only = true;
      const r = await api.get("/api/products/", { params });
      setProducts(r.data.products); setTotal(r.data.total);
    } catch { toast.error("Failed to load products"); }
    finally { setLoading(false); }
  }, [search, cat, stockFilter, pagination, sorting, user?.active_warehouse_id]);

  useEffect(() => { load(); }, [load]);

  const stockColor = (qty) => qty <= 0 ? "text-red-600 font-semibold" : qty < 10 ? "text-amber-600 font-semibold" : "text-bassani-700 font-semibold";

  const toggleCatalog = async (productId) => {
    setCatalog(prev => { const n = new Set(prev); n.has(productId) ? n.delete(productId) : n.add(productId); return n; }); // optimistic
    try {
      const r = await api.post(`/api/reseller-catalog/toggle/${productId}`);
      setCatalog(new Set(r.data.product_ids));
    } catch { toast.error("Failed to update reseller catalog"); }
  };

  const saveMoq = async (productId, val) => {
    const v = Math.max(0, parseInt(val) || 0);
    setMoqMap(prev => ({ ...prev, [productId]: v }));
    const tid = toast.loading("Saving…");
    try {
      await api.put(`/api/reseller-catalog/${productId}/moq`, { moq: v });
      toast.success(v > 0 ? `Minimum order quantity set to ${v}` : "Minimum order quantity removed", { id: tid });
    } catch {
      toast.error("Failed to update minimum order quantity", { id: tid });
    }
  };


  const openNew = () => { setEditing(null); setForm({ name:"", default_code:"", categ_id:"", list_price:"", standard_price:"", type:"consu", description:"", stock_qty:"", uom_id:"", tax_id:"", barcode:"" }); setModal(true); };
  const openEdit = (p) => { setEditing(p); setForm({ name:p.name, default_code:p.default_code||"", categ_id:p.categ_id?.[0]||"", list_price:p.list_price, standard_price:p.standard_price, type:p.type, description:p.description||"", stock_qty:"", uom_id:p.uom_id?.[0]||"", tax_id:p.tax_id||"", barcode:p.barcode||"" }); setModal(true); };

  const save = async () => {
    if (!form.name) return toast.error("Product name required");
    setSaving(true);
    try {
      const payload = {
        ...form,
        list_price:     parseFloat(form.list_price)     || 0,
        standard_price: parseFloat(form.standard_price) || 0,
        categ_id:       form.categ_id ? parseInt(form.categ_id) : undefined,
        uom_id:         form.uom_id   ? parseInt(form.uom_id)   : undefined,
        tax_id:         form.tax_id   ? parseInt(form.tax_id)   : undefined,
      };
      let productId;
      if (editing) {
        await api.put(`/api/products/${editing.id}`, payload);
        productId = editing.id;
        toast.success("Product updated");
      } else {
        const r = await api.post("/api/products/", payload);
        productId = r.data.product_id;
        toast.success("Product created");
      }
      if (form.stock_qty !== "") {
        await api.post(`/api/products/${productId}/stock`, { qty: parseFloat(form.stock_qty) || 0 });
      }
      setModal(false); load();
    } catch (e) { toast.error(e.response?.data?.detail || "Save failed"); }
    finally { setSaving(false); }
  };

  const archive = (id) => {
    const p = products.find(pr => pr.id === id);
    setArchiveConfirm({ id, name: p?.name || "this product" });
  };

  const doArchive = async () => {
    const { id } = archiveConfirm;
    setArchiveConfirm(null);
    setArchivingId(id);
    try { await api.delete(`/api/products/${id}`); toast.success("Product archived"); load(); }
    catch { toast.error("Archive failed"); }
    finally { setArchivingId(null); }
  };

  return (
    <div className="flex flex-col flex-1 overflow-hidden">
      <TopBar title="Products" subtitle={`${total} products synced from Odoo`} onRefresh={load} showWarehouseSwitcher />
      <main className="flex-1 overflow-y-auto p-6">
        <div className="mb-4 space-y-2">
          {/* Search + compact stock toggle */}
          <div className="flex items-center gap-3">
            <div className="flex-1">
              <SearchBar value={search} onChange={v => { setSearch(v); setPagination(p => ({...p, pageIndex:0})); }} placeholder="Search products, SKU…" />
            </div>
            <div className="flex items-center bg-gray-100 rounded-xl p-0.5 shrink-0">
              <button
                onClick={() => { setLoading(true); setProducts([]); setStockFilter("in_stock"); setPagination(p => ({...p, pageIndex:0})); }}
                className={`text-xs font-medium px-3 py-1.5 rounded-lg transition-all whitespace-nowrap ${stockFilter === "in_stock" ? "bg-white text-gray-900 shadow-sm" : "text-gray-500 hover:text-gray-700"}`}
              >On Hand</button>
              <button
                onClick={() => { setLoading(true); setProducts([]); setStockFilter("all"); setPagination(p => ({...p, pageIndex:0})); }}
                className={`text-xs font-medium px-3 py-1.5 rounded-lg transition-all whitespace-nowrap ${stockFilter === "all" ? "bg-white text-gray-900 shadow-sm" : "text-gray-500 hover:text-gray-700"}`}
              >All</button>
            </div>
          </div>

          {/* Adaptive filter row — categories at top level, variants when drilled in */}
          <ChipRow>
            {cat === "all" ? (
              ["all", ...categories.map(c => c.name)].map(c => (
                <FilterPill key={c} label={c === "all" ? "All" : c} active={cat === c}
                  onClick={() => { setLoading(true); setProducts([]); setCat(c); setVariant("all"); setPagination(p => ({...p, pageIndex:0})); }} />
              ))
            ) : (
              <>
                {/* Active category as removable crumb — click anywhere to go back */}
                <button
                  onClick={() => { setLoading(true); setProducts([]); setCat("all"); setVariant("all"); setPagination(p => ({...p, pageIndex:0})); }}
                  className="inline-flex items-center gap-1.5 text-xs font-semibold px-3 py-1.5 rounded-full bg-bassani-600 text-white shrink-0 hover:bg-bassani-700 transition-colors"
                >
                  {cat} <X size={11} className="opacity-80" />
                </button>
                <span className="text-gray-200 select-none self-center">|</span>
                {(() => {
                  const opts = Array.from(new Set(products.map(p => getVariantLabel(p)).filter(Boolean))).sort();
                  if (opts.length === 0) return null;
                  return [
                    <FilterPill key="__all__" label="All variants" active={variant === "all"} onClick={() => setVariant("all")} />,
                    ...opts.map(v => <FilterPill key={v} label={v} active={variant === v} onClick={() => setVariant(v)} />)
                  ];
                })()}
              </>
            )}
          </ChipRow>
        </div>
        <DataTable
          columns={[
            { accessorKey:"name", header:"Product / SKU", cell:({ row:{original:p} }) => {
              const { base, groups } = parseDisplayName(p.display_name || p.name || "");
              return (
                <div>
                  <p className="font-medium text-gray-900">{base}</p>
                  {groups.length > 0 && (
                    <div className="flex flex-wrap gap-1 mt-0.5">
                      {groups.map((g, i) => (
                        <span key={i} className="inline-block text-[10px] bg-bassani-50 text-bassani-700 rounded px-1.5 py-0.5 font-medium leading-none">{g}</span>
                      ))}
                    </div>
                  )}
                  <p className="font-mono text-[10px] text-gray-400 mt-0.5">{p.default_code||"—"}</p>
                </div>
              );
            } },
            { accessorKey:"barcode", header:"Barcode", enableSorting:false, meta:{className:"hidden lg:table-cell"}, cell:({ row:{original:p} })=>{
              const isGtin = /^\d{13,14}$/.test(p.barcode || "");
              return (
                <div className="flex items-center gap-1.5" onClick={e => e.stopPropagation()}>
                  {p.barcode && <span className="font-mono text-xs text-gray-500">{p.barcode}</span>}
                  <button
                    onClick={() => setGtinPickerProduct(p)}
                    className="text-[11px] text-bassani-500 hover:text-bassani-700 font-medium transition-colors whitespace-nowrap"
                  >
                    {p.barcode ? "Edit" : "+ Set GTIN"}
                  </button>
                  {isGtin && can("labels.print") && (
                    <button
                      onClick={() => setGs1Product(p)}
                      className="text-[10px] font-bold px-1.5 py-0.5 rounded bg-bassani-50 text-bassani-700 hover:bg-bassani-100 border border-bassani-200 transition-colors leading-none"
                    >
                      GS1
                    </button>
                  )}
                </div>
              );
            }},
            { id:"category", header:"Category", enableSorting:false, meta:{className:"hidden md:table-cell"}, accessorFn:r=>r.categ_id?.[1]||"—", cell:({getValue})=><span className="text-xs text-gray-500">{getValue()}</span> },
            { accessorKey:"list_price", header:"Sale Price", meta:{className:"hidden sm:table-cell"}, cell:({ row:{original:p} })=><span className="font-semibold">{fmtR(p.list_price)}</span> },
            { accessorKey:"standard_price", header:"Cost", meta:{className:"hidden md:table-cell"}, cell:({ row:{original:p} })=><span className="text-gray-500">{fmtR(p.standard_price)}</span> },
            { accessorKey:"tax_rate", header:"Tax", enableSorting:false, meta:{className:"hidden md:table-cell"}, cell:({ row:{original:p} })=>
              (p.tax_rate ?? 0) > 0
                ? <span className="text-xs text-gray-500">{p.tax_rate}%</span>
                : <span className="text-xs text-amber-600" title="No Customer Tax configured on this product in Odoo">No tax set</span>
            },
            { accessorKey:"qty_available", header:"On Hand", enableSorting:false, cell:({ row:{original:p} })=>{ const q=p.qty_available??0; return <span className="flex items-center gap-1.5"><span className={stockColor(q)}>{q}</span><button onClick={e=>{e.stopPropagation();openHistory(p);}} title="View stock movement history" className="text-gray-400 hover:text-gray-600 transition-colors"><History size={13}/></button><button onClick={e=>{e.stopPropagation();openLots(p);}} title="View lot / batch breakdown" className="text-gray-400 hover:text-bassani-600 transition-colors"><Layers size={13}/></button></span>; } },
            { accessorKey:"virtual_available", header:"Forecasted", enableSorting:false, meta:{className:"hidden md:table-cell"}, cell:({ row:{original:p} })=>{
              const onHand = p.qty_available ?? 0;
              const forecasted = p.virtual_available ?? 0;
              const tiedUp = onHand - forecasted > 0.001;
              return (
                <span className="flex items-center gap-1.5">
                  <span className="text-gray-500">{forecasted}</span>
                  {tiedUp && (
                    <button onClick={e=>{e.stopPropagation();openReservations(p);}} title="See which orders this stock is tied up in"
                      className="text-amber-500 hover:text-amber-600 transition-colors">
                      <PackageSearch size={13} />
                    </button>
                  )}
                </span>
              );
            } },
            ...(can("products.manage") ? [{
              id:"catalog", header:"Reseller / MOQ", enableSorting:false, meta:{className:"hidden sm:table-cell"},
              cell:({ row:{original:p} }) => {
                const active = catalog.has(p.id);
                const moqVal = moq[p.id] || 0;
                return (
                  <div className="flex items-center gap-2" onClick={e => e.stopPropagation()}>
                    <button
                      role="switch"
                      aria-checked={active}
                      onClick={() => toggleCatalog(p.id)}
                      title={active ? "Remove from reseller catalog" : "Add to reseller catalog"}
                      className={`relative inline-flex h-5 w-9 shrink-0 cursor-pointer items-center rounded-full p-0.5 transition-colors duration-200 ease-in-out focus:outline-none focus-visible:ring-2 focus-visible:ring-bassani-500 focus-visible:ring-offset-1 ${active ? "bg-bassani-600" : "bg-gray-200"}`}>
                      <span className={`pointer-events-none h-4 w-4 transform rounded-full bg-white shadow-sm transition duration-200 ease-in-out ${active ? "translate-x-4" : "translate-x-0"}`} />
                    </button>
                    {active && (
                      <input
                        type="number"
                        min="0"
                        value={moqVal || ""}
                        placeholder="Min"
                        title="Minimum order quantity (leave blank for no minimum)"
                        onChange={e => setMoqMap(prev => ({ ...prev, [p.id]: parseInt(e.target.value) || 0 }))}
                        onBlur={e => saveMoq(p.id, e.target.value)}
                        onKeyDown={e => { if (e.key === "Enter") { e.target.blur(); } }}
                        className="w-16 text-xs text-center border border-gray-200 rounded-lg px-2 py-1 focus:outline-none focus:border-bassani-500 [appearance:textfield] [&::-webkit-outer-spin-button]:appearance-none [&::-webkit-inner-spin-button]:appearance-none"
                      />
                    )}
                  </div>
                );
              }
            }] : []),
            // Edit / archive actions hidden — product changes are made in Odoo and synced here.
            // Restore by uncommenting: ...(can("products.manage") ? [{ id:"actions", ... }] : []),
          ]}
          data={variant === "all" ? products : products.filter(p => getVariantLabel(p) === variant)} loading={loading} total={total}
          pagination={pagination} onPaginationChange={setPagination}
          sorting={sorting} onSortingChange={u=>{ setSorting(typeof u==="function"?u(sorting):u); setPagination(p=>({...p,pageIndex:0})); }}
          manualPagination manualSorting
        />
      </main>
      {modal && (
        <Modal title={editing?"Edit Product":"New Product"} onClose={()=>setModal(false)}>
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
            <FormGroup label="Product Name" required><Input value={form.name} onChange={e=>setForm({...form,name:e.target.value})} placeholder="e.g. Tincture 20ml THC" /></FormGroup>
            <FormGroup label="SKU / Reference"><Input value={form.default_code} onChange={e=>setForm({...form,default_code:e.target.value})} placeholder="THC-TINC-20" /></FormGroup>
            <FormGroup label="Barcode"><Input value={form.barcode} onChange={e=>setForm({...form,barcode:e.target.value})} placeholder="e.g. 6009123456789" /></FormGroup>
            <FormGroup label="Category"><Select value={form.categ_id} onChange={e=>setForm({...form,categ_id:parseInt(e.target.value)||""})}>
              <option value="">— Select category —</option>
              {categories.map(c=><option key={c.id} value={c.id}>{c.name}</option>)}
            </Select></FormGroup>
            <FormGroup label="Unit of Measure"><Select value={form.uom_id} onChange={e=>setForm({...form,uom_id:parseInt(e.target.value)||""})}>
              <option value="">— Select unit —</option>
              {uoms.map(u=><option key={u.id} value={u.id}>{u.name}</option>)}
            </Select></FormGroup>
            <FormGroup label="Tax">
              <Select value={form.tax_id} onChange={e=>setForm({...form,tax_id:parseInt(e.target.value)||""})}>
                <option value="">— No tax —</option>
                {taxes.map(t=><option key={t.id} value={t.id}>{t.name}</option>)}
              </Select>
              <p className="text-[11px] text-gray-400 mt-1">Customer Tax — applies to every variant of this product.</p>
            </FormGroup>
            <FormGroup label="Sale Price (ZAR)"><Input type="number" value={form.list_price} onChange={e=>setForm({...form,list_price:e.target.value})} placeholder="450.00" /></FormGroup>
            <FormGroup label="Cost (ZAR)"><Input type="number" value={form.standard_price} onChange={e=>setForm({...form,standard_price:e.target.value})} placeholder="200.00" /></FormGroup>
            <FormGroup label={editing ? `Stock Quantity (current: ${editing.qty_available ?? 0})` : "Initial Stock"} className="sm:col-span-2">
              <Input type="number" min="0" value={form.stock_qty} disabled={!user?.active_warehouse_id}
                onChange={e=>setForm({...form,stock_qty:e.target.value})}
                placeholder={!user?.active_warehouse_id ? "Select a warehouse in the top nav first" : editing ? "Leave blank to keep current" : "0"} />
              {!user?.active_warehouse_id && (
                <p className="text-[11px] text-amber-600 mt-1">
                  Select a specific warehouse in the top-nav switcher to set stock — it can't be assigned while "All warehouses" is selected.
                </p>
              )}
            </FormGroup>
          </div>
          <FormGroup label="Description"><Textarea value={form.description} onChange={e=>setForm({...form,description:e.target.value})} rows={2} placeholder="Short product description" /></FormGroup>
          <div className="flex justify-end gap-2 mt-4"><BtnSecondary onClick={()=>setModal(false)} disabled={saving}>Cancel</BtnSecondary><BtnPrimary onClick={save} loading={saving}>{editing ? "Save Product" : "Create Product"}</BtnPrimary></div>
        </Modal>
      )}
      {reservationsModal && reservationsProduct && (
        <Modal title={`Stock Tied Up — ${reservationsProduct.display_name || reservationsProduct.name}`} onClose={()=>setReservationsModal(false)}>
          <p className="text-sm text-gray-500 mb-4">
            On Hand: <span className="font-semibold text-gray-700">{reservationsProduct.qty_available ?? 0}</span>
            {" · "}Forecasted: <span className="font-semibold text-gray-700">{reservationsProduct.virtual_available ?? 0}</span>
            {" — the difference is reserved against these open orders:"}
          </p>
          {reservationsLoading && <LoadingState />}
          {!reservationsLoading && reservations.length === 0 && (
            <EmptyState message="No open orders found — the gap may be from stock reserved outside a sale order (e.g. a warehouse transfer), or a manual stock adjustment." />
          )}
          {!reservationsLoading && reservations.length > 0 && (
            <div className="border border-gray-200 rounded-xl overflow-hidden divide-y divide-gray-100">
              {reservations.map(r => (
                <button key={r.order_id} onClick={()=>openReservationOrder(r.order_id)} disabled={viewingOrderId===r.order_id}
                  className="w-full flex items-center justify-between px-4 py-2.5 text-left hover:bg-gray-50 transition-colors disabled:opacity-50">
                  <div>
                    <div className="flex items-center gap-1.5">
                      <p className="text-sm font-medium text-bassani-700">{r.order_name}</p>
                      {r.warehouse_name ? (
                        <span className="text-[10px] text-gray-500 bg-gray-100 rounded-full px-1.5 py-0.5">{r.warehouse_name}</span>
                      ) : (
                        <span title="This order has no warehouse recorded in Odoo at all" className="text-[10px] text-amber-600 bg-amber-50 border border-amber-200 rounded-full px-1.5 py-0.5">no warehouse recorded</span>
                      )}
                    </div>
                    <p className="text-[11px] text-gray-400">{r.customer_name} · {fmtDate(r.date_order)}</p>
                  </div>
                  <span className="text-sm font-semibold text-amber-600 flex-shrink-0 ml-3">
                    {viewingOrderId===r.order_id ? <Loader2 size={14} className="animate-spin" /> : r.qty_reserved}
                  </span>
                </button>
              ))}
            </div>
          )}
          <div className="flex justify-end mt-4"><BtnSecondary onClick={()=>setReservationsModal(false)}>Close</BtnSecondary></div>
        </Modal>
      )}
      {historyModal && historyProduct && (
        <Modal title={`Stock History — ${historyProduct.display_name || historyProduct.name}`} onClose={()=>setHistoryModal(false)}>
          <div className="flex items-center gap-2 mb-4">
            <Input type="date" value={historyFrom} onChange={e=>setHistoryFrom(e.target.value)} className="text-xs flex-1" />
            <span className="text-gray-400 text-xs flex-shrink-0">to</span>
            <Input type="date" value={historyTo} onChange={e=>setHistoryTo(e.target.value)} className="text-xs flex-1" />
            <BtnSecondary size="sm" onClick={()=>openHistory(historyProduct)}>Filter</BtnSecondary>
          </div>
          {historyLoading && <LoadingState />}
          {!historyLoading && historyMoves.length === 0 && (
            <EmptyState message="No completed stock movements found for this product in the selected date range." />
          )}
          {!historyLoading && historyMoves.length > 0 && (
            <div className="border border-gray-200 rounded-xl overflow-hidden divide-y divide-gray-100 max-h-[420px] overflow-y-auto">
              {historyMoves.map((m, i) => {
                const meta   = MOVE_TYPE_META[m.move_type] || MOVE_TYPE_META.other;
                const isOut  = MOVE_OUT_TYPES.has(m.move_type);
                const label  = m.reference || m.origin || "—";
                return (
                  <div key={i} className="px-4 py-2.5">
                    <div className="flex items-center justify-between gap-2">
                      <div className="flex items-center gap-2 min-w-0">
                        <span className={`text-[10px] font-medium rounded-full px-2 py-0.5 flex-shrink-0 ${meta.cls}`}>{meta.label}</span>
                        <span className="text-xs text-gray-500 truncate">{label}</span>
                      </div>
                      <span className={`text-sm font-semibold flex-shrink-0 ${isOut ? "text-red-600" : "text-green-600"}`}>
                        {isOut ? "−" : "+"}{m.qty}
                      </span>
                    </div>
                    <p className="text-[11px] text-gray-400 mt-0.5 truncate">
                      {m.from_location} → {m.to_location}
                      {" · "}{fmtDate(m.date)}
                    </p>
                  </div>
                );
              })}
            </div>
          )}
          <div className="flex justify-end mt-4"><BtnSecondary onClick={()=>setHistoryModal(false)}>Close</BtnSecondary></div>
        </Modal>
      )}
      {lotsModal && lotsProduct && (
        <Modal title={`Lot / Batch Breakdown — ${lotsProduct.display_name || lotsProduct.name}`} onClose={()=>setLotsModal(false)}>
          {lotsLoading && <LoadingState />}
          {!lotsLoading && lots.length === 0 && (
            <EmptyState message="No tracked lots found with on-hand stock. This product may not have lot tracking enabled in Odoo, or all lots are at zero quantity." />
          )}
          {!lotsLoading && lots.length > 0 && (
            <>
              <div className="border border-gray-200 rounded-xl overflow-hidden divide-y divide-gray-100 max-h-[420px] overflow-y-auto">
                <div className="grid grid-cols-3 px-4 py-2 bg-gray-50 text-[10px] font-semibold text-gray-400 uppercase tracking-wide">
                  <span>Lot / Batch</span>
                  <span className="text-right">On Hand</span>
                  <span className="text-right">Expires</span>
                </div>
                {lots.map(l => (
                  <div key={l.id} className="grid grid-cols-3 px-4 py-2.5 items-center">
                    <span className="text-sm font-mono text-gray-900">{l.name}</span>
                    <span className="text-sm font-semibold text-bassani-700 text-right">{l.qty}{l.uom_name ? <span className="text-xs text-gray-400 font-normal ml-1">{l.uom_name}</span> : null}</span>
                    <span className="text-xs text-gray-500 text-right">{l.expiration_date || <span className="text-gray-300">—</span>}</span>
                  </div>
                ))}
              </div>
              <div className="flex items-center justify-between mt-3 px-1">
                <p className="text-xs text-gray-400">{lots.length} lot{lots.length !== 1 ? "s" : ""} · Total on hand: <span className="font-semibold text-gray-600">{lots.reduce((s, l) => s + l.qty, 0).toFixed(3).replace(/\.?0+$/, "")} {lots[0]?.uom_name || ""}</span></p>
                <BtnSecondary onClick={()=>setLotsModal(false)}>Close</BtnSecondary>
              </div>
            </>
          )}
          {!lotsLoading && lots.length === 0 && <div className="flex justify-end mt-4"><BtnSecondary onClick={()=>setLotsModal(false)}>Close</BtnSecondary></div>}
        </Modal>
      )}
      {viewingOrder && (
        <OrderView order={viewingOrder} onClose={()=>setViewingOrder(null)} />
      )}
      {archiveConfirm && (
        <Modal title="Archive Product" onClose={()=>setArchiveConfirm(null)}>
          <p className="text-sm text-gray-600">Archive <strong>{archiveConfirm.name}</strong>? It will no longer appear in the product catalogue.</p>
          <div className="flex justify-end gap-2 mt-4"><BtnSecondary onClick={()=>setArchiveConfirm(null)}>Cancel</BtnSecondary><BtnDanger onClick={doArchive}>Archive</BtnDanger></div>
        </Modal>
      )}
      {gs1Product && <GS1LabelModal product={gs1Product} onClose={() => setGs1Product(null)} />}
      {gtinPickerProduct && (
        <GTINPickerModal
          product={gtinPickerProduct}
          onClose={() => setGtinPickerProduct(null)}
          onAssigned={(gtin) => {
            setProducts(prev => prev.map(p =>
              p.id === gtinPickerProduct.id ? { ...p, barcode: gtin || "" } : p
            ));
            setGtinPickerProduct(null);
          }}
        />
      )}
    </div>
  );
}

// ─────────────────────────────────────────────────────────────────────────────
// Customers view
// ─────────────────────────────────────────────────────────────────────────────
export function Customers() {
  const { user } = useAuth();
  const navigate = useNavigate();
  const isReseller = user?.role === "reseller";
  const [customers, setCustomers] = useState([]);
  const [total,     setTotal    ] = useState(0);
  const [loading,   setLoading  ] = useState(true);
  const [search,    setSearch   ] = useState("");
  const [modal,     setModal    ] = useState(false);
  const [custPag,   setCustPag  ] = useState({ pageIndex: 0, pageSize: 25 });
  const [custSort,  setCustSort ] = useState([{ id: "name", desc: false }]);
  const [saving,    setSaving   ] = useState(false);

  // Onboarding invite modal state
  const [showOnboardingDocs,   setShowOnboardingDocs  ] = useState(false);
  const [obInviteEmail,        setObInviteEmail       ] = useState("");
  const [obInviteSending,      setObInviteSending     ] = useState(false);

  const sendObInvite = async () => {
    if (!obInviteEmail.trim()) return toast.error("Enter the customer's email address");
    setObInviteSending(true);
    try {
      await api.post("/api/onboarding/invite", {
        to_email:         obInviteEmail.trim(),
        registration_url: `${window.location.origin}/apply`,
      });
      toast.success(`Invitation sent to ${obInviteEmail.trim()}`);
      setObInviteEmail("");
    } catch (e) { toast.error(e.response?.data?.detail || "Failed to send invitation"); }
    finally { setObInviteSending(false); }
  };

  // Admin add-customer modal state
  const BLANK_FORM = { name:"", email:"", phone:"", street:"", city:"", zip:"", vat:"", credit_limit:"", customer_type:"Pharmacy", section21_registered:false };
  const REQUIRED_DOC_TYPES = [
    { key:"store_onboarding_agreement", label:"Signed Store Onboarding Agreement" },
    { key:"customer_information_form",  label:"Signed Customer Information Form"  },
    { key:"nda",                        label:"Signed NDA"                        },
    { key:"tqa",                        label:"Signed TQA Document"               },
    { key:"cipc_certificate",           label:"CIPC Company Registration Certificate" },
  ];
  const [form,           setForm          ] = useState(BLANK_FORM);
  const [nameSearch,     setNameSearch    ] = useState("");
  const [nameResults,    setNameResults   ] = useState([]);
  const [nameSearching,  setNameSearching ] = useState(false);
  const [step,           setStep          ] = useState("search");
  const [claiming,       setClaiming      ] = useState(false);
  const [sessionId,      setSessionId     ] = useState("");
  const [stagedDocs,     setStagedDocs    ] = useState([]);
  const [uploadingDoc,   setUploadingDoc  ] = useState(null);
  const [removingDoc,       setRemovingDoc      ] = useState(null);
  const [removeDocConfirm,  setRemoveDocConfirm ] = useState(null);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const sort = custSort[0];
      const params = { limit: custPag.pageSize, offset: custPag.pageIndex * custPag.pageSize };
      if (sort) { params.sort_by = sort.id; params.sort_dir = sort.desc ? "desc" : "asc"; }
      if (search) params.search = search;
      const r = await api.get("/api/customers/", { params });
      setCustomers(r.data.customers); setTotal(r.data.total);
    } catch { toast.error("Failed to load customers"); }
    finally { setLoading(false); }
  }, [search, custPag, custSort]);

  useEffect(() => { load(); }, [load]);

  // Debounced Odoo search for admin add-customer modal
  useEffect(() => {
    if (!modal || step !== "search") return;
    if (nameSearch.length < 2) { setNameResults([]); return; }
    const t = setTimeout(async () => {
      setNameSearching(true);
      try {
        const r = await api.get("/api/customers/search", { params: { q: nameSearch, limit: 8 } });
        setNameResults(r.data.customers || []);
      } catch { setNameResults([]); }
      finally { setNameSearching(false); }
    }, 300);
    return () => clearTimeout(t);
  }, [nameSearch, modal, step]);

  const genSessionId = () => (
    typeof crypto !== "undefined" && crypto.randomUUID
      ? crypto.randomUUID()
      : `sess-${Date.now()}-${Math.random().toString(36).slice(2)}`
  );

  const openModal = () => {
    const sid = genSessionId();
    setForm(BLANK_FORM); setNameSearch(""); setNameResults([]);
    setStep("search"); setSessionId(sid); setStagedDocs([]);
    setUploadingDoc(null); setRemovingDoc(null);
    setModal(true);
  };

  const uploadDoc = async (docKey, docLabel, file) => {
    setUploadingDoc(docKey);
    try {
      const fd = new FormData();
      fd.append("file", file);
      const r = await api.post(
        `/api/onboarding/documents/upload?session_id=${sessionId}&doc_type=${docKey}`,
        fd, { headers: { "Content-Type": "multipart/form-data" } }
      );
      setStagedDocs(prev => {
        const without = prev.filter(d => d.doc_type !== docKey);
        return [...without, { ...r.data, label: docLabel }];
      });
    } catch { toast.error(`Failed to upload ${docLabel}`); }
    finally { setUploadingDoc(null); }
  };

  const removeDoc = (docKey) => setRemoveDocConfirm(docKey);

  const doRemoveDoc = async () => {
    const docKey = removeDocConfirm;
    setRemoveDocConfirm(null);
    setRemovingDoc(docKey);
    try {
      await api.delete(`/api/onboarding/documents/${sessionId}/${docKey}`);
      setStagedDocs(prev => prev.filter(d => d.doc_type !== docKey));
    } catch { toast.error("Failed to remove document"); }
    finally { setRemovingDoc(null); }
  };

  const claim = async (customer) => {
    setClaiming(true);
    try {
      await api.post(`/api/customers/${customer.id}/claim`);
      toast.success(`${customer.name} linked to your account`);
      setModal(false); load();
    } catch (e) { toast.error(e.response?.data?.detail || "Could not link customer"); }
    finally { setClaiming(false); }
  };

  const save = async () => {
    if (!form.name) return toast.error("Name required");
    const missingDocs = REQUIRED_DOC_TYPES.filter(t => !stagedDocs.find(d => d.doc_type === t.key));
    if (missingDocs.length) return toast.error(`Please upload: ${missingDocs.map(d => d.label).join(", ")}`);
    setSaving(true);
    try {
      const payload = {
        ...form,
        credit_limit: parseFloat(form.credit_limit) || 0,
        document_session_id: sessionId,
        documents: stagedDocs,
      };
      await api.post("/api/customers/", payload);
      toast.success("Customer created"); setModal(false); load();
    } catch (e) {
      const detail = e.response?.data?.detail;
      if (detail && typeof detail === "object" && detail.existing) {
        toast.error(`Duplicate found: ${detail.existing.name} already exists with this email or VAT number.`);
      } else {
        toast.error(typeof detail === "string" ? detail : "Save failed");
      }
    }
    finally { setSaving(false); }
  };

  const TYPES = ["Pharmacy","Dispensary","Clinic","Hospital","Retail"];
  const balanceColor = (b, l) => !l ? "text-gray-600" : b/l >= 1 ? "text-red-600" : b/l >= 0.75 ? "text-amber-600" : "text-bassani-700";

  return (
    <div className="flex flex-col flex-1 overflow-hidden">
      <TopBar
        title={isReseller ? "My Customers" : "Customers"}
        subtitle={`${total} active accounts`}
        onRefresh={load}
        actions={isReseller
          ? <BtnPrimary onClick={() => navigate("/onboarding-docs")}><Link2 size={14}/>Send Registration Link</BtnPrimary>
          : <div className="flex gap-2">
              <BtnSecondary onClick={() => { setObInviteEmail(""); setShowOnboardingDocs(true); }}>
                <FileText size={14} className="mr-1" />Onboarding Documents
              </BtnSecondary>
              <BtnPrimary onClick={openModal}><Plus size={14}/>Add Customer</BtnPrimary>
            </div>
        }
      />
      <main className="flex-1 overflow-y-auto p-6">
        <div className="flex items-center gap-2 mb-4"><SearchBar value={search} onChange={v=>{ setSearch(v); setCustPag(p=>({...p,pageIndex:0})); }} placeholder="Search customers, city…" /></div>
        <DataTable
          columns={[
            { accessorKey:"name", header:"Customer", cell:({row:{original:c}})=><p className="font-medium">{c.name}</p> },
            { id:"type", header:"Type", enableSorting:false, accessorFn:r=>r.is_company?"Company":"Individual", cell:({row:{original:c}})=><span className="text-xs text-gray-500">{c.is_company?"Company":"Individual"}</span> },
            { id:"category", header:"Category", enableSorting:false, meta:{className:"hidden md:table-cell"}, accessorFn:r=>r.comment?.match(/Type: (\w+)/)?.[1]||"—", cell:({row:{original:c}})=>{ const cat=c.comment?.match(/Type: (\w+)/)?.[1]; return cat?<Badge status={cat.toLowerCase()} label={cat} />:<span className="text-xs text-gray-400">—</span>; } },
            { accessorKey:"email", header:"Contact", meta:{className:"hidden md:table-cell"}, cell:({row:{original:c}})=><span className="text-xs text-gray-500">{c.email||"—"}</span> },
            { accessorKey:"city", header:"City", meta:{className:"hidden md:table-cell"}, cell:({row:{original:c}})=><span className="text-gray-500 text-sm">{c.city||"—"}</span> },
            { id:"s21", header:"Section 21", enableSorting:false, meta:{className:"hidden md:table-cell"}, cell:({row:{original:c}})=>c.comment?.includes("Section 21: Registered")?<span className="text-xs text-bassani-700 font-medium">✓ Registered</span>:<span className="text-xs text-gray-400">—</span> },
            { accessorKey:"credit_limit", header:"Credit Limit", meta:{className:"hidden md:table-cell"}, cell:({row:{original:c}})=>(
              <div className="flex items-center gap-1.5">
                <span className={balanceColor(0,c.credit_limit)}>{fmtR(c.credit_limit)}</span>
                {c.credit_hold && (
                  <span title="Customer is currently over their credit limit" className="text-[10px] font-semibold text-red-700 bg-red-50 border border-red-200 rounded-full px-1.5 py-0.5">Credit Hold</span>
                )}
              </div>
            ) },
            { id:"terms", header:"Terms", enableSorting:false, meta:{className:"hidden md:table-cell"}, cell:({row:{original:c}})=><span className="text-xs text-gray-500">{c.property_payment_term_id?.[1]||"—"}</span> },
            ...(!isReseller ? [
              { id:"createdBy", header:"Created By", enableSorting:false, meta:{className:"hidden md:table-cell"}, cell:({row:{original:c}})=>
                c.created_by_reseller_name
                  ? <span className="text-xs bg-purple-50 text-purple-700 px-2 py-0.5 rounded-full font-medium">{c.created_by_reseller_name}</span>
                  : <span className="text-xs text-gray-400">Bassani</span>
              },
            ] : []),
            { id:"actions", header:"", enableSorting:false, cell:({row:{original:c}})=><BtnSecondary size="sm" onClick={e=>{e.stopPropagation();navigate(`/customers/${c.id}`);}}>View</BtnSecondary> },
          ]}
          data={customers} loading={loading} total={total}
          pagination={custPag} onPaginationChange={setCustPag}
          sorting={custSort} onSortingChange={u=>{ setCustSort(typeof u==="function"?u(custSort):u); setCustPag(p=>({...p,pageIndex:0})); }}
          onRowClick={c => navigate(`/customers/${c.id}`)}
          manualPagination manualSorting
        />
      </main>
      {showOnboardingDocs && (
        <Modal title="Send Registration Link" onClose={() => setShowOnboardingDocs(false)}>
          <div className="rounded-xl border border-gray-100 overflow-hidden">
            <div className="px-4 py-3 border-b border-gray-50 flex items-center gap-2 bg-gray-50">
              <Mail size={13} className="text-bassani-600 shrink-0" />
              <p className="text-xs font-bold text-gray-700">Send Registration Invitation</p>
            </div>
            <div className="px-4 py-4 space-y-3">
              <p className="text-xs text-gray-500">
                Send the customer a link to the self-service registration page. They will complete their own details and upload their documents.
              </p>
              <div className="flex gap-2 items-center">
                <span className="text-[10px] text-gray-400 font-mono bg-gray-50 border border-gray-200 rounded px-2 py-1 truncate flex-1">{window.location.origin}/apply</span>
                <button
                  onClick={() => { navigator.clipboard.writeText(`${window.location.origin}/apply`); toast.success("Link copied"); }}
                  className="shrink-0 text-xs font-semibold text-gray-500 hover:text-gray-700 px-2 py-1 border border-gray-200 rounded transition-colors">
                  Copy
                </button>
              </div>
              <div className="flex gap-2">
                <input
                  type="email"
                  value={obInviteEmail}
                  onChange={e => setObInviteEmail(e.target.value)}
                  onKeyDown={e => e.key === "Enter" && sendObInvite()}
                  placeholder="customer@example.co.za"
                  className="flex-1 px-3 py-2 text-sm border border-gray-200 rounded-lg focus:outline-none focus:ring-2 focus:ring-bassani-300 bg-white placeholder-gray-400"
                />
                <button
                  onClick={sendObInvite}
                  disabled={obInviteSending || !obInviteEmail.trim()}
                  className="flex items-center gap-1.5 px-4 py-2 bg-bassani-600 hover:bg-bassani-700 disabled:opacity-50 text-white text-xs font-semibold rounded-lg transition-colors whitespace-nowrap">
                  {obInviteSending ? <Loader2 size={12} className="animate-spin" /> : <Mail size={12} />}
                  Send Invitation
                </button>
              </div>
            </div>
          </div>
        </Modal>
      )}

      {modal && (
        <Modal title="Add Customer" onClose={()=>setModal(false)}>
          {/* Step indicator */}
          <div className="flex items-center gap-2 mb-5">
            {["search","docs","create"].map((s,i)=>(
              <div key={s} className="flex items-center gap-2">
                <div className={`w-6 h-6 rounded-full flex items-center justify-center text-[11px] font-bold shrink-0 ${step===s?"bg-bassani-600 text-white":["search","docs","create"].indexOf(step)>i?"bg-green-500 text-white":"bg-gray-100 text-gray-400"}`}>{["search","docs","create"].indexOf(step)>i?"✓":i+1}</div>
                <span className={`text-xs font-medium ${step===s?"text-bassani-700":"text-gray-400"}`}>{["Search","Documents","Details"][i]}</span>
                {i<2&&<div className="w-6 h-px bg-gray-200 mx-1"/>}
              </div>
            ))}
          </div>

          {/* ── Step 1: Search ── */}
          {step === "search" && (
            <>
              <p className="text-sm text-gray-500 mb-3">
                Search for the customer first. If they already exist, select them rather than creating a duplicate.
              </p>
              <FormGroup label="Customer Name">
                <div className="relative">
                  <Input value={nameSearch} onChange={e=>setNameSearch(e.target.value)} placeholder="Start typing a business name…" autoFocus />
                  {nameSearching && <Loader2 size={13} className="animate-spin absolute right-3 top-1/2 -translate-y-1/2 text-gray-400" />}
                </div>
              </FormGroup>
              {nameResults.length > 0 && (
                <>
                  <div className="mt-2 border border-amber-100 rounded-xl overflow-hidden">
                    <p className="text-xs text-amber-700 px-3 py-2 bg-amber-50 font-medium">Existing customers found — select one below or refine your search to confirm this is a new customer</p>
                    {nameResults.map(c => (
                      <div key={c.id} className="flex items-center justify-between px-3 py-2.5 border-t border-gray-50 hover:bg-gray-50">
                        <div>
                          <p className="text-sm font-medium text-gray-800">{c.name}</p>
                          <p className="text-xs text-gray-400">{[c.city, c.email].filter(Boolean).join(" · ") || "No contact info"}</p>
                        </div>
                        <BtnPrimary size="sm" onClick={()=>claim(c)} loading={claiming}>Select</BtnPrimary>
                      </div>
                    ))}
                  </div>
                  <p className="text-[11px] text-gray-400 mt-2 text-center">None of these match? Refine your search until no results appear, then you can proceed.</p>
                </>
              )}
              {nameSearch.length >= 2 && !nameSearching && nameResults.length === 0 && (
                <p className="text-xs text-green-600 mt-2 text-center font-medium">No existing customers found for "{nameSearch}"</p>
              )}
              <div className="flex justify-between items-center mt-4 pt-3 border-t border-gray-100">
                <span className="text-xs text-gray-400">
                  {nameSearch.length < 2 ? "Type at least 2 characters to search first" : nameResults.length > 0 ? "Select a match above or keep searching" : "Customer confirmed as new"}
                </span>
                <BtnSecondary
                  onClick={()=>{ setForm({...BLANK_FORM, name:nameSearch}); setStep("docs"); }}
                  disabled={nameSearch.length < 2 || nameSearching || nameResults.length > 0}
                >
                  Continue
                </BtnSecondary>
              </div>
            </>
          )}

          {/* ── Step 2: Documents ── */}
          {step === "docs" && (
            <>
              <button onClick={()=>setStep("search")} className="flex items-center gap-1 text-xs text-gray-400 hover:text-gray-600 mb-3">
                <ChevronDown size={12} className="-rotate-90"/>Back to search
              </button>
              <p className="text-sm text-gray-500 mb-4">Upload all five signed onboarding documents before creating the customer record.</p>
              <div className="space-y-2 mb-5">
                {REQUIRED_DOC_TYPES.map(dt => {
                  const uploaded = stagedDocs.find(d => d.doc_type === dt.key);
                  const isUploading = uploadingDoc === dt.key;
                  const isRemoving  = removingDoc  === dt.key;
                  return (
                    <div key={dt.key} className={`flex items-center gap-3 rounded-lg px-3 py-2.5 border ${uploaded?"border-green-200 bg-green-50":"border-gray-100 bg-gray-50"}`}>
                      <div className="flex-1 min-w-0">
                        <p className={`text-xs font-semibold truncate ${uploaded?"text-green-800":"text-gray-700"}`}>{dt.label}</p>
                        {uploaded && <p className="text-[11px] text-green-600 truncate">{uploaded.filename}</p>}
                      </div>
                      {uploaded ? (
                        <button onClick={()=>removeDoc(dt.key)} disabled={isRemoving}
                          className="text-red-400 hover:text-red-600 text-xs font-semibold disabled:opacity-50 shrink-0">
                          {isRemoving ? <Loader2 size={12} className="animate-spin"/> : "Remove"}
                        </button>
                      ) : (
                        <label className={`flex items-center gap-1.5 text-xs font-semibold text-bassani-600 hover:text-bassani-700 cursor-pointer shrink-0 ${isUploading?"opacity-50 pointer-events-none":""}`}>
                          {isUploading ? <Loader2 size={12} className="animate-spin"/> : <Download size={12}/>}
                          Upload
                          <input type="file" accept=".pdf,.jpg,.jpeg,.png,.doc,.docx" className="hidden"
                            onChange={e=>{ if(e.target.files[0]) uploadDoc(dt.key, dt.label, e.target.files[0]); e.target.value=""; }} />
                        </label>
                      )}
                    </div>
                  );
                })}
              </div>
              <div className="flex justify-between items-center pt-3 border-t border-gray-100">
                <span className="text-xs text-gray-400">{stagedDocs.length} of {REQUIRED_DOC_TYPES.length} documents uploaded</span>
                <BtnPrimary onClick={()=>setStep("create")} disabled={stagedDocs.length < REQUIRED_DOC_TYPES.length}>Continue to Details</BtnPrimary>
              </div>
            </>
          )}

          {/* ── Step 3: Customer details ── */}
          {step === "create" && (
            <>
              <button onClick={()=>setStep("docs")} className="flex items-center gap-1 text-xs text-gray-400 hover:text-gray-600 mb-3">
                <ChevronDown size={12} className="-rotate-90"/>Back to documents
              </button>
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                <FormGroup label="Business Name" required><Input value={form.name} onChange={e=>setForm({...form,name:e.target.value})} placeholder="Wellness Pharmacy" /></FormGroup>
                <FormGroup label="Type"><Select value={form.customer_type} onChange={e=>setForm({...form,customer_type:e.target.value})}>{TYPES.map(t=><option key={t}>{t}</option>)}</Select></FormGroup>
                <FormGroup label="Email"><Input value={form.email} onChange={e=>setForm({...form,email:e.target.value})} placeholder="orders@example.co.za" /></FormGroup>
                <FormGroup label="Phone"><Input value={form.phone} onChange={e=>setForm({...form,phone:e.target.value})} placeholder="+27 11 555 1234" /></FormGroup>
                <FormGroup label="VAT Registration Number"><Input value={form.vat} onChange={e=>setForm({...form,vat:e.target.value})} placeholder="e.g. 4123456789" /></FormGroup>
                <FormGroup label="Credit Limit (ZAR)"><Input type="number" value={form.credit_limit} onChange={e=>setForm({...form,credit_limit:e.target.value})} placeholder="50000" /></FormGroup>
                <FormGroup label="Street Address" className="sm:col-span-2"><Input value={form.street} onChange={e=>setForm({...form,street:e.target.value})} placeholder="123 Health Street, Sandton" /></FormGroup>
                <FormGroup label="City"><Input value={form.city} onChange={e=>setForm({...form,city:e.target.value})} placeholder="Johannesburg" /></FormGroup>
                <FormGroup label="Postal Code"><Input value={form.zip} onChange={e=>setForm({...form,zip:e.target.value})} placeholder="2196" /></FormGroup>
              </div>
              <div className="flex items-center gap-2 my-3"><input type="checkbox" id="s21" checked={form.section21_registered} onChange={e=>setForm({...form,section21_registered:e.target.checked})} className="accent-bassani-600" /><label htmlFor="s21" className="text-sm text-gray-600">Section 21 registered</label></div>
              <div className="flex justify-end gap-2"><BtnSecondary onClick={()=>setModal(false)} disabled={saving}>Cancel</BtnSecondary><BtnPrimary onClick={save} loading={saving}>Create Customer</BtnPrimary></div>
            </>
          )}
        </Modal>
      )}
      {removeDocConfirm && (
        <Modal title="Remove Document" onClose={()=>setRemoveDocConfirm(null)}>
          <p className="text-sm text-gray-600">Remove this document from the application? You will need to re-upload it to continue.</p>
          <div className="flex justify-end gap-2 mt-4"><BtnSecondary onClick={()=>setRemoveDocConfirm(null)}>Cancel</BtnSecondary><BtnDanger onClick={doRemoveDoc}>Remove</BtnDanger></div>
        </Modal>
      )}
    </div>
  );
}

// ─────────────────────────────────────────────────────────────────────────────
// Orders view
// ─────────────────────────────────────────────────────────────────────────────
export function Orders() {
  const { user, can } = useAuth();
  const navigate   = useNavigate();
  const location   = useLocation();
  const isReseller = user?.role === "reseller";

  // ── List view state ───────────────────────────────────────────────────────
  const [view,        setView       ] = useState(
    (location.state?.newQuote || location.state?.editQuote) ? "new" : "list"
  ); // "list" | "detail" | "new"
  const [orders,      setOrders     ] = useState([]);
  const [orderTotal,  setOrderTotal ] = useState(0);
  const [loading,     setLoading    ] = useState(true);
  const [search,      setSearch     ] = useState(location.state?.searchQuery || "");
  const [status,      setStatus     ] = useState("all");
  const [detail,         setDetail        ] = useState(null);
  const [orderPag,    setOrderPag   ] = useState({ pageIndex: 0, pageSize: 25 });
  const [orderSort,   setOrderSort  ] = useState([{ id: "date_order", desc: true }]);

  const [creatingTicket,        setCreatingTicket       ] = useState(new Set());
  const [ticketPreflightModal,  setTicketPreflightModal ] = useState(null); // { orderId, orderName, has_linked_ticket, existing_ticket_id, unlinked_tickets }

  // ── Reseller order cart (place a new order) ──────────────────────────────
  // Resellers only — staff use the Sales Ticket quote builder instead (they
  // know product names/SKUs and type-search; resellers need to browse a
  // catalogue, so this is a product grid + cart, not a line-item table).
  // Submits straight to POST /api/orders/, which auto-creates an unassigned
  // Sales Ticket exactly like every other portal order (see order_routes.py).
  const [cartProducts,     setCartProducts    ] = useState([]);
  const [cartMoq,          setCartMoq         ] = useState({});
  const [cartProdsLoading, setCartProdsLoading] = useState(false);
  const [cartProdSearch,   setCartProdSearch  ] = useState("");
  const [cartProdCat,      setCartProdCat     ] = useState("all");
  const [cartProdVariant,  setCartProdVariant ] = useState("all");
  const [cartStockFilter,  setCartStockFilter ] = useState("all"); // "all"|"in_stock"|"out_of_stock"
  const [cart,             setCart            ] = useState([]);
  const [cartNote,         setCartNote        ] = useState("");
  const [cartCustSearch,   setCartCustSearch  ] = useState("");
  const [cartCustResults,  setCartCustResults ] = useState([]);
  const [cartCustLoading,  setCartCustLoading ] = useState(false);
  const [cartSelectedCust, setCartSelectedCust] = useState(null);
  const [cartCustDropOpen, setCartCustDropOpen] = useState(false);
  const [cartSubmitting,   setCartSubmitting  ] = useState(false);
  const [editQuote,        setEditQuote       ] = useState(null); // { ticketId, orderId, customerName, customerId }

  const loadCartProducts = async () => {
    setCartProdsLoading(true);
    try {
      const [prodR, catR] = await Promise.all([
        api.get("/api/products/", { params: { limit: 200 } }),
        api.get("/api/reseller-catalog/"),
      ]);
      setCartProducts(prodR.data.products || []);
      setCartMoq(catR.data.moq || {});
    } catch { toast.error("Failed to load products"); }
    finally { setCartProdsLoading(false); }
  };

  // If navigated here from My Quotes to start a new quote, load the product catalogue
  useEffect(() => {
    if (location.state?.newQuote) loadCartProducts();
  }, []); // eslint-disable-line

  // If navigated here from My Quotes with an existing draft to edit, enter edit mode
  useEffect(() => {
    const eq = location.state?.editQuote;
    if (!eq) return;
    setEditQuote(eq);
    setCart((eq.lines || []).map(l => ({
      product_id: l.product_id,
      product_uom_qty: l.product_uom_qty,
      price_unit: l.price_unit,
      name: l.name,
      _sku: l._sku || "",
      _stock: 9999,
      _taxRate: l._taxRate || 0,
    })));
    setCartSelectedCust({ id: eq.customerId, name: eq.customerName });
    setCartCustSearch(eq.customerName || "");
    loadCartProducts();
    setView("new");
  }, []); // eslint-disable-line

  // Customer search debounce (cart)
  useEffect(() => {
    if (!cartCustDropOpen) { setCartCustResults([]); return; }
    const delay = cartCustSearch.length >= 2 ? 300 : 0;
    const t = setTimeout(async () => {
      setCartCustLoading(true);
      try {
        const params = { limit: 20 };
        if (cartCustSearch.length >= 2) params.search = cartCustSearch;
        const r = await api.get("/api/customers/", { params });
        setCartCustResults(r.data.customers || []);
      } catch { setCartCustResults([]); }
      finally { setCartCustLoading(false); }
    }, delay);
    return () => clearTimeout(t);
  }, [cartCustSearch, cartCustDropOpen]);

  const openNewOrder = () => {
    setCart([]); setCartProdSearch(""); setCartProdCat("all"); setCartProdVariant("all"); setCartStockFilter("all"); setCartNote("");
    setCartCustSearch(""); setCartCustResults([]); setCartSelectedCust(null);
    setCartCustDropOpen(false); setCartSubmitting(false);
    loadCartProducts();
    setView("new");
  };

  // product.id is already the correct Odoo product.product (variant) id —
  // the product list endpoint returns variants, not templates.
  const addToCart = (product) => {
    const pid = product.id;
    const minQty = cartMoq[pid] || 1;
    setCart(prev => {
      const ex = prev.find(i => i.product_id === pid);
      if (ex) return prev.map(i => i.product_id === pid ? { ...i, product_uom_qty: i.product_uom_qty + 1 } : i);
      return [...prev, {
        product_id: pid, product_uom_qty: minQty, price_unit: product.list_price,
        name: product.display_name || product.name, _sku: product.default_code || "",
        _stock: Math.max(0, product.virtual_available ?? 0), _taxRate: product.tax_rate ?? 0,
      }];
    });
  };
  const removeFromCart = (pid) => setCart(prev => prev.filter(i => i.product_id !== pid));
  const updateCartQty = (pid, qty) => {
    const minQty = cartMoq[pid] || 1;
    if (qty <= 0) { removeFromCart(pid); return; }
    if (qty < minQty) { toast.error(`Minimum order quantity is ${minQty}`); return; }
    setCart(prev => prev.map(i => i.product_id === pid ? { ...i, product_uom_qty: qty } : i));
  };
  const cartItemFor = (product) => cart.find(i => i.product_id === product.id) || null;

  const submitCart = async () => {
    if (cart.length === 0) return toast.error("Add at least one product");
    if (!cartSelectedCust) return toast.error("Select a customer first");
    setCartSubmitting(true);

    // Edit-quote mode: update existing draft order lines via the ticket endpoint
    if (editQuote) {
      try {
        await api.put(`/api/tickets/${editQuote.ticketId}/update-order`, {
          order_line: cart.map(i => ({ product_id: i.product_id, product_uom_qty: i.product_uom_qty, price_unit: i.price_unit, name: i.name })),
          note: cartNote || undefined,
        });
        toast.success("Quote updated");
        setEditQuote(null);
        navigate("/tickets/sales");
      } catch (e) {
        toast.error(e.response?.data?.detail || "Failed to update quote");
      } finally {
        setCartSubmitting(false);
      }
      return;
    }

    // Section 21 script check — blocks expired/missing scripts, warns if expiring soon
    try {
      const { data: sc } = await api.get(`/api/scripts/check/${cartSelectedCust.id}`);
      if (sc.block_order) {
        toast.error(`Order blocked: ${sc.reason}`, { duration: 8000 });
        setCartSubmitting(false);
        return;
      }
      if (sc.warn) toast(`⚠️ ${sc.reason}`, { duration: 6000 });
    } catch (e) {
      if (e.response?.status !== 404) console.warn("Script check error:", e);
    }

    try {
      const { data } = await api.post("/api/orders/", {
        partner_id: cartSelectedCust.id,
        order_line: cart.map(i => ({ product_id: i.product_id, product_uom_qty: i.product_uom_qty, price_unit: i.price_unit, name: i.name })),
        note: cartNote,
      });
      toast.success(isReseller ? "Quote created — view and manage it in My Quotes" : "Order placed — it's now in the Sales queue for processing");
      if (data.credit_warning) {
        toast(`⚠️ ${cartSelectedCust.name} is over their credit limit by ${fmtR(data.credit_warning.shortfall)} — this order will need an admin override to confirm.`,
          { duration: 10000 });
      }
      if (isReseller) { navigate("/tickets/sales"); return; }
      setView("list");
      load();
    } catch (e) {
      toast.error(e.response?.data?.detail || "Failed to place order");
    } finally {
      setCartSubmitting(false);
    }
  };

  const cartProductCategories = ["all", ...Array.from(new Set(cartProducts.map(p => p.categ_id?.[1]).filter(Boolean))).sort()];
  const cartVariantOptions    = cartProdCat === "all" ? [] :
    Array.from(new Set(
      cartProducts.filter(p => (p.categ_id?.[1] || "") === cartProdCat).map(p => getVariantLabel(p)).filter(Boolean)
    )).sort();
  const cartFilteredProducts  = cartProducts
    .filter(p => {
      const q          = cartProdSearch.toLowerCase();
      const inStock     = (p.virtual_available ?? 0) > 0;
      const matchQ      = !q || p.name.toLowerCase().includes(q) || (p.default_code || "").toLowerCase().includes(q);
      const matchCat    = cartProdCat === "all" || (p.categ_id?.[1] || "") === cartProdCat;
      const matchVariant = cartProdVariant === "all" || getVariantLabel(p) === cartProdVariant;
      const matchStock  = cartStockFilter === "all" || (cartStockFilter === "in_stock" ? inStock : !inStock);
      return matchQ && matchCat && matchVariant && matchStock;
    })
    .sort((a, b) => {
      const aIn = (a.virtual_available ?? 0) > 0;
      const bIn = (b.virtual_available ?? 0) > 0;
      if (aIn !== bIn) return aIn ? -1 : 1;
      return a.name.localeCompare(b.name);
    });
  // VAT computed per line from each product's real Odoo tax configuration
  // (resolved server-side via _attach_tax_rates), not a flat assumption.
  const cartSubtotal = cart.reduce((s, i) => s + i.product_uom_qty * i.price_unit, 0);
  const cartVat      = cart.reduce((s, i) => s + i.product_uom_qty * i.price_unit * ((i._taxRate ?? 0) / 100), 0);
  const cartTotal    = cartSubtotal + cartVat;

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const sort = orderSort[0];
      const params = { limit: orderPag.pageSize, offset: orderPag.pageIndex * orderPag.pageSize };
      if (sort) { params.sort_by = sort.id; params.sort_dir = sort.desc ? "desc" : "asc"; }
      if (search) params.search = search;
      if (status !== "all") params.status = status;
      const r = await api.get("/api/orders/", { params });
      setOrders(r.data.orders); setOrderTotal(r.data.total);
    } catch { toast.error("Failed to load orders"); }
    finally { setLoading(false); }
  }, [search, status, orderPag, orderSort]);

  useEffect(() => { load(); }, [load]);

  const openDetail = async (order) => {
    setDetail(order);
    setView("detail");
    try {
      const r = await api.get(`/api/orders/${order.id}`);
      setDetail(r.data);
    } catch { /* keep showing basic data */ }
  };

  // ── Create a Sales Ticket for an existing Odoo order ────────────────────
  const createTicketFromOrder = async (orderId) => {
    setCreatingTicket(s => new Set(s).add(orderId));
    try {
      const pf = await api.get("/api/tickets/from-order/preflight", { params: { order_id: orderId } });
      const data = pf.data;
      if (data.has_linked_ticket || data.unlinked_tickets?.length > 0) {
        setTicketPreflightModal({ orderId, ...data });
        return;
      }
      await api.post("/api/tickets/from-order", { order_id: orderId });
      toast.success("Sales Ticket created — find it in Sales Tickets");
      load();
    } catch (e) {
      toast.error(e.response?.data?.detail || "Failed to create ticket");
    } finally {
      setCreatingTicket(s => { const n = new Set(s); n.delete(orderId); return n; });
    }
  };

  const doCreateTicket = async () => {
    const { orderId } = ticketPreflightModal;
    setTicketPreflightModal(null);
    setCreatingTicket(s => new Set(s).add(orderId));
    try {
      const r = await api.post("/api/tickets/from-order", { order_id: orderId });
      toast.success("Sales Ticket created — find it in Sales Tickets");
      navigate("/tickets/sales", { state: { openTicketId: r.data.ticket_id } });
    } catch (e) {
      const detail = e.response?.data?.detail;
      const existingId = typeof detail === "object" ? detail?.existing_ticket_id : null;
      if (existingId) {
        toast.error("A ticket already exists for this order");
        navigate("/tickets/sales", { state: { openTicketId: existingId } });
      } else {
        toast.error((typeof detail === "object" ? detail?.message : detail) || "Failed to create ticket");
      }
    } finally {
      setCreatingTicket(s => { const n = new Set(s); n.delete(orderId); return n; });
    }
  };

  const doLinkUnlinkedTicket = async (ticketId) => {
    const { orderId } = ticketPreflightModal;
    setTicketPreflightModal(null);
    try {
      await api.post(`/api/tickets/${ticketId}/link-order`, { order_id: orderId });
      toast.success("Existing ticket linked to order");
      navigate("/tickets/sales", { state: { openTicketId: ticketId } });
    } catch (e) {
      toast.error(e.response?.data?.detail || "Failed to link ticket");
    }
  };

  const STATUSES = ["all","draft","sale","done","cancel"];

  // ── Detail / order view ───────────────────────────────────────────────────
  if (view === "detail" && detail) {
    return (
      <OrderView
        order={detail}
        isAdmin={!isReseller}
        canConfirmOrder={false}
        canCancelOrder={false}
        onClose={() => { setView("list"); setDetail(null); }}
      />
    );
  }

  // ── New order (reseller cart) ────────────────────────────────────────────
  if (view === "new" && isReseller) {
    return (
      <div className="flex flex-col flex-1 overflow-hidden">
        <TopBar
          title={editQuote ? "Edit Quote" : "Place New Order"}
          subtitle={editQuote ? `Revising quote for ${editQuote.customerName}` : "Select a customer and add products"}
          showWarehouseSwitcher
          actions={
            <BtnSecondary onClick={() => {
              if (editQuote || isReseller) { setEditQuote(null); navigate("/tickets/sales"); }
              else setView("list");
            }}>
              {editQuote || isReseller ? "← Back to My Quotes" : "← Back to Orders"}
            </BtnSecondary>
          }
        />

        <div className="flex flex-col lg:flex-row flex-1 overflow-hidden">

          {/* ── Left panel: product browser ────────────────────────────── */}
          <div className="flex-1 flex flex-col overflow-hidden min-h-0">
            <div className="px-6 pt-5 pb-4 bg-white border-b border-gray-100 space-y-3">
              <input
                value={cartProdSearch}
                onChange={e => setCartProdSearch(e.target.value)}
                placeholder="Search by product name or SKU…"
                className="w-full px-3 py-2 text-sm border border-gray-200 rounded-lg focus:outline-none focus:ring-2 focus:ring-bassani-300 bg-gray-50 placeholder-gray-400"
              />
              <ChipRow>
                {cartProdCat === "all" ? (
                  cartProductCategories.map(c => (
                    <FilterPill key={c} label={c === "all" ? "All Categories" : c} active={cartProdCat === c}
                      onClick={() => { setCartProdCat(c); setCartProdVariant("all"); }} />
                  ))
                ) : (
                  <>
                    <button
                      onClick={() => { setCartProdCat("all"); setCartProdVariant("all"); }}
                      className="inline-flex items-center gap-1.5 text-xs font-semibold px-3 py-1.5 rounded-full bg-bassani-600 text-white shrink-0 hover:bg-bassani-700 transition-colors"
                    >
                      {cartProdCat} <X size={11} className="opacity-80" />
                    </button>
                    {cartVariantOptions.length > 0 && (
                      <>
                        <span className="text-gray-200 select-none self-center">|</span>
                        <FilterPill key="__all__" label="All" active={cartProdVariant === "all"} onClick={() => setCartProdVariant("all")} />
                        {cartVariantOptions.map(v => (
                          <FilterPill key={v} label={v} active={cartProdVariant === v} onClick={() => setCartProdVariant(v)} />
                        ))}
                      </>
                    )}
                  </>
                )}
                <div className="w-px bg-gray-200 self-stretch shrink-0 mx-1" />
                <FilterPill label="In Stock"     active={cartStockFilter === "in_stock"}     onClick={() => setCartStockFilter(cartStockFilter === "in_stock"     ? "all" : "in_stock")}     />
                <FilterPill label="Out of Stock" active={cartStockFilter === "out_of_stock"} onClick={() => setCartStockFilter(cartStockFilter === "out_of_stock" ? "all" : "out_of_stock")} />
              </ChipRow>
            </div>
            <div className="flex-1 overflow-y-auto p-6">
              {cartProdsLoading && <LoadingState />}
              {!cartProdsLoading && cartFilteredProducts.length === 0 && <EmptyState />}
              {!cartProdsLoading && (
                <div className="grid grid-cols-2 xl:grid-cols-3 gap-4">
                  {cartFilteredProducts.map(p => {
                    const item       = cartItemFor(p);
                    const outOfStock = (p.virtual_available ?? 0) <= 0;
                    const lowStock   = !outOfStock && (p.virtual_available ?? 0) < 10;
                    const minQty     = cartMoq[p.id] || 0;
                    return (
                      <div key={p.id}
                        className={`bg-white border rounded-xl p-4 flex flex-col gap-3 transition-all ${item ? "border-bassani-300 ring-1 ring-bassani-100 shadow-sm" : "border-gray-100 hover:border-gray-200 hover:shadow-sm"}`}>
                        <div className="flex-1">
                          <div className="flex items-start justify-between gap-2">
                            <p className="font-semibold text-gray-900 text-sm leading-snug">{p.display_name || p.name}</p>
                            {item && <span className="bg-bassani-600 text-white text-[10px] font-bold px-1.5 py-0.5 rounded-full shrink-0">×{item.product_uom_qty}</span>}
                          </div>
                          {p.default_code && <p className="font-mono text-[10px] text-gray-400 mt-0.5">{p.default_code}</p>}
                          <div className="flex items-center gap-1.5 flex-wrap mt-1">
                            {p.categ_id?.[1] && <span className="text-[10px] text-gray-400 bg-gray-50 rounded-full px-2 py-0.5">{p.categ_id[1]}</span>}
                            {minQty > 0 && <span className="text-[10px] font-semibold text-amber-700 bg-amber-50 rounded-full px-2 py-0.5">Min. {minQty} units</span>}
                          </div>
                        </div>
                        <div className="flex items-center justify-between gap-2">
                          <span className="text-base font-bold text-gray-900">{fmtR(p.list_price)}</span>
                          <span className={`text-[11px] font-semibold px-2 py-0.5 rounded-full ${outOfStock ? "bg-red-50 text-red-600" : lowStock ? "bg-amber-50 text-amber-600" : "bg-green-50 text-green-700"}`}>
                            {outOfStock ? "Out of stock" : `${p.virtual_available} available`}
                          </span>
                        </div>
                        {item ? (
                          <div className="flex items-center gap-1.5">
                            <button onClick={() => updateCartQty(item.product_id, item.product_uom_qty - 1)}
                              className="w-8 h-8 rounded-lg border border-gray-200 text-gray-600 hover:bg-gray-50 flex items-center justify-center font-bold text-base">−</button>
                            <input type="number" min={Math.max(1, minQty)} max={item._stock} value={item.product_uom_qty}
                              onChange={e => { const v = parseInt(e.target.value); if (!isNaN(v) && v >= 1) updateCartQty(item.product_id, Math.min(v, item._stock)); }}
                              className="flex-1 w-20 text-center font-bold text-sm bg-transparent border-0 focus:outline-none [appearance:textfield] [&::-webkit-outer-spin-button]:appearance-none [&::-webkit-inner-spin-button]:appearance-none" />
                            <button onClick={() => updateCartQty(item.product_id, item.product_uom_qty + 1)}
                              className="w-8 h-8 rounded-lg border border-gray-200 text-gray-600 hover:bg-gray-50 flex items-center justify-center font-bold text-base">+</button>
                            <button onClick={() => removeFromCart(item.product_id)}
                              className="w-8 h-8 rounded-lg border border-red-100 text-red-400 hover:bg-red-50 flex items-center justify-center text-xl leading-none">×</button>
                          </div>
                        ) : (
                          <button onClick={() => !outOfStock && addToCart(p)}
                            className={`w-full py-2 rounded-lg text-sm font-semibold transition-colors ${outOfStock ? "bg-gray-100 text-gray-400 cursor-not-allowed" : "bg-bassani-600 hover:bg-bassani-700 text-white"}`}>
                            {outOfStock ? "Out of stock" : "+ Add to Order"}
                          </button>
                        )}
                      </div>
                    );
                  })}
                </div>
              )}
            </div>
          </div>

          {/* ── Right panel: cart ──────────────────────────────────────── */}
          <div className="h-72 lg:h-auto w-full lg:w-80 xl:w-96 flex flex-col bg-white border-t lg:border-t-0 lg:border-l border-gray-100 shrink-0">
            <div className="px-5 py-4 border-b border-gray-100 flex items-center justify-between">
              <div>
                <h3 className="font-semibold text-gray-900">Your Order</h3>
                <p className="text-xs text-gray-400 mt-0.5">{cart.length === 0 ? "No items yet" : `${cart.length} line${cart.length > 1 ? "s" : ""} · ${fmtR(cartTotal)}`}</p>
              </div>
              {cart.length > 0 && <span className="bg-bassani-600 text-white text-xs font-bold px-2 py-0.5 rounded-full">{cart.length}</span>}
            </div>

            <div className="flex-1 overflow-y-auto px-5 py-4 space-y-4">

              {/* Customer selector */}
              <div>
                <p className="text-[10px] font-semibold text-gray-400 uppercase tracking-wider mb-1.5">
                  Ordering For (Customer) <span className="text-red-400">*</span>
                </p>
                {editQuote ? (
                  /* In edit mode the customer is locked — resellers cannot change the customer on an existing quote */
                  <div className="flex items-center gap-2 border border-gray-200 bg-gray-50 rounded-xl px-3 py-2">
                    <span className="w-2 h-2 rounded-full bg-gray-400 shrink-0"/>
                    <p className="text-sm font-semibold text-gray-700 flex-1 truncate">{editQuote.customerName}</p>
                    <span className="text-[10px] text-gray-400 shrink-0">Locked</span>
                  </div>
                ) : cartSelectedCust ? (
                  <div className="flex items-center gap-2 border border-bassani-300 bg-bassani-50 rounded-xl px-3 py-2">
                    <span className="w-2 h-2 rounded-full bg-bassani-500 shrink-0"/>
                    <p className="text-sm font-semibold text-bassani-800 flex-1 truncate">{cartSelectedCust.name}</p>
                    <button onClick={() => { setCartSelectedCust(null); setCartCustSearch(""); setCartCustDropOpen(true); }}
                      className="text-gray-400 hover:text-red-500 text-xl leading-none shrink-0">×</button>
                  </div>
                ) : (
                  <>
                  <div className="relative">
                    <Input value={cartCustSearch} onChange={e => setCartCustSearch(e.target.value)}
                      onFocus={() => setCartCustDropOpen(true)}
                      onBlur={() => setTimeout(() => setCartCustDropOpen(false), 150)}
                      placeholder="Search your customers…" />
                    <span className="absolute right-3 top-1/2 -translate-y-1/2 pointer-events-none text-gray-400">
                      <ChevronDown size={14} />
                    </span>
                    {cartCustDropOpen && (
                      <div className="absolute z-10 w-full bg-white border border-gray-200 rounded-xl shadow-lg mt-1 max-h-44 overflow-y-auto">
                        {cartCustLoading && <p className="px-3 py-2 text-xs text-gray-400">Loading…</p>}
                        {!cartCustLoading && cartCustResults.length === 0 && <p className="px-3 py-2 text-xs text-gray-400">No customers found</p>}
                        {cartCustResults.map(c => (
                          <button key={c.id} onMouseDown={() => { setCartSelectedCust(c); setCartCustSearch(c.name); setCartCustDropOpen(false); setCartCustResults([]); }}
                            className="w-full text-left px-3 py-2 hover:bg-gray-50 text-sm border-b border-gray-50 last:border-0">
                            <span className="font-medium">{c.name}</span>
                            {c.city && <span className="text-gray-400 text-xs ml-1.5">{c.city}</span>}
                          </button>
                        ))}
                      </div>
                    )}
                  </div>
                  <p className="text-[11px] text-gray-400 mt-1.5">Only your own customers appear here.</p>
                  </>
                )}
              </div>

              {/* Cart items */}
              {cart.length === 0 ? (
                <div className="py-10 text-center">
                  <p className="text-sm text-gray-400">No products added yet</p>
                  <p className="text-xs text-gray-300 mt-1">Click "+ Add to Order" on a product card</p>
                </div>
              ) : (
                <div className="space-y-2">
                  {cart.map(item => (
                    <div key={item.product_id} className="border border-gray-100 rounded-xl p-3">
                      <div className="flex items-start justify-between gap-2 mb-2">
                        <div className="min-w-0">
                          <p className="text-xs font-semibold text-gray-900 leading-snug">{item.name}</p>
                          {item._sku && <p className="font-mono text-[10px] text-gray-400">{item._sku}</p>}
                        </div>
                        <button onClick={() => removeFromCart(item.product_id)}
                          className="text-gray-300 hover:text-red-500 transition-colors text-xl leading-none shrink-0">×</button>
                      </div>
                      <div className="flex items-center gap-2">
                        <div className="flex items-center border border-gray-200 rounded-lg overflow-hidden">
                          <button onClick={() => updateCartQty(item.product_id, item.product_uom_qty - 1)}
                            className="w-7 h-7 flex items-center justify-center text-gray-500 hover:bg-gray-50 font-semibold text-sm">−</button>
                          <input type="number" min={1} max={item._stock} value={item.product_uom_qty}
                            onChange={e => { const v = parseInt(e.target.value); if (!isNaN(v) && v >= 1) updateCartQty(item.product_id, Math.min(v, item._stock)); }}
                            className="w-20 text-center text-sm font-bold text-gray-800 bg-transparent border-0 focus:outline-none [appearance:textfield] [&::-webkit-outer-spin-button]:appearance-none [&::-webkit-inner-spin-button]:appearance-none" />
                          <button onClick={() => updateCartQty(item.product_id, item.product_uom_qty + 1)}
                            className="w-7 h-7 flex items-center justify-center text-gray-500 hover:bg-gray-50 font-semibold text-sm">+</button>
                        </div>
                        <span className="text-xs text-gray-400 flex-1 truncate">× {fmtR(item.price_unit)}</span>
                        <span className="text-sm font-bold text-gray-800 shrink-0">{fmtR(item.product_uom_qty * item.price_unit)}</span>
                      </div>
                    </div>
                  ))}
                </div>
              )}
            </div>

            {/* Footer: totals + notes + actions */}
            <div className="border-t border-gray-100 px-5 py-4 space-y-3 bg-white">
              {cart.length > 0 && (
                <div className="space-y-1 text-sm">
                  <div className="flex justify-between text-gray-500">
                    <span>Subtotal (excl. VAT)</span>
                    <span>{fmtR(cartSubtotal)}</span>
                  </div>
                  <div className="flex justify-between text-gray-500">
                    <span>VAT</span>
                    <span>{fmtR(cartVat)}</span>
                  </div>
                  <div className="flex justify-between font-bold text-base pt-1.5 border-t border-gray-100">
                    <span className="text-gray-900">Total</span>
                    <span className="text-bassani-700">{fmtR(cartTotal)}</span>
                  </div>
                </div>
              )}
              <Textarea value={cartNote} onChange={e => setCartNote(e.target.value)} rows={2} placeholder="Delivery notes or special instructions…" />
              <div className="flex gap-2">
                <BtnSecondary onClick={() => {
                  if (editQuote) { setEditQuote(null); navigate("/tickets/sales"); }
                  else setView("list");
                }} className="flex-1">Cancel</BtnSecondary>
                <BtnPrimary onClick={submitCart} loading={cartSubmitting} disabled={cartSubmitting || cart.length === 0} className="flex-1">
                  {cartSubmitting ? (editQuote ? "Saving…" : "Placing…") : (editQuote ? "Save Quote" : "Place Order")}
                </BtnPrimary>
              </div>
            </div>
          </div>
        </div>
      </div>
    );
  }

  // ── List view ─────────────────────────────────────────────────────────────
  return (
    <div className="flex flex-col flex-1 overflow-hidden">
      <TopBar title="Orders" subtitle={`${orderTotal} orders`} onRefresh={load} showWarehouseSwitcher
        actions={isReseller && <BtnPrimary onClick={openNewOrder}><Plus size={14} />New Order</BtnPrimary>} />
      <main className="flex-1 overflow-y-auto p-6">
        {!isReseller && (
          <div className="mb-4 flex items-start gap-3 px-4 py-3 bg-blue-50 border border-blue-100 rounded-xl text-sm text-blue-700">
            <span className="font-semibold shrink-0">New orders:</span>
            <span>All orders — whether placed through the portal or created directly in Odoo — must flow through the <strong>Sales Tickets</strong> pipeline. Use <em>Create Sales Ticket</em> to bring any unlinked order into the pipeline. Finance must confirm payment before an order reaches the packing board.</span>
          </div>
        )}
        <div className="mb-4 space-y-2">
          <SearchBar value={search} onChange={v=>{ setSearch(v); setOrderPag(p=>({...p,pageIndex:0})); }} placeholder="Search order, customer…" />
          <ChipRow>
            {STATUSES.map(s=><FilterPill key={s} label={s==="all"?"All":s==="sale"?"Confirmed":s==="draft"?"Quotation":s.charAt(0).toUpperCase()+s.slice(1)} active={status===s} onClick={()=>{ setStatus(s); setOrderPag(p=>({...p,pageIndex:0})); }} />)}
          </ChipRow>
        </div>
        <DataTable
          columns={[
            { accessorKey:"name", header:"Order #", meta:{className:"hidden sm:table-cell"}, cell:({row:{original:o}})=><span className="font-mono text-xs text-bassani-700">{o.name}</span> },
            { id:"customer", header:"Customer", enableSorting:false, cell:({row:{original:o}})=><div><p className="font-medium text-sm">{o.partner_id?.[1]||"—"}</p>{o.reseller_name&&<span className="text-[10px] bg-purple-50 text-purple-700 px-1.5 py-0.5 rounded-full">{o.reseller_name}</span>}</div> },
            { accessorKey:"date_order", header:"Date", meta:{className:"hidden md:table-cell"}, cell:({row:{original:o}})=><span className="text-xs text-gray-500">{o.date_order?.split("T")[0]}</span> },
            { accessorKey:"amount_untaxed", header:"Amount", meta:{className:"hidden md:table-cell"}, cell:({row:{original:o}})=>fmtR(o.amount_untaxed) },
            { accessorKey:"amount_total", header:"Total", cell:({row:{original:o}})=><span className="font-semibold">{fmtR(o.amount_total)}</span> },
            { id:"state", header:"Status", enableSorting:false, cell:({row:{original:o}})=><Badge status={o.state} /> },
            { id:"invoice", header:"Payment", enableSorting:false, meta:{className:"hidden md:table-cell"}, cell:({row:{original:o}})=><Badge status={o.invoice_status} /> },
            ...(!isReseller?[{ id:"ticket", header:"Sales Ticket", enableSorting:false, meta:{className:"hidden lg:table-cell"}, cell:({row:{original:o}})=>{
              const t = o.linked_ticket;
              if (!t) return <span className="text-xs text-gray-300">—</span>;
              const EXIT_COLOR = { not_interested:"gray", cancelled:"red", complete:"green" };
              const EXIT_LABEL = { not_interested:"Not Interested", cancelled:"Cancelled", complete:"Complete" };
              const STATUS_COLOR = { open:"gray", quote:"amber", sale_order:"blue", invoice:"indigo", confirmed_wip:"teal", ready_for_collection:"green", incomplete:"orange" };
              const STATUS_LABEL = { open:"Open", quote:"Quote", sale_order:"Sale Order", invoice:"Invoice", confirmed_wip:"WIP", ready_for_collection:"Ready", incomplete:"Incomplete" };
              return t.exit_status
                ? <Badge color={EXIT_COLOR[t.exit_status]}>{EXIT_LABEL[t.exit_status]}</Badge>
                : <Badge color={STATUS_COLOR[t.status]}>{STATUS_LABEL[t.status] || t.status}</Badge>;
            }}]:[]),
            ...(!isReseller?[{ id:"packing", header:"Packing", enableSorting:false, meta:{className:"hidden lg:table-cell"}, cell:({row:{original:o}})=>{
              const PACK_COLOR = { queued:"blue", packing:"amber", ready:"indigo", complete:"green", incomplete:"orange", cancelled:"red", collected:"teal", cleared:"gray" };
              const PACK_LABEL = { queued:"Queued", packing:"Packing", ready:"Ready", complete:"Complete", incomplete:"Incomplete", cancelled:"Cancelled", collected:"Collected", cleared:"Cleared" };
              if (o.packing_status) return <Badge color={PACK_COLOR[o.packing_status]}>{PACK_LABEL[o.packing_status] || o.packing_status}</Badge>;
              if (o.state === "sale") return <span className="text-[10px] text-gray-400 italic">Not queued</span>;
              return <span className="text-xs text-gray-200">—</span>;
            }}]:[]),
            ...(!isReseller?[{ id:"actions", header:"", enableSorting:false, cell:({row:{original:o}})=>(
              <div className="flex gap-1.5" onClick={e=>e.stopPropagation()}>
                {!o.linked_ticket && !o.packing_status && o.state !== "done" && o.state !== "cancel" && can("tickets.sales") && (
                  <BtnPrimary size="sm" onClick={()=>createTicketFromOrder(o.id)} loading={creatingTicket.has(o.id)} disabled={creatingTicket.has(o.id)}>Create Sales Ticket</BtnPrimary>
                )}
              </div>
            )}]:[]),
          ]}
          data={orders} loading={loading} total={orderTotal}
          pagination={orderPag} onPaginationChange={setOrderPag}
          sorting={orderSort} onSortingChange={u=>{ setOrderSort(typeof u==="function"?u(orderSort):u); setOrderPag(p=>({...p,pageIndex:0})); }}
          onRowClick={openDetail}
          manualPagination manualSorting
        />
      </main>

      {/* ── Ticket preflight modal ───────────────────────────────────────── */}
      {ticketPreflightModal && (
        <Modal
          title={ticketPreflightModal.has_linked_ticket ? "Ticket Already Exists" : "Link Existing Ticket?"}
          onClose={() => setTicketPreflightModal(null)}
          width="max-w-lg"
        >
          {ticketPreflightModal.has_linked_ticket ? (
            <>
              <p className="text-sm text-gray-600 mb-4">
                A Sales Ticket already exists for order <strong>{ticketPreflightModal.order_name}</strong>.
                Open it to continue managing this order in the pipeline.
              </p>
              <div className="flex justify-end gap-2">
                <BtnSecondary onClick={() => setTicketPreflightModal(null)}>Cancel</BtnSecondary>
                <BtnPrimary onClick={() => {
                  navigate("/tickets/sales", { state: { openTicketId: ticketPreflightModal.existing_ticket_id } });
                  setTicketPreflightModal(null);
                }}>Open Existing Ticket</BtnPrimary>
              </div>
            </>
          ) : (
            <>
              <p className="text-sm text-gray-600 mb-4">
                The following open inquiry tickets have no order assigned yet. You can link one to
                order <strong>{ticketPreflightModal.order_name}</strong> instead of creating a new ticket.
              </p>
              <div className="border border-gray-200 rounded-xl overflow-hidden mb-4">
                {ticketPreflightModal.unlinked_tickets.map(t => (
                  <div key={t.id} className="flex items-center justify-between px-4 py-3 border-b border-gray-100 last:border-0">
                    <div>
                      <p className="text-sm font-medium text-gray-900">{t.customer_name}</p>
                      <p className="text-xs text-gray-400 mt-0.5">
                        {t.source === "email" ? "Email inquiry" : "Direct inquiry"} · {t.created_at ? new Date(t.created_at).toLocaleDateString("en-ZA") : ""}
                      </p>
                    </div>
                    <BtnSecondary size="sm" onClick={() => doLinkUnlinkedTicket(t.id)}>Link This</BtnSecondary>
                  </div>
                ))}
              </div>
              <div className="flex justify-end gap-2">
                <BtnSecondary onClick={() => setTicketPreflightModal(null)}>Cancel</BtnSecondary>
                <BtnPrimary onClick={doCreateTicket}>Create New Ticket</BtnPrimary>
              </div>
            </>
          )}
        </Modal>
      )}
    </div>
  );
}

// ─────────────────────────────────────────────────────────────────────────────
// Resellers view
// ─────────────────────────────────────────────────────────────────────────────
export function Resellers() {
  const { can } = useAuth();
  const navigate = useNavigate();
  const BLANK_FORM = { name:"", type:"Distributor", seller_code:"", contact_person:"", email:"", phone:"", commission_eligible:true, odoo_partner_id:"", warehouse_id:"", username:"", password:"", company_reg_number:"", vat_registered:false, vat_number:"", bank_name:"", bank_account_holder:"", bank_account_number:"", bank_branch_code:"" };

  const [resellers,          setResellers         ] = useState([]);
  const [loading,            setLoading           ] = useState(true);
  const [warehouses,         setWarehouses        ] = useState([]);
  const [defaultWarehouseId, setDefaultWarehouseId] = useState(null);
  const [modal,              setModal             ] = useState(false);
  const [form,               setForm              ] = useState(BLANK_FORM);
  const [customerSearch,     setCustomerSearch    ] = useState("");
  const [customers,          setCustomers         ] = useState([]);
  const [customerLoading,    setCustomerLoading   ] = useState(false);
  const [selectedCustomer,   setSelectedCustomer  ] = useState(null);
  const [custDropdownOpen,   setCustDropdownOpen  ] = useState(false);
  const [editModal,              setEditModal             ] = useState(false);
  const [editingId,              setEditingId             ] = useState(null);
  const [editForm,               setEditForm              ] = useState({ name:"", type:"Distributor", contact_person:"", email:"", phone:"", commission_eligible:true, odoo_partner_id:null, warehouse_id:"", company_reg_number:"", vat_registered:false, vat_number:"", bank_name:"", bank_account_holder:"", bank_account_number:"", bank_branch_code:"" });
  const [editSelectedCustomer,   setEditSelectedCustomer  ] = useState(null);
  const [saving,                 setSaving                ] = useState(false);
  const [editSaving,             setEditSaving            ] = useState(false);

  const [rStep, setRStep] = useState(1);

  const load = async () => {
    setLoading(true);
    try { const r = await api.get("/api/resellers/"); setResellers(r.data.resellers); }
    catch { toast.error("Failed to load sales agents"); }
    finally { setLoading(false); }
  };
  useEffect(() => { load(); }, []);
  useEffect(() => {
    api.get("/api/warehouses/").then(r => {
      setWarehouses(r.data.warehouses || []);
      setDefaultWarehouseId(r.data.default_warehouse_id || null);
    }).catch(() => {});
  }, []);

  // Load customers whenever dropdown is open — debounce only when typing
  useEffect(() => {
    if (!custDropdownOpen) { setCustomers([]); return; }
    const delay = customerSearch.length >= 2 ? 300 : 0;
    const t = setTimeout(async () => {
      setCustomerLoading(true);
      try {
        const params = { limit: 20, mode: "partner" };
        if (customerSearch.length >= 2) params.search = customerSearch;
        const r = await api.get("/api/customers/", { params });
        setCustomers(r.data.customers || []);
      } catch { setCustomers([]); }
      finally { setCustomerLoading(false); }
    }, delay);
    return () => clearTimeout(t);
  }, [customerSearch, custDropdownOpen]);

  const selectCustomer = (c) => {
    setSelectedCustomer(c);
    setCustDropdownOpen(false);
    setCustomers([]);
    setCustomerSearch("");
    setForm(f => ({
      ...f,
      odoo_partner_id: c.id,
      name:        f.name        || c.name        || "",
      email:       f.email       || c.email        || "",
      phone:       f.phone       || c.phone        || "",
      seller_code: f.seller_code || c.ref          || "",
    }));
  };

  const clearCustomer = () => {
    setSelectedCustomer(null);
    setForm(f => ({ ...f, odoo_partner_id: "" }));
    setCustomerSearch("");
    setCustDropdownOpen(true);
  };

  const openModal = () => {
    setForm({ ...BLANK_FORM, warehouse_id: defaultWarehouseId ? String(defaultWarehouseId) : "" });
    setSelectedCustomer(null); setCustomerSearch(""); setCustomers([]); setCustDropdownOpen(false);
    setRStep(1);
    setModal(true);
  };

  const openEdit = (r) => {
    setEditForm({
      name: r.name, type: r.type, contact_person: r.contact_person||"", email: r.email||"", phone: r.phone||"",
      commission_eligible: r.commission_eligible !== false,
      odoo_partner_id: r.odoo_partner_id || null,
      warehouse_id: r.warehouse_id || "",
      company_reg_number: r.company_reg_number || "",
      vat_registered: r.vat_registered || false, vat_number: r.vat_number || "",
      bank_name: r.bank_name || "", bank_account_holder: r.bank_account_holder || "",
      bank_account_number: r.bank_account_number || "", bank_branch_code: r.bank_branch_code || "",
    });
    setEditingId(r.id);
    setEditSelectedCustomer(null);
    setCustomerSearch(""); setCustomers([]); setCustDropdownOpen(false);
    if (r.odoo_partner_id) {
      api.get(`/api/customers/${r.odoo_partner_id}`)
        .then(res => setEditSelectedCustomer({ id: r.odoo_partner_id, name: res.data.name || `Partner #${r.odoo_partner_id}`, email: res.data.email || null }))
        .catch(() => setEditSelectedCustomer({ id: r.odoo_partner_id, name: `Partner #${r.odoo_partner_id}`, email: null }));
    }
    setEditModal(true);
  };

  const editSelectCustomer = (c) => {

    setEditSelectedCustomer(c);
    setCustDropdownOpen(false);
    setCustomers([]);
    setCustomerSearch("");
    setEditForm(f => ({ ...f, odoo_partner_id: c.id }));
  };

  const editClearCustomer = () => {
    setEditSelectedCustomer(null);
    setEditForm(f => ({ ...f, odoo_partner_id: null }));
    setCustomerSearch("");
    setCustDropdownOpen(true);
  };

  const saveEdit = async () => {
    if (!editForm.name) return toast.error("Name required");
    setEditSaving(true);
    try {
      const payload = { ...editForm };
      payload.warehouse_id = payload.warehouse_id ? parseInt(payload.warehouse_id) : null;
      payload.odoo_partner_id = editForm.odoo_partner_id ? parseInt(editForm.odoo_partner_id) : null;
      await api.put(`/api/resellers/${editingId}`, payload);
      toast.success("Sales agent updated");
      setEditModal(false);
      load();
    } catch (e) { toast.error(e.response?.data?.detail || "Save failed"); }
    finally { setEditSaving(false); }
  };

  const save = async () => {
    if (!form.name || !form.seller_code) return toast.error("Name and seller code required");
    if (!form.username || !form.password) return toast.error("Username and password are required");
    if (form.password.length < 8) return toast.error("Password must be at least 8 characters");
    setSaving(true);
    try {
      const payload = { ...form };
      if (payload.odoo_partner_id) payload.odoo_partner_id = parseInt(payload.odoo_partner_id);
      else delete payload.odoo_partner_id;
      if (payload.warehouse_id) payload.warehouse_id = parseInt(payload.warehouse_id);
      else delete payload.warehouse_id;
      await api.post("/api/resellers/", payload);
      toast.success("Sales agent created");
      setModal(false);
      load();
    } catch (e) { toast.error(e.response?.data?.detail || "Save failed"); }
    finally { setSaving(false); }
  };

  return (
    <div className="flex flex-col flex-1 overflow-hidden">
      <TopBar title="Sales Agents" subtitle="Distributors, agents and brokers" onRefresh={load}
        actions={can("resellers.manage") && <BtnPrimary onClick={openModal}><Plus size={14}/>Add Sales Agent</BtnPrimary>} />
      <main className="flex-1 overflow-y-auto p-6">
        <DataTable
          columns={[
            { accessorKey:"name", header:"Name / Code", cell:({row:{original:r}})=><div><p className="font-semibold text-gray-900">{r.name}</p><p className="text-[10px] font-mono text-gray-400">{r.seller_code}</p></div> },
            { accessorKey:"type", header:"Type", meta:{className:"hidden sm:table-cell"}, cell:({row:{original:r}})=><span className="text-xs text-gray-500">{r.type}</span> },
            { id:"contact", header:"Contact", enableSorting:false, meta:{className:"hidden md:table-cell"}, cell:({row:{original:r}})=><div><p className="text-gray-700">{r.contact_person||"—"}</p>{r.email&&<p className="text-[10px] text-gray-400">{r.email}</p>}</div> },
            { id:"actions", header:"", enableSorting:false, cell:({row:{original:r}})=>(
              <div className="flex gap-2">
                <BtnSecondary size="sm" onClick={e=>{e.stopPropagation();navigate(`/resellers/${r.id}`);}}>View</BtnSecondary>
                {can("resellers.manage") && <BtnSecondary size="sm" onClick={e=>{e.stopPropagation();openEdit(r);}}><Edit2 size={11}/>Edit</BtnSecondary>}
              </div>
            )},
          ]}
          data={resellers} loading={loading}
        />
      </main>

      {modal && (
        <Modal title="Add Sales Agent" onClose={()=>setModal(false)} width="max-w-xl">

          {/* Step indicator */}
          {(() => {
            const STEPS = ["Odoo Partner", "Business", "Login", "Financials"];
            return (
              <div className="flex items-center gap-0 mb-6">
                {STEPS.map((label, i) => {
                  const n     = i + 1;
                  const done  = rStep > n;
                  const active = rStep === n;
                  return (
                    <div key={n} className="flex items-center flex-1 last:flex-none">
                      <div className="flex flex-col items-center gap-1 shrink-0">
                        <div className={`w-7 h-7 rounded-full flex items-center justify-center text-xs font-bold transition-colors
                          ${done  ? "bg-green-500 text-white" :
                            active ? "bg-bassani-600 text-white" :
                                     "bg-gray-100 text-gray-400"}`}>
                          {done ? "✓" : n}
                        </div>
                        <span className={`text-[10px] font-medium ${active ? "text-bassani-700" : "text-gray-400"}`}>{label}</span>
                      </div>
                      {i < STEPS.length - 1 && (
                        <div className={`flex-1 h-px mx-1 mb-3 ${rStep > n ? "bg-green-400" : "bg-gray-200"}`} />
                      )}
                    </div>
                  );
                })}
              </div>
            );
          })()}

          {/* ── Step 1: Commission Eligibility + Odoo Partner + Documents ── */}
          {rStep === 1 && (
            <div className="space-y-4">

              {/* Commission eligibility toggle */}
              <div className="rounded-xl border border-gray-100 bg-gray-50 px-4 py-3">
                <label className="flex items-start gap-3 cursor-pointer">
                  <input type="checkbox" checked={form.commission_eligible}
                    onChange={e => {
                      setForm(f => ({ ...f, commission_eligible: e.target.checked }));
                      if (!e.target.checked) { setSelectedCustomer(null); setRSellerCustHasDocs(null); setCustDropdownOpen(false); }
                    }}
                    className="mt-0.5 w-4 h-4 accent-bassani-600 shrink-0" />
                  <div>
                    <p className="text-sm font-semibold text-gray-800">Applicable for commission</p>
                    <p className="text-xs text-gray-400 mt-0.5">Uncheck for internal Bassani staff accounts. Non-eligible agents are excluded from commission statements and will not see the Commission section in their portal.</p>
                  </div>
                </label>
              </div>

              {form.commission_eligible ? (<>
              <div>
                <p className="text-xs font-semibold text-gray-500 mb-1 uppercase tracking-wider">Odoo Partner <span className="text-red-400 font-normal normal-case">* required for commission</span></p>
                <p className="text-xs text-gray-400 mb-2">Required for commission payouts — when a statement is paid, a vendor bill is raised against this partner. Selecting a partner here will also pre-fill their business details on the next step.</p>
                <div className="relative">
                  {selectedCustomer ? (
                    <div className="flex items-center gap-3 border border-bassani-300 bg-bassani-50 rounded-xl px-4 py-2.5">
                      <span className="w-2 h-2 rounded-full bg-bassani-500 shrink-0"/>
                      <div className="flex-1 min-w-0">
                        <p className="text-sm font-semibold text-bassani-800 truncate">{selectedCustomer.name}</p>
                        {selectedCustomer.email && <p className="text-xs text-gray-400 truncate">{selectedCustomer.email}</p>}
                      </div>
                      {(() => {
                        const isCust = (selectedCustomer.customer_rank || 0) > 0;
                        const isSupp = (selectedCustomer.supplier_rank || 0) > 0;
                        if (isCust && isSupp) return <span className="text-[9px] font-semibold bg-purple-100 text-purple-700 px-1.5 py-0.5 rounded shrink-0">Cust & Supplier</span>;
                        if (isSupp) return <span className="text-[9px] font-semibold bg-amber-100 text-amber-700 px-1.5 py-0.5 rounded shrink-0">Supplier</span>;
                        return <span className="text-[9px] font-semibold bg-blue-100 text-blue-700 px-1.5 py-0.5 rounded shrink-0">Customer</span>;
                      })()}
                      <button onClick={clearCustomer} className="text-gray-400 hover:text-red-500 transition-colors text-xl leading-none shrink-0">×</button>
                    </div>
                  ) : (
                    <div className="relative">
                      <Input value={customerSearch} onChange={e=>setCustomerSearch(e.target.value)}
                        onFocus={()=>setCustDropdownOpen(true)} onBlur={()=>setTimeout(()=>setCustDropdownOpen(false),150)}
                        placeholder="Click to browse or type to search…" className="pr-10" autoFocus />
                      <span className="absolute right-3 top-1/2 -translate-y-1/2 text-gray-400 pointer-events-none">
                        <ChevronDown size={15} className={custDropdownOpen?"rotate-180 transition-transform":"transition-transform"} />
                      </span>
                    </div>
                  )}
                  {custDropdownOpen && !selectedCustomer && (
                    <div className="absolute z-10 w-full bg-white border border-gray-200 rounded-xl shadow-lg mt-1 max-h-48 overflow-y-auto">
                      {customerLoading && <p className="px-4 py-3 text-xs text-gray-400">Loading partners…</p>}
                      {!customerLoading && customers.length === 0 && (
                        <div className="px-4 py-3">
                          <p className="text-xs text-gray-400">No partners found.</p>
                          <p className="text-xs text-gray-400 mt-1">If the customer does not exist yet, complete their onboarding via Customer Applications first, then return here to create the sales agent.</p>
                        </div>
                      )}
                      {customers.map(c=>(
                        <button key={c.id} onMouseDown={()=>selectCustomer(c)}
                          className="w-full text-left px-4 py-2.5 hover:bg-gray-50 text-sm border-b border-gray-50 last:border-0">
                          <div className="flex items-center justify-between gap-2">
                            <span className="font-medium text-gray-900">{c.name}</span>
                            <div className="flex items-center gap-1 shrink-0">
                              {c.ref && <span className="font-mono text-[10px] text-bassani-600 bg-bassani-50 px-1.5 py-0.5 rounded">{c.ref}</span>}
                              {(() => {
                                const isCust = (c.customer_rank || 0) > 0;
                                const isSupp = (c.supplier_rank || 0) > 0;
                                if (isCust && isSupp) return <span className="text-[9px] font-semibold bg-purple-100 text-purple-700 px-1.5 py-0.5 rounded">Cust & Supplier</span>;
                                if (isSupp) return <span className="text-[9px] font-semibold bg-amber-100 text-amber-700 px-1.5 py-0.5 rounded">Supplier</span>;
                                return <span className="text-[9px] font-semibold bg-blue-100 text-blue-700 px-1.5 py-0.5 rounded">Customer</span>;
                              })()}
                            </div>
                          </div>
                          {c.email && <span className="text-gray-400 text-xs">{c.email}</span>}
                        </button>
                      ))}
                    </div>
                  )}
                </div>
              </div>
              </>) : (
                <div className="rounded-xl border border-gray-100 bg-gray-50 px-4 py-3">
                  <p className="text-xs text-gray-500">Internal staff accounts do not require an Odoo vendor profile.</p>
                </div>
              )}

              <div className="flex justify-end">
                <BtnPrimary onClick={() => {
                  if (form.commission_eligible && !selectedCustomer)
                    return toast.error("An Odoo partner link is required for commission-eligible sales agents.");
                  setRStep(2);
                }}>Next →</BtnPrimary>
              </div>
            </div>
          )}

          {/* ── Step 2: Business Details ── */}
          {rStep === 2 && (
            <div className="space-y-4">
              {selectedCustomer && (
                <p className="text-xs text-bassani-600 bg-bassani-50 border border-bassani-100 rounded-lg px-3 py-2">
                  Pre-filled from <span className="font-semibold">{selectedCustomer.name}</span> — review and adjust as needed.
                </p>
              )}
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                <FormGroup label="Business Name" required><Input value={form.name} onChange={e=>setForm({...form,name:e.target.value})} autoFocus /></FormGroup>
                <FormGroup label="Type"><Select value={form.type} onChange={e=>setForm({...form,type:e.target.value})}>{["Distributor","Agent","Broker"].map(t=><option key={t}>{t}</option>)}</Select></FormGroup>
                <FormGroup label="Seller Code" required><Input value={form.seller_code} onChange={e=>setForm({...form,seller_code:e.target.value.toUpperCase()})} placeholder="JOE001" /></FormGroup>
                <FormGroup label="Contact Person"><Input value={form.contact_person} onChange={e=>setForm({...form,contact_person:e.target.value})} /></FormGroup>
                <FormGroup label="Email"><Input value={form.email} onChange={e=>setForm({...form,email:e.target.value})} /></FormGroup>
                <FormGroup label="Phone"><Input value={form.phone} onChange={e=>setForm({...form,phone:e.target.value})} /></FormGroup>
                <FormGroup label="Warehouse" className="sm:col-span-2">
                  <Select value={form.warehouse_id} onChange={e=>setForm({...form,warehouse_id:e.target.value})}>
                    <option value="">— No warehouse assigned —</option>
                    {warehouses.map(w=><option key={w.id} value={w.id}>{w.name}</option>)}
                  </Select>
                  <p className="text-[11px] text-gray-400 mt-1">This agent's orders will draw stock from the selected warehouse.</p>
                </FormGroup>
              </div>
              <div className="flex justify-between">
                <BtnSecondary onClick={()=>setRStep(1)}>← Back</BtnSecondary>
                <BtnPrimary onClick={() => {
                  if (!form.name) return toast.error("Business name is required");
                  if (!form.seller_code) return toast.error("Seller code is required");
                  setRStep(3);
                }}>Next →</BtnPrimary>
              </div>
            </div>
          )}

          {/* ── Step 3: Login Credentials ── */}
          {rStep === 3 && (
            <div className="space-y-4">
              <p className="text-sm text-gray-500">Set the portal login credentials for this sales agent. They will be required to change their password on first login.</p>
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                <FormGroup label="Username" required>
                  <Input value={form.username} onChange={e=>setForm({...form,username:e.target.value.toLowerCase().replace(/\s/g,"")})} placeholder="e.g. joe.smith" autoFocus />
                </FormGroup>
                <FormGroup label="Password" required>
                  <Input type="password" value={form.password} onChange={e=>setForm({...form,password:e.target.value})} placeholder="Min. 8 characters" />
                </FormGroup>
              </div>
              <div className="flex justify-between">
                <BtnSecondary onClick={()=>setRStep(2)}>← Back</BtnSecondary>
                <BtnPrimary onClick={() => {
                  if (!form.username) return toast.error("Username is required");
                  if (!form.password) return toast.error("Password is required");
                  if (form.password.length < 8) return toast.error("Password must be at least 8 characters");
                  setRStep(4);
                }}>Next →</BtnPrimary>
              </div>
            </div>
          )}

          {/* ── Step 4: Financials ── */}
          {rStep === 4 && (
            <div className="space-y-4">
              <div>
                <p className="text-xs font-semibold text-gray-500 mb-2 uppercase tracking-wider">Registration</p>
                <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                  <FormGroup label="Company Reg Number">
                    <Input value={form.company_reg_number} onChange={e=>setForm({...form,company_reg_number:e.target.value})} placeholder="e.g. 2023/123456/07" />
                  </FormGroup>
                  <div className="space-y-2">
                    <FormGroup label="VAT">
                      <label className="flex items-center gap-2 cursor-pointer h-9">
                        <input type="checkbox" checked={form.vat_registered} onChange={e=>setForm({...form,vat_registered:e.target.checked,vat_number:e.target.checked?form.vat_number:""})} className="w-4 h-4 accent-bassani-600" />
                        <span className="text-sm text-gray-700">VAT registered</span>
                      </label>
                    </FormGroup>
                    {form.vat_registered && (
                      <FormGroup label="VAT Number"><Input value={form.vat_number} onChange={e=>setForm({...form,vat_number:e.target.value})} placeholder="e.g. 4123456789" /></FormGroup>
                    )}
                  </div>
                </div>
              </div>
              <div>
                <p className="text-xs font-semibold text-gray-500 mb-2 uppercase tracking-wider">Banking Details <span className="text-gray-300 font-normal normal-case">(for EFT commission payouts)</span></p>
                <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                  <FormGroup label="Bank Name"><Input value={form.bank_name} onChange={e=>setForm({...form,bank_name:e.target.value})} placeholder="e.g. FNB" /></FormGroup>
                  <FormGroup label="Account Holder"><Input value={form.bank_account_holder} onChange={e=>setForm({...form,bank_account_holder:e.target.value})} /></FormGroup>
                  <FormGroup label="Account Number"><Input value={form.bank_account_number} onChange={e=>setForm({...form,bank_account_number:e.target.value})} /></FormGroup>
                  <FormGroup label="Branch Code"><Input value={form.bank_branch_code} onChange={e=>setForm({...form,bank_branch_code:e.target.value})} placeholder="e.g. 250655" /></FormGroup>
                </div>
              </div>
              <div className="flex justify-between">
                <BtnSecondary onClick={()=>setRStep(3)} disabled={saving}>← Back</BtnSecondary>
                <BtnPrimary onClick={save} loading={saving}>Create Sales Agent</BtnPrimary>
              </div>
            </div>
          )}

        </Modal>
      )}

      {editModal && (
        <Modal title="Edit Sales Agent" onClose={()=>setEditModal(false)} width="max-w-2xl">

          {/* Commission eligibility */}
          <div className="rounded-xl border border-gray-100 bg-gray-50 px-4 py-3 mb-4">
            <label className="flex items-start gap-3 cursor-pointer">
              <input type="checkbox" checked={editForm.commission_eligible}
                onChange={e => setEditForm(f => ({ ...f, commission_eligible: e.target.checked }))}
                className="mt-0.5 w-4 h-4 accent-bassani-600 shrink-0" />
              <div>
                <p className="text-sm font-semibold text-gray-800">Applicable for commission</p>
                <p className="text-xs text-gray-400 mt-0.5">Uncheck for internal Bassani staff accounts. Non-eligible agents are excluded from commission statements and will not see the Commission section in their portal.</p>
              </div>
            </label>
          </div>

          {/* Section 1 — Odoo vendor partner link (commission only) */}
          {editForm.commission_eligible && <>
          <p className="text-xs font-semibold text-gray-500 mb-2 uppercase tracking-wider">Odoo Vendor Profile <span className="text-gray-300 font-normal normal-case">(optional — used for commission billing)</span></p>
          <div className="relative mb-4">
            {editSelectedCustomer ? (
              <div className="flex items-center gap-3 border border-bassani-300 bg-bassani-50 rounded-xl px-4 py-2.5">
                <span className="w-2 h-2 rounded-full bg-bassani-500 shrink-0"/>
                <div className="flex-1 min-w-0">
                  <p className="text-sm font-semibold text-bassani-800 truncate">{editSelectedCustomer.name}</p>
                  {editSelectedCustomer.email && <p className="text-xs text-gray-400 truncate">{editSelectedCustomer.email}</p>}
                </div>
                <button onClick={editClearCustomer}
                  className="text-gray-400 hover:text-red-500 transition-colors text-xl leading-none shrink-0">×</button>
              </div>
            ) : (
              <div className="relative">
                <Input
                  value={customerSearch}
                  onChange={e=>setCustomerSearch(e.target.value)}
                  onFocus={()=>setCustDropdownOpen(true)}
                  onBlur={()=>setTimeout(()=>setCustDropdownOpen(false), 150)}
                  placeholder="Click to browse or type to search…"
                  className="pr-10"
                />
                <span className="absolute right-3 top-1/2 -translate-y-1/2 text-gray-400 pointer-events-none">
                  <ChevronDown size={15} className={custDropdownOpen ? "rotate-180 transition-transform" : "transition-transform"} />
                </span>
              </div>
            )}
            {custDropdownOpen && !editSelectedCustomer && (
              <div className="absolute z-10 w-full bg-white border border-gray-200 rounded-xl shadow-lg mt-1 max-h-56 overflow-y-auto">
                {customerLoading && <p className="px-4 py-3 text-xs text-gray-400">Loading customers…</p>}
                {!customerLoading && customers.length === 0 && <p className="px-4 py-3 text-xs text-gray-400">No customers found</p>}
                {customers.map(c=>(
                  <button key={c.id} onMouseDown={()=>editSelectCustomer(c)}
                    className="w-full text-left px-4 py-2.5 hover:bg-gray-50 text-sm border-b border-gray-50 last:border-0">
                    <div className="flex items-center justify-between gap-2">
                      <span className="font-medium text-gray-900">{c.name}</span>
                      {c.ref && <span className="font-mono text-[10px] text-bassani-600 bg-bassani-50 px-1.5 py-0.5 rounded">{c.ref}</span>}
                    </div>
                    {c.email && <span className="text-gray-400 text-xs">{c.email}</span>}
                  </button>
                ))}
              </div>
            )}
          </div>
          </>}

          <p className="text-xs font-semibold text-gray-500 mb-2 uppercase tracking-wider">Business Details</p>
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-3 mb-4">
            <FormGroup label="Business Name" required><Input value={editForm.name} onChange={e=>setEditForm({...editForm,name:e.target.value})} /></FormGroup>
            <FormGroup label="Type"><Select value={editForm.type} onChange={e=>setEditForm({...editForm,type:e.target.value})}>{["Distributor","Agent","Broker"].map(t=><option key={t}>{t}</option>)}</Select></FormGroup>
            <FormGroup label="Contact Person"><Input value={editForm.contact_person} onChange={e=>setEditForm({...editForm,contact_person:e.target.value})} /></FormGroup>
            <FormGroup label="Email"><Input value={editForm.email} onChange={e=>setEditForm({...editForm,email:e.target.value})} /></FormGroup>
            <FormGroup label="Phone"><Input value={editForm.phone} onChange={e=>setEditForm({...editForm,phone:e.target.value})} /></FormGroup>
            <FormGroup label="Warehouse" className="sm:col-span-2">
              <Select value={editForm.warehouse_id} onChange={e=>setEditForm({...editForm,warehouse_id:e.target.value})}>
                <option value="">— No warehouse assigned —</option>
                {warehouses.map(w=><option key={w.id} value={w.id}>{w.name}</option>)}
              </Select>
            </FormGroup>
          </div>

          <p className="text-xs font-semibold text-gray-500 mb-2 uppercase tracking-wider">Registration</p>
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-3 mb-4">
            <FormGroup label="Company Reg Number">
              <Input value={editForm.company_reg_number} onChange={e=>setEditForm({...editForm,company_reg_number:e.target.value})} placeholder="e.g. 2023/123456/07" />
            </FormGroup>
            <div className="space-y-2">
              <FormGroup label="VAT">
                <label className="flex items-center gap-2 cursor-pointer h-9">
                  <input type="checkbox" checked={editForm.vat_registered} onChange={e=>setEditForm({...editForm,vat_registered:e.target.checked,vat_number:e.target.checked?editForm.vat_number:""})}
                    className="w-4 h-4 accent-bassani-600" />
                  <span className="text-sm text-gray-700">VAT registered</span>
                </label>
              </FormGroup>
              {editForm.vat_registered && (
                <FormGroup label="VAT Number"><Input value={editForm.vat_number} onChange={e=>setEditForm({...editForm,vat_number:e.target.value})} placeholder="e.g. 4123456789" /></FormGroup>
              )}
            </div>
          </div>

          {editForm.commission_eligible && <>
          <p className="text-xs font-semibold text-gray-500 mb-2 uppercase tracking-wider">Banking Details <span className="text-gray-300 font-normal normal-case">(for EFT commission payouts)</span></p>
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-3 mb-4">
            <FormGroup label="Bank Name"><Input value={editForm.bank_name} onChange={e=>setEditForm({...editForm,bank_name:e.target.value})} placeholder="e.g. FNB" /></FormGroup>
            <FormGroup label="Account Holder"><Input value={editForm.bank_account_holder} onChange={e=>setEditForm({...editForm,bank_account_holder:e.target.value})} /></FormGroup>
            <FormGroup label="Account Number"><Input value={editForm.bank_account_number} onChange={e=>setEditForm({...editForm,bank_account_number:e.target.value})} /></FormGroup>
            <FormGroup label="Branch Code"><Input value={editForm.bank_branch_code} onChange={e=>setEditForm({...editForm,bank_branch_code:e.target.value})} placeholder="e.g. 250655" /></FormGroup>
          </div>
          </>}

          <div className="flex justify-end gap-2"><BtnSecondary onClick={()=>setEditModal(false)} disabled={editSaving}>Cancel</BtnSecondary><BtnPrimary onClick={saveEdit} loading={editSaving}>Save Changes</BtnPrimary></div>
        </Modal>
      )}

    </div>
  );
}

// ─────────────────────────────────────────────────────────────────────────────
// Reseller commission view — tier progress + statement history
// ─────────────────────────────────────────────────────────────────────────────
function ResellerCommissionView() {
  const { user } = useAuth();
  const [progress,      setProgress     ] = useState(null);
  const [history,       setHistory      ] = useState([]);
  const [loading,       setLoading      ] = useState(true);
  const [resellerId,    setResellerId   ] = useState(null);
  const [disputeModal,  setDisputeModal ] = useState(null);
  const [disputeReason, setDisputeReason] = useState("");
  const [disputing,     setDisputing    ] = useState(false);

  const loadHistory = async (rid) => {
    const hRes = await api.get(`/api/commission/${rid}/history`);
    setHistory(hRes.data.records || []);
  };

  useEffect(() => {
    (async () => {
      try {
        const me = await api.get("/api/auth/me");
        const rid = me.data.reseller_id;
        if (!rid) return;
        setResellerId(rid);
        const [pRes, hRes] = await Promise.all([
          api.get(`/api/commission/${rid}/current-month`),
          api.get(`/api/commission/${rid}/history`),
        ]);
        setProgress(pRes.data);
        setHistory(hRes.data.records || []);
      } catch { toast.error("Failed to load commission data"); }
      finally { setLoading(false); }
    })();
  }, []);

  const dispute = async () => {
    if (!disputeModal) return;
    setDisputing(true);
    try {
      await api.post(`/api/commission/statements/${disputeModal.id}/dispute`, { reason: disputeReason });
      toast.success(`Dispute submitted for ${disputeModal.month_label}`);
      setDisputeModal(null);
      if (resellerId) await loadHistory(resellerId);
    } catch (e) { toast.error(e.response?.data?.detail || "Failed to submit dispute"); }
    finally { setDisputing(false); }
  };

  if (user?.commission_eligible === false) {
    return (
      <div className="flex flex-col items-center justify-center flex-1 py-20 text-center px-6">
        <Percent size={40} className="text-gray-200 mb-4" />
        <p className="text-gray-500 font-medium mb-1">Commission not applicable</p>
        <p className="text-sm text-gray-400 max-w-xs">This account is not enrolled in the commission programme.</p>
      </div>
    );
  }

  if (loading) return <LoadingState />;

  const tiers = progress?.all_tiers || [];
  const currentTier = progress?.tier?.tier;

  return (
    <div className="space-y-5">
      {/* Current month progress */}
      {progress && (
        <div className="bg-white border border-gray-100 rounded-2xl p-5">
          <div className="flex items-start justify-between gap-4 flex-wrap mb-5">
            <div>
              <p className="text-xs text-gray-400 font-medium mb-0.5">{progress.month_label} Progress</p>
              <p className="text-2xl font-bold text-gray-900">{fmtR(progress.total_turnover)}</p>
              <p className="text-xs text-gray-400 mt-0.5">{progress.order_count} order{progress.order_count !== 1 ? "s" : ""} this month</p>
            </div>
            <div className="text-right">
              <p className="text-xs text-gray-400 mb-0.5">Projected Commission</p>
              <p className="text-2xl font-bold text-bassani-700">{fmtR(progress.commission_projected)}</p>
              <p className="text-xs text-gray-400 mt-0.5">{progress.tier?.label} @ {progress.commission_rate}%</p>
            </div>
          </div>
          {progress.next_tier && (
            <div>
              <div className="flex justify-between text-xs text-gray-500 mb-1.5">
                <span>Progress to {progress.next_tier.label} ({progress.next_tier.rate}%)</span>
                <span>{fmtR(progress.next_tier_gap)} to go</span>
              </div>
              <div className="h-2.5 bg-gray-100 rounded-full overflow-hidden">
                <div className="h-full bg-bassani-600 rounded-full transition-all"
                  style={{ width: `${Math.min(progress.next_tier_pct, 100)}%` }} />
              </div>
              <p className="text-[10px] text-gray-400 mt-1">{progress.next_tier_pct}% of {progress.next_tier.range}</p>
            </div>
          )}
          {!progress.next_tier && (
            <div className="flex items-center gap-2 text-xs text-emerald-700 font-semibold">
              <span className="w-2 h-2 rounded-full bg-emerald-500 inline-block" />
              Maximum tier achieved — {progress.commission_rate}%
            </div>
          )}
        </div>
      )}

      {/* Tier bands table */}
      <div className="bg-white border border-gray-100 rounded-2xl overflow-hidden">
        <div className="px-5 py-4 border-b border-gray-50">
          <h3 className="text-sm font-semibold text-gray-800">Commission Structure</h3>
          <p className="text-xs text-gray-400 mt-0.5">Your rate is determined by total monthly turnover</p>
        </div>
        <table className="w-full text-sm">
          <thead>
            <tr className="bg-gray-50">
              {["Tier","Turnover Range","Commission Rate",""].map(h=>(
                <th key={h} className="text-left text-[10px] font-semibold text-gray-400 uppercase tracking-wider px-5 py-2.5">{h}</th>
              ))}
            </tr>
          </thead>
          <tbody>
            {tiers.map(t => {
              const active = t.tier === currentTier;
              return (
                <tr key={t.tier} className={`border-t border-gray-50 ${active ? "bg-bassani-50" : "hover:bg-gray-50"} transition-colors`}>
                  <td className="px-5 py-3 font-semibold text-gray-700">{t.label}</td>
                  <td className="px-5 py-3 text-gray-500">{t.range}</td>
                  <td className="px-5 py-3 font-bold text-bassani-700">{t.rate}%</td>
                  <td className="px-5 py-3">
                    {active && <span className="text-[10px] bg-bassani-600 text-white px-2 py-0.5 rounded-full font-semibold">Current</span>}
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>

      {/* Monthly statement history */}
      <div className="bg-white border border-gray-100 rounded-2xl overflow-hidden">
        <div className="px-5 py-4 border-b border-gray-50">
          <h3 className="text-sm font-semibold text-gray-800">Statement History</h3>
          <p className="text-xs text-gray-400 mt-0.5">Monthly commission statements</p>
        </div>
        <div className="overflow-x-auto">
          <table className="w-full text-sm min-w-[580px]">
            <thead>
              <tr className="bg-gray-50">
                {["Month","Turnover","Tier","Rate","Commission","Status",""].map(h=>(
                  <th key={h} className="text-left text-[10px] font-semibold text-gray-400 uppercase tracking-wider px-5 py-2.5">{h}</th>
                ))}
              </tr>
            </thead>
            <tbody>
              {history.length === 0 && (
                <tr><td colSpan={7} className="px-5 py-8 text-center text-gray-400 text-sm">No statements yet — generated at month-end by your account manager</td></tr>
              )}
              {history.map((rec, i) => (
                <tr key={i} className="border-t border-gray-50 hover:bg-gray-50 transition-colors">
                  <td className="px-5 py-3 font-medium text-gray-700">{rec.month_label}</td>
                  <td className="px-5 py-3 text-gray-600">{fmtR(rec.total_turnover)}</td>
                  <td className="px-5 py-3 text-gray-500 text-xs">{rec.tier_label} <span className="text-gray-300">·</span> {rec.tier_range}</td>
                  <td className="px-5 py-3 font-semibold text-bassani-700">{rec.commission_rate}%</td>
                  <td className="px-5 py-3 font-bold text-bassani-700">{fmtR(rec.commission_amount)}</td>
                  <td className="px-5 py-3">
                    <span className={`text-[10px] px-2 py-0.5 rounded-full font-semibold ${
                      rec.status === "paid" ? "bg-green-50 text-green-700" :
                      rec.status === "disputed" ? "bg-red-50 text-red-700" :
                      "bg-amber-50 text-amber-700"
                    }`}>
                      {rec.status === "paid" ? "Paid" : rec.status === "disputed" ? "Disputed" : "Pending"}
                    </span>
                  </td>
                  <td className="px-5 py-3">
                    {rec.status !== "disputed" && (
                      <button onClick={() => { setDisputeModal(rec); setDisputeReason(""); }}
                        className="text-[10px] text-red-400 hover:text-red-600 font-medium transition-colors">
                        Dispute
                      </button>
                    )}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>

      {disputeModal && (
        <Modal title={`Dispute Statement — ${disputeModal.month_label}`} onClose={() => setDisputeModal(null)}>
          <p className="text-sm text-gray-600 mb-4">
            Commission of <b className="text-bassani-700">{fmtR(disputeModal.commission_amount)}</b> for <b>{disputeModal.month_label}</b>
          </p>
          <div className="space-y-3 mb-6">
            <FormGroup label="Reason for Dispute">
              <Input value={disputeReason} onChange={e => setDisputeReason(e.target.value)}
                placeholder="Describe the issue with this statement…" autoFocus />
            </FormGroup>
          </div>
          <div className="flex justify-end gap-2">
            <BtnSecondary onClick={() => setDisputeModal(null)}>Cancel</BtnSecondary>
            <BtnPrimary onClick={dispute} loading={disputing} disabled={!disputeReason.trim()}>Submit Dispute</BtnPrimary>
          </div>
        </Modal>
      )}
    </div>
  );
}

// ─────────────────────────────────────────────────────────────────────────────
// Admin commission view — statements + tier settings
// ─────────────────────────────────────────────────────────────────────────────
function AdminCommissionView() {
  const { can }    = useAuth();
  const today      = new Date();
  const [activeTab,   setActiveTab  ] = useState("statements");
  const [genYear,     setGenYear    ] = useState(today.getFullYear());
  const [genMonth,    setGenMonth   ] = useState(today.getMonth() + 1);
  const [generating,  setGenerating ] = useState(false);
  const [statements,  setStatements ] = useState([]);
  const [stmtLoading, setStmtLoading] = useState(true);
  const [stmtStatus,  setStmtStatus ] = useState("all");
  const [payModal,    setPayModal   ] = useState(null);
  const [payRef,      setPayRef     ] = useState("");
  const [payDate,     setPayDate    ] = useState("");
  const [paying,      setPaying     ] = useState(false);
  const [expanded,    setExpanded   ] = useState(null);
  const [stmtOrders,  setStmtOrders ] = useState({});
  const [resetConfirm,  setResetConfirm ] = useState(false);
  const [resolveModal,  setResolveModal ] = useState(null);
  const [resolveNotes,  setResolveNotes ] = useState("");
  const [resolving,     setResolving    ] = useState(false);
  const [payOverride,       setPayOverride      ] = useState(false);
  const [payOverrideReason, setPayOverrideReason] = useState("");
  // Tier settings — draft state: [{label, max, rate}], min derived from position
  const DEFAULT_DRAFT = [
    { label: "Tier 1", max: 300000,  rate: 2.5  },
    { label: "Tier 2", max: 500000,  rate: 5.0  },
    { label: "Tier 3", max: 750000,  rate: 7.5  },
    { label: "Tier 4", max: 1000000, rate: 10.0 },
    { label: "Tier 5", max: null,    rate: 12.5 },
  ];
  const [tierDraft,          setTierDraft         ] = useState(DEFAULT_DRAFT);
  const [tierSaving,         setTierSaving        ] = useState(false);
  const [tierHistory,        setTierHistory       ] = useState([]);
  const [tierHistoryLoading, setTierHistoryLoading] = useState(false);

  const MONTHS = ["Jan","Feb","Mar","Apr","May","Jun","Jul","Aug","Sep","Oct","Nov","Dec"];

  const loadStatements = useCallback(async () => {
    setStmtLoading(true);
    try {
      const r = await api.get("/api/commission/statements", {
        params: { status: stmtStatus === "all" ? undefined : stmtStatus, limit: 100 },
      });
      setStatements(r.data.statements || []);
    } catch { toast.error("Failed to load statements"); }
    finally { setStmtLoading(false); }
  }, [stmtStatus]);

  useEffect(() => { loadStatements(); }, [loadStatements]);

  useEffect(() => {
    api.get("/api/commission/tiers").then(r => {
      const t = r.data.tiers || [];
      if (t.length) setTierDraft(t.map(t => ({ label: t.label, max: t.max ?? null, rate: t.rate })));
    }).catch(() => {});
  }, []);

  useEffect(() => {
    if (activeTab !== "tiers") return;
    setTierHistoryLoading(true);
    api.get("/api/commission/tiers/history", { params: { limit: 10 } })
      .then(r => setTierHistory(r.data.history || []))
      .catch(() => {})
      .finally(() => setTierHistoryLoading(false));
  }, [activeTab]);

  const generate = async () => {
    setGenerating(true);
    try {
      const r = await api.post("/api/commission/statements/generate", { year: genYear, month: genMonth });
      toast.success(`${r.data.generated} statement${r.data.generated !== 1 ? "s" : ""} generated for ${r.data.month_label}`);
      loadStatements();
    } catch (e) { toast.error(e.response?.data?.detail || "Generation failed"); }
    finally { setGenerating(false); }
  };

  const openPay = (stmt) => {
    setPayModal(stmt);
    setPayRef("");
    setPayDate(today.toISOString().split("T")[0]);
    setPayOverride(false);
    setPayOverrideReason("");
  };

  const markPaid = async () => {
    if (!payModal) return;
    setPaying(true);
    try {
      const r = await api.put(`/api/commission/statements/${payModal.id}/mark-paid`, {
        payment_reference: payRef,
        payment_date: payDate,
        override_bill_creation: payOverride,
        override_reason: payOverrideReason,
      });
      toast.success(`${payModal.reseller_name} — ${payModal.month_label} marked as paid`);
      if (r.data.bill_warning) toast(r.data.bill_warning, { icon: "⚠️", duration: 8000 });
      setPayModal(null);
      loadStatements();
    } catch (e) { toast.error(e.response?.data?.detail || "Failed to mark as paid"); }
    finally { setPaying(false); }
  };

  const resolveDispute = async () => {
    if (!resolveModal) return;
    setResolving(true);
    try {
      await api.put(`/api/commission/statements/${resolveModal.id}/resolve`, { notes: resolveNotes });
      toast.success(`Dispute resolved — ${resolveModal.reseller_name} ${resolveModal.month_label}`);
      setResolveModal(null);
      loadStatements();
    } catch (e) { toast.error(e.response?.data?.detail || "Failed to resolve dispute"); }
    finally { setResolving(false); }
  };

  const toggleExpand = async (stmtId) => {
    if (expanded === stmtId) { setExpanded(null); return; }
    setExpanded(stmtId);
    if (!stmtOrders[stmtId]) {
      try {
        const r = await api.get(`/api/commission/statements/${stmtId}`);
        setStmtOrders(prev => ({ ...prev, [stmtId]: r.data.orders || [] }));
      } catch { toast.error("Failed to load orders"); }
    }
  };

  const tierMin = (i) => i === 0 ? 0 : (tierDraft[i - 1].max ?? 0);

  const fmtThreshold = (v) => {
    if (v === null || v === undefined) return "Unlimited";
    if (v >= 1_000_000 && v % 1_000_000 === 0) return `R${v / 1_000_000}m`;
    if (v >= 1_000_000) return `R${(v / 1_000_000).toFixed(1)}m`;
    if (v >= 1_000 && v % 1_000 === 0) return `R${v / 1_000}k`;
    return `R${Number(v).toLocaleString()}`;
  };

  const updateTier = (i, field, value) =>
    setTierDraft(prev => prev.map((t, j) => j === i ? { ...t, [field]: value } : t));

  const addTier = () =>
    setTierDraft(prev => [...prev, { label: `Tier ${prev.length + 1}`, max: null, rate: 0 }]);

  const removeTier = (i) => {
    if (tierDraft.length <= 1) return;
    setTierDraft(prev => {
      const next = prev.filter((_, j) => j !== i);
      return next.map((t, j) => j === next.length - 1 ? { ...t, max: null } : t);
    });
  };

  const saveTiers = async () => {
    for (let i = 0; i < tierDraft.length; i++) {
      if (!tierDraft[i].label.trim()) { toast.error(`Tier ${i + 1} needs a label`); return; }
      if (i < tierDraft.length - 1 && (tierDraft[i].max === null || tierDraft[i].max === "" || isNaN(tierDraft[i].max))) {
        toast.error(`Tier ${i + 1} needs a maximum threshold`); return;
      }
      if (tierDraft[i].rate < 0 || tierDraft[i].rate > 100) {
        toast.error(`Rate for tier ${i + 1} must be between 0 and 100`); return;
      }
    }
    setTierSaving(true);
    try {
      const payload = tierDraft.map((t, i) => ({ label: t.label.trim(), min: tierMin(i), max: t.max, rate: t.rate }));
      const r = await api.put("/api/commission/tiers", { tiers: payload });
      setTierDraft(r.data.tiers.map(t => ({ label: t.label, max: t.max ?? null, rate: t.rate })));
      toast.success("Commission tiers saved");
    } catch (e) { toast.error(e.response?.data?.detail || "Save failed"); }
    finally { setTierSaving(false); }
  };

  const resetTiers = () => setResetConfirm(true);

  const doResetTiers = async () => {
    setResetConfirm(false);
    setTierSaving(true);
    try {
      const r = await api.delete("/api/commission/tiers/reset");
      setTierDraft(r.data.tiers.map(t => ({ label: t.label, max: t.max ?? null, rate: t.rate })));
      toast.success("Commission tiers reset to defaults");
    } catch { toast.error("Reset failed"); }
    finally { setTierSaving(false); }
  };

  const pendingTotal = statements.filter(s => s.status === "pending").reduce((sum, s) => sum + s.commission_amount, 0);

  return (
    <div className="space-y-4">
      <ChipRow>
        <FilterPill label="Statements"    active={activeTab === "statements"}    onClick={() => setActiveTab("statements")} />
        <FilterPill label="Tier Settings" active={activeTab === "tiers"}         onClick={() => setActiveTab("tiers")} />
      </ChipRow>

      {/* ── Statements tab ── */}
      {activeTab === "statements" && (<>
        {/* Generate + filter bar */}
        <div className="bg-white border border-gray-100 rounded-2xl px-5 py-4 flex flex-wrap items-center gap-4">
          <div>
            <p className="text-xs font-semibold text-gray-500 mb-2 uppercase tracking-wider">Generate Statements</p>
            <div className="flex items-center gap-2">
              <select value={genMonth} onChange={e => setGenMonth(Number(e.target.value))}
                className="border border-gray-200 rounded-lg px-3 py-1.5 text-sm text-gray-700 focus:outline-none focus:border-bassani-600 bg-white">
                {MONTHS.map((m, i) => <option key={i+1} value={i+1}>{m}</option>)}
              </select>
              <input type="number" value={genYear} onChange={e => setGenYear(Number(e.target.value))} min={2020} max={2040}
                className="border border-gray-200 rounded-lg px-3 py-1.5 text-sm text-gray-700 focus:outline-none focus:border-bassani-600 w-24" />
              {can("commission.generate_statements") && (
                <BtnPrimary size="sm" onClick={generate} loading={generating}>
                  {generating ? "Generating…" : "Generate"}
                </BtnPrimary>
              )}
            </div>
          </div>
          <div className="ml-auto text-right">
            <p className="text-xs text-gray-400">Total Pending</p>
            <p className="text-2xl font-bold text-bassani-700">{fmtR(pendingTotal)}</p>
          </div>
        </div>

        <ChipRow>
          {[["all","All"],["pending","Pending"],["paid","Paid"],["disputed","Disputed"]].map(([k,l])=>(
            <FilterPill key={k} label={l} active={stmtStatus===k} onClick={() => setStmtStatus(k)} />
          ))}
        </ChipRow>

        {stmtLoading ? <LoadingState /> : statements.length === 0 ? (
          <div className="bg-white border border-gray-100 rounded-2xl px-5 py-14 text-center">
            <p className="text-sm font-medium text-gray-400">No statements found</p>
            <p className="text-xs text-gray-300 mt-1">Generate statements using the controls above</p>
          </div>
        ) : statements.map(s => (
          <div key={s.id} className="bg-white border border-gray-100 rounded-2xl overflow-hidden">
            <div className="px-5 py-4 flex flex-wrap items-start gap-4">
              <div className="flex-1 min-w-0 space-y-1">
                <div className="flex items-center gap-2 flex-wrap">
                  <p className="font-semibold text-gray-900">{s.reseller_name}</p>
                  <span className="text-[10px] bg-purple-50 text-purple-700 px-1.5 py-0.5 rounded-full font-semibold">{s.month_label}</span>
                  <span className={`text-[10px] px-1.5 py-0.5 rounded-full font-semibold ${
                    s.status === "paid" ? "bg-green-50 text-green-700" :
                    s.status === "disputed" ? "bg-red-50 text-red-700" :
                    "bg-amber-50 text-amber-700"
                  }`}>
                    {s.status === "paid" ? "Paid" : s.status === "disputed" ? "Disputed" : "Pending"}
                  </span>
                </div>
                <p className="text-xs text-gray-500">
                  Turnover: <b className="text-gray-700">{fmtR(s.total_turnover)}</b> ·
                  {" "}{s.tier_label} ({s.tier_range}) · {s.order_count} order{s.order_count !== 1 ? "s" : ""}
                </p>
                {s.status === "paid" && s.payment_reference && (
                  <p className="text-xs text-gray-400">Ref: <span className="font-mono">{s.payment_reference}</span> · {fmtDate(s.paid_at)}</p>
                )}
                {s.status === "disputed" && s.dispute_reason && (
                  <p className="text-xs text-red-500 mt-0.5">Dispute: {s.dispute_reason}</p>
                )}
              </div>
              <div className="flex items-center gap-3 shrink-0">
                <div className="text-right">
                  <p className="text-xl font-bold text-bassani-700">{fmtR(s.commission_amount)}</p>
                  <p className="text-[10px] text-gray-400">{s.commission_rate}% commission</p>
                </div>
                <button onClick={() => toggleExpand(s.id)}
                  className="text-xs px-3 py-1.5 rounded-lg border border-gray-200 text-gray-600 hover:bg-gray-50 font-medium transition-colors">
                  {expanded === s.id ? "Hide" : "Orders"}
                </button>
                {s.status === "disputed" && can("commission.mark_paid") && (
                  <BtnSecondary size="sm" onClick={() => { setResolveModal(s); setResolveNotes(""); }}>Resolve</BtnSecondary>
                )}
                {s.status === "pending" && can("commission.mark_paid") && (
                  <BtnPrimary size="sm" onClick={() => openPay(s)}>Mark Paid</BtnPrimary>
                )}
              </div>
            </div>

            {expanded === s.id && (
              <div className="border-t border-gray-50">
                {!stmtOrders[s.id] ? (
                  <p className="px-5 py-4 text-xs text-gray-400">Loading…</p>
                ) : (
                  <table className="w-full text-sm">
                    <thead>
                      <tr className="bg-gray-50">
                        {["Order #","Customer","Date","Order Value"].map(h=>(
                          <th key={h} className="text-left text-[10px] font-semibold text-gray-400 uppercase tracking-wider px-4 py-2.5">{h}</th>
                        ))}
                      </tr>
                    </thead>
                    <tbody>
                      {stmtOrders[s.id].map(o => (
                        <tr key={o.odoo_order_id} className="border-t border-gray-50 hover:bg-gray-50">
                          <td className="px-4 py-2.5 font-mono text-xs text-bassani-700">#{o.odoo_order_id}</td>
                          <td className="px-4 py-2.5 text-gray-700 text-xs">{o.customer_name || "—"}</td>
                          <td className="px-4 py-2.5 text-gray-400 text-xs">{fmtDate(o.created_at)}</td>
                          <td className="px-4 py-2.5 text-gray-700">{fmtR(o.original_subtotal || 0)}</td>
                        </tr>
                      ))}
                      <tr className="border-t-2 border-bassani-100 bg-bassani-50/40">
                        <td colSpan={3} className="px-4 py-2.5 text-xs font-semibold text-gray-600 text-right">Total Turnover</td>
                        <td className="px-4 py-2.5 font-bold text-gray-800">{fmtR(s.total_turnover)}</td>
                      </tr>
                    </tbody>
                  </table>
                )}
              </div>
            )}
          </div>
        ))}
      </>)}

      {/* ── Tier settings tab ── */}
      {activeTab === "tiers" && (
        <div className="bg-white border border-gray-100 rounded-2xl overflow-hidden">
          <div className="px-5 py-4 border-b border-gray-50">
            <h3 className="text-sm font-semibold text-gray-800">Commission Tier Configuration</h3>
            <p className="text-xs text-gray-400 mt-0.5">Define turnover brackets and commission rates. The last tier is always open-ended.</p>
          </div>
          <div className="grid grid-cols-[1fr_110px_110px_88px_36px] gap-x-3 px-5 py-2 bg-gray-50 border-b border-gray-100">
            {["Label","From","Up To","Rate",""].map(h => (
              <span key={h} className="text-[10px] font-semibold text-gray-400 uppercase tracking-wider">{h}</span>
            ))}
          </div>
          <div className="divide-y divide-gray-50">
            {tierDraft.map((t, i) => {
              const isLast = i === tierDraft.length - 1;
              return (
                <div key={i} className="grid grid-cols-[1fr_110px_110px_88px_36px] gap-x-3 px-5 py-3 items-center">
                  <input
                    type="text" value={t.label}
                    onChange={e => updateTier(i, "label", e.target.value)}
                    readOnly={!can("commission.configure_tiers")}
                    className="border border-gray-200 rounded-lg px-3 py-1.5 text-sm text-gray-700 focus:outline-none focus:border-bassani-600"
                    placeholder="Label"
                  />
                  <div className="border border-gray-100 rounded-lg px-3 py-1.5 text-sm text-gray-400 bg-gray-50 truncate">
                    {fmtThreshold(tierMin(i))}
                  </div>
                  {isLast ? (
                    <div className="border border-gray-100 rounded-lg px-3 py-1.5 text-sm text-gray-400 bg-gray-50 italic">Unlimited</div>
                  ) : (
                    <input
                      type="number" min={0} value={t.max ?? ""}
                      onChange={e => updateTier(i, "max", e.target.value === "" ? null : parseFloat(e.target.value))}
                      readOnly={!can("commission.configure_tiers")}
                      className="border border-gray-200 rounded-lg px-3 py-1.5 text-sm text-gray-700 focus:outline-none focus:border-bassani-600"
                      placeholder="e.g. 300000"
                    />
                  )}
                  <div className="flex items-center gap-1">
                    <input
                      type="number" min={0} max={100} step={0.5} value={t.rate}
                      onChange={e => updateTier(i, "rate", parseFloat(e.target.value) || 0)}
                      readOnly={!can("commission.configure_tiers")}
                      className="border border-gray-200 rounded-lg px-2 py-1.5 text-sm text-gray-700 focus:outline-none focus:border-bassani-600 w-14 text-right"
                    />
                    <span className="text-xs text-gray-400">%</span>
                  </div>
                  {can("commission.configure_tiers") ? (
                    <button onClick={() => removeTier(i)} disabled={tierDraft.length <= 1}
                      className="text-gray-300 hover:text-red-400 disabled:opacity-30 disabled:cursor-not-allowed transition-colors flex items-center justify-center">
                      <Trash2 size={13} />
                    </button>
                  ) : <span />}
                </div>
              );
            })}
          </div>
          {can("commission.configure_tiers") && (
            <div className="px-5 py-3 border-t border-gray-50">
              <button onClick={addTier}
                className="flex items-center gap-1.5 text-xs text-bassani-600 hover:text-bassani-800 font-medium transition-colors">
                <Plus size={13} /> Add Tier
              </button>
            </div>
          )}
          {can("commission.configure_tiers") && (
            <div className="px-5 py-4 border-t border-gray-50 flex justify-between">
              <BtnSecondary onClick={resetTiers} disabled={tierSaving}>Reset to Defaults</BtnSecondary>
              <BtnPrimary onClick={saveTiers} loading={tierSaving}>Save Tiers</BtnPrimary>
            </div>
          )}
          <div className="px-5 py-4 border-t border-gray-50">
            <p className="text-[10px] font-semibold text-gray-400 uppercase tracking-wider mb-3">Change History</p>
            {tierHistoryLoading ? (
              <p className="text-xs text-gray-400">Loading…</p>
            ) : tierHistory.length === 0 ? (
              <p className="text-xs text-gray-400">No tier changes recorded yet</p>
            ) : (
              <div className="space-y-2">
                {tierHistory.map((h, i) => (
                  <div key={i} className="flex items-start gap-3 text-xs">
                    <span className="text-gray-300 shrink-0 tabular-nums">{fmtDate(h.created_at)}</span>
                    <span className="text-gray-600">
                      <b>{h.actor_username}</b>
                      {h.action === "commission.reset_tiers" ? " reset tiers to system defaults" : " updated commission tiers"}
                    </span>
                  </div>
                ))}
              </div>
            )}
          </div>
        </div>
      )}

      {/* Mark as Paid modal */}
      {resolveModal && (
        <Modal title={`Resolve Dispute — ${resolveModal.reseller_name}`} onClose={() => setResolveModal(null)}>
          <p className="text-sm text-gray-600 mb-2">
            <b>{resolveModal.month_label}</b> · {fmtR(resolveModal.commission_amount)}
          </p>
          {resolveModal.dispute_reason && (
            <div className="bg-red-50 border border-red-100 rounded-xl px-4 py-3 mb-4">
              <p className="text-[10px] font-semibold text-red-500 uppercase tracking-wider mb-1">Dispute reason</p>
              <p className="text-sm text-red-700">{resolveModal.dispute_reason}</p>
            </div>
          )}
          <div className="space-y-3 mb-6">
            <FormGroup label="Resolution Notes">
              <Input value={resolveNotes} onChange={e => setResolveNotes(e.target.value)}
                placeholder="Explain how the dispute was resolved…" autoFocus />
            </FormGroup>
          </div>
          <div className="flex justify-end gap-2">
            <BtnSecondary onClick={() => setResolveModal(null)}>Cancel</BtnSecondary>
            <BtnPrimary onClick={resolveDispute} loading={resolving} disabled={!resolveNotes.trim()}>Resolve Dispute</BtnPrimary>
          </div>
        </Modal>
      )}

      {payModal && (
        <Modal title={`Mark as Paid — ${payModal.reseller_name}`} onClose={() => setPayModal(null)}>
          <p className="text-sm text-gray-600 mb-4">
            Marking <b>{payModal.month_label}</b> statement as paid:
            {" "}turnover <b>{fmtR(payModal.total_turnover)}</b> ·
            {" "}{payModal.tier_label} @ {payModal.commission_rate}% =
            {" "}<b className="text-bassani-700">{fmtR(payModal.commission_amount)}</b>
          </p>
          {payModal.bank_account_number && (
            <div className="bg-gray-50 border border-gray-100 rounded-xl px-4 py-3 mb-4 space-y-0.5">
              <p className="text-[10px] font-semibold text-gray-400 uppercase tracking-wider mb-1">Banking Details</p>
              <p className="text-sm font-medium text-gray-800">{payModal.bank_account_holder}</p>
              <p className="text-xs text-gray-500">{payModal.bank_name}</p>
              <p className="text-sm font-mono text-gray-800">
                {payModal.bank_account_number}
                {payModal.bank_branch_code && <span className="text-gray-400 font-sans"> · {payModal.bank_branch_code}</span>}
              </p>
            </div>
          )}
          <div className="space-y-3 mb-4">
            <FormGroup label="Payment Reference">
              <Input value={payRef} onChange={e => setPayRef(e.target.value)} placeholder="e.g. EFT ref 20260612-RES01" autoFocus />
            </FormGroup>
            <FormGroup label="Payment Date">
              <Input type="date" value={payDate} onChange={e => setPayDate(e.target.value)} />
            </FormGroup>
          </div>
          <div className="border-t border-gray-100 pt-4 mb-6">
            <label className="flex items-start gap-2 cursor-pointer">
              <input type="checkbox" checked={payOverride} onChange={e => setPayOverride(e.target.checked)}
                className="mt-0.5 accent-bassani-600" />
              <span className="text-xs text-gray-500">
                Override Odoo bill creation <span className="text-gray-300 ml-1">(use only if Odoo integration is unavailable)</span>
              </span>
            </label>
            {payOverride && (
              <div className="mt-2">
                <FormGroup label="Override Reason">
                  <Input value={payOverrideReason} onChange={e => setPayOverrideReason(e.target.value)}
                    placeholder="Reason for bypassing Odoo bill creation…" />
                </FormGroup>
              </div>
            )}
          </div>
          <div className="flex justify-end gap-2">
            <BtnSecondary onClick={() => setPayModal(null)}>Cancel</BtnSecondary>
            <BtnPrimary onClick={markPaid} loading={paying}>Confirm Payment</BtnPrimary>
          </div>
        </Modal>
      )}
      {resetConfirm && (
        <Modal title="Reset Commission Tiers" onClose={() => setResetConfirm(false)}>
          <p className="text-sm text-gray-600">Reset all commission tiers to system defaults? This will overwrite any custom tier configuration and affects all commission calculations going forward.</p>
          <div className="flex justify-end gap-2 mt-4">
            <BtnSecondary onClick={() => setResetConfirm(false)}>Cancel</BtnSecondary>
            <BtnDanger onClick={doResetTiers}>Reset to Defaults</BtnDanger>
          </div>
        </Modal>
      )}
    </div>
  );
}

export function Commission() {
  const { user } = useAuth();
  const isReseller = user?.role === "reseller";

  if (isReseller) return (
    <div className="flex flex-col flex-1 overflow-hidden">
      <TopBar title="My Commission" subtitle="Monthly earnings based on turnover tier" />
      <main className="flex-1 overflow-y-auto p-6 space-y-5">
        <ResellerCommissionView />
      </main>
    </div>
  );

  return (
    <div className="flex flex-col flex-1 overflow-hidden">
      <TopBar title="Commission" subtitle="Monthly statements, tier configuration and payouts" />
      <main className="flex-1 overflow-y-auto p-6">
        <AdminCommissionView />
      </main>
    </div>
  );
}

// ─────────────────────────────────────────────────────────────────────────────
// Reports view
// ─────────────────────────────────────────────────────────────────────────────
export function Reports() {
  const [activeReport, setActiveReport] = useState("monthly-turnover");
  const [data,   setData  ] = useState(null);
  const [loading,setLoading] = useState(false);
  const navigate = useNavigate();

  const ANALYTICS = [
    { key:"monthly-turnover",      label:"Monthly Turnover"      },
    { key:"best-sellers",          label:"Best Sellers"          },
    { key:"best-customers",        label:"Best Customers"        },
    { key:"best-resellers",        label:"Best Resellers"        },
    { key:"dead-stock",            label:"Dead Stock"            },
    { key:"category-performance",  label:"Category Performance"  },
  ];

  const INVENTORY = [
    { key:"stock-positions", label:"Stock Positions", href:"/stock-report" },
  ];

  const { user } = useAuth();

  const load = async (key) => {
    setLoading(true);
    try { const r = await api.get(`/api/reports/${key}`); setData(r.data); }
    catch { toast.error("Failed to load report"); }
    finally { setLoading(false); }
  };

  useEffect(() => { load(activeReport); }, [activeReport, user?.active_warehouse_id]);

  return (
    <div className="flex flex-col flex-1 overflow-hidden">
      <TopBar title="Reports & Analytics" subtitle="Live data from Odoo" onRefresh={()=>load(activeReport)} showWarehouseSwitcher />
      <main className="flex-1 overflow-y-auto p-4 sm:p-6 flex flex-col sm:flex-row gap-4 sm:gap-5">
        {/* Report nav */}
        <div className="sm:w-44 sm:flex-shrink-0">
          <p className="text-[10px] font-bold text-gray-400 uppercase tracking-wider mb-2 sm:mb-3">Analytics</p>
          <div className="flex sm:flex-col gap-1 overflow-x-auto no-scrollbar pb-1 sm:pb-0">
            {ANALYTICS.map(r=>(
              <button key={r.key} onClick={()=>{ setActiveReport(r.key); setData(null); }}
                className={`w-full text-left text-xs px-3 py-2.5 rounded-lg transition-all border font-medium ${activeReport===r.key?"border-bassani-600 text-bassani-700 bg-bassani-50":"border-transparent text-gray-500 hover:bg-gray-100"}`}>
                {r.label}
              </button>
            ))}
          </div>
          <p className="text-[10px] font-bold text-gray-400 uppercase tracking-wider mt-4 mb-2 sm:mb-3">Inventory</p>
          <div className="flex sm:flex-col gap-1 overflow-x-auto no-scrollbar pb-1 sm:pb-0">
            {INVENTORY.map(r=>(
              <button key={r.key} onClick={()=>navigate(r.href)}
                className="w-full text-left text-xs px-3 py-2.5 rounded-lg transition-all border font-medium border-transparent text-gray-500 hover:bg-gray-100 flex items-center justify-between group">
                {r.label}
                <span className="text-gray-300 group-hover:text-bassani-500 transition-colors">→</span>
              </button>
            ))}
          </div>
        </div>

        {/* Report content */}
        <div className="flex-1 space-y-4">
          {loading && <LoadingState />}
          {!loading && data && <ReportContent type={activeReport} data={data} />}
        </div>
      </main>
    </div>
  );
}

function ReportContent({ type, data }) {
  if (type === "monthly-turnover") return (
    <div className="space-y-4">
      <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
        <StatCardInline label="Total Revenue" value={fmtR(data.revenue?.total)} />
        <StatCardInline label="Direct Sales"  value={fmtR(data.revenue?.direct)} />
        <StatCardInline label="Reseller Sales" value={fmtR(data.revenue?.reseller)} />
        <StatCardInline label="Commission" value={fmtR(data.commission?.total)} accent="text-red-600" />
      </div>
      <div className="bg-white border border-gray-100 rounded-xl p-5">
        <h3 className="text-sm font-semibold text-gray-800 mb-4">6-month revenue trend</h3>
        {data.trend?.map(t=>{
          const max = Math.max(...(data.trend||[]).map(x=>x.revenue));
          const pct = max > 0 ? Math.round(t.revenue/max*100) : 0;
          return (
            <div key={t.month} className="mb-3">
              <div className="flex justify-between text-xs mb-1"><span className="font-medium text-gray-700">{t.month}</span><span className="text-gray-500">{fmtR(t.revenue)}</span></div>
              <div className="h-2.5 bg-gray-100 rounded-full overflow-hidden"><div className="h-full bg-bassani-600 rounded-full" style={{width:`${pct}%`}} /></div>
            </div>
          );
        })}
      </div>
    </div>
  );

  if (type === "best-sellers") return (
    <div className="bg-white border border-gray-100 rounded-xl overflow-hidden">
      <div className="px-5 py-4 border-b border-gray-50"><h3 className="text-sm font-semibold">Top products by revenue</h3></div>
      <div className="overflow-x-auto"><table className="w-full text-sm min-w-[480px]">
        <thead><tr className="bg-gray-50">{["#","Product","Units","Revenue","Share"].map(h=><th key={h} className="text-left text-[10px] font-semibold text-gray-400 uppercase tracking-wider px-4 py-3">{h}</th>)}</tr></thead>
        <tbody>
          {data.products?.map((p,i)=>{
            const maxRev = data.products[0]?.revenue||1;
            return <tr key={p.product_id} className="border-t border-gray-50 hover:bg-gray-50">
              <Td><span className={`w-6 h-6 rounded-full flex items-center justify-center text-xs font-bold ${i===0?"bg-amber-50 text-amber-700":i===1?"bg-gray-100 text-gray-600":i===2?"bg-bassani-50 text-bassani-700":"bg-gray-50 text-gray-400"}`}>{p.rank}</span></Td>
              <Td><p className="font-medium">{p.product_name}</p></Td>
              <Td>{Math.round(p.units_sold)}</Td>
              <Td className="font-semibold">{fmtR(p.revenue)}</Td>
              <Td><div className="flex items-center gap-2"><div className="h-1.5 w-20 bg-gray-100 rounded-full overflow-hidden"><div className="h-full bg-bassani-600 rounded-full" style={{width:`${Math.round(p.revenue/maxRev*100)}%`}}/></div><span className="text-xs text-gray-400">{Math.round(p.revenue/maxRev*100)}%</span></div></Td>
            </tr>;
          })}
        </tbody>
      </table></div>
    </div>
  );

  if (type === "best-customers") return (
    <div className="bg-white border border-gray-100 rounded-xl overflow-hidden">
      <div className="px-5 py-4 border-b border-gray-50"><h3 className="text-sm font-semibold">Top customers by spend</h3></div>
      <div className="overflow-x-auto"><table className="w-full text-sm min-w-[400px]">
        <thead><tr className="bg-gray-50">{["#","Customer","Orders","Total Spend","Avg Order"].map(h=><th key={h} className="text-left text-[10px] font-semibold text-gray-400 uppercase tracking-wider px-4 py-3">{h}</th>)}</tr></thead>
        <tbody>
          {data.customers?.map((c,i)=>(
            <tr key={c.customer_id} className="border-t border-gray-50 hover:bg-gray-50">
              <Td><span className={`w-6 h-6 rounded-full flex items-center justify-center text-xs font-bold ${i===0?"bg-amber-50 text-amber-700":i===1?"bg-gray-100 text-gray-600":"bg-gray-50 text-gray-400"}`}>{c.rank}</span></Td>
              <Td className="font-medium">{c.customer_name}</Td>
              <Td>{c.order_count}</Td>
              <Td className="font-semibold">{fmtR(c.total_spend)}</Td>
              <Td className="text-gray-500">{fmtR(c.avg_order)}</Td>
            </tr>
          ))}
        </tbody>
      </table></div>
    </div>
  );

  if (type === "best-resellers") {
    const rs = data.resellers || [];
    const rankStyle = (i) =>
      i === 0 ? "bg-amber-50 text-amber-700" :
      i === 1 ? "bg-gray-100 text-gray-600"  :
      i === 2 ? "bg-bassani-50 text-bassani-700" : "bg-gray-50 text-gray-400";
    return (
      <div className="space-y-4">
        {/* FY banner + summary KPIs */}
        <div className="bg-white border border-gray-100 rounded-xl p-4 flex flex-wrap items-center justify-between gap-3">
          <div>
            <span className="text-xs font-bold text-bassani-700 bg-bassani-50 px-2.5 py-1 rounded-full">{data.fy_label}</span>
            <p className="text-xs text-gray-400 mt-1">{fmtDate(data.fy_start)} — {fmtDate(data.fy_end)}</p>
          </div>
          <div className="flex flex-wrap gap-5">
            <div className="text-right"><p className="text-xs text-gray-400">FY Orders</p><p className="font-bold text-gray-900">{data.total_fy_orders}</p></div>
            <div className="text-right"><p className="text-xs text-gray-400">FY Revenue</p><p className="font-bold text-gray-900">{fmtR(data.total_fy_revenue)}</p></div>
            <div className="text-right"><p className="text-xs text-gray-400">FY Commission</p><p className="font-bold text-red-600">{fmtR(data.total_fy_commission)}</p></div>
            <div className="text-right"><p className="text-xs text-gray-400">Customers Onboarded</p><p className="font-bold text-gray-900">{data.total_customers_onboarded}</p></div>
          </div>
        </div>

        {/* Leaderboard table */}
        <div className="bg-white border border-gray-100 rounded-xl overflow-hidden">
          <div className="px-5 py-4 border-b border-gray-50">
            <h3 className="text-sm font-semibold">Reseller leaderboard — {data.fy_label}</h3>
          </div>
          <div className="overflow-x-auto">
            <table className="w-full text-sm min-w-[700px]">
              <thead>
                <tr className="bg-gray-50">
                  {["#","Reseller","FY Orders","FY Revenue","Avg Order","Commission","Customers","All-time Orders"].map(h=>(
                    <th key={h} className="text-left text-[10px] font-semibold text-gray-400 uppercase tracking-wider px-4 py-3">{h}</th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {rs.map((r, i) => (
                  <tr key={r.reseller_id || i} className="border-t border-gray-50 hover:bg-gray-50">
                    <Td>
                      <span className={`w-6 h-6 rounded-full flex items-center justify-center text-xs font-bold ${rankStyle(i)}`}>{r.rank}</span>
                    </Td>
                    <Td>
                      <p className="font-semibold text-gray-800">{r.reseller_name}</p>
                    </Td>
                    <Td>
                      <span className={`font-bold ${r.fy_orders > 0 ? "text-gray-900" : "text-gray-300"}`}>{r.fy_orders}</span>
                    </Td>
                    <Td className="font-semibold">{r.fy_revenue > 0 ? fmtR(r.fy_revenue) : <span className="text-gray-300">—</span>}</Td>
                    <Td className="text-gray-500">{r.avg_order_value > 0 ? fmtR(r.avg_order_value) : <span className="text-gray-300">—</span>}</Td>
                    <Td className="text-red-600 font-medium">{r.fy_commission > 0 ? fmtR(r.fy_commission) : <span className="text-gray-300">—</span>}</Td>
                    <Td>
                      <span className={`font-semibold ${r.customers_onboarded > 0 ? "text-bassani-700" : "text-gray-300"}`}>{r.customers_onboarded || "—"}</span>
                    </Td>
                    <Td className="text-gray-400">{r.all_time_orders}</Td>
                  </tr>
                ))}
                {rs.length === 0 && (
                  <tr><td colSpan={8} className="px-5 py-8 text-center text-sm text-gray-400">No reseller activity found for this financial year.</td></tr>
                )}
              </tbody>
            </table>
          </div>
        </div>
      </div>
    );
  }

  if (type === "dead-stock") return (
    <div className="space-y-4">
      <div className="bg-red-50 border border-red-100 rounded-xl p-4 text-sm text-red-700 font-medium">
        {data.total} products haven't moved in {data.days_threshold}+ days
      </div>
      <div className="bg-white border border-gray-100 rounded-xl overflow-hidden">
        <div className="overflow-x-auto"><table className="w-full text-sm min-w-[480px]">
          <thead><tr className="bg-gray-50">{["Product","Category","Stock","Last Sold","Status"].map(h=><th key={h} className="text-left text-[10px] font-semibold text-gray-400 uppercase tracking-wider px-4 py-3">{h}</th>)}</tr></thead>
          <tbody>
            {data.dead_stock?.map(p=>(
              <tr key={p.product_id} className="border-t border-gray-50 hover:bg-gray-50">
                <Td><p className="font-medium">{p.product_name}</p><p className="font-mono text-[10px] text-gray-400">{p.sku}</p></Td>
                <Td className="text-xs text-gray-500">{p.category}</Td>
                <Td className="font-semibold text-red-600">{p.stock} {p.uom}</Td>
                <Td className="text-gray-400 text-xs">{p.last_sold||"—"}</Td>
                <Td><span className={`text-xs px-2 py-0.5 rounded-full font-semibold ${p.status==="never_sold"?"bg-red-50 text-red-600":"bg-amber-50 text-amber-700"}`}>{p.status==="never_sold"?"Never sold":"Slow moving"}</span></Td>
              </tr>
            ))}
          </tbody>
        </table></div>
      </div>
    </div>
  );

  if (type === "category-performance") return (
    <div className="bg-white border border-gray-100 rounded-xl p-5">
      <h3 className="text-sm font-semibold mb-4">Revenue by category</h3>
      {data.categories?.map(c=>{
        const max = data.categories[0]?.revenue||1;
        return (
          <div key={c.category} className="mb-4">
            <div className="flex justify-between text-sm mb-1.5">
              <span className="font-medium text-gray-800">{c.category}</span>
              <div className="flex gap-4 text-gray-500"><span>{c.order_lines} lines</span><span className="font-semibold text-gray-900">{fmtR(c.revenue)}</span><span>{c.pct}%</span></div>
            </div>
            <div className="h-2.5 bg-gray-100 rounded-full overflow-hidden"><div className="h-full bg-bassani-600 rounded-full" style={{width:`${Math.round(c.revenue/max*100)}%`}}/></div>
          </div>
        );
      })}
    </div>
  );

  return null;
}

function StatCardInline({ label, value, accent }) {
  return (
    <div className="bg-white border border-gray-100 rounded-xl p-4">
      <p className="text-xs text-gray-400 mb-1">{label}</p>
      <p className={`text-lg font-semibold ${accent||"text-gray-900"}`}>{value}</p>
    </div>
  );
}

// ─────────────────────────────────────────────────────────────────────────────
// Healthcare onboarding view
// ─────────────────────────────────────────────────────────────────────────────
export function Healthcare() {
  const { can }    = useAuth();
  const [submissions, setSubmissions] = useState([]);
  const [stats,       setStats      ] = useState({});
  const [total,       setTotal      ] = useState(0);
  const [loading,     setLoading    ] = useState(true);
  const [search,      setSearch     ] = useState("");
  const [statusF,     setStatusF    ] = useState("all");
  const [detail,      setDetail     ] = useState(null);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const r = await api.get("/api/healthcare/submissions", { params:{ search:search||undefined, status:statusF==="all"?undefined:statusF, limit:50 } });
      setSubmissions(r.data.submissions); setTotal(r.data.total); setStats(r.data.stats||{});
    } catch { toast.error("Failed to load submissions"); }
    finally { setLoading(false); }
  }, [search, statusF]);

  useEffect(() => { load(); }, [load]);

  const updateStatus = async (id, status) => {
    try { await api.put(`/api/healthcare/submissions/${id}/status`, { status }); toast.success(`Status updated to ${status}`); load(); if (detail?.id===id) setDetail({...detail,status}); }
    catch { toast.error("Update failed"); }
  };

  const STATUSES = ["all","pending","contacted","approved","declined"];
  const profStyle = { "General Practitioner":"bg-purple-50 text-purple-700", Specialist:"bg-bassani-50 text-bassani-700", Pharmacist:"bg-amber-50 text-amber-700", Nurse:"bg-pink-50 text-pink-700" };

  return (
    <div className="flex flex-col flex-1 overflow-hidden">
      <TopBar title="Healthcare Onboarding" subtitle="HPCSA-registered practitioners" onRefresh={load} />
      <main className="flex-1 overflow-y-auto p-6 space-y-4">
        {/* Stats */}
        <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
          <StatCardInline label="Total Submissions" value={total} />
          <StatCardInline label="Pending Review"    value={stats.pending||0}   accent="text-amber-600" />
          <StatCardInline label="Approved"          value={stats.approved||0}  accent="text-bassani-700" />
          <StatCardInline label="Declined"          value={stats.declined||0}  accent="text-red-600" />
        </div>

        {/* Filters */}
        <div className="space-y-2">
          <SearchBar value={search} onChange={setSearch} placeholder="Search name, HPCSA, practice…" />
          <ChipRow>
            {STATUSES.map(s=><FilterPill key={s} label={s==="all"?"All":s.charAt(0).toUpperCase()+s.slice(1)} active={statusF===s} onClick={()=>setStatusF(s)} />)}
          </ChipRow>
        </div>

        <Table headers={["Professional","Profession","Practice","Location","Section 21","Prescribing","Submitted","Status","Actions"]} loading={loading}>
          {submissions.length===0&&!loading&&<tr><td colSpan={9}><EmptyState /></td></tr>}
          {submissions.map(s=>(
            <Tr key={s.id} onClick={()=>setDetail(s)}>
              <Td><p className="font-medium">{s.full_name}{s.status==="pending"&&<span className="ml-1.5 text-[9px] bg-blue-50 text-blue-600 px-1.5 py-0.5 rounded-full font-bold">NEW</span>}</p><p className="font-mono text-[10px] text-gray-400">{s.hpcsa_number}</p></Td>
              <Td><span className={`text-[10px] px-2 py-0.5 rounded-full font-semibold ${profStyle[s.profession]||"bg-gray-100 text-gray-500"}`}>{s.profession}</span></Td>
              <Td className="text-xs text-gray-500">{s.practice_name}</Td>
              <Td className="text-xs text-gray-500">{s.practice_location}</Td>
              <Td><span className={`text-xs font-medium ${s.section21_familiar==="Yes"?"text-bassani-700":s.section21_familiar==="Somewhat"?"text-amber-600":"text-gray-400"}`}>{s.section21_familiar}</span></Td>
              <Td><span className={`text-xs font-medium ${s.currently_prescribing==="Yes"?"text-bassani-700":s.currently_prescribing==="Planning"?"text-amber-600":"text-gray-400"}`}>{s.currently_prescribing}</span></Td>
              <Td className="text-xs text-gray-400">{s.submitted_at?.split("T")[0]}</Td>
              <Td><Badge status={s.status} /></Td>
              <Td onClick={e=>e.stopPropagation()}>
                {can("healthcare.manage") ? (
                  <Select value={s.status} onChange={e=>updateStatus(s.id,e.target.value)} onClick={e=>e.stopPropagation()} style={{fontSize:"11px",padding:"3px 8px",width:"auto"}}>
                    {["pending","contacted","approved","declined"].map(st=><option key={st}>{st}</option>)}
                  </Select>
                ) : <span className="text-xs text-gray-400 capitalize">{s.status}</span>}
              </Td>
            </Tr>
          ))}
        </Table>
      </main>

      {detail && (
        <Modal title={detail.full_name} onClose={()=>setDetail(null)} width="max-w-xl">
          <div className="space-y-1 text-sm mb-4">
            {[
              ["HPCSA Number",detail.hpcsa_number],["Profession",detail.profession],["Practice",detail.practice_name],
              ["Location",detail.practice_location],["Practice Type",detail.practice_type],["Years in Practice",detail.years_in_practice],
              ["Email",detail.email],["Phone",detail.phone],["Currently Prescribing",detail.currently_prescribing],
              ["Section 21 Familiar",detail.section21_familiar],["Estimated Patients/month",detail.estimated_patients],
              ["Conditions of Interest",detail.conditions_of_interest],
            ].map(([l,v])=>(
              <div key={l} className="flex justify-between py-1.5 border-b border-gray-50">
                <span className="text-gray-400 text-xs">{l}</span>
                <span className="font-medium text-xs text-right max-w-xs">{v||"—"}</span>
              </div>
            ))}
          </div>
          {detail.additional_comments && <div className="bg-gray-50 rounded-lg p-3 text-xs text-gray-600 italic mb-4">"{detail.additional_comments}"</div>}
          <div className="flex justify-between items-center mt-2">
            <div className="flex gap-2">
              {detail.status==="pending"&&can("healthcare.manage")&&<BtnPrimary size="sm" onClick={()=>updateStatus(detail.id,"approved")}>Approve</BtnPrimary>}
              {(detail.status==="pending"||detail.status==="approved")&&can("healthcare.manage")&&<BtnSecondary size="sm" onClick={()=>updateStatus(detail.id,"contacted")}>Mark Contacted</BtnSecondary>}
              <a href={`mailto:${detail.email}`}><BtnSecondary size="sm">Send Email</BtnSecondary></a>
            </div>
            <BtnSecondary onClick={()=>setDetail(null)}>Close</BtnSecondary>
          </div>
        </Modal>
      )}
    </div>
  );
}
