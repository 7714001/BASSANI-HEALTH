import { useState, useEffect } from "react";
import { useParams, useNavigate } from "react-router-dom";
import {
  ChevronDown, ShoppingCart, TrendingUp, Users, CreditCard,
  FileText, Clock, Building2, History,
} from "lucide-react";
import api from "../api";
import toast from "react-hot-toast";
import { useAuth } from "../AuthContext";
import { Badge, BtnSecondary, LoadingState, fmtR, fmtDate } from "../components/UI";

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

function Section({ title, children }) {
  return (
    <div className="bg-white rounded-2xl border border-gray-100 overflow-hidden">
      <div className="px-5 py-4 border-b border-gray-50">
        <h3 className="font-semibold text-gray-800 text-sm">{title}</h3>
      </div>
      {children}
    </div>
  );
}

const STATE_LABEL   = { draft:"Quotation", sale:"Confirmed", done:"Done", cancel:"Cancelled", sent:"Sent" };
const PAYMENT_LABEL = { not_paid:"Unpaid", partial:"Partial", in_payment:"In Payment", paid:"Paid" };
const PAYMENT_COLOR = { not_paid:"text-red-600", partial:"text-amber-600", in_payment:"text-blue-600", paid:"text-green-600" };

export default function ResellerProfile() {
  const { id } = useParams();
  const navigate = useNavigate();
  const { can } = useAuth();
  const [data,    setData   ] = useState(null);
  const [loading, setLoading] = useState(true);
  const [activity, setActivity] = useState([]);

  useEffect(() => {
    api.get(`/api/resellers/${id}/profile`)
      .then(r => setData(r.data))
      .catch(() => { toast.error("Failed to load reseller profile"); navigate("/resellers"); })
      .finally(() => setLoading(false));
  }, [id, navigate]);

  useEffect(() => {
    if (!can("audit.view")) return;
    api.get("/api/audit/", { params: { reseller_id: id, limit: 50 } })
      .then(r => setActivity(r.data.logs))
      .catch(() => {});
  }, [id, can]);

  if (loading) return <LoadingState />;
  if (!data)   return null;

  const { reseller: r, fy_label, stats, customers, recent_orders, commission_bills } = data;

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

            {/* Bank details */}
            {r.bank_name && (
              <div className="mt-5 pt-5 border-t border-gray-50 grid grid-cols-2 sm:grid-cols-4 gap-4 text-sm">
                {r.bank_name             && <div><p className="text-xs text-gray-400 mb-0.5">Bank</p><p className="font-medium text-gray-700">{r.bank_name}</p></div>}
                {r.bank_account_holder   && <div><p className="text-xs text-gray-400 mb-0.5">Account Holder</p><p className="font-medium text-gray-700">{r.bank_account_holder}</p></div>}
                {r.bank_account_number   && <div><p className="text-xs text-gray-400 mb-0.5">Account Number</p><p className="font-medium text-gray-700">{r.bank_account_number}</p></div>}
                {r.bank_branch_code      && <div><p className="text-xs text-gray-400 mb-0.5">Branch Code</p><p className="font-medium text-gray-700">{r.bank_branch_code}</p></div>}
              </div>
            )}
          </div>

          {/* KPI cards */}
          <div className="grid grid-cols-2 lg:grid-cols-3 gap-4">
            <KpiCard
              label="Customers Onboarded"
              value={stats.customer_total}
              sub={stats.pending_applications > 0 ? `${stats.pending_applications} pending approval` : "All active"}
              icon={Users}
              accent="bg-purple-600"
            />
            <KpiCard
              label="Total Orders"
              value={stats.total_orders}
              sub="All time"
              icon={ShoppingCart}
              accent="bg-bassani-600"
            />
            <KpiCard
              label="All-time Commission"
              value={fmtR(stats.total_commission)}
              sub={`${stats.total_orders} orders`}
              icon={TrendingUp}
              accent="bg-emerald-500"
            />
            <KpiCard
              label="This Month Commission"
              value={fmtR(stats.month_commission)}
              sub={`${stats.month_orders} orders`}
              icon={CreditCard}
              accent="bg-blue-500"
            />
            <KpiCard
              label={`${fy_label} Commission`}
              value={fmtR(stats.fy_commission)}
              sub={`${stats.fy_orders} orders`}
              icon={FileText}
              accent="bg-violet-500"
            />
            {stats.pending_applications > 0 && (
              <KpiCard
                label="Pending Applications"
                value={stats.pending_applications}
                sub="Awaiting admin review"
                icon={Clock}
                accent="bg-amber-500"
              />
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

          {/* Customers */}
          <Section title={`Customers (${customers.length})`}>
            {customers.length === 0 ? (
              <p className="text-sm text-gray-400 px-5 py-4">No customers onboarded yet.</p>
            ) : (
              <table className="w-full text-sm">
                <thead>
                  <tr className="bg-gray-50 text-xs text-gray-500">
                    <th className="text-left px-5 py-2.5 font-medium">Name</th>
                    <th className="text-left px-5 py-2.5 font-medium">Email</th>
                    <th className="text-left px-5 py-2.5 font-medium">City</th>
                    <th className="text-left px-5 py-2.5 font-medium">Phone</th>
                  </tr>
                </thead>
                <tbody>
                  {customers.map(c => (
                    <tr key={c.id} className="border-t border-gray-50 hover:bg-gray-50 transition-colors">
                      <td className="px-5 py-3">
                        <div className="flex items-center gap-2">
                          <div className="w-6 h-6 rounded-full bg-bassani-100 flex items-center justify-center">
                            <Building2 size={11} className="text-bassani-600" />
                          </div>
                          <span className="font-medium text-gray-900">{c.name}</span>
                        </div>
                      </td>
                      <td className="px-5 py-3 text-gray-500">{c.email || "—"}</td>
                      <td className="px-5 py-3 text-gray-500">{c.city || "—"}</td>
                      <td className="px-5 py-3 text-gray-500">{c.phone || "—"}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
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
            <Section title={`Activity (${activity.length})`}>
              {activity.length === 0 ? (
                <p className="text-sm text-gray-400 px-5 py-4">No recorded activity for this reseller yet.</p>
              ) : (
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
                          {a.actor_username || "system"} · {a.created_at ? new Date(a.created_at).toLocaleString("en-ZA") : "—"}
                        </p>
                      </div>
                    </div>
                  ))}
                </div>
              )}
            </Section>
          )}

        </div>
      </main>
    </div>
  );
}
