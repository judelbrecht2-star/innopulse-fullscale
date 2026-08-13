import { describe, it, expect } from "vitest";
import { evaluateFindings, CLASS, RULE_COUNT } from "../app/lib/findings.js";

/* The findings engine turns numbers into sentences a client will act on, so the
   tests here care less about "does rule X fire" than about the discipline around
   the rules: nothing fires without data, suppressed groups never contribute, a
   broken rule cannot take the page down, and single-signal findings stay
   hypotheses rather than being asserted as conclusions. */

const PILLARS = [
  { id: "sii", short: "SII", name: "Strategic intent", weight: 1 },
  { id: "iem", short: "IEM", name: "Environment", weight: 1 },
  { id: "oic", short: "OIC", name: "Capability", weight: 1 },
  { id: "ipm", short: "IPM", name: "Process", weight: 1 },
  { id: "roi", short: "ROI", name: "Return", weight: 1 },
];

const cell = (mean, { n = 12, dk = 0, sd = null } = {}) => ({ mean, n_scored: n, n_dkna: dk, sd, dist: {} });

/* findings.js reads per-question data by group TYPE, which is the alias
   fs-results emits when a type is unique among visible groups. Build fixtures
   the same way. */
function results({ groups, questions }) {
  return { pillars: PILLARS, groups, questions };
}
const group = (type, n = 12, extra = {}) => ({ id: "g-" + type, type, label: type, n, target_n: n, suppressed: false, pillars: {}, ...extra });
const q = (key, pillar, groupsByType, audience = null) => ({
  key, pillar, pillar_short: pillar.toUpperCase(), text: key, audience, groups: groupsByType,
});

describe("preconditions", () => {
  it("produces nothing without question detail", () => {
    expect(evaluateFindings(null)).toEqual([]);
    expect(evaluateFindings({})).toEqual([]);
    expect(evaluateFindings({ questions: [] })).toEqual([]);
  });

  it("produces nothing from a campaign with no responses at all", () => {
    const r = results({
      groups: [group("employee", 0, { target_n: 0 })],
      questions: [q("sii_0", "sii", { employee: cell(null, { n: 0 }) })],
    });
    expect(evaluateFindings(r)).toEqual([]);
  });
});

describe("suppressed groups never speak", () => {
  it("ignores a group marked suppressed even though its numbers are present", () => {
    const suppressed = { ...group("executive", 3), suppressed: true };
    const r = results({
      groups: [suppressed],
      // iem_ex0 below 40 would normally fire `no_risk_appetite`
      questions: [q("iem_ex0", "iem", { executive: cell(10) }, ["executive"])],
    });
    expect(evaluateFindings(r).some((f) => f.id === "no_risk_appetite")).toBe(false);
  });

  it("fires the same rule once the group is released", () => {
    const r = results({
      groups: [group("executive", 12)],
      questions: [q("iem_ex0", "iem", { executive: cell(10) }, ["executive"])],
    });
    const f = evaluateFindings(r).find((x) => x.id === "no_risk_appetite");
    expect(f).toBeDefined();
    expect(f.klass).toBe(CLASS.OBS);
    expect(f.evidence.length).toBeGreaterThan(0);
  });

  it("still counts a suppressed group's participation — coverage is not private", () => {
    // participation_bias deliberately looks at every group, suppressed included:
    // knowing that 2 of 20 executives answered is a methodology fact, not a
    // disclosure about any individual.
    const r = results({
      groups: [{ ...group("executive", 2, { target_n: 20 }), suppressed: true }, group("employee", 12, { target_n: 12 })],
      questions: [q("sii_0", "sii", { employee: cell(60) })],
    });
    expect(evaluateFindings(r).some((f) => f.id === "participation_bias")).toBe(true);
  });
});

