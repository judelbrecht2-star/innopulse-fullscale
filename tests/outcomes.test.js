import { describe, expect, it } from "vitest";
import { outcomeAssessment } from "../app/lib/outcomes.js";

describe("intervention outcome learning", () => {
  it("stays planned until an observed score is recorded", () => {
    expect(outcomeAssessment({ baseline: 40, target: 60 })).toEqual({ status: "planned", delta: null, progressPct: null });
  });

  it("calculates progress toward a target", () => {
    expect(outcomeAssessment({ baseline: 40, target: 60, observed: 50 })).toEqual({ status: "on_track", delta: 10, progressPct: 50 });
    expect(outcomeAssessment({ baseline: 40, target: 60, observed: 61 }).status).toBe("achieved");
  });

  it("marks stalled and overdue outcomes conservatively", () => {
    expect(outcomeAssessment({ baseline: 40, target: 60, observed: 39 }).status).toBe("at_risk");
    expect(outcomeAssessment({ baseline: 40, target: 60, observed: 55, reviewDueAt: "2026-01-01", now: new Date("2026-09-22") }).status).toBe("not_achieved");
  });

  it("does not infer progress without a baseline", () => {
    expect(outcomeAssessment({ target: 60, observed: 55 }).status).toBe("inconclusive");
  });
});
