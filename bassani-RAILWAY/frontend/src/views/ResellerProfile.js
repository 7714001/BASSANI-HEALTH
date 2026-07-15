import { useState, useEffect, useRef } from "react";
import { useParams, useNavigate } from "react-router-dom";
import {
  ChevronDown, ShoppingCart, TrendingUp, Users, CreditCard,
  FileText, Clock, Building2, History, Plus, X, Search, Loader2, Link2, Unlink, Ticket,
} from "lucide-react";
import api from "../api";
import toast from "react-hot-toast";
import { useAuth } from "../AuthContext";
import { Badge, BtnSecondary, BtnDanger, LoadingState, PaginationBar, fmtR, fmtDate, Modal } from "../components/UI";

function KpiCard({ label, value, sub, icon: Icon, accent }) {
  return (
    <div className="bg-white rounded-2xl border border-gray-100 p-5 flex items-start gap-4">
      <div className={`w-10 h-10 rounded-xl flex items-center justify-center shrink-0 ${accent}`}>
        <Icon size={18} className="text-white" />
      </div>
      <div className="min-w-0">
        <p className="text-xs text-gray-400 font-medium mb-0.5">{label}</p>
        <p className="text-xl font-bold text-gray-900 truncate">{value}</p>
        {sub && <p className="text-xs text-gray-400 mt-0.5">{sub}</p>}
      </div>
    </div>
  );
}

function Section({ title, action, children }) {
  return (
    <div className="bg-white rounded-2xl border border-gray-100 overflow-hidden">
      <div className="px-5 py-4 border-b border-gray-50 flex items-center justify-between">
        <h3 className="font-semibold text-gray-800 text-sm">{title}</h3>
        {action}
      </div>
      {children}
    </div>
  );
}

// ── Link customer modal ────────────────────────────────────────────────────────

function LinkCustomerModal({ resellerId, onClose, onLinked }) {
  const [query,    setQuery   ] = useState("");
  const [results,  setResults ] = useState([]);
  const [searching,setSearching] = useState(false);
  const [linking,  setLinking ] = useState(null);
  const debounce = useRef(null);

  useEffect(() => {
    if (!query.trim() || query.trim().length < 2) { setResults([]); return; }
    clearTimeout(debounce.current);
    debounce.current = setTimeout(async () => {
      setSearching(true);
      try {
        const { data } = await api.get("/api/customers/search", { params: { q: query.trim(), limit: 8 } });
        setResults(data.customers || []);
      } catch {
        setResults([]);
      } finally {
        setSearching(false);
      }
    }, 300);
    return () => clearTimeout(debounce.current);
  }, [query]);

  const handleLink = async (customer) => {
    setLinking(customer.id);
    try {
      await api.post(`/api/resellers/${resellerId}/customers/link`, { odoo_partner_id: customer.id });
      toast.success(`${customer.name} linked to reseller`);
      onLinked(customer);
      onClose();
    } catch (e) {
      toast.error(e.response?.data?.detail || "Failed to link customer");
    } finally {
      setLinking(null);
    }
  };

  return (
    <Modal title="Link Customer to Reseller" onClose={onClose}>
      <div className="space-y-4">
        <p className="text-xs text-gray-500">
          Search for an existing Bassani customer and link them to this reseller's account.
          The reseller will then be able to place orders for this customer.
        </p>

        {/* Search input */}
        <div className="relative">
          <Search size={14} className="absolute left-3 top-1/2 -translate-y-1/2 text-gray-400 pointer-events-none" />
          <input
            type="text"
            value={query}
            onChange={e => setQuery(e.target.value)}
            placeholder="Search by customer name or email…"
            autoFocus
            className="w-full pl-9 pr-4 py-2 text-sm border border-gray-200 rounded-lg focus:outline-none focus:ring-2 focus:ring-bassani-300 bg-white placeholder-gray-400"
          />
          {searching && <Loader2 size={13} className="absolute right-3 top-1/2 -translate-y-1/2 text-gray-400 animate-spin" />}
        </div>

        {/* Results */}
        {results.length > 0 ? (
          <div className="border border-gray-100 rounded-xl overflow-hidden divide-y divide-gray-50">
            {results.map(c => (
              <div key={c.id} className="flex items-center gap-3 px-4 py-3 hover:bg-gray-50 transition-colors">
                <div className="w-7 h-7 rounded-full bg-bassani-100 flex items-center justify-center shrink-0">
                  <Building2 size={12} className="text-bassani-600" />
                </div>
                <div className="flex-1 min-w-0">
                  <p className="text-sm font-semibold text-gray-800 truncate">{c.name}</p>
                  <p className="text-xs text-gray-400 truncate">{[c.email, c.city].filter(Boolean).join(" · ")}</p>
                </div>
                <button
                  onClick={() => handleLink(c)}
                  disabled={!!linking}
                  className="flex items-center gap-1.5 px-3 py-1.5 bg-bassani-600 hover:bg-bassani-700 disabled:opacity-50 text-white text-xs font-semibold rounded-lg transition-colors shrink-0">
                  {linking === c.id ? <Loader2 size={11} className="animate-spin" /> : <Link2 size={11} />}
                  Link
                </button>
              </div>
            ))}
          </div>
        ) : query.trim().length >= 2 && !searching ? (
          <p className="text-sm text-gray-400 text-center py-4">No customers found for "{query}"</p>
        ) : query.trim().length > 0 && query.trim().length < 2 ? (
          <p className="text-xs text-gray-400 text-center py-2">Type at least 2 characters to search</p>
        ) : null}
      </div>
    </Modal>
  );
}

