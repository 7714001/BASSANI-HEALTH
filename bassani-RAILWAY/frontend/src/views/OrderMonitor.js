// Operations Monitor — public/big-screen board for the full order pipeline
// (Phase 23.0/23.1, redesigned 23.6 2026-08-23 onto the shared MonitorKit —
// light/dark theme (light default), fullscreen toggle, Bassani branding, and
// cards grouped by order/SO within each column so a primary delivery and a
// re-queued backorder child sharing one order_id read as one order, not two
// anonymous cards. See CLAUDE.md's Phase 23.6 entry for the full rationale.
import { useState, useEffect, useCallback, useRef } from "react";
import { useSearchParams } from "react-router-dom";
import api from "../api";
import {
  useMonitorTheme, THEME, pageContainerStyle, resolveHeaderColor, getTiers,
  fmtR, fmtHours, AgeBadge, KpiCard, KpiSmall, Column, CardGroupBox,
  OrderGroupHeader, groupCardsByOrder, MonitorHeaderBar, MonitorLoadingScreen,
  MonitorInvalidTokenScreen, GlobalMonitorStyles,
} from "../components/MonitorKit";

const POLL_MS = 30_000;

const COLUMNS = [
  { key: "quotes",     label: "Open Quotes",       accent: "#6366f1" },
  { key: "deposit",    label: "Awaiting Deposit",  accent: "#eab308" },
  { key: "packing",    label: "Packing",           accent: "#8b5cf6" },
  { key: "qa",         label: "QA Review",         accent: "#06b6d4" },
  { key: "rp",         label: "RP Review",         accent: "#14b8a6" },
  { key: "collection", label: "Ready to Collect",  accent: "#f59e0b" },
];

function cardUrl(card) {
  if (card.so_ref) return `/orders/${encodeURIComponent(card.so_ref)}/passport`;
  return "/tickets/sales";
}

const STAGE_LABEL = {
  open:       { label: "Inquiry",          color: "#6366f1" },
  quote:      { label: "Quote sent",       color: "#8b5cf6" },
  sale_order: { label: "Awaiting packing", color: "#f59e0b" },
};

function OrderCard({ card, now, theme, hideOrderLine }) {
  const t          = THEME[theme];
  const tiers      = getTiers(theme);
  const tier       = tiers[card.age_tier] || tiers.ok;
  const isReseller = card.is_reseller && card.reseller_name;
  const isSample   = card.is_sample;
  const href       = cardUrl(card);
  const stageInfo  = card.type === "quote" ? STAGE_LABEL[card.status] : null;

  return (
    <div
      onClick={() => window.open(href, "_blank", "noopener,noreferrer")}
      style={{
        background: t.surfaceAlt,
        border: `1px solid ${t.border}`,
        borderLeft: `4px solid ${tier.border}`,
        borderRadius: "0 12px 12px 0",
        padding: "12px 14px",
        display: "flex",
        flexDirection: "column",
        gap: 8,
        transition: "background 0.2s",
        cursor: "pointer",
      }}
      onMouseEnter={e => e.currentTarget.style.background = t.hoverBg}
      onMouseLeave={e => e.currentTarget.style.background = t.surfaceAlt}
    >
      {/* Customer + tags */}
      <div style={{ display: "flex", alignItems: "flex-start", justifyContent: "space-between", gap: 8 }}>
        <span style={{ fontSize: 14, fontWeight: 700, color: t.textPrimary, lineHeight: 1.3 }}>
          {card.customer_name || "—"}
        </span>
        <div style={{ display: "flex", gap: 4, flexShrink: 0, flexWrap: "wrap", justifyContent: "flex-end" }}>
          {card.has_backorder && <span style={{ fontSize: 9, fontWeight: 700, padding: "2px 6px", borderRadius: 4, background: "rgba(220,38,38,0.15)", color: "#dc2626" }}>BACKORDER</span>}
          {card.has_mo_pending && <span style={{ fontSize: 9, fontWeight: 700, padding: "2px 6px", borderRadius: 4, background: "rgba(37,99,235,0.15)", color: "#2563eb" }}>IN PRODUCTION</span>}
          {isSample   && <span style={{ fontSize: 9, fontWeight: 700, padding: "2px 6px", borderRadius: 4, background: "rgba(99,102,241,0.15)", color: "#4f46e5" }}>SAMPLE</span>}
          {isReseller && <span style={{ fontSize: 9, fontWeight: 700, padding: "2px 6px", borderRadius: 4, background: t.brandSoft, color: t.brand }}>RESELLER</span>}
          {stageInfo  && <span style={{ fontSize: 9, fontWeight: 700, padding: "2px 6px", borderRadius: 4, background: `${stageInfo.color}22`, color: stageInfo.color }}>{stageInfo.label}</span>}
        </div>
      </div>

      {/* SO ref — hidden when a shared group header already shows it */}
      {!hideOrderLine && card.so_ref && (
        <span style={{ fontFamily: "monospace", fontSize: 11, color: t.textMuted, fontWeight: 600 }}>
          {card.so_ref}
        </span>
      )}

      {/* Assigned to */}
      <div style={{ display: "flex", alignItems: "center", gap: 5 }}>
        <span style={{ fontSize: 10, color: t.textMuted }}>
          {card.assigned_name
            ? `Assigned: ${card.assigned_name}`
            : <span style={{ fontStyle: "italic" }}>Unassigned</span>
          }
        </span>
        {card.packer_name && (
          <>
            <span style={{ color: t.textFaint, fontSize: 10 }}>·</span>
            <span style={{ fontSize: 10, color: t.textMuted }}>Packer: {card.packer_name}</span>
          </>
        )}
      </div>

      <AgeBadge card={card} now={now} theme={theme} />

      {/* Footer: units + reseller + value */}
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", borderTop: `1px solid ${t.divider}`, paddingTop: 8 }}>
        <span style={{ fontSize: 11, color: t.textMuted }}>
          {card.total_units ? `${card.total_units} units` : ""}
          {isReseller && card.reseller_name ? ` · ${card.reseller_name}` : ""}
        </span>
        {card.order_value != null && (
          <span style={{ fontSize: 12, fontWeight: 700, color: t.textSecondary }}>
            {fmtR(card.order_value)}
          </span>
        )}
      </div>
    </div>
  );
}

