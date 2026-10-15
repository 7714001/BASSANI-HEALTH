// Deposit Requests (8.71, renamed 8.69) — /tickets/release-requests.
// The queue of orders a sales clerk has asked to send to the packing board
// without a deposit: either released on account (credit terms) or paid in
// full before collection (8.69). Open to tickets.release_on_account and
// tickets.finance_confirm holders; Finance can approve pay before
// collection, only release permission can release on account. Deciding
// happens on the Sales ticket itself (Review No-Deposit Request), where the
// order and customer context already live — this page is the list of what's
// waiting, plus recent decisions.
// No-deposit orders tab (8.69e, 2026-10-15): the register of every order sent
// for packing without a deposit, including ones approved directly on the
// Sales ticket with no request (those never appear in the request lists).
import { useState, useEffect, useCallback, useMemo } from "react";
import { useNavigate } from "react-router-dom";
import toast from "react-hot-toast";
import api from "../api";
import { useAuth } from "../AuthContext";
import { Download } from "lucide-react";
import { TopBar, DataTable, FilterPill, ChipRow, Badge, SearchBar, BtnSecondary, fmtR, fmtDate, fmtDateTime } from "../components/UI";

const STATUS_LABEL = {
  pending: "Waiting", released: "Released on terms", exception: "One-off release",
  pay_before_collection: "Pay before collection",
  declined: "Declined", withdrawn: "Withdrawn", deposit_registered: "Deposit registered",
};
const STATUS_COLOR = {
  pending: "amber", released: "green", exception: "teal", pay_before_collection: "indigo",
  declined: "red", withdrawn: "gray", deposit_registered: "blue",
};
const KIND_LABEL = { on_account: "Release on account", pay_before_collection: "Pay before collection" };

export default function ReleaseRequests() {
  const { feature } = useAuth();
  const accountTermsOn = feature("account_terms");   // switched off 2026-10-14
  const navigate = useNavigate();
  const [filter, setFilter] = useState("pending");
  const [rows, setRows] = useState([]);
  const [loading, setLoading] = useState(true);

  const load = useCallback(async () => {
    if (filter === "register") return;
    setLoading(true);
    try {
      const r = await api.get("/api/tickets/release-requests", { params: { status: filter } });
      setRows(r.data.requests || []);
    } catch (e) {
      toast.error(e.response?.data?.detail || "Failed to load release requests");
    } finally {
      setLoading(false);
    }
  }, [filter]);

  useEffect(() => { load(); }, [load]);

  const open = (r) => navigate("/tickets/sales", { state: { openTicketId: r.ticket_id } });
  const waiting = filter === "pending" ? rows.length : rows.filter(r => r.status === "pending").length;

  return (
    <div className="flex flex-col h-full">
      <TopBar
        title="Deposit Requests"
        subtitle={filter === "register" ? "Every order sent for packing without a deposit" : `${waiting} waiting for a decision`}
        onRefresh={filter === "register" ? undefined : load}
      />
      <main className="flex-1 overflow-y-auto p-4 sm:p-6">
        <div className="w-full space-y-4">
          <ChipRow>
            <FilterPill label="Waiting" active={filter === "pending"} onClick={() => setFilter("pending")} />
            <FilterPill label="All recent requests" active={filter === "all"} onClick={() => setFilter("all")} />
            <FilterPill label="No-deposit orders" active={filter === "register"} onClick={() => setFilter("register")} />
          </ChipRow>
          {filter === "register" ? <NoDepositRegister navigate={navigate} /> : (<>
          <p className="text-sm text-gray-500">
            Orders a sales clerk has asked to send for packing without a deposit. Open one to decide: approve pay before
            collection (the customer pays in full before collecting){accountTermsOn ? ", release it on account terms, release that order only," : ""}
            {" "}or decline and ask for a deposit.
          </p>
          <div className="bg-white rounded-2xl border border-gray-100 overflow-hidden">
            <DataTable
              loading={loading}
              data={rows}
              total={rows.length}
              onRowClick={open}
              columns={[
                { accessorKey: "requested_at", header: "Requested",
                  cell: ({ row: { original: r } }) => (
                    <span className="text-sm text-gray-600 whitespace-nowrap">{fmtDateTime(r.requested_at)}</span>
                  ) },
                { accessorKey: "customer_name", header: "Customer",
                  cell: ({ row: { original: r } }) => (
                    <div>
                      <p className="font-medium text-gray-900">{r.customer_name}</p>
                      <p className="text-[10px] font-mono text-gray-400">{r.order_name || "—"} · {r.ref}</p>
                    </div>
                  ) },
                { accessorKey: "kind", header: "Asked for",
                  cell: ({ row: { original: r } }) => (
                    <Badge color={r.kind === "pay_before_collection" ? "indigo" : "teal"}>{KIND_LABEL[r.kind] || "Release on account"}</Badge>
                  ) },
                { accessorKey: "order_total", header: "Order total",
                  cell: ({ row: { original: r } }) => <span className="font-semibold">{fmtR(r.order_total || 0)}</span> },
                { accessorKey: "requested_by_name", header: "Requested by",
                  cell: ({ row: { original: r } }) => <span className="text-sm">{r.requested_by_name}</span> },
                { id: "reason", header: "Reason", enableSorting: false,
                  cell: ({ row: { original: r } }) => (
                    <p className="text-xs text-gray-600 max-w-xs line-clamp-2" title={r.reason}>{r.reason}</p>
                  ) },
                { accessorKey: "status", header: "Status",
                  cell: ({ row: { original: r } }) => (
                    <div>
                      <Badge color={STATUS_COLOR[r.status] || "gray"}>{STATUS_LABEL[r.status] || r.status}</Badge>
                      {r.status !== "pending" && r.decided_by_name && (
                        <p className="text-[10px] text-gray-400 mt-0.5">{r.decided_by_name}, {fmtDate(r.decided_at)}</p>
                      )}
                    </div>
                  ) },
              ]}
            />
          </div>
          </>)}
        </div>
      </main>
    </div>
  );
}


