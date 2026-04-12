import { Routes, Route, Navigate } from "react-router-dom";
import { Toaster } from "react-hot-toast";
import { useAuth } from "./AuthContext";
import { Sidebar } from "./components/UI";
import { Spinner } from "./components/UI";

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
  return (
    <div className="flex h-screen overflow-hidden bg-gray-50">
      <Sidebar />
      <div className="flex-1 flex flex-col overflow-hidden">{children}</div>
    </div>
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

        <Route path="/" element={
          <ProtectedRoute><AppLayout><Dashboard /></AppLayout></ProtectedRoute>
        } />
        <Route path="/products" element={
          <ProtectedRoute adminOnly><AppLayout><Products /></AppLayout></ProtectedRoute>
        } />
        <Route path="/customers" element={
          <ProtectedRoute adminOnly><AppLayout><Customers /></AppLayout></ProtectedRoute>
        } />
        <Route path="/orders" element={
          <ProtectedRoute><AppLayout><Orders /></AppLayout></ProtectedRoute>
        } />
        <Route path="/resellers" element={
          <ProtectedRoute adminOnly><AppLayout><Resellers /></AppLayout></ProtectedRoute>
        } />
        <Route path="/commission" element={
          <ProtectedRoute><AppLayout><Commission /></AppLayout></ProtectedRoute>
        } />
        <Route path="/reports" element={
          <ProtectedRoute adminOnly><AppLayout><Reports /></AppLayout></ProtectedRoute>
        } />
        <Route path="/healthcare" element={
          <ProtectedRoute adminOnly><AppLayout><Healthcare /></AppLayout></ProtectedRoute>
        } />

        {/* Catch-all */}
        <Route path="*" element={<Navigate to="/" replace />} />
      </Routes>
    </>
  );
}
