// Onboarding monitor — public/big-screen board for the customer onboarding
// pipeline (companion to OrderMonitor.js, same architecture: URL-token-only
// access, no login, 30s poll). Deliberately no WebSocket here (2026-08-21) —
// an application's stage doesn't change fast enough to need live push; see
// backend/routes/onboarding_monitor_routes.py's file header for why.
import { useState, useEffect, useCallback } from "react";
import { useSearchParams } from "react-router-dom";
import api from "../api";

// ── Constants ─────────────────────────────────────────────────────────────────

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
  { key: "pending_review",     label: "Pending Review",   accent: "#6366f1" },
  { key: "docs_generated",     label: "Docs Generated",   accent: "#8b5cf6" },
  { key: "awaiting_signature", label: "Awaiting Signature", accent: "#06b6d4" },
  { key: "countersigning",     label: "Countersigning",   accent: "#14b8a6" },
  { key: "ready_to_finish",    label: "Ready to Finish",  accent: "#22c55e" },
];

const TIER = {
  ok:      { border: "#22c55e", bg: "rgba(34,197,94,0.08)",   text: "#4ade80",  dot: "#22c55e",  label: "On track"  },
  warning: { border: "#fbbf24", bg: "rgba(251,191,36,0.08)",  text: "#fcd34d",  dot: "#fbbf24",  label: "Attention" },
  urgent:  { border: "#f97316", bg: "rgba(249,115,22,0.08)",  text: "#fb923c",  dot: "#f97316",  label: "Urgent"    },
  overdue: { border: "#ef4444", bg: "rgba(239,68,68,0.08)",   text: "#f87171",  dot: "#ef4444",  label: "OVERDUE"   },
};

// ── Formatters (mirrors OrderMonitor.js) ────────────────────────────────────────

function fmtHours(h) {
  if (h === null || h === undefined) return "—";
  const hrs  = Math.floor(h);
  const mins = Math.round((h - hrs) * 60);
  if (hrs === 0) return `${mins}m`;
  return `${hrs}h ${mins}m`;
}

function countdown(clockStart, deadlineHours, now) {
  if (!clockStart) return null;
  const start      = new Date(clockStart).getTime();
  const deadlineMs = start + deadlineHours * 3_600_000;
  const remainMs   = deadlineMs - now;
  const abs        = Math.abs(remainMs);
  const h          = Math.floor(abs / 3_600_000);
  const m          = Math.floor((abs % 3_600_000) / 60_000);
  const s          = Math.floor((abs % 60_000) / 1_000);
  const isOver     = remainMs < 0;
  return { isOver, h, m, s };
}

// ── Sub-components (KpiCard/KpiSmall/AgeBadge/Column shells identical to
// OrderMonitor.js — kept as a second copy rather than extracted into a
// shared file, matching this codebase's existing preference for parallel
// per-feature files over a shared abstraction two call sites don't yet
// justify) ───────────────────────────────────────────────────────────────────

function KpiCard({ label, value, sub, color, pulse }) {
  return (
    <div style={{
      background: "rgba(255,255,255,0.04)",
      border: `1px solid ${color}33`,
      borderRadius: 16,
      padding: "18px 22px",
      display: "flex",
      flexDirection: "column",
      gap: 4,
      position: "relative",
      overflow: "hidden",
    }}>
      <div style={{ width: 3, position: "absolute", left: 0, top: 0, bottom: 0, background: color, borderRadius: "4px 0 0 4px" }} />
      <span style={{ fontSize: 11, fontWeight: 600, letterSpacing: "0.08em", color: "#64748b", textTransform: "uppercase" }}>{label}</span>
      <span style={{
        fontSize: 36,
        fontWeight: 800,
        color,
        lineHeight: 1,
        animation: pulse ? "pulse 2s ease-in-out infinite" : "none",
      }}>{value ?? "—"}</span>
      {sub && <span style={{ fontSize: 12, color: "#475569", marginTop: 2 }}>{sub}</span>}
    </div>
  );
}

function KpiSmall({ label, value, color = "#94a3b8" }) {
  return (
    <div style={{
      background: "rgba(255,255,255,0.03)",
      border: "1px solid rgba(255,255,255,0.06)",
      borderRadius: 12,
      padding: "12px 16px",
      display: "flex",
      flexDirection: "column",
      gap: 3,
    }}>
      <span style={{ fontSize: 10, fontWeight: 600, letterSpacing: "0.08em", color: "#475569", textTransform: "uppercase" }}>{label}</span>
      <span style={{ fontSize: 22, fontWeight: 700, color, lineHeight: 1 }}>{value ?? "—"}</span>
    </div>
  );
}

