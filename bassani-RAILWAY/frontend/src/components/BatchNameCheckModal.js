// Odoo batch-name check (2026-10-11) — read-only report for Bassani to tidy
// the batch (stock.lot) names already in Odoo: how many follow the standard,
// near-duplicates (same product, one character apart), and names outside the
// standard. Backed by GET /api/production/odoo-batch-check.
import { useState, useEffect } from "react";
import { Loader2, Download } from "lucide-react";
import toast from "react-hot-toast";
import api from "../api";
import { Modal, BtnSecondary, FilterPill, ChipRow } from "./UI";

const KIND = {
  legacy: "Older Bassani format",
  other: "Not in the batch standard",
};

export default function BatchNameCheckModal({ onClose }) {
  const [data, setData] = useState(null);
  const [tab, setTab] = useState("near");

  useEffect(() => {
    api.get("/api/production/odoo-batch-check").then(r => setData(r.data))
      .catch(e => { toast.error(e.response?.data?.detail || "Could not check batch names"); onClose(); });
  }, []); // eslint-disable-line

  const exportExcel = async () => {
    const XLSX = await import("xlsx");
    const wb = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(wb, XLSX.utils.json_to_sheet(data.near_duplicates.map(d => ({ Product: d.product, "Name A": d.names[0], "Name B": d.names[1] }))), "Near duplicates");
    XLSX.utils.book_append_sheet(wb, XLSX.utils.json_to_sheet(data.non_standard.map(n => ({ Batch: n.name, Product: n.product, Type: KIND[n.kind], Created: n.created }))), "Outside the standard");
    XLSX.writeFile(wb, `Odoo batch name check ${new Date().toISOString().slice(0, 10)}.xlsx`);
  };

  const c = data?.counts || {};
  return (
    <Modal title="Batch names in Odoo" onClose={onClose} width="max-w-4xl">
      {!data ? (
        <p className="text-sm text-gray-400 flex items-center gap-2"><Loader2 size={14} className="animate-spin" />Reading every batch in Odoo…</p>
      ) : (
        <>
          <p className="text-xs text-gray-500 mb-3">
            A read-only check of the {data.total.toLocaleString()} batch names already in Odoo, to tidy there. New batches made in the portal always follow
            the standard. Names outside the standard aren't necessarily wrong: some may be supplier or packing references still to be confirmed.
          </p>
          <div className="grid grid-cols-2 sm:grid-cols-5 gap-2 mb-3">
            {[
              ["Follow the standard", c.standard, "text-green-700"],
              ["Import standard (BI)", c.import, "text-green-700"],
              ["Older Bassani format", c.legacy, "text-amber-700"],
              ["Outside the standard", c.other, "text-gray-700"],
              ["Near-duplicate pairs", data.near_duplicate_count, data.near_duplicate_count ? "text-red-600" : "text-gray-400"],
            ].map(([label, v, cls]) => (
              <div key={label} className="bg-gray-50 rounded-lg px-3 py-2">
                <p className="text-[10px] text-gray-400">{label}</p>
                <p className={`text-lg font-bold ${cls}`}>{(v || 0).toLocaleString()}</p>
              </div>
            ))}
          </div>
          <div className="flex items-center justify-between gap-2 mb-2">
            <ChipRow>
              <FilterPill label={`Near-duplicates (${data.near_duplicate_count})`} active={tab === "near"} onClick={() => setTab("near")} />
              <FilterPill label={`Outside the standard (${data.non_standard_count})`} active={tab === "other"} onClick={() => setTab("other")} />
            </ChipRow>
            <BtnSecondary size="sm" onClick={exportExcel}><Download size={13} />Export</BtnSecondary>
          </div>
          <div className="border border-gray-100 rounded-lg overflow-y-auto max-h-[50vh]">
            {tab === "near" ? (
              data.near_duplicates.length === 0 ? <p className="text-sm text-gray-400 px-3 py-6 text-center">No near-duplicates found.</p> : (
                <table className="w-full text-sm">
                  <thead className="bg-gray-50 text-xs text-gray-500 sticky top-0"><tr><th className="text-left px-3 py-2">Product</th><th className="text-left px-3 py-2">Batch names (one character apart)</th></tr></thead>
                  <tbody className="divide-y divide-gray-50">
                    {data.near_duplicates.map((d, i) => (
                      <tr key={i}><td className="px-3 py-2 text-gray-700">{d.product}</td>
                        <td className="px-3 py-2 font-mono text-xs">{d.names[0]} <span className="text-gray-400">vs</span> {d.names[1]}</td></tr>
                    ))}
                  </tbody>
                </table>
              )
            ) : (
              <table className="w-full text-sm">
                <thead className="bg-gray-50 text-xs text-gray-500 sticky top-0"><tr><th className="text-left px-3 py-2">Batch</th><th className="text-left px-3 py-2">Product</th><th className="text-left px-3 py-2">Type</th><th className="text-left px-3 py-2">Created</th></tr></thead>
                <tbody className="divide-y divide-gray-50">
                  {data.non_standard.map((n, i) => (
                    <tr key={i}><td className="px-3 py-2 font-mono text-xs">{n.name}</td><td className="px-3 py-2 text-gray-700">{n.product}</td>
                      <td className="px-3 py-2 text-xs text-gray-500">{KIND[n.kind]}</td><td className="px-3 py-2 text-xs text-gray-500">{n.created}</td></tr>
                  ))}
                </tbody>
              </table>
            )}
          </div>
          {data.non_standard_count > data.non_standard.length && tab === "other" && (
            <p className="text-[11px] text-gray-400 mt-1">Showing the newest {data.non_standard.length.toLocaleString()} of {data.non_standard_count.toLocaleString()}.</p>
          )}
        </>
      )}
      <div className="flex justify-end mt-4"><BtnSecondary onClick={onClose}>Close</BtnSecondary></div>
    </Modal>
  );
}
