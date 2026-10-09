import type { ReactNode } from "react";

/** Brand story beside a focused form card; used by sign-in and password recovery. */
export function AuthLayout({ children }: { children: ReactNode }) {
  return (
    <main className="login-page">
      <section aria-hidden="true" className="login-story">
        <div className="login-brand"><span className="brand-mark"><span>R</span></span> RetailOps BD</div>
        <div>
          <span className="login-kicker">Commerce operations, beautifully connected</span>
          <h1>Run every sale, order and stock movement with confidence.</h1>
          <p>Built for Bangladesh’s fast-moving retailers, from the counter to COD delivery, even when the internet drops.</p>
        </div>
        <div className="login-proof">
          <span><strong>Offline-first</strong><small>Never stop selling</small></span>
          <span><strong>One ledger</strong><small>Always accountable</small></span>
          <span><strong>BD ready</strong><small>COD &amp; MFS workflows</small></span>
        </div>
      </section>
      <section className="login-panel">{children}</section>
    </main>
  );
}
