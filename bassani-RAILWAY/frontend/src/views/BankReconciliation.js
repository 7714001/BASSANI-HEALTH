import { useState, useEffect, useCallback, useRef } from "react";
import {
  Upload, ChevronRight, CheckCircle2, AlertCircle, MinusCircle,
  Loader2, X, Link2, Eye, ArrowLeft, RefreshCw, Landmark,
} from "lucide-react";
import api from "../api";
import toast from "react-hot-toast";
import {
  TopBar, BtnPrimary, BtnSecondary, BtnDanger,
  Modal, LoadingState, fmtR, fmtDate,
} from "../components/UI";

// ── Status badge ──────────────────────────────────────────────────────────────

const STATUS_META = {
  auto_matched:     { label: "Auto-matched",  color: "bg-green-100 text-green-700 border-green-200"  },
  manually_matched: { label: "Confirmed",     color: "bg-blue-100 text-blue-700 border-blue-200"    },
  unmatched:        { label: "Unmatched",     color: "bg-amber-100 text-amber-700 border-amber-200" },
  excluded:         { label: "Excluded",      color: "bg-gray-100 text-gray-500 border-gray-200"    },
};

function StatusBadge({ status }) {
  const m = STATUS_META[status] || STATUS_META.unmatched;
  return (
    <span className={`inline-flex items-center gap-1 text-[11px] font-semibold px-2 py-0.5 rounded-full border ${m.color}`}>
      {status === "auto_matched" || status === "manually_matched"
        ? <CheckCircle2 size={10} />
        : status === "excluded"
        ? <MinusCircle size={10} />
        : <AlertCircle size={10} />
      }
      {m.label}
    </span>
  );
}

function ConfidenceDot({ confidence }) {
  if (!confidence || confidence === "confirmed") return null;
  const color = confidence === "high" ? "bg-green-500" : confidence === "medium" ? "bg-amber-500" : "bg-red-400";
  return (
    <span className="flex items-center gap-1 text-[10px] text-gray-400">
      <span className={`w-1.5 h-1.5 rounded-full ${color}`} />
      {confidence}
    </span>
  );
}

// ── Import modal ──────────────────────────────────────────────────────────────

