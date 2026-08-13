"use client";
/* Shared state for every /settings/* route.
   One auth check, one membership resolution and one fs_org_settings fetch for
   the whole section, rather than each page doing its own. The active
   organisation comes from app/lib/org.js (P0-3) — never an arbitrary
   membership row. Writes stay on the individual pages; this only holds what
   they all need and gives them a way to refresh it. */
import { createContext, useCallback, useContext, useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { sb } from "../../lib/supabase";
import { activeMembership } from "../lib/org";

const Ctx = createContext(null);

export function useSettings() {
  const v = useContext(Ctx);
  if (!v) throw new Error("useSettings must be used inside the /settings layout");
  return v;
}

export function SettingsProvider({ children }) {
  const router = useRouter();
  const [user, setUser] = useState(null);
  const [org, setOrg] = useState(null);
  const [role, setRole] = useState("");
  const [memberships, setMemberships] = useState([]);
  const [orgSettings, setOrgSettings] = useState(null);
  const [prefs, setPrefs] = useState(null);
  const [loading, setLoading] = useState(true);
  const [err, setErr] = useState("");

  /* Personal preferences are per-user and cross-organisation. They are loaded
     here, alongside org settings, so no page has to decide which table a given
     setting belongs to — the answer is already on screen in the shape of the
     data. */
  const loadPrefs = useCallback(async () => {
    const { data, error } = await sb().rpc("fs_user_preferences_ensure");
    if (error) { setErr(error.message); return null; }
    const row = Array.isArray(data) ? data[0] : data;
    setPrefs(row || null);
    return row || null;
  }, []);

  const loadOrgSettings = useCallback(async (orgId) => {
    // SECURITY DEFINER: creates the row on first read for orgs that predate
    // fs_org_settings. Members only; the function re-checks membership.
    const { data, error } = await sb().rpc("fs_org_settings_ensure", { p_org: orgId });
    if (error) { setErr(error.message); return null; }
    const row = Array.isArray(data) ? data[0] : data;
    setOrgSettings(row || null);
    return row || null;
  }, []);

  const refresh = useCallback(async () => {
    const { data } = await sb().auth.getUser();
    if (!data.user) { router.replace("/login"); return; }
    setUser(data.user);
    await loadPrefs();
    const mem = await activeMembership(data.user.id);
    if (!mem) {
      setErr("Your user isn't linked to an organisation yet.");
      setLoading(false);
      return;
    }
    setOrg(mem.fs_orgs);
    setRole(mem.role);
    setMemberships(mem.memberships || []);
    await loadOrgSettings(mem.org_id);
    setLoading(false);
  }, [router, loadOrgSettings, loadPrefs]);

  useEffect(() => { refresh(); }, [refresh]);

  const value = {
    user, org, role, memberships, orgSettings, prefs,
    loading, err,
    isOwner: role === "owner",
    canManage: role === "owner" || role === "manager",
    setOrg, setOrgSettings, setPrefs, loadOrgSettings, loadPrefs, refresh,
  };
  return <Ctx.Provider value={value}>{children}</Ctx.Provider>;
}
