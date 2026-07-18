"use client";
// Collapsible legend explaining the finding tags (evidence class, confidence,
// priority, ISO 56001 clause). Used on /insights and /insights/findings.

const ISO_CLAUSES = [
  ["4", "Context of the organisation"],
  ["5", "Leadership"],
  ["6", "Planning"],
  ["7", "Support"],
  ["8", "Operation"],
  ["9", "Performance evaluation"],
  ["10", "Improvement"],
];

export default function TagGlossary({ open = false }) {
  return (
    <details open={open} style={{ border: "1px solid var(--line)", borderRadius: 12, padding: "10px 16px", margin: "12px 0", background: "#fdfbf7" }}>
      <summary style={{ cursor: "pointer", fontWeight: 600, fontSize: 13.5, listStyle: "none", display: "flex", alignItems: "center", gap: 8 }}>
        <span style={{ fontSize: 15 }}>ⓘ</span> How to read the tags
        <span className="small muted" style={{ fontWeight: 400 }}>— evidence class · confidence · priority · ISO 56001</span>
      </summary>

      <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(260px, 1fr))", gap: "14px 22px", marginTop: 12 }}>
        <div>
          <div className="small" style={{ fontWeight: 700, marginBottom: 6 }}>Evidence class — how solid is it?</div>
          <p className="small" style={{ margin: "0 0 6px", lineHeight: 1.55 }}>
            <span className="pill teal">Observed finding</span><br />
            Measured directly in the numbers (participation, don&apos;t-know rates, score
            levels). No interpretation involved — the strongest class.
          </p>
          <p className="small" style={{ margin: "0 0 6px", lineHeight: 1.55 }}>
            <span className="pill draft">Supported interpretation</span><br />
            A consistent pattern across several questions, read through a well-documented
            organisational dynamic. Grounded, but it is a reading of the data.
          </p>
          <p className="small" style={{ margin: 0, lineHeight: 1.55 }}>
            <span className="pill closed">Plausible hypothesis</span><br />
            A credible explanation the data hints at but cannot prove. Treat it as a
            question to investigate, never as a conclusion.
          </p>
        </div>

        <div>
          <div className="small" style={{ fontWeight: 700, marginBottom: 6 }}>Confidence — how robust is the evidence?</div>
          <p className="small" style={{ margin: 0, lineHeight: 1.7 }}>
            <b>High</b> — strong, consistent signal on a sufficient sample.<br />
            <b>Medium-High</b> — clear signal with a caveat (small sample or few questions).<br />
            <b>Medium</b> — indicative only; verify before acting on it.<br />
            <span className="muted">Confidence describes robustness of the evidence, not how important
            the finding is — a Medium finding can still be the most consequential one.</span>
          </p>
          <div className="small" style={{ fontWeight: 700, margin: "12px 0 6px" }}>Priority — how soon to act?</div>
          <p className="small" style={{ margin: 0, lineHeight: 1.7 }}>
            <span className="legend-dot" style={{ background: "var(--primary)" }} /><b>P3 · Urgent</b> — address in this cycle; it undermines other results.<br />
            <span className="legend-dot" style={{ background: "var(--amber, #b7791f)" }} /><b>P2 · Material</b> — plan a deliberate response.<br />
            <span className="legend-dot" style={{ background: "var(--muted)" }} /><b>P1 · Monitor</b> — keep on the watch-list and re-test next cycle.
          </p>
        </div>

        <div>
          <div className="small" style={{ fontWeight: 700, marginBottom: 6 }}>ISO 56001 — where it lands in the standard</div>
          <p className="small" style={{ margin: "0 0 8px", lineHeight: 1.55 }}>
            <span className="pill violet">ISO Clause 9 · Performance evaluation</span><br />
            Maps the finding to the clause of <b>ISO 56001:2024</b> (the international
            innovation-management-system standard) it affects — useful when the assessment
            feeds a readiness or certification conversation.
          </p>
          <p className="small muted" style={{ margin: 0, lineHeight: 1.65 }}>
            {ISO_CLAUSES.map(([n, t], i) => (
              <span key={n}>{n} {t}{i < ISO_CLAUSES.length - 1 ? " · " : ""}</span>
            ))}
          </p>
          <div className="small" style={{ fontWeight: 700, margin: "12px 0 6px" }}>Score bands</div>
          <p className="small" style={{ margin: 0, lineHeight: 1.65 }}>
            <span className="legend-dot" style={{ background: "var(--band-low)" }} />Low &lt; 40
            <span className="legend-dot" style={{ background: "var(--band-med)", marginLeft: 12 }} />Medium 40–69
            <span className="legend-dot" style={{ background: "var(--band-high)", marginLeft: 12 }} />High 70+
            <br /><span className="muted">Scores are 0–100 index points, not percentages of people.</span>
          </p>
        </div>
      </div>
    </details>
  );
}
