import { describe, expect, it } from "vitest";
import {
  aggregateCorroboration,
  buildFindingCorroborationBatchRequest,
  evidenceDisposition,
  normaliseFindingCorroborationAnswers,
  selectEvidenceCandidates,
} from "../supabase/functions/_shared/finding-corroboration-shadow.ts";

const finding = {
  id: "idea_pathway",
  title: "There is no visible pathway for an idea",
  conclusion: "People cannot see how an idea moves from submission to implementation.",
  alternatives: "The process may exist but be poorly communicated.",
  klass: "Supported interpretation",
};

const comments = [
  { id: 11, group_id: "g1", pillar: "process", body: "Ideas disappear after submission.", actionability: 1.8, identifying_detail_probability: 0.02 },
  { id: 12, group_id: "g2", pillar: "process", body: "Every idea has an owner and visible stage.", actionability: 1.6, identifying_detail_probability: 0.03 },
];

function responseFor(values) {
  const answers = {};
  values.forEach((value, index) => {
    const ref = `c${index + 1}`;
    answers[`${ref}_supports`] = { type: "noul", noul: value.supports };
    answers[`${ref}_contradicts`] = { type: "noul", noul: value.contradicts };
    answers[`${ref}_relevance`] = { type: "score", score: value.relevance, confidence: 0.85 };
  });
  return { model: "jev-1.13.0", answers };
}

describe("Jev finding corroboration shadow worker", () => {
  it("evaluates support, contradiction and relevance separately for every comment", () => {
    const request = buildFindingCorroborationBatchRequest(finding, comments);
    expect(request.model).toBe("jev-latest");
    expect(request.state.comments).toHaveLength(2);
    expect(Object.keys(request.questions)).toHaveLength(6);
    expect(request.questions.c1_supports.type).toBe("noul");
    expect(request.questions.c1_contradicts.type).toBe("noul");
    expect(request.questions.c1_relevance.type).toBe("score");
  });

  it("normalises typed answers without retaining comment text", () => {
    const normalised = normaliseFindingCorroborationAnswers(responseFor([
      { supports: 0.9, contradicts: 0.04, relevance: 1.8 },
      { supports: 0.08, contradicts: 0.91, relevance: 1.7 },
    ]), comments);
    expect(normalised.model).toBe("jev-1.13.0");
    expect(normalised.results[0]).toEqual(expect.objectContaining({ comment_id: 11, supports: 0.9 }));
    expect(JSON.stringify(normalised.results)).not.toContain("Ideas disappear");
  });

  it("routes convergent support, contradiction and mixed evidence conservatively", () => {
    expect(aggregateCorroboration([
      { comment_id: 1, supports: 0.91, contradicts: 0.04, relevance: 1.9, relevance_confidence: 0.9 },
      { comment_id: 2, supports: 0.82, contradicts: 0.08, relevance: 1.6, relevance_confidence: 0.8 },
    ]).verdict).toBe("corroborated");
    expect(aggregateCorroboration([
      { comment_id: 1, supports: 0.05, contradicts: 0.9, relevance: 1.8, relevance_confidence: 0.9 },
      { comment_id: 2, supports: 0.09, contradicts: 0.83, relevance: 1.7, relevance_confidence: 0.8 },
    ]).verdict).toBe("contradicted");
    expect(aggregateCorroboration([
      { comment_id: 1, supports: 0.91, contradicts: 0.04, relevance: 1.9, relevance_confidence: 0.9 },
      { comment_id: 2, supports: 0.05, contradicts: 0.9, relevance: 1.8, relevance_confidence: 0.9 },
    ]).verdict).toBe("mixed");
    expect(aggregateCorroboration([
      { comment_id: 1, supports: 0.95, contradicts: 0.02, relevance: 0.2, relevance_confidence: 0.9 },
    ]).verdict).toBe("insufficient");
  });

  it("does not let ambiguous context dilute decisive evidence", () => {
    const directSupport = [1, 2, 3].map((comment_id) => ({
      comment_id, supports: 0.86, contradicts: 0.08, relevance: 2, relevance_confidence: 0.9,
    }));
    const context = Array.from({ length: 6 }, (_, index) => ({
      comment_id: index + 10, supports: 0.3, contradicts: 0.25, relevance: 1, relevance_confidence: 0.7,
    }));
    const result = aggregateCorroboration([...directSupport, ...context]);
    expect(result.verdict).toBe("corroborated");
    expect(result.support_count).toBe(3);
    expect(result.context_count).toBe(6);
  });

  it("uses directional verdicts for one decisive comment", () => {
    const supporting = { comment_id: 1, supports: 0.9, contradicts: 0.05, relevance: 2, relevance_confidence: 0.9 };
    const contradictory = { comment_id: 2, supports: 0.03, contradicts: 0.88, relevance: 2, relevance_confidence: 0.9 };
    expect(evidenceDisposition(supporting)).toBe("supporting");
    expect(evidenceDisposition(contradictory)).toBe("contradictory");
    expect(aggregateCorroboration([supporting]).verdict).toBe("leaning_support");
    expect(aggregateCorroboration([contradictory]).verdict).toBe("leaning_contradiction");
  });

  it("excludes identity-risk comments and prevents one group dominating the sample", () => {
    const rows = [
      ...Array.from({ length: 5 }, (_, i) => ({ id: i + 1, group_id: "g1", body: `g1-${i}`, actionability: 2 - i / 10, identifying_detail_probability: 0.02 })),
      ...Array.from({ length: 3 }, (_, i) => ({ id: i + 10, group_id: "g2", body: `g2-${i}`, actionability: 1.2 - i / 10, identifying_detail_probability: 0.02 })),
      { id: 99, group_id: "g3", body: "Names a person", actionability: 2, identifying_detail_probability: 0.91 },
    ];
    const selected = selectEvidenceCandidates(rows, 6, 3);
    expect(selected).toHaveLength(6);
    expect(selected.filter((row) => row.group_id === "g1")).toHaveLength(3);
    expect(selected.filter((row) => row.group_id === "g2")).toHaveLength(3);
    expect(selected.some((row) => row.id === 99)).toBe(false);
  });

  it("represents distinct pillars before filling the remaining sample", () => {
    const rows = [
      { id: 1, group_id: "g1", pillar: "strategy", body: "s1", actionability: 2, identifying_detail_probability: 0.01 },
      { id: 2, group_id: "g1", pillar: "strategy", body: "s2", actionability: 1.9, identifying_detail_probability: 0.01 },
      { id: 3, group_id: "g1", pillar: "process", body: "p1", actionability: 1.2, identifying_detail_probability: 0.01 },
      { id: 4, group_id: "g1", pillar: "value", body: "v1", actionability: 1.1, identifying_detail_probability: 0.01 },
    ];
    const selected = selectEvidenceCandidates(rows, 3, 3);
    expect(selected.map((row) => row.id)).toEqual([1, 3, 4]);
  });
});
