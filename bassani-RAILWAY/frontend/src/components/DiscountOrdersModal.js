// Drill-down behind a row of the Discounts by Product / Discounts by Customer
// reports: the confirmed orders carrying that discount in the same period and
// warehouse. Clicking an order opens its Order Passport.
import { useState, useEffect } from "react";
import { useNavigate } from "react-router-dom";
import { Loader2, ExternalLink } from "lucide-react";
import api from "../api";
import { Modal, BtnSecondary, fmtR, fmtDate } from "./UI";

export default function DiscountOrdersModal({ dimension, row, periodParams, onClose }) {
  const navigate = useNavigate();
  const [data, setData] = useState(null);
  const [error, setError] = useState(null);

  useEffect(() => {
    let cancelled = false;
    api.get("/api/reports/discount-orders", { params: { ...periodParams, dimension, id: row.id } })
      .then(r => { if (!cancelled) setData(r.data); })
      .catch(e => { if (!cancelled) setError(e.response?.data?.detail || "Could not load the orders"); });
    return () => { cancelled = true; };
  }, [dimension, row.id]); // eslint-disable-line

  const orders = data?.orders || [];
  const showCustomer = dimension === "product";

  return (
    <Modal title={`Orders with a discount: ${row.name}`} onClose={onClose} width="max-w-4xl">
      <p className="text-xs text-gray-500 mb-3">
        Confirmed orders in the selected period{showCustomer ? " that discounted this product" : " for this customer that carry a discount"}.
        Amounts exclude VAT{showCustomer ? " and cover this product only" : " and cover the discounted lines only"}. Click an order to open it.
      </p>
      {error ? (
        <p className="text-sm text-red-600">{error}</p>
      ) : !data ? (
        <div className="py-10 flex items-center justify-center text-sm text-gray-400 gap-2"><Loader2 size={15} className="animate-spin" />Loading orders…</div>
      ) : orders.length === 0 ? (
        <p className="text-sm text-gray-400 py-6">No orders found for this period.</p>
      ) : (
        <div className="border border-gray-100 rounded-xl overflow-x-auto max-h-[60vh] overflow-y-auto">
          <table className="w-full text-sm min-w-[720px]">
            <thead className="bg-gray-50 sticky top-0">
              <tr>
                {["Order", "Date", ...(showCustomer ? ["Customer"] : []), "Before Discount", "Discount", "Avg %", "Approved", "Not via Approval"].map(h => (
                  <th key={h} className="text-left text-[10px] font-semibold text-gray-400 uppercase tracking-wider px-3 py-2.5">{h}</th>
                ))}
              </tr>
            </thead>
            <tbody>
              {orders.map(o => (
                <tr key={o.order_id ?? o.order_name}
                  onClick={() => o.order_id && navigate(`/orders/${o.order_id}/passport`)}
                  className="border-t border-gray-50 hover:bg-bassani-50 cursor-pointer">
                  <td className="px-3 py-2.5 font-mono text-xs font-semibold text-bassani-700 whitespace-nowrap">
                    {o.order_name}<ExternalLink size={11} className="inline ml-1 opacity-50" />
                  </td>
                  <td className="px-3 py-2.5 text-gray-500 whitespace-nowrap">{fmtDate(o.date)}</td>
                  {showCustomer && <td className="px-3 py-2.5 text-gray-700">{o.customer_name}</td>}
                  <td className="px-3 py-2.5 text-gray-500">{fmtR(o.gross_before_discount)}</td>
                  <td className="px-3 py-2.5 font-semibold text-red-600">{fmtR(o.total_discount)}</td>
                  <td className="px-3 py-2.5 text-gray-500">{o.avg_pct?.toFixed(1)}%</td>
                  <td className="px-3 py-2.5 text-gray-600">{o.approved_in_portal == null ? <span className="text-gray-300">n/a</span> : fmtR(o.approved_in_portal)}</td>
                  <td className={`px-3 py-2.5 ${o.not_via_approval > 0 ? "font-semibold text-amber-600" : "text-gray-400"}`}>
                    {o.not_via_approval == null ? <span className="text-gray-300">n/a</span> : fmtR(o.not_via_approval)}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
      {data?.truncated && <p className="text-xs text-amber-700 mt-2">Showing the 200 orders with the largest discount. Narrow the period to see the rest.</p>}
      <div className="flex justify-end mt-4"><BtnSecondary onClick={onClose}>Close</BtnSecondary></div>
    </Modal>
  );
}
