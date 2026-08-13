import { describe, it, expect } from "vitest";
import {
  planSuppression, planDimension, recoverableCells, simulatePrivacy, REASON, ANON_FLOOR,
} from "../app/lib/suppression.js";

/* This file is the specification for suppression, and the edge functions carry a
   port of the same logic. The central property is stated once and then asserted
   against every scenario: after suppression, no hidden cell's exact value may be
   derivable from what was published.
   A failure here is a privacy incident, not a broken test. */

/* The adversary. Given a plan and the published total, can any hidden number
   that contains a real respondent be worked out exactly? A derivably-empty cell
   is not a disclosure — there is nobody in it to identify. */
function attack(plan, total) {
  return recoverableCells(plan.cells, total, !plan.suppressTotal);
}

const cellsOf = (...ns) => ns.map((n, i) => ({ key: "c" + i, n }));
const sum = (ns) => ns.reduce((a, b) => a + b, 0);

describe("direct suppression", () => {
  it("hides any cohort below the threshold", () => {
    const p = planSuppression(cellsOf(10, 3, 12), { threshold: 5 });
    expect(p.cells.find((c) => c.n === 3).suppressed).toBe(true);
    expect(p.cells.find((c) => c.n === 3).reason).toBe(REASON.BELOW);
  });

  it("treats the threshold as inclusive — exactly at the threshold is released", () => {
    const p = planSuppression(cellsOf(5, 20, 20), { threshold: 5 });
    expect(p.cells.find((c) => c.n === 5).suppressed).toBe(false);
  });

  it("never uses a threshold below the hard floor of 4", () => {
    const p = planSuppression(cellsOf(3, 30, 30), { threshold: 1 });
    expect(p.threshold).toBe(ANON_FLOOR);
    expect(p.cells.find((c) => c.n === 3).suppressed).toBe(true);
  });

  it("leaves everything visible when every cohort is large enough", () => {
    const p = planSuppression(cellsOf(10, 12, 15), { threshold: 5 });
    expect(p.cells.every((c) => !c.suppressed)).toBe(true);
    expect(p.suppressTotal).toBe(false);
  });
});

describe("the differencing attack the old code was open to", () => {
  it("does not leave a single hidden cell recoverable by subtraction", () => {
    // 40 total, one group of 3. Publishing the other three groups and the total
    // gives the attacker 40 - 37 = 3. This is the whole point of the module.
    const ns = [3, 12, 13, 12];
    const p = planSuppression(cellsOf(...ns), { threshold: 5 });
    expect(attack(p, sum(ns))).toEqual([]);
    expect(p.cells.filter((c) => c.suppressed).length).toBeGreaterThanOrEqual(2);
  });

  it("hides a second cell, and picks the smallest one to lose least information", () => {
    const p = planSuppression(cellsOf(3, 30, 8, 25), { threshold: 5 });
    const hidden = p.cells.filter((c) => c.suppressed).map((c) => c.n).sort((a, b) => a - b);
    expect(hidden).toEqual([3, 8]);              // 8 chosen, not 25 or 30
    expect(p.cells.find((c) => c.n === 8).reason).toBe(REASON.COMPLEMENTARY);
  });

  it("holds across a spread of randomly generated dimensions", () => {
    // Property test: whatever the shape, nothing is ever recoverable.
    let checked = 0;
    for (let seed = 1; seed <= 400; seed++) {
      const count = 2 + (seed % 6);
      const ns = Array.from({ length: count }, (_, i) => (seed * (i + 3)) % 23);
      for (const mode of ["basic", "strong"]) {
        const p = planSuppression(cellsOf(...ns), { threshold: 5, mode });
        expect(attack(p, sum(ns))).toEqual([]);
        checked++;
      }
    }
    expect(checked).toBe(800);
  });
});

describe("determinism", () => {
  it("hides the same cell every time when several are tied on size", () => {
    // Three groups of five and one of four is a very ordinary shape. Without a
    // tie-break, which group loses its scores would vary between calls, and a
    // regenerated report would disagree with the previous one.
    const cells = [{ key: "partners", n: 4 }, { key: "exec", n: 5 }, { key: "employees", n: 5 }, { key: "customers", n: 5 }];
    const runs = Array.from({ length: 20 }, () =>
      planSuppression(cells, { threshold: 5 }).cells.filter((c) => c.suppressed).map((c) => c.key).sort().join(","));
    expect(new Set(runs).size).toBe(1);
    expect(runs[0]).toBe("customers,partners");   // lowest key among the tied cells
  });

  it("does not depend on the order the cells arrive in", () => {
    const a = [{ key: "x", n: 3 }, { key: "y", n: 9 }, { key: "z", n: 9 }];
    const b = [{ key: "z", n: 9 }, { key: "x", n: 3 }, { key: "y", n: 9 }];
    const keys = (cs) => planSuppression(cs, { threshold: 5 }).cells.filter((c) => c.suppressed).map((c) => c.key).sort().join(",");
    expect(keys(a)).toBe(keys(b));
  });
});

