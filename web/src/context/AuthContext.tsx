import { createContext, useContext, useEffect, useState, type ReactNode } from "react";
import { api } from "../lib/api";
import { refreshProductCache } from "../lib/sync";
import type { PermissionMap } from "../lib/permissions";

export interface AuthUser {
  id: string;
  name: string;
  email: string;
  role: "ADMIN" | "MANAGER" | "CASHIER" | "STOREKEEPER" | "ACCOUNTANT";
  storeId: string;
  permissions: PermissionMap;
}

interface AuthContextValue {
  user: AuthUser | null;
  loading: boolean;
  sessionExpired: boolean;
  login: (email: string, password: string) => Promise<void>;
  logout: () => void;
}

const AuthContext = createContext<AuthContextValue | undefined>(undefined);

export function AuthProvider({ children }: { children: ReactNode }) {
  const [user, setUser] = useState<AuthUser | null>(null);
  const [loading, setLoading] = useState(true);
  const [sessionExpired, setSessionExpired] = useState(false);

  useEffect(() => {
    const stored = localStorage.getItem("auth_user");
    if (stored) setUser(JSON.parse(stored));
    setLoading(false);

    // Refresh role/permissions from the server on load in case an admin
    // changed them since this device last logged in — best-effort, since
    // this device may currently be offline for a shift.
    if (stored) {
      void api
        .get<AuthUser>("/api/auth/me")
        .then((fresh) => {
          localStorage.setItem("auth_user", JSON.stringify(fresh));
          setUser(fresh);
        })
        .catch(() => {
          // Offline or token invalid — keep the cached user; requireAuth
          // still re-verifies server-side on the next successful request.
        });
    }
  }, []);

  useEffect(() => {
    // api.ts clears localStorage and fires this the moment any request
    // comes back 401 — previously nothing listened for it, so an expired
    // session just left every page silently rendering empty data forever.
    const handler = () => {
      setUser(null);
      setSessionExpired(true);
    };
    window.addEventListener("auth:session-expired", handler);
    return () => window.removeEventListener("auth:session-expired", handler);
  }, []);

  async function login(email: string, password: string) {
    const result = await api.post<{ token: string; user: AuthUser }>("/api/auth/login", {
      email,
      password,
    });
    localStorage.setItem("auth_token", result.token);
    localStorage.setItem("auth_user", JSON.stringify(result.user));
    setUser(result.user);
    setSessionExpired(false);
    void refreshProductCache();
  }

  function logout() {
    localStorage.removeItem("auth_token");
    localStorage.removeItem("auth_user");
    setUser(null);
    setSessionExpired(false);
  }

  return (
    <AuthContext.Provider value={{ user, loading, sessionExpired, login, logout }}>{children}</AuthContext.Provider>
  );
}

export function useAuth(): AuthContextValue {
  const ctx = useContext(AuthContext);
  if (!ctx) throw new Error("useAuth must be used within AuthProvider");
  return ctx;
}
