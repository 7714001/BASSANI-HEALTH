import { useState, useEffect, useCallback } from "react";
import api from "../api";
import toast from "react-hot-toast";
import { Download } from "lucide-react";
import { TopBar, DataTable, SearchBar, ProductThumb, fmtR, parseDisplayName, WarehouseLabel } from "../components/UI";
import { SearchableSelect } from "../components/ProductPickerDrawer";
import { fetchAllProducts } from "../utils/productExport";

// stripLeadingGroup drops the first attribute group (the grade/brand code,
// e.g. "EXO") once a Brand/Grade sub-category is already selected — showing
// it again in the Variant dropdown would just repeat what the reseller has
// already picked. Only strips when there's more than one group, so a product
// with just a single attribute (no separate grade+size split) is untouched.
const getVariantLabel = (p, { stripLeadingGroup = false } = {}) => {
  let { groups } = parseDisplayName((p.display_name || p.name) || "");
  if (stripLeadingGroup && groups.length > 1) groups = groups.slice(1);
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
  const [warehouseName, setWarehouseName] = useState(null);
  const [exporting, setExporting] = useState(false);

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
      setWarehouseName(data.warehouse_name || null);
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

  // Once a Brand/Grade sub-category is selected, its grade code is already
  // implied — strip it from the variant label so "EXO / 1G" just reads "1G".
  const variantLabelOpts = { stripLeadingGroup: subCat !== "all" };

  const visibleProducts = variant === "all"
    ? products
    : products.filter(p => getVariantLabel(p, variantLabelOpts) === variant);

  // Exports the full filtered catalog (not just the current page) so a
  // reseller can take the price/stock list offline. Cost and tax are
  // deliberately left out — the on-screen catalog never shows Bassani's
  // cost price to resellers, so the export shouldn't leak it either.
  const exportCatalog = async () => {
    setExporting(true);
    try {
      const XLSX = await import("xlsx");
      const params = {};
      if (search) params.search = search;
      const effectiveCat = subCat !== "all" ? subCat : cat;
      if (effectiveCat !== "all") params.parent_category_id = effectiveCat;
      const { products: rows, warehouseName: exportWarehouse } = await fetchAllProducts(params);
      const filtered = variant === "all"
        ? rows
        : rows.filter(p => getVariantLabel(p, variantLabelOpts) === variant);
      const sheet = filtered.map(p => ({
        SKU: p.default_code || "",
        Product: p.display_name || p.name,
        Category: p.categ_id?.[1] || "",
        Variant: getVariantLabel(p, variantLabelOpts) || "",
        "Sale Price (R)": (p.list_price ?? 0).toFixed(2),
        "Available Stock": p.virtual_available ?? 0,
        "Min Order Qty": moq[p.id] || "",
      }));
      const wb = XLSX.utils.book_new();
      XLSX.utils.book_append_sheet(wb, XLSX.utils.json_to_sheet(sheet), "Catalog");
      const suffix = exportWarehouse ? ` - ${exportWarehouse}` : "";
      XLSX.writeFile(wb, `Bassani Product Catalog${suffix} ${new Date().toISOString().slice(0, 10)}.xlsx`);
      toast.success("Export ready");
    } catch (e) {
      toast.error("Export failed");
      console.error(e);
    } finally {
      setExporting(false);
    }
  };

  const variantOpts = cat === "all"
    ? []
    : Array.from(new Set(products.map(p => getVariantLabel(p, variantLabelOpts)).filter(Boolean))).sort();

  return (
    <div className="flex flex-col flex-1 overflow-hidden">
      <TopBar
        title="Product Catalog"
        subtitle={`${total} product${total !== 1 ? "s" : ""} available`}
        onRefresh={load}
        actions={
          <>
            <WarehouseLabel name={warehouseName} />
            <button onClick={exportCatalog} disabled={exporting}
              title="Export the current filtered catalog to Excel"
              className="text-xs flex items-center gap-1.5 px-3 py-1.5 bg-bassani-600 text-white rounded-lg hover:bg-bassani-700 disabled:opacity-50 disabled:cursor-not-allowed font-medium transition-colors whitespace-nowrap">
              <Download className="w-3.5 h-3.5" />
              {exporting ? "Exporting…" : "Export"}
            </button>
          </>
        }
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
                const { base, groups: rawGroups } = parseDisplayName(p.display_name || p.name || "");
                // Same redundant-grade stripping as the Variant dropdown — once Brand/Grade
                // is selected, repeating its code as a chip on every row is just noise.
                const groups = (subCat !== "all" && rawGroups.length > 1) ? rawGroups.slice(1) : rawGroups;
                return (
                  <div className="flex items-center gap-2.5">
                    <ProductThumb product={p} size="sm" />
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
              header: "Stock",
              enableSorting: false,
              // Binary in-stock/out-of-stock only — Bassani does not want
              // the exact quantity on hand shown to resellers/customers.
              cell: ({ row: { original: p } }) => {
                const outOfStock = (p.virtual_available ?? 0) <= 0;
                return (
                  <span className={`text-[11px] font-semibold px-2 py-0.5 rounded-full ${outOfStock ? "bg-red-50 text-red-600" : "bg-green-50 text-green-700"}`}>
                    {outOfStock ? "Out of stock" : "In stock"}
                  </span>
                );
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
