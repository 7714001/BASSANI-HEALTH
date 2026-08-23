// Onboarding monitor — public/big-screen board for the customer onboarding
// pipeline (companion to OrderMonitor.js, redesigned 23.6 2026-08-23 onto
// the shared MonitorKit — light/dark theme (light default), fullscreen
// toggle, Bassani branding). Deliberately no WebSocket here (2026-08-21) —
// an application's stage doesn't change fast enough to need live push; see
// backend/routes/onboarding_monitor_routes.py's file header for why.
// No order/SO grouping on this board (unlike Operations/Manufacturing) —
// this pipeline is company/application-focused, not order-focused.
import { useState, useEffect, useCallback } from "react";
import { useSearchParams } from "react-router-dom";
import api from "../api";
import {
  useMonitorTheme, THEME, pageContainerStyle, resolveHeaderColor, getTiers,
  fmtHours, AgeBadge, KpiCard, KpiSmall, Column, MonitorHeaderBar,
  MonitorLoadingScreen, MonitorInvalidTokenScreen, GlobalMonitorStyles,
} from "../components/MonitorKit";

const POLL_MS = 30_000;

// "Ready to Finish" merges what were two separate columns (Ready to Approve /
// Welcome Pack Pending) into one (2026-08-22) — now that approval and the
// welcome pack send are a single button in the normal case (8.55), a card
// sitting here is just "one click away from done" either way. A card that's
// specifically the retry case (approved, but the pack send failed) still
// gets its own RETRY badge on the card itself, so that distinct, more
// urgent situation doesn't disappear into the general queue.
// "Awaiting Docs" (reseller-inbox-initiated applications) is deliberately
// not a column here (2026-08-22, confirmed with the product owner) — that
// intake path isn't part of the live process, customer self-service via
// /apply is the only way an application is created, so the column would
// always read empty. The backend still tracks the underlying stage/data,
// just excludes it from the board rather than showing a dead column.
const COLUMNS = [
  { key: "pending_review",     label: "Pending Review",     accent: "#6366f1" },
  { key: "docs_generated",     label: "Docs Generated",     accent: "#8b5cf6" },
  { key: "awaiting_signature", label: "Awaiting Signature", accent: "#06b6d4" },
  { key: "countersigning",     label: "Countersigning",     accent: "#14b8a6" },
  { key: "ready_to_finish",    label: "Ready to Finish",    accent: "#16a34a" },
];

const REG_TYPE_LABEL = {
  individual: { label: "INDIVIDUAL", color: "#d97706" },
};

function ApplicationCard({ card, now, theme }) {
  const t          = THEME[theme];
  const tiers      = getTiers(theme);
  const tier       = tiers[card.age_tier] || tiers.ok;
  const isReseller = card.is_reseller && card.reseller_name;
  const regInfo    = REG_TYPE_LABEL[card.registration_type];
  const isInbox    = card.source === "inbox";
  const href       = `/applications/${encodeURIComponent(card.id)}`;

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
      {/* Company + tags */}
      <div style={{ display: "flex", alignItems: "flex-start", justifyContent: "space-between", gap: 8 }}>
        <span style={{ fontSize: 14, fontWeight: 700, color: t.textPrimary, lineHeight: 1.3 }}>
          {card.company_name || "—"}
        </span>
        <div style={{ display: "flex", gap: 4, flexShrink: 0, flexWrap: "wrap", justifyContent: "flex-end" }}>
          {card.needs_retry && <span style={{ fontSize: 9, fontWeight: 700, padding: "2px 6px", borderRadius: 4, background: "rgba(234,88,12,0.18)", color: "#c2410c", animation: "bh-pulse 2s ease-in-out infinite" }}>RETRY: WELCOME PACK</span>}
          {isReseller && <span style={{ fontSize: 9, fontWeight: 700, padding: "2px 6px", borderRadius: 4, background: t.brandSoft, color: t.brand }}>RESELLER</span>}
          {regInfo    && <span style={{ fontSize: 9, fontWeight: 700, padding: "2px 6px", borderRadius: 4, background: `${regInfo.color}22`, color: regInfo.color }}>{regInfo.label}</span>}
          {isInbox    && <span style={{ fontSize: 9, fontWeight: 700, padding: "2px 6px", borderRadius: 4, background: "rgba(99,102,241,0.15)", color: "#4f46e5" }}>INBOX</span>}
        </div>
      </div>

      {card.contact_name && (
        <span style={{ fontSize: 11, color: t.textMuted }}>{card.contact_name}</span>
      )}

      {/* Assigned to */}
      <div style={{ display: "flex", alignItems: "center", gap: 5 }}>
        <span style={{ fontSize: 10, color: t.textMuted }}>
          {card.assigned_name
            ? `Assigned: ${card.assigned_name}`
            : <span style={{ fontStyle: "italic" }}>Unassigned</span>
          }
        </span>
      </div>

      <AgeBadge card={card} now={now} theme={theme} />

      {/* Footer: reseller name (if not already implied by the badge alone) */}
      {isReseller && (
        <div style={{ display: "flex", justifyContent: "flex-end", borderTop: `1px solid ${t.divider}`, paddingTop: 8 }}>
          <span style={{ fontSize: 11, color: t.textMuted }}>{card.reseller_name}</span>
        </div>
      )}
    </div>
  );
}

