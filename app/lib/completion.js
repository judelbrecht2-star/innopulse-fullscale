export const REPORT_STATES = { legacy: 'Legacy version', draft: 'Draft', pending: 'Awaiting approval', changes_requested: 'Changes requested', approved: 'Approved', issued: 'Issued' };
export const canEdit = role => ['owner', 'manager', 'analyst'].includes(role);
export const canApprove = role => ['owner', 'manager'].includes(role);
export function todayInZone(zone = 'Africa/Johannesburg', now = new Date()) {
  return new Intl.DateTimeFormat('en-CA', { timeZone: zone, year: 'numeric', month: '2-digit', day: '2-digit' }).format(now);
}
export function actionBucket(action, today) {
  if (action.status === 'done') return 'done';
  if (!action.due_on) return 'unscheduled';
  return action.due_on < today ? 'overdue' : action.due_on === today ? 'today' : 'upcoming';
}
export function acceptedFindings(findings, reviews) {
  const map = Object.fromEntries(reviews.map(r => [r.rule_id, r]));
  return findings.filter(f => ['accepted', 'edited'].includes(map[f.id]?.decision)).map(f => ({
    ...f, title: map[f.id].edited_title || f.title, text: map[f.id].edited_text || f.text,
    analyst: { decision: map[f.id].decision, contradictory: map[f.id].note_contradictory || null, alternative: map[f.id].note_alternative || null },
  }));
}
export function safeBranding(raw = {}) {
  return {
    accent: /^#[0-9a-f]{6}$/i.test(raw.accent || '') ? raw.accent : '#c74b42',
    footer: String(raw.footer || '').slice(0, 200),
    logo: /^data:image\/(png|jpeg);base64,[A-Za-z0-9+/=]+$/.test(raw.logo || '') && raw.logo.length <= 410000 ? raw.logo : '',
  };
}
