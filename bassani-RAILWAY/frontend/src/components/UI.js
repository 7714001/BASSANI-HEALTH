import { useRef, useState, useEffect, createContext, useContext, useCallback } from "react";
import {
  useReactTable, getCoreRowModel, getPaginationRowModel,
  getSortedRowModel, flexRender,
} from "@tanstack/react-table";
import { useAuth } from "../AuthContext";
import api from "../api";
import { useNavigate, useLocation } from "react-router-dom";
import {
  LayoutDashboard, Package, Users, ShoppingCart,
  DollarSign, Percent, BarChart3, Phone, FileText,
  LogOut, Bell, RefreshCw, UserCog, Loader2, Warehouse,
  ChevronLeft, ChevronRight, ChevronUp, ChevronDown, Menu, X, ChevronsUpDown,
  ScrollText, Target, ClipboardCheck, ClipboardList, ShieldCheck, History, Ticket, Tag, Ruler, Mail, Truck, Settings, UserCircle, Landmark, Search, Clock, Link2,
} from "lucide-react";

export const SidebarContext = createContext({ open: false, toggle: () => {}, close: () => {} });

// ── Formatters ────────────────────────────────────────────────────────────────
const SAST = { timeZone: "Africa/Johannesburg" };
export const fmtR       = (n) => `R ${Number(n || 0).toLocaleString("en-ZA", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
export const fmtNum     = (n) => Number(n || 0).toLocaleString("en-ZA");
export const fmtDate    = (d) => d ? new Date(d).toLocaleDateString("en-ZA", { year: "numeric", month: "short", day: "numeric", ...SAST }) : "—";
export const fmtDateTime= (d) => d ? new Date(d).toLocaleString("en-ZA", { year: "numeric", month: "short", day: "numeric", hour: "2-digit", minute: "2-digit", ...SAST }) : "—";

// Splits an Odoo display_name into base name + variant chips.
// Odoo appends each attribute as a trailing "(Value)" group:
// "Product (Weight: 1g) (Pack: 2)" → { base: "Product", groups: ["Weight: 1g", "Pack: 2"] }
export const parseDisplayName = (full = "") => {
  const groups = [];
  let rest = full;
  let m;
  while ((m = rest.match(/\s*\(([^)]+)\)$/))) {
    groups.unshift(m[1]);
    rest = rest.slice(0, rest.length - m[0].length);
  }
  return { base: rest, groups };
};

// ── Sidebar ───────────────────────────────────────────────────────────────────
const NAV = [
  { label: "Dashboard",    path: "/",            icon: LayoutDashboard, section: "Main"      },
  { label: "Products", icon: Package, section: "Main", children: [
    { label: "Catalogue",   path: "/products",             icon: Package },
    { label: "Categories",  path: "/catalogue/categories", icon: Tag,   permission: "products.manage" },
  ]},
  { label: "Customers",        path: "/customers",        icon: Users,         section: "Customers", permission: "customers.view"      },
  { label: "Applications",    path: "/applications",     icon: ClipboardCheck, section: "Customers", adminOnly: true, permission: "customers.view", showApplicationsBadge: true },
  { label: "Onboarding Inbox",path: "/onboarding-inbox", icon: Mail,           section: "Customers", permission: "onboarding.inbox", showOnboardingInboxBadge: true },
  { label: "Suppliers",    path: "/suppliers",   icon: Truck,           section: "Main",     permission: "suppliers.view"      },
  { label: "Orders",       path: "/orders",      icon: ShoppingCart,    section: "Main",     permission: "orders.view"         },
  { label: "Sales Agents", path: "/resellers",   icon: DollarSign,      section: "Resellers",permission: "resellers.view"      },
  { label: "Commission",   path: "/commission",  icon: Percent,         section: "Resellers",permission: "commission.view"     },
  { label: "Invoices",          path: "/invoices",         icon: FileText,  section: "Finance", permission: "invoices.view"                   },
  { label: "Bank Reconciliation", path: "/finance/bank-recon", icon: Landmark, section: "Finance", permission: "finance.bank_reconciliation" },
  { label: "Targets",           path: "/targets",          icon: Target,    section: "Finance", permission: "reports.view"                    },
  { label: "Reports",      path: "/reports",      icon: BarChart3,       section: "Insights", permission: "reports.view"  },
  { label: "Healthcare",   path: "/healthcare",  icon: Phone,           section: "Insights", permission: "healthcare.view"     },
  { label: "Scripts",      path: "/scripts",     icon: ScrollText,      section: "Insights"  },
  { label: "Sales Inbox",        path: "/inbox",            icon: Mail,   section: "Sales",   permission: "inbox.view",              showInboxBadge: true },
  { label: "Sales Tickets",      path: "/tickets/sales",    icon: Ticket, section: "Sales",   permissions: ["tickets.sales", "tickets.finance_confirm"] },
  { label: "Orders Inbox",       path: "/orders-inbox",     icon: Mail,   section: "Orders",  permission: "orders_inbox.view",       showOrdersInboxBadge: true },
  { label: "Orders Tickets",     path: "/tickets/orders",   icon: Ticket, section: "Orders",  permissions: ["tickets.orders", "tickets.qa_approve", "tickets.rp_approve"] },
  { label: "Backorders",         path: "/orders/backorders", icon: Clock,  section: "Orders",  permission: "orders.view", adminOnly: true },
  { label: "Partner Directory", path: "/partners",            icon: Users,    section: "Admin", permission: "customers.manage"    },
  { label: "Users",         path: "/users",                  icon: UserCog,  section: "Admin", permission: "users.manage"        },
  { label: "Audit Trail",  path: "/audit",                  icon: History,  section: "Admin", permission: "audit.view"          },
  { label: "Settings",    path: "/settings",               icon: Settings, section: "Admin", permission: "settings.manage"     },
];

const RESELLER_NAV = [
  { label: "Dashboard",  path: "/",         icon: LayoutDashboard, section: "Main" },
  { label: "Products",   path: "/products", icon: Package,         section: "Main" },
  { label: "My Quotes",  path: "/tickets/sales", icon: Ticket,    section: "Orders" },
  { label: "Commission", path: "/commission", icon: Percent,       section: "Orders", requiresCommission: true },
  { label: "My Customers",    path: "/customers",        icon: Users,         section: "Customers" },
  { label: "My Applications", path: "/my-applications",  icon: ClipboardList, section: "Customers" },
  { label: "Invite Customer", path: "/onboarding-docs",  icon: Link2,         section: "Customers" },
];

export function Sidebar() {
  const { user, logout, isAdmin, can } = useAuth();
  const navigate = useNavigate();
  const { pathname } = useLocation();
  const { open, close } = useContext(SidebarContext);
  const [inboxCount,            setInboxCount           ] = useState(0);
  const [onboardingInboxCount,  setOnboardingInboxCount ] = useState(0);
  const [pendingAppsCount,      setPendingAppsCount     ] = useState(0);

  useEffect(() => {
    if (!can("inbox.view")) return;
    const fetchCount = () =>
      api.get("/api/inbox/unhandled-count")
        .then(r => setInboxCount(r.data.count || 0))
        .catch(() => {});
    fetchCount();
    const id = setInterval(fetchCount, 60000);
    return () => clearInterval(id);
  }, [can]);

  useEffect(() => {
    if (!can("onboarding.inbox")) return;
    const fetchCount = () =>
      api.get("/api/onboarding-inbox/unhandled-count")
        .then(r => setOnboardingInboxCount(r.data.count || 0))
        .catch(() => {});
    fetchCount();
    const id = setInterval(fetchCount, 60000);
    return () => clearInterval(id);
  }, [can]);

  useEffect(() => {
    if (!isAdmin) return;
    const fetchCount = () =>
      api.get("/api/onboarding/", { params: { status: "pending", limit: 1, offset: 0 } })
        .then(r => setPendingAppsCount(r.data.total || 0))
        .catch(() => {});
    fetchCount();
    const id = setInterval(fetchCount, 60000);
    return () => clearInterval(id);
  }, [isAdmin]);

  const isReseller = user?.role === "reseller";
  const rawItems   = isReseller ? RESELLER_NAV : NAV;
  const items      = rawItems.filter(i => {
    if (i.adminOnly && !isAdmin) return false;
    if (i.requiresCommission && user?.commission_eligible === false) return false;
    if (i.children) return true; // NavGroup filters its own children
    // Permission-gated items apply to admin-tier AND ticketing-role accounts
    // (resellers never reach here — they use RESELLER_NAV, which has none).
    if (i.permissions) return i.permissions.some(p => can(p));
    if (i.permission) return can(i.permission);
    return true;
  });
  const sections   = [...new Set(items.map((i) => i.section || ""))].filter(Boolean);

  const initials = (name) =>
    name?.split(" ").map((w) => w[0]).join("").slice(0, 2).toUpperCase() || "??";

  return (
    <aside className={`fixed inset-y-0 left-0 z-50 w-56 bg-slate-900 flex flex-col flex-shrink-0 transition-transform duration-200 lg:static lg:w-48 lg:translate-x-0 ${open ? "translate-x-0" : "-translate-x-full"}`}>
      {/* Mobile close button */}
      <button onClick={close} className="absolute top-3.5 right-3.5 text-slate-500 hover:text-white transition-colors lg:hidden" aria-label="Close menu">
        <X size={16} />
      </button>
      {/* Logo */}
      <div className="px-4 py-5 border-b border-slate-800">
        <div className="flex items-center gap-2.5">
          <img src="/favicon.ico" alt="Bassani Health" className="w-8 h-8 object-contain" />
          <div>
            <p className="text-white text-sm font-medium leading-none">Bassani</p>
            <p className="text-slate-500 text-xs mt-0.5">Health Internal</p>
          </div>
        </div>
      </div>

      {/* Nav */}
      <nav className="flex-1 min-h-0 overflow-y-auto px-3 py-4 space-y-0.5">
        {sections.map((section) => (
          <div key={section}>
            <p className="text-slate-600 text-[10px] font-bold uppercase tracking-widest px-2 pt-4 pb-1.5">{section}</p>
            {items.filter((i) => i.section === section).map((item) =>
              item.children
                ? <NavGroup key={item.label} group={item} pathname={pathname} navigate={navigate} />
                : <NavItem key={item.path} item={item} pathname={pathname} navigate={navigate}
                    badge={item.showInboxBadge ? inboxCount : item.showOnboardingInboxBadge ? onboardingInboxCount : item.showApplicationsBadge ? pendingAppsCount : 0} />
            )}
          </div>
        ))}
      </nav>

      {/* User */}
      <div className="px-3 py-4 border-t border-slate-800">
        <div className="flex items-center gap-2.5">
          <div className="w-7 h-7 rounded-full bg-bassani-600 flex items-center justify-center text-white text-xs font-medium flex-shrink-0">
            {initials(user?.username || "")}
          </div>
          <div className="flex-1 min-w-0">
            <div className="flex items-center gap-1.5">
              <p className="text-slate-200 text-xs font-medium truncate">{user?.name || user?.username}</p>
              {user?.is_super_admin && (
                <ShieldCheck size={10} className="text-purple-400 flex-shrink-0" title="Super Admin" />
              )}
            </div>
            <p className="text-slate-500 text-[10px] truncate">
              {user?.is_super_admin ? "Super Admin" : user?.role?.replace(/_/g, " ")}
            </p>
          </div>
          <button onClick={logout} className="text-slate-500 hover:text-slate-300 transition-colors">
            <LogOut size={14} />
          </button>
        </div>
      </div>
    </aside>
  );
}

function NavItem({ item, pathname, navigate, badge = 0 }) {
  const { close } = useContext(SidebarContext);
  const isActive = pathname === item.path || (item.path !== "/" && pathname.startsWith(item.path));
  const Icon = item.icon;
  return (
    <button
      onClick={() => { navigate(item.path); close(); }}
      className={`w-full flex items-center gap-2.5 px-3 py-2 rounded-lg text-sm transition-all border-l-2 overflow-hidden ${
        isActive
          ? "bg-slate-800 text-white border-bassani-600 font-medium"
          : "text-slate-400 border-transparent hover:text-white hover:bg-slate-800"
      }`}
    >
      <Icon size={15} className="flex-shrink-0" />
      <span className="truncate flex-1 text-left">{item.label}</span>
      {badge > 0 && (
        <span className="flex-shrink-0 min-w-[18px] h-[18px] px-1 bg-red-500 text-white text-[9px] font-bold rounded-full flex items-center justify-center leading-none">
          {badge > 99 ? "99+" : badge}
        </span>
      )}
    </button>
  );
}

function NavGroup({ group, pathname, navigate }) {
  const { can } = useAuth();
  const Icon = group.icon;
  const visibleChildren = group.children.filter(c => {
    if (c.permission) return can(c.permission);
    return true;
  });
  const isAnyChildActive = visibleChildren.some(
    c => pathname === c.path || (c.path !== "/" && pathname.startsWith(c.path))
  );
  const [open, setOpen] = useState(isAnyChildActive);

  if (visibleChildren.length === 0) return null;

  return (
    <div>
      <button
        onClick={() => setOpen(v => !v)}
        className={`w-full flex items-center gap-2.5 px-3 py-2 rounded-lg text-sm transition-all border-l-2 overflow-hidden ${
          isAnyChildActive
            ? "bg-slate-800 text-white border-bassani-600 font-medium"
            : "text-slate-400 border-transparent hover:text-white hover:bg-slate-800"
        }`}
      >
        <Icon size={15} className="flex-shrink-0" />
        <span className="flex-1 text-left truncate">{group.label}</span>
        {open ? <ChevronUp size={12} className="flex-shrink-0" /> : <ChevronDown size={12} className="flex-shrink-0" />}
      </button>
      {open && (
        <div className="ml-3 mt-0.5 mb-0.5 border-l border-slate-700 pl-2 space-y-0.5">
          {visibleChildren.map(child => (
            <NavItem key={child.path} item={child} pathname={pathname} navigate={navigate} />
          ))}
        </div>
      )}
    </div>
  );
}

// ── Global barcode / reference search bar ─────────────────────────────────────
// Press "/" from anywhere (when not in another input) to focus. Enter dispatches.
function GlobalSearch() {
  const inputRef  = useRef(null);
  const navigate  = useNavigate();
  const { isAdmin } = useAuth();
  const [query,   setQuery  ] = useState("");
  const [loading, setLoading] = useState(false);

  const focus = useCallback((e) => {
    if (e.key !== "/") return;
    const tag = document.activeElement?.tagName;
    if (tag === "INPUT" || tag === "TEXTAREA" || tag === "SELECT") return;
    e.preventDefault();
    inputRef.current?.focus();
  }, []);

  useEffect(() => {
    window.addEventListener("keydown", focus);
    return () => window.removeEventListener("keydown", focus);
  }, [focus]);

  if (!isAdmin) return null;

  const dispatch = async () => {
    const q = query.trim();
    if (!q) return;
    setLoading(true);
    try {
      const { data } = await api.get("/api/search/global", { params: { q } });
      setQuery("");
      inputRef.current?.blur();
      navigate(data.navigate_to, { state: data.state || {} });
    } catch (err) {
      const msg = err.response?.data?.detail || "No match found";
      // dynamic import keeps react-hot-toast out of the non-toast code path
      import("react-hot-toast").then(({ default: toast }) => toast.error(msg));
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="hidden sm:flex items-center relative">
      <Search size={13} className="absolute left-2.5 text-gray-400 pointer-events-none z-10" />
      {loading && <Loader2 size={13} className="absolute right-2.5 text-gray-400 animate-spin z-10" />}
      <input
        ref={inputRef}
        value={query}
        onChange={e => setQuery(e.target.value)}
        onKeyDown={e => {
          if (e.key === "Enter") dispatch();
          if (e.key === "Escape") { setQuery(""); e.target.blur(); }
        }}
        placeholder="/ Scan or search…"
        className="pl-7 pr-7 py-1.5 text-xs border border-gray-200 rounded-lg bg-white text-gray-800 placeholder-gray-400 focus:outline-none focus:ring-2 focus:ring-bassani-400 w-44 focus:w-56 transition-all duration-150"
      />
    </div>
  );
}

// ── Top bar ───────────────────────────────────────────────────────────────────
function WarehouseSwitcher() {
  const { user, isAdmin, setActiveWarehouse } = useAuth();
  const [warehouses, setWarehouses] = useState([]);

  useEffect(() => {
    if (!isAdmin) return;
    api.get("/api/warehouses/").then((r) => setWarehouses(r.data.warehouses || [])).catch(() => {});
  }, [isAdmin]);

  if (!isAdmin || warehouses.length === 0) return null;

  return (
    <div className="hidden sm:flex items-center gap-1.5 text-xs px-2 py-1 rounded-md border border-gray-200 text-gray-600">
      <Warehouse size={13} className="text-gray-400" />
      <select
        value={user?.active_warehouse_id || ""}
        onChange={(e) => setActiveWarehouse(e.target.value ? parseInt(e.target.value) : null)}
        className="bg-transparent outline-none text-xs text-gray-700 max-w-[140px]"
      >
        <option value="">All warehouses</option>
        {warehouses.map((w) => (
          <option key={w.id} value={w.id}>{w.name}</option>
        ))}
      </select>
    </div>
  );
}

export function TopBar({ title, subtitle, onRefresh, actions, leftAction, odooConnected = true, showWarehouseSwitcher = false }) {
  const { toggle } = useContext(SidebarContext);
  const navigate   = useNavigate();
  return (
    <header className="bg-white border-b border-gray-100 px-4 sm:px-6 py-3.5 flex items-center justify-between flex-shrink-0 gap-3">
      <div className="flex items-center gap-2.5 min-w-0">
        <button onClick={toggle} aria-label="Open menu"
          className="lg:hidden p-1.5 rounded-md border border-gray-200 text-gray-400 hover:text-gray-600 hover:bg-gray-50 transition-all flex-shrink-0">
          <Menu size={16} />
        </button>
        {leftAction}
        <div className="min-w-0">
          <h1 className="text-base font-semibold text-gray-900 truncate">{title}</h1>
          {subtitle && <p className="text-xs text-gray-500 mt-0.5 hidden sm:block truncate">{subtitle}</p>}
        </div>
      </div>
      <div className="flex items-center gap-2 sm:gap-2.5 flex-shrink-0">
        {showWarehouseSwitcher && <WarehouseSwitcher />}
        <span className={`hidden sm:flex items-center gap-1.5 text-xs px-2.5 py-1 rounded-md ${odooConnected ? "bg-bassani-50 text-bassani-700" : "bg-red-50 text-red-600"}`}>
          <span className={`w-1.5 h-1.5 rounded-full ${odooConnected ? "bg-bassani-600" : "bg-red-500"}`} />
          {odooConnected ? "Odoo synced" : "Odoo offline"}
        </span>
        <GlobalSearch />
        {onRefresh && (
          <button onClick={onRefresh} className="p-1.5 rounded-md border border-gray-200 text-gray-400 hover:text-gray-600 hover:bg-gray-50 transition-all">
            <RefreshCw size={14} />
          </button>
        )}
        {actions}
        <button
          onClick={() => navigate("/profile")}
          title="My Profile"
          className="text-gray-400 hover:text-bassani-600 transition-colors flex-shrink-0"
        >
          <UserCircle size={26} />
        </button>
      </div>
    </header>
  );
}

// ── Reusable components ───────────────────────────────────────────────────────

export function Spinner({ size = "md" }) {
  const s = size === "sm" ? "w-4 h-4" : size === "lg" ? "w-10 h-10" : "w-7 h-7";
  return (
    <div className={`${s} border-2 border-gray-200 border-t-bassani-600 rounded-full animate-spin`} />
  );
}

export function LoadingState({ message = "Loading…" }) {
  return (
    <div className="flex flex-col items-center justify-center h-48 gap-3 text-gray-400">
      <Spinner />
      <span className="text-sm">{message}</span>
    </div>
  );
}

export function EmptyState({ message = "No records found", heading, icon: Icon, action }) {
  if (heading || Icon || action) {
    return (
      <div className="flex flex-col items-center justify-center py-16 px-6 text-center gap-4">
        {Icon && (
          <div className="w-14 h-14 rounded-2xl bg-gray-50 flex items-center justify-center">
            <Icon size={26} className="text-gray-300" />
          </div>
        )}
        {heading && <p className="text-base font-semibold text-gray-500">{heading}</p>}
        <p className="text-sm text-gray-400 max-w-xs leading-relaxed">{message}</p>
        {action && (
          <button onClick={action.onClick}
            className="mt-1 px-4 py-2 rounded-xl bg-bassani-600 text-white text-sm font-medium hover:bg-bassani-700 transition-colors">
            {action.label}
          </button>
        )}
      </div>
    );
  }
  return (
    <div className="text-center py-12 text-gray-400 text-sm">{message}</div>
  );
}

export function ErrorState({ message, onRetry }) {
  return (
    <div className="flex flex-col items-center justify-center h-48 gap-3">
      <p className="text-red-500 text-sm font-medium">{message}</p>
      {onRetry && <BtnPrimary onClick={onRetry}>Try Again</BtnPrimary>}
    </div>
  );
}

// ── Buttons ───────────────────────────────────────────────────────────────────
export function BtnPrimary({ children, onClick, disabled, loading, size = "md", type = "button" }) {
  const p = size === "sm" ? "px-3 py-1.5 text-xs" : "px-4 py-2 text-sm";
  return (
    <button type={type} onClick={onClick} disabled={disabled || loading}
      className={`${p} bg-bassani-600 hover:bg-bassani-700 text-white rounded-lg font-medium transition-colors disabled:opacity-50 disabled:cursor-not-allowed flex items-center gap-1.5`}>
      {loading && <Loader2 size={12} className="animate-spin shrink-0" />}
      {children}
    </button>
  );
}

export function BtnSecondary({ children, onClick, disabled, loading, size = "md" }) {
  const p = size === "sm" ? "px-3 py-1.5 text-xs" : "px-4 py-2 text-sm";
  return (
    <button onClick={onClick} disabled={disabled || loading}
      className={`${p} bg-white border border-gray-200 hover:bg-gray-50 text-gray-600 rounded-lg font-medium transition-colors disabled:opacity-50 flex items-center gap-1.5`}>
      {loading && <Loader2 size={12} className="animate-spin shrink-0" />}
      {children}
    </button>
  );
}

export function PaginationBar({ page, pageSize, total, onChange }) {
  const pageCount = Math.ceil(total / pageSize);
  if (pageCount <= 1) return null;
  return (
    <div className="flex items-center justify-between px-5 py-3 border-t border-gray-50 text-xs text-gray-400">
      <span>{total} total · Page {page + 1} of {pageCount}</span>
      <div className="flex gap-1">
        <button disabled={page === 0} onClick={() => onChange(page - 1)}
          className="px-2.5 py-1 rounded-lg border border-gray-200 text-gray-500 hover:bg-gray-50 disabled:opacity-40 disabled:cursor-not-allowed transition-colors">
          Previous
        </button>
        <button disabled={page >= pageCount - 1} onClick={() => onChange(page + 1)}
          className="px-2.5 py-1 rounded-lg border border-gray-200 text-gray-500 hover:bg-gray-50 disabled:opacity-40 disabled:cursor-not-allowed transition-colors">
          Next
        </button>
      </div>
    </div>
  );
}

export function BtnDanger({ children, onClick, disabled, loading, size = "sm" }) {
  const p = size === "sm" ? "px-3 py-1.5 text-xs" : "px-4 py-2 text-sm";
  return (
    <button onClick={onClick} disabled={disabled || loading}
      className={`${p} bg-white border border-red-200 hover:border-red-400 text-red-600 rounded-lg font-medium transition-colors disabled:opacity-50 disabled:cursor-not-allowed flex items-center gap-1.5`}>
      {loading && <Loader2 size={12} className="animate-spin shrink-0" />}
      {children}
    </button>
  );
}

// ── Table ─────────────────────────────────────────────────────────────────────
export function Table({ headers, children, loading }) {
  return (
    <div className="bg-white border border-gray-100 rounded-xl overflow-hidden">
      <div className="overflow-x-auto">
        <table className="w-full min-w-[560px] border-collapse text-sm">
          <thead>
            <tr>
              {headers.map((h) => (
                <th key={h} className="text-left text-[10px] font-semibold text-gray-400 uppercase tracking-wider px-4 py-3 bg-gray-50 border-b border-gray-100">
                  {h}
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {loading ? (
              <tr><td colSpan={headers.length} className="py-12 text-center"><Spinner /></td></tr>
            ) : children}
          </tbody>
        </table>
      </div>
    </div>
  );
}

export function Td({ children, className = "" }) {
  return <td className={`px-4 py-3 border-b border-gray-50 text-gray-700 ${className}`}>{children}</td>;
}

export function Tr({ children, onClick }) {
  return (
    <tr onClick={onClick} className={`${onClick ? "cursor-pointer hover:bg-gray-50" : ""} transition-colors`}>
      {children}
    </tr>
  );
}

// ── DataTable ─────────────────────────────────────────────────────────────────
export function DataTable({
  columns, data, loading = false,
  total, pagination, onPaginationChange,
  sorting = [], onSortingChange,
  manualPagination = false, manualSorting = false,
  onRowClick,
  defaultPageSize = 25,
  pageSizeOptions = [10, 25, 50, 100],
}) {
  const table = useReactTable({
    data,
    columns,
    state: {
      sorting,
      ...(manualPagination ? { pagination: pagination || { pageIndex: 0, pageSize: defaultPageSize } } : {}),
    },
    pageCount: manualPagination && total != null
      ? Math.ceil(total / (pagination?.pageSize || defaultPageSize))
      : undefined,
    onSortingChange,
    onPaginationChange: manualPagination ? onPaginationChange : undefined,
    getCoreRowModel: getCoreRowModel(),
    getPaginationRowModel: manualPagination ? undefined : getPaginationRowModel(),
    getSortedRowModel: manualSorting ? undefined : getSortedRowModel(),
    manualPagination,
    manualSorting,
    initialState: !manualPagination ? { pagination: { pageSize: defaultPageSize } } : undefined,
  });

  const pag = manualPagination
    ? (pagination || { pageIndex: 0, pageSize: defaultPageSize })
    : table.getState().pagination;
  const { pageIndex, pageSize } = pag;
  const pageCount = table.getPageCount();
  const totalRows = manualPagination ? (total ?? 0) : data.length;
  const from      = totalRows ? pageIndex * pageSize + 1 : 0;
  const to        = Math.min(from + pageSize - 1, totalRows);
  const canPrev   = pageIndex > 0;
  const canNext   = pageIndex < (pageCount > 0 ? pageCount - 1 : 0);

  const goTo = (idx) => {
    if (manualPagination) onPaginationChange({ pageIndex: idx, pageSize });
    else table.setPageIndex(idx);
  };
  const changeSize = (size) => {
    if (manualPagination) onPaginationChange({ pageIndex: 0, pageSize: size });
    else table.setPageSize(size);
  };

  return (
    <div className="bg-white border border-gray-100 rounded-xl overflow-hidden">
      <div className="overflow-x-auto">
        <table className="w-full border-collapse text-sm">
          <thead>
            {table.getHeaderGroups().map(hg => (
              <tr key={hg.id} className="bg-gray-50 border-b border-gray-100">
                {hg.headers.map(header => (
                  <th key={header.id}
                    onClick={header.column.getToggleSortingHandler()}
                    className={`text-left text-[10px] font-semibold text-gray-400 uppercase tracking-wider px-4 py-3 whitespace-nowrap
                      ${header.column.getCanSort() ? "cursor-pointer select-none hover:text-gray-600 transition-colors" : ""}
                      ${header.column.columnDef.meta?.className || ""}`}
                  >
                    <div className="flex items-center gap-1">
                      {flexRender(header.column.columnDef.header, header.getContext())}
                      {header.column.getCanSort() && (
                        header.column.getIsSorted() === "asc"  ? <ChevronUp    size={11} className="text-bassani-600 shrink-0" /> :
                        header.column.getIsSorted() === "desc" ? <ChevronDown  size={11} className="text-bassani-600 shrink-0" /> :
                                                                  <ChevronsUpDown size={11} className="opacity-30 shrink-0" />
                      )}
                    </div>
                  </th>
                ))}
              </tr>
            ))}
          </thead>
          <tbody>
            {loading ? (
              <tr><td colSpan={columns.length} className="py-12 text-center"><Spinner /></td></tr>
            ) : table.getRowModel().rows.length === 0 ? (
              <tr><td colSpan={columns.length}><EmptyState /></td></tr>
            ) : (
              table.getRowModel().rows.map(row => (
                <tr key={row.id}
                  onClick={() => onRowClick?.(row.original)}
                  className={`border-b border-gray-50 transition-colors ${onRowClick ? "cursor-pointer hover:bg-gray-50" : "hover:bg-gray-50/50"}`}
                >
                  {row.getVisibleCells().map(cell => (
                    <td key={cell.id} className={`px-4 py-3 text-gray-700 text-sm ${cell.column.columnDef.meta?.className || ""}`}>
                      {flexRender(cell.column.columnDef.cell, cell.getContext())}
                    </td>
                  ))}
                </tr>
              ))
            )}
          </tbody>
        </table>
      </div>

      {/* Pagination footer */}
      {(totalRows > 0 || manualPagination) && (
        <div className="flex items-center justify-between gap-3 px-4 py-2.5 border-t border-gray-100 bg-gray-50/60 text-xs text-gray-500 flex-wrap">
          <span className="shrink-0 tabular-nums">
            {totalRows === 0 ? "No results" : `Showing ${from}–${to} of ${totalRows}`}
          </span>
          <div className="flex items-center gap-1">
            <button onClick={() => goTo(0)} disabled={!canPrev}
              className="px-2 py-1 rounded border border-gray-200 disabled:opacity-30 disabled:cursor-not-allowed hover:bg-gray-100 transition-colors">«</button>
            <button onClick={() => goTo(pageIndex - 1)} disabled={!canPrev}
              className="px-2 py-1 rounded border border-gray-200 disabled:opacity-30 disabled:cursor-not-allowed hover:bg-gray-100 transition-colors">‹</button>
            <span className="px-2 tabular-nums">{pageIndex + 1} / {pageCount > 0 ? pageCount : 1}</span>
            <button onClick={() => goTo(pageIndex + 1)} disabled={!canNext}
              className="px-2 py-1 rounded border border-gray-200 disabled:opacity-30 disabled:cursor-not-allowed hover:bg-gray-100 transition-colors">›</button>
            <button onClick={() => goTo(pageCount - 1)} disabled={!canNext}
              className="px-2 py-1 rounded border border-gray-200 disabled:opacity-30 disabled:cursor-not-allowed hover:bg-gray-100 transition-colors">»</button>
          </div>
          <select value={pageSize} onChange={e => changeSize(Number(e.target.value))}
            className="border border-gray-200 rounded px-2 py-1 text-xs bg-white focus:outline-none focus:border-bassani-600">
            {pageSizeOptions.map(s => <option key={s} value={s}>{s} per page</option>)}
          </select>
        </div>
      )}
    </div>
  );
}

// ── Modal ─────────────────────────────────────────────────────────────────────
export function Modal({ title, onClose, children, width = "max-w-lg" }) {
  return (
    <div className="fixed inset-0 bg-black/40 flex items-end sm:items-center justify-center z-50 p-0 sm:p-4" onClick={(e) => e.target === e.currentTarget && onClose()}>
      <div className={`bg-white rounded-t-2xl sm:rounded-2xl shadow-2xl w-full ${width} max-h-[92vh] overflow-y-auto`}>
        <div className="flex items-center justify-between px-6 py-4 border-b border-gray-100">
          <h2 className="text-base font-semibold text-gray-900">{title}</h2>
          <button onClick={onClose} className="text-gray-400 hover:text-gray-600 text-xl leading-none">×</button>
        </div>
        <div className="px-6 py-5">{children}</div>
      </div>
    </div>
  );
}

// ── Form components ───────────────────────────────────────────────────────────
export function FormGroup({ label, children, required }) {
  return (
    <div className="mb-4">
      <label className="block text-xs font-semibold text-gray-600 mb-1.5">
        {label}{required && <span className="text-red-400 ml-0.5">*</span>}
      </label>
      {children}
    </div>
  );
}

export function Input({ ...props }) {
  return (
    <input {...props}
      className="w-full border border-gray-200 rounded-lg px-3 py-2 text-sm text-gray-800 bg-gray-50 focus:outline-none focus:border-bassani-600 focus:ring-2 focus:ring-bassani-600/10 transition-all placeholder-gray-400" />
  );
}

export function Select({ children, ...props }) {
  return (
    <select {...props}
      className="w-full border border-gray-200 rounded-lg px-3 py-2 text-sm text-gray-800 bg-gray-50 focus:outline-none focus:border-bassani-600 transition-all">
      {children}
    </select>
  );
}

export function Textarea({ ...props }) {
  return (
    <textarea {...props}
      className="w-full border border-gray-200 rounded-lg px-3 py-2 text-sm text-gray-800 bg-gray-50 focus:outline-none focus:border-bassani-600 focus:ring-2 focus:ring-bassani-600/10 transition-all resize-none" />
  );
}

// ── Badges ────────────────────────────────────────────────────────────────────
const STATUS_STYLES = {
  draft:      "bg-gray-100 text-gray-600",
  sent:       "bg-blue-50 text-blue-700",
  sale:       "bg-green-50 text-green-700",
  done:       "bg-purple-50 text-purple-700",
  cancel:     "bg-red-50 text-red-600",
  cancelled:  "bg-red-50 text-red-600",
  purchase:   "bg-green-50 text-green-700",
  posted:     "bg-green-50 text-green-700",
  not_paid:   "bg-amber-50 text-amber-700",
  paid:       "bg-green-50 text-green-700",
  in_payment: "bg-blue-50 text-blue-700",
  partial:    "bg-orange-50 text-orange-700",
  pending:    "bg-amber-50 text-amber-700",
  contacted:  "bg-blue-50 text-blue-700",
  approved:   "bg-green-50 text-green-700",
  declined:   "bg-red-50 text-red-600",
  processing: "bg-blue-50 text-blue-700",
  shipped:    "bg-bassani-50 text-bassani-700",
  delivered:  "bg-green-50 text-green-700",
};

const COLOR_STYLES = {
  gray:   "bg-gray-100 text-gray-600",
  blue:   "bg-blue-50 text-blue-700",
  green:  "bg-green-50 text-green-700",
  red:    "bg-red-50 text-red-600",
  amber:  "bg-amber-50 text-amber-700",
  purple: "bg-purple-100 text-purple-700",
  orange: "bg-orange-50 text-orange-700",
  teal:   "bg-teal-50 text-teal-700",
  pink:   "bg-pink-50 text-pink-700",
  indigo: "bg-indigo-50 text-indigo-700",
};

export function Badge({ status, label, color, children }) {
  const style = color
    ? (COLOR_STYLES[color] || "bg-gray-100 text-gray-600")
    : (STATUS_STYLES[status?.toLowerCase()] || "bg-gray-100 text-gray-600");
  const text = children ?? label ?? (status ? status.replace(/_/g, " ").replace(/\b\w/g, c => c.toUpperCase()) : "—");
  return <span className={`inline-block text-[10px] font-semibold px-2 py-0.5 rounded-full ${style}`}>{text}</span>;
}

// ── Stat card ─────────────────────────────────────────────────────────────────
export function StatCard({ label, value, sub, accent }) {
  return (
    <div className="bg-white border border-gray-100 rounded-xl p-5">
      <p className="text-xs text-gray-500 mb-1.5">{label}</p>
      <p className={`text-2xl font-semibold ${accent || "text-gray-900"}`}>{value}</p>
      {sub && <p className="text-xs text-gray-400 mt-1">{sub}</p>}
    </div>
  );
}

// ── Search bar ────────────────────────────────────────────────────────────────
export function SearchBar({ value, onChange, placeholder = "Search…" }) {
  return (
    <div className="relative">
      <svg className="absolute left-3 top-1/2 -translate-y-1/2 text-gray-400" width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><circle cx="11" cy="11" r="8"/><line x1="21" y1="21" x2="16.65" y2="16.65"/></svg>
      <input value={value} onChange={(e) => onChange(e.target.value)}
        placeholder={placeholder}
        className="pl-8 pr-3 py-2 border border-gray-200 rounded-lg text-sm bg-white text-gray-800 focus:outline-none focus:border-bassani-600 w-64 transition-all placeholder-gray-400" />
    </div>
  );
}

// ── Chip row with chevron scroll buttons ──────────────────────────────────────
export function ChipRow({ children }) {
  const ref = useRef(null);
  const scroll = (dir) => ref.current?.scrollBy({ left: dir * 160, behavior: "smooth" });
  return (
    <div className="flex items-center gap-1">
      <button type="button" onClick={() => scroll(-1)}
        className="shrink-0 p-0.5 text-gray-500 hover:text-gray-700 transition-colors">
        <ChevronLeft size={15} />
      </button>
      <div ref={ref} className="flex gap-2 overflow-x-auto no-scrollbar flex-1 pb-0.5">
        {children}
      </div>
      <button type="button" onClick={() => scroll(1)}
        className="shrink-0 p-0.5 text-gray-500 hover:text-gray-700 transition-colors">
        <ChevronRight size={15} />
      </button>
    </div>
  );
}

// ── Filter pill ───────────────────────────────────────────────────────────────
export function FilterPill({ label, active, onClick }) {
  return (
    <button onClick={onClick}
      className={`shrink-0 px-3 py-1.5 rounded-lg text-xs font-medium transition-all border ${
        active ? "bg-bassani-600 text-white border-bassani-600" : "bg-white text-gray-500 border-gray-200 hover:border-bassani-600 hover:text-bassani-600"
      }`}>
      {label}
    </button>
  );
}

// ── Section divider ───────────────────────────────────────────────────────────
export function SectionDivider({ label }) {
  return (
    <div className="border-b border-gray-100 pb-1.5 mb-4 mt-2">
      <p className="text-[10px] font-bold text-gray-400 uppercase tracking-wider">{label}</p>
    </div>
  );
}
