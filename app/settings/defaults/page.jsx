"use client";
/* Campaign defaults — what a new campaign inherits.
   These values are copied onto fs_campaign_governance by fs_create_campaign at
   creation time. Changing them here does NOT change any campaign that already
   exists: a running campaign's governance is deliberately independent, so a
   settings edit can never retroactively unsuppress data that respondents were
   promised would stay suppressed. The page says so explicitly. */
import { useEffect, useState } from "react";
import { sb } from "../../../lib/supabase";
import { useSettings } from "../context";
import { ErrorNote, LoadingCard, Note, ReadOnlyNotice, Row, SaveBar, Section, SettingsPage, useSave } from "../parts";
import { Input } from "@/components/ui/input";
import { Checkbox } from "@/components/ui/checkbox";
import { Label } from "@/components/ui/label";
import { NativeSelect, NativeSelectOption } from "@/components/ui/native-select";

const FLOOR = 4; // hard server floor — also enforced by DB trigger and edge functions

export default function DefaultsSettings() {
  const { org, user, orgSettings, isOwner, loading, err, loadOrgSettings } = useSettings();
  const [f, setF] = useState(null);
  const [state, save] = useSave();

  useEffect(() => {
    if (!orgSettings) return;
    setF({
      default_campaign_duration_days: orgSettings.default_campaign_duration_days ?? 30,
      default_score_threshold: orgSettings.default_score_threshold ?? 5,
      default_comment_threshold: orgSettings.default_comment_threshold ?? 10,
      default_suppression_mode: orgSettings.default_suppression_mode || "basic",
      default_max_filter_dimensions: orgSettings.default_max_filter_dimensions ?? 2,
      require_launch_approval: !!orgSettings.require_launch_approval,
      require_report_approval: !!orgSettings.require_report_approval,
    });
  }, [orgSettings]);

  if (loading || !f) return <LoadingCard rows={6} />;
  if (err) return <ErrorNote>{err}</ErrorNote>;

  const ro = !isOwner;
  const num = (k, min, max) => (e) => {
    const v = Number(e.target.value);
    setF((p) => ({ ...p, [k]: Number.isFinite(v) ? Math.min(max, Math.max(min, Math.round(v))) : p[k] }));
  };

  const onSave = () => save(async () => {
    const score = Math.max(FLOOR, f.default_score_threshold);
    const comment = Math.max(score, f.default_comment_threshold);
    const { error } = await sb().from("fs_org_settings").update({
      default_campaign_duration_days: f.default_campaign_duration_days,
      default_score_threshold: score,
      default_comment_threshold: comment,
      default_suppression_mode: f.default_suppression_mode,
      default_max_filter_dimensions: f.default_max_filter_dimensions,
      require_launch_approval: f.require_launch_approval,
      require_report_approval: f.require_report_approval,
    }).eq("org_id", org.id);
    if (error) throw error;
    await sb().from("fs_audit").insert({
      org_id: org.id, actor: user.id, action: "org.defaults.update",
      entity: "fs_org_settings", entity_id: org.id,
    });
    await loadOrgSettings(org.id);
    setF((p) => ({ ...p, default_score_threshold: score, default_comment_threshold: comment }));
  });

  return (
    <SettingsPage
      title="Campaign defaults"
      description="The starting point for every campaign you create from now on."
    >
      {ro ? <ReadOnlyNotice /> : null}

      <Note>
        These are inherited at creation time only. Changing them never alters a campaign that already exists —
        a running campaign keeps the privacy promise it was launched with.
      </Note>

      <Section
        title="Anonymity thresholds"
        description="The minimum number of responses in a group before its data is released."
        footer={ro ? null : <SaveBar onSave={onSave} state={state} />}
      >
        <Row label="Score threshold" htmlFor="score" source="org"
          hint={`Gates group scores, demographic cuts and the overall score. Cannot go below ${FLOOR} — that floor is enforced by the database and by both edge functions, not by this form.`}>
          <div className="flex items-center gap-2">
            <Input id="score" type="number" min={FLOOR} max={100} value={f.default_score_threshold}
              onChange={num("default_score_threshold", FLOOR, 100)} disabled={ro} className="w-28" />
            <span className="text-sm text-muted-foreground">responses</span>
          </div>
        </Row>
        <Row label="Comment threshold" htmlFor="comment" source="org"
          hint="Gates everything that exposes individual-level content: written comments, theme coding, and the single-response view. Usually higher than the score threshold, because a verbatim can identify its author in a group where a mean cannot.">
          <div className="flex items-center gap-2">
            <Input id="comment" type="number" min={f.default_score_threshold} max={200} value={f.default_comment_threshold}
              onChange={num("default_comment_threshold", FLOOR, 200)} disabled={ro} className="w-28" />
            <span className="text-sm text-muted-foreground">responses</span>
          </div>
        </Row>
        {f.default_comment_threshold < f.default_score_threshold ? (
          <Note>The comment threshold will be raised to {f.default_score_threshold} on save — it can never sit below the score threshold.</Note>
        ) : null}
        <Row label="Suppression mode" htmlFor="mode" source="org"
          hint="Basic suppresses any group or cut below the threshold. Complementary suppression — hiding a second cell so a suppressed one cannot be recovered by subtraction — is not implemented yet.">
          <NativeSelect id="mode" value={f.default_suppression_mode} onChange={(e) => setF((p) => ({ ...p, default_suppression_mode: e.target.value }))}
            disabled={ro} className="max-w-sm">
            <NativeSelectOption value="basic">Basic — suppress below threshold</NativeSelectOption>
            <NativeSelectOption value="strong" disabled>Strong — complementary suppression (not yet available)</NativeSelectOption>
          </NativeSelect>
        </Row>
        <Row label="Max filter dimensions" htmlFor="dims" source="org"
          hint="How many demographic filters an analyst may stack at once. Each additional filter shrinks the cell and makes re-identification easier.">
          <Input id="dims" type="number" min={1} max={8} value={f.default_max_filter_dimensions}
            onChange={num("default_max_filter_dimensions", 1, 8)} disabled={ro} className="w-28" />
        </Row>
      </Section>

      <Section
        title="Campaign run"
        description="Timing and sign-off."
        footer={ro ? null : <SaveBar onSave={onSave} state={state} />}
      >
        <Row label="Default duration" htmlFor="days" source="org" hint="New campaigns close this many days after they are created. You can always change the close date on the campaign itself.">
          <div className="flex items-center gap-2">
            <Input id="days" type="number" min={1} max={365} value={f.default_campaign_duration_days}
              onChange={num("default_campaign_duration_days", 1, 365)} disabled={ro} className="w-28" />
            <span className="text-sm text-muted-foreground">days</span>
          </div>
        </Row>
        <Row label="Approvals" source="org">
          <div className="flex flex-col gap-2">
            <div className="flex items-center gap-2">
              <Checkbox id="launch" checked={f.require_launch_approval} disabled={ro}
                onCheckedChange={(v) => setF((p) => ({ ...p, require_launch_approval: !!v }))} />
              <Label htmlFor="launch" className="text-sm font-normal">Require approval before a campaign opens</Label>
            </div>
            <div className="flex items-center gap-2">
              <Checkbox id="report" checked={f.require_report_approval} disabled={ro}
                onCheckedChange={(v) => setF((p) => ({ ...p, require_report_approval: !!v }))} />
              <Label htmlFor="report" className="text-sm font-normal">Require approval before a report is issued</Label>
            </div>
          </div>
        </Row>
      </Section>
    </SettingsPage>
  );
}
