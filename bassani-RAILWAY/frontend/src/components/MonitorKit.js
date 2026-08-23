// Shared visual/behavior toolkit for the three public big-screen monitor
// boards (OrderMonitor.js / OnboardingMonitor.js / ManufacturingMonitor.js) —
// extracted 2026-08-23 as part of the light/dark theme + enterprise redesign.
// These boards are deliberately kept off Tailwind classes (fully
// self-contained public pages, no auth/layout shell dependency), so this kit
// stays plain JS + inline-style rather than a Tailwind component, matching
// the pattern the three view files already used.
//
// This is a deliberate exception to the "parallel files over shared
// abstraction" precedent noted for these three files elsewhere in the repo —
// justified because a fourth cross-cutting concern (theme) is being added,
// and three independent copies of theme logic is exactly the kind of thing
// that silently drifts. See CLAUDE.md's Phase 23.6 entry.
import { useCallback, useEffect, useState } from "react";
import { Sun, Moon, Maximize, Minimize, CheckCircle2, AlertTriangle, AlertCircle, AlertOctagon } from "lucide-react";

// ── Theme persistence ───────────────────────────────────────────────────────

const THEME_STORAGE_KEY = "bassani_monitor_theme";

export function useMonitorTheme() {
  const [theme, setTheme] = useState(() => {
    try {
      return localStorage.getItem(THEME_STORAGE_KEY) === "dark" ? "dark" : "light";
    } catch {
      return "light";
    }
  });

  const toggleTheme = useCallback(() => {
    setTheme(prev => {
      const next = prev === "light" ? "dark" : "light";
      try { localStorage.setItem(THEME_STORAGE_KEY, next); } catch {}
      return next;
    });
  }, []);

  return [theme, toggleTheme];
}

// ── Theme tokens ─────────────────────────────────────────────────────────────
// Brand accent (`brand`) matches tailwind.config.js's `bassani` scale
// (500 #1D9E75 / 600 #0f6e56) so these boards read as part of the same
// product as the rest of the portal, not a bolted-on NOC screen. Pipeline/
// tier colors stay theme-agnostic (they carry meaning, not brand) but their
// tinted backgrounds are tuned per theme for contrast against a white vs.
// dark surface.

export const THEME = {
  light: {
    mode: "light",
    pageBg: "#f1f5f9",
    headerBg: "#ffffff",
    headerBorder: "rgba(15,23,42,0.08)",
    surface: "#ffffff",
    surfaceAlt: "#f8fafc",
    groupBg: "rgba(15,23,42,0.025)",
    border: "rgba(15,23,42,0.09)",
    divider: "rgba(15,23,42,0.07)",
    textPrimary: "#0f172a",
    textSecondary: "#475569",
    textMuted: "#94a3b8",
    textFaint: "#cbd5e1",
    brand: "#0f6e56",
    brandSoft: "rgba(15,110,86,0.10)",
    shadow: "0 1px 2px rgba(15,23,42,0.04), 0 4px 12px rgba(15,23,42,0.05)",
    scrollbarThumb: "rgba(15,23,42,0.16)",
    gradientAlpha: "10",
    countBgIdle: "rgba(15,23,42,0.06)",
    countTextIdle: "#94a3b8",
    hoverBg: "#f1f5f9",
  },
  dark: {
    mode: "dark",
    pageBg: "#0f172a",
    headerBg: "rgba(255,255,255,0.02)",
    headerBorder: "rgba(255,255,255,0.06)",
    surface: "rgba(255,255,255,0.03)",
    surfaceAlt: "rgba(255,255,255,0.015)",
    groupBg: "rgba(255,255,255,0.015)",
    border: "rgba(255,255,255,0.07)",
    divider: "rgba(255,255,255,0.05)",
    textPrimary: "#f1f5f9",
    textSecondary: "#94a3b8",
    textMuted: "#64748b",
    textFaint: "#334155",
    brand: "#1D9E75",
    brandSoft: "rgba(29,158,117,0.16)",
    shadow: "none",
    scrollbarThumb: "rgba(255,255,255,0.1)",
    gradientAlpha: "18",
    countBgIdle: "rgba(100,116,139,0.2)",
    countTextIdle: "#475569",
    hoverBg: "rgba(255,255,255,0.06)",
  },
};