describe("strong indirect protection", () => {
  it("is not satisfied by two hidden cells that sum to almost nothing", () => {
    // Hidden {1, 2} sums to 3. An attacker knows the pair totals 3, so each is
    // pinned to a range of three values — barely protection at all.
    const ns = [1, 2, 40, 40];
    const basic = planSuppression(cellsOf(...ns), { threshold: 5, mode: "basic" });
    const strong = planSuppression(cellsOf(...ns), { threshold: 5, mode: "strong" });

    expect(basic.hiddenSum).toBe(3);
    expect(strong.hiddenSum).toBeGreaterThanOrEqual(5);
    expect(strong.cells.filter((c) => c.suppressed).length)
      .toBeGreaterThan(basic.cells.filter((c) => c.suppressed).length);
  });

  it("marks the extra suppression as a residual protection, not a threshold failure", () => {
    const p = planSuppression(cellsOf(1, 2, 40, 40), { threshold: 5, mode: "strong" });
    expect(p.cells.some((c) => c.reason === REASON.RESIDUAL)).toBe(true);
  });

  it("suppresses more than basic across the board, never less", () => {
    for (let seed = 1; seed <= 200; seed++) {
      const ns = Array.from({ length: 2 + (seed % 5) }, (_, i) => (seed * (i + 2)) % 19);
      const b = planSuppression(cellsOf(...ns), { threshold: 5, mode: "basic" });
      const s = planSuppression(cellsOf(...ns), { threshold: 5, mode: "strong" });
      const nb = b.cells.filter((c) => c.suppressed).length;
      const ns2 = s.cells.filter((c) => c.suppressed).length;
      expect(ns2).toBeGreaterThanOrEqual(nb);
    }
  });
});

describe("dimensions that cannot be protected at all", () => {
  it("suppresses the whole set when there is only one cell and it is too small", () => {
    const p = planSuppression(cellsOf(2), { threshold: 5 });
    expect(p.suppressTotal).toBe(true);
    expect(p.cells.every((c) => c.suppressed)).toBe(true);
  });

  it("hides the whole breakdown rather than the total, when only one cell is safe", () => {
    // Two cells, one below threshold. Hiding the large one too costs the entire
    // breakdown — but the total stays publishable, because two unknowns summing
    // to 43 give an attacker nothing. "43 people responded" is not a disclosure;
    // "3 of them were partners" is.
    const p = planSuppression(cellsOf(3, 40), { threshold: 5 });
    expect(p.cells.every((c) => c.suppressed)).toBe(true);
    expect(p.suppressTotal).toBe(false);
    expect(attack(p, 43)).toEqual([]);
  });

  it("does not treat a derivably-empty cell as a disclosure", () => {
    // Hidden {0, 0}: an attacker derives that both are zero. True, and harmless
    // — there is no respondent in an empty cell. The alternative is that a
    // campaign with no responses reports itself as a privacy failure.
    for (const ns of [[0, 0, 30, 30], [0, 0, 0, 0], [0]]) {
      for (const mode of ["basic", "strong"]) {
        expect(attack(planSuppression(cellsOf(...ns), { threshold: 5, mode }), sum(ns))).toEqual([]);
      }
    }
  });

  it("does treat a derivable non-empty cell as a disclosure — the check has teeth", () => {
    // A hand-built unsafe plan: one hidden cell of 3 with everything else shown.
    const unsafe = {
      cells: [
        { key: "a", n: 3, suppressed: true },
        { key: "b", n: 20, suppressed: false },
        { key: "c", n: 17, suppressed: false },
      ],
      suppressTotal: false,
    };
    expect(recoverableCells(unsafe.cells, 40, true)).toEqual(["a"]);
  });
});

