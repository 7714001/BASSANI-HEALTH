import { useState, useEffect, useCallback } from "react";
import { Loader2, RefreshCw, ShieldCheck, AlertTriangle, CheckCircle, FileQuestion } from "lucide-react";
import api from "../api";
import toast from "react-hot-toast";
import { useAuth } from "../AuthContext";
import { TopBar, BtnPrimary, BtnSecondary, BtnDanger, Modal } from "../components/UI";
import { fmtWhen, batchTitle } from "./BatchRegistry";
import ProductionGuideButton from "../components/ProductionGuide";

/* Phase 13.0.7 — S6 Releases: the Responsible Pharmacist's queue.
   Every imported receipt sits in quarantine until it is released here.
   Segregation of duties: the receiver records the facts; the RP verifies
   and releases (or queries). Flagged no-PO receipts must be resolved by
   compliance (production.manage) before release is possible. */

const DOC_LABELS = { invoice: "Invoice", coa: "COA", delivery_note: "Delivery Note", s6_transfer: "S6 Transfer Doc" };

export default function S6Releases() {
  const { can } = useAuth();
  const [items, setItems]     = useState([]);
  const [loading, setLoading] = useState(true);

  const [releaseConfirm, setReleaseConfirm] = useState(null);  // receipt
  const [queryTarget, setQueryTarget]       = useState(null);  // receipt
  const [queryNote, setQueryNote]           = useState("");
  const [resolveTarget, setResolveTarget]   = useState(null);  // receipt
  const [resolveNote, setResolveNote]       = useState("");
  const [busy, setBusy]                     = useState(false);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const r = await api.get("/api/production/s6-register", { params: { status: "pending", limit: 200 } });
      setItems(r.data.items);
    } catch (e) {
      toast.error(e.response?.data?.detail || "Failed to load the release queue");
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => { load(); }, [load]);

  async function doRelease() {
    const r = releaseConfirm;
    setReleaseConfirm(null);
    setBusy(true);
    try {
      await api.post(`/api/production/s6/${r.id}/release`);
      toast.success(`${r.batch_id} released. It can now be issued from the vault.`);
      load();
    } catch (e) {
      toast.error(e.response?.data?.detail || "Failed to release");
    } finally {
      setBusy(false);
    }
  }

  async function doQuery() {
    const r = queryTarget;
    setQueryTarget(null);
    setBusy(true);
    try {
      await api.post(`/api/production/s6/${r.id}/query`, { note: queryNote });
      toast.success(`${r.batch_id} marked as queried`);
      setQueryNote("");
      load();
    } catch (e) {
      toast.error(e.response?.data?.detail || "Failed to record the query");
    } finally {
      setBusy(false);
    }
  }

  async function doResolve() {
    const r = resolveTarget;
    setResolveTarget(null);
    setBusy(true);
    try {
      await api.post(`/api/production/s6/${r.id}/resolve-flag`, { note: resolveNote });
      toast.success("Flag resolved. The receipt can now be released.");
      setResolveNote("");
      load();
    } catch (e) {
      toast.error(e.response?.data?.detail || "Failed to resolve the flag");
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="flex flex-col h-full overflow-hidden">
      <TopBar
        title="S6 Releases"
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
        <div className="max-w-4xl mx-auto w-full space-y-4">
          <p className="text-xs text-gray-500 dark:text-gray-400">
            Imported stock stays in quarantine until it is released here. Check the delivery documents and quantities against the receipt, then release the batch or raise a query. Your release is recorded permanently with your name and the time.
          </p>

          {loading ? (
            <div className="flex items-center justify-center py-16 text-gray-400">
              <Loader2 size={18} className="animate-spin mr-2" /> <span className="text-sm">Loading…</span>
            </div>
          ) : items.length === 0 ? (
            <div className="text-center py-16 text-gray-400 dark:text-gray-500">
              <ShieldCheck size={36} className="mx-auto mb-2 opacity-30" />
              <p className="text-sm">Nothing awaiting release. All imported stock has been signed off.</p>
            </div>
          ) : items.map(r => {
            const flagged   = r.po_flag?.flagged && !r.po_flag?.resolved;
            const docsIn    = Object.entries(r.docs || {}).filter(([, v]) => v).map(([k]) => DOC_LABELS[k]);
            const docsOut   = Object.entries(r.docs || {}).filter(([, v]) => !v).map(([k]) => DOC_LABELS[k]);
            return (
              <div key={r.id} className={`bg-white dark:bg-gray-800 rounded-xl border p-5 ${
                flagged ? "border-red-200 dark:border-red-900" : r.status === "queried" ? "border-amber-300 dark:border-amber-800" : "border-gray-200 dark:border-gray-700"
              }`}>
                <div className="flex flex-wrap items-start justify-between gap-3">
                  <div className="min-w-0">
                    <p className="font-mono text-sm font-semibold text-gray-800 dark:text-gray-100" title={batchTitle(r.batch_id, r.product_name)}>{r.batch_id}</p>
                    <p className="text-sm text-gray-600 dark:text-gray-300 mt-0.5">
                      {r.product_name} <span className="text-gray-400">· {r.type_label}{r.subcat ? ` · ${r.subcat}` : ""}</span>
                    </p>
                    <p className="text-xs text-gray-400 mt-0.5">
                      {r.supplier_name} · received {fmtWhen(r.created_at)} by {r.actor_name}
                    </p>
                  </div>
                  <div className="text-right shrink-0">
                    <p className="text-sm font-semibold text-gray-800 dark:text-gray-100">{r.qty_received} received</p>
                    {r.discrepancy ? (
                      <p className="text-xs text-amber-600 dark:text-amber-400">quoted {r.qty_quoted} (short {r.discrepancy})</p>
                    ) : r.qty_quoted ? (
                      <p className="text-xs text-green-600 dark:text-green-400">matches quoted</p>
                    ) : null}
                  </div>
                </div>

                <div className="flex flex-wrap gap-x-5 gap-y-1 mt-3 text-xs">
                  <span className="text-gray-500 dark:text-gray-400">
                    PO: {r.po_name
                      ? <span className="font-mono text-gray-700 dark:text-gray-200">{r.po_name}</span>
                      : flagged
                        ? <span className="text-red-600 dark:text-red-400 font-medium">none — flagged for investigation</span>
                        : r.po_flag?.resolved
                          ? <span title={r.po_flag.note}>none — flag resolved: {r.po_flag.note}</span>
                          : "none"}
                  </span>
                  {docsIn.length > 0 && (
                    <span className="text-green-600 dark:text-green-400 flex items-center gap-1"><CheckCircle size={11} /> {docsIn.join(", ")}</span>
                  )}
                  {docsOut.length > 0 && (
                    <span className="text-amber-600 dark:text-amber-400 flex items-center gap-1"><AlertTriangle size={11} /> Missing: {docsOut.join(", ")}</span>
                  )}
                </div>

                {r.status === "queried" && r.query_note && (
                  <p className="mt-2 text-xs text-amber-700 dark:text-amber-300 bg-amber-50 dark:bg-amber-900/20 rounded-lg px-3 py-2">
                    Query on record: {r.query_note}
                  </p>
                )}
                {r.comment && (
                  <p className="mt-2 text-xs text-gray-500 dark:text-gray-400">Receiver's note: {r.comment}</p>
                )}

                <div className="flex justify-end gap-2 mt-4">
                  {flagged && can("production.manage") && (
                    <BtnSecondary onClick={() => { setResolveTarget(r); setResolveNote(""); }} disabled={busy}>
                      Resolve flag
                    </BtnSecondary>
                  )}
                  {can("production.rp_release") && (
                    <>
                      <BtnDanger onClick={() => { setQueryTarget(r); setQueryNote(""); }} disabled={busy}>
                        <FileQuestion size={14} /> Query
                      </BtnDanger>
                      <BtnPrimary onClick={() => setReleaseConfirm(r)} disabled={busy || flagged}
                        title={flagged ? "The no-purchase-order flag must be resolved first" : ""}>
                        <ShieldCheck size={14} /> Release
                      </BtnPrimary>
                    </>
                  )}
                </div>
              </div>
            );
          })}
        </div>
      </div>

      {/* Release confirm */}
      {releaseConfirm && (
        <Modal title="Release Batch" onClose={() => setReleaseConfirm(null)}>
          <p className="text-sm text-gray-600 dark:text-gray-300 mb-2">
            Release <strong className="font-mono">{releaseConfirm.batch_id}</strong> ({releaseConfirm.product_name}, {releaseConfirm.qty_received} received from {releaseConfirm.supplier_name})?
          </p>
          <p className="text-sm text-gray-600 dark:text-gray-300 mb-4">
            This is your Schedule 6 sign-off. The batch becomes available for issue from the vault, and the release is recorded permanently under your name.
          </p>
          <div className="flex justify-end gap-2">
            <BtnSecondary onClick={() => setReleaseConfirm(null)}>Cancel</BtnSecondary>
            <BtnPrimary onClick={doRelease}><ShieldCheck size={14} /> Release Batch</BtnPrimary>
          </div>
        </Modal>
      )}

      {/* Query modal */}
      {queryTarget && (
        <Modal title="Query Receipt" onClose={() => setQueryTarget(null)}>
          <p className="text-sm text-gray-600 dark:text-gray-300 mb-3">
            The batch stays locked in quarantine and your note goes on record. Describe what needs to be checked before <span className="font-mono">{queryTarget.batch_id}</span> can be released.
          </p>
          <textarea
            value={queryNote}
            onChange={e => setQueryNote(e.target.value)}
            rows={3}
            placeholder="e.g. COA missing, weight difference needs explanation from the supplier…"
            className="w-full text-sm border border-gray-200 dark:border-gray-600 rounded-lg px-3 py-2 bg-gray-50 dark:bg-gray-900 text-gray-900 dark:text-gray-100 placeholder-gray-400 focus:outline-none focus:ring-2 focus:ring-bassani-400 resize-y"
          />
          <div className="flex justify-end gap-2 mt-4">
            <BtnSecondary onClick={() => setQueryTarget(null)}>Cancel</BtnSecondary>
            <BtnDanger onClick={doQuery} disabled={!queryNote.trim()}>Record Query</BtnDanger>
          </div>
        </Modal>
      )}

      {/* Resolve flag modal */}
      {resolveTarget && (
        <Modal title="Resolve Investigation Flag" onClose={() => setResolveTarget(null)}>
          <p className="text-sm text-gray-600 dark:text-gray-300 mb-3">
            This receipt was flagged because no purchase order was found. Record the outcome of the investigation for <span className="font-mono">{resolveTarget.batch_id}</span>. Once resolved, the Responsible Pharmacist can release the batch.
          </p>
          <textarea
            value={resolveNote}
            onChange={e => setResolveNote(e.target.value)}
            rows={3}
            placeholder="e.g. PO raised retrospectively as P00123 after confirming the order with the supplier…"
            className="w-full text-sm border border-gray-200 dark:border-gray-600 rounded-lg px-3 py-2 bg-gray-50 dark:bg-gray-900 text-gray-900 dark:text-gray-100 placeholder-gray-400 focus:outline-none focus:ring-2 focus:ring-bassani-400 resize-y"
          />
          <div className="flex justify-end gap-2 mt-4">
            <BtnSecondary onClick={() => setResolveTarget(null)}>Cancel</BtnSecondary>
            <BtnPrimary onClick={doResolve} disabled={!resolveNote.trim()}>Resolve Flag</BtnPrimary>
          </div>
        </Modal>
      )}
    </div>
  );
}
