export const COMMENT_CODING_SCHEMA_VERSION = "comment-coding-v1";
export const COMMENT_CODING_MODEL = "jev-latest";

const TYPE_SAFE_URL = "https://api.typesafe.ai/v1/systemone";
const MAX_COMMENTS_PER_RUN = 60;
const CONCURRENCY = 4;

const PILLAR_CRITERIA = {
  strategic_intent: "Direction, priorities, sponsorship, investment intent or strategic alignment.",
  environment: "Culture, psychological safety, collaboration, time, incentives or experimentation conditions.",
  capability: "Skills, coaching, tools, data, technology or organisational capability.",
  process: "Idea capture, evaluation, portfolio governance, piloting, customer involvement or implementation process.",
  return_on_innovation: "Adoption, realised value, measurement, benefits, learning or communication of outcomes.",
  cross_cutting: "The comment materially covers several pillars and no single pillar is primary.",
  none: "The comment does not contain a substantive innovation-system observation.",
} as const;

const COMMENT_THEMES = {
  strategy_clarity: "People understand the innovation direction, priorities and how their work connects to it.",
  resource_constraints: "Insufficient time, funding, capacity or protected space prevents innovation work.",
  psychological_safety: "People feel safe or unsafe to raise ideas, challenge decisions, take risks or discuss failure.",
  skills_and_coaching: "Practical innovation skills, training, coaching or access to expertise.",
  collaboration_and_silos: "Cross-functional collaboration, knowledge sharing, hand-offs or organisational silos.",
  customer_insight: "Customer needs, customer understanding, co-creation or external problem evidence.",
  experimentation: "Testing assumptions, pilots, learning from evidence, iteration or permission to experiment.",
  process_clarity: "Clarity of the idea-to-implementation process, criteria, ownership or decision gates.",
  implementation_and_adoption: "Moving tested ideas into operations, adoption, ownership or last-mile execution.",
  value_measurement: "Tracking benefits, outcomes, value, portfolio performance or communicating realised impact.",
} as const;

type DatabaseClient = {
  from: (table: string) => any;
};

type ShadowContext = {
  campaignId: string;
  groupId: string;
  fallbackThreshold: number;
  questionnaire: any;
};

function noul(instructions: string, yes: string, no: string) {
  return { type: "noul", instructions, criteria: { true: yes, false: no } };
}

export function buildCommentCodingRequest(comment: string, pillar: string | null, prompt: string | null) {
  const text = String(comment || "").trim();
  if (!text) throw new Error("comment is required");
  const questions: Record<string, unknown> = {
    primary_pillar: {
      type: "choice",
      instructions: "Which innovation-system pillar is the primary subject of `comment`? Use `survey_context` as context, but classify what the respondent actually wrote.",
      criteria: PILLAR_CRITERIA,
    },
    actionability: {
      type: "score",
      instructions: "How actionable is `comment` for an assessment analyst?",
      criteria: [
        "No substantive observation or action-relevant detail.",
        "A broad sentiment or problem is present, but the cause or location is unclear.",
        "A specific problem, cause, example, affected process or testable suggestion is present.",
      ],
    },
    contains_identifying_detail: noul(
      "Does `comment` contain detail that could identify a natural person, such as a name, contact detail, uniquely identifying job description or uniquely identifying incident?",
      "At least one person could plausibly be identified from the text or its unusually specific incident detail.",
      "No natural person is identified or plausibly singled out.",
    ),
  };
  for (const [id, definition] of Object.entries(COMMENT_THEMES)) {
    questions[`theme_${id}`] = noul(
      `Does \`comment\` substantively express the theme defined as: ${definition}`,
      "The theme is explicitly present or strongly implied by a concrete observation.",
      "The theme is absent, merely adjacent, or cannot be established from the comment.",
    );
  }
  return {
    model: COMMENT_CODING_MODEL,
    state: {
      comment: text.slice(0, 4000),
      survey_context: {
        stated_pillar: pillar ? String(pillar).slice(0, 120) : null,
        question_prompt: prompt ? String(prompt).slice(0, 1000) : null,
      },
    },
    questions,
  };
}

export function normaliseCommentCodingAnswers(payload: any) {
  const answers = payload?.answers;
  if (!answers || typeof answers !== "object") throw new Error("invalid_response");
  const pillar = answers.primary_pillar;
  const actionability = answers.actionability;
  const identifying = answers.contains_identifying_detail;
  if (pillar?.type !== "choice" || !Object.hasOwn(PILLAR_CRITERIA, pillar.choice)) throw new Error("invalid_response");
  if (!Number.isFinite(pillar.confidence) || !Number.isFinite(actionability?.score) || !Number.isFinite(actionability?.confidence)) throw new Error("invalid_response");
  if (!Number.isFinite(identifying?.noul) || identifying.noul < 0 || identifying.noul > 1) throw new Error("invalid_response");

  const themes: Record<string, number> = {};
  for (const id of Object.keys(COMMENT_THEMES)) {
    const probability = answers[`theme_${id}`]?.noul;
    if (!Number.isFinite(probability) || probability < 0 || probability > 1) throw new Error("invalid_response");
    themes[id] = probability;
  }
  return {
    model: String(payload.model || COMMENT_CODING_MODEL),
    primary_pillar: pillar.choice,
    primary_pillar_confidence: pillar.confidence,
    actionability: actionability.score,
    actionability_confidence: actionability.confidence,
    identifying_detail_probability: identifying.noul,
    theme_probabilities: themes,
    answers,
  };
}

