import { useState, useEffect, useCallback } from "react";
import { X, Loader2 } from "lucide-react";
import api from "../api";
import toast from "react-hot-toast";
import { TopBar, DataTable, SearchBar, FilterPill, ChipRow, fmtR, parseDisplayName } from "../components/UI";

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
  const [cat,        setCat       ] = useState("all");
  const [variant,    setVariant   ] = useState("all");
  const [categories, setCategories] = useState([]);
  const [moq,        setMoq       ] = useState({});
  const [pagination, setPagination] = useState({ pageIndex: 0, pageSize: 25 });
  const [sorting,    setSorting   ] = useState([{ id: "name", desc: false }]);

  useEffect(() => {
    api.get("/api/products/categories")
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
            {cat === "all" ? (
              ["all", ...categories.map(c => c.name)].map(c => (
                <FilterPill key={c} label={c === "all" ? "All" : c} active={cat === c}
                  onClick={() => { setCat(c); setVariant("all"); setPagination(p => ({ ...p, pageIndex: 0 })); }} />
              ))
            ) : (
              <>
                <button
                  onClick={() => { setCat("all"); setVariant("all"); setPagination(p => ({ ...p, pageIndex: 0 })); }}
                  className="inline-flex items-center gap-1.5 text-xs font-semibold px-3 py-1.5 rounded-full bg-bassani-600 text-white shrink-0 hover:bg-bassani-700 transition-colors"
                >
                  {cat} <X size={11} className="opacity-80" />
                </button>
                {loading ? (
                  <Loader2 size={14} className="animate-spin text-gray-400 self-center ml-1" />
                ) : variantOpts.length > 0 ? (
                  <>
                    <span className="text-gray-200 select-none self-center">|</span>
                    <FilterPill key="__all__" label="All variants" active={variant === "all"} onClick={() => setVariant("all")} />
                    {variantOpts.map(v => (
                      <FilterPill key={v} label={v} active={variant === v} onClick={() => setVariant(v)} />
                    ))}
                  </>
                ) : null}
              </>
            )}
          </ChipRow>
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
