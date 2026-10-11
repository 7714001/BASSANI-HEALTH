// GMP Supply windows (8.70): settings, request stock from GMP, book stock in
// at GMP, dispatch a GMP delivery to La Farmacia, and backlog reconciliation.
// All Odoo work happens server-side (backend/services/supply_service.py).
import { useState, useEffect } from "react";
import { Loader2, AlertTriangle, CheckCircle } from "lucide-react";
import toast from "react-hot-toast";
import api from "../api";
import { Modal, BtnPrimary, BtnSecondary, FormGroup, Input, Select, fmtDate } from "./UI";
import { ProductSearchPicker } from "./GTINActions";

const qtyFmt = (n) => Number(n || 0).toLocaleString("en-ZA", { maximumFractionDigits: 3 });

// ── Settings ──────────────────────────────────────────────────────────────────
export function SupplySettingsModal({ onClose, onSaved }) {
  const [data, setData] = useState(null);
  const [form, setForm] = useState({ supplier_company_id: "", receiving_warehouse_id: "", supplier_warehouse_id: "" });
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    api.get("/api/supply/settings").then(r => {
      setData(r.data);
      const s = r.data.settings || {}, sug = r.data.options?.suggested || {};
      setForm({
        supplier_company_id: String(s.supplier_company_id || sug.supplier_company_id || ""),
        receiving_warehouse_id: String(s.receiving_warehouse_id || sug.receiving_warehouse_id || ""),
        supplier_warehouse_id: String(s.supplier_warehouse_id || ""),
      });
    }).catch(e => { toast.error(e.response?.data?.detail || "Could not load supply settings"); onClose(); });
  }, []); // eslint-disable-line

  const save = async () => {
    if (!form.supplier_company_id || !form.receiving_warehouse_id) return toast.error("Choose both");
    setSaving(true);
    try {
      const { data: r } = await api.put("/api/supply/settings", {
        supplier_company_id: parseInt(form.supplier_company_id),
        receiving_warehouse_id: parseInt(form.receiving_warehouse_id),
        supplier_warehouse_id: form.supplier_warehouse_id ? parseInt(form.supplier_warehouse_id) : null,
      });
      (r.warnings || []).forEach(w => toast(w, { icon: "⚠️", duration: 9000 }));
      toast.success("Supply settings saved");
      onSaved?.();
      onClose();
    } catch (e) { toast.error(e.response?.data?.detail || "Could not save"); }
    finally { setSaving(false); }
  };

  const opts = data?.options || { companies: [], warehouses: [] };
  const supplierWarehouses = opts.warehouses.filter(w => String(w.company_id) === form.supplier_company_id);
  return (
    <Modal title="GMP Supply settings" onClose={onClose}>
      {!data ? (
        <p className="text-sm text-gray-400 flex items-center gap-2"><Loader2 size={14} className="animate-spin" />Loading…</p>
      ) : (
        <>
          <p className="text-xs text-gray-500 mb-3">
            Which company supplies stock (GMP) and which warehouse receives it and sells to customers (La Farmacia).
            Everything else is read from Odoo's own inter-company setup.
          </p>
          <FormGroup label="Supplying company" required>
            <Select value={form.supplier_company_id} onChange={e => setForm(f => ({ ...f, supplier_company_id: e.target.value, supplier_warehouse_id: "" }))}>
              <option value="">— Select —</option>
              {opts.companies.map(c => <option key={c.id} value={c.id}>{c.name}</option>)}
            </Select>
          </FormGroup>
          <FormGroup label="Supplying warehouse (optional)">
            <Select value={form.supplier_warehouse_id} onChange={e => setForm(f => ({ ...f, supplier_warehouse_id: e.target.value }))}>
              <option value="">Use Odoo's inter-company warehouse</option>
              {supplierWarehouses.map(w => <option key={w.id} value={w.id}>{w.name}</option>)}
            </Select>
          </FormGroup>
          <FormGroup label="Receiving warehouse" required>
            <Select value={form.receiving_warehouse_id} onChange={e => setForm(f => ({ ...f, receiving_warehouse_id: e.target.value }))}>
              <option value="">— Select —</option>
              {opts.warehouses.map(w => <option key={w.id} value={w.id}>{w.name} ({w.company_name})</option>)}
            </Select>
          </FormGroup>
          {data.config && (
            <div className="text-xs text-gray-600 bg-gray-50 rounded-lg px-3 py-2 space-y-0.5">
              <p>Current: <strong>{data.config.supplier_warehouse_name}</strong> ({data.config.supplier_company_name}) supplies <strong>{data.config.receiving_warehouse_name}</strong>.</p>
              <p>Odoo creates GMP's sales orders automatically: <strong>{data.config.auto_sales_orders ? "Yes" : "No"}</strong>. Receipts sync from deliveries: <strong>{data.config.receipt_sync ? "Yes" : "No"}</strong>.</p>
            </div>
          )}
          {data.error && <p className="text-xs text-amber-700 mt-2">{data.error}</p>}
          <div className="flex justify-end gap-2 mt-4">
            <BtnSecondary onClick={onClose} disabled={saving}>Cancel</BtnSecondary>
            <BtnPrimary onClick={save} loading={saving}>Save</BtnPrimary>
          </div>
        </>
      )}
    </Modal>
  );
}

