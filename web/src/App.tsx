import { Navigate, Route, Routes } from "react-router-dom";
import { AuthProvider, useAuth, type AuthUser } from "./context/AuthContext";
import { Layout } from "./components/Layout";
import { UpdateBanner } from "./components/UpdateBanner";
import { Login } from "./pages/Login";
import { Dashboard } from "./pages/Dashboard";
import { Checkout } from "./pages/Checkout";
import { Inventory } from "./pages/Inventory";
import { CashRegisterPage } from "./pages/CashRegisterPage";
import { Reports } from "./pages/Reports";
import { Employees } from "./pages/Employees";
import { Settings } from "./pages/Settings";
import { Suppliers } from "./pages/Suppliers";
import { CreditSales } from "./pages/CreditSales";
import { Expenses } from "./pages/Expenses";
import { Promotions } from "./pages/Promotions";

function ProtectedRoutes({ roles }: { roles?: AuthUser["role"][] }) {
  const { user, loading } = useAuth();
  if (loading) return null;
  if (!user) return <Navigate to="/login" replace />;
  if (roles && !roles.includes(user.role)) return <Navigate to="/" replace />;
  return <Layout />;
}

function AppRoutes() {
  return (
    <Routes>
      <Route path="/login" element={<Login />} />
      <Route element={<ProtectedRoutes />}>
        <Route path="/" element={<Dashboard />} />
      </Route>
      <Route element={<ProtectedRoutes roles={["ADMIN", "MANAGER", "CASHIER"]} />}>
        <Route path="/checkout" element={<Checkout />} />
        <Route path="/register" element={<CashRegisterPage />} />
      </Route>
      <Route element={<ProtectedRoutes roles={["ADMIN", "MANAGER", "STOREKEEPER"]} />}>
        <Route path="/inventory" element={<Inventory />} />
      </Route>
      <Route element={<ProtectedRoutes roles={["ADMIN", "MANAGER", "STOREKEEPER", "ACCOUNTANT"]} />}>
        <Route path="/suppliers" element={<Suppliers />} />
      </Route>
      <Route element={<ProtectedRoutes roles={["ADMIN", "MANAGER", "ACCOUNTANT", "CASHIER"]} />}>
        <Route path="/credit-sales" element={<CreditSales />} />
      </Route>
      <Route element={<ProtectedRoutes roles={["ADMIN", "MANAGER", "ACCOUNTANT"]} />}>
        <Route path="/expenses" element={<Expenses />} />
        <Route path="/reports" element={<Reports />} />
      </Route>
      <Route element={<ProtectedRoutes roles={["ADMIN", "MANAGER"]} />}>
        <Route path="/promotions" element={<Promotions />} />
      </Route>
      <Route element={<ProtectedRoutes roles={["ADMIN"]} />}>
        <Route path="/employees" element={<Employees />} />
        <Route path="/settings" element={<Settings />} />
      </Route>
    </Routes>
  );
}

export function App() {
  return (
    <AuthProvider>
      <UpdateBanner />
      <AppRoutes />
    </AuthProvider>
  );
}