// ── Main component ─────────────────────────────────────────────────────────────

const STATE_LABEL   = { draft:"Quotation", sale:"Confirmed", done:"Done", cancel:"Cancelled", sent:"Sent" };
const PAYMENT_LABEL = { not_paid:"Unpaid", partial:"Partial", in_payment:"In Payment", paid:"Paid" };
const PAYMENT_COLOR = { not_paid:"text-red-600", partial:"text-amber-600", in_payment:"text-blue-600", paid:"text-green-600" };

const TICKET_STATUS_LABEL = {
  open: "Open (RFQ)", quote: "Quote", sale_order: "Sale Order", invoice: "Invoice",
  confirmed_wip: "Confirmed — WIP", ready_for_collection: "Ready", incomplete: "Incomplete",
};
const TICKET_STATUS_COLOR = {
  open: "bg-gray-100 text-gray-600", quote: "bg-amber-100 text-amber-700",
  sale_order: "bg-blue-100 text-blue-700", invoice: "bg-indigo-100 text-indigo-700",
  confirmed_wip: "bg-teal-100 text-teal-700", ready_for_collection: "bg-green-100 text-green-700",
  incomplete: "bg-orange-100 text-orange-700",
};
const TICKET_EXIT_LABEL = { not_interested: "Not Interested", cancelled: "Cancelled", complete: "Complete" };
const TICKET_EXIT_COLOR = {
  not_interested: "bg-gray-100 text-gray-500", cancelled: "bg-red-100 text-red-600",
  complete: "bg-green-100 text-green-700",
};

