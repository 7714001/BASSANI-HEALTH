// Manufacturing Orders monitor — public/big-screen board for the GACP
// manufacturing facility (Phase 23.3, redesigned 23.6 2026-08-23 onto the
// shared MonitorKit — light/dark theme (light default), fullscreen toggle,
// Bassani branding). Genuine difference from the other two boards: this
// board's data lives only in Odoo, so every poll makes a live Odoo call —
// see backend/routes/manufacturing_monitor_routes.py's file header for why.
import { useState, useEffect, useCallback } from "react";
import { useSearchParams } from "react-router-dom";
import api from "../api";
import {
  useMonitorTheme, THEME, pageContainerStyle, resolveHeaderColor, getTiers,
  fmtHours, fmtQty, fmtDueDate, AgeBadge, KpiCard, KpiSmall, Column,
  CardGroupBox, OrderGroupHeader, groupCardsByOrder, MonitorHeaderBar,
  MonitorLoadingScreen, MonitorInvalidTokenScreen, GlobalMonitorStyles,
} from "../components/MonitorKit";

const POLL_MS = 30_000;

// Columns are keyed to Odoo's own mrp.production state machine (done/cancel
// excluded server-side already) — same colors already established for MO
// state chips elsewhere in the app (Backorders.js, OrderPassport.js,
// SalesTickets.js) for visual consistency with every other MO chip in the
// portal, rather than inventing new column colors here.
const COLUMNS = [
  { key: "draft",     label: "Draft",       accent: "#94a3b8" },
  { key: "confirmed", label: "Confirmed",   accent: "#d97706" },
  { key: "progress",  label: "In Progress", accent: "#16a34a" },
  { key: "to_close",  label: "To Close",    accent: "#2563eb" },
];

function cardUrl(card) {
  if (card.sale_order_id) return `/orders/${encodeURIComponent(card.sale_order_id)}/passport`;
  return "/orders/backorders";
}

function MOCard({ card, now, theme, hideOrderLine }) {
  const t     = THEME[theme];
  const tiers = getTiers(theme);
  const tier  = tiers[card.age_tier] || tiers.ok;
  const href  = cardUrl(card);
  const due   = fmtDueDate(card.date_finished);

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
      {/* Product — the primary label on this board, since the question is
          "what do I make," not "who is it for" (inverted from the other
          two boards' customer-first card layout) */}
      <div>
        <span style={{ fontSize: 14, fontWeight: 700, color: t.textPrimary, lineHeight: 1.3 }}>
          {card.product_name || "—"}
        </span>
        <div style={{ fontSize: 11, color: t.textMuted, fontFamily: "monospace", marginTop: 2 }}>
          {card.mo_name}
        </div>
      </div>

      {/* Quantity readout */}
      <div style={{ display: "flex", alignItems: "baseline", gap: 6 }}>
        <span style={{ fontSize: 18, fontWeight: 800, color: t.textPrimary }}>{fmtQty(card.qty_remaining)}</span>
        <span style={{ fontSize: 11, color: t.textMuted }}>
          units remaining ({fmtQty(card.qty_producing)} / {fmtQty(card.qty_total)} produced)
        </span>
      </div>

      {/* Order / customer / ticket — hidden when a shared group header
          (OrderGroupHeader below) already shows it, so it isn't repeated */}
      {(!hideOrderLine || card.ticket) && (
        <div style={{ display: "flex", flexDirection: "column", gap: 2 }}>
          {!hideOrderLine && card.order_ref && (
            <span style={{ fontSize: 11, color: t.textSecondary }}>
              {card.order_ref}{card.customer_name ? ` · ${card.customer_name}` : ""}
            </span>
          )}
          {card.ticket && (
            <span style={{ fontSize: 10, color: t.brand }}>{card.ticket.ref}</span>
          )}
        </div>
      )}

      {/* Age badge + due date */}
      <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", gap: 8 }}>
        <AgeBadge card={card} now={now} theme={theme} />
        {due && <span style={{ fontSize: 10, color: t.textMuted }}>Due: {due}</span>}
      </div>
    </div>
  );
}

