"use client";
import { useEffect, useState } from "react";
import { useParams, useRouter } from "next/navigation";
import { sb, FN_BASE } from "../../../../lib/supabase";
import { Shell, bandWord, bandOf, groupName } from "../../../ui";
import { bestGaps, MIN_N } from "../../../lib/gaps";

export default function Report() {
  const { id } = useParams();
  const router = useRouter();
  const [data, setData] = useState(null);
  const [library, setLibrary] = useState([]);
  const [err, setErr] = useState("");

  useEffect(() => {
    (async () => {
      const { data: u } = await sb().auth.getUser();
      if (!u.user) { router.replace("/login"); return; }
      const { data: sess } = await sb().auth.getSession();
      const jwt = sess.session?.access_token;
      try {
        const [r, lib] = await Promise.all([
          fetch(`${FN_BASE}/fs-results?campaign_id=${id}&detail=1`, { headers: { Authorization: `Bearer ${jwt}` } }),
          sb().from("fs_interventions").select("*"),
        ]);
        if (!r.ok) { setErr("Could not load results."); return; }
        setData(await r.json());
        setLibrary(lib.data || []);
      } catch { setErr("Could not load results."); }
    })();
  }, [id, router]);

  if (err) return (<Shell active="campaigns"><div className="err">{err}</div></Shell>);
  if (!data) return (<Shell active="campaigns"><p className="muted">Preparing report…</p></Shell>);

  const pillars = data.pillars || [];
  const visible = (data.groups || []).filter((g) => !g.suppressed);
  const overall = data.overall && !data.overall.suppressed ? data.overall : null;
  const nameOfType = (t) => groupName((data.groups || []).find((g) => g.type === t)) || t; // F9: custom names flow through
  const smallGroups = visible.filter((g) => g.n < MIN_N);

  // F2: gaps on shared questions only, any pair, either direction
  const gapMap = bestGaps(data.questions, pillars, visible);
  const gapRows = pillars
    .map((p) => ({ p, e: gapMap[p.id] || null }))
    .filter((r) => r.e)
    .sort((a, b) => b.e.d - a.e.d);

  // interventions (same generalized engine as the campaign page)
  const picks = [];
  for (const p of pillars) {
    const gp = gapMap[p.id];
    if (gp) {
      const gapEntry = library.find((e) => e.trigger_type === "gap" && e.pillar === p.id && gp.d >= Number(e.gap_min || 20));
      if (gapEntry) picks.push({ entry: gapEntry, p, why: `${nameOfType(gp.hiType)} ${gp.hi} vs ${nameOfType(gp.loType)} ${gp.lo} on ${gp.items} shared questions` });
    }
  }
  if (overall) {
    const ranked = pillars.map((p) => ({ p, v: overall.pillars?.[p.id] })).filter((x) => x.v != null).sort((a, b) => a.v - b.v);
    for (const { p, v } of ranked.slice(0, 3)) {
      const e = library.find((x) => x.trigger_type === "band" && x.pillar === p.id && x.band === bandOf(v));
      if (e && !picks.some((k) => k.entry.id === e.id)) picks.push({ entry: e, p, why: `${p.short} scored ${v}` });
    }
  }

  return (
    <Shell active="campaigns">
    <div className="report">
      <style>{`
        @media print {
          .noprint { display: none !important; }
          body { background: #fff !important; }
          .shell { padding: 0 !important; max-width: none !important; }
          .footer { display: none !important; }
          .rcard { break-inside: avoid; }
        }
        .report h1 { font-size: 24px; margin: 0 0 2px; }
        .report .rcard { background: #fff; border: 1px solid var(--line); border-radius: 12px; padding: 18px 20px; margin-bottom: 14px; }
        .report table { width: 100%; border-collapse: collapse; font-size: 13.5px; }
        .report th { text-align: left; font-size: 11px; letter-spacing: .6px; text-transform: uppercase; color: var(--muted); padding: 6px 8px; border-bottom: 2px solid var(--line); }
        .report td { padding: 7px 8px; border-bottom: 1px solid var(--line); vertical-align: top; }
        .big { font-size: 40px; font-weight: 800; line-height: 1; }
      `}</style>

      <div className="noprint" style={{ margin: "6px 0 16px", display: "flex", gap: 10 }}>
        <button className="btn btn-primary btn-sm" onClick={() => window.print()}>Print / Save as PDF</button>
        <a className="btn btn-ghost btn-sm" href={`/campaigns/${id}`}>← Back to campaign</a>
      </div>

      <div className="rcard">
        <div className="small muted" style={{ letterSpacing: 1, textTransform: "uppercase", fontWeight: 700 }}>
          InnoPulse Full-Scale · Innovation health report
        </div>
        <h1>{data.campaign.name}</h1>
        <p className="small muted" style={{ margin: "4px 0 0" }}>
          {data.org?.name} · {data.campaign.status}
          {data.campaign.closes_at ? ` · window closes ${new Date(data.campaign.closes_at).toLocaleDateString()}` : ""}
          {" "}· generated {new Date().toLocaleDateString()}
        </p>
      </div>

      <div className="rcard" style={{ display: "flex", gap: 28, alignItems: "center", flexWrap: "wrap" }}>
        <div>
          <div className="small muted">Overall innovation health</div>
          <div className="big">{overall ? overall.score : "—"}</div>
          <div className="small">{overall ? `${bandWord(overall.score)} · ${overall.n} response${overall.n === 1 ? "" : "s"}` : "Awaiting enough responses"}</div>
        </div>
        <div style={{ flex: 1, minWidth: 280 }}>
          <table>
            <thead><tr><th>Pillar</th><th>Score</th><th>Band</th></tr></thead>
            <tbody>
              {pillars.map((p) => {
                const v = overall?.pillars?.[p.id];
                return (
                  <tr key={p.id}>
                    <td>{p.name} <span className="muted small">({Math.round(p.weight * 100)}%)</span></td>
                    <td><b>{v ?? "—"}</b></td>
                    <td>{v != null ? bandWord(v) : "—"}</td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      </div>

      <div className="rcard">
        <h2 style={{ margin: "0 0 8px", fontSize: 16 }}>Results by stakeholder group</h2>
        <table>
          <thead><tr><th>Group</th><th>n</th>{pillars.map((p) => <th key={p.id}>{p.short}</th>)}<th>DK/NA</th></tr></thead>
          <tbody>
            {(data.groups || []).map((g) => (
              <tr key={g.id}>
                <td><b>{groupName(g)}</b></td>
                <td>{g.n}</td>
                {g.suppressed
                  ? <td colSpan={pillars.length + 1} className="muted small">Suppressed — below the anonymity threshold of {data.campaign.anonymity_threshold}</td>
                  : <>{pillars.map((p) => <td key={p.id}><b>{g.pillars[p.id] ?? "—"}</b></td>)}<td className="small muted">{g.dkna_pct}%</td></>}
              </tr>
            ))}
          </tbody>
        </table>
        <p className="small muted" style={{ margin: "8px 0 0" }}>
          Each group&apos;s scores cover the questions that group was asked. The gap table
          below compares groups on shared questions only.
        </p>
      </div>

      <div className="rcard">
        <h2 style={{ margin: "0 0 8px", fontSize: 16 }}>Stakeholder perception gaps</h2>
        {gapRows.length === 0 ? <p className="small muted">Not enough visible groups (or shared questions) yet to compare fairly.</p> : (
          <>
            <table>
              <thead><tr><th>Pillar</th><th>Higher</th><th>Lower</th><th>Shared Qs</th><th>Gap</th></tr></thead>
              <tbody>
                {gapRows.map(({ p, e }) => (
                  <tr key={p.id}>
                    <td>{p.short}</td>
                    <td>{nameOfType(e.hiType)} · <b>{e.hi}</b></td>
                    <td>{nameOfType(e.loType)} · <b>{e.lo}</b></td>
                    <td className="small muted">{e.items}</td>
                    <td><b>{e.d}</b>{e.d >= 20 ? " ⚠" : ""}</td>
                  </tr>
                ))}
              </tbody>
            </table>
            <p className="small muted" style={{ margin: "8px 0 0" }}>
              Gaps are computed only on questions both groups answered, so they reflect
              perception differences rather than questionnaire design.
              {smallGroups.length ? ` Small samples (${smallGroups.map((g) => `${groupName(g)} n=${g.n}`).join(", ")}) — differences below ${MIN_N} respondents per group are indicative.` : ""}
            </p>
          </>
        )}
      </div>

      <div className="rcard">
        <h2 style={{ margin: "0 0 8px", fontSize: 16 }}>Recommended interventions</h2>
        {picks.length === 0 ? <p className="small muted">No triggers fired yet.</p> : picks.map(({ entry, p, why }) => (
          <div key={entry.id} style={{ borderTop: "1px solid var(--line)", padding: "10px 0" }}>
            <p style={{ margin: "0 0 4px", fontWeight: 700, fontSize: 14 }}>
              {p.short} — {entry.trigger_type === "gap" ? "perception gap" : entry.band} <span className="muted small">({why})</span>
            </p>
            <p className="small" style={{ margin: "0 0 6px" }}>{entry.summary}</p>
            <ul style={{ margin: "0 0 6px", paddingLeft: 18 }}>
              {(entry.actions || []).map((a, j) => <li key={j} className="small">{a}</li>)}
            </ul>
            <p className="small muted" style={{ margin: 0 }}>
              Owner: {entry.owner_suggestion} · Horizon: {entry.horizon} · Measure: {entry.kpi} · {entry.iso_map}
            </p>
          </div>
        ))}
        <p className="small muted" style={{ marginTop: 10 }}>
          Recommendations are drawn from the approved InnoPulse intervention library. ISO 56001
          references indicate readiness alignment, not certification.
        </p>
      </div>
    </div>
    </Shell>
  );
}
