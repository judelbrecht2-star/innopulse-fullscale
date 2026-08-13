"use client";
/* Security — password and TOTP two-factor.
   Moved verbatim in behaviour from the old /account page, with the MFA policy
   from fs_org_settings.require_mfa_roles now driving the prompt rather than a
   hard-coded owner/manager check. Enforcement is still soft (this banner):
   Supabase AAL2 is not yet required server-side, which is a known gap and is
   stated here rather than implied. */
import { useCallback, useEffect, useState } from "react";
import { sb } from "../../../lib/supabase";
import { useSettings } from "../context";
import { ErrorNote, LoadingCard, Row, SaveBar, Section, SettingsPage, useSave } from "../parts";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import { Alert, AlertDescription } from "@/components/ui/alert";
import { Badge } from "@/components/ui/badge";
import { Check, WarningTriangle } from "iconoir-react";

export default function SecuritySettings() {
  const { user, role, orgSettings, loading, err } = useSettings();
  const [pw1, setPw1] = useState("");
  const [pw2, setPw2] = useState("");
  const [pwState, savePw] = useSave();

  const [factors, setFactors] = useState(null);
  const [enroll, setEnroll] = useState(null); // { factorId, qr, secret }
  const [code, setCode] = useState("");
  const [mfaErr, setMfaErr] = useState("");
  const [mfaMsg, setMfaMsg] = useState("");
  const [mfaBusy, setMfaBusy] = useState(false);

  const loadFactors = useCallback(async () => {
    try { const { data } = await sb().auth.mfa.listFactors(); setFactors(data?.totp || []); }
    catch { setFactors([]); }
  }, []);

  useEffect(() => { if (user) loadFactors(); }, [user, loadFactors]);

  if (loading) return <LoadingCard rows={3} />;
  if (err) return <ErrorNote>{err}</ErrorNote>;

  const enabled = !!factors?.some((f) => f.status === "verified");
  const requiredRoles = orgSettings?.require_mfa_roles || [];
  const mfaRequired = requiredRoles.includes(role);

  const onSavePassword = () => savePw(async () => {
    if (pw1.length < 10) throw new Error("Use at least 10 characters.");
    if (pw1 !== pw2) throw new Error("Passwords don't match.");
    const { error } = await sb().auth.updateUser({ password: pw1 });
    if (error) throw error;
    setPw1(""); setPw2("");
  });

  async function startEnroll() {
    setMfaErr(""); setMfaMsg(""); setMfaBusy(true);
    const { data, error } = await sb().auth.mfa.enroll({ factorType: "totp", friendlyName: "Authenticator app" });
    setMfaBusy(false);
    if (error) { setMfaErr(error.message); return; }
    setEnroll({ factorId: data.id, qr: data.totp.qr_code, secret: data.totp.secret });
  }

  async function confirmEnroll() {
    setMfaErr(""); setMfaBusy(true);
    try {
      const { data: ch, error: e1 } = await sb().auth.mfa.challenge({ factorId: enroll.factorId });
      if (e1) throw e1;
      const { error: e2 } = await sb().auth.mfa.verify({ factorId: enroll.factorId, challengeId: ch.id, code: code.trim() });
      if (e2) throw e2;
      setEnroll(null); setCode("");
      setMfaMsg("Two-factor authentication is on — you'll be asked for a code at every sign-in.");
      await loadFactors();
    } catch (ex) { setMfaErr(ex.message || "Invalid code — try again."); }
    setMfaBusy(false);
  }

  async function removeFactor(id) {
    setMfaErr(""); setMfaMsg(""); setMfaBusy(true);
    const { error } = await sb().auth.mfa.unenroll({ factorId: id });
    if (error) setMfaErr(error.message); else setMfaMsg("Two-factor authentication removed.");
    await loadFactors();
    setMfaBusy(false);
  }

  return (
    <SettingsPage title="Security" description="How you prove it's you.">
      <Section
        title="Two-factor authentication"
        description="A 6-digit code from an authenticator app, in addition to your password."
      >
        {mfaRequired && !enabled ? (
          <Alert variant="destructive">
            <WarningTriangle width={16} height={16} />
            <AlertDescription>
              Your organisation requires two-factor authentication for the <b>{role}</b> role. Please enable it now.
            </AlertDescription>
          </Alert>
        ) : null}
        {mfaErr ? <ErrorNote>{mfaErr}</ErrorNote> : null}
        {mfaMsg ? (
          <Alert><Check width={16} height={16} /><AlertDescription>{mfaMsg}</AlertDescription></Alert>
        ) : null}

        {factors === null ? (
          <p className="text-sm text-muted-foreground">Loading…</p>
        ) : enabled ? (
          <div className="flex flex-col gap-3">
            <div className="flex items-center gap-2 text-sm">
              <Badge variant="secondary" data-tone="open">Enabled</Badge>
              A code from your authenticator app is required at sign-in.
            </div>
            {factors.filter((f) => f.status === "verified").map((f) => (
              <div key={f.id} className="flex items-center gap-3 text-sm text-muted-foreground">
                <span>{f.friendly_name || "Authenticator"} · added {new Date(f.created_at).toLocaleDateString()}</span>
                <Button variant="ghost" size="sm" disabled={mfaBusy} onClick={() => removeFactor(f.id)}>Remove</Button>
              </div>
            ))}
          </div>
        ) : enroll ? (
          <div className="flex flex-col gap-3">
            <p className="text-sm">
              Scan this with Google Authenticator, Microsoft Authenticator or 1Password, then enter the 6-digit code.
            </p>
            {/* eslint-disable-next-line @next/next/no-img-element */}
            <img src={enroll.qr} alt="Two-factor enrolment QR code" width={180} height={180}
              className="rounded-lg bg-white p-2" style={{ width: 180, height: 180 }} />
            <p className="text-xs text-muted-foreground">Can&apos;t scan? Manual key: <code className="text-xs">{enroll.secret}</code></p>
            <div className="flex max-w-xs gap-2">
              <Input inputMode="numeric" value={code} onChange={(e) => setCode(e.target.value)} placeholder="123456" />
              <Button size="sm" disabled={mfaBusy} onClick={confirmEnroll}>Activate</Button>
              <Button size="sm" variant="ghost" disabled={mfaBusy} onClick={() => { setEnroll(null); setCode(""); }}>Cancel</Button>
            </div>
          </div>
        ) : (
          <div className="flex flex-col items-start gap-3">
            <p className="text-sm text-muted-foreground">
              Strongly recommended for any role that can reach respondent data.
            </p>
            <Button size="sm" disabled={mfaBusy} onClick={startEnroll}>Enable two-factor authentication</Button>
          </div>
        )}
      </Section>

      <Section
        title="Password"
        description={`Signed in as ${user?.email || ""}. If you were given a temporary password, change it now.`}
        footer={<SaveBar onSave={onSavePassword} state={pwState} label="Change password" disabled={!pw1 && !pw2} />}
      >
        <Row label="New password" htmlFor="pw1" hint="At least 10 characters.">
          <Input id="pw1" type="password" value={pw1} onChange={(e) => setPw1(e.target.value)} autoComplete="new-password" className="max-w-sm" />
        </Row>
        <Row label="Repeat new password" htmlFor="pw2">
          <Input id="pw2" type="password" value={pw2} onChange={(e) => setPw2(e.target.value)} autoComplete="new-password" className="max-w-sm" />
        </Row>
      </Section>

      <Section title="Sessions">
        <p className="text-sm text-muted-foreground">
          Signing out everywhere ends every session on every device, including this one.
        </p>
        <div>
          <Button variant="outline" size="sm"
            onClick={async () => { await sb().auth.signOut({ scope: "global" }); window.location.href = "/login"; }}>
            Sign out of all devices
          </Button>
        </div>
      </Section>
    </SettingsPage>
  );
}
