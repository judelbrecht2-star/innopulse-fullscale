import { evaluateFindings } from "./findings";

// Saved reports keep their reviewed wording when the rulebook changes later.
export function reportFindings(data, snapshotMode, reviewed) {
  if (snapshotMode) return { findings: data.findings || [], held: 0 };
  const all = evaluateFindings(data);
  const findings = all.filter((f) => reviewed?.has(f.id));
  return { findings, held: all.length - findings.length };
}
