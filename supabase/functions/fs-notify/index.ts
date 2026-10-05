// InnoPulse Full-Scale — reminder emails via Resend. Owner/manager only.
// Privacy by design: recipient lists are used for delivery only and are never
// stored or linked to responses. Requires RESEND_API_KEY secret.
import { createClient } from "npm:@supabase/supabase-js@2";

const CORS: Record<string, string> = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};
const J = (o: unknown, s = 200) => new Response(JSON.stringify(o), { status: s, headers: { ...CORS, "Content-Type": "application/json" } });

Deno.serve(async (req: Request) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: CORS });
  if (req.method !== "POST") return J({ error: "POST only" }, 405);
  const key = Deno.env.get("RESEND_API_KEY");
  if (!key) return J({ error: "Email isn't configured yet — add the RESEND_API_KEY secret in Supabase → Edge Functions → Secrets, then try again." }, 503);

  const admin = createClient(Deno.env.get("SUPABASE_URL")!, Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!, { auth: { autoRefreshToken: false, persistSession: false } });
  const jwt = (req.headers.get("Authorization") || "").replace(/^Bearer\s+/i, "");
  const { data: ud, error: uerr } = await admin.auth.getUser(jwt);
  if (uerr || !ud?.user) return J({ error: "Not signed in" }, 401);

  let body: any; try { body = await req.json(); } catch { return J({ error: "Bad JSON" }, 400); }
  const campaignId = String(body?.campaign_id || "");
  const groupId = String(body?.group_id || "");
  const emails: string[] = Array.isArray(body?.emails) ? body.emails.map((e: any) => String(e).trim().toLowerCase()).filter((e: string) => /^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(e)) : [];
  const note = String(body?.message || "").slice(0, 600);
  if (!campaignId || !groupId) return J({ error: "Missing campaign or group" }, 400);
  if (!emails.length) return J({ error: "No valid email addresses" }, 400);
  if (emails.length > 100) return J({ error: "Max 100 recipients per send" }, 400);

  const { data: camp } = await admin.from("fs_campaigns").select("id, org_id, name, status, closes_at").eq("id", campaignId).maybeSingle();
  if (!camp) return J({ error: "Campaign not found" }, 404);
  const { data: mem } = await admin.from("fs_memberships").select("role").eq("org_id", camp.org_id).eq("user_id", ud.user.id).maybeSingle();
  if (!mem || !["owner", "manager"].includes(mem.role)) return J({ error: "Owners and managers only" }, 403);
  if (camp.status !== "open") return J({ error: "Campaign is not open" }, 400);
  const { data: grp } = await admin.from("fs_groups").select("id, label, type").eq("id", groupId).eq("campaign_id", campaignId).maybeSingle();
  if (!grp) return J({ error: "Group not found" }, 404);
  const { data: link } = await admin.from("fs_links").select("token").eq("campaign_id", campaignId).eq("group_id", groupId).eq("mode", "group").eq("active", true).limit(1).maybeSingle();
  if (!link) return J({ error: "No active link for this group" }, 400);

  const { data: org } = await admin.from("fs_orgs").select("name").eq("id", camp.org_id).maybeSingle();
  const url = `https://innopulse-fullscale.vercel.app/respond/${link.token}`;
  const closes = camp.closes_at ? new Date(camp.closes_at).toDateString() : null;
  const html = `
    <div style="font-family:Segoe UI,Arial,sans-serif;max-width:560px;margin:0 auto;color:#17171a">
      <h2 style="color:#e8332e;margin:18px 0 6px">A few minutes for ${org?.name || "your organisation"}?</h2>
      <p>You're invited to complete the <b>${camp.name}</b> innovation assessment as part of the <b>${grp.label}</b> group. It takes about 10–12 minutes.</p>
      ${note ? `<p style=\"border-left:3px solid #e8332e;padding-left:10px;color:#444\">${note.replace(/</g, "&lt;")}</p>` : ""}
      <p><a href="${url}" style="background:#e8332e;color:#fff;text-decoration:none;padding:11px 20px;border-radius:9px;font-weight:700;display:inline-block">Start the assessment</a></p>
      <p style="font-size:13px;color:#666">Your answers are anonymous — no name or email is stored with them, and results are only reported for groups.${closes ? ` The window closes ${closes}.` : ""}</p>
    </div>`;

  let sent = 0; const errors: string[] = [];
  for (let i = 0; i < emails.length; i += 40) {
    const batch = emails.slice(i, i + 40).map((to) => ({
      from: "InnoPulse <noreply@thegrowthsystem.co.za>",
      to: [to],
      subject: `Reminder: ${camp.name} — your input is needed`,
      html,
    }));
    const r = await fetch("https://api.resend.com/emails/batch", {
      method: "POST", headers: { Authorization: `Bearer ${key}`, "Content-Type": "application/json" },
      body: JSON.stringify(batch),
    });
    if (r.ok) sent += batch.length; else errors.push(await r.text());
  }
  await admin.from("fs_audit").insert({ org_id: camp.org_id, actor: ud.user.id, action: `reminder.sent:${sent}`, entity: "fs_groups", entity_id: groupId }).then(() => {}, () => {});
  if (!sent) return J({ error: "Sending failed: " + (errors[0] || "unknown").slice(0, 200) }, 502);
  return J({ ok: true, sent, failed: emails.length - sent });
});

