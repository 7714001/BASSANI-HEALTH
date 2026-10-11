import { useState, useEffect, useCallback } from "react";
import { Loader2, Tag, Trash2, CheckCircle, AlertCircle, RefreshCw, Link2, Archive, Undo2, History } from "lucide-react";
import api from "../api";
import toast from "react-hot-toast";
import { useAuth } from "../AuthContext";
import { BtnPrimary, BtnSecondary, BtnDanger, Modal } from "../components/UI";
import { RelinkModal, RetireModal, ReleaseModal, GTINHistoryModal, BulkRelinkModal } from "../components/GTINActions";

export default function GTINPool({ embedded }) {
  const { can } = useAuth();
  const canManage = can("settings.manage");
  const [stats, setStats]         = useState({ total: 0, available: 0, assigned: 0, retired: 0 });
  const [items, setItems]         = useState([]);
  const [loading, setLoading]     = useState(true);
  const [statusFilter, setStatusFilter] = useState("all");  // all | available | assigned | retired

  // 12.10 — GTINs whose Odoo product was deleted (e.g. recreated in Odoo)
  const [orphans, setOrphans]       = useState([]);
  const [orphanError, setOrphanError] = useState(null);
  const [bulkOpen, setBulkOpen]     = useState(false);

  // Upload state
  const [uploadText, setUploadText]   = useState("");
  const [uploading, setUploading]     = useState(false);
  const [uploadResult, setUploadResult] = useState(null);  // { added, skipped, invalid }

  const [deleteConfirm, setDeleteConfirm] = useState(null);  // gtin string
  const [deleting, setDeleting]           = useState(false);
  const [retrying, setRetrying]           = useState(null);  // gtin string being retried
  const [relinkItem, setRelinkItem]       = useState(null);
  const [retireItem, setRetireItem]       = useState(null);
  const [releaseItem, setReleaseItem]     = useState(null);
  const [historyGtin, setHistoryGtin]     = useState(null);

  const loadOrphans = useCallback(async () => {
    try {
      const r = await api.get("/api/gtin-pool/orphans");
      setOrphans(r.data.items || []);
      setOrphanError(null);
    } catch (e) {
      setOrphans([]);
      setOrphanError(e.response?.data?.detail || "Could not check products in Odoo");
    }
  }, []);

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
  useEffect(() => { loadOrphans(); }, [loadOrphans]);
  const reloadAll = () => { load(); loadOrphans(); };

  const orphanSet = new Set(orphans.map(o => o.gtin));

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

  async function retrySync(gtin) {
    setRetrying(gtin);
    try {
      await api.post(`/api/gtin-pool/${gtin}/retry-sync`);
      toast.success(`GTIN ${gtin} synced to Odoo`);
      load();
    } catch (e) {
      toast.error(e.response?.data?.detail || "Still failed to sync to Odoo");
    } finally {
      setRetrying(null);
    }
  }

  const StatCard = ({ label, value, color }) => (
    <div className="bg-white rounded-xl border border-gray-200 px-5 py-4 flex-1">
      <p className="text-xs text-gray-500 font-medium mb-1">{label}</p>
      <p className={`text-2xl font-bold ${color}`}>{value}</p>
    </div>
  );

  const actionBtn = "text-xs flex items-center gap-1 transition-colors";

  return (
    <div className={embedded ? "flex-1 overflow-auto p-6" : "p-6"}>
      <div className="max-w-4xl mx-auto w-full space-y-6">

        {/* Stats */}
        <div className="flex flex-wrap gap-4">
          <StatCard label="Total GTINs"  value={stats.total}     color="text-gray-800" />
          <StatCard label="Available"    value={stats.available} color="text-green-600" />
          <StatCard label="Assigned"     value={stats.assigned}  color="text-bassani-600" />
          <StatCard label="Retired"      value={stats.retired || 0} color="text-gray-500" />
        </div>

        {/* Products deleted in Odoo */}
        {orphans.length > 0 && (
          <div className="rounded-xl border border-red-200 bg-red-50 px-5 py-4 flex flex-wrap items-center justify-between gap-3">
            <div className="min-w-0">
              <p className="text-sm font-semibold text-red-800">
                {orphans.length} GTIN{orphans.length !== 1 ? "s are" : " is"} linked to products that no longer exist in Odoo
              </p>
              <p className="text-xs text-red-700 mt-0.5">
                Usually because the products were deleted and recreated. Relink each GTIN to its new product record; it's the
                same physical product, so it keeps the same GTIN.
              </p>
            </div>
            <BtnPrimary onClick={() => setBulkOpen(true)}><Link2 size={14} />Relink</BtnPrimary>
          </div>
        )}
        {orphanError && (
          <p className="text-xs text-amber-700">Couldn't check for deleted products: {orphanError}</p>
        )}

        {/* Upload */}
        <div className="bg-white rounded-xl border border-gray-200 p-5">
          <h3 className="text-sm font-semibold text-gray-800 mb-1">Add GTINs to Pool</h3>
          <p className="text-xs text-gray-500 mb-3">
            Paste GTIN codes below, one per line (or comma-separated). GS1 check digit is validated before saving.
          </p>
          <textarea
            value={uploadText}
            onChange={e => { setUploadText(e.target.value); setUploadResult(null); }}
            rows={5}
            placeholder={"6009123456789\n6009123456796\n6009123456802\n…"}
            className="w-full text-sm font-mono border border-gray-200 rounded-lg px-3 py-2 bg-gray-50 text-gray-900 placeholder-gray-400 focus:outline-none focus:ring-2 focus:ring-bassani-400 resize-y"
          />

          {uploadResult && (
            <div className="mt-2 flex flex-wrap gap-3 text-xs">
              {uploadResult.added > 0 && (
                <span className="flex items-center gap-1 text-green-700">
                  <CheckCircle size={12} /> {uploadResult.added} added
                </span>
              )}
              {uploadResult.skipped > 0 && (
                <span className="text-gray-500">
                  {uploadResult.skipped} already in pool (skipped)
                </span>
              )}
              {uploadResult.invalid?.length > 0 && (
                <span className="flex items-center gap-1 text-red-600">
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
        <div className="bg-white rounded-xl border border-gray-200 overflow-hidden">
          <div className="flex items-center justify-between px-5 py-3 border-b border-gray-100">
            <h3 className="text-sm font-semibold text-gray-800">GTIN Registry</h3>
            <div className="flex gap-1">
              {["all", "available", "assigned", "retired"].map(f => (
                <button
                  key={f}
                  onClick={() => setStatusFilter(f)}
                  className={`text-xs px-3 py-1.5 rounded-lg font-medium transition-colors capitalize ${
                    statusFilter === f
                      ? "bg-bassani-100 text-bassani-700"
                      : "text-gray-500 hover:text-gray-700"
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
            <div className="text-center py-12 text-gray-400">
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
                  <tr className="text-left text-xs font-medium text-gray-500 bg-gray-50">
                    <th className="px-5 py-2.5">GTIN</th>
                    <th className="px-5 py-2.5">Status</th>
                    <th className="px-5 py-2.5">Product</th>
                    <th className="px-5 py-2.5">Assigned</th>
                    <th className="px-5 py-2.5 text-right">Actions</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-gray-100">
                  {items.map(item => {
                    const orphaned = orphanSet.has(item.gtin);
                    return (
                      <tr key={item.gtin} className="hover:bg-gray-50 transition-colors">
                        <td className="px-5 py-3 font-mono text-gray-800">
                          <button onClick={() => setHistoryGtin(item.gtin)} title="View history" className="hover:underline">{item.gtin}</button>
                        </td>
                        <td className="px-5 py-3">
                          <div className="flex flex-col items-start gap-1">
                            {item.status === "assigned" ? (
                              <span className="inline-flex items-center gap-1 text-xs font-medium px-2 py-0.5 rounded-full bg-bassani-100 text-bassani-700">
                                <CheckCircle size={11} /> Assigned
                              </span>
                            ) : item.status === "retired" ? (
                              <span title={item.retired_reason || ""} className="inline-flex items-center gap-1 text-xs font-medium px-2 py-0.5 rounded-full bg-gray-100 text-gray-600">
                                <Archive size={11} /> Retired
                              </span>
                            ) : (
                              <span className="inline-flex items-center gap-1 text-xs font-medium px-2 py-0.5 rounded-full bg-green-100 text-green-700">
                                Available
                              </span>
                            )}
                            {orphaned && (
                              <span className="inline-flex items-center gap-1 text-xs font-medium px-2 py-0.5 rounded-full bg-red-100 text-red-700">
                                <AlertCircle size={11} /> Product deleted in Odoo
                              </span>
                            )}
                            {item.status === "assigned" && !orphaned && item.odoo_synced === false && (
                              <span
                                title={item.sync_error || "Not synced to Odoo"}
                                className="inline-flex items-center gap-1 text-xs font-medium px-2 py-0.5 rounded-full bg-amber-100 text-amber-700"
                              >
                                <AlertCircle size={11} /> Not synced to Odoo
                              </span>
                            )}
                          </div>
                        </td>
                        <td className="px-5 py-3 text-gray-600 max-w-[200px] truncate">
                          {item.product_name || <span className="text-gray-300">—</span>}
                        </td>
                        <td className="px-5 py-3 text-gray-400 text-xs whitespace-nowrap">
                          {item.assigned_at
                            ? new Date(item.assigned_at).toLocaleDateString("en-ZA", { day: "2-digit", month: "short", year: "numeric", timeZone: "Africa/Johannesburg" })
                            : <span className="text-gray-300">—</span>}
                        </td>
                        <td className="px-5 py-3 text-right">
                          {item.status === "assigned" ? (
                            <div className="flex items-center justify-end gap-3 flex-wrap">
                              {item.odoo_synced === false && !orphaned && (
                                <button onClick={() => retrySync(item.gtin)} disabled={retrying === item.gtin}
                                  className={`${actionBtn} text-amber-600 hover:text-amber-700`}>
                                  {retrying === item.gtin ? <Loader2 size={12} className="animate-spin" /> : <RefreshCw size={12} />}
                                  Retry Sync
                                </button>
                              )}
                              <button onClick={() => setRelinkItem(item)} className={`${actionBtn} text-bassani-700 hover:text-bassani-800`}>
                                <Link2 size={12} /> Relink
                              </button>
                              {canManage && (
                                <button onClick={() => setRetireItem(item)} className={`${actionBtn} text-gray-500 hover:text-gray-700`}>
                                  <Archive size={12} /> Retire
                                </button>
                              )}
                              {canManage && (
                                <button onClick={() => setReleaseItem(item)} className={`${actionBtn} text-orange-600 hover:text-orange-700`}>
                                  <Undo2 size={12} /> Return to pool
                                </button>
                              )}
                            </div>
                          ) : item.status === "retired" ? (
                            <button onClick={() => setHistoryGtin(item.gtin)} className={`${actionBtn} text-gray-400 hover:text-gray-600 ml-auto`}>
                              <History size={12} /> History
                            </button>
                          ) : (
                            <button
                              onClick={() => setDeleteConfirm(item.gtin)}
                              disabled={deleting}
                              className={`${actionBtn} text-gray-400 hover:text-red-500 ml-auto`}
                            >
                              <Trash2 size={12} /> Remove
                            </button>
                          )}
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          )}
        </div>
      </div>

      {/* Delete confirm */}
      {deleteConfirm && (
        <Modal title="Remove GTIN" onClose={() => setDeleteConfirm(null)}>
          <p className="text-sm text-gray-600 mb-4">
            Remove <strong className="font-mono">{deleteConfirm}</strong> from the pool? It will no longer be selectable when assigning GTINs to products.
          </p>
          <div className="flex justify-end gap-2">
            <BtnSecondary onClick={() => setDeleteConfirm(null)}>Cancel</BtnSecondary>
            <BtnDanger onClick={doDelete}>Remove</BtnDanger>
          </div>
        </Modal>
      )}

      {relinkItem && <RelinkModal item={relinkItem} onClose={() => setRelinkItem(null)} onDone={reloadAll} />}
      {retireItem && <RetireModal item={retireItem} onClose={() => setRetireItem(null)} onDone={reloadAll} />}
      {releaseItem && <ReleaseModal item={releaseItem} onClose={() => setReleaseItem(null)} onDone={reloadAll} />}
      {historyGtin && <GTINHistoryModal gtin={historyGtin} onClose={() => setHistoryGtin(null)} />}
      {bulkOpen && <BulkRelinkModal orphans={orphans} onClose={() => setBulkOpen(false)} onDone={reloadAll} />}
    </div>
  );
}
