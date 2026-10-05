// InnoPulse Full-Scale — Responses operations endpoint.
// v6: thresholds come from fs_campaign_governance, not from
// fs_campaigns.anonymity_threshold, and there are now two of them:
//
//   score_threshold   — gates aggregates (fs-results). Returned here as
//                       `threshold` for back-compat and used for the roster.
//   comment_threshold — gates every surface that exposes individual-level
//                       content: the single-response detail view, comment
//                       curation (in_report), theme tagging, the theme summary
//                       and the report verbatim feed. Never below
//                       score_threshold (enforced by DB trigger).
//
// Rationale: a group can be large enough for its mean to be safe while still
// being small enough that a verbatim identifies the person who wrote it. The
// old single threshold could not express that. fs_campaigns.anonymity_threshold
// is now a deprecated trigger-maintained mirror and is read only when a
// campaign has no governance row at all. The hard floor of 4 still wins.
//
// v5 (P0-2): the anonymity threshold is absolute. The previous
// `mem.role !== "owner"` exemption on detail views and comment tagging is
// REMOVED — no role, including owner, can read an individual response or tag a
// comment from a group below the threshold. Enforced server-side for every
// caller; the UI is not the control.
// v4: theme_summary dual denominators. v3: verbatim theme coding.
import { createClient } from "npm:@supabase/supabase-js@2.112.3";

import { checked, readAll } from "../_shared/query.js";

const CORS: Record<string, string> = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};
const J = (o: unknown, s = 200) => new Response(JSON.stringify(o), { status: s, headers: { ...CORS, "Content-Type": "application/json" } });
const FLOOR = 4;

