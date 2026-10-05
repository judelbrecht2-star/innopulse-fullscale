import { describe, expect, it } from "vitest";
import { csvEsc } from "../app/lib/csv";

describe("spreadsheet exports", () => {
  it("neutralises formulas in text, including whitespace prefixes", () => {
    for (const text of ["=1+1", "+SUM(A1)", "-1+2", "@SUM(A1)", "\t=1+1", "  =1+1"]) {
      expect(csvEsc(text)).toBe("'" + text);
    }
  });
  it("preserves numeric cells and ordinary text", () => {
    expect(csvEsc(-30)).toBe("-30");
    expect(csvEsc(0)).toBe("0");
    expect(csvEsc("Follow up")).toBe("Follow up");
    expect(csvEsc(null)).toBe("");
  });
  it("quotes delimiters, double quotes and both newline styles", () => {
    expect(csvEsc('Owner, "Lead"')).toBe('"Owner, ""Lead"""');
    expect(csvEsc("a\rb")).toBe('"a\rb"');
    expect(csvEsc("a\nb")).toBe('"a\nb"');
  });
});
