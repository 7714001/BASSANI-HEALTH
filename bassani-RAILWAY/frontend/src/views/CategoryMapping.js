import { useState, useEffect, useCallback } from "react";
import { useNavigate } from "react-router-dom";
import api from "../api";
import toast from "react-hot-toast";
import { Info, Loader2 } from "lucide-react";
import {
  TopBar, DataTable, Select, SearchBar, FilterPill,
  BtnSecondary, LoadingState, EmptyState,
} from "../components/UI";

// Bulk setup tool for Parent Categories (7.12) — one row per real Odoo
// category, with Parent/Sub Category dropdowns to assign it. Complements
// ParentCategories.js's per-category edit modal (which is better for naming,
// hand-picked products, and preview) — this page is for the one-sitting job
// of mapping every Odoo category at once, mirroring how Bassani actually
// planned their mapping on paper (one row per Odoo category).
export default function CategoryMapping() {
  const navigate = useNavigate();
  const [odooCategories, setOdooCategories] = useState([]);
  const [parentDocs,     setParentDocs    ] = useState([]);
  const [loading,        setLoading       ] = useState(true);
  const [savingId,       setSavingId      ] = useState(null);
  const [search,         setSearch        ] = useState("");
  const [unmappedOnly,   setUnmappedOnly  ] = useState(false);

  const reload = useCallback(async () => {
    setLoading(true);
    try {
      const [catR, pcR] = await Promise.all([
        api.get("/api/products/categories"),
        api.get("/api/parent-categories/"),
      ]);
      setOdooCategories(catR.data.categories || []);
      setParentDocs(pcR.data.categories || []);
    } catch { toast.error("Failed to load categories"); }
    finally { setLoading(false); }
  }, []);

  useEffect(() => { reload(); }, [reload]);

  const docsById     = Object.fromEntries(parentDocs.map(d => [d.id, d]));
  const topLevelDocs = parentDocs.filter(d => !d.parent_id);
  const childrenOf   = (parentId) => parentDocs.filter(d => d.parent_id === parentId);

  // Which doc (if any) currently contains each Odoo category — a category
  // should have exactly one home via this page (a "move," not an "add"); the
  // per-category edit modal's hand-pick flow is the only place many-to-many
  // is actually used (e.g. Specials), so that edge case just shows whichever
  // doc is found first here.
  const categoryToDocId = {};
  for (const d of parentDocs) {
    for (const cid of d.odoo_category_ids || []) {
      if (!(cid in categoryToDocId)) categoryToDocId[cid] = d.id;
    }
  }

  const rows = odooCategories
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

  const filteredRows = rows.filter(r => {
    const label = (r.cat.complete_name || r.cat.name || "").toLowerCase();
    const matchSearch   = !search || label.includes(search.toLowerCase());
    const matchUnmapped = !unmappedOnly || !r.parentId;
    return matchSearch && matchUnmapped;
  });

  const mappedCount = rows.filter(r => r.parentId).length;

  const assign = async (odooCatId, targetId) => {
    setSavingId(odooCatId);
    try {
      await api.put(`/api/parent-categories/category-mapping/${odooCatId}`, { target_id: targetId || null });
      await reload();
    } catch (e) { toast.error(e.response?.data?.detail || "Failed to update mapping"); }
    finally { setSavingId(null); }
  };

  // Picking a parent directly (no sub) assigns straight onto the parent doc.
  const handleParentChange = (catId, newParentId) => assign(catId, newParentId || null);
  // An empty sub means "directly under the parent," not "unassigned" — falls
  // back to the row's current parent rather than clearing the mapping.
  const handleSubChange = (catId, newSubId, parentId) => assign(catId, newSubId || parentId || null);

  return (
    <div className="flex flex-col flex-1 overflow-hidden">
      <TopBar
        title="Category Mapping"
        subtitle={`${mappedCount} of ${rows.length} Odoo categories mapped`}
        onRefresh={reload}
        actions={<BtnSecondary onClick={() => navigate("/catalogue/parent-categories")}>Manage Parent Categories</BtnSecondary>}
      />
      <main className="flex-1 overflow-y-auto p-6">
        <div className="flex items-start gap-2 bg-blue-50 border border-blue-200 rounded-xl p-3 mb-4">
          <Info size={14} className="text-blue-500 shrink-0 mt-0.5" />
          <p className="text-xs text-blue-700">
            <strong>Bulk setup.</strong> Assign every Odoo category to a Parent Category (and, optionally, a
            sub-category within it) in one sitting. Create Parent Categories and their sub-categories first
            under <strong>Manage Parent Categories</strong> — this page only assigns Odoo categories to
            categories that already exist. Portal-only, same as Parent Categories — nothing here touches Odoo.
          </p>
        </div>

        {topLevelDocs.length === 0 && !loading ? (
          <EmptyState
            message="No Parent Categories exist yet. Create at least one (e.g. 'Flower') before mapping Odoo categories to it."
            action={<BtnSecondary onClick={() => navigate("/catalogue/parent-categories")}>Create a Parent Category</BtnSecondary>}
          />
        ) : (
          <>
            <div className="flex flex-wrap items-center gap-3 mb-4">
              <SearchBar value={search} onChange={setSearch} placeholder="Search Odoo categories…" />
              <FilterPill label="Unmapped only" active={unmappedOnly} onClick={() => setUnmappedOnly(v => !v)} />
            </div>

            {loading ? <LoadingState /> : filteredRows.length === 0 ? (
              <EmptyState message="No categories match this filter." />
            ) : (
              <DataTable
                data={filteredRows}
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
                          disabled={savingId === r.cat.id}
                          onChange={e => handleParentChange(r.cat.id, e.target.value)}
                        >
                          <option value="">— Unassigned —</option>
                          {topLevelDocs.map(d => <option key={d.id} value={d.id}>{d.name}</option>)}
                        </Select>
                        {savingId === r.cat.id && <Loader2 size={12} className="animate-spin text-gray-400 shrink-0" />}
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
                          disabled={!r.parentId || children.length === 0 || savingId === r.cat.id}
                          onChange={e => handleSubChange(r.cat.id, e.target.value, r.parentId)}
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
      </main>
    </div>
  );
}
