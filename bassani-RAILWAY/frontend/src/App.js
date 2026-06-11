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
import Invoices         from "./views/Invoices";
import CustomerProfile  from "./views/CustomerProfile";
import Scripts          from "./views/Scripts";
import HcpRegister      from "./views/HcpRegister";
import Targets               from "./views/Targets";
import CustomerOnboarding    from "./views/CustomerOnboarding";
import CustomerApplications  from "./views/CustomerApplications";
import ResellerProfile       from "./views/ResellerProfile";

function ProtectedRoute({ children, adminOnly }) {
  const { user, loading } = useAuth();
  if (loading) return (
    <div className="flex items-center justify-center h-screen">
      <Spinner size="lg" />
    </div>
  );
  if (!user) return <Navigate to="/login" replace />;
  if (adminOnly && user.role !== "admin") return <Navigate to="/" replace />;
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
        <Route path="/login" element={user ? <Navigate to="/" replace /> : <Login />} />
        <Route path="/register" element={<HcpRegister />} />

        <Route path="/" element={
          <ProtectedRoute><AppLayout><Dashboard /></AppLayout></ProtectedRoute>
        } />
        <Route path="/products" element={
          <ProtectedRoute><AppLayout><Products /></AppLayout></ProtectedRoute>
        } />
        <Route path="/customers" element={
          <ProtectedRoute><AppLayout><Customers /></AppLayout></ProtectedRoute>
        } />
        <Route path="/customers/:id" element={
          <ProtectedRoute adminOnly><AppLayout><CustomerProfile /></AppLayout></ProtectedRoute>
        } />
        <Route path="/orders" element={
          <ProtectedRoute><AppLayout><Orders /></AppLayout></ProtectedRoute>
        } />
        <Route path="/onboard" element={
          <ProtectedRoute><AppLayout><CustomerOnboarding /></AppLayout></ProtectedRoute>
        } />
        <Route path="/applications" element={
          <ProtectedRoute adminOnly><AppLayout><CustomerApplications /></AppLayout></ProtectedRoute>
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
        <Route path="/targets" element={
          <ProtectedRoute adminOnly><AppLayout><Targets /></AppLayout></ProtectedRoute>
        } />
        <Route path="/reports" element={
          <ProtectedRoute adminOnly><AppLayout><Reports /></AppLayout></ProtectedRoute>
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

        {/* Catch-all */}
        <Route path="*" element={<Navigate to="/" replace />} />
      </Routes>
    </>
  );
}
