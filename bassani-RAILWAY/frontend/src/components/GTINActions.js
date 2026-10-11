// GTIN lifecycle windows (12.10) — shared by the GTIN Pool page and the
// Products page's GTIN picker so both behave identically.
//
// GS1 rule behind this: a GTIN that has identified a product is never given
// to a different product. So:
//   Relink  — same physical product, new Odoo record (e.g. the product was
//             deleted and recreated in Odoo). Keeps the GTIN. Not reuse.
//   Retire  — product discontinued. The GTIN stays on record, never reissued.
//   Release — assigned by mistake and never used. Back to the pool.
import { useState, useEffect, useRef } from "react";
import { Loader2, Search, CheckCircle, AlertTriangle } from "lucide-react";
import toast from "react-hot-toast";
import api from "../api";
import { Modal, BtnPrimary, BtnSecondary, BtnDanger, FormGroup, Input, fmtDateTime } from "./UI";

// Debounced search over the Odoo product variants (same endpoint as the
// Products list), returning {id, name, display_name, default_code, barcode}.
export function ProductSearchPicker({ value, onChange, autoFocus }) {
  const [q, setQ] = useState("");
  const [results, setResults] = useState([]);
  const [loading, setLoading] = useState(false);
  const timer = useRef(null);

  useEffect(() => {
    clearTimeout(timer.current);
    if (q.trim().length < 2) { setResults([]); return; }
    timer.current = setTimeout(async () => {
      setLoading(true);
      try {
        const { data } = await api.get("/api/products/", { params: { search: q.trim(), limit: 20 } });
        setResults(data.products || []);
      } catch { setResults([]); }
      finally { setLoading(false); }
    }, 300);
    return () => clearTimeout(timer.current);
  }, [q]);

  return (
    <div>
      {value && (
        <div className="mb-2 flex items-center justify-between gap-2 px-3 py-2 rounded-lg border border-bassani-200 bg-bassani-50">
          <div className="min-w-0">
            <p className="text-sm font-medium text-gray-900 truncate">{value.display_name || value.name}</p>
            {value.default_code && <p className="text-[11px] font-mono text-gray-500">{value.default_code}</p>}
          </div>
          <button type="button" onClick={() => onChange(null)} className="text-xs text-gray-500 hover:text-gray-700">Change</button>
        </div>
      )}
      {!value && (
        <>
          <div className="relative">
            <Search size={14} className="absolute left-2.5 top-1/2 -translate-y-1/2 text-gray-400 pointer-events-none" />
            <input value={q} onChange={e => setQ(e.target.value)} autoFocus={autoFocus}
              placeholder="Search products by name or code…"
              className="w-full pl-8 pr-3 py-2 text-sm border border-gray-200 rounded-lg bg-white focus:outline-none focus:ring-2 focus:ring-bassani-400" />
          </div>
          {(loading || results.length > 0) && (
            <div className="mt-1 border border-gray-200 rounded-lg max-h-56 overflow-y-auto">
              {loading && <p className="px-3 py-2 text-xs text-gray-400 flex items-center gap-1.5"><Loader2 size={12} className="animate-spin" />Searching…</p>}
              {results.map(p => (
                <button key={p.id} type="button" onClick={() => { onChange(p); setQ(""); setResults([]); }}
                  className="w-full text-left px-3 py-2 border-t first:border-t-0 border-gray-100 hover:bg-gray-50">
                  <p className="text-sm text-gray-900">{p.display_name || p.name}</p>
                  <p className="text-[11px] text-gray-400">
                    {p.default_code && <span className="font-mono mr-2">{p.default_code}</span>}
                    {p.barcode ? <span className="text-amber-600">Has barcode {p.barcode}</span> : "No barcode"}
                  </p>
                </button>
              ))}
            </div>
          )}
        </>
      )}
    </div>
  );
}

