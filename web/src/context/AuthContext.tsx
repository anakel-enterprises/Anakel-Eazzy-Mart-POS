import { createContext, useContext, useEffect, useState, type ReactNode } from "react";
import { api } from "../lib/api";
import { refreshProductCache } from "../lib/sync";
import type { PermissionMap } from "../lib/permissions";
import { clearActivity, isSessionTimedOut, recordActivity } from "../lib/sessionTimeout";

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
  sessionTimedOut: boolean;
  login: (email: string, password: string) => Promise<void>;
  logout: () => void;
}

const AuthContext = createContext<AuthContextValue | undefined>(undefined);

function clearStoredSession() {
  localStorage.removeItem("auth_token");
  localStorage.removeItem("auth_user");
  clearActivity();
}

export function AuthProvider({ children }: { children: ReactNode }) {
  const [user, setUser] = useState<AuthUser | null>(null);
  const [loading, setLoading] = useState(true);
  const [sessionExpired, setSessionExpired] = useState(false);
  const [sessionTimedOut, setSessionTimedOut] = useState(false);

  useEffect(() => {
    const stored = localStorage.getItem("auth_user");
    // Covers both "left the tab open and idle" and "closed the installed
    // app and reopened it later" — either way, silently landing back on the
    // dashboard without a fresh login is the exact gap this closes.
    const timedOut = !!stored && isSessionTimedOut();
    if (timedOut) {
      clearStoredSession();
      setSessionTimedOut(true);
    } else if (stored) {
      setUser(JSON.parse(stored));
      recordActivity();
    }
    setLoading(false);

    // Refresh role/permissions from the server on load in case an admin
    // changed them since this device last logged in — best-effort, since
    // this device may currently be offline for a shift.
    if (stored && !timedOut) {
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
    // eslint-disable-next-line react-hooks/exhaustive-deps
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

  // Only wired up while logged in, and only real user input resets the
  // clock — background sync/API polling must never count as activity, or
  // an unattended device would never time out.
  useEffect(() => {
    if (!user) return;

    function checkIdle() {
      if (isSessionTimedOut()) {
        clearStoredSession();
        setUser(null);
        setSessionTimedOut(true);
      }
    }

    const activityEvents = ["mousedown", "keydown", "touchstart", "click"] as const;
    const onActivity = () => recordActivity();
    activityEvents.forEach((evt) => window.addEventListener(evt, onActivity, { passive: true }));

    const interval = setInterval(checkIdle, 30_000);

    // Catches the case where the interval was throttled/suspended while the
    // app was backgrounded — re-check the moment it's visible again.
    const onVisible = () => {
      if (document.visibilityState === "visible") checkIdle();
    };
    document.addEventListener("visibilitychange", onVisible);
    window.addEventListener("focus", onVisible);

    return () => {
      activityEvents.forEach((evt) => window.removeEventListener(evt, onActivity));
      clearInterval(interval);
      document.removeEventListener("visibilitychange", onVisible);
      window.removeEventListener("focus", onVisible);
    };
  }, [user]);

  async function login(email: string, password: string) {
    const result = await api.post<{ token: string; user: AuthUser }>("/api/auth/login", {
      email,
      password,
    });
    localStorage.setItem("auth_token", result.token);
    localStorage.setItem("auth_user", JSON.stringify(result.user));
    recordActivity();
    setUser(result.user);
    setSessionExpired(false);
    setSessionTimedOut(false);
    void refreshProductCache();
  }

  function logout() {
    clearStoredSession();
    setUser(null);
    setSessionExpired(false);
    setSessionTimedOut(false);
  }

  return (
    <AuthContext.Provider value={{ user, loading, sessionExpired, sessionTimedOut, login, logout }}>
      {children}
    </AuthContext.Provider>
  );
}

export function useAuth(): AuthContextValue {
  const ctx = useContext(AuthContext);
  if (!ctx) throw new Error("useAuth must be used within AuthProvider");
  return ctx;
}
