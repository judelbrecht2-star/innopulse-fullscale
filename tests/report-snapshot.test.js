import { describe, expect, it } from "vitest";
import { reportFindings } from "../app/lib/report-snapshot";
describe("saved report wording", () => {
  it("uses saved reviewed findings even when the current rulebook would produce nothing", () => {
    const frozen = [{ id: "historic-rule", text: "Reviewed conclusion at generation time" }];
    expect(reportFindings({ findings: frozen }, true, new Set())).toEqual({ findings: frozen, held: 0 });
  });
  it("does not recompute missing findings in a saved report", () => expect(reportFindings({}, true, new Set())).toEqual({ findings: [], held: 0 }));
});
