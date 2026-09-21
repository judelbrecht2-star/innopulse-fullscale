import { createClient } from "npm:@supabase/supabase-js@2";
import {
  INTERVENTION_MATCHING_SCHEMA_VERSION,
  buildInterventionMatchingRequest,
  normaliseInterventionMatchingAnswer,
} from "../_shared/intervention-matching.ts";

const TYPE_SAFE_URL = "https://api.typesafe.ai/v1/systemone";
const ALLOWED_ROLES = new Set(["owner", "manager", "analyst"]);
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
  return createClient(Deno.env.get("SUPABASE_URL")!, Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!, {
    auth: { autoRefreshToken: false, persistSession: false },
  });
}

function userClient(authorization: string) {
  return createClient(Deno.env.get("SUPABASE_URL")!, Deno.env.get("SUPABASE_ANON_KEY")!, {
    global: { headers: { Authorization: authorization } },
    auth: { autoRefreshToken: false, persistSession: false },
  });
}

function validFinding(value: any) {
  const id = String(value?.id || "").trim();
  const title = String(value?.title || "").trim();
  const conclusion = String(value?.conclusion || "").trim();
  if (!/^[a-zA-Z0-9_-]{1,100}$/.test(id) || !title || !conclusion) return null;
  return {
    id,
    title: title.slice(0, 500),
    conclusion: conclusion.slice(0, 2500),
    validate: value?.validate ? String(value.validate).trim().slice(0, 1200) : null,
    iso: value?.iso ? String(value.iso).trim().slice(0, 300) : null,
  };
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

Deno.serve(async (req: Request) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: CORS });
  if (req.method !== "POST") return json({ error: "Method not allowed" }, 405);
  if (Deno.env.get("JEV_INTERVENTION_MATCHING") !== "true") return json({ status: "disabled", matches: [] });
  const apiKey = Deno.env.get("TYPESAFE_API_KEY")?.trim();
  if (!apiKey) return json({ error: "AI intervention matching is not configured" }, 503);
  const authorization = req.headers.get("Authorization") || "";
  if (!authorization.startsWith("Bearer ")) return json({ error: "Unauthorised" }, 401);

  let body: any;
  try { body = await req.json(); } catch { return json({ error: "Bad JSON" }, 400); }
  const campaignId = String(body?.campaign_id || "").trim();
  if (!/^[0-9a-f-]{36}$/i.test(campaignId)) return json({ error: "Invalid campaign" }, 400);
  const finding = validFinding(body?.finding);
  if (!finding) return json({ error: "Invalid finding" }, 400);

  const auth = userClient(authorization);
  const { data: authData, error: authError } = await auth.auth.getUser();
  if (authError || !authData.user) return json({ error: "Unauthorised" }, 401);
  const admin = adminClient();
  const { data: campaign } = await admin.from("fs_campaigns").select("id,org_id").eq("id", campaignId).maybeSingle();
  if (!campaign) return json({ error: "Campaign not found" }, 404);
  const { data: membership } = await admin.from("fs_memberships").select("role")
    .eq("org_id", campaign.org_id).eq("user_id", authData.user.id).maybeSingle();
  if (!membership || !ALLOWED_ROLES.has(membership.role)) return json({ error: "Forbidden" }, 403);

  const { data: library, error: libraryError } = await admin.from("fs_interventions")
    .select("id,pillar,risk,summary,actions,services,owner_suggestion,horizon,effort,impact,kpi,evidence,iso_map")
    .order("pillar").limit(24);
  if (libraryError) return json({ error: "Could not load the approved intervention library" }, 500);
  if (!library?.length) return json({ status: "complete", matches: [], selected_id: null });

  try {
    const { request, candidateMap } = buildInterventionMatchingRequest(finding, library);
    const { payload, latencyMs } = await callTypeSafe(apiKey, request);
    const normalised = normaliseInterventionMatchingAnswer(payload, candidateMap);
    const byId = new Map(library.map((entry: any) => [entry.id, entry]));
    const matches = normalised.ranked.slice(0, 3).map((match) => ({
      ...byId.get(match.id),
      probability: match.probability,
      selected: match.id === normalised.selected_id,
    }));
    return json({
      status: normalised.selected_id ? "complete" : "no_match",
      finding_id: finding.id,
      selected_id: normalised.selected_id,
      confidence: normalised.confidence,
      none_probability: normalised.none_probability,
      model: normalised.model,
      schema_version: INTERVENTION_MATCHING_SCHEMA_VERSION,
      latency_ms: latencyMs,
      matches,
    });
  } catch (error) {
    const message = error instanceof Error ? error.message : "request_failed";
    return json({ error: ["invalid_response", "timeout"].includes(message) || /^http_\d{3}$/.test(message) ? message : "request_failed" }, 502);
  }
});
