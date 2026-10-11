// Customer statement of account (7.17) — the Account Statement card on the
// customer profile. Replaces the old 7.3 invoice list: a real statement
// (opening balance, invoices, payments, credit notes, running balance,
// closing balance) or an open-items view, ageing, one Odoo company at a time.
// Download as PDF/Excel, or email it via the shared recipient picker. Invoice
// and credit note numbers open InvoiceDetailModal for payment and other actions.
import { useState, useEffect, useCallback } from "react";
import toast from "react-hot-toast";
import { Mail, FileSpreadsheet, FileText, RefreshCw, Loader2, AlertTriangle } from "lucide-react";
import api from "../api";
import { useAuth } from "../AuthContext";
import { Input, Select, FilterPill, Pager, fmtR, fmtDate, fmtDateTime } from "./UI";
import SendRecipientsModal from "./SendRecipientsModal";
import InvoiceDetailModal from "./InvoiceDetailModal";

const iso = (d) => {
  const p = (n) => String(n).padStart(2, "0");
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}`;
};

// South African financial year runs March to February, matching Reports.
function presetRange(key) {
  const now = new Date();
  const y = now.getFullYear(), m = now.getMonth();
  switch (key) {
    case "this_month": return [iso(new Date(y, m, 1)), iso(now)];
    case "last_month": return [iso(new Date(y, m - 1, 1)), iso(new Date(y, m, 0))];
    case "last_3":     return [iso(new Date(y, m - 2, 1)), iso(now)];
    case "fy": {
      const fyStart = m >= 2 ? new Date(y, 2, 1) : new Date(y - 1, 2, 1);
      return [iso(fyStart), iso(now)];
    }
    case "all":        return ["", iso(now)];
    default:           return null;
  }
}

const PRESETS = [
  ["this_month", "This month"],
  ["last_month", "Last month"],
  ["last_3", "Last 3 months"],
  ["fy", "This financial year"],
  ["all", "All time"],
];

const KIND_STYLE = {
  invoice: "bg-gray-100 text-gray-600",
  credit_note: "bg-purple-50 text-purple-700 border border-purple-100",
  payment: "bg-green-50 text-green-700 border border-green-100",
  refund: "bg-amber-50 text-amber-700 border border-amber-100",
  adjustment: "bg-blue-50 text-blue-700 border border-blue-100",
};

const PAGE_SIZE = 15;

function filenameFrom(disposition, fallback) {
  const m = /filename="?([^"]+)"?/.exec(disposition || "");
  return m ? m[1] : fallback;
}

export default function CustomerStatement({ customerId, onFinanceChanged }) {
  const { can, user } = useAuth();
  const canEmail = can("customers.send_statement");
  const isStaff = !["reseller", "customer"].includes(user?.role);

  const [mode, setMode] = useState("activity");
  const [preset, setPreset] = useState("last_3");
  const [range, setRange] = useState(() => presetRange("last_3"));
  const [companyId, setCompanyId] = useState(null);
  const [stmt, setStmt] = useState(null);
  const [loading, setLoading] = useState(true);
  const [page, setPage] = useState(0);
  const [downloading, setDownloading] = useState(null); // "pdf" | "xlsx" | null
  const [emailOpen, setEmailOpen] = useState(false);
  const [emailFormats, setEmailFormats] = useState({ pdf: true, xlsx: false });
  const [sends, setSends] = useState([]);
  const [showSends, setShowSends] = useState(false);
  const [openInvoiceId, setOpenInvoiceId] = useState(null);

  const params = useCallback(() => {
    const p = { mode };
    if (companyId) p.company_id = companyId;
    if (mode === "activity") {
      if (range?.[0]) p.date_from = range[0];
      if (range?.[1]) p.date_to = range[1];
    }
    return p;
  }, [mode, companyId, range]);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const r = await api.get(`/api/customers/${customerId}/statement`, { params: params() });
      setStmt(r.data);
      setPage(0);
      if (!companyId && r.data.company?.id) setCompanyId(r.data.company.id);
    } catch (e) {
      toast.error(e.response?.data?.detail || "Failed to load account statement");
    } finally {
      setLoading(false);
    }
  }, [customerId, params]); // eslint-disable-line

  const loadSends = useCallback(() => {
    if (!isStaff) return;
    api.get(`/api/customers/${customerId}/statement/sends`)
      .then(r => setSends(r.data.sends || []))
      .catch(() => setSends([]));
  }, [customerId, isStaff]);

  useEffect(() => { load(); }, [load]);
  useEffect(() => { loadSends(); }, [loadSends]);

  const choosePreset = (key) => {
    setPreset(key);
    setRange(presetRange(key));
  };

  const download = async (format) => {
    setDownloading(format);
    try {
      const r = await api.get(`/api/customers/${customerId}/statement/export`, {
        params: { ...params(), format }, responseType: "blob",
      });
      const name = filenameFrom(r.headers?.["content-disposition"], `Statement.${format}`);
      const url = URL.createObjectURL(r.data);
      const a = document.createElement("a");
      a.href = url; a.download = name;
      document.body.appendChild(a); a.click(); a.remove();
      setTimeout(() => URL.revokeObjectURL(url), 2000);
    } catch (e) {
      let msg = "Download failed";
      try { msg = JSON.parse(await e.response.data.text()).detail || msg; } catch { /* not JSON */ }
      toast.error(msg);
    } finally {
      setDownloading(null);
    }
  };

  const doEmail = async (recipients) => {
    const formats = Object.entries(emailFormats).filter(([, v]) => v).map(([k]) => k);
    if (formats.length === 0) {
      toast.error("Choose PDF, Excel or both");
      throw new Error("no format");
    }
    try {
      const p = params();
      await api.post(`/api/customers/${customerId}/statement/email`, {
        company_id: stmt.company.id, mode, date_from: p.date_from, date_to: p.date_to,
        recipients, formats,
      });
      toast.success(`Statement sent to ${recipients[0]}${recipients.length > 1 ? ` and ${recipients.length - 1} more` : ""}`);
      loadSends();
    } catch (e) {
      toast.error(e.response?.data?.detail || "Failed to send statement");
      throw e;
    }
  };

  const onInvoiceChanged = () => { load(); onFinanceChanged?.(); };

  const s = stmt?.summary;
  const ageing = stmt?.ageing;
  const rows = stmt?.rows || [];
  const slice = rows.slice(page * PAGE_SIZE, (page + 1) * PAGE_SIZE);
  const hasAccount = !!stmt?.company;
  const lastSend = sends[0];
  // Data rendering follows the loaded statement's own mode, so switching
  // modes never briefly renders one shape with the other's columns.
  const isOpen = stmt?.mode === "open";

  const summaryTiles = !s ? [] : isOpen ? [
    { label: "Overdue", value: s.overdue, color: s.overdue > 0 ? "text-red-600" : "text-gray-800" },
    { label: "Unallocated credits", value: s.unallocated, color: s.unallocated < 0 ? "text-amber-700" : "text-gray-800" },
    { label: s.total_due < 0 ? "Balance in credit" : "Total due", value: s.total_due, color: s.total_due > 0 ? "text-red-600" : "text-green-700", strong: true },
  ] : [
    { label: "Opening balance", value: s.opening_balance, color: "text-gray-800" },
    { label: "Invoices", value: s.invoiced, color: "text-gray-800" },
    { label: "Payments received", value: -s.payments, color: "text-green-700" },
    { label: "Credit notes", value: -s.credit_notes, color: "text-purple-700" },
    { label: "Closing balance", value: s.closing_balance, color: s.closing_balance > 0 ? "text-red-600" : "text-green-700", strong: true },
  ];

  return (
    <div className="bg-white rounded-2xl border border-gray-100 overflow-hidden">
      {/* Header */}
      <div className="px-5 py-4 border-b border-gray-50 flex flex-wrap items-center justify-between gap-3">
        <div>
          <h3 className="font-semibold text-gray-800 text-sm">Account Statement</h3>
          {isStaff && lastSend && (
            <button type="button" onClick={() => setShowSends(v => !v)} className="text-[11px] text-gray-400 hover:text-gray-600 mt-0.5 text-left">
              Last sent {fmtDateTime(lastSend.sent_at)} to {lastSend.recipients[0]}{lastSend.recipients.length > 1 ? ` +${lastSend.recipients.length - 1}` : ""} by {lastSend.sent_by?.name}
              {sends.length > 1 ? ` · ${showSends ? "hide" : "show"} history` : ""}
            </button>
          )}
        </div>
        {hasAccount && (
          <div className="flex flex-wrap items-center gap-2">
            <button type="button" onClick={() => download("pdf")} disabled={!!downloading || loading}
              className="inline-flex items-center gap-1.5 px-3 py-1.5 text-xs font-medium rounded-lg border border-gray-200 text-gray-700 hover:bg-gray-50 disabled:opacity-50">
              {downloading === "pdf" ? <Loader2 size={13} className="animate-spin" /> : <FileText size={13} />}PDF
            </button>
            <button type="button" onClick={() => download("xlsx")} disabled={!!downloading || loading}
              className="inline-flex items-center gap-1.5 px-3 py-1.5 text-xs font-medium rounded-lg border border-gray-200 text-gray-700 hover:bg-gray-50 disabled:opacity-50">
              {downloading === "xlsx" ? <Loader2 size={13} className="animate-spin" /> : <FileSpreadsheet size={13} />}Excel
            </button>
            {canEmail && (
              <button type="button" onClick={() => setEmailOpen(true)} disabled={loading}
                className="inline-flex items-center gap-1.5 px-3 py-1.5 text-xs font-medium rounded-lg bg-bassani-600 text-white hover:bg-bassani-700 disabled:opacity-50">
                <Mail size={13} />Email Statement
              </button>
            )}
          </div>
        )}
      </div>

      {/* Send history */}
      {showSends && sends.length > 0 && (
        <div className="px-5 py-3 border-b border-gray-50 bg-gray-50/60 space-y-1">
          {sends.map(x => (
            <p key={x.id} className="text-[11px] text-gray-500">
              <span className="text-gray-700 font-medium">{fmtDateTime(x.sent_at)}</span>
              {" "}· {x.period_label} · {x.company_name} · to {x.recipients.join(", ")} · {x.formats.map(f => f === "xlsx" ? "Excel" : "PDF").join(" + ")} · by {x.sent_by?.name}
            </p>
          ))}
        </div>
      )}

      {/* Controls */}
      <div className="px-5 py-3 border-b border-gray-50 space-y-3">
        <div className="flex flex-wrap items-center gap-2">
          <FilterPill label="Activity" active={mode === "activity"} onClick={() => setMode("activity")} />
          <FilterPill label="Open items" active={mode === "open"} onClick={() => setMode("open")} />
          {stmt?.companies?.length > 1 && (
            <Select value={companyId || ""} onChange={e => setCompanyId(Number(e.target.value))} className="w-auto text-xs">
              {stmt.companies.map(c => <option key={c.id} value={c.id}>{c.name} ({fmtR(c.balance)})</option>)}
            </Select>
          )}
          {stmt?.companies?.length === 1 && (
            <span className="text-xs text-gray-400">{stmt.companies[0].name}</span>
          )}
          <button type="button" onClick={load} disabled={loading} title="Refresh"
            className="ml-auto p-1.5 rounded-lg text-gray-400 hover:text-gray-600 hover:bg-gray-50 disabled:opacity-50">
            <RefreshCw size={14} className={loading ? "animate-spin" : ""} />
          </button>
        </div>
        {mode === "activity" && (
          <div className="flex flex-wrap items-end gap-2">
            <div className="flex flex-wrap gap-1.5">
              {PRESETS.map(([k, label]) => (
                <button key={k} type="button" onClick={() => choosePreset(k)}
                  className={`px-2.5 py-1 text-[11px] rounded-full border transition-colors ${preset === k ? "bg-bassani-50 border-bassani-200 text-bassani-700 font-medium" : "border-gray-200 text-gray-500 hover:bg-gray-50"}`}>
                  {label}
                </button>
              ))}
            </div>
            <div className="flex items-end gap-2 ml-auto">
              <div>
                <p className="text-[11px] text-gray-400 mb-0.5">From</p>
                <Input type="date" value={range?.[0] || ""} className="w-36"
                  onChange={e => { setPreset(null); setRange(r => [e.target.value, r?.[1] || ""]); }} />
              </div>
              <div>
                <p className="text-[11px] text-gray-400 mb-0.5">To</p>
                <Input type="date" value={range?.[1] || ""} className="w-36"
                  onChange={e => { setPreset(null); setRange(r => [r?.[0] || "", e.target.value]); }} />
              </div>
            </div>
          </div>
        )}
      </div>

      {loading && !stmt ? (
        <p className="px-5 py-6 text-xs text-gray-400">Loading statement…</p>
      ) : !hasAccount ? (
        <p className="px-5 py-6 text-sm text-gray-400">No account activity yet. A statement becomes available once the first invoice is posted.</p>
      ) : (
        <div className={loading ? "opacity-60 transition-opacity" : ""}>
          {/* Summary */}
          <div className={`grid grid-cols-2 ${isOpen ? "md:grid-cols-3" : "md:grid-cols-5"} divide-x divide-gray-50 border-b border-gray-50`}>
            {summaryTiles.map(t => (
              <div key={t.label} className="px-5 py-3">
                <p className="text-xs text-gray-400 mb-0.5">{t.label}</p>
                <p className={`text-sm ${t.strong ? "font-bold" : "font-semibold"} ${t.color}`}>{fmtR(t.value)}</p>
              </div>
            ))}
          </div>

          {/* Ageing */}
          {ageing && (
            <div className="px-5 py-3 border-b border-gray-50">
              <p className="text-[11px] text-gray-400 mb-1.5">Ageing as at today</p>
              <div className="grid grid-cols-3 sm:grid-cols-6 gap-1.5">
                {ageing.buckets.map(b => {
                  const tone = b.amount <= 0 ? "bg-gray-50 text-gray-400"
                    : b.key === "current" ? "bg-green-50 text-green-700"
                    : ["d30", "d60"].includes(b.key) ? "bg-amber-50 text-amber-700"
                    : "bg-red-50 text-red-700";
                  return (
                    <div key={b.key} className={`rounded-lg px-2 py-1.5 ${tone}`}>
                      <p className="text-[10px] opacity-80">{b.label}</p>
                      <p className="text-xs font-semibold">{fmtR(b.amount)}</p>
                    </div>
                  );
                })}
              </div>
              {ageing.unallocated < -0.005 && (
                <p className="text-[11px] text-amber-700 mt-2">
                  {fmtR(-ageing.unallocated)} in payments or credits is not yet matched to an invoice. Open an unpaid invoice below to apply it.
                </p>
              )}
            </div>
          )}

          {stmt.truncated && (
            <p className="px-5 py-2 text-xs text-red-600 bg-red-50 border-b border-red-100 flex items-center gap-1.5">
              <AlertTriangle size={13} />This statement is too long to show in full. Choose a shorter period.
            </p>
          )}

          {/* Transactions */}
          {rows.length === 0 ? (
            <p className="px-5 py-4 text-sm text-gray-400">{isOpen ? "Nothing outstanding. The account is settled." : "No transactions in this period."}</p>
          ) : (
            <>
              <div className="overflow-x-auto">
                <table className="w-full text-sm">
                  <thead>
                    <tr className="bg-gray-50 text-xs text-gray-500">
                      <th className="text-left px-5 py-2.5 font-medium">Date</th>
                      <th className="text-left px-5 py-2.5 font-medium">Number</th>
                      <th className="text-left px-5 py-2.5 font-medium">Type</th>
                      <th className="text-left px-5 py-2.5 font-medium hidden md:table-cell">Reference</th>
                      <th className="text-left px-5 py-2.5 font-medium">Due</th>
                      {isOpen ? (
                        <>
                          <th className="text-right px-5 py-2.5 font-medium">Days overdue</th>
                          <th className="text-right px-5 py-2.5 font-medium">Outstanding</th>
                        </>
                      ) : (
                        <>
                          <th className="text-right px-5 py-2.5 font-medium">Debit</th>
                          <th className="text-right px-5 py-2.5 font-medium">Credit</th>
                          <th className="text-right px-5 py-2.5 font-medium">Balance</th>
                        </>
                      )}
                    </tr>
                  </thead>
                  <tbody>
                    {!isOpen && page === 0 && stmt.date_from && (
                      <tr className="border-t border-gray-50 bg-gray-50/40">
                        <td className="px-5 py-2.5 text-gray-500">{fmtDate(stmt.date_from)}</td>
                        <td colSpan={6} className="px-5 py-2.5 text-xs italic text-gray-500">Opening balance</td>
                        <td className="px-5 py-2.5 text-right font-semibold">{fmtR(s.opening_balance)}</td>
                      </tr>
                    )}
                    {slice.map(r => {
                      const owed = (r.residual || 0) > 0;
                      const overdue = isOpen && owed && r.days_overdue > 0;
                      const showDue = r.kind === "invoice" || r.kind === "credit_note";
                      return (
                        <tr key={r.move_id} className="border-t border-gray-50 hover:bg-gray-50 transition-colors">
                          <td className="px-5 py-2.5 text-gray-500 whitespace-nowrap">{fmtDate(r.date)}</td>
                          <td className="px-5 py-2.5 font-mono text-xs whitespace-nowrap">
                            {r.openable && isStaff ? (
                              <button type="button" onClick={() => setOpenInvoiceId(r.move_id)}
                                className="text-bassani-700 hover:text-bassani-800 hover:underline font-semibold">
                                {r.number}
                              </button>
                            ) : <span className="text-gray-700">{r.number}</span>}
                          </td>
                          <td className="px-5 py-2.5">
                            <span className={`text-[10px] px-1.5 py-0.5 rounded-full font-semibold whitespace-nowrap ${KIND_STYLE[r.kind] || KIND_STYLE.invoice}`}>{r.type_label}</span>
                          </td>
                          <td className="px-5 py-2.5 text-xs text-gray-500 hidden md:table-cell max-w-[180px] truncate" title={r.reference}>{r.reference}</td>
                          <td className={`px-5 py-2.5 whitespace-nowrap ${overdue ? "text-red-600 font-medium" : "text-gray-500"}`}>
                            {showDue && r.due_date ? fmtDate(r.due_date) : ""}
                          </td>
                          {isOpen ? (
                            <>
                              <td className={`px-5 py-2.5 text-right ${overdue ? "text-red-600 font-semibold" : "text-gray-400"}`}>{owed ? r.days_overdue : ""}</td>
                              <td className={`px-5 py-2.5 text-right font-semibold ${owed ? "text-red-600" : "text-green-700"}`}>{fmtR(r.residual)}</td>
                            </>
                          ) : (
                            <>
                              <td className="px-5 py-2.5 text-right">{r.debit ? fmtR(r.debit) : ""}</td>
                              <td className="px-5 py-2.5 text-right text-green-700">{r.credit ? fmtR(r.credit) : ""}</td>
                              <td className={`px-5 py-2.5 text-right font-semibold ${r.running_balance > 0 ? "text-gray-800" : "text-green-700"}`}>{fmtR(r.running_balance)}</td>
                            </>
                          )}
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
              </div>
              {rows.length > PAGE_SIZE && (
                <div className="px-5 py-2 border-t border-gray-50">
                  <Pager pageIndex={page} pageSize={PAGE_SIZE} total={rows.length} onPageChange={setPage} />
                </div>
              )}
            </>
          )}
        </div>
      )}

      {emailOpen && stmt?.company && (
        <SendRecipientsModal
          partnerId={stmt.customer.id}
          title="Email Statement"
          onClose={() => setEmailOpen(false)}
          onSend={doEmail}
        >
          <div className="bg-gray-50 rounded-xl p-3 mb-3 text-sm space-y-2">
            <div className="flex justify-between gap-2">
              <span className="text-gray-500">Statement</span>
              <span className="font-medium text-right">{stmt.period_label}</span>
            </div>
            <div className="flex justify-between gap-2">
              <span className="text-gray-500">From</span>
              <span className="font-medium text-right">{stmt.company.name}</span>
            </div>
            <div className="flex items-center gap-4 pt-1">
              <span className="text-gray-500">Attach</span>
              {[["pdf", "PDF"], ["xlsx", "Excel"]].map(([k, label]) => (
                <label key={k} className="inline-flex items-center gap-1.5 cursor-pointer">
                  <input type="checkbox" checked={emailFormats[k]}
                    onChange={e => setEmailFormats(f => ({ ...f, [k]: e.target.checked }))}
                    className="rounded border-gray-300 text-bassani-600 focus:ring-bassani-500" />
                  {label}
                </label>
              ))}
            </div>
          </div>
        </SendRecipientsModal>
      )}

      {openInvoiceId && (
        <InvoiceDetailModal invoiceId={openInvoiceId} onClose={() => setOpenInvoiceId(null)} onChanged={onInvoiceChanged} />
      )}
    </div>
  );
}