function ImportModal({ onClose, onDone }) {
  const [journals, setJournals] = useState([]);
  const [journalId, setJournalId] = useState("");
  const [file, setFile] = useState(null);
  const [loading, setLoading] = useState(false);
  const [loadingJournals, setLoadingJournals] = useState(true);
  const fileRef = useRef();

  useEffect(() => {
    api.get("/api/finance/bank-journals")
      .then(r => {
        setJournals(r.data.journals);
        if (r.data.journals.length === 1) setJournalId(String(r.data.journals[0].id));
      })
      .catch(() => toast.error("Failed to load bank journals"))
      .finally(() => setLoadingJournals(false));
  }, []);

  const submit = async () => {
    if (!file) return toast.error("Select a CSV file first");
    if (!journalId) return toast.error("Select a bank journal");
    setLoading(true);
    try {
      const fd = new FormData();
      fd.append("file", file);
      fd.append("journal_id", journalId);
      const r = await api.post("/api/finance/bank-statements/import", fd, {
        headers: { "Content-Type": "multipart/form-data" },
      });
      toast.success(`Imported ${r.data.lines_imported} lines — ${r.data.auto_matched} auto-matched`);
      onDone(r.data.statement_id);
    } catch (e) {
      toast.error(e.response?.data?.detail || "Import failed");
    } finally {
      setLoading(false);
    }
  };

  return (
    <Modal title="Import Bank Statement" onClose={onClose}>
      <div className="space-y-4">
        <div>
          <label className="block text-xs font-semibold text-gray-600 mb-1.5">Bank Journal</label>
          {loadingJournals
            ? <div className="h-9 bg-gray-100 rounded-xl animate-pulse" />
            : (
              <select
                value={journalId}
                onChange={e => setJournalId(e.target.value)}
                className="w-full border border-gray-200 rounded-xl px-3 py-2 text-sm bg-white focus:outline-none focus:ring-2 focus:ring-bassani-200"
              >
                <option value="">Select journal…</option>
                {journals.map(j => (
                  <option key={j.id} value={j.id}>{j.name}</option>
                ))}
              </select>
            )
          }
        </div>

        <div>
          <label className="block text-xs font-semibold text-gray-600 mb-1.5">CSV File</label>
          <div
            onClick={() => fileRef.current?.click()}
            className="border-2 border-dashed border-gray-200 rounded-xl p-6 text-center cursor-pointer hover:border-bassani-300 hover:bg-bassani-50 transition-colors"
          >
            {file ? (
              <div className="flex items-center justify-center gap-2 text-sm text-gray-700">
                <CheckCircle2 size={16} className="text-green-500" />
                <span className="font-medium">{file.name}</span>
                <button
                  onClick={e => { e.stopPropagation(); setFile(null); }}
                  className="text-gray-400 hover:text-gray-700"
                >
                  <X size={13} />
                </button>
              </div>
            ) : (
              <>
                <Upload size={20} className="mx-auto text-gray-300 mb-2" />
                <p className="text-sm text-gray-500">Click to choose a CSV file</p>
                <p className="text-[11px] text-gray-400 mt-1">FNB Business or Nedbank Business format</p>
              </>
            )}
          </div>
          <input
            ref={fileRef}
            type="file"
            accept=".csv,text/csv"
            className="hidden"
            onChange={e => setFile(e.target.files?.[0] || null)}
          />
        </div>

        <div className="bg-blue-50 border border-blue-100 rounded-xl px-4 py-3">
          <p className="text-xs text-blue-700 font-semibold mb-0.5">Supported formats</p>
          <p className="text-[11px] text-blue-600">
            FNB Business (columns: Date, Transaction Type, Reference, Amount, Running Balance)
            and Nedbank Business (Date, Reference, Description, Debit, Credit, Balance).
            Credits only — debits and fees are ignored automatically.
          </p>
        </div>

        <div className="flex justify-end gap-2 pt-1">
          <BtnSecondary onClick={onClose}>Cancel</BtnSecondary>
          <BtnPrimary onClick={submit} disabled={loading}>
            {loading ? <Loader2 size={13} className="animate-spin mr-1.5" /> : <Upload size={13} className="mr-1.5" />}
            Import
          </BtnPrimary>
        </div>
      </div>
    </Modal>
  );
}

// ── Manual match modal ────────────────────────────────────────────────────────

