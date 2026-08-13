import { describe, it, expect } from "vitest";
import { DEMO_DIMS, dimById } from "../app/lib/demographics.js";

/* Demographic dimensions are how a campaign slices its results, and every slice
   is threshold-protected. What matters here is that the catalogue stays
   well-formed: stable ids (they are persisted on fs_campaigns.demographics and
   on every response), enough options for a cut to be meaningful, and a question
   respondents can actually answer. */

describe("the dimension catalogue", () => {
  it("has unique, stable, snake_case ids", () => {
    const ids = DEMO_DIMS.map((d) => d.id);
    expect(new Set(ids).size).toBe(ids.length);
    for (const id of ids) expect(id).toMatch(/^[a-z][a-z0-9_]*$/);
  });

  it("gives every dimension a label and a respondent-facing question", () => {
    for (const d of DEMO_DIMS) {
      expect(d.label.trim()).toBeTruthy();
      expect(d.question.trim()).toBeTruthy();
      expect(d.question.trim().endsWith("?")).toBe(true);
    }
  });

  it("gives every fixed dimension at least two options — a one-option cut says nothing", () => {
    for (const d of DEMO_DIMS.filter((x) => !x.custom)) {
      expect(d.options.length).toBeGreaterThanOrEqual(2);
      expect(new Set(d.options).size).toBe(d.options.length);
    }
  });

  it("gives every custom dimension a placeholder, since its options come from the campaign owner", () => {
    for (const d of DEMO_DIMS.filter((x) => x.custom)) {
      expect(d.placeholder && d.placeholder.trim()).toBeTruthy();
    }
  });

  it("never bakes 'Prefer not to say' into the options — declining is handled by the form, not by a choice", () => {
    for (const d of DEMO_DIMS) {
      for (const o of d.options) expect(o.toLowerCase()).not.toContain("prefer not");
    }
  });

  it("stays within the 8 dimensions fs_create_campaign will accept", () => {
    expect(DEMO_DIMS.length).toBeLessThanOrEqual(8);
  });
});

describe("lookup", () => {
  it("finds a dimension by id", () => {
    expect(dimById("tenure")?.label).toBe("Time with the organisation");
  });

  it("returns undefined rather than throwing on an unknown id", () => {
    expect(dimById("not_a_dimension")).toBeUndefined();
    expect(dimById(undefined)).toBeUndefined();
  });

  it("keeps `department` available, because legacy segments are mapped onto it", () => {
    // fs-results synthesises a `department` cut from fs_campaigns.segments for
    // campaigns that predate demographics. Renaming this id breaks those.
    expect(dimById("department")).toBeDefined();
    expect(dimById("department").custom).toBe(true);
  });
});
