"use client";
import { useCallback, useEffect, useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { sb, FN_BASE } from "../../../lib/supabase";
import { Shell, I, bandWord, bandOf, groupName } from "../../ui";
import { bestGaps, MIN_N } from "../../lib/gaps";

const PILLAR_ICON = { sii: "chart", iem: "people", oic: "person", ipm: "gear", roi: "pie" };
function csvEsc(v) { const s = String(v ?? ""); return /[",\n]/.test(s) ? '"' + s.replace(/"/g, '""') + '"' : s; }

export default function Interventions() {
  const router = useRouter();
  const [user, setUser] = useState(null);
  const [campaign, setCampaign] = useState(null);
  const [results, setResults] = useState(null);
  const [library, setLibrary] = useState([]);
  const [actions, setActions] = useState([]);
  const [selPillar, setSelPillar] = useState(null); // { kind:'gap'|'band', id }
  const [err, setErr] = useState("");
  const [busy, setBusy] = useState(false);
  const [ownerEdit, setOwnerEdit] = useState(null); // string while editing
  const [msEdit, setMsEdit] = useState(null);

  const loadActions = useCallback(async (cid) => {
    const { data } = await sb().from("fs_actions").select("*").eq("campaign_id", cid).order("created_at");
    setActions(data || []);
  }, []);

  useEffect(() => {
    (async () => {
      const { data: u } = await sb().auth.getUser();
      if (!u.user) { router.replace("/login"); return; }
      setUser(u.user);
      const { data: cs } = await sb().from("fs_campaigns")
        .select("id, name, status, created_at").order("created_at", { ascending: false });
      const target = (cs || []).find((c) => c.status === "open") || (cs || [])[0];
      if (!target) { setErr("No campaigns yet."); return; }
      setCampaign(target);
      const { data: sess } = await sb().auth.getSession();
      const jwt = sess.session?.access_token;
      try {
        const [r, lib] = await Promise.all([
          fetch(`${FN_BASE}/fs-results?campaign_id=${target.id}&detail=1`, { headers: { Authorization: `Bearer ${jwt}` } }),
          sb().from("fs_interventions").select("*"),
        ]);
        if (r.ok) setResults(await r.json());
        setLibrary(lib.data || []);
        await loadActions(target.id);
      } catch { setErr("Could not load results."); }
    })();
  }, [router, loadActions]);

  if (err) return (<Shell active="insights" user={user}><div className="err">{err}</div></Shell>);
  if (!campaign || !results) return (<Shell active="insights" user={user}><p className="muted">Loading…</p></Shell>);

  const pillars = results.pillars || [];
  const pillarById = Object.fromEntries(pillars.map((p) => [p.id, p]));
  const visible = (results.groups || []).filter((g) => !g.suppressed);
  const overall = results.overall && !results.overall.suppressed ? results.overall : null;
  const nameOfType = (t) => groupName((results.groups || []).find((g) => g.type === t)) || t;

  // F2 + F7: largest reliable shared-question gap per pillar, any pair, either direction
  const gapMap = bestGaps(results.questions, pillars, visible);
  const gaps = pillars.map((p) => {
    const e = gapMap[p.id];
    if (!e) return null;
    const entry = library.find((x) => x.trigger_type === "gap" && x.pillar === p.id && e.d >= Number(x.gap_min || 20));
    return entry ? { p, ...e, hiName: nameOfType(e.hiType), loName: nameOfType(e.loType), entry } : null;
  }).filter(Boolean).sort((x, y) => y.d - x.d);

  // baseline band opportunities (overall pillars, weakest first, excluding high band)
  const opps = overall ? pillars
    .map((p) => ({ p, v: overall.pillars?.[p.id] }))
    .filter((x) => x.v != null && x.v < 70)
    .sort((a, b) => a.v - b.v)
    .map(({ p, v }) => ({ p, v, entry: library.find((e) => e.trigger_type === "band" && e.pillar === p.id && e.band === bandOf(v)) }))
    .filter((o) => o.entry) : [];

  const smallGroups = visible.filter((g) => g.n < MIN_N);

  const sel = selPillar
    || (gaps.length ? { kind: "gap", id: gaps[0].p.id } : (opps.length ? { kind: "band", id: opps[0].p.id } : null));
  const cur = sel?.kind === "gap" ? gaps.find((g) => g.p.id === sel.id) : opps.find((o) => o.p.id === sel.id);
  const curEntry = cur?.entry || null;
  const curPillar = cur ? cur.p : null;
  const priorityIndex = sel?.kind === "gap" ? gaps.findIndex((g) => g.p.id === sel.id) + 1 : null;

  const actFor = (idx) => actions.find((a) => a.intervention_id === curEntry?.id && a.action_index === idx);
  const milestones = actions.filter((a) => a.is_milestone && a.pillar === curPillar?.id);
  const planned = actions.some((a) => !a.is_milestone);
  const savedOwner = actions.find((a) => a.intervention_id === curEntry?.id && a.owner)?.owner || null;

  async function ensureRow(idx, patch = {}) {
    if (!curEntry || !curPillar) return;
    const existing = actFor(idx);
    if (existing) {
      await sb().from("fs_actions").update({ ...patch, updated_at: new Date().toISOString() }).eq("id", existing.id);
    } else {
      await sb().from("fs_actions").insert({
        campaign_id: campaign.id, pillar: curPillar.id, intervention_id: curEntry.id,
        action_index: idx, title: (curEntry.actions || [])[idx] || "", created_by: user.id,
        ...patch,
      });
    }
    await loadActions(campaign.id);
  }
  async function cycleStatus(idx) {
    const cur = actFor(idx)?.status || "not_started";
    const next = cur === "not_started" ? "in_progress" : cur === "in_progress" ? "done" : "not_started";
    await ensureRow(idx, { status: next });
  }
  async function toggleDone(idx, checked) {
    await ensureRow(idx, { status: checked ? "done" : "not_started" });
  }
  async function addAllToPlan() {
    setBusy(true);
    const rows = [];
    for (const g of gaps) (g.entry.actions || []).forEach((t, i) => {
      if (!actions.some((a) => a.intervention_id === g.entry.id && a.action_index === i))
        rows.push({ campaign_id: campaign.id, pillar: g.p.id, intervention_id: g.entry.id, action_index: i, title: t, created_by: user.id });
    });
    for (const o of opps) (o.entry.actions || []).forEach((t, i) => {
      if (!actions.some((a) => a.intervention_id === o.entry.id && a.action_index === i))
        rows.push({ campaign_id: campaign.id, pillar: o.p.id, intervention_id: o.entry.id, action_index: i, title: t, created_by: user.id });
    });
    if (rows.length) {
      const { error } = await sb().from("fs_actions").insert(rows);
      if (error) setErr(error.message);
    }
    await loadActions(campaign.id);
    setBusy(false);
  }
  async function saveOwner() {
    if (!curEntry) return;
    setBusy(true);
    for (let i = 0; i < (curEntry.actions || []).length; i++) await ensureRow(i, { owner: ownerEdit || null });
    setOwnerEdit(null); setBusy(false);
  }
  async function saveMilestone() {
    if (!msEdit?.trim() || !curPillar) { setMsEdit(null); return; }
    setBusy(true);
    await sb().from("fs_actions").insert({
      campaign_id: campaign.id, pillar: curPillar.id, title: msEdit.trim(),
      is_milestone: true, created_by: user.id,
    });
    await loadActions(campaign.id);
    setMsEdit(null); setBusy(false);
  }
  function exportRoadmap() {
    const rows = [["Priority", "Type", "Pillar", "Groups compared", "Action / milestone", "Status", "Owner", "Horizon", "Measure", "ISO readiness", "Services"]];
    gaps.forEach((g, gi) => (g.entry.actions || []).forEach((t, i) => {
      const a = actions.find((x) => x.intervention_id === g.entry.id && x.action_index === i);
      rows.push([gi + 1, "Perception gap", g.p.short, `${g.hiName} ${g.hi} vs ${g.loName} ${g.lo} (${g.items} shared Qs)`, t, a?.status || "not_started", a?.owner || g.entry.owner_suggestion, g.entry.horizon, g.entry.kpi, g.entry.iso_map, (g.entry.services || []).join("; ")]);
    }));
    opps.forEach((o) => (o.entry.actions || []).forEach((t, i) => {
      const a = actions.find((x) => x.intervention_id === o.entry.id && x.action_index === i);
      rows.push(["—", `Band (${bandWord(o.v)})`, o.p.short, "All groups", t, a?.status || "not_started", a?.owner || o.entry.owner_suggestion, o.entry.horizon, o.entry.kpi, o.entry.iso_map, (o.entry.services || []).join("; ")]);
    }));
    actions.filter((a) => a.is_milestone).forEach((a) => {
      rows.push(["—", "Milestone", pillarById[a.pillar]?.short || a.pillar, "", a.title, a.status, a.owner || "", "", "", "", ""]);
    });
    const csv = rows.map((r) => r.map(csvEsc).join(",")).join("\r\n");
    const blob = new Blob(["﻿" + csv], { type: "text/csv;charset=utf-8" });
    const aEl = document.createElement("a");
    aEl.href = URL.createObjectURL(blob);
    aEl.download = `${campaign.name.replace(/[^\w]+/g, "-")}-roadmap.csv`;
    aEl.click();
  }

  const horizonBig = curEntry?.horizon?.match(/(\d+)\s*-?\s*day/gi)?.pop()?.match(/\d+/)?.[0];

  return (
    <Shell active="insights" user={user}>
      <div className="crumbs"><Link href="/insights">Insights</Link> / <b>{campaign.name}</b></div>
      <div className="pagehead">
        <div>
          <h1>Recommended interventions</h1>
          <p className="lead">Drawn from the approved InnoPulse intervention library — triggered by this campaign&apos;s scores and stakeholder gaps (compared on shared questions only), not generated ad hoc.</p>
        </div>
        <div style={{ display: "flex", gap: 10, flexWrap: "wrap" }}>
          <button className="btn btn-ghost" onClick={exportRoadmap}>⭱ Export roadmap</button>
          <button className="btn btn-primary" disabled={busy || planned} onClick={addAllToPlan}>
            {planned ? "In action plan ✓" : "+ Add to action plan"}
          </button>
        </div>
      </div>

      <div className="stats">
        <div className="stat"><span className="ic c-red"><I.info /></span><div>
          <div className="k">Critical perception gaps</div><div className="v">{gaps.length}</div>
          <span className="small muted">pillar{gaps.length === 1 ? "" : "s"}</span>
        </div></div>
        <div className="stat"><span className="ic c-red"><I.chart /></span><div>
          <div className="k">Highest gap</div><div className="v">{gaps[0] ? `${gaps[0].d} pts` : "—"}</div>
          <span className="small muted">{gaps[0] ? `${gaps[0].p.short} · ${gaps[0].hiName} vs ${gaps[0].loName}` : "needs two comparable groups"}</span>
        </div></div>
        <div className="stat"><span className="ic c-teal"><I.doc /></span><div>
          <div className="k">Recommended horizon</div><div className="v">{horizonBig ? `${horizonBig} days` : "—"}</div>
          <span className="small muted">to re-measure</span>
        </div></div>
        <div className="stat"><span className="ic c-green"><I.person /></span><div>
          <div className="k">Primary owner</div>
          <div style={{ fontWeight: 800, fontSize: 16, lineHeight: 1.3 }}>{savedOwner || curEntry?.owner_suggestion || "—"}</div>
        </div></div>
      </div>

      {smallGroups.length ? (
        <p className="small" style={{ margin: "0 0 14px", color: "var(--amber, #b7791f)" }}>
          ⚠ Small samples ({smallGroups.map((g) => `${groupName(g)} n=${g.n}`).join(", ")}) — treat gap-driven
          priorities as indicative until groups reach {MIN_N}+ responses.
        </p>
      ) : null}

      {!cur ? (
        <div className="card"><p className="muted">Recommendations appear once at least two stakeholder groups clear the anonymity threshold with enough shared questions to compare fairly.</p></div>
      ) : (
        <div style={{ display: "grid", gridTemplateColumns: "minmax(0,2fr) minmax(280px,1fr)", gap: 18, alignItems: "start" }} className="ivgrid">
          <style>{`@media(max-width:1020px){.ivgrid{grid-template-columns:1fr!important}}`}</style>

          <div>
            <div className="card">
              <div style={{ display: "flex", alignItems: "center", gap: 12, flexWrap: "wrap" }}>
                <span className="numchip">{priorityIndex || "•"}</span>
                <h2 style={{ margin: 0, fontSize: 20 }}>{sel.kind === "gap" ? `Priority ${priorityIndex}` : "Opportunity"} · {curPillar.short}</h2>
                <span className={"pill " + (sel.kind === "gap" ? "closed" : "draft")} style={{ textTransform: "uppercase" }}>
                  {sel.kind === "gap" ? "Perception gap" : `${bandWord(cur.v)} band`}
                </span>
                {sel.kind === "gap"
                  ? <span className="small muted">{cur.hiName} {cur.hi} vs {cur.loName} {cur.lo} · {cur.items} shared questions</span>
                  : <span className="small muted">Overall {cur.v}</span>}
              </div>

              {sel.kind === "gap" ? (
                <div style={{ display: "flex", alignItems: "center", gap: 14, margin: "16px 0 6px" }}>
                  <span className="small" style={{ fontWeight: 800, color: "var(--band-low)" }}>{cur.loName} {cur.lo}</span>
                  <div className="gbar">
                    <span className="cap" style={{ left: cur.lo + "%", background: "var(--primary)" }} />
                    <span className="cap" style={{ left: cur.hi + "%", background: "var(--band-high)" }} />
                  </div>
                  <span className="small" style={{ fontWeight: 800, color: "var(--band-high)" }}>{cur.hiName} {cur.hi}</span>
                  <span style={{ fontWeight: 800, fontSize: 22, color: "var(--primary)", whiteSpace: "nowrap" }}>{cur.d}<div className="small muted" style={{ fontWeight: 600 }}>point gap</div></span>
                </div>
              ) : null}

              <p className="small" style={{ margin: "12px 0" }}>{curEntry.summary}</p>

              {(curEntry.actions || []).map((t, i) => {
                const a = actFor(i);
                const st = a?.status || "not_started";
                return (
                  <div className="act" key={i}>
                    <input type="checkbox" checked={st === "done"} onChange={(e) => toggleDone(i, e.target.checked)} />
                    <span className="numchip sm" style={{ background: "transparent", color: "var(--primary)", border: "none", fontSize: 15 }}>{i + 1}.</span>
                    <span className="txt">{t}</span>
                    <button className={"stchip " + st} onClick={() => cycleStatus(i)}>
                      {st === "not_started" ? "Not started" : st === "in_progress" ? "In progress" : "Done"}
                    </button>
                  </div>
                );
              })}
              {milestones.map((m) => (
                <div className="act" key={m.id} style={{ borderStyle: "dashed" }}>
                  <input type="checkbox" checked={m.status === "done"} onChange={async (e) => { await sb().from("fs_actions").update({ status: e.target.checked ? "done" : "not_started" }).eq("id", m.id); loadActions(campaign.id); }} />
                  <span className="small" style={{ fontWeight: 800, color: "var(--muted)" }}>⚑</span>
                  <span className="txt">{m.title}</span>
                  <span className={"stchip " + m.status} style={{ cursor: "default" }}>{m.status === "done" ? "Done" : "Milestone"}</span>
                </div>
              ))}
            </div>

            {gaps.length > 1 ? (
              <div className="card">
                <h2>Remaining perception-gap priorities</h2>
                {gaps.map((g, gi) => (sel.kind === "gap" && g.p.id === sel.id) ? null : (
                  <div className="prow" key={g.p.id} onClick={() => setSelPillar({ kind: "gap", id: g.p.id })}>
                    <span className="numchip sm">{gi + 1}</span>
                    <span className="nm">{g.p.short}</span>
                    <span className="small muted">{g.loName}</span><span className="v" style={{ color: "var(--band-low)" }}>{g.lo}</span>
                    <div className="gbar" style={{ maxWidth: 220 }}>
                      <span className="cap" style={{ left: g.lo + "%", background: "var(--primary)", width: 10, height: 10 }} />
                      <span className="cap" style={{ left: g.hi + "%", background: "var(--band-high)", width: 10, height: 10 }} />
                    </div>
                    <span className="small muted">{g.hiName}</span><span className="v">{g.hi}</span>
                    <span className="pts">{g.d} pts</span>
                    <span className="pill draft">{g.entry.impact || "High"} impact</span>
                    <span className="muted">›</span>
                  </div>
                ))}
              </div>
            ) : null}
          </div>

          <div>
            <div className="card">
              <h2>Execution plan</h2>
              <div className="kv"><span className="k"><I.person />Owner</span>
                {ownerEdit === null ? (
                  <span>{savedOwner || curEntry.owner_suggestion}</span>
                ) : (
                  <span style={{ display: "flex", gap: 6, flex: 1 }}>
                    <input type="text" value={ownerEdit} onChange={(e) => setOwnerEdit(e.target.value)} placeholder={curEntry.owner_suggestion} />
                    <button className="btn btn-primary btn-sm" disabled={busy} onClick={saveOwner}>Save</button>
                  </span>
                )}
              </div>
              <div className="kv"><span className="k"><I.doc />Horizon</span><span>{curEntry.horizon}</span></div>
              <div className="kv"><span className="k"><I.chart />Effort</span><span className="pill draft">{curEntry.effort}</span></div>
              <div className="kv"><span className="k"><I.chart />Impact</span><span className="pill open">{curEntry.impact}</span></div>
              <div className="kv"><span className="k"><I.pie />Measure</span><span className="small">{curEntry.kpi}</span></div>
              <div className="kv" style={{ borderBottom: "none" }}><span className="k"><I.shield />ISO readiness</span><span className="small">{curEntry.iso_map}</span></div>
              <div style={{ margin: "8px 0 14px" }}>
                {(curEntry.services || []).map((s, i) => <span className="tagchip" key={i}>{s}</span>)}
              </div>
              <div style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>
                <button className="btn btn-primary btn-sm" onClick={() => setOwnerEdit(savedOwner || "")}>Assign owner</button>
                {msEdit === null ? (
                  <button className="btn btn-ghost btn-sm" onClick={() => setMsEdit("")}>⚑ Add milestone</button>
                ) : (
                  <span style={{ display: "flex", gap: 6, width: "100%", marginTop: 8 }}>
                    <input type="text" value={msEdit} onChange={(e) => setMsEdit(e.target.value)} placeholder="e.g. Listening sessions completed by 15 Aug" />
                    <button className="btn btn-primary btn-sm" disabled={busy} onClick={saveMilestone}>Add</button>
                  </span>
                )}
              </div>
            </div>

            {opps.length ? (
              <div className="card">
                <h2>Baseline improvement opportunities</h2>
                {opps.map((o) => {
                  const Icon = I[PILLAR_ICON[o.p.id]] || I.chart;
                  return (
                    <div className="opp" key={o.p.id} onClick={() => setSelPillar({ kind: "band", id: o.p.id })}>
                      <span className="chip c-green" style={{ width: 40, height: 40, flex: "0 0 40px" }}><Icon style={{ width: 18, height: 18 }} /></span>
                      <span className="nm">{o.p.short}</span>
                      <span style={{ fontWeight: 800 }}>{o.v}</span>
                      <span className="small muted">· {bandWord(o.v)}</span>
                      <span className="muted">›</span>
                    </div>
                  );
                })}
              </div>
            ) : null}
          </div>
        </div>
      )}
    </Shell>
  );
}
