// Operations Monitor — public/big-screen board for the full order pipeline
// (Phase 23.0/23.1, redesigned 23.6 2026-08-23 onto the shared MonitorKit —
// light/dark theme (light default), fullscreen toggle, Bassani branding, and
// cards grouped by order/SO within each column so a primary delivery and a
// re-queued backorder child sharing one order_id read as one order, not two
// anonymous cards. See CLAUDE.md's Phase 23.6 entry for the full rationale.
import { useState, useEffect, useCallback, useRef } from "react";
import { useSearchParams } from "react-router-dom";
import api from "../api";
import toast from "react-hot-toast";
import {
  useMonitorTheme, THEME, pageContainerStyle, resolveHeaderColor, getTiers,
  fmtR, fmtHours, AgeBadge, KpiCard, KpiSmall, Column, CardGroupBox,
  OrderGroupHeader, groupCardsByOrder, MonitorHeaderBar, MonitorLoadingScreen,
  MonitorInvalidTokenScreen, GlobalMonitorStyles, ExportButton,
} from "../components/MonitorKit";

const POLL_MS = 30_000;

const COLUMNS = [
  { key: "quotes",     label: "Open Quotes",       accent: "#6366f1" },
  { key: "deposit",    label: "Awaiting Deposit",  accent: "#eab308" },
  { key: "packing",    label: "Packing",           accent: "#8b5cf6" },
  { key: "qa",         label: "QA Review",         accent: "#06b6d4" },
  { key: "rp",         label: "RP Review",         accent: "#14b8a6" },
  // 8.69 — packed and signed off, customer not told yet: waiting on payment
  { key: "payment",    label: "Awaiting Payment",  accent: "#ea580c" },
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
  const exportingRef = useRef(false);
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
  const { kpis, columns, column_totals } = data;

  // Excel export (23.9, 2026-10-15). Rows come from /api/monitor/export, the
  // same cards as the board plus the sale order number, value excl. VAT and
  // units read from Odoo only on click. Requested columns first, then extras.
  const exportExcel = async () => {
    if (exportingRef.current) return;
    exportingRef.current = true;
    const busy = toast.loading("Preparing export…");
    try {
      const [{ data: ex }, XLSX] = await Promise.all([
        api.get(`/api/monitor/export?token=${encodeURIComponent(token)}`),
        import("xlsx"),
      ]);
      const stamp = new Date();
      const hrs = v => (v == null ? "" : Math.round(Number(v) * 10) / 10);
      const yesNo = v => (v ? "Yes" : "");
      const num = v => (v == null ? "" : v);
      const TIER = { ok: "On track", warning: "Watch", urgent: "At risk", overdue: "Overdue" };
      const fmtDate = v => (v ? new Date(v).toLocaleString("en-ZA") : "");
      const rows = ex.rows.map(r => ({
        "Sale Order": r.sale_order || "",
        "Customer": r.customer_name,
        "Status": r.status,
        "Created By": r.created_by,
        "Units to Pack": num(r.units),
        "Order Value excl. VAT (R)": num(r.value_excl_vat),
        "VAT (R)": num(r.vat),
        "Order Value incl. VAT (R)": num(r.value_incl_vat),
        "Order Date": fmtDate(r.order_date),
        "Sales Agent": r.sales_agent,
        "Assigned To": r.assigned_to,
        "Packer": r.packer,
        "Warehouse": r.warehouse,
        "In Stage Since": fmtDate(r.waiting_since),
        "Hours in Stage": hrs(r.hours_waiting),
        "Target (hours)": num(r.deadline_hours),
        "Age": TIER[r.age_tier] || r.age_tier || "",
        "Backorder": yesNo(r.backorder),
        "In Production": yesNo(r.in_production),
        "Sample": yesNo(r.sample),
      }));
      const sumOf = k => Math.round(ex.rows.reduce((a, r) => a + (Number(r[k]) || 0), 0) * 100) / 100;
      rows.push({});
      rows.push({
        "Sale Order": "TOTAL",
        "Customer": `${ex.rows.length} orders`,
        "Units to Pack": sumOf("units"),
        "Order Value excl. VAT (R)": sumOf("value_excl_vat"),
        "VAT (R)": sumOf("vat"),
        "Order Value incl. VAT (R)": sumOf("value_incl_vat"),
      });

      const k = ex.kpis;
      const stageRows = COLUMNS.map(cfg => {
        const inStage = ex.rows.filter(r => r.stage_key === cfg.key);
        return {
          "Measure": cfg.label,
          "Orders": inStage.length,
          "Units": Math.round(inStage.reduce((a, r) => a + (Number(r.units) || 0), 0) * 100) / 100,
          "Value excl. VAT (R)": Math.round(inStage.reduce((a, r) => a + (Number(r.value_excl_vat) || 0), 0) * 100) / 100,
          "Overdue": inStage.filter(r => r.age_tier === "overdue").length,
        };
      });
      const summary = [
        { "Measure": "Exported", "Orders": stamp.toLocaleString("en-ZA") },
        ...(ex.odoo_unavailable ? [{ "Measure": "Note", "Orders": "Order values and units could not be read; try again shortly" }] : []),
        {},
        ...stageRows,
        {},
        { "Measure": "Overdue", "Orders": k.overdue },
        { "Measure": "At risk", "Orders": k.at_risk },
        { "Measure": "Backorders", "Orders": k.backorders },
        { "Measure": "In production", "Orders": k.in_production },
        { "Measure": "Compliance hold (QA + RP)", "Orders": k.compliance_hold },
        { "Measure": "Completed today", "Orders": k.completed_today },
        { "Measure": "Completed today value incl. VAT (R)", "Orders": k.completed_today_value },
        { "Measure": "Revenue at risk incl. VAT (R)", "Orders": k.revenue_at_risk },
        { "Measure": "Oldest active (hours)", "Orders": hrs(k.oldest_hours) },
      ];

      const wb = XLSX.utils.book_new();
      const board = XLSX.utils.json_to_sheet(rows);
      board["!cols"] = [12, 32, 18, 22, 12, 20, 12, 20, 18, 22, 20, 18, 22, 18, 12, 12, 10, 10, 12, 8].map(w => ({ wch: w }));
      board["!autofilter"] = { ref: `A1:T${ex.rows.length + 1}` };
      XLSX.utils.book_append_sheet(wb, board, "Orders");
      const sum = XLSX.utils.json_to_sheet(summary);
      sum["!cols"] = [{ wch: 36 }, { wch: 22 }, { wch: 10 }, { wch: 20 }, { wch: 10 }];
      XLSX.utils.book_append_sheet(wb, sum, "Summary");
      const pad = n => String(n).padStart(2, "0");
      XLSX.writeFile(wb, `Operations Monitor ${stamp.getFullYear()}-${pad(stamp.getMonth() + 1)}-${pad(stamp.getDate())} ${pad(stamp.getHours())}${pad(stamp.getMinutes())}.xlsx`);
      if (ex.odoo_unavailable) toast.error("Exported, but order values and units couldn't be read. Try again shortly.", { id: busy });
      else toast.success(`Exported ${ex.rows.length} orders`, { id: busy });
    } catch (e) {
      toast.error(e.response?.data?.detail || "Export failed", { id: busy });
    } finally {
      exportingRef.current = false;
    }
  };
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
        actions={<ExportButton theme={theme} onClick={exportExcel} title="Export the board to Excel" />}
      />

      {/* ── KPI strip ──────────────────────────────────────────────────────── */}
      {/* Redesigned 2026-09-20: every per-column count that used to live here
          (Open Inquiries, Awaiting Deposit, In Packing, QA/RP Pending,
          Awaiting Collection) now shows directly on that column's own
          heading badge below — repeating it up here was pure duplication.
          Row 1 is "needs action" for sales clerks/ops staff working the
          pipeline day to day; Row 2 is "business health" for the CFO/exco
          audience glancing at the board — the only two Row-2-style numbers
          that survived from the old design (Backorders, In Production) are
          promoted into Row 1 instead, since they're the one thing here that
          IS still actionable ops signal, not a duplicate of a column count. */}
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
            label="Backorders"
            value={kpis.backorders}
            sub="Orders waiting on stock"
            color="#dc2626"
            pulse={kpis.backorders > 0}
          />
          <KpiCard theme={theme}
            label="In Production"
            value={kpis.in_production}
            sub="Orders waiting on manufacturing"
            color="#2563eb"
          />
        </div>

        <div style={{ display: "grid", gridTemplateColumns: "repeat(5, 1fr)", gap: 10, marginBottom: 16 }}>
          <KpiSmall theme={theme}
            label="Pipeline Value"
            value={fmtR(kpis.pipeline_value)}
            color={t.brand}
          />
          <KpiSmall theme={theme}
            label="Revenue at Risk"
            value={fmtR(kpis.revenue_at_risk)}
            color={kpis.revenue_at_risk > 0 ? "#dc2626" : undefined}
          />
          <KpiSmall theme={theme}
            label="Completed Today"
            value={`${kpis.completed_today} · ${fmtR(kpis.completed_today_value)}`}
            color={t.brand}
          />
          <KpiSmall theme={theme}
            label="Compliance Hold"
            value={kpis.compliance_hold}
            color={kpis.compliance_hold > 3 ? "#8b5cf6" : undefined}
          />
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
              valueTotal={column_totals?.[cfg.key]}
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
