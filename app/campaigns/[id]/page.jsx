"use client";
import { useCallback, useEffect, useState } from "react";
import Link from "next/link";
import { useParams, useRouter } from "next/navigation";
import { sb, FN_BASE } from "../../../lib/supabase";
import { Shell, I, bandCls, bandWord, bandOf, GROUP_META, GROUP_BAR, groupName } from "../../ui";
import { bestGaps, MIN_N } from "../../lib/gaps";
import { DEMO_DIMS } from "../../lib/demographics";
import { Button } from "@/components/ui/button";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Badge } from "@/components/ui/badge";
import { NativeSelect, NativeSelectOption } from "@/components/ui/native-select";
import { ArrowRight, Check, EditPencil, Plus, ShieldCheck } from "iconoir-react";

function randToken() {
  const b = new Uint8Array(8);
  crypto.getRandomValues(b);
  return Array.from(b, (x) => x.toString(16).padStart(2, "0")).join("");
}
function csvEsc(v) {
  const s = String(v ?? "");
  return /[",\n]/.test(s) ? '"' + s.replace(/"/g, '""') + '"' : s;
}
function downloadCsv(name, rows) {
  const csv = rows.map((r) => r.map(csvEsc).join(",")).join("\r\n");
  const blob = new Blob(["﻿" + csv], { type: "text/csv;charset=utf-8" });
  const a = document.createElement("a");
  a.href = URL.createObjectURL(blob);
  a.download = name;
  a.click();
  URL.revokeObjectURL(a.href);
}

export default function Campaign() {
  const { id } = useParams();
  const router = useRouter();
  const [user, setUser] = useState(null);
  const [role, setRole] = useState("");
  const [c, setC] = useState(null);
  const [groups, setGroups] = useState([]);
  const [links, setLinks] = useState([]);
  const [results, setResults] = useState(null);
  const [library, setLibrary] = useState([]);
  const [err, setErr] = useState("");
  const [copied, setCopied] = useState("");
  const [busy, setBusy] = useState(false);
  const [editName, setEditName] = useState("");
  const [editThreshold, setEditThreshold] = useState("");
  const [editCloses, setEditCloses] = useState("");
  const [editThanks, setEditThanks] = useState("");
  const [editClosedMsg, setEditClosedMsg] = useState("");
  const [editSegs, setEditSegs] = useState("");
  const [segList, setSegList] = useState([]);
  const [segNew, setSegNew] = useState(null); // string while typing a new segment
  const [demoOn, setDemoOn] = useState({});
  const [demoCustom, setDemoCustom] = useState({});
  const [editStatus, setEditStatus] = useState("");
  const [saved, setSaved] = useState(false);
  const [qr, setQr] = useState(null);
  const [uniqGroup, setUniqGroup] = useState("");
  const [uniqCount, setUniqCount] = useState("5");
  const [addName, setAddName] = useState(null);
  const [tEdit, setTEdit] = useState(null); // { gid, val } while editing a group target

  const load = useCallback(async () => {
    const { data: u } = await sb().auth.getUser();
    if (!u.user) { router.replace("/login"); return; }
    setUser(u.user);
    const { data: camp, error: e1 } = await sb().from("fs_campaigns")
      .select("id, org_id, name, status, opens_at, closes_at, anonymity_threshold, thankyou_message, closed_message, segments, demographics").eq("id", id).maybeSingle();
    if (e1 || !camp) { setErr(e1 ? e1.message : "Campaign not found (or you don't have access)."); return; }
    // F8: resolve the caller's OWN role in THIS campaign's org
    const { data: mem } = await sb().from("fs_memberships").select("role")
      .eq("org_id", camp.org_id).eq("user_id", u.user.id).maybeSingle();
    setRole(mem?.role || "");
    setC(camp);
    setEditName(camp.name);
    setEditThreshold(String(camp.anonymity_threshold));
    setEditCloses(camp.closes_at ? camp.closes_at.slice(0, 10) : "");
    setEditThanks(camp.thankyou_message || "");
    setEditClosedMsg(camp.closed_message || "");
    setEditSegs((camp.segments || []).join(", "));
    setSegList(camp.segments || []);
    // Demographics config → checklist + custom option lists
    const dOn = {}; const dCustom = {};
    for (const dim of camp.demographics || []) {
      dOn[dim.id] = true;
      const std = DEMO_DIMS.find((x) => x.id === dim.id);
      if (std?.custom) dCustom[dim.id] = (dim.options || []).join(", ");
    }
    setDemoOn(dOn); setDemoCustom(dCustom);
    setEditStatus(camp.status);
    const [{ data: gs }, { data: ls }, { data: lib }] = await Promise.all([
      sb().from("fs_groups").select("id, type, label, target_n").eq("campaign_id", id),
      sb().from("fs_links").select("id, group_id, token, mode, active, used_count, max_uses").eq("campaign_id", id).order("created_at"),
      sb().from("fs_interventions").select("*"),
    ]);
    setGroups(gs || []); setLinks(ls || []); setLibrary(lib || []);
    if (!uniqGroup && gs && gs.length) setUniqGroup(gs[0].id);
    const { data: sess } = await sb().auth.getSession();
    const jwt = sess.session?.access_token;
    if (jwt) {
      try {
        const r = await fetch(`${FN_BASE}/fs-results?campaign_id=${id}&detail=1`, { headers: { Authorization: `Bearer ${jwt}` } });
        if (r.ok) setResults(await r.json());
      } catch { /* best-effort */ }
    }
  }, [id, router, uniqGroup]);

  useEffect(() => { load(); }, [load]);

  const canManage = role === "owner" || role === "manager";
  function respondUrl(token) { return `${window.location.origin}/respond/${token}`; }
  async function copy(token) {
    try { await navigator.clipboard.writeText(respondUrl(token)); setCopied(token); setTimeout(() => setCopied(""), 1600); } catch {}
  }
  async function showQr(token) {
    if (qr && qr.token === token) { setQr(null); return; }
    try {
      const QRCode = (await import("qrcode")).default;
      const dataUrl = await QRCode.toDataURL(respondUrl(token), { width: 480, margin: 2, color: { dark: "#17171a", light: "#ffffff" } });
      setQr({ token, dataUrl });
    } catch { setErr("Could not generate the QR code."); }
  }
  async function setStatus(status) {
    setBusy(true);
    // launching uses the audited server transaction (stamps opens_at)
    const { error } = status === "open"
      ? await sb().rpc("fs_open_campaign", { p_camp: id })
      : await sb().from("fs_campaigns").update({ status }).eq("id", id);
    setBusy(false);
    if (error) setErr(error.message); else load();
  }
  async function saveSettings(e) {
    e.preventDefault();
    setBusy(true); setSaved(false);
    // Rebuild demographics config from the checklist
    const demoConf = [];
    for (const d of DEMO_DIMS) {
      if (!demoOn[d.id]) continue;
      let options = d.options;
      if (d.custom) {
        options = String(demoCustom[d.id] || "").split(",").map((s) => s.trim()).filter(Boolean).slice(0, 20);
        if (d.id === "language" && options.length === 0) options = d.options;
        if (options.length < 2) { setBusy(false); setErr(`"${d.label}": list at least 2 options (comma-separated).`); return; }
      }
      demoConf.push({ id: d.id, label: d.label, question: d.question, options });
    }
    const upd = {
      name: editName.trim() || c.name,
      anonymity_threshold: Math.max(4, Number(editThreshold || 5)),
      thankyou_message: editThanks.trim() || null,
      closed_message: editClosedMsg.trim() || null,
      segments: segList.length ? segList.slice(0, 30) : null,
      demographics: demoConf.length ? demoConf : null,
    };
    if (editCloses) upd.closes_at = new Date(editCloses + "T23:59:59").toISOString();
    const { error } = await sb().from("fs_campaigns").update(upd).eq("id", id);
    let e2 = null;
    if (!error && editStatus && editStatus !== c.status) {
      const r = editStatus === "open"
        ? await sb().rpc("fs_open_campaign", { p_camp: id })
        : await sb().from("fs_campaigns").update({ status: editStatus }).eq("id", id);
      e2 = r.error;
    }
    setBusy(false);
    if (error || e2) setErr((error || e2).message);
    else { setSaved(true); setTimeout(() => setSaved(false), 2000); load(); }
  }
  async function deactivateLink(linkId) {
    setBusy(true);
    const { error } = await sb().from("fs_links").update({ active: false }).eq("id", linkId);
    setBusy(false);
    if (error) setErr(error.message); else load();
  }
  async function regenerateLink(groupId) {
    setBusy(true);
    const { error } = await sb().from("fs_links").insert({ campaign_id: id, group_id: groupId, token: randToken(), mode: "group" });
    setBusy(false);
    if (error) setErr(error.message); else load();
  }
  async function saveTarget() {
    if (!tEdit) return;
    const val = Math.max(0, Number(tEdit.val || 0));
    setBusy(true);
    const { error } = await sb().from("fs_groups").update({ target_n: val }).eq("id", tEdit.gid);
    setBusy(false); setTEdit(null);
    if (error) setErr(error.message); else load();
  }
  async function addGroup() {
    const name = (addName || "").trim();
    if (!name) { setAddName(null); return; }
    setBusy(true);
    const { data: g, error } = await sb().from("fs_groups")
      .insert({ campaign_id: id, type: "other", label: name, target_n: 5 }).select("id").single();
    if (!error && g) {
      await sb().from("fs_links").insert({ campaign_id: id, group_id: g.id, token: randToken(), mode: "group" });
    }
    if (error) setErr(error.message);
    setAddName(null); setBusy(false); load();
  }
  async function generateUnique() {
    const n = Math.min(50, Math.max(1, Number(uniqCount || 5)));
    if (!uniqGroup) return;
    setBusy(true);
    const rows = Array.from({ length: n }, () => ({ campaign_id: id, group_id: uniqGroup, token: randToken(), mode: "unique", max_uses: 1 }));
    const { error } = await sb().from("fs_links").insert(rows);
    setBusy(false);
    if (error) setErr(error.message); else load();
  }
  function exportSummary() {
    if (!results) return;
    const pillars = results.pillars || [];
    const rows = [["Campaign", results.campaign.name], ["Organisation", results.org?.name || ""],
      ["Status", results.campaign.status], ["Anonymity threshold", results.campaign.anonymity_threshold], [],
      ["Group", "Responses", "Target", ...pillars.map((p) => p.short), "Don't know / N-A %"]];
    for (const g of results.groups || []) {
      if (g.suppressed) rows.push([GROUP_META[g.type]?.label || g.type, g.n, g.target_n, `suppressed (below ${results.campaign.anonymity_threshold})`]);
      else rows.push([GROUP_META[g.type]?.label || g.type, g.n, g.target_n, ...pillars.map((p) => g.pillars[p.id] ?? ""), g.dkna_pct]);
    }
    if (results.overall && !results.overall.suppressed) {
      rows.push(["All groups", results.overall.n, "", ...pillars.map((p) => results.overall.pillars[p.id] ?? ""), ""]);
      rows.push([], ["Overall weighted score", results.overall.score ?? ""]);
    }
    downloadCsv(`${results.campaign.name.replace(/[^\w]+/g, "-")}-results.csv`, rows);
  }
  async function exportQuestions() {
    const { data: sess } = await sb().auth.getSession();
    const jwt = sess.session?.access_token;
    if (!jwt) return;
    const r = await fetch(`${FN_BASE}/fs-results?campaign_id=${id}&detail=1`, { headers: { Authorization: `Bearer ${jwt}` } });
    if (!r.ok) { setErr("Could not load question detail."); return; }
    const d = await r.json();
    const types = (d.groups || []).filter((g) => !g.suppressed).map((g) => g.type);
    const head = ["Pillar", "Question"];
    for (const t of types) head.push(`${GROUP_META[t]?.label || t} mean`, `${GROUP_META[t]?.label || t} n`, `${GROUP_META[t]?.label || t} DK/NA`);
    const rows = [head];
    for (const q of d.questions || []) {
      const row = [q.pillar_short || q.pillar, q.text];
      for (const t of types) {
        const e = q.groups[t] || {};
        row.push(e.mean ?? "", e.n_scored ?? 0, e.n_dkna ?? 0);
      }
      rows.push(row);
    }
    downloadCsv(`${d.campaign.name.replace(/[^\w]+/g, "-")}-questions.csv`, rows);
  }

  if (err && !c) return (<Shell active="campaigns" user={user}><div className="err">{err}</div></Shell>);
  if (!c) return (<Shell active="campaigns" user={user}><p className="muted">Loading…</p></Shell>);

  const linkByGroup = {};
  for (const l of links) if (l.mode === "group" && l.active && !linkByGroup[l.group_id]) linkByGroup[l.group_id] = l;
  const inactiveCount = links.filter((l) => !l.active).length;
  const activeCount = links.filter((l) => l.active).length;
  const uniqueLinks = links.filter((l) => l.mode === "unique");
  const groupById = {};
  for (const g of groups) groupById[g.id] = g;
  const resByGroup = {};
  if (results?.groups) for (const g of results.groups) resByGroup[g.id] = g;
  const pillars = results?.pillars || [];
  const totalN = (results?.groups || []).reduce((s, g) => s + (g.n || 0), 0);
  const totalTarget = groups.reduce((s, g) => s + (g.target_n || 0), 0);
  const completion = totalTarget ? Math.round((totalN / totalTarget) * 100) : 0;

  return (
    <Shell active="campaigns" user={user}>
      <div className="crumbs"><Link href="/campaigns">Campaigns</Link> / <b>{c.name}</b></div>
      <div className="pagehead">
        <div>
          <h1>Campaign links</h1>
          <p className="lead">
            Each stakeholder group has its own signed link — the URL carries only a random
            token, so respondents can&apos;t change which group they answer for.
          </p>
        </div>
        {canManage ? (
          <a className="btn btn-primary" href="#invites"><I.plus style={{ width: 16, height: 16, stroke: "#fff" }} /> Generate link</a>
        ) : null}
      </div>
      {err ? <div className="err">{err}</div> : null}

      <div className="stats">
        <div className="stat"><span className="ic c-red"><I.link /></span><div><div className="k">Active links</div><div className="v">{activeCount}</div></div></div>
        <div className="stat"><span className="ic c-teal"><I.people /></span><div><div className="k">Responses</div><div className="v">{totalN} <span>/ {totalTarget || "—"}</span></div></div></div>
        <div className="stat"><span className="ic c-amber"><I.pie /></span><div><div className="k">Completion</div><div className="v">{completion}%</div></div></div>
        <div className="stat"><span className="ic c-grey"><I.unlink /></span><div><div className="k">Deactivated</div><div className="v">{inactiveCount}</div></div></div>
      </div>

      <div className="card">
        <Table>
          <TableHeader><TableRow><TableHead>Group</TableHead><TableHead>Status</TableHead><TableHead>Signed link</TableHead><TableHead>Responses</TableHead><TableHead>Completion</TableHead><TableHead style={{ textAlign: "right" }}>Actions</TableHead></TableRow></TableHeader>
          <TableBody>
            {groups.map((g) => {
              const meta = GROUP_META[g.type] || { label: g.type, chip: "c-grey", icon: "people" };
              const Icon = I[meta.icon] || I.people;
              const l = linkByGroup[g.id];
              const r = resByGroup[g.id];
              const n = r?.n || 0;
              const pct = g.target_n ? Math.min(100, Math.round((n / g.target_n) * 100)) : 0;
              return (
                <TableRow key={g.id}>
                  <TableCell>
                    <div className="gname">
                      <span className={"chip " + meta.chip}><Icon /></span>
                      <span><div className="nm">{groupName(g)}</div>{groupName(g) !== g.label ? <div className="sub">{g.label}</div> : null}</span>
                    </div>
                  </TableCell>
                  <TableCell>{l ? <Badge variant="secondary" data-tone="open">Active</Badge> : <Badge variant="outline" data-tone="closed">No link</Badge>}</TableCell>
                  <TableCell>
                    {l ? (
                      <span className="codebox">/respond/{l.token}
                        <button title="Copy link" onClick={() => copy(l.token)}><I.copy /></button>
                      </span>
                    ) : <span className="small muted">—</span>}
                  </TableCell>
                  <TableCell style={{ whiteSpace: "nowrap" }}>
                    <b>{n}</b>{" "}
                    {tEdit?.gid === g.id ? (
                      <span style={{ display: "inline-flex", gap: 4, alignItems: "center" }}>
                        <span className="small muted">/</span>
                        <Input type="text" inputMode="numeric" autoFocus value={tEdit.val}
                          onChange={(e) => setTEdit({ gid: g.id, val: e.target.value.replace(/\D/g, "") })}
                          onKeyDown={(e) => { if (e.key === "Enter") { e.preventDefault(); saveTarget(); } if (e.key === "Escape") setTEdit(null); }}
                          onBlur={saveTarget}
                          style={{ width: 56, padding: "3px 7px", fontSize: 13 }} />
                      </span>
                    ) : canManage ? (
                      <button type="button" className="small muted" title="Edit the target number of people for this group"
                        onClick={() => setTEdit({ gid: g.id, val: String(g.target_n ?? "") })}
                        style={{ background: "none", border: "none", cursor: "pointer", padding: 0, textDecoration: "underline dotted", color: "var(--muted)" }}>
                        / {g.target_n || "—"} <EditPencil className="inline size-4 -mt-0.5" />
                      </button>
                    ) : (
                      <span className="small muted">/ {g.target_n || "—"}</span>
                    )}
                  </TableCell>
                  <TableCell>
                    <div className="cbar">
                      <div className="track"><div className="fill" style={{ width: pct + "%", background: GROUP_BAR[g.type] || "var(--primary)" }} /></div>
                      <span className="pct">{pct}%</span>
                    </div>
                  </TableCell>
                  <TableCell style={{ textAlign: "right", whiteSpace: "nowrap" }}>
                    {l ? (
                      <span style={{ display: "inline-flex", gap: 8, alignItems: "center" }}>
                        <Button variant="outline" size="sm" onClick={() => copy(l.token)}>
                          {copied === l.token ? <>Copied <Check className="inline size-4 -mt-0.5" /></> : "Copy link"}
                        </Button>
                        <button className="iconbtn" title="QR code" onClick={() => showQr(l.token)}><I.qr /></button>
                        {canManage ? (
                          <details className="rowmenu">
                            <summary className="iconbtn" style={{ fontWeight: 800 }}>⋯</summary>
                            <div className="dd">
                              <button disabled={busy} onClick={() => deactivateLink(l.id)}>Deactivate link</button>
                              <button disabled={busy} onClick={() => regenerateLink(g.id)}>Issue new link</button>
                            </div>
                          </details>
                        ) : null}
                      </span>
                    ) : canManage ? (
                      <Button size="sm" disabled={busy} onClick={() => regenerateLink(g.id)}>New link</Button>
                    ) : null}
                  </TableCell>
                </TableRow>
              );
            })}
          </TableBody>
        </Table>
        {canManage ? (
          <div style={{ marginTop: 12 }}>
            {addName === null ? (
              <Button variant="ghost" size="sm" onClick={() => setAddName("")}>+ Add stakeholder group</Button>
            ) : (
              <span style={{ display: "flex", gap: 8, maxWidth: 480 }}>
                <Input type="text" value={addName} onChange={(e) => setAddName(e.target.value)}
                  placeholder="Type the stakeholder name, e.g. Board members" autoFocus />
                <Button size="sm" disabled={busy} onClick={addGroup}>Add</Button>
                <Button variant="ghost" size="sm" onClick={() => setAddName(null)}>Cancel</Button>
              </span>
            )}
            <div className="small muted" style={{ marginTop: 6 }}>
              Custom groups answer the outward-facing question set and get their own signed link immediately.
            </div>
          </div>
        ) : null}
        {qr ? (
          <div style={{ marginTop: 14, textAlign: "center", padding: 16, border: "1px solid var(--line)", borderRadius: 12 }}>
            {/* eslint-disable-next-line @next/next/no-img-element */}
            <img src={qr.dataUrl} alt="QR code for the campaign link" style={{ width: 240, height: 240 }} />
            <p className="small muted" style={{ margin: "8px 0 10px" }}>
              Scan to open <span className="codebox" style={{ padding: "3px 8px" }}>/respond/{qr.token}</span>
            </p>
            <a className="btn btn-ghost btn-sm" href={qr.dataUrl} download={`innopulse-qr-${qr.token}.png`}>Download PNG</a>
          </div>
        ) : null}
        {inactiveCount ? (
          <div className="infoline"><I.info />
            {inactiveCount} deactivated link{inactiveCount === 1 ? "" : "s"} — old URLs now show &quot;link deactivated&quot; to respondents.
          </div>
        ) : null}
      </div>

      <div style={{ display: "flex", gap: 8, flexWrap: "wrap", margin: "0 0 18px" }}>
        {canManage ? (c.status !== "open" ? (
          <Button size="sm" disabled={busy} onClick={() => setStatus("open")}>Open collection</Button>
        ) : (
          <Button variant="ghost" size="sm" disabled={busy} onClick={() => setStatus("closed")}>Close collection</Button>
        )) : null}
        <Button variant="ghost" size="sm" onClick={exportSummary} disabled={!results}>⬇ Results CSV</Button>
        <Button variant="ghost" size="sm" onClick={exportQuestions} disabled={!results}>⬇ Question detail CSV</Button>
        <Link className="btn btn-ghost btn-sm" href={`/campaigns/${id}/report`}>Report view (print / PDF)</Link>
      </div>

      {canManage ? (
        <div className="card" id="invites">
          <h2>Unique invitation links</h2>
          <p className="small muted">
            Single-use links track completion per invitee without connecting identities to
            answers. Each link dies after one submission.
          </p>
          <div style={{ display: "flex", gap: 10, alignItems: "center", flexWrap: "wrap", marginBottom: 10 }}>
            <NativeSelect value={uniqGroup} onChange={(e) => setUniqGroup(e.target.value)} style={{ width: "auto" }}>
              {groups.map((g) => <NativeSelectOption key={g.id} value={g.id}>{groupName(g)}</NativeSelectOption>)}
            </NativeSelect>
            <Input type="text" inputMode="numeric" value={uniqCount}
              onChange={(e) => setUniqCount(e.target.value.replace(/\D/g, ""))} style={{ width: 70 }} />
            <Button size="sm" disabled={busy} onClick={generateUnique}>Generate</Button>
          </div>
          {uniqueLinks.length === 0 ? <p className="muted small">None yet.</p> : (
            <Table>
              <TableHeader><TableRow><TableHead>Group</TableHead><TableHead>Link</TableHead><TableHead>Status</TableHead><TableHead></TableHead></TableRow></TableHeader>
              <TableBody>
                {uniqueLinks.map((l) => {
                  const used = l.used_count >= (l.max_uses || 1) || !l.active;
                  return (
                    <TableRow key={l.id}>
                      <TableCell className="small">{groupName(groupById[l.group_id]) || "—"}</TableCell>
                      <TableCell><span className="codebox">/respond/{l.token}</span></TableCell>
                      <TableCell><span className={"pill " + (used ? "closed" : "open")}>{used ? "used" : "unused"}</span></TableCell>
                      <TableCell style={{ textAlign: "right" }}>{!used ? (
                        <Button variant="ghost" size="sm" onClick={() => copy(l.token)}>
                          {copied === l.token ? "Copied ✓" : "Copy"}
                        </Button>
                      ) : null}</TableCell>
                    </TableRow>
                  );
                })}
              </TableBody>
            </Table>
          )}
        </div>
      ) : null}

      <div className="card" style={{ display: "flex", justifyContent: "space-between", alignItems: "center", flexWrap: "wrap", gap: 10 }}>
        <div>
          <h2 style={{ margin: "0 0 4px" }}>Results &amp; analysis</h2>
          <p className="small muted" style={{ margin: 0 }}>
            {results && results.overall && !results.overall.suppressed
              ? <>Overall <b>{results.overall.score}</b> from {results.overall.n} responses — scores, perception gaps and automatic findings live on Insights.</>
              : "Scores, perception gaps and automatic findings live on Insights once enough responses are in."}
          </p>
        </div>
        <div style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>
          <Link className="btn btn-primary btn-sm" href="/insights">Open Insights <ArrowRight className="inline size-4 -mt-0.5" /></Link>
          <Link className="btn btn-ghost btn-sm" href="/insights/interventions">Interventions <ArrowRight className="inline size-4 -mt-0.5" /></Link>
        </div>
      </div>

      {canManage ? (
        <div className="card" style={{ maxWidth: 860, padding: 0, overflow: "hidden" }}>
          <form onSubmit={saveSettings}>
            <div style={{ padding: "22px 26px 6px" }}>
              <div style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-start", gap: 12, flexWrap: "wrap" }}>
                <div>
                  <h2 style={{ margin: 0 }}>Campaign settings</h2>
                  <p className="small muted" style={{ margin: "4px 0 0" }}>Manage the campaign window, privacy controls and respondent experience.</p>
                </div>
                <span className={"pill " + (c.status === "open" ? "open" : c.status === "draft" ? "draft" : "closed")}>
                  ● {c.status === "open" ? "Open campaign" : c.status === "draft" ? "Draft" : c.status.charAt(0).toUpperCase() + c.status.slice(1)}
                </span>
              </div>

              {/* 1 — Campaign details */}
              <div style={{ display: "flex", alignItems: "center", gap: 10, margin: "20px 0 8px" }}>
                <span className="numchip sm">1</span><h2 style={{ margin: 0, fontSize: 16.5 }}>Campaign details</h2>
              </div>
              <label className="f">Campaign name</label>
              <Input type="text" value={editName} onChange={(e) => setEditName(e.target.value)} />
              <div className="grid2" style={{ marginTop: 4 }}>
                <div>
                  <label className="f">Closes on</label>
                  <Input type="date" value={editCloses} onChange={(e) => setEditCloses(e.target.value)} />
                </div>
                <div>
                  <label className="f">Campaign status</label>
                  <NativeSelect value={editStatus} onChange={(e) => setEditStatus(e.target.value)}>
                    <NativeSelectOption value="draft">Draft</NativeSelectOption>
                    <NativeSelectOption value="open">Open</NativeSelectOption>
                    <NativeSelectOption value="closed">Closed</NativeSelectOption>
                    <NativeSelectOption value="archived">Archived</NativeSelectOption>
                  </NativeSelect>
                  <p className="small muted" style={{ margin: "5px 0 0" }}>
                    {editStatus === "open" ? "Responses are currently being accepted."
                      : editStatus === "draft" ? "Nothing is collected until you open the campaign."
                        : editStatus === "closed" ? "Collection is closed — results and reporting stay available."
                          : "Hidden from the active campaign list."}
                  </p>
                </div>
              </div>

              {/* 2 — Privacy & segmentation */}
              <div style={{ borderTop: "1px solid var(--line)", margin: "18px 0 0" }} />
              <div style={{ display: "flex", alignItems: "center", gap: 10, margin: "18px 0 8px" }}>
                <span className="numchip sm">2</span><h2 style={{ margin: 0, fontSize: 16.5 }}>Privacy &amp; segmentation</h2>
              </div>
              <div className="grid2">
                <div>
                  <label className="f">Anonymity threshold</label>
                  <div style={{ display: "flex", alignItems: "stretch", maxWidth: 200 }}>
                    <button type="button" className="btn btn-ghost" style={{ borderRadius: "10px 0 0 10px", padding: "0 16px" }}
                      onClick={() => setEditThreshold(String(Math.max(4, Number(editThreshold || 5) - 1)))}>−</button>
                    <Input type="text" inputMode="numeric" value={editThreshold} style={{ borderRadius: 0, textAlign: "center" }}
                      onChange={(e) => setEditThreshold(e.target.value.replace(/\D/g, ""))} />
                    <button type="button" className="btn btn-ghost" style={{ borderRadius: "0 10px 10px 0", padding: "0 16px" }}
                      onClick={() => setEditThreshold(String(Number(editThreshold || 5) + 1))}>+</button>
                  </div>
                  <p className="small muted" style={{ margin: "6px 0 0" }}>
                    <ShieldCheck className="inline size-4 -mt-0.5" /> Results for a group or segment appear only after {Math.max(4, Number(editThreshold || 5))} responses. Minimum 4.
                  </p>
                </div>
                <div>
                  <label className="f">Segments</label>
                  <p className="small muted" style={{ margin: "0 0 7px" }}>Optional departments or sites respondents can select.</p>
                  <div style={{ display: "flex", gap: 7, flexWrap: "wrap", alignItems: "center" }}>
                    {segList.map((sg) => (
                      <span key={sg} className="pill closed" style={{ display: "inline-flex", alignItems: "center", gap: 6, textTransform: "none", fontSize: 12.5 }}>
                        {sg}
                        <button type="button" onClick={() => setSegList((l) => l.filter((x) => x !== sg))}
                          style={{ background: "none", border: "none", cursor: "pointer", color: "var(--muted)", padding: 0, lineHeight: 1 }}>×</button>
                      </span>
                    ))}
                    {segNew === null ? (
                      <button type="button" onClick={() => setSegNew("")}
                        style={{ border: "1.5px dashed var(--primary)", color: "var(--primary)", background: "none", borderRadius: 9, padding: "5px 12px", fontWeight: 600, cursor: "pointer", fontSize: 12.5 }}>
                        <Plus className="inline size-4 -mt-0.5" /> Add segment
                      </button>
                    ) : (
                      <Input type="text" autoFocus value={segNew} onChange={(e) => setSegNew(e.target.value)} placeholder="Segment name"
                        style={{ width: 160, padding: "5px 10px", fontSize: 13 }}
                        onKeyDown={(e) => { if (e.key === "Enter") { e.preventDefault(); const v = segNew.trim(); if (v && !segList.includes(v)) setSegList((l) => [...l, v]); setSegNew(null); } if (e.key === "Escape") setSegNew(null); }}
                        onBlur={() => { const v = (segNew || "").trim(); if (v && !segList.includes(v)) setSegList((l) => [...l, v]); setSegNew(null); }} />
                    )}
                  </div>
                </div>
              </div>

              <div style={{ marginTop: 16 }}>
                <label className="f">Demographics recorded on the response form</label>
                <p className="small muted" style={{ margin: "0 0 8px" }}>
                  Always optional for respondents; every demographic cut is hidden below the
                  anonymity threshold. Changes apply to responses submitted from now on.
                </p>
                <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fill, minmax(240px, 1fr))", gap: "4px 16px" }}>
                  {DEMO_DIMS.map((d) => (
                    <div key={d.id}>
                      <label style={{ display: "flex", alignItems: "center", gap: 8, cursor: "pointer", padding: "4px 0" }}>
                        <input type="checkbox" checked={!!demoOn[d.id]}
                          onChange={(e) => setDemoOn((s) => ({ ...s, [d.id]: e.target.checked }))} />
                        <span className="small"><b>{d.label}</b></span>
                      </label>
                      {d.custom && demoOn[d.id] ? (
                        <Input type="text" value={demoCustom[d.id] || ""}
                          onChange={(e) => setDemoCustom((s) => ({ ...s, [d.id]: e.target.value }))}
                          placeholder={d.id === "language" ? "Empty = standard list" : (d.placeholder || "Comma-separated options")}
                          style={{ margin: "2px 0 6px 24px", width: "calc(100% - 24px)", padding: "5px 10px", fontSize: 12.5 }} />
                      ) : null}
                    </div>
                  ))}
                </div>
              </div>

              {/* 3 — Respondent experience */}
              <div style={{ borderTop: "1px solid var(--line)", margin: "18px 0 0" }} />
              <div style={{ display: "flex", alignItems: "center", gap: 10, margin: "18px 0 8px" }}>
                <span className="numchip sm">3</span><h2 style={{ margin: 0, fontSize: 16.5 }}>Respondent experience</h2>
              </div>
              <div className="grid2">
                <div>
                  <label className="f">Thank-you message <Badge variant="outline" data-tone="closed" style={{ textTransform: "none", marginLeft: 6 }}>Optional</Badge></label>
                  <Textarea maxLength={300} value={editThanks} onChange={(e) => setEditThanks(e.target.value)}
                    placeholder="Default: Your responses have been recorded anonymously." />
                  <p className="small muted" style={{ margin: "4px 0 0" }}>{editThanks.length} / 300</p>
                </div>
                <div>
                  <label className="f">Closed campaign message <Badge variant="outline" data-tone="closed" style={{ textTransform: "none", marginLeft: 6 }}>Optional</Badge></label>
                  <Textarea maxLength={300} value={editClosedMsg} onChange={(e) => setEditClosedMsg(e.target.value)}
                    placeholder="Default: This assessment is not currently open." />
                  <p className="small muted" style={{ margin: "4px 0 0" }}>{editClosedMsg.length} / 300</p>
                </div>
              </div>
            </div>

            <div style={{ background: "#fbf7ef", borderTop: "1px solid var(--line)", padding: "14px 26px", display: "flex", justifyContent: "space-between", alignItems: "center", gap: 12, flexWrap: "wrap" }}>
              <span className="small muted">Changes affect this campaign only.{saved ? <span style={{ color: "var(--green, #2f855a)", marginLeft: 10, fontWeight: 600 }}>Saved <Check className="inline size-4 -mt-0.5" /></span> : null}</span>
              <span style={{ display: "flex", gap: 10 }}>
                <button type="button" className="btn btn-ghost btn-sm" disabled={busy} onClick={() => load()}>Cancel</button>
                <Button disabled={busy}>{busy ? "Saving…" : "Save changes"}</Button>
              </span>
            </div>
          </form>
        </div>
      ) : null}
    </Shell>
  );
}