export function RelinkModal({ item, initialProduct = null, onClose, onDone }) {
  const [product, setProduct] = useState(initialProduct);
  const [reason, setReason] = useState("");
  const [saving, setSaving] = useState(false);

  const submit = async () => {
    if (!product) return toast.error("Choose the product");
    setSaving(true);
    try {
      const { data } = await api.post(`/api/gtin-pool/${item.gtin}/relink`, {
        odoo_product_id: product.id, product_name: product.name || product.display_name,
        reason: reason.trim() || undefined,
      });
      if (data.warning) toast.error(data.warning, { duration: 8000 });
      else toast.success(`GTIN ${item.gtin} relinked to ${product.display_name || product.name}`);
      onDone?.();
      onClose();
    } catch (e) { toast.error(e.response?.data?.detail || "Relink failed"); }
    finally { setSaving(false); }
  };

  return (
    <Modal title={`Relink GTIN ${item.gtin}`} onClose={onClose}>
      <p className="text-xs text-gray-500 mb-3">
        Use this when it's the <strong>same physical product</strong> under a new record in Odoo, for example after
        the product was deleted and recreated. The GTIN stays with the product. For a different product, don't
        relink: retire this GTIN and assign a new one.
      </p>
      <p className="text-xs text-gray-500 mb-3">Currently linked to: <strong className="text-gray-700">{item.product_name || "Unknown"}</strong></p>
      <FormGroup label="Link to" required>
        <ProductSearchPicker value={product} onChange={setProduct} autoFocus={!initialProduct} />
      </FormGroup>
      <FormGroup label="Note">
        <Input value={reason} onChange={e => setReason(e.target.value)} placeholder="e.g. Product recreated in Odoo" />
      </FormGroup>
      <div className="flex justify-end gap-2 mt-4">
        <BtnSecondary onClick={onClose} disabled={saving}>Cancel</BtnSecondary>
        <BtnPrimary onClick={submit} loading={saving} disabled={!product}>Relink</BtnPrimary>
      </div>
    </Modal>
  );
}

export function RetireModal({ item, onClose, onDone }) {
  const [reason, setReason] = useState("");
  const [saving, setSaving] = useState(false);
  const submit = async () => {
    setSaving(true);
    try {
      const { data } = await api.post(`/api/gtin-pool/${item.gtin}/retire`, { reason: reason.trim() });
      if (data.warning) toast.error(data.warning, { duration: 8000 });
      else toast.success(`GTIN ${item.gtin} retired`);
      onDone?.();
      onClose();
    } catch (e) { toast.error(e.response?.data?.detail || "Retire failed"); }
    finally { setSaving(false); }
  };
  return (
    <Modal title={`Retire GTIN ${item.gtin}?`} onClose={onClose}>
      <p className="text-sm text-gray-600 mb-2">
        For a discontinued product. The barcode is cleared from <strong>{item.product_name}</strong> in Odoo, and the
        GTIN is kept on record against it permanently. It can never be assigned to another product, so anything
        already printed with it always traces back to the right item.
      </p>
      <p className="text-xs text-gray-500 mb-3">If the product was only recreated in Odoo, use Relink instead.</p>
      <FormGroup label="Reason" required>
        <Input value={reason} onChange={e => setReason(e.target.value)} placeholder="e.g. Product discontinued" autoFocus />
      </FormGroup>
      <div className="flex justify-end gap-2 mt-4">
        <BtnSecondary onClick={onClose} disabled={saving}>Cancel</BtnSecondary>
        <BtnDanger onClick={submit} loading={saving} disabled={!reason.trim()}>Retire</BtnDanger>
      </div>
    </Modal>
  );
}

