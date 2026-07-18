"use client";
import { useState } from "react";
import { useRouter } from "next/navigation";
import { sb } from "../../lib/supabase";
import { I } from "../ui";

export default function Login() {
  const router = useRouter();
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [err, setErr] = useState("");
  const [msg, setMsg] = useState("");
  const [busy, setBusy] = useState(false);

  async function forgot() {
    setErr(""); setMsg("");
    if (!email) { setErr("Enter your email first, then click the reset link."); return; }
    setBusy(true);
    const { error } = await sb().auth.resetPasswordForEmail(email, {
      redirectTo: "https://innopulse-fullscale.vercel.app/account",
    });
    setBusy(false);
    if (error) setErr(error.message);
    else setMsg("Reset link sent — check your inbox, then set a new password on the Settings page it opens.");
  }

  const [mfa, setMfa] = useState(null); // { factorId } while a TOTP challenge is pending
  const [code, setCode] = useState("");

  async function submit(e) {
    e.preventDefault();
    setErr(""); setBusy(true);
    const { error } = await sb().auth.signInWithPassword({ email, password });
    if (error) { setBusy(false); setErr(error.message); return; }
    // Gate 1: if the account has TOTP enrolled, require the second factor
    try {
      const { data: aal } = await sb().auth.mfa.getAuthenticatorAssuranceLevel();
      if (aal?.nextLevel === "aal2" && aal.nextLevel !== aal.currentLevel) {
        const { data: f } = await sb().auth.mfa.listFactors();
        const totp = f?.totp?.[0];
        if (totp) { setMfa({ factorId: totp.id }); setBusy(false); return; }
      }
    } catch { /* no MFA configured */ }
    setBusy(false);
    router.push("/dashboard");
  }

  async function verifyMfa(e) {
    e.preventDefault();
    setErr(""); setBusy(true);
    try {
      const { data: ch, error: e1 } = await sb().auth.mfa.challenge({ factorId: mfa.factorId });
      if (e1) throw e1;
      const { error: e2 } = await sb().auth.mfa.verify({ factorId: mfa.factorId, challengeId: ch.id, code: code.trim() });
      if (e2) throw e2;
      router.push("/dashboard");
      return;
    } catch (ex) { setErr(ex.message || "Invalid code — try again."); }
    setBusy(false);
  }

  return (
    <div className="authwrap">
      <div className="authcard">
        <div className="authbrand">
          <span className="sb-logo"><I.pulse /></span> InnoPulse <span className="muted" style={{ fontWeight: 700, fontSize: 13, letterSpacing: 1.2 }}>FULL-SCALE</span>
        </div>
        <div className="card">
          <h1 style={{ fontSize: 24 }}>Sign in</h1>
          <p className="muted small">
            Corporate workspace access. Respondents don&apos;t need an account —
            they use the campaign link they were given.
          </p>
          {err ? <div className="err">{err}</div> : null}
          {msg ? <div className="ok">{msg}</div> : null}
          {mfa ? (
            <form onSubmit={verifyMfa}>
              <label className="f">Two-factor code</label>
              <input type="text" inputMode="numeric" autoFocus value={code} onChange={(e) => setCode(e.target.value)}
                placeholder="6-digit code from your authenticator app" autoComplete="one-time-code" />
              <div style={{ marginTop: 14 }}>
                <button className="btn btn-primary" disabled={busy} style={{ width: "100%", justifyContent: "center" }}>
                  {busy ? "Verifying…" : "Verify"}
                </button>
              </div>
            </form>
          ) : (
          <form onSubmit={submit}>
            <label className="f">Email</label>
            <input type="email" value={email} onChange={(e) => setEmail(e.target.value)} required autoComplete="username" />
            <label className="f">Password</label>
            <input type="password" value={password} onChange={(e) => setPassword(e.target.value)} required autoComplete="current-password" />
            <div style={{ marginTop: 18 }}>
              <button className="btn btn-primary" disabled={busy} style={{ width: "100%", justifyContent: "center" }}>
                {busy ? "Signing in…" : "Sign in"}
              </button>
            </div>
          </form>
          )}
          <p className="small" style={{ marginTop: 12 }}>
            <button type="button" onClick={forgot} disabled={busy}
              style={{ background: "none", border: "none", padding: 0, cursor: "pointer", textDecoration: "underline", color: "var(--muted)" }}>
              Forgotten your password? Email me a reset link
            </button>
          </p>
        </div>
        <p className="footer" style={{ marginTop: 14 }}>InnoPulse Full-Scale · preview build · The Growth System</p>
      </div>
    </div>
  );
}
