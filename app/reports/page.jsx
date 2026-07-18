"use client";
import { useCallback, useEffect, useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { sb, FN_BASE } from "../../lib/supabase";
import { Shell, I, groupName } from "../ui";
import { evaluateFindings } from "../lib/findings";
import { generateWordReport } from "../lib/reportgen";

const TYPES = {
  executive: { label: "Executive", pill: "violet", desc: "Board-ready web report (print / save as PDF)" },
  findings_csv: { label: "Findings", pill: "teal", desc: "Automatic findings with evidence, CSV" },
  results_csv: { label: "Results", pill: "draft", desc: "Group scores by pillar, CSV" },
  questions_csv: { label: "Questions", pill: "draft", desc: "Question-level means by group, CSV" },
};
function csvEsc(v) { const s = String(v ?? ""); return /[",\n]/.test(s) ? '"' + s.replace(/"/g, '""') + '"' : s; }
function dl(name, rows) {
  const csv = rows.map((r) => r.map(csvEsc).join(",")).join("\r\n");
  const a = document.createElement("a");
  a.href = URL.createObjectURL(new Blob(["﻿" + csv], { type: "text/csv;charset=utf-8" }));
  a.download = name; a.click();
}

export default function Reports() {
  const router = useRouter();
  const [user, setUser] = useState(null);
  const [camps, setCamps] = useState([]);
  const [reports, setReports] = useState([]);
  const [interps, setInterps] = useState([]);
  const [content, setContent] = useState({ client_context: "", engagement_objective: "" });
  const [notes, setNotes] = useState({}); // pillar -> body
  const [saved, setSaved] = useState(false);
  const [genFor, setGenFor] = useState("");
  const [q, setQ] = useState("");
  const [fCamp, setFCamp] = useState("all");
  const [err, setErr] = useState("");
  const [busy, setBusy] = useState(false);

  const load = useCallback(async () => {
    const { data: u } = await sb().auth.getUser();
    if (!u.user) { router.replace("/login"); return; }
    setUser(u.user);
    const [{ data: cs }, { data: rs }, { data: ip }] = await Promise.all([
      sb().from("fs_campaigns").select("id, name, status, created_at, client_context, engagement_objective").order("created_at", { ascending: false }),
      sb().from("fs_reports").select("*").order("created_at", { ascending: false }),
      sb().from("fs_interpretations").select("scope, band, body, version"),
    ]);
    setCamps(cs || []); setReports(rs || []); setInterps(ip || []);
    if (cs?.length) setGenFor(cs[0].id);
  }, [router]);
  useEffect(() => { load(); }, [load]);

  const campName = (id) => camps.find((c) => c.id === id)?.name || "—";
  const PILLARS = [["sii", "Strategic Innovation Intent"], ["iem", "Innovation Environment"], ["oic", "Organisational Capability"], ["ipm", "Process Management"], ["roi", "Return on Innovation"]];

  // load authored content when the selected campaign changes
  useEffect(() => {
    (async () => {
      if (!genFor) return;
      const c = camps.find((x) => x.id === genFor);
      setContent({ client_context: c?.client_context || "", engagement_objective: c?.engagement_objective || "" });
      const { data: pn } = await sb().from("fs_pillar_notes").select("pillar, body").eq("campaign_id", genFor);
      setNotes(Object.fromEntries((pn || []).map((x) => [x.pillar, x.body])));
    })();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [genFor, camps.length]);

  async function saveContent() {
    setBusy(true); setSaved(false); setErr("");
    const { error: e1 } = await sb().from("fs_campaigns").update({
      client_context: content.client_context.trim() || null,
      engagement_objective: content.engagement_objective.trim() || null,
    }).eq("id", genFor);
    let e2 = null;
    for (const [pid] of PILLARS) {
      const body = (notes[pid] || "").trim();
      const { error } = await sb().from("fs_pillar_notes").upsert(
        { campaign_id: genFor, pillar: pid, body, updated_at: new Date().toISOString() },
        { onConflict: "campaign_id,pillar" });
      if (error) e2 = error;
    }
    if (e1 || e2) setErr((e1 || e2).message); else { setSaved(true); setTimeout(() => setSaved(false), 2000); }
    setBusy(false);
  }

  async function fetchResults(cid) {
    const { data: sess } = await sb().auth.getSession();
    const r = await fetch(`${FN_BASE}/fs-results?campaign_id=${cid}&detail=1`, { headers: { Authorization: `Bearer ${sess.session?.access_token}` } });
    if (!r.ok) throw new Error("Could not load campaign results.");
    return r.json();
  }

  async function sha256(s) {
    const h = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(s));
    return Array.from(new Uint8Array(h), (b) => b.toString(16).padStart(2, "0")).join("");
  }

  // Gate 1: generation freezes a snapshot. Downloads render from the snapshot,
  // never from live data — two downloads of the same version are byte-identical.
  async function generate(rtype) {
    if (!genFor) return;
    setBusy(true); setErr("");
    try {
      const d = await fetchResults(genFor);
      const { data: sess2 } = await sb().auth.getSession();
      const [{ data: revs }, { data: pn }, vb] = await Promise.all([
        sb().from("fs_finding_reviews").select("rule_id").eq("campaign_id", genFor),
        sb().from("fs_pillar_notes").select("pillar, body").eq("campaign_id", genFor),
        fetch(`${FN_BASE}/fs-responses-ops`, {
          method: "POST",
          headers: { "Content-Type": "application/json", Authorization: `Bearer ${sess2.session?.access_token}` },
          body: JSON.stringify({ action: "report_comments", campaign_id: genFor }),
        }).then((r) => (r.ok ? r.json() : { verbatims: [] })).catch(() => ({ verbatims: [] })),
      ]);
      const approved = new Set((revs || []).map((x) => x.rule_id));
      const findings = evaluateFindings(d).filter((f) => approved.has(f.id));
      const cRow = camps.find((x) => x.id === genFor);
      const snapshot = {
        generated_at: new Date().toISOString(),
        campaign: d.campaign, org: d.org, pillars: d.pillars, groups: d.groups,
        overall: d.overall, questions: d.questions || null,
        findings, rulebook: "v1.1", engine: "shared-gaps-v1",
        segments: d.segments || null,
        client_context: content.client_context || cRow?.client_context || null,
        engagement_objective: content.engagement_objective || cRow?.engagement_objective || null,
        pillar_notes: Object.fromEntries((pn || []).filter((x) => x.body?.trim()).map((x) => [x.pillar, x.body])),
        verbatims: vb.verbatims || [],
      };
      const body = JSON.stringify(snapshot);
      const checksum = await sha256(body);
      const prior = reports.filter((r) => r.campaign_id === genFor && r.rtype === rtype);
      const version = prior.length ? Math.max(...prior.map((r) => r.version || 1)) + 1 : 1;
      const title = `${campName(genFor)} — ${TYPES[rtype].label} report v${version}`;
      const { data: ins, error } = await sb().from("fs_reports").insert({
        campaign_id: genFor, title, rtype, created_by: user.id,
        snapshot, version, checksum, questionnaire_version: d.questionnaire_version || null,
      }).select("*").single();
      if (error) throw new Error(error.message);
      await load();
      await open(ins);
    } catch (ex) { setErr(String(ex.message || ex)); }
    setBusy(false);
  }

  async function open(rep) {
    setErr("");
    try {
      if (rep.rtype === "executive") {
        router.push(`/campaigns/${rep.campaign_id}/report${rep.snapshot ? `?rid=${rep.id}` : ""}`);
        return;
      }
      // render strictly from the frozen snapshot; legacy rows without one fall back to live
      const d = rep.snapshot || await fetchResults(rep.campaign_id);
      const base = campName(rep.campaign_id).replace(/[^\w]+/g, "-") + (rep.version ? `-v${rep.version}` : "");
      if (rep.rtype === "findings_csv") {
        const fs = rep.snapshot ? (d.findings || []) : evaluateFindings(d);
        const rows = [["Priority", "Finding", "Class", "Confidence", "ISO 56001", "Trigger", "Conclusion", "Evidence", "Validate"]];
        fs.forEach((f) => rows.push([f.severity === 3 ? "P3" : f.severity === 2 ? "P2" : "P1", f.title, f.klass, f.confidence, f.iso || "", f.trigger || "", f.text, f.evidence.join(" "), f.validate]));
        dl(`${base}-findings.csv`, rows);
      } else if (rep.rtype === "results_csv") {
        const ps = d.pillars || [];
        const rows = [["Group", "n", ...ps.map((p) => p.short), "DK/NA %"]];
        (d.groups || []).forEach((g) => rows.push(g.suppressed
          ? [groupName(g), g.n, `suppressed (below ${d.campaign.anonymity_threshold})`]
          : [groupName(g), g.n, ...ps.map((p) => g.pillars[p.id] ?? ""), g.dkna_pct]));
        if (d.overall && !d.overall.suppressed) rows.push(["All groups", d.overall.n, ...ps.map((p) => d.overall.pillars[p.id] ?? ""), ""], ["Overall", d.overall.score]);
        dl(`${base}-results.csv`, rows);
      } else if (rep.rtype === "questions_csv") {
        const types = (d.groups || []).filter((g) => !g.suppressed).map((g) => g.type);
        const head = ["Pillar", "Question"]; types.forEach((t) => head.push(`${t} mean`, `${t} n`, `${t} DK`));
        const rows = [head];
        (d.questions || []).forEach((qr) => {
          const row = [qr.pillar_short, qr.text];
          types.forEach((t) => { const e = qr.groups[t] || {}; row.push(e.mean ?? "", e.n_scored ?? 0, e.n_dkna ?? 0); });
          rows.push(row);
        });
        dl(`${base}-questions.csv`, rows);
      }
    } catch (ex) { setErr(String(ex.message || ex)); }
  }

  async function remove(id) {
    setBusy(true);
    await sb().from("fs_reports").delete().eq("id", id);
    await load(); setBusy(false);
  }

  const filtered = reports.filter((r) => {
    if (fCamp !== "all" && r.campaign_id !== fCamp) return false;
    if (q.trim() && !(r.title + " " + campName(r.campaign_id)).toLowerCase().includes(q.trim().toLowerCase())) return false;
    return true;
  });

  return (
    <Shell active="reports" user={user}>
      <div className="crumbs"><b>Reports</b></div>
      <div className="pagehead">
        <div>
          <h1>Reports</h1>
          <p className="lead">Turn campaign findings into clear, decision-ready reports.</p>
        </div>
        <div style={{ display: "flex", gap: 10, flexWrap: "wrap", alignItems: "center" }}>
          <select value={genFor} onChange={(e) => setGenFor(e.target.value)} style={{ width: "auto", fontWeight: 600 }}>
            {camps.map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}
          </select>
          <details className="rowmenu">
            <summary className="btn btn-primary" style={{ listStyle: "none", cursor: "pointer" }}>+ Generate report</summary>
            <div className="dd">
              {Object.entries(TYPES).map(([k, t]) => (
                <button key={k} disabled={busy || !genFor} onClick={() => generate(k)} title={t.desc}>{t.label} — {t.desc}</button>
              ))}
            </div>
          </details>
        </div>
      </div>
      {err ? <div className="err">{err}</div> : null}

      <div className="stats">
        <div className="stat"><span className="ic c-green"><I.doc /></span><div><div className="k">Ready to share</div><div className="v">{reports.length}</div><span className="small muted">across {new Set(reports.map((r) => r.campaign_id)).size} campaign{new Set(reports.map((r) => r.campaign_id)).size === 1 ? "" : "s"}</span></div></div>
        <div className="stat"><span className="ic c-violet"><I.chart /></span><div><div className="k">Executive reports</div><div className="v">{reports.filter((r) => r.rtype === "executive").length}</div></div></div>
        <div className="stat"><span className="ic c-teal"><I.shield /></span><div><div className="k">Evidence packs</div><div className="v">{reports.filter((r) => r.rtype !== "executive").length}</div></div></div>
        <div className="stat"><span className="ic c-grey"><I.info /></span><div><div className="k">Scheduled delivery</div><div className="v" style={{ fontSize: 16 }}>planned</div><span className="small muted">arrives with recurring cycles</span></div></div>
      </div>

      <details className="card">
        <summary style={{ cursor: "pointer", fontWeight: 800, fontSize: 16 }}>
          Report content — client context, objectives &amp; pillar summaries
          <span className="small muted" style={{ marginLeft: 10, fontWeight: 500 }}>authored once per campaign, included in every generated report</span>
        </summary>
        <div style={{ marginTop: 12 }}>
          <label className="f">Client context <span className="muted">(who they are, in their words — the report&apos;s introduction)</span></label>
          <textarea value={content.client_context} onChange={(e) => setContent((c) => ({ ...c, client_context: e.target.value }))}
            placeholder="e.g. A proudly South African technology solutions provider serving the financial, engineering and mining sectors for over 20 years…" />
          <label className="f">Engagement objective <span className="muted">(why this assessment was commissioned)</span></label>
          <textarea value={content.engagement_objective} onChange={(e) => setContent((c) => ({ ...c, engagement_objective: e.target.value }))}
            placeholder="e.g. Establish an innovation-capability baseline to inform the innovation strategy and track progress in future cycles." />
          {PILLARS.map(([pid, nm]) => (
            <div key={pid}>
              <label className="f">{nm} — summary of written responses <span className="muted">(analyst-written, optional)</span></label>
              <textarea value={notes[pid] || ""} onChange={(e) => setNotes((n) => ({ ...n, [pid]: e.target.value }))}
                placeholder="Themes in this pillar's written feedback — descriptive, no individual identifiable." />
            </div>
          ))}
          <div style={{ marginTop: 10 }}>
            <button className="btn btn-primary btn-sm" disabled={busy || !genFor} onClick={saveContent}>Save report content</button>
            {saved ? <span className="small" style={{ color: "var(--green, #2f855a)", marginLeft: 10 }}>Saved ✓</span> : null}
          </div>
        </div>
      </details>

      <div className="card">
        <div style={{ display: "flex", gap: 10, flexWrap: "wrap", marginBottom: 12 }}>
          <h2 style={{ margin: 0, flex: 1 }}>Report library</h2>
          <input type="text" placeholder="Search reports" value={q} onChange={(e) => setQ(e.target.value)} style={{ width: 220 }} />
          <select value={fCamp} onChange={(e) => setFCamp(e.target.value)} style={{ width: "auto" }}>
            <option value="all">All campaigns</option>
            {camps.map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}
          </select>
        </div>
        {!filtered.length ? (
          <p className="muted small">No reports yet — pick a campaign and use “+ Generate report”. Executive reports open the print-ready view; the other types download live CSV evidence packs.</p>
        ) : (
          <table className="t">
            <thead><tr><th>Report</th><th>Campaign</th><th>Type</th><th>Status</th><th>Created</th><th></th></tr></thead>
            <tbody>
              {filtered.map((r) => (
                <tr key={r.id}>
                  <td><b>{r.title}</b><div className="small muted">{TYPES[r.rtype]?.desc}{r.checksum ? ` · snapshot ${r.checksum.slice(0, 8)}` : " · legacy (live data)"}</div></td>
                  <td className="small">{campName(r.campaign_id)}</td>
                  <td><span className={"pill " + (TYPES[r.rtype]?.pill || "draft")}>{TYPES[r.rtype]?.label || r.rtype}</span></td>
                  <td><span className="pill open">Ready</span></td>
                  <td className="small muted">{new Date(r.created_at).toLocaleDateString()}</td>
                  <td style={{ textAlign: "right", whiteSpace: "nowrap" }}>
                    <button className="btn btn-primary btn-sm" onClick={() => open(r)}>{r.rtype === "executive" ? "View" : "Download"}</button>{" "}
                    {r.rtype === "executive" && r.snapshot ? (
                      <><button className="btn btn-ghost btn-sm" disabled={busy}
                        onClick={async () => { setBusy(true); try { await generateWordReport(r, interps); } catch (e) { setErr(String(e.message || e)); } setBusy(false); }}>
                        Word (.docx)</button>{" "}</>
                    ) : null}
                    <button className="btn btn-ghost btn-sm" disabled={busy} onClick={() => remove(r.id)}>Remove</button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
        <p className="small muted" style={{ marginTop: 10 }}>
          Each generated report is an immutable, checksummed snapshot — re-downloading the same
          version always yields identical content, and only findings approved in the review
          workbench are included. New responses require generating a new version. Scheduled
          recurring delivery is planned alongside multi-cycle trend reports.
        </p>
      </div>
    </Shell>
  );
}
