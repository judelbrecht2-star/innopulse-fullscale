"use client";
/* Privacy — retention, export policy and the MFA requirement.
   Two honest caveats are stated on the page rather than buried: retention here
   is a policy of record (no scheduled job deletes anything yet), and the MFA
   requirement drives a prompt rather than a server-side AAL2 refusal. Claiming
   either is enforced when it is not would be worse than the gap itself. */
import { useEffect, useState } from "react";
import Link from "next/link";
import { sb } from "../../../lib/supabase";
import { useSettings } from "../context";
import { ErrorNote, LoadingCard, Note, ReadOnlyNotice, Row, SaveBar, Section, SettingsPage, useSave } from "../parts";
import { Input } from "@/components/ui/input";
import { Checkbox } from "@/components/ui/checkbox";
import { Label } from "@/components/ui/label";
import { NativeSelect, NativeSelectOption } from "@/components/ui/native-select";
import { Badge } from "@/components/ui/badge";

const MFA_ROLES = ["owner", "manager", "analyst", "viewer"];

export default function PrivacySettings() {
  const { org, user, orgSettings, isOwner, loading, err, loadOrgSettings } = useSettings();
  const [f, setF] = useState(null);
  const [state, save] = useSave();

  useEffect(() => {
    if (!orgSettings) return;
    const r = orgSettings.retention_policy || {};
    setF({
      allow_raw_exports: !!orgSettings.allow_raw_exports,
      require_mfa_roles: orgSettings.require_mfa_roles || [],
      enabled: !!r.enabled,
      invitation_contacts_days: r.invitation_contacts_days ?? 90,
      incomplete_responses_days: r.incomplete_responses_days ?? 30,
      completed_responses_months: r.completed_responses_months ?? 24,
    });
  }, [orgSettings]);

  if (loading || !f) return <LoadingCard rows={5} />;
  if (err) return <ErrorNote>{err}</ErrorNote>;

  const ro = !isOwner;
  const num = (k, min, max) => (e) => {
    const v = Number(e.target.value);
    setF((p) => ({ ...p, [k]: Number.isFinite(v) ? Math.min(max, Math.max(min, Math.round(v))) : p[k] }));
  };
  const toggleRole = (r) => setF((p) => ({
    ...p,
    require_mfa_roles: p.require_mfa_roles.includes(r)
      ? p.require_mfa_roles.filter((x) => x !== r)
      : [...p.require_mfa_roles, r],
  }));

  const onSave = () => save(async () => {
    const { error } = await sb().from("fs_org_settings").update({
      allow_raw_exports: f.allow_raw_exports,
      require_mfa_roles: f.require_mfa_roles,
      retention_policy: {
        enabled: f.enabled,
        invitation_contacts_days: f.invitation_contacts_days,
        incomplete_responses_days: f.incomplete_responses_days,
        completed_responses_months: f.completed_responses_months,
      },
    }).eq("org_id", org.id);
    if (error) throw error;
    await sb().from("fs_audit").insert({
      org_id: org.id, actor: user.id, action: "org.privacy.update",
      entity: "fs_org_settings", entity_id: org.id,
    });
    await loadOrgSettings(org.id);
  });

  return (
    <SettingsPage
      title="Privacy"
      description="Organisation-wide rules for respondent data. Per-campaign suppression thresholds live on each campaign; the values new campaigns start from are under Campaign defaults."
    >
      {ro ? <ReadOnlyNotice /> : null}

      <Section
        title="Data retention"
        description="How long each class of data is kept."
        footer={ro ? null : <SaveBar onSave={onSave} state={state} />}
      >
        <Note>
          This is your <b>policy of record</b>. Nothing on this platform deletes data automatically yet —
          no scheduled job is running against these values. Until one exists, treat these as the retention
          commitment you have made, which someone must action.
        </Note>
        <Row label="Retention policy" source="org" hint="Turn on once you are ready to stand behind these periods.">
          <div className="flex items-center gap-2">
            <Checkbox id="retention" checked={f.enabled} disabled={ro}
              onCheckedChange={(v) => setF((p) => ({ ...p, enabled: !!v }))} />
            <Label htmlFor="retention" className="text-sm font-normal">Retention policy is in force</Label>
          </div>
        </Row>
        <Row label="Invitation contacts" htmlFor="ret1" hint="Email addresses used to send invitations and reminders. Never joined to answers.">
          <div className="flex items-center gap-2">
            <Input id="ret1" type="number" min={1} max={3650} value={f.invitation_contacts_days}
              onChange={num("invitation_contacts_days", 1, 3650)} disabled={ro} className="w-28" />
            <span className="text-sm text-muted-foreground">days after the campaign closes</span>
          </div>
        </Row>
        <Row label="Incomplete responses" htmlFor="ret2" hint="Partial questionnaires that were started and abandoned.">
          <div className="flex items-center gap-2">
            <Input id="ret2" type="number" min={1} max={3650} value={f.incomplete_responses_days}
              onChange={num("incomplete_responses_days", 1, 3650)} disabled={ro} className="w-28" />
            <span className="text-sm text-muted-foreground">days after last activity</span>
          </div>
        </Row>
        <Row label="Completed responses" htmlFor="ret3" hint="The answers behind your results. Deleting these invalidates any report not already snapshotted.">
          <div className="flex items-center gap-2">
            <Input id="ret3" type="number" min={1} max={240} value={f.completed_responses_months}
              onChange={num("completed_responses_months", 1, 240)} disabled={ro} className="w-28" />
            <span className="text-sm text-muted-foreground">months after the campaign closes</span>
          </div>
        </Row>
      </Section>

      <Section
        title="Exports"
        description="Whether anyone in this organisation may take data out at respondent level."
        footer={ro ? null : <SaveBar onSave={onSave} state={state} />}
      >
        <Row label="Raw exports" source="org" hint="Off is the safe default: exports are aggregate-only, and per-campaign governance starts from this setting. Leaving it off keeps the anonymity guarantee end-to-end.">
          <div className="flex items-center gap-2">
            <Checkbox id="raw" checked={f.allow_raw_exports} disabled={ro}
              onCheckedChange={(v) => setF((p) => ({ ...p, allow_raw_exports: !!v }))} />
            <Label htmlFor="raw" className="text-sm font-normal">Allow respondent-level exports</Label>
          </div>
        </Row>
        {f.allow_raw_exports ? (
          <Note>
            With this on, new campaigns are created with <code>raw_export_policy = allowed</code>. Suppression
            thresholds still apply — an export can never contain a group below its threshold.
          </Note>
        ) : null}
      </Section>

      <Section
        title="Two-factor requirement"
        description="Which roles are told they must enable an authenticator app."
        footer={ro ? null : <SaveBar onSave={onSave} state={state} />}
      >
        <Note>
          High-risk actions — opening a campaign, rotating links, changing retention — check for two-factor
          server-side. That check is currently in <b>warn mode</b>: while no-one in this organisation has an
          authenticator enrolled, the action is allowed and the bypass is written to the audit log as
          <code> security.aal2_bypassed</code>. As soon as one person enrols, the check starts refusing. This
          list additionally drives the prompt each role sees on their Security page.
        </Note>
        <Row label="Roles requiring 2FA" source="org">
          <div className="flex flex-col gap-2">
            {MFA_ROLES.map((r) => (
              <div key={r} className="flex items-center gap-2">
                <Checkbox id={"mfa-" + r} checked={f.require_mfa_roles.includes(r)} disabled={ro}
                  onCheckedChange={() => toggleRole(r)} />
                <Label htmlFor={"mfa-" + r} className="text-sm font-normal">
                  {r}
                  {r === "viewer" ? <span className="text-muted-foreground"> — aggregate results only</span> : null}
                </Label>
              </div>
            ))}
          </div>
        </Row>
      </Section>

      <Section title="Respondent-facing notice">
        <p className="text-sm text-muted-foreground">
          The privacy notice respondents see is at{" "}
          <Link href="/privacy" target="_blank" className="underline underline-offset-2">/privacy</Link>. It names the
          privacy contact set under <Link href="/settings/organization" className="underline underline-offset-2">Organisation</Link>.
        </p>
        <div className="flex flex-wrap items-center gap-2 text-sm">
          <span className="text-muted-foreground">Privacy contact:</span>
          {orgSettings?.privacy_contact_email
            ? <Badge variant="outline" data-tone="draft">{orgSettings.privacy_contact_email}</Badge>
            : <Badge variant="outline" data-tone="closed">not set</Badge>}
        </div>
        <Note>
          The notice has not yet had a full POPIA section-18 legal review. That is tracked on the backlog and
          should happen before this platform is used with a client outside a pilot.
        </Note>
      </Section>
    </SettingsPage>
  );
}
