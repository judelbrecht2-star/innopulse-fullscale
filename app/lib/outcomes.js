function numberOrNull(value) {
  if (value === "" || value == null) return null;
  const number = Number(value);
  return Number.isFinite(number) ? number : null;
}

export function outcomeAssessment({ baseline, target, observed, reviewDueAt = null, now = new Date() } = {}) {
  const b = numberOrNull(baseline);
  const t = numberOrNull(target);
  const o = numberOrNull(observed);
  if (o == null) return { status: "planned", delta: null, progressPct: null };
  if (b == null) return { status: "inconclusive", delta: null, progressPct: null };

  const delta = Math.round((o - b) * 10) / 10;
  if (t == null || t === b) {
    return { status: delta > 0 ? "on_track" : "at_risk", delta, progressPct: null };
  }

  const targetDelta = t - b;
  const progressPct = Math.round(((o - b) / targetDelta) * 100);
  if ((targetDelta > 0 && o >= t) || (targetDelta < 0 && o <= t)) {
    return { status: "achieved", delta, progressPct };
  }

  const due = reviewDueAt ? new Date(`${reviewDueAt}T23:59:59`) : null;
  const overdue = due && Number.isFinite(due.getTime()) && due < new Date(now);
  if (overdue) return { status: "not_achieved", delta, progressPct };
  const movedTowardTarget = targetDelta > 0 ? o > b : o < b;
  return { status: movedTowardTarget ? "on_track" : "at_risk", delta, progressPct };
}

export const OUTCOME_STATUS = Object.freeze({
  planned: "Planned",
  on_track: "On track",
  at_risk: "At risk",
  achieved: "Achieved",
  not_achieved: "Not achieved",
  inconclusive: "Inconclusive",
});
