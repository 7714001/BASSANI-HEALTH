import { useState, useEffect, useCallback } from "react";
import { Loader2, Tag, Trash2, Unlink, CheckCircle, AlertCircle } from "lucide-react";
import api from "../api";
import toast from "react-hot-toast";
import { BtnPrimary, BtnSecondary, BtnDanger, Modal } from "../components/UI";

export default function GTINPool({ embedded }) {
  const [stats, setStats]         = useState({ total: 0, available: 0, assigned: 0 });
  const [items, setItems]         = useState([]);
  const [loading, setLoading]     = useState(true);
  const [statusFilter, setStatusFilter] = useState("all");  // "all" | "available" | "assigned"

  // Upload state
  const [uploadText, setUploadText]   = useState("");
  const [uploading, setUploading]     = useState(false);
  const [uploadResult, setUploadResult] = useState(null);  // { added, skipped, invalid }

  // Confirm modals
  const [deleteConfirm, setDeleteConfirm]     = useState(null);  // gtin string
  const [unassignConfirm, setUnassignConfirm] = useState(null);  // pool item
  const [deleting, setDeleting]               = useState(false);
  const [unassigning, setUnassigning]         = useState(false);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const params = statusFilter !== "all" ? { status: statusFilter } : {};
      const [statsRes, listRes] = await Promise.all([
        api.get("/api/gtin-pool/stats"),
        api.get("/api/gtin-pool", { params: { ...params, limit: 500 } }),
      ]);
      setStats(statsRes.data);
      setItems(listRes.data.items);
    } catch {
      toast.error("Failed to load GTIN pool");
    } finally {
      setLoading(false);
    }
  }, [statusFilter]);

  useEffect(() => { load(); }, [load]);

  async function upload() {
    const lines = uploadText.split(/[\n,]+/).map(l => l.trim()).filter(Boolean);
    if (!lines.length) {
      toast.error("Paste at least one GTIN to add.");
      return;
    }
    setUploading(true);
    setUploadResult(null);
    try {
      const r = await api.post("/api/gtin-pool/bulk-add", { gtins: lines });
      setUploadResult(r.data);
      if (r.data.added > 0) {
        setUploadText("");
        load();
      }
    } catch (e) {
      toast.error(e.response?.data?.detail || "Upload failed");
    } finally {
      setUploading(false);
    }
  }

  async function doDelete() {
    const gtin = deleteConfirm;
    setDeleteConfirm(null);
    setDeleting(true);
    try {
      await api.delete(`/api/gtin-pool/${gtin}`);
      toast.success(`GTIN ${gtin} removed from pool`);
      load();
    } catch (e) {
      toast.error(e.response?.data?.detail || "Failed to remove GTIN");
    } finally {
      setDeleting(false);
    }
  }

  async function doUnassign() {
    const item = unassignConfirm;
    setUnassignConfirm(null);
    setUnassigning(true);
    try {
      await api.post(`/api/gtin-pool/${item.gtin}/unassign`);
      toast.success(`GTIN ${item.gtin} released from ${item.product_name}`);
      load();
    } catch (e) {
      toast.error(e.response?.data?.detail || "Failed to unassign GTIN");
    } finally {
      setUnassigning(false);
    }
  }

  const StatCard = ({ label, value, color }) => (
    <div className="bg-white dark:bg-gray-800 rounded-xl border border-gray-200 dark:border-gray-700 px-5 py-4 flex-1">
      <p className="text-xs text-gray-500 dark:text-gray-400 font-medium mb-1">{label}</p>
      <p className={`text-2xl font-bold ${color}`}>{value}</p>
    </div>
  );

  return (
    <div className={embedded ? "flex-1 overflow-auto p-6" : "p-6"}>
      <div className="max-w-4xl mx-auto w-full space-y-6">

        {/* Stats */}
        <div className="flex gap-4">
          <StatCard label="Total GTINs"  value={stats.total}     color="text-gray-800 dark:text-gray-100" />
          <StatCard label="Available"    value={stats.available} color="text-green-600 dark:text-green-400" />
          <StatCard label="Assigned"     value={stats.assigned}  color="text-bassani-600 dark:text-bassani-400" />
        </div>

        {/* Upload */}
        <div className="bg-white dark:bg-gray-800 rounded-xl border border-gray-200 dark:border-gray-700 p-5">
          <h3 className="text-sm font-semibold text-gray-800 dark:text-gray-100 mb-1">Add GTINs to Pool</h3>
          <p className="text-xs text-gray-500 dark:text-gray-400 mb-3">
            Paste GTIN codes below, one per line (or comma-separated). GS1 check digit is validated before saving.
          </p>
          <textarea
            value={uploadText}
            onChange={e => { setUploadText(e.target.value); setUploadResult(null); }}
            rows={5}
            placeholder={"6009123456789\n6009123456796\n6009123456802\n…"}
            className="w-full text-sm font-mono border border-gray-200 dark:border-gray-600 rounded-lg px-3 py-2 bg-gray-50 dark:bg-gray-900 text-gray-900 dark:text-gray-100 placeholder-gray-400 focus:outline-none focus:ring-2 focus:ring-bassani-400 resize-y"
          />

          {uploadResult && (
            <div className="mt-2 flex flex-wrap gap-3 text-xs">
              {uploadResult.added > 0 && (
                <span className="flex items-center gap-1 text-green-700 dark:text-green-400">
                  <CheckCircle size={12} /> {uploadResult.added} added
                </span>
              )}
              {uploadResult.skipped > 0 && (
                <span className="text-gray-500 dark:text-gray-400">
                  {uploadResult.skipped} already in pool (skipped)
                </span>
              )}
              {uploadResult.invalid?.length > 0 && (
                <span className="flex items-center gap-1 text-red-600 dark:text-red-400">
                  <AlertCircle size={12} /> {uploadResult.invalid.length} invalid: {uploadResult.invalid.join(", ")}
                </span>
              )}
            </div>
          )}

          <div className="mt-3 flex justify-end">
            <BtnPrimary onClick={upload} disabled={uploading || !uploadText.trim()}>
              {uploading ? <Loader2 size={14} className="animate-spin mr-1.5" /> : null}
              {uploading ? "Adding…" : "Add to Pool"}
            </BtnPrimary>
          </div>
        </div>

        {/* GTIN table */}
        <div className="bg-white dark:bg-gray-800 rounded-xl border border-gray-200 dark:border-gray-700 overflow-hidden">
          <div className="flex items-center justify-between px-5 py-3 border-b border-gray-100 dark:border-gray-700">
            <h3 className="text-sm font-semibold text-gray-800 dark:text-gray-100">GTIN Registry</h3>
            <div className="flex gap-1">
              {["all", "available", "assigned"].map(f => (
                <button
                  key={f}
                  onClick={() => setStatusFilter(f)}
                  className={`text-xs px-3 py-1.5 rounded-lg font-medium transition-colors capitalize ${
                    statusFilter === f
                      ? "bg-bassani-100 text-bassani-700 dark:bg-bassani-900/40 dark:text-bassani-300"
                      : "text-gray-500 dark:text-gray-400 hover:text-gray-700 dark:hover:text-gray-200"
                  }`}
                >
                  {f}
                </button>
              ))}
            </div>
          </div>

          {loading ? (
            <div className="flex items-center justify-center py-12 text-gray-400">
              <Loader2 size={18} className="animate-spin mr-2" />
              <span className="text-sm">Loading…</span>
            </div>
          ) : items.length === 0 ? (
            <div className="text-center py-12 text-gray-400 dark:text-gray-500">
              <Tag size={32} className="mx-auto mb-2 opacity-30" />
              <p className="text-sm">
                {statusFilter === "all"
                  ? "No GTINs in pool yet. Add them above."
                  : `No ${statusFilter} GTINs.`}
              </p>
            </div>
          ) : (
            <div className="overflow-x-auto">
              <table className="w-full text-sm">
                <thead>
                  <tr className="text-left text-xs font-medium text-gray-500 dark:text-gray-400 bg-gray-50 dark:bg-gray-900/50">
                    <th className="px-5 py-2.5">GTIN</th>
                    <th className="px-5 py-2.5">Status</th>
                    <th className="px-5 py-2.5">Product</th>
                    <th className="px-5 py-2.5">Assigned</th>
                    <th className="px-5 py-2.5 text-right">Actions</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-gray-100 dark:divide-gray-700">
                  {items.map(item => (
                    <tr key={item.gtin} className="hover:bg-gray-50 dark:hover:bg-gray-800/50 transition-colors">
                      <td className="px-5 py-3 font-mono text-gray-800 dark:text-gray-200">{item.gtin}</td>
                      <td className="px-5 py-3">
                        {item.status === "assigned" ? (
                          <span className="inline-flex items-center gap-1 text-xs font-medium px-2 py-0.5 rounded-full bg-bassani-100 text-bassani-700 dark:bg-bassani-900/40 dark:text-bassani-300">
                            <CheckCircle size={11} /> Assigned
                          </span>
                        ) : (
                          <span className="inline-flex items-center gap-1 text-xs font-medium px-2 py-0.5 rounded-full bg-green-100 text-green-700 dark:bg-green-900/30 dark:text-green-300">
                            Available
                          </span>
                        )}
                      </td>
                      <td className="px-5 py-3 text-gray-600 dark:text-gray-300 max-w-[200px] truncate">
                        {item.product_name || <span className="text-gray-300 dark:text-gray-600">—</span>}
                      </td>
                      <td className="px-5 py-3 text-gray-400 dark:text-gray-500 text-xs whitespace-nowrap">
                        {item.assigned_at
                          ? new Date(item.assigned_at).toLocaleDateString("en-ZA", { day: "2-digit", month: "short", year: "numeric" })
                          : <span className="text-gray-300 dark:text-gray-600">—</span>}
                      </td>
                      <td className="px-5 py-3 text-right">
                        {item.status === "assigned" ? (
                          <button
                            onClick={() => setUnassignConfirm(item)}
                            disabled={unassigning}
                            className="text-xs text-orange-600 dark:text-orange-400 hover:text-orange-700 flex items-center gap-1 ml-auto"
                          >
                            <Unlink size={12} /> Unassign
                          </button>
                        ) : (
                          <button
                            onClick={() => setDeleteConfirm(item.gtin)}
                            disabled={deleting}
                            className="text-xs text-gray-400 hover:text-red-500 flex items-center gap-1 ml-auto transition-colors"
                          >
                            <Trash2 size={12} /> Remove
                          </button>
                        )}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </div>
      </div>

      {/* Delete confirm */}
      {deleteConfirm && (
        <Modal title="Remove GTIN" onClose={() => setDeleteConfirm(null)}>
          <p className="text-sm text-gray-600 dark:text-gray-300 mb-4">
            Remove <strong className="font-mono">{deleteConfirm}</strong> from the pool? It will no longer be selectable when assigning GTINs to products.
          </p>
          <div className="flex justify-end gap-2">
            <BtnSecondary onClick={() => setDeleteConfirm(null)}>Cancel</BtnSecondary>
            <BtnDanger onClick={doDelete}>Remove</BtnDanger>
          </div>
        </Modal>
      )}

      {/* Unassign confirm */}
      {unassignConfirm && (
        <Modal title="Unassign GTIN" onClose={() => setUnassignConfirm(null)}>
          <p className="text-sm text-gray-600 dark:text-gray-300 mb-4">
            Unassign <strong className="font-mono">{unassignConfirm.gtin}</strong> from <strong>{unassignConfirm.product_name}</strong>? This clears the barcode from the product in Odoo and returns the GTIN to the available pool.
          </p>
          <div className="flex justify-end gap-2">
            <BtnSecondary onClick={() => setUnassignConfirm(null)}>Cancel</BtnSecondary>
            <BtnDanger onClick={doUnassign}>Unassign</BtnDanger>
          </div>
        </Modal>
      )}
    </div>
  );
}
