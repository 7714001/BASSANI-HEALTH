import { useState, useEffect, useCallback } from "react";
import { Target, Edit2, CheckCircle, XCircle, Clock, TrendingUp } from "lucide-react";
import api from "../api";
import toast from "react-hot-toast";
import { TopBar, Modal, FormGroup, Input, BtnPrimary, BtnSecondary, LoadingState, fmtR } from "../components/UI";

// ── Helpers ────────────────────────────────────────────────────────────────────

function pace(daysElapsed, daysInMonth) {
  return daysInMonth > 0 ? daysElapsed / daysInMonth : 0;
}

function isOnTrack(pct, daysElapsed, daysInMonth) {
  if (pct == null) return null;
  const expected = pace(daysElapsed, daysInMonth) * 100;
  return pct >= expected * 0.9; // within 10% of pace = on track
}

function barColor(pct, daysElapsed, daysInMonth, isFuture) {
  if (isFuture || pct == null) return "bg-gray-200";
  if (pct >= 100)              return "bg-green-500";
  if (isOnTrack(pct, daysElapsed, daysInMonth)) return "bg-bassani-600";
  return "bg-amber-500";
}

function StatusBadge({ month }) {
  const { is_future, is_current, target_revenue, target_orders, revenue_pct, orders_pct, days_elapsed, days_in_month } = month;
  if (is_future) {
    return target_revenue || target_orders
      ? <span className="text-[10px] text-gray-400 font-medium">Upcoming</span>
      : <span className="text-[10px] text-gray-300 font-medium">No target</span>;
  }
  if (is_current) {
    const pct = revenue_pct ?? orders_pct;
    const on  = isOnTrack(pct, days_elapsed, days_in_month);
    if (pct == null) return <span className="text-[10px] text-gray-400 font-medium">No target set</span>;
    return on
      ? <span className="flex items-center gap-1 text-[10px] text-bassani-700 font-semibold"><TrendingUp size={10}/>On track</span>
      : <span className="flex items-center gap-1 text-[10px] text-amber-600 font-semibold"><Clock size={10}/>Behind target</span>;
  }
  // Past month
  if (!target_revenue && !target_orders) {
    return <span className="text-[10px] text-gray-300 font-medium">No target set</span>;
  }
  const revHit = revenue_pct == null || revenue_pct >= 100;
  const ordHit = orders_pct  == null || orders_pct  >= 100;
  return revHit && ordHit
    ? <span className="flex items-center gap-1 text-[10px] text-green-600 font-semibold"><CheckCircle size={10}/>Hit</span>
    : <span className="flex items-center gap-1 text-[10px] text-red-500 font-semibold"><XCircle size={10}/>Missed</span>;
}

// ── Month card ─────────────────────────────────────────────────────────────────

