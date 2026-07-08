import { useState, useEffect } from "react";
import api from "../api";
import toast from "react-hot-toast";
import { useAuth } from "../AuthContext";
import {
  UserPlus, KeyRound, PowerOff, Power, Copy, Check,
  ChevronDown, ChevronUp, ShieldCheck, Warehouse,
} from "lucide-react";
import {
  TopBar, DataTable, Modal, FormGroup, Input, Select,
  BtnPrimary, BtnSecondary, BtnDanger, Badge, LoadingState, fmtDate,
  SearchBar, ChipRow, FilterPill,
} from "../components/UI";

// ── Permission configuration ──────────────────────────────────────────────────

const PERMISSION_GROUPS = [
  {
    domain: "products",
    label: "Products",
    actions: [
      { key: "manage", label: "Create, edit & archive products" },
    ],
  },
  {
    domain: "orders",
    label: "Orders",
    actions: [
      { key: "view",    label: "View orders" },
      { key: "confirm", label: "Confirm orders" },
      { key: "cancel",  label: "Cancel orders" },
    ],
  },
  {
    domain: "customers",
    label: "Customers & Onboarding",
    actions: [
      { key: "view",                label: "View customers" },
      { key: "manage",              label: "Create & edit customers" },
      { key: "approve_onboarding",  label: "Approve onboarding applications" },
      { key: "reject_onboarding",   label: "Reject onboarding applications" },
    ],
  },
  {
    domain: "commission",
    label: "Commission",
    actions: [
      { key: "view",                label: "View statements" },
      { key: "generate_statements", label: "Generate monthly statements" },
      { key: "mark_paid",           label: "Mark statements as paid" },
      { key: "configure_tiers",     label: "Configure commission tiers" },
    ],
  },
  {
    domain: "resellers",
    label: "Resellers",
    actions: [
      { key: "view",   label: "View resellers" },
      { key: "manage", label: "Create & edit resellers" },
    ],
  },
  {
    domain: "invoices",
    label: "Invoices",
    actions: [
      { key: "view",           label: "View invoices" },
      { key: "record_payment", label: "Record payments" },
    ],
  },
  {
    domain: "reports",
    label: "Reports",
    actions: [
      { key: "view",   label: "View reports" },
      { key: "export", label: "Export report data" },
    ],
  },
  {
    domain: "healthcare",
    label: "Healthcare",
    actions: [
      { key: "view",   label: "View healthcare records" },
      { key: "manage", label: "Manage healthcare records" },
    ],
  },
  {
    domain: "users",
    label: "User Management",
    actions: [
      { key: "manage", label: "Create & edit staff accounts" },
    ],
  },
  {
    domain: "warehouse",
    label: "Warehouse",
    actions: [
      { key: "view",      label: "View warehouse data" },
      { key: "supervise", label: "Supervise packing floor" },
    ],
  },
  {
    domain: "audit",
    label: "Audit Trail",
    actions: [
      { key: "view", label: "View audit trail" },
    ],
  },
  {
    domain: "tickets",
    label: "Tickets",
    actions: [
      { key: "sales",           label: "Sales ticket queue" },
      { key: "orders",          label: "Orders ticket queue" },
      { key: "finance_confirm", label: "Confirm payment received" },
      { key: "qa_approve",      label: "QA approval" },
      { key: "rp_approve",      label: "Responsible Pharmacist approval" },
      { key: "manage",          label: "Override ticket stage manually (admin only)" },
    ],
  },
  {
    domain: "settings",
    label: "Settings",
    actions: [
      { key: "manage", label: "Manage email routing, mailboxes, document templates & signing authority" },
    ],
  },
];

const ROLE_OPTIONS = [
  { value: "admin",                   label: "Admin",                       adminOnly: true  },
  { value: "warehouse_supervisor",    label: "Warehouse Supervisor",        adminOnly: false },
  { value: "packer",                  label: "Packer",                      adminOnly: false },
  { value: "sales",                   label: "Sales (ticket queue)",        adminOnly: false },
  { value: "orders_clerk",            label: "Orders Clerk (ticket queue)", adminOnly: false },
  { value: "finance",                 label: "Finance",                     adminOnly: false },
  { value: "qa_manager",              label: "QA Manager",                  adminOnly: false },
  { value: "responsible_pharmacist",  label: "Responsible Pharmacist",      adminOnly: false },
];

const ROLE_COLORS = {
  super_admin:             "purple",
  admin:                   "blue",
  warehouse_supervisor:    "amber",
  packer:                  "green",
  reseller:                "teal",
  sales:                   "pink",
  orders_clerk:            "amber",
  finance:                 "indigo",
  qa_manager:              "orange",
  responsible_pharmacist:  "orange",
};

