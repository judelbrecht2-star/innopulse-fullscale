import { describe, it, expect } from "vitest";
import {
  ANON_FLOOR, effectiveThresholds, scoresReleased, commentsReleased, gateFor, gateReason,
} from "../app/lib/thresholds.js";

/* These tests are the written form of the privacy promise. If one of them fails,
   something has become willing to release data it previously would not — treat a
   failure here as a security regression, not a broken test. */

describe("the hard floor", () => {
  it("is 4 and cannot be lowered by governance", () => {
    expect(ANON_FLOOR).toBe(4);
    expect(effectiveThresholds({ score_threshold: 1, comment_threshold: 1 }).score).toBe(4);
  });

  it("cannot be lowered by the deprecated campaign column either", () => {
    expect(effectiveThresholds(null, { anonymity_threshold: 2 }).score).toBe(4);
  });

  it("cannot be lowered by a missing or nonsense value", () => {
    for (const bad of [null, undefined, "", NaN, "abc", 0, -10]) {
      const t = effectiveThresholds({ score_threshold: bad, comment_threshold: bad });
      expect(t.score).toBeGreaterThanOrEqual(ANON_FLOOR);
      expect(t.comment).toBeGreaterThanOrEqual(ANON_FLOOR);
    }
  });
});

describe("resolving the pair in force", () => {
  it("prefers governance over the deprecated campaign mirror", () => {
    const t = effectiveThresholds({ score_threshold: 8, comment_threshold: 12 }, { anonymity_threshold: 5 });
    expect(t).toEqual({ score: 8, comment: 12 });
  });

  it("falls back to the campaign column only when there is no governance row", () => {
    expect(effectiveThresholds(null, { anonymity_threshold: 7 })).toEqual({ score: 7, comment: 7 });
  });

  it("defaults to 5 when a campaign has neither", () => {
    expect(effectiveThresholds(null, null)).toEqual({ score: 5, comment: 5 });
  });

  it("never lets the comment threshold sit below the score threshold", () => {
    // A campaign configured this way would leak: scores gated at 10, verbatims at 6.
    expect(effectiveThresholds({ score_threshold: 10, comment_threshold: 6 })).toEqual({ score: 10, comment: 10 });
  });
});

describe("release decisions", () => {
  const t = { score: 5, comment: 10 };

  it("suppresses scores strictly below the score threshold", () => {
    expect(scoresReleased(4, t)).toBe(false);
    expect(scoresReleased(5, t)).toBe(true);   // boundary is inclusive
  });

  it("suppresses comments strictly below the comment threshold", () => {
    expect(commentsReleased(9, t)).toBe(false);
    expect(commentsReleased(10, t)).toBe(true);
  });

  it("describes the three states a group can be in", () => {
    expect(gateFor(0, t)).toBe("suppressed");
    expect(gateFor(4, t)).toBe("suppressed");
    expect(gateFor(5, t)).toBe("scores-only");
    expect(gateFor(9, t)).toBe("scores-only");
    expect(gateFor(10, t)).toBe("released");
    expect(gateFor(999, t)).toBe("released");
  });

  it("treats a missing count as zero rather than as released", () => {
    for (const bad of [null, undefined, NaN, "x"]) {
      expect(gateFor(bad, t)).toBe("suppressed");
    }
  });

  it("collapses to one gate when both thresholds are equal", () => {
    const eq = { score: 6, comment: 6 };
    expect(gateFor(5, eq)).toBe("suppressed");
    expect(gateFor(6, eq)).toBe("released");
  });
});

describe("what the user is told", () => {
  const t = { score: 5, comment: 10 };

  it("says nothing when a group is fully released", () => {
    expect(gateReason(10, t)).toBeNull();
  });

  it("names the threshold and the current count while suppressed", () => {
    const s = gateReason(3, t);
    expect(s).toContain("5");
    expect(s).toContain("3");
  });

  it("distinguishes 'scores shown, comments hidden' from full suppression", () => {
    expect(gateReason(7, t)).toContain("comments");
    expect(gateReason(2, t)).not.toContain("Scores are shown");
  });
});
