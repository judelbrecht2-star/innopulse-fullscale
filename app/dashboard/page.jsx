"use client";
import { useEffect, useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { sb, FN_BASE } from "../../lib/supabase";
import { Shell, bandCls, bandWord, bandOf, GROUP_META, GROUP_BAR, groupName } from "../ui";
import { bestGaps } from "../lib/gaps";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Badge } from "@/components/ui/badge";
import { ArrowRight, GraphUp, Group, ShieldCheck, WarningTriangle } from "iconoir-react";
import { activeMembership } from "../lib/org";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";

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
      const mem = await activeMembership(u.user.id); // P0-3: explicit active org
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
              <p className="lead ovw-lead">
                Your role: <b>{role || "—"}</b> · {campaigns.length} campaign{campaigns.length === 1 ? "" : "s"}
                <Button asChild variant="outline" size="sm" className="ovw-btn ovw-lead-btn">
                  <Link href="/campaigns"><Group width={16} height={16} /> Manage campaigns <ArrowRight width={16} height={16} /></Link>
                </Button>
              </p>
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
  // Ring sits clear of the numerals: inner radius (r - stroke/2) is comfortably
  // wider than the score text at this font size.
  const r = 66, c = 2 * Math.PI * r;
  const pct = Math.max(0, Math.min(100, value ?? 0));
  const col = pct < 40 ? "var(--band-low)" : pct < 70 ? "var(--band-med)" : "var(--band-high)";
  return (
    <svg viewBox="0 0 160 160" style={{ width: 158, height: 158, flex: "0 0 auto" }} role="img" aria-label={`Overall score ${value}`}>
      <circle cx="80" cy="80" r={r} fill="none" stroke="#e8e8ec" strokeWidth="13" />
      <circle cx="80" cy="80" r={r} fill="none" stroke={col} strokeWidth="13" strokeLinecap="round"
        strokeDasharray={`${(pct / 100) * c} ${c}`} transform="rotate(-90 80 80)" />
      <text x="80" y="79" textAnchor="middle" fontSize="34" fontWeight="800" fill="#17171a"
        style={{ fontVariantNumeric: "tabular-nums" }}>{value ?? "—"}</text>
      <text x="80" y="100" textAnchor="middle" fontSize="11" fontWeight="700" letterSpacing="1.2" fill="#6d6d76">
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
      if (e) picks.push({ p, label: `Close the ${p.short} perception gap (${(gp.hiLabel || nameOfType(gp.hiType))} ${gp.hi} vs ${(gp.loLabel || nameOfType(gp.loType))} ${gp.lo})`, service: (e.services || [])[0] });
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
    <Card className="ovw-card">
      <CardHeader className="ovw-head">
        <div>
          <CardTitle className="ovw-title">Executive overview</CardTitle>
          <p className="ovw-source">
            Data source: <b>{campaign.name}</b> only — the {campaign.status === "open" ? "currently open" : "most recent"} campaign,
            never an average across campaigns.<br />Earlier cycles appear as the trend comparison on{" "}
            <Link href="/insights" className="ovw-inline-link">Insights</Link>, not in these numbers.
          </p>
        </div>
        <div className="ovw-head-right">
          <span className="ovw-campaign">{campaign.name}</span>
          <Button asChild variant="outline" size="sm" className="ovw-btn">
            <Link href={`/campaigns/${campaign.id}`}>View full campaign <ArrowRight width={16} height={16} /></Link>
          </Button>
        </div>
      </CardHeader>

      <CardContent className="ovw-body">
        {!overall ? (
          <p className="muted">
            Waiting for enough responses — results appear once groups pass the anonymity
            threshold of {results.campaign.anonymity_threshold}.
          </p>
        ) : (
          <div className="ovw-top">
            <Donut value={overall.score} />
            <dl className="ovw-rows">
              <div className="ovw-row">
                <dt>Strongest capability</dt>
                <dd><b>{strongest ? strongest.p.name : "—"}</b>{strongest ? <span className="ovw-score">{strongest.v}</span> : null}</dd>
              </div>
              <div className="ovw-row">
                <dt>Biggest constraint</dt>
                <dd>
                  <b>{weakest ? weakest.p.name : "—"}</b>{weakest ? <span className="ovw-score">{weakest.v}</span> : null}
                  {weakest ? <span className="ovw-meta"> · shows up as {BARRIER[weakest.p.id]}</span> : null}
                </dd>
              </div>
              <div className="ovw-row">
                <dt>Responses</dt>
                <dd><b>{totalN}</b>{totalTarget ? <span className="ovw-meta"> of {totalTarget} targeted ({coverage}%)</span> : null}</dd>
              </div>
              <div className="ovw-row">
                <dt>Confidence</dt>
                <dd>
                  {confidence ? <Badge variant="secondary" data-tone={confidence === "High" ? "open" : confidence === "Medium" ? "draft" : "closed"}>{confidence}</Badge> : "—"}
                  <span className="ovw-meta"> coverage {coverage ?? "—"}% · don&apos;t-know {dknaAvg ?? "—"}%</span>
                </dd>
              </div>
            </dl>
          </div>
        )}
      </CardContent>

      <div className="ovw-split">
        <section className="ovw-pane">
          <h3 className="ovw-h3">Response coverage</h3>
          {groups.map((g) => {
            const pct = g.target_n ? Math.min(100, Math.round((g.n / g.target_n) * 100)) : 0;
            return (
              <div key={g.id} className="ovw-cov">
                <div className="ovw-cov-top">
                  <span className="ovw-cov-name">
                    <i className="ovw-dot" style={{ background: GROUP_BAR[g.type] || "var(--primary)" }} />
                    {groupName(g)}
                  </span>
                  <span className="ovw-cov-num">{g.n}{g.target_n ? ` / ${g.target_n}` : ""}</span>
                </div>
                <div className="ovw-track">
                  <div className="ovw-fill" style={{ width: pct + "%", background: GROUP_BAR[g.type] || "var(--primary)" }} />
                </div>
              </div>
            );
          })}
        </section>

        <section className="ovw-pane ovw-pane-right">
          <h3 className="ovw-h3">Top priorities</h3>
          {picks.length === 0 ? (
            <p className="small muted">Priorities appear once results clear the anonymity threshold.</p>
          ) : picks.slice(0, 3).map((k, i) => (
            <div key={i} className="ovw-pri">
              <span className="ovw-num">{i + 1}</span>
              <div>
                <div className="ovw-pri-label">{k.label}</div>
                {k.service ? <Badge variant="outline" data-tone="draft" className="ovw-chip">{k.service}</Badge> : null}
              </div>
            </div>
          ))}
        </section>
      </div>
    </Card>
  );
}
