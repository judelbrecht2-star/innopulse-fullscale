// InnoPulse Full-Scale — public respondent endpoint. v8: privacy-gated Jev
// comment-coding shadow pilot. v7: configurable optional
// demographics ({dimId: value}, validated against the campaign's configured
// dimensions; always optional). v6: single segment (kept for backcompat).
// v5: no UA, device dedup, atomic link claim. v4: progress beacons.
import { createClient } from "npm:@supabase/supabase-js@2";
import {
  queueCommentCodingRows,
  runEligibleCommentCodingShadow,
} from "../_shared/comment-coding-shadow.ts";

declare const EdgeRuntime: { waitUntil(promise: Promise<unknown>): void };

const CORS: Record<string, string> = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "GET, POST, OPTIONS",
};
const J = (o: unknown, s = 200) => new Response(JSON.stringify(o), { status: s, headers: { ...CORS, "Content-Type": "application/json" } });

function db() {
  return createClient(Deno.env.get("SUPABASE_URL")!, Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!, { auth: { autoRefreshToken: false, persistSession: false } });
}

function filterForGroup(def: any, groupType: string) {
  return {
    ...def,
    pillars: def.pillars
      .map((p: any) => ({ ...p, questions: p.questions.filter((q: any) => !q.groups || q.groups.includes(groupType)) }))
      .filter((p: any) => p.questions.length > 0),
  };
}

async function loadLink(admin: ReturnType<typeof db>, token: string) {
  const { data: link } = await admin.from("fs_links").select("id, token, mode, max_uses, used_count, expires_at, active, campaign_id, group_id").eq("token", token).maybeSingle();
  if (!link) return { err: "This link is not valid." };
  if (!link.active) return { err: "This link has been deactivated." };
  if (link.expires_at && new Date(link.expires_at) < new Date()) return { err: "This link has expired." };
  if (link.max_uses && link.used_count >= link.max_uses) return { err: "This link has already been used." };
  const { data: campaign } = await admin.from("fs_campaigns").select("id, name, status, opens_at, closes_at, anonymity_threshold, questionnaire_version_id, org_id, thankyou_message, closed_message, segments, demographics, is_sandbox").eq("id", link.campaign_id).maybeSingle();
  if (!campaign) return { err: "Campaign not found." };
  const closedMsg = campaign.closed_message?.trim() || "This assessment is not currently open.";
  if (campaign.status !== "open") return { err: closedMsg };
  const now = new Date();
  if (campaign.opens_at && now < new Date(campaign.opens_at)) return { err: "This assessment hasn't opened yet — please try again after " + new Date(campaign.opens_at).toDateString() + "." };
  if (campaign.closes_at && now > new Date(campaign.closes_at)) return { err: closedMsg };
  const { data: group } = await admin.from("fs_groups").select("id, type, label").eq("id", link.group_id).maybeSingle();
  const { data: org } = await admin.from("fs_orgs").select("id, name").eq("id", campaign.org_id).maybeSingle();
  const { data: qv } = await admin.from("fs_questionnaire_versions").select("id, version, definition").eq("id", campaign.questionnaire_version_id).maybeSingle();
  return { link, campaign, group, org, qv };
}

