import { useState, useEffect, useCallback } from "react";
import api from "../api";
import toast from "react-hot-toast";
import { TopBar, DataTable, SearchBar, fmtR, parseDisplayName } from "../components/UI";
import { SearchableSelect } from "../components/ProductPickerDrawer";

const stockColor = (qty) =>
  qty <= 0   ? "text-red-600 font-semibold"
  : qty < 10 ? "text-amber-600 font-semibold"
             : "text-bassani-700 font-semibold";

const getVariantLabel = (p) => {
  const { groups } = parseDisplayName((p.display_name || p.name) || "");
  return groups.length > 0 ? groups.join(" / ") : null;
};

export default function ResellerCatalog() {
  const [products,   setProducts  ] = useState([]);
  const [total,      setTotal     ] = useState(0);
  const [loading,    setLoading   ] = useState(true);
  const [search,     setSearch    ] = useState("");
  const [cat,        setCat       ] = useState("all"); // selected top-level parent-category id
  const [subCat,     setSubCat    ] = useState("all"); // selected child (brand/grade) id
  const [variant,    setVariant   ] = useState("all");
  const [categories, setCategories] = useState([]);
  const [moq,        setMoq       ] = useState({});
  const [pagination, setPagination] = useState({ pageIndex: 0, pageSize: 25 });
  const [sorting,    setSorting   ] = useState([{ id: "name", desc: false }]);

  useEffect(() => {
    api.get("/api/parent-categories/")
      .then(r => setCategories(r.data.categories || []))
      .catch(() => {});
    api.get("/api/reseller-catalog/")
      .then(r => setMoq(r.data.moq || {}))
      .catch(() => {});
  }, []);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const sort   = sorting[0];
      const params = { limit: pagination.pageSize, offset: pagination.pageIndex * pagination.pageSize };
      if (sort)   { params.sort_by = sort.id; params.sort_dir = sort.desc ? "desc" : "asc"; }
      if (search) params.search   = search;
      const effectiveCat = subCat !== "all" ? subCat : cat;
      if (effectiveCat !== "all") params.parent_category_id = effectiveCat;
      const { data } = await api.get("/api/products/", { params });
      setProducts(data.products || []);
      setTotal(data.total || 0);
    } catch {
      toast.error("Failed to load catalog");
    } finally {
      setLoading(false);
    }
  }, [search, cat, subCat, pagination, sorting]);

  useEffect(() => { load(); }, [load]);

  // Brand/Grade dropdown — only populated (and only shown) when the selected
  // top-level category actually has sub-categories, e.g. Flower -> Indoor /
  // Exotic / Greendoor / Greenhouse, or Vapes -> CannaCrafter's / Green Clouds.
  const topLevelCategories = categories.filter(c => !c.parent_id);
  const childCategories    = cat === "all" ? [] : categories.filter(c => c.parent_id === cat);

  const visibleProducts = variant === "all"
    ? products
    : products.filter(p => getVariantLabel(p) === variant);

  const variantOpts = cat === "all"
    ? []
    : Array.from(new Set(products.map(p => getVariantLabel(p)).filter(Boolean))).sort();

  return (
    <div className="flex flex-col flex-1 overflow-hidden">
      <TopBar
        title="Product Catalog"
        subtitle={`${total} product${total !== 1 ? "s" : ""} available`}
        onRefresh={load}
      />
      <main className="flex-1 overflow-y-auto p-6">
        <div className="mb-4 space-y-2">
          <SearchBar
            value={search}
            onChange={v => { setSearch(v); setPagination(p => ({ ...p, pageIndex: 0 })); }}
            placeholder="Search products, SKU…"
          />
          <div className="flex flex-wrap gap-3 items-end">
            <div>
              <label className="text-[10px] font-semibold text-gray-500 uppercase tracking-wide mb-1 block">Category</label>
              <SearchableSelect
                value={cat === "all" ? null : cat}
                onChange={v => { setCat(v ?? "all"); setSubCat("all"); setVariant("all"); setPagination(p => ({ ...p, pageIndex: 0 })); }}
                options={topLevelCategories.map(c => ({ value: c.id, label: c.name }))}
                placeholder="All categories"
                searchPlaceholder="Search categories…"
              />
            </div>
            {childCategories.length > 0 && (
              <div>
                <label className="text-[10px] font-semibold text-gray-500 uppercase tracking-wide mb-1 block">Brand / Grade</label>
                <SearchableSelect
                  value={subCat === "all" ? null : subCat}
                  onChange={v => { setSubCat(v ?? "all"); setVariant("all"); setPagination(p => ({ ...p, pageIndex: 0 })); }}
                  options={childCategories.map(c => ({ value: c.id, label: c.name }))}
                  placeholder={`All ${categories.find(x => x.id === cat)?.name || ""}`}
                  searchPlaceholder="Search…"
                />
              </div>
            )}
            {cat !== "all" && variantOpts.length > 0 && (
              <div>
                <label className="text-[10px] font-semibold text-gray-500 uppercase tracking-wide mb-1 block">Variant</label>
                <SearchableSelect
                  value={variant === "all" ? null : variant}
                  onChange={v => setVariant(v ?? "all")}
                  options={variantOpts.map(v => ({ value: v, label: v }))}
                  placeholder="All variants"
                  searchPlaceholder="Search…"
                />
              </div>
            )}
          </div>
        </div>

        <DataTable
          columns={[
            {
              accessorKey: "name",
              header: "Product / SKU",
              cell: ({ row: { original: p } }) => {
                const minQty = moq[p.id] || 0;
                const { base, groups } = parseDisplayName(p.display_name || p.name || "");
                return (
                  <div>
                    <p className="font-medium text-gray-900">{base}</p>
                    {groups.length > 0 && (
                      <div className="flex flex-wrap gap-1 mt-0.5">
                        {groups.map((g, i) => (
                          <span key={i} className="inline-block text-[10px] bg-bassani-50 text-bassani-700 rounded px-1.5 py-0.5 font-medium leading-none">{g}</span>
                        ))}
                      </div>
                    )}
                    <div className="flex items-center gap-2 mt-0.5">
                      <p className="font-mono text-[10px] text-gray-400">{p.default_code || "—"}</p>
                      {minQty > 0 && (
                        <span className="text-[10px] font-semibold text-amber-700 bg-amber-50 rounded-full px-2 py-0.5">
                          Min. {minQty} units
                        </span>
                      )}
                    </div>
                  </div>
                );
              },
            },
            {
              id: "category",
              header: "Category",
              enableSorting: false,
              meta: { className: "hidden md:table-cell" },
              accessorFn: r => r.categ_id?.[1] || "—",
              cell: ({ getValue }) => <span className="text-xs text-gray-500">{getValue()}</span>,
            },
            {
              accessorKey: "list_price",
              header: "Sale Price",
              cell: ({ row: { original: p } }) => (
                <span className="font-semibold">{fmtR(p.list_price)}</span>
              ),
            },
            {
              accessorKey: "virtual_available",
              header: "Available Stock",
              enableSorting: false,
              cell: ({ row: { original: p } }) => {
                const qty = p.virtual_available ?? 0;
                return <span className={stockColor(qty)}>{qty}</span>;
              },
            },
          ]}
          data={visibleProducts}
          loading={loading}
          total={total}
          pagination={pagination}
          onPaginationChange={setPagination}
          sorting={sorting}
          onSortingChange={u => {
            setSorting(typeof u === "function" ? u(sorting) : u);
            setPagination(p => ({ ...p, pageIndex: 0 }));
          }}
          manualPagination
          manualSorting
        />
      </main>
    </div>
  );
}
