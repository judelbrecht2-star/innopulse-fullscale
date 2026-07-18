"use client";
import { useCallback, useEffect, useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { sb, FN_BASE } from "../../../lib/supabase";
import { Shell, I } from "../../ui";
import { evaluateFindings, CLASS } from "../../lib/findings";
import TagGlossary from "../../lib/TagGlossary";

function csvEsc(v) { const s = String(v ?? ""); return /[",\n]/.test(s) ? '"' + s.replace(/"/g, '""') + '"' : s; }
const PRI = { 3: "P3 · Urgent", 2: "P2 · Material", 1: "P1 · Monitor" };
const PRIC = { 3: "var(--primary)", 2: "var(--amber, #b7791f)", 1: "var(--muted)" };

export default function FindingsWorkbench() {
  const router = useRouter();
  const [user, setUser] = useState(null);
  const [campaigns, setCampaigns] = useState([]);
  const [sel, setSel] = useState("");
  const [results, setResults] = useState(null);
  const [reviews, setReviews] = useState({}); // rule_id -> reviewed_at
  const [err, setErr] = useState("");
  const [q, setQ] = useState("");
  const [fPri, setFPri] = useState(0); // 0=all
  const [fClass, setFClass] = useState("all");
  const [cur, setCur] = useState(null); // finding id
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    (async () => {
      const { data: u } = await sb().auth.getUser();
      if (!u.user) { router.replace("/login"); return; }
      setUser(u.user);
      const { data: cs } = await sb().from("fs_campaigns")
        .select("id, name, status, created_at").order("created_at", { ascending: false });
      setCampaigns(cs || []);
      const target = (cs || []).find((c) => c.status === "open") || (cs || [])[0];
      if (target) setSel(target.id);
    })();
  }, [router]);

  const load = useCallback(async (cid) => {
    if (!cid) return;
    setResults(null); setErr(""); setCur(null);
    const { data: sess } = await sb().auth.getSession();
    const jwt = sess.session?.access_token;
    if (!jwt) return;
    try {
      const [r, { data: revs }] = await Promise.all([
        fetch(`${FN_BASE}/fs-results?campaign_id=${cid}&detail=1`, { headers: { Authorization: `Bearer ${jwt}` } }),
        sb().from("fs_finding_reviews").select("rule_id, reviewed_at").eq("campaign_id", cid),
      ]);
      if (!r.ok) { setErr("Could not load results."); return; }
      setResults(await r.json());
      setReviews(Object.fromEntries((revs || []).map((x) => [x.rule_id, x.reviewed_at])));
    } catch { setErr("Could not load results."); }
  }, []);
  useEffect(() => { load(sel); }, [sel, load]);

  const findings = results ? evaluateFindings(results) : [];
  const filtered = findings.filter((f) => {
    if (fPri && f.severity !== fPri) return false;
    if (fClass !== "all" && f.klass !== fClass) return false;
    if (q.trim()) {
      const n = q.trim().toLowerCase();
      if (!(f.title + " " + f.text + " " + (f.iso || "") + " " + f.evidence.join(" ")).toLowerCase().includes(n)) return false;
    }
    return true;
  });
  const active = filtered.find((f) => f.id === cur) || filtered[0] || null;
  const nOf = (s) => findings.filter((f) => f.severity === s).length;
  const nObs = findings.filter((f) => f.klass === CLASS.OBS).length;

  async function toggleReview(f) {
    setBusy(true);
    if (reviews[f.id]) {
      await sb().from("fs_finding_reviews").delete().eq("campaign_id", sel).eq("rule_id", f.id);
    } else {
      await sb().from("fs_finding_reviews").upsert(
        { campaign_id: sel, rule_id: f.id, reviewed_by: user.id },
        { onConflict: "campaign_id,rule_id" });
    }
    const { data: revs } = await sb().from("fs_finding_reviews").select("rule_id, reviewed_at").eq("campaign_id", sel);
    setReviews(Object.fromEntries((revs || []).map((x) => [x.rule_id, x.reviewed_at])));
    setBusy(false);
  }

  function exportEvidence() {
    const rows = [["Priority", "Finding", "Class", "Confidence", "ISO 56001", "Trigger", "Conclusion", "Evidence", "Alternatives", "Validate", "Reviewed"]];
    findings.forEach((f) => rows.push([PRI[f.severity], f.title, f.klass, f.confidence, f.iso || "", f.trigger || "", f.text, f.evidence.join(" "), f.alternatives, f.validate, reviews[f.id] ? "yes" : "no"]));
    const csv = rows.map((r) => r.map(csvEsc).join(",")).join("\r\n");
    const blob = new Blob(["﻿" + csv], { type: "text/csv;charset=utf-8" });
    const a = document.createElement("a");
    a.href = URL.createObjectURL(blob);
    a.download = `${(campaigns.find((c) => c.id === sel)?.name || "campaign").replace(/[^\w]+/g, "-")}-findings-evidence.csv`;
    a.click();
  }

  const chipCls = (k) => k === CLASS.OBS ? "teal" : k === CLASS.SUP ? "draft" : "closed";

  return (
    <Shell active="insights" user={user}>
      <div className="crumbs"><Link href="/insights">Insights</Link> / <b>Automatic findings</b></div>
      <div className="pagehead">
        <div>
          <h1>Automatic findings</h1>
          <p className="lead">Deterministic patterns triggered by converging evidence — every finding cites its questions and includes a validation step.</p>
        </div>
        <div style={{ display: "flex", gap: 10, flexWrap: "wrap" }}>
          <button className="btn btn-ghost" onClick={exportEvidence} disabled={!findings.length}>⭱ Export evidence</button>
          <select value={sel} onChange={(e) => setSel(e.target.value)} style={{ width: "auto", fontWeight: 600 }}>
            {campaigns.map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}
          </select>
        </div>
      </div>
      {err ? <div className="err">{err}</div> : null}

      <TagGlossary />

      <div className="stats">
        <div className="stat"><span className="ic c-teal"><I.chart /></span><div><div className="k">Patterns detected</div><div className="v">{findings.length}</div></div></div>
        <div className="stat"><span className="ic c-red"><I.info /></span><div><div className="k">P3 · Urgent</div><div className="v">{nOf(3)}</div></div></div>
        <div className="stat"><span className="ic c-amber"><I.doc /></span><div><div className="k">P2 · Material</div><div className="v">{nOf(2)}</div></div></div>
        <div className="stat"><span className="ic c-grey"><I.pie /></span><div><div className="k">P1 · Monitor</div><div className="v">{nOf(1)}</div></div></div>
        <div className="stat"><span className="ic c-violet"><I.shield /></span><div><div className="k">Evidence classes</div><div className="v" style={{ fontSize: 17 }}>{nObs} observed · {findings.length - nObs} interpreted</div></div></div>
      </div>

      <div className="card" style={{ display: "flex", gap: 10, flexWrap: "wrap", alignItems: "center" }}>
        <input type="text" placeholder="Search findings, questions or ISO clauses" value={q} onChange={(e) => setQ(e.target.value)} style={{ flex: 1, minWidth: 220 }} />
        <select value={fPri} onChange={(e) => setFPri(Number(e.target.value))} style={{ width: "auto" }}>
          <option value={0}>All priorities</option><option value={3}>P3 · Urgent</option><option value={2}>P2 · Material</option><option value={1}>P1 · Monitor</option>
        </select>
        <select value={fClass} onChange={(e) => setFClass(e.target.value)} style={{ width: "auto" }}>
          <option value="all">All classes</option>
          {[CLASS.OBS, CLASS.SUP, CLASS.HYP].map((k) => <option key={k} value={k}>{k}</option>)}
        </select>
      </div>

      {!results ? <p className="muted">Loading…</p> : !findings.length ? (
        <div className="card"><p className="muted">No patterns detected for this campaign yet — findings appear as responses accumulate.</p></div>
      ) : (
        <div style={{ display: "grid", gridTemplateColumns: "minmax(280px,5fr) minmax(320px,7fr)", gap: 18, alignItems: "start" }} className="wbgrid">
          <style>{`@media(max-width:1000px){.wbgrid{grid-template-columns:1fr!important}}`}</style>

          <div className="card" style={{ padding: 12 }}>
            <h2 style={{ margin: "6px 8px 8px" }}>Ranked findings</h2>
            {[3, 2, 1].map((s) => {
              const grp = filtered.filter((f) => f.severity === s);
              if (!grp.length) return null;
              return (
                <div key={s}>
                  <div className="small" style={{ fontWeight: 800, color: PRIC[s], margin: "10px 8px 4px", textTransform: "uppercase", letterSpacing: ".5px" }}>{PRI[s]}</div>
                  {grp.map((f) => (
                    <button key={f.id} onClick={() => setCur(f.id)} style={{
                      display: "block", width: "100%", textAlign: "left", cursor: "pointer",
                      border: active?.id === f.id ? "1.5px solid var(--primary)" : "1px solid var(--line)",
                      background: active?.id === f.id ? "var(--primary-soft, #fdeeee)" : "transparent",
                      borderRadius: 10, padding: "9px 11px", marginBottom: 6,
                    }}>
                      <span style={{ display: "flex", gap: 8, alignItems: "center", flexWrap: "wrap" }}>
                        <span style={{ width: 8, height: 8, borderRadius: "50%", background: PRIC[f.severity], flex: "0 0 8px" }} />
                        <b style={{ fontSize: 13.5, flex: 1, minWidth: 140 }}>{f.title}</b>
                        {reviews[f.id] ? <span className="pill open">✓</span> : null}
                      </span>
                      <span className="small muted" style={{ display: "block", marginTop: 3 }}>
                        {f.klass} · {f.confidence}{f.iso ? ` · ISO ${f.iso}` : ""}
                      </span>
                    </button>
                  ))}
                </div>
              );
            })}
          </div>

          {active ? (
            <div className="card">
              <span className="pill" style={{ background: PRIC[active.severity], color: "#fff" }}>{PRI[active.severity]}</span>
              <h2 style={{ margin: "10px 0 6px", fontSize: 21 }}>{active.title}</h2>
              <p className="small" style={{ margin: "0 0 12px" }}>
                <span className={"pill " + chipCls(active.klass)}>{active.klass}</span>
                <span className="muted" style={{ marginLeft: 10 }}>Confidence · {active.confidence}</span>
                {active.iso ? <span className="pill violet" style={{ marginLeft: 10 }}>ISO 56001 · {active.iso}</span> : null}
              </p>

              {active.trigger ? (
                <div style={{ border: "1px solid var(--line)", borderRadius: 12, padding: "12px 14px", marginBottom: 12 }}>
                  <div className="small" style={{ fontWeight: 800, marginBottom: 4 }}>Why this rule fired</div>
                  <p className="small" style={{ margin: 0 }}>{active.trigger}</p>
                  <p className="small muted" style={{ margin: "6px 0 0" }}>Signals converge before a conclusion upgrades; suppressed groups never feed a finding.</p>
                </div>
              ) : null}

              <div style={{ border: "1px solid var(--amber, #b7791f)", background: "#fffaf0", borderRadius: 12, padding: "12px 14px", marginBottom: 12 }}>
                <div className="small" style={{ fontWeight: 800, marginBottom: 4 }}>Conclusion</div>
                <p className="small" style={{ margin: 0, lineHeight: 1.6 }}>{active.text}</p>
              </div>

              <div className="grid2">
                <div style={{ border: "1px solid var(--line)", borderRadius: 12, padding: "12px 14px" }}>
                  <div className="small" style={{ fontWeight: 800, marginBottom: 4 }}>Alternative explanations</div>
                  <p className="small muted" style={{ margin: 0 }}>{active.alternatives}</p>
                </div>
                <div style={{ border: "1px solid var(--line)", borderRadius: 12, padding: "12px 14px" }}>
                  <div className="small" style={{ fontWeight: 800, marginBottom: 4 }}>Validate next</div>
                  <p className="small muted" style={{ margin: 0 }}>{active.validate}</p>
                </div>
              </div>

              <div className="small" style={{ margin: "12px 0 4px", fontWeight: 800 }}>Evidence cited</div>
              <p className="small muted" style={{ margin: "0 0 14px" }}>{active.evidence.join("  ")}</p>

              <div style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>
                <Link className="btn btn-primary btn-sm" href="/insights/interventions">⇢ Add to intervention roadmap</Link>
                <button className="btn btn-ghost btn-sm" disabled={busy} onClick={() => toggleReview(active)}>
                  {reviews[active.id] ? "✓ Reviewed — undo" : "Mark reviewed"}
                </button>
                {sel ? <Link className="btn btn-ghost btn-sm" href={`/campaigns/${sel}/report`}>View in report</Link> : null}
              </div>
              {reviews[active.id] ? <p className="small muted" style={{ marginTop: 8 }}>Reviewed {new Date(reviews[active.id]).toLocaleString()}</p> : null}
            </div>
          ) : <div className="card"><p className="muted small">No findings match these filters.</p></div>}
        </div>
      )}

      <p className="small muted" style={{ marginTop: 6 }}>
        <b>Observed</b> = directly visible in the data · <b>Supported interpretation</b> = several signals converge ·
        <b> Plausible hypothesis</b> = credible, still needs validation.
      </p>
    </Shell>
  );
}