function CardGroup({ group, now, theme }) {
  if (group.cards.length === 1) {
    return <OrderCard card={group.cards[0]} now={now} theme={theme} />;
  }
  const first = group.cards[0];
  return (
    <CardGroupBox theme={theme}>
      <OrderGroupHeader
        orderRef={first.so_ref}
        customerName={first.customer_name}
        count={group.cards.length}
        href={cardUrl(first)}
        theme={theme}
      />
      {group.cards.map(card => <OrderCard key={card.id} card={card} now={now} theme={theme} hideOrderLine />)}
    </CardGroupBox>
  );
}

// ── Main component ────────────────────────────────────────────────────────────

export default function OrderMonitor() {
  const [searchParams]              = useSearchParams();
  const token                       = searchParams.get("token") || "";
  const [theme, toggleTheme]        = useMonitorTheme();

  const [valid,       setValid     ] = useState(null);   // null=checking, true, false
  const [data,        setData      ] = useState(null);
  const [lastUpdated, setLastUpdated] = useState(null);
  const [now,         setNow       ] = useState(Date.now());
  const [connected,   setConnected ] = useState(true);

  // 1-second tick for live countdowns
  useEffect(() => {
    const id = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(id);
  }, []);

  const fetchData = useCallback(async () => {
    try {
      const { data: d } = await api.get(`/api/monitor/data?token=${encodeURIComponent(token)}`);
      setData(d);
      setLastUpdated(new Date());
      setConnected(true);
    } catch {
      setConnected(false);
    }
  }, [token]);

  // Validate token once on mount
  useEffect(() => {
    if (!token) { setValid(false); return; }
    api.get(`/api/monitor/validate?token=${encodeURIComponent(token)}`)
      .then(() => { setValid(true); fetchData(); })
      .catch(() => setValid(false));
  }, [token, fetchData]);

  // Poll every 30 s as a fallback heartbeat (covers reconnects / network blips)
  useEffect(() => {
    if (!valid) return;
    const id = setInterval(fetchData, POLL_MS);
    return () => clearInterval(id);
  }, [valid, fetchData]);

  // WebSocket — push refresh from server on any pipeline state change
  const wsRef        = useRef(null);
  const reconnectRef = useRef(null);
  useEffect(() => {
    if (!valid || !token) return;
    let delay = 1000;
    const connect = () => {
      const protocol = window.location.protocol === "https:" ? "wss" : "ws";
      const ws = new WebSocket(`${protocol}://${window.location.host}/api/monitor/ws?token=${encodeURIComponent(token)}`);
      wsRef.current = ws;
      ws.onopen  = () => { delay = 1000; };
      ws.onmessage = (e) => {
        try {
          const msg = JSON.parse(e.data);
          if (msg.type === "refresh") fetchData();
        } catch {}
      };
      ws.onclose = () => {
        reconnectRef.current = setTimeout(connect, delay);
        delay = Math.min(delay * 2, 30_000);
      };
      ws.onerror = () => ws.close();
    };
    connect();
    return () => {
      clearTimeout(reconnectRef.current);
      wsRef.current?.close();
    };
  }, [valid, token, fetchData]);

  if (valid === false) {
    return <MonitorInvalidTokenScreen theme={theme} settingsHint="Generate a token in Settings → Monitor Displays" />;
  }
  if (valid === null || !data) {
    return <MonitorLoadingScreen theme={theme} message="Connecting to operations feed…" />;
  }

  const t = THEME[theme];
  const { kpis, columns } = data;
  const lastUpdatedStr = lastUpdated
    ? lastUpdated.toLocaleTimeString("en-ZA", { hour: "2-digit", minute: "2-digit", second: "2-digit" })
    : "—";

  return (
    <div style={pageContainerStyle(theme)}>
      <GlobalMonitorStyles theme={theme} />

      <MonitorHeaderBar
        theme={theme}
        onToggleTheme={toggleTheme}
        title="Operations Monitor"
        lastUpdatedStr={lastUpdatedStr}
        connected={connected}
      />

      {/* ── KPI strip ──────────────────────────────────────────────────────── */}
      <div style={{ padding: "16px 20px 0", flexShrink: 0 }}>
        <div style={{ display: "grid", gridTemplateColumns: "repeat(4, 1fr)", gap: 12, marginBottom: 10 }}>
          <KpiCard theme={theme}
            label="Overdue"
            value={kpis.overdue}
            sub={kpis.overdue > 0 ? "Orders past deadline — act now" : "All orders on time"}
            color="#dc2626"
            pulse={kpis.overdue > 0}
          />
          <KpiCard theme={theme}
            label="At Risk"
            value={kpis.at_risk}
            sub="Approaching 72h deadline"
            color="#ea580c"
          />
          <KpiCard theme={theme}
            label="Compliance Hold"
            value={kpis.compliance_hold}
            sub="Waiting on QA or RP sign-off"
            color="#8b5cf6"
            pulse={kpis.compliance_hold > 3}
          />
          <KpiCard theme={theme}
            label="Completed Today"
            value={kpis.completed_today}
            sub="Orders fulfilled today"
            color={t.brand}
          />
        </div>

        <div style={{ display: "grid", gridTemplateColumns: "repeat(8, 1fr)", gap: 10, marginBottom: 16 }}>
          <KpiSmall theme={theme} label="Open Inquiries"      value={kpis.open_quotes}         color="#6366f1" />
          <KpiSmall theme={theme} label="Awaiting Deposit"    value={kpis.awaiting_deposit}    color={kpis.awaiting_deposit > 0 ? "#ca8a04" : undefined} />
          <KpiSmall theme={theme} label="In Packing"          value={kpis.in_packing}          color="#8b5cf6" />
          <KpiSmall theme={theme} label="QA Pending"          value={kpis.qa_pending}          color={kpis.qa_pending  > 0 ? "#d97706" : undefined} />
          <KpiSmall theme={theme} label="RP Pending"          value={kpis.rp_pending}          color={kpis.rp_pending  > 0 ? "#d97706" : undefined} />
          <KpiSmall theme={theme} label="Awaiting Collection" value={kpis.awaiting_collection} color="#14b8a6" />
          <KpiSmall theme={theme} label="Backorders"          value={kpis.backorders}          color={kpis.backorders > 0 ? "#dc2626" : undefined} />
          <KpiSmall theme={theme} label="In Production"       value={kpis.in_production}       color={kpis.in_production > 0 ? "#2563eb" : undefined} />
        </div>
        <div style={{ display: "grid", gridTemplateColumns: "repeat(4, 1fr)", gap: 10, marginBottom: 16 }}>
          <KpiSmall theme={theme}
            label="Oldest Active"
            value={fmtHours(kpis.oldest_hours)}
            color={
              !kpis.oldest_hours ? undefined
              : kpis.oldest_hours > 72 ? "#dc2626"
              : kpis.oldest_hours > 48 ? "#ea580c"
              : t.brand
            }
          />
        </div>
      </div>

      {/* ── Kanban columns ─────────────────────────────────────────────────── */}
      <div style={{ flex: 1, display: "flex", gap: 10, padding: "0 20px 20px", overflow: "hidden", minHeight: 0 }}>
        {COLUMNS.map(cfg => {
          const cards = columns[cfg.key] || [];
          const groups = groupCardsByOrder(cards, c => c.so_ref || `x-${c.id}`);
          return (
            <Column
              key={cfg.key}
              config={cfg}
              count={cards.length}
              headerColor={resolveHeaderColor(cards, cfg.accent, theme)}
              theme={theme}
            >
              {groups.map(group => <CardGroup key={group.key} group={group} now={now} theme={theme} />)}
            </Column>
          );
        })}
      </div>
    </div>
  );
}
