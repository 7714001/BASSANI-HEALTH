import { useState, useEffect } from "react";
import { Search, CheckCircle, Loader2, Tag, X, Archive, Undo2, Link2 } from "lucide-react";
import api from "../api";
import toast from "react-hot-toast";
import { useAuth } from "../AuthContext";
import { Modal, BtnPrimary, BtnSecondary, BtnDanger } from "./UI";
import { RetireModal, ReleaseModal } from "./GTINActions";

export default function GTINPickerModal({ product, onClose, onAssigned }) {
  const [available,       setAvailable      ] = useState([]);
  const [poolEntry,       setPoolEntry      ] = useState(null);
  const [loading,         setLoading        ] = useState(true);
  const [search,          setSearch         ] = useState("");
  const [assigning,       setAssigning      ] = useState(null);   // gtin string being assigned from pool
  const { can } = useAuth();
  const canManage = can("settings.manage");
  // 12.10 — retire / return-to-pool replace the old Unassign; GTINs whose
  // product was deleted in Odoo can be relinked to this product.
  const [retireOpen,      setRetireOpen     ] = useState(false);
  const [releaseOpen,     setReleaseOpen    ] = useState(false);
  const [orphans,         setOrphans        ] = useState([]);
  const [relinking,       setRelinking      ] = useState(null);
  const [customGtin,      setCustomGtin     ] = useState("");
  const [savingCustom,    setSavingCustom   ] = useState(false);
  const [clearConfirm,    setClearConfirm   ] = useState(false);
  const [clearing,        setClearing       ] = useState(false);

  useEffect(() => { load(); }, []); // eslint-disable-line

  async function load() {
    setLoading(true);
    try {
      const [availRes, entryRes, orphanRes] = await Promise.allSettled([
        api.get("/api/gtin-pool", { params: { status: "available", limit: 500 } }),
        product.barcode
          ? api.get(`/api/gtin-pool/${product.barcode}`)
          : Promise.reject(new Error("no barcode")),
        product.barcode ? Promise.reject(new Error("has barcode")) : api.get("/api/gtin-pool/orphans"),
      ]);
      setAvailable(availRes.status === "fulfilled" ? availRes.value.data.items : []);
      setPoolEntry(entryRes.status === "fulfilled" ? entryRes.value.data : null);
      // Suggested matches for this product first
      const os = orphanRes.status === "fulfilled" ? orphanRes.value.data.items : [];
      const isMatch = o => (o.candidates || []).some(c => c.id === product.id);
      setOrphans([...os].sort((a, b) => Number(isMatch(b)) - Number(isMatch(a))).map(o => ({ ...o, suggested: isMatch(o) })));
    } catch {
      setAvailable([]);
      setPoolEntry(null);
    } finally {
      setLoading(false);
    }
  }

  const filtered = available.filter(g => !search || g.gtin.includes(search.trim()));
  const isPoolAssigned = poolEntry && poolEntry.status === "assigned";

  async function assignFromPool(gtin) {
    setAssigning(gtin);
    try {
      const r = await api.post(`/api/gtin-pool/${gtin}/assign`, {
        odoo_product_id: product.id,
        product_name: product.name,
      });
      if (r.data.odoo_synced === false) {
        toast.error(r.data.warning || `GTIN ${gtin} linked in the portal, but Odoo was not updated.`, { duration: 8000 });
      } else {
        toast.success(`GTIN ${gtin} assigned to ${product.name}`);
      }
      onAssigned(gtin);
    } catch (e) {
      toast.error(e.response?.data?.detail || "Failed to assign GTIN");
      setAssigning(null);
    }
  }

  async function relinkHere(gtin) {
    setRelinking(gtin);
    try {
      const r = await api.post(`/api/gtin-pool/${gtin}/relink`, {
        odoo_product_id: product.id, product_name: product.name, reason: "Product recreated in Odoo",
      });
      if (r.data.warning) toast.error(r.data.warning, { duration: 8000 });
      else toast.success(`GTIN ${gtin} relinked to ${product.name}`);
      onAssigned(gtin);
    } catch (e) {
      toast.error(e.response?.data?.detail || "Relink failed");
      setRelinking(null);
    }
  }

  async function applyCustom() {
    const val = customGtin.trim();
    if (!val) return;
    setSavingCustom(true);
    try {
      await api.patch(`/api/products/${product.id}/barcode`, { barcode: val });
      toast.success("Barcode saved");
      onAssigned(val);
    } catch (e) {
      toast.error(e.response?.data?.detail || "Failed to save barcode");
      setSavingCustom(false);
    }
  }

  async function clearBarcode() {
    setClearing(true);
    setClearConfirm(false);
    try {
      await api.patch(`/api/products/${product.id}/barcode`, { barcode: "" });
      toast.success("Barcode cleared");
      onAssigned(null);
    } catch (e) {
      toast.error(e.response?.data?.detail || "Failed to clear barcode");
      setClearing(false);
    }
  }

  return (
    <>
    <Modal title="Set GTIN / Barcode" onClose={onClose} width="max-w-xl">

      {/* Product context */}
      <div className="mb-4 px-3 py-2.5 bg-gray-50 rounded-lg border border-gray-200">
        <p className="text-xs text-gray-500 mb-0.5">Product</p>
        <p className="text-sm font-semibold text-gray-900">{product.name}</p>
        {product.default_code && (
          <p className="text-xs text-gray-400 font-mono mt-0.5">{product.default_code}</p>
        )}
      </div>

      {/* Current barcode */}
      {product.barcode && (
        <div className={`mb-4 px-3 py-2.5 rounded-lg border ${
          isPoolAssigned
            ? "bg-green-50 border-green-200"
            : "bg-amber-50 border-amber-200"
        }`}>
          <div className="flex items-center justify-between gap-3">
            <div className="min-w-0">
              <p className="text-xs font-medium mb-0.5 flex items-center gap-1.5">
                {isPoolAssigned
                  ? <><CheckCircle size={12} className="text-green-600 shrink-0" /><span className="text-green-700">Assigned from pool</span></>
                  : <><Tag size={12} className="text-amber-600 shrink-0" /><span className="text-amber-700">Custom barcode</span></>
                }
              </p>
              <p className="font-mono text-sm text-gray-800">{product.barcode}</p>
            </div>
            {isPoolAssigned ? (
              canManage ? (
                <div className="flex items-center gap-3 shrink-0">
                  <button onClick={() => setRetireOpen(true)} className="text-xs text-gray-600 hover:text-gray-800 font-medium flex items-center gap-1">
                    <Archive size={12} />Retire
                  </button>
                  <button onClick={() => setReleaseOpen(true)} className="text-xs text-orange-600 hover:text-orange-700 font-medium flex items-center gap-1">
                    <Undo2 size={12} />Return to pool
                  </button>
                </div>
              ) : null
            ) : (
              <button
                onClick={() => setClearConfirm(true)}
                disabled={clearing}
                className="text-xs text-red-500 hover:text-red-700 font-medium transition-colors flex items-center gap-1"
              >
                <X size={12} />Clear
              </button>
            )}
          </div>
        </div>
      )}

      {/* Confirm: clear custom barcode */}
      {clearConfirm && (
        <div className="mb-4 p-3 bg-red-50 border border-red-200 rounded-lg">
          <p className="text-sm text-red-800 mb-2">
            Clear the barcode <strong className="font-mono">{product.barcode}</strong> from <strong>{product.name}</strong>?
          </p>
          <div className="flex gap-2 justify-end">
            <BtnSecondary onClick={() => setClearConfirm(false)}>Cancel</BtnSecondary>
            <BtnDanger onClick={clearBarcode}>Clear barcode</BtnDanger>
          </div>
        </div>
      )}

      {/* 12.10 — GTINs whose product was deleted in Odoo: relink to this product */}
      {!product.barcode && orphans.length > 0 && (
        <div className="mb-5">
          <p className="text-sm font-medium text-gray-700 mb-1">GTINs from deleted products</p>
          <p className="text-xs text-gray-500 mb-2">
            If this product was recreated in Odoo, give it back its original GTIN here rather than a new one.
          </p>
          <div className="border border-gray-200 rounded-lg overflow-hidden max-h-40 overflow-y-auto">
            {orphans.map((o, i) => (
              <div key={o.gtin} className={`flex items-center justify-between gap-2 px-3 py-2 ${i > 0 ? "border-t border-gray-100" : ""} ${o.suggested ? "bg-green-50" : ""}`}>
                <div className="min-w-0">
                  <p className="font-mono text-sm text-gray-800">{o.gtin}</p>
                  <p className="text-[11px] text-gray-500 truncate">
                    Was {o.product_name || "unknown product"}{o.suggested && <span className="text-green-700 font-medium"> · name matches</span>}
                  </p>
                </div>
                <button onClick={() => relinkHere(o.gtin)} disabled={!!relinking}
                  className="text-xs font-medium px-3 py-1.5 rounded-lg border border-bassani-200 text-bassani-700 hover:bg-bassani-50 disabled:opacity-50 flex items-center gap-1.5 shrink-0">
                  {relinking === o.gtin ? <Loader2 size={12} className="animate-spin" /> : <Link2 size={12} />}Relink here
                </button>
              </div>
            ))}
          </div>
        </div>
      )}

      {/* Pool GTINs */}
      <div className="mb-5">
        <div className="flex items-center justify-between mb-2">
          <p className="text-sm font-medium text-gray-700">Assign from pool</p>
          <span className="text-xs text-gray-400">{available.length} available</span>
        </div>
        <div className="relative mb-3">
          <Search size={14} className="absolute left-2.5 top-1/2 -translate-y-1/2 text-gray-400 pointer-events-none" />
          <input
            value={search}
            onChange={e => setSearch(e.target.value)}
            placeholder="Filter by GTIN number…"
            className="w-full pl-8 pr-3 py-2 text-sm border border-gray-200 rounded-lg bg-white text-gray-900 placeholder-gray-400 focus:outline-none focus:ring-2 focus:ring-bassani-400"
          />
        </div>
        {loading ? (
          <div className="flex items-center justify-center py-8 text-gray-400">
            <Loader2 size={18} className="animate-spin mr-2" />
            <span className="text-sm">Loading pool…</span>
          </div>
        ) : filtered.length === 0 ? (
          <div className="text-center py-6 text-gray-400">
            <Tag size={24} className="mx-auto mb-1.5 opacity-40" />
            <p className="text-sm">
              {available.length === 0
                ? "No GTINs in pool yet. Add them in Settings > GTIN Pool."
                : "No GTINs match your search."}
            </p>
          </div>
        ) : (
          <div className="border border-gray-200 rounded-lg overflow-hidden max-h-48 overflow-y-auto">
            {filtered.map((g, i) => (
              <div
                key={g.gtin}
                className={`flex items-center justify-between px-3 py-2.5 ${i > 0 ? "border-t border-gray-100" : ""} hover:bg-gray-50`}
              >
                <span className="font-mono text-sm text-gray-800">{g.gtin}</span>
                <button
                  onClick={() => assignFromPool(g.gtin)}
                  disabled={!!assigning}
                  className="text-xs font-medium px-3 py-1.5 rounded-lg bg-bassani-600 text-white hover:bg-bassani-700 disabled:opacity-50 transition-colors flex items-center gap-1.5"
                >
                  {assigning === g.gtin && <Loader2 size={12} className="animate-spin" />}
                  Assign
                </button>
              </div>
            ))}
          </div>
        )}
      </div>

      {/* Custom GTIN */}
      <div className="pt-4 border-t border-gray-100">
        <p className="text-sm font-medium text-gray-700 mb-2">Or enter a custom barcode</p>
        <div className="flex gap-2">
          <input
            value={customGtin}
            onChange={e => setCustomGtin(e.target.value)}
            onKeyDown={e => { if (e.key === "Enter") applyCustom(); }}
            placeholder="e.g. 6009123456789"
            className="flex-1 text-sm font-mono border border-gray-200 rounded-lg px-3 py-2 bg-white text-gray-900 placeholder-gray-400 focus:outline-none focus:ring-2 focus:ring-bassani-400"
          />
          <BtnPrimary onClick={applyCustom} disabled={!customGtin.trim() || savingCustom} loading={savingCustom}>
            Apply
          </BtnPrimary>
        </div>
        <p className="text-xs text-gray-400 mt-1.5">
          Accepts any barcode format. Use a GS1-registered GTIN for pharmaceutical dispatch.
        </p>
      </div>

      <div className="flex justify-end mt-4 pt-3 border-t border-gray-100">
        <BtnSecondary onClick={onClose}>Close</BtnSecondary>
      </div>
    </Modal>
    {retireOpen && poolEntry && (
      <RetireModal item={{ gtin: poolEntry.gtin, product_name: product.name }} onClose={() => setRetireOpen(false)} onDone={() => onAssigned(null)} />
    )}
    {releaseOpen && poolEntry && (
      <ReleaseModal item={{ gtin: poolEntry.gtin, product_name: product.name }} onClose={() => setReleaseOpen(false)} onDone={() => onAssigned(null)} />
    )}
    </>
  );
}