// ── Request stock from GMP ────────────────────────────────────────────────────
export function RequestStockModal({ rows, supplierName, onClose, onDone }) {
  const [lines, setLines] = useState(() => rows.map(r => ({
    product_id: r.product_id, product_name: r.product_name, qty: String(r.uncovered || r.still_needed || 0),
    orders: r.orders.map(o => o.order_name).filter(Boolean),
  })));
  const [note, setNote] = useState("");
  const [saving, setSaving] = useState(false);
  const [result, setResult] = useState(null);

  const submit = async () => {
    const payload = lines.filter(l => parseFloat(l.qty) > 0);
    if (!payload.length) return toast.error("Enter a quantity for at least one product");
    setSaving(true);
    try {
      const { data } = await api.post("/api/supply/request", {
        lines: payload.map(l => ({ product_id: l.product_id, qty: parseFloat(l.qty) })),
        origin_orders: [...new Set(payload.flatMap(l => l.orders))],
        note: note.trim() || undefined,
      });
      setResult(data);
      if (data.warning) toast(data.warning, { icon: "⚠️", duration: 10000 });
      else toast.success(`Requested from ${supplierName}: ${data.purchase_order}`);
      onDone?.();
    } catch (e) { toast.error(e.response?.data?.detail || "Request failed"); }
    finally { setSaving(false); }
  };

  return (
    <Modal title={`Request stock from ${supplierName}`} onClose={onClose} width="max-w-2xl">
      {result ? (
        <div className="space-y-2">
          <p className="text-sm text-gray-700 flex items-center gap-2"><CheckCircle size={15} className="text-green-600" />
            Purchase order <strong>{result.purchase_order}</strong> created{result.supplier_sale_order ? <> and {supplierName}'s sales order <strong>{result.supplier_sale_order}</strong> created by Odoo.</> : "."}
          </p>
          {result.warning && <p className="text-xs text-amber-700">{result.warning}</p>}
          <div className="flex justify-end mt-3"><BtnPrimary onClick={onClose}>Done</BtnPrimary></div>
        </div>
      ) : (
        <>
          <p className="text-xs text-gray-500 mb-3">
            Creates La Farmacia's purchase order to {supplierName}, with the waiting customer orders recorded as its source.
            Odoo then creates {supplierName}'s sales order and delivery automatically. Quantities default to what isn't already covered.
          </p>
          <div className="border border-gray-100 rounded-lg overflow-hidden max-h-[45vh] overflow-y-auto mb-3">
            <table className="w-full text-sm">
              <thead className="bg-gray-50 text-xs text-gray-500"><tr>
                <th className="px-3 py-2 text-left">Product</th><th className="px-3 py-2 text-left">For orders</th><th className="px-3 py-2 text-right w-32">Quantity</th>
              </tr></thead>
              <tbody className="divide-y divide-gray-50">
                {lines.map((l, i) => (
                  <tr key={l.product_id}>
                    <td className="px-3 py-2 text-gray-800">{l.product_name}</td>
                    <td className="px-3 py-2 text-xs text-gray-500">{l.orders.join(", ") || "—"}</td>
                    <td className="px-3 py-2 text-right">
                      <input type="number" min="0" step="any" value={l.qty}
                        onChange={e => setLines(ls => ls.map((x, j) => j === i ? { ...x, qty: e.target.value } : x))}
                        className="w-28 text-right text-sm border border-gray-200 rounded-lg px-2 py-1" />
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          <FormGroup label="Note for GMP (optional)">
            <Input value={note} onChange={e => setNote(e.target.value)} placeholder="e.g. Urgent, customer collecting Friday" />
          </FormGroup>
          <div className="flex justify-end gap-2 mt-4">
            <BtnSecondary onClick={onClose} disabled={saving}>Cancel</BtnSecondary>
            <BtnPrimary onClick={submit} loading={saving}>Create Request</BtnPrimary>
          </div>
        </>
      )}
    </Modal>
  );
}

// Batch picker: existing batches at a location, or a new batch number.
function BatchField({ productId, locationId, value, onChange, allowNew = true }) {
  const [lots, setLots] = useState(null);
  useEffect(() => {
    if (!productId) { setLots([]); return; }
    api.get(`/api/products/${productId}/lots`, { params: locationId ? { location_id: locationId } : {} })
      .then(r => setLots(r.data.lots || r.data || []))
      .catch(() => setLots([]));
  }, [productId, locationId]);
  const isNew = value?.mode === "new";
  return (
    <div className="space-y-2">
      <Select value={isNew ? "__new__" : (value?.lot_id ? String(value.lot_id) : "")}
        onChange={e => e.target.value === "__new__" ? onChange({ mode: "new", lot_name: "" })
          : onChange({ mode: "existing", lot_id: e.target.value ? parseInt(e.target.value) : null,
                       lot_name: (lots || []).find(l => String(l.lot_id || l.id) === e.target.value)?.lot_name || (lots || []).find(l => String(l.lot_id || l.id) === e.target.value)?.name })}>
        <option value="">{lots === null ? "Loading batches…" : "— Select batch —"}</option>
        {(lots || []).map(l => (
          <option key={l.lot_id || l.id} value={l.lot_id || l.id}>{l.lot_name || l.name} ({qtyFmt(l.qty ?? l.quantity)} on hand{l.expiration_date ? `, exp ${fmtDate(l.expiration_date)}` : ""})</option>
        ))}
        {allowNew && <option value="__new__">+ New batch number…</option>}
      </Select>
      {isNew && <Input value={value.lot_name} onChange={e => onChange({ ...value, lot_name: e.target.value })} placeholder="Batch number" autoFocus />}
    </div>
  );
}

// ── Book stock in at GMP ──────────────────────────────────────────────────────
// Batch rule (2026-10-11): stock is booked in on a batch registered in the
// Batch Registry / S6 Receiving, or on a batch already in Odoo. New batch
// names are never typed here; they come from the Batch Registry generator.
// Imports still awaiting Responsible Pharmacist release can't be used.
export function BookInModal({ initialProduct = null, supplierName, onClose, onDone }) {
  const [product, setProduct] = useState(initialProduct);
  const [opts, setOpts] = useState(null);
  const [choice, setChoice] = useState({ kind: null, value: "" }); // kind: registered | existing
  const [qty, setQty] = useState("");
  const [expiry, setExpiry] = useState("");
  const [reason, setReason] = useState("");
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    setOpts(null); setChoice({ kind: null, value: "" });
    if (!product) return;
    api.get("/api/supply/book-in/batches", { params: { product_id: product.id } })
      .then(r => setOpts(r.data))
      .catch(e => { toast.error(e.response?.data?.detail || "Could not load batches"); setOpts({ tracking: "lot", registered: [], existing: [] }); });
  }, [product]);

  const tracked = opts && opts.tracking !== "none";
  const existingNames = new Set((opts?.existing || []).map(l => l.name));
  // A registered batch that's already an Odoo batch is listed once, under registered.
  const existingOnly = (opts?.existing || []).filter(l => !(opts?.registered || []).some(r => r.batch_id === l.name));
  const chosenRegistered = choice.kind === "registered" ? (opts?.registered || []).find(r => r.batch_id === choice.value) : null;

  const submit = async () => {
    if (!product) return toast.error("Choose the product");
    if (!(parseFloat(qty) > 0)) return toast.error("Enter a quantity above zero");
    if (tracked && !choice.value) return toast.error("Choose the batch");
    if (!reason.trim()) return toast.error("Give a reason");
    setSaving(true);
    try {
      const { data } = await api.post("/api/supply/book-in", {
        product_id: product.id, qty: parseFloat(qty), reason: reason.trim(),
        registry_batch_id: choice.kind === "registered" ? choice.value : undefined,
        odoo_lot_id: choice.kind === "existing" ? parseInt(choice.value) : undefined,
        expiration_date: choice.kind === "registered" && expiry ? expiry : undefined,
      });
      toast.success(`Booked in ${qtyFmt(qty)} of ${data.product_name}${data.lot_name ? ` (batch ${data.lot_name})` : ""}. On hand now ${qtyFmt(data.after)}.`);
      onDone?.();
      onClose();
    } catch (e) { toast.error(e.response?.data?.detail || "Book-in failed"); }
    finally { setSaving(false); }
  };

  return (
    <Modal title={`Book stock in at ${supplierName}`} onClose={onClose} width="max-w-2xl">
      <div className="mb-3 rounded-lg border border-amber-200 bg-amber-50 px-3 py-2 flex gap-2">
        <AlertTriangle size={14} className="text-amber-600 shrink-0 mt-0.5" />
        <p className="text-xs text-amber-800">
          Adds stock at {supplierName} in Odoo (a stock adjustment) for finished product that's physically there but not yet in Odoo.
          It's recorded with your name and reason.
        </p>
      </div>
      <FormGroup label="Product" required>
        <ProductSearchPicker value={product} onChange={setProduct} autoFocus={!initialProduct} />
      </FormGroup>

      {product && !opts && <p className="text-xs text-gray-400 flex items-center gap-2 mb-3"><Loader2 size={12} className="animate-spin" />Loading batches…</p>}
      {product && opts && tracked && (
        <FormGroup label="Batch" required>
          <div className="space-y-2">
            <div className={`rounded-lg border px-3 py-2 ${choice.kind === "registered" ? "border-bassani-300 bg-bassani-50" : "border-gray-200"}`}>
              <p className="text-xs font-semibold text-gray-700 mb-1">Registered batch (Batch Registry or S6 Receiving)</p>
              {opts.registered.length === 0 ? (
                <p className="text-xs text-gray-500">
                  {opts.product_linked
                    ? "No batches registered for this product yet. Generate one in Production, Batch Registry (or receive it in S6 Receiving if it's imported)."
                    : "This product isn't linked to a Batch Registry product yet. Link it under Production, Batch Registry, Manage Products, then generate its batch."}
                </p>
              ) : (
                <Select value={choice.kind === "registered" ? choice.value : ""} onChange={e => setChoice({ kind: e.target.value ? "registered" : null, value: e.target.value })}>
                  <option value="">— Select a registered batch —</option>
                  {opts.registered.map(r => (
                    <option key={r.batch_id} value={r.batch_id} disabled={!!r.quarantine_block}>
                      {r.batch_id}{r.family === "import" ? " (import)" : ""}{existingNames.has(r.batch_id) ? " · in Odoo" : ""}{r.quarantine_block ? " · awaiting RP release" : ""}
                    </option>
                  ))}
                </Select>
              )}
            </div>
            <div className={`rounded-lg border px-3 py-2 ${choice.kind === "existing" ? "border-bassani-300 bg-bassani-50" : "border-gray-200"}`}>
              <p className="text-xs font-semibold text-gray-700 mb-1">Batch already in Odoo</p>
              {existingOnly.length === 0 ? (
                <p className="text-xs text-gray-500">No other batches for this product in Odoo.</p>
              ) : (
                <Select value={choice.kind === "existing" ? choice.value : ""} onChange={e => setChoice({ kind: e.target.value ? "existing" : null, value: e.target.value })}>
                  <option value="">— Select an existing batch —</option>
                  {existingOnly.map(l => (
                    <option key={l.lot_id} value={l.lot_id}>{l.name} ({qtyFmt(l.qty_here)} at {supplierName}{l.expiration_date ? `, exp ${fmtDate(l.expiration_date)}` : ""})</option>
                  ))}
                </Select>
              )}
            </div>
            <p className="text-[11px] text-gray-400">New batch numbers are only created by the Batch Registry generator, so every batch follows the standard.</p>
          </div>
        </FormGroup>
      )}
      {chosenRegistered && !existingNames.has(chosenRegistered.batch_id) && (
        <FormGroup label="Expiry date (optional)">
          <Input type="date" value={expiry} onChange={e => setExpiry(e.target.value)} />
          <p className="text-[11px] text-gray-400 mt-1">This batch will be created in Odoo now; set its expiry if it has one.</p>
        </FormGroup>
      )}
      {product && opts && !tracked && <p className="text-xs text-gray-500 mb-3">This product isn't batch-tracked, so no batch is needed.</p>}

      <FormGroup label="Quantity to add" required><Input type="number" min="0" step="any" value={qty} onChange={e => setQty(e.target.value)} /></FormGroup>
      <FormGroup label="Reason" required><Input value={reason} onChange={e => setReason(e.target.value)} placeholder="e.g. Production batch completed, packed 10 Oct" /></FormGroup>
      <div className="flex justify-end gap-2 mt-4">
        <BtnSecondary onClick={onClose} disabled={saving}>Cancel</BtnSecondary>
        <BtnPrimary onClick={submit} loading={saving} disabled={!product || !opts || (tracked && !choice.value)}>Book In</BtnPrimary>
      </div>
    </Modal>
  );
}

// ── Dispatch a GMP delivery to La Farmacia ────────────────────────────────────
export function DispatchModal({ delivery, supplierLocationId, receivingName, onClose, onDone, onBookIn }) {
  const [lines, setLines] = useState(() => delivery.lines.flatMap(l => l.move_lines.map(ml => ({
    move_line_id: ml.move_line_id, product_id: l.product_id, product_name: l.product_name,
    reserved: ml.quantity, quantity: String(ml.quantity), lot_id: ml.lot_id, lot_name: ml.lot_name, changeLot: false,
  }))));
  const [confirmed, setConfirmed] = useState(false);
  const [saving, setSaving] = useState(false);
  const unreserved = delivery.lines.filter(l => l.reserved < l.demand - 0.0001);
  const update = (id, patch) => setLines(ls => ls.map(l => l.move_line_id === id ? { ...l, ...patch } : l));

  const submit = async () => {
    for (const l of lines) {
      const q = parseFloat(l.quantity || 0);
      if (q < 0 || q > l.reserved + 0.0001) return toast.error(`${l.product_name}: dispatch between 0 and ${qtyFmt(l.reserved)}`);
    }
    setSaving(true);
    try {
      const { data } = await api.post("/api/supply/dispatch", {
        picking_id: delivery.picking_id,
        lines: lines.map(l => ({ move_line_id: l.move_line_id, quantity: parseFloat(l.quantity || 0), lot_id: l.lot_id || undefined })),
      });
      if (data.warning) toast(data.warning, { icon: "⚠️", duration: 12000 });
      toast.success(`${data.picking} dispatched${data.received?.length ? `, received at ${receivingName} (${data.received.join(", ")})` : ""}.`
        + (data.backorders_requeued ? ` ${data.backorders_requeued} backorder(s) back on the packing board.` : ""), { duration: 8000 });
      onDone?.();
      onClose();
    } catch (e) { toast.error(e.response?.data?.detail || "Dispatch failed"); }
    finally { setSaving(false); }
  };

  return (
    <Modal title={`Dispatch ${delivery.name} to ${receivingName}`} onClose={onClose} width="max-w-3xl">
      <p className="text-xs text-gray-500 mb-3">
        Purchase order {delivery.purchase_order || "—"} · GMP order {delivery.sale_order || "—"}. Dispatching books the stock out of GMP and
        into {receivingName}, then reserves it for waiting customer orders. Reduce a quantity to send less; the rest stays on a GMP backorder.
      </p>
      {lines.length === 0 ? (
        <div className="rounded-lg border border-amber-200 bg-amber-50 px-3 py-3 text-sm text-amber-800">
          Nothing on this delivery is reserved at GMP, because Odoo shows no GMP stock for it. Book the stock in at GMP first.
          {onBookIn && <div className="mt-2"><BtnSecondary size="sm" onClick={onBookIn}>Book Stock In</BtnSecondary></div>}
        </div>
      ) : (
        <div className="border border-gray-100 rounded-lg overflow-hidden max-h-[50vh] overflow-y-auto">
          <table className="w-full text-sm">
            <thead className="bg-gray-50 text-xs text-gray-500"><tr>
              <th className="px-3 py-2 text-left">Product</th><th className="px-3 py-2 text-left">Batch</th>
              <th className="px-3 py-2 text-right">Reserved</th><th className="px-3 py-2 text-right w-32">Dispatch</th>
            </tr></thead>
            <tbody className="divide-y divide-gray-50">
              {lines.map(l => (
                <tr key={l.move_line_id} className="align-top">
                  <td className="px-3 py-2 text-gray-800">{l.product_name}</td>
                  <td className="px-3 py-2 min-w-[14rem]">
                    {l.changeLot ? (
                      <BatchField productId={l.product_id} locationId={supplierLocationId} allowNew={false}
                        value={{ mode: "existing", lot_id: l.lot_id }}
                        onChange={v => update(l.move_line_id, { lot_id: v.lot_id, lot_name: v.lot_name })} />
                    ) : (
                      <span className="text-xs text-gray-700">{l.lot_name || "No batch"}
                        <button type="button" onClick={() => update(l.move_line_id, { changeLot: true })} className="ml-2 text-bassani-700 hover:underline">Change</button>
                      </span>
                    )}
                  </td>
                  <td className="px-3 py-2 text-right text-gray-500">{qtyFmt(l.reserved)}</td>
                  <td className="px-3 py-2 text-right">
                    <input type="number" min="0" step="any" value={l.quantity} onChange={e => update(l.move_line_id, { quantity: e.target.value })}
                      className="w-28 text-right text-sm border border-gray-200 rounded-lg px-2 py-1" />
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
      {unreserved.length > 0 && lines.length > 0 && (
        <p className="text-xs text-amber-700 mt-2">
          Not reserved at GMP, so staying on a GMP backorder: {unreserved.map(l => `${l.product_name} (${qtyFmt(l.demand - l.reserved)})`).join(", ")}.
        </p>
      )}
      {lines.length > 0 && (
        <label className="flex items-start gap-2 mt-3 text-sm text-gray-700 cursor-pointer">
          <input type="checkbox" checked={confirmed} onChange={e => setConfirmed(e.target.checked)} className="mt-0.5 accent-bassani-600" />
          This stock has physically left GMP for {receivingName}.
        </label>
      )}
      <div className="flex justify-end gap-2 mt-4">
        <BtnSecondary onClick={onClose} disabled={saving}>Cancel</BtnSecondary>
        {lines.length > 0 && <BtnPrimary onClick={submit} loading={saving} disabled={!confirmed}>Dispatch</BtnPrimary>}
      </div>
    </Modal>
  );
}

// ── Backlog reconciliation ────────────────────────────────────────────────────
export function ReconcileModal({ onClose, onDone }) {
  const [data, setData] = useState(null);
  const [receive, setReceive] = useState(new Set());
  const [dispatch, setDispatch] = useState(new Set());
  const [confirmText, setConfirmText] = useState("");
  const [saving, setSaving] = useState(false);
  const [results, setResults] = useState(null);

  useEffect(() => {
    api.get("/api/supply/reconcile/preview").then(r => setData(r.data))
      .catch(e => { toast.error(e.response?.data?.detail || "Could not load"); onClose(); });
  }, []); // eslint-disable-line

  const toggle = (set, setter, id) => setter(s => { const n = new Set(s); n.has(id) ? n.delete(id) : n.add(id); return n; });

  const submit = async () => {
    setSaving(true);
    try {
      const { data: r } = await api.post("/api/supply/reconcile", {
        receive_picking_ids: [...receive], dispatch_picking_ids: [...dispatch], confirmation: confirmText,
      });
      setResults(r);
      if (r.failed) toast.error(`${r.ok} done, ${r.failed} failed. See the list.`, { duration: 8000 });
      else toast.success(`${r.ok} documents completed`);
      onDone?.();
    } catch (e) { toast.error(e.response?.data?.detail || "Reconciliation failed"); }
    finally { setSaving(false); }
  };

  const total = receive.size + dispatch.size;
  return (
    <Modal title="Reconcile GMP to La Farmacia backlog" onClose={onClose} width="max-w-3xl">
      {!data ? (
        <p className="text-sm text-gray-400 flex items-center gap-2"><Loader2 size={14} className="animate-spin" />Checking Odoo…</p>
      ) : results ? (
        <div>
          <ul className="space-y-1 max-h-[55vh] overflow-y-auto text-sm">
            {results.results.map(r => (
              <li key={`${r.action}-${r.picking_id}`} className={r.ok ? "text-gray-700" : "text-red-700"}>
                {r.ok ? "✓" : "✗"} {r.name || `#${r.picking_id}`}: {r.ok ? r.action : r.error}
                {r.backorder && <span className="text-gray-500"> (rest on {r.backorder})</span>}
                {r.receipt_errors?.length > 0 && <span className="text-amber-700"> · receipt: {r.receipt_errors.join("; ")}</span>}
              </li>
            ))}
          </ul>
          {results.backorders_requeued > 0 && <p className="text-xs text-green-700 mt-2">{results.backorders_requeued} customer backorder(s) went back on the packing board.</p>}
          <div className="flex justify-end mt-4"><BtnPrimary onClick={onClose}>Done</BtnPrimary></div>
        </div>
      ) : (
        <>
          <div className="mb-3 rounded-lg border border-red-200 bg-red-50 px-3 py-2 flex gap-2">
            <AlertTriangle size={14} className="text-red-600 shrink-0 mt-0.5" />
            <p className="text-xs text-red-800">
              Only tick documents for stock that has <strong>physically arrived at {data.receiving_company_name}</strong>. Completing them books
              the stock in Odoo. If something never arrived, leave it unticked and ask whoever manages Odoo whether to cancel it.
            </p>
          </div>

          <h4 className="text-sm font-semibold text-gray-800 mt-2">In transit, never received ({data.transit_receipts.length})</h4>
          <p className="text-xs text-gray-500 mb-1">Odoo already shows this stock as having left {data.supplier_company_name}.</p>
          <div className="border border-gray-100 rounded-lg divide-y divide-gray-50 max-h-44 overflow-y-auto mb-3">
            {data.transit_receipts.length === 0 && <p className="text-xs text-gray-400 px-3 py-2">None.</p>}
            {data.transit_receipts.map(r => (
              <label key={r.picking_id} className="flex items-center gap-3 px-3 py-2 text-sm cursor-pointer hover:bg-gray-50">
                <input type="checkbox" checked={receive.has(r.picking_id)} onChange={() => toggle(receive, setReceive, r.picking_id)} className="accent-bassani-600" />
                <span className="font-mono text-xs">{r.name}</span>
                <span className="text-xs text-gray-500">{r.origin || "—"} · {r.lines} lines · {qtyFmt(r.qty)} units · since {fmtDate(r.created)}</span>
              </label>
            ))}
          </div>

          <h4 className="text-sm font-semibold text-gray-800">GMP deliveries with stock reserved ({data.dispatchable.length})</h4>
          <p className="text-xs text-gray-500 mb-1">Dispatches what's reserved; anything else stays on a GMP backorder.</p>
          <div className="border border-gray-100 rounded-lg divide-y divide-gray-50 max-h-44 overflow-y-auto mb-3">
            {data.dispatchable.length === 0 && <p className="text-xs text-gray-400 px-3 py-2">None.</p>}
            {data.dispatchable.map(d => (
              <label key={d.picking_id} className="flex items-center gap-3 px-3 py-2 text-sm cursor-pointer hover:bg-gray-50">
                <input type="checkbox" checked={dispatch.has(d.picking_id)} onChange={() => toggle(dispatch, setDispatch, d.picking_id)} className="accent-bassani-600" />
                <span className="font-mono text-xs">{d.name}</span>
                <span className="text-xs text-gray-500">{d.purchase_order || "—"} · {qtyFmt(d.reserved)} of {qtyFmt(d.demand)} reserved · since {fmtDate(d.created)}</span>
              </label>
            ))}
          </div>

          <p className="text-xs text-gray-600">
            <strong>{data.waiting_count}</strong> GMP deliveries have nothing reserved because Odoo shows no GMP stock for them. Book the stock in at GMP
            (then dispatch from GMP Deliveries), or ask whoever manages Odoo to cancel any that are no longer needed.
          </p>

          <FormGroup label='Type ARRIVED to confirm' >
            <Input value={confirmText} onChange={e => setConfirmText(e.target.value)} placeholder="ARRIVED" />
          </FormGroup>
          <div className="flex justify-end gap-2 mt-2">
            <BtnSecondary onClick={onClose} disabled={saving}>Cancel</BtnSecondary>
            <BtnPrimary onClick={submit} loading={saving} disabled={!total || confirmText.trim().toUpperCase() !== "ARRIVED"}>
              Complete {total || ""}
            </BtnPrimary>
          </div>
        </>
      )}
    </Modal>
  );
}