Deno.serve(async (req: Request) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: CORS });
  const admin = db();

  if (req.method === "GET") {
    const token = new URL(req.url).searchParams.get("token") || "";
    if (!token) return J({ error: "Missing token" }, 400);
    const r = await loadLink(admin, token);
    if ("err" in r) return J({ error: r.err }, 404);
    const served = filterForGroup(r.qv!.definition, r.group!.type);
    return J({
      campaign: { name: r.campaign!.name, is_sandbox: Boolean(r.campaign!.is_sandbox), thankyou_message: r.campaign!.thankyou_message || null, closes_at: r.campaign!.closes_at, segments: r.campaign!.segments || null, demographics: r.campaign!.demographics || null },
      org: { name: r.org?.name },
      group: { type: r.group?.type, label: r.group?.label },
      questionnaire: served,
    });
  }

  if (req.method === "POST") {
    let body: any;
    try { body = await req.json(); } catch { return J({ error: "Bad JSON" }, 400); }
    const token = String(body?.token || "");
    if (!token) return J({ error: "Missing token" }, 400);
    const r = await loadLink(admin, token);
    if ("err" in r) return J({ error: r.err }, 404);

    if (body.action === "progress") {
      const ref = String(body.ref || "").slice(0, 40);
      if (!ref) return J({ ok: true });
      const answered = Math.max(0, Math.min(500, Number(body.answered || 0)));
      const total = Math.max(0, Math.min(500, Number(body.total || 0)));
      await admin.from("fs_progress").upsert({
        campaign_id: r.campaign!.id, group_id: r.group!.id, link_id: r.link!.id,
        client_ref: ref, answered, total, last_seen: new Date().toISOString(),
      }, { onConflict: "link_id,client_ref" });
      return J({ ok: true });
    }

    const served = filterForGroup(r.qv!.definition, r.group!.type);
    const scaleByCode: Record<string, any> = {};
    for (const s of served.scale) scaleByCode[s.code] = s;
    const questionKeys: string[] = served.pillars.flatMap((p: any) => p.questions.map((q: any) => q.key));

    const answers: Record<string, string> = body.answers || {};
    const missing = questionKeys.filter((k) => !(k in answers));
    if (missing.length > 0) return J({ error: `Incomplete: ${missing.length} unanswered question(s).` }, 400);
    for (const [k, code] of Object.entries(answers)) {
      if (!questionKeys.includes(k)) return J({ error: `Unknown question ${k}` }, 400);
      if (!scaleByCode[code]) return J({ error: `Invalid choice for ${k}` }, 400);
    }
    if (body.consent !== true) return J({ error: "Consent is required." }, 400);

    // v7: optional demographics — validate each value against the configured dimension
    let demo: Record<string, string> | null = null;
    if (body.demo && typeof body.demo === "object" && Array.isArray(r.campaign!.demographics)) {
      const dims: any[] = r.campaign!.demographics;
      const out: Record<string, string> = {};
      for (const d of dims) {
        const v = body.demo[d.id];
        if (v && Array.isArray(d.options) && d.options.includes(String(v))) out[d.id] = String(v).slice(0, 80);
      }
      if (Object.keys(out).length) demo = out;
    }
    // legacy single segment (older clients)
    let segment: string | null = null;
    if (body.segment) {
      const segs: string[] = r.campaign!.segments || [];
      const cand = String(body.segment).slice(0, 80);
      if (segs.includes(cand)) segment = cand;
    }

    const ref = body.ref ? String(body.ref).slice(0, 40) : null;
    if (ref) {
      const { data: dup } = await admin.from("fs_responses").select("id")
        .eq("link_id", r.link!.id).eq("meta->>ref", ref).limit(1);
      if (dup && dup.length) return J({ error: "This device has already submitted a response for this link." }, 409);
    }

    const { data: claimed, error: eClaim } = await admin.rpc("fs_use_link", { p_link: r.link!.id });
    if (eClaim || claimed !== true) return J({ error: "This link has already been used." }, 409);

    const { data: resp, error: e1 } = await admin.from("fs_responses").insert({
      campaign_id: r.campaign!.id, group_id: r.group!.id, link_id: r.link!.id,
      questionnaire_version_id: r.qv!.id,
      meta: { ...(ref ? { ref } : {}), ...(r.campaign!.is_sandbox ? { sandbox: true } : {}) },
      flag: r.campaign!.is_sandbox ? "test" : null,
      segment, demo,
    }).select("id").single();
    if (e1 || !resp) { await admin.rpc("fs_release_link", { p_link: r.link!.id }); return J({ error: "Could not save response." }, 500); }

    const rows = Object.entries(answers).map(([k, code]) => ({
      response_id: resp.id, question_key: k, choice: code,
      value: scaleByCode[code].value, not_scored: !!scaleByCode[code].not_scored,
    }));
    const { error: e2 } = await admin.from("fs_answers").insert(rows);
    if (e2) { await admin.from("fs_responses").delete().eq("id", resp.id); await admin.rpc("fs_release_link", { p_link: r.link!.id }); return J({ error: "Could not save answers." }, 500); }

    const comments = body.comments || {};
    const cRows = Object.entries(comments).filter(([, v]) => typeof v === "string" && (v as string).trim())
      .map(([pillar, v]) => ({ response_id: resp.id, pillar, body: (v as string).trim().slice(0, 4000) }));
    let savedComments: any[] = [];
    if (cRows.length) {
      const { data, error } = await admin.from("fs_comments").insert(cRows).select("id,response_id,pillar,body");
      if (error) console.error("comment insert failed", error.code || "database_error");
      savedComments = data || [];
      await queueCommentCodingRows(admin, savedComments, {
        campaignId: r.campaign!.id,
        groupId: r.group!.id,
      });
    }

    await admin.from("fs_consents").insert({ response_id: resp.id, consented: true, policy_version: "v0.2" });
    if (r.link!.mode === "unique") await admin.from("fs_links").update({ active: false }).eq("id", r.link!.id);
    if (ref) await admin.from("fs_progress").delete().eq("link_id", r.link!.id).eq("client_ref", ref);

    if (savedComments.length) {
      EdgeRuntime.waitUntil(runEligibleCommentCodingShadow(admin, {
        campaignId: r.campaign!.id,
        groupId: r.group!.id,
        fallbackThreshold: r.campaign!.anonymity_threshold,
        questionnaire: r.qv!.definition,
      }));
    }

    return J({ ok: true, thankyou_message: r.campaign!.thankyou_message || null });
  }

  return new Response("nope", { status: 405, headers: CORS });
});
