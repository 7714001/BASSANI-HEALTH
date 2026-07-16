import { useState, useEffect, useCallback, useRef } from "react";
import { useSearchParams } from "react-router-dom";
import api from "../api";

// ── Constants ─────────────────────────────────────────────────────────────────

const POLL_MS = 30_000;

const COLUMNS = [
  { key: "quotes",     label: "Open Quotes",      abbr: "QUOTES",   accent: "#6366f1" },
  { key: "packing",    label: "Packing",           abbr: "PACKING",  accent: "#8b5cf6" },
  { key: "qa",         label: "QA Review",         abbr: "QA",       accent: "#06b6d4" },
  { key: "rp",         label: "RP Review",         abbr: "RP",       accent: "#14b8a6" },
  { key: "collection", label: "Ready to Collect",   abbr: "COLLECT",  accent: "#f59e0b" },
];

const TIER = {
  ok:      { border: "#22c55e", bg: "rgba(34,197,94,0.08)",   text: "#4ade80",  dot: "#22c55e",  label: "On track"  },
  warning: { border: "#fbbf24", bg: "rgba(251,191,36,0.08)",  text: "#fcd34d",  dot: "#fbbf24",  label: "Attention" },
  urgent:  { border: "#f97316", bg: "rgba(249,115,22,0.08)",  text: "#fb923c",  dot: "#f97316",  label: "Urgent"    },
  overdue: { border: "#ef4444", bg: "rgba(239,68,68,0.08)",   text: "#f87171",  dot: "#ef4444",  label: "OVERDUE"   },
};

// ── Formatters ────────────────────────────────────────────────────────────────

function fmtR(val) {
  if (!val && val !== 0) return "—";
  if (val >= 1_000_000) return `R${(val / 1_000_000).toFixed(1)}M`;
  if (val >= 1_000)     return `R${(val / 1_000).toFixed(0)}k`;
  return `R${Number(val).toLocaleString("en-ZA", { minimumFractionDigits: 0 })}`;
}

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

// ── Sub-components ────────────────────────────────────────────────────────────

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

function cardUrl(card) {
  if (card.so_ref) return `/orders/${encodeURIComponent(card.so_ref)}/passport`;
  return "/tickets/sales";
}

const STAGE_LABEL = {
  open:       { label: "Inquiry",         color: "#6366f1" },
  quote:      { label: "Quote sent",      color: "#8b5cf6" },
  sale_order: { label: "Awaiting packing", color: "#f59e0b" },
};

function OrderCard({ card, now }) {
  const tier       = TIER[card.age_tier] || TIER.ok;
  const isReseller = card.is_reseller && card.reseller_name;
  const isSample   = card.is_sample;
  const href       = cardUrl(card);
  const stageInfo  = card.type === "quote" ? STAGE_LABEL[card.status] : null;

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
      {/* Customer + tags */}
      <div style={{ display: "flex", alignItems: "flex-start", justifyContent: "space-between", gap: 8 }}>
        <span style={{ fontSize: 14, fontWeight: 700, color: "#f1f5f9", lineHeight: 1.3 }}>
          {card.customer_name || "—"}
        </span>
        <div style={{ display: "flex", gap: 4, flexShrink: 0 }}>
          {isSample   && <span style={{ fontSize: 9, fontWeight: 700, padding: "2px 6px", borderRadius: 4, background: "rgba(99,102,241,0.2)", color: "#a5b4fc" }}>SAMPLE</span>}
          {isReseller && <span style={{ fontSize: 9, fontWeight: 700, padding: "2px 6px", borderRadius: 4, background: "rgba(20,184,166,0.2)", color: "#5eead4" }}>RESELLER</span>}
          {stageInfo  && <span style={{ fontSize: 9, fontWeight: 700, padding: "2px 6px", borderRadius: 4, background: `${stageInfo.color}22`, color: stageInfo.color }}>{stageInfo.label}</span>}
        </div>
      </div>

      {/* SO ref */}
      {card.so_ref && (
        <span style={{ fontFamily: "monospace", fontSize: 11, color: "#64748b", fontWeight: 600 }}>
          {card.so_ref}
        </span>
      )}

      {/* Assigned to */}
      <div style={{ display: "flex", alignItems: "center", gap: 5 }}>
        <span style={{ fontSize: 10, color: "#475569" }}>
          {card.assigned_name
            ? `Assigned: ${card.assigned_name}`
            : <span style={{ color: "#334155", fontStyle: "italic" }}>Unassigned</span>
          }
        </span>
        {card.packer_name && (
          <>
            <span style={{ color: "#1e293b", fontSize: 10 }}>·</span>
            <span style={{ fontSize: 10, color: "#475569" }}>Packer: {card.packer_name}</span>
          </>
        )}
      </div>

      {/* Age badge */}
      <AgeBadge card={card} now={now} />

      {/* Footer: units + reseller + value */}
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", borderTop: "1px solid rgba(255,255,255,0.05)", paddingTop: 8 }}>
        <span style={{ fontSize: 11, color: "#475569" }}>
          {card.total_units ? `${card.total_units} units` : ""}
          {isReseller && card.reseller_name ? ` · ${card.reseller_name}` : ""}
        </span>
        {card.order_value != null && (
          <span style={{ fontSize: 12, fontWeight: 700, color: "#94a3b8" }}>
            {fmtR(card.order_value)}
          </span>
        )}
      </div>
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
      {/* Column header */}
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

      {/* Cards */}
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
          cards.map(card => <OrderCard key={card.id} card={card} now={now} />)
        )}
      </div>
    </div>
  );
}

