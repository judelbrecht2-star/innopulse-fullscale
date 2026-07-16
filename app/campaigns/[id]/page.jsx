"use client";
import { useCallback, useEffect, useState } from "react";
import { useParams, useRouter } from "next/navigation";
import { sb, FN_BASE } from "../../../lib/supabase";
import { TopBar, bandCls } from "../../ui";

const GROUP_LABEL = { executive: "Executives", employee: "Employees", customer: "Customers", partner: "Partners" };

export default function Campaign() {
  const { id } = useParams();
  const router = useRouter();
  const [user, setUser] = useState(null);
  const [c, setC] = useState(null);
  const [groups, setGroups] = useState([]);
  const [links, setLinks] = useState([]);
  const [results, setResults] = useState(null);
  const [library, setLibrary] = useState([]);
  const [err, setErr] = useState("");
  const [copied, setCopied] = useState("");
  const [busy, setBusy] = useState(false);

  const load = useCallback(async () => {
    const { data: u } = await sb().auth.getUser();
    if (!u.user) { router.replace("/login"); return; }
    setUser(u.user);
    const { data: camp, error: e1 } = await sb().from("fs_campaigns")
      .select("id, name, status, opens_at, closes_at, anonymity_threshold").eq("id", id).maybeSingle();
    if (e1 || !camp) { setErr(e1 ? e1.message : "Campaign not found (or you don't have access)."); return; }
    setC(camp);
    const [{ data: gs }, { data: ls }, { data: lib }] = await Promise.all([
      sb().from("fs_groups").select("id, type, label, target_n").eq("campaign_id", id),
      sb().from("fs_links").select("id, group_id, token, mode, active, used_count").eq("campaign_id", id),
      sb().from("fs_interventions").select("*"),
    ]);
    setGroups(gs || []); setLinks(ls || []); setLibrary(lib || []);
    const { data: sess } = await sb().auth.getSession();
    const jwt = sess.session?.access_token;
    if (jwt) {
      try {
        const r = await fetch(`${FN_BASE}/fs-results?campaign_id=${id}`, { headers: { Authorization: `Bearer ${jwt}` } });
        if (r.ok) setResults(await r.json());
      } catch { /* results are best-effort */ }
    }
  }, [id, router]);

  useEffect(() => { load(); }, [load]);

  function respondUrl(token) {
    return `${window.location.origin}/respond/${token}`;
  }
  async function copy(token) {
    try { await navigator.clipboard.writeText(respondUrl(token)); setCopied(token); setTimeout(() => setCopied(""), 1600); } catch {}
  }
  async function setStatus(status) {
    setBusy(true);
    const { error } = await sb().from("fs_campaigns").update({ status }).eq("id", id);
    setBusy(false);
    if (error) setErr(error.message); else load();
  }

  if (err) return (<><TopBar user={user} /><div className="err">{err}</div></>);
  if (!c) return <p className="muted">Loading…</p>;

  const linkByGroup = {};
  for (const l of links) linkByGroup[l.group_id] = l;
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
      </p>
      <div style={{ margin: "12px 0 20px" }}>
        {c.status !== "open" ? (
          <button className="btn btn-primary btn-sm" disabled={busy} onClick={() => setStatus("open")}>Open collection</button>
        ) : (
          <button className="btn btn-ghost btn-sm" disabled={busy} onClick={() => setStatus("closed")}>Close collection</button>
        )}
      </div>

      <div className="card">
        <h2>Campaign links</h2>
        <p className="muted small">
          Each stakeholder group has its own signed link — the URL carries only a random
          token, so respondents can&apos;t change which group they answer for. Share the
          right link with the right audience.
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
                  <td>{l ? <code className="small">/respond/{l.token}</code> : <span className="muted">—</span>}</td>
                  <td>{r ? `${r.n} / ${g.target_n || "—"}` : "0"}</td>
                  <td>{l ? (
                    <button className="btn btn-ghost btn-sm" onClick={() => copy(l.token)}>
                      {copied === l.token ? "Copied ✓" : "Copy link"}
                    </button>
                  ) : null}</td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>

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
  // 1) Perception-gap triggers (executive vs employee) come first — they usually matter most
  for (const p of pillars) {
    const ex = byGroup.executive?.pillars?.[p.id];
    const em = byGroup.employee?.pillars?.[p.id];
    if (ex !== null && ex !== undefined && em !== null && em !== undefined) {
      const gapEntry = library.find((e) => e.trigger_type === "gap" && e.pillar === p.id && ex - em >= Number(e.gap_min || 20));
      if (gapEntry) picks.push({ entry: gapEntry, p, why: `Executives ${ex} vs employees ${em} (gap ${Math.round((ex - em) * 10) / 10})` });
    }
  }
  // 2) Band matches for the weakest pillars overall
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