function MatchModal({ line, onClose, onDone }) {
  const [invoices, setInvoices] = useState([]);
  const [journals, setJournals] = useState([]);
  const [selectedInvoice, setSelectedInvoice] = useState(null);
  const [journalId, setJournalId] = useState("");
  const [loading, setLoading] = useState(false);
  const [query, setQuery] = useState("");

  useEffect(() => {
    Promise.all([
      api.get("/api/finance/invoices/open"),
      api.get("/api/finance/bank-journals"),
    ]).then(([invR, jR]) => {
      setInvoices(invR.data.invoices);
      setJournals(jR.data.journals);
      if (jR.data.journals.length === 1) setJournalId(String(jR.data.journals[0].id));
    }).catch(() => toast.error("Failed to load invoices"));
  }, []);

  const filtered = invoices.filter(inv => {
    if (!query) return true;
    const q = query.toLowerCase();
    return (
      (inv.name || "").toLowerCase().includes(q) ||
      (Array.isArray(inv.partner_id) ? inv.partner_id[1] : "").toLowerCase().includes(q)
    );
  });

  const confirm = async () => {
    if (!selectedInvoice) return toast.error("Select an invoice first");
    if (!journalId) return toast.error("Select a payment journal");
    setLoading(true);
    try {
      await api.post(`/api/finance/bank-statements/lines/${line.id}/match`, {
        invoice_id: selectedInvoice.id,
        journal_id: parseInt(journalId),
        amount: line.amount,
      });
      toast.success("Payment registered and line matched");
      onDone();
    } catch (e) {
      toast.error(e.response?.data?.detail || "Match failed");
    } finally {
      setLoading(false);
    }
  };

  return (
    <Modal title="Match to Invoice" onClose={onClose}>
      <div className="space-y-4">
        <div className="bg-gray-50 rounded-xl px-4 py-3 text-sm">
          <p className="text-xs text-gray-500 mb-0.5">Statement line</p>
          <p className="font-semibold text-gray-900">{line.reference || line.description}</p>
          <p className="text-xs text-gray-500 mt-0.5">{fmtDate(line.date)} &nbsp;·&nbsp; <span className="font-semibold text-green-700">{fmtR(line.amount)}</span></p>
        </div>

        <div>
          <label className="block text-xs font-semibold text-gray-600 mb-1.5">Payment Journal</label>
          <select
            value={journalId}
            onChange={e => setJournalId(e.target.value)}
            className="w-full border border-gray-200 rounded-xl px-3 py-2 text-sm bg-white focus:outline-none focus:ring-2 focus:ring-bassani-200"
          >
            <option value="">Select journal…</option>
            {journals.map(j => <option key={j.id} value={j.id}>{j.name}</option>)}
          </select>
        </div>

        <div>
          <label className="block text-xs font-semibold text-gray-600 mb-1.5">Open Invoice</label>
          <input
            type="text"
            placeholder="Search by invoice number or customer…"
            value={query}
            onChange={e => setQuery(e.target.value)}
            className="w-full border border-gray-200 rounded-xl px-3 py-2 text-sm mb-2 focus:outline-none focus:ring-2 focus:ring-bassani-200"
          />
          <div className="max-h-52 overflow-y-auto border border-gray-100 rounded-xl divide-y divide-gray-50">
            {filtered.length === 0 && (
              <p className="px-4 py-3 text-xs text-gray-400">No open invoices found</p>
            )}
            {filtered.map(inv => {
              const partner = Array.isArray(inv.partner_id) ? inv.partner_id[1] : "";
              const selected = selectedInvoice?.id === inv.id;
              return (
                <button
                  key={inv.id}
                  onClick={() => setSelectedInvoice(inv)}
                  className={`w-full text-left px-4 py-2.5 flex items-center justify-between text-sm transition-colors ${
                    selected ? "bg-bassani-50 border-l-2 border-bassani-500" : "hover:bg-gray-50"
                  }`}
                >
                  <div>
                    <p className="font-semibold text-gray-900 text-xs">{inv.name}</p>
                    <p className="text-[11px] text-gray-500">{partner}</p>
                  </div>
                  <div className="text-right">
                    <p className="text-xs font-semibold text-gray-900">{fmtR(inv.amount_residual)}</p>
                    {inv.invoice_date_due && (
                      <p className="text-[10px] text-gray-400">Due {fmtDate(inv.invoice_date_due)}</p>
                    )}
                  </div>
                </button>
              );
            })}
          </div>
        </div>

        <div className="flex justify-end gap-2 pt-1">
          <BtnSecondary onClick={onClose}>Cancel</BtnSecondary>
          <BtnPrimary onClick={confirm} disabled={loading || !selectedInvoice}>
            {loading ? <Loader2 size={13} className="animate-spin mr-1.5" /> : <Link2 size={13} className="mr-1.5" />}
            Confirm Match
          </BtnPrimary>
        </div>
      </div>
    </Modal>
  );
}

// ── Exclude modal ─────────────────────────────────────────────────────────────

