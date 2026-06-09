import { useState, useEffect } from "react";
import api from "../api";
import toast from "react-hot-toast";
import { UserPlus, RefreshCw, KeyRound, PowerOff, Power, Copy, Check } from "lucide-react";
import {
  TopBar, Table, Tr, Td, Modal, FormGroup, Input, Select,
  BtnPrimary, BtnSecondary, BtnDanger, Badge, LoadingState,
} from "../components/UI";

export default function Users() {
  const [users,   setUsers  ] = useState([]);
  const [loading, setLoading] = useState(true);

  // Create user modal
  const [createModal, setCreateModal] = useState(false);
  const [createForm,  setCreateForm ] = useState({ username: "", password: "", name: "", role: "admin" });

  // Reset password modal
  const [resetModal,   setResetModal  ] = useState(false);
  const [resetTarget,  setResetTarget ] = useState(null);
  const [resetPassword,setResetPassword] = useState("");
  const [revealed,     setRevealed    ] = useState(null); // plain-text password shown once
  const [copied,       setCopied      ] = useState(false);

  const load = async () => {
    setLoading(true);
    try { const r = await api.get("/api/users/"); setUsers(r.data.users); }
    catch { toast.error("Failed to load users"); }
    finally { setLoading(false); }
  };
  useEffect(() => { load(); }, []);

  // ── Create user ──────────────────────────────────────────────────────────────
  const createUser = async () => {
    if (!createForm.username || !createForm.password) return toast.error("Username and password required");
    if (createForm.password.length < 8) return toast.error("Password must be at least 8 characters");
    try {
      await api.post("/api/users/", createForm);
      toast.success("User created");
      setCreateModal(false);
      setCreateForm({ username: "", password: "", name: "", role: "admin" });
      load();
    } catch (e) { toast.error(e.response?.data?.detail || "Create failed"); }
  };

  // ── Reset password ───────────────────────────────────────────────────────────
  const openReset = (u) => { setResetTarget(u); setResetPassword(""); setRevealed(null); setCopied(false); setResetModal(true); };

  const submitReset = async () => {
    if (resetPassword && resetPassword.length < 8) return toast.error("Password must be at least 8 characters");
    try {
      const r = await api.post(`/api/users/${resetTarget.id}/reset-password`,
        resetPassword ? { new_password: resetPassword } : {}
      );
      setRevealed(r.data.new_password);
    } catch (e) { toast.error(e.response?.data?.detail || "Reset failed"); }
  };

  const copyPassword = () => {
    navigator.clipboard.writeText(revealed);
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  };

  const closeReset = () => { setResetModal(false); setRevealed(null); setResetTarget(null); load(); };

  // ── Toggle active ────────────────────────────────────────────────────────────
  const toggleActive = async (u) => {
    const action = u.active ? "deactivate" : "reactivate";
    const label  = u.active ? "Deactivate"  : "Reactivate";
    if (u.active && !window.confirm(`${label} ${u.username}? They will no longer be able to log in.`)) return;
    try {
      if (u.active) await api.delete(`/api/users/${u.id}`);
      else          await api.post(`/api/users/${u.id}/reactivate`);
      toast.success(`${label}d`);
      load();
    } catch (e) { toast.error(e.response?.data?.detail || `${label} failed`); }
  };

  return (
    <div className="flex flex-col flex-1 overflow-hidden">
      <TopBar title="User Accounts" subtitle="Manage portal login accounts" onRefresh={load}
        actions={<BtnPrimary onClick={() => setCreateModal(true)}><UserPlus size={14} />Add User</BtnPrimary>} />

      <main className="flex-1 overflow-y-auto p-6">
        {loading ? <LoadingState /> : (
          <Table headers={["Username", "Name", "Role", "Linked Reseller", "Status", "Actions"]}>
            {users.length === 0 && (
              <tr><td colSpan={6} className="text-center py-12 text-gray-400 text-sm">No users found</td></tr>
            )}
            {users.map(u => (
              <Tr key={u.id}>
                <Td><span className="font-mono text-sm font-medium text-gray-900">{u.username}</span></Td>
                <Td>{u.name || <span className="text-gray-300">—</span>}</Td>
                <Td>
                  <Badge color={u.role === "admin" ? "blue" : "green"}>{u.role}</Badge>
                </Td>
                <Td>
                  {u.reseller_name
                    ? <span className="text-sm text-gray-700">{u.reseller_name}</span>
                    : <span className="text-gray-300 text-sm">—</span>}
                </Td>
                <Td>
                  <Badge color={u.active !== false ? "green" : "red"}>
                    {u.active !== false ? "Active" : "Inactive"}
                  </Badge>
                </Td>
                <Td>
                  <div className="flex gap-1.5">
                    <BtnSecondary size="sm" onClick={() => openReset(u)} title="Reset password">
                      <KeyRound size={12} />
                    </BtnSecondary>
                    {u.active !== false
                      ? <BtnDanger onClick={() => toggleActive(u)} title="Deactivate"><PowerOff size={12} /></BtnDanger>
                      : <BtnSecondary size="sm" onClick={() => toggleActive(u)} title="Reactivate"><Power size={12} /></BtnSecondary>
                    }
                  </div>
                </Td>
              </Tr>
            ))}
          </Table>
        )}
      </main>

      {/* Create user modal */}
      {createModal && (
        <Modal title="Add User Account" onClose={() => setCreateModal(false)}>
          <div className="grid grid-cols-2 gap-3">
            <FormGroup label="Username" required>
              <Input value={createForm.username}
                onChange={e => setCreateForm({ ...createForm, username: e.target.value.toLowerCase().replace(/\s/g, "") })}
                placeholder="e.g. jane.admin" />
            </FormGroup>
            <FormGroup label="Full Name">
              <Input value={createForm.name}
                onChange={e => setCreateForm({ ...createForm, name: e.target.value })}
                placeholder="Jane Smith" />
            </FormGroup>
            <FormGroup label="Password" required>
              <Input type="password" value={createForm.password}
                onChange={e => setCreateForm({ ...createForm, password: e.target.value })}
                placeholder="Min. 8 characters" />
            </FormGroup>
            <FormGroup label="Role">
              <Select value={createForm.role} onChange={e => setCreateForm({ ...createForm, role: e.target.value })}>
                <option value="admin">Admin</option>
                <option value="reseller">Reseller</option>
              </Select>
            </FormGroup>
          </div>
          <div className="flex justify-end gap-2 mt-4">
            <BtnSecondary onClick={() => setCreateModal(false)}>Cancel</BtnSecondary>
            <BtnPrimary onClick={createUser}>Create Account</BtnPrimary>
          </div>
        </Modal>
      )}

      {/* Reset password modal */}
      {resetModal && resetTarget && (
        <Modal title={`Reset Password — ${resetTarget.username}`} onClose={closeReset}>
          {!revealed ? (
            <>
              <p className="text-sm text-gray-500 mb-4">
                Enter a new password, or leave blank to generate a secure random one.
              </p>
              <FormGroup label="New Password (optional)">
                <Input type="password" value={resetPassword}
                  onChange={e => setResetPassword(e.target.value)}
                  placeholder="Leave blank to auto-generate" />
              </FormGroup>
              <div className="flex justify-end gap-2 mt-4">
                <BtnSecondary onClick={closeReset}>Cancel</BtnSecondary>
                <BtnPrimary onClick={submitReset}><KeyRound size={13} />Reset Password</BtnPrimary>
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
                <button onClick={copyPassword}
                  className="text-bassani-600 hover:text-bassani-700 transition-colors">
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
    </div>
  );
}
