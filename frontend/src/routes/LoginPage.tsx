import { Clock, LockKeyhole, Store } from "lucide-react";
import { useState, type FormEvent } from "react";
import { Link, Navigate, useLocation, useNavigate } from "react-router-dom";

import { AuthLayout } from "../components/auth/AuthLayout";
import { Button } from "../components/ui/Button";
import { Input } from "../components/ui/Input";
import { useAuthStore } from "../stores/authStore";

// Demo credentials are pre-filled only in development or the public demo build.
const DEMO_MODE = import.meta.env.DEV || import.meta.env.VITE_DEMO_MODE === "true";

export function LoginPage() {
  const { user, login, sessionExpired } = useAuthStore();
  const [email, setEmail] = useState(DEMO_MODE ? "owner@retailopsbd.com" : "");
  const [password, setPassword] = useState(DEMO_MODE ? "RetailOps123!" : "");
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);
  const navigate = useNavigate();
  const location = useLocation();
  const state = location.state as { from?: string; notice?: string } | null;
  const from = state?.from ?? "/dashboard";
  if (user) return <Navigate replace to={from} />;

  async function submit(event: FormEvent) {
    event.preventDefault();
    setBusy(true);
    setError("");
    try {
      await login(email, password);
      void navigate(from, { replace: true });
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : "Unable to sign in");
    } finally {
      setBusy(false);
    }
  }

  return (
    <AuthLayout>
      <form className="login-card" onSubmit={(event) => void submit(event)}>
        <span aria-hidden="true" className="login-icon"><Store size={22} /></span>
        <h2>Welcome back</h2>
        <p>Sign in to your retail workspace.</p>
        {sessionExpired ? (
          <div className="form-notice" role="status"><Clock aria-hidden="true" size={16} /> Your session expired. Sign in again to continue; offline sales on this device are safe.</div>
        ) : null}
        {state?.notice ? <div className="form-notice success" role="status">{state.notice}</div> : null}
        <Input autoComplete="email" label="Email address" onChange={(event) => setEmail(event.target.value)} required type="email" value={email} />
        <Input autoComplete="current-password" label="Password" onChange={(event) => setPassword(event.target.value)} required type="password" value={password} />
        <Link className="text-link" to="/forgot-password">Forgot your password?</Link>
        {error ? <div className="form-alert" role="alert">{error}</div> : null}
        <Button aria-busy={busy} disabled={busy} size="lg" type="submit"><LockKeyhole aria-hidden="true" size={17} /> {busy ? "Signing in…" : "Sign in securely"}</Button>
        {DEMO_MODE ? <small className="demo-credential">Demo workspace: credentials are pre-filled. Try cashier@retailopsbd.com for the cashier view.</small> : null}
      </form>
    </AuthLayout>
  );
}