// ── No-deposit orders register (8.69e) ──────────────────────────────────────

const ARRANGEMENT_LABEL = { pay_before_collection: "Pay before collection", on_account: "On account" };
const VIA_LABEL = { direct: "Directly", request: "Via request", automatic: "Automatic" };
const VIA_COLOR = { direct: "amber", request: "green", automatic: "teal" };

function NoDepositRegister({ navigate }) {
  const [scope, setScope] = useState("open");
  const [rows, setRows] = useState([]);
  const [loading, setLoading] = useState(true);
  const [odooDown, setOdooDown] = useState(false);
  const [search, setSearch] = useState("");
  const [arrangement, setArrangement] = useState("all");
  const [via, setVia] = useState("all");
  const [owingOnly, setOwingOnly] = useState(false);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const r = await api.get("/api/tickets/no-deposit-orders", { params: { scope } });
      setRows(r.data.rows || []);
      setOdooDown(!!r.data.odoo_unavailable);
    } catch (e) {
      toast.error(e.response?.data?.detail || "Failed to load no-deposit orders");
    } finally {
      setLoading(false);
    }
  }, [scope]);
  useEffect(() => { load(); }, [load]);

  const filtered = useMemo(() => {
    const q = search.trim().toLowerCase();
    return rows.filter(r =>
      (arrangement === "all" || r.arrangement === arrangement) &&
      (via === "all" || r.via === via) &&
      (!owingOnly || (r.amount_owing || 0) > 0.005) &&
      (!q || [r.customer_name, r.order_name, r.ref, r.approved_by_name, r.reason, r.reseller_name, r.assigned_to_name]
        .some(v => (v || "").toLowerCase().includes(q)))
    );
  }, [rows, search, arrangement, via, owingOnly]);

  const kpi = useMemo(() => ({
    count: filtered.length,
    owing: filtered.reduce((a, r) => a + (r.amount_owing || 0), 0),
    overdue: filtered.filter(r => (r.days_overdue || 0) > 0).length,
    direct: filtered.filter(r => r.via === "direct").length,
  }), [filtered]);

  const exportExcel = async () => {
    try {
      const XLSX = await import("xlsx");
      const data = filtered.map(r => ({
        "Sale Order": r.order_name || "",
        "Ticket": r.ref,
        "Customer": r.customer_name || "",
        "Arrangement": ARRANGEMENT_LABEL[r.arrangement] || r.arrangement,
        "Payment Terms": r.payment_term || "",
        "Approved By": r.approved_by_name || "",
        "Approved On": r.approved_at ? fmtDateTime(r.approved_at) : "",
        "How Approved": VIA_LABEL[r.via] || r.via,
        "Requested By": r.requested_by_name || "",
        "Own Request": r.self_approved ? "Yes" : "",
        "Reason": r.reason || "",
        "Order Date": r.order_date ? fmtDate(r.order_date) : "",
        "Order Age (days)": r.order_age_days ?? "",
        "Days Since Approval": r.days_since_approval ?? "",
        "Where It Is Now": r.stage_label,
        "Waiting On Payment (days)": r.waiting_on_payment_days ?? "",
        "Order Total incl. VAT (R)": r.order_total ?? "",
        "Paid (R)": r.amount_paid ?? "",
        "Owing (R)": r.amount_owing ?? "",
        "Open Invoice": r.invoice_name || "",
        "Invoice Due": r.invoice_due_date ? fmtDate(r.invoice_due_date) : "",
        "Days Overdue": r.days_overdue || "",
        "Sales Agent": r.reseller_name || "",
        "Assigned To": r.assigned_to_name || "",
      }));
      const wb = XLSX.utils.book_new();
      const ws = XLSX.utils.json_to_sheet(data);
      ws["!cols"] = [12, 14, 30, 20, 16, 20, 18, 14, 20, 10, 40, 12, 10, 10, 26, 12, 16, 14, 14, 18, 12, 10, 20, 20].map(w => ({ wch: w }));
      if (data.length) ws["!autofilter"] = { ref: `A1:X${data.length + 1}` };
      XLSX.utils.book_append_sheet(wb, ws, "No-Deposit Orders");
      const d = new Date(); const pad = n => String(n).padStart(2, "0");
      XLSX.writeFile(wb, `No-Deposit Orders ${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}.xlsx`);
    } catch {
      toast.error("Export failed");
    }
  };

  const open = (r) => navigate("/tickets/sales", { state: { openTicketId: r.ticket_id } });

  return (
    <div className="space-y-4">
      <p className="text-sm text-gray-500">
        Every order sent for packing without a deposit, however it was approved: through a request, directly on the
        Sales ticket, or automatically. Approvals marked <span className="font-medium text-amber-700">Directly</span> had
        no second person involved. Amounts are read live from the accounting system.
      </p>
      {odooDown && (
        <p className="text-xs text-amber-700 bg-amber-50 border border-amber-200 rounded-lg px-3 py-2">
          Paid and owing amounts couldn't be read just now. Refresh in a moment.
        </p>
      )}
      <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
        {[
          ["Orders", kpi.count],
          ["Still owing", fmtR(kpi.owing)],
          ["Invoice overdue", kpi.overdue],
          ["Approved directly", kpi.direct],
        ].map(([label, value]) => (
          <div key={label} className="bg-white rounded-xl border border-gray-100 px-4 py-3">
            <p className="text-[11px] uppercase tracking-wide text-gray-400">{label}</p>
            <p className="text-lg font-semibold text-gray-900">{value}</p>
          </div>
        ))}
      </div>
      <div className="flex flex-wrap items-center gap-2">
        <div className="flex-1 min-w-[220px]">
          <SearchBar value={search} onChange={setSearch} placeholder="Search customer, order, approver, reason" />
        </div>
        <BtnSecondary onClick={exportExcel} disabled={!filtered.length}>
          <Download size={14} className="mr-1.5" />Export
        </BtnSecondary>
      </div>
      <ChipRow>
        <FilterPill label="In progress" active={scope === "open"} onClick={() => setScope("open")} />
        <FilterPill label="Include closed" active={scope === "all"} onClick={() => setScope("all")} />
        <span className="text-gray-300 px-1">|</span>
        <FilterPill label="All arrangements" active={arrangement === "all"} onClick={() => setArrangement("all")} />
        <FilterPill label="Pay before collection" active={arrangement === "pay_before_collection"} onClick={() => setArrangement("pay_before_collection")} />
        <FilterPill label="On account" active={arrangement === "on_account"} onClick={() => setArrangement("on_account")} />
        <span className="text-gray-300 px-1">|</span>
        <FilterPill label="Any approval" active={via === "all"} onClick={() => setVia("all")} />
        <FilterPill label="Directly" active={via === "direct"} onClick={() => setVia("direct")} />
        <FilterPill label="Via request" active={via === "request"} onClick={() => setVia("request")} />
        <span className="text-gray-300 px-1">|</span>
        <FilterPill label="Still owing" active={owingOnly} onClick={() => setOwingOnly(v => !v)} />
      </ChipRow>
      <div className="bg-white rounded-2xl border border-gray-100 overflow-hidden">
        <DataTable
          loading={loading}
          data={filtered}
          total={filtered.length}
          onRowClick={open}
          columns={[
            { accessorKey: "customer_name", header: "Customer",
              cell: ({ row: { original: r } }) => (
                <div>
                  <p className="font-medium text-gray-900">{r.customer_name}</p>
                  <p className="text-[10px] font-mono text-gray-400">{r.order_name || "—"} · {r.ref}</p>
                </div>
              ) },
            { accessorKey: "arrangement", header: "Arrangement",
              cell: ({ row: { original: r } }) => (
                <div>
                  <Badge color={r.arrangement === "pay_before_collection" ? "indigo" : "teal"}>
                    {ARRANGEMENT_LABEL[r.arrangement] || r.arrangement}
                  </Badge>
                  {r.payment_term && <p className="text-[10px] text-gray-400 mt-0.5">{r.payment_term}</p>}
                </div>
              ) },
            { accessorKey: "approved_at", header: "Approved",
              cell: ({ row: { original: r } }) => (
                <div className="text-sm">
                  <p className="text-gray-900">{r.approved_by_name || "Unknown"}</p>
                  <p className="text-[10px] text-gray-400">{r.approved_at ? fmtDate(r.approved_at) : "—"}
                    {r.days_since_approval != null && ` · ${r.days_since_approval}d ago`}</p>
                  <div className="flex items-center gap-1 mt-0.5">
                    <Badge color={VIA_COLOR[r.via] || "gray"}>{VIA_LABEL[r.via] || r.via}</Badge>
                    {r.self_approved && <Badge color="red">Own request</Badge>}
                  </div>
                  {r.requested_by_name && <p className="text-[10px] text-gray-400 mt-0.5">Asked by {r.requested_by_name}</p>}
                </div>
              ) },
            { id: "reason", header: "Reason", enableSorting: false,
              cell: ({ row: { original: r } }) => (
                <p className="text-xs text-gray-600 max-w-xs line-clamp-2" title={r.reason}>{r.reason || "—"}</p>
              ) },
            { accessorKey: "order_age_days", header: "Order age",
              cell: ({ row: { original: r } }) => (
                <div className="text-sm whitespace-nowrap">
                  <p className="text-gray-900">{r.order_age_days != null ? `${r.order_age_days} days` : "—"}</p>
                  <p className="text-[10px] text-gray-400">{r.order_date ? fmtDate(r.order_date) : ""}</p>
                </div>
              ) },
            { accessorKey: "stage_label", header: "Where it is now",
              cell: ({ row: { original: r } }) => (
                <div className="text-sm">
                  <p className="text-gray-900">{r.stage_label}</p>
                  {r.waiting_on_payment_days != null && (
                    <p className="text-[10px] text-amber-700">Waiting on payment {r.waiting_on_payment_days}d</p>
                  )}
                </div>
              ) },
            { accessorKey: "amount_owing", header: "Owing",
              cell: ({ row: { original: r } }) => (
                <div className="text-sm whitespace-nowrap">
                  <p className={(r.amount_owing || 0) > 0.005 ? "font-semibold text-gray-900" : "text-gray-400"}>
                    {r.amount_owing == null ? "—" : fmtR(r.amount_owing)}
                  </p>
                  {r.order_total != null && <p className="text-[10px] text-gray-400">of {fmtR(r.order_total)}</p>}
                  {(r.days_overdue || 0) > 0 && (
                    <p className="text-[10px] text-red-600">{r.invoice_name} {r.days_overdue}d overdue</p>
                  )}
                </div>
              ) },
          ]}
        />
      </div>
    </div>
  );
}
