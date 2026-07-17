"use client";
import { useCallback, useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { sb, FN_BASE } from "../../lib/supabase";
import { Shell, I, GROUP_META, GROUP_BAR, groupName } from "../ui";

const PILLAR_NAMES = { sii: "Strategic intent", iem: "Environment", oic: "Capability", ipm: "Process", roi: "Return on innovation" };
function csvEsc(v) { const s = String(v ?? ""); return /[",\n]/.test(s) ? '"' + s.replace(/"/g, '""') + '"' : s; }
function ago(ts) {
  const m = Math.round((Date.now() - new Date(ts).getTime()) / 60000);
  if (m < 1) return "just now";
  if (m < 60) return `${m} min ago`;
  const h = Math.round(m / 60);
  if (h < 24) return `${h} h ago`;
  return new Date(ts).toLocaleDateString();
}
function fmt(ts) { return new Date(ts).toLocaleString(undefined, { day: "numeric", month: "short", hour: "2-digit", minute: "2-digit" }); }

export default function Responses() {
  const router = useRouter();
  const [user, setUser] = useState(null);
  const [role, setRole] = useState("");
  const [campaigns, setCampaigns] = useState([]);
  const [sel, setSel] = useState("");
  const [campaign, setCampaign] = useState(null);
  const [groups, setGroups] = useState([]);
  const [links, setLinks] = useState([]);
  const [resps, setResps] = useState([]);
  const [aggs, setAggs] = useState({});       // response_id -> {answered, dk}
  const [comms, setComms] = useState({});     // response_id -> [{pillar, body}]
  const [progress, setProgress] = useState([]);
  const [err, setErr] = useState("");
  const [busy, setBusy] = useState(false);
  const [copied, setCopied] = useState("");
  // filters
  const [q, setQ] = useState("");
  const [fGroup, setFGroup] = useState("all");
  const [fStatus, setFStatus] = useState("all");
  const [fQuality, setFQuality] = useState("all");
  const [fComments, setFComments] = useState(false);
  // reminders
  const [remOpen, setRemOpen] = useState(false);
  const [remGroup, setRemGroup] = useState("");
  const [remEmails, setRemEmails] = useState("");
  const [remMsg, setRemMsg] = useState("");
  const [remState, setRemState] = useState("");
  // selection + drawer
  const [checks, setChecks] = useState({});
  const [drawer, setDrawer] = useState(null); // row object
  const [detail, setDetail] = useState(null); // pillar breakdown for drawer

  const [servedTotals, setServedTotals] = useState({}); // group type -> served question count

  useEffect(() => {
    (async () => {
      const { data: u } = await sb().auth.getUser();
      if (!u.user) { router.replace("/login"); return; }
      setUser(u.user);
      const { data: cs } = await sb().from("fs_campaigns")
        .select("id, org_id, name, status, anonymity_threshold, questionnaire_version_id, created_at").order("created_at", { ascending: false });
      setCampaigns(cs || []);
      const target = (cs || []).find((c) => c.status === "open") || (cs || [])[0];
      if (target) setSel(target.id);
    })();
  }, [router]);

  const load = useCallback(async (cid) => {
    if (!cid) return;
    setErr(""); setChecks({}); setDrawer(null);
    const c = campaigns.find((x) => x.id === cid) || null;
    setCampaign(c);
    // F8: the caller's OWN role in THIS campaign's org
    if (c?.org_id) {
      const { data: uu } = await sb().auth.getUser();
      const { data: mem } = uu?.user
        ? await sb().from("fs_memberships").select("role").eq("org_id", c.org_id).eq("user_id", uu.user.id).maybeSingle()
        : { data: null };
      setRole(mem?.role || "");
    }
    const [{ data: gs }, { data: ls }, { data: rs }, { data: pg }, { data: qv }] = await Promise.all([
      sb().from("fs_groups").select("id, type, label, target_n").eq("campaign_id", cid),
      sb().from("fs_links").select("id, group_id, token, mode, active, used_count, created_at").eq("campaign_id", cid),
      sb().from("fs_responses").select("id, group_id, link_id, submitted_at, valid, flag").eq("campaign_id", cid).order("submitted_at"),
      sb().from("fs_progress").select("id, group_id, link_id, client_ref, answered, total, started_at, last_seen").eq("campaign_id", cid).order("started_at"),
      c?.questionnaire_version_id
        ? sb().from("fs_questionnaire_versions").select("definition").eq("id", c.questionnaire_version_id).maybeSingle()
        : Promise.resolve({ data: null }),
    ]);
    setGroups(gs || []); setLinks(ls || []); setResps(rs || []); setProgress(pg || []);

    // F10: true served-questionnaire length per group type
    const totals = {};
    const def = qv?.definition;
    if (def?.pillars) {
      for (const t of ["executive", "employee", "customer", "partner", "other"]) {
        totals[t] = def.pillars.reduce((s, p) => s + p.questions.filter((q) => !q.groups || q.groups.includes(t)).length, 0);
      }
    }
    setServedTotals(totals);

    // Gate 1: response aggregates come from the server endpoint, which enforces
    // role + anonymity threshold. Raw answers/comments are no longer readable
    // from the browser at all.
    try {
      const { data: sess } = await sb().auth.getSession();
      const r = await fetch(`${FN_BASE}/fs-responses-ops`, {
        method: "POST",
        headers: { "Content-Type": "application/json", Authorization: `Bearer ${sess.session?.access_token}` },
        body: JSON.stringify({ action: "list", campaign_id: cid }),
      });
      if (r.ok) {
        const j = await r.json();
        const a = {}, cmap = {};
        for (const row of j.responses || []) {
          a[row.id] = row.agg || { answered: 0, dk: 0 };
          if (row.nComments) cmap[row.id] = Array.from({ length: row.nComments }, () => ({}));
        }
        setAggs(a); setComms(cmap);
      } else { setAggs({}); setComms({}); }
    } catch { setAggs({}); setComms({}); }
  }, [campaigns]);

  useEffect(() => { load(sel); }, [sel, load]);

  const canManage = role === "owner" || role === "manager";
  const groupById = Object.fromEntries(groups.map((g) => [g.id, g]));
  const threshold = campaign?.anonymity_threshold ?? 5;

  // ----- build unified rows -----
  const rows = [];
  resps.forEach((r, i) => {
    const agg = aggs[r.id] || { answered: 0, dk: 0 };
    const dkPct = agg.answered ? Math.round((agg.dk / agg.answered) * 100) : 0;
    const quality = r.flag === "review" ? "Review" : r.flag === "test" ? "Test" : dkPct > 30 ? "Review" : "Good";
    const status = !r.valid ? (r.flag === "test" ? "Test" : "Excluded") : "Completed";
    const g = groupById[r.group_id];
    rows.push({
      kind: "response", id: r.id, r,
      ref: `Anonymous #${String(i + 1).padStart(3, "0")}`,
      group: g, status, quality, dkPct,
      answered: agg.answered,
      total: servedTotals[g?.type] || agg.answered, // F10: measured against the real served set
      nComments: (comms[r.id] || []).length,
      when: r.submitted_at, whenLabel: fmt(r.submitted_at),
    });
  });
  progress.forEach((p, i) => {
    const stale = Date.now() - new Date(p.last_seen).getTime() > 24 * 3600 * 1000;
    rows.push({
      kind: "progress", id: "pg_" + p.id,
      ref: `In progress #${String(i + 1).padStart(2, "0")}`,
      group: groupById[p.group_id], status: stale ? "Abandoned" : "In progress",
      quality: null, dkPct: null, answered: p.answered, total: p.total || 0, nComments: 0,
      when: p.last_seen, whenLabel: `Updated ${ago(p.last_seen)}`,
    });
  });
  links.filter((l) => l.mode === "unique" && l.active && l.used_count === 0).forEach((l) => {
    rows.push({
      kind: "invite", id: "lk_" + l.id,
      ref: `Invite •${l.token.slice(-4)}`,
      group: groupById[l.group_id], status: "Not started",
      quality: null, dkPct: null, answered: 0, total: 0, nComments: 0,
      when: l.created_at, whenLabel: `Sent ${ago(l.created_at)}`,
    });
  });

  // ----- filters -----
  const filtered = rows.filter((row) => {
    if (fGroup !== "all" && row.group?.id !== fGroup) return false;
    if (fStatus !== "all" && row.status !== fStatus) return false;
    if (fQuality !== "all" && row.quality !== fQuality) return false;
    if (fComments && !row.nComments) return false;
    if (q.trim()) {
      // comment-body search removed: verbatims no longer reach the browser in bulk (Gate 1)
      if (!row.ref.toLowerCase().includes(q.trim().toLowerCase())) return false;
    }
    return true;
  });

  // ----- stats -----
  const invited = groups.reduce((s, g) => s + (g.target_n || 0), 0);
  const completed = resps.filter((r) => r.valid).length;
  const inProg = progress.filter((p) => Date.now() - new Date(p.last_seen).getTime() <= 24 * 3600 * 1000).length;
  const completion = invited ? Math.round((completed / invited) * 100) : 0;
  const outstanding = Math.max(0, invited - completed);
  const flagged = rows.filter((r) => r.quality === "Review" || r.status === "Excluded" || r.status === "Test").length;
  const lastResp = resps.length ? resps[resps.length - 1].submitted_at : null;

  // ----- actions -----
  async function setRespState(ids, patch) {
    setBusy(true);
    const { error } = await sb().from("fs_responses").update(patch).in("id", ids);
    if (error) setErr(error.message);
    setBusy(false); setChecks({});
    await load(sel);
  }
  const checkedIds = Object.keys(checks).filter((k) => checks[k]);
  async function copyLink(token) {
    try { await navigator.clipboard.writeText(`${window.location.origin}/respond/${token}`); setCopied(token); setTimeout(() => setCopied(""), 1500); } catch {}
  }
  function exportCsv(onlySelected) {
    const src = onlySelected ? filtered.filter((r) => checks[r.id]) : filtered;
    const out = [["Reference", "Group", "Status", "Progress", "Don't know / N-A %", "Quality", "Comments", "When"]];
    src.forEach((r) => out.push([r.ref, groupName(r.group), r.status, `${r.answered}/${r.total || "—"}`, r.dkPct ?? "", r.quality ?? "", r.nComments, r.whenLabel]));
    const csv = out.map((r) => r.map(csvEsc).join(",")).join("\r\n");
    const blob = new Blob(["﻿" + csv], { type: "text/csv;charset=utf-8" });
    const a = document.createElement("a");
    a.href = URL.createObjectURL(blob);
    a.download = `${(campaign?.name || "campaign").replace(/[^\w]+/g, "-")}-responses.csv`;
    a.click();
  }
  async function openDrawer(row) {
    if (row.kind !== "response") return;
    setDrawer(row); setDetail(null);
    try {
      const { data: sess } = await sb().auth.getSession();
      const r = await fetch(`${FN_BASE}/fs-responses-ops`, {
        method: "POST",
        headers: { "Content-Type": "application/json", Authorization: `Bearer ${sess.session?.access_token}` },
        body: JSON.stringify({ action: "detail", campaign_id: sel, response_id: row.id }),
      });
      setDetail(r.ok ? await r.json() : { error: true });
    } catch { setDetail({ error: true }); }
  }

  const statusPill = (s) => s === "Completed" ? "open" : s === "In progress" ? "teal" : s === "Not started" ? "closed" : s === "Excluded" ? "closed" : s === "Test" ? "violet" : "draft";

  return (
    <Shell active="responses" user={user}>
      <div className="crumbs">Responses / <b>{campaign?.name || "—"}</b></div>
      <div className="pagehead">
        <div>
          <h1>Responses</h1>
          <p className="lead">Monitor participation, review data quality and read written feedback from each stakeholder group.</p>
        </div>
        <div style={{ display: "flex", gap: 10, flexWrap: "wrap" }}>
          <button className="btn btn-ghost" onClick={() => exportCsv(false)}>⭱ Export responses</button>
          <button className="btn btn-primary" disabled={!canManage} title={canManage ? "" : "Owners and managers only"}
            onClick={() => { setRemOpen((v) => !v); if (!remGroup && groups.length) setRemGroup(groups[0].id); }}>✈ Send reminders</button>
          <select value={sel} onChange={(e) => setSel(e.target.value)} style={{ width: "auto", fontWeight: 600 }}>
            {campaigns.map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}
          </select>
        </div>
      </div>
      {err ? <div className="err">{err}</div> : null}

      <div className="stats">
        <div className="stat"><span className="ic c-red"><I.people /></span><div><div className="k">Invited (targets)</div><div className="v">{invited}</div></div></div>
        <div className="stat"><span className="ic c-green"><I.shield /></span><div><div className="k">Completed</div><div className="v">{completed}</div></div></div>
        <div className="stat"><span className="ic c-teal"><I.chat /></span><div><div className="k">In progress</div><div className="v">{inProg}</div></div></div>
        <div className="stat"><span className="ic c-amber"><I.pie /></span><div><div className="k">Completion rate</div><div className="v">{completion}%</div></div></div>
        <div className="stat"><span className="ic c-grey"><I.doc /></span><div><div className="k">Outstanding</div><div className="v">{outstanding}</div></div></div>
        <div className="stat"><span className="ic c-violet"><I.info /></span><div><div className="k">Flagged</div><div className="v">{flagged}</div>{lastResp ? <span className="small muted">last response {ago(lastResp)}</span> : null}</div></div>
      </div>

      {remOpen ? (
        <div className="card" style={{ border: "1.5px solid var(--primary)" }}>
          <h2>Send reminder emails</h2>
          <p className="small muted" style={{ margin: "2px 0 10px" }}>
            Recipients get the group&apos;s signed link. Addresses are used for delivery only —
            they are never stored or connected to responses.
          </p>
          <div style={{ display: "flex", gap: 10, flexWrap: "wrap", marginBottom: 8 }}>
            <select value={remGroup} onChange={(e) => setRemGroup(e.target.value)} style={{ width: "auto" }}>
              {groups.map((g) => <option key={g.id} value={g.id}>{groupName(g)}</option>)}
            </select>
          </div>
          <label className="f">Email addresses <span className="muted">(comma or new-line separated, max 100)</span></label>
          <textarea value={remEmails} onChange={(e) => setRemEmails(e.target.value)} placeholder="ana@company.com, ben@company.com" />
          <label className="f">Personal note <span className="muted">(optional)</span></label>
          <textarea value={remMsg} onChange={(e) => setRemMsg(e.target.value)} placeholder="A short line from you, shown in the email." />
          {remState ? <p className="small" style={{ color: remState.startsWith("Sent") ? "var(--green, #2f855a)" : "var(--primary)" }}>{remState}</p> : null}
          <div style={{ display: "flex", gap: 8, marginTop: 8 }}>
            <button className="btn btn-primary btn-sm" disabled={busy} onClick={async () => {
              const emails = remEmails.split(/[\s,;]+/).map((x) => x.trim()).filter(Boolean);
              if (!emails.length) { setRemState("Enter at least one email address."); return; }
              setBusy(true); setRemState("Sending…");
              try {
                const { data: sess } = await sb().auth.getSession();
                const r = await fetch(`${FN_BASE}/fs-notify`, {
                  method: "POST",
                  headers: { "Content-Type": "application/json", Authorization: `Bearer ${sess.session?.access_token}` },
                  body: JSON.stringify({ campaign_id: sel, group_id: remGroup, emails, message: remMsg }),
                });
                const j = await r.json();
                setRemState(r.ok ? `Sent ${j.sent} reminder${j.sent === 1 ? "" : "s"} ✓` : (j.error || "Could not send."));
                if (r.ok) setRemEmails("");
              } catch { setRemState("Could not send — network problem."); }
              setBusy(false);
            }}>Send</button>
            <button className="btn btn-ghost btn-sm" onClick={() => { setRemOpen(false); setRemState(""); }}>Close</button>
          </div>
        </div>
      ) : null}

      <div className="card">
        <h2>Stakeholder coverage</h2>
        {groups.map((g) => {
          const n = resps.filter((r) => r.valid && r.group_id === g.id).length;
          const pct = g.target_n ? Math.min(100, Math.round((n / g.target_n) * 100)) : 0;
          const meta = GROUP_META[g.type] || { chip: "c-grey", icon: "people" };
          const Icon = I[meta.icon] || I.people;
          const link = links.find((l) => l.group_id === g.id && l.mode === "group" && l.active);
          const lastForGroup = [...resps].reverse().find((r) => r.group_id === g.id);
          return (
            <div className="covrow" key={g.id}>
              <span className="nm"><span className={"chip " + meta.chip} style={{ width: 34, height: 34, flex: "0 0 34px" }}><Icon style={{ width: 16, height: 16 }} /></span>{groupName(g)}</span>
              <span className="frac">{n} / {g.target_n || "—"}</span>
              <span className="bar"><i style={{ width: pct + "%", background: GROUP_BAR[g.type] || "var(--primary)" }} /></span>
              <span className="pct">{pct}%</span>
              {n < threshold ? <span className="privnote">🔒 hidden until {threshold} completed</span> : <span className="privnote" style={{ visibility: "hidden" }}>ok</span>}
              <span className="small muted" style={{ width: 110 }}>{lastForGroup ? `last ${ago(lastForGroup.submitted_at)}` : "no responses yet"}</span>
              {link ? (
                <button className="btn btn-ghost btn-sm" onClick={() => copyLink(link.token)}>{copied === link.token ? "Copied ✓" : "Copy link"}</button>
              ) : <span className="small muted">no active link</span>}
            </div>
          );
        })}
      </div>

      <div className="card">
        <div style={{ display: "flex", gap: 10, flexWrap: "wrap", marginBottom: 12 }}>
          <input type="text" placeholder="Search response reference or written feedback" value={q}
            onChange={(e) => setQ(e.target.value)} style={{ flex: 1, minWidth: 220 }} />
          <select value={fGroup} onChange={(e) => setFGroup(e.target.value)} style={{ width: "auto" }}>
            <option value="all">All groups</option>
            {groups.map((g) => <option key={g.id} value={g.id}>{groupName(g)}</option>)}
          </select>
          <select value={fStatus} onChange={(e) => setFStatus(e.target.value)} style={{ width: "auto" }}>
            {["all", "Completed", "In progress", "Not started", "Abandoned", "Excluded", "Test"].map((s) => (
              <option key={s} value={s}>{s === "all" ? "All statuses" : s}</option>
            ))}
          </select>
          <select value={fQuality} onChange={(e) => setFQuality(e.target.value)} style={{ width: "auto" }}>
            {["all", "Good", "Review", "Test"].map((s) => <option key={s} value={s}>{s === "all" ? "Data quality" : s}</option>)}
          </select>
          <label className="small" style={{ display: "flex", alignItems: "center", gap: 7 }}>
            <input type="checkbox" checked={fComments} onChange={(e) => setFComments(e.target.checked)} /> Has written responses
          </label>
        </div>

        <table className="t">
          <thead>
            <tr>
              <th style={{ width: 30 }}></th>
              <th>Respondent</th><th>Group</th><th>Status</th><th>Progress</th>
              <th>Written</th><th>DK/NA</th><th>Quality</th><th>When</th>
            </tr>
          </thead>
          <tbody>
            {filtered.length === 0 ? (
              <tr><td colSpan={9} className="muted small">No responses match these filters yet.</td></tr>
            ) : filtered.map((row) => (
              <tr key={row.id} style={{ cursor: row.kind === "response" ? "pointer" : "default", background: drawer?.id === row.id ? "var(--primary-soft)" : undefined }}
                onClick={() => openDrawer(row)}>
                <td onClick={(e) => e.stopPropagation()}>
                  {row.kind === "response" ? (
                    <input type="checkbox" checked={!!checks[row.id]}
                      onChange={(e) => setChecks((s) => ({ ...s, [row.id]: e.target.checked }))} />
                  ) : null}
                </td>
                <td><b>{row.ref}</b></td>
                <td className="small">{groupName(row.group) || "—"}</td>
                <td><span className={"pill " + statusPill(row.status)}>{row.status}</span></td>
                <td className="small">
                  {row.kind === "invite" ? "—" : `${row.answered} / ${row.total || "—"}`}
                  {row.kind !== "invite" && row.total ? (
                    <span className="bar" style={{ display: "inline-block", width: 70, height: 6, background: "#e8e8ec", borderRadius: 99, marginLeft: 8, verticalAlign: "middle", overflow: "hidden" }}>
                      <i style={{ display: "block", height: "100%", width: Math.min(100, Math.round((row.answered / row.total) * 100)) + "%", background: "var(--teal)", borderRadius: 99 }} />
                    </span>
                  ) : null}
                </td>
                <td className="small">{row.nComments ? `${row.nComments} comment${row.nComments === 1 ? "" : "s"}` : "—"}</td>
                <td className="small">{row.dkPct == null ? "—" : row.dkPct + "%"}</td>
                <td>{row.quality ? <span className={"pill " + (row.quality === "Good" ? "open" : row.quality === "Test" ? "violet" : "draft")}>{row.quality}</span> : "—"}</td>
                <td className="small muted">{row.whenLabel}</td>
              </tr>
            ))}
          </tbody>
        </table>
        <p className="small muted" style={{ marginTop: 10 }}>
          Respondents are anonymous by design — references are assigned in order of submission and
          carry no identity. In-progress rows come from live autosave beacons; unique invitations
          track completion without linking who to what.
        </p>
      </div>

      {checkedIds.length && canManage ? (
        <div className="bulkbar">
          <span className="n">{checkedIds.length} selected</span>
          <button onClick={() => exportCsv(true)}>Export selected</button>
          <button onClick={() => setRespState(checkedIds, { flag: "review" })} disabled={busy}>Flag for review</button>
          <button onClick={() => setRespState(checkedIds, { valid: false, flag: "test" })} disabled={busy}>Mark as test</button>
          <button className="danger" onClick={() => setRespState(checkedIds, { valid: false, flag: null })} disabled={busy}>Exclude</button>
          <button onClick={() => setRespState(checkedIds, { valid: true, flag: null })} disabled={busy}>Restore</button>
          <button onClick={() => setChecks({})}>Clear</button>
        </div>
      ) : null}

      {drawer ? (
        <>
          <div className="drawer-overlay" onClick={() => setDrawer(null)} />
          <div className="drawer">
            <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center" }}>
              <h2 style={{ margin: 0 }}>{drawer.ref} <span className={"pill " + statusPill(drawer.status)} style={{ marginLeft: 8 }}>{drawer.status}</span></h2>
              <button className="iconbtn" onClick={() => setDrawer(null)}>✕</button>
            </div>
            <p className="small muted" style={{ margin: "6px 0 0" }}>
              {groupName(drawer.group)} · Submitted {drawer.whenLabel} · Identity not collected
            </p>

            {(() => {
              // Gate 1: the server decides. Below-threshold data never reaches the browser;
              // every individual-record view is audit-logged server-side.
              if (!detail) return <p className="muted small" style={{ marginTop: 14 }}>Loading…</p>;
              if (detail.error) return <div className="err" style={{ marginTop: 14 }}>Could not load this response.</div>;
              if (detail.locked) return (
                <div className="lockrow" style={{ marginTop: 16 }}>
                  🔒 This group has {detail.have} of {detail.needed} responses. To protect respondents
                  in small groups, per-response answers and written feedback stay on the server until
                  the group passes the anonymity threshold (the owner can view sooner).
                </div>
              );
              return (
                <>
                  <div className="vbanner">🛡 These are the respondent&apos;s verbatim comments — not an AI summary.</div>

                  <h2 style={{ fontSize: 15, margin: "14px 0 8px" }}>Pillar breakdown</h2>
                  <table className="t">
                    <thead><tr><th>Pillar</th><th>Score</th><th>Answered</th><th>DK/NA</th></tr></thead>
                    <tbody>
                      {(detail.pillars || []).map((d) => (
                        <tr key={d.pid}>
                          <td className="small"><b>{PILLAR_NAMES[d.pid] || d.pid}</b></td>
                          <td className="small">{d.score ?? "—"}</td>
                          <td className="small">{d.n}</td>
                          <td className="small">{d.dk}</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                  <p className="small muted" style={{ margin: "6px 0 0" }}>
                    Individual-level view — access is audit-logged, visible only to your team,
                    never to respondents or in reports.
                  </p>

                  <h2 style={{ fontSize: 15, margin: "18px 0 8px" }}>Written responses ({(detail.comments || []).length})</h2>
                  {(detail.comments || []).length === 0 ? <p className="muted small">None left.</p> :
                    (detail.comments || []).map((cm, i) => (
                      <div className="vcard" key={i}>
                        <div className="ph"><span className="pn">{PILLAR_NAMES[cm.pillar] || cm.pillar}</span><span className="tag">Verbatim response</span></div>
                        <p>{cm.body}</p>
                      </div>
                    ))}
                </>
              );
            })()}

            {canManage ? (
              <div style={{ display: "flex", gap: 8, flexWrap: "wrap", marginTop: 18 }}>
                {drawer.r.flag !== "review" ? (
                  <button className="btn btn-ghost btn-sm" disabled={busy} onClick={() => { setRespState([drawer.id], { flag: "review" }); setDrawer(null); }}>⚑ Flag for review</button>
                ) : (
                  <button className="btn btn-ghost btn-sm" disabled={busy} onClick={() => { setRespState([drawer.id], { flag: null }); setDrawer(null); }}>Clear flag</button>
                )}
                <button className="btn btn-ghost btn-sm" disabled={busy} onClick={() => { setRespState([drawer.id], { valid: false, flag: "test" }); setDrawer(null); }}>Mark as test</button>
                {drawer.r.valid ? (
                  <button className="btn btn-primary btn-sm" disabled={busy} onClick={() => { setRespState([drawer.id], { valid: false, flag: null }); setDrawer(null); }}>Exclude from results</button>
                ) : (
                  <button className="btn btn-primary btn-sm" disabled={busy} onClick={() => { setRespState([drawer.id], { valid: true, flag: null }); setDrawer(null); }}>Restore to results</button>
                )}
              </div>
            ) : null}
          </div>
        </>
      ) : null}
    </Shell>
  );
}
