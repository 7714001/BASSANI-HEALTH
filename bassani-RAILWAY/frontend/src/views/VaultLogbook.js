import { useState, useEffect, useCallback, useMemo, useRef, Fragment } from "react";
import {
  Loader2, RefreshCw, Vault, ArrowDownToLine, ArrowUpFromLine, Scissors,
  PackageOpen, CloudOff, CloudUpload, NotebookPen, Trash2, Radar, Building2,
  Warehouse, MapPin, XCircle, ChevronRight,
} from "lucide-react";
import api from "../api";
import toast from "react-hot-toast";
import { useAuth } from "../AuthContext";
import { TopBar, BtnPrimary, BtnSecondary, BtnDanger, Modal } from "../components/UI";
import { SyncBadge, fmtWhen, stageLabel, batchTitle } from "./BatchRegistry";
import ProductionGuideButton from "../components/ProductionGuide";

/* Phase 13.0.3 + 13.0.4 — Vault Transaction Logbook + Vault Ledger.
   Digital replacement for the paper "Vault Transaction Logbook": every gram
   crossing the vault threshold is recorded against a registry batch ID, with
   the actor and timestamp captured automatically. */

const MOVE_TYPES = [
  { key: "receive",           label: "Receive to Vault",        icon: ArrowDownToLine, hint: "Stock arriving into the vault" },
  { key: "issue_packing",     label: "Issue to Packing",        icon: PackageOpen,     hint: "Stock going out to the packing room" },
  { key: "issue_manicuring",  label: "Issue to Manicuring",     icon: ArrowUpFromLine, hint: "Unmanicured bulk going out for manicuring" },
  { key: "return_manicuring", label: "Return from Manicuring",  icon: Scissors,        hint: "Manicured flower and trim coming back in" },
];

const MOVE_LABEL = Object.fromEntries(MOVE_TYPES.map(m => [m.key, m.label]));

const RECEIVE_SOURCES = [
  { key: "production",        label: "From production" },
  { key: "external_supplier", label: "From external supplier" },
  { key: "opening_balance",   label: "Opening balance" },
];

const fmtQty = (g) => {
  if (g == null) return "";
  const abs = Math.abs(g);
  return abs >= 1000 ? `${(g / 1000).toFixed(3).replace(/\.?0+$/, "")} kg` : `${g} g`;
};

