import { useState, useEffect, useCallback } from "react";
import api from "../api";
import toast from "react-hot-toast";
import { Plus, Pencil } from "lucide-react";
import {
  TopBar, DataTable, Modal, FormGroup, Input, Select,
  BtnPrimary, BtnSecondary, LoadingState, EmptyState, fmtDate,
} from "../components/UI";

export default function ProductCategories() {
  const [categories, setCategories] = useState([]);
  const [loading, setLoading]       = useState(true);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const r = await api.get("/api/products/categories");
      setCategories(r.data.categories || []);
    } catch { toast.error("Failed to load categories"); }
    finally { setLoading(false); }
  }, []);
  useEffect(() => { load(); }, [load]);

  // ── Modal state (shared for create + edit) ───────────────────────────────
  const [modal, setModal]     = useState(null); // null | "create" | "edit"
  const [editing, setEditing] = useState(null); // category record being edited
  const [form, setForm]       = useState({ name: "", parent_id: "" });
  const [saving, setSaving]   = useState(false);

  const openCreate = () => {
    setForm({ name: "", parent_id: "" });
    setEditing(null);
    setModal("create");
  };

  const openEdit = (cat) => {
    setForm({
      name: cat.name,
      parent_id: cat.parent_id ? cat.parent_id[0] : "",
    });
    setEditing(cat);
    setModal("edit");
  };

  const save = async () => {
    if (!form.name.trim()) return toast.error("Name is required");
    setSaving(true);
    try {
      const payload = {
        name: form.name.trim(),
        parent_id: form.parent_id ? parseInt(form.parent_id) : null,
      };
      if (modal === "create") {
        await api.post("/api/products/categories", payload);
        toast.success("Category created");
      } else {
        await api.put(`/api/products/categories/${editing.id}`, payload);
        toast.success("Category updated");
      }
      setModal(null);
      load();
    } catch (e) { toast.error(e.response?.data?.detail || "Save failed"); }
    finally { setSaving(false); }
  };

  // Categories available as parent options (exclude the one being edited)
  const parentOptions = categories.filter(c => !editing || c.id !== editing.id);

  return (
    <div className="flex flex-col flex-1 overflow-hidden">
      <TopBar
        title="Product Categories"
        subtitle="Manage Odoo product category hierarchy"
        onRefresh={load}
        actions={<BtnPrimary onClick={openCreate}><Plus size={14} />New Category</BtnPrimary>}
      />
      <main className="flex-1 overflow-y-auto p-6">
        {loading ? <LoadingState /> : categories.length === 0 ? (
          <EmptyState message="No categories found in Odoo." />
        ) : (
          <DataTable
            data={categories}
            onRowClick={openEdit}
            columns={[
              { accessorKey: "complete_name", header: "Category", cell: ({ row: { original: c } }) => (
                <span className="font-medium text-gray-900">{c.complete_name || c.name}</span>
              )},
              { id: "parent", header: "Parent", cell: ({ row: { original: c } }) =>
                c.parent_id
                  ? <span className="text-sm text-gray-500">{c.parent_id[1]}</span>
                  : <span className="text-sm text-gray-300">—</span>
              },
              { id: "edit", header: "", cell: ({ row: { original: c } }) => (
                <button onClick={e => { e.stopPropagation(); openEdit(c); }}
                  className="text-gray-400 hover:text-bassani-600 transition-colors p-1">
                  <Pencil size={13} />
                </button>
              )},
            ]}
          />
        )}
      </main>

      {modal && (
        <Modal
          title={modal === "create" ? "New Category" : `Edit — ${editing?.name}`}
          onClose={() => setModal(null)}
        >
          <FormGroup label="Name" required>
            <Input
              value={form.name}
              onChange={e => setForm({ ...form, name: e.target.value })}
              placeholder="e.g. Pharmaceuticals"
              autoFocus
            />
          </FormGroup>
          <FormGroup label="Parent category">
            <Select
              value={form.parent_id}
              onChange={e => setForm({ ...form, parent_id: e.target.value })}
            >
              <option value="">— None (top-level) —</option>
              {parentOptions.map(c => (
                <option key={c.id} value={c.id}>{c.complete_name || c.name}</option>
              ))}
            </Select>
          </FormGroup>
          <p className="text-xs text-gray-400 mt-1 mb-4">
            Categories are created directly in Odoo. Deleting a category with
            assigned products must be done in Odoo directly.
          </p>
          <div className="flex justify-end gap-2">
            <BtnSecondary onClick={() => setModal(null)} disabled={saving}>Cancel</BtnSecondary>
            <BtnPrimary onClick={save} loading={saving}>
              {modal === "create" ? "Create" : "Save changes"}
            </BtnPrimary>
          </div>
        </Modal>
      )}
    </div>
  );
}
