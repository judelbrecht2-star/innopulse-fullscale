"use client";
import { useCallback, useEffect, useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { sb } from "../../lib/supabase";
import { Shell, I, GROUP_META, groupName } from "../ui";

function randToken() {
  const b = new Uint8Array(8); crypto.getRandomValues(b);
  return Array.from(b, (x) => x.toString(16).padStart(2, "0")).join("");
}
function ago(ts) {
  const m = Math.round((Date.now() - new Date(ts).getTime()) / 60000);
  if (m < 1) return "just now"; if (m < 60) return `${m} min ago`;
  const h = Math.round(m / 60); if (h < 24) return `${h} h ago`;
  return `${Math.round(h / 24)} d ago`;
}

export default function Campaigns() {
  const router = useRouter();
  const [user, setUser] = useState(null);
  const [role, setRole] = useState("");
  const [camps, setCamps] = useState([]);
  const [groups, setGroups] = useState([]);
  const [links, setLinks] = useState([]);
  const [resps, setResps] = useState([]);
  const [vers, setVers] = useState({});
  const [err, setErr] = useState("");
  const [busy, setBusy] = useState(false);
  const [q, setQ] = useState("");
  const [fStatus, setFStatus] = useState("active");
  const [sort, setSort] = useState("newest");

  const load = useCallback(async () => {
    const { data: u } = await sb().auth.getUser();
    if (!u.user) { router.replace("/login"); return; }
    setUser(u.user);
    const { data: mem } = await sb().from("fs_memberships").select("role").eq("user_id", u.user.id).limit(1).maybeSingle();
    setRole(mem?.role || "");
    const [{ data: cs }, { data: gs }, { data: ls }, { data: rs }, { data: vs }] = await Promise.all([
      sb().from("fs_campaigns").select("id, org_id, name, status, opens_at, closes_at, anonymity_threshold, questionnaire_version_id, created_by, created_at").order("created_at", { ascending: false }),
      sb().from("fs_groups").select("id, campaign_id, type, label, target_n"),
      sb().from("fs_links").select("id, campaign_id, mode, active"),
      sb().from("fs_responses").select("id, campaign_id, group_id, submitted_at, valid"),
      sb().from("fs_questionnaire_versions").select("id, version"),
    ]);
    setCamps(cs || []); setGroups(gs || []); setLinks(ls || []); setResps(rs || []);
    setVers(Object.fromEntries((vs || []).map((v) => [v.id, v.version])));
  }, [router]);
  useEffect(() => { load(); }, [load]);

  const canManage = role === "owner" || role === "manager";

  function stats(c) {
    const gs = groups.filter((g) => g.campaign_id === c.id);
    const ls = links.filter((l) => l.campaign_id === c.id);
    const rs = resps.filter((r) => r.campaign_id === c.id && r.valid);
    const target = gs.reduce((s, g) => s + (g.target_n || 0), 0);
    const n = rs.length;
    const covered = gs.filter((g) => rs.filter((r) => r.group_id === g.id).length >= (c.anonymity_threshold || 5)).length;
    const last = rs.length ? rs.reduce((a, b) => (a.submitted_at > b.submitted_at ? a : b)).submitted_at : null;
    const daysLeft = c.closes_at ? Math.ceil((new Date(c.closes_at) - Date.now()) / 86400000) : null;
    const scheduled = c.status === "open" && c.opens_at && new Date(c.opens_at) > new Date();
    const pct = target ? Math.round((n / target) * 100) : 0;
    const warns = [];
    if (c.status === "open") {
      if (!gs.length) warns.push("Setup incomplete — no stakeholder groups");
      else if (!ls.some((l) => l.active)) warns.push("Setup incomplete — no active links");
      else if (!target) warns.push("Setup incomplete — no participation targets");
      if (target && pct < 50 && n > 0) warns.push("Low participation");
      if (gs.length && covered === 0 && n > 0) warns.push("No group past the privacy threshold yet");
      if (daysLeft != null && daysLeft <= 7 && daysLeft >= 0) warns.push(`Closing in ${daysLeft} day${daysLeft === 1 ? "" : "s"}`);
      if (daysLeft != null && daysLeft < 0) warns.push("Past close date — still open");
      if (last && Date.now() - new Date(last).getTime() > 72 * 3600000) warns.push("No responses in 3+ days");
      if (n === 0 && !scheduled) warns.push("No responses received yet");
    }
    return { gs, n, target, pct, covered, last, daysLeft, scheduled, warns };
  }

  const enriched = camps.map((c) => ({ c, s: stats(c) }));
  const filtered = enriched.filter(({ c }) => {
    if (fStatus === "active" && c.status === "archived") return false;
    if (["draft", "open", "closed", "archived"].includes(fStatus) && c.status !== fStatus) return false;
    if (q.trim() && !(c.name + " " + (vers[c.questionnaire_version_id] || "")).toLowerCase().includes(q.trim().toLowerCase())) return false;
    return true;
  }).sort((a, b) => {
    if (sort === "closing") return (a.s.daysLeft ?? 9e9) - (b.s.daysLeft ?? 9e9);
    if (sort === "activity") return new Date(b.s.last || 0) - new Date(a.s.last || 0);
    return new Date(b.c.created_at) - new Date(a.c.created_at);
  });

  const open = enriched.filter(({ c }) => c.status === "open").length;
  const drafts = enriched.filter(({ c }) => c.status === "draft").length;
  const totalResp = enriched.reduce((s, e) => s + e.s.n, 0);
  const avgPct = (() => { const w = enriched.filter((e) => e.c.status === "open" && e.s.target); return w.length ? Math.round(w.reduce((s, e) => s + e.s.pct, 0) / w.length) : 0; })();
  const closingSoon = enriched.filter((e) => e.c.status === "open" && e.s.daysLeft != null && e.s.daysLeft <= 7 && e.s.daysLeft >= 0).length;
  const attention = enriched.filter((e) => e.s.warns.length).length;

  async function setStatus(id, status) {
    setBusy(true);
    const { error } = await sb().from("fs_campaigns").update({ status }).eq("id", id);
    setBusy(false); if (error) setErr(error.message); else load();
  }
  async function duplicate(c) {
    setBusy(true); setErr("");
    try {
      const { data: created, error: e2 } = await sb().from("fs_campaigns").insert({
        org_id: c.org_id,
        name: c.name.replace(/\s*—\s*next cycle.*$/, "") + " — next cycle",
        status: "draft", questionnaire_version_id: c.questionnaire_version_id,
        anonymity_threshold: c.anonymity_threshold, created_by: user.id,
      }).select("id").single();
      if (e2 || !created) throw new Error(e2?.message || "Could not duplicate.");
      const gs = groups.filter((g) => g.campaign_id === c.id);
      if (gs.length) {
        const { data: ng, error: e3 } = await sb().from("fs_groups").insert(
          gs.map((g) => ({ campaign_id: created.id, type: g.type, label: g.label, target_n: g.target_n }))
        ).select("id");
        if (e3) throw new Error(e3.message);
        await sb().from("fs_links").insert((ng || []).map((g) => ({ campaign_id: created.id, group_id: g.id, token: randToken(), mode: "group" })));
      }
      router.push(`/campaigns/${created.id}`);
      return;
    } catch (ex) { setErr(String(ex.message || ex)); }
    setBusy(false);
  }

  const stChip = (c, s) => {
    if (c.status === "draft") return <span className="pill draft">Draft</span>;
    if (c.status === "archived") return <span className="pill closed">Archived</span>;
    if (c.status === "closed") return <span className="pill closed">Closed · reporting</span>;
    if (s.scheduled) return <span className="pill teal">Scheduled</span>;
    return <span className="pill open">Open</span>;
  };

  return (
    <Shell active="campaigns" user={user}>
      <div className="crumbs"><b>Campaigns</b></div>
      <div className="pagehead">
        <div>
          <h1>Campaigns</h1>
          <p className="lead">Each campaign collects one assessment cycle across your stakeholder groups.</p>
        </div>
        {canManage ? <Link className="btn btn-primary" href="/campaigns/new"><I.plus style={{ width: 16, height: 16, stroke: "#fff" }} /> New campaign</Link> : null}
      </div>
      {err ? <div className="err">{err}</div> : null}

      <div className="stats">
        <div className="stat"><span className="ic c-green"><I.rocket /></span><div><div className="k">Active campaigns</div><div className="v">{open}</div></div></div>
        <div className="stat"><span className="ic c-grey"><I.doc /></span><div><div className="k">Drafts</div><div className="v">{drafts}</div></div></div>
        <div className="stat"><span className="ic c-teal"><I.people /></span><div><div className="k">Responses collected</div><div className="v">{totalResp}</div></div></div>
        <div className="stat"><span className="ic c-amber"><I.pie /></span><div><div className="k">Avg completion</div><div className="v">{avgPct}%</div></div></div>
        <div className="stat"><span className="ic c-blue"><I.info /></span><div><div className="k">Closing soon</div><div className="v">{closingSoon}</div></div></div>
        <div className="stat"><span className="ic c-red"><I.info /></span><div><div className="k">Needing attention</div><div className="v">{attention}</div></div></div>
      </div>

      <div className="card" style={{ display: "flex", gap: 10, flexWrap: "wrap", alignItems: "center" }}>
        <input type="text" placeholder="Search campaigns" value={q} onChange={(e) => setQ(e.target.value)} style={{ flex: 1, minWidth: 200 }} />
        <select value={fStatus} onChange={(e) => setFStatus(e.target.value)} style={{ width: "auto" }}>
          <option value="active">All except archived</option><option value="open">Open</option>
          <option value="draft">Draft</option><option value="closed">Closed</option><option value="archived">Archived</option>
        </select>
        <select value={sort} onChange={(e) => setSort(e.target.value)} style={{ width: "auto" }}>
          <option value="newest">Newest first</option><option value="closing">Closing soon</option><option value="activity">Recent activity</option>
        </select>
      </div>

      {!filtered.length ? (
        <div className="card"><p className="muted">No campaigns match. {canManage ? <Link href="/campaigns/new">Create one →</Link> : null}</p></div>
      ) : filtered.map(({ c, s }) => (
        <div className="card" key={c.id}>
          <div style={{ display: "flex", justifyContent: "space-between", gap: 12, flexWrap: "wrap", alignItems: "flex-start" }}>
            <div style={{ minWidth: 240, flex: 1 }}>
              <div style={{ display: "flex", gap: 10, alignItems: "center", flexWrap: "wrap" }}>
                <Link href={`/campaigns/${c.id}`} style={{ fontWeight: 800, fontSize: 17 }}>{c.name}</Link>
                {stChip(c, s)}
              </div>
              <p className="small muted" style={{ margin: "4px 0 0" }}>
                InnoPulse v{(vers[c.questionnaire_version_id] || "?").replace("-draft", " (draft)")}
                {c.created_by === user?.id ? " · Owner: you" : ""}
                {" · privacy threshold "}{c.anonymity_threshold}
              </p>
            </div>
            <div style={{ display: "flex", gap: 8, flexWrap: "wrap", alignItems: "center" }}>
              <Link className="btn btn-primary btn-sm" href={`/campaigns/${c.id}`}>View campaign</Link>
              <button className="btn btn-ghost btn-sm" disabled title="Email reminders arrive with the notifications build">✈ Send reminders</button>
              <details className="rowmenu">
                <summary className="iconbtn" style={{ fontWeight: 800 }}>⋯</summary>
                <div className="dd">
                  <button onClick={() => router.push(`/campaigns/${c.id}`)}>Manage links</button>
                  <button onClick={() => router.push("/responses")}>View responses</button>
                  <button onClick={() => router.push("/insights")}>View insights</button>
                  <button onClick={() => router.push(`/campaigns/${c.id}/report`)}>Export / report</button>
                  {canManage ? (
                    <>
                      {c.status === "open" ? <button disabled={busy} onClick={() => setStatus(c.id, "closed")}>Close collection</button> : null}
                      {c.status === "closed" || c.status === "draft" ? <button disabled={busy} onClick={() => setStatus(c.id, "open")}>Open collection</button> : null}
                      <button disabled={busy} onClick={() => duplicate(c)}>Duplicate for next cycle</button>
                      {c.status !== "archived"
                        ? <button disabled={busy} onClick={() => setStatus(c.id, "archived")}>Archive</button>
                        : <button disabled={busy} onClick={() => setStatus(c.id, "closed")}>Unarchive</button>}
                    </>
                  ) : null}
                </div>
              </details>
            </div>
          </div>

          <div style={{ display: "flex", gap: 22, flexWrap: "wrap", alignItems: "center", margin: "12px 0 0" }}>
            <span className="small"><b>{s.n} / {s.target || "—"}</b> responses</span>
            <span style={{ display: "inline-block", width: 130, height: 7, background: "#e8e8ec", borderRadius: 99, overflow: "hidden" }}>
              <i style={{ display: "block", height: "100%", width: Math.min(100, s.pct) + "%", background: s.pct < 50 ? "var(--amber, #b7791f)" : "var(--teal)", borderRadius: 99 }} />
            </span>
            <span className="small">{s.pct}% complete</span>
            <span className="small">{s.covered} / {s.gs.length} group{s.gs.length === 1 ? "" : "s"} past threshold</span>
            <span className="small" style={{ display: "inline-flex", gap: 4 }}>
              {s.gs.slice(0, 6).map((g) => (
                <span key={g.id} className={"chip " + (GROUP_META[g.type]?.chip || "c-grey")} title={groupName(g)}
                  style={{ width: 22, height: 22, fontSize: 10, display: "inline-flex", alignItems: "center", justifyContent: "center", borderRadius: "50%" }}>
                  {groupName(g).slice(0, 1)}
                </span>
              ))}
            </span>
            {s.daysLeft != null && c.status === "open" ? <span className="small muted">{s.daysLeft >= 0 ? `${s.daysLeft} days left` : "window ended"}</span> : null}
            <span className="small muted">{s.last ? `last response ${ago(s.last)}` : "no responses yet"}</span>
          </div>

          {s.warns.length ? (
            <p className="small" style={{ margin: "10px 0 0", color: "var(--amber, #b7791f)" }}>⚠ {s.warns.join(" · ")}</p>
          ) : null}
        </div>
      ))}
    </Shell>
  );
}