function AgeBadge({ card, now }) {
  const tier = TIER[card.age_tier] || TIER.ok;
  const cd   = countdown(card.clock_start, card.deadline_hours, now);
  if (!cd) return null;
  const { isOver, h, m, s } = cd;
  const label = isOver
    ? `+${h}h ${m}m overdue`
    : h > 0 ? `${h}h ${m}m left`
    : `${m}m ${s}s left`;

  return (
    <span style={{
      display: "inline-flex", alignItems: "center", gap: 5,
      padding: "3px 8px", borderRadius: 20,
      background: tier.bg, color: tier.text,
      fontSize: 11, fontWeight: 700,
      animation: card.age_tier === "overdue" ? "pulse 1.5s ease-in-out infinite" : "none",
    }}>
      <span style={{ width: 6, height: 6, borderRadius: "50%", background: tier.dot, flexShrink: 0 }} />
      {label}
    </span>
  );
}

const REG_TYPE_LABEL = {
  individual: { label: "INDIVIDUAL", color: "#f59e0b" },
};

function ApplicationCard({ card, now }) {
  const tier       = TIER[card.age_tier] || TIER.ok;
  const isReseller = card.is_reseller && card.reseller_name;
  const regInfo    = REG_TYPE_LABEL[card.registration_type];
  const isInbox    = card.source === "inbox";
  const href       = `/applications/${encodeURIComponent(card.id)}`;

  return (
    <div
      onClick={() => window.open(href, "_blank", "noopener,noreferrer")}
      style={{
        background: "rgba(255,255,255,0.04)",
        border: "1px solid rgba(255,255,255,0.07)",
        borderLeft: `4px solid ${tier.border}`,
        borderRadius: "0 12px 12px 0",
        padding: "12px 14px",
        display: "flex",
        flexDirection: "column",
        gap: 8,
        transition: "background 0.2s",
        cursor: "pointer",
      }}
      onMouseEnter={e => e.currentTarget.style.background = "rgba(255,255,255,0.07)"}
      onMouseLeave={e => e.currentTarget.style.background = "rgba(255,255,255,0.04)"}
    >
      {/* Company + tags */}
      <div style={{ display: "flex", alignItems: "flex-start", justifyContent: "space-between", gap: 8 }}>
        <span style={{ fontSize: 14, fontWeight: 700, color: "#f1f5f9", lineHeight: 1.3 }}>
          {card.company_name || "—"}
        </span>
        <div style={{ display: "flex", gap: 4, flexShrink: 0, flexWrap: "wrap", justifyContent: "flex-end" }}>
          {card.needs_retry && <span style={{ fontSize: 9, fontWeight: 700, padding: "2px 6px", borderRadius: 4, background: "rgba(249,115,22,0.25)", color: "#fdba74", animation: "pulse 2s ease-in-out infinite" }}>RETRY: WELCOME PACK</span>}
          {isReseller && <span style={{ fontSize: 9, fontWeight: 700, padding: "2px 6px", borderRadius: 4, background: "rgba(20,184,166,0.2)", color: "#5eead4" }}>RESELLER</span>}
          {regInfo    && <span style={{ fontSize: 9, fontWeight: 700, padding: "2px 6px", borderRadius: 4, background: `${regInfo.color}22`, color: regInfo.color }}>{regInfo.label}</span>}
          {isInbox    && <span style={{ fontSize: 9, fontWeight: 700, padding: "2px 6px", borderRadius: 4, background: "rgba(99,102,241,0.2)", color: "#a5b4fc" }}>INBOX</span>}
        </div>
      </div>

      {card.contact_name && (
        <span style={{ fontSize: 11, color: "#64748b" }}>{card.contact_name}</span>
      )}

      {/* Assigned to */}
      <div style={{ display: "flex", alignItems: "center", gap: 5 }}>
        <span style={{ fontSize: 10, color: "#475569" }}>
          {card.assigned_name
            ? `Assigned: ${card.assigned_name}`
            : <span style={{ color: "#334155", fontStyle: "italic" }}>Unassigned</span>
          }
        </span>
      </div>

      {/* Age badge */}
      <AgeBadge card={card} now={now} />

      {/* Footer: reseller name (if not already implied by the badge alone) */}
      {isReseller && (
        <div style={{ display: "flex", justifyContent: "flex-end", borderTop: "1px solid rgba(255,255,255,0.05)", paddingTop: 8 }}>
          <span style={{ fontSize: 11, color: "#475569" }}>{card.reseller_name}</span>
        </div>
      )}
    </div>
  );
}