function MonthCard({ month, onEdit }) {
  const { month_name, is_current, is_future, target_revenue, target_orders,
    actual_revenue, actual_orders, revenue_pct, orders_pct,
    days_elapsed, days_in_month } = month;

  const borderCls = is_current
    ? "border-bassani-300 ring-1 ring-bassani-200"
    : is_future
      ? "border-gray-100"
      : (revenue_pct ?? orders_pct ?? 0) >= 100
        ? "border-green-200"
        : (target_revenue || target_orders) ? "border-red-100" : "border-gray-100";

  return (
    <div className={`bg-white rounded-2xl border p-4 flex flex-col gap-3 ${borderCls} ${is_future ? "opacity-60" : ""}`}>
      {/* Header */}
      <div className="flex items-start justify-between">
        <div>
          <p className={`text-sm font-bold ${is_current ? "text-bassani-700" : "text-gray-800"}`}>{month_name}</p>
          {is_current && <p className="text-[10px] text-bassani-500 mt-0.5">Day {days_elapsed} of {days_in_month}</p>}
        </div>
        <div className="flex items-center gap-2">
          <StatusBadge month={month} />
          <button onClick={() => onEdit(month)}
            className="text-gray-300 hover:text-bassani-600 transition-colors p-0.5">
            <Edit2 size={13} />
          </button>
        </div>
      </div>

      {/* Revenue */}
      <div>
        <div className="flex justify-between text-[10px] text-gray-400 mb-1 font-medium">
          <span>REVENUE</span>
          <span>
            {actual_revenue != null ? fmtR(actual_revenue) : "—"}
            {target_revenue ? <span className="text-gray-300"> / {fmtR(target_revenue)}</span> : " (no target)"}
          </span>
        </div>
        <div className="h-2 bg-gray-100 rounded-full overflow-hidden">
          <div className={`h-full rounded-full transition-all ${barColor(revenue_pct, days_elapsed, days_in_month, is_future)}`}
            style={{ width: `${Math.min(revenue_pct ?? 0, 100)}%` }} />
        </div>
        {revenue_pct != null && (
          <p className="text-[10px] text-right text-gray-400 mt-0.5">{revenue_pct}%</p>
        )}
      </div>

      {/* Orders */}
      <div>
        <div className="flex justify-between text-[10px] text-gray-400 mb-1 font-medium">
          <span>ORDERS</span>
          <span>
            {actual_orders != null ? actual_orders : "—"}
            {target_orders ? <span className="text-gray-300"> / {target_orders}</span> : " (no target)"}
          </span>
        </div>
        <div className="h-2 bg-gray-100 rounded-full overflow-hidden">
          <div className={`h-full rounded-full transition-all ${barColor(orders_pct, days_elapsed, days_in_month, is_future)}`}
            style={{ width: `${Math.min(orders_pct ?? 0, 100)}%` }} />
        </div>
        {orders_pct != null && (
          <p className="text-[10px] text-right text-gray-400 mt-0.5">{orders_pct}%</p>
        )}
      </div>
    </div>
  );
}

// ── Edit modal ─────────────────────────────────────────────────────────────────

function EditModal({ month, onClose, onSaved }) {
  const [form,   setForm  ] = useState({
    target_revenue: month.target_revenue ?? "",
    target_orders:  month.target_orders  ?? "",
    notes:          month.notes          ?? "",
  });
  const [saving, setSaving] = useState(false);

  const save = async () => {
    setSaving(true);
    try {
      await api.put(`/api/targets/${month.year}/${month.month}`, {
        target_revenue: parseFloat(form.target_revenue) || 0,
        target_orders:  parseInt(form.target_orders,10) || 0,
        notes:          form.notes,
      });
      toast.success(`Target saved for ${month.month_name}`);
      onSaved();
      onClose();
    } catch (e) {
      toast.error(e.response?.data?.detail || "Save failed");
    } finally { setSaving(false); }
  };

  return (
    <Modal title={`Set Target — ${month.month_name}`} onClose={onClose}>
      <div className="space-y-3">
        <FormGroup label="Revenue Target (ZAR)">
          <Input type="number" min="0" step="1000"
            value={form.target_revenue} onChange={e => setForm({ ...form, target_revenue: e.target.value })}
            placeholder="e.g. 500000" autoFocus />
        </FormGroup>
        <FormGroup label="Order Count Target">
          <Input type="number" min="0" step="1"
            value={form.target_orders} onChange={e => setForm({ ...form, target_orders: e.target.value })}
            placeholder="e.g. 50" />
        </FormGroup>
        <FormGroup label="Notes (optional)">
          <Input value={form.notes} onChange={e => setForm({ ...form, notes: e.target.value })}
            placeholder="e.g. Includes new product launch, seasonal uplift…" />
        </FormGroup>
      </div>
      <div className="flex justify-end gap-2 mt-5">
        <BtnSecondary onClick={onClose} disabled={saving}>Cancel</BtnSecondary>
        <BtnPrimary onClick={save} loading={saving}>Save Target</BtnPrimary>
      </div>
    </Modal>
  );
}

// ── Main view ──────────────────────────────────────────────────────────────────

