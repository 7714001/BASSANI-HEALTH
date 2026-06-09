import { useState, useEffect, useCallback } from "react";
import { useLocation } from "react-router-dom";
import api from "../api";
import toast from "react-hot-toast";
import {
  TopBar, DataTable, SearchBar, FilterPill, ChipRow, Badge,
  fmtR, fmtDate,
} from "../components/UI";

const PAYMENT_STATE_LABEL = {
  not_paid:   "Unpaid",
  partial:    "Partial",
  in_payment: "In Payment",
  paid:       "Paid",
  reversed:   "Reversed",
};

const PAYMENT_STATE_STYLE = {
  not_paid:   "bg-red-50 text-red-700",
  partial:    "bg-amber-50 text-amber-700",
  in_payment: "bg-blue-50 text-blue-700",
  paid:       "bg-green-50 text-green-700",
  reversed:   "bg-gray-100 text-gray-500",
};

function PaymentBadge({ state }) {
  return (
    <span className={`text-[10px] px-2 py-0.5 rounded-full font-semibold ${PAYMENT_STATE_STYLE[state] || "bg-gray-100 text-gray-500"}`}>
      {PAYMENT_STATE_LABEL[state] || state}
    </span>
  );
}

export default function Invoices() {
  const location = useLocation();
  const initialFilter = location.state?.filter || "unpaid";

  const [invoices,   setInvoices  ] = useState([]);
  const [total,      setTotal     ] = useState(0);
  const [loading,    setLoading   ] = useState(true);
  const [search,     setSearch    ] = useState("");
  const [filter,     setFilter    ] = useState(initialFilter);
  const [pagination, setPagination] = useState({ pageIndex: 0, pageSize: 25 });
  const [sorting,    setSorting   ] = useState([{ id: "invoice_date", desc: true }]);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const sort = sorting[0];
      const params = {
        limit:  pagination.pageSize,
        offset: pagination.pageIndex * pagination.pageSize,
      };
      if (sort) { params.sort_by = sort.id; params.sort_dir = sort.desc ? "desc" : "asc"; }
      if (search) params.search = search;
      if (filter !== "all") params.payment_state = filter;
      const r = await api.get("/api/invoices/", { params });
      setInvoices(r.data.invoices);
      setTotal(r.data.total);
    } catch { toast.error("Failed to load invoices"); }
    finally { setLoading(false); }
  }, [search, filter, pagination, sorting]);

  useEffect(() => { load(); }, [load]);

  const FILTERS = [
    { key: "unpaid", label: "Outstanding" },
    { key: "not_paid", label: "Unpaid" },
    { key: "partial",  label: "Partial" },
    { key: "paid",     label: "Paid" },
    { key: "all",      label: "All" },
  ];

  const outstandingTotal = invoices.reduce((s, i) => s + (i.amount_residual || 0), 0);

  return (
    <div className="flex flex-col flex-1 overflow-hidden">
      <TopBar
        title="Invoices"
        subtitle={total > 0
          ? `${total} invoice${total !== 1 ? "s" : ""} · ${fmtR(outstandingTotal)} outstanding on this page`
          : "Customer invoices from Odoo"}
        onRefresh={load}
      />
      <main className="flex-1 overflow-y-auto p-6">
        <div className="mb-4 space-y-2">
          <SearchBar value={search} onChange={v => { setSearch(v); setPagination(p => ({ ...p, pageIndex: 0 })); }} placeholder="Search invoice #, customer…" />
          <ChipRow>
            {FILTERS.map(f => (
              <FilterPill key={f.key} label={f.label} active={filter === f.key}
                onClick={() => { setFilter(f.key); setPagination(p => ({ ...p, pageIndex: 0 })); }} />
            ))}
          </ChipRow>
        </div>

        <DataTable
          columns={[
            { accessorKey: "name", header: "Invoice #", cell: ({ row: { original: inv } }) =>
                <span className="font-mono text-xs text-bassani-700">{inv.name || "Draft"}</span> },
            { id: "customer", header: "Customer", enableSorting: false,
              cell: ({ row: { original: inv } }) =>
                <span className="font-medium text-gray-900">{inv.partner_id?.[1] || "—"}</span> },
            { accessorKey: "invoice_date", header: "Date",
              cell: ({ row: { original: inv } }) =>
                <span className="text-xs text-gray-500">{fmtDate(inv.invoice_date)}</span> },
            { accessorKey: "invoice_date_due", header: "Due Date",
              cell: ({ row: { original: inv } }) => {
                const overdue = inv.invoice_date_due && new Date(inv.invoice_date_due) < new Date() && inv.payment_state !== "paid";
                return <span className={`text-xs ${overdue ? "text-red-600 font-semibold" : "text-gray-500"}`}>{fmtDate(inv.invoice_date_due)}</span>;
              }},
            { accessorKey: "amount_total", header: "Total",
              cell: ({ row: { original: inv } }) =>
                <span className="font-semibold">{fmtR(inv.amount_total)}</span> },
            { accessorKey: "amount_residual", header: "Outstanding",
              cell: ({ row: { original: inv } }) =>
                <span className={`font-semibold ${inv.amount_residual > 0 ? "text-red-600" : "text-green-700"}`}>
                  {inv.amount_residual > 0 ? fmtR(inv.amount_residual) : "—"}
                </span> },
            { id: "payment_state", header: "Status", enableSorting: false,
              cell: ({ row: { original: inv } }) => <PaymentBadge state={inv.payment_state} /> },
          ]}
          data={invoices} loading={loading} total={total}
          pagination={pagination} onPaginationChange={setPagination}
          sorting={sorting} onSortingChange={u => { setSorting(typeof u === "function" ? u(sorting) : u); setPagination(p => ({ ...p, pageIndex: 0 })); }}
          manualPagination manualSorting
        />
      </main>
    </div>
  );
}
