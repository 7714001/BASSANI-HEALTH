import { useState, useEffect } from "react";
import api from "../api";
import { TopBar, StatCard, LoadingState, ErrorState, Badge, fmtR, fmtDate } from "../components/UI";

export default function Dashboard() {
  const [data, setData]     = useState(null);
  const [loading, setLoading] = useState(true);
  const [error, setError]   = useState(null);

  const load = async () => {
    setLoading(true); setError(null);
    try {
      const r = await api.get("/api/reports/dashboard");
      setData(r.data);
    } catch (e) {
      setError(e.response?.data?.detail || "Failed to load dashboard");
    } finally { setLoading(false); }
  };

  useEffect(() => { load(); }, []);

  return (
    <div className="flex flex-col flex-1 overflow-hidden">
      <TopBar title="Dashboard" subtitle="Overview of your business" onRefresh={load} />
      <main className="flex-1 overflow-y-auto p-6">
        {loading && <LoadingState />}
        {error   && <ErrorState message={error} onRetry={load} />}
        {data    && (
          <div className="space-y-5 max-w-6xl">
            {/* KPI row */}
            <div className="grid grid-cols-4 gap-4">
              <StatCard label="Total Products"    value={data.products.total}           sub={`${data.products.low_stock} low stock`} />
              <StatCard label="Orders This Month" value={data.orders.this_month}        sub={fmtR(data.orders.month_revenue)} />
              <StatCard label="Active Customers"  value={data.customers.active}         />
              <StatCard label="Commission Due"    value={fmtR(data.commission.due_this_month)} accent="text-bassani-700"
                sub={`${data.invoices.unpaid} unpaid invoices`} />
            </div>

            <div className="grid grid-cols-5 gap-4">
              {/* Recent orders */}
              <div className="col-span-3 bg-white rounded-xl border border-gray-100 overflow-hidden">
                <div className="px-5 py-4 border-b border-gray-50 flex justify-between items-center">
                  <h3 className="text-sm font-semibold text-gray-800">Recent orders</h3>
                </div>
                <table className="w-full text-sm">
                  <thead>
                    <tr className="bg-gray-50">
                      {["Order","Customer","Amount","Status"].map(h => (
                        <th key={h} className="text-left text-[10px] font-semibold text-gray-400 uppercase tracking-wider px-4 py-3">{h}</th>
                      ))}
                    </tr>
                  </thead>
                  <tbody>
                    {data.recent_orders.map(o => (
                      <tr key={o.id} className="border-t border-gray-50 hover:bg-gray-50 transition-colors">
                        <td className="px-4 py-3 font-mono text-xs text-bassani-700">{o.name}</td>
                        <td className="px-4 py-3 text-gray-700">{o.partner_id?.[1] || "—"}</td>
                        <td className="px-4 py-3 font-semibold">{fmtR(o.amount_total)}</td>
                        <td className="px-4 py-3"><Badge status={o.state} /></td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>

              {/* Right col */}
              <div className="col-span-2 space-y-4">
                {/* Low stock */}
                <div className="bg-white rounded-xl border border-gray-100 overflow-hidden">
                  <div className="px-5 py-4 border-b border-gray-50">
                    <h3 className="text-sm font-semibold text-gray-800">Low stock alerts</h3>
                  </div>
                  <div className="divide-y divide-gray-50">
                    {data.low_stock_products.length === 0 && (
                      <p className="text-xs text-gray-400 px-5 py-4">All stock levels healthy</p>
                    )}
                    {data.low_stock_products.map(p => (
                      <div key={p.id} className="flex items-center justify-between px-5 py-3">
                        <div>
                          <p className="text-xs font-medium text-gray-800 leading-none">{p.name}</p>
                          <p className="text-[10px] text-gray-400 mt-0.5">{p.categ_id?.[1]}</p>
                        </div>
                        <span className={`text-xs font-semibold ${p.qty_available <= 0 ? "text-red-600" : "text-amber-600"}`}>
                          {p.qty_available} {p.uom_id?.[1] || "units"}
                        </span>
                      </div>
                    ))}
                  </div>
                </div>

                {/* Invoice summary */}
                <div className="bg-white rounded-xl border border-gray-100 p-5">
                  <h3 className="text-sm font-semibold text-gray-800 mb-3">Invoicing</h3>
                  <div className="space-y-2.5">
                    <div className="flex justify-between text-sm">
                      <span className="text-gray-500">Unpaid invoices</span>
                      <span className="font-semibold text-amber-600">{data.invoices.unpaid}</span>
                    </div>
                    <div className="flex justify-between text-sm">
                      <span className="text-gray-500">Outstanding balance</span>
                      <span className="font-semibold text-red-600">{fmtR(data.invoices.overdue_amount)}</span>
                    </div>
                  </div>
                </div>
              </div>
            </div>
          </div>
        )}
      </main>
    </div>
  );
}