export function ReleaseModal({ item, onClose, onDone }) {
  const [reason, setReason] = useState("");
  const [saving, setSaving] = useState(false);
  const submit = async () => {
    setSaving(true);
    try {
      const { data } = await api.post(`/api/gtin-pool/${item.gtin}/unassign`, { reason: reason.trim() });
      if (data.warning) toast.error(data.warning, { duration: 8000 });
      else toast.success(`GTIN ${item.gtin} returned to the pool`);
      onDone?.();
      onClose();
    } catch (e) { toast.error(e.response?.data?.detail || "Release failed"); }
    finally { setSaving(false); }
  };
  return (
    <Modal title={`Return GTIN ${item.gtin} to the pool?`} onClose={onClose}>
      <div className="mb-3 rounded-lg border border-amber-200 bg-amber-50 px-3 py-2 flex gap-2">
        <AlertTriangle size={14} className="text-amber-600 shrink-0 mt-0.5" />
        <p className="text-xs text-amber-800">
          Only if this GTIN was assigned to <strong>{item.product_name}</strong> by mistake and has never been printed on a
          label or packaging. Once a GTIN has identified a product it must not move to a different one. For a recreated
          product use Relink; for a discontinued one use Retire.
        </p>
      </div>
      <FormGroup label="Reason" required>
        <Input value={reason} onChange={e => setReason(e.target.value)} placeholder="e.g. Assigned to the wrong product, never printed" autoFocus />
      </FormGroup>
      <div className="flex justify-end gap-2 mt-4">
        <BtnSecondary onClick={onClose} disabled={saving}>Cancel</BtnSecondary>
        <BtnDanger onClick={submit} loading={saving} disabled={!reason.trim()}>Return to Pool</BtnDanger>
      </div>
    </Modal>
  );
}

const HISTORY_LABEL = {
  assigned: "Assigned", relinked: "Relinked", retired: "Retired", released_in_error: "Returned to pool (assigned in error)",
};

export function GTINHistoryModal({ gtin, onClose }) {
  const [doc, setDoc] = useState(null);
  useEffect(() => {
    api.get(`/api/gtin-pool/${gtin}`).then(r => setDoc(r.data)).catch(() => setDoc({ history: [] }));
  }, [gtin]);
  const history = [...(doc?.history || [])].reverse();
  return (
    <Modal title={`GTIN ${gtin}: history`} onClose={onClose}>
      {!doc ? (
        <p className="text-sm text-gray-400 flex items-center gap-2"><Loader2 size={14} className="animate-spin" />Loading…</p>
      ) : history.length === 0 ? (
        <p className="text-sm text-gray-500">No changes recorded yet. History is kept from 11 October 2026; earlier changes are in the Audit Trail.</p>
      ) : (
        <ul className="space-y-2">
          {history.map((h, i) => (
            <li key={i} className="text-sm border-l-2 border-bassani-200 pl-3">
              <p className="font-medium text-gray-800">{HISTORY_LABEL[h.action] || h.action}</p>
              <p className="text-xs text-gray-500">
                {h.action === "relinked"
                  ? <>From {h.from_product_name || "a deleted product"} to {h.product_name}</>
                  : h.product_name}
              </p>
              {h.reason && <p className="text-xs text-gray-500 italic">{h.reason}</p>}
              <p className="text-[11px] text-gray-400">{h.by_name || h.by}, {fmtDateTime(h.at)}</p>
            </li>
          ))}
        </ul>
      )}
      <div className="flex justify-end mt-4"><BtnSecondary onClick={onClose}>Close</BtnSecondary></div>
    </Modal>
  );
}

