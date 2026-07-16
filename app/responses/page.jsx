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
  // selection + drawer
  const [checks, setChecks] = useState({});
  const [drawer, setDrawer] = useState(null); // row object
  const [detail, setDetail] = useState(null); // pillar breakdown for drawer

  useEffect(() => {
    (async () => {
      const { data: u } = await sb().auth.getUser();
      if (!u.user) { router.replace("/login"); return; }
      setUser(u.user);
      const { data: mem } = await sb().from("fs_memberships").select("role").limit(1).maybeSingle();
      setRole(mem?.role || "");
      const { data: cs } = await sb().from("fs_campaigns")
        .select("id, name, status, anonymity_threshold, created_at").order("created_at", { ascending: false });
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
    const [{ data: gs }, { data: ls }, { data: rs }, { data: ans }, { data: cm }, { data: pg }] = await Promise.all([
      sb().from("fs_groups").select("id, type, label, target_n").eq("campaign_id", cid),
      sb().from("fs_links").select("id, group_id, token, mode, active, used_count, created_at").eq("campaign_id", cid),
      sb().from("fs_responses").select("id, group_id, link_id, submitted_at, valid, flag").eq("campaign_id", cid).order("submitted_at"),
      sb().from("fs_answers").select("response_id, not_scored"),
      sb().from("fs_comments").select("response_id, pillar, body"),
      sb().from("fs_progress").select("id, group_id, link_id, client_ref, answered, total, started_at, last_seen").eq("campaign_id", cid).order("started_at"),
    ]);
    setGroups(gs || []); setLinks(ls || []); setResps(rs || []); setProgress(pg || []);
    const respIds = new Set((rs || []).map((r) => r.id));
    const a = {};
    for (const row of ans || []) {
      if (!respIds.has(row.response_id)) continue;
      a[row.response_id] = a[row.response_id] || { answered: 0, dk: 0 };
      a[row.response_id].answered++;
      if (row.not_scored) a[row.response_id].dk++;
    }
    setAggs(a);
    const cmap = {};
    for (const row of cm || []) {
      if (!respIds.has(row.response_id)) continue;
      (cmap[row.response_id] = cmap[row.response_id] || []).push(row);
    }
    setComms(cmap);
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
    rows.push({
      kind: "response", id: r.id, r,
      ref: `Anonymous #${String(i + 1).padStart(3, "0")}`,
      group: groupById[r.group_id], status, quality, dkPct,
      answered: agg.answered, total: agg.answered,
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
      const needle = q.trim().toLowerCase();
      const inRef = row.ref.toLowerCase().includes(needle);
      const inComments = row.kind === "response" && (comms[row.id] || []).some((cm) => cm.body.toLowerCase().includes(needle));
      if (!inRef && !inComments) return false;
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
    const { data } = await sb().from("fs_answers").select("question_key, value, not_scored").eq("response_id", row.id);
    const per = {};
    for (const a of data || []) {
      const pid = a.question_key.split("_")[0];
      per[pid] = per[pid] || { sum: 0, c: 0, dk: 0, n: 0 };
      per[pid].n++;
      if (a.not_scored || a.value === null) per[pid].dk++;
      else { per[pid].sum += Number(a.value); per[pid].c++; }
    }
    setDetail(per);
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
          <button className="btn btn-primary" disabled title="Email reminders arrive with the notifications build — use Copy link per group meanwhile">✈ Send reminders</button>
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

            <div className="vbanner">🛡 These are the respondent&apos;s verbatim comments — not an AI summary.</div>

            <h2 style={{ fontSize: 15, margin: "14px 0 8px" }}>Pillar breakdown</h2>
            {!detail ? <p className="muted small">Loading…</p> : (
              <table className="t">
                <thead><tr><th>Pillar</th><th>Score</th><th>Answered</th><th>DK/NA</th></tr></thead>
                <tbody>
                  {Object.entries(detail).map(([pid, d]) => (
                    <tr key={pid}>
                      <td className="small"><b>{PILLAR_NAMES[pid] || pid}</b></td>
                      <td className="small">{d.c ? Math.round((d.sum / d.c) * 10) / 10 : "—"}</td>
                      <td className="small">{d.n}</td>
                      <td className="small">{d.dk}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            )}
            <p className="small muted" style={{ margin: "6px 0 0" }}>
              Individual-level view — visible only to your team, never to respondents or in reports.
            </p>

            <h2 style={{ fontSize: 15, margin: "18px 0 8px" }}>Written responses ({(comms[drawer.id] || []).length})</h2>
            {(comms[drawer.id] || []).length === 0 ? <p className="muted small">None left.</p> :
              (comms[drawer.id] || []).map((cm, i) => (
                <div className="vcard" key={i}>
                  <div className="ph"><span className="pn">{PILLAR_NAMES[cm.pillar] || cm.pillar}</span><span className="tag">Verbatim response</span></div>
                  <p>{cm.body}</p>
                </div>
              ))}

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
