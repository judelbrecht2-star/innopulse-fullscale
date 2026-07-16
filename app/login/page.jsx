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
  const [busy, setBusy] = useState(false);

  async function submit(e) {
    e.preventDefault();
    setErr(""); setBusy(true);
    const { error } = await sb().auth.signInWithPassword({ email, password });
    setBusy(false);
    if (error) { setErr(error.message); return; }
    router.push("/dashboard");
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
        </div>
        <p className="footer" style={{ marginTop: 14 }}>InnoPulse Full-Scale · preview build · The Growth System</p>
      </div>
    </div>
  );
}
