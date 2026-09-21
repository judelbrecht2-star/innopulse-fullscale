export const FINDING_CORROBORATION_SCHEMA_VERSION = "finding-corroboration-v2";
export const FINDING_CORROBORATION_MODEL = "jev-latest";
export const MAX_EVIDENCE_COMMENTS = 12;

export type FindingInput = {
  id: string;
  title: string;
  conclusion: string;
  alternatives?: string | null;
  klass?: string | null;
};

export type EvidenceComment = {
  id: number;
  group_id: string;
  pillar?: string | null;
  body: string;
  actionability?: number | null;
  identifying_detail_probability?: number | null;
};

export type CorroborationResult = {
  comment_id: number;
  supports: number;
  contradicts: number;
  relevance: number;
  relevance_confidence: number;
};

export type EvidenceDisposition = "supporting" | "contradictory" | "context" | "irrelevant";

function noul(instructions: string, yes: string, no: string) {
  return { type: "noul", instructions, criteria: { true: yes, false: no } };
}

function score(instructions: string, criteria: string[]) {
  return { type: "score", instructions, criteria };
}

function boundedText(value: unknown, field: string, max: number) {
  const text = String(value ?? "").trim();
  if (!text) throw new Error(`${field} is required`);
  return text.slice(0, max);
}

export function buildFindingCorroborationBatchRequest(finding: FindingInput, comments: EvidenceComment[]) {
  if (!Array.isArray(comments) || !comments.length) throw new Error("at least one comment is required");
  if (comments.length > MAX_EVIDENCE_COMMENTS) throw new Error(`no more than ${MAX_EVIDENCE_COMMENTS} comments may be evaluated`);

  const stateComments = comments.map((comment, index) => ({
    ref: `c${index + 1}`,
    text: boundedText(comment.body, `comments[${index}].body`, 4000),
    stated_pillar: comment.pillar ? String(comment.pillar).slice(0, 120) : null,
  }));
  const questions: Record<string, unknown> = {};

  for (let index = 0; index < comments.length; index += 1) {
    const ref = `c${index + 1}`;
    questions[`${ref}_supports`] = noul(
      `Does the comment with ref ${ref} provide relevant evidence that supports the specific claim in finding.conclusion? Evaluate only that comment, not the other comments.`,
      "The comment supplies a relevant experience, observation or example in the same direction as the finding.",
      "The comment is irrelevant, too vague, neutral, or does not support the finding.",
    );
    questions[`${ref}_contradicts`] = noul(
      `Does the comment with ref ${ref} provide relevant evidence that contradicts or materially qualifies finding.conclusion? Evaluate only that comment, not the other comments.`,
      "The comment supplies an exception, opposing experience or fact that weakens or narrows the finding.",
      "The comment does not contradict or materially qualify the finding.",
    );
    questions[`${ref}_relevance`] = score(
      `How directly relevant is the comment with ref ${ref} to evaluating finding.conclusion? Evaluate only that comment.`,
      [
        "Unrelated or no usable evidence.",
        "Related topic, but indirect or ambiguous evidence.",
        "Direct, specific evidence for or against the finding.",
      ],
    );
  }

  return {
    model: FINDING_CORROBORATION_MODEL,
    state: {
      finding: {
        title: boundedText(finding?.title, "finding.title", 500),
        conclusion: boundedText(finding?.conclusion, "finding.conclusion", 2500),
        alternative_explanations: finding?.alternatives ? String(finding.alternatives).trim().slice(0, 2000) : null,
      },
      comments: stateComments,
    },
    questions,
  };
}

function probability(answer: any) {
  if (answer?.type !== "noul" || !Number.isFinite(answer.noul) || answer.noul < 0 || answer.noul > 1) {
    throw new Error("invalid_response");
  }
  return Number(answer.noul);
}

