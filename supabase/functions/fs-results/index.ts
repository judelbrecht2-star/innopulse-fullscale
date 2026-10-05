// InnoPulse Full-Scale — aggregated results.
//
// v11: complementary suppression.
//
// Hiding a cohort that is too small was only ever half the job. The other half
// is arithmetic. The overall score is published as a weighted mean over every
// answer; each visible group publishes its own mean and its answer counts. If
// exactly one group is hidden, its mean is not hidden at all — it is
//
//     (overall_total − Σ visible_totals) / hidden_count
//
// and anyone with a spreadsheet can run it. The suppression itself leaked the
// number it was protecting. v11 closes that: when hiding one cohort would leave
// it solvable, a second cohort is hidden too, because two unknowns in one
// equation cannot be solved. Under `strong` mode the hidden cohorts must also
// sum to at least the threshold, since two hidden groups totalling three people
// still say almost everything about both.
//
// The same treatment applies to demographic cuts, and there the "not declared"
// residual is part of the partition rather than free information — publishing
// options plus residual plus total is one equation with one unknown whenever a
// single option is hidden.
//
// Ties are broken on the cell key, so the same data always suppresses the same
// cohort. Three groups of five is an ordinary shape; without a deterministic
// rule a regenerated report would disagree with the previous one.
//
// This logic is duplicated from app/lib/suppression.js, which Deno cannot
// import. tests/suppression.test.js is the shared specification, including 800
// generated cases asserting that no non-empty hidden cell is ever derivable.
// Change one, change the other.
//
// v10: thresholds come from fs_campaign_governance. score_threshold gates
// aggregates; comment_threshold gates individual-level content and is returned
// so the UI can explain a lock consistently.
// v9 (P0-5): per-question data keyed by stable group ID, not by group type.
// v8: demographic cuts + legacy segments. v6: distributions. v3: anonymity floor.
import { createClient } from "npm:@supabase/supabase-js@2.112.3";

const ANON_FLOOR = 4;

import { checked, readAll } from "../_shared/query.js";

const CORS: Record<string, string> = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "GET, OPTIONS",
};
const J = (o: unknown, s = 200) => new Response(JSON.stringify(o), { status: s, headers: { ...CORS, "Content-Type": "application/json" } });

/* ---------------------------------------------------------------------------
   Suppression engine — port of app/lib/suppression.js
   --------------------------------------------------------------------------- */
type Cell = { key: string; n: number; suppressed: boolean; reason: string | null; alwaysHidden?: boolean };

function planSuppression(
  input: { key: string; n: number; alwaysHidden?: boolean }[],
  opts: { threshold: number; mode?: string; totalPublished?: boolean },
) {
  const threshold = Math.max(Number(opts.threshold) || 0, ANON_FLOOR);
  const mode = opts.mode === "strong" ? "strong" : "basic";
  const totalPublished = opts.totalPublished !== false;

  const cells: Cell[] = input.map((c) => ({
    key: c.key, n: Math.max(0, Number(c.n) || 0),
    suppressed: false, reason: null, alwaysHidden: !!c.alwaysHidden,
  }));

  // 1. Direct suppression. A cell whose scores are never published (the
  //    "not declared" residual) counts as hidden from the start.
  for (const c of cells) {
    if (c.alwaysHidden) { c.suppressed = true; c.reason = "never_published"; }
    else if (c.n < threshold) { c.suppressed = true; c.reason = "below_threshold"; }
  }

  const hidden = () => cells.filter((c) => c.suppressed);
  const visible = () => cells.filter((c) => !c.suppressed);
  const hiddenSum = () => hidden().reduce((s, c) => s + c.n, 0);

  if (hidden().length === 0 || !totalPublished) {
    return { cells, suppressTotal: false, hiddenSum: hiddenSum(), mode, threshold };
  }

  // Smallest first: it costs the least information and is the most sensitive.
  // Ties break on the key so the choice is reproducible across calls.
  const hideSmallestVisible = (reason: string) => {
    const v = visible();
    if (v.length === 0) return false;
    const smallest = v.reduce((a, b) => {
      if (b.n !== a.n) return b.n < a.n ? b : a;
      return String(b.key) < String(a.key) ? b : a;
    });
    smallest.suppressed = true;
    smallest.reason = reason;
    return true;
  };

  // 2. Basic indirect: one unknown against a published total is solvable.
  while (hidden().length < 2) { if (!hideSmallestVisible("complementary")) break; }

  // 3. Strong indirect: the hidden pool must be large enough to hide in.
  if (mode === "strong") {
    while (hiddenSum() < threshold) { if (!hideSmallestVisible("residual_too_small")) break; }
  }

  const stillSolvable = hidden().length < 2 || (mode === "strong" && hiddenSum() < threshold);
  if (stillSolvable) {
    for (const c of cells) { c.suppressed = true; c.reason = c.reason || "unprotectable"; }
    return { cells, suppressTotal: true, hiddenSum: hiddenSum(), mode, threshold };
  }
  return { cells, suppressTotal: false, hiddenSum: hiddenSum(), mode, threshold };
}

