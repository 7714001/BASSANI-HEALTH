import { useState, useEffect } from "react";
import { Printer, Plus, Trash2, CheckCircle2, AlertTriangle, Loader2, Wifi } from "lucide-react";
import api from "../api";
import toast from "react-hot-toast";
import {
  BtnPrimary, BtnSecondary, BtnDanger,
  FormGroup, Input, Modal, EmptyState, LoadingState,
} from "../components/UI";

function genKey(name) {
  return name.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "") || Date.now().toString();
}

export default function LabelPrinters({ embedded = false }) {
  const [printers,  setPrinters ] = useState([]);
  const [loading,   setLoading  ] = useState(true);
  const [addModal,  setAddModal ] = useState(false);
  const [form,      setForm     ] = useState({ name: "", ip: "", warehouse_id: "" });
  const [saving,    setSaving   ] = useState(false);
  const [testingKey, setTestingKey] = useState(null);
  const [deleteConfirm, setDeleteConfirm] = useState(null);

  const load = async () => {
    setLoading(true);
    try {
      const r = await api.get("/api/labels/printers");
      setPrinters(r.data.printers || []);
    } catch {
      toast.error("Failed to load printers");
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => { load(); }, []);

  const openAdd = () => {
    setForm({ name: "", ip: "", warehouse_id: "" });
    setAddModal(true);
  };

  const savePrinter = async () => {
    if (!form.name.trim()) return toast.error("Printer name required");
    if (!form.ip.trim())   return toast.error("IP address required");
    setSaving(true);
    try {
      const r = await api.put("/api/labels/printers", {
        key:          genKey(form.name),
        name:         form.name.trim(),
        ip:           form.ip.trim(),
        warehouse_id: form.warehouse_id ? parseInt(form.warehouse_id) : null,
      });
      setPrinters(r.data.printers || []);
      setAddModal(false);
      toast.success("Printer saved");
    } catch (e) {
      toast.error(e.response?.data?.detail || "Failed to save printer");
    } finally {
      setSaving(false);
    }
  };

  const testPrinter = async (key) => {
    setTestingKey(key);
    try {
      const r = await api.post(`/api/labels/printers/${key}/test`);
      toast.success(r.data.message);
    } catch (e) {
      toast.error(e.response?.data?.detail || "Printer unreachable — check IP and network");
    } finally {
      setTestingKey(null);
    }
  };

  const doDelete = async () => {
    const key = deleteConfirm?.key;
    setDeleteConfirm(null);
    try {
      const r = await api.delete(`/api/labels/printers/${key}`);
      setPrinters(r.data.printers || []);
      toast.success("Printer removed");
    } catch (e) {
      toast.error(e.response?.data?.detail || "Failed to remove printer");
    }
  };

  const content = (
    <div className="flex-1 overflow-y-auto p-6">
      <div className="max-w-4xl mx-auto w-full space-y-4">
        <div className="flex items-center justify-between">
          <div>
            <p className="text-sm font-semibold text-gray-900">Zebra Label Printers</p>
            <p className="text-xs text-gray-500 mt-0.5">
              Configure Zebra printers for GS1 pharmaceutical label printing. Printers are accessed
              directly over TCP port 9100 from the server — they must be on the same network.
            </p>
          </div>
          <BtnPrimary onClick={openAdd}>
            <Plus size={14} />
            Add Printer
          </BtnPrimary>
        </div>

        {loading && <LoadingState />}

        {!loading && printers.length === 0 && (
          <EmptyState
            icon={Printer}
            heading="No printers configured"
            message="Add a Zebra printer to enable direct GS1 label printing from the Products page."
          />
        )}

        {!loading && printers.length > 0 && (
          <div className="border border-gray-200 rounded-xl overflow-hidden divide-y divide-gray-100 bg-white">
            {printers.map(p => (
              <div key={p.key} className="flex items-center gap-4 px-4 py-3">
                <div className="shrink-0 w-8 h-8 rounded-lg bg-bassani-50 flex items-center justify-center">
                  <Printer size={16} className="text-bassani-600" />
                </div>
                <div className="flex-1 min-w-0">
                  <p className="text-sm font-semibold text-gray-900">{p.name}</p>
                  <p className="text-xs font-mono text-gray-500">{p.ip}:9100</p>
                  {p.warehouse_id && (
                    <p className="text-[10px] text-gray-400 mt-0.5">Warehouse ID: {p.warehouse_id}</p>
                  )}
                </div>
                <div className="flex items-center gap-2 shrink-0">
                  <button
                    onClick={() => testPrinter(p.key)}
                    disabled={testingKey === p.key}
                    className="flex items-center gap-1.5 text-xs font-medium text-bassani-600 hover:text-bassani-800 disabled:opacity-50 px-2.5 py-1.5 rounded-lg border border-bassani-200 hover:border-bassani-300 transition-colors"
                  >
                    {testingKey === p.key
                      ? <Loader2 size={12} className="animate-spin" />
                      : <Wifi size={12} />
                    }
                    Test
                  </button>
                  <BtnDanger size="sm" onClick={() => setDeleteConfirm(p)}>
                    <Trash2 size={13} />
                  </BtnDanger>
                </div>
              </div>
            ))}
          </div>
        )}

        <div className="flex items-start gap-2 bg-amber-50 border border-amber-200 rounded-xl p-3">
          <AlertTriangle size={14} className="text-amber-500 shrink-0 mt-0.5" />
          <p className="text-xs text-amber-700">
            GS1 labels require official GTINs assigned by GS1 South Africa. Dummy GTINs can be used
            for testing — replace them in Odoo's barcode field before going live. Contact GS1 SA
            at gs1za.org to register and receive your company prefix.
          </p>
        </div>
      </div>
    </div>
  );

  return (
    <>
      {embedded ? content : (
        <div className="flex flex-col flex-1 overflow-hidden">{content}</div>
      )}

      {addModal && (
        <Modal title="Add Label Printer" onClose={() => setAddModal(false)}>
          <div className="space-y-3">
            <FormGroup label="Printer name" required>
              <Input
                value={form.name}
                onChange={e => setForm({ ...form, name: e.target.value })}
                placeholder="e.g. Vault Printer 1"
                autoFocus
              />
            </FormGroup>
            <FormGroup label="IP address" required>
              <Input
                value={form.ip}
                onChange={e => setForm({ ...form, ip: e.target.value })}
                placeholder="e.g. 192.168.1.100"
                className="font-mono"
              />
              <p className="text-[10px] text-gray-400 mt-1">
                TCP port 9100 — ensure the printer has a static IP on the server network.
              </p>
            </FormGroup>
            <FormGroup label="Warehouse (optional)">
              <Input
                type="number"
                value={form.warehouse_id}
                onChange={e => setForm({ ...form, warehouse_id: e.target.value })}
                placeholder="Odoo warehouse ID (for filtering)"
              />
            </FormGroup>
            <div className="flex justify-end gap-2 pt-2">
              <BtnSecondary onClick={() => setAddModal(false)}>Cancel</BtnSecondary>
              <BtnPrimary onClick={savePrinter} loading={saving}>Save Printer</BtnPrimary>
            </div>
          </div>
        </Modal>
      )}

      {deleteConfirm && (
        <Modal title="Remove Printer" onClose={() => setDeleteConfirm(null)}>
          <p className="text-sm text-gray-600">
            Remove <strong>{deleteConfirm.name}</strong> ({deleteConfirm.ip})? This cannot be undone.
          </p>
          <div className="flex justify-end gap-2 mt-4">
            <BtnSecondary onClick={() => setDeleteConfirm(null)}>Cancel</BtnSecondary>
            <BtnDanger onClick={doDelete}>Remove</BtnDanger>
          </div>
        </Modal>
      )}
    </>
  );
}
