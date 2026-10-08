import { LockKeyhole, Store } from "lucide-react";
import { useState } from "react";
import type { FormEvent } from "react";
import { Navigate, useLocation, useNavigate } from "react-router-dom";

import { Button } from "../components/ui/Button";
import { Input } from "../components/ui/Input";
import { useAuthStore } from "../stores/authStore";

export function LoginPage() {
  const { user, login } = useAuthStore();
  const [email, setEmail] = useState("owner@retailopsbd.com");
  const [password, setPassword] = useState("RetailOps123!");
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);
  const navigate = useNavigate();
  const location = useLocation();
  if (user) return <Navigate replace to="/dashboard" />;

  async function submit(event: FormEvent) {
    event.preventDefault();
    setBusy(true);
    setError("");
    try {
      await login(email, password);
      void navigate((location.state as { from?: string } | null)?.from ?? "/dashboard", { replace: true });
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : "Unable to sign in");
    } finally {
      setBusy(false);
    }
  }

  return (
    <main className="login-page">
      <section className="login-story">
        <div className="login-brand"><span className="brand-mark"><span>R</span></span> RetailOps BD</div>
        <div><span className="login-kicker">Commerce operations, beautifully connected</span><h1>Run every sale, order and stock movement with confidence.</h1><p>Built for Bangladesh’s fast-moving retailers—from the counter to COD delivery, even when the internet drops.</p></div>
        <div className="login-proof"><span><strong>Offline-first</strong><small>Never stop selling</small></span><span><strong>One ledger</strong><small>Always accountable</small></span><span><strong>BD ready</strong><small>COD &amp; MFS workflows</small></span></div>
      </section>
      <section className="login-panel">
        <form className="login-card" onSubmit={(event) => void submit(event)}>
          <span className="login-icon"><Store size={22} /></span>
          <h2>Welcome back</h2><p>Sign in to your retail workspace.</p>
          <Input autoComplete="email" label="Email address" onChange={(event) => setEmail(event.target.value)} required type="email" value={email} />
          <Input autoComplete="current-password" label="Password" onChange={(event) => setPassword(event.target.value)} required type="password" value={password} />
          {error ? <div className="form-alert" role="alert">{error}</div> : null}
          <Button disabled={busy} size="lg" type="submit"><LockKeyhole size={17} /> {busy ? "Signing in…" : "Sign in securely"}</Button>
          <small className="demo-credential">Demo credentials are pre-filled.</small>
        </form>
      </section>
    </main>
  );
}
