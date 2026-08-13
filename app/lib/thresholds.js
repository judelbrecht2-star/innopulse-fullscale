// Suppression rules, in one place.
//
// The same three decisions are made in four places — fs-results, fs-responses-ops,
// the Responses console and the Insights page — and until now each expressed them
// in its own inline arithmetic. That is exactly the kind of duplication where a
// privacy rule quietly diverges. This module is the frontend's single definition;
// the two edge functions apply the identical rules server-side, because the client
// is never the control. If you change a rule here, change it there, and the tests
// in tests/thresholds.test.js state what "identical" means.
//
// Two thresholds, not one:
//   score   — a group, demographic cut or overall score is released at or above
//             this many valid responses.
//   comment — individual-level content (verbatims, theme coding, the single
//             response view) is released at or above this many. Never lower than
//             `score`: a mean can be safe in a group where a verbatim is not.
//
// ANON_FLOOR is absolute. No campaign setting, no org default and no role —
// owner included — goes below it. It is enforced here, by a database trigger on
// fs_campaign_governance, and again in both edge functions.

export const ANON_FLOOR = 4;

/* Resolve the pair of thresholds actually in force for a campaign.
   `governance` is a fs_campaign_governance row (or the thresholds an edge
   function returned). `campaign` is only consulted for its deprecated
   anonymity_threshold mirror, for a campaign created before governance existed. */
export function effectiveThresholds(governance, campaign) {
  const legacy = num(campaign?.anonymity_threshold) ?? 5;
  const score = Math.max(num(governance?.score_threshold) ?? legacy, ANON_FLOOR);
  const comment = Math.max(num(governance?.comment_threshold) ?? score, score);
  return { score, comment };
}

function num(v) {
  const n = Number(v);
  return Number.isFinite(n) ? Math.round(n) : null;
}

/* Are this group's aggregate scores releasable? */
export function scoresReleased(n, thresholds) {
  return toN(n) >= thresholds.score;
}

/* Is this group's individual-level content releasable? */
export function commentsReleased(n, thresholds) {
  return toN(n) >= thresholds.comment;
}

/* One word for what a group's state is, for UI that needs to say something. */
export function gateFor(n, thresholds) {
  if (!scoresReleased(n, thresholds)) return "suppressed";
  if (!commentsReleased(n, thresholds)) return "scores-only";
  return "released";
}

/* The sentence the UI shows for a group that is not fully released.
   Returns null when everything about the group is releasable. */
export function gateReason(n, thresholds) {
  const have = toN(n);
  const gate = gateFor(have, thresholds);
  if (gate === "released") return null;
  if (gate === "suppressed") {
    return `Hidden until ${thresholds.score} responses (${have} so far) — below that, a score can identify individuals.`;
  }
  return `Scores are shown. Written comments stay hidden until ${thresholds.comment} responses (${have} so far).`;
}

function toN(n) {
  const v = Number(n);
  return Number.isFinite(v) ? v : 0;
}
