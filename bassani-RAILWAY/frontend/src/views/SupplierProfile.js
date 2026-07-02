import { useState, useEffect } from "react";
import { useParams, useNavigate } from "react-router-dom";
import { ChevronDown, ShoppingCart, FileText, TrendingUp, Package, Inbox } from "lucide-react";
import api from "../api";
import toast from "react-hot-toast";
import { LoadingState, fmtR, fmtDate } from "../components/UI";

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

function EmptyRow({ text }) {
  return <p className="px-5 py-4 text-sm text-gray-400">{text}</p>;
}

const PO_STATE_LABEL = {
  draft: "Draft", sent: "Sent", to_approve: "To Approve",
  purchase: "Confirmed", done: "Done", cancel: "Cancelled",
};
const PO_STATE_COLOR = {
  draft: "text-gray-400", sent: "text-blue-600", to_approve: "text-amber-600",
  purchase: "text-green-600", done: "text-green-700", cancel: "text-red-500",
};
const BILL_PAY_LABEL = {
  not_paid: "Unpaid", partial: "Partial", in_payment: "In Payment", paid: "Paid",
};
const BILL_PAY_COLOR = {
  not_paid: "text-red-600", partial: "text-amber-600",
  in_payment: "text-blue-600", paid: "text-green-600",
};

