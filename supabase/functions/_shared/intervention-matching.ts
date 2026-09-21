export const INTERVENTION_MATCHING_SCHEMA_VERSION = "intervention-matching-v1";
export const INTERVENTION_MATCHING_MODEL = "jev-latest";
export const MAX_INTERVENTION_CANDIDATES = 24;

export type InterventionCandidate = {
  id: string;
  summary: string;
  pillar?: string | null;
  risk?: string | null;
  actions?: string[] | null;
  kpi?: string | null;
  iso_map?: string | null;
};

function boundedText(value: unknown, field: string, max: number) {
  const text = String(value ?? "").trim();
  if (!text) throw new Error(`${field} is required`);
  return text.slice(0, max);
}

export function buildInterventionMatchingRequest(finding: any, candidates: InterventionCandidate[]) {
  if (!Array.isArray(candidates) || !candidates.length) throw new Error("at least one intervention candidate is required");
  if (candidates.length > MAX_INTERVENTION_CANDIDATES) throw new Error(`no more than ${MAX_INTERVENTION_CANDIDATES} candidates may be evaluated`);

  const criteria: Record<string, unknown> = {
    none: "None of the approved interventions directly addresses the cause described by the finding.",
  };
  const candidateMap: Record<string, string> = {};
  candidates.forEach((candidate, index) => {
    const ref = `c${index + 1}`;
    candidateMap[ref] = candidate.id;
    criteria[ref] = {
      summary: boundedText(candidate.summary, `candidates[${index}].summary`, 1500),
      pillar: candidate.pillar || null,
      risk_addressed: candidate.risk || null,
      actions: Array.isArray(candidate.actions) ? candidate.actions.slice(0, 8) : [],
      success_measure: candidate.kpi || null,
      iso_alignment: candidate.iso_map || null,
    };
  });

  return {
    request: {
      model: INTERVENTION_MATCHING_MODEL,
      state: {
        finding: {
          title: boundedText(finding?.title, "finding.title", 500),
          conclusion: boundedText(finding?.conclusion, "finding.conclusion", 2500),
          validation_step: finding?.validate ? String(finding.validate).trim().slice(0, 1200) : null,
          iso_alignment: finding?.iso ? String(finding.iso).trim().slice(0, 300) : null,
        },
      },
      questions: {
        intervention: {
          type: "choice",
          instructions: "Which approved intervention is the best direct response to finding.conclusion? Prefer the intervention that addresses the likely cause and has a measurable outcome. Choose none when no candidate is a defensible fit.",
          criteria,
        },
      },
    },
    candidateMap,
  };
}

export function normaliseInterventionMatchingAnswer(payload: any, candidateMap: Record<string, string>) {
  const answer = payload?.answers?.intervention;
  if (answer?.type !== "choice" || typeof answer.choice !== "string") throw new Error("invalid_response");
  const allowed = new Set(["none", ...Object.keys(candidateMap)]);
  if (!allowed.has(answer.choice)) throw new Error("invalid_response");
  if (!Number.isFinite(answer.confidence) || answer.confidence < 0 || answer.confidence > 1) throw new Error("invalid_response");
  const probabilities = answer.probabilities;
  if (!probabilities || typeof probabilities !== "object") throw new Error("invalid_response");
  const total = [...allowed].reduce((sum, key) => {
    const probability = Number(probabilities[key]);
    if (!Number.isFinite(probability) || probability < 0 || probability > 1) throw new Error("invalid_response");
    return sum + probability;
  }, 0);
  if (Math.abs(total - 1) > 0.02) throw new Error("invalid_response");

  const ranked = Object.entries(candidateMap)
    .map(([ref, id]) => ({ id, probability: Number(probabilities[ref] || 0) }))
    .sort((a, b) => b.probability - a.probability);
  return {
    model: String(payload.model || INTERVENTION_MATCHING_MODEL),
    selected_id: answer.choice === "none" ? null : candidateMap[answer.choice],
    confidence: Number(answer.confidence),
    none_probability: Number(probabilities.none || 0),
    ranked,
  };
}
