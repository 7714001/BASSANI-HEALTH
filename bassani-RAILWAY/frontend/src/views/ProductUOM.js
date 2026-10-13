import { useState, useEffect, useCallback } from "react";
import api from "../api";
import toast from "react-hot-toast";
import { Plus, Pencil, Archive } from "lucide-react";
import {
  TopBar, DataTable, Modal, FormGroup, Input, Select,
  BtnPrimary, BtnSecondary, BtnDanger, Badge, LoadingState, EmptyState,
} from "../components/UI";

export default function ProductUOM() {
  const [uoms, setUoms]             = useState([]);
  const [loading, setLoading]       = useState(true);
  const [archiveConfirm, setArchiveConfirm] = useState(null);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const uomRes = await api.get("/api/products/uoms");
      setUoms(uomRes.data.uoms || []);
    } catch { toast.error("Failed to load units of measure"); }
    finally { setLoading(false); }
  }, []);
  useEffect(() => { load(); }, [load]);

  // ── Modal state ──────────────────────────────────────────────────────────
  const [modal, setModal]   = useState(null); // null | "create" | "edit"
  const [editing, setEditing] = useState(null);
  // Each unit is either its own reference unit, or "contains N of" another
  // unit (Odoo 19 removed UoM categories).
  const [form, setForm]     = useState({ name: "", relative_uom_id: "", relative_factor: "1" });
  const [saving, setSaving] = useState(false);

  const openCreate = () => {
    setForm({ name: "", relative_uom_id: "", relative_factor: "1" });
    setEditing(null);
    setModal("create");
  };

  const openEdit = (u) => {
    setForm({ name: u.name, relative_uom_id: "", relative_factor: "1" });
    setEditing(u);
    setModal("edit");
  };

  const save = async () => {
    if (!form.name.trim()) return toast.error("Name is required");
    if (modal === "create" && form.relative_uom_id && !(parseFloat(form.relative_factor) > 0))
      return toast.error("Enter how many it contains (more than 0)");
    setSaving(true);
    try {
      if (modal === "create") {
        await api.post("/api/products/uoms", {
          name: form.name.trim(),
          relative_uom_id: form.relative_uom_id ? parseInt(form.relative_uom_id) : null,
          relative_factor: form.relative_uom_id ? parseFloat(form.relative_factor) : 1,
        });
        toast.success("Unit of measure created");
      } else {
        await api.put(`/api/products/uoms/${editing.id}`, { name: form.name.trim() });
        toast.success("Unit of measure updated");
      }
      setModal(null);
      load();
    } catch (e) { toast.error(e.response?.data?.detail || "Save failed"); }
    finally { setSaving(false); }
  };

  const archive = (u) => setArchiveConfirm(u);

  const doArchive = async () => {
    const u = archiveConfirm;
    setArchiveConfirm(null);
    try {
      await api.put(`/api/products/uoms/${u.id}/archive`);
      toast.success("Archived");
      load();
    } catch (e) { toast.error(e.response?.data?.detail || "Archive failed"); }
  };

  // Group each unit under the reference unit it's defined from; a reference
  // unit heads its own group.
  const grouped = uoms.reduce((acc, u) => {
    const group = u.relative_uom_id?.[1] || u.name;
    if (!acc[group]) acc[group] = [];
    acc[group].push(u);
    return acc;
  }, {});
  const definedAs = (u) => u.relative_uom_id
    ? `Contains ${Number(u.relative_factor)} ${u.relative_uom_id[1]}`
    : "Reference unit";

  const noUoms = uoms.length === 0;

  return (
    <div className="flex flex-col flex-1 overflow-hidden">
      <TopBar
        title="Units of Measure"
        subtitle="Manage Odoo UOM records used on product forms"
        onRefresh={load}
        actions={<BtnPrimary onClick={openCreate}><Plus size={14} />New UOM</BtnPrimary>}
      />
      <main className="flex-1 overflow-y-auto p-6">
        {loading ? <LoadingState /> : noUoms ? (
          <div className="max-w-md mx-auto mt-12 text-center">
            <EmptyState message="No units of measure found." />
            <p className="text-sm text-gray-400 mt-2">
              Units of Measure may be disabled in your Odoo instance. Enable them under
              <strong> Inventory → Configuration → Settings → Units of Measure</strong>,
              then refresh this page.
            </p>
          </div>
        ) : (
          <div className="space-y-6">
            {Object.entries(grouped).sort(([a], [b]) => a.localeCompare(b)).map(([catName, items]) => (
              <div key={catName}>
                <h3 className="text-xs font-bold text-gray-400 uppercase tracking-wider mb-2">{catName}</h3>
                <DataTable
                  data={items}
                  onRowClick={openEdit}
                  columns={[
                    { accessorKey: "name", header: "Unit", cell: ({ row: { original: u } }) => (
                      <span className="font-medium text-gray-900">{u.name}</span>
                    )},
                    { id: "defined", header: "Defined as", cell: ({ row: { original: u } }) => (
                      <Badge color="gray">{definedAs(u)}</Badge>
                    )},
                    { id: "actions", header: "", cell: ({ row: { original: u } }) => (
                      <div className="flex items-center gap-1" onClick={e => e.stopPropagation()}>
                        <button onClick={() => openEdit(u)}
                          className="text-gray-400 hover:text-bassani-600 transition-colors p-1">
                          <Pencil size={13} />
                        </button>
                        <button onClick={() => archive(u)}
                          className="text-gray-400 hover:text-red-500 transition-colors p-1">
                          <Archive size={13} />
                        </button>
                      </div>
                    )},
                  ]}
                />
              </div>
            ))}
          </div>
        )}
      </main>

      {modal && (
        <Modal
          title={modal === "create" ? "New Unit of Measure" : `Edit — ${editing?.name}`}
          onClose={() => setModal(null)}
        >
          <FormGroup label="Name" required>
            <Input
              value={form.name}
              onChange={e => setForm({ ...form, name: e.target.value })}
              placeholder="e.g. Gram, Millilitre, Capsule"
              autoFocus
            />
          </FormGroup>

          {modal === "create" && (
            <>
              <FormGroup label="Based on">
                <Select value={form.relative_uom_id} onChange={e => setForm({ ...form, relative_uom_id: e.target.value })}>
                  <option value="">Nothing, this is a new reference unit</option>
                  {uoms.map(u => <option key={u.id} value={u.id}>{u.name}</option>)}
                </Select>
              </FormGroup>
              {form.relative_uom_id && (
                <FormGroup label="How many does it contain?" required>
                  <Input
                    type="number"
                    step="0.001"
                    min="0"
                    value={form.relative_factor}
                    onChange={e => setForm({ ...form, relative_factor: e.target.value })}
                  />
                </FormGroup>
              )}
              <p className="text-xs text-gray-400 mt-1 mb-3">
                {form.relative_uom_id
                  ? `One ${form.name.trim() || "new unit"} contains ${form.relative_factor || "?"} ${uoms.find(u => String(u.id) === form.relative_uom_id)?.name || ""}. For example, a Box based on Unit that contains 10.`
                  : "A reference unit stands on its own. Other units can then be defined from it."}
              </p>
            </>
          )}

          <div className="flex justify-end gap-2 mt-4">
            <BtnSecondary onClick={() => setModal(null)} disabled={saving}>Cancel</BtnSecondary>
            <BtnPrimary onClick={save} loading={saving}>
              {modal === "create" ? "Create" : "Save changes"}
            </BtnPrimary>
          </div>
        </Modal>
      )}
      {archiveConfirm && (
        <Modal title="Archive Unit of Measure" onClose={() => setArchiveConfirm(null)}>
          <p className="text-sm text-gray-600">Archive <strong>{archiveConfirm.name}</strong>? It will no longer appear in product forms.</p>
          <div className="flex justify-end gap-2 mt-4">
            <BtnSecondary onClick={() => setArchiveConfirm(null)}>Cancel</BtnSecondary>
            <BtnDanger onClick={doArchive}>Archive</BtnDanger>
          </div>
        </Modal>
      )}
    </div>
  );
}
