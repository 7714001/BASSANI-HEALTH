// Expected Payments (8.69) — /tickets/expected-payments, tickets.finance_confirm.
// Finance's list of payments to look out for, one row per order, amounts read
// live from Odoo (GET /api/tickets/expected-payments):
//   * deposits due (8.69d): confirmed orders waiting on their 50% deposit
//     before they can be packed. Recorded with Register Deposit (any amount;
//     under 10% of the order needs a reason), or Link Invoice when the order
//     already has a paid invoice in Odoo;
//   * balances due: every order approved to pay before collection that isn't
//     paid in full yet, and every deposit order packed and waiting on its
//     balance. Register Payment against the final invoice once it exists, or
//     a paid advance invoice before then (pay before collection only). Either
//     way, a packed order whose invoice is now paid has its customer told
//     it's ready to collect automatically.
import { useState, useEffect, useCallback, useMemo } from "react";
import { useNavigate } from "react-router-dom";
import toast from "react-hot-toast";
import { Wallet, Download, Loader2, ExternalLink, Upload, Link2, AlertTriangle } from "lucide-react";
import api from "../api";
import {
  TopBar, DataTable, FilterPill, ChipRow, SearchBar, Badge, AgeTierBadge, Modal, FormGroup, Input, Select,
  BtnPrimary, BtnSecondary, fmtR, fmtDate, fmtDateTime,
} from "../components/UI";

const VIEWS = [
  { key: "waiting",    label: "Packed & waiting" },
  { key: "deposits",   label: "Deposits due" },
  { key: "not_packed", label: "Not packed yet" },
  { key: "paid_today", label: "Paid today" },
  { key: "all",        label: "All outstanding" },
];
const STAGE_COLOR = {
  packed_waiting: "amber", packed_notified: "orange", signoff: "blue", packing: "blue",
  in_progress: "blue", approved: "gray", paid: "green",
  deposit_due: "amber", deposit_unlinked: "purple", deposit_stuck: "red", deposit_requested: "indigo", deposit_held: "orange",
};
const ARRANGEMENT_LABEL = {
  pay_before_collection: "Pay before collection", deposit: "Deposit balance", deposit_upfront: "50% deposit",
};
const DEPOSIT_PCT = 50;        // the deposit asked for on the pro-forma
const TOKEN_DEPOSIT_PCT = 10;  // matches ticket_routes.TOKEN_DEPOSIT_PCT

