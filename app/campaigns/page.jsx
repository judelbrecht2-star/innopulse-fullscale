"use client";
import { useCallback, useEffect, useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { sb } from "../../lib/supabase";
import { Shell, I, GROUP_META, groupName } from "../ui";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Badge } from "@/components/ui/badge";
import { NativeSelect, NativeSelectOption } from "@/components/ui/native-select";
import { ArrowRight, WarningTriangle, Rocket, Page, Group, ReportColumns, InfoCircle, WarningCircle, Search, Plus, SendMail } from "iconoir-react";
import { activeMembership } from "../lib/org";
import { archiveCampaign, closeCampaign, createRevisedCampaign, openCampaign, readiness } from "../lib/lifecycle";

/* Respondent tokens are minted server-side by fs_create_campaign,
   fs_rotate_link and fs_create_revised_campaign. The browser used to generate
   them here for duplicated campaigns; it no longer creates campaigns at all. */
function ago(ts) {
  const m = Math.round((Date.now() - new Date(ts).getTime()) / 60000);
  if (m < 1) return "just now"; if (m < 60) return `${m} min ago`;
  const h = Math.round(m / 60); if (h < 24) return `${h} h ago`;
  return `${Math.round(h / 24)} d ago`;
}

export default function Campaigns() {
  const router = useRouter();
  const [user, setUser] = useState(null);
  const [role, setRole] = useState("");
  const [camps, setCamps] = useState([]);
  const [groups, setGroups] = useState([]);
  const [links, setLinks] = useState([]);
  const [resps, setResps] = useState([]);
  const [vers, setVers] = useState({});
  const [err, setErr] = useState("");
  const [busy, setBusy] = useState(false);
  const [q, setQ] = useState("");
  const [fStatus, setFStatus] = useState("active");
  const [sort, setSort] = useState("newest");

  const load = useCallback(async () => {
    const { data: u } = await sb().auth.getUser();
    if (!u.user) { router.replace("/login"); return; }
    setUser(u.user);
    const mem = await activeMembership(u.user.id); // P0-3
    setRole(mem?.role || "");
    const [{ data: cs }, { data: gs }, { data: ls }, { data: rs }, { data: vs }] = await Promise.all([
      sb().from("fs_campaigns").select("id, org_id, name, status, opens_at, closes_at, anonymity_threshold, questionnaire_version_id, created_by, created_at").order("created_at", { ascending: false }),
      sb().from("fs_groups").select("id, campaign_id, type, label, target_n"),
      sb().from("fs_links").select("id, campaign_id, mode, active"),
      sb().from("fs_responses").select("id, campaign_id, group_id, submitted_at, valid"),
      sb().from("fs_questionnaire_versions").select("id, version"),
    ]);
    setCamps(cs || []); setGroups(gs || []); setLinks(ls || []); setResps(rs || []);
    setVers(Object.fromEntries((vs || []).map((v) => [v.id, v.version])));
  }, [router]);
  useEffect(() => { load(); }, [load]);

  const canManage = role === "owner" || role === "manager";

  function stats(c) {
    const gs = groups.filter((g) => g.campaign_id === c.id);
    const ls = links.filter((l) => l.campaign_id === c.id);
    const rs = resps.filter((r) => r.campaign_id === c.id && r.valid);
    const target = gs.reduce((s, g) => s + (g.target_n || 0), 0);
    const n = rs.length;
    const covered = gs.filter((g) => rs.filter((r) => r.group_id === g.id).length >= (c.anonymity_threshold || 5)).length;
    const last = rs.length ? rs.reduce((a, b) => (a.submitted_at > b.submitted_at ? a : b)).submitted_at : null;
    const daysLeft = c.closes_at ? Math.ceil((new Date(c.closes_at) - Date.now()) / 86400000) : null;
    const scheduled = c.status === "open" && c.opens_at && new Date(c.opens_at) > new Date();
    const pct = target ? Math.round((n / target) * 100) : 0;
    const warns = [];
    if (c.status === "open") {
      if (!gs.length) warns.push("Setup incomplete — no stakeholder groups");
      else if (!ls.some((l) => l.active)) warns.push("Setup incomplete — no active links");
      else if (!target) warns.push("Setup incomplete — no participation targets");
      if (target && pct < 50 && n > 0) warns.push("Low participation");
      if (gs.length && covered === 0 && n > 0) warns.push("No group past the privacy threshold yet");
      if (daysLeft != null && daysLeft <= 7 && daysLeft >= 0) warns.push(`Closing in ${daysLeft} day${daysLeft === 1 ? "" : "s"}`);
      if (daysLeft != null && daysLeft < 0) warns.push("Past close date — still open");
      if (last && Date.now() - new Date(last).getTime() > 72 * 3600000) warns.push("No responses in 3+ days");
      if (n === 0 && !scheduled) warns.push("No responses received yet");
    }
    return { gs, n, target, pct, covered, last, daysLeft, scheduled, warns };
  }

  const enriched = camps.map((c) => ({ c, s: stats(c) }));
  const filtered = enriched.filter(({ c }) => {
    if (fStatus === "active" && c.status === "archived") return false;
    if (["draft", "open", "closed", "archived"].includes(fStatus) && c.status !== fStatus) return false;
    if (q.trim() && !(c.name + " " + (vers[c.questionnaire_version_id] || "")).toLowerCase().includes(q.trim().toLowerCase())) return false;
    return true;
  }).sort((a, b) => {
    if (sort === "closing") return (a.s.daysLeft ?? 9e9) - (b.s.daysLeft ?? 9e9);
    if (sort === "activity") return new Date(b.s.last || 0) - new Date(a.s.last || 0);
    return new Date(b.c.created_at) - new Date(a.c.created_at);
  });

  const open = enriched.filter(({ c }) => c.status === "open").length;
  const drafts = enriched.filter(({ c }) => c.status === "draft").length;
  const totalResp = enriched.reduce((s, e) => s + e.s.n, 0);
  const avgPct = (() => { const w = enriched.filter((e) => e.c.status === "open" && e.s.target); return w.length ? Math.round(w.reduce((s, e) => s + e.s.pct, 0) / w.length) : 0; })();
  const closingSoon = enriched.filter((e) => e.c.status === "open" && e.s.daysLeft != null && e.s.daysLeft <= 7 && e.s.daysLeft >= 0).length;
  const attention = enriched.filter((e) => e.s.warns.length).length;

  /* Lifecycle goes through the audited server transactions only. The database
     refuses a direct status write, so there is no fallback path to maintain. */
  async function setStatus(id, status) {
    setErr("");
    if (status === "open") {
      const check = await readiness(id);
      if (check.ok && !check.canOpen) {
        setErr("Not ready to open — " + check.blocking.map((b) => b.detail).join(" "));
        return;
      }
    }
    let reason = null;
    if (status === "closed") {
      reason = window.prompt("Closing stops collection and revokes every active link.\n\nWhy are you closing it? (recorded in the audit log)");
      if (reason === null) return;
    }
    setBusy(true);
    const r = status === "open" ? await openCampaign(id)
            : status === "closed" ? await closeCampaign(id, reason)
            : status === "archived" ? await archiveCampaign(id, reason)
            : { ok: false, error: `Unsupported transition: ${status}` };
    setBusy(false);
    if (!r.ok) setErr(r.error); else load();
  }
  /* "Next cycle" is a revised draft, created server-side. The old client-side
     version inserted a campaign with no governance row, which meant the new
     draft inherited no thresholds and could never pass the readiness check.
     fs_create_revised_campaign copies the groups and targets, and takes its
     governance from the organisation's CURRENT defaults — a new cycle is a new
     analytical contract, not a copy of the old one. */
  async function duplicate(c) {
    setBusy(true); setErr("");
    const name = c.name.replace(/\s*—\s*next cycle.*$/, "") + " — next cycle";
    const r = await createRevisedCampaign(c.id, name);
    setBusy(false);
    if (!r.ok) { setErr(r.error); return; }
    router.push(`/campaigns/${r.data}`);
  }

  const stChip = (c, s) => {
    if (c.status === "draft") return <Badge variant="outline" data-tone="draft">Draft</Badge>;
    if (c.status === "archived") return <Badge variant="outline" data-tone="closed">Archived</Badge>;
    if (c.status === "closed") return <Badge variant="outline" data-tone="closed">Closed · reporting</Badge>;
    if (s.scheduled) return <Badge variant="secondary" data-tone="teal">Scheduled</Badge>;
    return <Badge variant="secondary" data-tone="open">Open</Badge>;
  };

  const STAT = [
    { k: "Active campaigns",    v: open,      Icon: Rocket,        tone: "green" },
    { k: "Drafts",              v: drafts,    Icon: Page,          tone: "grey"  },
    { k: "Responses collected", v: totalResp, Icon: Group,         tone: "teal"  },
    { k: "Average completion",  v: avgPct + "%", Icon: ReportColumns, tone: "amber" },
    { k: "Closing soon",        v: closingSoon, Icon: InfoCircle,  tone: "blue"  },
    { k: "Needs attention",     v: attention, Icon: WarningCircle, tone: "red"   },
  ];

  return (
    <Shell active="campaigns" user={user}>
      <div className="crumbs cmp-crumb">Campaigns</div>
      <div className="cmp-head">
        <div>
          <h1 className="cmp-h1">Campaigns</h1>
          <p className="cmp-sub">Each campaign collects one assessment cycle across your stakeholder groups.</p>
        </div>
        {canManage ? (
          <Button asChild className="cmp-primary">
            <Link href="/campaigns/new"><Plus width={18} height={18} /> New campaign</Link>
          </Button>
        ) : null}
      </div>
      {err ? <div className="err">{err}</div> : null}

      <div className="cmp-stats">
        {STAT.map((st) => (
          <div className="cmp-stat" key={st.k}>
            <span className={"cmp-tile cmp-" + st.tone}><st.Icon width={20} height={20} /></span>
            <div>
              <div className="cmp-stat-k">{st.k}</div>
              <div className="cmp-stat-v">{st.v}</div>
            </div>
          </div>
        ))}
      </div>

      <div className="cmp-toolbar">
        <span className="cmp-search">
          <Search width={18} height={18} />
          <Input type="text" placeholder="Search campaigns" value={q} onChange={(e) => setQ(e.target.value)} aria-label="Search campaigns" />
        </span>
        <NativeSelect value={fStatus} onChange={(e) => setFStatus(e.target.value)} aria-label="Filter by status">
          <NativeSelectOption value="active">All except archived</NativeSelectOption><NativeSelectOption value="open">Open</NativeSelectOption>
          <NativeSelectOption value="draft">Draft</NativeSelectOption><NativeSelectOption value="closed">Closed</NativeSelectOption><NativeSelectOption value="archived">Archived</NativeSelectOption>
        </NativeSelect>
        <NativeSelect value={sort} onChange={(e) => setSort(e.target.value)} aria-label="Sort campaigns">
          <NativeSelectOption value="newest">Newest first</NativeSelectOption><NativeSelectOption value="closing">Closing soon</NativeSelectOption><NativeSelectOption value="activity">Recent activity</NativeSelectOption>
        </NativeSelect>
      </div>

      {!filtered.length ? (
        <div className="card"><p className="muted">No campaigns match. {canManage ? <Link href="/campaigns/new">Create one <ArrowRight className="inline size-4 -mt-0.5" /></Link> : null}</p></div>
      ) : filtered.map(({ c, s }) => (
        <div className="cmp-row" key={c.id}>
          <div className="cmp-row-top">
            <div className="cmp-row-id">
              <div className="cmp-title-line">
                <Link href={`/campaigns/${c.id}`} className="cmp-name">{c.name}</Link>
                {stChip(c, s)}
              </div>
              <p className="cmp-meta">
                InnoPulse v{(vers[c.questionnaire_version_id] || "?").replace("-draft", " (draft)")}
                {c.created_by === user?.id ? " · Owner: you" : ""}
                {" · privacy threshold "}{c.anonymity_threshold}
              </p>
            </div>
            <div className="cmp-actions">
              <Button asChild size="sm" className="cmp-primary"><Link href={`/campaigns/${c.id}`}>View campaign</Link></Button>
              <Button variant="ghost" size="sm" disabled title="Email reminders arrive with the notifications build">
                <SendMail width={16} height={16} /> Send reminders
              </Button>
              <details className="rowmenu cmp-menu">
                <summary className="cmp-dots" aria-label="More actions">···</summary>
                <div className="dd">
                  <button onClick={() => router.push(`/campaigns/${c.id}`)}>Manage links</button>
                  <button onClick={() => router.push("/responses")}>View responses</button>
                  <button onClick={() => router.push("/insights")}>View insights</button>
                  <button onClick={() => router.push(`/campaigns/${c.id}/report`)}>Export / report</button>
                  {canManage ? (
                    <>
                      {c.status === "open" ? <button disabled={busy} onClick={() => setStatus(c.id, "closed")}>Close collection</button> : null}
                      {c.status === "closed" || c.status === "draft" ? <button disabled={busy} onClick={() => setStatus(c.id, "open")}>Open collection</button> : null}
                      <button disabled={busy} onClick={() => duplicate(c)}>Duplicate for next cycle</button>
                      {c.status !== "archived"
                        ? <button disabled={busy} onClick={() => setStatus(c.id, "archived")}>Archive</button>
                        : <button disabled={busy} onClick={() => setStatus(c.id, "closed")}>Unarchive</button>}
                    </>
                  ) : null}
                </div>
              </details>
            </div>
          </div>

          <div className="cmp-metrics">
            <span className="cmp-m">
              <b>{s.n} / {s.target || "—"}</b> responses
              <span className="cmp-track"><i style={{ width: Math.min(100, s.pct) + "%", background: s.pct < 50 ? "var(--tgs-amber)" : "var(--tgs-teal)" }} /></span>
            </span>
            <span className="cmp-m cmp-stack"><b>{s.pct}%</b><small>complete</small></span>
            <span className="cmp-m cmp-stack"><b>{s.covered} / {s.gs.length}</b><small>groups past threshold</small></span>
            <span className="cmp-m cmp-chips">
              {s.gs.slice(0, 6).map((g) => (
                <span key={g.id} className={"cmp-gchip " + (GROUP_META[g.type]?.chip || "c-grey")} title={groupName(g)}>
                  {groupName(g).slice(0, 1)}
                </span>
              ))}
            </span>
            {s.daysLeft != null && c.status === "open" ? (
              <span className="cmp-m"><b>{s.daysLeft >= 0 ? s.daysLeft : 0}</b> days left</span>
            ) : null}
            <span className="cmp-m cmp-stack cmp-last">
              <small>Last response</small><span>{s.last ? ago(s.last) : "—"}</span>
            </span>
          </div>

          {s.warns.length ? (
            <div className="cmp-warn">
              <WarningTriangle width={17} height={17} />
              <span>{s.warns.join(" · ")}</span>
            </div>
          ) : null}
        </div>
      ))}
    </Shell>
  );
}
