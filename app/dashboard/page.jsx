"use client";
import { useEffect, useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { sb, FN_BASE } from "../../lib/supabase";
import { Shell, bandCls, bandWord, bandOf, GROUP_META, GROUP_BAR, groupName } from "../ui";
import { bestGaps } from "../lib/gaps";

const BARRIER = { sii: "Confusion", iem: "Resistance", oic: "Anxiety", ipm: "Frustration", roi: "False Starts" };

export default function Dashboard() {
  const router = useRouter();
  const [user, setUser] = useState(null);
  const [org, setOrg] = useState(null);
  const [role, setRole] = useState("");
  const [campaigns, setCampaigns] = useState([]);
  const [overview, setOverview] = useState(null);
  const [loading, setLoading] = useState(true);
  const [err, setErr] = useState("");

  useEffect(() => {
    (async () => {
      const { data: u } = await sb().auth.getUser();
      if (!u.user) { router.replace("/login"); return; }
      setUser(u.user);
      const { data: mem, error: e1 } = await sb()
        .from("fs_memberships").select("role, org_id, fs_orgs(id, name)").limit(1).maybeSingle();
      if (e1) { setErr(e1.message); setLoading(false); return; }
      if (!mem) { setErr("Your user isn't linked to an organisation yet."); setLoading(false); return; }
      setOrg(mem.fs_orgs); setRole(mem.role);
      const { data: cs } = await sb().from("fs_campaigns")
        .select("id, name, status, opens_at, closes_at, anonymity_threshold, created_at")
        .order("created_at", { ascending: false });
      setCampaigns(cs || []);
      setLoading(false);
      const target = (cs || []).find((c) => c.status === "open") || (cs || [])[0];
      if (target) {
        const { data: sess } = await sb().auth.getSession();
        const jwt = sess.session?.access_token;
        if (jwt) {
          try {
            const [r, lib] = await Promise.all([
              fetch(`${FN_BASE}/fs-results?campaign_id=${target.id}&detail=1`, { headers: { Authorization: `Bearer ${jwt}` } }),
              sb().from("fs_interventions").select("*"),
            ]);
            if (r.ok) setOverview({ campaign: target, results: await r.json(), library: lib.data || [] });
          } catch { /* best-effort */ }
        }
      }
    })();
  }, [router]);

  return (
    <Shell active="overview" user={user}>
      {loading ? <p className="muted">Loading…</p> : (
        <>
          <div className="crumbs"><b>Overview</b></div>
          <div className="pagehead">
            <div>
              <h1>{org ? org.name : "Overview"}</h1>
              <p className="lead">Your role: <b>{role || "—"}</b> · {campaigns.length} campaign{campaigns.length === 1 ? "" : "s"} · <Link href="/campaigns">manage campaigns →</Link></p>
            </div>
          </div>
          {err ? <div className="err">{err}</div> : null}
          <ExecOverview data={overview} />
        </>
      )}
    </Shell>
  );
}

function Donut({ value }) {
  const r = 52, c = 2 * Math.PI * r;
  const pct = Math.max(0, Math.min(100, value ?? 0));
  const col = pct < 40 ? "var(--band-low)" : pct < 70 ? "var(--band-med)" : "var(--band-high)";
  return (
    <svg viewBox="0 0 130 130" style={{ width: 132, height: 132 }} role="img" aria-label={`Overall score ${value}`}>
      <circle cx="65" cy="65" r={r} fill="none" stroke="#e8e8ec" strokeWidth="12" />
      <circle cx="65" cy="65" r={r} fill="none" stroke={col} strokeWidth="12" strokeLinecap="round"
        strokeDasharray={`${(pct / 100) * c} ${c}`} transform="rotate(-90 65 65)" />
      <text x="65" y="62" textAnchor="middle" fontSize="30" fontWeight="800" fill="#17171a">{value ?? "—"}</text>
      <text x="65" y="82" textAnchor="middle" fontSize="11" fontWeight="700" letterSpacing="1" fill="#6d6d76">
        {value != null ? bandWord(value).toUpperCase() : ""}
      </text>
    </svg>
  );
}

function ExecOverview({ data }) {
  if (!data) return <div className="card"><p className="muted">Create a campaign to see your executive overview.</p></div>;
  const { campaign, results, library } = data;
  const pillars = results.pillars || [];
  const overall = results.overall && !results.overall.suppressed ? results.overall : null;
  const groups = results.groups || [];
  const visible = groups.filter((g) => !g.suppressed);

  const totalN = groups.reduce((s, g) => s + (g.n || 0), 0);
  const totalTarget = groups.reduce((s, g) => s + (g.target_n || 0), 0);
  const coverage = totalTarget > 0 ? Math.round((totalN / totalTarget) * 100) : null;
  const dknaAvg = visible.length ? Math.round(visible.reduce((s, g) => s + (g.dkna_pct || 0), 0) / visible.length) : null;
  const confidence = coverage === null ? null :
    coverage >= 80 && (dknaAvg ?? 0) < 10 ? "High" : coverage >= 50 ? "Medium" : "Low";

  let strongest = null, weakest = null;
  if (overall) {
    const scored = pillars.map((p) => ({ p, v: overall.pillars?.[p.id] })).filter((x) => x.v != null);
    if (scored.length) {
      strongest = scored.reduce((a, b) => (b.v > a.v ? b : a));
      weakest = scored.reduce((a, b) => (b.v < a.v ? b : a));
    }
  }

  // Shared-question gaps across any visible pair, either direction (audit F2/F7)
  const nameOfType = (t) => groupName(groups.find((g) => g.type === t)) || t;
  const gapMap = bestGaps(results.questions, pillars, visible);
  const picks = [];
  for (const p of pillars) {
    const gp = gapMap[p.id];
    if (gp) {
      const e = library.find((x) => x.trigger_type === "gap" && x.pillar === p.id && gp.d >= Number(x.gap_min || 20));
      if (e) picks.push({ p, label: `Close the ${p.short} perception gap (${nameOfType(gp.hiType)} ${gp.hi} vs ${nameOfType(gp.loType)} ${gp.lo})`, service: (e.services || [])[0] });
    }
  }
  if (overall) {
    const ranked = pillars.map((p) => ({ p, v: overall.pillars?.[p.id] })).filter((x) => x.v != null).sort((a, b) => a.v - b.v);
    for (const { p, v } of ranked) {
      if (picks.length >= 3) break;
      const e = library.find((x) => x.trigger_type === "band" && x.pillar === p.id && x.band === bandOf(v));
      if (e && !picks.some((k) => k.p.id === p.id)) picks.push({ p, label: (e.actions || [])[0] || e.summary, service: (e.services || [])[0] });
    }
  }

  return (
    <div className="card">
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "baseline", flexWrap: "wrap", gap: 8 }}>
        <h2 style={{ margin: 0 }}>Executive overview</h2>
        <span className="small muted">{campaign.name} · <Link href={`/campaigns/${campaign.id}`}>full detail →</Link></span>
      </div>
      <p className="small muted" style={{ margin: "4px 0 0" }}>
        Data source: <b>{campaign.name}</b> only — the {campaign.status === "open" ? "currently open" : "most recent"} campaign,
        never an average across campaigns. Earlier cycles appear as the trend comparison on{" "}
        <Link href="/insights" style={{ color: "inherit", fontWeight: 600 }}>Insights</Link>, not in these numbers.
      </p>

      {!overall ? (
        <p className="muted" style={{ marginTop: 10 }}>
          Waiting for enough responses — results appear once groups pass the anonymity
          threshold of {results.campaign.anonymity_threshold}.
        </p>
      ) : (
        <div style={{ display: "flex", gap: 26, flexWrap: "wrap", alignItems: "center", marginTop: 10 }}>
          <Donut value={overall.score} />
          <div style={{ flex: 1, minWidth: 260 }}>
            <table className="t">
              <tbody>
                <tr>
                  <td className="small muted" style={{ width: 170 }}>Strongest capability</td>
                  <td><b>{strongest ? strongest.p.name : "—"}</b> {strongest ? <span className={"score " + bandCls(strongest.v)}>{strongest.v}</span> : null}</td>
                </tr>
                <tr>
                  <td className="small muted">Biggest constraint</td>
                  <td>
                    <b>{weakest ? weakest.p.name : "—"}</b> {weakest ? <span className={"score " + bandCls(weakest.v)}>{weakest.v}</span> : null}
                    {weakest ? <span className="small muted"> · shows up as {BARRIER[weakest.p.id]}</span> : null}
                  </td>
                </tr>
                <tr>
                  <td className="small muted">Responses</td>
                  <td><b>{totalN}</b>{totalTarget ? <span className="small muted"> of {totalTarget} targeted ({coverage}%)</span> : null}</td>
                </tr>
                <tr>
                  <td className="small muted">Confidence</td>
                  <td>
                    {confidence ? <span className={"pill " + (confidence === "High" ? "open" : confidence === "Medium" ? "draft" : "closed")}>{confidence}</span> : "—"}
                    <span className="small muted"> coverage {coverage ?? "—"}% · don&apos;t-know {dknaAvg ?? "—"}%</span>
                  </td>
                </tr>
              </tbody>
            </table>
          </div>
        </div>
      )}

      <div className="grid2" style={{ marginTop: 14 }}>
        <div>
          <div className="small" style={{ fontWeight: 800, letterSpacing: ".6px", textTransform: "uppercase", color: "var(--muted)", marginBottom: 6 }}>Response coverage</div>
          {groups.map((g) => {
            const pct = g.target_n ? Math.min(100, Math.round((g.n / g.target_n) * 100)) : 0;
            return (
              <div key={g.id} style={{ marginBottom: 7 }}>
                <div className="small" style={{ display: "flex", justifyContent: "space-between" }}>
                  <span>{groupName(g)}</span>
                  <span className="muted">{g.n}{g.target_n ? ` / ${g.target_n}` : ""}</span>
                </div>
                <div style={{ height: 7, background: "#e8e8ec", borderRadius: 99 }}>
                  <div style={{ width: pct + "%", height: "100%", borderRadius: 99, background: GROUP_BAR[g.type] || "var(--primary)" }} />
                </div>
              </div>
            );
          })}
        </div>
        <div>
          <div className="small" style={{ fontWeight: 800, letterSpacing: ".6px", textTransform: "uppercase", color: "var(--muted)", marginBottom: 6 }}>Top priorities</div>
          {picks.length === 0 ? (
            <p className="small muted">Priorities appear once results clear the anonymity threshold.</p>
          ) : picks.slice(0, 3).map((k, i) => (
            <div key={i} className="small" style={{ padding: "7px 0", borderBottom: "1px solid var(--line)" }}>
              <b>{i + 1}.</b> {k.label}
              {k.service ? <div><span className="pill draft" style={{ marginTop: 4 }}>{k.service}</span></div> : null}
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}