function ExcludeModal({ line, onClose, onDone }) {
  const [reason, setReason] = useState("");
  const [loading, setLoading] = useState(false);

  const confirm = async () => {
    setLoading(true);
    try {
      await api.post(`/api/finance/bank-statements/lines/${line.id}/exclude`, { reason });
      toast.success("Line excluded");
      onDone();
    } catch (e) {
      toast.error(e.response?.data?.detail || "Failed");
    } finally {
      setLoading(false);
    }
  };

  return (
    <Modal title="Exclude Line" onClose={onClose}>
      <div className="space-y-4">
        <p className="text-sm text-gray-600">
          This line will be marked as excluded and won't count toward the unmatched total.
          Use this for bank fees, internal transfers, or lines that don't correspond to a customer invoice.
        </p>
        <div>
          <label className="block text-xs font-semibold text-gray-600 mb-1.5">Reason (optional)</label>
          <input
            type="text"
            value={reason}
            onChange={e => setReason(e.target.value)}
            placeholder="Bank fee, internal transfer…"
            className="w-full border border-gray-200 rounded-xl px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-bassani-200"
          />
        </div>
        <div className="flex justify-end gap-2">
          <BtnSecondary onClick={onClose}>Cancel</BtnSecondary>
          <BtnDanger onClick={confirm} disabled={loading}>
            {loading ? <Loader2 size={13} className="animate-spin mr-1.5" /> : null}
            Exclude
          </BtnDanger>
        </div>
      </div>
    </Modal>
  );
}

// ── Statement lines view ──────────────────────────────────────────────────────

