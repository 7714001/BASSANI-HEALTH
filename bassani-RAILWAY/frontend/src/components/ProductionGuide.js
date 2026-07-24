import { useState } from "react";
import { HelpCircle, ArrowDownToLine, ArrowUpFromLine, Scissors, PackageOpen } from "lucide-react";
import { BtnSecondary, Modal } from "./UI";

/* Phase 13.0 — built-in quick reference for the production vault module.
   A plain-language explanation of the Bassani V6 batch numbering standard and
   the vault movement types, so Patricia (or anyone using these pages) never
   needs the paper standard to understand what the system is doing. */

const FAMILY_ROWS = [
  { label: "Single strain",   prefix: "BH + product code", example: "BHDSD-011-100626",    note: "One strain harvested on its own. The product's shortcode follows BH." },
  { label: "Mixed room (API)", prefix: "BHAPI + product code", example: "BHAPIBBY-001-010126", note: "A room holding more than one strain, identified by the main one." },
  { label: "Blend",           prefix: "BHB + product code",  example: "BHBBBY-003-220426",   note: "Two or more batches mixed together. The blend links back to every batch that went into it." },
  { label: "Gummy / product lot", prefix: "BHG + product code", example: "BHGPIN-001-181225", note: "Gummies and similar products received from a supplier and packed here. The code is the flavour's shortcode." },
];

const STAGE_ROWS = [
  { suffix: "D",  label: "Drying — material in the drying room" },
  { suffix: "U",  label: "Unmanicured — dried flower before manicuring" },
  { suffix: "M",  label: "Manicured — trimmed premium flower" },
  { suffix: "P",  label: "Pops — small buds set aside during manicuring (a product, not waste)" },
  { suffix: "T",  label: "Trim — leaf material set aside during manicuring (a product, not waste)" },
  { suffix: "PC / TC", label: "Crushed — pops crushed for standard pre-rolls, trim crushed for budget pre-rolls" },
  { suffix: "PCPR / TCPR", label: "Pre-roll — standard (from pops) or budget (from trim)" },
];

const PACKAGING_ROWS = [
  { suffix: "PCPRPTT / TCPRPTT", label: "Pop top tube (standard / budget pre-roll)" },
  { suffix: "PCPRPJR / TCPRPJR", label: "Jar (standard / budget pre-roll)" },
  { suffix: "MP1G, MP3G, MP5G", label: "Mylar bag 1g / 3g / 5g — manicured flower" },
  { suffix: "PP1G, PP3G, PP5G", label: "Mylar bag 1g / 3g / 5g — pops" },
];

const MOVEMENT_ROWS = [
  { icon: ArrowDownToLine, label: "Receive to Vault",       note: "Stock arriving into the vault: from production, from an external supplier, or an opening balance when first setting up." },
  { icon: PackageOpen,     label: "Issue to Packing",       note: "Stock leaving the vault for the packing room." },
  { icon: ArrowUpFromLine, label: "Issue to Manicuring",    note: "Unmanicured bulk leaving the vault for manicuring." },
  { icon: Scissors,        label: "Return from Manicuring", note: "Manicured flower and trim coming back in. Enter both weights; the system books them in under the -M and -T batch numbers and works out the processing waste for you." },
];

function Section({ title, children }) {
  return (
    <div>
      <h3 className="text-xs font-semibold uppercase tracking-wide text-gray-500 dark:text-gray-400 mb-2">{title}</h3>
      {children}
    </div>
  );
}

