/*
 * Candidate System One workflows for InnoPulse.
 *
 * This module is deliberately pure: it builds typed request bodies and validates
 * typed responses, but it never reads an API key or performs a network request.
 * Production calls belong in a server-only Supabase Edge Function after the
 * comment threshold and tenant permissions have been enforced.
 */

export const SYSTEM_ONE_MODEL = "jev-latest";

export const PILLAR_CRITERIA = Object.freeze({
  strategic_intent: "Direction, priorities, sponsorship, investment intent or strategic alignment.",
  environment: "Culture, psychological safety, collaboration, time, incentives or experimentation conditions.",
  capability: "Skills, coaching, tools, data, technology or organisational capability.",
  process: "Idea capture, evaluation, portfolio governance, piloting, customer involvement or implementation process.",
  return_on_innovation: "Adoption, realised value, measurement, benefits, learning or communication of outcomes.",
  cross_cutting: "The comment materially covers several pillars and no single pillar is primary.",
  none: "The comment does not contain a substantive innovation-system observation.",
});

export const COMMENT_THEMES = Object.freeze({
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
});

export const SYSTEM_ONE_APPLICATIONS = Object.freeze({
  comment_coding: {
    label: "Written-response theme coding",
    recommendation: "pilot",
    value: "Removes repetitive manual tagging while keeping analysts in control.",
    risk: "medium",
  },
  finding_corroboration: {
    label: "Finding support and contradiction",
    recommendation: "pilot",
    value: "Surfaces qualitative evidence that strengthens or challenges a deterministic finding.",
    risk: "medium",
  },
  response_quality: {
    label: "Written-response quality triage",
    recommendation: "shadow_only",
    value: "Prioritises comments that may be off-topic, test data, vague or identifying.",
    risk: "high",
  },
  intervention_matching: {
    label: "Approved intervention matching",
    recommendation: "evaluate_later",
    value: "Ranks an already-approved library when several interventions could fit.",
    risk: "medium_high",
  },
});

function requiredText(value, field, max = 6000) {
  const out = String(value ?? "").trim();
  if (!out) throw new Error(`${field} is required.`);
  if (out.length > max) throw new Error(`${field} exceeds ${max} characters.`);
  return out;
}

function optionalText(value, max = 2000) {
  const out = String(value ?? "").trim();
  return out ? out.slice(0, max) : null;
}

function safeId(value, fallback) {
  const out = String(value ?? "").toLowerCase().replace(/[^a-z0-9_]+/g, "_").replace(/^_+|_+$/g, "").slice(0, 80);
  return out || fallback;
}

function noul(instructions, yes, no) {
  return {
    type: "noul",
    instructions,
    criteria: { true: yes, false: no },
  };
}

function choice(instructions, criteria) {
  return { type: "choice", instructions, criteria };
}

function score(instructions, criteria) {
  return { type: "score", instructions, criteria };
}