// ── Main component ────────────────────────────────────────────────────────────

export default function OrderMonitor() {
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

  // ── Invalid token screen ──────────────────────────────────────────────────
  if (valid === false) {
    return (
      <div style={{ minHeight: "100vh", background: "#0f172a", display: "flex", alignItems: "center", justifyContent: "center" }}>
        <div style={{ textAlign: "center", color: "#ef4444" }}>
          <div style={{ fontSize: 48, marginBottom: 12 }}>⚠</div>
          <div style={{ fontSize: 20, fontWeight: 700, marginBottom: 8 }}>Invalid display token</div>
          <div style={{ fontSize: 14, color: "#475569" }}>Generate a token in Settings → Monitor Display</div>
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
          <div style={{ fontSize: 14 }}>Connecting to operations feed…</div>
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
            Operations Monitor
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
            sub={kpis.overdue > 0 ? "Orders past deadline — act now" : "All orders on time"}
            color="#ef4444"
            pulse={kpis.overdue > 0}
          />
          <KpiCard
            label="At Risk"
            value={kpis.at_risk}
            sub="Approaching 72h deadline"
            color="#f97316"
          />
          <KpiCard
            label="Compliance Hold"
            value={kpis.compliance_hold}
            sub="Waiting on QA or RP sign-off"
            color="#8b5cf6"
            pulse={kpis.compliance_hold > 3}
          />
          <KpiCard
            label="Completed Today"
            value={kpis.completed_today}
            sub="Orders fulfilled today"
            color="#22c55e"
          />
        </div>

        {/* Row 2: Stage breakdown */}
        <div style={{ display: "grid", gridTemplateColumns: "repeat(6, 1fr)", gap: 10, marginBottom: 16 }}>
          <KpiSmall label="Open Inquiries"      value={kpis.open_quotes}         color="#6366f1" />
          <KpiSmall label="In Packing"          value={kpis.in_packing}          color="#8b5cf6" />
          <KpiSmall label="QA Pending"          value={kpis.qa_pending}          color={kpis.qa_pending  > 0 ? "#f59e0b" : "#475569"} />
          <KpiSmall label="RP Pending"          value={kpis.rp_pending}          color={kpis.rp_pending  > 0 ? "#f59e0b" : "#475569"} />
          <KpiSmall label="Awaiting Collection" value={kpis.awaiting_collection} color="#14b8a6" />
          <KpiSmall
            label="Oldest Active"
            value={fmtHours(kpis.oldest_hours)}
            color={
              !kpis.oldest_hours ? "#475569"
              : kpis.oldest_hours > 72 ? "#ef4444"
              : kpis.oldest_hours > 48 ? "#f97316"
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
