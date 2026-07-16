"use client";
import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { sb } from "../../lib/supabase";
import { TopBar } from "../ui";

export default function Account() {
  const router = useRouter();
  const [user, setUser] = useState(null);
  const [pw1, setPw1] = useState("");
  const [pw2, setPw2] = useState("");
  const [msg, setMsg] = useState("");
  const [err, setErr] = useState("");
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    sb().auth.getUser().then(({ data }) => {
      if (!data.user) router.replace("/login");
      else setUser(data.user);
    });
  }, [router]);

  async function change(e) {
    e.preventDefault();
    setErr(""); setMsg("");
    if (pw1.length < 10) { setErr("Use at least 10 characters."); return; }
    if (pw1 !== pw2) { setErr("Passwords don't match."); return; }
    setBusy(true);
    const { error } = await sb().auth.updateUser({ password: pw1 });
    setBusy(false);
    if (error) { setErr(error.message); return; }
    setPw1(""); setPw2("");
    setMsg("Password changed. Use the new password next time you sign in.");
  }

  if (!user) return <p className="muted">Loading…</p>;
  return (
    <>
      <TopBar user={user} />
      <h1>Account</h1>
      <div className="card" style={{ maxWidth: 480 }}>
        <h2>Change password</h2>
        <p className="muted small">Signed in as {user.email}. If you were given a temporary password, change it here now.</p>
        {err ? <div className="err">{err}</div> : null}
        {msg ? <div className="ok">{msg}</div> : null}
        <form onSubmit={change}>
          <label className="f">New password</label>
          <input type="password" value={pw1} onChange={(e) => setPw1(e.target.value)} autoComplete="new-password" />
          <label className="f">Repeat new password</label>
          <input type="password" value={pw2} onChange={(e) => setPw2(e.target.value)} autoComplete="new-password" />
          <div style={{ marginTop: 16 }}>
            <button className="btn btn-primary" disabled={busy}>{busy ? "Saving…" : "Change password"}</button>
          </div>
        </form>
      </div>
      <p className="small muted">Multi-factor authentication is on the roadmap for the next phase.</p>
    </>
  );
}
