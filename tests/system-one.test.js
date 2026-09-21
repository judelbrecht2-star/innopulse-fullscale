import { describe, expect, it } from "vitest";
import {
  COMMENT_THEMES,
  buildCommentCodingRequest,
  buildFindingCorroborationRequest,
  buildInterventionMatchingRequest,
  buildResponseQualityRequest,
  routeProbability,
  validateSystemOneResponse,
} from "../app/lib/system-one.js";

describe("System One request builders", () => {
  it("decomposes comment coding into independent typed judgments", () => {
    const request = buildCommentCodingRequest({ comment: "We have ideas but no time to test them.", pillar: "Environment" });
    expect(request.model).toBe("jev-latest");
    expect(request.questions.primary_pillar.type).toBe("choice");
    expect(request.questions.actionability.type).toBe("score");
    expect(request.questions.contains_identifying_detail.type).toBe("noul");
    expect(Object.keys(COMMENT_THEMES).every((id) => request.questions[`theme_${id}`]?.type === "noul")).toBe(true);
    expect(JSON.stringify(request)).not.toMatch(/api[_-]?key|authorization/i);
  });

  it("keeps finding support and contradiction separate", () => {
    const request = buildFindingCorroborationRequest({
      comment: "People know the priorities.",
      finding: { title: "Strategy is opaque", conclusion: "Employees cannot see the strategic priorities." },
    });
    expect(request.questions.supports_finding.type).toBe("noul");
    expect(request.questions.contradicts_finding.type).toBe("noul");
    expect(request.questions.evidence_relevance.type).toBe("score");
  });

  it("constrains interventions to an approved library plus none", () => {
    const request = buildInterventionMatchingRequest({
      finding: { title: "No feedback", conclusion: "Submitters cannot see decisions." },
      candidates: [{ id: "visible-funnel", summary: "Publish owner, stage and decision for each idea." }],
    });
    expect(request.questions.intervention.criteria).toHaveProperty("visible_funnel");
    expect(request.questions.intervention.criteria).toHaveProperty("none");
  });

  it("rejects an empty intervention candidate set", () => {
    expect(() => buildInterventionMatchingRequest({ finding: { title: "x", conclusion: "y" }, candidates: [] })).toThrow(/candidate/i);
  });

  it("builds quality triage without making an automatic exclusion decision", () => {
    const request = buildResponseQualityRequest({ comment: "test test", prompt: "What changed?" });
    expect(request.questions.quality.criteria).toEqual(expect.objectContaining({ usable: expect.any(String), test_or_gibberish: expect.any(String) }));
    expect(request.questions).not.toHaveProperty("exclude_response");
  });
});

describe("System One response contracts", () => {
  it("accepts a complete typed response", () => {
    const request = buildResponseQualityRequest({ comment: "A specific observation." });
    const response = {
      model: "jev-1.13.0",
      answers: {
        quality: { type: "choice", choice: "usable", probabilities: { usable: 0.8, vague: 0.1, off_topic: 0.05, test_or_gibberish: 0.05 }, confidence: 0.75 },
        contains_identifying_detail: { type: "noul", noul: 0.02 },
      },
    };
    expect(validateSystemOneResponse(request, response)).toEqual({ ok: true, errors: [] });
  });

  it("rejects missing answers and invalid distributions", () => {
    const request = buildResponseQualityRequest({ comment: "A specific observation." });
    const result = validateSystemOneResponse(request, {
      answers: { quality: { type: "choice", choice: "unknown", probabilities: {}, confidence: 4 } },
    });
    expect(result.ok).toBe(false);
    expect(result.errors.join(" ")).toMatch(/outside|missing|confidence/i);
  });

  it("routes probability conservatively", () => {
    expect(routeProbability(0.95)).toBe("positive");
    expect(routeProbability(0.05)).toBe("negative");
    expect(routeProbability(0.5)).toBe("review");
    expect(routeProbability("bad")).toBe("invalid");
  });
});
