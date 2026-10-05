// Only answers and optional context in the current questionnaire can be restored.
export function restoreDraft(draft, data) {
  const codes = new Set(data.questionnaire.scale.map((s) => s.code));
  const keys = data.questionnaire.pillars.flatMap((p) => p.questions.map((q) => q.key));
  const answers = Object.fromEntries(keys.filter((k) => codes.has(draft?.answers?.[k])).map((k) => [k, draft.answers[k]]));
  const comments = Object.fromEntries(data.questionnaire.pillars
    .filter((p) => typeof draft?.comments?.[p.id] === "string")
    .map((p) => [p.id, draft.comments[p.id]]));
  const demo = Object.fromEntries((data.campaign?.demographics || [])
    .filter((d) => d.options?.includes(draft?.demo?.[d.id]))
    .map((d) => [d.id, draft.demo[d.id]]));
  const segment = data.campaign?.segments?.includes(draft?.segment) ? draft.segment : "";
  return { answers, comments, demo, segment };
}

export function missingQuestions(questionnaire, answers) {
  const codes = new Set(questionnaire.scale.map((s) => s.code));
  return questionnaire.pillars.flatMap((p) => p.questions).filter((q) => !codes.has(answers[q.key]));
}
