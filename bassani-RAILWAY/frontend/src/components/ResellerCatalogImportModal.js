// Bulk-update Reseller Catalog visibility + MOQ from a re-uploaded copy of
// the Parent Categories "Export for Odoo" sheet (2026-09-14). That export
// already carries "Odoo Product ID" plus the two columns this reads back —
// "Reseller Catalog" (Yes/No) and "MOQ" — so editing those two columns in
// Excel and re-uploading here is the whole workflow, no second export needed.
//
// Three steps, entirely client-owned (no backend Excel dependency, matching
// this codebase's existing xlsx-is-a-frontend-concern convention):
//   1. Upload — parse the .xlsx client-side, extract rows keyed on Odoo
//      Product ID (the only unambiguous match key — never by name).
//   2. Preview — POST the parsed rows to a read-only diff endpoint that
//      re-reads live current state and returns exactly what would change.
//      Nothing is written yet. Rows are checkbox-selectable so a subset can
//      be applied deliberately.
//   3. Apply — POST only the checked rows; the backend re-derives the diff
//      fresh at commit time rather than trusting the preview (in case
//      anything changed in between) and applies just that.
import { useRef, useState } from "react";
import { Upload, Loader2, CheckCircle2, AlertTriangle, FileSpreadsheet } from "lucide-react";
import toast from "react-hot-toast";
import api from "../api";
import { Modal, BtnPrimary, BtnSecondary } from "./UI";

const STEP = { UPLOAD: "upload", PREVIEW: "preview" };

function normalizeHeader(h) {
  return String(h || "").trim().toLowerCase().replace(/\s+/g, " ");
}

function findColumn(headers, candidates) {
  return headers.find(h => candidates.includes(normalizeHeader(h)));
}

function parseBoolCell(v) {
  return ["yes", "y", "true", "1"].includes(String(v ?? "").trim().toLowerCase());
}

function parseMoqCell(v) {
  const n = parseInt(v, 10);
  return Number.isFinite(n) && n > 0 ? n : 0;
}