function Column({ config, cards, now }) {
  const count = cards.length;
  const hasOverdue = cards.some(c => c.age_tier === "overdue");
  const hasUrgent  = cards.some(c => c.age_tier === "urgent");
  const headerColor = hasOverdue ? "#ef4444" : hasUrgent ? "#f97316" : config.accent;

  return (
    <div style={{
      display: "flex",
      flexDirection: "column",
      minWidth: 0,
      flex: 1,
      background: "rgba(255,255,255,0.02)",
      border: "1px solid rgba(255,255,255,0.05)",
      borderRadius: 16,
      overflow: "hidden",
    }}>
      <div style={{
        padding: "14px 16px",
        borderBottom: "1px solid rgba(255,255,255,0.06)",
        display: "flex",
        alignItems: "center",
        justifyContent: "space-between",
        background: `linear-gradient(135deg, ${headerColor}18 0%, transparent 100%)`,
        flexShrink: 0,
      }}>
        <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
          <div style={{ width: 3, height: 20, background: headerColor, borderRadius: 2 }} />
          <span style={{ fontSize: 12, fontWeight: 800, letterSpacing: "0.06em", color: "#e2e8f0", textTransform: "uppercase" }}>
            {config.label}
          </span>
        </div>
        <span style={{
          fontSize: 13, fontWeight: 800,
          background: count === 0 ? "rgba(100,116,139,0.2)" : `${headerColor}25`,
          color: count === 0 ? "#475569" : headerColor,
          padding: "2px 10px", borderRadius: 20,
          minWidth: 28, textAlign: "center",
        }}>
          {count}
        </span>
      </div>

      <div style={{
        flex: 1,
        overflowY: "auto",
        padding: "12px 10px",
        display: "flex",
        flexDirection: "column",
        gap: 8,
      }}>
        {count === 0 ? (
          <div style={{ textAlign: "center", color: "#334155", fontSize: 12, padding: "32px 0" }}>
            All clear
          </div>
        ) : (
          cards.map(card => <ApplicationCard key={card.id} card={card} now={now} />)
        )}
      </div>
    </div>
  );
}

// ── Main component ────────────────────────────────────────────────────────────

