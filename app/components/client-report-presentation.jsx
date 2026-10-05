"use client";
import { useState } from "react";
import Link from "next/link";
import { safeBranding } from "../lib/completion";
import { groupName } from "../ui";
import { generateWordReport } from "../lib/reportgen";
import { Button } from "@/components/ui/button";
export default function ClientReportPresentation({ report }) {
  const [error, setError] = useState(""),
    [busy, setBusy] = useState(false);
  const s = report.snapshot,
    b = safeBranding(s.branding),
    overall = s.overall && !s.overall.suppressed ? s.overall : null;
  return (
    <main className="client-report" style={{ "--report-accent": b.accent }}>
      {error && (
        <p role="alert" className="err">
          {error}
        </p>
      )}
      <nav className="client-tools no-print">
        <Link href="/reports">← Reports</Link>
        <div>
          <Button variant="outline" onClick={() => window.print()}>
            Print / save PDF
          </Button>{" "}
          <Button
            disabled={busy}
            onClick={async () => {
              setBusy(true);
              try {
                await generateWordReport(report, s.interpretations || []);
              } catch (ex) {
                setError(ex.message);
              }
              setBusy(false);
            }}
          >
            Word document
          </Button>
        </div>
      </nav>
      <header className="client-cover">
        {b.logo && (
          <img
            src={b.logo}
            alt={`${s.org?.name || "Organisation"} logo`}
            className="report-logo"
          />
        )}
        <p className="eyebrow">
          INNOVATION CAPABILITY ASSESSMENT · VERSION {report.version}
        </p>
        <h1>{s.org?.name || "Innovation assessment"}</h1>
        <p className="lead">{s.campaign?.name}</p>
        <div className="client-meta">
          <span>
            {report.approval_state === "issued" ? "Issued" : "Approved"}{" "}
            {new Date(
              report.issued_at || report.approved_at,
            ).toLocaleDateString()}
          </span>
          <span>Confidential · Workspace members only</span>
        </div>
        {s.engagement_objective && (
          <p className="client-objective">{s.engagement_objective}</p>
        )}
      </header>
      <section className="client-section">
        <p className="eyebrow">THE OVERVIEW</p>
        <h2>Your innovation capability</h2>
        {s.client_context && <p>{s.client_context}</p>}
        <div className="client-score">
          <strong>{overall?.score ?? "—"}</strong>
          <div>
            <h3>Overall score / 100</h3>
            <p>
              {overall
                ? "A baseline for the capabilities your stakeholders experience."
                : "Results remain protected until enough responses are available."}
            </p>
          </div>
        </div>
        <div className="client-pillars">
          {(s.pillars || []).map((p) => (
            <div key={p.id}>
              <div className="score-label">
                <b>{p.name}</b>
                <span>{overall?.pillars?.[p.id] ?? "Protected"}</span>
              </div>
              <div className="score-track">
                <span
                  style={{
                    width: `${Math.max(0, Math.min(100, overall?.pillars?.[p.id] || 0))}%`,
                  }}
                />
              </div>
              {s.pillar_notes?.[p.id] && <p>{s.pillar_notes[p.id]}</p>}
            </div>
          ))}
        </div>
      </section>
      <section className="client-section">
        <p className="eyebrow">WHAT THE EVIDENCE SHOWS</p>
        <h2>Reviewed findings</h2>
        {(s.findings || []).length ? (
          s.findings.map((f, i) => (
            <article className="client-finding" key={f.id}>
              <span className="eyebrow">
                {i + 1} · {f.klass} · {f.confidence}
              </span>
              <h3>{f.title}</h3>
              <p>{f.text}</p>
              {f.evidence?.length > 0 && (
                <p className="small muted">Evidence: {f.evidence.join(" ")}</p>
              )}
              <p className="small">
                <b>Validate next:</b> {f.validate}
              </p>
              {f.analyst?.contradictory && (
                <p className="small">
                  <b>Counter-evidence:</b> {f.analyst.contradictory}
                </p>
              )}
            </article>
          ))
        ) : (
          <p>No findings were accepted into this saved version.</p>
        )}
      </section>
      <section className="client-section">
        <p className="eyebrow">TURN INSIGHT INTO ACTION</p>
        <h2>The agreed action plan</h2>
        {s.actions?.length ? (
          s.actions.map((a) => (
            <article className="client-finding" key={a.id}>
              <h3>{a.title}</h3>
              <p className="small">
                {a.owner || "Owner to be agreed"} ·{" "}
                {a.due_on ? `Due ${a.due_on}` : "Date to be agreed"} ·{" "}
                {a.status.replaceAll("_", " ")}
              </p>
              {a.notes && <p>{a.notes}</p>}
            </article>
          ))
        ) : (
          <p>
            The team had not saved an action plan when this version was
            generated.
          </p>
        )}
      </section>
      <section className="client-section">
        <h2>Participation and methodology</h2>
        <div className="completion-table">
          <table>
            <thead>
              <tr>
                <th>Stakeholder group</th>
                <th>Responses</th>
                <th>Result visibility</th>
              </tr>
            </thead>
            <tbody>
              {(s.groups || []).map((g) => (
                <tr key={g.id || g.type}>
                  <td>{groupName(g)}</td>
                  <td>{g.n}</td>
                  <td>{g.suppressed ? "Protected" : "Visible"}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
        <p className="small muted">
          Scores summarise stakeholder perceptions. They do not establish
          causality or certify compliance. Small groups and comparison cuts are
          suppressed to protect respondents. Only reviewed findings are
          included. Written comments receive separate privacy protection.
        </p>
        <p className="small muted">
          Generated{" "}
          {new Date(s.generated_at || report.created_at).toLocaleDateString()} ·
          Rulebook {s.rulebook || "recorded in source assessment"} · Snapshot{" "}
          {report.checksum}
        </p>
      </section>
      <footer>
        {b.footer || "InnoPulse · The Growth System"}
        <p className="small muted">
          This presentation uses the saved version. Later responses and action
          updates require a new report.
        </p>
      </footer>
    </main>
  );
}
