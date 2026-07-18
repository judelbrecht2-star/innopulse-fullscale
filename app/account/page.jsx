"use client";
import { useCallback, useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { sb, FN_BASE } from "../../lib/supabase";
import { Shell } from "../ui";

const ROLE_HELP = {
  owner: "Full control — campaigns, settings, team, and below-threshold detail",
  manager: "Runs campaigns and data collection",
  analyst: "Reads results and responses",
  viewer: "Reads aggregated results only",
};

export default function Account() {
  const router = useRouter();
  const [user, setUser] = useState(null);
  const [org, setOrg] = useState(null);
  const [role, setRole] = useState("");
  const [pw1, setPw1] = useState("");
  const [pw2, setPw2] = useState("");
  const [msg, setMsg] = useState("");
  const [err, setErr] = useState("");
  const [busy, setBusy] = useState(false);
  // mfa
  const [factors, setFactors] = useState(null);
  const [enroll, setEnroll] = useState(null); // { factorId, qr, secret }
  const [mfaCode, setMfaCode] = useState("");
  const [mfaMsg, setMfaMsg] = useState("");
  // team
  const [members, setMembers] = useState(null);
  const [tErr, setTErr] = useState("");
  const [tMsg, setTMsg] = useState("");
  const [invEmail, setInvEmail] = useState("");
  const [invRole, setInvRole] = useState("analyst");
  const [tBusy, setTBusy] = useState(false);

  const loadTeam = useCallback(async (orgId) => {
    setTErr("");
    const { data: sess } = await sb().auth.getSession();
    const jwt = sess.session?.access_token;
    if (!jwt) return;
    try {
      const r = await fetch(`${FN_BASE}/fs-admin`, {
        method: "POST",
        headers: { "Content-Type": "application/json", Authorization: `Bearer ${jwt}` },
        body: JSON.stringify({ action: "members", org_id: orgId }),
      });
      const j = await r.json();
      if (!r.ok) { setTErr(j.error || "Could not load the team."); return; }
      setMembers(j.members || []);
    } catch { setTErr("Could not load the team."); }
  }, []);

  useEffect(() => {
    (async () => {
      const { data } = await sb().auth.getUser();
      if (!data.user) { router.replace("/login"); return; }
      setUser(data.user);
      const { data: mem } = await sb().from("fs_memberships")
        .select("role, org_id, fs_orgs(id, name)").limit(1).maybeSingle();
      if (mem) {
        setOrg(mem.fs_orgs); setRole(mem.role);
        if (mem.role === "owner" || mem.role === "manager") loadTeam(mem.org_id);
      }
      try { const { data: f } = await sb().auth.mfa.listFactors(); setFactors(f?.totp || []); } catch { setFactors([]); }
    })();
  }, [router, loadTeam]);

  async function startEnroll() {
    setMfaMsg("");
    const { data, error } = await sb().auth.mfa.enroll({ factorType: "totp", friendlyName: "Authenticator app" });
    if (error) { setMfaMsg(error.message); return; }
    setEnroll({ factorId: data.id, qr: data.totp.qr_code, secret: data.totp.secret });
  }
  async function confirmEnroll() {
    setMfaMsg("");
    try {
      const { data: ch, error: e1 } = await sb().auth.mfa.challenge({ factorId: enroll.factorId });
      if (e1) throw e1;
      const { error: e2 } = await sb().auth.mfa.verify({ factorId: enroll.factorId, challengeId: ch.id, code: mfaCode.trim() });
      if (e2) throw e2;
      setEnroll(null); setMfaCode(""); setMfaMsg("Two-factor authentication is on ✓ — you'll be asked for a code at every sign-in.");
      const { data: f } = await sb().auth.mfa.listFactors(); setFactors(f?.totp || []);
    } catch (ex) { setMfaMsg(ex.message || "Invalid code — try again."); }
  }
  async function removeFactor(id) {
    setMfaMsg("");
    const { error } = await sb().auth.mfa.unenroll({ factorId: id });
    if (error) setMfaMsg(error.message);
    const { data: f } = await sb().auth.mfa.listFactors(); setFactors(f?.totp || []);
  }

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

  async function invite(e) {
    e.preventDefault();
    setTErr(""); setTMsg("");
    if (!invEmail.trim()) { setTErr("Enter an email address."); return; }
    setTBusy(true);
    const { data: sess } = await sb().auth.getSession();
    const jwt = sess.session?.access_token;
    try {
      const r = await fetch(`${FN_BASE}/fs-admin`, {
        method: "POST",
        headers: { "Content-Type": "application/json", Authorization: `Bearer ${jwt}` },
        body: JSON.stringify({ action: "invite", org_id: org.id, email: invEmail.trim(), role: invRole }),
      });
      const j = await r.json();
      if (!r.ok) { setTErr(j.error || "Could not send the invite."); }
      else {
        setTMsg(j.invited
          ? `Invite email sent to ${j.email} — they'll set a password and land in your organisation as ${j.role}.`
          : `${j.email} already had an account — added to your organisation as ${j.role}.`);
        setInvEmail("");
        loadTeam(org.id);
      }
    } catch { setTErr("Could not send the invite."); }
    setTBusy(false);
  }

  async function removeMember(userId) {
    setTErr(""); setTMsg(""); setTBusy(true);
    const { data: sess } = await sb().auth.getSession();
    const jwt = sess.session?.access_token;
    try {
      const r = await fetch(`${FN_BASE}/fs-admin`, {
        method: "POST",
        headers: { "Content-Type": "application/json", Authorization: `Bearer ${jwt}` },
        body: JSON.stringify({ action: "remove", org_id: org.id, user_id: userId }),
      });
      const j = await r.json();
      if (!r.ok) setTErr(j.error || "Could not remove this member.");
      else loadTeam(org.id);
    } catch { setTErr("Could not remove this member."); }
    setTBusy(false);
  }

  if (!user) return <p className="muted">Loading…</p>;
  return (
    <Shell active="settings" user={user}>
      <h1>Settings</h1>
      <p className="muted small">{org ? <>Organisation: <b>{org.name}</b> · your role: <b>{role}</b></> : "Not linked to an organisation yet."}</p>

      {(role === "owner" || role === "manager") && org ? (
        <div className="card" style={{ maxWidth: 640 }}>
          <h2>Team</h2>
          {tErr ? <div className="err">{tErr}</div> : null}
          {tMsg ? <div className="ok">{tMsg}</div> : null}
          {!members ? <p className="muted small">Loading team…</p> : (
            <table className="t">
              <thead><tr><th>Member</th><th>Role</th><th></th></tr></thead>
              <tbody>
                {members.map((m) => (
                  <tr key={m.user_id}>
                    <td className="small">{m.email || m.user_id}{m.you ? <span className="pill teal" style={{ marginLeft: 8 }}>you</span> : null}</td>
                    <td className="small" title={ROLE_HELP[m.role] || ""}><span className="pill draft">{m.role}</span></td>
                    <td style={{ textAlign: "right" }}>
                      {role === "owner" && !m.you ? (
                        <button className="btn btn-ghost btn-sm" disabled={tBusy} onClick={() => removeMember(m.user_id)}>Remove</button>
                      ) : null}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
          {role === "owner" ? (
            <form onSubmit={invite} style={{ marginTop: 14 }}>
              <label className="f">Invite a teammate</label>
              <div style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>
                <input type="email" value={invEmail} onChange={(e) => setInvEmail(e.target.value)}
                  placeholder="colleague@company.com" style={{ flex: 1, minWidth: 220 }} />
                <select value={invRole} onChange={(e) => setInvRole(e.target.value)} style={{ width: "auto" }}>
                  {["manager", "analyst", "viewer", "owner"].map((r) => <option key={r} value={r}>{r}</option>)}
                </select>
                <button className="btn btn-primary btn-sm" disabled={tBusy}>{tBusy ? "Working…" : "Invite"}</button>
              </div>
              <p className="small muted" style={{ marginTop: 8 }}>
                {ROLE_HELP[invRole]}. New addresses get an email invitation to set a password;
                existing accounts are added immediately.
              </p>
            </form>
          ) : (
            <p className="small muted" style={{ marginTop: 10 }}>Only the organisation owner can invite or remove teammates.</p>
          )}
        </div>
      ) : null}

      <div className="card" style={{ maxWidth: 560 }}>
        <h2>Two-factor authentication</h2>
        {(role === "owner" || role === "manager") && factors && !factors.some((f) => f.status === "verified") ? (
          <div className="err">Your role can manage campaigns and respondent data — please enable two-factor authentication now.</div>
        ) : null}
        {mfaMsg ? <div className={mfaMsg.includes("✓") ? "ok" : "err"}>{mfaMsg}</div> : null}
        {factors === null ? <p className="muted small">Loading…</p> : factors.some((f) => f.status === "verified") ? (
          <>
            <p className="small">✓ Enabled — a code from your authenticator app is required at sign-in.</p>
            {factors.map((f) => (
              <p key={f.id} className="small muted">{f.friendly_name || "Authenticator"} · added {new Date(f.created_at).toLocaleDateString()}{" "}
                <button className="btn btn-ghost btn-sm" onClick={() => removeFactor(f.id)}>Remove</button></p>
            ))}
          </>
        ) : enroll ? (
          <>
            <p className="small">Scan this QR code with Google Authenticator, Microsoft Authenticator or 1Password, then enter the 6-digit code:</p>
            {/* eslint-disable-next-line @next/next/no-img-element */}
            <img src={enroll.qr} alt="TOTP enrolment QR code" style={{ width: 180, height: 180, background: "#fff", padding: 8, borderRadius: 10 }} />
            <p className="small muted">Can&apos;t scan? Manual key: <code style={{ fontSize: 12 }}>{enroll.secret}</code></p>
            <div style={{ display: "flex", gap: 8, maxWidth: 340 }}>
              <input type="text" inputMode="numeric" value={mfaCode} onChange={(e) => setMfaCode(e.target.value)} placeholder="123456" />
              <button className="btn btn-primary btn-sm" onClick={confirmEnroll}>Activate</button>
            </div>
          </>
        ) : (
          <>
            <p className="small muted">Protect your account with a 6-digit code from an authenticator app, required at every sign-in.</p>
            <button className="btn btn-primary btn-sm" onClick={startEnroll}>Enable two-factor authentication</button>
          </>
        )}
      </div>

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
      <p className="small muted">Questions about your data? See the <a href="/privacy" target="_blank">privacy notice</a>.</p>
    </Shell>
  );
}
