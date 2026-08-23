// Manufacturing Orders monitor — public/big-screen board for the GACP
// manufacturing facility (Phase 23.3, redesigned 23.6 2026-08-23 onto the
// shared MonitorKit — light/dark theme (light default), fullscreen toggle,
// Bassani branding). Genuine difference from the other two boards: this
// board's data lives only in Odoo, so every poll makes a live Odoo call —
// see backend/routes/manufacturing_monitor_routes.py's file header for why.
import { useState, useEffect, useCallback, useMemo } from "react";
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

// Every group shows its order/customer heading, even a single-product order
// (2026-08-23) — previously only groups with more than one product got the
// header at all, so a single-item order's card carried no order/customer
// context unless you read the smaller inline order_ref line on the card
// itself.
function CardGroup({ group, now, theme }) {
  const first = group.cards[0];
  return (
    <CardGroupBox theme={theme}>
      <OrderGroupHeader
        orderRef={first.order_ref}
        customerName={first.customer_name}
        count={group.cards.length}
        unitLabel={group.cards.length === 1 ? "product" : "products"}
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

  // Order-level rollups, computed client-side from the already-fetched flat
  // per-column card lists (2026-08-23) — this board's headline KPIs were
  // entirely per-MO (individual product), which tells production how busy
  // the floor is but not which ORDER needs chasing: a single overdue
  // product buried inside a 5-product order never surfaced as "this order
  // is at risk." An order is overdue/at-risk if ANY of its products is —
  // the worst product on the order determines whether the order itself
  // needs chasing, mirroring how a customer experiences it (they don't
  // care that 4 of 5 items are ready if the 5th is late). No backend
  // change needed — every card already carries `sale_order_id`/`age_tier`.
  const allCards = useMemo(() => {
    if (!data) return [];
    return COLUMNS.flatMap(cfg => data.columns[cfg.key] || []);
  }, [data]);

  const orderRollups = useMemo(() => {
    const groups = groupCardsByOrder(allCards, c => c.sale_order_id || `mo-${c.id}`);
    let ordersOverdue = 0, ordersAtRisk = 0;
    groups.forEach(g => {
      const tiers = new Set(g.cards.map(c => c.age_tier));
      if (tiers.has("overdue")) ordersOverdue++;
      else if (tiers.has("urgent")) ordersAtRisk++;
    });
    return { ordersAffected: groups.length, ordersOverdue, ordersAtRisk };
  }, [allCards]);

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
      {/* Row 1 is order-focused (2026-08-23) — the headline numbers answer
          "which orders need chasing," not "how many individual products are
          in each state." Row 2 keeps the per-product/MO breakdown as a
          secondary signal, still useful for the production floor's own
          workload view. */}
      <div style={{ padding: "16px 20px 0", flexShrink: 0 }}>
        <div style={{ display: "grid", gridTemplateColumns: "repeat(4, 1fr)", gap: 12, marginBottom: 10 }}>
          <KpiCard theme={theme}
            label="Orders Overdue"
            value={orderRollups.ordersOverdue}
            sub={orderRollups.ordersOverdue > 0 ? "At least one product past deadline — chase these first" : "No orders overdue"}
            color="#dc2626"
            pulse={orderRollups.ordersOverdue > 0}
          />
          <KpiCard theme={theme}
            label="Orders At Risk"
            value={orderRollups.ordersAtRisk}
            sub="Approaching deadline on at least one product"
            color="#ea580c"
          />
          <KpiCard theme={theme}
            label="Orders Affected"
            value={orderRollups.ordersAffected}
            sub="Distinct orders with open production right now"
            color={t.brand}
          />
          <KpiCard theme={theme}
            label="Oldest Order Waiting"
            value={fmtHours(kpis.oldest_hours)}
            sub="Longest any order has been waiting on production"
            color={
              !kpis.oldest_hours ? undefined
              : kpis.oldest_hours > 72 ? "#dc2626"
              : kpis.oldest_hours > 48 ? "#ea580c"
              : t.brand
            }
          />
        </div>

        <div style={{ display: "grid", gridTemplateColumns: "repeat(5, 1fr)", gap: 10, marginBottom: 16 }}>
          <KpiSmall theme={theme} label="Draft"        value={kpis.draft}        />
          <KpiSmall theme={theme} label="Confirmed"    value={kpis.confirmed}    color="#d97706" />
          <KpiSmall theme={theme} label="In Progress"  value={kpis.in_progress}  color="#16a34a" />
          <KpiSmall theme={theme} label="To Close"     value={kpis.to_close}     color="#2563eb" />
          <KpiSmall theme={theme} label="Units Remaining" value={fmtQty(kpis.total_units_remaining)} />
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