export default function VaultLogbook() {
  const { can, user } = useAuth();
  const [ledger, setLedger]       = useState({ rows: [], staged_movements: 0, manicuring_out: {}, unreleased_imports: [], odoo_writes_live: false });
  const [movements, setMovements] = useState([]);
  const [loading, setLoading]     = useState(true);

  // Ledger grouped by physical batch lineage, same as the Batch Registry
  // table — one row per real-world batch, expandable into the per-stage
  // breakdown, instead of every stage the batch has ever carried appearing
  // as its own row. No separate fetch needed on expand: unlike the registry
  // page's timeline, every stage's balance is already in ledger.rows.
  const [expandedLedgerGroups, setExpandedLedgerGroups] = useState({});
  const ledgerGroups = useMemo(() => {
    const byBase = new Map();
    for (const r of ledger.rows) {
      const baseId = r.base_batch_id || r.batch_id;
      if (!byBase.has(baseId)) byBase.set(baseId, []);
      byBase.get(baseId).push(r);
    }
    return [...byBase.entries()].map(([baseId, rows]) => {
      const activeRows = rows.filter(r => Math.abs(r.qty_g) > 0.001);
      const total = rows.reduce((s, r) => s + (r.qty_g || 0), 0);
      const totalMovements = rows.reduce((s, r) => s + (r.movements || 0), 0);
      const lastActivity = rows.reduce(
        (max, r) => (!max || (r.last_movement_at && new Date(r.last_movement_at) > new Date(max))) ? r.last_movement_at : max,
        null
      );
      return { baseId, product_name: rows[0].product_name, rows, activeRows, total, totalMovements, lastActivity };
    }).sort((a, b) => Math.abs(b.total) - Math.abs(a.total));
  }, [ledger.rows]);

  // Movement form
  const [type, setType]           = useState("receive");
  const [batchQuery, setBatchQuery] = useState("");
  const [batchOptions, setBatchOptions] = useState([]);
  const [batch, setBatch]         = useState(null);   // registry row
  const [batchOpen, setBatchOpen] = useState(false);
  const [qty, setQty]             = useState("");
  const [source, setSource]       = useState("production");
  const [mQty, setMQty]           = useState("");
  const [tQty, setTQty]           = useState("");
  const [notes, setNotes]         = useState("");
  const [saving, setSaving]       = useState(false);
  const batchBoxRef = useRef(null);

  // Sync
  const [syncConfirm, setSyncConfirm] = useState(false);
  const [syncing, setSyncing]         = useState(false);

  // Ledger rebuild (13.0.9 reconciliation tool) — recomputes batch_balances
  // from the complete movement history. Not needed in normal operation
  // (balances update live at write time); available for repair/audit.
  const [rebuildConfirm, setRebuildConfirm] = useState(false);
  const [rebuilding, setRebuilding]         = useState(false);

  // Test-data purge (super admin only)
  const [purgeConfirm, setPurgeConfirm] = useState(false);
  const [purging, setPurging]           = useState(false);

  // GACP readiness probe (13.0.1) — "does the service account see the GACP
  // company/warehouse yet?" Read-only, safe to run any time.
  const [probeOpen, setProbeOpen]       = useState(false);
  const [probeLoading, setProbeLoading] = useState(false);
  const [probeData, setProbeData]       = useState(null);
  const [probeError, setProbeError]     = useState(null);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const [ledgerRes, movesRes] = await Promise.all([
        api.get("/api/production/vault/ledger"),
        api.get("/api/production/vault/movements", { params: { limit: 100 } }),
      ]);
      setLedger(ledgerRes.data);
      setMovements(movesRes.data.items);
    } catch (e) {
      toast.error(e.response?.data?.detail || "Failed to load vault logbook");
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => { load(); }, [load]);

  // Batch picker search (debounced)
  useEffect(() => {
    const t = setTimeout(() => {
      api.get("/api/production/batches", { params: { q: batchQuery || undefined, limit: 15 } })
        .then(r => setBatchOptions(r.data.items))
        .catch(() => {});
    }, 250);
    return () => clearTimeout(t);
  }, [batchQuery]);

  useEffect(() => {
    const close = (e) => {
      if (batchBoxRef.current && !batchBoxRef.current.contains(e.target)) setBatchOpen(false);
    };
    document.addEventListener("mousedown", close);
    return () => document.removeEventListener("mousedown", close);
  }, []);

  const isReturn = type === "return_manicuring";

  // ── Guided next-step logic ─────────────────────────────────────────────────
  // The batch's current position determines which movements make sense:
  //   never received      → Receive to Vault
  //   out at manicuring   → Return from Manicuring
  //   in vault, stage -U  → Issue to Manicuring
  //   in vault, other     → Issue to Packing
  // Receive stays enabled always (stock legitimately arrives in tranches);
  // the other movements are disabled when they are physically impossible.
  const vaultBalance = batch
    ? (ledger.rows.find(r => r.batch_id === batch.batch_id)?.qty_g ?? 0)
    : null;
  const outAtManicuring = batch ? (ledger.manicuring_out?.[batch.batch_id] || 0) : 0;
  const inVault = vaultBalance > 0.001;
  // Schedule 6 quarantine: imported batches cannot be issued until the
  // Responsible Pharmacist releases the receipt (server enforces this too).
  const awaitingRelease = Boolean(
    batch && batch.family === "import"
    && (ledger.unreleased_imports || []).includes(batch.base_batch_id || batch.batch_id)
  );

  const allowedTypes = {
    receive:           true,
    issue_packing:     inVault && !awaitingRelease,
    issue_manicuring:  inVault && !awaitingRelease,
    return_manicuring: outAtManicuring > 0.001,
  };
  const disabledReason = {
    issue_packing:     awaitingRelease ? "Awaiting Responsible Pharmacist release" : "Nothing in the vault for this batch yet",
    issue_manicuring:  awaitingRelease ? "Awaiting Responsible Pharmacist release" : "Nothing in the vault for this batch yet",
    return_manicuring: "This batch is not out at manicuring",
  };
  const suggestedType = !batch ? null
    : outAtManicuring > 0.001 ? "return_manicuring"
    : !inVault ? "receive"
    : awaitingRelease ? "receive"
    : batch.stage_suffix === "U" ? "issue_manicuring"
    : "issue_packing";

  // Snap to the suggested movement whenever a batch is picked
  useEffect(() => {
    if (batch && suggestedType) setType(suggestedType);
  }, [batch]);  // deliberately only on batch change — suggestedType would re-snap on every keystroke

  const overIssue = batch && !isReturn && type !== "receive"
    && parseFloat(qty) > 0 && parseFloat(qty) > vaultBalance;

  const canSubmit = batch && allowedTypes[type] && (isReturn
    ? (parseFloat(mQty) > 0 || parseFloat(tQty) > 0)
    : parseFloat(qty) > 0);

  async function submit() {
    if (!canSubmit) return;
    setSaving(true);
    try {
      const body = { type, batch_id: batch.batch_id, notes: notes || undefined };
      if (isReturn) {
        body.m_qty_g = parseFloat(mQty) || 0;
        body.t_qty_g = parseFloat(tQty) || 0;
      } else {
        body.qty_g = parseFloat(qty);
        if (type === "receive") body.source = source;
      }
      const r = await api.post("/api/production/vault/movements", body);
      const mv = r.data.movement;
      toast.success(
        isReturn
          ? `Return recorded: ${mv.outputs.map(o => o.batch_id).join(", ")}`
          : `${MOVE_LABEL[type]} recorded for ${batch.batch_id}`
      );
      setQty(""); setMQty(""); setTQty(""); setNotes(""); setBatch(null); setBatchQuery("");
      load();
    } catch (e) {
      toast.error(e.response?.data?.detail || "Failed to record movement");
    } finally {
      setSaving(false);
    }
  }

  async function doPurge() {
    setPurgeConfirm(false);
    setPurging(true);
    try {
      const r = await api.post("/api/production/purge-test-data");
      toast.success(`Purged ${r.data.batches_deleted} batches and ${r.data.movements_deleted} movements`);
      load();
    } catch (e) {
      toast.error(e.response?.data?.detail || "Purge failed");
    } finally {
      setPurging(false);
    }
  }

  async function doSync() {
    setSyncConfirm(false);
    setSyncing(true);
    try {
      const r = await api.post("/api/production/sync-staged");
      if (r.data.failed > 0) {
        toast.error(`${r.data.synced} synced, ${r.data.failed} failed. Check the movement list for details.`);
      } else {
        toast.success(`${r.data.synced} staged records synced to the stock system`);
      }
      load();
    } catch (e) {
      toast.error(e.response?.data?.detail || "Sync failed");
    } finally {
      setSyncing(false);
    }
  }

  async function doRebuild() {
    setRebuildConfirm(false);
    setRebuilding(true);
    try {
      const r = await api.post("/api/production/vault/rebuild-ledger");
      toast.success(`Ledger rebuilt from ${r.data.batches_rebuilt} batches' full movement history`);
      load();
    } catch (e) {
      toast.error(e.response?.data?.detail || "Rebuild failed");
    } finally {
      setRebuilding(false);
    }
  }

  async function runProbe() {
    setProbeOpen(true);
    setProbeLoading(true);
    setProbeError(null);
    try {
      const r = await api.get("/api/production/odoo-probe");
      setProbeData(r.data);
    } catch (e) {
      setProbeError(e.response?.data?.detail || "Could not reach the stock system");
    } finally {
      setProbeLoading(false);
    }
  }

  return (
    <div className="flex flex-col h-full overflow-hidden">
      <TopBar
        title="Vault Logbook"
        actions={
          <div className="flex items-center gap-2">
            <ProductionGuideButton />
            {can("production.manage") && (
              <BtnSecondary onClick={runProbe} disabled={probeLoading}>
                {probeLoading ? <Loader2 size={14} className="animate-spin" /> : <Radar size={14} />}
                Check stock system access
              </BtnSecondary>
            )}
            {user?.is_super_admin && (movements.length > 0 || ledger.rows.length > 0) && (
              <BtnSecondary onClick={() => setPurgeConfirm(true)} disabled={purging}>
                {purging ? <Loader2 size={14} className="animate-spin" /> : <Trash2 size={14} />}
                Purge test data
              </BtnSecondary>
            )}
            {can("production.manage") && ledger.staged_movements > 0 && (
              <BtnSecondary onClick={() => setSyncConfirm(true)} disabled={syncing}>
                {syncing ? <Loader2 size={14} className="animate-spin" /> : <CloudUpload size={14} />}
                Sync {ledger.staged_movements} staged
              </BtnSecondary>
            )}
            <BtnSecondary onClick={load} disabled={loading}>
              <RefreshCw size={14} className={loading ? "animate-spin" : ""} />
              Refresh
            </BtnSecondary>
          </div>
        }
      />

      <div className="flex-1 overflow-y-auto p-6">
        <div className="max-w-4xl mx-auto w-full space-y-6">

          {!ledger.odoo_writes_live && (
            <div className="flex items-center gap-2 text-xs text-amber-700 dark:text-amber-300 bg-amber-50 dark:bg-amber-900/20 border border-amber-200 dark:border-amber-800 rounded-lg px-4 py-2.5">
              <CloudOff size={14} />
              Movements are being recorded and queued. Stock levels shown here are calculated from the logbook and will be confirmed in the stock system once the production facility connection is live.
            </div>
          )}

          {/* Record movement */}
          <div className="bg-white dark:bg-gray-800 rounded-xl border border-gray-200 dark:border-gray-700 p-5">
            <h3 className="text-sm font-semibold text-gray-800 dark:text-gray-100 flex items-center gap-2 mb-1">
              <NotebookPen size={15} className="text-bassani-500" /> Record Movement
            </h3>
            <p className="text-xs text-gray-500 dark:text-gray-400 mb-4">
              Pick the batch first. The system shows where it is and suggests the next step. Your name and the time are captured automatically.
            </p>

            <div className="grid sm:grid-cols-2 gap-4">
              {/* Step 1 — batch picker */}
              <div ref={batchBoxRef} className="relative sm:col-span-2">
                <label className="block text-xs font-medium text-gray-500 dark:text-gray-400 mb-1.5">
                  1. Which batch?
                </label>
                <input
                  value={batch ? `${batch.batch_id} — ${batch.product_name}` : batchQuery}
                  onChange={e => { setBatch(null); setBatchQuery(e.target.value); setBatchOpen(true); }}
                  onFocus={() => setBatchOpen(true)}
                  placeholder="Search the batch registry…"
                  className="w-full text-sm font-mono border border-gray-200 dark:border-gray-600 rounded-lg px-3 py-2 bg-gray-50 dark:bg-gray-900 text-gray-900 dark:text-gray-100 placeholder-gray-400 focus:outline-none focus:ring-2 focus:ring-bassani-400"
                />
                {batchOpen && (
                  <div className="absolute z-20 mt-1 w-full max-h-56 overflow-y-auto bg-white dark:bg-gray-800 border border-gray-200 dark:border-gray-700 rounded-lg shadow-lg">
                    {batchOptions.length === 0 ? (
                      <p className="text-xs text-gray-400 px-3 py-2">
                        No matching batches. Generate it on the Batch Registry page first.
                      </p>
                    ) : batchOptions.map(b => (
                      <button
                        key={b.batch_id}
                        onClick={() => { setBatch(b); setBatchQuery(""); setBatchOpen(false); }}
                        className="w-full text-left px-3 py-2 text-sm hover:bg-gray-50 dark:hover:bg-gray-700/50 flex justify-between items-center gap-2"
                        title={batchTitle(b.batch_id, b.product_name)}
                      >
                        <span className="font-mono text-gray-800 dark:text-gray-200 truncate">{b.batch_id}</span>
                        <span className="text-xs text-gray-400 truncate shrink-0">
                          {b.product_name}{stageLabel(b.batch_id) ? ` · ${stageLabel(b.batch_id)}` : ""}
                        </span>
                      </button>
                    ))}
                  </div>
                )}
              </div>

              {/* Selected batch summary — plain-language confirmation of what was picked */}
              {batch && (
                <div className="sm:col-span-2 flex flex-wrap items-center gap-x-5 gap-y-1 text-xs bg-gray-50 dark:bg-gray-900 border border-gray-100 dark:border-gray-700 rounded-lg px-3 py-2.5">
                  <span className="text-gray-500 dark:text-gray-400">
                    Product: <span className="font-semibold text-gray-800 dark:text-gray-100">{batch.product_name}</span>
                  </span>
                  <span className="text-gray-500 dark:text-gray-400">
                    Stage: <span className="font-semibold text-gray-800 dark:text-gray-100">{stageLabel(batch.batch_id) || "Base batch"}</span>
                  </span>
                  <span className="text-gray-500 dark:text-gray-400">
                    In vault now: <span className={`font-semibold ${vaultBalance > 0 ? "text-gray-800 dark:text-gray-100" : "text-amber-600 dark:text-amber-400"}`}>{fmtQty(vaultBalance)}</span>
                  </span>
                  {outAtManicuring > 0.001 && (
                    <span className="text-gray-500 dark:text-gray-400">
                      Out at manicuring: <span className="font-semibold text-amber-600 dark:text-amber-400">{fmtQty(outAtManicuring)}</span>
                    </span>
                  )}
                  {awaitingRelease && (
                    <span className="inline-flex text-xs font-medium px-2 py-0.5 rounded-full bg-amber-100 text-amber-700 dark:bg-amber-900/40 dark:text-amber-300">
                      Awaiting Responsible Pharmacist release
                    </span>
                  )}
                </div>
              )}

              {/* Step 2 — movement, gated by where the batch actually is */}
              <div className="sm:col-span-2">
                <label className="block text-xs font-medium text-gray-500 dark:text-gray-400 mb-1.5">
                  2. What is happening to it?
                </label>
                <div className="grid grid-cols-2 lg:grid-cols-4 gap-2">
                  {MOVE_TYPES.map(m => {
                    const Icon = m.icon;
                    const active = type === m.key;
                    const enabled = batch ? allowedTypes[m.key] : false;
                    const suggested = batch && suggestedType === m.key;
                    return (
                      <button
                        key={m.key}
                        onClick={() => enabled && setType(m.key)}
                        disabled={!enabled}
                        className={`relative text-left rounded-lg border px-3 py-2.5 transition-colors ${
                          active && enabled
                            ? "border-bassani-300 bg-bassani-50 dark:bg-bassani-900/30 dark:border-bassani-700"
                            : enabled
                              ? "border-gray-200 dark:border-gray-700 hover:border-gray-300 dark:hover:border-gray-600"
                              : "border-gray-100 dark:border-gray-800 opacity-45 cursor-not-allowed"
                        }`}
                      >
                        {suggested && (
                          <span className="absolute -top-2 right-2 text-[10px] font-semibold px-1.5 py-0.5 rounded-full bg-bassani-600 text-white">
                            Next step
                          </span>
                        )}
                        <span className={`flex items-center gap-1.5 text-xs font-semibold ${active && enabled ? "text-bassani-700 dark:text-bassani-300" : "text-gray-700 dark:text-gray-200"}`}>
                          <Icon size={13} /> {m.label}
                        </span>
                        <span className="block text-[11px] text-gray-400 mt-0.5 leading-tight">
                          {!batch ? m.hint : enabled ? m.hint : disabledReason[m.key]}
                        </span>
                      </button>
                    );
                  })}
                </div>
                {!batch && (
                  <p className="text-[11px] text-gray-400 mt-1.5">Pick a batch above to see which movements are possible.</p>
                )}
              </div>

              {overIssue && (
                <p className="sm:col-span-2 text-xs text-amber-600 dark:text-amber-400">
                  This is more than the {fmtQty(vaultBalance)} recorded in the vault for this batch. You can still record it, but double-check the weight and the batch before saving.
                </p>
              )}

              {!isReturn && (
                <div>
                  <label className="block text-xs font-medium text-gray-500 dark:text-gray-400 mb-1.5">Weight (grams)</label>
                  <input
                    type="number" min="0" step="any" value={qty}
                    onChange={e => setQty(e.target.value)}
                    placeholder="e.g. 890"
                    className="w-full text-sm border border-gray-200 dark:border-gray-600 rounded-lg px-3 py-2 bg-gray-50 dark:bg-gray-900 text-gray-900 dark:text-gray-100 focus:outline-none focus:ring-2 focus:ring-bassani-400"
                  />
                </div>
              )}

              {type === "receive" && (
                <div>
                  <label className="block text-xs font-medium text-gray-500 dark:text-gray-400 mb-1.5">Source</label>
                  <select
                    value={source}
                    onChange={e => setSource(e.target.value)}
                    className="w-full text-sm border border-gray-200 dark:border-gray-600 rounded-lg px-3 py-2 bg-gray-50 dark:bg-gray-900 text-gray-900 dark:text-gray-100 focus:outline-none focus:ring-2 focus:ring-bassani-400"
                  >
                    {RECEIVE_SOURCES.map(s => <option key={s.key} value={s.key}>{s.label}</option>)}
                  </select>
                </div>
              )}

              {isReturn && (
                <>
                  <div>
                    <label className="block text-xs font-medium text-gray-500 dark:text-gray-400 mb-1.5">Manicured flower received back (grams)</label>
                    <input
                      type="number" min="0" step="any" value={mQty}
                      onChange={e => setMQty(e.target.value)}
                      placeholder="e.g. 5890"
                      className="w-full text-sm border border-gray-200 dark:border-gray-600 rounded-lg px-3 py-2 bg-gray-50 dark:bg-gray-900 text-gray-900 dark:text-gray-100 focus:outline-none focus:ring-2 focus:ring-bassani-400"
                    />
                  </div>
                  <div>
                    <label className="block text-xs font-medium text-gray-500 dark:text-gray-400 mb-1.5">Trim received back (grams)</label>
                    <input
                      type="number" min="0" step="any" value={tQty}
                      onChange={e => setTQty(e.target.value)}
                      placeholder="e.g. 730"
                      className="w-full text-sm border border-gray-200 dark:border-gray-600 rounded-lg px-3 py-2 bg-gray-50 dark:bg-gray-900 text-gray-900 dark:text-gray-100 focus:outline-none focus:ring-2 focus:ring-bassani-400"
                    />
                  </div>
                  {batch && (
                    <p className="sm:col-span-2 text-xs text-gray-500 dark:text-gray-400">
                      The manicured and trim weights are booked in under{" "}
                      <span className="font-mono">{batch.batch_id.replace(/-(D|U|M|P|T|PC|TC|PCPR|TCPR)$/, "")}-M</span> and{" "}
                      <span className="font-mono">{batch.batch_id.replace(/-(D|U|M|P|T|PC|TC|PCPR|TCPR)$/, "")}-T</span>.
                      Any shortfall against what was issued is recorded as processing waste.
                    </p>
                  )}
                </>
              )}

              <div className={isReturn || type === "receive" ? "sm:col-span-2" : ""}>
                <label className="block text-xs font-medium text-gray-500 dark:text-gray-400 mb-1.5">Notes (optional)</label>
                <input
                  value={notes}
                  onChange={e => setNotes(e.target.value)}
                  placeholder="Anything unusual about this movement…"
                  className="w-full text-sm border border-gray-200 dark:border-gray-600 rounded-lg px-3 py-2 bg-gray-50 dark:bg-gray-900 text-gray-900 dark:text-gray-100 focus:outline-none focus:ring-2 focus:ring-bassani-400"
                />
              </div>
            </div>

            <div className="mt-4 flex justify-end">
              <BtnPrimary onClick={submit} disabled={!canSubmit || saving}>
                {saving ? <Loader2 size={14} className="animate-spin mr-1.5" /> : null}
                {saving ? "Recording…" : "Record Movement"}
              </BtnPrimary>
            </div>
          </div>

          {/* Vault ledger */}
          <div className="bg-white dark:bg-gray-800 rounded-xl border border-gray-200 dark:border-gray-700 overflow-hidden">
            <div className="flex items-center justify-between px-5 py-3 border-b border-gray-100 dark:border-gray-700">
              <h3 className="text-sm font-semibold text-gray-800 dark:text-gray-100 flex items-center gap-2">
                <Vault size={15} className="text-gray-400" /> Vault Ledger
              </h3>
              <div className="flex items-center gap-3">
                <span className="text-xs text-gray-400">What is in the vault right now, per batch</span>
                {can("production.manage") && (
                  <button onClick={() => setRebuildConfirm(true)} disabled={rebuilding}
                    className="text-xs text-bassani-600 dark:text-bassani-400 hover:underline flex items-center gap-1 shrink-0">
                    {rebuilding ? <Loader2 size={11} className="animate-spin" /> : <RefreshCw size={11} />}
                    Rebuild
                  </button>
                )}
              </div>
            </div>
            {loading ? (
              <div className="flex items-center justify-center py-10 text-gray-400">
                <Loader2 size={18} className="animate-spin mr-2" /> <span className="text-sm">Loading…</span>
              </div>
            ) : ledger.rows.length === 0 ? (
              <div className="text-center py-10 text-gray-400 dark:text-gray-500">
                <Vault size={32} className="mx-auto mb-2 opacity-30" />
                <p className="text-sm">No vault stock recorded yet. Record the first movement above.</p>
              </div>
            ) : (
              <div className="overflow-x-auto">
                <table className="w-full text-sm">
                  <thead>
                    <tr className="text-left text-xs font-medium text-gray-500 dark:text-gray-400 bg-gray-50 dark:bg-gray-900/50">
                      <th className="px-5 py-2.5">Batch</th>
                      <th className="px-5 py-2.5">Product</th>
                      <th className="px-5 py-2.5">Current form(s)</th>
                      <th className="px-5 py-2.5 text-right">In Vault</th>
                      <th className="px-5 py-2.5 text-right">Movements</th>
                      <th className="px-5 py-2.5">Last Movement</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-gray-100 dark:divide-gray-700">
                    {ledgerGroups.map(g => {
                      const isOpen = !!expandedLedgerGroups[g.baseId];
                      const hasMultipleStages = g.rows.length > 1;
                      return (
                        <Fragment key={g.baseId}>
                          <tr
                            onClick={() => hasMultipleStages && setExpandedLedgerGroups(prev => ({ ...prev, [g.baseId]: !prev[g.baseId] }))}
                            className={`transition-colors ${hasMultipleStages ? "cursor-pointer hover:bg-gray-50 dark:hover:bg-gray-800/50" : ""}`}
                          >
                            <td className="px-5 py-3 font-mono text-gray-800 dark:text-gray-200 whitespace-nowrap">
                              <span className="inline-flex items-center gap-1.5">
                                {hasMultipleStages ? (
                                  <ChevronRight size={13} className={`text-gray-400 shrink-0 transition-transform ${isOpen ? "rotate-90" : ""}`} />
                                ) : (
                                  <span className="w-[13px] shrink-0" />
                                )}
                                <span title={batchTitle(g.baseId, g.product_name)}>{g.baseId}</span>
                              </span>
                            </td>
                            <td className="px-5 py-3 text-gray-600 dark:text-gray-300 max-w-[160px] truncate">{g.product_name}</td>
                            <td className="px-5 py-3 text-xs whitespace-nowrap">
                              <div className="flex flex-wrap items-center gap-1">
                                {g.activeRows.length === 0 ? (
                                  <span className="text-gray-300 dark:text-gray-600">None in vault</span>
                                ) : g.activeRows.map(r => (
                                  <span key={r.batch_id} className="text-[11px] font-medium px-1.5 py-0.5 rounded bg-gray-100 dark:bg-gray-700 text-gray-600 dark:text-gray-300">
                                    {stageLabel(r.batch_id) || "Base"}
                                  </span>
                                ))}
                              </div>
                            </td>
                            <td className={`px-5 py-3 text-right font-semibold whitespace-nowrap ${
                              g.total < 0 ? "text-red-600 dark:text-red-400" : g.total === 0 ? "text-gray-300 dark:text-gray-600" : "text-gray-800 dark:text-gray-100"
                            }`}>
                              {fmtQty(g.total)}
                            </td>
                            <td className="px-5 py-3 text-right text-xs text-gray-400">{g.totalMovements}</td>
                            <td className="px-5 py-3 text-xs text-gray-400 whitespace-nowrap">{fmtWhen(g.lastActivity)}</td>
                          </tr>
                          {isOpen && (
                            <tr>
                              <td colSpan={6} className="px-5 py-3 bg-gray-50/70 dark:bg-gray-900/40">
                                <div className="space-y-1">
                                  {g.rows.map(r => (
                                    <div key={r.batch_id} className="flex items-center justify-between gap-3 text-xs bg-white dark:bg-gray-800 border border-gray-100 dark:border-gray-700 rounded-lg px-3 py-2">
                                      <span className="font-mono text-gray-700 dark:text-gray-200" title={batchTitle(r.batch_id, r.product_name)}>
                                        {r.batch_id}
                                        <span className="font-sans text-gray-400 ml-1.5">{stageLabel(r.batch_id) || "Base"}</span>
                                      </span>
                                      <span className="flex items-center gap-4 text-gray-500 dark:text-gray-400">
                                        <span className={`font-semibold ${r.qty_g < 0 ? "text-red-600 dark:text-red-400" : r.qty_g === 0 ? "text-gray-300 dark:text-gray-600" : "text-gray-700 dark:text-gray-200"}`}>
                                          {fmtQty(r.qty_g)}
                                        </span>
                                        <span>{r.movements} movement{r.movements !== 1 ? "s" : ""}</span>
                                        <span>{fmtWhen(r.last_movement_at)}</span>
                                      </span>
                                    </div>
                                  ))}
                                </div>
                              </td>
                            </tr>
                          )}
                        </Fragment>
                      );
                    })}
                  </tbody>
                </table>
              </div>
            )}
          </div>

          {/* Movement history */}
          <div className="bg-white dark:bg-gray-800 rounded-xl border border-gray-200 dark:border-gray-700 overflow-hidden">
            <div className="px-5 py-3 border-b border-gray-100 dark:border-gray-700">
              <h3 className="text-sm font-semibold text-gray-800 dark:text-gray-100">Movement History</h3>
            </div>
            {movements.length === 0 ? (
              <p className="text-sm text-gray-400 text-center py-8">No movements recorded yet.</p>
            ) : (
              <div className="overflow-x-auto">
                <table className="w-full text-sm">
                  <thead>
                    <tr className="text-left text-xs font-medium text-gray-500 dark:text-gray-400 bg-gray-50 dark:bg-gray-900/50">
                      <th className="px-5 py-2.5">When</th>
                      <th className="px-5 py-2.5">Movement</th>
                      <th className="px-5 py-2.5">Batch</th>
                      <th className="px-5 py-2.5 text-right">Weight</th>
                      <th className="px-5 py-2.5">By</th>
                      <th className="px-5 py-2.5">Stock system</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-gray-100 dark:divide-gray-700">
                    {movements.map(m => (
                      <tr key={m.id} className="hover:bg-gray-50 dark:hover:bg-gray-800/50 transition-colors align-top">
                        <td className="px-5 py-3 text-xs text-gray-400 whitespace-nowrap">{fmtWhen(m.created_at)}</td>
                        <td className="px-5 py-3 text-xs text-gray-600 dark:text-gray-300 whitespace-nowrap">{MOVE_LABEL[m.type] || m.type}</td>
                        <td className="px-5 py-3 text-xs" title={batchTitle(m.batch_id, m.product_name)}>
                          <span className="font-mono text-gray-700 dark:text-gray-200">{m.batch_id}</span>
                          <span className="block text-gray-500 dark:text-gray-400 mt-0.5">
                            {m.product_name}{stageLabel(m.batch_id) ? ` · ${stageLabel(m.batch_id)}` : ""}
                          </span>
                          {(m.outputs || []).length > 0 && (
                            <span className="block font-mono text-gray-400 mt-0.5">
                              {m.outputs.map(o => `${o.batch_id} (+${fmtQty(o.qty_g)})`).join(", ")}
                              {m.waste_g != null && m.waste_g > 0 && `, waste ${fmtQty(m.waste_g)}`}
                            </span>
                          )}
                        </td>
                        <td className="px-5 py-3 text-right text-xs font-semibold text-gray-700 dark:text-gray-200 whitespace-nowrap">
                          {m.qty_g != null ? `${m.type === "receive" ? "+" : "-"}${fmtQty(m.qty_g)}` : ""}
                        </td>
                        <td className="px-5 py-3 text-xs text-gray-500 dark:text-gray-400 whitespace-nowrap">{m.actor_name}</td>
                        <td className="px-5 py-3">
                          <SyncBadge status={m.odoo_sync} />
                          {m.odoo_error && <span className="block text-[11px] text-red-500 mt-0.5 max-w-[180px]">{m.odoo_error}</span>}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
          </div>
        </div>
      </div>

      {/* GACP readiness probe results */}
      {probeOpen && (
        <Modal title="Stock System Access" onClose={() => setProbeOpen(false)} width="max-w-2xl">
          <p className="text-sm text-gray-600 dark:text-gray-300 mb-4">
            What the portal's stock system connection can currently see. Use this to check whether the GACP production facility's company and warehouse are visible yet — Odoo hides companies and their warehouses from the connection entirely until access is granted, rather than showing an error.
          </p>

          {probeLoading ? (
            <div className="flex items-center justify-center py-10 text-gray-400">
              <Loader2 size={18} className="animate-spin mr-2" /> <span className="text-sm">Checking…</span>
            </div>
          ) : probeError ? (
            <div className="flex items-start gap-2 text-sm text-red-600 dark:text-red-400 bg-red-50 dark:bg-red-900/20 border border-red-200 dark:border-red-800 rounded-lg px-4 py-3">
              <XCircle size={16} className="shrink-0 mt-0.5" /> {probeError}
            </div>
          ) : probeData && (
            <div className="space-y-4">
              <div className="flex flex-wrap gap-4 text-xs bg-gray-50 dark:bg-gray-900 border border-gray-100 dark:border-gray-700 rounded-lg px-4 py-2.5">
                <span className="text-gray-500 dark:text-gray-400">
                  Writes to the stock system:{" "}
                  <span className={`font-semibold ${probeData.odoo_writes_live ? "text-green-600 dark:text-green-400" : "text-amber-600 dark:text-amber-400"}`}>
                    {probeData.odoo_writes_live ? "Live" : "Not enabled yet"}
                  </span>
                </span>
                <span className="text-gray-500 dark:text-gray-400">
                  GACP warehouse configured:{" "}
                  <span className={`font-semibold ${probeData.gacp_warehouse_id ? "text-green-600 dark:text-green-400" : "text-amber-600 dark:text-amber-400"}`}>
                    {probeData.gacp_warehouse_id || "No"}
                  </span>
                </span>
                <span className="text-gray-500 dark:text-gray-400">
                  Manufacturing app:{" "}
                  <span className={`font-semibold ${probeData.mrp_installed ? "text-green-600 dark:text-green-400" : "text-amber-600 dark:text-amber-400"}`}>
                    {probeData.mrp_installed === null ? "Unknown" : probeData.mrp_installed ? "Installed" : "Not installed"}
                  </span>
                </span>
              </div>

              <div>
                <p className="text-xs font-semibold text-gray-500 dark:text-gray-400 mb-2 flex items-center gap-1.5">
                  <Building2 size={13} /> Companies visible to the stock system connection ({probeData.companies.length})
                </p>
                {probeData.companies.length === 0 ? (
                  <p className="text-sm text-amber-600 dark:text-amber-400">No companies are visible at all — the connection has not been granted access to anything yet.</p>
                ) : (
                  <div className="space-y-3">
                    {probeData.companies.map(c => (
                      <div key={c.id} className="border border-gray-100 dark:border-gray-700 rounded-lg px-3 py-2.5">
                        <p className="text-sm font-semibold text-gray-800 dark:text-gray-100 flex items-center gap-1.5">
                          <Building2 size={13} className="text-gray-400" /> {c.name}
                        </p>
                        {c.warehouses.length === 0 ? (
                          <p className="text-xs text-gray-400 mt-1 ml-5">No warehouses visible for this company.</p>
                        ) : (
                          <div className="mt-1.5 ml-5 space-y-1.5">
                            {c.warehouses.map(w => (
                              <div key={w.id} className="text-xs">
                                <p className="text-gray-700 dark:text-gray-200 font-medium flex items-center gap-1.5">
                                  <Warehouse size={12} className="text-gray-400" />
                                  {w.name} {w.code && <span className="font-mono text-gray-400">({w.code})</span>}
                                  {probeData.gacp_warehouse_id === w.id && (
                                    <span className="text-[10px] font-semibold px-1.5 py-0.5 rounded-full bg-bassani-100 text-bassani-700 dark:bg-bassani-900/40 dark:text-bassani-300">GACP</span>
                                  )}
                                </p>
                                {w.locations.length > 0 && (
                                  <p className="text-gray-400 mt-0.5 ml-4 flex items-start gap-1">
                                    <MapPin size={11} className="shrink-0 mt-0.5" />
                                    <span>{w.locations.slice(0, 6).map(l => l.name).join(", ")}{w.locations.length > 6 ? ` +${w.locations.length - 6} more` : ""}</span>
                                  </p>
                                )}
                              </div>
                            ))}
                          </div>
                        )}
                      </div>
                    ))}
                  </div>
                )}
              </div>

              <p className="text-xs text-gray-400">
                Looking for the GACP company or warehouse and not seeing it? It needs to be added to the connection's allowed companies in the stock system first — this is a one-time setup step, not something the portal can grant itself.
              </p>
            </div>
          )}

          <div className="flex justify-end gap-2 mt-4">
            <BtnSecondary onClick={runProbe} disabled={probeLoading}>
              <RefreshCw size={13} className={probeLoading ? "animate-spin" : ""} /> Re-check
            </BtnSecondary>
            <BtnPrimary onClick={() => setProbeOpen(false)}>Close</BtnPrimary>
          </div>
        </Modal>
      )}

      {/* Rebuild ledger confirm */}
      {rebuildConfirm && (
        <Modal title="Rebuild Vault Ledger" onClose={() => setRebuildConfirm(false)}>
          <p className="text-sm text-gray-600 dark:text-gray-300 mb-2">
            This recomputes every batch's balance from the complete vault movement history and replaces the current ledger with the result.
          </p>
          <p className="text-sm text-gray-600 dark:text-gray-300 mb-4">
            Balances already update automatically as movements are recorded, so this is not needed for normal use — it's a reconciliation tool, useful if the numbers ever look wrong and you want to confirm they match the full history.
          </p>
          <div className="flex justify-end gap-2">
            <BtnSecondary onClick={() => setRebuildConfirm(false)}>Cancel</BtnSecondary>
            <BtnPrimary onClick={doRebuild}>Rebuild Ledger</BtnPrimary>
          </div>
        </Modal>
      )}

      {/* Purge confirm */}
      {purgeConfirm && (
        <Modal title="Purge Test Data" onClose={() => setPurgeConfirm(false)}>
          <p className="text-sm text-gray-600 dark:text-gray-300 mb-2">
            This permanently deletes <strong>every batch and every vault movement</strong> so real operation can start with a clean registry. The product master list is kept, and batch sequence numbers start again from 001.
          </p>
          <p className="text-sm text-gray-600 dark:text-gray-300 mb-4">
            The audit trail keeps its complete history of everything that was recorded, including this purge. Records already written to the stock system cannot be purged and will block this action.
          </p>
          <div className="flex justify-end gap-2">
            <BtnSecondary onClick={() => setPurgeConfirm(false)}>Cancel</BtnSecondary>
            <BtnDanger onClick={doPurge}>Purge Everything</BtnDanger>
          </div>
        </Modal>
      )}

      {/* Sync confirm */}
      {syncConfirm && (
        <Modal title="Sync Staged Movements" onClose={() => setSyncConfirm(false)}>
          <p className="text-sm text-gray-600 dark:text-gray-300 mb-4">
            This replays all {ledger.staged_movements} staged vault records against the stock system, oldest first.
            It only works once the production facility connection has been switched on. Continue?
          </p>
          <div className="flex justify-end gap-2">
            <BtnSecondary onClick={() => setSyncConfirm(false)}>Cancel</BtnSecondary>
            <BtnPrimary onClick={doSync}>Sync Now</BtnPrimary>
          </div>
        </Modal>
      )}
    </div>
  );
}
