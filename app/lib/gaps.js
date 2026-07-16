// Shared-item perception-gap engine (audit findings F2 & F7).
//
// Different stakeholder groups answer different question sets, so comparing the
// groups' headline pillar scores mixes "different perceptions" with "different
// questions". Everything here compares a pair of groups ONLY on the questions
// both groups were actually asked (audience = null, or includes both types),
// weighted by how many people scored each question.

export const MIN_ITEMS = 4; // fewer shared questions than this => "indicative"
export const MIN_N = 10;    // group sizes below this => differences are indicative

// questions: fs-results ?detail=1 rows {key, pillar, audience, groups:{type:{mean,n_scored}}}
// Returns { [pillarId]: { a, b, d, signed, items } } for the pair (tA, tB).
export function sharedPillarScores(questions, pillars, tA, tB) {
  const per = {};
  for (const p of pillars) per[p.id] = { a: { sum: 0, c: 0 }, b: { sum: 0, c: 0 }, items: 0 };
  for (const q of questions || []) {
    if (!per[q.pillar]) continue;
    const served = !q.audience || (q.audience.includes(tA) && q.audience.includes(tB));
    if (!served) continue;
    const ea = q.groups?.[tA], eb = q.groups?.[tB];
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

// Largest reliable gap per pillar across ALL visible pairs, direction-aware.
// Returns { [pillarId]: { d, items, hiType, loType, hi, lo } } — only pillars
// with at least MIN_ITEMS shared questions qualify (F7: any pair, either direction).
export function bestGaps(questions, pillars, visibleGroups) {
  const types = visibleGroups.map((g) => g.type);
  const res = {};
  for (let i = 0; i < types.length; i++) {
    for (let j = i + 1; j < types.length; j++) {
      const s = sharedPillarScores(questions, pillars, types[i], types[j]);
      for (const p of pillars) {
        const e = s[p.id];
        if (!e || e.d == null || e.items < MIN_ITEMS) continue;
        if (!res[p.id] || e.d > res[p.id].d) {
          const aHi = e.a >= e.b;
          res[p.id] = {
            d: e.d, items: e.items,
            hiType: aHi ? types[i] : types[j], loType: aHi ? types[j] : types[i],
            hi: Math.max(e.a, e.b), lo: Math.min(e.a, e.b),
          };
        }
      }
    }
  }
  return res;
}
