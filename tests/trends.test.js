import { describe, it, expect } from "vitest";
import { computeTrend, fmtDelta } from "../app/lib/trends.js";

/* Trends compare two campaigns. The risk is not arithmetic — it is claiming a
   movement is real when the questionnaire changed underneath it, or when one
   side is suppressed. */

const PILLARS = [{ id: "sii", short: "SII", weight: 1 }, { id: "iem", short: "IEM", weight: 1 }];

function payload({ version = "v1", score = 60, pillars = { sii: 60, iem: 50 }, n = 20, groups = [], suppressed = false, name = "Cycle" } = {}) {
  return {
    questionnaire_version: version,
    campaign: { name },
    pillars: PILLARS,
    groups,
    overall: suppressed ? { n, suppressed: true } : { n, score, pillars },
  };
}

const grp = (type, pillars, n = 12) => ({ id: "g-" + type, type, label: type, n, suppressed: false, pillars });

describe("comparability", () => {
  it("is comparable only when the questionnaire version matches", () => {
    expect(computeTrend(payload({ version: "v2" }), payload({ version: "v2" })).comparable).toBe(true);
    expect(computeTrend(payload({ version: "v2" }), payload({ version: "v1" })).comparable).toBe(false);
  });

  it("is not comparable when either version is unknown", () => {
    expect(computeTrend(payload({ version: null }), payload({ version: null })).comparable).toBe(false);
  });

  it("still reports the deltas when not comparable, so the caller can caveat rather than hide", () => {
    const t = computeTrend(payload({ version: "v2", score: 70 }), payload({ version: "v1", score: 60 }));
    expect(t.comparable).toBe(false);
    expect(t.overall.d).toBe(10);
    expect(t.curVersion).toBe("v2");
    expect(t.priorVersion).toBe("v1");
  });

  it("returns null when there is nothing to compare against", () => {
    expect(computeTrend(payload(), null)).toBeNull();
    expect(computeTrend(null, payload())).toBeNull();
  });
});

describe("deltas", () => {
  it("computes the overall movement to one decimal place", () => {
    const t = computeTrend(payload({ score: 62.35 }), payload({ score: 60 }));
    expect(t.overall.d).toBe(2.4);
  });

  it("reports per-pillar movement and ranks best and worst", () => {
    const t = computeTrend(
      payload({ pillars: { sii: 70, iem: 40 } }),
      payload({ pillars: { sii: 60, iem: 55 } }),
    );
    expect(t.pillars.find((p) => p.id === "sii").d).toBe(10);
    expect(t.pillars.find((p) => p.id === "iem").d).toBe(-15);
    expect(t.best.id).toBe("sii");
    expect(t.worst.id).toBe("iem");
  });

  it("gives a null delta rather than a zero when a pillar is missing on one side", () => {
    const t = computeTrend(payload({ pillars: { sii: 70 } }), payload({ pillars: { iem: 50 } }));
    expect(t.pillars.find((p) => p.id === "sii").d).toBeNull();
    expect(t.pillars.find((p) => p.id === "iem").d).toBeNull();
  });
});

describe("suppression carries through", () => {
  it("produces no overall delta when the current cycle is suppressed", () => {
    const t = computeTrend(payload({ suppressed: true, n: 3 }), payload({ score: 60 }));
    expect(t.overall.cur).toBeNull();
    expect(t.overall.d).toBeNull();
    expect(t.n.cur).toBe(3); // the count itself is not secret; the score is
  });

  it("produces no overall delta when the prior cycle is suppressed", () => {
    const t = computeTrend(payload({ score: 60 }), payload({ suppressed: true, n: 2 }));
    expect(t.overall.prev).toBeNull();
    expect(t.overall.d).toBeNull();
  });

  it("ignores suppressed groups on both sides", () => {
    const cur = payload({ groups: [grp("employee", { sii: 60, iem: 60 }), { id: "g-x", type: "customer", n: 2, suppressed: true }] });
    const prior = payload({ groups: [grp("employee", { sii: 50, iem: 50 })] });
    const t = computeTrend(cur, prior);
    expect(t.groups).toHaveLength(1);
    expect(t.groups[0].d).toBe(10);
  });

  it("gives a null group delta when the group did not exist last cycle", () => {
    const t = computeTrend(payload({ groups: [grp("partner", { sii: 60, iem: 60 })] }), payload({ groups: [] }));
    expect(t.groups[0].d).toBeNull();
  });
});

describe("delta formatting", () => {
  it("marks direction and never renders a bare number for nothing", () => {
    expect(fmtDelta(null)).toBe("—");
    expect(fmtDelta(0)).toContain("0");
    expect(fmtDelta(3.2)).toContain("+3.2");
    expect(fmtDelta(-3.2)).toContain("-3.2");
  });
});