// Bulk relink for GTINs whose product was deleted in Odoo. Each row is
// pre-filled with the best suggested replacement (same name, no barcode yet)
// and can be changed with a search.
export function BulkRelinkModal({ orphans, onClose, onDone }) {
  const [rows, setRows] = useState(() => orphans.map(o => {
    const best = (o.candidates || []).find(c => !c.barcode && !c.has_pool_gtin);
    return { ...o, selected: best ? { id: best.id, name: o.product_name, display_name: best.display_name, default_code: best.default_code } : null,
             include: !!best, searching: false };
  }));
  const [saving, setSaving] = useState(false);
  const update = (gtin, patch) => setRows(rs => rs.map(r => (r.gtin === gtin ? { ...r, ...patch } : r)));
  const chosen = rows.filter(r => r.include && r.selected);
  const dupes = (() => {
    const seen = {}, d = new Set();
    chosen.forEach(r => { if (seen[r.selected.id]) { d.add(r.selected.id); } seen[r.selected.id] = true; });
    return d;
  })();

  const submit = async () => {
    if (!chosen.length) return toast.error("Tick at least one GTIN with a product chosen");
    if (dupes.size) return toast.error("Two GTINs are pointing at the same product");
    setSaving(true);
    try {
      const { data } = await api.post("/api/gtin-pool/relink-bulk", {
        items: chosen.map(r => ({ gtin: r.gtin, odoo_product_id: r.selected.id, product_name: r.selected.name || r.selected.display_name })),
        reason: "Product recreated in Odoo",
      });
      const failed = data.results.filter(r => r.error);
      if (failed.length) toast.error(`${data.relinked} relinked, ${failed.length} failed: ${failed.map(f => `${f.gtin} (${f.error})`).join("; ")}`, { duration: 10000 });
      else if (data.not_synced) toast.error(`${data.relinked} relinked; ${data.not_synced} could not be written to Odoo yet. Use Retry Sync.`, { duration: 8000 });
      else toast.success(`${data.relinked} GTINs relinked`);
      onDone?.();
      onClose();
    } catch (e) { toast.error(e.response?.data?.detail || "Relink failed"); }
    finally { setSaving(false); }
  };

  return (
    <Modal title="Relink GTINs to recreated products" onClose={onClose} width="max-w-4xl">
      <p className="text-xs text-gray-500 mb-3">
        These GTINs are still linked to products that no longer exist in Odoo. Where we found a product with the same
        name, it's pre-selected. Check each one is the same physical product, untick any that aren't, and use Search to
        pick the right product where needed.
      </p>
      <div className="border border-gray-200 rounded-lg overflow-hidden max-h-[55vh] overflow-y-auto">
        <table className="w-full text-sm">
          <thead className="bg-gray-50 text-xs text-gray-500 sticky top-0">
            <tr>
              <th className="px-3 py-2 w-8"></th>
              <th className="px-3 py-2 text-left">GTIN</th>
              <th className="px-3 py-2 text-left">Was linked to</th>
              <th className="px-3 py-2 text-left">Relink to</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-gray-100">
            {rows.map(r => (
              <tr key={r.gtin} className="align-top">
                <td className="px-3 py-2">
                  <input type="checkbox" checked={r.include} disabled={!r.selected}
                    onChange={e => update(r.gtin, { include: e.target.checked })} className="accent-bassani-600 mt-1" />
                </td>
                <td className="px-3 py-2 font-mono text-gray-800">{r.gtin}</td>
                <td className="px-3 py-2 text-gray-600">{r.product_name || "Unknown"}</td>
                <td className="px-3 py-2 min-w-[18rem]">
                  {r.searching ? (
                    <ProductSearchPicker value={null} autoFocus
                      onChange={p => update(r.gtin, { selected: p ? { ...p, name: p.name || p.display_name } : null, include: !!p, searching: false })} />
                  ) : r.selected ? (
                    <div className="flex items-start justify-between gap-2">
                      <div>
                        <p className={`text-sm ${dupes.has(r.selected.id) && r.include ? "text-red-600" : "text-gray-900"}`}>
                          <CheckCircle size={12} className="inline mr-1 text-green-600" />{r.selected.display_name || r.selected.name}
                        </p>
                        {dupes.has(r.selected.id) && r.include && <p className="text-[11px] text-red-600">Another GTIN is also pointing here</p>}
                      </div>
                      <button type="button" onClick={() => update(r.gtin, { searching: true })} className="text-xs text-gray-500 hover:text-gray-700 shrink-0">Change</button>
                    </div>
                  ) : (
                    <div>
                      <p className="text-xs text-gray-400 mb-1">
                        {(r.candidates || []).length ? "Matching products already have a barcode." : "No product with this name found."}
                      </p>
                      <button type="button" onClick={() => update(r.gtin, { searching: true })} className="text-xs text-bassani-700 hover:underline">Search for the product</button>
                    </div>
                  )}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      <div className="flex items-center justify-between gap-2 mt-4">
        <p className="text-xs text-gray-500">{chosen.length} of {rows.length} ready to relink</p>
        <div className="flex gap-2">
          <BtnSecondary onClick={onClose} disabled={saving}>Cancel</BtnSecondary>
          <BtnPrimary onClick={submit} loading={saving} disabled={!chosen.length}>Relink {chosen.length || ""}</BtnPrimary>
        </div>
      </div>
    </Modal>
  );
}