export default function ExpectedPayments() {
  const navigate = useNavigate();
  const [view, setView] = useState("waiting");
  const [rows, setRows] = useState([]);
  const [counts, setCounts] = useState({ waiting: 0, not_packed: 0, deposits: 0 });
  const [totalDue, setTotalDue] = useState(0);
  const [depositsDue, setDepositsDue] = useState(0);
  const [loading, setLoading] = useState(true);
  const [search, setSearch] = useState("");
  const [payRow, setPayRow] = useState(null);
  const [linkRow, setLinkRow] = useState(null);
  const [linking, setLinking] = useState(false);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const r = await api.get("/api/tickets/expected-payments", { params: { view } });
      setRows(r.data.rows || []);
      setCounts(r.data.counts || { waiting: 0, not_packed: 0, deposits: 0 });
      setTotalDue(r.data.total_due || 0);
      setDepositsDue(r.data.deposits_due || 0);
    } catch (e) {
      toast.error(e.response?.data?.detail || "Failed to load expected payments");
    } finally {
      setLoading(false);
    }
  }, [view]);

  useEffect(() => { load(); }, [load]);

  // Search by anything Finance might see on a bank line: customer, SO number,
  // invoice number, ticket ref, or the amount itself.
  const filtered = useMemo(() => {
    const q = search.trim().toLowerCase();
    if (!q) return rows;
    const qNum = parseFloat(q.replace(/[^0-9.]/g, ""));
    return rows.filter(r =>
      (r.customer_name || "").toLowerCase().includes(q) ||
      (r.order_name || "").toLowerCase().includes(q) ||
      (r.invoice_name || "").toLowerCase().includes(q) ||
      (r.ref || "").toLowerCase().includes(q) ||
      (!Number.isNaN(qNum) && qNum > 0 && [r.amount_due, r.order_total, r.invoice_residual, r.expected_deposit]
        .some(v => v != null && Math.abs(v - qNum) < 0.01))
    );
  }, [rows, search]);

  const openTicket = (r) => navigate("/tickets/sales", { state: { openTicketId: r.ticket_id } });

  // An order already paid in Odoo (outside the portal) gets that invoice
  // linked as its deposit rather than a second deposit invoice being raised.
  const doLink = async () => {
    const r = linkRow;
    setLinking(true);
    try {
      const { data } = await api.post(`/api/tickets/${r.ticket_id}/use-existing-invoice`, { invoice_id: r.invoice_id });
      if (data.warning) toast.error(data.warning, { duration: 8000 });
      else toast.success(`${r.invoice_name} linked as the deposit. The order is now on the packing board.`);
      setLinkRow(null);
      load();
    } catch (e) {
      toast.error(e.response?.data?.detail || "Could not link the invoice");
    } finally {
      setLinking(false);
    }
  };

  const exportExcel = async () => {
    const XLSX = await import("xlsx");
    const data = filtered.map(r => ({
      "Customer": r.customer_name,
      "Sales order": r.order_name,
      "Ticket": r.ref,
      "Type": r.row_type === "deposit" ? "Deposit" : "Balance",
      "Invoice": r.invoice_name || "Not yet invoiced",
      "Arrangement": ARRANGEMENT_LABEL[r.arrangement] || r.arrangement,
      "Order total": r.order_total,
      "Expected deposit": r.expected_deposit ?? "",
      "Paid so far": r.amount_paid,
      "Amount due": r.amount_due,
      "Stage": r.stage_label,
      "Note": r.stage_detail || "",
      "Days waiting": r.days_waiting ?? "",
      "Proof of payment uploaded": r.pop_awaiting_review ? "Yes" : "",
    }));
    const wb = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(wb, XLSX.utils.json_to_sheet(data), "Expected Payments");
    XLSX.writeFile(wb, `Expected Payments ${new Date().toISOString().slice(0, 10)}.xlsx`);
  };

  const badge = (n) => n > 0 && (
    <span className="ml-1.5 bg-amber-500 text-white rounded-full px-1.5 text-[10px]">{n}</span>
  );

  return (
    <div className="flex flex-col h-full">
      <TopBar
        title="Expected Payments"
        subtitle={`${counts.deposits} deposits due (${fmtR(depositsDue)}) · ${counts.waiting} packed and waiting · ${fmtR(totalDue)} balances outstanding`}
        onRefresh={load}
        actions={
          <BtnSecondary onClick={exportExcel} disabled={!filtered.length}>
            <Download size={14} />Export
          </BtnSecondary>
        }
      />
      <main className="flex-1 overflow-y-auto p-4 sm:p-6">
        <div className="w-full space-y-4">
          <p className="text-sm text-gray-500">
            Payments to look out for. Confirmed orders waiting on their {DEPOSIT_PCT}% deposit (they can't be packed until it's
            registered), orders approved to pay before collection, and deposit orders with a balance owing.
            Customers are only told an order is ready to collect once it's paid in full, and that email goes automatically
            as soon as a payment is recorded here, on the Sales ticket, on the Invoices page, through bank reconciliation,
            or in the accounting system. Customers use the sales order number as their payment reference.
          </p>
          <div className="flex flex-col sm:flex-row sm:items-center gap-3">
            <ChipRow>
              {VIEWS.map(v => (
                <FilterPill
                  key={v.key}
                  active={view === v.key}
                  onClick={() => setView(v.key)}
                  label={
                    <>
                      {v.label}
                      {v.key === "waiting" && badge(counts.waiting)}
                      {v.key === "deposits" && badge(counts.deposits)}
                    </>
                  }
                />
              ))}
            </ChipRow>
            <div className="sm:ml-auto sm:w-72">
              <SearchBar value={search} onChange={setSearch} placeholder="Customer, SO, invoice or amount…" />
            </div>
          </div>
          <div className="bg-white rounded-2xl border border-gray-100 overflow-hidden">
            <DataTable
              loading={loading}
              data={filtered}
              total={filtered.length}
              onRowClick={openTicket}
              columns={[
                { accessorKey: "customer_name", header: "Customer",
                  cell: ({ row: { original: r } }) => (
                    <div>
                      <p className="font-medium text-gray-900">{r.customer_name}</p>
                      <p className="text-[10px] font-mono text-gray-400">{r.ref}{r.reseller_name ? ` · via ${r.reseller_name}` : ""}</p>
                    </div>
                  ) },
                { accessorKey: "order_name", header: "Reference",
                  cell: ({ row: { original: r } }) => (
                    <div>
                      <p className="font-mono text-sm text-gray-900">{r.order_name}</p>
                      <p className="text-[10px] text-gray-400">
                        {r.invoice_name ? (r.pay_mode === "link" ? `Paid: ${r.invoice_name}` : r.invoice_name)
                          : r.row_type === "deposit" ? "No deposit invoice yet" : "Not yet invoiced"}
                      </p>
                    </div>
                  ) },
                { accessorKey: "arrangement", header: "Arrangement",
                  cell: ({ row: { original: r } }) => (
                    <Badge color={r.arrangement === "pay_before_collection" ? "indigo" : r.row_type === "deposit" ? "amber" : "teal"}>
                      {ARRANGEMENT_LABEL[r.arrangement] || r.arrangement}
                    </Badge>
                  ) },
                { accessorKey: "amount_due", header: "Amount due",
                  cell: ({ row: { original: r } }) => (
                    <div>
                      <p className="font-semibold text-gray-900">
                        {r.stage === "paid" ? "Paid" : r.stage === "deposit_stuck" ? "Received" : fmtR(r.amount_due)}
                      </p>
                      <p className="text-[10px] text-gray-400">
                        {r.row_type === "deposit" ? `${DEPOSIT_PCT}% of ${fmtR(r.order_total)}` : `of ${fmtR(r.order_total)}`}
                        {r.amount_paid > 0 ? `, ${fmtR(r.amount_paid)} paid` : ""}
                      </p>
                    </div>
                  ) },
                { accessorKey: "stage_label", header: "Stage",
                  cell: ({ row: { original: r } }) => (
                    <div className="space-y-1">
                      <Badge color={STAGE_COLOR[r.stage] || "gray"}>{r.stage_label}</Badge>
                      {r.stage === "paid" && r.customer_notified_at && (
                        <p className="text-[10px] text-gray-400">Customer told {fmtDateTime(r.customer_notified_at)}</p>
                      )}
                      {r.stage === "deposit_stuck" && (
                        <p className="text-[10px] text-gray-500">Retry with Admin Override on the Sales ticket</p>
                      )}
                      {r.stage_detail && (
                        <p className="text-[10px] text-gray-400 max-w-[220px] truncate" title={r.stage_detail}>{r.stage_detail}</p>
                      )}
                    </div>
                  ) },
                { accessorKey: "days_waiting", header: "Waiting",
                  cell: ({ row: { original: r } }) => r.days_waiting != null ? (
                    <div className="flex items-center gap-1.5">
                      <span className="text-sm text-gray-700 whitespace-nowrap">{r.days_waiting} {r.days_waiting === 1 ? "day" : "days"}</span>
                      {r.age_tier && r.age_tier !== "ok" && <AgeTierBadge tier={r.age_tier} />}
                    </div>
                  ) : <span className="text-xs text-gray-300">—</span> },
                { id: "pop", header: "Proof of payment", enableSorting: false,
                  cell: ({ row: { original: r } }) => r.pop_awaiting_review ? (
                    <Badge color="amber"><Upload size={9} className="inline mr-0.5" />Uploaded, check bank</Badge>
                  ) : r.pop_count > 0 ? <span className="text-xs text-gray-400">Reviewed</span> : <span className="text-xs text-gray-300">—</span> },
                { id: "actions", header: "", enableSorting: false,
                  cell: ({ row: { original: r } }) => (
                    <div className="flex items-center gap-2 justify-end" onClick={e => e.stopPropagation()}>
                      {r.pay_mode === "link" && (
                        <button onClick={() => setLinkRow(r)}
                          className="inline-flex items-center gap-1 px-2 py-1 text-[11px] font-semibold rounded-md border bg-purple-50 text-purple-700 border-purple-200 hover:bg-purple-100">
                          <Link2 size={11} />Link Invoice
                        </button>
                      )}
                      {r.pay_mode && r.pay_mode !== "link" && r.stage !== "paid" && (
                        <button onClick={() => setPayRow(r)}
                          className="inline-flex items-center gap-1 px-2 py-1 text-[11px] font-semibold rounded-md border bg-bassani-50 text-bassani-700 border-bassani-200 hover:bg-bassani-100">
                          <Wallet size={11} />{r.pay_mode === "deposit" ? "Record Deposit" : "Record Payment"}
                        </button>
                      )}
                      <button onClick={() => openTicket(r)} className="text-gray-400 hover:text-gray-700" title="Open the Sales ticket">
                        <ExternalLink size={14} />
                      </button>
                    </div>
                  ) },
              ]}
            />
          </div>
          {!loading && filtered.length === 0 && (
            <p className="text-sm text-gray-400 text-center py-4">
              {view === "paid_today" ? "No payments released today yet."
                : view === "deposits" ? "No confirmed orders are waiting on a deposit."
                : "Nothing outstanding here."}
            </p>
          )}
        </div>
      </main>

      {payRow && (
        <RecordPaymentModal row={payRow} onClose={() => setPayRow(null)} onDone={() => { setPayRow(null); load(); }} />
      )}

      {linkRow && (
        <Modal title="Link Paid Invoice as Deposit" onClose={() => !linking && setLinkRow(null)}>
          <p className="text-sm text-gray-700">
            Order {linkRow.order_name} for {linkRow.customer_name} already has a paid invoice in Odoo,{" "}
            <span className="font-mono">{linkRow.invoice_name}</span> ({fmtR(linkRow.amount_paid)} received in total).
          </p>
          <p className="text-sm text-gray-500 mt-2">
            Linking it counts it as this order's deposit, so no second deposit invoice is raised, and the order moves to the
            packing board. Only do this if that payment really is for this order.
          </p>
          <div className="flex justify-end gap-2 mt-4">
            <BtnSecondary onClick={() => setLinkRow(null)} disabled={linking}>Cancel</BtnSecondary>
            <BtnPrimary onClick={doLink} disabled={linking}>
              {linking ? <Loader2 size={13} className="animate-spin mr-1.5" /> : null}
              Link Invoice
            </BtnPrimary>
          </div>
        </Modal>
      )}
    </div>
  );
}

