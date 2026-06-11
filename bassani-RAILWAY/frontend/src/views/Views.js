// ─────────────────────────────────────────────────────────────────────────────
// Products view
// ─────────────────────────────────────────────────────────────────────────────
import { useState, useEffect, useCallback } from "react";
import { useAuth } from "../AuthContext";
import api from "../api";
import toast from "react-hot-toast";
import { Plus, Edit2, Archive, ChevronDown, Loader2 } from "lucide-react";
import {
  TopBar, Table, Tr, Td, DataTable, Modal, FormGroup, Input, Select, Textarea,
  BtnPrimary, BtnSecondary, BtnDanger, SearchBar, FilterPill, ChipRow,
  LoadingState, EmptyState, Badge, fmtR, fmtDate,
} from "../components/UI";


export function Products() {
  const { user } = useAuth();
  const isReseller = user?.role === "reseller";
  const [products,   setProducts  ] = useState([]);
  const [total,      setTotal     ] = useState(0);
  const [loading,    setLoading   ] = useState(true);
  const [search,     setSearch    ] = useState("");
  const [cat,        setCat       ] = useState("all");
  const [categories, setCategories] = useState([]);
  const [modal,       setModal      ] = useState(false);
  const [editing,     setEditing    ] = useState(null);
  const [form,        setForm       ] = useState({ name:"", default_code:"", categ_id:"", list_price:"", standard_price:"", type:"product", description:"" });
  const [saving,      setSaving     ] = useState(false);
  const [archivingId, setArchivingId] = useState(null);
  const [pagination, setPagination] = useState({ pageIndex: 0, pageSize: 25 });
  const [sorting,    setSorting   ] = useState([{ id: "name", desc: false }]);

  useEffect(() => {
    api.get("/api/products/categories")
      .then(r => setCategories(r.data.categories || []))
      .catch(() => {});
  }, []);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const sort = sorting[0];
      const params = { limit: pagination.pageSize, offset: pagination.pageIndex * pagination.pageSize };
      if (sort) { params.sort_by = sort.id; params.sort_dir = sort.desc ? "desc" : "asc"; }
      if (search) params.search = search;
      if (cat !== "all") params.category = cat;
      const r = await api.get("/api/products/", { params });
      setProducts(r.data.products); setTotal(r.data.total);
    } catch { toast.error("Failed to load products"); }
    finally { setLoading(false); }
  }, [search, cat, pagination, sorting]);

  useEffect(() => { load(); }, [load]);

  const stockColor = (qty) => qty <= 0 ? "text-red-600 font-semibold" : qty < 10 ? "text-amber-600 font-semibold" : "text-bassani-700 font-semibold";

  const openNew = () => { setEditing(null); setForm({ name:"", default_code:"", categ_id:"", list_price:"", standard_price:"", type:"product", description:"" }); setModal(true); };
  const openEdit = (p) => { setEditing(p); setForm({ name:p.name, default_code:p.default_code||"", categ_id:p.categ_id?.[0]||"", list_price:p.list_price, standard_price:p.standard_price, type:p.type, description:p.description||"" }); setModal(true); };

  const save = async () => {
    if (!form.name) return toast.error("Product name required");
    setSaving(true);
    try {
      if (editing) { await api.put(`/api/products/${editing.id}`, form); toast.success("Product updated"); }
      else         { await api.post("/api/products/", form);              toast.success("Product created"); }
      setModal(false); load();
    } catch (e) { toast.error(e.response?.data?.detail || "Save failed"); }
    finally { setSaving(false); }
  };

  const archive = async (id) => {
    if (!window.confirm("Archive this product?")) return;
    setArchivingId(id);
    try { await api.delete(`/api/products/${id}`); toast.success("Product archived"); load(); }
    catch { toast.error("Archive failed"); }
    finally { setArchivingId(null); }
  };

  return (
    <div className="flex flex-col flex-1 overflow-hidden">
      <TopBar title="Products" subtitle={`${total} products synced from Odoo`} onRefresh={load}
        actions={!isReseller && <BtnPrimary onClick={openNew}><Plus size={14} />Add Product</BtnPrimary>} />
      <main className="flex-1 overflow-y-auto p-6">
        <div className="mb-4 space-y-2">
          <SearchBar value={search} onChange={v => { setSearch(v); setPagination(p => ({...p, pageIndex:0})); }} placeholder="Search products, SKU…" />
          <ChipRow>
            {["all",...categories.map(c=>c.name)].map(c => <FilterPill key={c} label={c==="all"?"All":c} active={cat===c} onClick={() => { setCat(c); setPagination(p => ({...p, pageIndex:0})); }} />)}
          </ChipRow>
        </div>
        <DataTable
          columns={[
            { accessorKey:"name", header:"Product / SKU", cell:({ row:{original:p} }) => <div><p className="font-medium text-gray-900">{p.name}</p><p className="font-mono text-[10px] text-gray-400">{p.default_code||"—"}</p></div> },
            { id:"category", header:"Category", enableSorting:false, accessorFn:r=>r.categ_id?.[1]||"—", cell:({getValue})=><span className="text-xs text-gray-500">{getValue()}</span> },
            { accessorKey:"list_price", header:"Sale Price", cell:({ row:{original:p} })=><span className="font-semibold">{fmtR(p.list_price)}</span> },
            { accessorKey:"standard_price", header:"Cost", cell:({ row:{original:p} })=><span className="text-gray-500">{fmtR(p.standard_price)}</span> },
            { accessorKey:"qty_available", header:"On Hand", cell:({ row:{original:p} })=>{ const q=p.qty_available??0; return <span className={stockColor(q)}>{q}</span>; } },
            { accessorKey:"virtual_available", header:"Forecasted", enableSorting:false, cell:({ row:{original:p} })=><span className="text-gray-500">{p.virtual_available??0}</span> },
            ...(!isReseller ? [{ id:"actions", header:"", enableSorting:false, cell:({ row:{original:p} })=><div className="flex gap-1.5"><BtnSecondary size="sm" onClick={e=>{e.stopPropagation();openEdit(p);}}><Edit2 size={11}/></BtnSecondary><BtnDanger onClick={e=>{e.stopPropagation();archive(p.id);}} loading={archivingId===p.id} disabled={!!archivingId}><Archive size={11}/></BtnDanger></div> }] : []),
          ]}
          data={products} loading={loading} total={total}
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
            <FormGroup label="Category"><Select value={form.categ_id} onChange={e=>setForm({...form,categ_id:parseInt(e.target.value)||""})}>
              <option value="">— Select category —</option>
              {categories.map(c=><option key={c.id} value={c.id}>{c.name}</option>)}
            </Select></FormGroup>
            <FormGroup label="Sale Price (ZAR)"><Input type="number" value={form.list_price} onChange={e=>setForm({...form,list_price:e.target.value})} placeholder="450.00" /></FormGroup>
            <FormGroup label="Cost (ZAR)"><Input type="number" value={form.standard_price} onChange={e=>setForm({...form,standard_price:e.target.value})} placeholder="200.00" /></FormGroup>
          </div>
          <FormGroup label="Description"><Textarea value={form.description} onChange={e=>setForm({...form,description:e.target.value})} rows={2} placeholder="Short product description" /></FormGroup>
          <div className="flex justify-end gap-2 mt-4"><BtnSecondary onClick={()=>setModal(false)} disabled={saving}>Cancel</BtnSecondary><BtnPrimary onClick={save} loading={saving}>{editing ? "Save Product" : "Create Product"}</BtnPrimary></div>
        </Modal>
      )}
    </div>
  );
}

