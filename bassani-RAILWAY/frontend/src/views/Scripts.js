import { useState, useEffect, useCallback } from "react";
import { AlertTriangle, CheckCircle, XCircle, Clock, ScrollText, Loader2 } from "lucide-react";
import api from "../api";
import toast from "react-hot-toast";
import {
  TopBar, Modal, FormGroup, Input, BtnPrimary, BtnSecondary,
  LoadingState, EmptyState, fmtR, fmtDate, Badge,
} from "../components/UI";

// ── Status helpers ─────────────────────────────────────────────────────────────

const STATUS_CFG = {
  expired:   { label: "Expired",       cls: "bg-red-50 text-red-700",    Icon: XCircle      },
  warning:   { label: "Expiring soon", cls: "bg-amber-50 text-amber-700",Icon: AlertTriangle },
  no_script: { label: "No script",     cls: "bg-gray-100 text-gray-500", Icon: Clock        },
  no_expiry: { label: "No expiry set", cls: "bg-gray-100 text-gray-500", Icon: Clock        },
  active:    { label: "Active",        cls: "bg-green-50 text-green-700",Icon: CheckCircle  },
};

function ScriptBadge({ status }) {
  const cfg = STATUS_CFG[status] || STATUS_CFG.active;
  const { Icon } = cfg;
  return (
    <span className={`inline-flex items-center gap-1 text-xs font-medium px-2 py-0.5 rounded-full ${cfg.cls}`}>
      <Icon size={10} />{cfg.label}
    </span>
  );
}

function KpiCard({ label, value, accent, Icon }) {
  return (
    <div className="bg-white rounded-2xl border border-gray-100 p-5 flex items-start gap-4">
      <div className={`w-10 h-10 rounded-xl flex items-center justify-center shrink-0 ${accent}`}>
        <Icon size={18} className="text-white" />
      </div>
      <div>
        <p className="text-xs text-gray-400 font-medium mb-0.5">{label}</p>
        <p className="text-2xl font-bold text-gray-900">{value}</p>
      </div>
    </div>
  );
}

// ── Renew / Upsert modal ───────────────────────────────────────────────────────

const BLANK_SCRIPT = { script_number: "", expiry_date: "", prescribing_doctor: "" };

function ScriptModal({ patient, onClose, onSaved }) {
  const isNew = !patient.s21script;
  const [form,   setForm  ] = useState({
    script_number:      patient.s21script       || "",
    expiry_date:        patient.expiry_date      || "",
    prescribing_doctor: patient.doctor           || "",
  });
  const [saving, setSaving] = useState(false);

  const save = async () => {
    if (!form.script_number) return toast.error("Script number required");
    if (!form.expiry_date)   return toast.error("Expiry date required");
    setSaving(true);
    try {
      await api.post(`/api/scripts/${patient.id}`, form);
      toast.success(isNew ? "Script added" : "Script updated");
      onSaved();
      onClose();
    } catch (e) {
      toast.error(e.response?.data?.detail || "Save failed");
    } finally { setSaving(false); }
  };

  return (
    <Modal title={isNew ? `Add Script — ${patient.patient_name}` : `Renew Script — ${patient.patient_name}`} onClose={onClose}>
      <div className="space-y-3">
        <FormGroup label="Script Number" required>
          <Input value={form.script_number} onChange={e => setForm({ ...form, script_number: e.target.value })}
            placeholder="e.g. S21/2024/001234" autoFocus />
        </FormGroup>
        <FormGroup label="Expiry Date" required>
          <Input type="date" value={form.expiry_date} onChange={e => setForm({ ...form, expiry_date: e.target.value })} />
        </FormGroup>
        <FormGroup label="Prescribing Doctor">
          <Input value={form.prescribing_doctor} onChange={e => setForm({ ...form, prescribing_doctor: e.target.value })}
            placeholder="Dr. J. Smith" />
        </FormGroup>
      </div>
      <div className="flex justify-end gap-2 mt-5">
        <BtnSecondary onClick={onClose} disabled={saving}>Cancel</BtnSecondary>
        <BtnPrimary onClick={save} loading={saving}>{isNew ? "Add Script" : "Save Changes"}</BtnPrimary>
      </div>
    </Modal>
  );
}

// ── Add new patient modal ──────────────────────────────────────────────────────

