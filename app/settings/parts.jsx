"use client";
/* Small pieces every settings page uses. Kept here rather than repeated eight
   times: a section card, a labelled field, a save bar that reports its own
   state, and the read-only treatment for people who lack the role to edit. */
import { useCallback, useState } from "react";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Alert, AlertDescription } from "@/components/ui/alert";
import { Badge } from "@/components/ui/badge";
import { Label } from "@/components/ui/label";
import { Skeleton } from "@/components/ui/skeleton";
import { Check, InfoCircle, Lock, WarningTriangle } from "iconoir-react";

export function SettingsPage({ title, description, children }) {
  return (
    <div className="flex flex-col gap-6">
      <div>
        <h1 className="text-2xl font-semibold tracking-tight">{title}</h1>
        {description ? <p className="mt-1 max-w-2xl text-sm text-muted-foreground">{description}</p> : null}
      </div>
      {children}
    </div>
  );
}

export function Section({ title, description, children, footer, className = "" }) {
  return (
    <Card className={"max-w-3xl " + className}>
      {title ? (
        <CardHeader>
          <CardTitle className="text-base">{title}</CardTitle>
          {description ? <CardDescription>{description}</CardDescription> : null}
        </CardHeader>
      ) : null}
      <CardContent className="flex flex-col gap-4">{children}</CardContent>
      {footer ? <div className="flex items-center gap-3 border-t px-6 py-4">{footer}</div> : null}
    </Card>
  );
}

export function Row({ label, hint, htmlFor, children, source, wide = false }) {
  return (
    <div className={wide ? "flex flex-col gap-1.5" : "grid gap-1.5 sm:grid-cols-[220px_1fr] sm:items-start sm:gap-4"}>
      <Label htmlFor={htmlFor} className="pt-2 text-sm font-medium">
        {label}
        {source ? <SourceBadge source={source} /> : null}
      </Label>
      <div className="flex flex-col gap-1.5">
        {children}
        {hint ? <p className="text-xs text-muted-foreground">{hint}</p> : null}
      </div>
    </div>
  );
}

/* Where a value came from, in one word. The whole point of the settings
   redesign is that this is never a guess: `Organisation default` means new
   campaigns inherit it, `Campaign override` means this campaign diverged from
   it, `Locked` means launch froze it, `Personal` means it affects nobody else. */
const SOURCE_META = {
  org: { label: "Organisation default", tone: "draft", title: "Set once for the organisation. New campaigns inherit this value; existing campaigns keep whatever they were created with." },
  override: { label: "Campaign override", tone: "teal", title: "This campaign was changed away from the organisation default." },
  locked: { label: "Locked", tone: "closed", title: "Frozen when the campaign opened. Respondents answered under this value, so it cannot change." },
  personal: { label: "Personal", tone: "teal", title: "Yours alone. Changing it affects nothing for anyone else." },
};

export function SourceBadge({ source, className = "" }) {
  const m = SOURCE_META[source];
  if (!m) return null;
  return (
    <Badge variant="outline" data-tone={m.tone} title={m.title} className={"ml-2 align-middle font-normal " + className}>
      {m.label}
    </Badge>
  );
}

/* A save button that carries its own busy / saved / error state, so no page
   has to reinvent three booleans. */
export function SaveBar({ onSave, state, disabled, label = "Save changes", children }) {
  return (
    <>
      <Button onClick={onSave} disabled={disabled || state?.busy} size="sm">
        {state?.busy ? "Saving…" : label}
      </Button>
      {state?.saved ? (
        <span className="flex items-center gap-1.5 text-sm text-[var(--tgs-green)]"><Check width={16} height={16} /> Saved</span>
      ) : null}
      {state?.error ? (
        <span className="flex items-center gap-1.5 text-sm text-destructive"><WarningTriangle width={16} height={16} /> {state.error}</span>
      ) : null}
      {children}
    </>
  );
}

export function ReadOnlyNotice({ needs = "owner" }) {
  return (
    <Alert>
      <Lock width={16} height={16} />
      <AlertDescription>
        These settings are read-only for your role. Ask an organisation {needs} to change them.
      </AlertDescription>
    </Alert>
  );
}

export function Note({ children }) {
  return (
    <Alert>
      <InfoCircle width={16} height={16} />
      <AlertDescription>{children}</AlertDescription>
    </Alert>
  );
}

export function ErrorNote({ children }) {
  if (!children) return null;
  return (
    <Alert variant="destructive">
      <WarningTriangle width={16} height={16} />
      <AlertDescription>{children}</AlertDescription>
    </Alert>
  );
}

export function LoadingCard({ rows = 3 }) {
  return (
    <Card className="max-w-3xl">
      <CardContent className="flex flex-col gap-4 py-6">
        {Array.from({ length: rows }).map((_, i) => (
          <div key={i} className="grid gap-2 sm:grid-cols-[220px_1fr] sm:gap-4">
            <Skeleton className="h-4 w-32" />
            <Skeleton className="h-9 w-full max-w-sm" />
          </div>
        ))}
      </CardContent>
    </Card>
  );
}

/* One save-state implementation for all eight pages: busy while it runs, a
   "Saved" tick for four seconds, or the error message. `run` returns true on
   success so callers can chain a refresh. */
export function useSave() {
  const [state, setState] = useState({ busy: false, saved: false, error: "" });
  const run = useCallback(async (fn) => {
    setState({ busy: true, saved: false, error: "" });
    try {
      await fn();
      setState({ busy: false, saved: true, error: "" });
      setTimeout(() => setState((s) => (s.saved ? { ...s, saved: false } : s)), 4000);
      return true;
    } catch (e) {
      setState({ busy: false, saved: false, error: e?.message || "Could not save." });
      return false;
    }
  }, []);
  return [state, run];
}
