import { describe, expect, it } from "vitest";
import {
  buildCommentCodingRequest,
  commentPromptForPillar,
  hasReachedCommentThreshold,
  normaliseCommentCodingAnswers,
} from "../supabase/functions/_shared/comment-coding-shadow.ts";

function validAnswers() {
  const answers = {
    primary_pillar: {
      type: "choice",
      choice: "environment",
      confidence: 0.8,
      probabilities: {},
    },
    actionability: { type: "score", score: 1.5, confidence: 0.7 },
    contains_identifying_detail: { type: "noul", noul: 0.05 },
  };
  for (const id of [
    "strategy_clarity", "resource_constraints", "psychological_safety",
    "skills_and_coaching", "collaboration_and_silos", "customer_insight",
    "experimentation", "process_clarity", "implementation_and_adoption",
    "value_measurement",
  ]) answers[`theme_${id}`] = { type: "noul", noul: id === "psychological_safety" ? 0.91 : 0.04 };
  return answers;
}

describe("Jev comment-coding shadow worker", () => {
  it("builds the bounded typed request used by the successful evaluation", () => {
    const request = buildCommentCodingRequest("People are afraid to discuss failed experiments.", "environment", "What helps or hinders innovation?");
    expect(request.model).toBe("jev-latest");
    expect(request.state.comment).toContain("failed experiments");
    expect(request.questions.primary_pillar.type).toBe("choice");
    expect(request.questions.actionability.type).toBe("score");
    expect(request.questions.theme_psychological_safety.type).toBe("noul");
    expect(Object.keys(request.questions)).toHaveLength(13);
  });

  it("normalises typed answers without retaining the raw comment", () => {
    const result = normaliseCommentCodingAnswers({ model: "jev-1.13.0", answers: validAnswers() });
    expect(result.primary_pillar).toBe("environment");
    expect(result.theme_probabilities.psychological_safety).toBe(0.91);
    expect(result.identifying_detail_probability).toBe(0.05);
    expect(result).not.toHaveProperty("comment");
  });

  it("rejects incomplete model responses", () => {
    const answers = validAnswers();
    delete answers.theme_value_measurement;
    expect(() => normaliseCommentCodingAnswers({ answers })).toThrow("invalid_response");
  });

  it("enforces the hard privacy floor and configured comment threshold", () => {
    expect(hasReachedCommentThreshold(3, 1)).toBe(false);
    expect(hasReachedCommentThreshold(4, 1)).toBe(true);
    expect(hasReachedCommentThreshold(9, 10)).toBe(false);
    expect(hasReachedCommentThreshold(10, 10)).toBe(true);
  });

  it("finds the matching questionnaire prompt without leaking other context", () => {
    const questionnaire = { pillars: [{ id: "environment", commentPrompt: "Describe the environment." }] };
    expect(commentPromptForPillar(questionnaire, "environment")).toBe("Describe the environment.");
    expect(commentPromptForPillar(questionnaire, "process")).toBeNull();
  });
});
