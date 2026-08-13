import { describe, it, expect } from "vitest";
import { sharedPillarScores, bestGaps, MIN_ITEMS, MIN_N } from "../app/lib/gaps.js";

/* The gap engine is the single most quotable number in a report ("executives
   score X, employees Y"). Two properties matter more than any other:
     1. it compares only questions BOTH groups were actually asked, and
     2. it identifies groups by id, never by type — several custom groups can
        share the type `other`, and merging them silently would be a real
        finding about the wrong people. */

const PILLARS = [
  { id: "sii", short: "SII", name: "Strategic intent", weight: 1 },
  { id: "iem", short: "IEM", name: "Environment", weight: 1 },
];

const EXEC = { id: "g-exec", type: "executive", label: "Executives" };
const EMP = { id: "g-emp", type: "employee", label: "Employees" };
const OTHER_A = { id: "g-a", type: "other", label: "Union representatives" };
const OTHER_B = { id: "g-b", type: "other", label: "Contractors" };

const cell = (mean, n = 10) => ({ mean, n_scored: n, n_dkna: 0, sd: null, dist: {} });

/* Build an id-keyed question row the way fs-results v9+ emits it. */
function q(key, pillar, audience, byGroupId) {
  return { key, pillar, pillar_short: pillar.toUpperCase(), text: key, audience, groups: byGroupId };
}

describe("shared-question comparison", () => {
  it("averages only over questions served to both groups", () => {
    const questions = [
      // shared, both scored
      q("sii_0", "sii", null, { "g-exec": cell(80), "g-emp": cell(40) }),
      // executive-only: must not affect the comparison at all
      q("sii_ex0", "sii", ["executive"], { "g-exec": cell(10) }),
    ];
    const out = sharedPillarScores(questions, PILLARS, EXEC, EMP);
    expect(out.sii.a).toBe(80);
    expect(out.sii.b).toBe(40);
    expect(out.sii.items).toBe(1);
    expect(out.sii.d).toBe(40);
    expect(out.sii.signed).toBe(40);
  });

  it("signs the difference from the first group's point of view", () => {
    const questions = [q("sii_0", "sii", null, { "g-exec": cell(30), "g-emp": cell(70) })];
    expect(sharedPillarScores(questions, PILLARS, EXEC, EMP).sii.signed).toBe(-40);
    expect(sharedPillarScores(questions, PILLARS, EMP, EXEC).sii.signed).toBe(40);
  });

  it("weights each question by how many people actually scored it", () => {
    // 90 from 1 person and 50 from 9 should land near 54, not at the midpoint 70.
    const questions = [
      q("sii_0", "sii", null, { "g-exec": cell(90, 1), "g-emp": cell(50, 10) }),
      q("sii_1", "sii", null, { "g-exec": cell(50, 9), "g-emp": cell(50, 10) }),
    ];
    const out = sharedPillarScores(questions, PILLARS, EXEC, EMP);
    expect(out.sii.a).toBeCloseTo(54, 0);
  });

  it("returns nulls rather than zeros when nothing is shared", () => {
    const questions = [q("sii_ex0", "sii", ["executive"], { "g-exec": cell(80) })];
    const out = sharedPillarScores(questions, PILLARS, EXEC, EMP);
    expect(out.sii).toMatchObject({ a: null, b: null, d: null, items: 0 });
  });

  it("skips a question either side left unscored", () => {
    const questions = [
      q("sii_0", "sii", null, { "g-exec": cell(80), "g-emp": cell(null) }),
      q("sii_1", "sii", null, { "g-exec": cell(60), "g-emp": cell(40) }),
    ];
    expect(sharedPillarScores(questions, PILLARS, EXEC, EMP).sii.items).toBe(1);
  });

  it("returns an empty object when a group is missing", () => {
    expect(sharedPillarScores([], PILLARS, EXEC, null)).toEqual({});
  });
});

