"use client";
/* Audit log — who did what, from fs_audit.
   RLS restricts SELECT to owners and managers, so this page does no gating of
   its own beyond hiding itself from the nav. Actor UUIDs are resolved to emails
   through fs-admin (auth emails are not readable from the browser); anyone the
   lookup can't resolve stays a UUID rather than being guessed at.

   Actions are written as `verb` or `verb:detail` strings by the edge functions
   and by the settings pages. They are rendered here as-is, with a plain-English
   gloss where one exists — never rewritten, so the log and the screen agree. */
import { useCallback, useEffect, useMemo, useState } from "react";
import { sb, FN_BASE } from "../../../lib/supabase";
import { useSettings } from "../context";
import { ErrorNote, LoadingCard, Note, Section, SettingsPage } from "../parts";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Input } from "@/components/ui/input";
import { NativeSelect, NativeSelectOption } from "@/components/ui/native-select";

const PAGE = 100;

const GLOSS = {
  "response.viewed": "Opened an individual response",
  "comment.report_add": "Marked a comment for the report",
  "comment.report_remove": "Removed a comment from the report",
  "campaign.create": "Created a campaign",
  "member.invite": "Invited a teammate",
  "member.remove": "Removed a teammate",
  "member.role": "Changed a teammate's role",
  "org.profile.update": "Changed organisation details",
  "org.privacy.update": "Changed privacy settings",
  "org.defaults.update": "Changed campaign defaults",
  "link.rotate": "Rotated a respondent link",
  "report.generate": "Generated a report",
};

/* Anything that touches an individual respondent gets visual weight — these are
   the entries a privacy review actually cares about. */
const SENSITIVE = ["response.viewed", "comment."];

function gloss(action) {
  const base = String(action).split(":")[0];
  return GLOSS[base] || GLOSS[action] || base;
}
function detailOf(action) {
  const parts = String(action).split(":");
  return parts.length > 1 ? parts.slice(1).join(" · ") : "";
}
function isSensitive(action) {
  return SENSITIVE.some((s) => String(action).startsWith(s));
}

