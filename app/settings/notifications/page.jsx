"use client";
/* Notifications — read-only for now, on purpose.
   fs-notify v1 sends reminders on demand from the Responses console; there is
   no preferences table behind this screen yet, so there is nothing here to
   save. Rather than render controls that silently do nothing, the page states
   what actually happens today and what is missing. */
import Link from "next/link";
import { useSettings } from "../context";
import { ErrorNote, LoadingCard, Note, Row, Section, SettingsPage } from "../parts";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";

export default function NotificationSettings() {
  const { org, orgSettings, loading, err } = useSettings();

  if (loading) return <LoadingCard rows={3} />;
  if (err) return <ErrorNote>{err}</ErrorNote>;

  return (
    <SettingsPage
      title="Notifications"
      description="What this platform emails, and to whom."
    >
      <Note>
        There are no preferences to set yet — no notification is sent on a schedule or a trigger.
        Everything below is sent only when a person clicks send. Preferences will appear here once
        there is something to prefer.
      </Note>

      <Section title="What is sent today">
        <Row label="Respondent reminders" hint="Sent from the Responses console, to addresses you paste in at that moment. The addresses are used for the send and are not stored against any answer.">
          <div className="flex items-center gap-2">
            <Badge variant="secondary" data-tone="open">On demand</Badge>
            <Button asChild variant="ghost" size="sm"><Link href="/responses">Open Responses</Link></Button>
          </div>
        </Row>
        <Row label="Team invitations" hint="Sent when an owner invites a teammate who does not yet have an account.">
          <div className="flex items-center gap-2">
            <Badge variant="secondary" data-tone="open">On demand</Badge>
            <Button asChild variant="ghost" size="sm"><Link href="/settings/team">Open Team</Link></Button>
          </div>
        </Row>
        <Row label="Password reset" hint="Sent by Supabase Auth when someone asks to reset their password.">
          <Badge variant="secondary" data-tone="open">Automatic</Badge>
        </Row>
      </Section>

      <Section title="Not sent yet" description="Named here so nobody assumes otherwise.">
        <ul className="list-disc pl-5 text-sm text-muted-foreground">
          <li>No campaign-closing reminder to the programme owner.</li>
          <li>No alert when a group crosses its anonymity threshold and results unlock.</li>
          <li>No digest of new responses.</li>
          <li>No notification when a report is generated or approved.</li>
        </ul>
      </Section>

      <Section title="Where mail comes from">
        <Row label="Sender" hint="Reminder emails are sent through Resend by the fs-notify function.">
          <span className="text-sm">Resend · fs-notify</span>
        </Row>
        <Row label="Reply-to" hint="Set the support address under Organisation so respondents can reach a human.">
          {orgSettings?.support_email
            ? <Badge variant="outline" data-tone="draft">{orgSettings.support_email}</Badge>
            : (
              <div className="flex items-center gap-2">
                <Badge variant="outline" data-tone="closed">not set</Badge>
                <Button asChild variant="ghost" size="sm"><Link href="/settings/organization">Set it</Link></Button>
              </div>
            )}
        </Row>
        <Row label="Organisation">
          <span className="text-sm">{org?.name || "—"}</span>
        </Row>
      </Section>
    </SettingsPage>
  );
}
