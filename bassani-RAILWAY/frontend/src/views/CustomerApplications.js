import { useState, useEffect, useCallback } from "react";
import { CheckCircle, XCircle, Clock, Eye } from "lucide-react";
import api from "../api";
import toast from "react-hot-toast";
import {
  TopBar, DataTable, FilterPill, ChipRow, Modal,
  FormGroup, BtnPrimary, BtnSecondary, fmtDate,
} from "../components/UI";

// ── Status helpers ─────────────────────────────────────────────────────────────

const STATUS_CFG = {
  pending:  { label: "Pending",  cls: "bg-amber-50 text-amber-700",  icon: Clock },
  approved: { label: "Approved", cls: "bg-green-50 text-green-700",  icon: CheckCircle },
  rejected: { label: "Rejected", cls: "bg-red-50 text-red-700",      icon: XCircle },
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

// ── Detail section ─────────────────────────────────────────────────────────────

function DetailRow({ label, value }) {
  if (!value) return null;
  return (
    <div className="flex justify-between py-2 border-b border-gray-50 last:border-0">
      <span className="text-xs text-gray-400 font-medium shrink-0 mr-4">{label}</span>
      <span className="text-xs font-semibold text-gray-800 text-right">{value}</span>
    </div>
  );
}

function Section({ title, children }) {
  return (
    <div className="mb-4">
      <p className="text-[10px] font-semibold text-gray-400 uppercase tracking-wider mb-2">{title}</p>
      <div className="bg-gray-50 rounded-xl px-4 py-1">{children}</div>
    </div>
  );
}

// ── Review modal ───────────────────────────────────────────────────────────────

function ReviewModal({ app, onClose, onApprove, onReject }) {
  const [rejectMode,   setRejectMode  ] = useState(false);
  const [rejectReason, setRejectReason] = useState("");
  const [loading,      setLoading     ] = useState(false);

  const handleApprove = async () => {
    setLoading(true);
    try {
      await onApprove(app.id);
      onClose();
    } finally { setLoading(false); }
  };

  const handleReject = async () => {
    if (!rejectReason.trim()) return toast.error("Please enter a reason for rejection");
    setLoading(true);
    try {
      await onReject(app.id, rejectReason.trim());
      onClose();
    } finally { setLoading(false); }
  };

  const addressParts = [app.street, app.suburb, app.city, app.province, app.postal_code, app.country].filter(Boolean);

  return (
    <Modal title={`Review Application — ${app.id}`} onClose={onClose} size="lg">
      <div className="flex items-center gap-2 mb-4">
        <StatusBadge status={app.status} />
        <span className="text-xs text-gray-400">
          Submitted by <strong className="text-gray-600">{app.reseller_name}</strong> on {fmtDate(app.submitted_at)}
        </span>
      </div>

      {app.status === "rejected" && app.rejection_reason && (
        <div className="mb-4 rounded-xl border border-red-100 bg-red-50 px-4 py-3 text-xs text-red-700">
          <strong>Rejection reason:</strong> {app.rejection_reason}
        </div>
      )}

      <div className="max-h-[50vh] overflow-y-auto space-y-0 pr-1">
        <Section title="Business Details">
          <DetailRow label="Company Name"       value={app.company_name} />
          <DetailRow label="Trading Name"       value={app.trading_name} />
          <DetailRow label="Business Type"      value={app.business_type} />
          <DetailRow label="Registration No."   value={app.registration_number} />
          <DetailRow label="VAT Number"         value={app.vat_number} />
        </Section>

        <Section title="Primary Contact">
          <DetailRow label="Name"       value={app.contact_name} />
          <DetailRow label="Position"   value={app.contact_position} />
          <DetailRow label="Email"      value={app.contact_email} />
          <DetailRow label="Phone"      value={app.contact_phone} />
          <DetailRow label="Alt. Phone" value={app.contact_alt_phone} />
        </Section>

        <Section title="Business Address">
          <DetailRow label="Address"  value={addressParts.join(", ")} />
        </Section>

        <Section title="Additional Information">
          <DetailRow label="Monthly Volume"  value={app.ordering_volume} />
          <DetailRow label="Referral Source" value={app.referral_source} />
          <DetailRow label="Notes"           value={app.notes} />
        </Section>
      </div>

      {app.status === "pending" && (
        <>
          {rejectMode ? (
            <div className="mt-4 space-y-3">
              <FormGroup label="Reason for rejection">
                <textarea
                  value={rejectReason}
                  onChange={e => setRejectReason(e.target.value)}
                  rows={3}
                  placeholder="Provide a clear reason that will be visible to the reseller…"
                  className="w-full px-3 py-2 text-sm border border-gray-200 rounded-lg focus:outline-none focus:ring-2 focus:ring-red-200 resize-none placeholder-gray-400"
                  autoFocus
                />
              </FormGroup>
              <div className="flex justify-end gap-2">
                <BtnSecondary onClick={() => setRejectMode(false)} disabled={loading}>Cancel</BtnSecondary>
                <button onClick={handleReject} disabled={loading}
                  className="px-4 py-2 bg-red-600 hover:bg-red-700 text-white text-sm font-semibold rounded-lg transition-colors disabled:opacity-50">
                  {loading ? "Rejecting…" : "Confirm Rejection"}
                </button>
              </div>
            </div>
          ) : (
            <div className="mt-4 flex justify-between gap-2">
              <button onClick={() => setRejectMode(true)}
                className="px-4 py-2 bg-red-50 hover:bg-red-100 text-red-700 text-sm font-semibold rounded-lg transition-colors">
                Reject
              </button>
              <BtnPrimary onClick={handleApprove} loading={loading}>
                Approve & Create Customer
              </BtnPrimary>
            </div>
          )}
        </>
      )}
    </Modal>
  );
}

// ── Main view ──────────────────────────────────────────────────────────────────

export default function CustomerApplications() {
  const [applications, setApplications] = useState([]);
  const [total,        setTotal        ] = useState(0);
  const [loading,      setLoading      ] = useState(true);
  const [filter,       setFilter       ] = useState("pending");
  const [reviewing,    setReviewing    ] = useState(null);
  const [pagination,   setPagination   ] = useState({ pageIndex: 0, pageSize: 25 });

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const params = {
        limit:  pagination.pageSize,
        offset: pagination.pageIndex * pagination.pageSize,
        status: filter,
      };
      const r = await api.get("/api/onboarding/", { params });
      setApplications(r.data.applications || []);
      setTotal(r.data.total || 0);
    } catch { toast.error("Failed to load applications"); }
    finally { setLoading(false); }
  }, [filter, pagination]);

  useEffect(() => { load(); }, [load]);

  const approve = async (id) => {
    try {
      await api.put(`/api/onboarding/${id}/approve`);
      toast.success("Customer approved and created in Odoo");
      load();
    } catch (e) {
      toast.error(e.response?.data?.detail || "Approval failed");
      throw e;
    }
  };

  const reject = async (id, reason) => {
    try {
      await api.put(`/api/onboarding/${id}/reject`, { reason });
      toast.success("Application rejected");
      load();
    } catch (e) {
      toast.error(e.response?.data?.detail || "Rejection failed");
      throw e;
    }
  };

  const FILTERS = [
    { key: "pending",  label: "Pending" },
    { key: "approved", label: "Approved" },
    { key: "rejected", label: "Rejected" },
    { key: "all",      label: "All" },
  ];

  const pendingCount = applications.filter(a => a.status === "pending").length;

  return (
    <div className="flex flex-col flex-1 overflow-hidden">
      <TopBar
        title="Customer Applications"
        subtitle={filter === "pending"
          ? `${total} pending application${total !== 1 ? "s" : ""} awaiting review`
          : `${total} application${total !== 1 ? "s" : ""}`}
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
              cell: ({ row: { original: a } }) =>
                <span className="text-xs font-medium text-purple-700 bg-purple-50 px-2 py-0.5 rounded-full">{a.reseller_name}</span> },
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
              cell: ({ row: { original: a } }) => <StatusBadge status={a.status} /> },
            { id: "actions", header: "", enableSorting: false,
              cell: ({ row: { original: a } }) => (
                <button onClick={() => setReviewing(a)}
                  className="flex items-center gap-1 text-xs text-bassani-600 hover:text-bassani-700 font-semibold hover:underline">
                  <Eye size={12} />
                  {a.status === "pending" ? "Review" : "View"}
                </button>
              )},
          ]}
          data={applications} loading={loading} total={total}
          pagination={pagination} onPaginationChange={setPagination}
          manualPagination
        />
      </main>

      {reviewing && (
        <ReviewModal
          app={reviewing}
          onClose={() => setReviewing(null)}
          onApprove={approve}
          onReject={reject}
        />
      )}
    </div>
  );
}