describe("demographic dimensions include the residual", () => {
  /* fs-results publishes "not declared" next to the options. If it is left out
     of the partition, it becomes the subtraction an attacker uses. */
  it("counts not-declared as a cell, not as free information", () => {
    const r = planDimension({
      options: [{ name: "Sales", n: 3 }, { name: "Ops", n: 20 }, { name: "Eng", n: 20 }],
      notDeclared: 7, threshold: 5, mode: "basic",
    });
    const hiddenCount = r.options.filter((o) => o.suppressed).length + (r.notDeclaredSuppressed ? 1 : 0);
    expect(hiddenCount).toBeGreaterThanOrEqual(2);
  });

  it("can suppress the residual itself rather than a real option", () => {
    const r = planDimension({
      options: [{ name: "Sales", n: 3 }, { name: "Ops", n: 30 }, { name: "Eng", n: 30 }],
      notDeclared: 4, threshold: 5, mode: "basic",
    });
    // not-declared is 4, below the threshold, so it is hidden on its own merits
    // and already provides the second unknown.
    expect(r.notDeclaredSuppressed).toBe(true);
    expect(r.options.filter((o) => !o.suppressed).length).toBe(2);
  });

  it("releases no option of a dimension too small to cut at all", () => {
    const r = planDimension({
      options: [{ name: "Only", n: 2 }], notDeclared: 0, threshold: 5, mode: "basic",
    });
    expect(r.options.every((o) => o.suppressed)).toBe(true);
    expect(r.notDeclaredSuppressed).toBe(true);
  });

  it("withholds the total too when a lone cell would otherwise be derivable", () => {
    // One cell only, nothing to pair it with: publishing the total *is*
    // publishing the cell.
    const p = planSuppression(cellsOf(2), { threshold: 5 });
    expect(p.suppressTotal).toBe(true);
    expect(attack(p, 2)).toEqual([]);
  });
});

describe("no role and no setting can weaken this", () => {
  it("ignores an unknown suppression mode rather than falling open", () => {
    const p = planSuppression(cellsOf(3, 12, 13), { threshold: 5, mode: "none-at-all" });
    expect(p.mode).toBe("basic");
    expect(p.cells.filter((c) => c.suppressed).length).toBeGreaterThanOrEqual(2);
  });

  it("treats missing or malformed counts as zero, never as large", () => {
    const p = planSuppression([{ key: "a" }, { key: "b", n: null }, { key: "c", n: "x" }, { key: "d", n: 40 }],
      { threshold: 5 });
    expect(p.cells.filter((c) => c.suppressed).length).toBeGreaterThanOrEqual(3);
  });
});

describe("privacy simulator", () => {
  const groups = [
    { id: "g1", label: "Executives", type: "executive", target_n: 30 },
    { id: "g2", label: "Employees", type: "employee", target_n: 20 },
    { id: "g3", label: "Partners", type: "partner", target_n: 5 },
  ];

  it("works only from targets, so it can run on a draft with no responses", () => {
    const s = simulatePrivacy({ groups, demographics: [], scoreThreshold: 5, commentThreshold: 10, responseRate: 1 });
    expect(s.total_expected).toBe(55);
    expect(s.groups.every((g) => "expected_n" in g)).toBe(true);
  });

  it("shows which groups fall away as the response rate drops", () => {
    const full = simulatePrivacy({ groups, demographics: [], scoreThreshold: 5, commentThreshold: 10, responseRate: 1 });
    const half = simulatePrivacy({ groups, demographics: [], scoreThreshold: 5, commentThreshold: 10, responseRate: 0.4 });
    expect(half.groups_visible).toBeLessThan(full.groups_visible);
  });

  it("separates 'scores visible' from 'comments visible'", () => {
    const s = simulatePrivacy({ groups, demographics: [], scoreThreshold: 5, commentThreshold: 12, responseRate: 1 });
    const partners = s.groups.find((g) => g.id === "g3");
    expect(partners.scores_visible).toBe(true);    // 5 >= 5
    expect(partners.comments_visible).toBe(false); // 5 < 12
  });

  it("warns that a dimension with many options will mostly be suppressed", () => {
    const s = simulatePrivacy({
      groups, demographics: [{ id: "dept", label: "Department", options: ["A","B","C","D","E","F","G","H","I","J","K","L"] }],
      scoreThreshold: 5, commentThreshold: 10, responseRate: 1,
    });
    const dim = s.dimensions[0];
    expect(dim.expected_per_option).toBeLessThan(5);
    expect(dim.usable).toBe(false);
    expect(s.cuts_suppressed_pct).toBeGreaterThan(50);
  });

  it("states its assumptions rather than presenting a forecast as a guarantee", () => {
    const s = simulatePrivacy({ groups, demographics: [], scoreThreshold: 5, commentThreshold: 10 });
    expect(s.assumptions.note).toMatch(/uneven|evenly/i);
    expect(s.assumptions.score_threshold).toBe(5);
  });
});