/* ---------- Perception gaps (shared questions only — audit F2/F7) ---------- */
function GapsCard({ results }) {
  if (!results) return null;
  const pillars = results.pillars || [];
  const visible = (results.groups || []).filter((g) => !g.suppressed);
  const nameOfType = (t) => groupName(visible.find((g) => g.type === t)) || t;
  if (visible.length < 2) {
    return (
      <div className="card">
        <h2>Stakeholder perception gaps</h2>
        <p className="muted small">
          Gaps appear once at least two stakeholder groups have enough responses to show.
        </p>
      </div>
    );
  }
  const gapMap = bestGaps(results.questions, pillars, visible);
  const rows = pillars.map((p) => ({ p, e: gapMap[p.id] || null }));
  const maxSpread = Math.max(0, ...rows.map((r) => r.e?.d ?? 0));
  const smallGroups = visible.filter((g) => g.n < MIN_N);
  return (
    <div className="card">
      <h2>Stakeholder perception gaps</h2>
      <p className="muted small">
        The widest gap between any two groups on each pillar, measured only on the
        questions both groups answered — so it reflects perception, not questionnaire design.
      </p>
      <Table>
        <TableHeader><TableRow><TableHead>Pillar</TableHead><TableHead>Widest gap</TableHead><TableHead>Shared Qs</TableHead><TableHead>Spread</TableHead></TableRow></TableHeader>
        <TableBody>
          {rows.map(({ p, e }) => (
            <TableRow key={p.id} style={e && e.d === maxSpread && e.d >= 15 ? { background: "#fff8ef" } : undefined}>
              <TableCell><b>{p.short}</b></TableCell>
              <TableCell>
                {e ? (
                  <>
                    <Badge variant="outline" data-tone="closed" style={{ marginRight: 6 }}>{nameOfType(e.hiType)}: <b>{e.hi}</b></Badge>
                    <Badge variant="outline" data-tone="closed">{nameOfType(e.loType)}: <b>{e.lo}</b></Badge>
                  </>
                ) : <span className="small muted">not enough shared questions</span>}
              </TableCell>
              <TableCell className="small muted">{e ? e.items : "—"}</TableCell>
              <TableCell className="score">
                {!e ? "—" : (
                  <>
                    {e.d}
                    {e.d >= 20 ? <span className="small" style={{ color: "var(--band-low)" }}> ▲ {nameOfType(e.hiType)} vs {nameOfType(e.loType)}</span> : null}
                  </>
                )}
              </TableCell>
            </TableRow>
          ))}
        </TableBody>
      </Table>
      {smallGroups.length ? (
        <p className="small muted" style={{ marginTop: 8 }}>
          ⚠ Small samples ({smallGroups.map((g) => `${groupName(g)} n=${g.n}`).join(", ")}) — treat
          gaps as indicative until groups reach {MIN_N}+ responses.
        </p>
      ) : null}
    </div>
  );
}