// Record a payment against one expected-payment row. "invoice" mode pays the
// order's open final invoice (Register Payment); "advance" mode is a payment
// on a pay-before-collection order before it's invoiced, recorded as a paid
// advance invoice that the final invoice deducts (Register Deposit endpoint);
// "deposit" mode registers the deposit that lets a confirmed order onto the
// packing board (Register Deposit). The deposit asked for is 50%, but any
// amount up to the order total can be registered; under 10% of the order the
// backend requires a reason, so the modal warns and asks for one.
function RecordPaymentModal({ row, onClose, onDone }) {
  const isAdvance = row.pay_mode === "advance";
  const isDeposit = row.pay_mode === "deposit";
  const maxAmount = isDeposit ? Math.max(row.order_total - row.amount_paid, 0)
    : isAdvance ? row.amount_due : (row.invoice_residual ?? row.amount_due);
  const defaultAmount = isDeposit ? row.amount_due : maxAmount;
  const [journals, setJournals] = useState([]);
  const [loadingJournals, setLoadingJournals] = useState(true);
  const [form, setForm] = useState({
    amount: defaultAmount ? Number(defaultAmount).toFixed(2) : "",
    date: new Date().toISOString().split("T")[0],
    journal_id: "",
    note: "",
    small_deposit_reason: "",
  });
  const [saving, setSaving] = useState(false);
  const enteredAmount = parseFloat(form.amount) || 0;
  const isSmallDeposit = isDeposit && enteredAmount > 0 && row.order_total > 0
    && enteredAmount < row.order_total * TOKEN_DEPOSIT_PCT / 100;
  const isUnderAsked = isDeposit && !isSmallDeposit && enteredAmount > 0 && enteredAmount < row.amount_due - 0.005;

  useEffect(() => {
    api.get("/api/tickets/payment-journals", { params: { order_id: row.order_id } })
      .then(r => {
        const js = r.data.journals || [];
        setJournals(js);
        setForm(f => ({ ...f, journal_id: js[0]?.id ? String(js[0].id) : "" }));
      })
      .catch(e => toast.error(e.response?.data?.detail || "Could not load payment methods"))
      .finally(() => setLoadingJournals(false));
  }, [row.order_id]);

  const submit = async () => {
    const amount = parseFloat(form.amount);
    if (!amount || amount <= 0) return toast.error("Enter the amount received");
    if (amount > maxAmount + 0.01) return toast.error(`That's more than is owing (${fmtR(maxAmount)})`);
    if (!form.date || !form.journal_id) return toast.error("Date and payment method are required");
    if (isSmallDeposit && !form.small_deposit_reason.trim()) {
      return toast.error(`Give a reason for a deposit under ${TOKEN_DEPOSIT_PCT}% of the order`);
    }
    setSaving(true);
    try {
      if (isDeposit) {
        const { data } = await api.post(`/api/tickets/${row.ticket_id}/register-deposit`, {
          invoice_type: "fixed", amount, date: form.date, journal_id: parseInt(form.journal_id),
          note: form.note || undefined,
          small_deposit_reason: isSmallDeposit ? form.small_deposit_reason.trim() : undefined,
        });
        if (data.warning) toast.error(data.warning, { duration: 8000 });
        else toast.success("Deposit registered. The order is now on the packing board.");
      } else if (isAdvance) {
        await api.post(`/api/tickets/${row.ticket_id}/register-deposit`, {
          invoice_type: "fixed", amount, date: form.date, journal_id: parseInt(form.journal_id),
          note: form.note || undefined,
        });
        toast.success("Payment recorded. It will be deducted from the final invoice.");
      } else {
        const { data } = await api.post(`/api/tickets/${row.ticket_id}/register-payment`, {
          amount, date: form.date, journal_id: parseInt(form.journal_id), note: form.note || undefined,
        });
        if (data.customer_notified) toast.success("Payment recorded. The customer has been told their order is ready to collect.");
        else if (data.amount_residual > 0) toast.success(`Payment recorded. ${fmtR(data.amount_residual)} still owing.`);
        else toast.success("Payment recorded.");
      }
      onDone();
    } catch (e) {
      toast.error(e.response?.data?.detail || "Could not record the payment");
    } finally {
      setSaving(false);
    }
  };

  return (
    <Modal title={isDeposit ? "Record Deposit" : "Record Payment"} onClose={onClose}>
      <div className="mb-4 rounded-xl border border-gray-100 bg-gray-50 px-3 py-2.5 text-xs text-gray-600 space-y-0.5">
        <p className="font-semibold text-gray-900">{row.customer_name}</p>
        <p>Order {row.order_name}{row.invoice_name ? ` · invoice ${row.invoice_name}` : ""}</p>
        {isDeposit ? (
          <p>
            {DEPOSIT_PCT}% deposit: {fmtR(row.expected_deposit)}
            {row.amount_paid > 0 ? `, ${fmtR(row.amount_paid)} already paid` : ""} · order total {fmtR(row.order_total)}
          </p>
        ) : (
          <p>{fmtR(maxAmount)} owing{isAdvance ? " (not invoiced yet)" : ""}</p>
        )}
      </div>
      {isAdvance && (
        <p className="text-xs text-gray-500 mb-3">
          This order hasn't been invoiced yet. The payment is recorded as a paid advance invoice in Odoo and deducted from the
          final invoice when the order is marked complete.
        </p>
      )}
      {isDeposit && (
        <p className="text-xs text-gray-500 mb-3">
          Registers the deposit as a paid invoice in Odoo, which the final invoice deducts, and moves the order to the packing
          board. Enter what the customer actually paid: it can be more or less than {DEPOSIT_PCT}%, up to the full order total.
        </p>
      )}
      <FormGroup label="Amount received (ZAR)" required>
        <Input type="number" step="0.01" min="0.01" value={form.amount}
          onChange={e => setForm(f => ({ ...f, amount: e.target.value }))} autoFocus />
      </FormGroup>
      {isSmallDeposit && (
        <div className="mb-4 rounded-xl border border-amber-200 bg-amber-50 px-3 py-2.5 text-xs text-amber-800">
          <p className="flex items-center gap-1.5 font-semibold">
            <AlertTriangle size={13} />This is under {TOKEN_DEPOSIT_PCT}% of the order total.
          </p>
          <p className="mt-1">
            Token deposits create extra invoices in the books. If the customer has a payment agreement, request a release on
            account from the Sales ticket instead. To register this amount anyway, give a reason.
          </p>
          <div className="mt-2">
            <Input value={form.small_deposit_reason} placeholder="Reason for the small deposit"
              onChange={e => setForm(f => ({ ...f, small_deposit_reason: e.target.value }))} />
          </div>
        </div>
      )}
      {isUnderAsked && (
        <p className="text-xs text-gray-500 -mt-2 mb-3">
          Less than the {DEPOSIT_PCT}% deposit asked for ({fmtR(row.amount_due)}). The order still goes to the packing board,
          and the rest is collected with the balance.
        </p>
      )}
      <FormGroup label="Payment date" required>
        <Input type="date" value={form.date} onChange={e => setForm(f => ({ ...f, date: e.target.value }))} />
      </FormGroup>
      <FormGroup label="Payment method" required>
        {loadingJournals ? (
          <div className="flex items-center gap-2 text-xs text-gray-400 px-3 py-2 border border-gray-100 rounded-lg bg-gray-50">
            <Loader2 size={13} className="animate-spin" />Loading payment methods…
          </div>
        ) : (
          <Select value={form.journal_id} onChange={e => setForm(f => ({ ...f, journal_id: e.target.value }))}>
            <option value="">— Select —</option>
            {journals.map(j => <option key={j.id} value={j.id}>{j.display_label || j.name}</option>)}
          </Select>
        )}
      </FormGroup>
      <FormGroup label="Note">
        <Input value={form.note} onChange={e => setForm(f => ({ ...f, note: e.target.value }))}
          placeholder={`e.g. EFT received ${fmtDate(new Date())}, ref ${row.order_name}`} />
      </FormGroup>
      <div className="flex justify-end gap-2 mt-4">
        <BtnSecondary onClick={onClose} disabled={saving}>Cancel</BtnSecondary>
        <BtnPrimary onClick={submit} disabled={saving || loadingJournals}>
          {saving ? <Loader2 size={13} className="animate-spin mr-1.5" /> : null}
          {isDeposit ? "Record Deposit" : "Record Payment"}
        </BtnPrimary>
      </div>
    </Modal>
  );
}
