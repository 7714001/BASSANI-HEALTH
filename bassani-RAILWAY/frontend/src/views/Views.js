// ─────────────────────────────────────────────────────────────────────────────
// Products view
// ─────────────────────────────────────────────────────────────────────────────
import { useState, useEffect, useCallback } from "react";
import api from "../api";
import toast from "react-hot-toast";
import { Plus, Edit2, Archive } from "lucide-react";
import {
  TopBar, Table, Tr, Td, Modal, FormGroup, Input, Select, Textarea,
  BtnPrimary, BtnSecondary, BtnDanger, SearchBar, FilterPill,
  LoadingState, EmptyState, Badge, fmtR,
} from "../components/UI";

const CATEGORIES = ["Flower","Tinctures","Vapes","Edibles","Topicals","Accessories"];

export function Products() {
  const [products, setProducts] = useState([]);
  const [total,    setTotal   ] = useState(0);
  const [loading,  setLoading ] = useState(true);
  const [search,   setSearch  ] = useState("");
  const [cat,      setCat     ] = useState("all");
  const [modal,    setModal   ] = useState(false);
  const [editing,  setEditing ] = useState(null);
  const [form,     setForm    ] = useState({ name:"", default_code:"", list_price:"", standard_price:"", type:"product", description:"" });

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const params = { limit:50, offset:0 };
      if (search) params.search = search;
      if (cat !== "all") params.category = cat;
      const r = await api.get("/api/products/", { params });
      setProducts(r.data.products); setTotal(r.data.total);
    } catch { toast.error("Failed to load products"); }
    finally { setLoading(false); }
  }, [search, cat]);

  useEffect(() => { load(); }, [load]);

  const stockColor = (qty) => qty <= 0 ? "text-red-600 font-semibold" : qty < 10 ? "text-amber-600 font-semibold" : "text-bassani-700 font-semibold";

  const openNew = () => { setEditing(null); setForm({ name:"", default_code:"", list_price:"", standard_price:"", type:"product", description:"" }); setModal(true); };
  const openEdit = (p) => { setEditing(p); setForm({ name:p.name, default_code:p.default_code||"", list_price:p.list_price, standard_price:p.standard_price, type:p.type, description:p.description||"" }); setModal(true); };

  const save = async () => {
    if (!form.name) return toast.error("Product name required");
    try {
      if (editing) { await api.put(`/api/products/${editing.id}`, form); toast.success("Product updated"); }
      else         { await api.post("/api/products/", form);              toast.success("Product created"); }
      setModal(false); load();
    } catch (e) { toast.error(e.response?.data?.detail || "Save failed"); }
  };

  const archive = async (id) => {
    if (!window.confirm("Archive this product?")) return;
    try { await api.delete(`/api/products/${id}`); toast.success("Product archived"); load(); }
    catch { toast.error("Archive failed"); }
  };

  return (
    <div className="flex flex-col flex-1 overflow-hidden">
      <TopBar title="Products" subtitle={`${total} products synced from Odoo`} onRefresh={load}
        actions={<BtnPrimary onClick={openNew}><Plus size={14} />Add Product</BtnPrimary>} />
      <main className="flex-1 overflow-y-auto p-6">
        <div className="flex items-center gap-2 mb-4 flex-wrap">
          <SearchBar value={search} onChange={setSearch} placeholder="Search products, SKU…" />
          {["all",...CATEGORIES].map(c => <FilterPill key={c} label={c==="all"?"All":c} active={cat===c} onClick={()=>setCat(c)} />)}
        </div>
        <Table headers={["Product / SKU","Category","Sale Price","Cost","On Hand","Forecasted","Actions"]} loading={loading}>
          {products.length === 0 && !loading && <tr><td colSpan={7}><EmptyState /></td></tr>}
          {products.map(p => (
            <Tr key={p.id}>
              <Td><p className="font-medium text-gray-900">{p.name}</p><p className="font-mono text-[10px] text-gray-400">{p.default_code||"—"}</p></Td>
              <Td><span className="text-xs text-gray-500">{p.categ_id?.[1]||"—"}</span></Td>
              <Td className="font-semibold">{fmtR(p.list_price)}</Td>
              <Td className="text-gray-500">{fmtR(p.standard_price)}</Td>
              <Td><span className={stockColor(p.qty_available||0)}>{p.qty_available??0}</span></Td>
              <Td className="text-gray-500">{p.virtual_available??0}</Td>
              <Td>
                <div className="flex gap-1.5">
                  <BtnSecondary size="sm" onClick={()=>openEdit(p)}><Edit2 size={11}/></BtnSecondary>
                  <BtnDanger onClick={()=>archive(p.id)}><Archive size={11}/></BtnDanger>
                </div>
              </Td>
            </Tr>
          ))}
        </Table>
      </main>
      {modal && (
        <Modal title={editing?"Edit Product":"New Product"} onClose={()=>setModal(false)}>
          <div className="grid grid-cols-2 gap-3">
            <FormGroup label="Product Name" required><Input value={form.name} onChange={e=>setForm({...form,name:e.target.value})} placeholder="e.g. Tincture 20ml THC" /></FormGroup>
            <FormGroup label="SKU / Reference"><Input value={form.default_code} onChange={e=>setForm({...form,default_code:e.target.value})} placeholder="THC-TINC-20" /></FormGroup>
            <FormGroup label="Sale Price (ZAR)"><Input type="number" value={form.list_price} onChange={e=>setForm({...form,list_price:e.target.value})} placeholder="450.00" /></FormGroup>
            <FormGroup label="Cost (ZAR)"><Input type="number" value={form.standard_price} onChange={e=>setForm({...form,standard_price:e.target.value})} placeholder="200.00" /></FormGroup>
          </div>
          <FormGroup label="Description"><Textarea value={form.description} onChange={e=>setForm({...form,description:e.target.value})} rows={2} placeholder="Short product description" /></FormGroup>
          <div className="flex justify-end gap-2 mt-4"><BtnSecondary onClick={()=>setModal(false)}>Cancel</BtnSecondary><BtnPrimary onClick={save}>Save Product</BtnPrimary></div>
        </Modal>
      )}
    </div>
  );
}