/* ---------- Recommended interventions (engine v1 — any pair, either direction) ---------- */
function InterventionsCard({ results, library }) {
  if (!results) return null;
  const pillars = results.pillars || [];
  const overall = results.overall && !results.overall.suppressed ? results.overall : null;
  if (!overall) {
    return (
      <div className="card">
        <h2>Recommended interventions</h2>
        <p className="muted small">Recommendations appear as soon as enough responses are in.</p>
      </div>
    );
  }
  const visible = (results.groups || []).filter((g) => !g.suppressed);
  const nameOfType = (t) => groupName(visible.find((g) => g.type === t)) || t;
  const gapMap = bestGaps(results.questions, pillars, visible);

  const picks = [];
  for (const p of pillars) {
    const gp = gapMap[p.id];
    if (gp) {
      const gapEntry = library.find((e) => e.trigger_type === "gap" && e.pillar === p.id && gp.d >= Number(e.gap_min || 20));
      if (gapEntry) picks.push({ entry: gapEntry, p, why: `${nameOfType(gp.hiType)} ${gp.hi} vs ${nameOfType(gp.loType)} ${gp.lo} (gap ${gp.d}, ${gp.items} shared Qs)` });
    }
  }
  const ranked = pillars
    .map((p) => ({ p, v: overall.pillars?.[p.id] }))
    .filter((x) => x.v !== null && x.v !== undefined)
    .sort((a, b) => a.v - b.v);
  for (const { p, v } of ranked.slice(0, 3)) {
    const e = library.find((x) => x.trigger_type === "band" && x.pillar === p.id && x.band === bandOf(v));
    if (e) picks.push({ entry: e, p, why: `${p.short} scored ${v} (${bandOf(v)})` });
  }

  return (
    <div className="card">
      <h2>Recommended interventions</h2>
      <p className="muted small">
        Drawn from the approved InnoPulse intervention library — triggered by this
        campaign&apos;s scores and stakeholder gaps, not generated ad hoc.
      </p>
      {picks.length === 0 ? <p className="muted">No triggers fired yet.</p> : picks.map(({ entry, p, why }, i) => (
        <details key={entry.id} open={i === 0} style={{ borderTop: "1px solid var(--line)", padding: "12px 0" }}>
          <summary style={{ cursor: "pointer", fontWeight: 700 }}>
            {p.short} · <span className={"pill " + (entry.trigger_type === "gap" ? "closed" : entry.band === "high" ? "open" : "draft")}>
              {entry.trigger_type === "gap" ? "perception gap" : entry.band}
            </span>
            <span className="small muted" style={{ marginLeft: 8 }}>{why}</span>
          </summary>
          <p className="small" style={{ margin: "10px 0 6px" }}>{entry.summary}</p>
          <ul style={{ margin: "6px 0 10px", paddingLeft: 20 }}>
            {(entry.actions || []).map((a, j) => <li key={j} className="small" style={{ marginBottom: 4 }}>{a}</li>)}
          </ul>
          <p className="small muted" style={{ margin: "4px 0" }}>
            <b>Owner:</b> {entry.owner_suggestion} · <b>Horizon:</b> {entry.horizon} ·{" "}
            <b>Effort:</b> {entry.effort} · <b>Impact:</b> {entry.impact}
          </p>
          <p className="small muted" style={{ margin: "4px 0" }}><b>Measure:</b> {entry.kpi}</p>
          <p className="small muted" style={{ margin: "4px 0" }}><b>ISO readiness:</b> {entry.iso_map}</p>
          <div style={{ marginTop: 6 }}>
            {(entry.services || []).map((s, j) => (
              <span key={j} className="pill draft" style={{ marginRight: 6 }}>{s}</span>
            ))}
          </div>
        </details>
      ))}
    </div>
  );
}
