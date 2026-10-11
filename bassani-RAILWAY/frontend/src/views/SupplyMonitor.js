// GMP Supply monitor (8.70e) — public TV board for the GMP facility at
// /supply-monitor?token=. Product-first: what La Farmacia needs from GMP and
// how many customer orders are waiting on it. Same data as the GMP Supply
// page (backend/routes/supply_monitor_routes.py), 30s poll, MonitorKit theme.
import { useState, useEffect, useCallback } from "react";
import { useSearchParams } from "react-router-dom";
import api from "../api";
import {
  useMonitorTheme, THEME, pageContainerStyle, resolveHeaderColor, getTiers,
  fmtHours, fmtQty, AgeBadge, KpiCard, KpiSmall, Column, MonitorHeaderBar,
  MonitorLoadingScreen, MonitorInvalidTokenScreen, GlobalMonitorStyles,
} from "../components/MonitorKit";

const POLL_MS = 30_000;

const COLUMNS = [
  { key: "needs_requesting",  label: "Needs Requesting",   accent: "#dc2626" },
  { key: "requested",         label: "Requested: Make / Book In", accent: "#d97706" },
  { key: "ready_to_dispatch", label: "Ready to Dispatch",  accent: "#0d9488" },
  { key: "in_transit",        label: "In Transit",         accent: "#2563eb" },
];

function SupplyCard({ card, now, theme }) {
  const t = THEME[theme];
  const tier = getTiers(theme)[card.age_tier] || getTiers(theme).ok;
  const qty = card.uncovered > 0 ? card.uncovered : card.still_needed;
  return (
    <div style={{
      background: t.surfaceAlt, border: `1px solid ${t.border}`, borderLeft: `4px solid ${tier.border}`,
      borderRadius: "0 12px 12px 0", padding: "12px 14px", display: "flex", flexDirection: "column", gap: 6,
    }}>
      <div style={{ fontSize: 14, fontWeight: 700, color: t.textPrimary, lineHeight: 1.25 }}>{card.product_name}</div>
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "baseline", gap: 8 }}>
        <span style={{ fontSize: 22, fontWeight: 800, color: t.brand }}>{fmtQty(qty)}</span>
        <span style={{ fontSize: 12, color: t.textMuted }}>
          {card.order_count} customer order{card.order_count !== 1 ? "s" : ""} waiting
        </span>
      </div>
      {card.orders?.length > 0 && (
        <div style={{ fontSize: 11, color: t.textMuted }}>{card.orders.join(" · ")}</div>
      )}
      <div><AgeBadge card={card} now={now} theme={theme} /></div>
    </div>
  );
}

export default function SupplyMonitor() {
  const [searchParams] = useSearchParams();
  const token = searchParams.get("token") || "";
  const [theme, toggleTheme] = useMonitorTheme();
  const [valid, setValid] = useState(null);
  const [data, setData] = useState(null);
  const [error, setError] = useState(null);
  const [lastUpdated, setLastUpdated] = useState(null);
  const [now, setNow] = useState(Date.now());
  const [connected, setConnected] = useState(true);

  useEffect(() => {
    const id = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(id);
  }, []);

  const fetchData = useCallback(async () => {
    try {
      const { data: d } = await api.get(`/api/supply-monitor/data?token=${encodeURIComponent(token)}`);
      setData(d); setError(null); setLastUpdated(new Date()); setConnected(true);
    } catch (e) {
      setConnected(false);
      if (e.response?.status === 409) setError(e.response.data.detail);
    }
  }, [token]);

  useEffect(() => {
    if (!token) { setValid(false); return; }
    api.get(`/api/supply-monitor/validate?token=${encodeURIComponent(token)}`)
      .then(r => { setValid(!!r.data.valid); if (r.data.valid) fetchData(); })
      .catch(() => setValid(false));
  }, [token, fetchData]);

  useEffect(() => {
    if (!valid) return;
    const id = setInterval(fetchData, POLL_MS);
    return () => clearInterval(id);
  }, [valid, fetchData]);

  if (valid === false) return <MonitorInvalidTokenScreen theme={theme} settingsHint="Generate a token in Settings → Monitor Displays" />;
  if (error) return <MonitorLoadingScreen theme={theme} message={error} />;
  if (valid === null || !data) return <MonitorLoadingScreen theme={theme} message="Connecting to supply feed…" />;

  const t = THEME[theme];
  const { kpis, columns } = data;
  const lastUpdatedStr = lastUpdated ? lastUpdated.toLocaleTimeString("en-ZA", { hour: "2-digit", minute: "2-digit", second: "2-digit" }) : "—";

  return (
    <div style={pageContainerStyle(theme)}>
      <GlobalMonitorStyles theme={theme} />
      <MonitorHeaderBar theme={theme} onToggleTheme={toggleTheme} title={`GMP Supply · ${data.supplier} to ${data.receiving}`}
        lastUpdatedStr={lastUpdatedStr} connected={connected} />
      <div style={{ padding: "16px 20px 0", flexShrink: 0 }}>
        <div style={{ display: "grid", gridTemplateColumns: "repeat(4, 1fr)", gap: 12, marginBottom: 10 }}>
          <KpiCard theme={theme} label="Customer Orders Waiting" value={kpis.orders_waiting} sub="Orders short of stock right now" color={t.brand} />
          <KpiCard theme={theme} label="Overdue" value={kpis.overdue} sub={kpis.overdue ? "Past the target time: chase these first" : "Nothing overdue"} color="#dc2626" pulse={kpis.overdue > 0} />
          <KpiCard theme={theme} label="Ready to Dispatch" value={kpis.ready_to_dispatch} sub="Products GMP can send now" color="#0d9488" />
          <KpiCard theme={theme} label="Oldest Waiting" value={fmtHours(kpis.oldest_hours)} sub="Longest a product has been short"
            color={kpis.oldest_hours > 72 ? "#dc2626" : kpis.oldest_hours > 24 ? "#ea580c" : t.brand} />
        </div>
        <div style={{ display: "grid", gridTemplateColumns: "repeat(3, 1fr)", gap: 10, marginBottom: 16 }}>
          <KpiSmall theme={theme} label="Products Short" value={kpis.products_short} />
          <KpiSmall theme={theme} label="Needs Requesting" value={kpis.needs_requesting} color="#dc2626" />
          <KpiSmall theme={theme} label="In Transit" value={kpis.in_transit} color="#2563eb" />
        </div>
      </div>
      <div style={{ flex: 1, display: "flex", gap: 10, padding: "0 20px 20px", overflow: "hidden", minHeight: 0 }}>
        {COLUMNS.map(cfg => {
          const cards = columns[cfg.key] || [];
          return (
            <Column key={cfg.key} config={cfg} count={cards.length} headerColor={resolveHeaderColor(cards, cfg.accent, theme)} theme={theme}>
              {cards.map(c => <SupplyCard key={c.product_id} card={c} now={now} theme={theme} />)}
            </Column>
          );
        })}
      </div>
    </div>
  );
}