export function pageContainerStyle(theme) {
  const t = THEME[theme];
  return {
    minHeight: "100vh",
    background: t.pageBg,
    color: t.textPrimary,
    fontFamily: "'Inter', system-ui, -apple-system, sans-serif",
    display: "flex",
    flexDirection: "column",
    overflow: "hidden",
  };
}

// ── Age tiers (now icon + color, not color-only — colorblind-safer) ─────────

export function getTiers(theme) {
  return theme === "light" ? {
    ok:      { border: "#16a34a", bg: "rgba(22,163,74,0.09)", text: "#15803d", Icon: CheckCircle2 },
    warning: { border: "#d97706", bg: "rgba(217,119,6,0.10)", text: "#b45309", Icon: AlertTriangle },
    urgent:  { border: "#ea580c", bg: "rgba(234,88,12,0.10)", text: "#c2410c", Icon: AlertCircle },
    overdue: { border: "#dc2626", bg: "rgba(220,38,38,0.11)", text: "#b91c1c", Icon: AlertOctagon },
  } : {
    ok:      { border: "#22c55e", bg: "rgba(34,197,94,0.08)",  text: "#4ade80", Icon: CheckCircle2 },
    warning: { border: "#fbbf24", bg: "rgba(251,191,36,0.08)", text: "#fcd34d", Icon: AlertTriangle },
    urgent:  { border: "#f97316", bg: "rgba(249,115,22,0.08)", text: "#fb923c", Icon: AlertCircle },
    overdue: { border: "#ef4444", bg: "rgba(239,68,68,0.08)",  text: "#f87171", Icon: AlertOctagon },
  };
}

export function resolveHeaderColor(cards, accent, theme) {
  const tiers = getTiers(theme);
  if (cards.some(c => c.age_tier === "overdue")) return tiers.overdue.border;
  if (cards.some(c => c.age_tier === "urgent"))  return tiers.urgent.border;
  return accent;
}

// ── Formatters (unchanged logic, moved out of the three view files) ─────────

export function fmtR(val) {
  if (!val && val !== 0) return "—";
  if (val >= 1_000_000) return `R${(val / 1_000_000).toFixed(1)}M`;
  if (val >= 1_000)     return `R${(val / 1_000).toFixed(0)}k`;
  return `R${Number(val).toLocaleString("en-ZA", { minimumFractionDigits: 0 })}`;
}

export function fmtHours(h) {
  if (h === null || h === undefined) return "—";
  const hrs  = Math.floor(h);
  const mins = Math.round((h - hrs) * 60);
  if (hrs === 0) return `${mins}m`;
  return `${hrs}h ${mins}m`;
}

export function fmtQty(n) {
  if (n === null || n === undefined) return "—";
  return Number(n).toLocaleString("en-ZA", { maximumFractionDigits: 2 });
}

export function fmtDueDate(iso) {
  if (!iso) return null;
  return new Date(iso).toLocaleDateString("en-ZA", { day: "numeric", month: "short" });
}