export default function ProductionGuideButton() {
  const [open, setOpen] = useState(false);

  return (
    <>
      <BtnSecondary onClick={() => setOpen(true)}>
        <HelpCircle size={14} />
        Guide
      </BtnSecondary>

      {open && (
        <Modal title="Batch Numbers & Vault Guide" onClose={() => setOpen(false)} width="max-w-2xl">
          <div className="space-y-6 text-sm text-gray-600 dark:text-gray-300">

            <Section title="Reading a batch number">
              <div className="bg-gray-50 dark:bg-gray-900 rounded-lg px-4 py-3 mb-2">
                <p className="font-mono text-lg font-semibold tracking-wide">
                  <span className="text-bassani-600 dark:text-bassani-400">BH</span>
                  <span className="text-purple-600 dark:text-purple-400">DSD</span>
                  <span className="text-gray-400">-</span>
                  <span className="text-amber-600 dark:text-amber-400">011</span>
                  <span className="text-gray-400">-</span>
                  <span className="text-sky-600 dark:text-sky-400">100626</span>
                  <span className="text-gray-400">-</span>
                  <span className="text-rose-600 dark:text-rose-400">M</span>
                </p>
                <div className="grid grid-cols-2 sm:grid-cols-5 gap-x-3 gap-y-1 mt-2 text-xs">
                  <span><span className="font-semibold text-bassani-600 dark:text-bassani-400">BH</span> — Bassani Health</span>
                  <span><span className="font-semibold text-purple-600 dark:text-purple-400">DSD</span> — product shortcode (Dosi Si Dos)</span>
                  <span><span className="font-semibold text-amber-600 dark:text-amber-400">011</span> — batch number for that product</span>
                  <span><span className="font-semibold text-sky-600 dark:text-sky-400">100626</span> — date, day-month-year</span>
                  <span><span className="font-semibold text-rose-600 dark:text-rose-400">M</span> — current stage (Manicured)</span>
                </div>
              </div>
              <p className="text-xs text-gray-500 dark:text-gray-400">
                You never build these yourself. The system puts the number together when you create a batch, and updates the stage as material moves. If a batch is not in the picker, it has not been created yet: generate it on the Batch Registry page first.
              </p>
            </Section>

            <Section title="The four batch types">
              <div className="overflow-x-auto">
                <table className="w-full text-xs">
                  <thead>
                    <tr className="text-left text-gray-500 dark:text-gray-400 border-b border-gray-100 dark:border-gray-700">
                      <th className="py-1.5 pr-3">Type</th>
                      <th className="py-1.5 pr-3">Starts with</th>
                      <th className="py-1.5 pr-3">Example</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-gray-100 dark:divide-gray-700">
                    {FAMILY_ROWS.map(r => (
                      <tr key={r.label} className="align-top">
                        <td className="py-2 pr-3 font-medium text-gray-700 dark:text-gray-200 whitespace-nowrap">{r.label}</td>
                        <td className="py-2 pr-3 font-mono whitespace-nowrap">{r.prefix}</td>
                        <td className="py-2 pr-3">
                          <span className="font-mono">{r.example}</span>
                          <span className="block text-gray-400 mt-0.5">{r.note}</span>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </Section>

            <Section title="Stage letters (the part after the last dash)">
              <div className="space-y-1 text-xs">
                {STAGE_ROWS.map(r => (
                  <div key={r.suffix} className="flex gap-3">
                    <span className="font-mono font-semibold text-gray-700 dark:text-gray-200 w-24 shrink-0">-{r.suffix}</span>
                    <span>{r.label}</span>
                  </div>
                ))}
              </div>
              <div className="mt-3 bg-bassani-50 dark:bg-bassani-900/20 border border-bassani-100 dark:border-bassani-800 rounded-lg px-3 py-2 text-xs">
                <span className="font-semibold text-bassani-700 dark:text-bassani-300">The stage letter is replaced, not added to.</span>{" "}
                When unmanicured flower <span className="font-mono">BHDSD-011-100626-U</span> is manicured, it comes back as{" "}
                <span className="font-mono">BHDSD-011-100626-M</span> (plus <span className="font-mono">-T</span> for the trim).
                The rest of the number never changes, so the batch stays traceable through every stage.
              </div>
            </Section>

            <Section title="Finished goods packaging codes">
              <div className="space-y-1 text-xs">
                {PACKAGING_ROWS.map(r => (
                  <div key={r.suffix} className="flex gap-3">
                    <span className="font-mono font-semibold text-gray-700 dark:text-gray-200 w-40 shrink-0">{r.suffix}</span>
                    <span>{r.label}</span>
                  </div>
                ))}
              </div>
            </Section>

            <Section title="The four vault movements">
              <p className="text-xs text-gray-500 dark:text-gray-400 mb-2">
                Flower normally moves: <span className="font-medium">Receive to Vault</span> (unmanicured bulk in) → <span className="font-medium">Issue to Manicuring</span> → <span className="font-medium">Return from Manicuring</span> (comes back as -M plus -T trim) → <span className="font-medium">Issue to Packing</span>. You do not need to remember this: pick the batch and the system marks the next step and greys out anything impossible.
              </p>
              <div className="space-y-2">
                {MOVEMENT_ROWS.map(r => {
                  const Icon = r.icon;
                  return (
                    <div key={r.label} className="flex gap-3 items-start">
                      <span className="w-7 h-7 rounded-lg bg-gray-100 dark:bg-gray-700 flex items-center justify-center shrink-0 mt-0.5">
                        <Icon size={14} className="text-gray-500 dark:text-gray-300" />
                      </span>
                      <div>
                        <p className="text-xs font-semibold text-gray-700 dark:text-gray-200">{r.label}</p>
                        <p className="text-xs text-gray-500 dark:text-gray-400">{r.note}</p>
                      </div>
                    </div>
                  );
                })}
              </div>
            </Section>

            <Section title="Good to know">
              <ul className="list-disc pl-4 space-y-1 text-xs text-gray-500 dark:text-gray-400">
                <li>Your name and the exact time are saved automatically on everything you record. There is nothing extra to fill in.</li>
                <li>Weights are always entered in grams. The screens show large amounts in kilograms automatically.</li>
                <li>A <span className="font-medium text-amber-600 dark:text-amber-400">Staged</span> label means the entry is safely recorded and queued for the stock system. It is written through automatically once the production facility connection is live. Keep recording as normal.</li>
                <li>The Vault Ledger always shows what is in the vault right now, per batch. Click a batch on the Batch Registry page to see its full history.</li>
              </ul>
            </Section>
          </div>
        </Modal>
      )}
    </>
  );
}
