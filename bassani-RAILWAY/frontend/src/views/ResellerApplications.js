import { useState, useEffect, useCallback } from "react";
import { useNavigate } from "react-router-dom";
import { CheckCircle, XCircle, Clock, ChevronRight } from "lucide-react";
import api from "../api";
import toast from "react-hot-toast";
import { TopBar, DataTable, FilterPill, ChipRow, fmtDate } from "../components/UI";

const STATUS_CFG = {
  pending:  { label: "Pending",  cls: "bg-amber-50 text-amber-700",  icon: Clock        },
  approved: { label: "Approved", cls: "bg-green-50 text-green-700",  icon: CheckCircle  },
  rejected: { label: "Rejected", cls: "bg-red-50   text-red-700",    icon: XCircle      },
};

function StatusBadge({ status }) {
  const cfg  = STATUS_CFG[status] || STATUS_CFG.pending;
  const Icon = cfg.icon;
  return (
    <span className={`inline-flex items-center gap-1 text-[10px] px-2 py-0.5 rounded-full font-semibold ${cfg.cls}`}>
      <Icon size={10} />{cfg.label}
    </span>
  );
}

const FILTERS = [
  { key: "pending",  label: "Pending"  },
  { key: "approved", label: "Approved" },
  { key: "rejected", label: "Rejected" },
  { key: "all",      label: "All"      },
];

const COLUMNS = [
  {
    accessorKey: "id",
    header: "Reference",
    cell: ({ getValue }) => <span className="font-mono text-xs text-bassani-700 font-semibold">{getValue()}</span>,
  },
  {
    id: "company",
    header: "Business Name",
    enableSorting: false,
    cell: ({ row: { original: a } }) => (
      <div>
        <p className="font-semibold text-sm text-gray-900">{a.company_name}</p>
        {a.trading_name && <p className="text-xs text-gray-400">t/a {a.trading_name}</p>}
      </div>
    ),
  },
  {
    id: "type",
    header: "Type",
    enableSorting: false,
    cell: ({ row: { original: a } }) => <span className="text-xs text-gray-500">{a.business_type}</span>,
  },
  {
    id: "submitted_at",
    header: "Submitted",
    enableSorting: false,
    cell: ({ row: { original: a } }) => <span className="text-xs text-gray-400">{fmtDate(a.submitted_at)}</span>,
  },
  {
    id: "status",
    header: "Status",
    enableSorting: false,
    cell: ({ row: { original: a } }) => <StatusBadge status={a.status} />,
  },
  {
    id: "arrow",
    header: "",
    enableSorting: false,
    cell: () => <ChevronRight size={16} className="text-gray-300" />,
  },
];

export default function ResellerApplications() {
  const navigate = useNavigate();
  const [applications, setApplications] = useState([]);
  const [total,        setTotal        ] = useState(0);
  const [loading,      setLoading      ] = useState(true);
  const [filter,       setFilter       ] = useState("all");
  const [pagination,   setPagination   ] = useState({ pageIndex: 0, pageSize: 25 });

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const { data } = await api.get("/api/onboarding/", {
        params: {
          limit:  pagination.pageSize,
          offset: pagination.pageIndex * pagination.pageSize,
          status: filter,
        },
      });
      setApplications(data.applications || []);
      setTotal(data.total || 0);
    } catch {
      toast.error("Failed to load applications");
    } finally {
      setLoading(false);
    }
  }, [filter, pagination]);

  useEffect(() => { load(); }, [load]);

  return (
    <div className="flex flex-col flex-1 overflow-hidden">
      <TopBar
        title="My Applications"
        subtitle={`${total} application${total !== 1 ? "s" : ""}`}
        onRefresh={load}
      />
      <main className="flex-1 overflow-y-auto p-6">
        <div className="mb-4">
          <ChipRow>
            {FILTERS.map(f => (
              <FilterPill key={f.key} label={f.label} active={filter === f.key}
                onClick={() => { setFilter(f.key); setPagination(p => ({ ...p, pageIndex: 0 })); }} />
            ))}
          </ChipRow>
        </div>
        <DataTable
          columns={COLUMNS}
          data={applications}
          loading={loading}
          total={total}
          pagination={pagination}
          onPaginationChange={setPagination}
          onRowClick={a => navigate(`/my-applications/${a.id}`)}
          manualPagination
        />
      </main>
    </div>
  );
}