// ─────────────────────────────────────────────────────────────────────────────
// Customers view
// ─────────────────────────────────────────────────────────────────────────────
export function Customers() {
  const [customers, setCustomers] = useState([]);
  const [total,     setTotal    ] = useState(0);
  const [loading,   setLoading  ] = useState(true);
  const [search,    setSearch   ] = useState("");
  const [modal,     setModal    ] = useState(false);
  const [detail,    setDetail   ] = useState(null);
  const [form,      setForm     ] = useState({ name:"", email:"", phone:"", street:"", city:"", credit_limit:"", customer_type:"Pharmacy", section21_registered:false });

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const r = await api.get("/api/customers/", { params: { limit:50, search: search||undefined } });
      setCustomers(r.data.customers); setTotal(r.data.total);
    } catch { toast.error("Failed to load customers"); }
    finally { setLoading(false); }
  }, [search]);

  useEffect(() => { load(); }, [load]);

  const save = async () => {
    if (!form.name) return toast.error("Name required");
    try {
      await api.post("/api/customers/", form);
      toast.success("Customer created"); setModal(false); load();
    } catch (e) { toast.error(e.response?.data?.detail || "Save failed"); }
  };

  const TYPES = ["Pharmacy","Dispensary","Clinic","Hospital","Retail"];
  const balanceColor = (b, l) => !l ? "text-gray-600" : b/l >= 1 ? "text-red-600" : b/l >= 0.75 ? "text-amber-600" : "text-bassani-700";

  return (
    <div className="flex flex-col flex-1 overflow-hidden">
      <TopBar title="Customers" subtitle={`${total} active accounts`} onRefresh={load}
        actions={<BtnPrimary onClick={()=>setModal(true)}><Plus size={14}/>Add Customer</BtnPrimary>} />
      <main className="flex-1 overflow-y-auto p-6">
        <div className="flex items-center gap-2 mb-4"><SearchBar value={search} onChange={setSearch} placeholder="Search customers, city…" /></div>
        <Table headers={["Customer","Type","Contact","City","Section 21","Balance","Terms","Actions"]} loading={loading}>
          {customers.length===0&&!loading&&<tr><td colSpan={8}><EmptyState /></td></tr>}
          {customers.map(c=>(
            <Tr key={c.id} onClick={()=>setDetail(c)}>
              <Td><p className="font-medium">{c.name}</p></Td>
              <Td><Badge status={c.comment?.match(/Type: (\w+)/)?.[1]?.toLowerCase()||"pharmacy"} label={c.comment?.match(/Type: (\w+)/)?.[1]||"—"} /></Td>
              <Td className="text-xs text-gray-500">{c.email||"—"}</Td>
              <Td className="text-gray-500 text-sm">{c.city||"—"}</Td>
              <Td>{c.comment?.includes("Section 21: Registered")?<span className="text-xs text-bassani-700 font-medium">✓ Registered</span>:<span className="text-xs text-gray-400">—</span>}</Td>
              <Td><span className={balanceColor(0, c.credit_limit)}>{fmtR(c.credit_limit)}</span></Td>
              <Td className="text-xs text-gray-500">{c.property_payment_term_id?.[1]||"—"}</Td>
              <Td onClick={e=>e.stopPropagation()}><BtnSecondary size="sm" onClick={()=>setDetail(c)}>View</BtnSecondary></Td>
            </Tr>
          ))}
        </Table>
      </main>
      {modal && (
        <Modal title="Add Customer" onClose={()=>setModal(false)}>
          <div className="grid grid-cols-2 gap-3">
            <FormGroup label="Business Name" required><Input value={form.name} onChange={e=>setForm({...form,name:e.target.value})} placeholder="Wellness Pharmacy" /></FormGroup>
            <FormGroup label="Type"><Select value={form.customer_type} onChange={e=>setForm({...form,customer_type:e.target.value})}>{TYPES.map(t=><option key={t}>{t}</option>)}</Select></FormGroup>
            <FormGroup label="Email"><Input value={form.email} onChange={e=>setForm({...form,email:e.target.value})} placeholder="orders@example.co.za" /></FormGroup>
            <FormGroup label="Phone"><Input value={form.phone} onChange={e=>setForm({...form,phone:e.target.value})} placeholder="+27 11 555 1234" /></FormGroup>
            <FormGroup label="City"><Input value={form.city} onChange={e=>setForm({...form,city:e.target.value})} placeholder="Johannesburg" /></FormGroup>
            <FormGroup label="Credit Limit (ZAR)"><Input type="number" value={form.credit_limit} onChange={e=>setForm({...form,credit_limit:e.target.value})} placeholder="50000" /></FormGroup>
          </div>
          <FormGroup label="Address"><Input value={form.street} onChange={e=>setForm({...form,street:e.target.value})} placeholder="123 Health Street, Sandton" /></FormGroup>
          <div className="flex items-center gap-2 mb-4"><input type="checkbox" id="s21" checked={form.section21_registered} onChange={e=>setForm({...form,section21_registered:e.target.checked})} className="accent-bassani-600" /><label htmlFor="s21" className="text-sm text-gray-600">Section 21 registered</label></div>
          <div className="flex justify-end gap-2"><BtnSecondary onClick={()=>setModal(false)}>Cancel</BtnSecondary><BtnPrimary onClick={save}>Save Customer</BtnPrimary></div>
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
  const [orders,  setOrders ] = useState([]);
  const [total,   setTotal  ] = useState(0);
  const [loading, setLoading] = useState(true);
  const [search,  setSearch ] = useState("");
  const [status,  setStatus ] = useState("all");
  const [detail,  setDetail ] = useState(null);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const r = await api.get("/api/orders/", { params: { limit:20, search:search||undefined, status:status==="all"?undefined:status } });
      setOrders(r.data.orders); setTotal(r.data.total);
    } catch { toast.error("Failed to load orders"); }
    finally { setLoading(false); }
  }, [search, status]);

  useEffect(() => { load(); }, [load]);

  const confirm = async (id) => {
    try { await api.put(`/api/orders/${id}/confirm`); toast.success("Order confirmed"); load(); }
    catch (e) { toast.error(e.response?.data?.detail||"Failed"); }
  };

  const STATUSES = ["all","draft","sale","done","cancel"];

  return (
    <div className="flex flex-col flex-1 overflow-hidden">
      <TopBar title="Orders" subtitle={`${total} orders`} onRefresh={load} />
      <main className="flex-1 overflow-y-auto p-6">
        <div className="flex items-center gap-2 mb-4 flex-wrap">
          <SearchBar value={search} onChange={setSearch} placeholder="Search order, customer…" />
          {STATUSES.map(s=><FilterPill key={s} label={s==="all"?"All":s==="sale"?"Confirmed":s==="draft"?"Quotation":s.charAt(0).toUpperCase()+s.slice(1)} active={status===s} onClick={()=>setStatus(s)} />)}
        </div>
        <Table headers={["Order #","Customer","Date","Amount","VAT","Total","Commission","Status","Payment","Actions"]} loading={loading}>
          {orders.length===0&&!loading&&<tr><td colSpan={10}><EmptyState /></td></tr>}
          {orders.map(o=>(
            <Tr key={o.id} onClick={()=>setDetail(o)}>
              <Td><span className="font-mono text-xs text-bassani-700">{o.name}</span></Td>
              <Td><p className="font-medium text-sm">{o.partner_id?.[1]||"—"}</p>{o.reseller_name&&<span className="text-[10px] bg-purple-50 text-purple-700 px-1.5 py-0.5 rounded-full">{o.reseller_name}</span>}</Td>
              <Td className="text-xs text-gray-500">{o.date_order?.split("T")[0]}</Td>
              <Td>{fmtR(o.amount_untaxed)}</Td>
              <Td className="text-gray-500">{fmtR(o.amount_tax)}</Td>
              <Td className="font-semibold">{fmtR(o.amount_total)}</Td>
              <Td className={o.commission_total>0?"text-bassani-700 font-medium":"text-gray-300"}>{o.commission_total>0?fmtR(o.commission_total):"—"}</Td>
              <Td><Badge status={o.state} /></Td>
              <Td><Badge status={o.invoice_status} /></Td>
              <Td onClick={e=>e.stopPropagation()}>
                {o.state==="draft"&&<BtnPrimary size="sm" onClick={()=>confirm(o.id)}>Confirm</BtnPrimary>}
              </Td>
            </Tr>
          ))}
        </Table>
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
              {detail.state==="draft"&&<BtnPrimary onClick={()=>{confirm(detail.id);setDetail(null);}}>Confirm Order</BtnPrimary>}
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
  const [resellers, setResellers] = useState([]);
  const [loading,   setLoading  ] = useState(true);
  const [modal,     setModal    ] = useState(false);
  const [form,      setForm     ] = useState({ name:"", type:"Distributor", seller_code:"", contact_person:"", email:"", phone:"", commission_rates:{ Flower:10,Tinctures:10,Vapes:10,Edibles:10,Topicals:10,Accessories:10 } });

  const load = async () => {
    setLoading(true);
    try { const r = await api.get("/api/resellers/"); setResellers(r.data.resellers); }
    catch { toast.error("Failed to load resellers"); }
    finally { setLoading(false); }
  };
  useEffect(() => { load(); }, []);

  const save = async () => {
    if (!form.name || !form.seller_code) return toast.error("Name and seller code required");
    try { await api.post("/api/resellers/", form); toast.success("Reseller created"); setModal(false); load(); }
    catch (e) { toast.error(e.response?.data?.detail||"Save failed"); }
  };

  const initials = (name) => name.split(" ").map(w=>w[0]).join("").slice(0,2).toUpperCase();

  return (
    <div className="flex flex-col flex-1 overflow-hidden">
      <TopBar title="Resellers" subtitle="Distributors, agents and brokers" onRefresh={load}
        actions={<BtnPrimary onClick={()=>setModal(true)}><Plus size={14}/>Add Reseller</BtnPrimary>} />
      <main className="flex-1 overflow-y-auto p-6">
        {loading && <LoadingState />}
        <div className="grid grid-cols-2 gap-4">
          {resellers.map(r=>(
            <div key={r.id} className="bg-white border border-gray-100 rounded-xl p-5">
              <div className="flex items-center gap-3 mb-4">
                <div className="w-10 h-10 rounded-full bg-bassani-50 flex items-center justify-center text-bassani-700 font-semibold text-sm">{initials(r.name)}</div>
                <div>
                  <p className="font-semibold text-gray-900">{r.name}</p>
                  <p className="text-xs text-gray-400 font-mono">{r.seller_code} · {r.type}</p>
                </div>
              </div>
              <div className="space-y-1.5 text-sm mb-4">
                {[["Total Sales",fmtR(r.total_sales)],["Commission Earned",fmtR(r.total_commission)],["Contact",r.contact_person||"—"]].map(([l,v])=>(
                  <div key={l} className="flex justify-between"><span className="text-gray-500">{l}</span><span className={l==="Commission Earned"?"font-semibold text-bassani-700":"font-medium"}>{v}</span></div>
                ))}
              </div>
              <div>
                <p className="text-[10px] text-gray-400 uppercase font-semibold tracking-wider mb-2">Category Rates</p>
                <div className="grid grid-cols-3 gap-1.5">
                  {Object.entries(r.commission_rates||{}).map(([cat,rate])=>(
                    <div key={cat} className="bg-gray-50 rounded-lg px-2 py-1.5">
                      <p className="text-[10px] text-gray-400">{cat}</p>
                      <p className="text-sm font-semibold text-bassani-700">{rate}%</p>
                    </div>
                  ))}
                </div>
              </div>
            </div>
          ))}
        </div>
      </main>
      {modal && (
        <Modal title="Add Reseller" onClose={()=>setModal(false)} width="max-w-xl">
          <div className="grid grid-cols-2 gap-3">
            <FormGroup label="Business Name" required><Input value={form.name} onChange={e=>setForm({...form,name:e.target.value})} /></FormGroup>
            <FormGroup label="Type"><Select value={form.type} onChange={e=>setForm({...form,type:e.target.value})}>{["Distributor","Agent","Broker"].map(t=><option key={t}>{t}</option>)}</Select></FormGroup>
            <FormGroup label="Seller Code" required><Input value={form.seller_code} onChange={e=>setForm({...form,seller_code:e.target.value.toUpperCase()})} placeholder="JOE001" /></FormGroup>
            <FormGroup label="Contact Person"><Input value={form.contact_person} onChange={e=>setForm({...form,contact_person:e.target.value})} /></FormGroup>
            <FormGroup label="Email"><Input value={form.email} onChange={e=>setForm({...form,email:e.target.value})} /></FormGroup>
            <FormGroup label="Phone"><Input value={form.phone} onChange={e=>setForm({...form,phone:e.target.value})} /></FormGroup>
          </div>
          <p className="text-xs font-semibold text-gray-500 mb-3 mt-1 uppercase tracking-wider">Default Commission Rates (%)</p>
          <div className="grid grid-cols-3 gap-3">
            {Object.keys(form.commission_rates).map(cat=>(
              <FormGroup key={cat} label={cat}><Input type="number" min={10} max={50} value={form.commission_rates[cat]} onChange={e=>setForm({...form,commission_rates:{...form.commission_rates,[cat]:parseFloat(e.target.value)||10}})} /></FormGroup>
            ))}
          </div>
          <div className="flex justify-end gap-2 mt-2"><BtnSecondary onClick={()=>setModal(false)}>Cancel</BtnSecondary><BtnPrimary onClick={save}>Save Reseller</BtnPrimary></div>
        </Modal>
      )}
    </div>
  );
}