export default function AuditSettings() {
  const { org, canManage, loading, err } = useSettings();
  const [rows, setRows] = useState(null);
  const [emails, setEmails] = useState({});
  const [more, setMore] = useState(false);
  const [busy, setBusy] = useState(false);
  const [loadErr, setLoadErr] = useState("");
  const [q, setQ] = useState("");
  const [fActor, setFActor] = useState("all");
  const [fKind, setFKind] = useState("all");

  const load = useCallback(async (offset = 0) => {
    if (!org) return;
    setBusy(true); setLoadErr("");
    const { data, error } = await sb().from("fs_audit")
      .select("id, actor, action, entity, entity_id, at")
      .eq("org_id", org.id)
      .order("at", { ascending: false })
      .range(offset, offset + PAGE - 1);
    if (error) { setLoadErr(error.message); setBusy(false); return; }
    setRows((prev) => (offset === 0 ? (data || []) : [...(prev || []), ...(data || [])]));
    setMore((data || []).length === PAGE);
    setBusy(false);
  }, [org]);

  useEffect(() => { if (org && canManage) load(0); }, [org, canManage, load]);

  useEffect(() => {
    (async () => {
      if (!org || !canManage) return;
      try {
        const { data: sess } = await sb().auth.getSession();
        const r = await fetch(`${FN_BASE}/fs-admin`, {
          method: "POST",
          headers: { "Content-Type": "application/json", Authorization: `Bearer ${sess.session?.access_token}` },
          body: JSON.stringify({ action: "members", org_id: org.id }),
        });
        if (!r.ok) return;
        const j = await r.json();
        setEmails(Object.fromEntries((j.members || []).map((m) => [m.user_id, m.email || m.user_id])));
      } catch { /* names are a nicety; UUIDs still render */ }
    })();
  }, [org, canManage]);

  const kinds = useMemo(() => {
    const s = new Set((rows || []).map((r) => String(r.action).split(".")[0]));
    return [...s].sort();
  }, [rows]);

  const filtered = useMemo(() => (rows || []).filter((r) => {
    if (fActor !== "all" && r.actor !== fActor) return false;
    if (fKind !== "all" && !String(r.action).startsWith(fKind + ".")) return false;
    if (q) {
      const hay = `${r.action} ${r.entity} ${r.entity_id} ${emails[r.actor] || r.actor}`.toLowerCase();
      if (!hay.includes(q.toLowerCase())) return false;
    }
    return true;
  }), [rows, fActor, fKind, q, emails]);

  if (loading) return <LoadingCard rows={5} />;
  if (err) return <ErrorNote>{err}</ErrorNote>;
  if (!canManage) return <ErrorNote>Owners and managers only.</ErrorNote>;

  const actors = [...new Set((rows || []).map((r) => r.actor).filter(Boolean))];

  return (
    <SettingsPage
      title="Audit log"
      description="Every privacy-relevant action taken in this organisation, oldest retained entry to newest."
    >
      {loadErr ? <ErrorNote>{loadErr}</ErrorNote> : null}

      <Note>
        Entries are written by the server, not the browser, and cannot be edited or deleted from the app.
        Opening an individual response is always recorded, for every role.
      </Note>

      <Section className="max-w-none">
        <div className="flex flex-wrap items-center gap-2">
          <Input placeholder="Search action, entity or person" value={q} onChange={(e) => setQ(e.target.value)} className="max-w-xs" />
          <NativeSelect aria-label="Filter by person" value={fActor} onChange={(e) => setFActor(e.target.value)} className="w-56">
            <NativeSelectOption value="all">Everyone</NativeSelectOption>
            {actors.map((a) => <NativeSelectOption key={a} value={a}>{emails[a] || a.slice(0, 8)}</NativeSelectOption>)}
          </NativeSelect>
          <NativeSelect aria-label="Filter by kind" value={fKind} onChange={(e) => setFKind(e.target.value)} className="w-44">
            <NativeSelectOption value="all">All activity</NativeSelectOption>
            {kinds.map((k) => <NativeSelectOption key={k} value={k}>{k}</NativeSelectOption>)}
          </NativeSelect>
          <span className="text-sm text-muted-foreground">
            {rows === null ? "Loading…" : `${filtered.length} of ${rows.length} loaded`}
          </span>
        </div>

        {rows === null ? (
          <p className="text-sm text-muted-foreground">Loading…</p>
        ) : filtered.length === 0 ? (
          <p className="text-sm text-muted-foreground">Nothing matches those filters.</p>
        ) : (
          <div className="overflow-x-auto">
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead className="w-44">When</TableHead>
                  <TableHead>Who</TableHead>
                  <TableHead>Action</TableHead>
                  <TableHead>Record</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {filtered.map((r) => (
                  <TableRow key={r.id}>
                    <TableCell className="whitespace-nowrap text-sm text-muted-foreground">
                      {new Date(r.at).toLocaleString()}
                    </TableCell>
                    <TableCell className="text-sm">{emails[r.actor] || (r.actor ? r.actor.slice(0, 8) + "…" : "system")}</TableCell>
                    <TableCell className="text-sm">
                      <div className="flex flex-wrap items-center gap-2">
                        {isSensitive(r.action)
                          ? <Badge variant="secondary" data-tone="closed">{gloss(r.action)}</Badge>
                          : <span>{gloss(r.action)}</span>}
                        {detailOf(r.action) ? <span className="text-xs text-muted-foreground">{detailOf(r.action)}</span> : null}
                      </div>
                    </TableCell>
                    <TableCell className="text-xs text-muted-foreground">
                      {r.entity}
                      {r.entity_id ? <span className="ml-1 font-mono">{String(r.entity_id).slice(0, 8)}…</span> : null}
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          </div>
        )}

        {more ? (
          <div>
            <Button variant="outline" size="sm" disabled={busy} onClick={() => load((rows || []).length)}>
              {busy ? "Loading…" : `Load ${PAGE} more`}
            </Button>
          </div>
        ) : null}
      </Section>
    </SettingsPage>
  );
}
