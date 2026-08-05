import api from "../api";

// GET /api/products/ is paginated server-side (max 200/page, see
// product_routes.py's `limit: int = Query(50, le=200)`), but an export needs
// the full filtered catalog, not just whatever page is currently on screen.
// Loops through every page for the given filters (search/category/stock
// filter etc.) and concatenates the results. Shared by the admin Products
// export and the reseller catalog export so both stay in sync with the same
// pagination contract.
export async function fetchAllProducts(baseParams = {}) {
  const limit = 200;
  let offset = 0;
  let all = [];
  let warehouseName = null;
  for (;;) {
    const { data } = await api.get("/api/products/", { params: { ...baseParams, limit, offset } });
    const page = data.products || [];
    all = all.concat(page);
    warehouseName = data.warehouse_name || warehouseName;
    offset += limit;
    if (page.length === 0 || offset >= (data.total || 0)) break;
  }
  return { products: all, warehouseName };
}
