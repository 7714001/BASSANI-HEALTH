import { useState } from "react";
import { Routes, Route, Navigate } from "react-router-dom";
import { Toaster } from "react-hot-toast";
import { useAuth } from "./AuthContext";
import { Sidebar, Spinner, SidebarContext } from "./components/UI";

// Views
import Login      from "./views/Login";
import Dashboard  from "./views/Dashboard";
import Products   from "./views/Products";
import Customers  from "./views/Customers";
import Orders     from "./views/Orders";
import Resellers  from "./views/Resellers";
import Commission from "./views/Commission";
import Reports    from "./views/Reports";
import Healthcare from "./views/Healthcare";
import Users      from "./views/Users";
import AuditTrail from "./views/AuditTrail";
import Warehouses from "./views/Warehouses";
import Invoices         from "./views/Invoices";
import CustomerProfile  from "./views/CustomerProfile";
import Scripts          from "./views/Scripts";
import HcpRegister      from "./views/HcpRegister";
import Targets               from "./views/Targets";
import CustomerOnboarding    from "./views/CustomerOnboarding";
import CustomerApplications       from "./views/CustomerApplications";
import CustomerApplicationDetail  from "./views/CustomerApplicationDetail";
import OnboardingDocs             from "./views/OnboardingDocs";
import ResellerCatalog               from "./views/ResellerCatalog";
import ResellerApplications          from "./views/ResellerApplications";
import ResellerApplicationDetail     from "./views/ResellerApplicationDetail";
import EmailSettings                 from "./views/EmailSettings";
import MailboxSettings               from "./views/MailboxSettings";
import OnboardingMailboxSettings     from "./views/OnboardingMailboxSettings";
import ConnectedMailboxes            from "./views/ConnectedMailboxes";
import DocumentTemplates            from "./views/DocumentTemplates";
import ResellerProfile       from "./views/ResellerProfile";
import Suppliers             from "./views/Suppliers";
import SupplierProfile       from "./views/SupplierProfile";
import SalesTickets          from "./views/SalesTickets";
import OrdersTickets         from "./views/OrdersTickets";
import SalesInbox            from "./views/SalesInbox";
import OnboardingInbox       from "./views/OnboardingInbox";
import OrdersInbox           from "./views/OrdersInbox";
import ProductCategories     from "./views/ProductCategories";
import ProductUOM            from "./views/ProductUOM";
import ChangePassword        from "./views/ChangePassword";
import ForgotPassword        from "./views/ForgotPassword";
import ResetPassword         from "./views/ResetPassword";
import StockReport           from "./views/StockReport";
import PublicRegister        from "./views/PublicRegister";
import SigningPage           from "./views/SigningPage";
import PartnerDirectory      from "./views/PartnerDirectory";
import PublicDocUpload       from "./views/PublicDocUpload";
import MyProfile            from "./views/MyProfile";
import Settings             from "./views/Settings";
import BankReconciliation   from "./views/BankReconciliation";
import Backorders           from "./views/Backorders";
import OrderPassport        from "./views/OrderPassport";

const PACKING_FLOOR_ROLES = new Set(["warehouse_supervisor", "packer"]);

function PackingFloorScreen() {
  const { user, logout } = useAuth();
  const token = localStorage.getItem("token");
  const isSupervisor = user?.role === "warehouse_supervisor";
  const boardUrl   = isSupervisor ? `/supervisor.html?token=${token}` : `/packer.html?token=${token}`;
  const boardLabel = isSupervisor ? "Open Supervisor Board" : "Open Packing Board";

  return (
    <div className="min-h-screen bg-slate-900 flex items-center justify-center p-6">
      <div className="bg-white rounded-2xl shadow-xl max-w-sm w-full p-8 text-center">
        <div className="w-14 h-14 bg-bassani-50 rounded-full flex items-center justify-center mx-auto mb-4">
          <svg className="w-7 h-7 text-bassani-600" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.5}>
            <path strokeLinecap="round" strokeLinejoin="round" d="M20.25 7.5l-.625 10.632a2.25 2.25 0 01-2.247 2.118H6.622a2.25 2.25 0 01-2.247-2.118L3.75 7.5M10 11.25h4M3.375 7.5h17.25c.621 0 1.125-.504 1.125-1.125v-.375c0-.621-.504-1.125-1.125-1.125H3.375c-.621 0-1.125.504-1.125 1.125v.375c0 .621.504 1.125 1.125 1.125z" />
          </svg>
        </div>
        <h1 className="text-lg font-bold text-gray-900 mb-1">Packing Floor Access</h1>
        <p className="text-sm text-gray-500 mb-1">
          Logged in as <span className="font-semibold text-gray-700">{user?.name || user?.display_name || user?.username}</span>
        </p>
        <p className="text-xs text-gray-400 mb-6">
          {isSupervisor
            ? "Tap below to open the supervisor board on this device."
            : "Tap below to open your packing view on this device."}
        </p>
        <a
          href={boardUrl}
          className="block w-full py-2.5 rounded-xl bg-bassani-600 hover:bg-bassani-700 text-sm font-semibold text-white transition-colors mb-3"
        >
          {boardLabel}
        </a>
        <button
          onClick={logout}
          className="w-full py-2.5 rounded-xl bg-slate-100 hover:bg-slate-200 text-sm font-semibold text-slate-700 transition-colors"
        >
          Log out
        </button>
      </div>
    </div>
  );
}

