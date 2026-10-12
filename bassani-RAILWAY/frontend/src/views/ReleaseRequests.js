// Deposit Requests (8.71, renamed 8.69) — /tickets/release-requests.
// The queue of orders a sales clerk has asked to send to the packing board
// without a deposit: either released on account (credit terms) or paid in
// full before collection (8.69). Open to tickets.release_on_account and
// tickets.finance_confirm holders; Finance can approve pay before
// collection, only release permission can release on account. Deciding
// happens on the Sales ticket itself (Review No-Deposit Request), where the
// order and customer context already live — this page is the list of what's
// waiting, plus recent decisions.
import { useState, useEffect, useCallback } from "react";
import { useNavigate } from "react-router-dom";
import toast from "react-hot-toast";
import api from "../api";
import { TopBar, DataTable, FilterPill, ChipRow, Badge, fmtR, fmtDate, fmtDateTime } from "../components/UI";

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
  const navigate = useNavigate();
  const [filter, setFilter] = useState("pending");
  const [rows, setRows] = useState([]);
  const [loading, setLoading] = useState(true);

  const load = useCallback(async () => {
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
        subtitle={`${waiting} waiting for a decision`}
        onRefresh={load}
      />
      <main className="flex-1 overflow-y-auto p-4 sm:p-6">
        <div className="w-full space-y-4">
          <p className="text-sm text-gray-500">
            Orders a sales clerk has asked to send for packing without a deposit. Open one to decide: approve pay before
            collection (the customer pays in full before collecting), release it on account terms, release that order only,
            or decline and ask for a deposit.
          </p>
          <ChipRow>
            <FilterPill label="Waiting" active={filter === "pending"} onClick={() => setFilter("pending")} />
            <FilterPill label="All recent" active={filter === "all"} onClick={() => setFilter("all")} />
          </ChipRow>
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
        </div>
      </main>
    </div>
  );
}
