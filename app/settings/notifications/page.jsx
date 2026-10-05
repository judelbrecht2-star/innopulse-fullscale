"use client";
import { useEffect, useState } from "react";
import Link from "next/link";
import { sb } from "../../../lib/supabase";
import { useSettings } from "../context";
import { ErrorNote, LoadingCard, Row, Section, SettingsPage } from "../parts";
import { Button } from "@/components/ui/button";
const options = [
  [
    "actions",
    "Action due dates",
    "Due and overdue alerts for actions assigned to you.",
  ],
  [
    "reports",
    "Report decisions",
    "New versions, approval requests, changes requested and issued reports.",
  ],
  [
    "closing",
    "Collection closing",
    "An update when an open assessment is within three days of closing.",
  ],
  [
    "results",
    "Results available",
    "An update when an assessment has enough responses to unlock a group’s results.",
  ],
  [
    "weekly",
    "Weekly workspace review",
    "One inbox reminder each week to review your assessments and actions.",
  ],
];
export default function NotificationSettings() {
  const { org, user, loading, err } = useSettings();
  const [prefs, setPrefs] = useState(null),
    [error, setError] = useState(""),
    [busy, setBusy] = useState(false),
    [saved, setSaved] = useState(false);
  useEffect(() => {
    if (!org || !user) return;
    let alive = true;
    setPrefs(null);
    (async () => {
      try {
        const r = await sb()
          .from("fs_notification_preferences")
          .select("*")
          .eq("org_id", org.id)
          .eq("user_id", user.id)
          .maybeSingle();
        if (r.error) throw r.error;
        if (alive)
          setPrefs(
            r.data || Object.fromEntries(options.map(([k]) => [k, true])),
          );
      } catch (ex) {
        if (alive) setError(ex.message);
      }
    })();
    return () => {
      alive = false;
    };
  }, [org, user]);
  async function save() {
    setBusy(true);
    setError("");
    setSaved(false);
    try {
      const r = await sb()
        .from("fs_notification_preferences")
        .upsert(
          {
            org_id: org.id,
            user_id: user.id,
            ...Object.fromEntries(options.map(([k]) => [k, !!prefs[k]])),
          },
          { onConflict: "user_id,org_id" },
        )
        .select("*")
        .single();
      if (r.error) throw r.error;
      setPrefs(r.data);
      setSaved(true);
    } catch (ex) {
      setError(ex.message || "Could not save preferences.");
    } finally {
      setBusy(false);
    }
  }
  if (loading) return <LoadingCard rows={4} />;
  if (err || (error && !prefs)) return <ErrorNote>{err || error}</ErrorNote>;
  if (!prefs) return <LoadingCard rows={4} />;
  return (
    <SettingsPage
      title="Notifications"
      description="Choose which updates appear in your workspace inbox."
    >
      <Section
        title="Your inbox"
        description="These preferences apply only to you in this workspace. Report updates arrive when decisions happen; due dates and milestones refresh when you open Overview or Inbox."
      >
        {options.map(([key, label, hint]) => (
          <Row key={key} label={label} hint={hint} htmlFor={`notify-${key}`}>
            <input
              id={`notify-${key}`}
              type="checkbox"
              checked={!!prefs[key]}
              disabled={busy}
              onChange={(e) => {
                setPrefs((p) => ({ ...p, [key]: e.target.checked }));
                setSaved(false);
              }}
            />
          </Row>
        ))}
        <div className="guide-controls">
          <Button disabled={busy} onClick={save}>
            {busy ? "Saving…" : "Save preferences"}
          </Button>
          {saved && <span role="status">Preferences saved</span>}
          <Link href="/notifications">Open inbox →</Link>
        </div>
        {error && <ErrorNote>{error}</ErrorNote>}
      </Section>
      <Section
        title="Email"
        description="Inbox updates do not send email. Respondent reminders and team invitations are sent when a person chooses to send them; password recovery is handled by your sign-in provider."
      >
        <p className="small muted">
          No scheduled campaign or task email is enabled. Your inbox remains
          available whenever you sign in.
        </p>
      </Section>
    </SettingsPage>
  );
}