describe("group identity (P0-5)", () => {
  it("keeps two groups that share the type `other` apart", () => {
    const questions = [
      q("sii_0", "sii", null, { "g-a": cell(90), "g-b": cell(30) }),
      q("sii_1", "sii", null, { "g-a": cell(90), "g-b": cell(30) }),
      q("sii_2", "sii", null, { "g-a": cell(90), "g-b": cell(30) }),
      q("sii_3", "sii", null, { "g-a": cell(90), "g-b": cell(30) }),
    ];
    const out = sharedPillarScores(questions, PILLARS, OTHER_A, OTHER_B);
    expect(out.sii.a).toBe(90);
    expect(out.sii.b).toBe(30);
    expect(out.sii.d).toBe(60);
  });

  it("still reads type-keyed data from frozen pre-v9 report snapshots", () => {
    const legacy = [q("sii_0", "sii", null, { executive: cell(80), employee: cell(50) })];
    const out = sharedPillarScores(legacy, PILLARS, EXEC, EMP);
    expect(out.sii.d).toBe(30);
  });

  it("prefers the id over the type when a row carries both", () => {
    const both = [q("sii_0", "sii", null, { "g-exec": cell(80), executive: cell(10), "g-emp": cell(50) })];
    expect(sharedPillarScores(both, PILLARS, EXEC, EMP).sii.a).toBe(80);
  });
});

describe("bestGaps across every visible pair", () => {
  const shared = (a, b) => Array.from({ length: MIN_ITEMS }, (_, i) =>
    q(`sii_${i}`, "sii", null, { "g-exec": cell(a), "g-emp": cell(b), "g-a": cell(65) }));

  it("requires at least MIN_ITEMS shared questions before reporting a gap", () => {
    const tooFew = Array.from({ length: MIN_ITEMS - 1 }, (_, i) =>
      q(`sii_${i}`, "sii", null, { "g-exec": cell(90), "g-emp": cell(20) }));
    expect(bestGaps(tooFew, PILLARS, [EXEC, EMP]).sii).toBeUndefined();
    expect(bestGaps(shared(90, 20), PILLARS, [EXEC, EMP]).sii).toBeDefined();
  });

  it("reports the largest gap and names which side is high", () => {
    const g = bestGaps(shared(30, 80), PILLARS, [EXEC, EMP]).sii;
    expect(g.d).toBe(50);
    expect(g.hi).toBe(80);
    expect(g.lo).toBe(30);
    expect(g.hiId).toBe("g-emp");
    expect(g.loId).toBe("g-exec");
    expect(g.hiLabel).toBe("Employees");
  });

  it("picks the widest pair when three groups are visible", () => {
    const g = bestGaps(shared(90, 20), PILLARS, [EXEC, EMP, OTHER_A]).sii;
    expect(g.d).toBe(70);           // exec 90 vs emp 20 beats either pairing with 65
    expect(new Set([g.hiId, g.loId])).toEqual(new Set(["g-exec", "g-emp"]));
  });

  it("labels a custom `other` group by its label, not by its type", () => {
    const questions = Array.from({ length: MIN_ITEMS }, (_, i) =>
      q(`sii_${i}`, "sii", null, { "g-a": cell(90), "g-b": cell(20) }));
    const g = bestGaps(questions, PILLARS, [OTHER_A, OTHER_B]).sii;
    expect(g.hiLabel).toBe("Union representatives");
    expect(g.loLabel).toBe("Contractors");
  });

  it("returns nothing for a single group or none at all", () => {
    expect(bestGaps(shared(90, 20), PILLARS, [EXEC])).toEqual({});
    expect(bestGaps(shared(90, 20), PILLARS, [])).toEqual({});
    expect(bestGaps(undefined, PILLARS, [EXEC, EMP])).toEqual({});
  });
});

describe("documented guard values", () => {
  it("keeps the indicative-evidence guards where the audit set them", () => {
    // Changing either of these changes what the product is willing to call a
    // finding at small n. That should be a deliberate, reviewed decision.
    expect(MIN_ITEMS).toBe(4);
    expect(MIN_N).toBe(10);
  });
});