export default function ResellerProfile() {
  const { id } = useParams();
  const navigate = useNavigate();
  const { can, isAdmin } = useAuth();
  const ACT_PAGE_SIZE = 20;
  const CUST_PAGE_SIZE = 15;

  const [data,           setData          ] = useState(null);
  const [loading,        setLoading        ] = useState(true);
  const [activity,       setActivity       ] = useState([]);
  const [actTotal,       setActTotal       ] = useState(0);
  const [actPage,        setActPage        ] = useState(0);
  const [actLoading,     setActLoading     ] = useState(false);
  const [customers,      setCustomers      ] = useState([]);
  const [custPage,       setCustPage       ] = useState(0);
  const [showLink,       setShowLink       ] = useState(false);
  const [unlinking,      setUnlinking      ] = useState(null);
  const [unlinkConfirm,  setUnlinkConfirm  ] = useState(null);
  const [pipeline,       setPipeline       ] = useState([]);
  const [pipelineLoading,setPipelineLoading] = useState(true);

  useEffect(() => {
    api.get(`/api/resellers/${id}/profile`)
      .then(r => { setData(r.data); setCustomers(r.data.customers || []); })
      .catch(() => { toast.error("Failed to load reseller profile"); navigate("/resellers"); })
      .finally(() => setLoading(false));
  }, [id, navigate]);

  useEffect(() => {
    setPipelineLoading(true);
    api.get("/api/tickets/", { params: { reseller_id: id } })
      .then(r => setPipeline(r.data.tickets || []))
      .catch(() => setPipeline([]))
      .finally(() => setPipelineLoading(false));
  }, [id]);

  useEffect(() => {
    if (!can("audit.view")) return;
    setActLoading(true);
    api.get("/api/audit/", { params: { reseller_id: id, limit: ACT_PAGE_SIZE, offset: actPage * ACT_PAGE_SIZE } })
      .then(r => { setActivity(r.data.logs); setActTotal(r.data.total); })
      .catch(() => {})
      .finally(() => setActLoading(false));
  }, [id, can, actPage]); // eslint-disable-line

  const custSlice = customers.slice(custPage * CUST_PAGE_SIZE, (custPage + 1) * CUST_PAGE_SIZE);

  const handleUnlink = (customer) => setUnlinkConfirm(customer);

  const doUnlink = async () => {
    const customer = unlinkConfirm;
    setUnlinkConfirm(null);
    setUnlinking(customer.id);
    try {
      await api.delete(`/api/resellers/${id}/customers/${customer.id}/unlink`);
      toast.success(`${customer.name} unlinked`);
      setCustomers(prev => prev.filter(c => c.id !== customer.id));
    } catch (e) {
      toast.error(e.response?.data?.detail || "Failed to unlink customer");
    } finally {
      setUnlinking(null);
    }
  };

  const handleLinked = (customer) => {
    setCustomers(prev => [...prev, { id: customer.id, name: customer.name, email: customer.email, city: customer.city, phone: null }]);
  };

  if (loading) return <LoadingState />;
  if (!data)   return null;

  const { reseller: r, fy_label, stats, recent_orders, commission_bills } = data;

  return (
    <div className="flex flex-col flex-1 overflow-hidden">
      {/* Top bar */}
      <div className="border-b border-gray-100 bg-white px-6 py-3 flex items-center justify-between gap-4 shrink-0">
        <button onClick={() => navigate("/resellers")}
          className="flex items-center gap-1.5 text-sm text-gray-500 hover:text-gray-800 transition-colors">
          <ChevronDown size={14} className="-rotate-90" />Back to Resellers
        </button>
        <div className="flex gap-2">
          <BtnSecondary size="sm" onClick={() => navigate("/applications")}>View Applications</BtnSecondary>
        </div>
      </div>

      <main className="flex-1 overflow-y-auto p-6 bg-gray-50">
        <div className="max-w-5xl mx-auto space-y-5">

          {/* Reseller header */}
          <div className="bg-white rounded-2xl border border-gray-100 p-6">
            <div className="flex items-start justify-between gap-4 flex-wrap">
              <div className="flex items-center gap-4">
                <div className="w-14 h-14 rounded-2xl bg-purple-600 flex items-center justify-center shrink-0">
                  <span className="text-white text-xl font-bold">
                    {r.name?.split(" ").map(w => w[0]).join("").slice(0, 2).toUpperCase()}
                  </span>
                </div>
                <div>
                  <h1 className="text-xl font-bold text-gray-900">{r.name}</h1>
                  <div className="flex flex-wrap items-center gap-2 mt-1">
                    <span className="text-xs bg-purple-50 text-purple-700 px-2 py-0.5 rounded-full font-medium">{r.type}</span>
                    <span className="text-xs font-mono bg-gray-100 text-gray-600 px-2 py-0.5 rounded-full">{r.seller_code}</span>
                    {r.vat_registered && r.vat_number && (
                      <span className="text-xs bg-blue-50 text-blue-700 px-2 py-0.5 rounded-full font-medium">VAT: {r.vat_number}</span>
                    )}
                  </div>
                </div>
              </div>
              <div className="flex flex-wrap gap-6 text-sm">
                {r.contact_person && <div><p className="text-xs text-gray-400 mb-0.5">Contact</p><p className="font-medium text-gray-700">{r.contact_person}</p></div>}
                {r.email          && <div><p className="text-xs text-gray-400 mb-0.5">Email</p><p className="font-medium text-gray-700">{r.email}</p></div>}
                {r.phone          && <div><p className="text-xs text-gray-400 mb-0.5">Phone</p><p className="font-medium text-gray-700">{r.phone}</p></div>}
              </div>
            </div>

            {r.bank_name && (
              <div className="mt-5 pt-5 border-t border-gray-50 grid grid-cols-2 sm:grid-cols-4 gap-4 text-sm">
                {r.bank_name           && <div><p className="text-xs text-gray-400 mb-0.5">Bank</p><p className="font-medium text-gray-700">{r.bank_name}</p></div>}
                {r.bank_account_holder && <div><p className="text-xs text-gray-400 mb-0.5">Account Holder</p><p className="font-medium text-gray-700">{r.bank_account_holder}</p></div>}
                {r.bank_account_number && <div><p className="text-xs text-gray-400 mb-0.5">Account Number</p><p className="font-medium text-gray-700">{r.bank_account_number}</p></div>}
                {r.bank_branch_code    && <div><p className="text-xs text-gray-400 mb-0.5">Branch Code</p><p className="font-medium text-gray-700">{r.bank_branch_code}</p></div>}
              </div>
            )}
          </div>

          {/* KPI cards */}
          <div className="grid grid-cols-2 lg:grid-cols-3 gap-4">
            <KpiCard label="Customers" value={customers.length}
              sub={stats.pending_applications > 0 ? `${stats.pending_applications} pending approval` : "All active"}
              icon={Users} accent="bg-purple-600" />
            <KpiCard label="Total Orders" value={stats.total_orders} sub="All time"
              icon={ShoppingCart} accent="bg-bassani-600" />
            <KpiCard label="All-time Commission" value={fmtR(stats.total_commission)} sub={`${stats.total_orders} orders`}
              icon={TrendingUp} accent="bg-emerald-500" />
            <KpiCard label="This Month Commission" value={fmtR(stats.month_commission)} sub={`${stats.month_orders} orders`}
              icon={CreditCard} accent="bg-blue-500" />
            <KpiCard label={`${fy_label} Commission`} value={fmtR(stats.fy_commission)} sub={`${stats.fy_orders} orders`}
              icon={FileText} accent="bg-violet-500" />
            {stats.pending_applications > 0 && (
              <KpiCard label="Pending Applications" value={stats.pending_applications} sub="Awaiting admin review"
                icon={Clock} accent="bg-amber-500" />
            )}
          </div>

          {/* Recent orders */}
          <Section title={`Recent Orders (${recent_orders.length})`}>
            {recent_orders.length === 0 ? (
              <p className="text-sm text-gray-400 px-5 py-4">No orders yet.</p>
            ) : (
              <table className="w-full text-sm">
                <thead>
                  <tr className="bg-gray-50 text-xs text-gray-500">
                    <th className="text-left px-5 py-2.5 font-medium">Order #</th>
                    <th className="text-left px-5 py-2.5 font-medium">Date</th>
                    <th className="text-left px-5 py-2.5 font-medium">Customer</th>
                    <th className="text-right px-5 py-2.5 font-medium">Order Total</th>
                    <th className="text-right px-5 py-2.5 font-medium">Commission</th>
                    <th className="text-left px-5 py-2.5 font-medium">Status</th>
                  </tr>
                </thead>
                <tbody>
                  {recent_orders.map((o, i) => (
                    <tr key={i} className="border-t border-gray-50 hover:bg-gray-50 transition-colors">
                      <td className="px-5 py-3 font-mono text-xs text-bassani-700">{o.order_name}</td>
                      <td className="px-5 py-3 text-gray-500">{fmtDate(o.date_order?.split("T")[0])}</td>
                      <td className="px-5 py-3 text-gray-700">{o.customer_name || "—"}</td>
                      <td className="px-5 py-3 text-right font-semibold">{fmtR(o.amount_total)}</td>
                      <td className="px-5 py-3 text-right font-semibold text-emerald-700">{fmtR(o.commission)}</td>
                      <td className="px-5 py-3"><Badge status={o.state} label={STATE_LABEL[o.state] || o.state} /></td>
                    </tr>
                  ))}
                </tbody>
              </table>
            )}
          </Section>

          {/* Pipeline */}
          <Section
            title={`Quote Pipeline (${pipeline.filter(t => !t.exit_status).length} active)`}
            action={
              <button
                onClick={() => navigate("/tickets/sales")}
                className="flex items-center gap-1.5 text-xs font-semibold text-bassani-600 hover:text-bassani-700 transition-colors"
              >
                <Ticket size={12} /> Open in Sales Tickets
              </button>
            }
          >
            {pipelineLoading ? (
              <p className="text-sm text-gray-400 px-5 py-4 flex items-center gap-1.5">
                <Loader2 size={13} className="animate-spin" />Loading pipeline…
              </p>
            ) : pipeline.length === 0 ? (
              <p className="text-sm text-gray-400 px-5 py-4">No quotes or tickets yet.</p>
            ) : (
              <table className="w-full text-sm">
                <thead>
                  <tr className="bg-gray-50 text-xs text-gray-500">
                    <th className="text-left px-5 py-2.5 font-medium">Customer</th>
                    <th className="text-left px-5 py-2.5 font-medium">Status</th>
                    <th className="text-left px-5 py-2.5 font-medium">Order Ref</th>
                    <th className="text-left px-5 py-2.5 font-medium">Updated</th>
                  </tr>
                </thead>
                <tbody>
                  {pipeline.map(t => {
                    const statusKey   = t.exit_status ? null : t.status;
                    const labelText   = t.exit_status
                      ? (TICKET_EXIT_LABEL[t.exit_status] || t.exit_status)
                      : (TICKET_STATUS_LABEL[t.status] || t.status);
                    const badgeCls    = t.exit_status
                      ? (TICKET_EXIT_COLOR[t.exit_status] || "bg-gray-100 text-gray-500")
                      : (TICKET_STATUS_COLOR[statusKey]   || "bg-gray-100 text-gray-500");
                    return (
                      <tr key={t.id} className="border-t border-gray-50 hover:bg-gray-50 transition-colors">
                        <td className="px-5 py-3 font-medium text-gray-900">{t.customer_name || "—"}</td>
                        <td className="px-5 py-3">
                          <span className={`inline-flex px-2 py-0.5 rounded-full text-[11px] font-semibold ${badgeCls}`}>
                            {labelText}
                          </span>
                        </td>
                        <td className="px-5 py-3 font-mono text-xs text-bassani-700">
                          {t.order_id ? `#${t.order_id}` : "—"}
                        </td>
                        <td className="px-5 py-3 text-gray-500 text-xs">{fmtDate(t.updated_at)}</td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            )}
          </Section>

          {/* Customers */}
          <Section
            title={`Customers (${customers.length})`}
            action={isAdmin && (
              <button onClick={() => setShowLink(true)}
                className="flex items-center gap-1.5 text-xs font-semibold text-bassani-600 hover:text-bassani-700 transition-colors">
                <Plus size={13} /> Link Customer
              </button>
            )}
          >
            {customers.length === 0 ? (
              <div className="px-5 py-6 text-center">
                <p className="text-sm text-gray-400 mb-3">No customers linked to this reseller yet.</p>
                {isAdmin && (
                  <button onClick={() => setShowLink(true)}
                    className="inline-flex items-center gap-1.5 text-xs font-semibold text-bassani-600 hover:text-bassani-700 transition-colors">
                    <Link2 size={12} /> Link an existing customer
                  </button>
                )}
              </div>
            ) : (
              <>
                <table className="w-full text-sm">
                  <thead>
                    <tr className="bg-gray-50 text-xs text-gray-500">
                      <th className="text-left px-5 py-2.5 font-medium">Name</th>
                      <th className="text-left px-5 py-2.5 font-medium">Email</th>
                      <th className="text-left px-5 py-2.5 font-medium">City</th>
                      <th className="text-left px-5 py-2.5 font-medium">Phone</th>
                      {isAdmin && <th className="w-16 px-5 py-2.5" />}
                    </tr>
                  </thead>
                  <tbody>
                    {custSlice.map(c => (
                      <tr key={c.id} className="border-t border-gray-50 hover:bg-gray-50 transition-colors">
                        <td className="px-5 py-3">
                          <div className="flex items-center gap-2">
                            <div className="w-6 h-6 rounded-full bg-bassani-100 flex items-center justify-center shrink-0">
                              <Building2 size={11} className="text-bassani-600" />
                            </div>
                            <span className="font-medium text-gray-900">{c.name}</span>
                          </div>
                        </td>
                        <td className="px-5 py-3 text-gray-500">{c.email || "—"}</td>
                        <td className="px-5 py-3 text-gray-500">{c.city  || "—"}</td>
                        <td className="px-5 py-3 text-gray-500">{c.phone || "—"}</td>
                        {isAdmin && (
                          <td className="px-5 py-3 text-right">
                            <button
                              onClick={() => handleUnlink(c)}
                              disabled={unlinking === c.id}
                              title="Unlink customer from reseller"
                              className="flex items-center gap-1 text-[11px] font-medium text-gray-400 hover:text-red-500 transition-colors disabled:opacity-50 ml-auto">
                              {unlinking === c.id
                                ? <Loader2 size={12} className="animate-spin" />
                                : <Unlink size={12} />}
                              Unlink
                            </button>
                          </td>
                        )}
                      </tr>
                    ))}
                  </tbody>
                </table>
                <PaginationBar page={custPage} pageSize={CUST_PAGE_SIZE} total={customers.length}
                  onChange={p => setCustPage(p)} />
                {isAdmin && (
                  <div className="px-5 py-3 border-t border-gray-50">
                    <button onClick={() => setShowLink(true)}
                      className="flex items-center gap-1.5 text-sm text-bassani-600 hover:text-bassani-700 font-medium transition-colors">
                      <Plus size={14} /> Link another customer
                    </button>
                  </div>
                )}
              </>
            )}
          </Section>

          {/* Commission bills */}
          {commission_bills.length > 0 && (
            <Section title={`Commission Bills (${commission_bills.length})`}>
              <table className="w-full text-sm">
                <thead>
                  <tr className="bg-gray-50 text-xs text-gray-500">
                    <th className="text-left px-5 py-2.5 font-medium">Bill #</th>
                    <th className="text-left px-5 py-2.5 font-medium">Date</th>
                    <th className="text-left px-5 py-2.5 font-medium">Due</th>
                    <th className="text-right px-5 py-2.5 font-medium">Total</th>
                    <th className="text-right px-5 py-2.5 font-medium">Outstanding</th>
                    <th className="text-left px-5 py-2.5 font-medium">Status</th>
                  </tr>
                </thead>
                <tbody>
                  {commission_bills.map(b => {
                    const overdue = b.invoice_date_due && new Date(b.invoice_date_due) < new Date();
                    return (
                      <tr key={b.id} className="border-t border-gray-50 hover:bg-gray-50 transition-colors">
                        <td className="px-5 py-3 font-mono text-xs text-bassani-700">{b.name}</td>
                        <td className="px-5 py-3 text-gray-500">{fmtDate(b.invoice_date)}</td>
                        <td className={`px-5 py-3 font-medium ${overdue ? "text-red-600" : "text-gray-500"}`}>
                          {fmtDate(b.invoice_date_due)}{overdue ? " ⚠" : ""}
                        </td>
                        <td className="px-5 py-3 text-right">{fmtR(b.amount_total)}</td>
                        <td className={`px-5 py-3 text-right font-semibold ${PAYMENT_COLOR[b.payment_state] || ""}`}>
                          {fmtR(b.amount_residual)}
                        </td>
                        <td className="px-5 py-3">
                          <span className="text-xs font-medium">{PAYMENT_LABEL[b.payment_state] || b.payment_state}</span>
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </Section>
          )}

          {/* Activity / audit trail */}
          {can("audit.view") && (
            <Section title={`Activity (${actTotal})`}>
              {actLoading ? (
                <p className="text-sm text-gray-400 px-5 py-4">Loading activity…</p>
              ) : activity.length === 0 ? (
                <p className="text-sm text-gray-400 px-5 py-4">No recorded activity for this reseller yet.</p>
              ) : (
                <>
                  <div className="divide-y divide-gray-50">
                    {activity.map((a, i) => (
                      <div key={i} className="px-5 py-3 flex items-start gap-3">
                        <div className="w-7 h-7 rounded-lg bg-gray-100 flex items-center justify-center shrink-0 mt-0.5">
                          <History size={13} className="text-gray-400" />
                        </div>
                        <div className="min-w-0 flex-1">
                          <p className="text-sm text-gray-800">
                            <span className="font-mono text-xs text-gray-500">{a.action}</span>
                            {a.entity_label && <span className="text-gray-600"> — {a.entity_label}</span>}
                          </p>
                          <p className="text-[11px] text-gray-400 mt-0.5">
                            {a.actor_username || "system"} · {a.created_at ? new Date(a.created_at).toLocaleString("en-ZA", { timeZone: "Africa/Johannesburg" }) : "—"}
                          </p>
                        </div>
                      </div>
                    ))}
                  </div>
                  <PaginationBar page={actPage} pageSize={ACT_PAGE_SIZE} total={actTotal}
                    onChange={p => setActPage(p)} />
                </>
              )}
            </Section>
          )}

        </div>
      </main>

      {showLink && (
        <LinkCustomerModal
          resellerId={id}
          onClose={() => setShowLink(false)}
          onLinked={handleLinked}
        />
      )}
      {unlinkConfirm && (
        <Modal title="Remove Customer" onClose={() => setUnlinkConfirm(null)}>
          <p className="text-sm text-gray-600">Remove <strong>{unlinkConfirm.name}</strong> from this reseller's account? This will prevent them from placing orders for this customer.</p>
          <div className="flex justify-end gap-2 mt-4">
            <BtnSecondary onClick={() => setUnlinkConfirm(null)}>Cancel</BtnSecondary>
            <BtnDanger onClick={doUnlink}>Remove</BtnDanger>
          </div>
        </Modal>
      )}
    </div>
  );
}
