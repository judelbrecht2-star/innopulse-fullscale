import { createClient } from "npm:@supabase/supabase-js@2";
import {
  FINDING_CORROBORATION_MODEL,
  FINDING_CORROBORATION_SCHEMA_VERSION,
  aggregateCorroboration,
  buildFindingCorroborationBatchRequest,
  normaliseFindingCorroborationAnswers,
  selectEvidenceCandidates,
  type EvidenceComment,
  type FindingInput,
} from "../_shared/finding-corroboration-shadow.ts";

const TYPE_SAFE_URL = "https://api.typesafe.ai/v1/systemone";
const ALLOWED_CLASSES = new Set(["Supported interpretation", "Plausible hypothesis"]);
const ALLOWED_ROLES = new Set(["owner", "manager", "analyst"]);
const MAX_FINDINGS = 12;
const CONCURRENCY = 2;

const CORS: Record<string, string> = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};
const json = (body: unknown, status = 200) => new Response(JSON.stringify(body), {
  status,
  headers: { ...CORS, "Content-Type": "application/json" },
});

function adminClient() {
  return createClient(
    Deno.env.get("SUPABASE_URL")!,
    Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!,
    { auth: { autoRefreshToken: false, persistSession: false } },
  );
}

function userClient(authorization: string) {
  return createClient(
    Deno.env.get("SUPABASE_URL")!,
    Deno.env.get("SUPABASE_ANON_KEY")!,
    {
      global: { headers: { Authorization: authorization } },
      auth: { autoRefreshToken: false, persistSession: false },
    },
  );
}

function validFinding(value: any): FindingInput | null {
  const id = String(value?.id || "").trim();
  const title = String(value?.title || "").trim();
  const conclusion = String(value?.conclusion || "").trim();
  const klass = String(value?.klass || "").trim();
  if (!/^[a-zA-Z0-9_-]{1,100}$/.test(id) || !title || !conclusion || !ALLOWED_CLASSES.has(klass)) return null;
  return {
    id,
    title: title.slice(0, 500),
    conclusion: conclusion.slice(0, 2500),
    alternatives: value?.alternatives ? String(value.alternatives).trim().slice(0, 2000) : null,
    klass,
  };
}

async function sha256(value: string) {
  const bytes = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(value));
  return Array.from(new Uint8Array(bytes)).map((byte) => byte.toString(16).padStart(2, "0")).join("");
}

function errorCode(error: unknown) {
  const message = error instanceof Error ? error.message : String(error);
  if (/^http_\d{3}$/.test(message) || message === "invalid_response" || message === "timeout") return message;
  return "request_failed";
}

async function callTypeSafe(apiKey: string, request: unknown) {
  let delay = 500;
  for (let attempt = 1; attempt <= 3; attempt += 1) {
    const started = performance.now();
    let response: Response;
    try {
      response = await fetch(TYPE_SAFE_URL, {
        method: "POST",
        headers: { Authorization: `Bearer ${apiKey}`, "Content-Type": "application/json" },
        body: JSON.stringify(request),
        signal: AbortSignal.timeout(25_000),
      });
    } catch (error) {
      if (error instanceof DOMException && error.name === "TimeoutError") throw new Error("timeout");
      throw error;
    }
    const latencyMs = Math.round(performance.now() - started);
    if (response.ok) return { payload: await response.json(), latencyMs };
    if ((response.status === 429 || response.status === 529) && attempt < 3) {
      await new Promise((resolve) => setTimeout(resolve, delay));
      delay *= 2;
      continue;
    }
    throw new Error(`http_${response.status}`);
  }
  throw new Error("request_failed");
}

function publicResult(row: any) {
  return {
    finding_id: row.finding_id,
    status: row.status,
    verdict: row.verdict || null,
    eligible_comment_count: Number(row.eligible_comment_count || 0),
    evaluated_comment_count: Number(row.evaluated_comment_count || 0),
    relevant_count: Number(row.relevant_count || 0),
    support_count: Number(row.support_count || 0),
    contradiction_count: Number(row.contradiction_count || 0),
    support_mean: row.support_mean == null ? null : Number(row.support_mean),
    contradiction_mean: row.contradiction_mean == null ? null : Number(row.contradiction_mean),
    relevance_mean: row.relevance_mean == null ? null : Number(row.relevance_mean),
    model: row.model || FINDING_CORROBORATION_MODEL,
    latency_ms: row.latency_ms == null ? null : Number(row.latency_ms),
    completed_at: row.completed_at || null,
    cached: Boolean(row.cached),
  };
}

