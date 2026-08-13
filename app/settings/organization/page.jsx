"use client";
/* Organisation — identity, locale and contact points.
   Two tables sit behind this screen: fs_orgs (name/industry/size/region, the
   original record) and fs_org_settings (locale, contacts, programme owner).
   Industry exists on both; this page writes it to both so they cannot drift.
   RLS allows the update for owners only — the read-only path below is a
   courtesy, not the control. */
import { useEffect, useState } from "react";
import { sb } from "../../../lib/supabase";
import { useSettings } from "../context";
import { ErrorNote, LoadingCard, ReadOnlyNotice, Row, SaveBar, Section, SettingsPage, useSave } from "../parts";
import { Input } from "@/components/ui/input";
import { NativeSelect, NativeSelectOption } from "@/components/ui/native-select";

const SIZES = ["1-10", "11-50", "51-200", "201-1000", "1000+"];
const COUNTRIES = [
  ["ZA", "South Africa"], ["GB", "United Kingdom"], ["US", "United States"], ["AU", "Australia"],
  ["NA", "Namibia"], ["BW", "Botswana"], ["KE", "Kenya"], ["NG", "Nigeria"], ["AE", "United Arab Emirates"],
  ["DE", "Germany"], ["NL", "Netherlands"], ["OTHER", "Elsewhere"],
];
const TIMEZONES = [
  "Africa/Johannesburg", "Africa/Windhoek", "Africa/Nairobi", "Africa/Lagos",
  "Europe/London", "Europe/Amsterdam", "Europe/Berlin", "Asia/Dubai",
  "America/New_York", "America/Chicago", "America/Los_Angeles", "Australia/Sydney", "UTC",
];
const LOCALES = [["en-ZA", "English (South Africa)"], ["en-GB", "English (UK)"], ["en-US", "English (US)"]];

