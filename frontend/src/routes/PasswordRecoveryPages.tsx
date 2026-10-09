import { KeyRound, MailCheck } from "lucide-react";
import { useState, type FormEvent } from "react";
import { Link, useNavigate, useSearchParams } from "react-router-dom";

import { AuthLayout } from "../components/auth/AuthLayout";
import { Button } from "../components/ui/Button";
import { Input } from "../components/ui/Input";
import { api } from "../lib/api";
import { passwordProblems } from "../lib/passwordPolicy";

export function ForgotPasswordPage() {
  const [email, setEmail] = useState("");
  const [sent, setSent] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");

  async function submit(event: FormEvent) {
    event.preventDefault();
    setBusy(true);
    setError("");
    try {
      await api("/api/v1/auth/forgot-password", { method: "POST", body: JSON.stringify({ email }) });
      setSent(true);
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : "Could not send the reset link");
    } finally {
      setBusy(false);
    }
  }

  return (
    <AuthLayout>
      <form className="login-card" onSubmit={(event) => void submit(event)}>
        <span aria-hidden="true" className="login-icon">{sent ? <MailCheck size={22} /> : <KeyRound size={22} />}</span>
        <h2>{sent ? "Check your email" : "Reset your password"}</h2>
        {sent ? (
          <p role="status">If {email} has an account, a one-time reset link is on its way. It expires in 30 minutes.</p>
        ) : (
          <>
            <p>Enter your work email and we will send a one-time reset link.</p>
            <Input autoComplete="email" label="Email address" onChange={(event) => setEmail(event.target.value)} required type="email" value={email} />
            {error ? <div className="form-alert" role="alert">{error}</div> : null}
            <Button aria-busy={busy} disabled={busy || !email} size="lg" type="submit">{busy ? "Sending…" : "Send reset link"}</Button>
          </>
        )}
        <Link className="text-link" to="/login">Back to sign in</Link>
      </form>
    </AuthLayout>
  );
}

export function ResetPasswordPage() {
  const [params] = useSearchParams();
  const token = params.get("token") ?? "";
  const navigate = useNavigate();
  const [password, setPassword] = useState("");
  const [confirm, setConfirm] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const problems = password ? passwordProblems(password) : [];
  const mismatch = Boolean(confirm) && confirm !== password;

  async function submit(event: FormEvent) {
    event.preventDefault();
    if (problems.length || mismatch) return;
    setBusy(true);
    setError("");
    try {
      await api("/api/v1/auth/reset-password", { method: "POST", body: JSON.stringify({ token, new_password: password }) });
      void navigate("/login", { replace: true, state: { notice: "Password updated. Sign in with your new password." } });
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : "Could not reset the password");
    } finally {
      setBusy(false);
    }
  }

  return (
    <AuthLayout>
      <form className="login-card" onSubmit={(event) => void submit(event)}>
        <span aria-hidden="true" className="login-icon"><KeyRound size={22} /></span>
        <h2>Choose a new password</h2>
        {!token ? (
          <div className="form-alert" role="alert">This link is missing its token. Request a new reset link.</div>
        ) : (
          <>
            <p>This also signs you out on every other device.</p>
            <Input autoComplete="new-password" error={problems[0]} hint="At least 10 characters, with letters and numbers" label="New password" onChange={(event) => setPassword(event.target.value)} required type="password" value={password} />
            <Input autoComplete="new-password" error={mismatch ? "Passwords do not match" : undefined} label="Confirm new password" onChange={(event) => setConfirm(event.target.value)} required type="password" value={confirm} />
            {error ? <div className="form-alert" role="alert">{error}</div> : null}
            <Button aria-busy={busy} disabled={busy || !password || problems.length > 0 || mismatch || !confirm} size="lg" type="submit">{busy ? "Saving…" : "Set new password"}</Button>
          </>
        )}
        <Link className="text-link" to="/forgot-password">Request a new link</Link>
      </form>
    </AuthLayout>
  );
}
