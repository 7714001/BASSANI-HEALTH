import { Truck, FileSearch } from "lucide-react";
import { fmtDate } from "./UI";

const PICKING_COLOUR = {
  done:      "bg-green-50 text-green-700",
  assigned:  "bg-blue-50 text-blue-700",
  confirmed: "bg-amber-50 text-amber-700",
  waiting:   "bg-orange-50 text-orange-700",
  cancel:    "bg-gray-100 text-gray-400",
};

// ── Delivery & Fulfilment card (2026-08-26) — shared by SalesTickets.js and
// OrderPassport.js, which previously each carried their own near-duplicate
// copy with real drift between them: OrderPassport's had a "View Slip" PDF
// action and a backorder_ref line SalesTickets' didn't; SalesTickets' had a
// tracking_ref line OrderPassport's didn't. Reconciled into one version
// with everything both had.
//
// Redesigned the same day per product-owner feedback ("dummy-proof and
// enterprise industry standard") — the old version crammed a raw Odoo
// picking reference in as the heading plus four same-weight badges onto
// one line, unreadable to anyone untrained on the portal. Now leads with a
// human "Delivery N" label and a single status pill as the primary visual
// anchor (matches how Shopify/NetSuite-style fulfillment views lead with a
// friendly label, not the internal system reference); the raw picking
// reference, backorder/tracking refs, and dates move to a quiet muted line
// underneath — still there for anyone who needs to cross-reference Odoo,
// just not fighting the status pill for attention. Always renders a
// friendly empty state rather than hiding the card entirely when there are
// no deliveries yet, so the card's absence is never a silent mystery.
export default function DeliveryFulfilmentCard({
  deliveries = [], loading = false, lotMap = {}, onViewSlip,
  title = "Delivery & Fulfilment",
}) {
  const hasBackorder = deliveries.some(d => d.is_backorder);
  return (
    <div className="bg-white rounded-2xl shadow-sm border border-gray-100 p-4 space-y-3">
      <div className="flex items-center gap-2">
        <p className="text-xs font-semibold text-gray-500 uppercase tracking-wide flex items-center gap-1.5">
          <Truck size={12} />{title}
        </p>
        {hasBackorder && (
          <span className="ml-auto text-[10px] bg-orange-50 text-orange-600 border border-orange-100 px-1.5 py-0.5 rounded-full font-semibold">
            Backorders present
          </span>
        )}
      </div>
      <p className="text-[11px] text-gray-400">
        Each row below is a physical delivery prepared from this order.
      </p>
      {loading ? (
        <p className="text-xs text-gray-400 py-2">Loading deliveries…</p>
      ) : deliveries.length === 0 ? (
        <p className="text-xs text-gray-400 py-2">No deliveries created yet.</p>
      ) : (
        <div className="space-y-3">
          {deliveries.map((d, idx) => {
            const colour = PICKING_COLOUR[d.state] || "bg-gray-100 text-gray-500";
            const metaBits = [
              d.is_backorder ? (d.backorder_ref ? `Backorder of ${d.backorder_ref}` : "Backorder") : null,
              d.date_done ? `Delivered ${fmtDate(d.date_done)}` : (d.scheduled_date && d.state !== "done" ? `Expected ${fmtDate(d.scheduled_date)}` : null),
              d.tracking_ref || null,
            ].filter(Boolean);
            return (
              <div key={d.id} className="border border-gray-100 rounded-xl p-3 space-y-2">
                <div className="flex items-start justify-between gap-2">
                  <div className="min-w-0">
                    <div className="flex items-center gap-2 flex-wrap">
                      <span className="text-sm font-semibold text-gray-800">
                        Delivery {idx + 1}{deliveries.length > 1 ? ` of ${deliveries.length}` : ""}
                      </span>
                      <span className={`text-[10px] px-2 py-0.5 rounded-full font-semibold ${colour}`}>
                        {d.state_label}
                      </span>
                    </div>
                    <p className="text-[11px] text-gray-400 font-mono mt-0.5">{d.name}</p>
                    {metaBits.length > 0 && (
                      <p className="text-[11px] text-gray-400 mt-0.5">{metaBits.join(" · ")}</p>
                    )}
                  </div>
                  {onViewSlip && (
                    <button
                      onClick={() => onViewSlip(d)}
                      className="flex items-center gap-1 text-[11px] font-semibold text-bassani-600 hover:text-bassani-700 shrink-0"
                    >
                      <FileSearch size={11} />Slip
                    </button>
                  )}
                </div>
                {d.lines?.length > 0 && (
                  <div className="space-y-1.5 border-t border-gray-50 pt-2">
                    {d.lines.map((l, i) => {
                      const lots = lotMap[l.product_id] || [];
                      const outstanding = l.qty_done < l.qty_ordered;
                      return (
                        <div key={i} className="text-xs text-gray-500">
                          <div className="flex items-start gap-2">
                            <span className="flex-1 truncate">{l.product_name}</span>
                            <span className={`shrink-0 tabular-nums ${outstanding ? "text-orange-600 font-medium" : ""}`}>
                              {l.qty_done}/{l.qty_ordered}
                            </span>
                          </div>
                          {(outstanding || lots.length > 0) && (
                            <div className="flex items-center gap-2 mt-0.5">
                              {outstanding && (
                                <span className="text-[10px] text-orange-500">{l.qty_ordered - l.qty_done} outstanding</span>
                              )}
                              {lots.length > 0 && (
                                <span className="font-mono text-[10px] text-bassani-600 bg-bassani-50 px-1.5 py-0.5 rounded">
                                  Batch: {lots.join(", ")}
                                </span>
                              )}
                            </div>
                          )}
                        </div>
                      );
                    })}
                  </div>
                )}
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}