const EMPTY_PERMISSIONS = Object.fromEntries(
  PERMISSION_GROUPS.map(g => [
    g.domain,
    Object.fromEntries(g.actions.map(a => [a.key, false])),
  ])
);

// Mirrors backend DEFAULT_ADMIN_PERMISSIONS — pre-selected when creating a new admin account.
const DEFAULT_ADMIN_PERMS = {
  products:   { manage: false },
  orders:     { view: true,  confirm: false, cancel: false },
  customers:  { view: true,  manage: false,  approve_onboarding: false, reject_onboarding: false },
  commission: { view: true,  generate_statements: false, mark_paid: false, configure_tiers: false },
  resellers:  { view: true,  manage: false },
  invoices:   { view: true,  record_payment: false },
  reports:    { view: true,  export: false },
  healthcare: { view: true,  manage: false },
  users:      { manage: false },
  warehouse:  { view: false, supervise: false },
  audit:      { view: false },
  tickets:    { sales: false, orders: false, finance_confirm: false, qa_approve: false, rp_approve: false, manage: false },
  settings:   { manage: false },
};

// Mirrors backend ROLE_DEFAULT_PERMISSIONS — pre-populated when creating a ticket-role account.
const TICKET_ROLES = new Set(["sales", "orders_clerk", "finance", "qa_manager", "responsible_pharmacist"]);

const ROLE_DEFAULT_PERMS = {
  sales: {
    products:   { manage: false },
    orders:     { view: true,  confirm: false, cancel: false },
    customers:  { view: true,  manage: true,   approve_onboarding: false, reject_onboarding: false },
    commission: { view: false, generate_statements: false, mark_paid: false, configure_tiers: false },
    resellers:  { view: false, manage: false },
    invoices:   { view: false, record_payment: false },
    reports:    { view: false, export: false },
    healthcare: { view: false, manage: false },
    users:      { manage: false },
    warehouse:  { view: false, supervise: false },
    audit:      { view: false },
    tickets:    { sales: true, orders: false, finance_confirm: false, qa_approve: false, rp_approve: false, manage: false },
  },
  orders_clerk: {
    products:   { manage: false },
    orders:     { view: true,  confirm: false, cancel: false },
    customers:  { view: true,  manage: false,  approve_onboarding: false, reject_onboarding: false },
    commission: { view: false, generate_statements: false, mark_paid: false, configure_tiers: false },
    resellers:  { view: false, manage: false },
    invoices:   { view: false, record_payment: false },
    reports:    { view: false, export: false },
    healthcare: { view: false, manage: false },
    users:      { manage: false },
    warehouse:  { view: false, supervise: false },
    audit:      { view: false },
    tickets:    { sales: false, orders: true, finance_confirm: false, qa_approve: false, rp_approve: false, manage: false },
  },
  finance: {
    products:   { manage: false },
    orders:     { view: true,  confirm: false, cancel: false },
    customers:  { view: true,  manage: false,  approve_onboarding: false, reject_onboarding: false },
    commission: { view: true,  generate_statements: true,  mark_paid: true,  configure_tiers: false },
    resellers:  { view: true,  manage: false },
    invoices:   { view: true,  record_payment: true },
    reports:    { view: true,  export: false },
    healthcare: { view: false, manage: false },
    users:      { manage: false },
    warehouse:  { view: false, supervise: false },
    audit:      { view: false },
    tickets:    { sales: false, orders: false, finance_confirm: true, qa_approve: false, rp_approve: false, manage: false },
  },
  qa_manager: {
    products:   { manage: false },
    orders:     { view: true,  confirm: false, cancel: false },
    customers:  { view: false, manage: false,  approve_onboarding: false, reject_onboarding: false },
    commission: { view: false, generate_statements: false, mark_paid: false, configure_tiers: false },
    resellers:  { view: false, manage: false },
    invoices:   { view: false, record_payment: false },
    reports:    { view: false, export: false },
    healthcare: { view: false, manage: false },
    users:      { manage: false },
    warehouse:  { view: false, supervise: false },
    audit:      { view: false },
    tickets:    { sales: false, orders: false, finance_confirm: false, qa_approve: true, rp_approve: false, manage: false },
  },
  responsible_pharmacist: {
    products:   { manage: false },
    orders:     { view: true,  confirm: false, cancel: false },
    customers:  { view: false, manage: false,  approve_onboarding: false, reject_onboarding: false },
    commission: { view: false, generate_statements: false, mark_paid: false, configure_tiers: false },
    resellers:  { view: false, manage: false },
    invoices:   { view: false, record_payment: false },
    reports:    { view: false, export: false },
    healthcare: { view: true,  manage: true },
    users:      { manage: false },
    warehouse:  { view: false, supervise: false },
    audit:      { view: false },
    tickets:    { sales: false, orders: false, finance_confirm: false, qa_approve: false, rp_approve: true, manage: false },
  },
};

