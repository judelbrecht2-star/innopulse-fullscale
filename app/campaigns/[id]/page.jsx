"use client";
import { useCallback, useEffect, useState } from "react";
import Link from "next/link";
import { useParams, useRouter } from "next/navigation";
import { sb, FN_BASE } from "../../../lib/supabase";
import { TopBar, bandCls } from "../../ui";

const GROUP_LABEL = { executive: "Executives", employee: "Employees", customer: "Customers", partner: "Partners" };

function randToken() {
  const b = new Uint8Array(8);
  crypto.getRandomValues(b);
  return Array.from(b, (x) => x.toString(16).padStart(2, "0")).join("");
}
function csvEsc(v) {
  const s = String(v ?? "");
  return /[",\n]/.test(s) ? '"' + s.replace(/"/g, '""') + '"' : s;
}
function downloadCsv(name, rows) {
  const csv = rows.map((r) => r.map(csvEsc).join(",")).join("\r\n");
  const blob = new Blob(["﻿" + csv], { type: "text/csv;charset=utf-8" });
  const a = document.createElement("a");
  a.href = URL.createObjectURL(blob);
  a.download = name;
  a.click();
  URL.revokeObjectURL(a.href);
}

export default function Campaign() {
  const { id } = useParams();
  const router = useRouter();
  const [user, setUser] = useState(null);
  const [role, setRole] = useState("");
  const [c, setC] = useState(null);
  const [groups, setGroups] = useState([]);
  const [links, setLinks] = useState([]);
  const [results, setResults] = useState(null);
  const [library, setLibrary] = useState([]);
  const [err, setErr] = useState("");
  const [copied, setCopied] = useState("");
  const [busy, setBusy] = useState(false);
  // settings
  const [editName, setEditName] = useState("");
  const [editThreshold, setEditThreshold] = useState("");
  const [editCloses, setEditCloses] = useState("");
  const [editThanks, setEditThanks] = useState("");
  const [editClosedMsg, setEditClosedMsg] = useState("");
  const [saved, setSaved] = useState(false);
  // QR
  const [qr, setQr] = useState(null); // { token, dataUrl }
  // unique links
  const [uniqGroup, setUniqGroup] = useState("");
  const [uniqCount, setUniqCount] = useState("5");

  const load = useCallback(async () => {
    const { data: u } = await sb().auth.getUser();
    if (!u.user) { router.replace("/login"); return; }
    setUser(u.user);
    const { data: mem } = await sb().from("fs_memberships").select("role").limit(1).maybeSingle();
    setRole(mem?.role || "");
    const { data: camp, error: e1 } = await sb().from("fs_campaigns")
      .select("id, name, status, opens_at, closes_at, anonymity_threshold, thankyou_message, closed_message").eq("id", id).maybeSingle();
    if (e1 || !camp) { setErr(e1 ? e1.message : "Campaign not found (or you don't have access)."); return; }
    setC(camp);
    setEditName(camp.name);
    setEditThreshold(String(camp.anonymity_threshold));
    setEditCloses(camp.closes_at ? camp.closes_at.slice(0, 10) : "");
    setEditThanks(camp.thankyou_message || "");
    setEditClosedMsg(camp.closed_message || "");
    const [{ data: gs }, { data: ls }, { data: lib }] = await Promise.all([
      sb().from("fs_groups").select("id, type, label, target_n").eq("campaign_id", id),
      sb().from("fs_links").select("id, group_id, token, mode, active, used_count, max_uses").eq("campaign_id", id).order("created_at"),
      sb().from("fs_interventions").select("*"),
    ]);
    setGroups(gs || []); setLinks(ls || []); setLibrary(lib || []);
    if (!uniqGroup && gs && gs.length) setUniqGroup(gs[0].id);
    const { data: sess } = await sb().auth.getSession();
    const jwt = sess.session?.access_token;
    if (jwt) {
      try {
        const r = await fetch(`${FN_BASE}/fs-results?campaign_id=${id}`, { headers: { Authorization: `Bearer ${jwt}` } });
        if (r.ok) setResults(await r.json());
      } catch { /* best-effort */ }
    }
  }, [id, router, uniqGroup]);

  useEffect(() => { load(); }, [load]);

  const canManage = role === "owner" || role === "manager";

  function respondUrl(token) { return `${window.location.origin}/respond/${token}`; }
  async function copy(token) {
    try { await navigator.clipboard.writeText(respondUrl(token)); setCopied(token); setTimeout(() => setCopied(""), 1600); } catch {}
  }
  async function showQr(token) {
    if (qr && qr.token === token) { setQr(null); return; }
    try {
      const QRCode = (await import("qrcode")).default;
      const dataUrl = await QRCode.toDataURL(respondUrl(token), { width: 480, margin: 2, color: { dark: "#16160f", light: "#ffffff" } });
      setQr({ token, dataUrl });
    } catch { setErr("Could not generate the QR code."); }
  }
  async function setStatus(status) {
    setBusy(true);
    const { error } = await sb().from("fs_campaigns").update({ status }).eq("id", id);
    setBusy(false);
    if (error) setErr(error.message); else load();
  }
  async function saveSettings(e) {
    e.preventDefault();
    setBusy(true); setSaved(false);
    const upd = {
      name: editName.trim() || c.name,
      anonymity_threshold: Math.max(1, Number(editThreshold || 5)),
      thankyou_message: editThanks.trim() || null,
      closed_message: editClosedMsg.trim() || null,
    };
    if (editCloses) upd.closes_at = new Date(editCloses + "T23:59:59").toISOString();
    const { error } = await sb().from("fs_campaigns").update(upd).eq("id", id);
    setBusy(false);
    if (error) setErr(error.message);
    else { setSaved(true); setTimeout(() => setSaved(false), 2000); load(); }
  }
  async function deactivateLink(linkId) {
    setBusy(true);
    const { error } = await sb().from("fs_links").update({ active: false }).eq("id", linkId);
    setBusy(false);
    if (error) setErr(error.message); else load();
  }
  async function regenerateLink(groupId) {
    setBusy(true);
    const { error } = await sb().from("fs_links").insert({ campaign_id: id, group_id: groupId, token: randToken(), mode: "group" });
    setBusy(false);
    if (error) setErr(error.message); else load();
  }
  async function generateUnique() {
    const n = Math.min(50, Math.max(1, Number(uniqCount || 5)));
    if (!uniqGroup) return;
    setBusy(true);
    const rows = Array.from({ length: n }, () => ({
      campaign_id: id, group_id: uniqGroup, token: randToken(), mode: "unique", max_uses: 1,
    }));
    const { error } = await sb().from("fs_links").insert(rows);
    setBusy(false);
    if (error) setErr(error.message); else load();
  }

  function exportSummary() {
    if (!results) return;
    const pillars = results.pillars || [];
    const rows = [["Campaign", results.campaign.name], ["Organisation", results.org?.name || ""],
      ["Status", results.campaign.status], ["Anonymity threshold", results.campaign.anonymity_threshold], [],
      ["Group", "Responses", "Target", ...pillars.map((p) => p.short), "Don't know / N-A %"]];
    for (const g of results.groups || []) {
      if (g.suppressed) rows.push([GROUP_LABEL[g.type] || g.type, g.n, g.target_n, `suppressed (below ${results.campaign.anonymity_threshold})`]);
      else rows.push([GROUP_LABEL[g.type] || g.type, g.n, g.target_n, ...pillars.map((p) => g.pillars[p.id] ?? ""), g.dkna_pct]);
    }
    if (results.overall && !results.overall.suppressed) {
      rows.push(["All groups", results.overall.n, "", ...pillars.map((p) => results.overall.pillars[p.id] ?? ""), ""]);
      rows.push([], ["Overall weighted score", results.overall.score ?? ""]);
    }
    downloadCsv(`${results.campaign.name.replace(/[^\w]+/g, "-")}-results.csv`, rows);
  }
  async function exportQuestions() {
    const { data: sess } = await sb().auth.getSession();
    const jwt = sess.session?.access_token;
    if (!jwt) return;
    const r = await fetch(`${FN_BASE}/fs-results?campaign_id=${id}&detail=1`, { headers: { Authorization: `Bearer ${jwt}` } });
    if (!r.ok) { setErr("Could not load question detail."); return; }
    const d = await r.json();
    const types = (d.groups || []).filter((g) => !g.suppressed).map((g) => g.type);
    const head = ["Pillar", "Question"];
    for (const t of types) head.push(`${GROUP_LABEL[t] || t} mean`, `${GROUP_LABEL[t] || t} n`, `${GROUP_LABEL[t] || t} DK/NA`);
    const rows = [head];
    for (const q of d.questions || []) {
      const row = [q.pillar, q.text];
      for (const t of types) {
        const e = q.groups[t] || {};
        row.push(e.mean ?? "", e.n_scored ?? 0, e.n_dkna ?? 0);
      }
      rows.push(row);
    }
    downloadCsv(`${d.campaign.name.replace(/[^\w]+/g, "-")}-questions.csv`, rows);
  }

  if (err && !c) return (<><TopBar user={user} /><div className="err">{err}</div></>);
  if (!c) return <p className="muted">Loading…</p>;

  const linkByGroup = {};
  for (const l of links) if (l.mode === "group" && l.active && !linkByGroup[l.group_id]) linkByGroup[l.group_id] = l;
  const inactiveGroupLinks = links.filter((l) => l.mode === "group" && !l.active);
  const uniqueLinks = links.filter((l) => l.mode === "unique");
  const groupById = {};
  for (const g of groups) groupById[g.id] = g;
  const resByGroup = {};
  if (results?.groups) for (const g of results.groups) resByGroup[g.id] = g;
  const pillars = results?.pillars || [];

  return (
    <>
      <TopBar user={user} />
      <h1>{c.name}</h1>
      <p className="small muted">
        <span className={"pill " + c.status}>{c.status}</span>{" "}
        · Anonymity threshold: {c.anonymity_threshold} response{c.anonymity_threshold === 1 ? "" : "s"} per group
        {c.closes_at ? <> · closes {new Date(c.closes_at).toLocaleDateString()}</> : null}
      </p>
      {err ? <div className="err">{err}</div> : null}
      <div style={{ margin: "12px 0 20px", display: "flex", gap: 8, flexWrap: "wrap" }}>
        {canManage ? (c.status !== "open" ? (
          <button className="btn btn-primary btn-sm" disabled={busy} onClick={() => setStatus("open")}>Open collection</button>
        ) : (
          <button className="btn btn-ghost btn-sm" disabled={busy} onClick={() => setStatus("closed")}>Close collection</button>
        )) : null}
        <button className="btn btn-ghost btn-sm" onClick={exportSummary} disabled={!results}>⬇ Results CSV</button>
        <button className="btn btn-ghost btn-sm" onClick={exportQuestions} disabled={!results}>⬇ Question detail CSV</button>
        <Link className="btn btn-ghost btn-sm" href={`/campaigns/${id}/report`}>Report view (print / PDF)</Link>
      </div>

      <div className="card">
        <h2>Campaign links</h2>
        <p className="muted small">
          Each stakeholder group has its own signed link — the URL carries only a random
          token, so respondents can&apos;t change which group they answer for.
        </p>
        <table className="t">
          <thead><tr><th>Group</th><th>Link</th><th>Responses</th><th></th></tr></thead>
          <tbody>
            {groups.map((g) => {
              const l = linkByGroup[g.id];
              const r = resByGroup[g.id];
              return (
                <tr key={g.id}>
                  <td><b>{GROUP_LABEL[g.type] || g.type}</b><div className="small muted">{g.label}</div></td>
                  <td>{l ? <code className="small">/respond/{l.token}</code> : <span className="muted small">no active link</span>}</td>
                  <td>{r ? `${r.n} / ${g.target_n || "—"}` : "0"}</td>
                  <td style={{ whiteSpace: "nowrap" }}>
                    {l ? (
                      <>
                        <button className="btn btn-ghost btn-sm" onClick={() => copy(l.token)}>
                          {copied === l.token ? "Copied ✓" : "Copy link"}
                        </button>{" "}
                        <button className="btn btn-ghost btn-sm" onClick={() => showQr(l.token)}>
                          {qr && qr.token === l.token ? "Hide QR" : "QR code"}
                        </button>{" "}
                        {canManage ? <button className="btn btn-ghost btn-sm" disabled={busy} onClick={() => deactivateLink(l.id)}>Deactivate</button> : null}
                      </>
                    ) : canManage ? (
                      <button className="btn btn-primary btn-sm" disabled={busy} onClick={() => regenerateLink(g.id)}>New link</button>
                    ) : null}
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
        {inactiveGroupLinks.length ? (
          <p className="small muted" style={{ marginTop: 8 }}>
            {inactiveGroupLinks.length} deactivated group link{inactiveGroupLinks.length === 1 ? "" : "s"} — old URLs now show &quot;link deactivated&quot; to respondents.
          </p>
        ) : null}
        {qr ? (
          <div style={{ marginTop: 14, textAlign: "center", padding: 16, border: "1px solid var(--line)", borderRadius: 12, background: "#fff" }}>
            {/* eslint-disable-next-line @next/next/no-img-element */}
            <img src={qr.dataUrl} alt="QR code for the campaign link" style={{ width: 240, height: 240 }} />
            <p className="small muted" style={{ margin: "8px 0 10px" }}>
              Scan to open <code className="small">/respond/{qr.token}</code> — drop it into slides, posters or a Teams chat.
            </p>
            <a className="btn btn-ghost btn-sm" href={qr.dataUrl} download={`innopulse-qr-${qr.token}.png`}>Download PNG</a>
          </div>
        ) : null}
      </div>

      {canManage ? (
        <div className="card">
          <h2>Unique invitation links</h2>
          <p className="muted small">
            Single-use links let you track completion per invitee without connecting
            identities to answers. Each link dies after one submission.
          </p>
          <div style={{ display: "flex", gap: 10, alignItems: "center", flexWrap: "wrap", marginBottom: 10 }}>
            <select value={uniqGroup} onChange={(e) => setUniqGroup(e.target.value)}
              style={{ padding: "9px 12px", border: "1px solid var(--line)", borderRadius: 10, fontSize: 14.5, background: "#fff" }}>
              {groups.map((g) => <option key={g.id} value={g.id}>{GROUP_LABEL[g.type] || g.type}</option>)}
            </select>
            <input type="text" inputMode="numeric" value={uniqCount}
              onChange={(e) => setUniqCount(e.target.value.replace(/\D/g, ""))} style={{ width: 70 }} />
            <button className="btn btn-primary btn-sm" disabled={busy} onClick={generateUnique}>Generate</button>
          </div>
          {uniqueLinks.length === 0 ? <p className="muted small">None yet.</p> : (
            <table className="t">
              <thead><tr><th>Group</th><th>Link</th><th>Status</th><th></th></tr></thead>
              <tbody>
                {uniqueLinks.map((l) => {
                  const used = l.used_count >= (l.max_uses || 1) || !l.active;
                  return (
                    <tr key={l.id}>
                      <td className="small">{GROUP_LABEL[groupById[l.group_id]?.type] || "—"}</td>
                      <td><code className="small">/respond/{l.token}</code></td>
                      <td><span className={"pill " + (used ? "closed" : "open")}>{used ? "used" : "unused"}</span></td>
                      <td>{!used ? (
                        <button className="btn btn-ghost btn-sm" onClick={() => copy(l.token)}>
                          {copied === l.token ? "Copied ✓" : "Copy"}
                        </button>
                      ) : null}</td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          )}
        </div>
      ) : null}

      <div className="card">
        <h2>Results by stakeholder group</h2>
        {!results ? (
          <p className="muted">Loading results…</p>
        ) : (
          <>
            <table className="t">
              <thead>
                <tr>
                  <th>Group</th><th>n</th>
                  {pillars.map((p) => <th key={p.id}>{p.short}</th>)}
                  <th>Don&apos;t know / N-A</th>
                </tr>
              </thead>
              <tbody>
                {(results.groups || []).map((g) => (
                  <tr key={g.id}>
                    <td><b>{GROUP_LABEL[g.type] || g.type}</b></td>
                    <td>{g.n}</td>
                    {g.suppressed ? (
                      <td colSpan={pillars.length + 1} className="muted small">
                        Hidden until at least {results.campaign.anonymity_threshold} responses (privacy protection)
                      </td>
                    ) : (
                      <>
                        {pillars.map((p) => (
                          <td key={p.id} className={"score " + bandCls(g.pillars[p.id])}>
                            {g.pillars[p.id] === null ? "—" : g.pillars[p.id]}
                          </td>
                        ))}
                        <td className="small muted">{g.dkna_pct}%</td>
                      </>
                    )}
                  </tr>
                ))}
                {results.overall && !results.overall.suppressed ? (
                  <tr>
                    <td><b>All groups</b></td>
                    <td>{results.overall.n}</td>
                    {pillars.map((p) => (
                      <td key={p.id} className={"score " + bandCls(results.overall.pillars[p.id])}>
                        {results.overall.pillars[p.id] === null ? "—" : results.overall.pillars[p.id]}
                      </td>
                    ))}
                    <td className="small"><b>Overall {results.overall.score ?? "—"}</b></td>
                  </tr>
                ) : null}
              </tbody>
            </table>
            <p className="small muted" style={{ marginTop: 10 }}>
              Scores are 0–100. Low &lt; 40 · Medium 40–69 · High 70+. Don&apos;t-know and
              not-applicable answers are excluded from scores and tracked as a data-quality signal.
            </p>
          </>
        )}
      </div>

      <GapsCard results={results} />
      <InterventionsCard results={results} library={library} />

      {canManage ? (
        <div className="card" style={{ maxWidth: 640 }}>
          <h2>Campaign settings</h2>
          <form onSubmit={saveSettings}>
            <label className="f">Name</label>
            <input type="text" value={editName} onChange={(e) => setEditName(e.target.value)} />
            <div className="grid2">
              <div>
                <label className="f">Anonymity threshold</label>
                <input type="text" inputMode="numeric" value={editThreshold}
                  onChange={(e) => setEditThreshold(e.target.value.replace(/\D/g, ""))} />
              </div>
              <div>
                <label className="f">Closes on</label>
                <input type="text" placeholder="YYYY-MM-DD" value={editCloses}
                  onChange={(e) => setEditCloses(e.target.value)} />
              </div>
            </div>
            <label className="f">Thank-you message <span className="muted">(shown after a respondent submits; optional)</span></label>
            <textarea value={editThanks} onChange={(e) => setEditThanks(e.target.value)}
              placeholder="Default: Your responses have been recorded anonymously." />
            <label className="f">Closed message <span className="muted">(shown when collection is closed or past its window; optional)</span></label>
            <textarea value={editClosedMsg} onChange={(e) => setEditClosedMsg(e.target.value)}
              placeholder="Default: This assessment is not currently open." />
            <div style={{ marginTop: 14 }}>
              <button className="btn btn-primary btn-sm" disabled={busy}>Save settings</button>
              {saved ? <span className="small" style={{ color: "var(--green)", marginLeft: 10 }}>Saved ✓</span> : null}
            </div>
          </form>
        </div>
      ) : null}
    </>
  );
}

/* ---------- Perception gaps ---------- */
function GapsCard({ results }) {
  if (!results) return null;
  const pillars = results.pillars || [];
  const visible = (results.groups || []).filter((g) => !g.suppressed);
  if (visible.length < 2) {
    return (
      <div className="card">
        <h2>Stakeholder perception gaps</h2>
        <p className="muted small">
          Gaps appear once at least two stakeholder groups have enough responses to show.
          A 30-point difference between what leadership believes and what employees
          experience is often the single most important finding in the assessment.
        </p>
      </div>
    );
  }
  const rows = pillars.map((p) => {
    const entries = visible
      .map((g) => ({ type: g.type, v: g.pillars?.[p.id] }))
      .filter((e) => e.v !== null && e.v !== undefined);
    if (entries.length < 2) return { p, entries, spread: null };
    const hi = entries.reduce((a, b) => (b.v > a.v ? b : a));
    const lo = entries.reduce((a, b) => (b.v < a.v ? b : a));
    return { p, entries, spread: Math.round((hi.v - lo.v) * 10) / 10, hi, lo };
  });
  const maxSpread = Math.max(...rows.map((r) => r.spread ?? 0));
  return (
    <div className="card">
      <h2>Stakeholder perception gaps</h2>
      <p className="muted small">
        The spread between the highest- and lowest-scoring group on each pillar.
        Big spreads matter more than the average.
      </p>
      <table className="t">
        <thead><tr><th>Pillar</th><th>Group scores</th><th>Spread</th></tr></thead>
        <tbody>
          {rows.map(({ p, entries, spread, hi, lo }) => (
            <tr key={p.id} style={spread !== null && spread === maxSpread && spread >= 15 ? { background: "#fdf6e0" } : undefined}>
              <td><b>{p.short}</b></td>
              <td>
                {entries.map((e) => (
                  <span key={e.type} className="pill" style={{ marginRight: 6, background: "#f1f1e7", color: "#3c3c34" }}>
                    {GROUP_LABEL[e.type] || e.type}: <b>{e.v}</b>
                  </span>
                ))}
              </td>
              <td className="score">
                {spread === null ? "—" : (
                  <>
                    {spread}
                    {spread >= 20 ? <span className="small" style={{ color: "var(--red)" }}> ▲ {GROUP_LABEL[hi.type]} vs {GROUP_LABEL[lo.type]}</span> : null}
                  </>
                )}
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

/* ---------- Recommended interventions (engine v0) ---------- */
function bandOf(v) { return v < 40 ? "low" : v < 70 ? "medium" : "high"; }

function InterventionsCard({ results, library }) {
  if (!results) return null;
  const pillars = results.pillars || [];
  const overall = results.overall && !results.overall.suppressed ? results.overall : null;
  if (!overall) {
    return (
      <div className="card">
        <h2>Recommended interventions</h2>
        <p className="muted small">Recommendations appear as soon as enough responses are in.</p>
      </div>
    );
  }
  const byGroup = {};
  for (const g of results.groups || []) if (!g.suppressed) byGroup[g.type] = g;

  const picks = [];
  for (const p of pillars) {
    const ex = byGroup.executive?.pillars?.[p.id];
    const em = byGroup.employee?.pillars?.[p.id];
    if (ex !== null && ex !== undefined && em !== null && em !== undefined) {
      const gapEntry = library.find((e) => e.trigger_type === "gap" && e.pillar === p.id && ex - em >= Number(e.gap_min || 20));
      if (gapEntry) picks.push({ entry: gapEntry, p, why: `Executives ${ex} vs employees ${em} (gap ${Math.round((ex - em) * 10) / 10})` });
    }
  }
  const ranked = pillars
    .map((p) => ({ p, v: overall.pillars?.[p.id] }))
    .filter((x) => x.v !== null && x.v !== undefined)
    .sort((a, b) => a.v - b.v);
  for (const { p, v } of ranked.slice(0, 3)) {
    const band = bandOf(v);
    const e = library.find((x) => x.trigger_type === "band" && x.pillar === p.id && x.band === band);
    if (e) picks.push({ entry: e, p, why: `${p.short} scored ${v} (${band})` });
  }

  return (
    <div className="card">
      <h2>Recommended interventions</h2>
      <p className="muted small">
        Drawn from the approved InnoPulse intervention library — triggered by this
        campaign&apos;s scores and stakeholder gaps, not generated ad hoc.
      </p>
      {picks.length === 0 ? <p className="muted">No triggers fired yet.</p> : picks.map(({ entry, p, why }, i) => (
        <details key={entry.id} open={i === 0} style={{ borderTop: "1px solid var(--line)", padding: "12px 0" }}>
          <summary style={{ cursor: "pointer", fontWeight: 700 }}>
            {p.short} · <span className={"pill " + (entry.trigger_type === "gap" ? "closed" : entry.band === "high" ? "open" : entry.band === "medium" ? "draft" : "closed")}>
              {entry.trigger_type === "gap" ? "perception gap" : entry.band}
            </span>
            <span className="small muted" style={{ marginLeft: 8 }}>{why}</span>
          </summary>
          <p className="small" style={{ margin: "10px 0 6px" }}>{entry.summary}</p>
          <ul style={{ margin: "6px 0 10px", paddingLeft: 20 }}>
            {(entry.actions || []).map((a, j) => <li key={j} className="small" style={{ marginBottom: 4 }}>{a}</li>)}
          </ul>
          <p className="small muted" style={{ margin: "4px 0" }}>
            <b>Owner:</b> {entry.owner_suggestion} · <b>Horizon:</b> {entry.horizon} ·{" "}
            <b>Effort:</b> {entry.effort} · <b>Impact:</b> {entry.impact}
          </p>
          <p className="small muted" style={{ margin: "4px 0" }}><b>Measure:</b> {entry.kpi}</p>
          <p className="small muted" style={{ margin: "4px 0" }}><b>ISO readiness:</b> {entry.iso_map}</p>
          <div style={{ marginTop: 6 }}>
            {(entry.services || []).map((s, j) => (
              <span key={j} className="pill" style={{ marginRight: 6, background: "var(--lime-soft)", color: "var(--deep)" }}>{s}</span>
            ))}
          </div>
        </details>
      ))}
    </div>
  );
}
