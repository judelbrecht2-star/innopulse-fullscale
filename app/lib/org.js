"use client";
/* P0-3 — deliberate active-organisation context.
   Previously every page took `.limit(1).maybeSingle()` on fs_memberships, i.e.
   whichever membership Postgres happened to return first. For a user in more
   than one organisation that is non-deterministic and can show the wrong
   tenant's data. Here the active org is explicit, validated against the user's
   real memberships on every load, and switching purges cached tenant data.
   The server remains the authority: every edge function re-checks membership
   for the org that owns the record being touched. */
import { sb } from "../../lib/supabase";

const KEY = "fs_active_org";

export function getStoredOrgId() {
  try { return localStorage.getItem(KEY) || null; } catch { return null; }
}

export function setActiveOrgId(orgId) {
  try { localStorage.setItem(KEY, orgId); } catch { /* private mode */ }
}

/* Anything tenant-specific that must not survive an org switch. */
export function clearOrgScopedCache() {
  try {
    Object.keys(localStorage)
      .filter((k) => k.startsWith("fs_cache_") || k.startsWith("fs_last_campaign"))
      .forEach((k) => localStorage.removeItem(k));
    sessionStorage.clear();
  } catch { /* ignore */ }
}

/* All memberships for the signed-in user, newest org last. */
export async function listMemberships(userId) {
  const { data } = await sb()
    .from("fs_memberships")
    .select("role, org_id, fs_orgs(id, name)")
    .eq("user_id", userId);
  return (data || []).filter((m) => m.fs_orgs);
}

/* The membership for the *active* org — validated, never arbitrary.
   Returns { role, org_id, fs_orgs, memberships } or null. */
export async function activeMembership(userId) {
  const memberships = await listMemberships(userId);
  if (!memberships.length) return null;
  const stored = getStoredOrgId();
  const chosen =
    (stored && memberships.find((m) => m.org_id === stored)) ||
    memberships.slice().sort((a, b) => String(a.fs_orgs.name).localeCompare(String(b.fs_orgs.name)))[0];
  if (chosen.org_id !== stored) setActiveOrgId(chosen.org_id);
  return { ...chosen, memberships };
}

export async function switchOrg(orgId) {
  setActiveOrgId(orgId);
  clearOrgScopedCache();
  window.location.reload(); // hard reload: no stale tenant data in memory
}
