"use client";
/* Campaign lifecycle — the only way the browser is allowed to move a campaign.
 *
 * Every transition here is a single server transaction that checks the caller's
 * role, validates readiness, freezes or releases configuration, and writes an
 * audit record. The database refuses a direct `update fs_campaigns set status`
 * from any client, so there is no second path to keep in step: if you need a new
 * transition, add an RPC, not another table write.
 *
 * These helpers exist only to give the UI a predictable shape — { ok, data } or
 * { ok: false, error } — and to turn Postgres error text into something a person
 * can act on. They are not the control; the control is in the database.
 */
import { sb } from "../../lib/supabase";

/* Postgres messages are already written for humans in these RPCs, but a few
   generic ones benefit from translation. */
function humanise(message) {
  const m = String(message || "");
  if (/row-level security|not authorised|not authorized/i.test(m)) {
    return "Your role does not allow this. Ask an organisation owner or manager.";
  }
  if (/requires two-factor/i.test(m)) return m; // already precise
  if (/JWT|token is expired/i.test(m)) return "Your session expired — sign in again and retry.";
  return m || "That did not work.";
}

async function call(fn, args) {
  const { data, error } = await sb().rpc(fn, args);
  if (error) return { ok: false, error: humanise(error.message) };
  return { ok: true, data };
}

/* Readiness — returns the check rows so the UI can render blocking vs warning.
   Safe to call on any campaign the user can see, at any status. */
export async function readiness(campaignId) {
  const { data, error } = await sb().rpc("fs_validate_campaign_readiness", { p_camp: campaignId });
  if (error) return { ok: false, error: humanise(error.message), checks: [] };
  const checks = data || [];
  return {
    ok: true,
    checks,
    blocking: checks.filter((c) => c.severity === "blocking" && c.status === "failed"),
    warnings: checks.filter((c) => c.severity === "warning" && c.status === "failed"),
    passed: checks.filter((c) => c.status === "passed"),
    canOpen: !checks.some((c) => c.severity === "blocking" && c.status === "failed"),
  };
}

/* Opening freezes the analytical contract: it writes the launch snapshot, locks
   governance, and creates any missing group links — all or nothing. */
export function openCampaign(campaignId) {
  return call("fs_open_campaign", { p_camp: campaignId });
}

/* Post-launch operational changes require a reason, which is stored in the audit
   record. The server enforces the minimum length; we check it here too so the
   user finds out before a round trip. */
export function extendCampaign(campaignId, newCloseISO, reason) {
  if (!reason || reason.trim().length < 10) {
    return Promise.resolve({ ok: false, error: "Give a reason of at least 10 characters — this change is recorded." });
  }
  return call("fs_extend_campaign", { p_camp: campaignId, p_new_close: newCloseISO, p_reason: reason.trim() });
}

/* Closing also revokes every active link, so no late response can arrive after
   the collection window the report will describe. */
export function closeCampaign(campaignId, reason) {
  return call("fs_close_campaign", { p_camp: campaignId, p_reason: reason?.trim() || null });
}

export function archiveCampaign(campaignId, reason) {
  return call("fs_archive_campaign", { p_camp: campaignId, p_reason: reason?.trim() || null });
}

/* The supported answer to "I need to change something that is locked".
   Creates a fresh draft that inherits CURRENT organisation defaults — not the
   old campaign's governance — and links it as the next cycle. */
export function createRevisedCampaign(campaignId, name) {
  return call("fs_create_revised_campaign", { p_camp: campaignId, p_name: name || null });
}

/* Which campaign settings are still editable, given status. Mirrors
   fs_campaigns_lock_guard exactly; the server is what actually refuses. */
export const LOCKED_AFTER_LAUNCH = [
  "questionnaire_version_id", "demographics", "segments",
  "anonymity_threshold", "confidentiality_notice", "opens_at",
];

export function isLocked(field, status) {
  return status !== "draft" && LOCKED_AFTER_LAUNCH.includes(field);
}

export function lockReason(status) {
  if (status === "draft") return null;
  return "Locked at launch — respondents answered under this configuration. Create a revised campaign draft to change it.";
}
