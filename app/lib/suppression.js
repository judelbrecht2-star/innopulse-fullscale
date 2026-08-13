/* Complementary suppression — the single definition.
 *
 * Hiding a cell that is too small is the easy half. The hard half is that a
 * hidden cell can often be recovered by arithmetic: if a published total is 40,
 * and every group except one is visible and sums to 37, the hidden group is 3.
 * The suppression itself leaked the number it was protecting. That is a
 * differencing attack, and it is the reason this module exists.
 *
 * The rule set:
 *
 *   Direct          A cohort below its threshold is never released.
 *   Basic indirect  If a published total lets you subtract your way to a single
 *                   hidden cell, hide a second one. Two unknowns in one equation
 *                   cannot be solved.
 *   Strong indirect Also require that the hidden cells sum to at least the
 *                   threshold. Two hidden cells summing to 3 still tells you
 *                   almost everything about both.
 *
 * IMPORTANT: the cells passed in must be an *exhaustive* partition of the
 * total — every respondent counted exactly once. A demographic dimension's
 * "not declared" residual is a cell like any other. Leaving it out of the set
 * while publishing it on screen is precisely the hole this module closes.
 *
 * This is a heuristic, not an optimal solution. Finding the minimum set of
 * secondary suppressions is an integer programming problem; we take the
 * smallest cells first, which over-suppresses slightly and under-suppresses
 * never. For this product that is the correct trade.
 *
 * The edge functions carry a port of this logic, because Deno cannot import
 * from app/. tests/suppression.test.js is the shared specification: if you
 * change a rule here, change it there, and the differencing tests must still
 * pass.
 */

export const SUPPRESSION_MODES = ["basic", "strong"];
export const ANON_FLOOR = 4;

export const REASON = {
  BELOW: "below_threshold",       // the cohort itself is too small
  COMPLEMENTARY: "complementary", // hidden so that another hidden cell cannot be derived
  RESIDUAL: "residual_too_small", // hidden because the remaining hidden pool was too small to hide in
  UNPROTECTABLE: "unprotectable", // the dimension cannot be published safely at all
};

/* Plan the suppression of one exhaustive set of cells.
 *
 *   cells   [{ key, n }]  every cell of the partition, residual included
 *   opts    { threshold, mode = "basic", totalPublished = true }
 *
 * Returns { cells: [{ key, n, suppressed, reason }], suppressTotal, hiddenSum }.
 * `suppressTotal` means the total itself must not be published either — the
 * cells could not be made safe on their own.
 */
export function planSuppression(cells, opts = {}) {
  const threshold = Math.max(Number(opts.threshold) || 0, ANON_FLOOR);
  const mode = SUPPRESSION_MODES.includes(opts.mode) ? opts.mode : "basic";
  const totalPublished = opts.totalPublished !== false;

  const out = (cells || []).map((c) => ({
    key: c.key,
    n: Math.max(0, Number(c.n) || 0),
    suppressed: false,
    reason: null,
  }));

  // 1. Direct suppression.
  for (const c of out) {
    if (c.n < threshold) { c.suppressed = true; c.reason = REASON.BELOW; }
  }

  const hidden = () => out.filter((c) => c.suppressed);
  const visible = () => out.filter((c) => !c.suppressed);
  const hiddenSum = () => hidden().reduce((s, c) => s + c.n, 0);

  // Nothing hidden means nothing to protect.
  if (hidden().length === 0) {
    return { cells: out, suppressTotal: false, hiddenSum: 0, mode, threshold };
  }

  // If the total is not published, subtraction has nothing to work from.
  if (!totalPublished) {
    return { cells: out, suppressTotal: false, hiddenSum: hiddenSum(), mode, threshold };
  }

  /* Hide the smallest visible cell. Smallest first because it costs the least
     information and is itself the most likely to be sensitive.

     Ties are broken on the key, not left to array order. Three groups of five
     are a common shape, and without a deterministic rule the same data could
     hide a different group on each call — which would make a regenerated report
     disagree with the one before it for no reason a client could understand. */
  const hideSmallestVisible = (reason) => {
    const v = visible();
    if (v.length === 0) return false;
    const smallest = v.reduce((a, b) => {
      if (b.n !== a.n) return b.n < a.n ? b : a;
      return String(b.key) < String(a.key) ? b : a;
    });
    smallest.suppressed = true;
    smallest.reason = reason;
    return true;
  };

  // 2. Basic indirect: one hidden cell against a published total is solvable.
  while (hidden().length < 2) {
    if (!hideSmallestVisible(REASON.COMPLEMENTARY)) break;
  }

  // 3. Strong indirect: the hidden pool must itself be big enough to hide in.
  if (mode === "strong") {
    while (hiddenSum() < threshold) {
      if (!hideSmallestVisible(REASON.RESIDUAL)) break;
    }
  }

  // 4. Could we actually protect it? If fewer than two cells are hidden, or the
  //    strong-mode pool is still too small, the set cannot be published safely.
  const stillSolvable = hidden().length < 2 || (mode === "strong" && hiddenSum() < threshold);
  if (stillSolvable) {
    for (const c of out) { c.suppressed = true; c.reason = c.reason || REASON.UNPROTECTABLE; }
    return { cells: out, suppressTotal: true, hiddenSum: hiddenSum(), mode, threshold };
  }

  return { cells: out, suppressTotal: false, hiddenSum: hiddenSum(), mode, threshold };
}

/* Convenience for a demographic dimension, where the residual ("not declared")
   is published alongside the options and is therefore part of the partition. */
