"use client";
import { useCallback, useEffect, useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { sb, FN_BASE } from "../../lib/supabase";
import { Shell, I, groupName } from "../ui";
import { evaluateFindings } from "../lib/findings";

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
  const [genFor, setGenFor] = useState("");
  const [q, setQ] = useState("");
  const [fCamp, setFCamp] = useState("all");
  const [err, setErr] = useState("");
  const [busy, setBusy] = useState(false);

  const load = useCallback(async () => {
    const { data: u } = await sb().auth.getUser();
    if (!u.user) { router.replace("/login"); return; }
    setUser(u.user);
    const [{ data: cs }, { data: rs }] = await Promise.all([
      sb().from("fs_campaigns").select("id, name, status, created_at").order("created_at", { ascending: false }),
      sb().from("fs_reports").select("*").order("created_at", { ascending: false }),
    ]);
    setCamps(cs || []); setReports(rs || []);
    if (cs?.length) setGenFor(cs[0].id);
  }, [router]);
  useEffect(() => { load(); }, [load]);

  const campName = (id) => camps.find((c) => c.id === id)?.name || "—";

  async function fetchResults(cid) {
    const { data: sess } = await sb().auth.getSession();
    const r = await fetch(`${FN_BASE}/fs-results?campaign_id=${cid}&detail=1`, { headers: { Authorization: `Bearer ${sess.session?.access_token}` } });
    if (!r.ok) throw new Error("Could not load campaign results.");
    return r.json();
  }

  async function generate(rtype) {
    if (!genFor) return;
    setBusy(true); setErr("");
    try {
      const title = `${campName(genFor)} — ${TYPES[rtype].label} report`;
      await sb().from("fs_reports").insert({ campaign_id: genFor, title, rtype, created_by: user.id });
      await load();
      await open({ campaign_id: genFor, rtype, title });
    } catch (ex) { setErr(String(ex.message || ex)); }
    setBusy(false);
  }

  async function open(rep) {
    setErr("");
    try {
      if (rep.rtype === "executive") { router.push(`/campaigns/${rep.campaign_id}/report`); return; }
      const d = await fetchResults(rep.campaign_id);
      const base = campName(rep.campaign_id).replace(/[^\w]+/g, "-");
      if (rep.rtype === "findings_csv") {
        const fs = evaluateFindings(d);
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
                  <td><b>{r.title}</b><div className="small muted">{TYPES[r.rtype]?.desc}</div></td>
                  <td className="small">{campName(r.campaign_id)}</td>
                  <td><span className={"pill " + (TYPES[r.rtype]?.pill || "draft")}>{TYPES[r.rtype]?.label || r.rtype}</span></td>
                  <td><span className="pill open">Ready</span></td>
                  <td className="small muted">{new Date(r.created_at).toLocaleDateString()}</td>
                  <td style={{ textAlign: "right", whiteSpace: "nowrap" }}>
                    <button className="btn btn-primary btn-sm" onClick={() => open(r)}>{r.rtype === "executive" ? "View" : "Download"}</button>{" "}
                    <button className="btn btn-ghost btn-sm" disabled={busy} onClick={() => remove(r.id)}>Remove</button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
        <p className="small muted" style={{ marginTop: 10 }}>
          Reports always regenerate from the campaign&apos;s current data, so a re-download after new
          responses reflects the latest picture. Scheduled recurring delivery is planned alongside
          multi-cycle trend reports.
        </p>
      </div>
    </Shell>
  );
}
