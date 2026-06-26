import { useState, useEffect, useCallback } from "react";
import api from "../api";
import toast from "react-hot-toast";
import { useAuth } from "../AuthContext";
import { ShieldAlert } from "lucide-react";
import {
  TopBar, DataTable, Modal, FormGroup, Input, Select,
  BtnSecondary, Badge, SearchBar, ChipRow, FilterPill,
} from "../components/UI";

const ENTITY_TYPES = [
  { value: "",                      label: "All entities" },
  { value: "order",                 label: "Orders" },
  { value: "invoice",               label: "Invoices" },
  { value: "commission_statement",  label: "Commission Statements" },
  { value: "commission_tiers",      label: "Commission Tiers" },
  { value: "customer_onboarding",   label: "Onboarding" },
  { value: "user",                  label: "Users" },
  { value: "reseller",              label: "Resellers" },
  { value: "healthcare_professional", label: "Healthcare" },
  { value: "packing_board",         label: "Packing Board" },
];

export default function AuditTrail() {
  const { can } = useAuth();
  const allowed = can("audit.view");

  const [logs,    setLogs   ] = useState([]);
  const [actions, setActions] = useState([]);
  const [actors,  setActors ] = useState([]);
  const [loading, setLoading] = useState(true);

  const [search,     setSearch    ] = useState("");
  const [entityType,  setEntityType] = useState("");
  const [actionFilter,setActionFilter] = useState("");
  const [actorFilter, setActorFilter] = useState("");
  const [dateFrom,    setDateFrom   ] = useState("");
  const [dateTo,      setDateTo     ] = useState("");

  const [detail, setDetail] = useState(null);

  const load = useCallback(async () => {
    if (!allowed) return;
    setLoading(true);
    try {
      const params = { limit: 500 };
      if (entityType)   params.entity_type = entityType;
      if (actionFilter) params.action = actionFilter;
      if (actorFilter)  params.actor = actorFilter;
      if (dateFrom)      params.date_from = dateFrom;
      if (dateTo)        params.date_to = dateTo;
      const r = await api.get("/api/audit/", { params });
      setLogs(r.data.logs);
    } catch {
      toast.error("Failed to load audit log");
    } finally {
      setLoading(false);
    }
  }, [allowed, entityType, actionFilter, actorFilter, dateFrom, dateTo]);

  useEffect(() => { load(); }, [load]);

  useEffect(() => {
    if (!allowed) return;
    api.get("/api/audit/actions").then(r => setActions(r.data.actions)).catch(() => {});
    api.get("/api/audit/actors").then(r => setActors(r.data.actors)).catch(() => {});
  }, [allowed]);

  if (!allowed) {
    return (
      <div className="flex flex-col flex-1 items-center justify-center text-center p-8">
        <ShieldAlert size={36} className="text-gray-300 mb-3" />
        <p className="text-sm font-medium text-gray-600">You don't have access to the audit trail</p>
        <p className="text-xs text-gray-400 mt-1">Ask a super admin to grant the audit.view permission.</p>
      </div>
    );
  }

  const filtered = logs.filter(l => {
    const q = search.toLowerCase();
    if (!q) return true;
    return (
      (l.entity_label || "").toLowerCase().includes(q) ||
      (l.entity_id || "").toLowerCase().includes(q) ||
      (l.action || "").toLowerCase().includes(q) ||
      (l.actor_username || "").toLowerCase().includes(q)
    );
  });

  return (
    <div className="flex flex-col flex-1 overflow-hidden">
      <TopBar
        title="Audit Trail"
        subtitle="Every significant action, who performed it, and when"
        onRefresh={load}
      />

      <main className="flex-1 overflow-y-auto p-6">
        <div className="mb-4 space-y-2">
          <SearchBar
            value={search}
            onChange={setSearch}
            placeholder="Search entity, action, or actor…"
          />
          <ChipRow>
            {ENTITY_TYPES.map(t => (
              <FilterPill key={t.value} label={t.label} active={entityType === t.value}
                onClick={() => setEntityType(t.value)} />
            ))}
          </ChipRow>
          <div className="grid grid-cols-2 sm:grid-cols-4 gap-2 max-w-2xl">
            <FormGroup label="Actor">
              <Select value={actorFilter} onChange={e => setActorFilter(e.target.value)}>
                <option value="">All actors</option>
                {actors.map(a => <option key={a} value={a}>{a}</option>)}
              </Select>
            </FormGroup>
            <FormGroup label="Action">
              <Select value={actionFilter} onChange={e => setActionFilter(e.target.value)}>
                <option value="">All actions</option>
                {actions.map(a => <option key={a} value={a}>{a}</option>)}
              </Select>
            </FormGroup>
            <FormGroup label="From">
              <Input type="date" value={dateFrom} onChange={e => setDateFrom(e.target.value)} />
            </FormGroup>
            <FormGroup label="To">
              <Input type="date" value={dateTo} onChange={e => setDateTo(e.target.value)} />
            </FormGroup>
          </div>
        </div>

        <DataTable
          loading={loading}
          data={filtered}
          total={filtered.length}
          onRowClick={(row) => setDetail(row)}
          columns={[
            {
              id: "created_at",
              header: "When",
              enableSorting: false,
              cell: ({ row: { original: l } }) => (
                <span className="text-xs text-gray-500 whitespace-nowrap">
                  {l.created_at ? new Date(l.created_at).toLocaleString("en-ZA") : "—"}
                </span>
              ),
            },
            {
              id: "action",
              header: "Action",
              enableSorting: false,
              cell: ({ row: { original: l } }) => (
                <span className="font-mono text-xs text-gray-800">{l.action}</span>
              ),
            },
            {
              id: "entity",
              header: "Entity",
              enableSorting: false,
              cell: ({ row: { original: l } }) => (
                <div>
                  <p className="text-sm text-gray-900">{l.entity_label || l.entity_id}</p>
                  <Badge color="gray">{l.entity_type}</Badge>
                </div>
              ),
            },
            {
              id: "actor",
              header: "Actor",
              enableSorting: false,
              cell: ({ row: { original: l } }) => (
                <div>
                  <p className="text-sm font-medium text-gray-900">{l.actor_username || "system"}</p>
                  {l.actor_role && <p className="text-[11px] text-gray-400">{l.actor_role.replace(/_/g, " ")}</p>}
                </div>
              ),
            },
            {
              id: "ip",
              header: "IP",
              enableSorting: false,
              cell: ({ row: { original: l } }) => (
                <span className="text-xs text-gray-400">{l.ip || "—"}</span>
              ),
            },
          ]}
        />
      </main>

      {detail && (
        <Modal title={`${detail.action} — ${detail.entity_label || detail.entity_id}`} onClose={() => setDetail(null)} width="max-w-2xl">
          <div className="space-y-3 text-xs">
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
              <div>
                <p className="text-gray-400 uppercase tracking-wide text-[10px] mb-1">Actor</p>
                <p className="text-gray-800">{detail.actor_username || "system"} {detail.actor_role ? `(${detail.actor_role})` : ""}</p>
              </div>
              <div>
                <p className="text-gray-400 uppercase tracking-wide text-[10px] mb-1">When</p>
                <p className="text-gray-800">{detail.created_at ? new Date(detail.created_at).toLocaleString("en-ZA") : "—"}</p>
              </div>
            </div>
            {detail.before != null && (
              <div>
                <p className="text-gray-400 uppercase tracking-wide text-[10px] mb-1">Before</p>
                <pre className="bg-gray-50 border border-gray-200 rounded-lg p-3 overflow-x-auto whitespace-pre-wrap">{JSON.stringify(detail.before, null, 2)}</pre>
              </div>
            )}
            {detail.after != null && (
              <div>
                <p className="text-gray-400 uppercase tracking-wide text-[10px] mb-1">After</p>
                <pre className="bg-gray-50 border border-gray-200 rounded-lg p-3 overflow-x-auto whitespace-pre-wrap">{JSON.stringify(detail.after, null, 2)}</pre>
              </div>
            )}
            {detail.detail && Object.keys(detail.detail).length > 0 && (
              <div>
                <p className="text-gray-400 uppercase tracking-wide text-[10px] mb-1">Detail</p>
                <pre className="bg-gray-50 border border-gray-200 rounded-lg p-3 overflow-x-auto whitespace-pre-wrap">{JSON.stringify(detail.detail, null, 2)}</pre>
              </div>
            )}
          </div>
          <div className="flex justify-end mt-4">
            <BtnSecondary onClick={() => setDetail(null)}>Close</BtnSecondary>
          </div>
        </Modal>
      )}
    </div>
  );
}
