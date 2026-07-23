import { useState, useEffect, useCallback } from "react";
import { useNavigate } from "react-router-dom";
import { Link2, Search, Loader2, Building2, User, ChevronRight, ExternalLink } from "lucide-react";
import api from "../api";
import toast from "react-hot-toast";
import { useAuth } from "../AuthContext";
import {
  TopBar, SearchBar, DataTable, Badge,
  Modal, FormGroup, Input, BtnPrimary, BtnSecondary,
} from "../components/UI";

const FILTERS = [
  { key: "all",      label: "All Partners" },
  { key: "company",  label: "Companies" },
  { key: "linked",   label: "Linked Contacts" },
  { key: "unlinked", label: "Unlinked Contacts" },
];

export default function PartnerDirectory() {
  const navigate   = useNavigate();
  const { can }    = useAuth();
  const canManage  = can("customers.manage");

  const [filter,     setFilter    ] = useState("all");
  const [search,     setSearch    ] = useState("");
  const [partners,   setPartners  ] = useState([]);
  const [total,      setTotal     ] = useState(0);
  const [loading,    setLoading   ] = useState(true);
  const [counts,     setCounts    ] = useState({ all: 0, company: 0, linked: 0, unlinked: 0 });
  const [pagination, setPagination] = useState({ pageIndex: 0, pageSize: 50 });

  // ── Link to company modal ───────────────────────────────────────────────────
  const [linking,        setLinking       ] = useState(null);
  const [companyQuery,   setCompanyQuery  ] = useState("");
  const [companyResults, setCompanyResults] = useState([]);
  const [companySearch,  setCompanySearch ] = useState(false);
  const [selected,       setSelected      ] = useState(null);
  const [submitting,     setSubmitting    ] = useState(false);

  const loadCounts = useCallback(async () => {
    try {
      const r = await api.get("/api/partners/counts");
      setCounts(r.data);
    } catch { /* non-fatal */ }
  }, []);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const params = {
        filter,
        limit:  pagination.pageSize,
        offset: pagination.pageIndex * pagination.pageSize,
      };
      if (search) params.search = search;
      const r = await api.get("/api/partners/", { params });
      setPartners(r.data.partners || []);
      setTotal(r.data.total || 0);
    } catch {
      toast.error("Failed to load partners");
    } finally {
      setLoading(false);
    }
  }, [filter, search, pagination]);

  useEffect(() => { loadCounts(); }, [loadCounts]);
  useEffect(() => { load(); }, [load]);

  // company search inside link modal
  useEffect(() => {
    if (!linking || !companyQuery.trim()) { setCompanyResults([]); return; }
    const t = setTimeout(async () => {
      setCompanySearch(true);
      try {
        const r = await api.get("/api/customers/search", { params: { q: companyQuery, limit: 8 } });
        setCompanyResults(r.data.customers || []);
      } catch { setCompanyResults([]); }
      finally { setCompanySearch(false); }
    }, 300);
    return () => clearTimeout(t);
  }, [companyQuery, linking]);

  const openLink = (partner) => {
    setLinking(partner);
    setCompanyQuery(""); setCompanyResults([]);
    setSelected(null);
  };

  const submitLink = async () => {
    if (!selected || !linking) return;
    setSubmitting(true);
    try {
      await api.patch(`/api/partners/${linking.id}/link-company`, { company_id: selected.id });
      toast.success(`${linking.name} linked to ${selected.name}`);
      setLinking(null);
      loadCounts();
      load();
    } catch (e) {
      toast.error(e.response?.data?.detail || "Failed to link contact");
    } finally {
      setSubmitting(false);
    }
  };

  const columns = [
    {
      header: "Name",
      accessorKey: "name",
      cell: ({ row: { original: p } }) => (
        <div className="flex items-center gap-2">
          <div className={`w-7 h-7 rounded-full flex items-center justify-center flex-shrink-0 ${p.is_company ? "bg-bassani-100" : "bg-gray-100"}`}>
            {p.is_company
              ? <Building2 size={13} className="text-bassani-600" />
              : <User      size={13} className="text-gray-500" />}
          </div>
          <div>
            <p className="font-medium text-gray-900 text-sm">{p.name}</p>
            {p.email && <p className="text-xs text-gray-400">{p.email}</p>}
          </div>
        </div>
      ),
    },
    {
      header: "Type",
      id: "type",
      cell: ({ row: { original: p } }) => (
        <Badge color={p.is_company ? "green" : "gray"}>
          {p.is_company ? "Company" : "Individual"}
        </Badge>
      ),
    },
    {
      header: "Linked to",
      id: "company",
      cell: ({ row: { original: p } }) =>
        p.parent_name
          ? <span className="text-sm text-gray-700 flex items-center gap-1">
              <Building2 size={11} className="text-gray-400 flex-shrink-0" />{p.parent_name}
            </span>
          : p.is_company
            ? <span className="text-xs text-gray-300 italic">—</span>
            : <span className="text-xs text-amber-600 font-medium">Not linked</span>,
    },
    {
      header: "Roles",
      id: "roles",
      cell: ({ row: { original: p } }) => (
        <div className="flex gap-1">
          {p.customer_rank > 0 && <Badge color="blue">Customer</Badge>}
          {p.supplier_rank > 0 && <Badge color="yellow">Supplier</Badge>}
        </div>
      ),
    },
    {
      header: "",
      id: "actions",
      cell: ({ row: { original: p } }) => (
        <div className="flex items-center justify-end gap-2">
          {p.is_company && (
            <button
              onClick={e => { e.stopPropagation(); navigate(`/customers/${p.id}`); }}
              className="text-xs text-bassani-600 hover:text-bassani-700 flex items-center gap-1 transition-colors"
            >
              <ExternalLink size={11} />Profile
            </button>
          )}
          {!p.is_company && !p.parent_name && canManage && (
            <button
              onClick={e => { e.stopPropagation(); openLink(p); }}
              className="text-xs text-amber-600 hover:text-amber-700 flex items-center gap-1 transition-colors font-medium"
            >
              <Link2 size={11} />Link
            </button>
          )}
          {!p.is_company && p.parent_name && canManage && (
            <button
              onClick={e => { e.stopPropagation(); openLink(p); }}
              className="text-xs text-gray-400 hover:text-gray-600 flex items-center gap-1 transition-colors"
            >
              <Link2 size={11} />Relink
            </button>
          )}
          <ChevronRight size={14} className="text-gray-300" />
        </div>
      ),
    },
  ];

  return (
    <div className="flex flex-col flex-1 overflow-hidden">
      <TopBar
        title="Partner Directory"
        subtitle={`${total.toLocaleString()} record${total !== 1 ? "s" : ""} · ${counts.unlinked} unlinked contact${counts.unlinked !== 1 ? "s" : ""}`}
      />

      {/* Filter pills + search */}
      <div className="flex items-center gap-3 px-6 py-3 border-b border-gray-100 bg-white flex-wrap">
        <div className="flex gap-1.5">
          {FILTERS.map(f => {
            const count  = counts[f.key];
            const active = filter === f.key;
            return (
              <button
                key={f.key}
                onClick={() => { setFilter(f.key); setPagination(p => ({ ...p, pageIndex: 0 })); }}
                className={`flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-medium transition-colors ${
                  active
                    ? "bg-bassani-600 text-white"
                    : "bg-gray-100 text-gray-600 hover:bg-gray-200"
                }`}
              >
                {f.label}
                {f.key === "unlinked" && count > 0 && (
                  <span className={`px-1.5 py-0.5 rounded-full text-[10px] font-bold ${active ? "bg-white/20 text-white" : "bg-amber-100 text-amber-700"}`}>
                    {count}
                  </span>
                )}
              </button>
            );
          })}
        </div>
        <div className="flex-1 max-w-xs">
          <SearchBar
            value={search}
            onChange={v => { setSearch(v); setPagination(p => ({ ...p, pageIndex: 0 })); }}
            placeholder="Search name or email…"
          />
        </div>
      </div>

      <main className="flex-1 overflow-y-auto">
        <DataTable
          columns={columns}
          data={partners}
          loading={loading}
          total={total}
          pagination={pagination}
          onPaginationChange={setPagination}
          onRowClick={p => p.is_company && navigate(`/customers/${p.id}`)}
          manualPagination
        />
      </main>

      {/* Link to company modal */}
      {linking && (
        <Modal title={`Link "${linking.name}" to a Company`} onClose={() => setLinking(null)}>
          <p className="text-xs text-gray-500 mb-4">
            Search for the company this contact belongs to. Once linked they will appear as a contact on that company's profile.
          </p>
          {linking.parent_name && (
            <div className="mb-3 p-3 bg-amber-50 border border-amber-200 rounded-xl text-xs text-amber-700">
              Currently linked to <span className="font-semibold">{linking.parent_name}</span> — selecting a new company will replace this.
            </div>
          )}
          <FormGroup label="Search companies">
            <div className="relative">
              <Search size={13} className="absolute left-3 top-1/2 -translate-y-1/2 text-gray-400" />
              <Input
                value={companyQuery}
                onChange={e => { setCompanyQuery(e.target.value); setSelected(null); }}
                placeholder="Type company name…"
                className="pl-8"
                autoFocus
              />
              {companySearch && <Loader2 size={13} className="absolute right-3 top-1/2 -translate-y-1/2 text-gray-400 animate-spin" />}
            </div>
          </FormGroup>

          {companyResults.length > 0 && !selected && (
            <div className="mt-1 border border-gray-100 rounded-xl overflow-hidden">
              {companyResults.map(c => (
                <button
                  key={c.id}
                  onClick={() => setSelected(c)}
                  className="w-full flex items-center gap-3 px-4 py-2.5 hover:bg-bassani-50 text-left border-b border-gray-50 last:border-0 transition-colors"
                >
                  <Building2 size={13} className="text-gray-400 flex-shrink-0" />
                  <div>
                    <p className="text-sm font-medium text-gray-900">{c.name}</p>
                    {c.email && <p className="text-xs text-gray-400">{c.email}</p>}
                  </div>
                </button>
              ))}
            </div>
          )}

          {selected && (
            <div className="mt-2 bg-bassani-50 border border-bassani-200 rounded-xl px-4 py-3 flex items-center justify-between">
              <div className="flex items-center gap-2">
                <Building2 size={14} className="text-bassani-600" />
                <div>
                  <p className="text-sm font-semibold text-bassani-800">{selected.name}</p>
                  {selected.email && <p className="text-xs text-bassani-600">{selected.email}</p>}
                </div>
              </div>
              <button onClick={() => setSelected(null)} className="text-xs text-gray-400 hover:text-gray-600">Change</button>
            </div>
          )}

          <div className="flex justify-end gap-2 mt-5">
            <BtnSecondary onClick={() => setLinking(null)}>Cancel</BtnSecondary>
            <BtnPrimary onClick={submitLink} disabled={!selected || submitting}>
              {submitting ? <Loader2 size={14} className="animate-spin" /> : <Link2 size={14} />}
              Link to {selected?.name || "Company"}
            </BtnPrimary>
          </div>
        </Modal>
      )}
    </div>
  );
}
