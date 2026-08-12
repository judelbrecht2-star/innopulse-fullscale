// Shared-item perception-gap engine (audit F2 & F7; P0-5 group identity).
//
// Different stakeholder groups answer different question sets, so comparing
// headline pillar scores mixes "different perceptions" with "different
// questions". Everything here compares a pair ONLY on the questions both were
// actually asked (audience = null, or includes both group TYPES), weighted by
// how many people scored each question.
//
// P0-5: a campaign may contain several custom groups that all share the generic
// `other` type. Group TYPE is questionnaire-routing metadata; it is NOT an
// identity. All per-group data is therefore keyed by the stable group id.
// `q.groups` from fs-results v9+ is id-keyed; older frozen report snapshots are
// type-keyed, so lookups fall back to type for those (schema: "legacy-type-keyed").

export const MIN_ITEMS = 4; // fewer shared questions than this => "indicative"
export const MIN_N = 10;    // group sizes below this => differences are indicative

// Read one group's entry off a question row, id first, type only as legacy fallback.
function entryFor(q, g) {
  if (!q.groups || !g) return null;
  return q.groups[g.id] ?? q.groups[g.type] ?? null;
}

// Was this question served to both groups? Audience is expressed in types.
function servedToBoth(q, gA, gB) {
  return !q.audience || (q.audience.includes(gA.type) && q.audience.includes(gB.type));
}

// gA, gB: group objects { id, type, label, ... }
// Returns { [pillarId]: { a, b, d, signed, items } }
export function sharedPillarScores(questions, pillars, gA, gB) {
  const per = {};
  if (!gA || !gB) return per;
  for (const p of pillars) per[p.id] = { a: { sum: 0, c: 0 }, b: { sum: 0, c: 0 }, items: 0 };
  for (const q of questions || []) {
    if (!per[q.pillar]) continue;
    if (!servedToBoth(q, gA, gB)) continue;
    const ea = entryFor(q, gA), eb = entryFor(q, gB);
    if (!ea || !eb || ea.mean == null || eb.mean == null) continue;
    per[q.pillar].items++;
    per[q.pillar].a.sum += ea.mean * ea.n_scored; per[q.pillar].a.c += ea.n_scored;
    per[q.pillar].b.sum += eb.mean * eb.n_scored; per[q.pillar].b.c += eb.n_scored;
  }
  const out = {};
  for (const p of pillars) {
    const e = per[p.id];
    if (!e.items || !e.a.c || !e.b.c) { out[p.id] = { a: null, b: null, d: null, signed: null, items: e.items }; continue; }
    const a = Math.round((e.a.sum / e.a.c) * 10) / 10;
    const b = Math.round((e.b.sum / e.b.c) * 10) / 10;
    out[p.id] = { a, b, d: Math.round(Math.abs(a - b) * 10) / 10, signed: Math.round((a - b) * 10) / 10, items: e.items };
  }
  return out;
}

const nameOf = (g) => (g?.type === "other" ? (g.label || "Other stakeholders") : (g?.label || g?.type || ""));

// Largest reliable gap per pillar across ALL visible pairs, direction-aware.
// Returns { [pillarId]: { d, items, hiId, loId, hiLabel, loLabel, hiType, loType, hi, lo } }.
// hiType/loType are retained for display metadata only — never as identity.
export function bestGaps(questions, pillars, visibleGroups) {
  const gs = (visibleGroups || []).filter(Boolean);
  const res = {};
  for (let i = 0; i < gs.length; i++) {
    for (let j = i + 1; j < gs.length; j++) {
      const s = sharedPillarScores(questions, pillars, gs[i], gs[j]);
      for (const p of pillars) {
        const e = s[p.id];
        if (!e || e.d == null || e.items < MIN_ITEMS) continue;
        if (!res[p.id] || e.d > res[p.id].d) {
          const aHi = e.a >= e.b;
          const hi = aHi ? gs[i] : gs[j], lo = aHi ? gs[j] : gs[i];
          res[p.id] = {
            d: e.d, items: e.items,
            hiId: hi.id, loId: lo.id,
            hiLabel: nameOf(hi), loLabel: nameOf(lo),
            hiType: hi.type, loType: lo.type,
            hi: Math.max(e.a, e.b), lo: Math.min(e.a, e.b),
          };
        }
      }
    }
  }
  return res;
}
