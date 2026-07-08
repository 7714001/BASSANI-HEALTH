import { useState, useEffect, useCallback, useMemo } from "react";
import { useNavigate } from "react-router-dom";
import { CheckCircle, XCircle, Clock, ArrowRight, PenLine, FileCheck } from "lucide-react";
import api from "../api";
import toast from "react-hot-toast";
import { TopBar, DataTable, FilterPill, ChipRow, SearchBar, fmtDate } from "../components/UI";

// ── Derived status ─────────────────────────────────────────────────────────────

const BASSANI_SIG_TYPES = new Set(["nda", "tqa", "store_onboarding_agreement"]);

function deriveStatus(app) {
  const s = app.status;
  if (s === "approved")      return "approved";
  if (s === "rejected")      return "rejected";
  if (s === "awaiting_docs") return "awaiting_docs";

  // For pending apps, reflect countersign progress on portal-signed docs
  const docs   = app.documents || [];
  const bdocs  = docs.filter(d => d.signed_in_portal && BASSANI_SIG_TYPES.has(d.doc_type));
  if (!bdocs.length) return "ready_to_approve";

  const signed = bdocs.filter(d => d.countersigned_at).length;
  if (signed === 0)            return "needs_countersigning";
  if (signed < bdocs.length)   return "countersigning_in_progress";
  return "ready_to_approve";
}

// ── Status badge ───────────────────────────────────────────────────────────────

const STATUS_CFG = {
  awaiting_docs:              { label: "Awaiting Docs",    cls: "bg-amber-50 text-amber-700",   icon: Clock       },
  needs_countersigning:       { label: "Needs Countersign",cls: "bg-blue-50 text-blue-700",     icon: PenLine     },
  countersigning_in_progress: { label: "In Progress",      cls: "bg-purple-50 text-purple-700", icon: PenLine     },
  ready_to_approve:           { label: "Ready to Approve", cls: "bg-teal-50 text-teal-700",     icon: FileCheck   },
  approved:                   { label: "Approved",         cls: "bg-green-50 text-green-700",   icon: CheckCircle },
  rejected:                   { label: "Rejected",         cls: "bg-red-50 text-red-700",       icon: XCircle     },
};

function StatusBadge({ derivedStatus }) {
  const cfg  = STATUS_CFG[derivedStatus] || { label: derivedStatus, cls: "bg-gray-50 text-gray-700", icon: Clock };
  const Icon = cfg.icon;
  return (
    <span className={`inline-flex items-center gap-1 text-[10px] px-2 py-0.5 rounded-full font-semibold ${cfg.cls}`}>
      <Icon size={10} />{cfg.label}
    </span>
  );
}

// ── Filter definitions ─────────────────────────────────────────────────────────

const FILTERS = [
  { key: "all",                        label: "All"              },
  { key: "awaiting_docs",              label: "Awaiting Docs"    },
  { key: "needs_countersigning",       label: "Needs Countersign"},
  { key: "countersigning_in_progress", label: "In Progress"      },
  { key: "ready_to_approve",           label: "Ready to Approve" },
  { key: "approved",                   label: "Approved"         },
  { key: "rejected",                   label: "Rejected"         },
];

// ── Main view ──────────────────────────────────────────────────────────────────