Deno.serve(async (req: Request) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: CORS });
  const url = new URL(req.url);
  const campaignId = url.searchParams.get("campaign_id") || "";
  const wantDetail = url.searchParams.get("detail") === "1";
  if (!campaignId) return J({ error: "Missing campaign_id" }, 400);

  try {
  const admin = createClient(Deno.env.get("SUPABASE_URL")!, Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!, { auth: { autoRefreshToken: false, persistSession: false } });

  const auth = req.headers.get("Authorization") || "";
  const jwt = auth.replace(/^Bearer\s+/i, "");
  const { data: userData, error: uerr } = await admin.auth.getUser(jwt);
  if (uerr || !userData?.user) return J({ error: "Not signed in" }, 401);
  const uid = userData.user.id;

  const { data: campaign } = await checked(admin.from("fs_campaigns").select("id, org_id, name, status, opens_at, closes_at, anonymity_threshold, questionnaire_version_id, segments, demographics").eq("id", campaignId).maybeSingle());
  if (!campaign) return J({ error: "Campaign not found" }, 404);

  const { data: member } = await checked(admin.from("fs_memberships").select("role").eq("org_id", campaign.org_id).eq("user_id", uid).maybeSingle());
  if (!member || !["owner", "manager", "analyst", "viewer"].includes(member.role)) return J({ error: "Not authorised" }, 403);

  const { data: gov } = await checked(admin.from("fs_campaign_governance")
    .select("privacy_profile, score_threshold, comment_threshold, suppression_mode, max_filter_dimensions, raw_export_policy, locked_at")
    .eq("campaign_id", campaignId).maybeSingle());
  const legacy = campaign.anonymity_threshold ?? 5;
  const threshold = Math.max(gov?.score_threshold ?? legacy, ANON_FLOOR);
  const commentThreshold = Math.max(gov?.comment_threshold ?? threshold, threshold);
  const mode = gov?.suppression_mode === "strong" ? "strong" : "basic";

  const { data: org } = await checked(admin.from("fs_orgs").select("name").eq("id", campaign.org_id).maybeSingle());
  const { data: qv } = await checked(admin.from("fs_questionnaire_versions").select("version, definition").eq("id", campaign.questionnaire_version_id).maybeSingle());
  const def = qv?.definition as any;
  const pillarOfQ: Record<string, string> = {};
  for (const p of def.pillars) for (const q of p.questions) pillarOfQ[q.key] = p.id;
  const pillarMeta = def.pillars.map((p: any) => ({ id: p.id, short: p.short, name: p.name, weight: p.weight }));
  const scaleCodes: string[] = (def.scale || []).map((s: any) => s.code);

  const { data: groups } = await readAll(() => admin.from("fs_groups").select("id, type, label, target_n").eq("campaign_id", campaignId));
  const { data: responses } = await readAll(() => admin.from("fs_responses").select("id, group_id, segment, demo").eq("campaign_id", campaignId).eq("valid", true));
  const respIds = (responses || []).map((r) => r.id);
  const groupOfResp: Record<string, string> = {};
  const demoOfResp: Record<string, any> = {};
  for (const r of responses || []) {
    groupOfResp[r.id] = r.group_id;
    demoOfResp[r.id] = { ...(r.demo || {}), ...(r.segment && !(r.demo || {}).department ? { department: r.segment } : {}) };
  }

  let answers: any[] = [];
  for (let i = 0; i < respIds.length; i += 40) {
    const chunk = respIds.slice(i, i + 40);
    const { data: a } = await readAll(() => admin.from("fs_answers").select("response_id, question_key, choice, value, not_scored").in("response_id", chunk));
    answers = answers.concat(a || []);
  }

  const byGroup: Record<string, any> = {};
  for (const g of groups || []) byGroup[g.id] = { id: g.id, type: g.type, label: g.label, target_n: g.target_n, n: 0, dkna: 0, scored: 0 };
  for (const r of responses || []) if (byGroup[r.group_id]) byGroup[r.group_id].n++;

  const dims: any[] = Array.isArray(campaign.demographics) ? campaign.demographics : [];
  const segNames: string[] = Array.isArray(campaign.segments) ? campaign.segments : [];
  const cutDims: any[] = dims.slice();
  if (segNames.length && !dims.some((d: any) => d.id === "department")) {
    cutDims.push({ id: "department", label: "Segment", options: segNames, __legacy: true });
  }

  const acc: Record<string, Record<string, { sum: number; c: number }>> = {};
  const qacc: Record<string, Record<string, { sum: number; ss: number; c: number; dk: number; dist: Record<string, number> }>> = {};
  const dN: Record<string, number> = {};
  const dAcc: Record<string, Record<string, { sum: number; c: number }>> = {};
  for (const r of responses || []) {
    const d = demoOfResp[r.id];
    for (const dim of cutDims) if (d[dim.id]) dN[dim.id + "\0" + d[dim.id]] = (dN[dim.id + "\0" + d[dim.id]] || 0) + 1;
  }
  for (const a of answers) {
    const g = groupOfResp[a.response_id]; if (!g || !byGroup[g]) continue;
    const p = pillarOfQ[a.question_key]; if (!p) continue;
    byGroup[g].scored++;
    qacc[g] = qacc[g] || {}; qacc[g][a.question_key] = qacc[g][a.question_key] || { sum: 0, ss: 0, c: 0, dk: 0, dist: {} };
    const e = qacc[g][a.question_key];
    if (a.choice) e.dist[a.choice] = (e.dist[a.choice] || 0) + 1;
    if (a.not_scored || a.value === null) { byGroup[g].dkna++; e.dk++; continue; }
    acc[g] = acc[g] || {}; acc[g][p] = acc[g][p] || { sum: 0, c: 0 };
    acc[g][p].sum += Number(a.value); acc[g][p].c++;
    e.sum += Number(a.value); e.ss += Number(a.value) * Number(a.value); e.c++;
    const d = demoOfResp[a.response_id];
    for (const dim of cutDims) {
      const v = d[dim.id]; if (!v) continue;
      const k = dim.id + "\0" + v;
      dAcc[k] = dAcc[k] || {}; dAcc[k][p] = dAcc[k][p] || { sum: 0, c: 0 };
      dAcc[k][p].sum += Number(a.value); dAcc[k][p].c++;
    }
  }

  const totalN = (responses || []).length;
  const overallPublished = totalN >= threshold;

  // ---- Group suppression, including complementary -------------------------
  // Groups partition the campaign total, and the overall score is published, so
  // a lone hidden group is derivable. planSuppression decides who else must go.
  const groupPlan = planSuppression(
    Object.values(byGroup).map((g: any) => ({ key: g.id, n: g.n })),
    { threshold, mode, totalPublished: overallPublished },
  );
  const groupCell: Record<string, Cell> = {};
  for (const c of groupPlan.cells) groupCell[c.key] = c;

  const overall: Record<string, { sum: number; c: number }> = {};
  const groupsOut = Object.values(byGroup).map((g: any) => {
    const cell = groupCell[g.id];
    // The overall figure accumulates every group's answers whether or not that
    // group's own scores are released — otherwise the published total would
    // itself be a filtered statistic.
    for (const p of pillarMeta) {
      const e = acc[g.id]?.[p.id];
      if (e) { overall[p.id] = overall[p.id] || { sum: 0, c: 0 }; overall[p.id].sum += e.sum; overall[p.id].c += e.c; }
    }
    if (cell.suppressed) {
      return {
        id: g.id, type: g.type, label: g.label, target_n: g.target_n, n: g.n,
        suppressed: true, suppression_reason: cell.reason,
      };
    }
    const pil: Record<string, number | null> = {};
    for (const p of pillarMeta) {
      const e = acc[g.id]?.[p.id];
      pil[p.id] = e && e.c > 0 ? Math.round((e.sum / e.c) * 10) / 10 : null;
    }
    const dknaPct = g.scored > 0 ? Math.round((g.dkna / g.scored) * 1000) / 10 : 0;
    return {
      id: g.id, type: g.type, label: g.label, target_n: g.target_n, n: g.n,
      suppressed: false, suppression_reason: null,
      comments_locked: g.n < commentThreshold,
      pillars: pil, dkna_pct: dknaPct,
    };
  });

  const overallPillars: Record<string, number | null> = {};
  let weighted = 0, wsum = 0, any = false;
  for (const p of pillarMeta) {
    const e = overall[p.id];
    const v = e && e.c > 0 ? e.sum / e.c : null;
    overallPillars[p.id] = v === null ? null : Math.round(v * 10) / 10;
    if (v !== null) { weighted += v * p.weight; wsum += p.weight; any = true; }
  }
  const overallScore = any && wsum > 0 ? Math.round((weighted / wsum) * 10) / 10 : null;

  // ---- Demographic cuts ---------------------------------------------------
  const cutOf = (dim: any) => {
    const raw = (dim.options || []).map((name: string) => ({ name, n: dN[dim.id + "\0" + name] || 0 }));
    const declared = raw.reduce((s: number, o: any) => s + o.n, 0);
    const notDeclared = Math.max(0, totalN - declared);

    // The residual is part of the partition. Its scores are never published, so
    // it is always a hidden cell — which sometimes helps, by supplying the
    // second unknown that makes a single suppressed option unsolvable.
    const plan = planSuppression(
      [...raw.map((o: any) => ({ key: "opt:" + o.name, n: o.n })),
       { key: "__not_declared__", n: notDeclared, alwaysHidden: true }],
      { threshold, mode, totalPublished: overallPublished },
    );
    const byKey: Record<string, Cell> = {};
    for (const c of plan.cells) byKey[c.key] = c;

    const opts = raw.map((o: any) => {
      const cell = byKey["opt:" + o.name];
      if (cell.suppressed) return { name: o.name, n: o.n, suppressed: true, suppression_reason: cell.reason };
      const k = dim.id + "\0" + o.name;
      const pil: Record<string, number | null> = {};
      let wS = 0, wsumS = 0;
      for (const p of pillarMeta) {
        const e = dAcc[k]?.[p.id];
        const v = e && e.c > 0 ? e.sum / e.c : null;
        pil[p.id] = v === null ? null : Math.round(v * 10) / 10;
        if (v !== null) { wS += v * p.weight; wsumS += p.weight; }
      }
      return { name: o.name, n: o.n, suppressed: false, suppression_reason: null, pillars: pil,
               score: wsumS > 0 ? Math.round((wS / wsumS) * 10) / 10 : null };
    });
    return {
      id: dim.id, label: dim.label, options: opts, not_declared: notDeclared,
      suppressed_options: opts.filter((o: any) => o.suppressed).length,
      unusable: plan.suppressTotal || opts.filter((o: any) => !o.suppressed).length < 2,
    };
  };

  const demographicsOut = dims.length ? dims.map(cutOf) : null;
  const depDim = cutDims.find((d: any) => d.id === "department");
  const segmentsOut = depDim ? cutOf(depDim).options : null;

  const out: any = {
    schema: "id-keyed",
    campaign: {
      id: campaign.id, name: campaign.name, status: campaign.status,
      opens_at: campaign.opens_at, closes_at: campaign.closes_at,
      anonymity_threshold: threshold,   // deprecated alias
      score_threshold: threshold,
      comment_threshold: commentThreshold,
      segments: campaign.segments || null, demographics: campaign.demographics || null,
    },
    governance: {
      source: gov ? "fs_campaign_governance" : "legacy_campaign_column",
      privacy_profile: gov?.privacy_profile ?? null,
      score_threshold: threshold,
      comment_threshold: commentThreshold,
      suppression_mode: mode,
      max_filter_dimensions: gov?.max_filter_dimensions ?? 2,
      raw_export_policy: gov?.raw_export_policy ?? "aggregate_only",
      locked: !!gov?.locked_at,
      complementary_suppression_applied: groupPlan.cells.some((c) => c.reason === "complementary" || c.reason === "residual_too_small"),
    },
    org: { name: org?.name },
    questionnaire_version: qv?.version || null,
    scale: def.scale || null,
    pillars: pillarMeta,
    groups: groupsOut,
    demographics: demographicsOut,
    segments: segmentsOut,
    overall: overallPublished && !groupPlan.suppressTotal
      ? { n: totalN, pillars: overallPillars, score: overallScore }
      : { n: totalN, suppressed: true },
  };

  if (wantDetail) {
    // Per-question detail follows the same suppression decision as the group
    // itself. A group hidden for complementary reasons must not reappear here.
    const visible = groupsOut.filter((g: any) => !g.suppressed);
    const typeCount: Record<string, number> = {};
    for (const g of visible) typeCount[g.type] = (typeCount[g.type] || 0) + 1;
    const questions: any[] = [];
    for (const p of def.pillars) {
      for (const q of p.questions) {
        const row: any = { key: q.key, pillar: p.id, pillar_short: p.short, text: q.text, audience: q.groups ?? null, groups: {} };
        for (const g of visible) {
          const e = qacc[g.id]?.[q.key];
          let cell: any;
          if (!e) cell = { mean: null, n_scored: 0, n_dkna: 0, sd: null, dist: null };
          else {
            const mean = e.c > 0 ? e.sum / e.c : null;
            const sd = mean !== null && e.c >= 2 ? Math.sqrt(Math.max(0, e.ss / e.c - mean * mean)) : null;
            const dist: Record<string, number> = {};
            for (const code of scaleCodes) if (e.dist[code]) dist[code] = e.dist[code];
            cell = { mean: mean === null ? null : Math.round(mean * 10) / 10, n_scored: e.c, n_dkna: e.dk, sd: sd === null ? null : Math.round(sd * 10) / 10, dist };
          }
          row.groups[g.id] = cell;
          if (typeCount[g.type] === 1) row.groups[g.type] = cell;
        }
        questions.push(row);
      }
    }
    out.questions = questions;
  }

  return J(out);
  } catch {
    return J({ error: "Could not complete this request. Please try again." }, 503);
  }
});