/** Requires authentication only — does not redirect away if must_change_password is set.
 *  Used exclusively for the /change-password route so it can be accessed while the flag is true. */
function AuthRequired({ children }) {
  const { user, loading } = useAuth();
  if (loading) return (
    <div className="flex items-center justify-center h-screen">
      <Spinner size="lg" />
    </div>
  );
  if (!user) return <Navigate to="/login" replace />;
  return children;
}

function ProtectedRoute({ children, adminOnly }) {
  const { user, loading, isAdmin } = useAuth();
  if (loading) return (
    <div className="flex items-center justify-center h-screen">
      <Spinner size="lg" />
    </div>
  );
  if (!user) return <Navigate to="/login" replace />;
  if (user.must_change_password) return <Navigate to="/change-password" replace />;
  if (PACKING_FLOOR_ROLES.has(user.role)) return <PackingFloorScreen />;
  if (adminOnly && !isAdmin) return <Navigate to="/" replace />;
  return children;
}

function AppLayout({ children }) {
  const [sidebarOpen, setSidebarOpen] = useState(false);
  return (
    <SidebarContext.Provider value={{ open: sidebarOpen, toggle: () => setSidebarOpen(v => !v), close: () => setSidebarOpen(false) }}>
      <div className="flex h-screen overflow-hidden bg-gray-50">
        {sidebarOpen && (
          <div className="fixed inset-0 bg-black/40 z-40 lg:hidden" onClick={() => setSidebarOpen(false)} />
        )}
        <Sidebar />
        <div className="flex-1 flex flex-col overflow-hidden min-w-0">{children}</div>
      </div>
    </SidebarContext.Provider>
  );
}

