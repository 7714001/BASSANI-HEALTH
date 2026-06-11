import { useState, useEffect } from "react";
import { useNavigate } from "react-router-dom";
import api from "../api";
import { useAuth } from "../AuthContext";
import { TopBar, StatCard, LoadingState, ErrorState, Badge, fmtR, fmtDate } from "../components/UI";

export default function Dashboard() {
  const { user } = useAuth();
  const isReseller = user?.role === "reseller";
  const navigate = useNavigate();
  const [data,   setData  ] = useState(null);
  const [loading,setLoading] = useState(true);
  const [error,  setError ] = useState(null);
  const [target, setTarget] = useState(null);

  const load = async () => {
    setLoading(true); setError(null);
    try {
      const [dashRes, targetRes] = await Promise.allSettled([
        api.get("/api/reports/dashboard"),
        api.get("/api/targets/current"),
      ]);
      if (dashRes.status === "fulfilled") setData(dashRes.value.data);
      else setError(dashRes.reason?.response?.data?.detail || "Failed to load dashboard");
      if (targetRes.status === "fulfilled") setTarget(targetRes.value.data);
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
            <div className="grid grid-cols-2 lg:grid-cols-4 gap-4">
              {isReseller ? (
                <>
                  <StatCard label="Orders This Month" value={data.orders.this_month} sub={fmtR(data.orders.month_revenue)} />
                  <StatCard label="All-Time Orders" value={data.orders.total} />
                  <StatCard label="Commission This Month" value={fmtR(data.commission.due_this_month)} accent="text-bassani-700" />
                  <StatCard
                    label="Outstanding Invoices"
                    value={data.invoices.unpaid}
                    sub={data.invoices.unpaid > 0 ? fmtR(data.invoices.overdue_amount) : "All clear"}
                    accent={data.invoices.unpaid > 0 ? "text-amber-600" : undefined}
                  />
                </>
              ) : (
                <>
                  <StatCard label="Total Products"    value={data.products.total}           sub={`${data.products.low_stock} low stock`} />
                  <StatCard label="Orders This Month" value={data.orders.this_month}        sub={fmtR(data.orders.month_revenue)} />
                  <StatCard label="Active Customers"  value={data.customers.active} />
                  <StatCard label="Commission Due"    value={fmtR(data.commission.due_this_month)} accent="text-bassani-700"
                    sub={`${data.invoices.unpaid} unpaid invoices`} />
                </>
              )}
            </div>

            {/* Admin-only channel KPIs */}
            {!isReseller && data.channel_kpis && (
              <div className="bg-white border border-gray-100 rounded-xl px-5 py-4">
                <div className="flex items-center justify-between mb-4">
                  <h3 className="text-sm font-semibold text-gray-800">Channel Performance</h3>
                  <span className="text-xs text-gray-400">{data.channel_kpis.fy_label} · 1 Mar – 28 Feb</span>
                </div>
                <div className="grid grid-cols-2 lg:grid-cols-4 gap-4">
                  <div className="rounded-xl border border-gray-100 p-4 space-y-1">
                    <p className="text-[10px] font-semibold text-gray-400 uppercase tracking-wider">Bassani {data.channel_kpis.fy_label}</p>
                    <p className="text-2xl font-bold text-gray-800">{data.channel_kpis.bassani.fy_orders}</p>
                    <p className="text-xs text-gray-500">{fmtR(data.channel_kpis.bassani.fy_value)}</p>
                  </div>
                  <div className="rounded-xl border border-gray-100 p-4 space-y-1">
                    <p className="text-[10px] font-semibold text-gray-400 uppercase tracking-wider">Bassani This Month</p>
                    <p className="text-2xl font-bold text-gray-800">{data.channel_kpis.bassani.month_orders}</p>
                    <p className="text-xs text-gray-500">{fmtR(data.channel_kpis.bassani.month_value)}</p>
                  </div>
                  <div className="rounded-xl border border-bassani-100 bg-bassani-50/30 p-4 space-y-1">
                    <p className="text-[10px] font-semibold text-bassani-500 uppercase tracking-wider">Reseller {data.channel_kpis.fy_label}</p>
                    <p className="text-2xl font-bold text-bassani-700">{data.channel_kpis.reseller.fy_orders}</p>
                    <p className="text-xs text-bassani-600">{fmtR(data.channel_kpis.reseller.fy_value)}</p>
                  </div>
                  <div className="rounded-xl border border-bassani-100 bg-bassani-50/30 p-4 space-y-1">
                    <p className="text-[10px] font-semibold text-bassani-500 uppercase tracking-wider">Reseller This Month</p>
                    <p className="text-2xl font-bold text-bassani-700">{data.channel_kpis.reseller.month_orders}</p>
                    <p className="text-xs text-bassani-600">{fmtR(data.channel_kpis.reseller.month_value)}</p>
                  </div>
                </div>

                {/* Monthly target tile — injected into Channel Performance */}
                {target && (target.target_revenue || target.target_orders) ? (() => {
                  const paceRatio = target.days_in_month > 0 ? target.days_elapsed / target.days_in_month : 0;
                  const revPct    = target.target_revenue ? Math.round(target.actual_revenue / target.target_revenue * 100) : null;
                  const ordPct    = target.target_orders  ? Math.round(target.actual_orders  / target.target_orders  * 100) : null;
                  const revOnTrack = revPct != null && revPct >= paceRatio * 100 * 0.9;
                  const ordOnTrack = ordPct != null && ordPct >= paceRatio * 100 * 0.9;
                  const barCls = (pct, onTrack) =>
                    pct >= 100 ? "bg-green-500" : onTrack ? "bg-bassani-600" : "bg-amber-500";
                  return (
                    <div className="mt-4 pt-4 border-t border-gray-50">
                      <div className="flex items-center justify-between mb-3">
                        <p className="text-[10px] font-semibold text-gray-400 uppercase tracking-wider">
                          Monthly Target — {target.month_name}
                        </p>
                        <span className="text-[10px] text-gray-400">Day {target.days_elapsed} of {target.days_in_month}</span>
                      </div>
                      <div className="grid sm:grid-cols-2 gap-4">
                        {revPct != null && (
                          <div>
                            <div className="flex justify-between text-xs text-gray-500 mb-1.5">
                              <span className="font-medium">Revenue</span>
                              <span>{fmtR(target.actual_revenue)} <span className="text-gray-300">/ {fmtR(target.target_revenue)}</span></span>
                            </div>
                            <div className="h-2 bg-gray-100 rounded-full overflow-hidden">
                              <div className={`h-full rounded-full ${barCls(revPct, revOnTrack)}`} style={{ width: `${Math.min(revPct, 100)}%` }} />
                            </div>
                            <p className={`text-[10px] mt-1 font-medium ${revPct >= 100 ? "text-green-600" : revOnTrack ? "text-bassani-600" : "text-amber-600"}`}>
                              {revPct}% · {revPct >= 100 ? "Target hit!" : revOnTrack ? "On track" : "Behind target"}
                            </p>
                          </div>
                        )}
                        {ordPct != null && (
                          <div>
                            <div className="flex justify-between text-xs text-gray-500 mb-1.5">
                              <span className="font-medium">Orders</span>
                              <span>{target.actual_orders} <span className="text-gray-300">/ {target.target_orders}</span></span>
                            </div>
                            <div className="h-2 bg-gray-100 rounded-full overflow-hidden">
                              <div className={`h-full rounded-full ${barCls(ordPct, ordOnTrack)}`} style={{ width: `${Math.min(ordPct, 100)}%` }} />
                            </div>
                            <p className={`text-[10px] mt-1 font-medium ${ordPct >= 100 ? "text-green-600" : ordOnTrack ? "text-bassani-600" : "text-amber-600"}`}>
                              {ordPct}% · {ordPct >= 100 ? "Target hit!" : ordOnTrack ? "On track" : "Behind target"}
                            </p>
                          </div>
                        )}
                      </div>
                    </div>
                  );
                })() : !isReseller && (
                  <div className="mt-4 pt-4 border-t border-gray-50">
                    <button onClick={() => navigate("/targets")}
                      className="text-xs text-bassani-600 hover:text-bassani-700 hover:underline transition-colors">
                      Set a target for this month →
                    </button>
                  </div>
                )}
              </div>
            )}

            {/* Admin-only pipeline overview */}
            {!isReseller && data.pipeline && (
              <div className="bg-white border border-gray-100 rounded-xl px-5 py-4">
                <div className="flex items-center justify-between mb-4">
                  <h3 className="text-sm font-semibold text-gray-800">Active Pipeline</h3>
                  <span className="text-xs text-gray-400">
                    Today: <b className="text-gray-700">{data.pipeline.today}</b> new {data.pipeline.today === 1 ? "order" : "orders"}
                  </span>
                </div>
                <div className="grid grid-cols-1 sm:grid-cols-3 gap-6">
                  <div>
                    <p className="text-[10px] text-gray-400 uppercase tracking-wider font-semibold mb-1">Quotes / Drafts</p>
                    <p className="text-2xl font-bold text-gray-800">{data.pipeline.draft_count}</p>
                    <p className="text-xs text-gray-500 mt-0.5">{fmtR(data.pipeline.draft_value)}</p>
                  </div>
                  <div>
                    <p className="text-[10px] text-gray-400 uppercase tracking-wider font-semibold mb-1">Confirmed Orders</p>
                    <p className="text-2xl font-bold text-bassani-700">{data.pipeline.confirmed_count}</p>
                    <p className="text-xs text-gray-500 mt-0.5">{fmtR(data.pipeline.confirmed_value)}</p>
                  </div>
                  <button className="text-left hover:opacity-75 transition-opacity" onClick={() => navigate("/invoices", { state: { filter: "unpaid" } })}>
                    <p className="text-[10px] text-gray-400 uppercase tracking-wider font-semibold mb-1">Balance to Chase</p>
                    <p className="text-2xl font-bold text-red-600">{fmtR(data.invoices.overdue_amount)}</p>
                    <p className="text-xs text-bassani-600 mt-0.5 underline underline-offset-2">{data.invoices.unpaid} unpaid invoice{data.invoices.unpaid !== 1 ? "s" : ""} — view list →</p>
                  </button>
                </div>
              </div>
            )}

            {isReseller ? (
              /* Reseller — full-width recent orders */
              <div className="bg-white rounded-xl border border-gray-100 overflow-hidden">
                <div className="px-5 py-4 border-b border-gray-50">
                  <h3 className="text-sm font-semibold text-gray-800">Recent orders</h3>
                </div>
                <table className="w-full text-sm">
                  <thead>
                    <tr className="bg-gray-50">
                      {["Order","Date","Amount","Status"].map(h => (
                        <th key={h} className="text-left text-[10px] font-semibold text-gray-400 uppercase tracking-wider px-4 py-3">{h}</th>
                      ))}
                    </tr>
                  </thead>
                  <tbody>
                    {data.recent_orders.length === 0 && (
                      <tr><td colSpan={4} className="px-4 py-8 text-center text-gray-400 text-sm">No orders yet</td></tr>
                    )}
                    {data.recent_orders.map(o => (
                      <tr key={o.id} className="border-t border-gray-50 hover:bg-gray-50 transition-colors">
                        <td className="px-4 py-3 font-mono text-xs text-bassani-700">{o.name}</td>
                        <td className="px-4 py-3 text-gray-500 text-xs">{fmtDate(o.date_order)}</td>
                        <td className="px-4 py-3 font-semibold">{fmtR(o.amount_total)}</td>
                        <td className="px-4 py-3"><Badge status={o.state} /></td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            ) : (
              /* Admin — recent orders + low stock + invoicing */
              <div className="grid grid-cols-1 lg:grid-cols-5 gap-4">
                <div className="lg:col-span-3 bg-white rounded-xl border border-gray-100 overflow-hidden">
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

                <div className="lg:col-span-2 space-y-4">
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

                  <button className="bg-white rounded-xl border border-gray-100 p-5 text-left w-full hover:border-bassani-200 transition-colors"
                    onClick={() => navigate("/invoices", { state: { filter: "unpaid" } })}>
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
                    <p className="text-[10px] text-bassani-600 mt-3">View all invoices →</p>
                  </button>
                </div>
              </div>
            )}
          </div>
        )}
      </main>
    </div>
  );
}
