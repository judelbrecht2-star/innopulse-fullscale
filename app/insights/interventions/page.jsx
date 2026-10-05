"use client";
import { csvEsc } from "../../lib/csv";
import { useCallback, useEffect, useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { sb, FN_BASE } from "../../../lib/supabase";
import { Shell, I, bandWord, bandOf, groupName } from "../../ui";
import { bestGaps, MIN_N } from "../../lib/gaps";
import { outcomeAssessment, OUTCOME_STATUS } from "../../lib/outcomes";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Badge } from "@/components/ui/badge";
import { Download } from "iconoir-react";
import { Check, Plus, WarningTriangle } from "iconoir-react";

const PILLAR_ICON = { sii: "chart", iem: "people", oic: "person", ipm: "gear", roi: "pie" };

import { listOrgCampaigns } from "../../lib/campaign-data";
import { defaultCampaign, requestedCampaignId, setCampaignUrl, campaignHref } from "../../lib/campaign-context";
import CampaignWorkflow from "../../components/campaign-workflow";
import { NativeSelect, NativeSelectOption } from "@/components/ui/native-select";

export default function Interventions() {
  const router = useRouter();
  const [user, setUser] = useState(null);
  const [campaigns, setCampaigns] = useState([]);
  const [selCampaign, setSelCampaign] = useState("");
  const [campaign, setCampaign] = useState(null);
  const [results, setResults] = useState(null);
  const [library, setLibrary] = useState([]);
  const [actions, setActions] = useState([]);
  const [outcomes, setOutcomes] = useState([]);
  const [selPillar, setSelPillar] = useState(null); // { kind:'gap'|'band', id }
  const [err, setErr] = useState("");
  const [saveError, setSaveError] = useState("");
  const [busy, setBusy] = useState(false);
  const [ownerEdit, setOwnerEdit] = useState(null); // string while editing
  const [msEdit, setMsEdit] = useState(null);

  const loadActions = useCallback(async (cid) => {
    const [plan, learned] = await Promise.all([
      sb().from("fs_actions").select("*").eq("campaign_id", cid).order("created_at"),
      sb().from("fs_intervention_outcomes").select("*").eq("campaign_id", cid).order("updated_at", { ascending: false }),
    ]);
    if (plan.error || learned.error) throw plan.error || learned.error;
    setActions(plan.data || []);
    setOutcomes(learned.data || []);
  }, []);

  useEffect(() => {
    (async () => {
      try {
        const { data: u } = await sb().auth.getUser();
        if (!u.user) { router.replace("/login"); return; }
        setUser(u.user);
        const { campaigns: cs } = await listOrgCampaigns(u.user.id, "id, name, status, created_at, is_sandbox");
        setCampaigns(cs);
        const target = defaultCampaign(cs, requestedCampaignId());
        if (!target) { setErr("No campaigns yet. Create a campaign and collect responses before planning actions."); return; }
        setSelCampaign(target.id);
      } catch (ex) { setErr(ex.message || "Could not load campaigns."); }
    })();
  }, [router]);

  useEffect(() => {
    if (!selCampaign) return;
    const controller = new AbortController();
    setCampaign(campaigns.find((c) => c.id === selCampaign));
    setResults(null); setActions([]); setOutcomes([]); setSelPillar(null); setOwnerEdit(null); setMsEdit(null); setErr(""); setSaveError("");
    (async () => {
      try {
        const { data: sess } = await sb().auth.getSession();
        const jwt = sess.session?.access_token;
        if (!jwt) throw new Error("Your session expired. Sign in again to view actions.");
        const [r, lib, plan, learned] = await Promise.all([
          fetch(`${FN_BASE}/fs-results?campaign_id=${selCampaign}&detail=1`, { signal: controller.signal, headers: { Authorization: `Bearer ${jwt}` } }),
          sb().from("fs_interventions").select("*"),
          sb().from("fs_actions").select("*").eq("campaign_id", selCampaign).order("created_at"),
          sb().from("fs_intervention_outcomes").select("*").eq("campaign_id", selCampaign).order("updated_at", { ascending: false }),
        ]);
        if (!r.ok) throw new Error("Could not load campaign results. Please try again.");
        if (lib.error || plan.error || learned.error) throw lib.error || plan.error || learned.error;
        const data = await r.json();
        if (controller.signal.aborted) return;
        setResults(data); setLibrary(lib.data || []); setActions(plan.data || []); setOutcomes(learned.data || []);
      } catch (ex) { if (!controller.signal.aborted) setErr(ex.message || "Could not load results."); }
    })();
    return () => controller.abort();
  }, [selCampaign, campaigns]);

  if (err) return (<Shell active="insights" user={user} campaignId={selCampaign}><div role="alert" className="err">{err}</div><Button variant="outline" onClick={() => window.location.reload()}>Try again</Button></Shell>);
  if (!campaign || !results) return (<Shell active="insights" user={user} campaignId={selCampaign}><p className="muted">Loading…</p></Shell>);

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
    return entry ? { p, ...e, hiName: (e.hiLabel || nameOfType(e.hiType)), loName: (e.loLabel || nameOfType(e.loType)), entry } : null;
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
  const curOutcome = outcomes.find((outcome) => outcome.intervention_id === curEntry?.id) || null;
  const baselineScore = curOutcome?.baseline_score ?? (curPillar ? overall?.pillars?.[curPillar.id] : null) ?? "";
  const learned = curOutcome ? outcomeAssessment({
    baseline: curOutcome.baseline_score,
    target: curOutcome.target_score,
    observed: curOutcome.observed_score,
    reviewDueAt: curOutcome.review_due_at,
  }) : null;
  const priorityIndex = sel?.kind === "gap" ? gaps.findIndex((g) => g.p.id === sel.id) + 1 : null;

  const actFor = (idx) => actions.find((a) => a.intervention_id === curEntry?.id && a.action_index === idx);
  const milestones = actions.filter((a) => a.is_milestone && a.pillar === curPillar?.id);
  const recommended = [...gaps, ...opps].flatMap((o) => (o.entry.actions || []).map((_, index) => ({ intervention: o.entry.id, index })));
  const planned = recommended.length > 0 && recommended.every((r) => actions.some((a) => a.intervention_id === r.intervention && a.action_index === r.index));
  const savedOwner = actions.find((a) => a.intervention_id === curEntry?.id && a.owner)?.owner || null;

  async function saveChange(work) {
    if (busy) return;
    setBusy(true); setSaveError("");
    try { await work(); await loadActions(campaign.id); }
    catch (ex) { setSaveError("Could not confirm your changes were saved. " + (ex.message || "Please try again.")); }
    finally { setBusy(false); }
  }
  async function ensureRow(idx, patch = {}) {
    if (!curEntry || !curPillar) return;
    const existing = actFor(idx);
    const response = existing
      ? await sb().from("fs_actions").update({ ...patch, updated_at: new Date().toISOString() }).eq("id", existing.id).eq("campaign_id", campaign.id)
      : await sb().from("fs_actions").insert({
          campaign_id: campaign.id, pillar: curPillar.id, intervention_id: curEntry.id,
          action_index: idx, title: (curEntry.actions || [])[idx] || "", created_by: user.id, ...patch,
        });
    if (response.error) throw response.error;
  }
  async function cycleStatus(idx) {
    const current = actFor(idx)?.status || "not_started";
    const next = current === "not_started" ? "in_progress" : current === "in_progress" ? "done" : "not_started";
    await saveChange(() => ensureRow(idx, { status: next }));
  }
  async function toggleDone(idx, checked) {
    await saveChange(() => ensureRow(idx, { status: checked ? "done" : "not_started" }));
  }
  async function addAllToPlan() {
    await saveChange(async () => {
      const rows = [];
      for (const opportunity of [...gaps, ...opps]) (opportunity.entry.actions || []).forEach((title, index) => {
        if (!actions.some((a) => a.intervention_id === opportunity.entry.id && a.action_index === index)
            && !rows.some((a) => a.intervention_id === opportunity.entry.id && a.action_index === index)) {
          rows.push({ campaign_id: campaign.id, pillar: opportunity.p.id, intervention_id: opportunity.entry.id, action_index: index, title, created_by: user.id });
        }
      });
      if (rows.length) {
        const { error } = await sb().from("fs_actions").insert(rows);
        if (error) throw error;
      }
    });
  }
  async function saveOwner() {
    if (!curEntry) return;
    await saveChange(async () => {
      for (let i = 0; i < (curEntry.actions || []).length; i++) await ensureRow(i, { owner: ownerEdit?.trim() || null });
      setOwnerEdit(null);
    });
  }
  async function saveMilestone() {
    if (!msEdit?.trim() || !curPillar) { setMsEdit(null); return; }
    await saveChange(async () => {
      const { error } = await sb().from("fs_actions").insert({
        campaign_id: campaign.id, pillar: curPillar.id, title: msEdit.trim(),
        is_milestone: true, created_by: user.id,
      });
      if (error) throw error;
      setMsEdit(null);
    });
  }
  async function toggleMilestone(milestone, checked) {
    await saveChange(async () => {
      const { error } = await sb().from("fs_actions").update({ status: checked ? "done" : "not_started" })
        .eq("id", milestone.id).eq("campaign_id", campaign.id);
      if (error) throw error;
    });
  }
  async function saveOutcome(event) {
    event.preventDefault();
    if (!curEntry || !curPillar) return;
    const form = new FormData(event.currentTarget);
    const baseline = form.get("baseline_score");
    const target = form.get("target_score");
    const observed = form.get("observed_score");
    const reviewDueAt = String(form.get("review_due_at") || "") || null;
    const assessment = outcomeAssessment({ baseline, target, observed, reviewDueAt });
    const payload = {
      campaign_id: campaign.id,
      intervention_id: curEntry.id,
      pillar: curPillar.id,
      kpi: curEntry.kpi || null,
      baseline_score: baseline === "" ? null : Number(baseline),
      target_score: target === "" ? null : Number(target),
      observed_score: observed === "" ? null : Number(observed),
      review_due_at: reviewDueAt,
      observed_at: observed === "" ? null : new Date().toISOString(),
      status: assessment.status,
      learning_note: String(form.get("learning_note") || "").trim().slice(0, 2000) || null,
      created_by: curOutcome?.created_by || user.id,
      updated_at: new Date().toISOString(),
    };
    await saveChange(async () => {
      const { error } = await sb().from("fs_intervention_outcomes").upsert(payload, { onConflict: "campaign_id,intervention_id" });
      if (error) throw error;
    });
  }
  function exportRoadmap() {
    const rows = [["Priority", "Type", "Pillar", "Groups compared", "Action / milestone", "Status", "Owner", "Horizon", "Measure", "ISO readiness", "Services", "Outcome status", "Baseline score", "…21153 tokens truncated…{
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
  // soft row tint + solid left edge per stakeholder group
  const GROUP_TINT = {
    executive: "rgba(232,51,46,.045)", employee: "rgba(14,140,140,.055)",
    customer: "rgba(183,121,31,.06)", partner: "rgba(49,110,180,.055)", other: "rgba(122,90,190,.055)",
  };

  if (initialLoading || detailsLoading || !campaigns.length || err) return <Shell active="responses" user={user} campaignId={sel}><DataState loading={initialLoading || detailsLoading} error={err} empty={!campaigns.length} retry={() => window.location.reload()} /></Shell>;

  return (
    <Shell active="responses" user={user} campaignId={sel}>
      <CampaignWorkflow campaign={campaign} active="responses" />
      <div className="crumbs">Responses / <b>{campaign?.name || "—"}</b></div>
      <div className="pagehead">
        <div>
          <h1>Responses</h1>
          <p className="lead">Monitor participation, review data quality and read written feedback from each stakeholder group.</p>
        </div>
        <div style={{ display: "flex", gap: 10, flexWrap: "wrap" }}>
          <Button variant="ghost" onClick={() => exportCsv(false)}><Download className="inline size-4 -mt-0.5" /> Export responses</Button>
          <Button disabled={!canManage} title={canManage ? "" : "Owners and managers only"}
            onClick={() => { setRemOpen((v) => !v); if (!remGroup && groups.length) setRemGroup(groups[0].id); }}>✈ Send reminders</Button>
          <NativeSelect aria-label="Campaign" value={sel} disabled={busy} onChange={(e) => { setCampaignUrl(e.target.value); setSel(e.target.value); }} style={{ width: "auto", fontWeight: 600 }}>
            {campaigns.map((c) => <NativeSelectOption key={c.id} value={c.id}>{c.name}</NativeSelectOption>)}
          </NativeSelect>
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
            <NativeSelect value={remGroup} onChange={(e) => setRemGroup(e.target.value)} style={{ width: "auto" }}>
              {groups.map((g) => <NativeSelectOption key={g.id} value={g.id}>{groupName(g)}</NativeSelectOption>)}
            </NativeSelect>
          </div>
          <label className="f">Email addresses <span className="muted">(comma or new-line separated, max 100)</span></label>
          <Textarea value={remEmails} onChange={(e) => setRemEmails(e.target.value)} placeholder="ana@company.com, ben@company.com" />
          <label className="f">Personal note <span className="muted">(optional)</span></label>
          <Textarea value={remMsg} onChange={(e) => setRemMsg(e.target.value)} placeholder="A short line from you, shown in the email." />
          {remState ? <p className="small" style={{ color: remState.startsWith("Sent") ? "var(--green, #2f855a)" : "var(--primary)" }}>{remState}</p> : null}
          <div style={{ display: "flex", gap: 8, marginTop: 8 }}>
            <Button size="sm" disabled={busy} onClick={async () => {
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
            }}>Send</Button>
            <Button variant="ghost" size="sm" onClick={() => { setRemOpen(false); setRemState(""); }}>Close</Button>
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
              {(() => {
                const gate = gateFor(n, { score: threshold, comment: commentThreshold });
                if (gate === "suppressed") return <span className="privnote"><Lock className="inline size-4 -mt-0.5" /> scores hidden until {threshold} completed</span>;
                if (gate === "scores-only") return <span className="privnote"><Lock className="inline size-4 -mt-0.5" /> comments hidden until {commentThreshold} completed</span>;
                return <span className="privnote" style={{ visibility: "hidden" }}>ok</span>;
              })()}
              <span className="small muted" style={{ width: 110 }}>{lastForGroup ? `last ${ago(lastForGroup.submitted_at)}` : "no responses yet"}</span>
              {link ? (
                <Button variant="ghost" size="sm" onClick={() => copyLink(link.token)}>{copied === link.token ? "Copied" : "Copy link"}</Button>
              ) : <span className="small muted">no active link</span>}
            </div>
          );
        })}
      </div>

      <div className="card">
        <div style={{ display: "flex", gap: 10, flexWrap: "wrap", marginBottom: 12 }}>
          <Input type="text" placeholder="Search response reference or written feedback" value={q}
            onChange={(e) => setQ(e.target.value)} style={{ flex: 1, minWidth: 220 }} />
          <NativeSelect value={fGroup} onChange={(e) => setFGroup(e.target.value)} style={{ width: "auto" }}>
            <NativeSelectOption value="all">All groups</NativeSelectOption>
            {groups.map((g) => <NativeSelectOption key={g.id} value={g.id}>{groupName(g)}</NativeSelectOption>)}
          </NativeSelect>
          <NativeSelect value={fStatus} onChange={(e) => setFStatus(e.target.value)} style={{ width: "auto" }}>
            {["all", "Completed", "In progress", "Not started", "Abandoned", "Excluded", "Test"].map((s) => (
              <NativeSelectOption key={s} value={s}>{s === "all" ? "All statuses" : s}</NativeSelectOption>
            ))}
          </NativeSelect>
          <NativeSelect value={fQuality} onChange={(e) => setFQuality(e.target.value)} style={{ width: "auto" }}>
            {["all", "Good", "Review", "Test"].map((s) => <NativeSelectOption key={s} value={s}>{s === "all" ? "Data quality" : s}</NativeSelectOption>)}
          </NativeSelect>
          <label className="small" style={{ display: "flex", alignItems: "center", gap: 7 }}>
            <input type="checkbox" checked={fComments} onChange={(e) => setFComments(e.target.checked)} /> Has written responses
          </label>
        </div>

        <Table>
          <TableHeader>
            <TableRow>
              <TableHead style={{ width: 30 }}></TableHead>
              <TableHead>Respondent</TableHead><TableHead>Group</TableHead><TableHead>Status</TableHead><TableHead>Progress</TableHead>
              <TableHead>Written</TableHead><TableHead>DK/NA</TableHead><TableHead>Quality</TableHead><TableHead>When</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {filtered.length === 0 ? (
              <TableRow><TableCell colSpan={9} className="muted small">No responses match these filters yet.</TableCell></TableRow>
            ) : filtered.map((row) => (
              <TableRow key={row.id} style={{
                cursor: row.kind === "response" ? "pointer" : "default",
                background: drawer?.id === row.id ? "var(--primary-soft)" : GROUP_TINT[row.group?.type] || undefined,
                boxShadow: row.group ? `inset 3px 0 0 ${GROUP_BAR[row.group.type] || "var(--muted)"}` : undefined,
              }}
                onClick={() => openDrawer(row)}>
                <TableCell onClick={(e) => e.stopPropagation()}>
                  {row.kind === "response" ? (
                    <input type="checkbox" checked={!!checks[row.id]}
                      onChange={(e) => setChecks((s) => ({ ...s, [row.id]: e.target.checked }))} />
                  ) : null}
                </TableCell>
                <TableCell><b>{row.ref}</b></TableCell>
                <TableCell className="small">{groupName(row.group) || "—"}</TableCell>
                <TableCell><span className={"pill " + statusPill(row.status)}>{row.status}</span></TableCell>
                <TableCell className="small">
                  {row.kind === "invite" ? "—" : `${row.answered} / ${row.total || "—"}`}
                  {row.kind !== "invite" && row.total ? (
                    <span className="bar" style={{ display: "inline-block", width: 70, height: 6, background: "#e8e8ec", borderRadius: 99, marginLeft: 8, verticalAlign: "middle", overflow: "hidden" }}>
                      <i style={{ display: "block", height: "100%", width: Math.min(100, Math.round((row.answered / row.total) * 100)) + "%", background: "var(--teal)", borderRadius: 99 }} />
                    </span>
                  ) : null}
                </TableCell>
                <TableCell className="small">{row.nComments ? `${row.nComments} comment${row.nComments === 1 ? "" : "s"}` : "—"}</TableCell>
                <TableCell className="small">{row.dkPct == null ? "—" : row.dkPct + "%"}</TableCell>
                <TableCell>{row.quality ? <span className={"pill " + (row.quality === "Good" ? "open" : row.quality === "Test" ? "violet" : "draft")}>{row.quality}</span> : "—"}</TableCell>
                <TableCell className="small muted">{row.whenLabel}</TableCell>
              </TableRow>
            ))}
          </TableBody>
        </Table>
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
                  <Lock className="inline size-4 -mt-0.5" /> This group has {detail.have} of {detail.needed} responses. To protect
                  respondents in small groups, per-response answers and written feedback stay on the server until the group
                  passes the comment threshold. This applies to every role, including the owner.
                </div>
              );

  return (
                <>
                  <div className="vbanner"><ShieldCheck className="inline size-4 -mt-0.5" /> These are the respondent&apos;s verbatim comments — not an AI summary.</div>

                  <h2 style={{ fontSize: 15, margin: "14px 0 8px" }}>Pillar breakdown</h2>
                  <Table>
                    <TableHeader><TableRow><TableHead>Pillar</TableHead><TableHead>Score</TableHead><TableHead>Answered</TableHead><TableHead>DK/NA</TableHead></TableRow></TableHeader>
                    <TableBody>
                      {(detail.pillars || []).map((d) => (
                        <TableRow key={d.pid}>
                          <TableCell className="small"><b>{PILLAR_NAMES[d.pid] || d.pid}</b></TableCell>
                          <TableCell className="small">{d.score ?? "—"}</TableCell>
                          <TableCell className="small">{d.n}</TableCell>
                          <TableCell className="small">{d.dk}</TableCell>
                        </TableRow>
                      ))}
                    </TableBody>
                  </Table>
                  <p className="small muted" style={{ margin: "6px 0 0" }}>
                    Individual-level view — access is audit-logged, visible only to your team,
                    never to respondents or in reports.
                  </p>

                  <h2 style={{ fontSize: 15, margin: "18px 0 8px" }}>Written responses ({(detail.comments || []).length})</h2>
                  {(detail.comments || []).length === 0 ? <p className="muted small">None left.</p> :
                    (detail.comments || []).map((cm, i) => (
                      <div className="vcard" key={cm.id || i}>
                        <div className="ph">
                          <span className="pn">{PILLAR_NAMES[cm.pillar] || cm.pillar}</span>
                          <span className="tag">Verbatim response</span>
                          {canManage || role === "analyst" ? (
                            <Button variant="ghost" size="sm" disabled={busy} style={{ marginLeft: "auto" }}
                              onClick={async () => {
                                setBusy(true);
                                try {
                                  const { data: sess } = await sb().auth.getSession();
                                  const r = await fetch(`${FN_BASE}/fs-responses-ops`, {
                                    method: "POST",
                                    headers: { "Content-Type": "application/json", Authorization: `Bearer ${sess.session?.access_token}` },
                                    body: JSON.stringify({ action: "flag_comment", campaign_id: sel, comment_id: cm.id, in_report: !cm.in_report }),
                                  });
                                  const j = await r.json();
                                  if (r.ok) setDetail((d) => ({ ...d, comments: d.comments.map((x) => x.id === cm.id ? { ...x, in_report: j.in_report } : x) }));
                                  else setErr(j.error || "Could not update.");
                                } catch { setErr("Could not update."); }
                                setBusy(false);
                              }}>
                              {cm.in_report ? "In report — remove" : "Add to report"}
                            </Button>
                          ) : cm.in_report ? <Badge variant="secondary" data-tone="teal" style={{ marginLeft: "auto" }}>In report</Badge> : null}
                        </div>
                        <p>{cm.body}</p>
                        {canManage || role === "analyst" ? (
                          <div style={{ display: "flex", gap: 6, marginTop: 6 }}>
                            <Input type="text" defaultValue={(cm.themes || []).join(", ")} placeholder="Themes, comma-separated — e.g. workload, recognition"
                              style={{ flex: 1, fontSize: 12.5, padding: "5px 9px" }}
                              onBlur={async (e) => {
                                const themes = e.target.value.split(",").map((x) => x.trim()).filter(Boolean);
                                if (themes.join("|") === (cm.themes || []).join("|")) return;
                                try {
                                  const { data: sess } = await sb().auth.getSession();
                                  const r = await fetch(`${FN_BASE}/fs-responses-ops`, {
                                    method: "POST",
                                    headers: { "Content-Type": "application/json", Authorization: `Bearer ${sess.session?.access_token}` },
                                    body: JSON.stringify({ action: "tag_comment", campaign_id: sel, comment_id: cm.id, themes }),
                                  });
                                  const j = await r.json();
                                  if (r.ok) setDetail((d) => ({ ...d, comments: d.comments.map((x) => x.id === cm.id ? { ...x, themes: j.themes } : x) }));
                                  else setErr(j.error || "Could not save themes.");
                                } catch { setErr("Could not save themes."); }
                              }} />
                          </div>
                        ) : (cm.themes || []).length ? (
                          <p className="small muted" style={{ margin: "6px 0 0" }}>Themes: {cm.themes.join(", ")}</p>
                        ) : null}
                      </div>
                    ))}
                  <p className="small muted" style={{ margin: "6px 0 0" }}>
                    &quot;Add to report&quot; marks a verbatim for inclusion in generated reports —
                    always attributed to the stakeholder group only, never to an individual. Themes
                    you type here (saved when you click away) build the evidenced theme tables in
                    each report&apos;s pillar chapters.
                  </p>
                </>
              );
            })()}

            {canManage ? (
              <div style={{ display: "flex", gap: 8, flexWrap: "wrap", marginTop: 18 }}>
                {drawer.r.flag !== "review" ? (
                  <Button variant="ghost" size="sm" disabled={busy} onClick={() => { setRespState([drawer.id], { flag: "review" }); setDrawer(null); }}>⚑ Flag for review</Button>
                ) : (
                  <Button variant="ghost" size="sm" disabled={busy} onClick={() => { setRespState([drawer.id], { flag: null }); setDrawer(null); }}>Clear flag</Button>
                )}
                <Button variant="ghost" size="sm" disabled={busy} onClick={() => { setRespState([drawer.id], { valid: false, flag: "test" }); setDrawer(null); }}>Mark as test</Button>
                {drawer.r.valid ? (
                  <Button size="sm" disabled={busy} onClick={() => { setRespState([drawer.id], { valid: false, flag: null }); setDrawer(null); }}>Exclude from results</Button>
                ) : (
                  <Button size="sm" disabled={busy} onClick={() => { setRespState([drawer.id], { valid: true, flag: null }); setDrawer(null); }}>Restore to results</Button>
                )}
              </div>
            ) : null}
          </div>
        </>
      ) : null}
    </Shell>
  );
}