function AddPatientModal({ onClose, onSaved }) {
  const [custSearch,   setCustSearch  ] = useState("");
  const [custResults,  setCustResults ] = useState([]);
  const [custLoading,  setCustLoading ] = useState(false);
  const [selected,     setSelected    ] = useState(null);
  const [form,         setForm        ] = useState(BLANK_SCRIPT);
  const [saving,       setSaving      ] = useState(false);

  useEffect(() => {
    if (custSearch.length < 2) { setCustResults([]); return; }
    const t = setTimeout(async () => {
      setCustLoading(true);
      try {
        const r = await api.get("/api/customers/search", { params: { q: custSearch, limit: 8 } });
        setCustResults(r.data.customers || []);
      } catch { setCustResults([]); }
      finally { setCustLoading(false); }
    }, 300);
    return () => clearTimeout(t);
  }, [custSearch]);

  const save = async () => {
    if (!selected)           return toast.error("Select a patient first");
    if (!form.script_number) return toast.error("Script number required");
    if (!form.expiry_date)   return toast.error("Expiry date required");
    setSaving(true);
    try {
      await api.post(`/api/scripts/${selected.id}`, form);
      toast.success(`Script added for ${selected.name}`);
      onSaved();
      onClose();
    } catch (e) {
      toast.error(e.response?.data?.detail || "Save failed");
    } finally { setSaving(false); }
  };

  return (
    <Modal title="Add Patient Script" onClose={onClose}>
      {!selected ? (
        <>
          <p className="text-sm text-gray-500 mb-3">Search for the Odoo customer to add a Section 21 script.</p>
          <FormGroup label="Search Patient">
            <div className="relative">
              <Input value={custSearch} onChange={e => setCustSearch(e.target.value)}
                placeholder="Type patient or pharmacy name…" autoFocus />
              {custLoading && <Loader2 size={13} className="animate-spin absolute right-3 top-1/2 -translate-y-1/2 text-gray-400" />}
            </div>
          </FormGroup>
          {custResults.length > 0 && (
            <div className="mt-2 border border-gray-100 rounded-xl overflow-hidden">
              {custResults.map(c => (
                <button key={c.id} onClick={() => setSelected(c)}
                  className="w-full text-left flex items-center justify-between px-3 py-2.5 border-t first:border-t-0 border-gray-50 hover:bg-gray-50 transition-colors">
                  <div>
                    <p className="text-sm font-medium text-gray-800">{c.name}</p>
                    <p className="text-xs text-gray-400">{[c.city, c.email].filter(Boolean).join(" · ") || "No contact info"}</p>
                  </div>
                  <span className="text-xs text-bassani-600 font-medium">Select</span>
                </button>
              ))}
            </div>
          )}
          {custSearch.length >= 2 && !custLoading && custResults.length === 0 && (
            <p className="text-xs text-gray-400 mt-2 text-center">No customers found for "{custSearch}"</p>
          )}
        </>
      ) : (
        <>
          <div className="flex items-center justify-between mb-4 p-3 bg-gray-50 rounded-xl">
            <div>
              <p className="font-semibold text-sm text-gray-800">{selected.name}</p>
              <p className="text-xs text-gray-400">{selected.email || selected.city || "—"}</p>
            </div>
            <button onClick={() => setSelected(null)} className="text-xs text-gray-400 hover:text-gray-600">Change</button>
          </div>
          <div className="space-y-3">
            <FormGroup label="Script Number" required>
              <Input value={form.script_number} onChange={e => setForm({ ...form, script_number: e.target.value })}
                placeholder="e.g. S21/2024/001234" autoFocus />
            </FormGroup>
            <FormGroup label="Expiry Date" required>
              <Input type="date" value={form.expiry_date} onChange={e => setForm({ ...form, expiry_date: e.target.value })} />
            </FormGroup>
            <FormGroup label="Prescribing Doctor">
              <Input value={form.prescribing_doctor} onChange={e => setForm({ ...form, prescribing_doctor: e.target.value })}
                placeholder="Dr. J. Smith" />
            </FormGroup>
          </div>
          <div className="flex justify-end gap-2 mt-5">
            <BtnSecondary onClick={onClose} disabled={saving}>Cancel</BtnSecondary>
            <BtnPrimary onClick={save} loading={saving}>Add Script</BtnPrimary>
          </div>
        </>
      )}
    </Modal>
  );
}

// ── Main view ──────────────────────────────────────────────────────────────────