function CardGroup({ group, now, theme }) {
  if (group.cards.length === 1) {
    return <MOCard card={group.cards[0]} now={now} theme={theme} />;
  }
  const first = group.cards[0];
  return (
    <CardGroupBox theme={theme}>
      <OrderGroupHeader
        orderRef={first.order_ref}
        customerName={first.customer_name}
        count={group.cards.length}
        unitLabel="products"
        href={cardUrl(first)}
        theme={theme}
      />
      {group.cards.map(card => <MOCard key={card.id} card={card} now={now} theme={theme} hideOrderLine />)}
    </CardGroupBox>
  );
}

// ── Main component ────────────────────────────────────────────────────────────

export default function ManufacturingMonitor() {
  const [searchParams]              = useSearchParams();
  const token                       = searchParams.get("token") || "";
  const [theme, toggleTheme]        = useMonitorTheme();

  const [valid,       setValid     ] = useState(null);
  const [data,        setData      ] = useState(null);
  const [lastUpdated, setLastUpdated] = useState(null);
  const [now,         setNow       ] = useState(Date.now());
  const [connected,   setConnected ] = useState(true);

  useEffect(() => {
    const id = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(id);
  }, []);

  const fetchData = useCallback(async () => {
    try {
      const { data: d } = await api.get(`/api/manufacturing-monitor/data?token=${encodeURIComponent(token)}`);
      setData(d);
      setLastUpdated(new Date());
      setConnected(true);
    } catch {
      setConnected(false);
    }
  }, [token]);

  useEffect(() => {
    if (!token) { setValid(false); return; }
    api.get(`/api/manufacturing-monitor/validate?token=${encodeURIComponent(token)}`)
      .then(() => { setValid(true); fetchData(); })
      .catch(() => setValid(false));
  }, [token, fetchData]);

  // 30s poll — no WebSocket for this board, see file header comment
  useEffect(() => {
    if (!valid) return;
    const id = setInterval(fetchData, POLL_MS);
    return () => clearInterval(id);
  }, [valid, fetchData]);

  if (valid === false) {
    return <MonitorInvalidTokenScreen theme={theme} settingsHint="Generate a token in Settings → Monitor Displays" />;
  }
  if (valid === null || !data) {
    return <MonitorLoadingScreen theme={theme} message="Connecting to production feed…" />;
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
        title="Manufacturing Monitor · GACP Facility"
        lastUpdatedStr={lastUpdatedStr}
        connected={connected}
      />

      {/* ── KPI strip ──────────────────────────────────────────────────────── */}
      <div style={{ padding: "16px 20px 0", flexShrink: 0 }}>
        <div style={{ display: "grid", gridTemplateColumns: "repeat(4, 1fr)", gap: 12, marginBottom: 10 }}>
          <KpiCard theme={theme}
            label="Overdue"
            value={kpis.overdue}
            sub={kpis.overdue > 0 ? "Past the proposed deadline — act now" : "All MOs on track"}
            color="#dc2626"
            pulse={kpis.overdue > 0}
          />
          <KpiCard theme={theme}
            label="At Risk"
            value={kpis.at_risk}
            sub="Approaching deadline"
            color="#ea580c"
          />
          <KpiCard theme={theme}
            label="In Progress"
            value={kpis.in_progress}
            sub="Currently being produced"
            color="#16a34a"
          />
          <KpiCard theme={theme}
            label="To Close"
            value={kpis.to_close}
            sub="Nearly done, needs final confirmation"
            color="#2563eb"
          />
        </div>

        <div style={{ display: "grid", gridTemplateColumns: "repeat(6, 1fr)", gap: 10, marginBottom: 16 }}>
          <KpiSmall theme={theme} label="Draft"        value={kpis.draft}        />
          <KpiSmall theme={theme} label="Confirmed"    value={kpis.confirmed}    color="#d97706" />
          <KpiSmall theme={theme} label="In Progress"  value={kpis.in_progress}  color="#16a34a" />
          <KpiSmall theme={theme} label="To Close"     value={kpis.to_close}     color="#2563eb" />
          <KpiSmall theme={theme} label="Units Remaining" value={fmtQty(kpis.total_units_remaining)} />
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
          const groups = groupCardsByOrder(cards, c => c.sale_order_id || `mo-${c.id}`);
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
