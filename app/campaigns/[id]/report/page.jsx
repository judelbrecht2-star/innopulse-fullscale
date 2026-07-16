"use client";
import { useEffect, useState } from "react";
import { useParams, useRouter } from "next/navigation";
import { sb, FN_BASE } from "../../../../lib/supabase";

const GROUP_LABEL = { executive: "Executives", employee: "Employees", customer: "Customers", partner: "Partners" };
function bandOf(v) { return v < 40 ? "low" : v < 70 ? "medium" : "high"; }
function bandWord(v) { return v < 40 ? "Low" : v < 70 ? "Medium" : "High"; }

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

  if (err) return <div className="err">{err}</div>;
  if (!data) return <p className="muted">Preparing report…</p>;

  const pillars = data.pillars || [];
  const visible = (data.groups || []).filter((g) => !g.suppressed);
  const overall = data.overall && !data.overall.suppressed ? data.overall : null;

  // gaps
  const gapRows = pillars.map((p) => {
    const entries = visible.map((g) => ({ type: g.type, v: g.pillars?.[p.id] })).filter((e) => e.v != null);
    if (entries.length < 2) return null;
    const hi = entries.reduce((a, b) => (b.v > a.v ? b : a));
    const lo = entries.reduce((a, b) => (b.v < a.v ? b : a));
    return { p, spread: Math.round((hi.v - lo.v) * 10) / 10, hi, lo };
  }).filter(Boolean).sort((a, b) => b.spread - a.spread);

  // interventions (same engine as the campaign page)
  const byGroup = {};
  for (const g of visible) byGroup[g.type] = g;
  const picks = [];
  for (const p of pillars) {
    const ex = byGroup.executive?.pillars?.[p.id];
    const em = byGroup.employee?.pillars?.[p.id];
    if (ex != null && em != null) {
      const gapEntry = library.find((e) => e.trigger_type === "gap" && e.pillar === p.id && ex - em >= Number(e.gap_min || 20));
      if (gapEntry) picks.push({ entry: gapEntry, p, why: `Executives ${ex} vs employees ${em}` });
    }
  }
  if (overall) {
    const ranked = pillars.map((p) => ({ p, v: overall.pillars?.[p.id] })).filter((x) => x.v != null).sort((a, b) => a.v - b.v);
    for (const { p, v } of ranked.slice(0, 3)) {
      const e = library.find((x) => x.trigger_type === "band" && x.pillar === p.id && x.band === bandOf(v));
      if (e) picks.push({ entry: e, p, why: `${p.short} scored ${v}` });
    }
  }

  return (
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
                <td><b>{GROUP_LABEL[g.type] || g.type}</b></td>
                <td>{g.n}</td>
                {g.suppressed
                  ? <td colSpan={pillars.length + 1} className="muted small">Suppressed — below the anonymity threshold of {data.campaign.anonymity_threshold}</td>
                  : <>{pillars.map((p) => <td key={p.id}><b>{g.pillars[p.id] ?? "—"}</b></td>)}<td className="small muted">{g.dkna_pct}%</td></>}
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      <div className="rcard">
        <h2 style={{ margin: "0 0 8px", fontSize: 16 }}>Stakeholder perception gaps</h2>
        {gapRows.length === 0 ? <p className="small muted">Not enough visible groups yet to compare.</p> : (
          <table>
            <thead><tr><th>Pillar</th><th>Highest</th><th>Lowest</th><th>Spread</th></tr></thead>
            <tbody>
              {gapRows.map(({ p, spread, hi, lo }) => (
                <tr key={p.id}>
                  <td>{p.short}</td>
                  <td>{GROUP_LABEL[hi.type]} · <b>{hi.v}</b></td>
                  <td>{GROUP_LABEL[lo.type]} · <b>{lo.v}</b></td>
                  <td><b>{spread}</b>{spread >= 20 ? " ⚠" : ""}</td>
                </tr>
              ))}
            </tbody>
          </table>
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
  );
}
