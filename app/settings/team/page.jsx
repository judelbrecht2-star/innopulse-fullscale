"use client";
/* Team — members, roles and invitations.
   Listing and inviting go through the fs-admin edge function, because auth
   emails are not readable from the browser. Role changes are a direct update on
   fs_memberships, which RLS restricts to owners. The last-owner guard here is a
   usability guard; the real protection is that an org with no owner cannot be
   re-created from the client, so we refuse the change before it is sent. */
import { useCallback, useEffect, useState } from "react";
import { sb, FN_BASE } from "../../../lib/supabase";
import { useSettings } from "../context";
import { ErrorNote, LoadingCard, Note, Row, Section, SettingsPage } from "../parts";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { NativeSelect, NativeSelectOption } from "@/components/ui/native-select";
import { Alert, AlertDescription } from "@/components/ui/alert";
import { Check } from "iconoir-react";

const ROLES = ["owner", "manager", "analyst", "viewer"];
const ROLE_HELP = {
  owner: "Full control — campaigns, settings, team, and all released detail",
  manager: "Runs campaigns and data collection",
  analyst: "Reads results and responses",
  viewer: "Reads aggregated results only",
};

export default function TeamSettings() {
  const { org, user, isOwner, canManage, loading, err } = useSettings();
  const [members, setMembers] = useState(null);
  const [tErr, setTErr] = useState("");
  const [tMsg, setTMsg] = useState("");
  const [busy, setBusy] = useState(false);
  const [invEmail, setInvEmail] = useState("");
  const [invRole, setInvRole] = useState("analyst");

  const call = useCallback(async (body) => {
    const { data: sess } = await sb().auth.getSession();
    const jwt = sess.session?.access_token;
    const r = await fetch(`${FN_BASE}/fs-admin`, {
      method: "POST",
      headers: { "Content-Type": "application/json", Authorization: `Bearer ${jwt}` },
      body: JSON.stringify(body),
    });
    const j = await r.json();
    if (!r.ok) throw new Error(j.error || "That didn't work.");
    return j;
  }, []);

  const loadTeam = useCallback(async () => {
    if (!org) return;
    setTErr("");
    try { const j = await call({ action: "members", org_id: org.id }); setMembers(j.members || []); }
    catch (e) { setTErr(e.message); setMembers([]); }
  }, [org, call]);

  useEffect(() => { if (org && canManage) loadTeam(); }, [org, canManage, loadTeam]);

  if (loading) return <LoadingCard rows={4} />;
  if (err) return <ErrorNote>{err}</ErrorNote>;
  if (!canManage) return <ErrorNote>Owners and managers only.</ErrorNote>;

  const owners = (members || []).filter((m) => m.role === "owner").length;

  async function invite(e) {
    e.preventDefault();
    setTErr(""); setTMsg(""); setBusy(true);
    try {
      const j = await call({ action: "invite", org_id: org.id, email: invEmail.trim(), role: invRole });
      setTMsg(j.invited
        ? `Invite sent to ${j.email} — they'll set a password and land in your organisation as ${j.role}.`
        : `${j.email} already had an account — added to your organisation as ${j.role}.`);
      setInvEmail("");
      await loadTeam();
    } catch (ex) { setTErr(ex.message); }
    setBusy(false);
  }

  async function removeMember(userId) {
    setTErr(""); setTMsg(""); setBusy(true);
    try { await call({ action: "remove", org_id: org.id, user_id: userId }); await loadTeam(); }
    catch (ex) { setTErr(ex.message); }
    setBusy(false);
  }

  async function changeRole(m, next) {
    setTErr(""); setTMsg(""); setBusy(true);
    try {
      if (m.role === "owner" && next !== "owner" && owners <= 1) {
        throw new Error("This is the only owner. Promote someone else to owner first.");
      }
      const { error } = await sb().from("fs_memberships")
        .update({ role: next }).eq("org_id", org.id).eq("user_id", m.user_id);
      if (error) throw error;
      await sb().from("fs_audit").insert({
        org_id: org.id, actor: user.id, action: "member.role:" + next,
        entity: "fs_memberships", entity_id: m.user_id,
      });
      setTMsg(`${m.email || "That member"} is now ${next}.`);
      await loadTeam();
      // Demoting yourself changes what you can see — reload rather than leave a stale UI.
      if (m.user_id === user.id) window.location.reload();
    } catch (ex) { setTErr(ex.message); }
    setBusy(false);
  }

  return (
    <SettingsPage
      title="Team"
      description="Who can reach this organisation's campaigns, responses and reports."
    >
      {tErr ? <ErrorNote>{tErr}</ErrorNote> : null}
      {tMsg ? <Alert><Check width={16} height={16} /><AlertDescription>{tMsg}</AlertDescription></Alert> : null}

      <Section title="Members" description={`${members ? members.length : "…"} in ${org?.name || "this organisation"}.`}>
        {!members ? (
          <p className="text-sm text-muted-foreground">Loading team…</p>
        ) : (
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Member</TableHead>
                <TableHead>Role</TableHead>
                <TableHead className="text-right" />
              </TableRow>
            </TableHeader>
            <TableBody>
              {members.map((m) => (
                <TableRow key={m.user_id}>
                  <TableCell className="text-sm">
                    {m.email || m.user_id}
                    {m.you ? <Badge variant="secondary" data-tone="teal" className="ml-2">you</Badge> : null}
                    {m.since ? <div className="text-xs text-muted-foreground">since {new Date(m.since).toLocaleDateString()}</div> : null}
                  </TableCell>
                  <TableCell className="text-sm">
                    {isOwner ? (
                      <NativeSelect
                        aria-label={`Role for ${m.email || m.user_id}`}
                        value={m.role}
                        disabled={busy}
                        onChange={(e) => changeRole(m, e.target.value)}
                        className="w-36"
                      >
                        {ROLES.map((r) => <NativeSelectOption key={r} value={r}>{r}</NativeSelectOption>)}
                      </NativeSelect>
                    ) : (
                      <Badge variant="outline" data-tone="draft" title={ROLE_HELP[m.role]}>{m.role}</Badge>
                    )}
                  </TableCell>
                  <TableCell className="text-right">
                    {isOwner && !m.you ? (
                      <Button variant="ghost" size="sm" disabled={busy} onClick={() => removeMember(m.user_id)}>Remove</Button>
                    ) : null}
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        )}
        <div className="grid gap-1 text-xs text-muted-foreground sm:grid-cols-2">
          {ROLES.map((r) => <div key={r}><b className="text-foreground">{r}</b> — {ROLE_HELP[r]}</div>)}
        </div>
      </Section>

      {isOwner ? (
        <Section title="Invite a teammate" description="New addresses receive an email invitation; existing accounts are added immediately.">
          <form onSubmit={invite} className="flex flex-col gap-4">
            <Row label="Email address" htmlFor="invemail" hint={ROLE_HELP[invRole]}>
              <div className="flex flex-wrap gap-2">
                <Input id="invemail" type="email" value={invEmail} onChange={(e) => setInvEmail(e.target.value)}
                  placeholder="colleague@company.com" className="min-w-56 flex-1" />
                <NativeSelect aria-label="Role for the invitee" value={invRole} onChange={(e) => setInvRole(e.target.value)} className="w-36">
                  {ROLES.map((r) => <NativeSelectOption key={r} value={r}>{r}</NativeSelectOption>)}
                </NativeSelect>
                <Button size="sm" disabled={busy || !invEmail.trim()}>{busy ? "Working…" : "Invite"}</Button>
              </div>
            </Row>
          </form>
        </Section>
      ) : (
        <Note>Only the organisation owner can invite, remove or re-role teammates.</Note>
      )}
    </SettingsPage>
  );
}