export function countdown(clockStart, deadlineHours, now) {
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

// Groups a column's already-sorted (oldest/most-urgent-first) cards by
// whatever key the caller supplies (sale order id, SO ref, etc.), preserving
// each group's rank from its first (most urgent) member's position — a group
// is never pushed to the back just because it also holds a calmer item.
export function groupCardsByOrder(cards, keyFn) {
  const map = new Map();
  const order = [];
  cards.forEach(card => {
    const key = keyFn(card);
    if (!map.has(key)) {
      map.set(key, { key, cards: [] });
      order.push(key);
    }
    map.get(key).cards.push(card);
  });
  return order.map(k => map.get(k));
}

// ── Small building blocks ────────────────────────────────────────────────────

export function AgeBadge({ card, now, theme }) {
  const tier = getTiers(theme)[card.age_tier] || getTiers(theme).ok;
  const cd   = countdown(card.clock_start, card.deadline_hours, now);
  if (!cd) return null;
  const { isOver, h, m, s } = cd;
  const label = isOver
    ? `+${h}h ${m}m overdue`
    : h > 0 ? `${h}h ${m}m left`
    : `${m}m ${s}s left`;
  const Icon = tier.Icon;

  return (
    <span style={{
      display: "inline-flex", alignItems: "center", gap: 5,
      padding: "3px 8px 3px 6px", borderRadius: 20,
      background: tier.bg, color: tier.text,
      fontSize: 11, fontWeight: 700,
      animation: card.age_tier === "overdue" ? "bh-pulse 1.5s ease-in-out infinite" : "none",
    }}>
      <Icon size={11} strokeWidth={2.5} />
      {label}
    </span>
  );
}

export function KpiCard({ label, value, sub, color, pulse, theme }) {
  const t = THEME[theme];
  return (
    <div style={{
      background: t.surface,
      border: `1px solid ${t.border}`,
      borderRadius: 16,
      padding: "18px 22px",
      display: "flex",
      flexDirection: "column",
      gap: 4,
      position: "relative",
      overflow: "hidden",
      boxShadow: t.shadow,
    }}>
      <div style={{ width: 3, position: "absolute", left: 0, top: 0, bottom: 0, background: color, borderRadius: "4px 0 0 4px" }} />
      <span style={{ fontSize: 11, fontWeight: 600, letterSpacing: "0.08em", color: t.textMuted, textTransform: "uppercase" }}>{label}</span>
      <span style={{
        fontSize: 36,
        fontWeight: 800,
        color,
        lineHeight: 1,
        animation: pulse ? "bh-pulse 2s ease-in-out infinite" : "none",
      }}>{value ?? "—"}</span>
      {sub && <span style={{ fontSize: 12, color: t.textSecondary, marginTop: 2 }}>{sub}</span>}
    </div>
  );
}

export function KpiSmall({ label, value, color, theme }) {
  const t = THEME[theme];
  return (
    <div style={{
      background: t.surfaceAlt,
      border: `1px solid ${t.border}`,
      borderRadius: 12,
      padding: "12px 16px",
      display: "flex",
      flexDirection: "column",
      gap: 3,
    }}>
      <span style={{ fontSize: 10, fontWeight: 600, letterSpacing: "0.08em", color: t.textMuted, textTransform: "uppercase" }}>{label}</span>
      <span style={{ fontSize: 22, fontWeight: 700, color: color || t.textSecondary, lineHeight: 1 }}>{value ?? "—"}</span>
    </div>
  );
}

export function Column({ config, count, headerColor, theme, children }) {
  const t = THEME[theme];
  return (
    <div style={{
      display: "flex",
      flexDirection: "column",
      minWidth: 0,
      flex: 1,
      background: t.surface,
      border: `1px solid ${t.border}`,
      borderRadius: 16,
      overflow: "hidden",
      boxShadow: t.shadow,
    }}>
      <div style={{
        padding: "14px 16px",
        borderBottom: `1px solid ${t.divider}`,
        display: "flex",
        alignItems: "center",
        justifyContent: "space-between",
        background: `linear-gradient(135deg, ${headerColor}${t.gradientAlpha} 0%, transparent 100%)`,
        flexShrink: 0,
      }}>
        <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
          <div style={{ width: 3, height: 20, background: headerColor, borderRadius: 2 }} />
          <span style={{ fontSize: 12, fontWeight: 800, letterSpacing: "0.06em", color: t.textPrimary, textTransform: "uppercase" }}>
            {config.label}
          </span>
        </div>
        <span style={{
          fontSize: 13, fontWeight: 800,
          background: count === 0 ? t.countBgIdle : `${headerColor}22`,
          color: count === 0 ? t.countTextIdle : headerColor,
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
          <div style={{ textAlign: "center", color: t.textFaint, fontSize: 12, padding: "32px 0" }}>
            All clear
          </div>
        ) : children}
      </div>
    </div>
  );
}

// Wraps more than one card that share an order/SO under one visual envelope,
// distinct from a plain card's own surface so the nesting reads clearly.
export function CardGroupBox({ theme, children }) {
  const t = THEME[theme];
  return (
    <div style={{
      border: `1px solid ${t.border}`,
      borderRadius: 12,
      padding: 8,
      display: "flex",
      flexDirection: "column",
      gap: 6,
      background: t.groupBg,
    }}>
      {children}
    </div>
  );
}

// Clickable "SO ref · customer · N items" strip shown above a multi-card
// group — navigates to the Order Passport, same destination a card in the
// group would go to. (Previously inert text-only in ManufacturingMonitor.js.)
export function OrderGroupHeader({ orderRef, customerName, count, unitLabel = "items", href, theme }) {
  const t = THEME[theme];
  return (
    <div
      onClick={() => href && window.open(href, "_blank", "noopener,noreferrer")}
      style={{
        display: "flex", alignItems: "baseline", justifyContent: "space-between",
        padding: "4px 6px", margin: "-2px -2px 0",
        cursor: href ? "pointer" : "default", borderRadius: 8,
        transition: "background 0.15s",
      }}
      onMouseEnter={e => { if (href) e.currentTarget.style.background = t.hoverBg; }}
      onMouseLeave={e => { e.currentTarget.style.background = "transparent"; }}
    >
      <span style={{ fontSize: 11, fontWeight: 700, color: t.textSecondary }}>
        {orderRef || "—"}{customerName ? ` · ${customerName}` : ""}
      </span>
      <span style={{ fontSize: 10, color: t.textMuted, flexShrink: 0, marginLeft: 8 }}>
        {count} {unitLabel}
      </span>
    </div>
  );
}

// ── Header bar / connection / theme + fullscreen controls ───────────────────

function iconButtonStyle(t) {
  return {
    display: "flex", alignItems: "center", justifyContent: "center",
    width: 32, height: 32, borderRadius: 10,
    background: t.surfaceAlt, border: `1px solid ${t.border}`,
    color: t.textSecondary, cursor: "pointer", transition: "background 0.15s, color 0.15s",
    flexShrink: 0,
  };
}

export function ThemeToggle({ theme, onToggle }) {
  const t = THEME[theme];
  const isDark = theme === "dark";
  return (
    <button
      onClick={onToggle}
      title={isDark ? "Switch to light theme" : "Switch to dark theme"}
      style={iconButtonStyle(t)}
      onMouseEnter={e => { e.currentTarget.style.background = t.hoverBg; e.currentTarget.style.color = t.textPrimary; }}
      onMouseLeave={e => { e.currentTarget.style.background = t.surfaceAlt; e.currentTarget.style.color = t.textSecondary; }}
    >
      {isDark ? <Sun size={15} /> : <Moon size={15} />}
    </button>
  );
}

export function FullscreenToggle({ theme }) {
  const t = THEME[theme];
  const [isFs, setIsFs] = useState(() => !!document.fullscreenElement);

  useEffect(() => {
    const onChange = () => setIsFs(!!document.fullscreenElement);
    document.addEventListener("fullscreenchange", onChange);
    return () => document.removeEventListener("fullscreenchange", onChange);
  }, []);

  const toggle = () => {
    if (document.fullscreenElement) {
      document.exitFullscreen?.().catch(() => {});
    } else {
      document.documentElement.requestFullscreen?.().catch(() => {});
    }
  };

  return (
    <button
      onClick={toggle}
      title={isFs ? "Exit full screen" : "Full screen"}
      style={iconButtonStyle(t)}
      onMouseEnter={e => { e.currentTarget.style.background = t.hoverBg; e.currentTarget.style.color = t.textPrimary; }}
      onMouseLeave={e => { e.currentTarget.style.background = t.surfaceAlt; e.currentTarget.style.color = t.textSecondary; }}
    >
      {isFs ? <Minimize size={15} /> : <Maximize size={15} />}
    </button>
  );
}

export function ConnectionBadge({ connected, theme }) {
  const t = THEME[theme];
  const color = connected ? t.brand : "#dc2626";
  return (
    <span style={{ display: "flex", alignItems: "center", gap: 5, fontSize: 11, fontWeight: 700, color }}>
      <span style={{
        width: 6, height: 6, borderRadius: "50%", background: color,
        animation: connected ? "bh-pulse 3s ease-in-out infinite" : "none",
      }} />
      {connected ? "LIVE" : "OFFLINE"}
    </span>
  );
}

export function MonitorHeaderBar({ theme, onToggleTheme, title, lastUpdatedStr, connected }) {
  const t = THEME[theme];
  return (
    <div style={{
      padding: "12px 24px",
      borderBottom: `1px solid ${t.headerBorder}`,
      display: "flex",
      alignItems: "center",
      justifyContent: "space-between",
      background: t.headerBg,
      flexShrink: 0,
    }}>
      <div style={{ display: "flex", alignItems: "center", gap: 14 }}>
        <img src="/logo.png" alt="Bassani Health" style={{ height: 30, objectFit: "contain" }} />
        <div style={{ width: 1, height: 22, background: t.headerBorder }} />
        <div style={{ fontSize: 13, fontWeight: 700, color: t.textSecondary, letterSpacing: "0.02em" }}>
          {title}
        </div>
      </div>
      <div style={{ display: "flex", alignItems: "center", gap: 14 }}>
        <span style={{ fontSize: 12, color: t.textMuted }}>Updated {lastUpdatedStr}</span>
        <ConnectionBadge connected={connected} theme={theme} />
        <div style={{ width: 1, height: 22, background: t.headerBorder }} />
        <ThemeToggle theme={theme} onToggle={onToggleTheme} />
        <FullscreenToggle theme={theme} />
      </div>
    </div>
  );
}

export function MonitorLoadingScreen({ theme, message }) {
  const t = THEME[theme];
  return (
    <div style={{ minHeight: "100vh", background: t.pageBg, display: "flex", alignItems: "center", justifyContent: "center" }}>
      <style>{`@keyframes bh-spin { from{transform:rotate(0deg)} to{transform:rotate(360deg)} }`}</style>
      <div style={{ textAlign: "center" }}>
        <img src="/logo.png" alt="Bassani Health" style={{ height: 34, marginBottom: 20, opacity: 0.85 }} />
        <div style={{
          width: 36, height: 36, margin: "0 auto 16px",
          border: `3px solid ${t.border}`, borderTop: `3px solid ${t.brand}`,
          borderRadius: "50%", animation: "bh-spin 1s linear infinite",
        }} />
        <div style={{ fontSize: 14, color: t.textSecondary, fontFamily: "'Inter', system-ui, sans-serif" }}>{message}</div>
      </div>
    </div>
  );
}

export function MonitorInvalidTokenScreen({ theme, settingsHint }) {
  const t = THEME[theme];
  return (
    <div style={{ minHeight: "100vh", background: t.pageBg, display: "flex", alignItems: "center", justifyContent: "center" }}>
      <div style={{ textAlign: "center", fontFamily: "'Inter', system-ui, sans-serif" }}>
        <img src="/logo.png" alt="Bassani Health" style={{ height: 34, marginBottom: 20, opacity: 0.85 }} />
        <div style={{ fontSize: 38, marginBottom: 10, color: "#dc2626" }}>⚠</div>
        <div style={{ fontSize: 19, fontWeight: 700, marginBottom: 8, color: t.textPrimary }}>Invalid display token</div>
        <div style={{ fontSize: 14, color: t.textMuted }}>{settingsHint}</div>
      </div>
    </div>
  );
}

export function GlobalMonitorStyles({ theme }) {
  const t = THEME[theme];
  return (
    <style>{`
      @keyframes bh-pulse { 0%,100%{opacity:1} 50%{opacity:0.5} }
      @keyframes bh-spin  { from{transform:rotate(0deg)} to{transform:rotate(360deg)} }
      ::-webkit-scrollbar { width: 6px; height: 6px; }
      ::-webkit-scrollbar-track { background: transparent; }
      ::-webkit-scrollbar-thumb { background: ${t.scrollbarThumb}; border-radius: 3px; }
      * { box-sizing: border-box; margin: 0; padding: 0; }
    `}</style>
  );
}
