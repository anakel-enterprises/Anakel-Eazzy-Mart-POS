import { useState } from "react";
import { useNavigate } from "react-router-dom";
import { useAuth } from "../context/AuthContext";
import { Button } from "../components/ui";

export function Login() {
  const { login, sessionExpired, sessionTimedOut } = useAuth();
  const navigate = useNavigate();
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setError(null);
    setSubmitting(true);
    try {
      await login(email, password);
      navigate("/");
    } catch (err) {
      // Covers both a real server-side rejection (ApiError) and the local
      // offline-login fallback's own messages (a plain Error — see
      // AuthContext.login) with the same handling.
      setError(err instanceof Error ? err.message : "Could not reach the server");
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <div className="flex min-h-screen items-center justify-center bg-brand-bg p-4">
      <form
        onSubmit={handleSubmit}
        className="w-full max-w-sm rounded-2xl border border-brand-border bg-white p-6 shadow-card sm:p-8"
      >
        <div className="mb-6 flex items-center gap-3">
          <div className="flex h-10 w-10 items-center justify-center rounded-[10px] bg-brand-accentDeep font-display text-lg font-bold text-white">
            A
          </div>
          <div>
            <div className="font-display text-lg font-bold text-brand-ink">Anakel Eazzy Mart</div>
            <div className="text-xs text-brand-inkMuted">Point of Sale</div>
          </div>
        </div>

        <label className="mb-3 block text-sm">
          <span className="mb-1 block font-medium text-brand-ink">Email</span>
          <input
            type="text"
            required
            value={email}
            onChange={(e) => setEmail(e.target.value)}
            className="w-full rounded-lg border border-brand-border px-3 py-2 outline-none focus:border-brand-accentDeep"
            placeholder="email/username"
          />
        </label>

        <label className="mb-4 block text-sm">
          <span className="mb-1 block font-medium text-brand-ink">Password</span>
          <input
            type="password"
            required
            value={password}
            onChange={(e) => setPassword(e.target.value)}
            className="w-full rounded-lg border border-brand-border px-3 py-2 outline-none focus:border-brand-accentDeep"
          />
        </label>

        {!error && sessionTimedOut && (
          <div className="mb-4 rounded-lg bg-brand-warnBg px-3 py-2 text-sm font-medium text-brand-warn">
            You were logged out after 15 minutes of inactivity — please log in again.
          </div>
        )}
        {!error && !sessionTimedOut && sessionExpired && (
          <div className="mb-4 rounded-lg bg-brand-warnBg px-3 py-2 text-sm font-medium text-brand-warn">
            Your session expired — please log in again.
          </div>
        )}
        {error && <div className="mb-4 text-sm font-medium text-brand-warn">{error}</div>}

        <Button type="submit" disabled={submitting} className="w-full">
          {submitting ? "Signing in…" : "Sign in"}
        </Button>
      </form>
    </div>
  );
}