export default function CustomerApplications() {
  const navigate = useNavigate();
  const [allApps,    setAllApps   ] = useState([]);
  const [loading,    setLoading   ] = useState(true);
  const [filter,     setFilter    ] = useState("all");
  const [search,     setSearch    ] = useState("");
  const [pagination, setPagination] = useState({ pageIndex: 0, pageSize: 25 });

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const { data } = await api.get("/api/onboarding/", {
        params: { limit: 200, offset: 0, status: "all" },
      });
      setAllApps(data.applications || []);
    } catch {
      toast.error("Failed to load applications");
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => { load(); }, [load]);

  const enriched = useMemo(() =>
    allApps.map(a => ({ ...a, _derived: deriveStatus(a) })),
    [allApps]
  );

  const filtered = useMemo(() => {
    let apps = filter === "all" ? enriched : enriched.filter(a => a._derived === filter);
    if (search.trim()) {
      const q = search.trim().toLowerCase();
      apps = apps.filter(a =>
        a.company_name?.toLowerCase().includes(q) ||
        a.id?.toLowerCase().includes(q) ||
        a.contact_email?.toLowerCase().includes(q) ||
        a.contact_name?.toLowerCase().includes(q)
      );
    }
    return apps;
  }, [enriched, filter, search]);

  const subtitle = useMemo(() => {
    const n   = filtered.length;
    const lbl = FILTERS.find(f => f.key === filter)?.label.toLowerCase() || "";
    return filter === "all"
      ? `${n} application${n !== 1 ? "s" : ""}`
      : `${n} ${lbl} application${n !== 1 ? "s" : ""}`;
  }, [filtered, filter]);

  return (
    <div className="flex flex-col flex-1 overflow-hidden">
      <TopBar
        title="Customer Applications"
        subtitle={subtitle}
        onRefresh={load}
      />
      <main className="flex-1 overflow-y-auto p-6">
        <div className="mb-4 flex items-center justify-between gap-4 flex-wrap">
          <ChipRow>
            {FILTERS.map(f => (
              <FilterPill
                key={f.key}
                label={f.label}
                active={filter === f.key}
                onClick={() => { setFilter(f.key); setPagination(p => ({ ...p, pageIndex: 0 })); }}
              />
            ))}
          </ChipRow>
          <SearchBar
            value={search}
            onChange={v => { setSearch(v); setPagination(p => ({ ...p, pageIndex: 0 })); }}
            placeholder="Search by name, email or reference…"
          />
        </div>

        <DataTable
          columns={[
            { accessorKey: "id", header: "Reference",
              cell: ({ row: { original: a } }) =>
                <span className="font-mono text-xs text-bassani-700 font-semibold">{a.id}</span> },
            { id: "company", header: "Business Name", enableSorting: false,
              cell: ({ row: { original: a } }) => (
                <div>
                  <p className="font-semibold text-sm text-gray-900">{a.company_name}</p>
                  {a.trading_name && <p className="text-xs text-gray-400">t/a {a.trading_name}</p>}
                </div>
              )},
            { id: "reseller", header: "Submitted By", enableSorting: false,
              cell: ({ row: { original: a } }) => a.reseller_name
                ? <span className="text-xs font-medium text-purple-700 bg-purple-50 px-2 py-0.5 rounded-full">{a.reseller_name}</span>
                : <span className="text-xs font-medium text-gray-500 bg-gray-100 px-2 py-0.5 rounded-full">Direct Application</span> },
            { id: "type", header: "Type", enableSorting: false,
              cell: ({ row: { original: a } }) =>
                <span className="text-xs text-gray-500">{a.business_type}</span> },
            { id: "contact", header: "Contact", enableSorting: false,
              cell: ({ row: { original: a } }) => (
                <div>
                  <p className="text-xs font-medium text-gray-700">{a.contact_name}</p>
                  <p className="text-xs text-gray-400">{a.contact_email}</p>
                </div>
              )},
            { id: "submitted_at", header: "Submitted", enableSorting: false,
              cell: ({ row: { original: a } }) =>
                <span className="text-xs text-gray-400">{fmtDate(a.submitted_at)}</span> },
            { id: "status", header: "Status", enableSorting: false,
              cell: ({ row: { original: a } }) => <StatusBadge derivedStatus={a._derived} /> },
            { id: "actions", header: "", enableSorting: false,
              cell: ({ row: { original: a } }) => (
                <button
                  onClick={() => navigate(`/applications/${a.id}`)}
                  className="flex items-center gap-1 text-xs text-bassani-600 hover:text-bassani-700 font-semibold hover:underline"
                >
                  {a._derived === "approved" || a._derived === "rejected" ? "View" : "Review"}
                  <ArrowRight size={11} />
                </button>
              )},
          ]}
          data={filtered} loading={loading} total={filtered.length}
          pagination={pagination} onPaginationChange={setPagination}
          onRowClick={a => navigate(`/applications/${a.id}`)}
        />
      </main>
    </div>
  );
}
