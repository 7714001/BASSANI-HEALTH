import { useState, useEffect, useCallback, useRef } from "react";
import { Loader2, RefreshCw, PackageCheck, ClipboardList, CheckCircle, AlertTriangle } from "lucide-react";
import api from "../api";
import toast from "react-hot-toast";
import { TopBar, BtnPrimary, BtnSecondary } from "../components/UI";
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
            <h3 className="text-sm font-semibold text-gray-800 dark:text-gray-100 flex items-center gap-2 mb-1">
              <PackageCheck size={15} className="text-bassani-500" /> Receive Imported Stock
            </h3>
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
                  <p className="text-xs text-gray-400 mt-1">This supplier has no matching contact in the stock system yet, so no purchase orders could be listed.</p>
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
    </div>
  );
}
