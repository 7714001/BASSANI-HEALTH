import { useState, useEffect } from "react";
import { useParams, useNavigate } from "react-router-dom";
import { ChevronDown, ShoppingCart, FileText, TrendingUp, AlertCircle, CreditCard, User, Pencil, Plus } from "lucide-react";
import api from "../api";
import toast from "react-hot-toast";
import { useAuth } from "../AuthContext";
import { Badge, BtnPrimary, BtnSecondary, Input, Select, Modal, FormGroup, LoadingState, fmtR, fmtDate } from "../components/UI";

function KpiCard({ label, value, sub, icon: Icon, accent }) {
  return (
    <div className="bg-white rounded-2xl border border-gray-100 p-5 flex items-start gap-4">
      <div className={`w-10 h-10 rounded-xl flex items-center justify-center shrink-0 ${accent}`}>
        <Icon size={18} className="text-white" />
      </div>
      <div className="min-w-0">
        <p className="text-xs text-gray-400 font-medium mb-0.5">{label}</p>
        <p className="text-xl font-bold text-gray-900 truncate">{value}</p>
        {sub && <p className="text-xs text-gray-400 mt-0.5">{sub}</p>}
      </div>
    </div>
  );
}

function Section({ title, children }) {
  return (
    <div className="bg-white rounded-2xl border border-gray-100 overflow-hidden">
      <div className="px-5 py-4 border-b border-gray-50">
        <h3 className="font-semibold text-gray-800 text-sm">{title}</h3>
      </div>
      {children}
    </div>
  );
}

const STATE_LABEL = { draft:"Quotation", sale:"Confirmed", done:"Done", cancel:"Cancelled", sent:"Sent" };
const PAYMENT_LABEL = { not_paid:"Unpaid", partial:"Partial", in_payment:"In Payment", paid:"Paid" };
const PAYMENT_COLOR = { not_paid:"text-red-600", partial:"text-amber-600", in_payment:"text-blue-600", paid:"text-green-600" };

