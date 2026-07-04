import { useState, useEffect } from "react";
import api from "../api";
import toast from "react-hot-toast";
import { Copy, Check, RefreshCw, Star } from "lucide-react";
import { TopBar, DataTable, BtnSecondary, Badge } from "../components/UI";
import { useAuth } from "../AuthContext";

export default function Warehouses() {
  const { user } = useAuth();
  const isSuperAdmin = user?.is_super_admin;

  const [warehouses,        setWarehouses       ] = useState([]);
  const [tokens,            setTokens           ] = useState({});
  const [defaultWarehouseId, setDefaultWarehouseId] = useState(null);
  const [loading,           setLoading          ] = useState(true);
  const [copied,            setCopied           ] = useState(null);
  const [settingDefault,    setSettingDefault   ] = useState(null);

  const load = async () => {
    setLoading(true);
    try {
      const r = await api.get("/api/warehouses/");
      const whs = r.data.warehouses || [];
      setWarehouses(whs);
      setDefaultWarehouseId(r.data.default_warehouse_id || null);
      const entries = await Promise.all(
        whs.map(w => api.get(`/api/warehouses/${w.id}/display-token`).then(res => [w.id, res.data.token]))
      );
      setTokens(Object.fromEntries(entries));
    } catch {
      toast.error("Failed to load warehouses");
    } finally {
      setLoading(false);
    }
  };
  useEffect(() => { load(); }, []);

  const rotate = async (w) => {
    if (tokens[w.id] && !window.confirm(
      `Generate a new display token for ${w.name}? The screen currently using this URL will lose connection until its URL is updated.`
    )) return;
    try {
      const r = await api.post(`/api/warehouses/${w.id}/display-token`);
      setTokens(prev => ({ ...prev, [w.id]: r.data.token }));
      toast.success("Display token generated");
    } catch (e) {
      toast.error(e.response?.data?.detail || "Failed to generate token");
    }
  };

  const setDefault = async (warehouseId) => {
    setSettingDefault(warehouseId);
    try {
      await api.put("/api/settings/default-warehouse", {
        warehouse_id: warehouseId === defaultWarehouseId ? null : warehouseId,
      });
      setDefaultWarehouseId(warehouseId === defaultWarehouseId ? null : warehouseId);
      toast.success(
        warehouseId === defaultWarehouseId
          ? "Default warehouse cleared"
          : `Default warehouse set`
      );
    } catch (e) {
      toast.error(e.response?.data?.detail || "Failed to update default");
    } finally {
      setSettingDefault(null);
    }
  };

  const screenUrl = (token) => `${window.location.origin}/packing-board.html?token=${token}`;

  const copy = (text, key) => {
    navigator.clipboard.writeText(text);
    setCopied(key);
    setTimeout(() => setCopied(null), 2000);
  };

  return (
    <div className="flex flex-col flex-1 overflow-hidden">
      <TopBar
        title="Warehouses"
        subtitle="Packing-floor display screen tokens and portal default warehouse"
        onRefresh={load}
      />
      <main className="flex-1 overflow-y-auto p-6">
        <DataTable
          loading={loading}
          data={warehouses}
          total={warehouses.length}
          columns={[
            {
              id: "name",
              header: "Warehouse",
              enableSorting: false,
              cell: ({ row: { original: w } }) => (
                <div className="flex items-center gap-2">
                  <div>
                    <p className="text-sm font-medium text-gray-900">{w.name}</p>
                    <p className="text-[11px] text-gray-400">{w.code}</p>
                  </div>
                  {w.id === defaultWarehouseId && (
                    <Badge color="green">Default</Badge>
                  )}
                </div>
              ),
            },
            {
              id: "screen",
              header: "Display Screen URL",
              enableSorting: false,
              cell: ({ row: { original: w } }) => tokens[w.id] ? (
                <div className="flex items-center gap-2">
                  <span className="font-mono text-xs text-gray-600 truncate max-w-xs">{screenUrl(tokens[w.id])}</span>
                  <button onClick={() => copy(screenUrl(tokens[w.id]), w.id)} className="text-bassani-600 hover:text-bassani-700 transition-colors flex-shrink-0">
                    {copied === w.id ? <Check size={13} /> : <Copy size={13} />}
                  </button>
                </div>
              ) : (
                <span className="text-xs text-gray-400 italic">No token generated yet</span>
              ),
            },
            {
              id: "actions",
              header: "",
              enableSorting: false,
              cell: ({ row: { original: w } }) => (
                <div className="flex items-center gap-2 justify-end">
                  {isSuperAdmin && (
                    <BtnSecondary
                      size="sm"
                      onClick={() => setDefault(w.id)}
                      disabled={settingDefault === w.id}
                    >
                      <Star size={12} className={w.id === defaultWarehouseId ? "fill-amber-400 text-amber-400" : ""} />
                      {w.id === defaultWarehouseId ? "Remove Default" : "Set Default"}
                    </BtnSecondary>
                  )}
                  <BtnSecondary size="sm" onClick={() => rotate(w)}>
                    <RefreshCw size={12} /> {tokens[w.id] ? "Rotate" : "Generate"}
                  </BtnSecondary>
                </div>
              ),
            },
          ]}
        />
      </main>
    </div>
  );
}