export function commentPromptForPillar(questionnaire: any, pillarId: string) {
  const pillar = Array.isArray(questionnaire?.pillars)
    ? questionnaire.pillars.find((item: any) => item?.id === pillarId)
    : null;
  return typeof pillar?.commentPrompt === "string" ? pillar.commentPrompt : null;
}

export function hasReachedCommentThreshold(validResponses: number, threshold: number) {
  return Number(validResponses) >= Math.max(4, Number(threshold) || 4);
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
        signal: AbortSignal.timeout(20_000),
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

async function effectiveCommentThreshold(admin: DatabaseClient, campaignId: string, fallback: number) {
  const { data } = await admin.from("fs_campaign_governance")
    .select("comment_threshold,score_threshold")
    .eq("campaign_id", campaignId)
    .maybeSingle();
  return Math.max(4, Number(data?.comment_threshold || data?.score_threshold || fallback || 4));
}

async function evaluateOne(admin: DatabaseClient, apiKey: string, row: any, comment: any, questionnaire: any) {
  const attempt = Number(row.attempt_count || 0) + 1;
  await admin.from("fs_comment_coding_shadow").update({
    status: "processing", attempt_count: attempt, error_code: null, updated_at: new Date().toISOString(),
  }).eq("id", row.id);

  try {
    const request = buildCommentCodingRequest(
      comment.body,
      comment.pillar,
      commentPromptForPillar(questionnaire, comment.pillar),
    );
    const { payload, latencyMs } = await callTypeSafe(apiKey, request);
    const result = normaliseCommentCodingAnswers(payload);
    await admin.from("fs_comment_coding_shadow").update({
      ...result,
      status: "complete",
      latency_ms: latencyMs,
      completed_at: new Date().toISOString(),
      updated_at: new Date().toISOString(),
      error_code: null,
    }).eq("id", row.id);
  } catch (error) {
    await admin.from("fs_comment_coding_shadow").update({
      status: "error",
      error_code: errorCode(error),
      updated_at: new Date().toISOString(),
    }).eq("id", row.id);
  }
}

export async function queueCommentCodingRows(admin: DatabaseClient, comments: any[], context: Omit<ShadowContext, "fallbackThreshold" | "questionnaire">) {
  if (!comments.length) return;
  const rows = comments.map((comment) => ({
    comment_id: comment.id,
    response_id: comment.response_id,
    campaign_id: context.campaignId,
    group_id: context.groupId,
    schema_version: COMMENT_CODING_SCHEMA_VERSION,
    model: COMMENT_CODING_MODEL,
    status: "pending",
  }));
  const { error } = await admin.from("fs_comment_coding_shadow").upsert(rows, {
    onConflict: "comment_id,schema_version",
    ignoreDuplicates: true,
  });
  if (error) console.error("comment coding queue failed", error.code || "database_error");
}

export async function runEligibleCommentCodingShadow(admin: DatabaseClient, context: ShadowContext) {
  if (Deno.env.get("JEV_COMMENT_CODING_SHADOW") !== "true") return;
  const apiKey = Deno.env.get("TYPESAFE_API_KEY")?.trim();
  if (!apiKey) {
    console.error("comment coding shadow is enabled but TYPESAFE_API_KEY is missing");
    return;
  }

  const threshold = await effectiveCommentThreshold(admin, context.campaignId, context.fallbackThreshold);
  const { count, error: countError } = await admin.from("fs_responses")
    .select("id", { count: "exact", head: true })
    .eq("campaign_id", context.campaignId)
    .eq("group_id", context.groupId)
    .eq("valid", true);
  if (countError || !hasReachedCommentThreshold(count || 0, threshold)) return;

  const { data: pending, error: pendingError } = await admin.from("fs_comment_coding_shadow")
    .select("id,comment_id,response_id,attempt_count,status")
    .eq("campaign_id", context.campaignId)
    .eq("group_id", context.groupId)
    .in("status", ["pending", "error"])
    .lt("attempt_count", 3)
    .order("created_at")
    .limit(MAX_COMMENTS_PER_RUN);
  if (pendingError || !pending?.length) return;

  const ids = pending.map((row: any) => row.comment_id);
  const { data: comments, error: commentsError } = await admin.from("fs_comments")
    .select("id,response_id,pillar,body")
    .in("id", ids);
  if (commentsError || !comments?.length) return;
  const byId = new Map(comments.map((comment: any) => [comment.id, comment]));

  for (let index = 0; index < pending.length; index += CONCURRENCY) {
    const batch = pending.slice(index, index + CONCURRENCY);
    await Promise.all(batch.map((row: any) => {
      const comment = byId.get(row.comment_id);
      return comment ? evaluateOne(admin, apiKey, row, comment, context.questionnaire) : Promise.resolve();
    }));
  }
}

