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
  const [uomCats, setUomCats]       = useState([]);
  const [loading, setLoading]       = useState(true);
  const [archiveConfirm, setArchiveConfirm] = useState(null);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const [uomRes, catRes] = await Promise.all([
        api.get("/api/products/uoms"),
        api.get("/api/products/uom-categories"),
      ]);
      setUoms(uomRes.data.uoms || []);
      setUomCats(catRes.data.uom_categories || []);
    } catch { toast.error("Failed to load units of measure"); }
    finally { setLoading(false); }
  }, []);
  useEffect(() => { load(); }, [load]);

  // ── Modal state ──────────────────────────────────────────────────────────
  const [modal, setModal]   = useState(null); // null | "create" | "edit"
  const [editing, setEditing] = useState(null);
  const [form, setForm]     = useState({ name: "", category_id: "", factor: "1", uom_type: "bigger" });
  const [saving, setSaving] = useState(false);

  const openCreate = () => {
    setForm({ name: "", category_id: uomCats[0]?.id?.toString() || "", factor: "1", uom_type: "bigger" });
    setEditing(null);
    setModal("create");
  };

  const openEdit = (u) => {
    setForm({ name: u.name, category_id: u.category_id?.[0]?.toString() || "", factor: "1", uom_type: "bigger" });
    setEditing(u);
    setModal("edit");
  };

  const save = async () => {
    if (!form.name.trim()) return toast.error("Name is required");
    if (modal === "create" && !form.category_id) return toast.error("Select a UOM category");
    setSaving(true);
    try {
      if (modal === "create") {
        await api.post("/api/products/uoms", {
          name: form.name.trim(),
          category_id: parseInt(form.category_id),
          factor: parseFloat(form.factor) || 1,
          uom_type: form.uom_type,
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

  // Group UOMs by their category for display
  const grouped = uoms.reduce((acc, u) => {
    const catName = u.category_id?.[1] || "Uncategorised";
    if (!acc[catName]) acc[catName] = [];
    acc[catName].push(u);
    return acc;
  }, {});

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
                    { id: "cat", header: "Category", cell: ({ row: { original: u } }) => (
                      <Badge color="gray">{u.category_id?.[1] || "—"}</Badge>
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
              <FormGroup label="UOM Category" required>
                <Select value={form.category_id} onChange={e => setForm({ ...form, category_id: e.target.value })}>
                  <option value="">— Select category —</option>
                  {uomCats.map(c => <option key={c.id} value={c.id}>{c.name}</option>)}
                </Select>
              </FormGroup>
              <FormGroup label="Conversion factor">
                <Input
                  type="number"
                  step="0.001"
                  value={form.factor}
                  onChange={e => setForm({ ...form, factor: e.target.value })}
                />
              </FormGroup>
              <FormGroup label="Type">
                <Select value={form.uom_type} onChange={e => setForm({ ...form, uom_type: e.target.value })}>
                  <option value="bigger">Bigger than reference</option>
                  <option value="smaller">Smaller than reference</option>
                </Select>
              </FormGroup>
              <p className="text-xs text-gray-400 mt-1 mb-3">
                Each UOM category has one reference unit. New units are defined relative
                to it using the conversion factor above.
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