export default function OrganizationSettings() {
  const { org, orgSettings, isOwner, loading, err, user, loadOrgSettings, refresh } = useSettings();
  const [f, setF] = useState(null);
  const [state, save] = useSave();

  useEffect(() => {
    if (!org || !orgSettings) return;
    setF({
      name: org.name || "",
      industry: org.industry || orgSettings.industry || "",
      size: org.size || "",
      region: org.region || "",
      short_name: orgSettings.short_name || "",
      country: orgSettings.country || "ZA",
      timezone: orgSettings.timezone || "Africa/Johannesburg",
      locale: orgSettings.locale || "en-ZA",
      support_email: orgSettings.support_email || "",
      privacy_contact_email: orgSettings.privacy_contact_email || "",
    });
  }, [org, orgSettings]);

  if (loading || !f) return <LoadingCard rows={5} />;
  if (err) return <ErrorNote>{err}</ErrorNote>;

  const set = (k) => (e) => setF((p) => ({ ...p, [k]: e.target.value }));

  const onSave = () => save(async () => {
    if (!f.name.trim()) throw new Error("The organisation needs a name.");
    for (const [label, v] of [["support", f.support_email], ["privacy", f.privacy_contact_email]]) {
      if (v && !/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(v)) throw new Error(`Enter a valid ${label} email address.`);
    }
    const { error: e1 } = await sb().from("fs_orgs").update({
      name: f.name.trim(), industry: f.industry.trim() || null,
      size: f.size || null, region: f.region.trim() || null,
    }).eq("id", org.id);
    if (e1) throw e1;

    const { error: e2 } = await sb().from("fs_org_settings").update({
      short_name: f.short_name.trim() || null,
      industry: f.industry.trim() || null,
      country: f.country, timezone: f.timezone, locale: f.locale,
      support_email: f.support_email.trim() || null,
      privacy_contact_email: f.privacy_contact_email.trim() || null,
    }).eq("org_id", org.id);
    if (e2) throw e2;

    await sb().from("fs_audit").insert({
      org_id: org.id, actor: user.id, action: "org.profile.update",
      entity: "fs_org_settings", entity_id: org.id,
    });
    await loadOrgSettings(org.id);
    await refresh();
  });

  const ro = !isOwner;

  return (
    <SettingsPage
      title="Organisation"
      description="How this organisation is identified across the platform and in generated reports."
    >
      {ro ? <ReadOnlyNotice /> : null}

      <Section
        title="Identity"
        description="The name here appears on the cover of every report you generate."
        footer={ro ? null : <SaveBar onSave={onSave} state={state} />}
      >
        <Row label="Organisation name" htmlFor="orgname">
          <Input id="orgname" value={f.name} onChange={set("name")} disabled={ro} className="max-w-sm" />
        </Row>
        <Row label="Short name" htmlFor="shortname" hint="Optional. Used where the full name won't fit — chart labels, table headers.">
          <Input id="shortname" value={f.short_name} onChange={set("short_name")} disabled={ro} className="max-w-sm" placeholder={f.name} />
        </Row>
        <Row label="Industry" htmlFor="industry" hint="Used for context in reports. Cross-client benchmarking is deferred until there are enough campaigns to support it.">
          <Input id="industry" value={f.industry} onChange={set("industry")} disabled={ro} className="max-w-sm" />
        </Row>
        <Row label="Size" htmlFor="size">
          <NativeSelect id="size" value={f.size} onChange={set("size")} disabled={ro} className="max-w-sm">
            <NativeSelectOption value="">Not stated</NativeSelectOption>
            {SIZES.map((s) => <NativeSelectOption key={s} value={s}>{s} people</NativeSelectOption>)}
          </NativeSelect>
        </Row>
        <Row label="Region" htmlFor="region" hint="Free text — the operating region you'd describe to a client.">
          <Input id="region" value={f.region} onChange={set("region")} disabled={ro} className="max-w-sm" />
        </Row>
      </Section>

      <Section
        title="Locale"
        description="Drives date formatting and the default campaign close time."
        footer={ro ? null : <SaveBar onSave={onSave} state={state} />}
      >
        <Row label="Country" htmlFor="country">
          <NativeSelect id="country" value={f.country} onChange={set("country")} disabled={ro} className="max-w-sm">
            {COUNTRIES.map(([c, n]) => <NativeSelectOption key={c} value={c}>{n}</NativeSelectOption>)}
          </NativeSelect>
        </Row>
        <Row label="Time zone" htmlFor="tz" hint="Campaign open and close times are interpreted in this zone.">
          <NativeSelect id="tz" value={f.timezone} onChange={set("timezone")} disabled={ro} className="max-w-sm">
            {TIMEZONES.map((t) => <NativeSelectOption key={t} value={t}>{t.replace("_", " ")}</NativeSelectOption>)}
          </NativeSelect>
        </Row>
        <Row label="Language" htmlFor="locale">
          <NativeSelect id="locale" value={f.locale} onChange={set("locale")} disabled={ro} className="max-w-sm">
            {LOCALES.map(([c, n]) => <NativeSelectOption key={c} value={c}>{n}</NativeSelectOption>)}
          </NativeSelect>
        </Row>
      </Section>

      <Section
        title="Contact points"
        description="Shown to respondents on the questionnaire and in the privacy notice."
        footer={ro ? null : <SaveBar onSave={onSave} state={state} />}
      >
        <Row label="Support email" htmlFor="support" hint="Where a respondent writes if a link doesn't work.">
          <Input id="support" type="email" value={f.support_email} onChange={set("support_email")} disabled={ro} className="max-w-sm" placeholder="support@company.com" />
        </Row>
        <Row label="Privacy contact" htmlFor="privacy" hint="The address a data subject uses to exercise their rights. Appears in the POPIA notice.">
          <Input id="privacy" type="email" value={f.privacy_contact_email} onChange={set("privacy_contact_email")} disabled={ro} className="max-w-sm" placeholder="privacy@company.com" />
        </Row>
      </Section>
    </SettingsPage>
  );
}