export default function ResellerCatalogImportModal() {
  const [open, setOpen]       = useState(false);
  const [step, setStep]       = useState(STEP.UPLOAD);
  const [fileName, setFileName] = useState("");
  const [parsing, setParsing]   = useState(false);
  const [diff, setDiff]         = useState(null); // preview response
  const [selected, setSelected] = useState(() => new Set());
  const [applying, setApplying] = useState(false);
  const [showUnchanged, setShowUnchanged] = useState(false);
  const fileRef = useRef(null);

  const reset = () => {
    setStep(STEP.UPLOAD);
    setFileName("");
    setParsing(false);
    setDiff(null);
    setSelected(new Set());
    setApplying(false);
    setShowUnchanged(false);
  };

  const openModal = () => { reset(); setOpen(true); };
  const closeModal = () => { setOpen(false); reset(); };

  const previewImport = async (rows) => {
    try {
      const { data } = await api.post("/api/parent-categories/reseller-catalog-import/preview", { rows });
      setDiff(data);
      setSelected(new Set(data.changed_rows.map(r => r.odoo_product_id)));
      setStep(STEP.PREVIEW);
    } catch (e) {
      toast.error(e.response?.data?.detail || "Failed to preview this file");
    }
  };

  const handleFile = async (file) => {
    if (!file) return;
    setFileName(file.name);
    setParsing(true);
    try {
      const XLSX = await import("xlsx");
      const buf = await file.arrayBuffer();
      const wb = XLSX.read(buf, { type: "array" });
      const sheet = wb.Sheets[wb.SheetNames[0]];
      const raw = XLSX.utils.sheet_to_json(sheet, { defval: "" });
      if (raw.length === 0) {
        toast.error("This file has no rows");
        return;
      }
      const headers = Object.keys(raw[0]);
      const idCol   = findColumn(headers, ["odoo product id", "product id", "id"]);
      const visCol  = findColumn(headers, ["reseller catalog"]);
      const moqCol  = findColumn(headers, ["moq"]);
      if (!idCol) {
        toast.error('This file is missing an "Odoo Product ID" column — export the sheet from this page first, edit "Reseller Catalog" / "MOQ", and re-upload the same file.');
        return;
      }
      const rows = raw
        .map(r => {
          const pid = parseInt(r[idCol], 10);
          if (!Number.isFinite(pid)) return null;
          return {
            odoo_product_id: pid,
            reseller_visible: visCol ? parseBoolCell(r[visCol]) : false,
            moq: moqCol ? parseMoqCell(r[moqCol]) : 0,
          };
        })
        .filter(Boolean);
      if (rows.length === 0) {
        toast.error("No rows had a valid Odoo Product ID");
        return;
      }
      if (!visCol) {
        toast('No "Reseller Catalog" column found — every row will be treated as "No" (removed from the catalog if currently visible). Add that column to control this.', { icon: "⚠️", duration: 6000 });
      }
      await previewImport(rows);
    } catch (e) {
      toast.error("Couldn't read this file — make sure it's the .xlsx exported from this page");
    } finally {
      setParsing(false);
    }
  };

  const toggleRow = (id) => {
    setSelected(s => {
      const next = new Set(s);
      if (next.has(id)) next.delete(id); else next.add(id);
      return next;
    });
  };
  const selectAllChanged = () => setSelected(new Set(diff.changed_rows.map(r => r.odoo_product_id)));
  const selectNone = () => setSelected(new Set());

  const applyImport = async () => {
    const rows = diff.changed_rows
      .filter(r => selected.has(r.odoo_product_id))
      .map(r => ({ odoo_product_id: r.odoo_product_id, reseller_visible: r.target_visible, moq: r.target_moq }));
    if (rows.length === 0) return toast.error("Select at least one row to apply");
    setApplying(true);
    try {
      const { data } = await api.post("/api/parent-categories/reseller-catalog-import/apply", { rows });
      toast.success(`Updated ${data.applied} product${data.applied !== 1 ? "s" : ""} — ${data.summary.will_add} added, ${data.summary.will_remove} removed, ${data.summary.moq_changes} MOQ change${data.summary.moq_changes !== 1 ? "s" : ""}`);
      closeModal();
    } catch (e) {
      toast.error(e.response?.data?.detail || "Failed to apply changes");
    } finally {
      setApplying(false);
    }
  };

  const changedRows = diff?.changed_rows || [];
  const visibleRows = showUnchanged
    ? (diff?.rows || [])
    : changedRows;

  return (
    <>
      <BtnSecondary onClick={openModal}>
        <Upload size={14} />Import Reseller Catalog / MOQ
      </BtnSecondary>

      {open && (
        <Modal
          title="Import Reseller Catalog / MOQ"
          onClose={closeModal}
          width={step === STEP.PREVIEW ? "max-w-3xl" : "max-w-lg"}
        >
          {step === STEP.UPLOAD && (
            <div>
              <p className="text-xs text-gray-500 mb-4">
                Upload the same sheet from <strong>Export for Odoo</strong> after editing its <strong>Reseller Catalog</strong>{" "}
                (Yes/No) and <strong>MOQ</strong> columns. Nothing is changed until you review and confirm on the next screen.
              </p>
              <button
                type="button"
                onClick={() => fileRef.current?.click()}
                disabled={parsing}
                className="w-full flex flex-col items-center gap-2 border-2 border-dashed border-gray-200 rounded-xl py-8 hover:border-bassani-300 hover:bg-bassani-50/30 transition-colors disabled:opacity-60"
              >
                {parsing ? (
                  <Loader2 size={22} className="animate-spin text-bassani-500" />
                ) : (
                  <FileSpreadsheet size={22} className="text-gray-400" />
                )}
                <span className="text-sm font-medium text-gray-700">
                  {parsing ? "Reading file…" : fileName || "Click to choose a .xlsx file"}
                </span>
                <span className="text-[11px] text-gray-400">or drag and drop</span>
              </button>
              <input
                ref={fileRef}
                type="file"
                accept=".xlsx,.xls"
                className="hidden"
                onChange={e => handleFile(e.target.files?.[0])}
              />
              <div className="flex justify-end mt-4">
                <BtnSecondary onClick={closeModal}>Cancel</BtnSecondary>
              </div>
            </div>
          )}

          {step === STEP.PREVIEW && diff && (
            <div>
              <div className="flex flex-wrap gap-2 mb-3">
                <SummaryChip color="green"  label={`${diff.summary.will_add} to add`} />
                <SummaryChip color="red"    label={`${diff.summary.will_remove} to remove`} />
                <SummaryChip color="blue"   label={`${diff.summary.moq_changes} MOQ change${diff.summary.moq_changes !== 1 ? "s" : ""}`} />
                <SummaryChip color="gray"   label={`${diff.summary.unchanged} unchanged`} />
                {diff.summary.not_found > 0 && <SummaryChip color="amber" label={`${diff.summary.not_found} not found`} />}
                {diff.summary.duplicates > 0 && <SummaryChip color="amber" label={`${diff.summary.duplicates} duplicate row${diff.summary.duplicates !== 1 ? "s" : ""}`} />}
              </div>

              {diff.not_found_ids.length > 0 && (
                <p className="text-[11px] text-amber-600 bg-amber-50 rounded-lg px-2.5 py-1.5 mb-2">
                  <AlertTriangle size={11} className="inline mr-1 -mt-0.5" />
                  {diff.not_found_ids.length} product ID{diff.not_found_ids.length !== 1 ? "s" : ""} in the file no longer exist in Odoo and were skipped: {diff.not_found_ids.slice(0, 10).join(", ")}{diff.not_found_ids.length > 10 ? "…" : ""}
                </p>
              )}
              {diff.duplicate_ids.length > 0 && (
                <p className="text-[11px] text-amber-600 bg-amber-50 rounded-lg px-2.5 py-1.5 mb-2">
                  <AlertTriangle size={11} className="inline mr-1 -mt-0.5" />
                  {diff.duplicate_ids.length} product ID{diff.duplicate_ids.length !== 1 ? "s" : ""} appeared more than once — only the last row for each was used.
                </p>
              )}

              {changedRows.length === 0 ? (
                <p className="text-sm text-gray-400 py-6 text-center">
                  <CheckCircle2 size={18} className="inline mr-1.5 -mt-0.5 text-green-500" />
                  Nothing to change — every product already matches this file.
                </p>
              ) : (
                <>
                  <div className="flex items-center justify-between mb-1.5">
                    <div className="flex gap-3">
                      <button onClick={selectAllChanged} className="text-[11px] font-semibold text-bassani-600 hover:text-bassani-700">Select all changes</button>
                      <button onClick={selectNone} className="text-[11px] font-semibold text-gray-400 hover:text-gray-600">Select none</button>
                    </div>
                    <button onClick={() => setShowUnchanged(v => !v)} className="text-[11px] text-gray-400 hover:text-gray-600">
                      {showUnchanged ? "Hide unchanged rows" : `Show all ${diff.summary.matched} matched rows`}
                    </button>
                  </div>
                  <div className="border border-gray-100 rounded-lg max-h-72 overflow-y-auto">
                    {visibleRows.map(r => {
                      const isChanged = r.visible_changed || r.moq_changed;
                      return (
                        <div key={r.odoo_product_id} className="flex items-center gap-2.5 px-3 py-2 border-b border-gray-50 last:border-0">
                          {isChanged ? (
                            <input
                              type="checkbox"
                              checked={selected.has(r.odoo_product_id)}
                              onChange={() => toggleRow(r.odoo_product_id)}
                              className="rounded border-gray-300 text-bassani-600 focus:ring-bassani-500 shrink-0"
                            />
                          ) : <span className="w-[15px] shrink-0" />}
                          <div className="min-w-0 flex-1">
                            <p className="text-xs font-medium text-gray-900 truncate">{r.name}</p>
                            <p className="font-mono text-[10px] text-gray-400">{r.sku || "—"} · #{r.odoo_product_id}</p>
                          </div>
                          <div className="shrink-0 flex items-center gap-1.5 flex-wrap justify-end max-w-[45%]">
                            {r.visible_changed && (
                              <span className={`text-[9px] font-semibold px-2 py-0.5 rounded-full ${r.target_visible ? "bg-green-50 text-green-700" : "bg-red-50 text-red-700"}`}>
                                {r.target_visible ? "+ Add to catalog" : "− Remove from catalog"}
                              </span>
                            )}
                            {r.moq_changed && (
                              <span className="text-[9px] font-semibold px-2 py-0.5 rounded-full bg-blue-50 text-blue-700">
                                MOQ {r.current_moq || "none"} → {r.target_moq || "none"}
                              </span>
                            )}
                            {r.moq_ignored && (
                              <span className="text-[9px] text-amber-600" title="This product's row has an MOQ but is marked No for Reseller Catalog — MOQ is ignored while it isn't visible.">
                                MOQ ignored (not visible)
                              </span>
                            )}
                            {!isChanged && <span className="text-[9px] text-gray-300">No change</span>}
                          </div>
                        </div>
                      );
                    })}
                  </div>
                </>
              )}

              <div className="flex justify-between items-center mt-4">
                <BtnSecondary onClick={() => setStep(STEP.UPLOAD)} disabled={applying}>Back</BtnSecondary>
                <div className="flex gap-2">
                  <BtnSecondary onClick={closeModal} disabled={applying}>Cancel</BtnSecondary>
                  <BtnPrimary onClick={applyImport} loading={applying} disabled={selected.size === 0}>
                    Apply {selected.size > 0 ? `${selected.size} change${selected.size !== 1 ? "s" : ""}` : ""}
                  </BtnPrimary>
                </div>
              </div>
            </div>
          )}
        </Modal>
      )}
    </>
  );
}

const CHIP_COLORS = {
  green: "bg-green-50 text-green-700 border-green-200",
  red:   "bg-red-50 text-red-700 border-red-200",
  blue:  "bg-blue-50 text-blue-700 border-blue-200",
  gray:  "bg-gray-50 text-gray-500 border-gray-200",
  amber: "bg-amber-50 text-amber-700 border-amber-200",
};

function SummaryChip({ color, label }) {
  return (
    <span className={`text-[11px] font-semibold px-2.5 py-1 rounded-full border ${CHIP_COLORS[color]}`}>
      {label}
    </span>
  );
}
