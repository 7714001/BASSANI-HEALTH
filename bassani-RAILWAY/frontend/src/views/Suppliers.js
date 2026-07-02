import { useState, useEffect, useCallback } from "react";
import { useNavigate } from "react-router-dom";
import { ChevronRight } from "lucide-react";
import api from "../api";
import toast from "react-hot-toast";
import { TopBar, SearchBar, DataTable, LoadingState } from "../components/UI";

function TypeBadge({ s }) {
  const isCust = (s.customer_rank || 0) > 0;
  const isSupp = (s.supplier_rank || 0) > 0;
  if (isCust && isSupp)
    return <span className="text-[9px] font-semibold bg-purple-100 text-purple-700 px-1.5 py-0.5 rounded">Cust & Supplier</span>;
  if (isSupp)
    return <span className="text-[9px] font-semibold bg-amber-100 text-amber-700 px-1.5 py-0.5 rounded">Supplier</span>;
  return null;
}

const COLUMNS = [
  {
    header: "Name",
    accessorKey: "name",
    cell: ({ row }) => (
      <div>
        <p className="font-semibold text-gray-900">{row.original.name}</p>
        {row.original.ref && <p className="text-xs text-gray-400 font-mono">{row.original.ref}</p>}
      </div>
    ),
  },
  {
    header: "Type",
    id: "type",
    cell: ({ row }) => <TypeBadge s={row.original} />,
  },
  {
    header: "Email",
    accessorKey: "email",
    cell: ({ getValue }) => <span className="text-sm text-gray-500">{getValue() || "—"}</span>,
  },
  {
    header: "Phone",
    accessorKey: "phone",
    cell: ({ getValue }) => <span className="text-sm text-gray-500">{getValue() || "—"}</span>,
  },
  {
    header: "Payment Terms",
    id: "payment_term",
    cell: ({ row }) => <span className="text-sm text-gray-500">{row.original.payment_term_name || "—"}</span>,
  },
  {
    header: "",
    id: "arrow",
    cell: () => <ChevronRight size={16} className="text-gray-300" />,
  },
];

export default function Suppliers() {
  const navigate = useNavigate();
  const [suppliers, setSuppliers] = useState([]);
  const [loading,   setLoading  ] = useState(true);
  const [search,    setSearch   ] = useState("");
  const [total,     setTotal    ] = useState(0);

  const load = useCallback(async (q = "") => {
    setLoading(true);
    try {
      const params = { limit: 100 };
      if (q) params.search = q;
      const r = await api.get("/api/suppliers/", { params });
      setSuppliers(r.data.suppliers || []);
      setTotal(r.data.total || 0);
    } catch {
      toast.error("Failed to load suppliers");
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => { load(); }, [load]);

  useEffect(() => {
    const t = setTimeout(() => load(search), search ? 300 : 0);
    return () => clearTimeout(t);
  }, [search, load]);

  return (
    <div className="flex flex-col flex-1 overflow-hidden">
      <TopBar title="Suppliers" subtitle={`${total} supplier${total !== 1 ? "s" : ""} in Odoo`} />
      <div className="flex items-center gap-3 px-6 py-3 border-b border-gray-100 bg-white">
        <SearchBar value={search} onChange={e => setSearch(e.target.value)} placeholder="Search by name or email…" />
      </div>
      {loading
        ? <LoadingState />
        : <DataTable columns={COLUMNS} data={suppliers} onRowClick={row => navigate(`/suppliers/${row.id}`)} />
      }
    </div>
  );
}