// ── Main component ────────────────────────────────────────────────────────────

export default function OnboardingMonitor() {
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
      const { data: d } = await api.get(`/api/onboarding-monitor/data?token=${encodeURIComponent(token)}`);
      setData(d);
      setLastUpdated(new Date());
      setConnected(true);
    } catch {
      setConnected(false);
    }
  }, [token]);

  useEffect(() => {
    if (!token) { setValid(false); return; }
    api.get(`/api/onboarding-monitor/validate?token=${encodeURIComponent(token)}`)
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
    return <MonitorInvalidTokenScreen theme={theme} settingsHint="Generate a token in Settings → Onboarding Monitor Display" />;
  }
  if (valid === null || !data) {
    return <MonitorLoadingScreen theme={theme} message="Connecting to onboarding feed…" />;
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
        title="Onboarding Monitor"
        lastUpdatedStr={lastUpdatedStr}
        connected={connected}
      />

      {/* ── KPI strip ──────────────────────────────────────────────────────── */}
      <div style={{ padding: "16px 20px 0", flexShrink: 0 }}>
        <div style={{ display: "grid", gridTemplateColumns: "repeat(4, 1fr)", gap: 12, marginBottom: 10 }}>
          <KpiCard theme={theme}
            label="Overdue"
            value={kpis.overdue}
            sub={kpis.overdue > 0 ? "Applications past deadline — act now" : "All applications on time"}
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
            label="Awaiting Signing Authority"
            value={kpis.awaiting_signing_authority}
            sub="Waiting on a Bassani countersignature"
            color="#8b5cf6"
            pulse={kpis.awaiting_signing_authority > 3}
          />
          <KpiCard theme={theme}
            label="Completed Today"
            value={kpis.completed_today}
            sub="Profile created + welcome pack sent"
            color={t.brand}
          />
        </div>

        {/* "Needs Retry" is a sub-count within Ready to Finish (the 8.55
            welcome-pack-send failure case), not its own board column. */}
        <div style={{ display: "grid", gridTemplateColumns: "repeat(7, 1fr)", gap: 10, marginBottom: 16 }}>
          <KpiSmall theme={theme} label="Pending Review"     value={kpis.pending_review}     color="#6366f1" />
          <KpiSmall theme={theme} label="Docs Generated"     value={kpis.docs_generated}     color="#8b5cf6" />
          <KpiSmall theme={theme} label="Awaiting Signature" value={kpis.awaiting_signature} color="#0891b2" />
          <KpiSmall theme={theme} label="Countersigning"     value={kpis.countersigning}     color={kpis.countersigning > 0 ? "#d97706" : undefined} />
          <KpiSmall theme={theme} label="Ready to Finish"    value={kpis.ready_to_finish}    color="#16a34a" />
          <KpiSmall theme={theme} label="Needs Retry"        value={kpis.needs_retry}        color={kpis.needs_retry > 0 ? "#ea580c" : undefined} />
          <KpiSmall theme={theme}
            label="Oldest Active"
            value={fmtHours(kpis.oldest_hours)}
            color={
              !kpis.oldest_hours ? undefined
              : kpis.oldest_hours > 48 ? "#dc2626"
              : kpis.oldest_hours > 24 ? "#ea580c"
              : t.brand
            }
          />
        </div>
      </div>

      {/* ── Kanban columns ─────────────────────────────────────────────────── */}
      <div style={{ flex: 1, display: "flex", gap: 10, padding: "0 20px 20px", overflow: "hidden", minHeight: 0 }}>
        {COLUMNS.map(cfg => {
          const cards = columns[cfg.key] || [];
          return (
            <Column
              key={cfg.key}
              config={cfg}
              count={cards.length}
              headerColor={resolveHeaderColor(cards, cfg.accent, theme)}
              theme={theme}
            >
              {cards.map(card => <ApplicationCard key={card.id} card={card} now={now} theme={theme} />)}
            </Column>
          );
        })}
      </div>
    </div>
  );
}