export function planDimension({ options, notDeclared, threshold, mode, totalPublished = true }) {
  const cells = [
    ...(options || []).map((o) => ({ key: o.name, n: o.n })),
    { key: "__not_declared__", n: Math.max(0, Number(notDeclared) || 0) },
  ];
  const plan = planSuppression(cells, { threshold, mode, totalPublished });
  const byKey = Object.fromEntries(plan.cells.map((c) => [c.key, c]));
  return {
    options: (options || []).map((o) => ({
      ...o,
      suppressed: byKey[o.name]?.suppressed ?? true,
      suppression_reason: byKey[o.name]?.reason ?? REASON.UNPROTECTABLE,
    })),
    notDeclaredSuppressed: byKey.__not_declared__?.suppressed ?? true,
    suppressTotal: plan.suppressTotal,
    hiddenSum: plan.hiddenSum,
  };
}

/* Is a published set of numbers actually safe? Used by the tests, and kept in
   production code so the property is stated rather than assumed.
 *
 * The property being checked is precise, and the precision matters:
 *
 *   No hidden cell that contains at least one respondent may have its exact
 *   value derived from what was published.
 *
 * A cell that is derivably zero is not a disclosure — there is no respondent to
 * identify, and "nobody from Legal answered" is a fact about participation, not
 * about a person. An earlier version of this function flagged those as leaks,
 * which made an empty campaign look like a privacy failure. Deriving a non-zero
 * count *is* a disclosure, because it puts a named number of real people in a
 * named cohort, and at small n that is the first step to identifying them.
 *
 * Returns the keys of any hidden cell that is both derivable and non-empty. */
export function recoverableCells(planCells, total, totalPublished = true) {
  if (!totalPublished) return [];
  const hidden = planCells.filter((c) => c.suppressed);
  if (hidden.length === 0) return [];
  const visibleSum = planCells.filter((c) => !c.suppressed).reduce((s, c) => s + c.n, 0);
  const hiddenSum = total - visibleSum;

  // One unknown against a published total: solvable outright.
  if (hidden.length === 1) return hidden[0].n > 0 ? [hidden[0].key] : [];

  // Several unknowns summing to zero: each one is therefore zero. Knowable, but
  // empty, so nobody is exposed.
  if (hiddenSum === 0) return [];

  return [];
}

/* ---------------------------------------------------------------------------
   Privacy simulator — a planning aid for a draft campaign.

   Works only from the campaign's intended structure: group targets and the
   demographic options that were configured. It never touches a real response,
   and it cannot: a draft has none, and by the time it does the answer would be
   the real suppression result rather than a forecast.

   The forecast assumes respondents spread evenly across a dimension's options,
   which is optimistic — real demographics are lumpy, and a lumpy distribution
   suppresses more, not less. Treat the output as a best case.
   --------------------------------------------------------------------------- */
export function simulatePrivacy({ groups, demographics, scoreThreshold, commentThreshold, mode = "basic", responseRate = 1 }) {
  const rate = Math.min(1, Math.max(0, Number(responseRate) || 0));
  const score = Math.max(Number(scoreThreshold) || 5, ANON_FLOOR);
  const comment = Math.max(Number(commentThreshold) || score, score);

  const expected = (groups || []).map((g) => ({
    id: g.id, label: g.label, type: g.type,
    target_n: Math.max(0, Number(g.target_n) || 0),
    expected_n: Math.round(Math.max(0, Number(g.target_n) || 0) * rate),
  }));

  const totalExpected = expected.reduce((s, g) => s + g.expected_n, 0);

  // Groups partition the total, and the overall n is published.
  const groupPlan = planSuppression(expected.map((g) => ({ key: g.id, n: g.expected_n })),
    { threshold: score, mode, totalPublished: true });
  const groupByKey = Object.fromEntries(groupPlan.cells.map((c) => [c.key, c]));

  const groupResults = expected.map((g) => {
    const cell = groupByKey[g.id];
    return {
      ...g,
      scores_visible: !cell.suppressed,
      comments_visible: !cell.suppressed && g.expected_n >= comment,
      reason: cell.reason,
    };
  });

  // Demographic cuts, one dimension at a time, evenly spread.
  const dimensionResults = (demographics || []).map((d) => {
    const opts = (d.options || []).map((name) => ({
      name,
      n: (d.options || []).length ? Math.floor(totalExpected / d.options.length) : 0,
    }));
    const declared = opts.reduce((s, o) => s + o.n, 0);
    const plan = planDimension({
      options: opts, notDeclared: Math.max(0, totalExpected - declared),
      threshold: score, mode, totalPublished: true,
    });
    const visibleCount = plan.options.filter((o) => !o.suppressed).length;
    return {
      id: d.id, label: d.label,
      option_count: opts.length,
      expected_per_option: opts[0]?.n ?? 0,
      visible_options: visibleCount,
      suppressed_options: opts.length - visibleCount,
      usable: visibleCount >= 2,
      suppress_total: plan.suppressTotal,
    };
  });

  const totalCuts = dimensionResults.reduce((s, d) => s + d.option_count, 0);
  const suppressedCuts = dimensionResults.reduce((s, d) => s + d.suppressed_options, 0);

  return {
    assumptions: {
      response_rate: rate,
      score_threshold: score,
      comment_threshold: comment,
      suppression_mode: mode,
      note: "Assumes respondents spread evenly across each demographic option. Real distributions are uneven, which suppresses more, not less.",
    },
    total_expected: totalExpected,
    groups: groupResults,
    groups_visible: groupResults.filter((g) => g.scores_visible).length,
    groups_with_comments: groupResults.filter((g) => g.comments_visible).length,
    dimensions: dimensionResults,
    cuts_total: totalCuts,
    cuts_suppressed: suppressedCuts,
    cuts_suppressed_pct: totalCuts ? Math.round((suppressedCuts / totalCuts) * 100) : 0,
  };
}