// The core ticket permission per role — always checked and cannot be toggled off in the UI.
const ROLE_LOCKED_PERMS = {
  sales:                  { tickets: { sales: true } },
  orders_clerk:           { tickets: { orders: true } },
  finance:                { tickets: { finance_confirm: true } },
  qa_manager:             { tickets: { qa_approve: true } },
  responsible_pharmacist: { tickets: { rp_approve: true } },
};

// ── Component ─────────────────────────────────────────────────────────────────

export default function Users() {
  const { user: currentUser, can } = useAuth();
  const isSuperAdmin = currentUser?.is_super_admin;
  const canManageUsers = isSuperAdmin || can("users.manage");

  const [users,        setUsers       ] = useState([]);
  const [loading,      setLoading     ] = useState(true);
  const [search,       setSearch      ] = useState("");
  const [roleFilter,   setRoleFilter  ] = useState("all");
  const [statusFilter, setStatusFilter] = useState("all");
  const [warehouses,   setWarehouses  ] = useState([]);

  useEffect(() => {
    api.get("/api/warehouses/").then(r => setWarehouses(r.data.warehouses || [])).catch(() => {});
  }, []);
  const warehouseName = (id) => warehouses.find(w => w.id === id)?.name || null;

  // Create modal
  const [createModal, setCreateModal] = useState(false);
  const [createForm,  setCreateForm ] = useState({
    username: "", password: "", name: "", email: "", display_name: "", role: "admin", warehouse_id: "",
  });
  const [createPerms, setCreatePerms] = useState({ ...EMPTY_PERMISSIONS });

  // Assign warehouse modal (warehouse_supervisor / packer roles)
  const [warehouseModal,  setWarehouseModal ] = useState(false);
  const [warehouseTarget, setWarehouseTarget] = useState(null);
  const [warehouseValue,  setWarehouseValue ] = useState("");

  // Reset password modal
  const [resetModal,    setResetModal   ] = useState(false);
  const [resetTarget,   setResetTarget  ] = useState(null);
  const [resetPassword, setResetPassword] = useState("");
  const [revealed,      setRevealed     ] = useState(null);
  const [copied,        setCopied       ] = useState(false);

  // Permissions edit modal
  const [permsModal,  setPermsModal ] = useState(false);
  const [permsTarget, setPermsTarget] = useState(null);
  const [editPerms,   setEditPerms  ] = useState({});
  const [expandedGroups, setExpandedGroups] = useState({});

  const load = async () => {
    setLoading(true);
    try {
      const r = await api.get("/api/users/");
      setUsers(r.data.users);
    } catch {
      toast.error("Failed to load users");
    } finally {
      setLoading(false);
    }
  };
  useEffect(() => { load(); }, []);

  // ── Create user ─────────────────────────────────────────────────────────────

  const permsForRole = (role) => {
    if (role === "admin") return JSON.parse(JSON.stringify(DEFAULT_ADMIN_PERMS));
    if (TICKET_ROLES.has(role)) return JSON.parse(JSON.stringify(ROLE_DEFAULT_PERMS[role]));
    return JSON.parse(JSON.stringify(EMPTY_PERMISSIONS));
  };

  const openCreate = () => {
    const defaultRole = canManageUsers ? "admin" : "warehouse_supervisor";
    setCreateForm({ username: "", password: "", name: "", display_name: "", role: defaultRole, warehouse_id: "" });
    setCreatePerms(permsForRole(defaultRole));
    setCreateModal(true);
  };

  const createUser = async () => {
    if (!createForm.username || !createForm.password) return toast.error("Username and password required");
    if (createForm.password.length < 8) return toast.error("Password must be at least 8 characters");
    try {
      const body = { ...createForm };
      if (createForm.role === "admin" || TICKET_ROLES.has(createForm.role)) body.permissions = createPerms;
      if (createForm.role !== "packer") delete body.display_name;
      if (["warehouse_supervisor", "packer"].includes(createForm.role) && createForm.warehouse_id) {
        body.warehouse_id = parseInt(createForm.warehouse_id);
      } else {
        delete body.warehouse_id;
      }
      await api.post("/api/users/", body);
      toast.success("Account created");
      setCreateModal(false);
      load();
    } catch (e) {
      toast.error(e.response?.data?.detail || "Create failed");
    }
  };

  // ── Assign warehouse (supervisor/packer) ───────────────────────────────────

  const openWarehouse = (u) => {
    setWarehouseTarget(u);
    setWarehouseValue(u.warehouse_id || "");
    setWarehouseModal(true);
  };

  const saveWarehouse = async () => {
    try {
      await api.put(`/api/users/${warehouseTarget.id}`, {
        warehouse_id: warehouseValue ? parseInt(warehouseValue) : null,
      });
      toast.success("Warehouse assignment updated");
      setWarehouseModal(false);
      load();
    } catch (e) {
      toast.error(e.response?.data?.detail || "Update failed");
    }
  };

  // ── Reset password ───────────────────────────────────────────────────────────

  const openReset = (u) => {
    setResetTarget(u);
    setResetPassword("");
    setRevealed(null);
    setCopied(false);
    setResetModal(true);
  };

  const submitReset = async () => {
    if (resetPassword && resetPassword.length < 8) return toast.error("Password must be at least 8 characters");
    try {
      const r = await api.post(
        `/api/users/${resetTarget.id}/reset-password`,
        resetPassword ? { new_password: resetPassword } : {}
      );
      setRevealed(r.data.new_password);
    } catch (e) {
      toast.error(e.response?.data?.detail || "Reset failed");
    }
  };

  const closeReset = () => { setResetModal(false); setRevealed(null); setResetTarget(null); load(); };

  // ── Toggle active ────────────────────────────────────────────────────────────

  const toggleActive = async (u) => {
    if (u.active && !window.confirm(`Deactivate ${u.username}? They will no longer be able to log in.`)) return;
    try {
      if (u.active) await api.delete(`/api/users/${u.id}`);
      else          await api.post(`/api/users/${u.id}/reactivate`);
      toast.success(u.active ? "Account deactivated" : "Account reactivated");
      load();
    } catch (e) {
      toast.error(e.response?.data?.detail || "Action failed");
    }
  };

  // ── Permissions editor ───────────────────────────────────────────────────────

  const openPerms = (u) => {
    const base = { ...EMPTY_PERMISSIONS };
    const stored = u.permissions || {};
    for (const g of PERMISSION_GROUPS) {
      base[g.domain] = { ...base[g.domain], ...(stored[g.domain] || {}) };
    }
    setPermsTarget(u);
    setEditPerms(base);
    setExpandedGroups(Object.fromEntries(PERMISSION_GROUPS.map(g => [g.domain, true])));
    setPermsModal(true);
  };

  const togglePerm = (domain, action) => {
    setEditPerms(prev => ({
      ...prev,
      [domain]: { ...prev[domain], [action]: !prev[domain][action] },
    }));
  };

  const toggleGroup = (domain) => {
    const allOn = PERMISSION_GROUPS.find(g => g.domain === domain)
      ?.actions.every(a => editPerms[domain]?.[a.key]);
    setEditPerms(prev => ({
      ...prev,
      [domain]: Object.fromEntries(
        PERMISSION_GROUPS.find(g => g.domain === domain).actions.map(a => [a.key, !allOn])
      ),
    }));
  };

  const savePerms = async () => {
    try {
      await api.put(`/api/users/${permsTarget.id}`, { permissions: editPerms });
      toast.success("Permissions updated");
      setPermsModal(false);
      load();
    } catch (e) {
      toast.error(e.response?.data?.detail || "Save failed");
    }
  };

  const setCreatePerm = (domain, action, value) => {
    setCreatePerms(prev => ({ ...prev, [domain]: { ...prev[domain], [action]: value } }));
  };

  // ── Helpers ──────────────────────────────────────────────────────────────────

  const availableRoles = ROLE_OPTIONS.filter(r => canManageUsers || !r.adminOnly);

  const filtered = users.filter(u => {
    const q = search.toLowerCase();
    const matchSearch = !q || u.username.toLowerCase().includes(q) || (u.name || "").toLowerCase().includes(q);
    const matchRole   = roleFilter === "all"
      || (roleFilter === "super_admin" && u.is_super_admin)
      || (!u.is_super_admin && u.role === roleFilter);
    const matchStatus = statusFilter === "all"
      || (statusFilter === "active"   && u.active !== false)
      || (statusFilter === "inactive" && u.active === false);
    return matchSearch && matchRole && matchStatus;
  });

  const permSummary = (u) => {
    if (u.is_super_admin)                  return "Full access";
    if (u.role === "warehouse_supervisor") return "Packing floor — supervisor";
    if (u.role === "packer")               return "Packing floor — packer";
    if (u.role === "reseller")             return "Reseller portal";
    if (!u.permissions)                    return "—";
    const enabled = Object.values(u.permissions).flatMap(Object.values).filter(Boolean).length;
    const total   = Object.values(u.permissions).flatMap(Object.values).length;
    return `${enabled} / ${total} permissions`;
  };

  return (
    <div className="flex flex-col flex-1 overflow-hidden">
      <TopBar
        title="User Accounts"
        subtitle="Manage portal login accounts and permissions"
        onRefresh={load}
        actions={
          <BtnPrimary onClick={openCreate}>
            <UserPlus size={14} /> Add User
          </BtnPrimary>
        }
      />

      <main className="flex-1 overflow-y-auto p-6">
        <div className="mb-4 space-y-2">
          <SearchBar
            value={search}
            onChange={v => setSearch(v)}
            placeholder="Search username or name…"
          />
          <ChipRow>
            {[
              { value: "all",                  label: "All" },
              { value: "super_admin",          label: "Super Admin" },
              { value: "admin",                label: "Admin" },
              { value: "warehouse_supervisor", label: "Supervisor" },
              { value: "packer",               label: "Packer" },
              { value: "sales",                  label: "Sales" },
              { value: "orders_clerk",           label: "Orders Clerk" },
              { value: "finance",                label: "Finance" },
              { value: "qa_manager",             label: "QA Manager" },
              { value: "responsible_pharmacist", label: "RP" },
            ].map(r => (
              <FilterPill key={r.value} label={r.label} active={roleFilter === r.value}
                onClick={() => setRoleFilter(r.value)} />
            ))}
            <span className="w-px h-4 bg-gray-200 self-center mx-1" />
            {[
              { value: "all",      label: "Any status" },
              { value: "active",   label: "Active" },
              { value: "inactive", label: "Inactive" },
            ].map(s => (
              <FilterPill key={s.value} label={s.label} active={statusFilter === s.value}
                onClick={() => setStatusFilter(s.value)} />
            ))}
          </ChipRow>
        </div>
        <DataTable
          loading={loading}
          data={filtered}
          total={filtered.length}
          columns={[
            {
              id: "username",
              header: "Username",
              enableSorting: false,
              cell: ({ row: { original: u } }) => (
                <div className="flex items-center gap-2">
                  <span className="font-mono text-sm font-medium text-gray-900">{u.username}</span>
                  {u.is_super_admin && (
                    <span title="Super Admin" className="inline-flex items-center gap-1 text-[10px] font-bold text-purple-700 bg-purple-100 border border-purple-200 rounded-full px-2 py-0.5">
                      <ShieldCheck size={10} /> SUPER
                    </span>
                  )}
                </div>
              ),
            },
            {
              id: "name",
              header: "Name",
              enableSorting: false,
              cell: ({ row: { original: u } }) => (
                <div>
                  <p className="text-sm font-medium text-gray-900">{u.name || <span className="text-gray-300">—</span>}</p>
                  {u.email && <p className="text-[11px] text-gray-400 mt-0.5">{u.email}</p>}
                </div>
              ),
            },
            {
              id: "role",
              header: "Role",
              enableSorting: false,
              cell: ({ row: { original: u } }) => (
                <Badge color={ROLE_COLORS[u.role] || "gray"}>
                  {u.role?.replace(/_/g, " ")}
                </Badge>
              ),
            },
            {
              id: "permissions",
              header: "Permissions",
              enableSorting: false,
              meta: { className: "hidden lg:table-cell" },
              cell: ({ row: { original: u } }) => (
                <span className="text-xs text-gray-500">{permSummary(u)}</span>
              ),
            },
            {
              id: "warehouse",
              header: "Warehouse",
              enableSorting: false,
              meta: { className: "hidden md:table-cell" },
              cell: ({ row: { original: u } }) => (
                ["warehouse_supervisor", "packer"].includes(u.role)
                  ? (warehouseName(u.warehouse_id)
                      ? <span className="text-xs text-gray-600">{warehouseName(u.warehouse_id)}</span>
                      : <span className="text-xs text-amber-600 italic">Unassigned</span>)
                  : <span className="text-gray-300">—</span>
              ),
            },
            {
              id: "status",
              header: "Status",
              enableSorting: false,
              meta: { className: "hidden sm:table-cell" },
              cell: ({ row: { original: u } }) => (
                <Badge color={u.active !== false ? "green" : "red"}>
                  {u.active !== false ? "Active" : "Inactive"}
                </Badge>
              ),
            },
            {
              id: "last_login",
              header: "Last Login",
              enableSorting: false,
              meta: { className: "hidden md:table-cell" },
              cell: ({ row: { original: u } }) => (
                <span className="text-xs text-gray-400">
                  {u.last_login_at ? fmtDate(u.last_login_at) : <span className="italic">Never</span>}
                </span>
              ),
            },
            {
              id: "actions",
              header: "",
              enableSorting: false,
              cell: ({ row: { original: u } }) => (
                <div className="flex gap-1.5 flex-wrap">
                  {canManageUsers && (u.role === "admin" || TICKET_ROLES.has(u.role)) && !u.is_super_admin && (
                    <BtnSecondary size="sm" onClick={() => openPerms(u)} title="Edit permissions">
                      <ShieldCheck size={12} />
                    </BtnSecondary>
                  )}
                  {["warehouse_supervisor", "packer"].includes(u.role) && (
                    <BtnSecondary size="sm" onClick={() => openWarehouse(u)} title="Assign warehouse">
                      <Warehouse size={12} />
                    </BtnSecondary>
                  )}
                  <BtnSecondary size="sm" onClick={() => openReset(u)} title="Reset password">
                    <KeyRound size={12} />
                  </BtnSecondary>
                  {!u.is_super_admin && (
                    u.active !== false
                      ? <BtnDanger onClick={() => toggleActive(u)} title="Deactivate"><PowerOff size={12} /></BtnDanger>
                      : <BtnSecondary size="sm" onClick={() => toggleActive(u)} title="Reactivate"><Power size={12} /></BtnSecondary>
                  )}
                </div>
              ),
            },
          ]}
        />
      </main>

      {/* ── Create user modal ── */}
      {createModal && (
        <Modal title="Add User Account" onClose={() => setCreateModal(false)}>
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
            <FormGroup label="Username" required>
              <Input
                value={createForm.username}
                onChange={e => setCreateForm({ ...createForm, username: e.target.value.toLowerCase().replace(/\s/g, "") })}
                placeholder="e.g. jane.admin"
              />
            </FormGroup>
            <FormGroup label="Full Name">
              <Input
                value={createForm.name}
                onChange={e => setCreateForm({ ...createForm, name: e.target.value })}
                placeholder="Jane Smith"
              />
            </FormGroup>
            <FormGroup label="Email Address">
              <Input
                type="email"
                value={createForm.email}
                onChange={e => setCreateForm({ ...createForm, email: e.target.value.toLowerCase() })}
                placeholder="jane@company.com"
              />
            </FormGroup>
            <FormGroup label="Password" required>
              <Input
                type="password"
                value={createForm.password}
                onChange={e => setCreateForm({ ...createForm, password: e.target.value })}
                placeholder="Min. 8 characters"
              />
            </FormGroup>
            <FormGroup label="Role">
              <Select
                value={createForm.role}
                onChange={e => {
                  const role = e.target.value;
                  setCreateForm({ ...createForm, role });
                  setCreatePerms(permsForRole(role));
                }}
              >
                {availableRoles.map(r => (
                  <option key={r.value} value={r.value}>{r.label}</option>
                ))}
              </Select>
            </FormGroup>
            {createForm.role === "packer" && (
              <FormGroup label="Display Name" className="col-span-2">
                <Input
                  value={createForm.display_name}
                  onChange={e => setCreateForm({ ...createForm, display_name: e.target.value.toUpperCase() })}
                  placeholder="Shown on packing board, e.g. THEMBI"
                />
              </FormGroup>
            )}
            {["warehouse_supervisor", "packer"].includes(createForm.role) && (
              <FormGroup label="Warehouse" className="col-span-2">
                <Select
                  value={createForm.warehouse_id}
                  onChange={e => setCreateForm({ ...createForm, warehouse_id: e.target.value })}
                >
                  <option value="">— Select warehouse —</option>
                  {warehouses.map(w => (
                    <option key={w.id} value={w.id}>{w.name}</option>
                  ))}
                </Select>
                <p className="text-[11px] text-gray-400 mt-1">Which vault this account's packing board is scoped to.</p>
              </FormGroup>
            )}
          </div>

          {/* Permissions panel — admin and all ticket roles */}
          {(createForm.role === "admin" || TICKET_ROLES.has(createForm.role)) && (
            <div className="mt-4 border border-gray-200 rounded-xl overflow-hidden">
              <div className="bg-gray-50 px-4 py-2.5 border-b border-gray-200">
                <p className="text-xs font-semibold text-gray-700">Permissions</p>
                <p className="text-[11px] text-gray-400 mt-0.5">
                  {createForm.role === "admin"
                    ? "Defaults to view-only. Toggle to grant additional access."
                    : "Pre-set for this role. Locked permissions cannot be removed. Toggle to extend access."}
                </p>
              </div>
              <div className="divide-y divide-gray-100 max-h-72 overflow-y-auto">
                {PERMISSION_GROUPS.map(group => {
                  const groupLocked = ROLE_LOCKED_PERMS[createForm.role]?.[group.domain] || {};
                  return (
                    <PermissionGroup
                      key={group.domain}
                      group={group}
                      perms={createPerms[group.domain]}
                      lockedPerms={groupLocked}
                      onToggle={(action) => {
                        if (groupLocked[action]) return;
                        setCreatePerm(group.domain, action, !createPerms[group.domain][action]);
                      }}
                      onToggleAll={() => {
                        const unlocked = group.actions.filter(a => !groupLocked[a.key]);
                        const allOn = unlocked.every(a => createPerms[group.domain][a.key]);
                        setCreatePerms(prev => ({
                          ...prev,
                          [group.domain]: {
                            ...prev[group.domain],
                            ...Object.fromEntries(unlocked.map(a => [a.key, !allOn])),
                          },
                        }));
                      }}
                    />
                  );
                })}
              </div>
            </div>
          )}

          <div className="flex justify-end gap-2 mt-4">
            <BtnSecondary onClick={() => setCreateModal(false)}>Cancel</BtnSecondary>
            <BtnPrimary onClick={createUser}>Create Account</BtnPrimary>
          </div>
        </Modal>
      )}

      {/* ── Reset password modal ── */}
      {resetModal && resetTarget && (
        <Modal title={`Reset Password — ${resetTarget.username}`} onClose={closeReset}>
          {!revealed ? (
            <>
              <p className="text-sm text-gray-500 mb-4">
                Enter a new password, or leave blank to generate a secure random one.
              </p>
              <FormGroup label="New Password (optional)">
                <Input
                  type="password"
                  value={resetPassword}
                  onChange={e => setResetPassword(e.target.value)}
                  placeholder="Leave blank to auto-generate"
                />
              </FormGroup>
              <div className="flex justify-end gap-2 mt-4">
                <BtnSecondary onClick={closeReset}>Cancel</BtnSecondary>
                <BtnPrimary onClick={submitReset}><KeyRound size={13} /> Reset Password</BtnPrimary>
              </div>
            </>
          ) : (
            <>
              <div className="bg-amber-50 border border-amber-200 rounded-xl p-4 mb-4">
                <p className="text-xs font-semibold text-amber-700 mb-1">Save this password now — it will not be shown again</p>
                <p className="text-sm text-amber-600">Share it securely with the user and ask them to change it on first login.</p>
              </div>
              <div className="flex items-center gap-2 bg-gray-50 border border-gray-200 rounded-xl px-4 py-3">
                <span className="font-mono text-sm flex-1 select-all text-gray-900">{revealed}</span>
                <button
                  onClick={() => { navigator.clipboard.writeText(revealed); setCopied(true); setTimeout(() => setCopied(false), 2000); }}
                  className="text-bassani-600 hover:text-bassani-700 transition-colors"
                >
                  {copied ? <Check size={15} /> : <Copy size={15} />}
                </button>
              </div>
              <div className="flex justify-end mt-4">
                <BtnPrimary onClick={closeReset}>Done</BtnPrimary>
              </div>
            </>
          )}
        </Modal>
      )}

      {/* ── Assign warehouse modal ── */}
      {warehouseModal && warehouseTarget && (
        <Modal title={`Assign Warehouse — ${warehouseTarget.username}`} onClose={() => setWarehouseModal(false)}>
          <p className="text-sm text-gray-500 mb-4">
            Determines which vault's packing board and stock this account works against.
          </p>
          <FormGroup label="Warehouse">
            <Select value={warehouseValue} onChange={e => setWarehouseValue(e.target.value)}>
              <option value="">— Unassigned —</option>
              {warehouses.map(w => (
                <option key={w.id} value={w.id}>{w.name}</option>
              ))}
            </Select>
          </FormGroup>
          <div className="flex justify-end gap-2 mt-4">
            <BtnSecondary onClick={() => setWarehouseModal(false)}>Cancel</BtnSecondary>
            <BtnPrimary onClick={saveWarehouse}><Warehouse size={13} /> Save</BtnPrimary>
          </div>
        </Modal>
      )}

      {/* ── Edit permissions modal ── */}
      {permsModal && permsTarget && (() => {
        const roleLocked = ROLE_LOCKED_PERMS[permsTarget.role] || {};
        return (
          <Modal title={`Permissions — ${permsTarget.username}`} onClose={() => setPermsModal(false)}>
            <p className="text-xs text-gray-500 mb-3">
              Super admin always overrides these. Changes take effect immediately on next API call.
              {TICKET_ROLES.has(permsTarget.role) && " Locked permissions are part of this role's core access and cannot be removed."}
            </p>
            <div className="border border-gray-200 rounded-xl overflow-hidden max-h-96 overflow-y-auto">
              <div className="divide-y divide-gray-100">
                {PERMISSION_GROUPS.map(group => {
                  const groupLocked = roleLocked[group.domain] || {};
                  return (
                    <PermissionGroup
                      key={group.domain}
                      group={group}
                      perms={editPerms[group.domain]}
                      lockedPerms={groupLocked}
                      expanded={expandedGroups[group.domain]}
                      onExpand={() => setExpandedGroups(prev => ({ ...prev, [group.domain]: !prev[group.domain] }))}
                      onToggle={(action) => { if (!groupLocked[action]) togglePerm(group.domain, action); }}
                      onToggleAll={() => {
                        const unlocked = PERMISSION_GROUPS.find(g => g.domain === group.domain)
                          ?.actions.filter(a => !groupLocked[a.key]) || [];
                        const allOn = unlocked.every(a => editPerms[group.domain]?.[a.key]);
                        setEditPerms(prev => ({
                          ...prev,
                          [group.domain]: {
                            ...prev[group.domain],
                            ...Object.fromEntries(unlocked.map(a => [a.key, !allOn])),
                          },
                        }));
                      }}
                    />
                  );
                })}
              </div>
            </div>
            <div className="flex justify-end gap-2 mt-4">
              <BtnSecondary onClick={() => setPermsModal(false)}>Cancel</BtnSecondary>
              <BtnPrimary onClick={savePerms}><ShieldCheck size={13} /> Save Permissions</BtnPrimary>
            </div>
          </Modal>
        );
      })()}
    </div>
  );
}

