import { useState, useEffect, useCallback } from "react";
import api from "../api";
import toast from "react-hot-toast";
import { TopBar, DataTable, SearchBar, FilterPill, ChipRow, fmtR } from "../components/UI";

const stockColor = (qty) =>
  qty <= 0   ? "text-red-600 font-semibold"
  : qty < 10 ? "text-amber-600 font-semibold"
             : "text-bassani-700 font-semibold";

const getVariantLabel = (p) => {
  const m = ((p.display_name || p.name) || "").match(/\(([^)]+)\)$/);
  return m ? m[1] : null;
};

export default function ResellerCatalog() {
  const [products,   setProducts  ] = useState([]);
  const [total,      setTotal     ] = useState(0);
  const [loading,    setLoading   ] = useState(true);
  const [search,     setSearch    ] = useState("");
  const [cat,        setCat       ] = useState("all");
  const [variant,    setVariant   ] = useState("all");
  const [categories, setCategories] = useState([]);
  const [pagination, setPagination] = useState({ pageIndex: 0, pageSize: 25 });
  const [sorting,    setSorting   ] = useState([{ id: "name", desc: false }]);

  useEffect(() => {
    api.get("/api/products/categories")
      .then(r => setCategories(r.data.categories || []))
      .catch(() => {});
  }, []);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const sort   = sorting[0];
      const params = { limit: pagination.pageSize, offset: pagination.pageIndex * pagination.pageSize };
      if (sort)   { params.sort_by = sort.id; params.sort_dir = sort.desc ? "desc" : "asc"; }
      if (search) params.search   = search;
      if (cat !== "all") params.category = cat;
      const { data } = await api.get("/api/products/", { params });
      setProducts(data.products || []);
      setTotal(data.total || 0);
    } catch {
      toast.error("Failed to load catalog");
    } finally {
      setLoading(false);
    }
  }, [search, cat, pagination, sorting]);

  useEffect(() => { load(); }, [load]);

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
          <ChipRow>
            {["all", ...categories.map(c => c.name)].map(c => (
              <FilterPill
                key={c}
                label={c === "all" ? "All" : c}
                active={cat === c}
                onClick={() => { setCat(c); setVariant("all"); setPagination(p => ({ ...p, pageIndex: 0 })); }}
              />
            ))}
          </ChipRow>
          {variantOpts.length > 0 && (
            <ChipRow>
              {["all", ...variantOpts].map(v => (
                <FilterPill
                  key={v}
                  label={v === "all" ? "All Variants" : v}
                  active={variant === v}
                  onClick={() => setVariant(v)}
                />
              ))}
            </ChipRow>
          )}
        </div>

        <DataTable
          columns={[
            {
              accessorKey: "name",
              header: "Product / SKU",
              cell: ({ row: { original: p } }) => (
                <div>
                  <p className="font-medium text-gray-900">{p.display_name || p.name}</p>
                  <p className="font-mono text-[10px] text-gray-400">{p.default_code || "—"}</p>
                </div>
              ),
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
