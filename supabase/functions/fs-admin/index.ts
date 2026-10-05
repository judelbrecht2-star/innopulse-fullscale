// InnoPulse Full-Scale — org administration. v2 (audit F12):
// - action=members: list an org's team with emails (owner/manager)
// - action=invite: owner invites a teammate by email; existing auth users are
//   linked directly, new ones get a Supabase invite email. Membership upserted.
// - action=remove: owner removes a teammate (not themselves).
// verify_jwt=true; every action re-checks the caller's role in the target org.
import { createClient } from "npm:@supabase/supabase-js@2";

const CORS: Record<string, string> = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};
const J = (o: unknown, s = 200) => new Response(JSON.stringify(o), { status: s, headers: { ...CORS, "Content-Type": "application/json" } });
const ROLES = ["owner", "manager", "analyst", "viewer"];

Deno.serve(async (req: Request) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: CORS });
  if (req.method !== "POST") return J({ error: "POST only" }, 405);

  const admin = createClient(Deno.env.get("SUPABASE_URL")!, Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!, { auth: { autoRefreshToken: false, persistSession: false } });
  const jwt = (req.headers.get("Authorization") || "").replace(/^Bearer\s+/i, "");
  const { data: userData, error: uerr } = await admin.auth.getUser(jwt);
  if (uerr || !userData?.user) return J({ error: "Not signed in" }, 401);
  const uid = userData.user.id;

  let body: any;
  try { body = await req.json(); } catch { return J({ error: "Bad JSON" }, 400); }
  const orgId = String(body?.org_id || "");
  if (!orgId) return J({ error: "Missing org_id" }, 400);

  const { data: me } = await admin.from("fs_memberships").select("role").eq("org_id", orgId).eq("user_id", uid).maybeSingle();
  if (!me) return J({ error: "Not a member of this organisation" }, 403);

  if (body.action === "members") {
    if (!["owner", "manager"].includes(me.role)) return J({ error: "Owners and managers only" }, 403);
    const { data: mems } = await admin.from("fs_memberships").select("user_id, role, created_at").eq("org_id", orgId);
    const out = [];
    for (const m of mems || []) {
      let email = null;
      try { const { data: u } = await admin.auth.admin.getUserById(m.user_id); email = u?.user?.email ?? null; } catch { /* leave null */ }
      out.push({ user_id: m.user_id, role: m.role, email, since: m.created_at, you: m.user_id === uid });
    }
    return J({ members: out });
  }

  if (body.action === "invite") {
    if (me.role !== "owner") return J({ error: "Only owners can invite teammates" }, 403);
    const email = String(body?.email || "").trim().toLowerCase();
    const role = String(body?.role || "viewer");
    if (!/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(email)) return J({ error: "Enter a valid email address" }, 400);
    if (!ROLES.includes(role)) return J({ error: "Invalid role" }, 400);

    let targetId: string | null = null;
    let invited = false;
    const { data: inv, error: eInv } = await admin.auth.admin.inviteUserByEmail(email, {
      redirectTo: "https://innopulse-fullscale.vercel.app/login",
    });
    if (!eInv && inv?.user) { targetId = inv.user.id; invited = true; }
    else {
      // probably already registered — find them
      const { data: list } = await admin.auth.admin.listUsers({ page: 1, perPage: 1000 });
      const hit = (list?.users || []).find((u: any) => (u.email || "").toLowerCase() === email);
      if (!hit) return J({ error: eInv?.message || "Could not invite this address." }, 400);
      targetId = hit.id;
    }

    const { error: eMem } = await admin.from("fs_memberships")
      .upsert({ org_id: orgId, user_id: targetId, role }, { onConflict: "org_id,user_id" });
    if (eMem) return J({ error: eMem.message }, 500);

    await admin.from("fs_audit").insert({ org_id: orgId, actor: uid, action: "member.invite:" + role, entity: "fs_memberships", entity_id: targetId }).then(() => {}, () => {});
    return J({ ok: true, invited, email, role });
  }

  if (body.action === "remove") {
    if (me.role !== "owner") return J({ error: "Only owners can remove teammates" }, 403);
    const targetId = String(body?.user_id || "");
    if (!targetId) return J({ error: "Missing user_id" }, 400);
    if (targetId === uid) return J({ error: "You can't remove yourself." }, 400);
    const { error } = await admin.from("fs_memberships").delete().eq("org_id", orgId).eq("user_id", targetId);
    if (error) return J({ error: error.message }, 500);
    await admin.from("fs_audit").insert({ org_id: orgId, actor: uid, action: "member.remove", entity: "fs_memberships", entity_id: targetId }).then(() => {}, () => {});
    return J({ ok: true });
  }

  return J({ error: "Unknown action" }, 400);
});