export default function Targets() {
  const [months,  setMonths ] = useState([]);
  const [fyLabel, setFyLabel] = useState("");
  const [loading, setLoading] = useState(true);
  const [editing, setEditing] = useState(null);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const r = await api.get("/api/targets/");
      setMonths(r.data.months || []);
      setFyLabel(r.data.fy_label || "");
    } catch { toast.error("Failed to load targets"); }
    finally { setLoading(false); }
  }, []);

  useEffect(() => { load(); }, [load]);

  // Summary stats
  const past    = months.filter(m => !m.is_current && !m.is_future);
  const current = months.find(m => m.is_current);
  const monthsWithTargets = months.filter(m => m.target_revenue || m.target_orders);
  const monthsHit = past.filter(m =>
    (m.target_revenue ? (m.revenue_pct ?? 0) >= 100 : true) &&
    (m.target_orders  ? (m.orders_pct  ?? 0) >= 100 : true) &&
    (m.target_revenue || m.target_orders)
  );

  return (
    <div className="flex flex-col flex-1 overflow-hidden">
      <TopBar
        title="Monthly Targets"
        subtitle={fyLabel}
        onRefresh={load}
        actions={
          current && (
            <BtnPrimary onClick={() => setEditing(current)}>
              <Target size={14} />
              {current.target_revenue ? "Edit" : "Set"} {current.month_name?.split(" ")[0]} Target
            </BtnPrimary>
          )
        }
      />

      <main className="flex-1 overflow-y-auto p-6 bg-gray-50">
        {loading ? <LoadingState /> : (
          <div className="max-w-5xl mx-auto space-y-5">

            {/* Summary bar */}
            <div className="bg-white rounded-2xl border border-gray-100 p-4 flex flex-wrap gap-6">
              <div><p className="text-xs text-gray-400 mb-0.5">FY</p><p className="font-bold text-gray-900">{fyLabel}</p></div>
              <div><p className="text-xs text-gray-400 mb-0.5">Months with targets</p><p className="font-bold text-gray-900">{monthsWithTargets.length} / 12</p></div>
              {past.length > 0 && (
                <div>
                  <p className="text-xs text-gray-400 mb-0.5">Targets hit</p>
                  <p className={`font-bold ${monthsHit.length === past.filter(m => m.target_revenue || m.target_orders).length ? "text-green-600" : "text-amber-600"}`}>
                    {monthsHit.length} / {past.filter(m => m.target_revenue || m.target_orders).length}
                  </p>
                </div>
              )}
              {current && current.target_revenue && (
                <div>
                  <p className="text-xs text-gray-400 mb-0.5">This month ({current.month_name?.split(" ")[0]})</p>
                  <p className={`font-bold ${(current.revenue_pct ?? 0) >= 100 ? "text-green-600" : isOnTrack(current.revenue_pct, current.days_elapsed, current.days_in_month) ? "text-bassani-700" : "text-amber-600"}`}>
                    {current.revenue_pct ?? 0}% of target
                  </p>
                </div>
              )}
            </div>

            {/* 12-month grid */}
            <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-4 gap-4">
              {months.map(m => (
                <MonthCard key={`${m.year}-${m.month}`} month={m} onEdit={setEditing} />
              ))}
            </div>

            {/* Legend */}
            <div className="flex flex-wrap gap-4 text-[10px] text-gray-400 font-medium px-1">
              {[
                ["bg-green-500",    "Target hit (≥100%)"],
                ["bg-bassani-600",  "On track"],
                ["bg-amber-500",    "Behind target"],
                ["bg-gray-200",     "No target / future"],
              ].map(([cls, label]) => (
                <span key={label} className="flex items-center gap-1.5">
                  <span className={`w-3 h-2 rounded-full ${cls}`} />{label}
                </span>
              ))}
            </div>
          </div>
        )}
      </main>

      {editing && (
        <EditModal month={editing} onClose={() => setEditing(null)} onSaved={load} />
      )}
    </div>
  );
}