export default function App() {
  const { user } = useAuth();

  return (
    <>
      <Toaster position="bottom-right" toastOptions={{
        style: { fontSize: "13px", fontWeight: 500 },
        success: { iconTheme: { primary: "#0f6e56", secondary: "#fff" } },
      }} />

      <Routes>
        <Route path="/login" element={
          user
            ? <Navigate to={user.must_change_password ? "/change-password" : "/"} replace />
            : <Login />
        } />
        <Route path="/register"     element={<HcpRegister />} />
        <Route path="/apply"        element={<PublicRegister />} />
        <Route path="/sign/:token"  element={<SigningPage />} />
        <Route path="/upload-docs/:token" element={<PublicDocUpload />} />
        <Route path="/forgot-password" element={user ? <Navigate to="/" replace /> : <ForgotPassword />} />
        <Route path="/reset-password" element={user ? <Navigate to="/" replace /> : <ResetPassword />} />
        <Route path="/change-password" element={<AuthRequired><ChangePassword /></AuthRequired>} />
        <Route path="/profile" element={<AuthRequired><AppLayout><MyProfile /></AppLayout></AuthRequired>} />

        <Route path="/" element={
          <ProtectedRoute><AppLayout><Dashboard /></AppLayout></ProtectedRoute>
        } />
        <Route path="/products" element={
          <ProtectedRoute>
            <AppLayout>
              {user?.role === "reseller" ? <ResellerCatalog /> : <Products />}
            </AppLayout>
          </ProtectedRoute>
        } />
        <Route path="/customers" element={
          <ProtectedRoute><AppLayout><Customers /></AppLayout></ProtectedRoute>
        } />
        <Route path="/customers/:id" element={
          <ProtectedRoute><AppLayout><CustomerProfile /></AppLayout></ProtectedRoute>
        } />
        <Route path="/partners" element={
          <ProtectedRoute adminOnly><AppLayout><PartnerDirectory /></AppLayout></ProtectedRoute>
        } />
        <Route path="/suppliers" element={
          <ProtectedRoute><AppLayout><Suppliers /></AppLayout></ProtectedRoute>
        } />
        <Route path="/suppliers/:id" element={
          <ProtectedRoute><AppLayout><SupplierProfile /></AppLayout></ProtectedRoute>
        } />
        <Route path="/orders" element={
          <ProtectedRoute><AppLayout><Orders /></AppLayout></ProtectedRoute>
        } />
        <Route path="/orders/backorders" element={
          <ProtectedRoute adminOnly><AppLayout><Backorders /></AppLayout></ProtectedRoute>
        } />
        <Route path="/orders/:orderId/passport" element={
          <ProtectedRoute><AppLayout><OrderPassport /></AppLayout></ProtectedRoute>
        } />
        <Route path="/onboard" element={
          <ProtectedRoute><AppLayout><CustomerOnboarding /></AppLayout></ProtectedRoute>
        } />
        <Route path="/onboarding-docs" element={
          <ProtectedRoute><AppLayout><OnboardingDocs /></AppLayout></ProtectedRoute>
        } />
        <Route path="/applications" element={
          <ProtectedRoute adminOnly><AppLayout><CustomerApplications /></AppLayout></ProtectedRoute>
        } />
        <Route path="/applications/:id" element={
          <ProtectedRoute adminOnly><AppLayout><CustomerApplicationDetail /></AppLayout></ProtectedRoute>
        } />
        <Route path="/resellers" element={
          <ProtectedRoute adminOnly><AppLayout><Resellers /></AppLayout></ProtectedRoute>
        } />
        <Route path="/resellers/:id" element={
          <ProtectedRoute adminOnly><AppLayout><ResellerProfile /></AppLayout></ProtectedRoute>
        } />
        <Route path="/commission" element={
          <ProtectedRoute><AppLayout><Commission /></AppLayout></ProtectedRoute>
        } />
        <Route path="/invoices" element={
          <ProtectedRoute adminOnly><AppLayout><Invoices /></AppLayout></ProtectedRoute>
        } />
        <Route path="/finance/bank-recon" element={
          <ProtectedRoute adminOnly><AppLayout><BankReconciliation /></AppLayout></ProtectedRoute>
        } />
        <Route path="/targets" element={
          <ProtectedRoute adminOnly><AppLayout><Targets /></AppLayout></ProtectedRoute>
        } />
        <Route path="/reports" element={
          <ProtectedRoute adminOnly><AppLayout><Reports /></AppLayout></ProtectedRoute>
        } />
        <Route path="/stock-report" element={
          <ProtectedRoute adminOnly><AppLayout><StockReport /></AppLayout></ProtectedRoute>
        } />
        <Route path="/healthcare" element={
          <ProtectedRoute adminOnly><AppLayout><Healthcare /></AppLayout></ProtectedRoute>
        } />
        <Route path="/scripts" element={
          <ProtectedRoute adminOnly><AppLayout><Scripts /></AppLayout></ProtectedRoute>
        } />
        <Route path="/users" element={
          <ProtectedRoute adminOnly><AppLayout><Users /></AppLayout></ProtectedRoute>
        } />
        <Route path="/audit" element={
          <ProtectedRoute adminOnly><AppLayout><AuditTrail /></AppLayout></ProtectedRoute>
        } />
        <Route path="/warehouses" element={<Navigate to="/settings?tab=warehouses" replace />} />
        <Route path="/settings" element={
          <ProtectedRoute adminOnly><AppLayout><Settings /></AppLayout></ProtectedRoute>
        } />
        <Route path="/inbox" element={
          <ProtectedRoute><AppLayout><SalesInbox /></AppLayout></ProtectedRoute>
        } />
        <Route path="/onboarding-inbox" element={
          <ProtectedRoute><AppLayout><OnboardingInbox /></AppLayout></ProtectedRoute>
        } />
        <Route path="/orders-inbox" element={
          <ProtectedRoute><AppLayout><OrdersInbox /></AppLayout></ProtectedRoute>
        } />
        <Route path="/tickets/sales" element={
          <ProtectedRoute><AppLayout><SalesTickets /></AppLayout></ProtectedRoute>
        } />
        <Route path="/tickets/orders" element={
          <ProtectedRoute><AppLayout><OrdersTickets /></AppLayout></ProtectedRoute>
        } />
        <Route path="/catalogue/categories" element={
          <ProtectedRoute adminOnly><AppLayout><ProductCategories /></AppLayout></ProtectedRoute>
        } />
        <Route path="/catalogue/uom" element={
          <ProtectedRoute adminOnly><AppLayout><ProductUOM /></AppLayout></ProtectedRoute>
        } />

        <Route path="/doc-templates" element={<Navigate to="/settings?tab=doc-templates" replace />} />
        <Route path="/settings/email-routing" element={<Navigate to="/settings?tab=email-routing" replace />} />
        <Route path="/settings/mailboxes" element={<Navigate to="/settings?tab=mailboxes" replace />} />
        <Route path="/settings/mailbox" element={
          <ProtectedRoute><AppLayout><MailboxSettings /></AppLayout></ProtectedRoute>
        } />
        <Route path="/settings/onboarding-mailbox" element={
          <ProtectedRoute><AppLayout><OnboardingMailboxSettings /></AppLayout></ProtectedRoute>
        } />
        <Route path="/my-applications" element={
          <ProtectedRoute><AppLayout><ResellerApplications /></AppLayout></ProtectedRoute>
        } />
        <Route path="/my-applications/:id" element={
          <ProtectedRoute><AppLayout><ResellerApplicationDetail /></AppLayout></ProtectedRoute>
        } />

        {/* Catch-all */}
        <Route path="*" element={<Navigate to="/" replace />} />
      </Routes>
    </>
  );
}
