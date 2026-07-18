// Cycle-over-cycle trend engine (Report Blueprint Step 5).
// Compares two fs-results payloads (current vs prior campaign). Comparability
// is honest: same questionnaire version = comparable; different = directional
// only, and every consumer must show that caveat.

const r1 = (v) => Math.round(v * 10) / 10;

export function computeTrend(cur, prior) {
  if (!cur || !prior) return null;
  const comparable = cur.questionnaire_version && cur.questionnaire_version === prior.questionnaire_version;
  const co = cur.overall && !cur.overall.suppressed ? cur.overall : null;
  const po = prior.overall && !prior.overall.suppressed ? prior.overall : null;

  const pillars = (cur.pillars || []).map((p) => {
    const c = co?.pillars?.[p.id] ?? null;
    const pr = po?.pillars?.[p.id] ?? null;
    return { id: p.id, short: p.short, cur: c, prev: pr, d: c != null && pr != null ? r1(c - pr) : null };
  });

  const priorByType = Object.fromEntries((prior.groups || []).filter((g) => !g.suppressed).map((g) => [g.type, g]));
  const groups = (cur.groups || []).filter((g) => !g.suppressed).map((g) => {
    const pg = priorByType[g.type];
    if (!pg) return { type: g.type, label: g.label, d: null };
    const ds = (cur.pillars || []).map((p) => {
      const a = g.pillars?.[p.id], b = pg.pillars?.[p.id];
      return a != null && b != null ? a - b : null;
    }).filter((x) => x != null);
    return { type: g.type, label: g.label, d: ds.length ? r1(ds.reduce((s, x) => s + x, 0) / ds.length) : null, nCur: g.n, nPrev: pg.n };
  });

  const moved = pillars.filter((p) => p.d != null).sort((a, b) => b.d - a.d);
  return {
    comparable,
    curVersion: cur.questionnaire_version || null,
    priorVersion: prior.questionnaire_version || null,
    priorName: prior.campaign?.name || "previous assessment",
    overall: { cur: co?.score ?? null, prev: po?.score ?? null, d: co?.score != null && po?.score != null ? r1(co.score - po.score) : null },
    n: { cur: co?.n ?? cur.overall?.n ?? null, prev: po?.n ?? prior.overall?.n ?? null },
    pillars,
    groups,
    best: moved[0] || null,
    worst: moved.length ? moved[moved.length - 1] : null,
  };
}

export const fmtDelta = (d) => (d == null ? "—" : (d > 0 ? `▲ +${d}` : d < 0 ? `▼ ${d}` : "· 0"));
export const deltaColor = (d) => (d == null ? "var(--muted)" : d > 0 ? "var(--green, #2f855a)" : d < 0 ? "var(--primary)" : "var(--muted)");
