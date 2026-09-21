import { describe, expect, it } from "vitest";
import {
  buildInterventionMatchingRequest,
  normaliseInterventionMatchingAnswer,
} from "../supabase/functions/_shared/intervention-matching.ts";

const finding = {
  title: "There is no visible pathway for an idea",
  conclusion: "People cannot see how an idea moves from submission to implementation.",
  validate: "Ask employees where they would submit an idea.",
  iso: "Clause 8 · Operation",
};
const candidates = [
  { id: "i-1", pillar: "ipm", summary: "Publish a visible idea funnel", actions: ["Name an owner"], kpi: "stage visibility" },
  { id: "i-2", pillar: "oic", summary: "Launch innovation skills training", actions: ["Run workshops"], kpi: "trained staff" },
];

describe("AI intervention matching service", () => {
  it("constrains the decision to aliases for the approved library plus none", () => {
    const { request, candidateMap } = buildInterventionMatchingRequest(finding, candidates);
    expect(candidateMap).toEqual({ c1: "i-1", c2: "i-2" });
    expect(Object.keys(request.questions.intervention.criteria)).toEqual(["none", "c1", "c2"]);
    expect(request.state.finding.conclusion).toContain("submission");
  });

  it("returns a ranked approved result and preserves abstention probability", () => {
    const { candidateMap } = buildInterventionMatchingRequest(finding, candidates);
    const result = normaliseInterventionMatchingAnswer({
      model: "jev-test",
      answers: {
        intervention: {
          type: "choice",
          choice: "c1",
          confidence: 0.88,
          probabilities: { none: 0.05, c1: 0.82, c2: 0.13 },
        },
      },
    }, candidateMap);
    expect(result.selected_id).toBe("i-1");
    expect(result.ranked[0]).toEqual({ id: "i-1", probability: 0.82 });
    expect(result.none_probability).toBe(0.05);
  });

  it("honours an explicit no-match decision", () => {
    const { candidateMap } = buildInterventionMatchingRequest(finding, candidates);
    const result = normaliseInterventionMatchingAnswer({
      answers: {
        intervention: {
          type: "choice",
          choice: "none",
          confidence: 0.79,
          probabilities: { none: 0.74, c1: 0.16, c2: 0.1 },
        },
      },
    }, candidateMap);
    expect(result.selected_id).toBeNull();
  });
});