Deno.serve(async (req: Request) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: CORS });
  if (req.method !== "POST") return J({ error: "POST only" }, 405);
  try {
  const admin = createClient(Deno.env.get("SUPABASE_URL")!, Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!, { auth: { autoRefreshToken: false, persistSession: false } });
  const jwt = (req.headers.get("Authorization") || "").replace(/^Bearer\s+/i, "");
  const { data: ud, error: uerr } = await admin.auth.getUser(jwt);
  if (uerr || !ud?.user) return J({ error: "Not signed in" }, 401);
  const uid = ud.user.id;

  let body: any; try { body = await req.json(); } catch { return J({ error: "Bad JSON" }, 400); }
  const campaignId = String(body?.campaign_id || "");
  if (!campaignId) return J({ error: "Missing campaign_id" }, 400);

  const { data: camp } = await checked(admin.from("fs_campaigns").select("id, org_id, anonymity_threshold").eq("id", campaignId).maybeSingle());
  if (!camp) return J({ error: "Campaign not found" }, 404);
  const { data: mem } = await checked(admin.from("fs_memberships").select("role").eq("org_id", camp.org_id).eq("user_id", uid).maybeSingle());
  if (!mem || !["owner", "manager", "analyst"].includes(mem.role)) return J({ error: "Not authorised" }, 403);

  // --- Governance: the source of truth for both thresholds -------------------
  const { data: gov } = await checked(admin.from("fs_campaign_governance")
    .select("score_threshold, comment_threshold, suppression_mode, raw_export_policy, locked_at")
    .eq("campaign_id", campaignId).maybeSingle());
  const legacy = camp.anonymity_threshold ?? 5; // only if governance is missing
  const threshold = Math.max(gov?.score_threshold ?? legacy, FLOOR);          // aggregates
  const commentThreshold = Math.max(gov?.comment_threshold ?? threshold, threshold); // individual content

  const { data: resps } = await readAll(() => admin.from("fs_responses")
    .select("id, group_id, link_id, submitted_at, valid, flag").eq("campaign_id", campaignId).order("submitted_at"));
  const groupN: Record<string, number> = {};
  for (const r of resps || []) if (r.valid) groupN[r.group_id] = (groupN[r.group_id] || 0) + 1;
  const respById: Record<string, any> = {};
  for (const r of resps || []) respById[r.id] = r;

  if (body.action === "detail") {
    const rid = String(body?.response_id || "");
    const r = respById[rid];
    if (!r) return J({ error: "Response not found" }, 404);
    const n = groupN[r.group_id] || 0;
    // P0-2: absolute, no role exemption. v6: an individual response is
    // individual-level content, so it is gated on comment_threshold.
    if (n < commentThreshold) return J({ locked: true, have: n, needed: commentThreshold, gate: "comment_threshold" });
    const [{ data: ans }, { data: cms }] = await Promise.all([
      readAll(() => admin.from("fs_answers").select("question_key, value, not_scored").eq("response_id", rid)),
      readAll(() => admin.from("fs_comments").select("id, pillar, body, in_report, themes").eq("response_id", rid)),
    ]);
    const per: Record<string, { sum: number; c: number; dk: number; n: number }> = {};
    for (const a of ans || []) {
      const pid = String(a.question_key).split("_")[0];
      per[pid] = per[pid] || { sum: 0, c: 0, dk: 0, n: 0 };
      per[pid].n++;
      if (a.not_scored || a.value === null) per[pid].dk++;
      else { per[pid].sum += Number(a.value); per[pid].c++; }
    }
    const pillars = Object.entries(per).map(([pid, d]) => ({ pid, score: d.c ? Math.round((d.sum / d.c) * 10) / 10 : null, n: d.n, dk: d.dk }));
    await admin.from("fs_audit").insert({ org_id: camp.org_id, actor: uid, action: "response.viewed", entity: "fs_responses", entity_id: rid }).then(() => {}, () => {});
    return J({ locked: false, pillars, comments: cms || [] });
  }

  if (body.action === "flag_comment" || body.action === "tag_comment") {
    const cid = String(body?.comment_id || "");
    const { data: cm } = await checked(admin.from("fs_comments").select("id, response_id").eq("id", cid).maybeSingle());
    if (!cm || !respById[cm.response_id]) return J({ error: "Comment not found" }, 404);
    const gid = respById[cm.response_id].group_id;
    const have = groupN[gid] || 0;
    const below = have < commentThreshold;   // v6: comment surfaces use comment_threshold
    if (body.action === "flag_comment") {
      if (below) return J({ error: `This group has ${have} responses and comments are released at ${commentThreshold} — its comments cannot be used in reports yet.`, have, needed: commentThreshold, gate: "comment_threshold" }, 403);
      const flag = body?.in_report === true;
      await checked(admin.from("fs_comments").update({ in_report: flag }).eq("id", cid).select("id").single());
      await admin.from("fs_audit").insert({ org_id: camp.org_id, actor: uid, action: flag ? "comment.report_add" : "comment.report_remove", entity: "fs_comments", entity_id: cid }).then(() => {}, () => {});
      return J({ ok: true, in_report: flag });
    }
    // Tagging reads individual content — same gate, no owner exemption.
    if (below) return J({ error: `Group below the comment threshold (${have} of ${commentThreshold}) — tagging unlocks once it passes.`, have, needed: commentThreshold, gate: "comment_threshold" }, 403);
    const themes = Array.isArray(body?.themes)
      ? body.themes.map((t: any) => String(t).trim().slice(0, 40)).filter(Boolean).slice(0, 6)
      : [];
    await checked(admin.from("fs_comments").update({ themes: themes.length ? themes : null }).eq("id", cid).select("id").single());
    return J({ ok: true, themes });
  }

  if (body.action === "theme_summary") {
    // v6: theme counts are built from verbatims, so the comment gate applies.
    const okGroups = new Set(Object.entries(groupN).filter(([, n]) => (n as number) >= commentThreshold).map(([g]) => g));
    const okResp = (resps || []).filter((r) => r.valid && okGroups.has(r.group_id));
    const totalValid = (resps || []).filter((r) => r.valid).length;
    const ids = okResp.map((r) => r.id);
    let cms: any[] = [];
    for (let i = 0; i < ids.length; i += 100) {
      const { data } = await readAll(() => admin.from("fs_comments").select("response_id, pillar, themes").in("response_id", ids.slice(i, i + 100)));
      cms = cms.concat(data || []);
    }
    const commenterSet = new Set(cms.map((c) => c.response_id));
    const { data: grps } = await readAll(() => admin.from("fs_groups").select("id, type, label").eq("campaign_id", campaignId));
    const gmap: Record<string, any> = {};
    for (const g of grps || []) gmap[g.id] = g;
    const agg: Record<string, { pillar: string; theme: string; count: number; people: Set<string>; groups: Set<string> }> = {};
    for (const c of cms) {
      if (!c.themes) continue;
      const g = gmap[respById[c.response_id]?.group_id];
      for (const t of c.themes || []) {
        const k = c.pillar + "\0" + t.toLowerCase();
        agg[k] = agg[k] || { pillar: c.pillar, theme: t, count: 0, people: new Set(), groups: new Set() };
        agg[k].count++;
        agg[k].people.add(c.response_id);
        if (g) agg[k].groups.add(g.label || g.type);
      }
    }
    const themes = Object.values(agg).map((x) => ({ pillar: x.pillar, theme: x.theme, count: x.count, people: x.people.size, groups: [...x.groups] }))
      .sort((a, b) => b.count - a.count);
    const excluded = Object.entries(groupN).filter(([, n]) => (n as number) < commentThreshold).length;
    return J({ themes, commenters: commenterSet.size, respondents: totalValid, comment_threshold: commentThreshold, groups_excluded: excluded });
  }

  if (body.action === "report_comments") {
    // v6: verbatims released into a report use the comment gate.
    const okGroups = new Set(Object.entries(groupN).filter(([, n]) => (n as number) >= commentThreshold).map(([g]) => g));
    const okResp = (resps || []).filter((r) => r.valid && okGroups.has(r.group_id));
    const ids = okResp.map((r) => r.id);
    let out: any[] = [];
    for (let i = 0; i < ids.length; i += 100) {
      const { data: cms2 } = await readAll(() => admin.from("fs_comments").select("id, response_id, pillar, body, in_report").in("response_id", ids.slice(i, i + 100)).eq("in_report", true));
      out = out.concat(cms2 || []);
    }
    const { data: grps } = await readAll(() => admin.from("fs_groups").select("id, type, label").eq("campaign_id", campaignId));
    const gmap: Record<string, any> = {};
    for (const g of grps || []) gmap[g.id] = g;
    const verbatims = out.map((c) => {
      const g = gmap[respById[c.response_id]?.group_id] || {};
      return { pillar: c.pillar, body: c.body, group_id: g.id || null, group_type: g.type || null, group_label: g.label || null };
    });
    return J({ verbatims, comment_threshold: commentThreshold });
  }

  // action=list (default) — aggregates only, never raw answers
  const ids = (resps || []).map((r) => r.id);
  const agg: Record<string, { answered: number; dk: number }> = {};
  const cn: Record<string, number> = {};
  for (let i = 0; i < ids.length; i += 100) {
    const chunk = ids.slice(i, i + 100);
    const [{ data: ans }, { data: cms }] = await Promise.all([
      readAll(() => admin.from("fs_answers").select("response_id, not_scored").in("response_id", chunk)),
      readAll(() => admin.from("fs_comments").select("response_id").in("response_id", chunk)),
    ]);
    for (const a of ans || []) {
      agg[a.response_id] = agg[a.response_id] || { answered: 0, dk: 0 };
      agg[a.response_id].answered++;
      if (a.not_scored) agg[a.response_id].dk++;
    }
    for (const c of cms || []) cn[c.response_id] = (cn[c.response_id] || 0) + 1;
  }
  const out = (resps || []).map((r) => ({ ...r, agg: agg[r.id] || { answered: 0, dk: 0 }, nComments: cn[r.id] || 0 }));
  const { data: prog } = await readAll(() => admin.from("fs_progress")
    .select("id, group_id, link_id, client_ref, answered, total, started_at, last_seen").eq("campaign_id", campaignId).order("started_at"));
  // Per-group gate state, so the console can label each row without guessing.
  const gates = Object.fromEntries(Object.entries(groupN).map(([gid, n]) => [gid, {
    n, scores_released: (n as number) >= threshold, comments_released: (n as number) >= commentThreshold,
  }]));
  return J({
    responses: out, progress: prog || [], role: mem.role,
    threshold,                       // deprecated alias = score_threshold
    score_threshold: threshold,
    comment_threshold: commentThreshold,
    governance: {
      source: gov ? "fs_campaign_governance" : "legacy_campaign_column",
      suppression_mode: gov?.suppression_mode ?? "basic",
      raw_export_policy: gov?.raw_export_policy ?? "aggregate_only",
      locked: !!gov?.locked_at,
    },
    group_gates: gates,
  });
  } catch {
    return J({ error: "Could not complete this request. Please try again." }, 503);
  }
});