export function normaliseFindingCorroborationAnswers(payload: any, comments: EvidenceComment[]) {
  const answers = payload?.answers;
  if (!answers || typeof answers !== "object") throw new Error("invalid_response");

  const results: CorroborationResult[] = comments.map((comment, index) => {
    const ref = `c${index + 1}`;
    const relevance = answers[`${ref}_relevance`];
    if (relevance?.type !== "score" || !Number.isFinite(relevance.score) || relevance.score < 0 || relevance.score > 2) {
      throw new Error("invalid_response");
    }
    if (!Number.isFinite(relevance.confidence) || relevance.confidence < 0 || relevance.confidence > 1) {
      throw new Error("invalid_response");
    }
    return {
      comment_id: comment.id,
      supports: probability(answers[`${ref}_supports`]),
      contradicts: probability(answers[`${ref}_contradicts`]),
      relevance: Number(relevance.score),
      relevance_confidence: Number(relevance.confidence),
    };
  });

  return { model: String(payload.model || FINDING_CORROBORATION_MODEL), results, answers };
}

export function evidenceDisposition(row: CorroborationResult): EvidenceDisposition {
  if (row.relevance < 1) return "irrelevant";
  if (row.supports >= 0.7 && row.supports >= row.contradicts + 0.15) return "supporting";
  if (row.contradicts >= 0.7 && row.contradicts >= row.supports + 0.15) return "contradictory";
  return "context";
}

export function aggregateCorroboration(results: CorroborationResult[], eligibleCommentCount = results.length) {
  const relevant = results.filter((row) => row.relevance >= 1);
  const supportCount = relevant.filter((row) => evidenceDisposition(row) === "supporting").length;
  const contradictionCount = relevant.filter((row) => evidenceDisposition(row) === "contradictory").length;
  const contextCount = relevant.length - supportCount - contradictionCount;
  const mean = (key: "supports" | "contradicts" | "relevance") => relevant.length
    ? relevant.reduce((sum, row) => sum + row[key], 0) / relevant.length
    : 0;
  const supportMean = mean("supports");
  const contradictionMean = mean("contradicts");

  let verdict = "insufficient";
  if (supportCount > 0 && contradictionCount > 0) verdict = "mixed";
  else if (supportCount >= 2) verdict = "corroborated";
  else if (contradictionCount >= 2) verdict = "contradicted";
  else if (supportCount === 1) verdict = "leaning_support";
  else if (contradictionCount === 1) verdict = "leaning_contradiction";
  else if (supportMean >= 0.55 && contradictionMean >= 0.55) verdict = "mixed";

  return {
    verdict,
    eligible_comment_count: Number(eligibleCommentCount) || 0,
    evaluated_comment_count: results.length,
    relevant_count: relevant.length,
    support_count: supportCount,
    contradiction_count: contradictionCount,
    context_count: contextCount,
    support_mean: supportMean,
    contradiction_mean: contradictionMean,
    relevance_mean: mean("relevance"),
  };
}

export function selectEvidenceCandidates(rows: EvidenceComment[], max = MAX_EVIDENCE_COMMENTS, perGroup = 3) {
  const safe = rows
    .filter((row) => String(row.body || "").trim())
    .filter((row) => Number(row.identifying_detail_probability ?? 0) <= 0.5)
    .sort((a, b) => Number(b.actionability || 0) - Number(a.actionability || 0) || a.id - b.id);
  const selected: EvidenceComment[] = [];
  const groupCounts = new Map<string, number>();

  // First give each stakeholder-group/pillar combination one place. This keeps
  // a single high-actionability theme from crowding out the rest of the survey.
  const strata = new Set<string>();
  for (const row of safe) {
    const stratum = `${row.group_id}::${row.pillar || "none"}`;
    if (strata.has(stratum)) continue;
    selected.push(row);
    strata.add(stratum);
    groupCounts.set(row.group_id, (groupCounts.get(row.group_id) || 0) + 1);
    if (selected.length >= max) return selected;
  }

  for (const row of safe) {
    if (selected.some((item) => item.id === row.id)) continue;
    const count = groupCounts.get(row.group_id) || 0;
    if (count >= perGroup) continue;
    selected.push(row);
    groupCounts.set(row.group_id, count + 1);
    if (selected.length >= max) return selected;
  }
  for (const row of safe) {
    if (selected.some((item) => item.id === row.id)) continue;
    selected.push(row);
    if (selected.length >= max) break;
  }
  return selected;
}