describe("evidence discipline", () => {
  it("labels a single-signal finding as a hypothesis and a converging one as supported", () => {
    const single = results({
      groups: [group("partner")],
      questions: [q("iem_pa0", "iem", { partner: cell(20) }, ["partner"])],
    });
    const a = evaluateFindings(single).find((f) => f.id === "partner_arms_length");
    expect(a.klass).toBe(CLASS.HYP);

    const converging = results({
      groups: [group("partner")],
      questions: [
        q("iem_pa0", "iem", { partner: cell(20) }, ["partner"]),
        q("sii_pa0", "sii", { partner: cell(30) }, ["partner"]),
      ],
    });
    const b = evaluateFindings(converging).find((f) => f.id === "partner_arms_length");
    expect(b.klass).toBe(CLASS.SUP);
    expect(b.evidence.length).toBeGreaterThan(a.evidence.length);
  });

  it("gives every finding a citation, an alternative explanation and a validation step", () => {
    const r = results({
      groups: [group("executive"), group("employee")],
      questions: [
        q("iem_ex0", "iem", { executive: cell(10) }, ["executive"]),
        q("oic_6", "oic", { employee: cell(20), executive: cell(20) }),
        q("oic_7", "oic", { employee: cell(20), executive: cell(20) }),
      ],
    });
    const found = evaluateFindings(r);
    expect(found.length).toBeGreaterThan(0);
    for (const f of found) {
      expect(Array.isArray(f.evidence) && f.evidence.length).toBeTruthy();
      expect(f.alternatives).toBeTruthy();
      expect(f.validate).toBeTruthy();
      expect(Object.values(CLASS)).toContain(f.klass);
    }
  });

  it("orders findings by severity, then by how strong the evidence class is", () => {
    const r = results({
      groups: [group("executive"), group("employee"), group("customer")],
      questions: [
        q("iem_ex0", "iem", { executive: cell(10) }, ["executive"]),          // sev 2
        q("oic_cu0", "oic", { customer: cell(20) }, ["customer"]),            // sev 2
        q("ipm_2", "ipm", { employee: cell(20), executive: cell(20) }),       // idea_blackhole, sev 3
      ],
    });
    const sevs = evaluateFindings(r).map((f) => f.severity);
    expect(sevs).toEqual([...sevs].sort((a, b) => b - a));
  });
});

describe("robustness", () => {
  it("survives malformed question rows rather than throwing", () => {
    const r = results({
      groups: [group("employee")],
      questions: [
        { key: "sii_0", pillar: "sii" },                       // no groups at all
        q("sii_1", "sii", { employee: { mean: "not a number" } }),
        q("sii_2", "sii", { employee: null }),
      ],
    });
    expect(() => evaluateFindings(r)).not.toThrow();
  });

  it("never invents a finding out of an empty group map", () => {
    const r = results({ groups: [], questions: [q("sii_0", "sii", {})] });
    expect(evaluateFindings(r)).toEqual([]);
  });
});

describe("the rulebook itself", () => {
  it("still has the 26 rules the audit reviewed", () => {
    // If this number changes, the report's methodology appendix and the audit
    // trail both need updating — that is the point of pinning it.
    expect(RULE_COUNT).toBe(26);
  });

  it("names its three evidence classes exactly as the report renders them", () => {
    expect(CLASS.OBS).toBe("Observed finding");
    expect(CLASS.SUP).toBe("Supported interpretation");
    expect(CLASS.HYP).toBe("Plausible hypothesis");
  });
});

describe("known limitation — group identity (P0-5 residue)", () => {
  it("reads per-question data by TYPE, so two custom `other` groups cannot both be seen", () => {
    // fs-results v9+ keys per-question data by group id and only emits a type
    // alias when that type is unique among visible groups. gaps.js was migrated
    // to ids; findings.js was not. With two `other` groups there is no alias, so
    // no rule can read either of them. This test documents that gap rather than
    // asserting it is correct — it should be turned into a failing expectation
    // when findings.js is migrated to id-keyed lookups.
    const r = results({
      groups: [group("other", 12), { ...group("other", 12), id: "g-other-2", label: "Contractors" }],
      questions: [{
        key: "sii_0", pillar: "sii", pillar_short: "SII", text: "sii_0", audience: null,
        groups: { "g-other": cell(10), "g-other-2": cell(90) },   // no `other` alias
      }],
    });
    expect(evaluateFindings(r)).toEqual([]);
  });
});