function StatementLines({ statementId, onBack }) {
  const [data, setData] = useState(null);
  const [loading, setLoading] = useState(true);
  const [filter, setFilter] = useState("all");
  const [matchingLine, setMatchingLine] = useState(null);
  const [excludingLine, setExcludingLine] = useState(null);
  const [unmatchConfirm, setUnmatchConfirm] = useState(null);

  const load = useCallback(() => {
    setLoading(true);
    api.get(`/api/finance/bank-statements/${statementId}/lines`)
      .then(r => setData(r.data))
      .catch(() => toast.error("Failed to load statement"))
      .finally(() => setLoading(false));
  }, [statementId]);

  useEffect(() => { load(); }, [load]);

  const unmatch = async () => {
    const line = unmatchConfirm;
    setUnmatchConfirm(null);
    try {
      await api.post(`/api/finance/bank-statements/lines/${line.id}/unmatch`);
      toast.success("Line reset to unmatched");
      load();
    } catch (e) {
      toast.error(e.response?.data?.detail || "Failed");
    }
  };

  if (loading) return <LoadingState />;
  if (!data) return null;

  const { statement: stmt, lines } = data;

  const filtered = filter === "all"
    ? lines
    : lines.filter(l => l.status === filter);

  const unmatched = lines.filter(l => l.status === "unmatched").length;
  const matched   = lines.filter(l => ["auto_matched", "manually_matched"].includes(l.status)).length;
  const excluded  = lines.filter(l => l.status === "excluded").length;

  return (
    <div className="flex flex-col flex-1 overflow-hidden">
      <TopBar
        title={stmt.name}
        subtitle={`${stmt.format?.toUpperCase()} · ${stmt.date_from} to ${stmt.date_to} · Imported by ${stmt.imported_by_name}`}
        actions={
          <div className="flex items-center gap-2">
            <BtnSecondary onClick={onBack}><ArrowLeft size={13} className="mr-1" />Back</BtnSecondary>
            <BtnSecondary onClick={load}><RefreshCw size={13} className="mr-1" />Refresh</BtnSecondary>
          </div>
        }
      />

      <main className="flex-1 overflow-y-auto p-6 bg-gray-50">
        <div className="max-w-4xl mx-auto w-full space-y-5">

          {/* Summary cards */}
          <div className="grid grid-cols-4 gap-4">
            {[
              { label: "Total credits", value: fmtR(stmt.total_credits), color: "text-gray-900" },
              { label: "Matched",       value: matched,                  color: "text-green-700" },
              { label: "Unmatched",     value: unmatched,                color: unmatched > 0 ? "text-amber-700" : "text-gray-400" },
              { label: "Excluded",      value: excluded,                 color: "text-gray-400" },
            ].map(c => (
              <div key={c.label} className="bg-white rounded-2xl border border-gray-100 px-5 py-4">
                <p className="text-[11px] text-gray-400 uppercase tracking-wide mb-1">{c.label}</p>
                <p className={`text-xl font-bold ${c.color}`}>{c.value}</p>
              </div>
            ))}
          </div>

          {/* Filter pills */}
          <div className="flex items-center gap-2">
            {[
              { key: "all",              label: "All" },
              { key: "unmatched",        label: `Unmatched (${unmatched})` },
              { key: "auto_matched",     label: `Auto-matched (${lines.filter(l=>l.status==="auto_matched").length})` },
              { key: "manually_matched", label: `Confirmed` },
              { key: "excluded",         label: `Excluded (${excluded})` },
            ].map(p => (
              <button
                key={p.key}
                onClick={() => setFilter(p.key)}
                className={`text-xs font-semibold px-3 py-1.5 rounded-full border transition-colors ${
                  filter === p.key
                    ? "bg-bassani-600 text-white border-bassani-600"
                    : "bg-white text-gray-600 border-gray-200 hover:border-bassani-300"
                }`}
              >
                {p.label}
              </button>
            ))}
          </div>

          {/* Lines table */}
          <div className="bg-white rounded-2xl border border-gray-100 overflow-hidden">
            {filtered.length === 0 ? (
              <p className="px-6 py-10 text-sm text-gray-400 text-center">No lines in this view</p>
            ) : (
              <div className="overflow-x-auto">
                <table className="w-full text-sm">
                  <thead>
                    <tr className="border-b border-gray-100 bg-gray-50">
                      <th className="text-left px-4 py-3 text-[11px] font-semibold text-gray-400 uppercase tracking-wide">Date</th>
                      <th className="text-left px-4 py-3 text-[11px] font-semibold text-gray-400 uppercase tracking-wide">Reference</th>
                      <th className="text-right px-4 py-3 text-[11px] font-semibold text-gray-400 uppercase tracking-wide">Amount</th>
                      <th className="text-left px-4 py-3 text-[11px] font-semibold text-gray-400 uppercase tracking-wide">Status</th>
                      <th className="text-left px-4 py-3 text-[11px] font-semibold text-gray-400 uppercase tracking-wide">Invoice</th>
                      <th className="px-4 py-3" />
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-gray-50">
                    {filtered.map(line => (
                      <tr key={line.id} className={`group ${line.status === "excluded" ? "opacity-50" : ""}`}>
                        <td className="px-4 py-3 text-xs text-gray-500 whitespace-nowrap">{fmtDate(line.date)}</td>
                        <td className="px-4 py-3">
                          <p className="text-xs font-medium text-gray-900">{line.reference || "—"}</p>
                          {line.description && line.description !== line.reference && (
                            <p className="text-[11px] text-gray-400">{line.description}</p>
                          )}
                        </td>
                        <td className="px-4 py-3 text-right text-sm font-semibold text-green-700 whitespace-nowrap">
                          {fmtR(line.amount)}
                        </td>
                        <td className="px-4 py-3 whitespace-nowrap">
                          <div className="flex flex-col gap-0.5">
                            <StatusBadge status={line.status} />
                            {line.status === "auto_matched" && (
                              <ConfidenceDot confidence={line.match_confidence} />
                            )}
                          </div>
                        </td>
                        <td className="px-4 py-3">
                          {line.match_invoice_name ? (
                            <div>
                              <p className="text-xs font-medium text-gray-900">{line.match_invoice_name}</p>
                              {line.match_customer_name && (
                                <p className="text-[11px] text-gray-400">{line.match_customer_name}</p>
                              )}
                              {line.excluded_reason && (
                                <p className="text-[11px] text-gray-400 italic">{line.excluded_reason}</p>
                              )}
                            </div>
                          ) : line.excluded_reason ? (
                            <p className="text-[11px] text-gray-400 italic">{line.excluded_reason}</p>
                          ) : (
                            <span className="text-[11px] text-gray-300">—</span>
                          )}
                        </td>
                        <td className="px-4 py-3">
                          <div className="flex items-center gap-1.5 justify-end opacity-0 group-hover:opacity-100 transition-opacity">
                            {(line.status === "unmatched" || line.status === "auto_matched") && (
                              <>
                                <button
                                  onClick={() => setMatchingLine(line)}
                                  className="text-[11px] font-semibold text-bassani-600 hover:text-bassani-800 whitespace-nowrap flex items-center gap-1"
                                >
                                  <Link2 size={11} /> Match
                                </button>
                                <button
                                  onClick={() => setExcludingLine(line)}
                                  className="text-[11px] font-semibold text-gray-400 hover:text-gray-700 whitespace-nowrap flex items-center gap-1"
                                >
                                  <MinusCircle size={11} /> Exclude
                                </button>
                              </>
                            )}
                            {(line.status === "auto_matched" || line.status === "manually_matched" || line.status === "excluded") && (
                              <button
                                onClick={() => setUnmatchConfirm(line)}
                                className="text-[11px] font-semibold text-gray-400 hover:text-gray-700 whitespace-nowrap"
                              >
                                Reset
                              </button>
                            )}
                          </div>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
          </div>
        </div>
      </main>

      {matchingLine && (
        <MatchModal
          line={matchingLine}
          onClose={() => setMatchingLine(null)}
          onDone={() => { setMatchingLine(null); load(); }}
        />
      )}
      {excludingLine && (
        <ExcludeModal
          line={excludingLine}
          onClose={() => setExcludingLine(null)}
          onDone={() => { setExcludingLine(null); load(); }}
        />
      )}
      {unmatchConfirm && (
        <Modal title="Reset Line" onClose={() => setUnmatchConfirm(null)}>
          <p className="text-sm text-gray-600 mb-4">
            Reset this line to unmatched. If a payment was already registered in Odoo, it will not be automatically reversed.
          </p>
          <div className="flex justify-end gap-2">
            <BtnSecondary onClick={() => setUnmatchConfirm(null)}>Cancel</BtnSecondary>
            <BtnDanger onClick={unmatch}>Reset to Unmatched</BtnDanger>
          </div>
        </Modal>
      )}
    </div>
  );
}

// ── Statements list (dashboard) ───────────────────────────────────────────────

export default function BankReconciliation() {
  const [statements, setStatements] = useState([]);
  const [loading, setLoading] = useState(true);
  const [showImport, setShowImport] = useState(false);
  const [openStatement, setOpenStatement] = useState(null);

  const load = useCallback(() => {
    setLoading(true);
    api.get("/api/finance/bank-statements")
      .then(r => setStatements(r.data.statements))
      .catch(() => toast.error("Failed to load statements"))
      .finally(() => setLoading(false));
  }, []);

  useEffect(() => { load(); }, [load]);

  if (openStatement) {
    return (
      <StatementLines
        statementId={openStatement}
        onBack={() => { setOpenStatement(null); load(); }}
      />
    );
  }

  return (
    <div className="flex flex-col flex-1 overflow-hidden">
      <TopBar
        title="Bank Reconciliation"
        subtitle="Match bank statement credits to open invoices"
        actions={
          <div className="flex items-center gap-2">
            <BtnSecondary onClick={load}><RefreshCw size={13} className="mr-1" />Refresh</BtnSecondary>
            <BtnPrimary onClick={() => setShowImport(true)}>
              <Upload size={13} className="mr-1.5" /> Import Statement
            </BtnPrimary>
          </div>
        }
      />

      <main className="flex-1 overflow-y-auto p-6 bg-gray-50">
        <div className="max-w-4xl mx-auto w-full space-y-5">

          <div className="bg-blue-50 border border-blue-100 rounded-2xl px-5 py-4">
            <p className="text-xs font-semibold text-blue-700 mb-0.5">How this works</p>
            <p className="text-[11px] text-blue-600 leading-relaxed">
              Import a bank statement CSV. Credits are auto-matched to open invoices by amount and reference.
              Green lines are matched with high confidence. Amber lines need your review.
              Confirming a match registers the payment directly in the accounting system.
            </p>
          </div>

          {loading ? (
            <LoadingState />
          ) : statements.length === 0 ? (
            <div className="bg-white rounded-2xl border border-gray-100 px-6 py-16 text-center">
              <Landmark size={32} className="mx-auto text-gray-200 mb-3" />
              <p className="text-sm font-semibold text-gray-500 mb-1">No statements imported yet</p>
              <p className="text-xs text-gray-400 mb-4">Import an FNB or Nedbank business CSV to get started</p>
              <BtnPrimary onClick={() => setShowImport(true)}>
                <Upload size={13} className="mr-1.5" /> Import Statement
              </BtnPrimary>
            </div>
          ) : (
            <div className="bg-white rounded-2xl border border-gray-100 overflow-hidden">
              <table className="w-full text-sm">
                <thead>
                  <tr className="border-b border-gray-100 bg-gray-50">
                    <th className="text-left px-5 py-3 text-[11px] font-semibold text-gray-400 uppercase tracking-wide">Statement</th>
                    <th className="text-left px-5 py-3 text-[11px] font-semibold text-gray-400 uppercase tracking-wide">Period</th>
                    <th className="text-right px-5 py-3 text-[11px] font-semibold text-gray-400 uppercase tracking-wide">Credits</th>
                    <th className="text-center px-5 py-3 text-[11px] font-semibold text-gray-400 uppercase tracking-wide">Lines</th>
                    <th className="text-center px-5 py-3 text-[11px] font-semibold text-gray-400 uppercase tracking-wide">Matched</th>
                    <th className="text-center px-5 py-3 text-[11px] font-semibold text-gray-400 uppercase tracking-wide">Unmatched</th>
                    <th className="px-5 py-3" />
                  </tr>
                </thead>
                <tbody className="divide-y divide-gray-50">
                  {statements.map(s => {
                    const unmatched = s.line_count - s.matched_count - s.excluded_count;
                    return (
                      <tr key={s.id} className="hover:bg-gray-50 cursor-pointer group" onClick={() => setOpenStatement(s.id)}>
                        <td className="px-5 py-3.5">
                          <p className="font-semibold text-gray-900 text-xs">{s.journal_name}</p>
                          <p className="text-[11px] text-gray-400">
                            {s.format?.toUpperCase()} · Imported {fmtDate(s.imported_at)} by {s.imported_by_name}
                          </p>
                        </td>
                        <td className="px-5 py-3.5 text-xs text-gray-500 whitespace-nowrap">
                          {s.date_from} — {s.date_to}
                        </td>
                        <td className="px-5 py-3.5 text-right text-sm font-semibold text-gray-900 whitespace-nowrap">
                          {fmtR(s.total_credits)}
                        </td>
                        <td className="px-5 py-3.5 text-center text-xs text-gray-600">{s.line_count}</td>
                        <td className="px-5 py-3.5 text-center">
                          <span className="text-xs font-semibold text-green-700">{s.matched_count}</span>
                        </td>
                        <td className="px-5 py-3.5 text-center">
                          {unmatched > 0 ? (
                            <span className="text-xs font-semibold text-amber-700">{unmatched}</span>
                          ) : (
                            <span className="text-xs text-gray-300">0</span>
                          )}
                        </td>
                        <td className="px-5 py-3.5 text-right">
                          <Eye size={14} className="text-gray-300 group-hover:text-bassani-500 transition-colors" />
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          )}
        </div>
      </main>

      {showImport && (
        <ImportModal
          onClose={() => setShowImport(false)}
          onDone={statementId => {
            setShowImport(false);
            load();
            setOpenStatement(statementId);
          }}
        />
      )}
    </div>
  );
}
