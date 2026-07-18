// InnoPulse Full-Scale — client-side Word report generator (Report Blueprint v1).
// Builds the branded .docx entirely from a frozen report snapshot + the versioned
// interpretation library. No live data is consulted: same snapshot, same document.
import {
  Document, Packer, Paragraph, TextRun, HeadingLevel, ImageRun, PageBreak,
  Table, TableRow, TableCell, WidthType, BorderStyle, ShadingType, AlignmentType, Footer, PageNumber,
} from "docx";
import { bestGaps, MIN_N } from "./gaps";

const INK = "17171A", CORAL = "E8332E", TEAL = "0E8C8C", GREY = "6D6D76", LINE = "D9D9DE", AMBER = "B7791F", GREEN = "2F855A";
const GROUP_LBL = { executive: "Executives", employee: "Employees", customer: "Customers", partner: "Partners", other: "Other" };
const bandOf = (v) => (v < 40 ? "low" : v < 70 ? "med" : "high");
const bandWord = (v) => (v < 40 ? "Low" : v < 70 ? "Medium" : "High");
const bandCol = (v) => (v < 40 ? CORAL : v < 70 ? AMBER : GREEN);

const H = (t, l = HeadingLevel.HEADING_1) => new Paragraph({ heading: l, spacing: { before: 260, after: 110 }, children: [new TextRun({ text: t, color: INK })] });
const P = (t, o = {}) => new Paragraph({ spacing: { after: o.after ?? 100, line: 276 }, alignment: o.align, children: [new TextRun({ text: t, color: o.c || "333338", size: o.s || 21, italics: o.i, bold: o.b })] });
const CAP = (t) => new Paragraph({ spacing: { before: 40, after: 160 }, children: [new TextRun({ text: t, color: GREY, size: 18, italics: true })] });
const cellB = { top: { style: BorderStyle.SINGLE, size: 4, color: LINE }, bottom: { style: BorderStyle.SINGLE, size: 4, color: LINE }, left: { style: BorderStyle.SINGLE, size: 4, color: LINE }, right: { style: BorderStyle.SINGLE, size: 4, color: LINE } };
const TC = (t, w, opts = {}) => new TableCell({
  width: { size: w, type: WidthType.DXA }, borders: cellB, margins: { top: 60, bottom: 60, left: 90, right: 90 },
  columnSpan: opts.span,
  shading: opts.fill ? { type: ShadingType.CLEAR, fill: opts.fill } : undefined,
  children: [new Paragraph({ children: [new TextRun({ text: String(t), size: opts.s || 18.5, bold: opts.b, color: opts.c || "333338" })] })],
});

function png(dataUrl) { return Uint8Array.from(atob(dataUrl.split(",")[1]), (c) => c.charCodeAt(0)); }

function pillarChart(pillars, scores) {
  const c = document.createElement("canvas"); c.width = 920; c.height = 430;
  const x = c.getContext("2d");
  x.fillStyle = "#ffffff"; x.fillRect(0, 0, 920, 430);
  const L = 70, B = 360, W = 800, H0 = 300;
  x.strokeStyle = "#" + LINE; x.lineWidth = 1;
  x.fillStyle = "#" + GREY; x.font = "15px Arial"; x.textAlign = "right";
  for (let v = 0; v <= 100; v += 25) {
    const y = B - (v / 100) * H0;
    x.beginPath(); x.moveTo(L, y); x.lineTo(L + W, y); x.stroke();
    x.fillText(String(v), L - 10, y + 5);
  }
  const bw = 90, gap = (W - pillars.length * bw) / (pillars.length + 1);
  x.textAlign = "center";
  pillars.forEach((p, i) => {
    const v = scores[p.id]; if (v == null) return;
    const bx = L + gap + i * (bw + gap), bh = (v / 100) * H0;
    x.fillStyle = "#" + TEAL; x.fillRect(bx, B - bh, bw, bh);
    x.fillStyle = "#" + INK; x.font = "bold 17px Arial"; x.fillText(String(v), bx + bw / 2, B - bh - 8);
    x.fillStyle = "#" + GREY; x.font = "14px Arial";
    x.fillText(p.short.length > 14 ? p.short.slice(0, 13) + "…" : p.short, bx + bw / 2, B + 22);
  });
  const by = B - 0.7 * H0;
  x.strokeStyle = "#" + CORAL; x.lineWidth = 3; x.setLineDash([9, 6]);
  x.beginPath(); x.moveTo(L, by); x.lineTo(L + W, by); x.stroke(); x.setLineDash([]);
  x.fillStyle = "#" + CORAL; x.font = "bold 15px Arial"; x.textAlign = "left";
  x.fillText("70 benchmark", L + W - 118, by - 8);
  return c.toDataURL("image/png");
}

