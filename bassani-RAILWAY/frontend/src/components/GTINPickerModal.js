import { useState, useEffect } from "react";
import { Search, CheckCircle, Loader2, Tag, Unlink } from "lucide-react";
import api from "../api";
import toast from "react-hot-toast";
import { Modal, BtnPrimary, BtnSecondary, BtnDanger } from "./UI";

export default function GTINPickerModal({ product, onClose, onAssigned }) {
  const [available, setAvailable]   = useState([]);
  const [poolEntry, setPoolEntry]   = useState(null);   // pool record for product's current barcode
  const [loading, setLoading]       = useState(true);
  const [search, setSearch]         = useState("");
  const [assigning, setAssigning]   = useState(null);   // gtin string currently being assigned
  const [unassigning, setUnassigning] = useState(false);
  const [unassignConfirm, setUnassignConfirm] = useState(false);

  useEffect(() => {
    load();
  }, []);

  async function load() {
    setLoading(true);
    try {
      const [availRes, entryRes] = await Promise.allSettled([
        api.get("/api/gtin-pool", { params: { status: "available", limit: 500 } }),
        product.barcode
          ? api.get(`/api/gtin-pool/${product.barcode}`)
          : Promise.reject(new Error("no barcode")),
      ]);
      setAvailable(availRes.status === "fulfilled" ? availRes.value.data.items : []);
      setPoolEntry(entryRes.status === "fulfilled" ? entryRes.value.data : null);
    } catch {
      setAvailable([]);
      setPoolEntry(null);
    } finally {
      setLoading(false);
    }
  }

  const filtered = available.filter(g =>
    !search || g.gtin.includes(search.trim())
  );

  async function assign(gtin) {
    setAssigning(gtin);
    try {
      await api.post(`/api/gtin-pool/${gtin}/assign`, {
        odoo_product_id: product.id,
        product_name: product.name,
      });
      toast.success(`GTIN ${gtin} assigned to ${product.name}`);
      onAssigned(gtin);
    } catch (e) {
      toast.error(e.response?.data?.detail || "Failed to assign GTIN");
      setAssigning(null);
    }
  }

  async function unassign() {
    setUnassigning(true);
    setUnassignConfirm(false);
    try {
      await api.post(`/api/gtin-pool/${product.barcode}/unassign`);
      toast.success("GTIN released back to pool");
      onAssigned(null);
    } catch (e) {
      toast.error(e.response?.data?.detail || "Failed to unassign GTIN");
      setUnassigning(false);
    }
  }

  const isPoolAssigned = poolEntry && poolEntry.status === "assigned";

  return (
    <Modal title="Assign GTIN from Pool" onClose={onClose} width="max-w-xl">
      {/* Product context */}
      <div className="mb-4 px-3 py-2.5 bg-gray-50 dark:bg-gray-800 rounded-lg border border-gray-200 dark:border-gray-700">
        <p className="text-xs text-gray-500 dark:text-gray-400 mb-0.5">Product</p>
        <p className="text-sm font-semibold text-gray-900 dark:text-gray-100">{product.name}</p>
        {product.default_code && (
          <p className="text-xs text-gray-400 dark:text-gray-500 font-mono mt-0.5">{product.default_code}</p>
        )}
      </div>

      {/* Current pool assignment */}
      {product.barcode && (
        <div className={`mb-4 px-3 py-2.5 rounded-lg border ${
          isPoolAssigned
            ? "bg-green-50 dark:bg-green-900/20 border-green-200 dark:border-green-700"
            : "bg-amber-50 dark:bg-amber-900/20 border-amber-200 dark:border-amber-700"
        }`}>
          <div className="flex items-center justify-between gap-3">
            <div className="min-w-0">
              <p className="text-xs font-medium mb-0.5 flex items-center gap-1.5">
                {isPoolAssigned
                  ? <><CheckCircle size={12} className="text-green-600 dark:text-green-400 shrink-0" /> <span className="text-green-700 dark:text-green-300">Assigned from pool</span></>
                  : <><Tag size={12} className="text-amber-600 dark:text-amber-400 shrink-0" /> <span className="text-amber-700 dark:text-amber-300">Current barcode (not in pool)</span></>
                }
              </p>
              <p className="font-mono text-sm text-gray-800 dark:text-gray-200">{product.barcode}</p>
            </div>
            {isPoolAssigned && (
              <BtnDanger
                onClick={() => setUnassignConfirm(true)}
                disabled={unassigning}
                loading={unassigning}
              >
                <Unlink size={12} />Unassign
              </BtnDanger>
            )}
          </div>
        </div>
      )}

      {/* Unassign confirm */}
      {unassignConfirm && (
        <div className="mb-4 p-3 bg-red-50 dark:bg-red-900/20 border border-red-200 dark:border-red-700 rounded-lg">
          <p className="text-sm text-red-800 dark:text-red-200 mb-2">
            This will clear the barcode from <strong>{product.name}</strong> in Odoo and return GTIN <strong className="font-mono">{product.barcode}</strong> to the available pool.
          </p>
          <div className="flex gap-2 justify-end">
            <BtnSecondary onClick={() => setUnassignConfirm(false)}>Cancel</BtnSecondary>
            <BtnDanger onClick={unassign}>Confirm Unassign</BtnDanger>
          </div>
        </div>
      )}

      {/* Available GTINs */}
      <div>
        <div className="flex items-center justify-between mb-2">
          <p className="text-sm font-medium text-gray-700 dark:text-gray-300">Available GTINs</p>
          <span className="text-xs text-gray-400 dark:text-gray-500">{available.length} available</span>
        </div>

        <div className="relative mb-3">
          <Search size={14} className="absolute left-2.5 top-1/2 -translate-y-1/2 text-gray-400 pointer-events-none" />
          <input
            value={search}
            onChange={e => setSearch(e.target.value)}
            placeholder="Filter by GTIN number…"
            className="w-full pl-8 pr-3 py-2 text-sm border border-gray-200 dark:border-gray-600 rounded-lg bg-white dark:bg-gray-800 text-gray-900 dark:text-gray-100 placeholder-gray-400 focus:outline-none focus:ring-2 focus:ring-bassani-400"
          />
        </div>

        {loading ? (
          <div className="flex items-center justify-center py-10 text-gray-400">
            <Loader2 size={20} className="animate-spin mr-2" />
            <span className="text-sm">Loading pool…</span>
          </div>
        ) : filtered.length === 0 ? (
          <div className="text-center py-8 text-gray-400 dark:text-gray-500">
            <Tag size={28} className="mx-auto mb-2 opacity-40" />
            <p className="text-sm">
              {available.length === 0
                ? "No GTINs in pool yet. Add them in Settings > GTIN Pool."
                : "No GTINs match your search."}
            </p>
          </div>
        ) : (
          <div className="border border-gray-200 dark:border-gray-700 rounded-lg overflow-hidden max-h-64 overflow-y-auto">
            {filtered.map((g, i) => (
              <div
                key={g.gtin}
                className={`flex items-center justify-between px-3 py-2.5 ${
                  i > 0 ? "border-t border-gray-100 dark:border-gray-700" : ""
                } hover:bg-gray-50 dark:hover:bg-gray-800/50`}
              >
                <span className="font-mono text-sm text-gray-800 dark:text-gray-200">{g.gtin}</span>
                <button
                  onClick={() => assign(g.gtin)}
                  disabled={!!assigning}
                  className="text-xs font-medium px-3 py-1.5 rounded-lg bg-bassani-600 text-white hover:bg-bassani-700 disabled:opacity-50 transition-colors flex items-center gap-1.5"
                >
                  {assigning === g.gtin
                    ? <Loader2 size={12} className="animate-spin" />
                    : null}
                  Assign
                </button>
              </div>
            ))}
          </div>
        )}
      </div>

      <div className="flex justify-end mt-4 pt-3 border-t border-gray-100 dark:border-gray-700">
        <BtnSecondary onClick={onClose}>Close</BtnSecondary>
      </div>
    </Modal>
  );
}