export function buildCommentCodingRequest({ comment, pillar = null, prompt = null } = {}) {
  const state = {
    comment: requiredText(comment, "comment"),
    survey_context: {
      stated_pillar: optionalText(pillar, 120),
      question_prompt: optionalText(prompt, 1000),
    },
  };
  const questions = {
    primary_pillar: choice(
      "Which innovation-system pillar is the primary subject of `comment`? Use `survey_context` as context, but classify what the respondent actually wrote.",
      PILLAR_CRITERIA,
    ),
    actionability: score(
      "How actionable is `comment` for an assessment analyst?",
      [
        "No substantive observation or action-relevant detail.",
        "A broad sentiment or problem is present, but the cause or location is unclear.",
        "A specific problem, cause, example, affected process or testable suggestion is present.",
      ],
    ),
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

  return { model: SYSTEM_ONE_MODEL, state, questions };
}

export function buildFindingCorroborationRequest({ comment, finding } = {}) {
  const findingTitle = requiredText(finding?.title, "finding.title", 500);
  const findingConclusion = requiredText(finding?.conclusion, "finding.conclusion", 2500);
  return {
    model: SYSTEM_ONE_MODEL,
    state: {
      comment: requiredText(comment, "comment"),
      finding: {
        title: findingTitle,
        conclusion: findingConclusion,
        alternative_explanations: optionalText(finding?.alternatives, 2000),
      },
    },
    questions: {
      supports_finding: noul(
        "Does `comment` provide relevant evidence that supports the specific claim in `finding.conclusion`?",
        "The comment supplies relevant experience, observation or example in the same direction as the finding.",
        "The comment is irrelevant, too vague, neutral, or does not support the finding.",
      ),
      contradicts_finding: noul(
        "Does `comment` provide relevant evidence that contradicts or materially qualifies the specific claim in `finding.conclusion`?",
        "The comment supplies an exception, opposing experience or fact that weakens or narrows the finding.",
        "The comment does not contradict or materially qualify the finding.",
      ),
      evidence_relevance: score(
        "How directly relevant is `comment` to evaluating `finding.conclusion`?",
        [
          "Unrelated or no usable evidence.",
          "Related topic, but indirect or ambiguous evidence.",
          "Direct, specific evidence for or against the finding.",
        ],
      ),
    },
  };
}

export function buildResponseQualityRequest({ comment, prompt = null } = {}) {
  return {
    model: SYSTEM_ONE_MODEL,
    state: {
      comment: requiredText(comment, "comment"),
      question_prompt: optionalText(prompt, 1000),
    },
    questions: {
      quality: choice(
        "What is the most appropriate data-quality category for `comment` in the context of `question_prompt`?",
        {
          usable: "A coherent, relevant response containing an interpretable observation or sentiment.",
          vague: "Potentially relevant but too generic, brief or ambiguous to support analysis.",
          off_topic: "Coherent text that does not answer or relate to the prompt.",
          test_or_gibberish: "Obvious test content, keyboard mashing, meaningless text or non-response.",
        },
      ),
      contains_identifying_detail: noul(
        "Does `comment` contain detail that could identify a natural person?",
        "A name, contact detail, unique role or uniquely identifying incident is present.",
        "No natural person is identified or plausibly singled out.",
      ),
    },
  };
}

export function buildInterventionMatchingRequest({ finding, candidates } = {}) {
  const list = Array.isArray(candidates) ? candidates.slice(0, 254) : [];
  if (!list.length) throw new Error("At least one intervention candidate is required.");
  const criteria = { none: "None of the approved interventions is a defensible fit for this finding." };
  for (const [index, item] of list.entries()) {
    const id = safeId(item?.id, `candidate_${index + 1}`);
    if (criteria[id]) throw new Error(`Duplicate intervention id: ${id}`);
    criteria[id] = {
      summary: requiredText(item?.summary, `candidates[${index}].summary`, 1500),
      intended_outcome: optionalText(item?.intendedOutcome, 1000),
      applicability: optionalText(item?.applicability, 1000),
    };
  }
  return {
    model: SYSTEM_ONE_MODEL,
    state: {
      finding: {
        title: requiredText(finding?.title, "finding.title", 500),
        conclusion: requiredText(finding?.conclusion, "finding.conclusion", 2500),
        validation_step: optionalText(finding?.validate, 1200),
      },
    },
    questions: {
      intervention: choice(
        "Which approved intervention is the best direct response to `finding.conclusion`? Choose `none` when the candidates do not address the cause described.",
        criteria,
      ),
    },
  };
}

export function validateSystemOneResponse(request, response) {
  if (!response || typeof response !== "object") throw new Error("Response must be an object.");
  if (!response.answers || typeof response.answers !== "object") throw new Error("Response is missing answers.");
  const errors = [];
  for (const [id, question] of Object.entries(request.questions || {})) {
    const answer = response.answers[id];
    if (!answer) { errors.push(`${id}: missing answer`); continue; }
    if (answer.type !== question.type) errors.push(`${id}: expected ${question.type}, received ${answer.type}`);
    if (question.type === "noul" && !(Number.isFinite(answer.noul) && answer.noul >= 0 && answer.noul <= 1)) {
      errors.push(`${id}: noul must be between 0 and 1`);
    }
    if (question.type === "choice") {
      const options = Object.keys(question.criteria);
      if (!options.includes(answer.choice)) errors.push(`${id}: choice is outside the declared criteria`);
      const probs = answer.probabilities || {};
      if (options.some((key) => !Number.isFinite(probs[key]))) errors.push(`${id}: incomplete probability distribution`);
      const sum = options.reduce((total, key) => total + (Number(probs[key]) || 0), 0);
      if (Math.abs(sum - 1) > 0.02) errors.push(`${id}: probabilities sum to ${sum}`);
      if (!(Number.isFinite(answer.confidence) && answer.confidence >= 0 && answer.confidence <= 1)) errors.push(`${id}: invalid confidence`);
    }
    if (question.type === "score") {
      if (!Number.isFinite(answer.score)) errors.push(`${id}: invalid score`);
      if (!(Number.isFinite(answer.confidence) && answer.confidence >= 0 && answer.confidence <= 1)) errors.push(`${id}: invalid confidence`);
    }
  }
  return { ok: errors.length === 0, errors };
}

export function routeProbability(probability, { positive = 0.9, negative = 0.1 } = {}) {
  const p = Number(probability);
  if (!Number.isFinite(p) || p < 0 || p > 1) return "invalid";
  if (p >= positive) return "positive";
  if (p <= negative) return "negative";
  return "review";
}