Deno.serve(async (req: Request) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: CORS });
  if (req.method !== "POST") return json({ error: "Method not allowed" }, 405);
  if (Deno.env.get("JEV_FINDING_CORROBORATION_SHADOW") !== "true") return json({ status: "disabled", results: [] });

  const apiKey = Deno.env.get("TYPESAFE_API_KEY")?.trim();
  if (!apiKey) return json({ error: "Finding evidence check is not configured" }, 503);
  const authorization = req.headers.get("Authorization") || "";
  if (!authorization.startsWith("Bearer ")) return json({ error: "Unauthorised" }, 401);

  let body: any;
  try { body = await req.json(); } catch { return json({ error: "Bad JSON" }, 400); }
  const campaignId = String(body?.campaign_id || "").trim();
  if (!/^[0-9a-f-]{36}$/i.test(campaignId)) return json({ error: "Invalid campaign" }, 400);
  const findings = (Array.isArray(body?.findings) ? body.findings : [])
    .map(validFinding)
    .filter(Boolean)
    .slice(0, MAX_FINDINGS) as FindingInput[];
  if (!findings.length) return json({ status: "complete", results: [] });

  const auth = userClient(authorization);
  const { data: authData, error: authError } = await auth.auth.getUser();
  if (authError || !authData.user) return json({ error: "Unauthorised" }, 401);

  const admin = adminClient();
  const { data: campaign } = await admin.from("fs_campaigns")
    .select("id,org_id,anonymity_threshold")
    .eq("id", campaignId)
    .maybeSingle();
  if (!campaign) return json({ error: "Campaign not found" }, 404);
  const { data: membership } = await admin.from("fs_memberships")
    .select("role")
    .eq("org_id", campaign.org_id)
    .eq("user_id", authData.user.id)
    .maybeSingle();
  if (!membership || !ALLOWED_ROLES.has(membership.role)) return json({ error: "Forbidden" }, 403);

  const { data: governance } = await admin.from("fs_campaign_governance")
    .select("comment_threshold,score_threshold")
    .eq("campaign_id", campaignId)
    .maybeSingle();
  const threshold = Math.max(4, Number(governance?.comment_threshold || governance?.score_threshold || campaign.anonymity_threshold || 4));

  const { data: responses, error: responsesError } = await admin.from("fs_responses")
    .select("id,group_id")
    .eq("campaign_id", campaignId)
    .eq("valid", true);
  if (responsesError) return json({ error: "Could not load eligible responses" }, 500);
  const validResponseIds = new Set((responses || []).map((row: any) => row.id));
  const groupCounts = new Map<string, number>();
  for (const response of responses || []) groupCounts.set(response.group_id, (groupCounts.get(response.group_id) || 0) + 1);
  const eligibleGroupIds = [...groupCounts.entries()].filter(([, count]) => count >= threshold).map(([groupId]) => groupId);

  let evidence: EvidenceComment[] = [];
  let eligibleCommentCount = 0;
  if (eligibleGroupIds.length) {
    const { data: codingRows } = await admin.from("fs_comment_coding_shadow")
      .select("comment_id,response_id,group_id,actionability,identifying_detail_probability")
      .eq("campaign_id", campaignId)
      .eq("status", "complete")
      .in("group_id", eligibleGroupIds)
      .order("actionability", { ascending: false });
    const safeRows = (codingRows || []).filter((row: any) => validResponseIds.has(row.response_id));
    const commentIds = safeRows.map((row: any) => row.comment_id);
    if (commentIds.length) {
      const { data: comments } = await admin.from("fs_comments")
        .select("id,response_id,pillar,body")
        .in("id", commentIds);
      const byId = new Map((comments || []).map((comment: any) => [comment.id, comment]));
      const candidates: EvidenceComment[] = safeRows.flatMap((row: any) => {
        const comment: any = byId.get(row.comment_id);
        if (!comment || !validResponseIds.has(comment.response_id)) return [];
        return [{
          id: Number(comment.id),
          group_id: row.group_id,
          pillar: comment.pillar,
          body: comment.body,
          actionability: row.actionability,
          identifying_detail_probability: row.identifying_detail_probability,
        }];
      });
      const privacySafe = candidates.filter((row) => Number(row.identifying_detail_probability ?? 0) <= 0.5);
      eligibleCommentCount = privacySafe.length;
      evidence = selectEvidenceCandidates(privacySafe);
    }
  }

  const commentSetHash = await sha256(evidence.map((comment) => comment.id).sort((a, b) => a - b).join(","));

  async function evaluateFinding(finding: FindingInput) {
    const findingSignature = await sha256(JSON.stringify({
      title: finding.title,
      conclusion: finding.conclusion,
      alternatives: finding.alternatives || null,
      klass: finding.klass || null,
    }));
    const { data: existing } = await admin.from("fs_finding_corroboration_shadow")
      .select("*")
      .eq("campaign_id", campaignId)
      .eq("finding_id", finding.id)
      .eq("schema_version", FINDING_CORROBORATION_SCHEMA_VERSION)
      .maybeSingle();
    if (existing?.status === "complete" && existing.finding_signature === findingSignature && existing.comment_set_hash === commentSetHash) {
      return publicResult({ ...existing, cached: true });
    }

    const base = {
      campaign_id: campaignId,
      finding_id: finding.id,
      finding_signature: findingSignature,
      comment_set_hash: commentSetHash,
      schema_version: FINDING_CORROBORATION_SCHEMA_VERSION,
      model: FINDING_CORROBORATION_MODEL,
      finding_class: finding.klass || null,
      status: evidence.length ? "processing" : "complete",
      verdict: evidence.length ? null : "insufficient",
      eligible_comment_count: eligibleCommentCount,
      evaluated_comment_count: 0,
      relevant_count: 0,
      support_count: 0,
      contradiction_count: 0,
      support_mean: 0,
      contradiction_mean: 0,
      relevance_mean: 0,
      answers: evidence.length ? null : { comments: [] },
      latency_ms: evidence.length ? null : 0,
      attempt_count: Number(existing?.attempt_count || 0) + (evidence.length ? 1 : 0),
      error_code: null,
      updated_at: new Date().toISOString(),
      completed_at: evidence.length ? null : new Date().toISOString(),
    };
    const { data: queued, error: queueError } = await admin.from("fs_finding_corroboration_shadow")
      .upsert(base, { onConflict: "campaign_id,finding_id,schema_version" })
      .select("*")
      .single();
    if (queueError || !queued) throw new Error("database_error");
    if (!evidence.length) return publicResult(queued);

    try {
      const request = buildFindingCorroborationBatchRequest(finding, evidence);
      const { payload, latencyMs } = await callTypeSafe(apiKey!, request);
      const normalised = normaliseFindingCorroborationAnswers(payload, evidence);
      const aggregate = aggregateCorroboration(normalised.results, eligibleCommentCount);
      const { data: complete, error: completeError } = await admin.from("fs_finding_corroboration_shadow")
        .update({
          ...aggregate,
          model: normalised.model,
          status: "complete",
          answers: { comments: normalised.results },
          latency_ms: latencyMs,
          error_code: null,
          completed_at: new Date().toISOString(),
          updated_at: new Date().toISOString(),
        })
        .eq("id", queued.id)
        .select("*")
        .single();
      if (completeError || !complete) throw new Error("database_error");
      return publicResult(complete);
    } catch (error) {
      const code = errorCode(error);
      await admin.from("fs_finding_corroboration_shadow").update({
        status: "error",
        error_code: code,
        updated_at: new Date().toISOString(),
      }).eq("id", queued.id);
      return publicResult({ ...queued, status: "error" });
    }
  }

  const output: any[] = [];
  for (let index = 0; index < findings.length; index += CONCURRENCY) {
    const batch = findings.slice(index, index + CONCURRENCY);
    output.push(...await Promise.all(batch.map(evaluateFinding)));
  }
  return json({ status: "complete", threshold, eligible_group_count: eligibleGroupIds.length, results: output });
});
