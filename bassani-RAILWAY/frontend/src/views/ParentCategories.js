import { useState, useEffect, useCallback } from "react";
import api from "../api";
import toast from "react-hot-toast";
import { Plus, Pencil, Info, Search, X, Loader2 } from "lucide-react";
import {
  TopBar, DataTable, Modal, FormGroup, Input, Select, ChipRow, FilterPill, SearchBar,
  BtnPrimary, BtnSecondary, BtnDanger, LoadingState, EmptyState, Badge, parseDisplayName,
} from "../components/UI";
import { MultiSearchableSelect } from "../components/ProductPickerDrawer";

// Removable chip — same visual/interaction idiom as the active-filter chip in
// ResellerCatalog.js / the reseller order cart, reused here for reviewing a
// multi-select without reopening the dropdown for every removal.
function RemovableChip({ label, onRemove }) {
  return (
    <button
      type="button"
      onClick={onRemove}
      className="inline-flex items-center gap-1.5 text-xs font-medium px-2.5 py-1 rounded-full bg-bassani-50 text-bassani-700 border border-bassani-200 shrink-0 hover:bg-bassani-100 transition-colors"
    >
      {label} <X size={11} className="opacity-70" />
    </button>
  );
}

// Search-driven hand-pick list for individually adding product variants to a
// parent category (e.g. a weekly-rotating "Specials" bucket) — a distinct
// interaction from MultiSearchableSelect's small pre-loaded list, since this
// searches the live Odoo catalogue rather than filtering an in-memory array.
function ProductMultiPicker({ selectedIds, labels, onAdd, onRemove }) {
  const [query, setQuery]     = useState("");
  const [results, setResults] = useState([]);
  const [loading, setLoading] = useState(false);

  useEffect(() => {
    if (query.trim().length < 2) { setResults([]); return; }
    setLoading(true);
    const t = setTimeout(async () => {
      try {
        const { data } = await api.get("/api/products/", { params: { search: query, limit: 20 } });
        setResults(data.products || []);
      } catch { setResults([]); }
      finally { setLoading(false); }
    }, 300);
    return () => clearTimeout(t);
  }, [query]);

  return (
    <div>
      <div className="relative">
        <Search size={12} className="absolute left-2.5 top-1/2 -translate-y-1/2 text-gray-400 pointer-events-none" />
        <input
          value={query}
          onChange={e => setQuery(e.target.value)}
          placeholder="Search products or SKU to add…"
          className="w-full text-xs pl-7 pr-3 py-2 border border-gray-200 rounded-lg focus:outline-none focus:ring-1 focus:ring-bassani-300 focus:border-bassani-400 placeholder-gray-400 bg-gray-50/50"
        />
        {loading && <Loader2 size={12} className="absolute right-2.5 top-1/2 -translate-y-1/2 text-gray-400 animate-spin" />}
      </div>

      {results.length > 0 && (
        <div className="mt-2 border border-gray-100 rounded-lg max-h-48 overflow-y-auto">
          {results.map(p => {
            const added = selectedIds.includes(p.id);
            const { base, groups } = parseDisplayName(p.display_name || p.name || "");
            return (
              <div key={p.id} className="flex items-center justify-between gap-2 px-3 py-2 border-b border-gray-50 last:border-0">
                <div className="min-w-0">
                  <p className="text-xs font-medium text-gray-900 truncate">{base}</p>
                  <div className="flex items-center gap-1.5 flex-wrap mt-0.5">
                    {groups.map((g, i) => (
                      <span key={i} className="text-[9px] bg-gray-100 text-gray-500 rounded px-1 py-0.5">{g}</span>
                    ))}
                    <span className="font-mono text-[9px] text-gray-400">{p.default_code || "—"}</span>
                  </div>
                </div>
                <button
                  type="button"
                  onClick={() => added ? onRemove(p.id) : onAdd(p)}
                  className={`shrink-0 text-[10px] font-semibold px-2.5 py-1 rounded-full transition-colors ${
                    added ? "bg-green-50 text-green-700 border border-green-200" : "bg-bassani-600 text-white hover:bg-bassani-700"
                  }`}
                >
                  {added ? "Added" : "+ Add"}
                </button>
              </div>
            );
          })}
        </div>
      )}

      {selectedIds.length > 0 && (
        <div className="mt-3">
          <ChipRow>
            {selectedIds.map(id => (
              <RemovableChip
                key={id}
                label={labels[id] || `#${id}`}
                onRemove={() => onRemove(id)}
              />
            ))}
          </ChipRow>
        </div>
      )}
    </div>
  );
}