// ── PermissionGroup sub-component ─────────────────────────────────────────────

function PermissionGroup({ group, perms = {}, lockedPerms = {}, expanded = true, onExpand, onToggle, onToggleAll }) {
  const allOn = group.actions.every(a => perms[a.key]);
  const anyOn = group.actions.some(a => perms[a.key]);

  return (
    <div>
      <div className="flex items-center justify-between px-4 py-2.5 bg-gray-50 cursor-pointer select-none"
        onClick={onExpand || (() => {})}>
        <div className="flex items-center gap-3">
          {/* Group toggle */}
          <button
            type="button"
            className={`w-8 h-4 rounded-full transition-colors relative flex-shrink-0 overflow-hidden focus:outline-none ${
              allOn ? "bg-bassani-600" : anyOn ? "bg-bassani-300" : "bg-gray-200"
            }`}
            onClick={e => { e.stopPropagation(); onToggleAll(); }}
            title={allOn ? "Disable all" : "Enable all"}
          >
            <span className={`absolute top-0.5 w-3 h-3 bg-white rounded-full shadow transition-transform ${
              allOn ? "translate-x-[17px]" : anyOn ? "translate-x-[9px]" : "translate-x-0.5"
            }`} />
          </button>
          <span className="text-xs font-semibold text-gray-700">{group.label}</span>
        </div>
        {onExpand && (
          expanded ? <ChevronUp size={13} className="text-gray-400" /> : <ChevronDown size={13} className="text-gray-400" />
        )}
      </div>

      {expanded && (
        <div className="pr-4 pl-[44px] pb-2 pt-1 space-y-1">
          {group.actions.map(action => {
            const isLocked = !!lockedPerms[action.key];
            return (
              <label key={action.key} className={`flex items-center gap-3 py-1 ${isLocked ? "opacity-60" : "cursor-pointer group"}`}>
                <div
                  className={`w-4 h-4 rounded flex items-center justify-center flex-shrink-0 transition-colors ${
                    perms[action.key] ? "bg-bassani-600 border-bassani-600" : "bg-white border border-gray-300"
                  } ${isLocked ? "cursor-not-allowed" : ""}`}
                  onClick={() => !isLocked && onToggle(action.key)}
                >
                  {perms[action.key] && (
                    <svg className="w-2.5 h-2.5 text-white" fill="none" viewBox="0 0 10 10">
                      <path d="M2 5l2 2 4-4" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" />
                    </svg>
                  )}
                </div>
                <span className={`text-xs ${isLocked ? "text-gray-400" : "text-gray-600 group-hover:text-gray-900"}`}>
                  {action.label}
                  {isLocked && <span className="ml-1.5 text-[10px] font-medium text-gray-400 bg-gray-100 rounded px-1">locked</span>}
                </span>
              </label>
            );
          })}
        </div>
      )}
    </div>
  );
}