export default function SupplierProfile() {
  const { id }       = useParams();
  const navigate     = useNavigate();
  const [data,    setData   ] = useState(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    api.get(`/api/suppliers/${id}/profile`)
      .then(r => setData(r.data))
      .catch(() => { toast.error("Failed to load supplier profile"); navigate("/suppliers"); })
      .finally(() => setLoading(false));
  }, [id, navigate]);

  if (loading) return <LoadingState />;
  if (!data)   return null;

  const { supplier: s, stats, vendor_bills, purchase_orders, receipts, products_supplied } = data;
  const isCust = (s.customer_rank || 0) > 0;
  const isSupp = (s.supplier_rank || 0) > 0;
  const initials = (s.name || "?").split(" ").map(w => w[0]).join("").slice(0, 2).toUpperCase();

  return (
    <div className="flex flex-col flex-1 overflow-hidden">
      {/* Top bar */}
      <div className="border-b border-gray-100 bg-white px-6 py-3 flex items-center shrink-0">
        <button onClick={() => navigate("/suppliers")}
          className="flex items-center gap-1.5 text-sm text-gray-500 hover:text-gray-800 transition-colors">
          <ChevronDown size={14} className="-rotate-90" />Back to Suppliers
        </button>
      </div>

      <main className="flex-1 overflow-y-auto p-6 bg-gray-50">
        <div className="max-w-5xl mx-auto space-y-5">

          {/* Header card */}
          <div className="bg-white rounded-2xl border border-gray-100 p-6">
            <div className="flex items-start gap-4 flex-wrap">
              <div className="w-14 h-14 rounded-2xl bg-amber-600 flex items-center justify-center shrink-0">
                <span className="text-white text-xl font-bold">{initials}</span>
              </div>
              <div className="flex-1 min-w-0">
                <div className="flex items-center gap-2 flex-wrap mb-1">
                  <h1 className="text-xl font-bold text-gray-900">{s.name}</h1>
                  {isCust && isSupp && (
                    <span className="text-[10px] font-semibold bg-purple-100 text-purple-700 px-2 py-0.5 rounded-full">Cust & Supplier</span>
                  )}
                  {!isCust && isSupp && (
                    <span className="text-[10px] font-semibold bg-amber-100 text-amber-700 px-2 py-0.5 rounded-full">Supplier</span>
                  )}
                </div>
                <div className="flex flex-wrap gap-x-5 gap-y-1 text-sm text-gray-500">
                  {s.ref   && <span className="font-mono text-xs text-gray-400">{s.ref}</span>}
                  {s.email && <span>{s.email}</span>}
                  {s.phone && <span>{s.phone}</span>}
                  {s.vat   && <span>VAT: {s.vat}</span>}
                </div>
                {(s.street || s.city) && (
                  <p className="text-xs text-gray-400 mt-1">
                    {[s.street, s.city, s.zip, s.country_name].filter(Boolean).join(", ")}
                  </p>
                )}
                {s.payment_term_name && (
                  <p className="text-xs text-gray-400 mt-1">
                    Payment terms: <span className="font-medium text-gray-600">{s.payment_term_name}</span>
                  </p>
                )}
              </div>
            </div>
          </div>

          {/* KPI row */}
          <div className="grid grid-cols-2 gap-4 sm:grid-cols-4">
            <KpiCard
              label="Confirmed POs" value={stats.total_purchase_orders}
              sub="All time" icon={ShoppingCart} accent="bg-bassani-600"
            />
            <KpiCard
              label="Total Spend" value={fmtR(stats.total_po_spend)}
              sub="Confirmed POs" icon={TrendingUp} accent="bg-green-600"
            />
            <KpiCard
              label="Outstanding Balance" value={fmtR(stats.outstanding_balance)}
              sub={`${stats.open_bills} unpaid bill${stats.open_bills !== 1 ? "s" : ""}`}
              icon={FileText} accent={stats.outstanding_balance > 0 ? "bg-amber-500" : "bg-gray-400"}
            />
            <KpiCard
              label="Products Supplied" value={stats.products_supplied}
              sub="SKUs in Odoo" icon={Package} accent="bg-purple-600"
            />
          </div>

          {/* Vendor Bills */}
          <Section title={`Vendor Bills (${vendor_bills.length})`}>
            {vendor_bills.length === 0 ? <EmptyRow text="No vendor bills on record." /> : (
              <div className="overflow-x-auto">
                <table className="w-full text-sm">
                  <thead>
                    <tr className="text-left text-xs text-gray-400 font-medium border-b border-gray-50">
                      <th className="px-5 py-3">Reference</th>
                      <th className="px-5 py-3">Date</th>
                      <th className="px-5 py-3">Due</th>
                      <th className="px-5 py-3 text-right">Amount</th>
                      <th className="px-5 py-3">Status</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-gray-50">
                    {vendor_bills.map(b => (
                      <tr key={b.id} className="hover:bg-gray-50">
                        <td className="px-5 py-3 font-mono text-xs text-gray-700">{b.name}</td>
                        <td className="px-5 py-3 text-gray-500">{fmtDate(b.invoice_date)}</td>
                        <td className="px-5 py-3 text-gray-500">{fmtDate(b.invoice_date_due)}</td>
                        <td className="px-5 py-3 text-right font-semibold text-gray-900">{fmtR(b.amount_total)}</td>
                        <td className={`px-5 py-3 text-xs font-semibold ${BILL_PAY_COLOR[b.payment_state] || "text-gray-500"}`}>
                          {BILL_PAY_LABEL[b.payment_state] || b.payment_state}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
          </Section>

          {/* Purchase Orders */}
          <Section title={`Purchase Orders (${purchase_orders.length})`}>
            {purchase_orders.length === 0 ? <EmptyRow text="No purchase orders on record." /> : (
              <div className="overflow-x-auto">
                <table className="w-full text-sm">
                  <thead>
                    <tr className="text-left text-xs text-gray-400 font-medium border-b border-gray-50">
                      <th className="px-5 py-3">Reference</th>
                      <th className="px-5 py-3">Order Date</th>
                      <th className="px-5 py-3">Confirmed</th>
                      <th className="px-5 py-3 text-right">Total</th>
                      <th className="px-5 py-3">Status</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-gray-50">
                    {purchase_orders.map(po => (
                      <tr key={po.id} className="hover:bg-gray-50">
                        <td className="px-5 py-3 font-mono text-xs text-gray-700">{po.name}</td>
                        <td className="px-5 py-3 text-gray-500">{fmtDate(po.date_order)}</td>
                        <td className="px-5 py-3 text-gray-500">{po.date_approve ? fmtDate(po.date_approve) : "—"}</td>
                        <td className="px-5 py-3 text-right font-semibold text-gray-900">{fmtR(po.amount_total)}</td>
                        <td className={`px-5 py-3 text-xs font-semibold ${PO_STATE_COLOR[po.state] || "text-gray-500"}`}>
                          {PO_STATE_LABEL[po.state] || po.state}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
          </Section>

          {/* Goods Receipts */}
          <Section title={`Goods Receipts (${receipts.length})`}>
            {receipts.length === 0 ? <EmptyRow text="No goods receipts on record." /> : (
              <div className="overflow-x-auto">
                <table className="w-full text-sm">
                  <thead>
                    <tr className="text-left text-xs text-gray-400 font-medium border-b border-gray-50">
                      <th className="px-5 py-3">Reference</th>
                      <th className="px-5 py-3">Source Document</th>
                      <th className="px-5 py-3">Received</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-gray-50">
                    {receipts.map(r => (
                      <tr key={r.id} className="hover:bg-gray-50">
                        <td className="px-5 py-3 font-mono text-xs text-gray-700">{r.name}</td>
                        <td className="px-5 py-3 text-gray-500 text-xs">{r.origin || "—"}</td>
                        <td className="px-5 py-3 text-gray-500">{fmtDate(r.date_done)}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
          </Section>

          {/* Products Supplied */}
          <Section title={`Products Supplied (${products_supplied.length})`}>
            {products_supplied.length === 0
              ? <EmptyRow text="No products configured for this supplier in Odoo." />
              : (
                <div className="divide-y divide-gray-50">
                  {products_supplied.map(p => (
                    <div key={p.id} className="flex items-center gap-4 px-5 py-3">
                      <div className="w-8 h-8 bg-amber-50 rounded-lg flex items-center justify-center shrink-0">
                        <Package size={14} className="text-amber-600" />
                      </div>
                      <div className="flex-1 min-w-0">
                        <p className="text-sm font-semibold text-gray-800 truncate">{p.name}</p>
                        {p.default_code && <p className="text-xs text-gray-400 font-mono">{p.default_code}</p>}
                      </div>
                      {!p.active && (
                        <span className="text-[9px] font-semibold bg-red-50 text-red-500 px-1.5 py-0.5 rounded shrink-0">Archived</span>
                      )}
                    </div>
                  ))}
                </div>
              )
            }
          </Section>

        </div>
      </main>
    </div>
  );
}