function gapChart(rows) {
  const rh = 64, c = document.createElement("canvas"); c.width = 920; c.height = rows.length * rh + 60;
  const x = c.getContext("2d"); x.fillStyle = "#fff"; x.fillRect(0, 0, c.width, c.height);
  const L = 200, W = 620;
  x.font = "14px Arial";
  for (let v = 0; v <= 100; v += 25) {
    const gx = L + (v / 100) * W;
    x.strokeStyle = "#" + LINE; x.beginPath(); x.moveTo(gx, 20); x.lineTo(gx, c.height - 40); x.stroke();
    x.fillStyle = "#" + GREY; x.textAlign = "center"; x.fillText(String(v), gx, c.height - 18);
  }
  rows.forEach((r, i) => {
    const y = 40 + i * rh;
    x.fillStyle = "#" + INK; x.font = "bold 15px Arial"; x.textAlign = "left"; x.fillText(r.short, 16, y + 5);
    const x1 = L + (r.lo / 100) * W, x2 = L + (r.hi / 100) * W;
    x.strokeStyle = "#" + LINE; x.lineWidth = 5; x.beginPath(); x.moveTo(x1, y); x.lineTo(x2, y); x.stroke();
    x.fillStyle = "#" + CORAL; x.beginPath(); x.arc(x1, y, 9, 0, 7); x.fill();
    x.fillStyle = "#" + GREEN; x.beginPath(); x.arc(x2, y, 9, 0, 7); x.fill();
    x.fillStyle = "#" + GREY; x.font = "13px Arial";
    x.fillText(`${r.loName} ${r.lo}  →  ${r.hiName} ${r.hi}   Δ ${r.d} (on ${r.items} shared Qs)`, 16, y + 26);
  });
  return c.toDataURL("image/png");
}

const IMG = (dataUrl, w = 620, h = 290) => new Paragraph({
  spacing: { before: 60, after: 40 },
  children: [new ImageRun({ type: "png", data: png(dataUrl), transformation: { width: w, height: h } })],
});

const GLOSSARY = [
  ["Innovation Capability Index", "The weighted overall score (0–100) across the five pillars; the headline measure of innovation enablement."],
  ["Score bands", "Low (0–39): innovation enablement is absent and value is at risk. Medium (40–69): value is maintained but not compounded. High (70+): innovation builds value."],
  ["Anonymity threshold", "The minimum completed responses a stakeholder group needs before its results are shown anywhere (minimum 4). Below it, results stay suppressed to protect respondents."],
  ["Don't know / Not applicable (DK/NA)", "Answer options excluded from scores and tracked separately; patterned DK indicates information visibility, not disengagement."],
  ["Perception gap", "The score difference between two stakeholder groups on the same questions — computed only on shared items so it reflects perception, not questionnaire design."],
  ["Shared questions", "Questions served to both groups in a comparison; group-vs-group deltas use only these."],
  ["Finding classes", "Observed = directly visible in the data · Supported interpretation = several independent signals converge · Plausible hypothesis = credible, still requires validation."],
  ["Polarisation", "A wide spread (high standard deviation) on one question — the average conceals two different experiences of the organisation."],
  ["ISO 56001:2024", "The international requirements standard for innovation management systems; findings and interventions are tagged to its clauses to indicate readiness areas."],
];

const REFS = [
  "Crossan, M. M., & Apaydin, M. (2010). A multi-dimensional framework of organizational innovation. Journal of Management Studies, 47(6), 1154–1191.",
  "Edmondson, A. C. (1999). Psychological safety and learning behavior in work teams. Administrative Science Quarterly, 44(2), 350–383.",
  "ISO (2019). ISO 56002:2019 Innovation management system — Guidance. ISO.",
  "ISO (2024). ISO 56001:2024 Innovation management system — Requirements. ISO.",
  "O'Connor, G. C., & Ayers, A. D. (2019). Building organizational capacity for continuous innovation. Research-Technology Management, 62(3), 19–29.",
  "Pisano, G. P. (2015). You need an innovation strategy. Harvard Business Review, 93(6), 44–54.",
  "Teece, D. J. (2018). Dynamic capabilities and (digital) platform lifecycles. Oxford University Press.",
  "Tidd, J., & Bessant, J. (2018). Managing Innovation (6th ed.). Wiley.",
];