// ─────────────────────────────────────────────────────────────────────────────
// Customers view
// ─────────────────────────────────────────────────────────────────────────────
export function Customers() {
  const { user } = useAuth();
  const isReseller = user?.role === "reseller";
  const [customers, setCustomers] = useState([]);
  const [total,     setTotal    ] = useState(0);
  const [loading,   setLoading  ] = useState(true);
  const [search,    setSearch   ] = useState("");
  const [modal,     setModal    ] = useState(false);
  const [detail,    setDetail   ] = useState(null);
  const [form,      setForm     ] = useState({ name:"", email:"", phone:"", street:"", city:"", credit_limit:"", customer_type:"Pharmacy", section21_registered:false });
  const [custPag,   setCustPag  ] = useState({ pageIndex: 0, pageSize: 25 });
  const [custSort,  setCustSort ] = useState([{ id: "name", desc: false }]);
  const [saving,    setSaving   ] = useState(false);

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

  const save = async () => {
    if (!form.name) return toast.error("Name required");
    setSaving(true);
    try {
      await api.post("/api/customers/", form);
      toast.success("Customer created"); setModal(false); load();
    } catch (e) { toast.error(e.response?.data?.detail || "Save failed"); }
    finally { setSaving(false); }
  };

  const TYPES = ["Pharmacy","Dispensary","Clinic","Hospital","Retail"];
  const balanceColor = (b, l) => !l ? "text-gray-600" : b/l >= 1 ? "text-red-600" : b/l >= 0.75 ? "text-amber-600" : "text-bassani-700";

  return (
    <div className="flex flex-col flex-1 overflow-hidden">
      <TopBar title="Customers" subtitle={`${total} active accounts`} onRefresh={load}
        actions={!isReseller && <BtnPrimary onClick={()=>setModal(true)}><Plus size={14}/>Add Customer</BtnPrimary>} />
      <main className="flex-1 overflow-y-auto p-6">
        <div className="flex items-center gap-2 mb-4"><SearchBar value={search} onChange={v=>{ setSearch(v); setCustPag(p=>({...p,pageIndex:0})); }} placeholder="Search customers, city…" /></div>
        <DataTable
          columns={[
            { accessorKey:"name", header:"Customer", cell:({row:{original:c}})=><p className="font-medium">{c.name}</p> },
            { id:"type", header:"Type", enableSorting:false, accessorFn:r=>r.comment?.match(/Type: (\w+)/)?.[1]||"—", cell:({row:{original:c}})=><Badge status={c.comment?.match(/Type: (\w+)/)?.[1]?.toLowerCase()||"pharmacy"} label={c.comment?.match(/Type: (\w+)/)?.[1]||"—"} /> },
            { accessorKey:"email", header:"Contact", cell:({row:{original:c}})=><span className="text-xs text-gray-500">{c.email||"—"}</span> },
            { accessorKey:"city", header:"City", cell:({row:{original:c}})=><span className="text-gray-500 text-sm">{c.city||"—"}</span> },
            { id:"s21", header:"Section 21", enableSorting:false, cell:({row:{original:c}})=>c.comment?.includes("Section 21: Registered")?<span className="text-xs text-bassani-700 font-medium">✓ Registered</span>:<span className="text-xs text-gray-400">—</span> },
            { accessorKey:"credit_limit", header:"Credit Limit", cell:({row:{original:c}})=><span className={balanceColor(0,c.credit_limit)}>{fmtR(c.credit_limit)}</span> },
            { id:"terms", header:"Terms", enableSorting:false, cell:({row:{original:c}})=><span className="text-xs text-gray-500">{c.property_payment_term_id?.[1]||"—"}</span> },
            ...(!isReseller?[{ id:"actions", header:"", enableSorting:false, cell:({row:{original:c}})=><BtnSecondary size="sm" onClick={e=>{e.stopPropagation();setDetail(c);}}>View</BtnSecondary> }]:[]),
          ]}
          data={customers} loading={loading} total={total}
          pagination={custPag} onPaginationChange={setCustPag}
          sorting={custSort} onSortingChange={u=>{ setCustSort(typeof u==="function"?u(custSort):u); setCustPag(p=>({...p,pageIndex:0})); }}
          onRowClick={setDetail}
          manualPagination manualSorting
        />
      </main>
      {modal && (
        <Modal title="Add Customer" onClose={()=>setModal(false)}>
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
            <FormGroup label="Business Name" required><Input value={form.name} onChange={e=>setForm({...form,name:e.target.value})} placeholder="Wellness Pharmacy" /></FormGroup>
            <FormGroup label="Type"><Select value={form.customer_type} onChange={e=>setForm({...form,customer_type:e.target.value})}>{TYPES.map(t=><option key={t}>{t}</option>)}</Select></FormGroup>
            <FormGroup label="Email"><Input value={form.email} onChange={e=>setForm({...form,email:e.target.value})} placeholder="orders@example.co.za" /></FormGroup>
            <FormGroup label="Phone"><Input value={form.phone} onChange={e=>setForm({...form,phone:e.target.value})} placeholder="+27 11 555 1234" /></FormGroup>
            <FormGroup label="City"><Input value={form.city} onChange={e=>setForm({...form,city:e.target.value})} placeholder="Johannesburg" /></FormGroup>
            <FormGroup label="Credit Limit (ZAR)"><Input type="number" value={form.credit_limit} onChange={e=>setForm({...form,credit_limit:e.target.value})} placeholder="50000" /></FormGroup>
          </div>
          <FormGroup label="Address"><Input value={form.street} onChange={e=>setForm({...form,street:e.target.value})} placeholder="123 Health Street, Sandton" /></FormGroup>
          <div className="flex items-center gap-2 mb-4"><input type="checkbox" id="s21" checked={form.section21_registered} onChange={e=>setForm({...form,section21_registered:e.target.checked})} className="accent-bassani-600" /><label htmlFor="s21" className="text-sm text-gray-600">Section 21 registered</label></div>
          <div className="flex justify-end gap-2"><BtnSecondary onClick={()=>setModal(false)} disabled={saving}>Cancel</BtnSecondary><BtnPrimary onClick={save} loading={saving}>Save Customer</BtnPrimary></div>
        </Modal>
      )}
      {detail && (
        <Modal title={detail.name} onClose={()=>setDetail(null)}>
          <div className="space-y-2 text-sm">
            {[["Email",detail.email||"—"],["Phone",detail.phone||"—"],["City",detail.city||"—"],["Credit Limit",fmtR(detail.credit_limit)],["Payment Terms",detail.property_payment_term_id?.[1]||"—"]].map(([l,v])=>(
              <div key={l} className="flex justify-between py-2 border-b border-gray-50"><span className="text-gray-500">{l}</span><span className="font-medium">{v}</span></div>
            ))}
          </div>
          <div className="flex justify-end mt-4"><BtnSecondary onClick={()=>setDetail(null)}>Close</BtnSecondary></div>
        </Modal>
      )}
    </div>
  );
}