export default function ParentCategories() {
  const [activeTab, setActiveTab] = useState("categories"); // "categories" | "mapping"
  const [categories, setCategories] = useState([]);
  const [odooCategoriesRaw, setOdooCategoriesRaw] = useState([]); // [{id, name, complete_name}]
  const [loading, setLoading]       = useState(true);

  const odooCategoryOptions = odooCategoriesRaw.map(c => ({ value: c.id, label: c.complete_name || c.name }));

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const [pcR, catR] = await Promise.all([
        api.get("/api/parent-categories/"),
        api.get("/api/products/categories"),
      ]);
      setCategories(pcR.data.categories || []);
      setOdooCategoriesRaw(catR.data.categories || []);
    } catch { toast.error("Failed to load categories"); }
    finally { setLoading(false); }
  }, []);

  useEffect(() => { load(); }, [load]);

  // ── Modal state (shared for create + edit) ───────────────────────────────
  const [modal, setModal]     = useState(null); // null | "create" | "edit"
  const [editing, setEditing] = useState(null);
  const [form, setForm]       = useState({ name: "", sort_order: 0, odoo_category_ids: [], product_ids: [], active: true, parent_id: "" });
  const [productLabels, setProductLabels] = useState({}); // {id: "Name (Variant)"}
  const [saving, setSaving]   = useState(false);
  const [deleteConfirm, setDeleteConfirm] = useState(null);
  const [deleting, setDeleting] = useState(false);
  const [preview, setPreview] = useState({ count: 0, truncated: false, products: [] });
  const [previewLoading, setPreviewLoading] = useState(false);

  // Live preview of what this parent category will actually contain — lets
  // the admin see the resolved product list (and whether each match is
  // already visible to resellers) before saving. Debounced and keyed off
  // sorted id lists so reordering selections doesn't trigger a re-fetch.
  const catKey  = [...form.odoo_category_ids].sort((a, b) => a - b).join(",");
  const prodKey = [...form.product_ids].sort((a, b) => a - b).join(",");
  useEffect(() => {
    if (!modal) return;
    if (!catKey && !prodKey) { setPreview({ count: 0, truncated: false, products: [] }); return; }
    setPreviewLoading(true);
    const t = setTimeout(async () => {
      try {
        const { data } = await api.post("/api/parent-categories/preview", {
          odoo_category_ids: catKey ? catKey.split(",").map(Number) : [],
          product_ids: prodKey ? prodKey.split(",").map(Number) : [],
        });
        setPreview(data);
      } catch { setPreview({ count: 0, truncated: false, products: [] }); }
      finally { setPreviewLoading(false); }
    }, 400);
    return () => clearTimeout(t);
  }, [modal, catKey, prodKey]);

  // A category already nested can't be offered as a parent (two levels max),
  // and a category with its own children can't be nested under another —
  // mirrors the backend's _validate_parent_id checks so the picker never
  // offers a choice the server would reject.
  const topLevelOptions = categories.filter(c => !c.parent_id && c.id !== editing?.id);
  const hasChildren = editing ? categories.some(c => c.parent_id === editing.id) : false;

  const openCreate = () => {
    setForm({ name: "", sort_order: 0, odoo_category_ids: [], product_ids: [], active: true, parent_id: "" });
    setProductLabels({});
    setEditing(null);
    setModal("create");
  };

  const openEdit = async (cat) => {
    setForm({
      name: cat.name,
      sort_order: cat.sort_order || 0,
      odoo_category_ids: cat.odoo_category_ids || [],
      product_ids: cat.product_ids || [],
      active: cat.active !== false,
      parent_id: cat.parent_id || "",
    });
    setEditing(cat);
    setModal("edit");
    if ((cat.product_ids || []).length > 0) {
      try {
        const { data } = await api.get("/api/products/", { params: { ids: cat.product_ids.join(","), limit: cat.product_ids.length } });
        const map = {};
        (data.products || []).forEach(p => { map[p.id] = p.display_name || p.name; });
        setProductLabels(map);
      } catch { /* labels stay as fallback #id */ }
    } else {
      setProductLabels({});
    }
  };

  const save = async () => {
    if (!form.name.trim()) return toast.error("Name is required");
    setSaving(true);
    try {
      const payload = {
        ...form,
        name: form.name.trim(),
        sort_order: Number(form.sort_order) || 0,
        parent_id: form.parent_id || null,
      };
      if (modal === "create") {
        await api.post("/api/parent-categories/", payload);
        toast.success("Parent category created");
      } else {
        // Optional[str]=None on the backend can't tell "leave unchanged" from
        // "unparent" — clear_parent says so explicitly when the admin picked
        // "— None (top-level) —" on a category that previously had a parent.
        if (!form.parent_id && editing?.parent_id) payload.clear_parent = true;
        await api.put(`/api/parent-categories/${editing.id}`, payload);
        toast.success("Parent category updated");
      }
      setModal(null);
      load();
    } catch (e) { toast.error(e.response?.data?.detail || "Save failed"); }
    finally { setSaving(false); }
  };

  const askDelete = (cat) => { setModal(null); setDeleteConfirm(cat); };
  const doDelete = async () => {
    const target = deleteConfirm;
    setDeleteConfirm(null);
    setDeleting(true);
    try {
      await api.delete(`/api/parent-categories/${target.id}`);
      toast.success("Parent category deleted");
      load();
    } catch (e) { toast.error(e.response?.data?.detail || "Delete failed"); }
    finally { setDeleting(false); }
  };

  const addProduct = (p) => {
    setForm(f => ({ ...f, product_ids: [...f.product_ids, p.id] }));
    setProductLabels(l => ({ ...l, [p.id]: p.display_name || p.name }));
  };
  const removeProduct = (id) => {
    setForm(f => ({ ...f, product_ids: f.product_ids.filter(x => x !== id) }));
  };

  // ── Category Mapping tab — bulk setup: one row per real Odoo category ────
  const [mappingSavingId, setMappingSavingId] = useState(null);
  const [mappingSearch,   setMappingSearch  ] = useState("");
  const [unmappedOnly,    setUnmappedOnly   ] = useState(false);

  const docsById     = Object.fromEntries(categories.map(d => [d.id, d]));
  const topLevelDocs = categories.filter(d => !d.parent_id);
  const childrenOf   = (parentId) => categories.filter(d => d.parent_id === parentId);

  // Which doc (if any) currently contains each Odoo category — a category
  // has exactly one home via this tab (a "move," not an "add"); the edit
  // modal's hand-pick flow is the only place many-to-many is actually used
  // (e.g. Specials), so that edge case just shows whichever doc is found first.
  const categoryToDocId = {};
  for (const d of categories) {
    for (const cid of d.odoo_category_ids || []) {
      if (!(cid in categoryToDocId)) categoryToDocId[cid] = d.id;
    }
  }

  const mappingRows = odooCategoriesRaw
    .map(cat => {
      const containingDoc = categoryToDocId[cat.id] ? docsById[categoryToDocId[cat.id]] : null;
      let parentId = "", subId = "";
      if (containingDoc) {
        if (containingDoc.parent_id) { parentId = containingDoc.parent_id; subId = containingDoc.id; }
        else { parentId = containingDoc.id; }
      }
      return { cat, parentId, subId };
    })
    .sort((a, b) => (a.cat.complete_name || a.cat.name || "").localeCompare(b.cat.complete_name || b.cat.name || ""));

  const filteredMappingRows = mappingRows.filter(r => {
    const label = (r.cat.complete_name || r.cat.name || "").toLowerCase();
    const matchSearch   = !mappingSearch || label.includes(mappingSearch.toLowerCase());
    const matchUnmapped = !unmappedOnly || !r.parentId;
    return matchSearch && matchUnmapped;
  });

  const mappedCount = mappingRows.filter(r => r.parentId).length;

  const assignMapping = async (odooCatId, targetId) => {
    setMappingSavingId(odooCatId);
    try {
      await api.put(`/api/parent-categories/category-mapping/${odooCatId}`, { target_id: targetId || null });
      await load();
    } catch (e) { toast.error(e.response?.data?.detail || "Failed to update mapping"); }
    finally { setMappingSavingId(null); }
  };

  // Picking a parent directly (no sub) assigns straight onto the parent doc.
  const handleMappingParentChange = (catId, newParentId) => assignMapping(catId, newParentId || null);
  // An empty sub means "directly under the parent," not "unassigned" — falls
  // back to the row's current parent rather than clearing the mapping.
  const handleMappingSubChange = (catId, newSubId, parentId) => assignMapping(catId, newSubId || parentId || null);

  return (
    <div className="flex flex-col flex-1 overflow-hidden">
      <TopBar
        title="Parent Categories"
        subtitle={activeTab === "categories" ? "Portal-only grouping for reseller browsing" : `${mappedCount} of ${mappingRows.length} Odoo categories mapped`}
        onRefresh={load}
        actions={activeTab === "categories" ? (
          <BtnPrimary onClick={openCreate}><Plus size={14} />New Parent Category</BtnPrimary>
        ) : null}
      />
      <main className="flex-1 overflow-y-auto p-6">
        <ChipRow>
          <FilterPill label="Parent Categories" active={activeTab === "categories"} onClick={() => setActiveTab("categories")} />
          <FilterPill label="Category Mapping"  active={activeTab === "mapping"}    onClick={() => setActiveTab("mapping")} />
        </ChipRow>

        {activeTab === "categories" ? (
          <>
            <div className="flex items-start gap-2 bg-blue-50 border border-blue-200 rounded-xl p-3 my-4">
              <Info size={14} className="text-blue-500 shrink-0 mt-0.5" />
              <p className="text-xs text-blue-700">
                <strong>Portal-only.</strong> Parent categories exist only in this system to organize how
                resellers browse products, they never read from or write to Odoo. Odoo's own category
                structure is managed separately under <strong>Odoo Categories</strong>.
              </p>
            </div>

            {loading ? <LoadingState /> : categories.length === 0 ? (
              <EmptyState message="No parent categories yet. Create one to start grouping products for resellers." />
            ) : (
              <DataTable
                data={categories}
                onRowClick={openEdit}
                columns={[
                  { accessorKey: "name", header: "Name", cell: ({ row: { original: c } }) => (
                    <span className="font-medium text-gray-900">{c.name}</span>
                  )},
                  { id: "parent", header: "Parent", cell: ({ row: { original: c } }) => (
                    c.parent_id
                      ? <span className="text-sm text-gray-500">{categories.find(x => x.id === c.parent_id)?.name || "—"}</span>
                      : <span className="text-sm text-gray-300">—</span>
                  )},
                  { accessorKey: "sort_order", header: "Sort Order", cell: ({ row: { original: c } }) => (
                    <span className="text-sm text-gray-500">{c.sort_order}</span>
                  )},
                  { id: "odoo_cats", header: "Odoo Categories", cell: ({ row: { original: c } }) => (
                    <span className="text-sm text-gray-500">{(c.odoo_category_ids || []).length}</span>
                  )},
                  { id: "products", header: "Hand-picked Products", cell: ({ row: { original: c } }) => (
                    <span className="text-sm text-gray-500">{(c.product_ids || []).length}</span>
                  )},
                  { id: "active", header: "Status", cell: ({ row: { original: c } }) => (
                    <Badge color={c.active !== false ? "green" : "gray"} label={c.active !== false ? "Active" : "Inactive"} />
                  )},
                  { id: "edit", header: "", cell: ({ row: { original: c } }) => (
                    <button onClick={e => { e.stopPropagation(); openEdit(c); }}
                      className="text-gray-400 hover:text-bassani-600 transition-colors p-1">
                      <Pencil size={13} />
                    </button>
                  )},
                ]}
              />
            )}
          </>
        ) : (
          <>
            <div className="flex items-start gap-2 bg-blue-50 border border-blue-200 rounded-xl p-3 my-4">
              <Info size={14} className="text-blue-500 shrink-0 mt-0.5" />
              <p className="text-xs text-blue-700">
                <strong>Bulk setup.</strong> Assign every Odoo category to a Parent Category (and, optionally, a
                sub-category within it) in one sitting. Create Parent Categories and their sub-categories first
                on the <strong>Parent Categories</strong> tab — this table only assigns Odoo categories to
                categories that already exist.
              </p>
            </div>

            {topLevelDocs.length === 0 && !loading ? (
              <EmptyState
                message="No Parent Categories exist yet. Create at least one (e.g. 'Flower') before mapping Odoo categories to it."
                action={<BtnSecondary onClick={() => setActiveTab("categories")}>Create a Parent Category</BtnSecondary>}
              />
            ) : (
              <>
                <div className="flex flex-wrap items-center gap-3 mb-4">
                  <SearchBar value={mappingSearch} onChange={setMappingSearch} placeholder="Search Odoo categories…" />
                  <FilterPill label="Unmapped only" active={unmappedOnly} onClick={() => setUnmappedOnly(v => !v)} />
                </div>

                {loading ? <LoadingState /> : filteredMappingRows.length === 0 ? (
                  <EmptyState message="No categories match this filter." />
                ) : (
                  <DataTable
                    data={filteredMappingRows}
                    columns={[
                      {
                        id: "category",
                        header: "Odoo Category",
                        accessorFn: r => r.cat.complete_name || r.cat.name || "",
                        cell: ({ row: { original: r } }) => (
                          <span className="text-sm text-gray-900">{r.cat.complete_name || r.cat.name}</span>
                        ),
                      },
                      {
                        id: "parent",
                        header: "Parent Category",
                        enableSorting: false,
                        cell: ({ row: { original: r } }) => (
                          <div className="flex items-center gap-2">
                            <Select
                              value={r.parentId}
                              disabled={mappingSavingId === r.cat.id}
                              onChange={e => handleMappingParentChange(r.cat.id, e.target.value)}
                            >
                              <option value="">— Unassigned —</option>
                              {topLevelDocs.map(d => <option key={d.id} value={d.id}>{d.name}</option>)}
                            </Select>
                            {mappingSavingId === r.cat.id && <Loader2 size={12} className="animate-spin text-gray-400 shrink-0" />}
                          </div>
                        ),
                      },
                      {
                        id: "sub",
                        header: "Sub Category",
                        enableSorting: false,
                        cell: ({ row: { original: r } }) => {
                          const children = r.parentId ? childrenOf(r.parentId) : [];
                          return (
                            <Select
                              value={r.subId}
                              disabled={!r.parentId || children.length === 0 || mappingSavingId === r.cat.id}
                              onChange={e => handleMappingSubChange(r.cat.id, e.target.value, r.parentId)}
                            >
                              <option value="">{children.length ? "— None (directly under parent) —" : "—"}</option>
                              {children.map(d => <option key={d.id} value={d.id}>{d.name}</option>)}
                            </Select>
                          );
                        },
                      },
                    ]}
                  />
                )}
              </>
            )}
          </>
        )}
      </main>

      {modal && (
        <Modal
          title={modal === "create" ? "New Parent Category" : `Edit — ${editing?.name}`}
          onClose={() => setModal(null)}
          width="max-w-xl"
        >
          <FormGroup label="Name" required>
            <Input
              value={form.name}
              onChange={e => setForm({ ...form, name: e.target.value })}
              placeholder="e.g. Flower, Specials"
              autoFocus
            />
          </FormGroup>
          <FormGroup label="Sort order">
            <Input
              type="number"
              value={form.sort_order}
              onChange={e => setForm({ ...form, sort_order: e.target.value })}
            />
          </FormGroup>
          <FormGroup label="Parent category (optional)">
            {hasChildren ? (
              <p className="text-xs text-gray-400 py-2">
                This category has sub-categories of its own, so it can't be nested under another one.
              </p>
            ) : (
              <>
                <Select
                  value={form.parent_id}
                  onChange={e => setForm({ ...form, parent_id: e.target.value })}
                >
                  <option value="">— None (top-level) —</option>
                  {topLevelOptions.map(c => (
                    <option key={c.id} value={c.id}>{c.name}</option>
                  ))}
                </Select>
                <p className="text-[11px] text-gray-400 mt-1.5">
                  Leave as top-level for a category resellers see directly (e.g. "Flower"). Pick a parent
                  to make this a sub-group under it (e.g. "Indoor" under "Flower") — create the top-level
                  category first if it doesn't exist yet.
                </p>
              </>
            )}
          </FormGroup>
          <FormGroup label="Odoo categories in this group">
            <MultiSearchableSelect
              values={form.odoo_category_ids}
              onChange={v => setForm({ ...form, odoo_category_ids: v })}
              options={odooCategoryOptions}
              placeholder="Select categories…"
              searchPlaceholder="Search Odoo categories…"
            />
            {form.odoo_category_ids.length > 0 && (
              <div className="mt-2">
                <ChipRow>
                  {form.odoo_category_ids.map(id => (
                    <RemovableChip
                      key={id}
                      label={odooCategoryOptions.find(c => c.value === id)?.label || `#${id}`}
                      onRemove={() => setForm(f => ({ ...f, odoo_category_ids: f.odoo_category_ids.filter(x => x !== id) }))}
                    />
                  ))}
                </ChipRow>
              </div>
            )}
            <p className="text-[11px] text-gray-400 mt-2">
              Quicker to assign many categories at once from the <strong>Category Mapping</strong> tab instead.
            </p>
          </FormGroup>
          <FormGroup label="Individually hand-picked products/variants">
            <ProductMultiPicker
              selectedIds={form.product_ids}
              labels={productLabels}
              onAdd={addProduct}
              onRemove={removeProduct}
            />
            <p className="text-[11px] text-gray-400 mt-2">
              Adding a product here also makes it visible in the reseller catalog if it isn't already.
            </p>
          </FormGroup>

          <FormGroup label="Preview">
            {hasChildren && (
              <p className="text-[11px] text-amber-600 bg-amber-50 rounded-lg px-2.5 py-1.5 mb-2">
                This preview only shows products added directly to this category — it doesn't include its
                sub-categories, which resellers will still see when they select this category. Edit each
                sub-category to preview its own matches.
              </p>
            )}
            {previewLoading ? (
              <div className="flex items-center gap-2 text-xs text-gray-400 py-3">
                <Loader2 size={12} className="animate-spin" /> Resolving matches…
              </div>
            ) : (form.odoo_category_ids.length === 0 && form.product_ids.length === 0) ? (
              <p className="text-xs text-gray-400 py-2">
                Select Odoo categories or hand-pick products above to preview what resellers will see.
              </p>
            ) : preview.count === 0 ? (
              <p className="text-xs text-gray-400 py-2">No products match this selection yet.</p>
            ) : (
              <div>
                <p className="text-xs text-gray-600 mb-2">
                  <strong>{preview.count}</strong> product{preview.count !== 1 ? "s" : ""} will be grouped under this category
                  {preview.truncated && <span className="text-gray-400"> (showing first {preview.products.length})</span>}.
                </p>
                <div className="border border-gray-100 rounded-lg max-h-56 overflow-y-auto">
                  {preview.products.map(p => {
                    const { base, groups } = parseDisplayName(p.name || "");
                    return (
                      <div key={p.id} className="flex items-center justify-between gap-2 px-3 py-2 border-b border-gray-50 last:border-0">
                        <div className="min-w-0">
                          <p className="text-xs font-medium text-gray-900 truncate">{base}</p>
                          <div className="flex items-center gap-1.5 flex-wrap mt-0.5">
                            {groups.map((g, i) => (
                              <span key={i} className="text-[9px] bg-gray-100 text-gray-500 rounded px-1 py-0.5">{g}</span>
                            ))}
                            <span className="font-mono text-[9px] text-gray-400">{p.sku || "—"}</span>
                            {p.category && <span className="text-[9px] text-gray-400">{p.category}</span>}
                          </div>
                        </div>
                        {p.catalog_visible ? (
                          <span className="shrink-0 text-[9px] font-semibold px-2 py-0.5 rounded-full bg-green-50 text-green-700">Visible</span>
                        ) : p.source === "handpick" ? (
                          <span className="shrink-0 text-[9px] font-semibold px-2 py-0.5 rounded-full bg-blue-50 text-blue-700">Will be added</span>
                        ) : (
                          <span
                            className="shrink-0 text-[9px] font-semibold px-2 py-0.5 rounded-full bg-amber-50 text-amber-700"
                            title="Not in the reseller catalog — toggle it on in Products for resellers to actually see it"
                          >
                            Hidden — not in catalog
                          </span>
                        )}
                      </div>
                    );
                  })}
                </div>
              </div>
            )}
          </FormGroup>

          <FormGroup label="Status">
            <button
              type="button"
              onClick={() => setForm({ ...form, active: !form.active })}
              className={`relative inline-flex h-5 w-9 items-center rounded-full transition-colors ${form.active ? "bg-bassani-600" : "bg-gray-200"}`}
            >
              <span className={`inline-block h-3.5 w-3.5 transform rounded-full bg-white transition-transform ${form.active ? "translate-x-5" : "translate-x-1"}`} />
            </button>
            <span className="ml-2 text-xs text-gray-500 align-middle">{form.active ? "Active (visible to resellers)" : "Inactive (hidden)"}</span>
          </FormGroup>

          <div className="flex justify-between items-center mt-4">
            {modal === "edit" ? (
              <BtnDanger onClick={() => askDelete(editing)} disabled={saving || deleting}>Delete</BtnDanger>
            ) : <span />}
            <div className="flex gap-2">
              <BtnSecondary onClick={() => setModal(null)} disabled={saving}>Cancel</BtnSecondary>
              <BtnPrimary onClick={save} loading={saving}>
                {modal === "create" ? "Create" : "Save changes"}
              </BtnPrimary>
            </div>
          </div>
        </Modal>
      )}

      {deleteConfirm && (
        <Modal title="Delete parent category" onClose={() => setDeleteConfirm(null)}>
          <p className="text-sm text-gray-600">
            Delete <strong>{deleteConfirm.name}</strong>? Products in this group keep their reseller
            catalog visibility, they just stop appearing under this grouping.
          </p>
          <div className="flex justify-end gap-2 mt-4">
            <BtnSecondary onClick={() => setDeleteConfirm(null)}>Cancel</BtnSecondary>
            <BtnDanger onClick={doDelete} loading={deleting}>Delete</BtnDanger>
          </div>
        </Modal>
      )}
    </div>
  );
}