export default function CustomerProfile() {
  const { id } = useParams();
  const navigate = useNavigate();
  const { user } = useAuth();
  const canManageAddresses = user?.permissions?.customers?.manage;

  const [data,         setData        ] = useState(null);
  const [loading,      setLoading     ] = useState(true);
  const [stmt,         setStmt        ] = useState(null);
  const [stmtLoading,  setStmtLoading ] = useState(false);
  const [stmtFrom,     setStmtFrom    ] = useState("");
  const [stmtTo,       setStmtTo      ] = useState("");

  // ── Addresses ─────────────────────────────────────────────────────────────
  const [addresses,  setAddresses ] = useState([]);
  const [addrLoading,setAddrLoading] = useState(false);
  const [addrModal,  setAddrModal ] = useState(false);
  const [addrTarget, setAddrTarget] = useState(null);
  const [addrForm,   setAddrForm  ] = useState({ name: "", type: "delivery", street: "", street2: "", city: "", zip: "", phone: "", email: "" });
  const [addrSaving, setAddrSaving] = useState(false);

  useEffect(() => {
    api.get(`/api/customers/${id}/profile`)
      .then(r => setData(r.data))
      .catch(() => { toast.error("Failed to load customer profile"); navigate("/customers"); })
      .finally(() => setLoading(false));
  }, [id, navigate]);

  useEffect(() => {
    setAddrLoading(true);
    api.get(`/api/customers/${id}/addresses`)
      .then(r => setAddresses(r.data.addresses || []))
      .catch(() => {})
      .finally(() => setAddrLoading(false));
  }, [id]);

  const loadAddresses = () => {
    setAddrLoading(true);
    api.get(`/api/customers/${id}/addresses`)
      .then(r => setAddresses(r.data.addresses || []))
      .catch(() => {})
      .finally(() => setAddrLoading(false));
  };

  const openAddrCreate = () => {
    setAddrForm({ name: "", type: "delivery", street: "", street2: "", city: "", zip: "", phone: "", email: "" });
    setAddrTarget(null);
    setAddrModal(true);
  };

  const openAddrEdit = (addr) => {
    setAddrForm({
      name: addr.name || "", type: addr.type || "delivery",
      street: addr.street || "", street2: addr.street2 || "",
      city: addr.city || "", zip: addr.zip || "",
      phone: addr.phone || "", email: addr.email || "",
    });
    setAddrTarget(addr);
    setAddrModal(true);
  };

  const saveAddr = async () => {
    if (!addrForm.name.trim()) return toast.error("Name is required");
    setAddrSaving(true);
    try {
      if (addrTarget) {
        await api.put(`/api/customers/${id}/addresses/${addrTarget.id}`, addrForm);
        toast.success("Address updated");
      } else {
        await api.post(`/api/customers/${id}/addresses`, addrForm);
        toast.success("Address added");
      }
      setAddrModal(false);
      loadAddresses();
    } catch (e) {
      toast.error(e.response?.data?.detail || "Failed to save address");
    } finally {
      setAddrSaving(false);
    }
  };

  const loadStatement = async () => {
    setStmtLoading(true);
    try {
      const params = {};
      if (stmtFrom) params.date_from = stmtFrom;
      if (stmtTo)   params.date_to   = stmtTo;
      const r = await api.get(`/api/customers/${id}/statement`, { params });
      setStmt(r.data);
    } catch {
      toast.error("Failed to load account statement");
    } finally {
      setStmtLoading(false);
    }
  };

  useEffect(() => { loadStatement(); }, [id]); // eslint-disable-line

  if (loading) return <LoadingState />;
  if (!data)   return null;

  const { customer: c, stats, recent_orders, outstanding_invoices, ownership } = data;
  const typeMatch = c.comment?.match(/Type: (\w+)/);
  const customerType = typeMatch?.[1] || null;
  const isSection21 = c.comment?.includes("Section 21: Registered");
  const creditPct = stats.credit_utilisation;
  const creditBarColor = !creditPct ? "bg-bassani-600"
    : creditPct >= 90 ? "bg-red-500"
    : creditPct >= 70 ? "bg-amber-500"
    : "bg-bassani-600";

  return (
    <div className="flex flex-col flex-1 overflow-hidden">
      {/* Top bar */}
      <div className="border-b border-gray-100 bg-white px-6 py-3 flex items-center justify-between gap-4 shrink-0">
        <button onClick={() => navigate("/customers")}
          className="flex items-center gap-1.5 text-sm text-gray-500 hover:text-gray-800 transition-colors">
          <ChevronDown size={14} className="-rotate-90" />Back to Customers
        </button>
        <div className="flex gap-2">
          <BtnSecondary size="sm" onClick={() => navigate(`/invoices`)}>View Invoices</BtnSecondary>
          <BtnPrimary size="sm" onClick={() => navigate("/orders")}>Place Order</BtnPrimary>
        </div>
      </div>

      <main className="flex-1 overflow-y-auto p-6 bg-gray-50">
        <div className="max-w-5xl mx-auto space-y-5">

          {/* Customer header */}
          <div className="bg-white rounded-2xl border border-gray-100 p-6">
            <div className="flex items-start justify-between gap-4 flex-wrap">
              <div className="flex items-center gap-4">
                <div className="w-14 h-14 rounded-2xl bg-bassani-600 flex items-center justify-center shrink-0">
                  <span className="text-white text-xl font-bold">
                    {c.name?.split(" ").map(w => w[0]).join("").slice(0, 2).toUpperCase()}
                  </span>
                </div>
                <div>
                  <h1 className="text-xl font-bold text-gray-900">{c.name}</h1>
                  <div className="flex flex-wrap items-center gap-2 mt-1">
                    {customerType && (
                      <span className="text-xs bg-bassani-50 text-bassani-700 px-2 py-0.5 rounded-full font-medium">{customerType}</span>
                    )}
                    {isSection21 && (
                      <span className="text-xs bg-green-50 text-green-700 px-2 py-0.5 rounded-full font-medium">Section 21</span>
                    )}
                    {c.credit_hold && (
                      <span title="Over their Odoo credit limit — order confirmation requires an admin override" className="text-xs bg-red-50 text-red-700 px-2 py-0.5 rounded-full font-medium flex items-center gap-1">
                        <AlertCircle size={11} />Credit Hold
                      </span>
                    )}
                    {ownership?.reseller_name && (
                      <span className="text-xs bg-purple-50 text-purple-700 px-2 py-0.5 rounded-full font-medium">
                        Via {ownership.reseller_name}
                      </span>
                    )}
                  </div>
                </div>
              </div>
              <div className="flex flex-wrap gap-6 text-sm">
                {c.email && <div><p className="text-xs text-gray-400 mb-0.5">Email</p><p className="font-medium text-gray-700">{c.email}</p></div>}
                {c.phone && <div><p className="text-xs text-gray-400 mb-0.5">Phone</p><p className="font-medium text-gray-700">{c.phone}</p></div>}
                {c.city  && <div><p className="text-xs text-gray-400 mb-0.5">City</p><p className="font-medium text-gray-700">{c.city}</p></div>}
                {c.property_payment_term_id && <div><p className="text-xs text-gray-400 mb-0.5">Terms</p><p className="font-medium text-gray-700">{c.property_payment_term_id[1]}</p></div>}
              </div>
            </div>

            {/* Credit bar */}
            {stats.credit_limit > 0 && (
              <div className="mt-5 pt-5 border-t border-gray-50">
                <div className="flex justify-between text-xs text-gray-500 mb-1.5">
                  <span>Credit used: <strong className="text-gray-700">{fmtR(stats.outstanding_balance)}</strong></span>
                  <span>Limit: <strong className="text-gray-700">{fmtR(stats.credit_limit)}</strong></span>
                </div>
                <div className="h-2 bg-gray-100 rounded-full overflow-hidden">
                  <div className={`h-full rounded-full transition-all ${creditBarColor}`}
                    style={{ width: `${Math.min(creditPct || 0, 100)}%` }} />
                </div>
                {creditPct >= 90 && (
                  <p className="text-xs text-red-600 mt-1 flex items-center gap-1">
                    <AlertCircle size={11} />Credit limit {creditPct >= 100 ? "exceeded" : "nearly reached"} ({creditPct}%)
                  </p>
                )}
              </div>
            )}
          </div>

          {/* KPI cards */}
          <div className="grid grid-cols-2 lg:grid-cols-3 gap-4">
            <KpiCard label="Lifetime Orders"   value={stats.total_orders}             sub="Confirmed orders"           icon={ShoppingCart} accent="bg-bassani-600" />
            <KpiCard label="Lifetime Spend"    value={fmtR(stats.total_spend)}        sub="Excl. cancelled"            icon={TrendingUp}   accent="bg-emerald-500" />
            <KpiCard label="This Month"        value={fmtR(stats.revenue_this_month)} sub={`${stats.orders_this_month} orders`} icon={CreditCard} accent="bg-blue-500" />
            <KpiCard label="Outstanding"       value={fmtR(stats.outstanding_balance)} sub={`${stats.outstanding_invoices} invoice${stats.outstanding_invoices !== 1 ? "s" : ""}`} icon={FileText} accent={stats.outstanding_balance > 0 ? "bg-red-500" : "bg-gray-400"} />
            {stats.credit_limit > 0 && (
              <KpiCard label="Credit Limit"    value={fmtR(stats.credit_limit)}       sub={creditPct != null ? `${creditPct}% used` : "No usage"} icon={CreditCard} accent="bg-violet-500" />
            )}
            {ownership && (
              <KpiCard label="Account Manager" value={ownership.reseller_name}        sub="Onboarded via reseller"     icon={User}         accent="bg-purple-500" />
            )}
          </div>

          {/* Addresses */}
          <Section title={`Addresses (${addresses.length})`}>
            {addrLoading ? (
              <p className="text-sm text-gray-400 px-5 py-4">Loading…</p>
            ) : addresses.length === 0 ? (
              <p className="text-sm text-gray-400 px-5 py-4">No addresses on file.</p>
            ) : (
              <div className="overflow-x-auto">
              <table className="w-full text-sm">
                <thead>
                  <tr className="bg-gray-50 text-xs text-gray-500">
                    <th className="text-left px-5 py-2.5 font-medium">Name</th>
                    <th className="text-left px-5 py-2.5 font-medium">Type</th>
                    <th className="text-left px-5 py-2.5 font-medium">Street</th>
                    <th className="text-left px-5 py-2.5 font-medium">City / ZIP</th>
                    <th className="text-left px-5 py-2.5 font-medium">Phone</th>
                    {canManageAddresses && <th className="w-10" />}
                  </tr>
                </thead>
                <tbody>
                  {addresses.map(a => (
                    <tr key={a.id} className="border-t border-gray-50 hover:bg-gray-50 transition-colors">
                      <td className="px-5 py-3 font-medium text-gray-900">{a.name}</td>
                      <td className="px-5 py-3">
                        <span className={`text-[10px] px-1.5 py-0.5 rounded-full font-semibold ${
                          a.type === "delivery" ? "bg-blue-50 text-blue-700"
                          : a.type === "invoice" ? "bg-purple-50 text-purple-700"
                          : "bg-gray-100 text-gray-500"
                        }`}>
                          {a.type === "delivery" ? "Delivery" : a.type === "invoice" ? "Billing" : a.type || "Other"}
                        </span>
                      </td>
                      <td className="px-5 py-3 text-gray-500">{[a.street, a.street2].filter(Boolean).join(", ") || "—"}</td>
                      <td className="px-5 py-3 text-gray-500">{[a.city, a.zip].filter(Boolean).join(" ") || "—"}</td>
                      <td className="px-5 py-3 text-gray-500">{a.phone || "—"}</td>
                      {canManageAddresses && (
                        <td className="px-5 py-3">
                          <button onClick={() => openAddrEdit(a)} className="text-gray-400 hover:text-bassani-600 transition-colors p-1">
                            <Pencil size={13} />
                          </button>
                        </td>
                      )}
                    </tr>
                  ))}
                </tbody>
              </table>
              </div>
            )}
            {canManageAddresses && (
              <div className="px-5 py-3 border-t border-gray-50">
                <button
                  onClick={openAddrCreate}
                  className="flex items-center gap-1.5 text-sm text-bassani-600 hover:text-bassani-700 font-medium transition-colors"
                >
                  <Plus size={14} />Add address
                </button>
              </div>
            )}
          </Section>

          {/* Recent orders */}
          <Section title={`Recent Orders (${recent_orders.length})`}>
            {recent_orders.length === 0 ? (
              <p className="text-sm text-gray-400 px-5 py-4">No orders yet.</p>
            ) : (
              <div className="overflow-x-auto">
              <table className="w-full text-sm">
                <thead>
                  <tr className="bg-gray-50 text-xs text-gray-500">
                    <th className="text-left px-5 py-2.5 font-medium">Order #</th>
                    <th className="text-left px-5 py-2.5 font-medium">Date</th>
                    <th className="text-right px-5 py-2.5 font-medium">Total</th>
                    <th className="text-left px-5 py-2.5 font-medium">Status</th>
                    <th className="text-left px-5 py-2.5 font-medium">Payment</th>
                  </tr>
                </thead>
                <tbody>
                  {recent_orders.map(o => (
                    <tr key={o.id} className="border-t border-gray-50 hover:bg-gray-50 transition-colors">
                      <td className="px-5 py-3 font-mono text-xs text-bassani-700">{o.name}</td>
                      <td className="px-5 py-3 text-gray-500">{fmtDate(o.date_order?.split("T")[0])}</td>
                      <td className="px-5 py-3 text-right font-semibold">{fmtR(o.amount_total)}</td>
                      <td className="px-5 py-3"><Badge status={o.state} label={STATE_LABEL[o.state] || o.state} /></td>
                      <td className="px-5 py-3"><Badge status={o.invoice_status} /></td>
                    </tr>
                  ))}
                </tbody>
              </table>
              </div>
            )}
          </Section>

          {/* Outstanding invoices */}
          <Section title={`Outstanding Invoices (${outstanding_invoices.length})`}>
            {outstanding_invoices.length === 0 ? (
              <p className="text-sm text-gray-400 px-5 py-4">No outstanding invoices.</p>
            ) : (
              <div className="overflow-x-auto">
              <table className="w-full text-sm">
                <thead>
                  <tr className="bg-gray-50 text-xs text-gray-500">
                    <th className="text-left px-5 py-2.5 font-medium">Invoice #</th>
                    <th className="text-left px-5 py-2.5 font-medium">Date</th>
                    <th className="text-left px-5 py-2.5 font-medium">Due</th>
                    <th className="text-right px-5 py-2.5 font-medium">Total</th>
                    <th className="text-right px-5 py-2.5 font-medium">Outstanding</th>
                    <th className="text-left px-5 py-2.5 font-medium">Status</th>
                  </tr>
                </thead>
                <tbody>
                  {outstanding_invoices.map(inv => {
                    const overdue = inv.invoice_date_due && new Date(inv.invoice_date_due) < new Date();
                    return (
                      <tr key={inv.id} className="border-t border-gray-50 hover:bg-gray-50 transition-colors">
                        <td className="px-5 py-3 font-mono text-xs text-bassani-700">{inv.name}</td>
                        <td className="px-5 py-3 text-gray-500">{fmtDate(inv.invoice_date)}</td>
                        <td className={`px-5 py-3 font-medium ${overdue ? "text-red-600" : "text-gray-500"}`}>
                          {fmtDate(inv.invoice_date_due)}{overdue ? " ⚠" : ""}
                        </td>
                        <td className="px-5 py-3 text-right">{fmtR(inv.amount_total)}</td>
                        <td className={`px-5 py-3 text-right font-semibold ${PAYMENT_COLOR[inv.payment_state] || ""}`}>
                          {fmtR(inv.amount_residual)}
                        </td>
                        <td className="px-5 py-3">
                          <span className="text-xs font-medium">{PAYMENT_LABEL[inv.payment_state] || inv.payment_state}</span>
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
              </div>
            )}
          </Section>

          {/* Account Statement — 7.3 */}
          <Section title="Account Statement">
            <div className="px-5 py-4 border-b border-gray-50 flex flex-wrap items-end gap-3">
              <div>
                <p className="text-xs text-gray-400 mb-1">From</p>
                <Input type="date" value={stmtFrom} onChange={e => setStmtFrom(e.target.value)} className="w-36" />
              </div>
              <div>
                <p className="text-xs text-gray-400 mb-1">To</p>
                <Input type="date" value={stmtTo} onChange={e => setStmtTo(e.target.value)} className="w-36" />
              </div>
              <BtnSecondary size="sm" onClick={loadStatement} disabled={stmtLoading}>
                {stmtLoading ? "Loading…" : "Load Statement"}
              </BtnSecondary>
            </div>

            {stmtLoading ? (
              <p className="px-5 py-6 text-xs text-gray-400">Loading statement…</p>
            ) : stmt ? (
              <>
                {/* Summary row */}
                <div className="grid grid-cols-2 md:grid-cols-4 divide-x divide-gray-50 border-b border-gray-50">
                  {[
                    { label: "Total Invoiced",   value: fmtR(stmt.summary.total_invoiced),   color: "text-gray-800" },
                    { label: "Total Credits",     value: fmtR(stmt.summary.total_credits),    color: "text-purple-700" },
                    { label: "Total Outstanding", value: fmtR(stmt.summary.total_outstanding), color: "text-red-600"   },
                    { label: "Net Balance",       value: fmtR(stmt.summary.net_balance),      color: stmt.summary.net_balance > 0 ? "text-red-600" : "text-green-700" },
                  ].map(({ label, value, color }) => (
                    <div key={label} className="px-5 py-3">
                      <p className="text-xs text-gray-400 mb-0.5">{label}</p>
                      <p className={`text-sm font-bold ${color}`}>{value}</p>
                    </div>
                  ))}
                </div>

                {/* Transaction table */}
                {stmt.invoices.length === 0 ? (
                  <p className="px-5 py-4 text-sm text-gray-400">No transactions in this period.</p>
                ) : (
                  <div className="overflow-x-auto">
                  <table className="w-full text-sm">
                    <thead>
                      <tr className="bg-gray-50 text-xs text-gray-500">
                        <th className="text-left px-5 py-2.5 font-medium">Ref</th>
                        <th className="text-left px-5 py-2.5 font-medium">Type</th>
                        <th className="text-left px-5 py-2.5 font-medium">Date</th>
                        <th className="text-left px-5 py-2.5 font-medium">Due</th>
                        <th className="text-right px-5 py-2.5 font-medium">Total</th>
                        <th className="text-right px-5 py-2.5 font-medium">Outstanding</th>
                        <th className="text-left px-5 py-2.5 font-medium">Status</th>
                      </tr>
                    </thead>
                    <tbody>
                      {stmt.invoices.map(inv => {
                        const isCN = inv.move_type === "out_refund";
                        const overdue = !isCN && inv.invoice_date_due && new Date(inv.invoice_date_due) < new Date() && inv.payment_state !== "paid";
                        return (
                          <tr key={inv.id} className="border-t border-gray-50 hover:bg-gray-50 transition-colors">
                            <td className="px-5 py-3 font-mono text-xs text-bassani-700">{inv.name}</td>
                            <td className="px-5 py-3">
                              {isCN
                                ? <span className="text-[10px] bg-purple-50 text-purple-700 border border-purple-100 px-1.5 py-0.5 rounded-full font-semibold">Credit Note</span>
                                : <span className="text-[10px] bg-gray-100 text-gray-500 px-1.5 py-0.5 rounded-full font-semibold">Invoice</span>
                              }
                            </td>
                            <td className="px-5 py-3 text-gray-500">{fmtDate(inv.invoice_date)}</td>
                            <td className={`px-5 py-3 font-medium ${overdue ? "text-red-600" : "text-gray-500"}`}>
                              {inv.invoice_date_due ? fmtDate(inv.invoice_date_due) : "—"}{overdue ? " ⚠" : ""}
                            </td>
                            <td className={`px-5 py-3 text-right font-semibold ${isCN ? "text-purple-700" : ""}`}>
                              {isCN ? `(${fmtR(inv.amount_total)})` : fmtR(inv.amount_total)}
                            </td>
                            <td className={`px-5 py-3 text-right font-semibold ${inv.amount_residual > 0 ? "text-red-600" : "text-gray-400"}`}>
                              {inv.amount_residual > 0 ? fmtR(inv.amount_residual) : "—"}
                            </td>
                            <td className="px-5 py-3">
                              <span className="text-xs font-medium">{PAYMENT_LABEL[inv.payment_state] || inv.payment_state}</span>
                            </td>
                          </tr>
                        );
                      })}
                    </tbody>
                  </table>
                  </div>
                )}
              </>
            ) : null}
          </Section>

        </div>
      </main>

      {addrModal && (
        <Modal title={addrTarget ? "Edit Address" : "Add Address"} onClose={() => setAddrModal(false)}>
          <div className="space-y-4">
            <FormGroup label="Name" required>
              <Input
                value={addrForm.name}
                onChange={e => setAddrForm(f => ({ ...f, name: e.target.value }))}
                placeholder="Branch name or contact name"
                autoFocus
              />
            </FormGroup>
            <FormGroup label="Type">
              <Select value={addrForm.type} onChange={e => setAddrForm(f => ({ ...f, type: e.target.value }))}>
                <option value="delivery">Delivery</option>
                <option value="invoice">Invoice / Billing</option>
                <option value="other">Other</option>
              </Select>
            </FormGroup>
            <FormGroup label="Street">
              <Input value={addrForm.street} onChange={e => setAddrForm(f => ({ ...f, street: e.target.value }))} placeholder="Street address" />
            </FormGroup>
            <FormGroup label="Street 2">
              <Input value={addrForm.street2} onChange={e => setAddrForm(f => ({ ...f, street2: e.target.value }))} placeholder="Unit / Suite / Floor" />
            </FormGroup>
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
              <FormGroup label="City">
                <Input value={addrForm.city} onChange={e => setAddrForm(f => ({ ...f, city: e.target.value }))} />
              </FormGroup>
              <FormGroup label="Postal Code">
                <Input value={addrForm.zip} onChange={e => setAddrForm(f => ({ ...f, zip: e.target.value }))} />
              </FormGroup>
            </div>
            <FormGroup label="Phone">
              <Input value={addrForm.phone} onChange={e => setAddrForm(f => ({ ...f, phone: e.target.value }))} placeholder="+27 …" />
            </FormGroup>
            <FormGroup label="Email">
              <Input type="email" value={addrForm.email} onChange={e => setAddrForm(f => ({ ...f, email: e.target.value }))} />
            </FormGroup>
            <div className="flex justify-end gap-2 pt-2">
              <BtnSecondary onClick={() => setAddrModal(false)}>Cancel</BtnSecondary>
              <BtnPrimary onClick={saveAddr} loading={addrSaving}>
                {addrTarget ? "Save Changes" : "Add Address"}
              </BtnPrimary>
            </div>
          </div>
        </Modal>
      )}
    </div>
  );
}