// ─────────────────────────────────────────────────────────────────────────────
// Orders view
// ─────────────────────────────────────────────────────────────────────────────
export function Orders() {
  const { user } = useAuth();
  const isReseller = user?.role === "reseller";

  // ── List view state ───────────────────────────────────────────────────────
  const [view,        setView       ] = useState("list"); // "list" | "cart"
  const [orders,      setOrders     ] = useState([]);
  const [orderTotal,  setOrderTotal ] = useState(0);
  const [loading,     setLoading    ] = useState(true);
  const [search,      setSearch     ] = useState("");
  const [status,      setStatus     ] = useState("all");
  const [detail,      setDetail     ] = useState(null);
  const [orderPag,    setOrderPag   ] = useState({ pageIndex: 0, pageSize: 25 });
  const [orderSort,   setOrderSort  ] = useState([{ id: "date_order", desc: true }]);

  // ── Cart view state ───────────────────────────────────────────────────────
  const [products,     setProducts    ] = useState([]);
  const [prodsLoading, setProdsLoading] = useState(false);
  const [prodSearch,   setProdSearch  ] = useState("");
  const [prodCat,      setProdCat     ] = useState("all");
  const [stockFilter,  setStockFilter ] = useState("all"); // "all"|"in_stock"|"out_of_stock"
  const [cart,         setCart        ] = useState([]);
  const [orderNote,    setOrderNote   ] = useState("");
  const [custSearch,   setCustSearch  ] = useState("");
  const [custResults,  setCustResults ] = useState([]);
  const [custLoading,  setCustLoading ] = useState(false);
  const [selectedCust, setSelectedCust] = useState(null);
  const [custDropOpen,     setCustDropOpen    ] = useState(false);
  const [submitting,         setSubmitting        ] = useState(false);
  const [commissionOverride, setCommissionOverride] = useState(null); // reseller's chosen rate for this order
  const [confirming,         setConfirming        ] = useState(new Set());
  const [cancelling,         setCancelling        ] = useState(new Set());

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

  const confirm = async (id) => {
    setConfirming(s => new Set(s).add(id));
    try {
      const { data } = await api.put(`/api/orders/${id}/confirm`);
      if (data.invoice_name) {
        toast.success(`Order confirmed · Invoice ${data.invoice_name} created`);
      } else {
        toast.success("Order confirmed");
      }
      if (data.warnings?.length) {
        data.warnings.forEach(w => toast(w, { icon: "⚠️", duration: 8000 }));
      }
      load();
    } catch (e) {
      toast.error(e.response?.data?.detail || "Failed to confirm order");
    } finally {
      setConfirming(s => { const n = new Set(s); n.delete(id); return n; });
    }
  };

  const cancelOrder = async (id) => {
    if (!window.confirm("Cancel this order? This cannot be undone.")) return;
    setCancelling(s => new Set(s).add(id));
    try {
      await api.put(`/api/orders/${id}/cancel`);
      toast.success("Order cancelled");
      setDetail(null);
      load();
    } catch (e) {
      toast.error(e.response?.data?.detail || "Failed to cancel order");
    } finally {
      setCancelling(s => { const n = new Set(s); n.delete(id); return n; });
    }
  };

  // ── Load products for cart view ───────────────────────────────────────────
  const loadProducts = async () => {
    setProdsLoading(true);
    try {
      const r = await api.get("/api/products/", { params: { limit: 200 } });
      setProducts(r.data.products || []);
    } catch { toast.error("Failed to load products"); }
    finally { setProdsLoading(false); }
  };

  // ── Customer search debounce (cart) ───────────────────────────────────────
  useEffect(() => {
    if (!custDropOpen) { setCustResults([]); return; }
    const delay = custSearch.length >= 2 ? 300 : 0;
    const t = setTimeout(async () => {
      setCustLoading(true);
      try {
        const params = { limit: 20 };
        if (custSearch.length >= 2) params.search = custSearch;
        const r = await api.get("/api/customers/", { params });
        setCustResults(r.data.customers || []);
      } catch { setCustResults([]); }
      finally { setCustLoading(false); }
    }, delay);
    return () => clearTimeout(t);
  }, [custSearch, custDropOpen, isReseller]);

  // ── Open cart view ────────────────────────────────────────────────────────
  const openCart = () => {
    setCart([]); setProdSearch(""); setProdCat("all"); setStockFilter("all"); setOrderNote("");
    setCustSearch(""); setCustResults([]); setSelectedCust(null);
    setCustDropOpen(false); setSubmitting(false);
    // Resellers always start at the full 12.5% rate — slider lets them reduce it as a customer discount
    setCommissionOverride(isReseller ? COMMISSION_CAP : null);
    loadProducts();
    setView("cart");
  };

  // ── Cart operations ───────────────────────────────────────────────────────
  const addToCart = (product) => {
    const pid = product.product_variant_ids?.[0] ?? product.id;
    setCart(prev => {
      const ex = prev.find(i => i.product_id === pid);
      if (ex) return prev.map(i => i.product_id === pid ? { ...i, product_uom_qty: i.product_uom_qty + 1 } : i);
      return [...prev, { product_id: pid, product_uom_qty: 1, price_unit: product.list_price, name: product.name, _sku: product.default_code || "", _stock: Math.max(0, product.virtual_available ?? 0) }];
    });
  };

  const removeFromCart = (pid) => setCart(prev => prev.filter(i => i.product_id !== pid));

  const updateQty = (pid, qty) => {
    if (qty <= 0) { removeFromCart(pid); return; }
    setCart(prev => prev.map(i => i.product_id === pid ? { ...i, product_uom_qty: qty } : i));
  };

  const cartItemFor = (product) => {
    const pid = product.product_variant_ids?.[0] ?? product.id;
    return cart.find(i => i.product_id === pid) || null;
  };

  // ── Submit order ──────────────────────────────────────────────────────────
  const submitOrder = async () => {
    if (cart.length === 0) return toast.error("Add at least one product");
    if (!selectedCust) return toast.error("Select a customer first");
    setSubmitting(true);
    try {
      const payload = {
        partner_id: selectedCust.id,
        order_line: cart.map(i => ({ product_id: i.product_id, product_uom_qty: i.product_uom_qty, price_unit: i.price_unit, name: i.name })),
        note: orderNote,
      };
      if (isReseller && commissionOverride !== null) {
        payload.commission_override = commissionOverride;
      }
      await api.post("/api/orders/", payload);
      toast.success("Order placed successfully");
      setView("list");
      load();
    } catch (e) {
      toast.error(e.response?.data?.detail || "Failed to place order");
    } finally { setSubmitting(false); }
  };

  // ── Derived ───────────────────────────────────────────────────────────────
  const productCategories = ["all", ...Array.from(new Set(products.map(p => p.categ_id?.[1]).filter(Boolean))).sort()];
  const filteredProducts  = products.filter(p => {
    const q         = prodSearch.toLowerCase();
    const inStock   = (p.virtual_available ?? 0) > 0;
    const matchQ    = !q || p.name.toLowerCase().includes(q) || (p.default_code || "").toLowerCase().includes(q);
    const matchCat  = prodCat === "all" || (p.categ_id?.[1] || "") === prodCat;
    const matchStock = stockFilter === "all" || (stockFilter === "in_stock" ? inStock : !inStock);
    return matchQ && matchCat && matchStock;
  });
  const COMMISSION_CAP = 12.5;
  const cartSubtotal   = cart.reduce((s, i) => s + i.product_uom_qty * i.price_unit, 0);
  // Discount = the gap between the 12.5% cap and the reseller's chosen rate, passed to the customer
  const cartDiscount   = (isReseller && commissionOverride !== null)
    ? cartSubtotal * ((COMMISSION_CAP - commissionOverride) / 100)
    : 0;
  const cartAdjusted   = cartSubtotal - cartDiscount;   // what the customer actually pays (ex-VAT)
  const cartVat        = cartAdjusted * 0.15;
  const cartTotal      = cartAdjusted + cartVat;
  const cartCommission = (isReseller && commissionOverride !== null)
    ? cartSubtotal * (commissionOverride / 100)
    : 0;

  const STATUSES = ["all","draft","sale","done","cancel"];

  // ── Cart view ─────────────────────────────────────────────────────────────
  if (view === "cart") {
    return (
      <div className="flex flex-col flex-1 overflow-hidden">
        <TopBar title="Place New Order"
          subtitle="Select a customer and add products"
          actions={<BtnSecondary onClick={()=>setView("list")}>← Back to Orders</BtnSecondary>} />

        <div className="flex flex-col lg:flex-row flex-1 overflow-hidden">

          {/* ── Left panel: product browser ────────────────────────────── */}
          <div className="flex-1 flex flex-col overflow-hidden min-h-0">
            {/* Search + category filters */}
            <div className="px-6 pt-5 pb-4 bg-white border-b border-gray-100 space-y-3">
              <input
                value={prodSearch}
                onChange={e => setProdSearch(e.target.value)}
                placeholder="Search by product name or SKU…"
                className="w-full px-3 py-2 text-sm border border-gray-200 rounded-lg focus:outline-none focus:ring-2 focus:ring-bassani-300 bg-gray-50 placeholder-gray-400"
              />
              <ChipRow>
                {productCategories.map(c => (
                  <FilterPill key={c} label={c === "all" ? "All Categories" : c} active={prodCat === c} onClick={() => setProdCat(c)} />
                ))}
                <div className="w-px bg-gray-200 self-stretch shrink-0 mx-1" />
                <FilterPill label="In Stock"     active={stockFilter === "in_stock"}     onClick={() => setStockFilter(stockFilter === "in_stock"     ? "all" : "in_stock")}     />
                <FilterPill label="Out of Stock" active={stockFilter === "out_of_stock"} onClick={() => setStockFilter(stockFilter === "out_of_stock" ? "all" : "out_of_stock")} />
              </ChipRow>
            </div>
            {/* Product grid */}
            <div className="flex-1 overflow-y-auto p-6">
              {prodsLoading && <LoadingState />}
              {!prodsLoading && filteredProducts.length === 0 && <EmptyState />}
              {!prodsLoading && (
                <div className="grid grid-cols-2 xl:grid-cols-3 gap-4">
                  {filteredProducts.map(p => {
                    const item        = cartItemFor(p);
                    const outOfStock  = (p.virtual_available ?? 0) <= 0;
                    const lowStock    = !outOfStock && (p.virtual_available ?? 0) < 10;
                    return (
                      <div key={p.id}
                        className={`bg-white border rounded-xl p-4 flex flex-col gap-3 transition-all ${item ? "border-bassani-300 ring-1 ring-bassani-100 shadow-sm" : "border-gray-100 hover:border-gray-200 hover:shadow-sm"}`}>
                        {/* Name + SKU + category */}
                        <div className="flex-1">
                          <div className="flex items-start justify-between gap-2">
                            <p className="font-semibold text-gray-900 text-sm leading-snug">{p.name}</p>
                            {item && <span className="bg-bassani-600 text-white text-[10px] font-bold px-1.5 py-0.5 rounded-full shrink-0">×{item.product_uom_qty}</span>}
                          </div>
                          {p.default_code && <p className="font-mono text-[10px] text-gray-400 mt-0.5">{p.default_code}</p>}
                          {p.categ_id?.[1] && <span className="inline-block mt-1 text-[10px] text-gray-400 bg-gray-50 rounded-full px-2 py-0.5">{p.categ_id[1]}</span>}
                        </div>
                        {/* Price + stock badge */}
                        <div className="flex items-center justify-between gap-2">
                          <span className="text-base font-bold text-gray-900">{fmtR(p.list_price)}</span>
                          <span className={`text-[11px] font-semibold px-2 py-0.5 rounded-full ${outOfStock ? "bg-red-50 text-red-600" : lowStock ? "bg-amber-50 text-amber-600" : "bg-green-50 text-green-700"}`}>
                            {outOfStock ? "Out of stock" : `${p.virtual_available} available`}
                          </span>
                        </div>
                        {/* Add button or qty stepper */}
                        {item ? (
                          <div className="flex items-center gap-1.5">
                            <button onClick={() => updateQty(item.product_id, item.product_uom_qty - 1)}
                              className="w-8 h-8 rounded-lg border border-gray-200 text-gray-600 hover:bg-gray-50 flex items-center justify-center font-bold text-base">−</button>
                            <input type="number" min={1} max={item._stock} value={item.product_uom_qty}
                              onChange={e => { const v = parseInt(e.target.value); if (!isNaN(v) && v >= 1) updateQty(item.product_id, Math.min(v, item._stock)); }}
                              className="flex-1 w-20 text-center font-bold text-sm bg-transparent border-0 focus:outline-none [appearance:textfield] [&::-webkit-outer-spin-button]:appearance-none [&::-webkit-inner-spin-button]:appearance-none" />
                            <button onClick={() => updateQty(item.product_id, item.product_uom_qty + 1)}
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
            {/* Header */}
            <div className="px-5 py-4 border-b border-gray-100 flex items-center justify-between">
              <div>
                <h3 className="font-semibold text-gray-900">Your Order</h3>
                <p className="text-xs text-gray-400 mt-0.5">{cart.length === 0 ? "No items yet" : `${cart.length} line${cart.length > 1 ? "s" : ""} · ${fmtR(cartTotal)}`}</p>
              </div>
              {cart.length > 0 && <span className="bg-bassani-600 text-white text-xs font-bold px-2 py-0.5 rounded-full">{cart.length}</span>}
            </div>

            {/* Scrollable body */}
            <div className="flex-1 overflow-y-auto px-5 py-4 space-y-4">

              {/* Customer selector */}
              <div>
                <p className="text-[10px] font-semibold text-gray-400 uppercase tracking-wider mb-1.5">
                  {isReseller ? "Ordering For (Customer)" : "Customer"} <span className="text-red-400">*</span>
                </p>
                {selectedCust ? (
                  <div className="flex items-center gap-2 border border-bassani-300 bg-bassani-50 rounded-xl px-3 py-2">
                    <span className="w-2 h-2 rounded-full bg-bassani-500 shrink-0"/>
                    <p className="text-sm font-semibold text-bassani-800 flex-1 truncate">{selectedCust.name}</p>
                    <button onClick={() => { setSelectedCust(null); setCustSearch(""); setCustDropOpen(true); }}
                      className="text-gray-400 hover:text-red-500 text-xl leading-none shrink-0">×</button>
                  </div>
                ) : (
                  <div className="relative">
                    <Input value={custSearch} onChange={e => setCustSearch(e.target.value)}
                      onFocus={() => setCustDropOpen(true)}
                      onBlur={() => setTimeout(() => setCustDropOpen(false), 150)}
                      placeholder="Search customers…" />
                    <span className="absolute right-3 top-1/2 -translate-y-1/2 pointer-events-none text-gray-400">
                      <ChevronDown size={14} />
                    </span>
                    {custDropOpen && (
                      <div className="absolute z-10 w-full bg-white border border-gray-200 rounded-xl shadow-lg mt-1 max-h-44 overflow-y-auto">
                        {custLoading && <p className="px-3 py-2 text-xs text-gray-400">Loading…</p>}
                        {!custLoading && custResults.length === 0 && <p className="px-3 py-2 text-xs text-gray-400">No customers found</p>}
                        {custResults.map(c => (
                          <button key={c.id} onMouseDown={() => { setSelectedCust(c); setCustSearch(c.name); setCustDropOpen(false); setCustResults([]); }}
                            className="w-full text-left px-3 py-2 hover:bg-gray-50 text-sm border-b border-gray-50 last:border-0">
                            <span className="font-medium">{c.name}</span>
                            {c.city && <span className="text-gray-400 text-xs ml-1.5">{c.city}</span>}
                          </button>
                        ))}
                      </div>
                    )}
                  </div>
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
                          <button onClick={() => updateQty(item.product_id, item.product_uom_qty - 1)}
                            className="w-7 h-7 flex items-center justify-center text-gray-500 hover:bg-gray-50 font-semibold text-sm">−</button>
                          <input type="number" min={1} max={item._stock} value={item.product_uom_qty}
                            onChange={e => { const v = parseInt(e.target.value); if (!isNaN(v) && v >= 1) updateQty(item.product_id, Math.min(v, item._stock)); }}
                            className="w-20 text-center text-sm font-bold text-gray-800 bg-transparent border-0 focus:outline-none [appearance:textfield] [&::-webkit-outer-spin-button]:appearance-none [&::-webkit-inner-spin-button]:appearance-none" />
                          <button onClick={() => updateQty(item.product_id, item.product_uom_qty + 1)}
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
                  {cartDiscount > 0 && (
                    <div className="flex justify-between text-green-700">
                      <span>Discount ({(COMMISSION_CAP - commissionOverride).toFixed(1)}%)</span>
                      <span className="font-semibold">-{fmtR(cartDiscount)}</span>
                    </div>
                  )}
                  <div className="flex justify-between text-gray-500">
                    <span>VAT (15%)</span>
                    <span>{fmtR(cartVat)}</span>
                  </div>
                  <div className="flex justify-between font-bold text-base pt-1.5 border-t border-gray-100">
                    <span className="text-gray-900">Total</span>
                    <span className="text-bassani-700">{fmtR(cartTotal)}</span>
                  </div>
                  {isReseller && commissionOverride !== null && (
                    <div className="pt-2 border-t border-dashed border-bassani-200 space-y-2">
                      <div className="flex items-center justify-between">
                        <span className="text-[10px] font-semibold text-gray-400 uppercase tracking-wider">Your Commission</span>
                        <span className="text-xs font-bold text-bassani-700">{commissionOverride}% · {fmtR(cartCommission)}</span>
                      </div>
                      <input type="range" min={0} max={COMMISSION_CAP} step={0.5}
                        value={commissionOverride}
                        onChange={e => setCommissionOverride(parseFloat(e.target.value))}
                        className="w-full accent-bassani-600" />
                      <div className="flex justify-between text-[10px] text-gray-400">
                        <span>0% (max discount)</span>
                        <span>{COMMISSION_CAP}% (no discount)</span>
                      </div>
                    </div>
                  )}
                </div>
              )}
              <Textarea value={orderNote} onChange={e => setOrderNote(e.target.value)} rows={2} placeholder="Delivery notes or special instructions…" />
              <div className="flex gap-2">
                <BtnSecondary onClick={() => setView("list")} className="flex-1">Cancel</BtnSecondary>
                <BtnPrimary onClick={submitOrder} loading={submitting} disabled={submitting || cart.length === 0} className="flex-1">
                  {submitting ? "Placing…" : "Place Order"}
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
      <TopBar title="Orders" subtitle={`${orderTotal} orders`} onRefresh={load}
        actions={<BtnPrimary onClick={openCart}><Plus size={14}/>Place Order</BtnPrimary>} />
      <main className="flex-1 overflow-y-auto p-6">
        <div className="mb-4 space-y-2">
          <SearchBar value={search} onChange={v=>{ setSearch(v); setOrderPag(p=>({...p,pageIndex:0})); }} placeholder="Search order, customer…" />
          <ChipRow>
            {STATUSES.map(s=><FilterPill key={s} label={s==="all"?"All":s==="sale"?"Confirmed":s==="draft"?"Quotation":s.charAt(0).toUpperCase()+s.slice(1)} active={status===s} onClick={()=>{ setStatus(s); setOrderPag(p=>({...p,pageIndex:0})); }} />)}
          </ChipRow>
        </div>
        <DataTable
          columns={[
            { accessorKey:"name", header:"Order #", cell:({row:{original:o}})=><span className="font-mono text-xs text-bassani-700">{o.name}</span> },
            { id:"customer", header:"Customer", enableSorting:false, cell:({row:{original:o}})=><div><p className="font-medium text-sm">{o.partner_id?.[1]||"—"}</p>{o.reseller_name&&<span className="text-[10px] bg-purple-50 text-purple-700 px-1.5 py-0.5 rounded-full">{o.reseller_name}</span>}</div> },
            { accessorKey:"date_order", header:"Date", cell:({row:{original:o}})=><span className="text-xs text-gray-500">{o.date_order?.split("T")[0]}</span> },
            { accessorKey:"amount_untaxed", header:"Amount", cell:({row:{original:o}})=>fmtR(o.amount_untaxed) },
            { accessorKey:"amount_total", header:"Total", cell:({row:{original:o}})=><span className="font-semibold">{fmtR(o.amount_total)}</span> },
            { id:"commission", header:"Commission", enableSorting:false, cell:({row:{original:o}})=><span className={o.commission_total>0?"text-bassani-700 font-medium":"text-gray-300"}>{o.commission_total>0?fmtR(o.commission_total):"—"}</span> },
            { id:"state", header:"Status", enableSorting:false, cell:({row:{original:o}})=><Badge status={o.state} /> },
            { id:"invoice", header:"Payment", enableSorting:false, cell:({row:{original:o}})=><Badge status={o.invoice_status} /> },
            ...(!isReseller?[{ id:"actions", header:"", enableSorting:false, cell:({row:{original:o}})=>
              (o.state==="draft"||o.state==="sale") ? (
                <div className="flex gap-1.5" onClick={e=>e.stopPropagation()}>
                  {o.state==="draft" && <BtnPrimary size="sm" onClick={()=>confirm(o.id)} loading={confirming.has(o.id)} disabled={confirming.has(o.id)||cancelling.has(o.id)}>Confirm</BtnPrimary>}
                  {o.state!=="cancel" && <BtnSecondary size="sm" onClick={()=>cancelOrder(o.id)} loading={cancelling.has(o.id)} disabled={confirming.has(o.id)||cancelling.has(o.id)} className="text-red-600 border-red-200 hover:bg-red-50">Cancel</BtnSecondary>}
                </div>
              ) : null
            }]:[]),
          ]}
          data={orders} loading={loading} total={orderTotal}
          pagination={orderPag} onPaginationChange={setOrderPag}
          sorting={orderSort} onSortingChange={u=>{ setOrderSort(typeof u==="function"?u(orderSort):u); setOrderPag(p=>({...p,pageIndex:0})); }}
          onRowClick={setDetail}
          manualPagination manualSorting
        />
      </main>
      {detail && (
        <Modal title={detail.name} onClose={()=>setDetail(null)} width="max-w-xl">
          <div className="space-y-1.5 text-sm mb-4">
            <div className="flex justify-between py-2 border-b border-gray-50"><span className="text-gray-500">Customer</span><span className="font-medium">{detail.partner_id?.[1]}</span></div>
            {detail.reseller_name&&<div className="flex justify-between py-2 border-b border-gray-50"><span className="text-gray-500">Reseller</span><span className="font-medium">{detail.reseller_name}</span></div>}
            <div className="flex justify-between py-2 border-b border-gray-50"><span className="text-gray-500">Subtotal</span><span>{fmtR(detail.amount_untaxed)}</span></div>
            {detail.commission_total>0&&<div className="flex justify-between py-2 border-b border-gray-50 text-bassani-700"><span>Commission</span><span className="font-medium">{fmtR(detail.commission_total)}</span></div>}
            <div className="flex justify-between py-2 border-b border-gray-50"><span className="text-gray-500">VAT (15%)</span><span>{fmtR(detail.amount_tax)}</span></div>
            <div className="flex justify-between py-2 font-semibold text-base"><span>Total</span><span>{fmtR(detail.amount_total)}</span></div>
          </div>
          <div className="flex justify-between items-center mt-4">
            <Badge status={detail.state} />
            <div className="flex gap-2">
              <BtnSecondary onClick={()=>setDetail(null)}>Close</BtnSecondary>
              {!isReseller && detail.state!=="cancel" && detail.state!=="done" && (
                <BtnSecondary onClick={()=>cancelOrder(detail.id)} loading={cancelling.has(detail.id)} disabled={confirming.has(detail.id)||cancelling.has(detail.id)} className="text-red-600 border-red-200 hover:bg-red-50">Cancel Order</BtnSecondary>
              )}
              {!isReseller && detail.state==="draft" && <BtnPrimary onClick={()=>{confirm(detail.id);setDetail(null);}} loading={confirming.has(detail.id)} disabled={confirming.has(detail.id)||cancelling.has(detail.id)}>Confirm Order</BtnPrimary>}
            </div>
          </div>
        </Modal>
      )}
    </div>
  );
}

// ─────────────────────────────────────────────────────────────────────────────
// Resellers view
// ─────────────────────────────────────────────────────────────────────────────
export function Resellers() {
  const BLANK_FORM = { name:"", type:"Distributor", seller_code:"", contact_person:"", email:"", phone:"", odoo_partner_id:"", username:"", password:"", company_reg_number:"", vat_registered:false, vat_number:"", bank_name:"", bank_account_holder:"", bank_account_number:"", bank_branch_code:"" };

  const [resellers,          setResellers         ] = useState([]);
  const [loading,            setLoading           ] = useState(true);
  const [modal,              setModal             ] = useState(false);
  const [form,               setForm              ] = useState(BLANK_FORM);
  const [customerSearch,     setCustomerSearch    ] = useState("");
  const [customers,          setCustomers         ] = useState([]);
  const [customerLoading,    setCustomerLoading   ] = useState(false);
  const [selectedCustomer,   setSelectedCustomer  ] = useState(null);
  const [custDropdownOpen,   setCustDropdownOpen  ] = useState(false);
  const [editModal,          setEditModal         ] = useState(false);
  const [editingId,          setEditingId         ] = useState(null);
  const [editForm,           setEditForm          ] = useState({ name:"", type:"Distributor", contact_person:"", email:"", phone:"", company_reg_number:"", vat_registered:false, vat_number:"", bank_name:"", bank_account_holder:"", bank_account_number:"", bank_branch_code:"" });
  const [saving,             setSaving            ] = useState(false);
  const [editSaving,         setEditSaving        ] = useState(false);

  const load = async () => {
    setLoading(true);
    try { const r = await api.get("/api/resellers/"); setResellers(r.data.resellers); }
    catch { toast.error("Failed to load resellers"); }
    finally { setLoading(false); }
  };
  useEffect(() => { load(); }, []);

  // Load customers whenever dropdown is open — debounce only when typing
  useEffect(() => {
    if (!custDropdownOpen) { setCustomers([]); return; }
    const delay = customerSearch.length >= 2 ? 300 : 0;
    const t = setTimeout(async () => {
      setCustomerLoading(true);
      try {
        const params = { limit: 20 };
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
    setForm({ ...BLANK_FORM });
    setSelectedCustomer(null); setCustomerSearch(""); setCustomers([]); setCustDropdownOpen(false); setModal(true);
  };

  const openEdit = (r) => {
    setEditForm({
      name: r.name, type: r.type, contact_person: r.contact_person||"", email: r.email||"", phone: r.phone||"",
      company_reg_number: r.company_reg_number || "",
      vat_registered: r.vat_registered || false, vat_number: r.vat_number || "",
      bank_name: r.bank_name || "", bank_account_holder: r.bank_account_holder || "",
      bank_account_number: r.bank_account_number || "", bank_branch_code: r.bank_branch_code || "",
    });
    setEditingId(r.id);
    setEditModal(true);
  };

  const saveEdit = async () => {
    if (!editForm.name) return toast.error("Name required");
    setEditSaving(true);
    try {
      await api.put(`/api/resellers/${editingId}`, editForm);
      toast.success("Reseller updated");
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
      await api.post("/api/resellers/", payload);
      toast.success("Reseller created");
      setModal(false);
      load();
    } catch (e) { toast.error(e.response?.data?.detail || "Save failed"); }
    finally { setSaving(false); }
  };

  return (
    <div className="flex flex-col flex-1 overflow-hidden">
      <TopBar title="Resellers" subtitle="Distributors, agents and brokers" onRefresh={load}
        actions={<BtnPrimary onClick={openModal}><Plus size={14}/>Add Reseller</BtnPrimary>} />
      <main className="flex-1 overflow-y-auto p-6">
        <DataTable
          columns={[
            { accessorKey:"name", header:"Name / Code", cell:({row:{original:r}})=><div><p className="font-semibold text-gray-900">{r.name}</p><p className="text-[10px] font-mono text-gray-400">{r.seller_code}</p></div> },
            { accessorKey:"type", header:"Type", cell:({row:{original:r}})=><span className="text-xs text-gray-500">{r.type}</span> },
            { id:"commission", header:"Commission", enableSorting:false, cell:()=><span className="font-semibold text-bassani-700">12.5%</span> },
            { id:"contact", header:"Contact", enableSorting:false, cell:({row:{original:r}})=><div><p className="text-gray-700">{r.contact_person||"—"}</p>{r.email&&<p className="text-[10px] text-gray-400">{r.email}</p>}</div> },
            { id:"actions", header:"", enableSorting:false, cell:({row:{original:r}})=><BtnSecondary size="sm" onClick={e=>{e.stopPropagation();openEdit(r);}}><Edit2 size={11}/>Edit</BtnSecondary> },
          ]}
          data={resellers} loading={loading}
        />
      </main>

      {modal && (
        <Modal title="Add Reseller" onClose={()=>setModal(false)} width="max-w-2xl">

          {/* Section 1 — Odoo vendor partner link (optional) */}
          <p className="text-xs font-semibold text-gray-500 mb-2 uppercase tracking-wider">Odoo Vendor Profile <span className="text-gray-300 font-normal normal-case">(optional — used for commission billing)</span></p>
          <div className="relative mb-4">
            {selectedCustomer ? (
              /* Selected state — show chip with clear button */
              <div className="flex items-center gap-3 border border-bassani-300 bg-bassani-50 rounded-xl px-4 py-2.5">
                <span className="w-2 h-2 rounded-full bg-bassani-500 shrink-0"/>
                <div className="flex-1 min-w-0">
                  <p className="text-sm font-semibold text-bassani-800 truncate">{selectedCustomer.name}</p>
                  {selectedCustomer.email && <p className="text-xs text-gray-400 truncate">{selectedCustomer.email}</p>}
                </div>
                <button onClick={clearCustomer}
                  className="text-gray-400 hover:text-red-500 transition-colors text-xl leading-none shrink-0">×</button>
              </div>
            ) : (
              /* Search state — input with chevron */
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

            {/* Dropdown list */}
            {custDropdownOpen && !selectedCustomer && (
              <div className="absolute z-10 w-full bg-white border border-gray-200 rounded-xl shadow-lg mt-1 max-h-56 overflow-y-auto">
                {customerLoading && (
                  <p className="px-4 py-3 text-xs text-gray-400">Loading customers…</p>
                )}
                {!customerLoading && customers.length === 0 && (
                  <p className="px-4 py-3 text-xs text-gray-400">No customers found</p>
                )}
                {customers.map(c=>(
                  <button key={c.id} onMouseDown={()=>selectCustomer(c)}
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

          {/* Section 2 — Business details */}
          <p className="text-xs font-semibold text-gray-500 mb-2 uppercase tracking-wider">Business Details</p>
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-3 mb-4">
            <FormGroup label="Business Name" required><Input value={form.name} onChange={e=>setForm({...form,name:e.target.value})} /></FormGroup>
            <FormGroup label="Type"><Select value={form.type} onChange={e=>setForm({...form,type:e.target.value})}>{["Distributor","Agent","Broker"].map(t=><option key={t}>{t}</option>)}</Select></FormGroup>
            <FormGroup label="Seller Code" required><Input value={form.seller_code} onChange={e=>setForm({...form,seller_code:e.target.value.toUpperCase()})} placeholder="JOE001" /></FormGroup>
            <FormGroup label="Contact Person"><Input value={form.contact_person} onChange={e=>setForm({...form,contact_person:e.target.value})} /></FormGroup>
            <FormGroup label="Email"><Input value={form.email} onChange={e=>setForm({...form,email:e.target.value})} /></FormGroup>
            <FormGroup label="Phone"><Input value={form.phone} onChange={e=>setForm({...form,phone:e.target.value})} /></FormGroup>
          </div>

          {/* Section 3 — Portal login */}
          <p className="text-xs font-semibold text-gray-500 mb-2 uppercase tracking-wider">Portal Login Credentials</p>
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-3 mb-4">
            <FormGroup label="Username" required><Input value={form.username} onChange={e=>setForm({...form,username:e.target.value.toLowerCase().replace(/\s/g,"")})} placeholder="e.g. joe.smith" /></FormGroup>
            <FormGroup label="Password" required><Input type="password" value={form.password} onChange={e=>setForm({...form,password:e.target.value})} placeholder="Min. 8 characters" /></FormGroup>
          </div>

          {/* Section 4 — Registration */}
          <p className="text-xs font-semibold text-gray-500 mb-2 uppercase tracking-wider">Registration</p>
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-3 mb-4">
            <FormGroup label="Company Reg Number">
              <Input value={form.company_reg_number} onChange={e=>setForm({...form,company_reg_number:e.target.value})} placeholder="e.g. 2023/123456/07" />
            </FormGroup>
            <div className="space-y-2">
              <FormGroup label="VAT">
                <label className="flex items-center gap-2 cursor-pointer h-9">
                  <input type="checkbox" checked={form.vat_registered} onChange={e=>setForm({...form,vat_registered:e.target.checked,vat_number:e.target.checked?form.vat_number:""})}
                    className="w-4 h-4 accent-bassani-600" />
                  <span className="text-sm text-gray-700">VAT registered</span>
                </label>
              </FormGroup>
              {form.vat_registered && (
                <FormGroup label="VAT Number"><Input value={form.vat_number} onChange={e=>setForm({...form,vat_number:e.target.value})} placeholder="e.g. 4123456789" /></FormGroup>
              )}
            </div>
          </div>

          {/* Section 5 — Banking */}
          <p className="text-xs font-semibold text-gray-500 mb-2 uppercase tracking-wider">Banking Details <span className="text-gray-300 font-normal normal-case">(for EFT commission payouts)</span></p>
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-3 mb-4">
            <FormGroup label="Bank Name"><Input value={form.bank_name} onChange={e=>setForm({...form,bank_name:e.target.value})} placeholder="e.g. FNB" /></FormGroup>
            <FormGroup label="Account Holder"><Input value={form.bank_account_holder} onChange={e=>setForm({...form,bank_account_holder:e.target.value})} /></FormGroup>
            <FormGroup label="Account Number"><Input value={form.bank_account_number} onChange={e=>setForm({...form,bank_account_number:e.target.value})} /></FormGroup>
            <FormGroup label="Branch Code"><Input value={form.bank_branch_code} onChange={e=>setForm({...form,bank_branch_code:e.target.value})} placeholder="e.g. 250655" /></FormGroup>
          </div>

          <div className="bg-bassani-50 rounded-xl px-4 py-3 mb-4 flex items-center justify-between">
            <span className="text-xs text-gray-600">Commission rate</span>
            <span className="text-sm font-bold text-bassani-700">12.5% (all products)</span>
          </div>

          <div className="flex justify-end gap-2"><BtnSecondary onClick={()=>setModal(false)} disabled={saving}>Cancel</BtnSecondary><BtnPrimary onClick={save} loading={saving}>Create Reseller</BtnPrimary></div>
        </Modal>
      )}

      {editModal && (
        <Modal title="Edit Reseller" onClose={()=>setEditModal(false)} width="max-w-2xl">
          <p className="text-xs font-semibold text-gray-500 mb-2 uppercase tracking-wider">Business Details</p>
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-3 mb-4">
            <FormGroup label="Business Name" required><Input value={editForm.name} onChange={e=>setEditForm({...editForm,name:e.target.value})} /></FormGroup>
            <FormGroup label="Type"><Select value={editForm.type} onChange={e=>setEditForm({...editForm,type:e.target.value})}>{["Distributor","Agent","Broker"].map(t=><option key={t}>{t}</option>)}</Select></FormGroup>
            <FormGroup label="Contact Person"><Input value={editForm.contact_person} onChange={e=>setEditForm({...editForm,contact_person:e.target.value})} /></FormGroup>
            <FormGroup label="Email"><Input value={editForm.email} onChange={e=>setEditForm({...editForm,email:e.target.value})} /></FormGroup>
            <FormGroup label="Phone"><Input value={editForm.phone} onChange={e=>setEditForm({...editForm,phone:e.target.value})} /></FormGroup>
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

          <p className="text-xs font-semibold text-gray-500 mb-2 uppercase tracking-wider">Banking Details <span className="text-gray-300 font-normal normal-case">(for EFT commission payouts)</span></p>
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-3 mb-4">
            <FormGroup label="Bank Name"><Input value={editForm.bank_name} onChange={e=>setEditForm({...editForm,bank_name:e.target.value})} placeholder="e.g. FNB" /></FormGroup>
            <FormGroup label="Account Holder"><Input value={editForm.bank_account_holder} onChange={e=>setEditForm({...editForm,bank_account_holder:e.target.value})} /></FormGroup>
            <FormGroup label="Account Number"><Input value={editForm.bank_account_number} onChange={e=>setEditForm({...editForm,bank_account_number:e.target.value})} /></FormGroup>
            <FormGroup label="Branch Code"><Input value={editForm.bank_branch_code} onChange={e=>setEditForm({...editForm,bank_branch_code:e.target.value})} placeholder="e.g. 250655" /></FormGroup>
          </div>

          <div className="flex justify-end gap-2"><BtnSecondary onClick={()=>setEditModal(false)} disabled={editSaving}>Cancel</BtnSecondary><BtnPrimary onClick={saveEdit} loading={editSaving}>Save Changes</BtnPrimary></div>
        </Modal>
      )}
    </div>
  );
}

// ─────────────────────────────────────────────────────────────────────────────
// Commission matrix view
// ─────────────────────────────────────────────────────────────────────────────
function ResellerCommissionView() {
  const [reseller, setReseller] = useState(null);
  const [history,  setHistory ] = useState([]);
  const [loading,  setLoading ] = useState(true);

  useEffect(() => {
    (async () => {
      try {
        const me = await api.get("/api/auth/me");
        const rid = me.data.reseller_id;
        if (!rid) return;
        const [rRes, hRes] = await Promise.all([
          api.get(`/api/resellers/${rid}`),
          api.get(`/api/commission/${rid}/history`),
        ]);
        setReseller(rRes.data);
        setHistory(hRes.data.records || []);
      } catch { toast.error("Failed to load commission data"); }
      finally { setLoading(false); }
    })();
  }, []);

  if (loading) return <LoadingState />;
  if (!reseller) return <EmptyState message="No commission data found" />;

  return (
    <div className="flex flex-col lg:flex-row gap-4 items-start">
      <div className="bg-white border border-gray-100 rounded-xl overflow-hidden shrink-0 w-full lg:w-64">
        <div className="px-5 py-4 border-b border-gray-50">
          <h3 className="text-sm font-semibold text-gray-800">Your Commission Rate</h3>
          <p className="text-xs text-gray-400 mt-0.5">Applied across all products</p>
        </div>
        <div className="px-5 py-6 flex flex-col items-center gap-1">
          <span className="text-4xl font-bold text-bassani-700">12.5%</span>
          <span className="text-xs text-gray-400 text-center">You can reduce this per order to pass savings to the customer</span>
        </div>
      </div>

      <div className="bg-white border border-gray-100 rounded-xl overflow-hidden flex-1 min-w-0 w-full">
        <div className="px-5 py-4 border-b border-gray-50">
          <h3 className="text-sm font-semibold text-gray-800">Commission History</h3>
          <p className="text-xs text-gray-400 mt-0.5">Commission earned per order</p>
        </div>
        <div className="overflow-x-auto"><table className="w-full text-sm min-w-[420px]">
          <thead>
            <tr className="bg-gray-50">
              {["Order #","Customer","Date","Commission","Status"].map(h=>(
                <th key={h} className="text-left text-[10px] font-semibold text-gray-400 uppercase tracking-wider px-4 py-3">{h}</th>
              ))}
            </tr>
          </thead>
          <tbody>
            {history.length === 0 && (
              <tr><td colSpan={5} className="px-4 py-8 text-center text-gray-400 text-sm">No commission records yet</td></tr>
            )}
            {history.map((rec, i) => (
              <tr key={i} className="border-t border-gray-50 hover:bg-gray-50 transition-colors">
                <td className="px-4 py-3 font-mono text-xs text-bassani-700">{rec.odoo_order_id}</td>
                <td className="px-4 py-3 text-gray-700 text-xs">{rec.customer_name || "—"}</td>
                <td className="px-4 py-3 text-gray-500 text-xs">{fmtDate(rec.created_at)}</td>
                <td className="px-4 py-3 font-semibold text-bassani-700">{fmtR(rec.commission_total || 0)}</td>
                <td className="px-4 py-3">
                  <span className={`text-[10px] px-2 py-0.5 rounded-full font-semibold ${rec.payout_status === "paid" ? "bg-green-50 text-green-700" : "bg-amber-50 text-amber-700"}`}>
                    {rec.payout_status === "paid" ? "Paid" : "Pending"}
                  </span>
                </td>
              </tr>
            ))}
          </tbody>
        </table></div>
      </div>
    </div>
  );
}

// ─────────────────────────────────────────────────────────────────────────────
// Payouts view (admin only)
// ─────────────────────────────────────────────────────────────────────────────
function PayoutsView() {
  const [payouts,    setPayouts   ] = useState([]);
  const [grandTotal, setGrandTotal] = useState(0);
  const [loading,    setLoading   ] = useState(true);
  const [expanded,   setExpanded  ] = useState(null);   // reseller_id
  const [orderCache, setOrderCache] = useState({});     // reseller_id → orders[]
  const [payModal,   setPayModal  ] = useState(null);   // payout row being paid
  const [payRef,     setPayRef    ] = useState("");
  const [payDate,    setPayDate   ] = useState("");
  const [paying,     setPaying    ] = useState(false);

  const load = async () => {
    setLoading(true);
    try {
      const r = await api.get("/api/commission/payouts");
      setPayouts(r.data.resellers);
      setGrandTotal(r.data.grand_total);
    } catch { toast.error("Failed to load payouts"); }
    finally { setLoading(false); }
  };
  useEffect(() => { load(); }, []);

  const toggleExpand = async (resellerId) => {
    if (expanded === resellerId) { setExpanded(null); return; }
    setExpanded(resellerId);
    if (!orderCache[resellerId]) {
      try {
        const r = await api.get(`/api/commission/payouts/${resellerId}/orders`);
        setOrderCache(prev => ({ ...prev, [resellerId]: r.data.orders }));
      } catch { toast.error("Failed to load orders"); }
    }
  };

  const openPayModal = (payout) => {
    setPayModal(payout);
    setPayRef("");
    setPayDate(new Date().toISOString().split("T")[0]);
  };

  const markPaid = async () => {
    if (!payModal) return;
    setPaying(true);
    try {
      await api.put(`/api/commission/payouts/${payModal.reseller_id}/mark-paid`, {
        payment_reference: payRef,
        payment_date: payDate,
      });
      toast.success(`${payModal.reseller_name} — ${payModal.order_count} order${payModal.order_count !== 1 ? "s" : ""} marked as paid`);
      setPayModal(null);
      setOrderCache(prev => { const n = { ...prev }; delete n[payModal.reseller_id]; return n; });
      load();
    } catch (e) {
      toast.error(e.response?.data?.detail || "Failed to mark as paid");
    } finally { setPaying(false); }
  };

  if (loading) return <LoadingState />;

  return (
    <div className="space-y-4">
      {/* Summary banner */}
      <div className="bg-white border border-gray-100 rounded-xl px-5 py-4 flex items-center justify-between">
        <div>
          <p className="text-sm font-semibold text-gray-800">Pending Commission Payouts</p>
          <p className="text-xs text-gray-400 mt-0.5">
            {payouts.length} reseller{payouts.length !== 1 ? "s" : ""} awaiting payment
          </p>
        </div>
        <div className="text-right">
          <p className="text-2xl font-bold text-bassani-700">{fmtR(grandTotal)}</p>
          <p className="text-[10px] text-gray-400 mt-0.5">total outstanding</p>
        </div>
      </div>

      {payouts.length === 0 && (
        <div className="bg-white border border-gray-100 rounded-xl px-5 py-14 text-center">
          <p className="text-sm font-medium text-gray-400">No pending payouts</p>
          <p className="text-xs text-gray-300 mt-1">All commission payments are up to date</p>
        </div>
      )}

      {/* Per-reseller cards */}
      {payouts.map(p => (
        <div key={p.reseller_id} className="bg-white border border-gray-100 rounded-xl overflow-hidden">
          {/* Header row */}
          <div className="px-5 py-4 flex flex-wrap items-start gap-4">
            <div className="flex-1 min-w-0 space-y-1">
              <div className="flex items-center gap-2">
                <p className="font-semibold text-gray-900">{p.reseller_name}</p>
                <span className="text-[10px] bg-purple-50 text-purple-700 px-1.5 py-0.5 rounded-full font-semibold shrink-0">
                  {p.reseller_id.replace("reseller_", "").toUpperCase()}
                </span>
              </div>
              <p className="text-xs text-gray-400">
                {p.order_count} order{p.order_count !== 1 ? "s" : ""} · oldest {fmtDate(p.oldest_order)}
              </p>
              {p.bank_account_number ? (
                <p className="text-xs text-gray-500">
                  {p.bank_name && <span className="font-medium">{p.bank_name} · </span>}
                  {p.bank_account_holder && <span>{p.bank_account_holder} · </span>}
                  <span className="font-mono">{p.bank_account_number}</span>
                  {p.bank_branch_code && <span className="text-gray-400"> ({p.bank_branch_code})</span>}
                </p>
              ) : (
                <p className="text-xs text-amber-600 font-medium">⚠ No banking details on file</p>
              )}
            </div>
            <div className="flex items-center gap-3 shrink-0">
              <div className="text-right">
                <p className="text-xl font-bold text-bassani-700">{fmtR(p.total_pending)}</p>
                <p className="text-[10px] text-gray-400">pending</p>
              </div>
              <button onClick={() => toggleExpand(p.reseller_id)}
                className="text-xs px-3 py-1.5 rounded-lg border border-gray-200 text-gray-600 hover:bg-gray-50 font-medium transition-colors">
                {expanded === p.reseller_id ? "Hide" : "View Orders"}
              </button>
              <BtnPrimary size="sm" onClick={() => openPayModal(p)}>Mark as Paid</BtnPrimary>
            </div>
          </div>

          {/* Expanded order detail */}
          {expanded === p.reseller_id && (
            <div className="border-t border-gray-50">
              {!orderCache[p.reseller_id] ? (
                <p className="px-5 py-4 text-xs text-gray-400">Loading…</p>
              ) : (
                <table className="w-full text-sm">
                  <thead>
                    <tr className="bg-gray-50">
                      {["Order #", "Customer", "Date", "Order Value", "Commission", "Odoo Bill"].map(h => (
                        <th key={h} className="text-left text-[10px] font-semibold text-gray-400 uppercase tracking-wider px-4 py-2.5">{h}</th>
                      ))}
                    </tr>
                  </thead>
                  <tbody>
                    {orderCache[p.reseller_id].map(o => (
                      <tr key={o.odoo_order_id} className="border-t border-gray-50 hover:bg-gray-50 transition-colors">
                        <td className="px-4 py-2.5 font-mono text-xs text-bassani-700">#{o.odoo_order_id}</td>
                        <td className="px-4 py-2.5 text-gray-700 text-xs">{o.customer_name || "—"}</td>
                        <td className="px-4 py-2.5 text-gray-400 text-xs">{fmtDate(o.created_at)}</td>
                        <td className="px-4 py-2.5 text-gray-700">{fmtR(o.original_subtotal || 0)}</td>
                        <td className="px-4 py-2.5 font-semibold text-bassani-700">{fmtR(o.commission_total)}</td>
                        <td className="px-4 py-2.5 text-xs text-gray-400 font-mono">
                          {o.odoo_bill_id ? `#${o.odoo_bill_id}` : "—"}
                        </td>
                      </tr>
                    ))}
                    <tr className="border-t-2 border-bassani-100 bg-bassani-50/40">
                      <td colSpan={4} className="px-4 py-2.5 text-xs font-semibold text-gray-600 text-right">Total</td>
                      <td className="px-4 py-2.5 font-bold text-bassani-700">
                        {fmtR(orderCache[p.reseller_id].reduce((s, o) => s + o.commission_total, 0))}
                      </td>
                      <td />
                    </tr>
                  </tbody>
                </table>
              )}
            </div>
          )}
        </div>
      ))}

      {/* Mark as Paid modal */}
      {payModal && (
        <Modal title={`Mark as Paid — ${payModal.reseller_name}`} onClose={() => setPayModal(null)}>
          <p className="text-sm text-gray-600 mb-5">
            This will mark <b>{payModal.order_count} order{payModal.order_count !== 1 ? "s" : ""}</b> as paid,
            totalling <b className="text-bassani-700">{fmtR(payModal.total_pending)}</b>.
          </p>
          {payModal.bank_account_number && (
            <div className="bg-gray-50 border border-gray-100 rounded-xl px-4 py-3 mb-5 space-y-0.5">
              <p className="text-[10px] font-semibold text-gray-400 uppercase tracking-wider mb-1">Banking Details</p>
              <p className="text-sm font-medium text-gray-800">{payModal.bank_account_holder}</p>
              <p className="text-xs text-gray-500">{payModal.bank_name}</p>
              <p className="text-sm font-mono text-gray-800">
                {payModal.bank_account_number}
                {payModal.bank_branch_code && <span className="text-gray-400 font-sans"> · {payModal.bank_branch_code}</span>}
              </p>
            </div>
          )}
          <div className="space-y-3 mb-6">
            <FormGroup label="Payment Reference">
              <Input value={payRef} onChange={e => setPayRef(e.target.value)} placeholder="e.g. EFT ref 20250610-JOE" autoFocus />
            </FormGroup>
            <FormGroup label="Payment Date">
              <Input type="date" value={payDate} onChange={e => setPayDate(e.target.value)} />
            </FormGroup>
          </div>
          <div className="flex justify-end gap-2">
            <BtnSecondary onClick={() => setPayModal(null)}>Cancel</BtnSecondary>
            <BtnPrimary onClick={markPaid} disabled={paying}>{paying ? "Saving…" : "Confirm Payment"}</BtnPrimary>
          </div>
        </Modal>
      )}
    </div>
  );
}

export function Commission() {
  const { user } = useAuth();
  const isReseller = user?.role === "reseller";

  const [activeTab,  setActiveTab ] = useState("blocks");
  const [resellers,  setResellers ] = useState([]);
  const [selected,   setSelected  ] = useState(null);
  const [matrix,     setMatrix    ] = useState([]);
  const [summary,    setSummary   ] = useState(null);
  const [loading,    setLoading   ] = useState(false);
  const [toggling,   setToggling  ] = useState(new Set());
  const [search,     setSearch    ] = useState("");
  const [cat,        setCat       ] = useState("all");
  const [categories, setCategories] = useState([]);

  useEffect(() => {
    if (isReseller) return;
    api.get("/api/products/categories")
      .then(r => setCategories(r.data.categories || []))
      .catch(() => {});
  }, [isReseller]);

  const loadResellers = async () => {
    if (isReseller) return;
    try { const r = await api.get("/api/resellers/"); setResellers(r.data.resellers); if (r.data.resellers.length) setSelected(r.data.resellers[0].id); }
    catch { toast.error("Failed to load resellers"); }
  };
  useEffect(() => { loadResellers(); }, []); // eslint-disable-line

  const loadMatrix = useCallback(async () => {
    if (!selected || isReseller) return;
    setLoading(true);
    try {
      const r = await api.get(`/api/commission/${selected}/matrix`, { params:{ search:search||undefined, category:cat==="all"?undefined:cat } });
      setMatrix(r.data.matrix); setSummary(r.data.summary);
    } catch { toast.error("Failed to load matrix"); }
    finally { setLoading(false); }
  }, [selected, search, cat, isReseller]);

  useEffect(() => { loadMatrix(); }, [loadMatrix]);

  const toggleBlock = async (productId, currentlyBlocked) => {
    setToggling(s => new Set(s).add(productId));
    const endpoint = currentlyBlocked ? "unblock" : "block";
    try {
      await api.put(`/api/commission/${selected}/matrix/${productId}/${endpoint}`);
      toast.success(currentlyBlocked ? "Product unblocked — 12.5% restored" : "Product blocked — 0% commission");
      loadMatrix();
    } catch { toast.error("Failed"); }
    finally { setToggling(s => { const n = new Set(s); n.delete(productId); return n; }); }
  };

  if (isReseller) return (
    <div className="flex flex-col flex-1 overflow-hidden">
      <TopBar title="My Commission" subtitle="Your earnings history" />
      <main className="flex-1 overflow-y-auto p-6 space-y-4">
        <ResellerCommissionView />
      </main>
    </div>
  );

  return (
    <div className="flex flex-col flex-1 overflow-hidden">
      <TopBar
        title="Commission"
        subtitle={activeTab === "blocks" ? "Block products per reseller — all active products earn 12.5%" : "Pending EFT payouts to resellers"}
        onRefresh={activeTab === "blocks" ? loadMatrix : undefined}
      />
      <main className="flex-1 overflow-y-auto p-6 space-y-4">
        {/* Tab navigation */}
        <ChipRow>
          <FilterPill label="Product Blocks" active={activeTab === "blocks"} onClick={() => setActiveTab("blocks")} />
          <FilterPill label="Payouts" active={activeTab === "payouts"} onClick={() => setActiveTab("payouts")} />
        </ChipRow>

        {/* ── Product Blocks tab ── */}
        {activeTab === "blocks" && (<>
          <div className="bg-white border border-gray-100 rounded-xl px-5 py-4 flex flex-wrap items-center gap-4">
            <div className="flex items-center gap-2">
              <span className="text-xs text-gray-400 font-medium shrink-0">Reseller:</span>
              <select value={selected||""} onChange={e=>setSelected(e.target.value)}
                className="border border-gray-200 rounded-lg px-3 py-1.5 text-sm text-gray-700 focus:outline-none focus:border-bassani-600 bg-white min-w-[200px]">
                {resellers.map(r=><option key={r.id} value={r.id}>{r.name}{r.seller_code?" · "+r.seller_code:""}</option>)}
              </select>
            </div>
            {summary && (
              <div className="ml-auto flex gap-4 text-xs text-gray-500">
                <span>Active: <b className="text-green-700">{summary.active_products}</b></span>
                <span>Blocked: <b className="text-red-600">{summary.blocked_products}</b></span>
                <span>Default rate: <b className="text-bassani-700">{summary.default_rate}%</b></span>
              </div>
            )}
          </div>
          <div className="space-y-2">
            <SearchBar value={search} onChange={setSearch} placeholder="Search products…" />
            <ChipRow>
              {["all",...categories.map(c=>c.name)].map(c=><FilterPill key={c} label={c==="all"?"All":c} active={cat===c} onClick={()=>setCat(c)} />)}
            </ChipRow>
          </div>
          <DataTable
            columns={[
              { accessorKey:"product_name", header:"Product / SKU", cell:({row:{original:m}})=>
                  <div className={m.is_blocked?"opacity-50":""}>
                    <p className={`font-medium ${m.is_blocked?"line-through text-gray-400":"text-gray-900"}`}>{m.product_name}</p>
                    <p className="font-mono text-[10px] text-gray-400">{m.product_sku}</p>
                  </div> },
              { accessorKey:"category", header:"Category", cell:({row:{original:m}})=><span className="text-xs text-gray-500">{m.category}</span> },
              { accessorKey:"list_price", header:"List Price", cell:({row:{original:m}})=><span className="text-sm">{fmtR(m.list_price)}</span> },
              { id:"commission", header:"Commission", enableSorting:false, cell:({row:{original:m}})=>
                  m.is_blocked
                    ? <span className="text-[10px] px-2 py-0.5 rounded-full font-semibold bg-red-50 text-red-600">Blocked — 0%</span>
                    : <span className="text-[10px] px-2 py-0.5 rounded-full font-semibold bg-green-50 text-green-700">Active — 12.5%</span> },
              { id:"block", header:"", enableSorting:false, cell:({row:{original:m}})=> {
                  const busy = toggling.has(m.product_id);
                  return (
                    <button onClick={()=>!busy && toggleBlock(m.product_id, m.is_blocked)} disabled={busy}
                      className={`text-xs px-3 py-1.5 rounded-lg border font-medium transition-all flex items-center gap-1.5 disabled:opacity-50 disabled:cursor-not-allowed ${m.is_blocked?"border-bassani-300 text-bassani-700 hover:bg-bassani-50":"border-red-200 text-red-600 hover:bg-red-50"}`}>
                      {busy && <Loader2 size={10} className="animate-spin" />}
                      {busy ? (m.is_blocked ? "Unblocking…" : "Blocking…") : (m.is_blocked ? "Unblock" : "Block")}
                    </button>
                  );
                } },
            ]}
            data={matrix} loading={loading} defaultPageSize={50}
          />
        </>)}

        {/* ── Payouts tab ── */}
        {activeTab === "payouts" && <PayoutsView />}
      </main>
    </div>
  );
}

// ─────────────────────────────────────────────────────────────────────────────
// Reports view
// ─────────────────────────────────────────────────────────────────────────────
export function Reports() {
  const [activeReport, setActiveReport] = useState("turnover");
  const [data,   setData  ] = useState(null);
  const [loading,setLoading] = useState(false);

  const REPORTS = [
    { key:"turnover",     label:"Monthly Turnover" },
    { key:"best-sellers", label:"Best Sellers"     },
    { key:"best-customers",label:"Best Customers"  },
    { key:"dead-stock",   label:"Dead Stock"       },
    { key:"category-performance", label:"Category Performance" },
  ];

  const load = async (key) => {
    setLoading(true);
    try { const r = await api.get(`/api/reports/${key}`); setData(r.data); }
    catch { toast.error("Failed to load report"); }
    finally { setLoading(false); }
  };

  useEffect(() => { load(activeReport); }, [activeReport]);

  return (
    <div className="flex flex-col flex-1 overflow-hidden">
      <TopBar title="Reports & Analytics" subtitle="Live data from Odoo" onRefresh={()=>load(activeReport)} />
      <main className="flex-1 overflow-y-auto p-4 sm:p-6 flex flex-col sm:flex-row gap-4 sm:gap-5">
        {/* Report nav */}
        <div className="sm:w-44 sm:flex-shrink-0">
          <p className="text-[10px] font-bold text-gray-400 uppercase tracking-wider mb-2 sm:mb-3">Reports</p>
          <div className="flex sm:flex-col gap-1 overflow-x-auto no-scrollbar pb-1 sm:pb-0">
            {REPORTS.map(r=>(
              <button key={r.key} onClick={()=>{ setActiveReport(r.key); setData(null); }}
                className={`w-full text-left text-xs px-3 py-2.5 rounded-lg transition-all border font-medium ${activeReport===r.key?"border-bassani-600 text-bassani-700 bg-bassani-50":"border-transparent text-gray-500 hover:bg-gray-100"}`}>
                {r.label}
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
  if (type === "turnover") return (
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
                <Select value={s.status} onChange={e=>updateStatus(s.id,e.target.value)} onClick={e=>e.stopPropagation()} style={{fontSize:"11px",padding:"3px 8px",width:"auto"}}>
                  {["pending","contacted","approved","declined"].map(st=><option key={st}>{st}</option>)}
                </Select>
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
              {detail.status==="pending"&&<BtnPrimary size="sm" onClick={()=>updateStatus(detail.id,"approved")}>Approve</BtnPrimary>}
              {(detail.status==="pending"||detail.status==="approved")&&<BtnSecondary size="sm" onClick={()=>updateStatus(detail.id,"contacted")}>Mark Contacted</BtnSecondary>}
              <a href={`mailto:${detail.email}`}><BtnSecondary size="sm">Send Email</BtnSecondary></a>
            </div>
            <BtnSecondary onClick={()=>setDetail(null)}>Close</BtnSecondary>
          </div>
        </Modal>
      )}
    </div>
  );
}