// snap: fs_reports row (with .snapshot); interps: [{scope,band,body}]
export async function generateWordReport(rep, interps) {
  const s = rep.snapshot;
  const interp = (scope, v) => interps.find((x) => x.scope === scope && x.band === bandOf(v))?.body || "";
  const pillars = s.pillars || [];
  const groups = s.groups || [];
  const visible = groups.filter((g) => !g.suppressed);
  const overall = s.overall && !s.overall.suppressed ? s.overall : null;
  const nameOf = (t) => (groups.find((g) => g.type === t)?.label) || GROUP_LBL[t] || t;
  const gapMap = s.questions ? bestGaps(s.questions, pillars, visible) : {};
  const gapRows = pillars.map((p) => {
    const e = gapMap[p.id]; if (!e) return null;
    return { short: p.short, hi: e.hi, lo: e.lo, d: e.d, items: e.items, hiName: nameOf(e.hiType), loName: nameOf(e.loType) };
  }).filter(Boolean).sort((a, b) => b.d - a.d);
  const findings = s.findings || [];
  const smalls = visible.filter((g) => g.n < MIN_N);

  const b = [];
  // ---- cover ----
  b.push(new Paragraph({ spacing: { before: 2200, after: 60 }, children: [new TextRun({ text: "INNOPULSE FULL-SCALE", bold: true, color: CORAL, size: 24, characterSpacing: 40 })] }));
  b.push(new Paragraph({ spacing: { after: 90 }, children: [new TextRun({ text: "Innovation Health Report", bold: true, color: INK, size: 56 })] }));
  b.push(P(`${s.org?.name || ""} — ${s.campaign?.name || ""}`, { s: 28, c: "44444a", after: 260 }));
  b.push(P(`Report version v${rep.version} · generated ${new Date(s.generated_at).toLocaleDateString()} · snapshot ${String(rep.checksum || "").slice(0, 12)}`, { c: GREY, s: 20 }));
  b.push(P(`Questionnaire ${rep.questionnaire_version ? "v" + rep.questionnaire_version : ""} · findings rulebook ${s.rulebook} · anonymity threshold ${s.campaign?.anonymity_threshold}`, { c: GREY, s: 20 }));
  b.push(P("CONFIDENTIAL — prepared by The Growth System. Results are reported for stakeholder groups only; no individual is identifiable in this document.", { c: GREY, s: 19, i: true, after: 0 }));
  b.push(new Paragraph({ children: [new PageBreak()] }));

  // ---- executive summary ----
  b.push(H("Executive summary"));
  if (overall) {
    b.push(P(`${s.org?.name || "The organisation"} achieved an overall Innovation Capability Index of ${overall.score} (${bandWord(overall.score)} band) from ${overall.n} valid responses across ${visible.length} stakeholder group${visible.length === 1 ? "" : "s"}. The benchmark at which innovation capability reliably builds organisational value is 70.`));
    b.push(P(interp("overall", overall.score)));
  } else {
    b.push(P("The overall index is suppressed: total responses have not yet passed the anonymity threshold."));
  }
  if (gapRows.length) b.push(P(`The widest stakeholder perception gap is ${gapRows[0].d} points on ${gapRows[0].short} (${gapRows[0].hiName} ${gapRows[0].hi} vs ${gapRows[0].loName} ${gapRows[0].lo}, measured on ${gapRows[0].items} shared questions).`));
  if (findings.length) {
    b.push(P(`${findings.length} reviewed finding${findings.length === 1 ? "" : "s"} are included in this report (unreviewed patterns are excluded by policy). The highest-priority findings:`, { b: true }));
    findings.slice(0, 3).forEach((f, i) => b.push(P(`${i + 1}. ${f.title} — ${f.klass}, confidence ${f.confidence}.`)));
  }
  if (smalls.length) b.push(P(`Interpretation caveat: ${smalls.map((g) => `${nameOf(g.type)} n=${g.n}`).join(", ")} — group comparisons below ${MIN_N} respondents are indicative rather than conclusive.`, { i: true, c: AMBER }));

  // ---- introduction (authored) ----
  if (s.client_context || s.engagement_objective) {
    b.push(H("Introduction"));
    if (s.client_context) b.push(P(s.client_context));
    if (s.engagement_objective) {
      b.push(P("Objective of this assessment", { b: true, after: 40 }));
      b.push(P(s.engagement_objective));
    }
  }

  // ---- model ----
  b.push(H("The InnoPulse model"));
  b.push(P("InnoPulse assesses organisational innovation capability across five interdependent pillars that form a value chain: Strategic Innovation Intent sets direction; Innovation Environment Management creates the conditions; Organisational Innovation Capability provides the skills and tools; Innovation Process Management carries ideas to implementation; and Return on Innovation measures and communicates the value created. Weakness in an upstream pillar typically caps the performance of everything downstream, which is why this report reads the five scores as one system rather than five numbers. The model aligns with the ISO 56000 series: ISO 56001:2024 clause references throughout indicate readiness areas, not certification."));

  // ---- methodology ----
  b.push(H("Methodology and sample"));
  const totTarget = groups.reduce((a, g) => a + (g.target_n || 0), 0);
  const totN = groups.reduce((a, g) => a + (g.n || 0), 0);
  b.push(P(`Data was collected through the InnoPulse Full-Scale platform using signed, stakeholder-coded links${s.campaign?.closes_at ? `, with the collection window closing ${new Date(s.campaign.closes_at).toLocaleDateString()}` : ""}. Each stakeholder group answered the question set written for its vantage point; cross-group comparisons in this report use only questions shared by the groups compared. Responses are anonymous by design: no name, email or device identity is stored with answers. "Don't know" and "Not applicable" answers are excluded from scores and tracked as a data-quality signal. Groups below the anonymity threshold of ${s.campaign?.anonymity_threshold} completed responses are suppressed everywhere.`));
  const mrows = [new TableRow({ children: [TC("Stakeholder group", 2800, { b: true, fill: "F4F1EC" }), TC("Responses", 1500, { b: true, fill: "F4F1EC" }), TC("Target", 1500, { b: true, fill: "F4F1EC" }), TC("Status", 3000, { b: true, fill: "F4F1EC" })] })];
  groups.forEach((g) => mrows.push(new TableRow({ children: [TC(nameOf(g.type), 2800), TC(g.n ?? 0, 1500), TC(g.target_n || "—", 1500), TC(g.suppressed ? "Suppressed (below threshold)" : "Reported", 3000, { c: g.suppressed ? GREY : GREEN })] })));
  mrows.push(new TableRow({ children: [TC("Total", 2800, { b: true }), TC(totN, 1500, { b: true }), TC(totTarget || "—", 1500, { b: true }), TC(totTarget ? Math.round((totN / totTarget) * 100) + "% of target" : "", 3000)] }));
  b.push(new Table({ columnWidths: [2800, 1500, 1500, 3000], width: { size: 8800, type: WidthType.DXA }, rows: mrows }));
  b.push(CAP("Table 1: Participation by stakeholder group."));

  // ---- overall results ----
  b.push(new Paragraph({ children: [new PageBreak()] }));
  b.push(H("Overall results"));
  if (overall) {
    b.push(P(`Overall Innovation Capability Index: ${overall.score} — ${bandWord(overall.score)}.`, { b: true, s: 24 }));
    b.push(IMG(pillarChart(pillars, overall.pillars), 620, 290));
    b.push(CAP("Figure 1: Pillar scores against the 70-point benchmark (weighted overall shown in the executive summary)."));
    b.push(P(interp("overall", overall.score)));
  } else b.push(P("Suppressed pending sufficient responses."));

  // ---- gaps ----
  b.push(H("Stakeholder perception analysis"));
  if (gapRows.length) {
    b.push(IMG(gapChart(gapRows), 620, Math.min(320, gapRows.length * 46 + 40)));
    b.push(CAP("Figure 2: Widest perception gap per pillar, computed on shared questions only."));
    b.push(P("Gaps of this kind rarely mean one group is wrong; they usually mean the groups are describing different objects — policy as designed versus practice as experienced, or work as visible from the top versus as lived below. Where a gap exceeds 25 points the relevant finding in the register sets out competing explanations and the validation step to run before acting."));
  } else b.push(P("Not enough visible groups (or shared questions) yet for a fair comparison."));

  // ---- segment cuts (Step 4; threshold-protected) ----
  const segs = (s.segments || []).filter((x) => !x.info);
  if (segs.length) {
    b.push(H("Results by segment"));
    b.push(P("Respondents could optionally declare their department or area. Cuts below the anonymity threshold are suppressed; the segment question is always optional, so totals may not sum to all responses."));
    const sw = 2400, nw = 900, cw = Math.floor(4600 / pillars.length), ow = 900;
    const rows = [new TableRow({ children: [TC("Segment", sw, { b: true, fill: "F4F1EC" }), TC("n", nw, { b: true, fill: "F4F1EC" }), ...pillars.map((p) => TC(p.short.split(" ")[0], cw, { b: true, fill: "F4F1EC" })), TC("Index", ow, { b: true, fill: "F4F1EC" })] })];
    segs.forEach((sg) => rows.push(new TableRow({
      children: sg.suppressed
        ? [TC(sg.name, sw), TC(sg.n, nw), TC("Suppressed — below the anonymity threshold", cw * pillars.length + ow, { c: GREY, span: pillars.length + 1 })]
        : [TC(sg.name, sw), TC(sg.n, nw), ...pillars.map((p) => TC(sg.pillars?.[p.id] ?? "—", cw)), TC(sg.score ?? "—", ow, { b: true })],
    })));
    const nd = (s.segments || []).find((x) => x.info);
    if (nd) rows.push(new TableRow({ children: [TC("Not declared", sw, { c: GREY }), TC(nd.n, nw, { c: GREY }), TC("—", cw * pillars.length + ow, { c: GREY, span: pillars.length + 1 })] }));
    b.push(new Table({ columnWidths: [sw, nw, ...pillars.map(() => cw), ow], width: { size: sw + nw + cw * pillars.length + ow, type: WidthType.DXA }, rows }));
    b.push(CAP("Table: Pillar scores and index by self-declared segment (threshold-protected)."));
  }

  // ---- pillar chapters ----
  for (const p of pillars) {
    b.push(new Paragraph({ children: [new PageBreak()] }));
    const v = overall?.pillars?.[p.id];
    b.push(H(p.name));
    if (v != null) {
      b.push(new Paragraph({ spacing: { after: 90 }, children: [new TextRun({ text: `Score ${v} · ${bandWord(v)}`, bold: true, size: 24, color: bandCol(v) }), new TextRun({ text: `   (weight ${Math.round(p.weight * 100)}% of the overall index)`, size: 19, color: GREY })] }));
      b.push(P(interp(p.id, v)));
    } else b.push(P("This pillar's overall score is suppressed pending sufficient responses."));
    const gp = gapMap[p.id];
    if (gp) b.push(P(`Perception gap: ${nameOf(gp.hiType)} ${gp.hi} vs ${nameOf(gp.loType)} ${gp.lo} — Δ ${gp.d} points on ${gp.items} shared questions.`, { i: true }));
    const qs = (s.questions || []).filter((q) => q.pillar === p.id);
    if (qs.length && visible.length) {
      const types = visible.map((g) => g.type);
      const qw = 4600, cw = Math.floor(4200 / types.length);
      const rows = [new TableRow({ children: [TC("Question", qw, { b: true, fill: "F4F1EC" }), ...types.map((t) => TC(nameOf(t), cw, { b: true, fill: "F4F1EC" }))] })];
      qs.forEach((q) => rows.push(new TableRow({ children: [TC(q.text.length > 92 ? q.text.slice(0, 90) + "…" : q.text, qw, { s: 17 }), ...types.map((t) => { const e = q.groups?.[t]; return TC(e && e.mean != null ? e.mean : (q.audience && !q.audience.includes(t) ? "n/s" : "—"), cw, { s: 17 }); })] })));
      b.push(new Table({ columnWidths: [qw, ...types.map(() => cw)], width: { size: qw + cw * types.length, type: WidthType.DXA }, rows }));
      b.push(CAP(`Table: ${p.short} question-level means per stakeholder group (n/s = not served to that group).`));
    }
    const pfShow = findings.filter((f) => f.evidence?.some((e) => e.toLowerCase().includes(p.id + "_")));
    pfShow.forEach((f) => {
      b.push(P(`Reviewed finding — ${f.title} (${f.klass}, confidence ${f.confidence})`, { b: true }));
      b.push(P(f.text));
    });
    // analyst summary of written responses (authored, Step 3)
    if (s.pillar_notes?.[p.id]) {
      b.push(P("Summary of written responses", { b: true, after: 40 }));
      b.push(P(s.pillar_notes[p.id]));
    }
    // curated verbatims (selected via "Add to report"; group-attributed only)
    const vbs = (s.verbatims || []).filter((v2) => v2.pillar === p.id);
    if (vbs.length) {
      b.push(P("Stakeholder voice — selected verbatim comments", { b: true, after: 40 }));
      vbs.forEach((v2) => {
        b.push(new Paragraph({
          spacing: { after: 70, line: 270 }, indent: { left: 340 },
          border: { left: { style: BorderStyle.SINGLE, size: 14, color: CORAL, space: 8 } },
          children: [
            new TextRun({ text: `“${v2.body}”`, italics: true, size: 20, color: "3a3a40" }),
            new TextRun({ text: `  — ${v2.group_label || GROUP_LBL[v2.group_type] || "Stakeholder"}, anonymous`, size: 18, color: GREY }),
          ],
        }));
      });
      b.push(P("Verbatims are reproduced as written and attributed to stakeholder group only; they are included by analyst selection from groups above the anonymity threshold.", { i: true, c: GREY, s: 18 }));
    }
  }

  // ---- findings register ----
  b.push(new Paragraph({ children: [new PageBreak()] }));
  b.push(H("Findings register (reviewed)"));
  if (!findings.length) b.push(P("No findings were approved for this report version."));
  findings.forEach((f, i) => {
    b.push(P(`${i + 1}. ${f.title}`, { b: true, s: 22 }));
    b.push(P(`${f.klass} · confidence ${f.confidence}${f.iso ? ` · ISO 56001 ${f.iso}` : ""}`, { c: GREY, s: 19 }));
    b.push(P(f.text));
    if (f.trigger) b.push(P(`Fired when: ${f.trigger}`, { c: GREY, s: 19 }));
    b.push(P(`Evidence: ${(f.evidence || []).join("  ")}`, { c: GREY, s: 18 }));
    b.push(P(`Also consider: ${f.alternatives}`, { s: 19 }));
    b.push(P(`Validate next: ${f.validate}`, { s: 19, after: 160 }));
  });

  // ---- conclusion, glossary, references ----
  b.push(H("Conclusion"));
  b.push(P(overall
    ? `At ${overall.score}, ${s.org?.name || "the organisation"} sits in the ${bandWord(overall.score)} band. ${overall.score < 70 ? "The path to the 70-point value-building benchmark runs through the reviewed findings above: each names its evidence, its alternative explanations and the validation step that turns a pattern into a decision." : "The task now is protection and ambition: keep the disciplines that built this score, and use their credibility to fund longer-horizon innovation."} Re-measurement after the intervention horizon will convert this baseline into a trend.`
    : "This report establishes the assessment baseline; conclusions follow once groups pass the anonymity threshold."));
  b.push(new Paragraph({ children: [new PageBreak()] }));
  b.push(H("Glossary"));
  GLOSSARY.forEach(([k, v2]) => b.push(new Paragraph({ spacing: { after: 70, line: 268 }, children: [new TextRun({ text: k + " — ", bold: true, size: 20, color: INK }), new TextRun({ text: v2, size: 20, color: "333338" })] })));
  b.push(H("References"));
  REFS.forEach((r) => b.push(P(r, { s: 19, after: 55 })));
  b.push(P(`Document control: generated from immutable snapshot ${String(rep.checksum || "").slice(0, 12)} (report v${rep.version}) · interpretation library v1 · findings rulebook ${s.rulebook}. Regeneration from the same snapshot reproduces this document; new data requires a new report version.`, { i: true, c: GREY, s: 18 }));

  const doc = new Document({
    styles: { default: { document: { run: { font: "Calibri", size: 21, color: INK } } } },
    sections: [{
      properties: { page: { size: { width: 11906, height: 16838 }, margin: { top: 1100, bottom: 1100, left: 1250, right: 1250 } } },
      footers: { default: new Footer({ children: [new Paragraph({ alignment: AlignmentType.CENTER, children: [new TextRun({ text: `${s.org?.name || ""} · Innovation Health Report v${rep.version} · CONFIDENTIAL · page `, size: 16, color: GREY }), new TextRun({ children: [PageNumber.CURRENT], size: 16, color: GREY })] })] }) },
      children: b,
    }],
  });
  const blob = await Packer.toBlob(doc);
  const a = document.createElement("a");
  a.href = URL.createObjectURL(blob);
  a.download = `${(s.campaign?.name || "campaign").replace(/[^\w]+/g, "-")}-Innovation-Health-Report-v${rep.version}.docx`;
  a.click();
  URL.revokeObjectURL(a.href);
}
