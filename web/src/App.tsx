import { Navigate, Route, Routes } from "react-router-dom";
import { AuthProvider, useAuth } from "./context/AuthContext";
import { Layout } from "./components/Layout";
import { Login } from "./pages/Login";
import { Dashboard } from "./pages/Dashboard";
import { Checkout } from "./pages/Checkout";
import { Inventory } from "./pages/Inventory";
import { CashRegisterPage } from "./pages/CashRegisterPage";
import { Reports } from "./pages/Reports";
import { Employees } from "./pages/Employees";
import { Settings } from "./pages/Settings";

function ProtectedRoutes({ adminOnly = false }: { adminOnly?: boolean }) {
  const { user, loading } = useAuth();
  if (loading) return null;
  if (!user) return <Navigate to="/login" replace />;
  if (adminOnly && user.role !== "ADMIN") return <Navigate to="/" replace />;
  return <Layout />;
}

function AppRoutes() {
  return (
    <Routes>
      <Route path="/login" element={<Login />} />
      <Route element={<ProtectedRoutes />}>
        <Route path="/" element={<Dashboard />} />
        <Route path="/checkout" element={<Checkout />} />
        <Route path="/inventory" element={<Inventory />} />
        <Route path="/register" element={<CashRegisterPage />} />
        <Route path="/reports" element={<Reports />} />
      </Route>
      <Route element={<ProtectedRoutes adminOnly />}>
        <Route path="/employees" element={<Employees />} />
        <Route path="/settings" element={<Settings />} />
      </Route>
    </Routes>
  );
}

export function App() {
  return (
    <AuthProvider>
      <AppRoutes />
    </AuthProvider>
  );
}