// ─────────────────────────────────────────────────────────────────────────────
// Commission matrix view
// ─────────────────────────────────────────────────────────────────────────────
export function Commission() {
  const [resellers,  setResellers ] = useState([]);
  const [selected,   setSelected  ] = useState(null);
  const [matrix,     setMatrix    ] = useState([]);
  const [summary,    setSummary   ] = useState(null);
  const [loading,    setLoading   ] = useState(false);
  const [search,     setSearch    ] = useState("");
  const [cat,        setCat       ] = useState("all");

  const loadResellers = async () => {
    try { const r = await api.get("/api/resellers/"); setResellers(r.data.resellers); if (r.data.resellers.length) setSelected(r.data.resellers[0].id); }
    catch { toast.error("Failed to load resellers"); }
  };
  useEffect(() => { loadResellers(); }, []);

  const loadMatrix = useCallback(async () => {
    if (!selected) return;
    setLoading(true);
    try {
      const r = await api.get(`/api/commission/${selected}/matrix`, { params:{ search:search||undefined, category:cat==="all"?undefined:cat } });
      setMatrix(r.data.matrix); setSummary(r.data.summary);
    } catch { toast.error("Failed to load matrix"); }
    finally { setLoading(false); }
  }, [selected, search, cat]);

  useEffect(() => { loadMatrix(); }, [loadMatrix]);

  const updateRate = async (productId, rate) => {
    try { await api.put(`/api/commission/${selected}/matrix/${productId}`, { commission_rate: parseFloat(rate) }); toast.success("Rate saved"); loadMatrix(); }
    catch (e) { toast.error(e.response?.data?.detail||"Save failed"); }
  };

  const toggleBlock = async (productId, currentlyBlocked) => {
    const endpoint = currentlyBlocked ? "unblock" : "block";
    try { await api.put(`/api/commission/${selected}/matrix/${productId}/${endpoint}`); toast.success(currentlyBlocked?"Unblocked":"Blocked"); loadMatrix(); }
    catch { toast.error("Failed"); }
  };

  const sourceStyle = { custom:"bg-bassani-50 text-bassani-700", category_default:"bg-gray-100 text-gray-500", blocked:"bg-red-50 text-red-600", reseller_default:"bg-gray-100 text-gray-500", system_default:"bg-gray-100 text-gray-400" };

  const CATS = ["all","Flower","Tinctures","Vapes","Edibles","Topicals","Accessories"];

  return (
    <div className="flex flex-col flex-1 overflow-hidden">
      <TopBar title="Commission Matrix" subtitle="Per-product rates per reseller · 10%–50% range" onRefresh={loadMatrix} />
      <main className="flex-1 overflow-y-auto p-6 space-y-4">
        {/* Reseller tabs */}
        <div className="bg-white border border-gray-100 rounded-xl px-5 py-4 flex items-center gap-4 flex-wrap">
          <span className="text-xs text-gray-400 font-medium">Reseller:</span>
          {resellers.map(r=>(
            <button key={r.id} onClick={()=>setSelected(r.id)}
              className={`px-3 py-1.5 rounded-lg text-xs font-medium transition-all border ${selected===r.id?"bg-bassani-600 text-white border-bassani-600":"bg-white text-gray-500 border-gray-200 hover:border-bassani-600"}`}>
              {r.name.split(" ")[0]} <span className="opacity-60 font-mono">{r.seller_code}</span>
            </button>
          ))}
          {summary && (
            <div className="ml-auto flex gap-4 text-xs text-gray-500">
              <span>Custom: <b className="text-bassani-700">{summary.custom_rates}</b></span>
              <span>Blocked: <b className="text-red-600">{summary.blocked_products}</b></span>
              <span>Avg rate: <b>{summary.avg_effective_rate}%</b></span>
            </div>
          )}
        </div>

        {/* Filters */}
        <div className="flex items-center gap-2 flex-wrap">
          <SearchBar value={search} onChange={setSearch} placeholder="Search products…" />
          {CATS.map(c=><FilterPill key={c} label={c==="all"?"All":c} active={cat===c} onClick={()=>setCat(c)} />)}
        </div>

        {/* Matrix table */}
        <div className="bg-white border border-gray-100 rounded-xl overflow-hidden">
          <table className="w-full border-collapse text-sm">
            <thead>
              <tr className="bg-gray-50">
                {["Product / SKU","Category","Commission Rate","Source","Effective Rate","Block/Unblock"].map(h=>(
                  <th key={h} className="text-left text-[10px] font-semibold text-gray-400 uppercase tracking-wider px-4 py-3 border-b border-gray-100">{h}</th>
                ))}
              </tr>
            </thead>
            <tbody>
              {loading && <tr><td colSpan={6} className="py-12 text-center"><LoadingState /></td></tr>}
              {!loading && matrix.map(m=>(
                <tr key={m.product_id} className={`border-b border-gray-50 hover:bg-gray-50 transition-colors ${m.is_blocked?"opacity-60":""}`}>
                  <Td><p className={`font-medium ${m.is_blocked?"line-through text-gray-400":"text-gray-900"}`}>{m.product_name}</p><p className="font-mono text-[10px] text-gray-400">{m.product_sku}</p></Td>
                  <Td><span className="text-xs text-gray-500">{m.category}</span></Td>
                  <Td>
                    {!m.is_blocked ? (
                      <div className="flex items-center gap-1.5">
                        <input type="number" min={10} max={50} step={0.5} defaultValue={m.commission_rate}
                          className={`w-16 text-center border rounded-lg px-2 py-1 text-xs font-semibold focus:outline-none focus:border-bassani-600 ${m.is_custom?"border-bassani-300 bg-bassani-50 text-bassani-700":"border-gray-200 bg-gray-50 text-gray-600"}`}
                          onBlur={e=>{ if(parseFloat(e.target.value)!==m.commission_rate) updateRate(m.product_id, e.target.value); }} />
                        <span className="text-xs text-gray-400">%</span>
                      </div>
                    ) : <span className="text-xs text-red-400">Blocked</span>}
                  </Td>
                  <Td><span className={`text-[10px] px-2 py-0.5 rounded-full font-semibold ${sourceStyle[m.source]||"bg-gray-100 text-gray-500"}`}>{m.source.replace(/_/g," ")}</span></Td>
                  <Td><span className={`font-semibold text-sm ${m.is_blocked?"text-red-500":m.is_custom?"text-bassani-700":"text-gray-700"}`}>{m.is_blocked?"—":m.effective_rate+"%"}</span></Td>
                  <Td>
                    <button onClick={()=>toggleBlock(m.product_id, m.is_blocked)}
                      className={`text-xs px-3 py-1.5 rounded-lg border font-medium transition-all ${m.is_blocked?"border-bassani-300 text-bassani-700 hover:bg-bassani-50":"border-red-200 text-red-600 hover:bg-red-50"}`}>
                      {m.is_blocked?"Unblock":"Block"}
                    </button>
                  </Td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
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
      <main className="flex-1 overflow-y-auto p-6 flex gap-5">
        {/* Report nav */}
        <div className="w-44 flex-shrink-0">
          <p className="text-[10px] font-bold text-gray-400 uppercase tracking-wider mb-3">Reports</p>
          <div className="space-y-1">
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
      <div className="grid grid-cols-4 gap-3">
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
      <table className="w-full text-sm">
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
      </table>
    </div>
  );

  if (type === "best-customers") return (
    <div className="bg-white border border-gray-100 rounded-xl overflow-hidden">
      <div className="px-5 py-4 border-b border-gray-50"><h3 className="text-sm font-semibold">Top customers by spend</h3></div>
      <table className="w-full text-sm">
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
      </table>
    </div>
  );

  if (type === "dead-stock") return (
    <div className="space-y-4">
      <div className="bg-red-50 border border-red-100 rounded-xl p-4 text-sm text-red-700 font-medium">
        {data.total} products haven't moved in {data.days_threshold}+ days
      </div>
      <div className="bg-white border border-gray-100 rounded-xl overflow-hidden">
        <table className="w-full text-sm">
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
        </table>
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
        <div className="grid grid-cols-4 gap-3">
          <StatCardInline label="Total Submissions" value={total} />
          <StatCardInline label="Pending Review"    value={stats.pending||0}   accent="text-amber-600" />
          <StatCardInline label="Approved"          value={stats.approved||0}  accent="text-bassani-700" />
          <StatCardInline label="Declined"          value={stats.declined||0}  accent="text-red-600" />
        </div>

        {/* Filters */}
        <div className="flex items-center gap-2 flex-wrap">
          <SearchBar value={search} onChange={setSearch} placeholder="Search name, HPCSA, practice…" />
          {STATUSES.map(s=><FilterPill key={s} label={s==="all"?"All":s.charAt(0).toUpperCase()+s.slice(1)} active={statusF===s} onClick={()=>setStatusF(s)} />)}
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
