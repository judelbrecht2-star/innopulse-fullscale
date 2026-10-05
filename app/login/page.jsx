"use client";
import { useState } from "react";
import { useRouter } from "next/navigation";
import { sb } from "../../lib/supabase";
import { I } from "../ui";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";

export default function Login() {
  const router = useRouter();
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [err, setErr] = useState("");
  const [msg, setMsg] = useState("");
  const [busy, setBusy] = useState(false);
  const [showPassword, setShowPassword] = useState(false);

  async function forgot() {
    setErr(""); setMsg("");
    if (!email) { setErr("Enter your email first, then click the reset link."); return; }
    setBusy(true);
    try {
      const { error } = await sb().auth.resetPasswordForEmail(email.trim(), {
        redirectTo: "https://innopulse-fullscale.vercel.app/settings/security",
      });
      if (error) throw error;
      setMsg("If an account uses this email, a reset link is on its way. Check your inbox.");
    } catch (ex) { setErr(ex.message || "Could not send the reset link. Check your connection and try again."); }
    finally { setBusy(false); }
  }

  const [mfa, setMfa] = useState(null); // { factorId } while a TOTP challenge is pending
  const [code, setCode] = useState("");

  async function submit(e) {
    e.preventDefault();
    setErr(""); setMsg(""); setBusy(true);
    // Gate 1: if the account has TOTP enrolled, require the second factor
    try {
      const { error } = await sb().auth.signInWithPassword({ email: email.trim(), password });
      if (error) throw error;
      const { data: aal, error: aalError } = await sb().auth.mfa.getAuthenticatorAssuranceLevel();
      if (aalError) throw aalError;
      if (aal?.nextLevel === "aal2" && aal.nextLevel !== aal.currentLevel) {
        const { data: f, error: factorError } = await sb().auth.mfa.listFactors();
        if (factorError) throw factorError;
        const totp = f?.totp?.find((factor) => factor.status === "verified");
        if (!totp) throw new Error("Could not verify your second factor. Please try signing in again.");
        setMfa({ factorId: totp.id }); return;
      }
      router.replace("/dashboard");
    } catch (ex) { setErr(ex.message || "Could not sign in. Check your connection and try again."); }
    finally { setBusy(false); }
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
    <main className="authwrap auth-layout">
      <section className="auth-story" aria-label="About InnoPulse">
        <p className="auth-eyebrow">THE GROWTH SYSTEM</p>
        <h1>Understand your innovation health. Agree on what comes next.</h1>
        <p>Bring stakeholder perspectives together and turn the evidence into a practical improvement plan.</p>
        <ol><li>Collect feedback across stakeholder groups</li><li>Review findings and perception gaps</li><li>Plan actions and track their outcomes</li></ol>
        <div className="auth-privacy"><I.shield /> Group results stay hidden until enough people have responded.</div>
      </section>
      <div className="authcard">
        <div className="authbrand">
          <span className="sb-logo"><I.pulse /></span> InnoPulse <span className="muted" style={{ fontWeight: 700, fontSize: 13, letterSpacing: 1.2 }}>FULL-SCALE</span>
        </div>
        <div className="card">
          <h2 style={{ fontSize: 24 }}>{mfa ? "Verify it’s you" : "Sign in to your workspace"}</h2>
          <p className="muted small">
            Corporate workspace access. Respondents don&apos;t need an account —
            they use the campaign link they were given.
          </p>
          {err ? <div role="alert" className="err">{err}</div> : null}
          {msg ? <div role="status" className="ok">{msg}</div> : null}
          {mfa ? (
            <form onSubmit={verifyMfa}>
              <label className="f" htmlFor="mfa-code">Two-factor code</label>
              <Input id="mfa-code" type="text" inputMode="numeric" autoFocus required pattern="[0-9]{6}" maxLength={6} value={code} onChange={(e) => setCode(e.target.value.replace(/\D/g, ""))}
                placeholder="6-digit code from your authenticator app" autoComplete="one-time-code" />
              <div style={{ marginTop: 14 }}>
                <Button disabled={busy} style={{ width: "100%", justifyContent: "center" }}>
                  {busy ? "Verifying…" : "Verify"}
                </Button>
              </div>
            </form>
          ) : (
          <form onSubmit={submit}>
            <label className="f" htmlFor="email">Email</label>
            <Input id="email" type="email" disabled={busy} value={email} onChange={(e) => setEmail(e.target.value)} required autoComplete="username" />
            <label className="f" htmlFor="password">Password</label>
            <Input id="password" type={showPassword ? "text" : "password"} disabled={busy} value={password} onChange={(e) => setPassword(e.target.value)} required autoComplete="current-password" />
            <button type="button" className="auth-text-button" aria-pressed={showPassword} onClick={() => setShowPassword((v) => !v)}>{showPassword ? "Hide password" : "Show password"}</button>
            <div style={{ marginTop: 18 }}>
              <Button disabled={busy} style={{ width: "100%", justifyContent: "center" }}>
                {busy ? "Signing in…" : "Sign in"}
              </Button>
            </div>
          </form>
          )}
          {!mfa ? <p className="small" style={{ marginTop: 12 }}>
            <button type="button" onClick={forgot} disabled={busy}
              style={{ background: "none", border: "none", padding: 0, cursor: "pointer", textDecoration: "underline", color: "var(--muted)" }}>
              Forgotten your password? Email me a reset link
            </button>
          </p> : <Button variant="ghost" disabled={busy} onClick={async () => {
            const { error } = await sb().auth.signOut();
            if (error) { setErr("Could not switch accounts. Please try again."); return; }
            setMfa(null); setCode(""); setPassword(""); setErr("");
          }}>Use a different account</Button>}
        </div>
        <p className="footer" style={{ marginTop: 14 }}>InnoPulse Full-Scale · The Growth System</p>
      </div>
    </main>
  );
}