export default function Scripts() {
  const [patients,  setPatients ] = useState([]);
  const [stats,     setStats    ] = useState(null);
  const [loading,   setLoading  ] = useState(true);
  const [search,    setSearch   ] = useState("");
  const [statusF,   setStatusF  ] = useState("all");
  const [renewing,  setRenewing ] = useState(null);   // patient object to renew
  const [addModal,  setAddModal ] = useState(false);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const [patientsRes, statsRes] = await Promise.all([
        api.get("/api/scripts/"),
        api.get("/api/scripts/dashboard"),
      ]);
      setPatients(patientsRes.data.patients || []);
      setStats(statsRes.data);
    } catch { toast.error("Failed to load scripts"); }
    finally { setLoading(false); }
  }, []);

  useEffect(() => { load(); }, [load]);

  const filtered = patients.filter(p => {
    const q = search.toLowerCase();
    const matchQ = !q
      || (p.patient_name || "").toLowerCase().includes(q)
      || (p.s21script    || "").toLowerCase().includes(q)
      || (p.doctor       || "").toLowerCase().includes(q);
    const matchStatus = statusF === "all" || p.script_status === statusF;
    return matchQ && matchStatus;
  });

  const STATUS_FILTERS = [
    { id: "all",      label: "All"           },
    { id: "expired",  label: "Expired"       },
    { id: "warning",  label: "Expiring soon" },
    { id: "no_script",label: "No script"     },
    { id: "active",   label: "Active"        },
  ];

  return (
    <div className="flex flex-col flex-1 overflow-hidden">
      <TopBar
        title="Section 21 Scripts"
        subtitle={stats ? `${stats.total_private_patients} private patients` : ""}
        onRefresh={load}
        actions={<BtnPrimary onClick={() => setAddModal(true)}><ScrollText size={14} />Add Script</BtnPrimary>}
      />

      <main className="flex-1 overflow-y-auto p-6 bg-gray-50">
        <div className="max-w-5xl mx-auto space-y-5">

          {/* KPI cards */}
          {stats && (
            <div className="grid grid-cols-2 lg:grid-cols-4 gap-4">
              <KpiCard label="Private Patients"  value={stats.total_private_patients} accent="bg-bassani-600" Icon={ScrollText}    />
              <KpiCard label="Expired Scripts"   value={stats.expired}                accent="bg-red-500"     Icon={XCircle}       />
              <KpiCard label="Expiring (30 days)"value={stats.expiring_30}            accent="bg-amber-500"   Icon={AlertTriangle} />
              <KpiCard label="Expiring (60 days)"value={stats.expiring_60}            accent="bg-yellow-400"  Icon={Clock}         />
            </div>
          )}

          {/* Filter + search */}
          <div className="flex flex-wrap items-center gap-2">
            <input
              type="text" value={search} onChange={e => setSearch(e.target.value)}
              placeholder="Search by name, script #, or doctor…"
              className="flex-1 min-w-0 text-sm border border-gray-200 rounded-xl px-3 py-2 focus:outline-none focus:ring-2 focus:ring-bassani-400 bg-white"
            />
            <div className="flex gap-1.5 flex-wrap">
              {STATUS_FILTERS.map(f => (
                <button key={f.id} onClick={() => setStatusF(f.id)}
                  className={`text-xs px-3 py-1.5 rounded-full font-medium transition-colors ${statusF === f.id ? "bg-bassani-600 text-white" : "bg-white border border-gray-200 text-gray-600 hover:bg-gray-50"}`}>
                  {f.label}
                </button>
              ))}
            </div>
          </div>

          {/* Patients table */}
          <div className="bg-white rounded-2xl border border-gray-100 overflow-hidden">
            {loading ? <LoadingState /> : filtered.length === 0 ? (
              <div className="py-16">
                <EmptyState />
                {patients.length === 0 && (
                  <p className="text-center text-sm text-gray-400 mt-2">
                    No private patients yet. Click "Add Script" to get started.
                  </p>
                )}
              </div>
            ) : (
              <table className="w-full text-sm">
                <thead>
                  <tr className="bg-gray-50 text-xs text-gray-500 border-b border-gray-100">
                    <th className="text-left px-5 py-3 font-medium">Patient</th>
                    <th className="text-left px-5 py-3 font-medium">Script #</th>
                    <th className="text-left px-5 py-3 font-medium">Doctor</th>
                    <th className="text-left px-5 py-3 font-medium">Expiry</th>
                    <th className="text-left px-5 py-3 font-medium">Status</th>
                    <th className="text-right px-5 py-3 font-medium">Days Left</th>
                    <th className="px-5 py-3" />
                  </tr>
                </thead>
                <tbody>
                  {filtered.map((p, i) => {
                    const overdue = p.script_status === "expired";
                    return (
                      <tr key={p.id ?? i} className="border-t border-gray-50 hover:bg-gray-50 transition-colors">
                        <td className="px-5 py-3">
                          <p className="font-medium text-gray-800">{p.patient_name}</p>
                          {p.patient_email && <p className="text-xs text-gray-400">{p.patient_email}</p>}
                        </td>
                        <td className="px-5 py-3 font-mono text-xs text-gray-700">{p.s21script || <span className="text-gray-300">—</span>}</td>
                        <td className="px-5 py-3 text-gray-500">{p.doctor || "—"}</td>
                        <td className={`px-5 py-3 font-medium ${overdue ? "text-red-600" : "text-gray-600"}`}>
                          {p.expiry_date ? fmtDate(p.expiry_date) : "—"}
                        </td>
                        <td className="px-5 py-3"><ScriptBadge status={p.script_status} /></td>
                        <td className={`px-5 py-3 text-right font-semibold tabular-nums ${overdue ? "text-red-600" : p.script_status === "warning" ? "text-amber-600" : "text-gray-500"}`}>
                          {p.days_remaining != null ? (
                            overdue ? `${Math.abs(p.days_remaining)}d ago` : `${p.days_remaining}d`
                          ) : "—"}
                        </td>
                        <td className="px-5 py-3 text-right">
                          <BtnSecondary size="sm" onClick={() => setRenewing(p)}>
                            {p.s21script ? "Renew" : "Add"}
                          </BtnSecondary>
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            )}
          </div>
        </div>
      </main>

      {renewing && (
        <ScriptModal patient={renewing} onClose={() => setRenewing(null)} onSaved={load} />
      )}
      {addModal && (
        <AddPatientModal onClose={() => setAddModal(false)} onSaved={load} />
      )}
    </div>
  );
}