export default function OnboardingMonitor() {
  const [searchParams]              = useSearchParams();
  const token                       = searchParams.get("token") || "";

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
      const { data: d } = await api.get(`/api/onboarding-monitor/data?token=${encodeURIComponent(token)}`);
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

  // ── Invalid token screen ──────────────────────────────────────────────────
  if (valid === false) {
    return (
      <div style={{ minHeight: "100vh", background: "#0f172a", display: "flex", alignItems: "center", justifyContent: "center" }}>
        <div style={{ textAlign: "center", color: "#ef4444" }}>
          <div style={{ fontSize: 48, marginBottom: 12 }}>⚠</div>
          <div style={{ fontSize: 20, fontWeight: 700, marginBottom: 8 }}>Invalid display token</div>
          <div style={{ fontSize: 14, color: "#475569" }}>Generate a token in Settings → Onboarding Monitor Display</div>
        </div>
      </div>
    );
  }

  // ── Loading ───────────────────────────────────────────────────────────────
  if (valid === null || !data) {
    return (
      <div style={{ minHeight: "100vh", background: "#0f172a", display: "flex", alignItems: "center", justifyContent: "center" }}>
        <div style={{ textAlign: "center", color: "#475569" }}>
          <div style={{ width: 40, height: 40, border: "3px solid #1e293b", borderTop: "3px solid #6366f1", borderRadius: "50%", animation: "spin 1s linear infinite", margin: "0 auto 16px" }} />
          <div style={{ fontSize: 14 }}>Connecting to onboarding feed…</div>
        </div>
      </div>
    );
  }

  const { kpis, columns } = data;
  const lastUpdatedStr = lastUpdated
    ? lastUpdated.toLocaleTimeString("en-ZA", { hour: "2-digit", minute: "2-digit", second: "2-digit" })
    : "—";

  return (
    <div style={{
      minHeight: "100vh",
      background: "#0f172a",
      color: "#f1f5f9",
      fontFamily: "'Inter', system-ui, -apple-system, sans-serif",
      display: "flex",
      flexDirection: "column",
      overflow: "hidden",
    }}>
      <style>{`
        @keyframes pulse { 0%,100%{opacity:1} 50%{opacity:0.5} }
        @keyframes spin  { from{transform:rotate(0deg)} to{transform:rotate(360deg)} }
        ::-webkit-scrollbar { width: 4px; height: 4px; }
        ::-webkit-scrollbar-track { background: transparent; }
        ::-webkit-scrollbar-thumb { background: rgba(255,255,255,0.1); border-radius: 2px; }
        * { box-sizing: border-box; margin: 0; padding: 0; }
      `}</style>

      {/* ── Header bar ─────────────────────────────────────────────────────── */}
      <div style={{
        padding: "14px 24px",
        borderBottom: "1px solid rgba(255,255,255,0.06)",
        display: "flex",
        alignItems: "center",
        justifyContent: "space-between",
        background: "rgba(255,255,255,0.02)",
        flexShrink: 0,
      }}>
        <div style={{ display: "flex", alignItems: "center", gap: 16 }}>
          <div style={{ fontSize: 18, fontWeight: 900, letterSpacing: "-0.02em", color: "#f1f5f9" }}>
            BASSANI HEALTH
          </div>
          <div style={{ width: 1, height: 20, background: "rgba(255,255,255,0.1)" }} />
          <div style={{ fontSize: 13, fontWeight: 600, color: "#64748b", letterSpacing: "0.06em", textTransform: "uppercase" }}>
            Onboarding Monitor
          </div>
        </div>
        <div style={{ display: "flex", alignItems: "center", gap: 16 }}>
          <span style={{ fontSize: 12, color: "#334155" }}>
            Updated {lastUpdatedStr}
          </span>
          <span style={{
            display: "flex", alignItems: "center", gap: 5,
            fontSize: 11, fontWeight: 600,
            color: connected ? "#22c55e" : "#ef4444",
          }}>
            <span style={{ width: 6, height: 6, borderRadius: "50%", background: connected ? "#22c55e" : "#ef4444", animation: connected ? "pulse 3s ease-in-out infinite" : "none" }} />
            {connected ? "LIVE" : "OFFLINE"}
          </span>
        </div>
      </div>

      {/* ── KPI strip ──────────────────────────────────────────────────────── */}
      <div style={{ padding: "16px 20px 0", flexShrink: 0 }}>
        {/* Row 1: Pipeline health */}
        <div style={{ display: "grid", gridTemplateColumns: "repeat(4, 1fr)", gap: 12, marginBottom: 10 }}>
          <KpiCard
            label="Overdue"
            value={kpis.overdue}
            sub={kpis.overdue > 0 ? "Applications past deadline — act now" : "All applications on time"}
            color="#ef4444"
            pulse={kpis.overdue > 0}
          />
          <KpiCard
            label="At Risk"
            value={kpis.at_risk}
            sub="Approaching deadline"
            color="#f97316"
          />
          <KpiCard
            label="Awaiting Signing Authority"
            value={kpis.awaiting_signing_authority}
            sub="Waiting on a Bassani countersignature"
            color="#8b5cf6"
            pulse={kpis.awaiting_signing_authority > 3}
          />
          <KpiCard
            label="Completed Today"
            value={kpis.completed_today}
            sub="Profile created + welcome pack sent"
            color="#22c55e"
          />
        </div>

        {/* Row 2: Stage breakdown — one per Kanban column plus Oldest Active.
            "Needs Retry" is a sub-count within Ready to Finish (the 8.55
            welcome-pack-send failure case), not its own board column. */}
        <div style={{ display: "grid", gridTemplateColumns: "repeat(7, 1fr)", gap: 10, marginBottom: 16 }}>
          <KpiSmall label="Pending Review"     value={kpis.pending_review}     color="#6366f1" />
          <KpiSmall label="Docs Generated"     value={kpis.docs_generated}     color="#8b5cf6" />
          <KpiSmall label="Awaiting Signature" value={kpis.awaiting_signature} color="#06b6d4" />
          <KpiSmall label="Countersigning"     value={kpis.countersigning}     color={kpis.countersigning > 0 ? "#f59e0b" : "#475569"} />
          <KpiSmall label="Ready to Finish"    value={kpis.ready_to_finish}    color="#22c55e" />
          <KpiSmall label="Needs Retry"        value={kpis.needs_retry}        color={kpis.needs_retry > 0 ? "#f97316" : "#475569"} />
          <KpiSmall
            label="Oldest Active"
            value={fmtHours(kpis.oldest_hours)}
            color={
              !kpis.oldest_hours ? "#475569"
              : kpis.oldest_hours > 48 ? "#ef4444"
              : kpis.oldest_hours > 24 ? "#f97316"
              : "#22c55e"
            }
          />
        </div>
      </div>

      {/* ── Kanban columns ─────────────────────────────────────────────────── */}
      <div style={{
        flex: 1,
        display: "flex",
        gap: 10,
        padding: "0 20px 20px",
        overflow: "hidden",
        minHeight: 0,
      }}>
        {COLUMNS.map(cfg => (
          <Column
            key={cfg.key}
            config={cfg}
            cards={columns[cfg.key] || []}
            now={now}
          />
        ))}
      </div>
    </div>
  );
}
