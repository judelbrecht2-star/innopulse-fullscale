"use client";
import { useCallback, useEffect, useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { sb, FN_BASE } from "../../../lib/supabase";
import { Shell, I } from "../../ui";
import { evaluateFindings, CLASS } from "../../lib/findings";
import TagGlossary from "../../lib/TagGlossary";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Badge } from "@/components/ui/badge";
import { NativeSelect, NativeSelectOption } from "@/components/ui/native-select";
import { ArrowRight, Check, Download } from "iconoir-react";

function csvEsc(v) { const s = String(v ?? ""); return /[",\n]/.test(s) ? '"' + s.replace(/"/g, '""') + '"' : s; }
const PRI = { 3: "P3 · Urgent", 2: "P2 · Material", 1: "P1 · Monitor" };
const PRIC = { 3: "var(--primary)", 2: "var(--amber, #b7791f)", 1: "var(--muted)" };
const ISO_LABEL = { 4: "Context", 5: "Leadership", 6: "Planning", 7: "Support", 8: "Operation", 9: "Performance evaluation", 10: "Improvement" };
const CONF_ORDER = ["High", "Medium-High", "Medium"];
const JEV_VERDICT = {
  corroborated: { label: "Corroborated", color: "var(--green, #2f855a)", text: "Multiple relevant comments support this interpretation without material contradiction." },
  leaning_support: { label: "Leaning support", color: "var(--teal, #2c7a7b)", text: "One directly relevant comment supports this interpretation. Treat it as a lead, not confirmation." },
  mixed: { label: "Mixed evidence", color: "var(--amber, #b7791f)", text: "Written responses contain both supporting and contradictory evidence. Narrow or qualify the conclusion before approval." },
  leaning_contradiction: { label: "Leaning contradiction", color: "var(--amber, #b7791f)", text: "One directly relevant comment weakens or qualifies this interpretation. Review the counter-evidence before approval." },
  contradicted: { label: "Contradicted", color: "var(--primary)", text: "Multiple relevant comments push against this interpretation. Treat it as a prompt for analyst investigation, not a conclusion." },
  insufficient: { label: "Insufficient evidence", color: "var(--muted)", text: "Too little directly relevant written evidence is available to corroborate or challenge this interpretation." },
};
const LEDGER_TONE = {
  supporting: { label: "Supports", color: "var(--green, #2f855a)" },
  contradictory: { label: "Challenges", color: "var(--primary)" },
  context: { label: "Context", color: "var(--amber, #b7791f)" },
  irrelevant: { label: "Not used", color: "var(--muted)" },
};

function Chip({ label, count, on, color, onClick }) {
  return (
    <button type="button" onClick={onClick} style={{
      display: "inline-flex", alignItems: "center", gap: 7, cursor: "pointer",
      border: on ? "1.5px solid var(--primary)" : "1px solid var(--line)",
      background: on ? "var(--primary-soft, #fdeeee)" : "#fff",
      borderRadius: 10, padding: "7px 12px", fontWeight: 650, fontSize: 13, color: color || "inherit",
    }}>
      {label}
      <span style={{ background: on ? "#fff" : "var(--bg2, #f4f1ec)", borderRadius: 99, padding: "1px 8px", fontSize: 11.5, color: "var(--ink, #17171a)", fontWeight: 700 }}>{count}</span>
    </button>
  );
}

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
  const [fIso, setFIso] = useState(""); // "" = all clauses
  const [sortBy, setSortBy] = useState("pri"); // pri | conf | rev
  const [cur, setCur] = useState(null); // finding id
  const [busy, setBusy] = useState(false);
  const [jevEvidence, setJevEvidence] = useState({});
  const [jevStatus, setJevStatus] = useState("idle");
  const [jevMatches, setJevMatches] = useState({});
  const [matchStatus, setMatchStatus] = useState({});

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
    setResults(null); setErr(""); setCur(null); setJevEvidence({}); setJevStatus("idle"); setJevMatches({}); setMatchStatus({});
    const { data: sess } = await sb().auth.getSession();
    const jwt = sess.session?.access_token;
    if (!jwt) return;
    try {
      const [r, { data: revs }] = await Promise.all([
        fetch(`${FN_BASE}/fs-results?campaign_id=${cid}&detail=1`, { headers: { Authorization: `Bearer ${jwt}` } }),
        sb().from("fs_finding_reviews").select("rule_id, reviewed_at, note_contradictory, note_alternative").eq("campaign_id", cid),
      ]);
      if (!r.ok) { setErr("Could not load results."); return; }
      setResults(await r.json());
      setReviews(Object.fromEntries((revs || []).map((x) => [x.rule_id, x])));
    } catch { setErr("Could not load results."); }
  }, []);
  useEffect(() => { load(sel); }, [sel, load]);

  useEffect(() => {
    if (!results || !sel) return;
    const candidates = evaluateFindings(results)
      .filter((finding) => finding.klass === CLASS.SUP || finding.klass === CLASS.HYP)
      .slice(0, 12)
      .map((finding) => ({
        id: finding.id,
        title: finding.title,
        conclusion: finding.text,
        alternatives: finding.alternatives,
        klass: finding.klass,
      }));
    if (!candidates.length) { setJevStatus("complete"); return; }
    let cancelled = false;
    setJevStatus("loading");
    (async () => {
      try {
        const { data: sess } = await sb().auth.getSession();
        const jwt = sess.session?.access_token;
        if (!jwt) throw new Error("No session");
        const response = await fetch(`${FN_BASE}/fs-jev-findings`, {
          method: "POST",
          headers: { "Content-Type": "application/json", Authorization: `Bearer ${jwt}` },
          body: JSON.stringify({ campaign_id: sel, findings: candidates }),
        });
        if (!response.ok) throw new Error("Evidence check failed");
        const payload = await response.json();
        if (cancelled) return;
        setJevEvidence(Object.fromEntries((payload.results || []).map((row) => [row.finding_id, row])));
        setJevStatus(payload.status === "disabled" ? "disabled" : "complete");
      } catch {
        if (!cancelled) setJevStatus("unavailable");
      }
    })();
    return () => { cancelled = true; };
  }, [results, sel]);

  const findings = results ? evaluateFindings(results) : [];
  const clauseOf = (f) => ((f.iso || "").match(/Clause (\d+)/) || [])[1] || "";
  const filtered = findings.filter((f) => {
    if (fPri && f.severity !== fPri) return false;
    if (fClass !== "all" && f.klass !== fClass) return false;
    if (fIso && clauseOf(f) !== fIso) return false;
    if (q.trim()) {
      const n = q.trim().toLowerCase();
      if (!(f.title + " " + f.text + " " + (f.iso || "") + " " + f.evidence.join(" ")).toLowerCase().includes(n)) return false;
    }
    return true;
  });
  const active = filtered.find((f) => f.id === cur) || filtered[0] || null;
  const nOf = (s) => findings.filter((f) => f.severity === s).length;
  const nObs = findings.filter((f) => f.klass === CLASS.OBS).length;
  const nSup = findings.filter((f) => f.klass === CLASS.SUP).length;
  const nHyp = findings.filter((f) => f.klass === CLASS.HYP).length;
  const isoNums = [...new Set(findings.map(clauseOf).filter(Boolean))].sort((a, b) => Number(a) - Number(b));
  const allOn = fPri === 0 && fClass === "all" && !fIso;
  // Grouped list order depends on the sort selector
  const bySev = (a, b) => b.severity - a.severity;
  const groups = sortBy === "conf"
    ? CONF_ORDER.map((c) => ({ key: c, label: "Confidence · " + c, color: "var(--ink, #17171a)", items: filtered.filter((f) => f.confidence === c).sort(bySev) }))
    : sortBy === "rev"
      ? [
        { key: "todo", label: "Awaiting review", color: "var(--primary)", items: filtered.filter((f) => !reviews[f.id]).sort(bySev) },
        { key: "done", label: "Reviewed", color: "var(--muted)", items: filtered.filter((f) => !!reviews[f.id]).sort(bySev) },
      ]
      : [3, 2, 1].map((s) => ({ key: s, label: PRI[s], color: PRIC[s], items: filtered.filter((f) => f.severity === s) }));

  async function toggleReview(f) {
    setBusy(true);
    if (reviews[f.id]) {
      await sb().from("fs_finding_reviews").delete().eq("campaign_id", sel).eq("rule_id", f.id);
    } else {
      await sb().from("fs_finding_reviews").upsert(
        { campaign_id: sel, rule_id: f.id, reviewed_by: user.id },
        { onConflict: "campaign_id,rule_id" });
    }
    const { data: revs } = await sb().from("fs_finding_reviews").select("rule_id, reviewed_at, note_contradictory, note_alternative").eq("campaign_id", sel);
    setReviews(Object.fromEntries((revs || []).map((x) => [x.rule_id, x])));
    setBusy(false);
  }

  async function saveNote(f, field, value) {
    const v = value.trim().slice(0, 600) || null;
    if ((reviews[f.id]?.[field] || null) === v) return;
    await sb().from("fs_finding_reviews").update({ [field]: v }).eq("campaign_id", sel).eq("rule_id", f.id);
    setReviews((rv) => ({ ...rv, [f.id]: { ...rv[f.id], [field]: v } }));
  }

  async function matchApprovedInterventions(finding) {
    setMatchStatus((status) => ({ ...status, [finding.id]: "loading" }));
    try {
      const { data: sess } = await sb().auth.getSession();
      const jwt = sess.session?.access_token;
      if (!jwt) throw new Error("No session");
      const response = await fetch(`${FN_BASE}/fs-jev-interventions`, {
        method: "POST",
        headers: { "Content-Type": "application/json", Authorization: `Bearer ${jwt}` },
        body: JSON.stringify({
          campaign_id: sel,
          finding: {
            id: finding.id,
            title: finding.title,
            conclusion: finding.text,
            validate: finding.validate,
            iso: finding.iso,
          },
        }),
      });
      if (!response.ok) throw new Error("Match failed");
      const payload = await response.json();
      setJevMatches((matches) => ({ ...matches, [finding.id]: payload }));
      setMatchStatus((status) => ({ ...status, [finding.id]: payload.status === "disabled" ? "disabled" : "complete" }));
    } catch {
      setMatchStatus((status) => ({ ...status, [finding.id]: "unavailable" }));
    }
  }

  function exportEvidence() {
    const rows = [["Priority", "Finding", "Class", "Confidence", "ISO 56001", "Trigger", "Conclusion", "Evidence", "Alternatives", "Validate", "Jev shadow verdict", "Jev support comments", "Jev contradictory comments", "Jev eligible comments", "Reviewed", "Analyst: contradictory evidence", "Analyst: alternative explanation"]];
    findings.forEach((f) => {
      const jev = jevEvidence[f.id];
      rows.push([PRI[f.severity], f.title, f.klass, f.confidence, f.iso || "", f.trigger || "", f.text, f.evidence.join(" "), f.alternatives, f.validate, jev?.verdict || "", jev?.support_count ?? "", jev?.contradiction_count ?? "", jev?.eligible_comment_count ?? "", reviews[f.id] ? "yes" : "no", reviews[f.id]?.note_contradictory || "", reviews[f.id]?.note_alternative || ""]);
    });
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
          <Button variant="ghost" onClick={exportEvidence} disabled={!findings.length}><Download className="inline size-4 -mt-0.5" /> Export evidence</Button>
          <NativeSelect value={sel} onChange={(e) => setSel(e.target.value)} style={{ width: "auto", fontWeight: 600 }}>
            {campaigns.map((c) => <NativeSelectOption key={c.id} value={c.id}>{c.name}</NativeSelectOption>)}
          </NativeSelect>
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

      <div className="card" style={{ display: "flex", gap: 8, flexWrap: "wrap", alignItems: "center" }}>
        <Input type="text" placeholder="Search findings, questions or ISO clauses" value={q} onChange={(e) => setQ(e.target.value)} style={{ flex: 1, minWidth: 200 }} />
        <Chip label="All" count={findings.length} on={allOn} onClick={() => { setFPri(0); setFClass("all"); setFIso(""); }} />
        <Chip label="P3 Urgent" color={PRIC[3]} count={nOf(3)} on={fPri === 3} onClick={() => setFPri(fPri === 3 ? 0 : 3)} />
        <Chip label="P2 Material" color={PRIC[2]} count={nOf(2)} on={fPri === 2} onClick={() => setFPri(fPri === 2 ? 0 : 2)} />
        <Chip label="P1 Monitor" color={PRIC[1]} count={nOf(1)} on={fPri === 1} onClick={() => setFPri(fPri === 1 ? 0 : 1)} />
        <Chip label="Observed" color="var(--band-med)" count={nObs} on={fClass === CLASS.OBS} onClick={() => setFClass(fClass === CLASS.OBS ? "all" : CLASS.OBS)} />
        <Chip label="Supported" color="var(--amber, #b7791f)" count={nSup} on={fClass === CLASS.SUP} onClick={() => setFClass(fClass === CLASS.SUP ? "all" : CLASS.SUP)} />
        {nHyp ? <Chip label="Hypothesis" color="var(--muted)" count={nHyp} on={fClass === CLASS.HYP} onClick={() => setFClass(fClass === CLASS.HYP ? "all" : CLASS.HYP)} /> : null}
        <NativeSelect value={fIso} onChange={(e) => setFIso(e.target.value)} style={{ width: "auto" }}>
          <NativeSelectOption value="">ISO clause</NativeSelectOption>
          {isoNums.map((n) => <NativeSelectOption key={n} value={n}>Clause {n}{ISO_LABEL[n] ? ` · ${ISO_LABEL[n]}` : ""}</NativeSelectOption>)}
        </NativeSelect>
        <NativeSelect value={sortBy} onChange={(e) => setSortBy(e.target.value)} style={{ width: "auto" }}>
          <NativeSelectOption value="pri">Priority first</NativeSelectOption>
          <NativeSelectOption value="conf">Confidence first</NativeSelectOption>
          <NativeSelectOption value="rev">Unreviewed first</NativeSelectOption>
        </NativeSelect>
      </div>

      {!results ? <p className="muted">Loading…</p> : !findings.length ? (
        <div className="card"><p className="muted">No patterns detected for this campaign yet — findings appear as responses accumulate.</p></div>
      ) : (
        <div style={{ display: "grid", gridTemplateColumns: "minmax(280px,5fr) minmax(320px,7fr)", gap: 18, alignItems: "start" }} className="wbgrid">
          <style>{`@media(max-width:1000px){.wbgrid{grid-template-columns:1fr!important}}`}</style>

          <div className="card" style={{ padding: 12 }}>
            <h2 style={{ margin: "6px 8px 8px" }}>Ranked findings {filtered.length !== findings.length ? <span className="small muted" style={{ fontWeight: 400 }}>— {filtered.length} of {findings.length} shown</span> : null}</h2>
            {!filtered.length ? <p className="small muted" style={{ margin: "4px 8px 10px" }}>Nothing matches the current filters — clear a chip or the search box.</p> : null}
            {groups.map((g) => {
              const grp = g.items;
              if (!grp.length) return null;
              return (
                <div key={g.key}>
                  <div className="small" style={{ fontWeight: 800, color: g.color, margin: "10px 8px 4px", textTransform: "uppercase", letterSpacing: ".5px" }}>{g.label}</div>
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
                        {reviews[f.id] ? <Badge variant="secondary" data-tone="open"><Check className="inline size-4 -mt-0.5" /></Badge> : null}
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
              <Badge variant="secondary" style={{ background: PRIC[active.severity], color: "#fff" }}>{PRI[active.severity]}</Badge>
              <h2 style={{ margin: "10px 0 10px", fontSize: 21 }}>{active.title}</h2>
              <div className="small" style={{ display: "flex", flexWrap: "wrap", alignItems: "center", gap: "8px 10px", margin: "0 0 14px" }}>
                <span className={"pill " + chipCls(active.klass)}>{active.klass}</span>
                <span className="muted">Confidence · {active.confidence}</span>
                {active.iso ? <Badge variant="secondary" data-tone="violet">ISO 56001 · {active.iso}</Badge> : null}
              </div>

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

              {active.klass !== CLASS.OBS ? (() => {
                const jev = jevEvidence[active.id];
                const meta = jev ? JEV_VERDICT[jev.verdict] : null;
                return (
                  <div style={{ border: "1px solid var(--line)", background: "var(--bg2, #f7f5f1)", borderRadius: 12, padding: "12px 14px", marginBottom: 14 }}>
                    <div className="small" style={{ display: "flex", gap: 8, alignItems: "center", flexWrap: "wrap", fontWeight: 800, marginBottom: 5 }}>
                      AI evidence review
                      <Badge variant="outline" data-tone="draft" style={{ textTransform: "none" }}>Jev · advisory</Badge>
                      {meta ? <span style={{ color: meta.color }}>{meta.label}</span> : null}
                    </div>
                    {jevStatus === "loading" ? <p className="small muted" style={{ margin: 0 }}>Checking privacy-eligible written responses…</p> : null}
                    {jevStatus === "unavailable" ? <p className="small muted" style={{ margin: 0 }}>The written-evidence check is temporarily unavailable. The deterministic finding is unchanged.</p> : null}
                    {jevStatus === "disabled" ? <p className="small muted" style={{ margin: 0 }}>The written-evidence pilot is disabled. The deterministic finding is unchanged.</p> : null}
                    {jev && meta ? (
                      <>
                        <p className="small" style={{ margin: 0, lineHeight: 1.55 }}>{meta.text}</p>
                        <p className="small muted" style={{ margin: "6px 0 0" }}>
                          {jev.support_count} supporting · {jev.contradiction_count} contradictory · {jev.relevant_count} relevant of {jev.evaluated_comment_count} evaluated
                          {jev.eligible_comment_count > jev.evaluated_comment_count ? ` (${jev.eligible_comment_count} privacy-eligible)` : ""}
                          {jev.latency_ms != null ? ` · ${jev.latency_ms} ms` : ""}
                        </p>
                        <details style={{ marginTop: 10 }}>
                          <summary className="small" style={{ cursor: "pointer", fontWeight: 800 }}>
                            Evidence ledger ({(jev.evidence_ledger || []).length})
                          </summary>
                          <p className="small muted" style={{ margin: "7px 0" }}>
                            Privacy-eligible excerpts only · {(jev.sampling?.sampling_omitted_count || 0)} omitted by the balanced sample
                            {(jev.sampling?.privacy_excluded_count || 0) ? ` · ${jev.sampling.privacy_excluded_count} withheld for identity risk` : ""}
                            {(jev.sampling?.invalid_or_test_excluded_count || 0) ? ` · ${jev.sampling.invalid_or_test_excluded_count} test/invalid excluded` : ""}
                          </p>
                          {(jev.evidence_ledger || []).map((entry) => {
                            const tone = LEDGER_TONE[entry.disposition] || LEDGER_TONE.context;
                            return (
                              <div key={entry.ref} style={{ borderLeft: `3px solid ${tone.color}`, padding: "7px 10px", margin: "7px 0", background: "#fff", borderRadius: 6 }}>
                                <div className="small" style={{ display: "flex", gap: 7, flexWrap: "wrap", fontWeight: 750 }}>
                                  <span style={{ color: tone.color }}>{tone.label}</span>
                                  <span>{entry.ref} · {entry.source_group}{entry.pillar ? ` · ${entry.pillar}` : ""}</span>
                                </div>
                                <p className="small" style={{ margin: "4px 0", lineHeight: 1.5 }}>“{entry.excerpt}”</p>
                                <div className="small muted">support {Math.round(entry.supports * 100)}% · challenge {Math.round(entry.contradicts * 100)}% · relevance {entry.relevance}/2</div>
                              </div>
                            );
                          })}
                          <div className="small muted" style={{ marginTop: 8 }}>Model {jev.model} · schema {jev.schema_version}{jev.cached ? " · cached result" : ""}</div>
                        </details>
                      </>
                    ) : null}
                    <p className="small muted" style={{ margin: "6px 0 0" }}>Jev cannot create, remove or approve a finding. Analyst review remains required before report publication.</p>
                  </div>
                );
              })() : null}

              {(() => {
                const status = matchStatus[active.id] || "idle";
                const result = jevMatches[active.id];
                return (
                  <div style={{ border: "1px solid var(--line)", background: "#fff", borderRadius: 12, padding: "12px 14px", marginBottom: 14 }}>
                    <div className="small" style={{ display: "flex", gap: 8, alignItems: "center", flexWrap: "wrap", fontWeight: 800 }}>
                      AI-assisted next action
                      <Badge variant="outline" data-tone="teal" style={{ textTransform: "none" }}>approved library only</Badge>
                    </div>
                    <p className="small muted" style={{ margin: "5px 0 9px" }}>Ranks your curated interventions against this finding. It cannot invent or add an action without analyst review.</p>
                    {status === "idle" ? <Button size="sm" variant="outline" onClick={() => matchApprovedInterventions(active)}>Match approved interventions</Button> : null}
                    {status === "loading" ? <p className="small muted" style={{ margin: 0 }}>Comparing the finding with the approved library…</p> : null}
                    {status === "disabled" ? <p className="small muted" style={{ margin: 0 }}>AI intervention matching is currently disabled.</p> : null}
                    {status === "unavailable" ? <><p className="small" style={{ color: "var(--primary)", margin: "0 0 7px" }}>The match could not be completed.</p><Button size="sm" variant="outline" onClick={() => matchApprovedInterventions(active)}>Try again</Button></> : null}
                    {status === "complete" && result ? (
                      <>
                        {result.selected_id ? <p className="small" style={{ margin: "0 0 8px" }}>Best approved fit · confidence {Math.round((result.confidence || 0) * 100)}%</p> : <p className="small" style={{ margin: "0 0 8px" }}>Jev abstained: no approved intervention was a defensible direct match.</p>}
                        {(result.matches || []).map((match, index) => (
                          <div key={match.id} style={{ borderTop: "1px solid var(--line)", padding: "8px 0" }}>
                            <div className="small" style={{ fontWeight: 800 }}>{index + 1}. {match.summary} · {Math.round((match.probability || 0) * 100)}%</div>
                            <div className="small muted" style={{ marginTop: 3 }}>{match.pillar?.toUpperCase() || "Cross-pillar"}{match.kpi ? ` · Measure: ${match.kpi}` : ""}</div>
                          </div>
                        ))}
                        <div style={{ display: "flex", gap: 8, flexWrap: "wrap", marginTop: 8 }}>
                          <Link className="btn btn-primary btn-sm" href="/insights/interventions">Review in intervention workspace</Link>
                          <Button size="sm" variant="ghost" onClick={() => matchApprovedInterventions(active)}>Run again</Button>
                        </div>
                        <div className="small muted" style={{ marginTop: 7 }}>Model {result.model} · schema {result.schema_version}{result.latency_ms != null ? ` · ${result.latency_ms} ms` : ""}</div>
                      </>
                    ) : null}
                  </div>
                );
              })()}

              <div style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>
                <Link className="btn btn-primary btn-sm" href="/insights/interventions"><ArrowRight className="inline size-4 -mt-0.5" /> Add to intervention roadmap</Link>
                <Button variant="ghost" size="sm" disabled={busy} onClick={() => toggleReview(active)}>
                  {reviews[active.id] ? <><Check className="inline size-4 -mt-0.5" /> Reviewed — undo</> : "Mark reviewed"}
                </Button>
                {sel ? <Link className="btn btn-ghost btn-sm" href={`/campaigns/${sel}/report`}>View in report</Link> : null}
              </div>
              {reviews[active.id] ? (
                <>
                  <p className="small muted" style={{ marginTop: 8 }}>Reviewed {new Date(reviews[active.id].reviewed_at).toLocaleString()}</p>
                  <div style={{ borderTop: "1px solid var(--line)", marginTop: 10, paddingTop: 12 }}>
                    <div className="small" style={{ fontWeight: 800, marginBottom: 6 }}>Analyst notes <span className="muted" style={{ fontWeight: 400 }}>— carried into the report with this finding</span></div>
                    <label className="f">Contradictory evidence <span className="muted small">(what pushes against this conclusion?)</span></label>
                    <Textarea key={active.id + "_c"} maxLength={600} defaultValue={reviews[active.id].note_contradictory || ""}
                      placeholder="e.g. Two customer comments describe fast idea turnaround, which cuts against the visibility pattern."
                      onBlur={(e) => saveNote(active, "note_contradictory", e.target.value)} style={{ minHeight: 64 }} />
                    <label className="f" style={{ marginTop: 8 }}>Alternative explanation <span className="muted small">(your reading, beyond the rule&apos;s own alternatives)</span></label>
                    <Textarea key={active.id + "_a"} maxLength={600} defaultValue={reviews[active.id].note_alternative || ""}
                      placeholder="e.g. The survey ran during retrenchment consultations — scores may reflect general anxiety rather than the innovation system."
                      onBlur={(e) => saveNote(active, "note_alternative", e.target.value)} style={{ minHeight: 64 }} />
                    <p className="small muted" style={{ margin: "6px 0 0" }}>Saved automatically when you click away.</p>
                  </div>
                </>
              ) : null}
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
