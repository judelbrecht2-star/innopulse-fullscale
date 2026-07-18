"use client";
import { useCallback, useEffect, useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { sb, FN_BASE } from "../../lib/supabase";
import { Shell, I, GROUP_META, GROUP_BAR, groupName } from "../ui";
import { sharedPillarScores, MIN_ITEMS, MIN_N } from "../lib/gaps";
import { evaluateFindings, CLASS } from "../lib/findings";
import { computeTrend, fmtDelta, deltaColor } from "../lib/trends";

function FindingCard({ f }) {
  const chip = f.klass === CLASS.OBS ? "teal" : f.klass === CLASS.SUP ? "draft" : "closed";
  const dot = f.severity === 3 ? "var(--primary)" : f.severity === 2 ? "var(--amber, #b7791f)" : "var(--muted)";
  return (
    <details style={{ borderTop: "1px solid var(--line)", padding: "10px 0" }}>
      <summary style={{ cursor: "pointer", display: "flex", alignItems: "center", gap: 10, flexWrap: "wrap" }}>
        <span style={{ width: 9, height: 9, borderRadius: "50%", background: dot, flex: "0 0 9px" }} />
        <b style={{ fontSize: 14 }}>{f.title}</b>
        <span className={"pill " + chip}>{f.klass}</span>
        <span className="small muted">confidence: {f.confidence}</span>
        {f.iso ? <span className="pill violet" title="ISO 56001:2024 readiness area">ISO {f.iso}</span> : null}
      </summary>
      <p className="small" style={{ margin: "10px 0 6px", lineHeight: 1.6 }}>{f.text}</p>
      <p className="small muted" style={{ margin: "6px 0" }}>{f.evidence.join("  ")}</p>
      <p className="small" style={{ margin: "6px 0" }}><b>Also consider:</b> <span className="muted">{f.alternatives}</span></p>
      <p className="small" style={{ margin: "6px 0" }}><b>To validate:</b> <span className="muted">{f.validate}</span></p>
    </details>
  );
}

function bandChip(v) { return v == null ? "" : v < 40 ? "low" : v < 70 ? "med" : "high"; }

export default function Insights() {
  const router = useRouter();
  const [user, setUser] = useState(null);
  const [campaigns, setCampaigns] = useState([]);
  const [sel, setSel] = useState("");
  const [results, setResults] = useState(null);
  const [err, setErr] = useState("");
  const [gA, setGA] = useState("executive");
  const [gB, setGB] = useState("employee");

  useEffect(() => {
    (async () => {
      const { data: u } = await sb().auth.getUser();
      if (!u.user) { router.replace("/login"); return; }
      setUser(u.user);
      const { data: cs } = await sb().from("fs_campaigns")
        .select("id, name, status, created_at, prior_campaign_id").order("created_at", { ascending: false });
      setCampaigns(cs || []);
      const target = (cs || []).find((c) => c.status === "open") || (cs || [])[0];
      if (target) setSel(target.id);
    })();
  }, [router]);

  const [trend, setTrend] = useState(null);
  useEffect(() => {
    (async () => {
      setTrend(null);
      const cur = campaigns.find((c) => c.id === sel);
      if (!results || !cur?.prior_campaign_id) return;
      try {
        const { data: sess } = await sb().auth.getSession();
        const r = await fetch(`${FN_BASE}/fs-results?campaign_id=${cur.prior_campaign_id}`, { headers: { Authorization: `Bearer ${sess.session?.access_token}` } });
        if (r.ok) setTrend(computeTrend(results, await r.json()));
      } catch { /* trend is best-effort */ }
    })();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [results, sel]);

  const loadResults = useCallback(async (cid) => {
    if (!cid) return;
    setResults(null); setErr("");
    const { data: sess } = await sb().auth.getSession();
    const jwt = sess.session?.access_token;
    if (!jwt) return;
    try {
      const r = await fetch(`${FN_BASE}/fs-results?campaign_id=${cid}&detail=1`, { headers: { Authorization: `Bearer ${jwt}` } });
      if (!r.ok) { setErr("Could not load results for this campaign."); return; }
      setResults(await r.json());
    } catch { setErr("Could not load results for this campaign."); }
  }, []);

  useEffect(() => { loadResults(sel); }, [sel, loadResults]);

  const pillars = results?.pillars || [];
  const groups = results?.groups || [];
  const visible = groups.filter((g) => !g.suppressed);
  const overall = results?.overall && !results.overall.suppressed ? results.overall : null;
  const totalN = groups.reduce((s, g) => s + (g.n || 0), 0);
  const presentTypes = groups.map((g) => g.type);
  const nameOfType = (t) => groupName(groups.find((g) => g.type === t)) || GROUP_META[t]?.label || t;
  const visByType = Object.fromEntries(visible.map((g) => [g.type, g]));

  // ensure selectors point at present groups
  useEffect(() => {
    if (!results) return;
    const types = groups.map((g) => g.type);
    if (types.length >= 2) {
      if (!types.includes(gA)) setGA(types[0]);
      if (!types.includes(gB) || gB === gA) setGB(types.find((t) => t !== (types.includes(gA) ? gA : types[0])) || types[1]);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [results]);

  const A = visByType[gA], B = visByType[gB];

  // F2: compare the pair ONLY on questions both groups answered
  const shared = results ? sharedPillarScores(results.questions, pillars, gA, gB) : {};
  const gapRows = pillars.map((p) => ({ p, ...(shared[p.id] || { a: null, b: null, d: null, items: 0 }) }));
  const sharedTotal = gapRows.reduce((s, r) => s + (r.items || 0), 0);
  const reliable = gapRows.filter((r) => r.d != null && r.items >= MIN_ITEMS);
  const biggest = reliable.sort((x, y) => y.d - x.d)[0] || null;
  const smallSample = A && B && (A.n < MIN_N || B.n < MIN_N);
  const findings = results ? evaluateFindings(results) : [];

  return (
    <Shell active="insights" user={user}>
      <div className="crumbs">Insights / <b>{campaigns.find((c) => c.id === sel)?.name || "—"}</b></div>
      <div className="pagehead">
        <div>
          <h1>Stakeholder results</h1>
          <p className="lead">Compare how each stakeholder group experiences the organisation&apos;s innovation system.</p>
        </div>
        <div style={{ display: "flex", gap: 10, flexWrap: "wrap" }}>
          {sel ? <Link className="btn btn-ghost" href={`/campaigns/${sel}/report`}>⭱ Export report</Link> : null}
          {sel ? <Link className="btn btn-primary" href="/insights/interventions">Recommended interventions →</Link> : null}
          <select value={sel} onChange={(e) => setSel(e.target.value)} style={{ width: "auto", fontWeight: 600 }}>
            {campaigns.map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}
          </select>
        </div>
      </div>
      {err ? <div className="err">{err}</div> : null}

      <div className="stats">
        <div className="stat"><span className="ic c-green"><I.chart /></span><div>
          <div className="k">Overall score</div>
          <div className="v">{overall ? overall.score : "—"}</div>
          {overall ? <span className={"pill " + (overall.score < 40 ? "closed" : overall.score < 70 ? "draft" : "open")}>{overall.score < 40 ? "Low" : overall.score < 70 ? "Medium" : "High"}</span> : null}
        </div></div>
        <div className="stat"><span className="ic c-teal"><I.people /></span><div>
          <div className="k">Responses</div>
          <div className="v">{totalN}</div>
          <span className="small muted">{visible.length} stakeholder group{visible.length === 1 ? "" : "s"} represented</span>
        </div></div>
        <div className="stat"><span className="ic c-red"><I.info /></span><div>
          <div className="k">Largest perception gap</div>
          <div className="v">{biggest ? `${biggest.d} pts` : "—"}</div>
          {biggest
            ? <span className="small muted">{biggest.p.short} · {nameOfType(gA)} vs {nameOfType(gB)} · {biggest.items} shared Qs</span>
            : <span className="small muted">needs two visible groups with {MIN_ITEMS}+ shared questions</span>}
        </div></div>
      </div>

      {trend && trend.overall.d != null ? (
        <div className="card">
          <div style={{ display: "flex", gap: 16, alignItems: "center", flexWrap: "wrap" }}>
            <h2 style={{ margin: 0 }}>Trend vs {trend.priorName}</h2>
            <span style={{ fontWeight: 800, fontSize: 22, color: deltaColor(trend.overall.d) }}>{fmtDelta(trend.overall.d)}</span>
            <span className="small muted">overall ({trend.overall.prev} → {trend.overall.cur} · n {trend.n.prev} → {trend.n.cur})</span>
            {!trend.comparable ? <span className="pill draft" title="The two cycles used different questionnaire versions">directional only — versions differ</span> : null}
          </div>
          <div style={{ display: "flex", gap: 14, flexWrap: "wrap", marginTop: 10 }}>
            {trend.pillars.map((p) => (
              <span key={p.id} className="small" style={{ border: "1px solid var(--line)", borderRadius: 99, padding: "5px 12px" }}>
                {p.short}: <b style={{ color: deltaColor(p.d) }}>{fmtDelta(p.d)}</b>
              </span>
            ))}
          </div>
        </div>
      ) : null}

      {findings.length ? (
        <div className="card">
          <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", flexWrap: "wrap", gap: 8 }}>
            <h2 style={{ margin: 0 }}>Automatic findings</h2>
            <Link className="btn btn-primary btn-sm" href="/insights/findings">Review all {findings.length} findings →</Link>
          </div>
          {findings.slice(0, 3).map((f) => <FindingCard key={f.id} f={f} />)}
          {findings.length > 3 ? (
            <p className="small muted" style={{ marginTop: 8 }}>
              + {findings.length - 3} more pattern{findings.length - 3 === 1 ? "" : "s"} in the findings workbench —
              with filters, evidence detail, review tracking and CSV export.
            </p>
          ) : null}
        </div>
      ) : null}

      <div style={{ display: "grid", gridTemplateColumns: "minmax(0,2fr) minmax(260px,1fr)", gap: 18, alignItems: "start" }} className="gapgrid">
        <style>{`@media(max-width:980px){.gapgrid{grid-template-columns:1fr!important}}`}</style>
        <div className="card">
          <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", flexWrap: "wrap", gap: 10 }}>
            <h2 style={{ margin: 0 }}>Stakeholder perception gap</h2>
            <div style={{ display: "flex", gap: 8, alignItems: "center" }}>
              <select value={gA} onChange={(e) => setGA(e.target.value)} style={{ width: "auto", fontSize: 13 }}>
                {presentTypes.map((t) => <option key={t} value={t} disabled={t === gB}>{nameOfType(t)}</option>)}
              </select>
              <span className="small muted">vs</span>
              <select value={gB} onChange={(e) => setGB(e.target.value)} style={{ width: "auto", fontSize: 13 }}>
                {presentTypes.map((t) => <option key={t} value={t} disabled={t === gA}>{nameOfType(t)}</option>)}
              </select>
            </div>
          </div>
          <p className="small" style={{ margin: "8px 0 12px" }}>
            <span className="legend-dot" style={{ background: GROUP_BAR[gA] }} />{nameOfType(gA)}
            <span className="legend-dot" style={{ background: GROUP_BAR[gB], marginLeft: 16 }} />{nameOfType(gB)}
            <span className="muted" style={{ marginLeft: 16 }}>Δ = point difference on the {sharedTotal} question{sharedTotal === 1 ? "" : "s"} both groups answered</span>
          </p>
          {!A || !B ? (
            <p className="muted small">
              Both selected groups need enough responses to show. {A ? "" : `${nameOfType(gA)} is still below the anonymity threshold. `}
              {B ? "" : `${nameOfType(gB)} is still below the anonymity threshold.`}
            </p>
          ) : (
            <>
              {gapRows.map(({ p, a, b, d, items }) => {
                if (a == null || b == null) return (
                  <div className="dumb" key={p.id}>
                    <div className="plabel">{p.short}</div>
                    <div /><div className="trackwrap"><div className="track" /></div><div />
                    <div className="delta muted">no shared Qs</div>
                  </div>
                );
                const lo = Math.min(a, b), hi = Math.max(a, b);
                const loColor = a <= b ? GROUP_BAR[gA] : GROUP_BAR[gB];
                const hiColor = a <= b ? GROUP_BAR[gB] : GROUP_BAR[gA];
                return (
                  <div className="dumb" key={p.id}>
                    <div className="plabel">{p.short}{items < MIN_ITEMS ? <span className="small muted" title={`Only ${items} shared question${items === 1 ? "" : "s"} — treat as indicative`}> *</span> : null}</div>
                    <div className="val" style={{ color: loColor }}>{lo}</div>
                    <div className="trackwrap">
                      <div className="track" />
                      <div className="seg" style={{ left: lo + "%", width: (hi - lo) + "%" }} />
                      <div className="dot" style={{ left: lo + "%", background: loColor }} />
                      <div className="dot" style={{ left: hi + "%", background: hiColor }} />
                    </div>
                    <div className="val right" style={{ color: hiColor }}>{hi}</div>
                    <div className="delta">Δ {d} pts{items < MIN_ITEMS ? " *" : ""}</div>
                  </div>
                );
              })}
              <div className="axis"><div /><div /><div className="ticks"><span>0</span><span>25</span><span>50</span><span>75</span><span>100</span></div><div /><div /></div>
              {gapRows.some((r) => r.d != null && r.items < MIN_ITEMS) ? (
                <p className="small muted" style={{ marginTop: 8 }}>* Fewer than {MIN_ITEMS} shared questions on this pillar — indicative only.</p>
              ) : null}
              {smallSample ? (
                <p className="small" style={{ marginTop: 8, color: "var(--amber, #b7791f)" }}>
                  ⚠ Small samples ({nameOfType(gA)} n={A.n}, {nameOfType(gB)} n={B.n}) — differences based on fewer
                  than {MIN_N} respondents per group are indicative, not conclusive.
                </p>
              ) : null}
            </>
          )}
        </div>

        <div className="alertcard" style={{ visibility: biggest && biggest.d >= 30 ? "visible" : "hidden" }}>
          <div style={{ display: "flex", gap: 12, alignItems: "center", marginBottom: 8 }}>
            <span className="ic c-red" style={{ width: 44, height: 44, borderRadius: "50%", display: "flex", alignItems: "center", justifyContent: "center" }}><I.info /></span>
            <h2 style={{ margin: 0 }}>Critical alignment gap</h2>
          </div>
          {biggest ? (
            <>
              <p className="small" style={{ lineHeight: 1.55 }}>
                {nameOfType(biggest.a >= biggest.b ? gA : gB)} see a substantially healthier innovation system than{" "}
                {nameOfType(biggest.a >= biggest.b ? gB : gA)} experience
                ({biggest.d} points apart on {biggest.p.short}, measured on the {biggest.items} questions both answered).
                Validate this gap before acting on the overall average.
              </p>
              {sel ? <Link href={`/campaigns/${sel}`} style={{ fontWeight: 700 }}>Review campaign detail →</Link> : null}
            </>
          ) : null}
        </div>
      </div>

      <div className="card">
        <h2>Detailed stakeholder scores</h2>
        <table className="t">
          <thead>
            <tr><th>Group</th><th>N</th>{pillars.map((p) => <th key={p.id}>{p.short}</th>)}<th>Don&apos;t know / N-A</th></tr>
          </thead>
          <tbody>
            {groups.map((g) => {
              const meta = GROUP_META[g.type] || { label: g.type, chip: "c-grey", icon: "people" };
              const Icon = I[meta.icon] || I.people;
              return (
                <tr key={g.id}>
                  <td><div className="gname"><span className={"chip " + meta.chip} style={{ width: 36, height: 36, flex: "0 0 36px" }}><Icon style={{ width: 17, height: 17 }} /></span><b>{groupName(g)}</b></div></td>
                  <td>{g.n}</td>
                  {g.suppressed ? (
                    <td colSpan={pillars.length + 1}>
                      <div className="lockrow">🔒 Hidden until at least {results?.campaign?.anonymity_threshold} response{results?.campaign?.anonymity_threshold === 1 ? "" : "s"} (privacy protection)</div>
                    </td>
                  ) : (
                    <>
                      {pillars.map((p) => (
                        <td key={p.id}>{g.pillars[p.id] == null ? <span className="muted">—</span> : <span className={"schip " + bandChip(g.pillars[p.id])}>{g.pillars[p.id]}</span>}</td>
                      ))}
                      <td className="small muted">{g.dkna_pct}%</td>
                    </>
                  )}
                </tr>
              );
            })}
            {overall ? (
              <tr>
                <td><b>All groups</b></td>
                <td>{overall.n}</td>
                {pillars.map((p) => (
                  <td key={p.id}>{overall.pillars[p.id] == null ? "—" : <span className={"schip " + bandChip(overall.pillars[p.id])}>{overall.pillars[p.id]}</span>}</td>
                ))}
                <td><b>Overall {overall.score}</b></td>
              </tr>
            ) : null}
          </tbody>
        </table>
        <p className="small muted" style={{ marginTop: 12 }}>
          <span className="legend-dot" style={{ background: "var(--band-low)" }} />Low &lt; 40
          <span className="legend-dot" style={{ background: "var(--band-med)", marginLeft: 14 }} />Medium 40–69
          <span className="legend-dot" style={{ background: "var(--band-high)", marginLeft: 14 }} />High 70+
          <span style={{ marginLeft: 14 }}>|</span>
          <span style={{ marginLeft: 14 }}>Each group&apos;s scores cover the questions that group was asked; the gap chart above compares shared questions only. Don&apos;t-know and not-applicable answers are excluded from scores and tracked as a data-quality signal.</span>
        </p>
      </div>
    </Shell>
  );
}
