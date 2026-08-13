"use client";
/* Profile — the signed-in person, not the organisation.
   Display name and email live on the Supabase auth user; the organisation
   switcher writes through app/lib/org.js so the active-org choice (P0-3) stays
   the single source of truth and cached tenant data is purged on switch. */
import { useEffect, useState } from "react";
import Link from "next/link";
import { sb } from "../../../lib/supabase";
import { switchOrg } from "../../lib/org";
import { useSettings } from "../context";
import { ErrorNote, LoadingCard, Note, Row, SaveBar, Section, SettingsPage, useSave } from "../parts";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { NativeSelect, NativeSelectOption } from "@/components/ui/native-select";
import { Checkbox } from "@/components/ui/checkbox";
import { Label } from "@/components/ui/label";

const ROLE_HELP = {
  owner: "Full control — campaigns, settings, team, and all released detail",
  manager: "Runs campaigns and data collection",
  analyst: "Reads results and responses",
  viewer: "Reads aggregated results only",
};

const TIMEZONES = [
  "Africa/Johannesburg", "Africa/Windhoek", "Africa/Nairobi", "Africa/Lagos",
  "Europe/London", "Europe/Amsterdam", "Europe/Berlin", "Asia/Dubai",
  "America/New_York", "America/Chicago", "America/Los_Angeles", "Australia/Sydney", "UTC",
];
const LOCALES = [["en-ZA", "English (South Africa)"], ["en-GB", "English (UK)"], ["en-US", "English (US)"]];
const DATE_FORMATS = [["DD MMM YYYY", "13 Aug 2026"], ["YYYY-MM-DD", "2026-08-13"], ["DD/MM/YYYY", "13/08/2026"], ["MM/DD/YYYY", "08/13/2026"]];
const LANDING = [["/dashboard", "Overview"], ["/campaigns", "Campaigns"], ["/responses", "Responses"], ["/insights", "Insights"], ["/reports", "Reports"]];

