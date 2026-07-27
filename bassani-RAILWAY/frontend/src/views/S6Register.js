import { useState, useEffect, useCallback, useRef } from "react";
import { Loader2, RefreshCw, PackageCheck, ClipboardList, CheckCircle, AlertTriangle, Plus, Link2 } from "lucide-react";
import api from "../api";
import toast from "react-hot-toast";
import { useAuth } from "../AuthContext";
import { TopBar, BtnPrimary, BtnSecondary, Modal } from "../components/UI";
import { fmtWhen, batchTitle } from "./BatchRegistry";
import ProductionGuideButton from "../components/ProductionGuide";

/* Phase 13.0.6 — S6 Stock Receiving Register.
   Digital replacement for the "S6 Stock Receiving Logbook" Excel: one form =
   one register row = BI batch created + vault receive recorded + Schedule 6
   receipt entry written. The register table below is the compliance record. */

const DOCS = [
  { key: "doc_invoice",       label: "Invoice" },
  { key: "doc_coa",           label: "COA" },
  { key: "doc_delivery_note", label: "Delivery Note / Packing List" },
  { key: "doc_s6_transfer",   label: "S6 Transfer Doc" },
];

export default function S6Register() {
  const { can } = useAuth();
  const [meta, setMeta]           = useState(null);
  const [suppliers, setSuppliers] = useState([]);
  const [products, setProducts]   = useState([]);
  const [items, setItems]         = useState([]);
  const [total, setTotal]         = useState(0);
  const [loading, setLoading]     = useState(true);
  const [q, setQ]                 = useState("");

  // Receive form
  const [supplier, setSupplier]   = useState(null);
  const [productQuery, setProductQuery] = useState("");
  const [product, setProduct]     = useState(null);
  const [productOpen, setProductOpen] = useState(false);
  const [typeDigit, setTypeDigit] = useState(3);
  const [subcat, setSubcat]       = useState("");
  const [qtyQuoted, setQtyQuoted] = useState("");
  const [qtyReceived, setQtyReceived] = useState("");
  const [poList, setPoList]       = useState([]);
  const [poInfo, setPoInfo]       = useState(null);    // open-pos response meta
  const [poChoice, setPoChoice]   = useState("");      // "" | "flag" | "<po id>"
  const [docs, setDocs]           = useState({ doc_invoice: false, doc_coa: false, doc_delivery_note: false, doc_s6_transfer: false });
  const [comment, setComment]     = useState("");
  const [preview, setPreview]     = useState(null);
  const [saving, setSaving]       = useState(false);
  const productBoxRef = useRef(null);

  // Manage-suppliers modal (production.manage)
  const [manageOpen, setManageOpen]       = useState(false);
  const [manageList, setManageList]       = useState([]);
  const [newSupplier, setNewSupplier]     = useState({ name: "", code: "" });
  const [savingSupplier, setSavingSupplier] = useState(false);
  const [supplierBusy, setSupplierBusy]   = useState(null);
  // Link-to-Odoo-account picker
  const [linkTarget, setLinkTarget]       = useState(null);   // supplier row
  const [vendorQuery, setVendorQuery]     = useState("");
  const [vendorResults, setVendorResults] = useState([]);
  const [vendorSearching, setVendorSearching] = useState(false);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const [metaRes, supRes, prodRes, listRes] = await Promise.all([
        api.get("/api/production/meta"),
        api.get("/api/production/suppliers"),
        api.get("/api/production/products"),
        api.get("/api/production/s6-register", { params: q ? { q, limit: 200 } : { limit: 200 } }),
      ]);
      setMeta(metaRes.data);
      setSuppliers(supRes.data.suppliers);
      setProducts(prodRes.data.products);
      setItems(listRes.data.items);
      setTotal(listRes.data.total);
    } catch (e) {
      toast.error(e.response?.data?.detail || "Failed to load the S6 register");
    } finally {
      setLoading(false);
    }
  }, [q]);

  useEffect(() => { load(); }, [load]);

  // Live BI batch ID preview
  useEffect(() => {
    if (!supplier || !product || !typeDigit) { setPreview(null); return; }
    let stale = false;
    api.get("/api/production/batches/preview", {
      params: { family: "import", product_code: product.code, supplier_code: supplier.code,
                type_digit: typeDigit, subcat: subcat || undefined },
    })
      .then(r => { if (!stale) setPreview(r.data); })
      .catch(() => { if (!stale) setPreview(null); });
    return () => { stale = true; };
  }, [supplier, product, typeDigit, subcat]);

  useEffect(() => {
    const close = (e) => {
      if (productBoxRef.current && !productBoxRef.current.contains(e.target)) setProductOpen(false);
    };
    document.addEventListener("mousedown", close);
    return () => document.removeEventListener("mousedown", close);
  }, []);

  // Load the supplier's open purchase orders whenever the supplier changes
  useEffect(() => {
    setPoChoice(""); setPoList([]); setPoInfo(null);
    if (!supplier) return;
    let stale = false;
    api.get(`/api/production/suppliers/${supplier.code}/open-pos`)
      .then(r => { if (!stale) { setPoList(r.data.purchase_orders || []); setPoInfo(r.data); } })
      .catch(() => { if (!stale) setPoInfo({ odoo_unavailable: true }); });
    return () => { stale = true; };
  }, [supplier]);

  const filteredProducts = products.filter(p => {
    const t = productQuery.trim().toLowerCase();
    if (!t) return true;
    return p.name.toLowerCase().includes(t) || p.code.toLowerCase().includes(t);
  });

  // Manage suppliers: list incl. archived, add / archive / restore / link
  async function refreshSuppliers() {
    const [all, active] = await Promise.all([
      api.get("/api/production/suppliers", { params: { include_archived: true } }),
      api.get("/api/production/suppliers"),
    ]);
    setManageList(all.data.suppliers);
    setSuppliers(active.data.suppliers);
  }

  async function openManage() {
    setManageOpen(true);
    try { await refreshSuppliers(); } catch { toast.error("Failed to load supplier list"); }
  }

  async function saveSupplier() {
    setSavingSupplier(true);
    try {
      await api.post("/api/production/suppliers", { name: newSupplier.name, code: newSupplier.code });
      toast.success(`Supplier ${newSupplier.name} added`);
      setNewSupplier({ name: "", code: "" });
      await refreshSuppliers();
    } catch (e) {
      toast.error(e.response?.data?.detail || "Failed to add supplier");
    } finally {
      setSavingSupplier(false);
    }
  }

  async function toggleSupplier(s) {
    setSupplierBusy(s.code);
    try {
      await api.post(`/api/production/suppliers/${s.code}/${s.active ? "archive" : "restore"}`);
      toast.success(s.active ? `${s.name} archived` : `${s.name} restored`);
      await refreshSuppliers();
    } catch (e) {
      toast.error(e.response?.data?.detail || "Failed to update supplier");
    } finally {
      setSupplierBusy(null);
    }
  }

  async function doLink(vendor) {
    const s = linkTarget;
    setLinkTarget(null);
    setSupplierBusy(s.code);
    try {
      await api.post(`/api/production/suppliers/${s.code}/link`, {
        odoo_partner_id: vendor.id, odoo_partner_name: vendor.name,
      });
      toast.success(`${s.name} linked to ${vendor.name}`);
      await refreshSuppliers();
    } catch (e) {
      toast.error(e.response?.data?.detail || "Failed to link supplier");
    } finally {
      setSupplierBusy(null);
    }
  }

  async function doUnlink(s) {
    setSupplierBusy(s.code);
    try {
      await api.post(`/api/production/suppliers/${s.code}/unlink`);
      toast.success(`${s.name} unlinked`);
      await refreshSuppliers();
    } catch (e) {
      toast.error(e.response?.data?.detail || "Failed to unlink supplier");
    } finally {
      setSupplierBusy(null);
    }
  }

  // Vendor search inside the link picker (debounced)
  useEffect(() => {
    if (!linkTarget || vendorQuery.trim().length < 2) { setVendorResults([]); return; }
    setVendorSearching(true);
    const t = setTimeout(() => {
      api.get("/api/production/odoo-vendors", { params: { q: vendorQuery.trim() } })
        .then(r => setVendorResults(r.data.vendors))
        .catch(e => toast.error(e.response?.data?.detail || "Vendor search failed"))
        .finally(() => setVendorSearching(false));
    }, 300);
    return () => clearTimeout(t);
  }, [vendorQuery, linkTarget]);

  const discrepancy = qtyQuoted && qtyReceived
    ? Math.round((parseFloat(qtyQuoted) - parseFloat(qtyReceived)) * 1000) / 1000
    : null;

  const canSubmit = supplier && product && typeDigit && parseFloat(qtyReceived) > 0 && poChoice !== "";

  async function submit() {
    if (!canSubmit) return;
    setSaving(true);
    try {
      const linkedPo = poChoice !== "flag" ? poList.find(p => String(p.id) === poChoice) : null;
      const r = await api.post("/api/production/vault/receive-import", {
        supplier_code: supplier.code,
        product_code: product.code,
        type_digit: typeDigit,
        subcat: subcat || undefined,
        qty_quoted: qtyQuoted ? parseFloat(qtyQuoted) : undefined,
        qty_received: parseFloat(qtyReceived),
        po_id: linkedPo?.id,
        po_name: linkedPo?.name,
        po_flag: poChoice === "flag",
        ...docs,
        comment: comment || undefined,
      });
      if (poChoice === "flag") {
        toast(`${r.data.receipt.batch_id} received and flagged for investigation`, { icon: "⚠️" });
      } else {
        toast.success(`Received ${r.data.receipt.batch_id}. It is held until the Responsible Pharmacist releases it.`);
      }
      setProduct(null); setProductQuery(""); setQtyQuoted(""); setQtyReceived(""); setPoChoice("");
      setDocs({ doc_invoice: false, doc_coa: false, doc_delivery_note: false, doc_s6_transfer: false });
      setComment(""); setPreview(null);
      load();
    } catch (e) {
      toast.error(e.response?.data?.detail || "Failed to record the receipt");
    } finally {
      setSaving(false);
    }
  }

  return (
    <div className="flex flex-col h-full overflow-hidden">
      <TopBar
        title="S6 Receiving"
        actions={
          <div className="flex items-center gap-2">
            <ProductionGuideButton />
            <BtnSecondary onClick={load} disabled={loading}>
              <RefreshCw size={14} className={loading ? "animate-spin" : ""} />
              Refresh
            </BtnSecondary>
          </div>
        }
      />

      <div className="flex-1 overflow-y-auto p-6">
        <div className="max-w-4xl mx-auto w-full space-y-6">

          {/* Receive form */}
          <div className="bg-white dark:bg-gray-800 rounded-xl border border-gray-200 dark:border-gray-700 p-5">
            <div className="flex items-center justify-between mb-1">
              <h3 className="text-sm font-semibold text-gray-800 dark:text-gray-100 flex items-center gap-2">
                <PackageCheck size={15} className="text-bassani-500" /> Receive Imported Stock
              </h3>
              {can("production.manage") && (
                <button onClick={openManage} className="text-xs text-bassani-600 dark:text-bassani-400 hover:underline flex items-center gap-1">
                  <Plus size={12} /> Manage suppliers
                </button>
              )}
            </div>
            <p className="text-xs text-gray-500 dark:text-gray-400 mb-4">
              One entry does everything: the batch number is generated, the stock is booked into the vault, and the Schedule 6 register entry is written. Your name and the time are captured automatically.
            </p>

            <div className="grid sm:grid-cols-2 gap-4">
              <div>
                <label className="block text-xs font-medium text-gray-500 dark:text-gray-400 mb-1.5">Supplier</label>
                <select
                  value={supplier?.code || ""}
                  onChange={e => setSupplier(suppliers.find(s => s.code === e.target.value) || null)}
                  className="w-full text-sm border border-gray-200 dark:border-gray-600 rounded-lg px-3 py-2 bg-gray-50 dark:bg-gray-900 text-gray-900 dark:text-gray-100 focus:outline-none focus:ring-2 focus:ring-bassani-400"
                >
                  <option value="">Select supplier…</option>
                  {suppliers.map(s => <option key={s.code} value={s.code}>{s.name} ({s.code})</option>)}
                </select>
              </div>

              <div ref={productBoxRef} className="relative">
                <label className="block text-xs font-medium text-gray-500 dark:text-gray-400 mb-1.5">Product</label>
                <input
                  value={product ? `${product.name} (${product.code})` : productQuery}
                  onChange={e => { setProduct(null); setProductQuery(e.target.value); setProductOpen(true); }}
                  onFocus={() => setProductOpen(true)}
                  placeholder="Search by name or shortcode…"
                  className="w-full text-sm border border-gray-200 dark:border-gray-600 rounded-lg px-3 py-2 bg-gray-50 dark:bg-gray-900 text-gray-900 dark:text-gray-100 placeholder-gray-400 focus:outline-none focus:ring-2 focus:ring-bassani-400"
                />
                {productOpen && (
                  <div className="absolute z-20 mt-1 w-full max-h-56 overflow-y-auto bg-white dark:bg-gray-800 border border-gray-200 dark:border-gray-700 rounded-lg shadow-lg">
                    {filteredProducts.length === 0 ? (
                      <p className="text-xs text-gray-400 px-3 py-2">No matching products</p>
                    ) : filteredProducts.map(p => (
                      <button
                        key={p.code}
                        onClick={() => { setProduct(p); setProductQuery(""); setProductOpen(false); }}
                        className="w-full text-left px-3 py-2 text-sm text-gray-700 dark:text-gray-200 hover:bg-gray-50 dark:hover:bg-gray-700/50 flex justify-between items-center"
                      >
                        <span className="truncate">{p.name}</span>
                        <span className="font-mono text-xs text-gray-400 ml-2">{p.code}</span>
                      </button>
                    ))}
                  </div>
                )}
              </div>

              <div>
                <label className="block text-xs font-medium text-gray-500 dark:text-gray-400 mb-1.5">Stock type</label>
                <select
                  value={typeDigit}
                  onChange={e => setTypeDigit(Number(e.target.value))}
                  className="w-full text-sm border border-gray-200 dark:border-gray-600 rounded-lg px-3 py-2 bg-gray-50 dark:bg-gray-900 text-gray-900 dark:text-gray-100 focus:outline-none focus:ring-2 focus:ring-bassani-400"
                >
                  {(meta?.import_types || []).map(t => <option key={t.digit} value={t.digit}>{t.label}</option>)}
                </select>
              </div>

              <div>
                <label className="block text-xs font-medium text-gray-500 dark:text-gray-400 mb-1.5">Size (flower only)</label>
                <select
                  value={subcat}
                  onChange={e => setSubcat(e.target.value)}
                  className="w-full text-sm border border-gray-200 dark:border-gray-600 rounded-lg px-3 py-2 bg-gray-50 dark:bg-gray-900 text-gray-900 dark:text-gray-100 focus:outline-none focus:ring-2 focus:ring-bassani-400"
                >
                  <option value="">Not applicable</option>
                  {(meta?.import_subcats || []).map(s => <option key={s.char} value={s.char}>{s.label}</option>)}
                </select>
              </div>

              <div>
                <label className="block text-xs font-medium text-gray-500 dark:text-gray-400 mb-1.5">Quantity quoted (grams or units)</label>
                <input
                  type="number" min="0" step="any" value={qtyQuoted}
                  onChange={e => setQtyQuoted(e.target.value)}
                  placeholder="What the supplier said"
                  className="w-full text-sm border border-gray-200 dark:border-gray-600 rounded-lg px-3 py-2 bg-gray-50 dark:bg-gray-900 text-gray-900 dark:text-gray-100 placeholder-gray-400 focus:outline-none focus:ring-2 focus:ring-bassani-400"
                />
              </div>

              <div>
                <label className="block text-xs font-medium text-gray-500 dark:text-gray-400 mb-1.5">Quantity received (grams or units)</label>
                <input
                  type="number" min="0" step="any" value={qtyReceived}
                  onChange={e => setQtyReceived(e.target.value)}
                  placeholder="What was actually weighed in"
                  className="w-full text-sm border border-gray-200 dark:border-gray-600 rounded-lg px-3 py-2 bg-gray-50 dark:bg-gray-900 text-gray-900 dark:text-gray-100 placeholder-gray-400 focus:outline-none focus:ring-2 focus:ring-bassani-400"
                />
              </div>

              <div className="sm:col-span-2">
                <label className="block text-xs font-medium text-gray-500 dark:text-gray-400 mb-1.5">Purchase order for this delivery</label>
                <select
                  value={poChoice}
                  onChange={e => setPoChoice(e.target.value)}
                  disabled={!supplier}
                  className="w-full text-sm border border-gray-200 dark:border-gray-600 rounded-lg px-3 py-2 bg-gray-50 dark:bg-gray-900 text-gray-900 dark:text-gray-100 focus:outline-none focus:ring-2 focus:ring-bassani-400 disabled:opacity-50"
                >
                  <option value="">{supplier ? "Select the purchase order…" : "Pick a supplier first"}</option>
                  {poList.map(p => (
                    <option key={p.id} value={String(p.id)}>
                      {p.name}{p.date_order ? ` — ${String(p.date_order).slice(0, 10)}` : ""}{p.amount_total ? ` — R ${p.amount_total}` : ""}
                    </option>
                  ))}
                  <option value="flag">No purchase order found — flag for investigation</option>
                </select>
                {poChoice === "flag" && (
                  <p className="text-xs text-amber-600 dark:text-amber-400 mt-1 flex items-center gap-1">
                    <AlertTriangle size={12} /> The receipt will be held and the compliance contact notified. It cannot be released until the flag is resolved.
                  </p>
                )}
                {supplier && poInfo?.odoo_partner_found === false && (
                  <p className="text-xs text-gray-400 mt-1">This supplier is not linked to a supplier account yet, so no purchase orders could be listed. An admin can link it under Manage suppliers.</p>
                )}
                {supplier && poInfo?.odoo_partner_found && poInfo?.linked === false && (
                  <p className="text-xs text-amber-600 dark:text-amber-400 mt-1">
                    Matched by name to "{poInfo.partner_name}". Ask an admin to link this supplier to its account under Manage suppliers to make the match permanent.
                  </p>
                )}
                {supplier && poInfo?.odoo_unavailable && (
                  <p className="text-xs text-gray-400 mt-1">Purchase orders could not be loaded right now. You can still flag the receipt for investigation.</p>
                )}
              </div>

              {discrepancy !== null && discrepancy !== 0 && (
                <p className="sm:col-span-2 text-xs text-amber-600 dark:text-amber-400 flex items-center gap-1">
                  <AlertTriangle size={12} />
                  {discrepancy > 0
                    ? `Received ${discrepancy} less than quoted. The difference is recorded on the register entry.`
                    : `Received ${Math.abs(discrepancy)} more than quoted. The difference is recorded on the register entry.`}
                </p>
              )}

              <div className="sm:col-span-2">
                <label className="block text-xs font-medium text-gray-500 dark:text-gray-400 mb-1.5">Documents received with this delivery</label>
                <div className="flex flex-wrap gap-x-5 gap-y-2">
                  {DOCS.map(d => (
                    <label key={d.key} className="flex items-center gap-1.5 text-sm text-gray-700 dark:text-gray-200 cursor-pointer">
                      <input
                        type="checkbox"
                        checked={docs[d.key]}
                        onChange={e => setDocs(v => ({ ...v, [d.key]: e.target.checked }))}
                        className="rounded border-gray-300 text-bassani-600 focus:ring-bassani-400"
                      />
                      {d.label}
                    </label>
                  ))}
                </div>
              </div>

              <div className="sm:col-span-2">
                <label className="block text-xs font-medium text-gray-500 dark:text-gray-400 mb-1.5">Comment (optional)</label>
                <input
                  value={comment}
                  onChange={e => setComment(e.target.value)}
                  placeholder="Anything unusual about this delivery…"
                  className="w-full text-sm border border-gray-200 dark:border-gray-600 rounded-lg px-3 py-2 bg-gray-50 dark:bg-gray-900 text-gray-900 dark:text-gray-100 placeholder-gray-400 focus:outline-none focus:ring-2 focus:ring-bassani-400"
                />
              </div>
            </div>

            <div className="mt-4 flex flex-col sm:flex-row sm:items-center gap-3">
              <div className="flex-1 bg-gray-50 dark:bg-gray-900 border border-dashed border-gray-300 dark:border-gray-600 rounded-lg px-4 py-3">
                {preview ? (
                  <span className="font-mono text-lg font-semibold text-gray-800 dark:text-gray-100 tracking-wide">{preview.batch_id}</span>
                ) : (
                  <span className="text-sm text-gray-400">Pick the supplier and product to preview the batch number</span>
                )}
              </div>
              <BtnPrimary onClick={submit} disabled={!canSubmit || saving}>
                {saving ? <Loader2 size={14} className="animate-spin mr-1.5" /> : <PackageCheck size={14} className="mr-1.5" />}
                {saving ? "Recording…" : "Receive into Vault"}
              </BtnPrimary>
            </div>
          </div>

          {/* Register table */}
          <div className="bg-white dark:bg-gray-800 rounded-xl border border-gray-200 dark:border-gray-700 overflow-hidden">
            <div className="flex items-center justify-between px-5 py-3 border-b border-gray-100 dark:border-gray-700 gap-3">
              <h3 className="text-sm font-semibold text-gray-800 dark:text-gray-100 flex items-center gap-2">
                <ClipboardList size={15} className="text-gray-400" /> S6 Register
                <span className="text-xs font-normal text-gray-400">{total} receipts</span>
              </h3>
              <input
                value={q}
                onChange={e => setQ(e.target.value)}
                placeholder="Search supplier, product or batch…"
                className="text-xs border border-gray-200 dark:border-gray-600 rounded-lg px-3 py-1.5 bg-gray-50 dark:bg-gray-900 text-gray-900 dark:text-gray-100 placeholder-gray-400 focus:outline-none focus:ring-2 focus:ring-bassani-400 w-64"
              />
            </div>

            {loading ? (
              <div className="flex items-center justify-center py-12 text-gray-400">
                <Loader2 size={18} className="animate-spin mr-2" /> <span className="text-sm">Loading…</span>
              </div>
            ) : items.length === 0 ? (
              <div className="text-center py-12 text-gray-400 dark:text-gray-500">
                <ClipboardList size={32} className="mx-auto mb-2 opacity-30" />
                <p className="text-sm">No receipts recorded yet. Record the first one above.</p>
              </div>
            ) : (
              <div className="overflow-x-auto">
                <table className="w-full text-sm">
                  <thead>
                    <tr className="text-left text-xs font-medium text-gray-500 dark:text-gray-400 bg-gray-50 dark:bg-gray-900/50">
                      <th className="px-5 py-2.5">Received</th>
                      <th className="px-5 py-2.5">Supplier</th>
                      <th className="px-5 py-2.5">Product</th>
                      <th className="px-5 py-2.5">Batch</th>
                      <th className="px-5 py-2.5 text-right">Qty</th>
                      <th className="px-5 py-2.5">PO</th>
                      <th className="px-5 py-2.5">Status</th>
                      <th className="px-5 py-2.5">Docs</th>
                      <th className="px-5 py-2.5">By</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-gray-100 dark:divide-gray-700">
                    {items.map(r => (
                      <tr key={r.id} className="hover:bg-gray-50 dark:hover:bg-gray-800/50 transition-colors align-top">
                        <td className="px-5 py-3 text-xs text-gray-400 whitespace-nowrap">{fmtWhen(r.created_at)}</td>
                        <td className="px-5 py-3 text-gray-600 dark:text-gray-300 whitespace-nowrap">{r.supplier_name}</td>
                        <td className="px-5 py-3 text-gray-600 dark:text-gray-300 max-w-[160px] truncate">
                          {r.product_name}
                          <span className="block text-xs text-gray-400">{r.type_label}{r.subcat ? ` · ${r.subcat}` : ""}</span>
                        </td>
                        <td className="px-5 py-3 font-mono text-xs text-gray-700 dark:text-gray-200 whitespace-nowrap" title={batchTitle(r.batch_id, r.product_name)}>{r.batch_id}</td>
                        <td className="px-5 py-3 text-right text-xs whitespace-nowrap">
                          <span className="font-semibold text-gray-700 dark:text-gray-200">{r.qty_received}</span>
                          {r.discrepancy ? (
                            <span className="block text-amber-600 dark:text-amber-400">quoted {r.qty_quoted}</span>
                          ) : null}
                        </td>
                        <td className="px-5 py-3 text-xs whitespace-nowrap">
                          {r.po_name
                            ? <span className="font-mono text-gray-600 dark:text-gray-300">{r.po_name}</span>
                            : r.po_flag?.flagged
                              ? r.po_flag.resolved
                                ? <span className="text-gray-400" title={r.po_flag.note}>Flag resolved</span>
                                : <span className="text-red-600 dark:text-red-400 font-medium">No PO — flagged</span>
                              : <span className="text-gray-300 dark:text-gray-600">None</span>}
                        </td>
                        <td className="px-5 py-3">
                          {r.status === "released" ? (
                            <span className="inline-flex text-xs font-medium px-2 py-0.5 rounded-full bg-green-100 text-green-700 dark:bg-green-900/30 dark:text-green-300" title={r.released_by_name ? `Released by ${r.released_by_name}` : ""}>Released</span>
                          ) : r.status === "queried" ? (
                            <span className="inline-flex text-xs font-medium px-2 py-0.5 rounded-full bg-red-100 text-red-700 dark:bg-red-900/30 dark:text-red-300" title={r.query_note || ""}>Queried</span>
                          ) : (
                            <span className="inline-flex text-xs font-medium px-2 py-0.5 rounded-full bg-amber-100 text-amber-700 dark:bg-amber-900/40 dark:text-amber-300">Awaiting release</span>
                          )}
                        </td>
                        <td className="px-5 py-3 text-xs text-gray-500 dark:text-gray-400">
                          {DOCS.filter(d => r.docs?.[d.key.replace("doc_", "")]).length === 0
                            ? <span className="text-gray-300 dark:text-gray-600">None</span>
                            : DOCS.filter(d => r.docs?.[d.key.replace("doc_", "")]).map(d => (
                                <span key={d.key} className="inline-flex items-center gap-0.5 mr-2"><CheckCircle size={10} className="text-green-500" />{d.label.split(" ")[0]}</span>
                              ))}
                        </td>
                        <td className="px-5 py-3 text-xs text-gray-500 dark:text-gray-400 whitespace-nowrap">{r.actor_name}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
          </div>
        </div>
      </div>

      {/* Manage suppliers modal */}
      {manageOpen && (
        <Modal title="Manage Suppliers" onClose={() => setManageOpen(false)} width="max-w-2xl">
          <p className="text-sm text-gray-600 dark:text-gray-300 mb-4">
            The supplier list used for imported stock. Linking a supplier to its account in the stock system makes purchase order lookups and receipts exact, instead of matching by name. Archiving hides a supplier from the receiving form without touching its history.
          </p>

          {/* Add row */}
          <div className="flex flex-col sm:flex-row gap-2 mb-4">
            <input
              value={newSupplier.name}
              onChange={e => setNewSupplier(v => ({ ...v, name: e.target.value }))}
              placeholder="Supplier name"
              className="flex-1 text-sm border border-gray-200 dark:border-gray-600 rounded-lg px-3 py-2 bg-gray-50 dark:bg-gray-900 text-gray-900 dark:text-gray-100 placeholder-gray-400 focus:outline-none focus:ring-2 focus:ring-bassani-400"
            />
            <input
              value={newSupplier.code}
              onChange={e => setNewSupplier(v => ({ ...v, code: e.target.value.toUpperCase() }))}
              maxLength={2}
              placeholder="Code"
              className="w-full sm:w-20 text-sm font-mono border border-gray-200 dark:border-gray-600 rounded-lg px-3 py-2 bg-gray-50 dark:bg-gray-900 text-gray-900 dark:text-gray-100 placeholder-gray-400 focus:outline-none focus:ring-2 focus:ring-bassani-400"
            />
            <BtnPrimary onClick={saveSupplier} disabled={savingSupplier || !newSupplier.name.trim() || newSupplier.code.trim().length !== 2}>
              {savingSupplier ? "Adding…" : "Add"}
            </BtnPrimary>
          </div>

          {/* List */}
          <div className="max-h-80 overflow-y-auto divide-y divide-gray-100 dark:divide-gray-700 border border-gray-100 dark:border-gray-700 rounded-lg">
            {manageList.map(s => (
              <div key={s.code} className={`flex items-center gap-3 px-3 py-2.5 text-sm ${s.active ? "" : "opacity-60"}`}>
                <span className="font-mono text-xs font-semibold text-gray-500 dark:text-gray-400 w-8 shrink-0">{s.code}</span>
                <div className="flex-1 min-w-0">
                  <span className="block truncate text-gray-700 dark:text-gray-200">{s.name}</span>
                  {s.odoo_partner_name ? (
                    <span className="block text-xs text-green-600 dark:text-green-400 truncate flex items-center gap-1">
                      <Link2 size={10} /> Linked to {s.odoo_partner_name}
                    </span>
                  ) : (
                    <span className="block text-xs text-amber-600 dark:text-amber-400">Not linked to a supplier account</span>
                  )}
                </div>
                {!s.active && (
                  <span className="text-xs font-medium px-2 py-0.5 rounded-full bg-gray-100 text-gray-500 dark:bg-gray-700 dark:text-gray-300 shrink-0">Archived</span>
                )}
                {s.odoo_partner_name ? (
                  <button onClick={() => doUnlink(s)} disabled={supplierBusy === s.code}
                    className="text-xs text-gray-400 hover:text-red-500 shrink-0 transition-colors">
                    Unlink
                  </button>
                ) : (
                  <button onClick={() => { setLinkTarget(s); setVendorQuery(s.name); }} disabled={supplierBusy === s.code}
                    className="text-xs text-bassani-600 dark:text-bassani-400 hover:underline shrink-0">
                    Link account
                  </button>
                )}
                <button onClick={() => toggleSupplier(s)} disabled={supplierBusy === s.code}
                  className="text-xs text-gray-400 hover:text-gray-600 dark:hover:text-gray-200 shrink-0">
                  {s.active ? "Archive" : "Restore"}
                </button>
              </div>
            ))}
            {manageList.length === 0 && (
              <p className="text-xs text-gray-400 px-3 py-4 text-center">Loading supplier list…</p>
            )}
          </div>

          <div className="flex justify-end mt-4">
            <BtnSecondary onClick={() => setManageOpen(false)}>Close</BtnSecondary>
          </div>
        </Modal>
      )}

      {/* Link-to-account picker */}
      {linkTarget && (
        <Modal title={`Link ${linkTarget.name}`} onClose={() => setLinkTarget(null)}>
          <p className="text-sm text-gray-600 dark:text-gray-300 mb-3">
            Search the supplier accounts in the stock system and pick the one that belongs to <strong>{linkTarget.name}</strong>. Purchase order lookups and goods receipts for this supplier will then always use that account.
          </p>
          <input
            value={vendorQuery}
            onChange={e => setVendorQuery(e.target.value)}
            placeholder="Search supplier accounts…"
            autoFocus
            className="w-full text-sm border border-gray-200 dark:border-gray-600 rounded-lg px-3 py-2 bg-gray-50 dark:bg-gray-900 text-gray-900 dark:text-gray-100 placeholder-gray-400 focus:outline-none focus:ring-2 focus:ring-bassani-400 mb-2"
          />
          <div className="max-h-56 overflow-y-auto divide-y divide-gray-100 dark:divide-gray-700 border border-gray-100 dark:border-gray-700 rounded-lg">
            {vendorSearching ? (
              <p className="text-xs text-gray-400 px-3 py-3 flex items-center gap-2"><Loader2 size={12} className="animate-spin" /> Searching…</p>
            ) : vendorResults.length === 0 ? (
              <p className="text-xs text-gray-400 px-3 py-3">
                {vendorQuery.trim().length < 2 ? "Type at least two characters to search." : "No supplier accounts found. Check the name, or create the supplier contact in the stock system first."}
              </p>
            ) : vendorResults.map(v => (
              <button
                key={v.id}
                onClick={() => doLink(v)}
                className="w-full text-left px-3 py-2.5 text-sm hover:bg-gray-50 dark:hover:bg-gray-700/50"
              >
                <span className="block text-gray-800 dark:text-gray-100">{v.name}</span>
                <span className="block text-xs text-gray-400">{[v.city, v.email].filter(Boolean).join(" · ") || "No contact details"}</span>
              </button>
            ))}
          </div>
          <div className="flex justify-end mt-4">
            <BtnSecondary onClick={() => setLinkTarget(null)}>Cancel</BtnSecondary>
          </div>
        </Modal>
      )}
    </div>
  );
}
