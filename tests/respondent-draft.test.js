import { describe, it, expect } from "vitest";
import { restoreDraft, missingQuestions } from "../app/lib/respondent-draft";
const data = {
  questionnaire: { scale: [{ code: "yes" }, { code: "dk" }, { code: 0 }], pillars: [{ id: "sii", questions: [{ key: "a" }, { key: "b" }] }] },
  campaign: { demographics: [{ id: "department", options: ["Sales", "Operations"] }], segments: ["North"] },
};
describe("respondent draft recovery", () => {
  it("restores optional context and comments alongside answers", () => {
    const draft = { answers: { a: "yes" }, comments: { sii: "More time for ideas" }, demo: { department: "Sales" }, segment: "North" };
    expect(restoreDraft(draft, data)).toEqual(draft);
  });
  it("drops obsolete questions and invalid choices instead of reporting false completion", () => {
    const clean = restoreDraft({ answers: { a: "invalid", b: "dk", obsolete: "yes" } }, data);
    expect(clean.answers).toEqual({ b: "dk" });
    expect(missingQuestions(data.questionnaire, clean.answers).map(q => q.key)).toEqual(["a"]);
  });
  it("rejects context values removed from the configured questionnaire", () => {
    const clean = restoreDraft({ demo: { department: "Unknown", extra: "Sales" }, segment: "South", comments: { unknown: "wrong pillar" } }, data);
    expect(clean).toEqual({ answers: {}, comments: {}, demo: {}, segment: "" });
  });
  it("accepts a zero-valued scale code and don't-know as complete answers", () => expect(missingQuestions(data.questionnaire, { a: 0, b: "dk" })).toEqual([]));
  it("handles a malformed saved draft", () => expect(restoreDraft(null, data).answers).toEqual({}));
});