export default function ProfileSettings() {
  const { user, org, role, memberships, prefs, loading, err, refresh, loadPrefs } = useSettings();
  const [name, setName] = useState("");
  const [email, setEmail] = useState("");
  const [p, setP] = useState(null);          // working copy of personal preferences
  const [nameState, saveName] = useSave();
  const [emailState, saveEmail] = useSave();
  const [prefState, savePrefs] = useSave();
  const [emailSent, setEmailSent] = useState("");

  useEffect(() => {
    if (!user) return;
    setName(prefs?.display_name || user.user_metadata?.full_name || "");
    setEmail(user.email || "");
  }, [user, prefs]);

  useEffect(() => {
    if (!prefs) return;
    setP({
      timezone: prefs.timezone || "Africa/Johannesburg",
      locale: prefs.locale || "en-ZA",
      date_format: prefs.date_format || "DD MMM YYYY",
      table_density: prefs.table_density || "comfortable",
      reduced_motion: !!prefs.reduced_motion,
      default_landing_page: prefs.default_landing_page || "/dashboard",
      default_org_id: prefs.default_org_id || "",
    });
  }, [prefs]);

  if (loading) return <LoadingCard rows={4} />;
  if (err) return <ErrorNote>{err}</ErrorNote>;

  /* Display name lives in fs_user_preferences — it is a personal preference,
     not organisation data. It is mirrored into auth user_metadata so anything
     reading the session still sees it. */
  const onSaveName = () => saveName(async () => {
    const { error } = await sb().from("fs_user_preferences")
      .update({ display_name: name.trim() || null }).eq("user_id", user.id);
    if (error) throw error;
    await sb().auth.updateUser({ data: { full_name: name.trim() } });
    await loadPrefs();
    await refresh();
  });

  const onSavePrefs = () => savePrefs(async () => {
    const { error } = await sb().from("fs_user_preferences").update({
      timezone: p.timezone, locale: p.locale, date_format: p.date_format,
      table_density: p.table_density, reduced_motion: p.reduced_motion,
      default_landing_page: p.default_landing_page,
      default_org_id: p.default_org_id || null,
    }).eq("user_id", user.id);
    if (error) throw error;
    await loadPrefs();
  });

  const onSaveEmail = () => saveEmail(async () => {
    const next = email.trim().toLowerCase();
    if (!/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(next)) throw new Error("Enter a valid email address.");
    if (next === (user.email || "").toLowerCase()) throw new Error("That is already your address.");
    const { error } = await sb().auth.updateUser({ email: next });
    if (error) throw error;
    setEmailSent(next);
  });

  return (
    <SettingsPage
      title="Profile"
      description="Who you are on this platform, and which organisation you are currently working in."
    >
      <Section
        title="Your details"
        description="Your name appears in the audit log next to actions you take."
        footer={<SaveBar onSave={onSaveName} state={nameState} />}
      >
        <Row label="Display name" htmlFor="fullname" hint="Optional. Shown to teammates in the audit log.">
          <div className="flex items-center gap-2">
            <Input id="fullname" value={name} onChange={(e) => setName(e.target.value)} placeholder="Your name" className="max-w-sm" />
            <Badge variant="outline" data-tone="teal">Personal</Badge>
          </div>
        </Row>
        <Row label="Role" hint={ROLE_HELP[role] || "Assigned by the organisation owner."}>
          <div className="flex items-center gap-2">
            <Badge variant="outline" data-tone="draft">{role || "—"}</Badge>
            <span className="text-xs text-muted-foreground">Set by your organisation — you cannot change your own role.</span>
          </div>
        </Row>
      </Section>

      {p ? (
        <Section
          title="How the app behaves for you"
          description="These follow you across every organisation you belong to, and change nothing for anyone else."
          footer={<SaveBar onSave={onSavePrefs} state={prefState} />}
        >
          <Row label="Time zone" htmlFor="tz" hint="Dates and times are shown in this zone. Your organisation has its own time zone for scheduling.">
            <div className="flex items-center gap-2">
              <NativeSelect id="tz" value={p.timezone} onChange={(e) => setP({ ...p, timezone: e.target.value })} className="max-w-sm">
                {TIMEZONES.map((t) => <NativeSelectOption key={t} value={t}>{t.replace("_", " ")}</NativeSelectOption>)}
              </NativeSelect>
              <Badge variant="outline" data-tone="teal">Personal</Badge>
            </div>
          </Row>
          <Row label="Language" htmlFor="loc">
            <NativeSelect id="loc" value={p.locale} onChange={(e) => setP({ ...p, locale: e.target.value })} className="max-w-sm">
              {LOCALES.map(([c, n]) => <NativeSelectOption key={c} value={c}>{n}</NativeSelectOption>)}
            </NativeSelect>
          </Row>
          <Row label="Date format" htmlFor="df">
            <NativeSelect id="df" value={p.date_format} onChange={(e) => setP({ ...p, date_format: e.target.value })} className="max-w-sm">
              {DATE_FORMATS.map(([v, eg]) => <NativeSelectOption key={v} value={v}>{v} — {eg}</NativeSelectOption>)}
            </NativeSelect>
          </Row>
          <Row label="Table density" htmlFor="td" hint="Compact fits more rows on screen.">
            <NativeSelect id="td" value={p.table_density} onChange={(e) => setP({ ...p, table_density: e.target.value })} className="max-w-sm">
              <NativeSelectOption value="comfortable">Comfortable</NativeSelectOption>
              <NativeSelectOption value="compact">Compact</NativeSelectOption>
            </NativeSelect>
          </Row>
          <Row label="Reduced motion">
            <div className="flex items-center gap-2">
              <Checkbox id="rm" checked={p.reduced_motion} onCheckedChange={(v) => setP({ ...p, reduced_motion: !!v })} />
              <Label htmlFor="rm" className="text-sm font-normal">Minimise animation and transitions</Label>
            </div>
          </Row>
          <Row label="Start page" htmlFor="lp" hint="Where signing in takes you.">
            <NativeSelect id="lp" value={p.default_landing_page} onChange={(e) => setP({ ...p, default_landing_page: e.target.value })} className="max-w-sm">
              {LANDING.map(([v, n]) => <NativeSelectOption key={v} value={v}>{n}</NativeSelectOption>)}
            </NativeSelect>
          </Row>
          {memberships.length > 1 ? (
            <Row label="Default organisation" htmlFor="dorg" hint="Which organisation you land in when you sign in.">
              <NativeSelect id="dorg" value={p.default_org_id} onChange={(e) => setP({ ...p, default_org_id: e.target.value })} className="max-w-sm">
                <NativeSelectOption value="">Last one I used</NativeSelectOption>
                {memberships.map((m) => <NativeSelectOption key={m.org_id} value={m.org_id}>{m.fs_orgs.name}</NativeSelectOption>)}
              </NativeSelect>
            </Row>
          ) : null}
        </Section>
      ) : null}

      <Section
        title="Sign-in address"
        description="Changing this sends a confirmation link to the new address. The change only takes effect once you click it."
        footer={<SaveBar onSave={onSaveEmail} state={emailState} label="Change email" />}
      >
        <Row label="Email" htmlFor="email">
          <Input id="email" type="email" value={email} onChange={(e) => setEmail(e.target.value)} className="max-w-sm" autoComplete="email" />
        </Row>
        {emailSent ? <Note>Confirmation sent to <b>{emailSent}</b>. Until you confirm it, keep signing in with your current address.</Note> : null}
      </Section>

      <Section
        title="Active organisation"
        description="Everything you see — campaigns, responses, reports — is scoped to this organisation."
      >
        {memberships.length <= 1 ? (
          <Row label="Organisation" hint="You belong to one organisation.">
            <div className="text-sm font-medium">{org?.name || "—"}</div>
          </Row>
        ) : (
          <Row label="Organisation" hint="Switching reloads the app and clears any cached data from the previous organisation.">
            <NativeSelect
              className="max-w-sm"
              value={org?.id || ""}
              onChange={(e) => { if (e.target.value !== org?.id) switchOrg(e.target.value); }}
            >
              {memberships.map((m) => (
                <NativeSelectOption key={m.org_id} value={m.org_id}>
                  {m.fs_orgs.name} — {m.role}
                </NativeSelectOption>
              ))}
            </NativeSelect>
          </Row>
        )}
      </Section>

      <Section title="Data about you">
        <p className="text-sm text-muted-foreground">
          Respondent answers are never linked to a named person. What this platform stores about
          <em> you</em> as a user is your email, your display name, your role, and the actions you take
          in the audit log. The <Link href="/privacy" target="_blank" className="underline underline-offset-2">privacy notice</Link> sets
          out the detail.
        </p>
        <div>
          <Button
            variant="outline"
            size="sm"
            onClick={async () => { await sb().auth.signOut({ scope: "global" }); window.location.href = "/login"; }}
          >
            Sign out of all devices
          </Button>
        </div>
      </Section>
    </SettingsPage>
  );
}
