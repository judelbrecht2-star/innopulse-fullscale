"use client";
import { useEffect, useState } from "react";
import { DEMO_DIMS } from "../lib/demographics";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";

const steps = [
  "Objective",
  "Stakeholders",
  "Questionnaire",
  "Privacy",
  "Review",
];
const groups = [
  ["executive", "Executives & leadership", 5],
  ["employee", "Employees", 20],
  ["customer", "Customers", 10],
  ["partner", "Partners", 5],
  ["other", "Other stakeholders", 5],
];
export function validateSetup(f, step) {
  if (step === 0 && (!f.name.trim() || !f.objective.trim()))
    return "Give the assessment a name and a clear objective.";
  if (
    step === 0 &&
    (!Number.isInteger(+f.days) || +f.days < 1 || +f.days > 365)
  )
    return "Choose a collection window of 1–365 days.";
  if (
    step === 1 &&
    (!f.groups.some((g) => g.on) ||
      f.groups.some(
        (g) =>
          g.on &&
          (!g.label.trim() ||
            !Number.isInteger(+g.target) ||
            +g.target < 1 ||
            +g.target > 100000),
      ))
  )
    return "Select at least one audience and give each a name and a positive target.";
  if (step === 2 && !f.questionnaire) return "Choose a questionnaire.";
  if (
    step === 3 &&
    (!Number.isInteger(+f.threshold) || +f.threshold < 4 || +f.threshold > 1000)
  )
    return "Choose a privacy threshold between 4 and 1,000.";
  if (
    step === 3 &&
    DEMO_DIMS.some(
      (d) =>
        f.dims[d.id] &&
        d.custom &&
        !(d.id === "language" && !f.options[d.id]) &&
        new Set(
          String(f.options[d.id] || "")
            .split(",")
            .map((x) => x.trim())
            .filter(Boolean),
        ).size < 2,
    )
  )
    return "Give every custom demographic at least two comma-separated options.";
  return "";
}
export default function SetupWizard({
  org,
  user,
  versions,
  settings,
  onCreate,
}) {
  const key = `innopulse:setup:${user.id}:${org.id}`;
  const defaults = () => ({
    name: "",
    objective: "",
    days: settings?.default_campaign_duration_days || 30,
    threshold: settings?.default_score_threshold || 5,
    questionnaire:
      versions.find((v) => v.id === settings?.default_questionnaire_version_id)
        ?.id ||
      versions[0]?.id ||
      "",
    sandbox: false,
    groups: groups.map(([type, label, target]) => ({
      type,
      label,
      target,
      on: type !== "other",
    })),
    dims: {},
    options: {},
  });
  const [f, setF] = useState(defaults),
    [step, setStep] = useState(0),
    [ready, setReady] = useState(false),
    [remember, setRemember] = useState(true),
    [notice, setNotice] = useState(""),
    [error, setError] = useState(""),
    [busy, setBusy] = useState(false);
  useEffect(() => {
    try {
      const saved = JSON.parse(localStorage.getItem(key) || "null");
      if (
        saved?.version === 1 &&
        saved.form &&
        typeof saved.form.name === "string"
      ) {
        const p = saved.form,
          d = defaults();
        setF({
          ...d,
          name: p.name.slice(0, 160),
          objective: String(p.objective || "").slice(0, 2000),
          days: String(p.days).slice(0, 3),
          threshold: String(p.threshold).slice(0, 4),
          sandbox: p.sandbox === true,
          questionnaire: versions.some((v) => v.id === p.questionnaire)
            ? p.questionnaire
            : d.questionnaire,
          groups: d.groups.map((g) => {
            const s =
              Array.isArray(p.groups) &&
              p.groups.find((x) => x.type === g.type);
            return s
              ? {
                  ...g,
                  on: s.on === true,
                  label: String(s.label).slice(0, 100),
                  target: String(s.target).slice(0, 6),
                }
              : g;
          }),
          dims: Object.fromEntries(
            DEMO_DIMS.map((d) => [d.id, p.dims?.[d.id] === true]),
          ),
          options: Object.fromEntries(
            DEMO_DIMS.map((d) => [
              d.id,
              String(p.options?.[d.id] || "").slice(0, 1000),
            ]),
          ),
        });
        setNotice("Your unfinished setup was restored on this device.");
      }
    } catch {
      setNotice(
        "Device storage is unavailable. Keep this page open until you finish.",
      );
    }
    setReady(true);
  }, [key]); // eslint-disable-line react-hooks/exhaustive-deps
  useEffect(() => {
    if (!ready || busy) return;
    const timer = setTimeout(() => {
      try {
        if (remember)
          localStorage.setItem(key, JSON.stringify({ version: 1, form: f }));
        else localStorage.removeItem(key);
      } catch {
        setNotice("Your setup could not be saved on this device.");
      }
    }, 400);
    return () => clearTimeout(timer);
  }, [ready, f, remember, key, busy]);
  const set = (name) => (e) => setF((p) => ({ ...p, [name]: e.target.value }));
  async function advance(e) {
    e.preventDefault();
    const invalid =
      step === 4
        ? [0, 1, 2, 3].map((s) => validateSetup(f, s)).find(Boolean)
        : validateSetup(f, step);
    setError(invalid || "");
    if (invalid) return;
    if (step < 4) {
      setStep(step + 1);
      return;
    }
    setBusy(true);
    try {
      await onCreate({
        p_org: org.id,
        p_name: f.name.trim(),
        p_objective: f.objective.trim(),
        p_days: +f.days,
        p_threshold: +f.threshold,
        p_qv: f.questionnaire,
        p_is_sandbox: f.sandbox,
        p_groups: f.groups
          .filter((g) => g.on)
          .map(({ type, label, target }) => ({
            type,
            label: label.trim(),
            target: +target,
          })),
        p_demographics: DEMO_DIMS.filter((d) => f.dims[d.id]).map((d) => ({
          id: d.id,
          label: d.label,
          question: d.question,
          options:
            d.custom && f.options[d.id]?.trim()
              ? [
                  ...new Set(
                    f.options[d.id]
                      .split(",")
                      .map((x) => x.trim())
                      .filter(Boolean),
                  ),
                ].slice(0, 20)
              : d.options,
        })),
      });
      try {
        localStorage.removeItem(key);
      } catch {}
    } catch (ex) {
      setError(
        ex.message ||
          "Could not create your assessment. Your setup is still here.",
      );
      setBusy(false);
    }
  }
  return (
    <div className="guide-layout">
      <ol className="guide-steps">
        {steps.map((s, i) => (
          <li key={s}>
            <button
              type="button"
              disabled={i > step || busy}
              aria-current={i === step ? "step" : undefined}
              onClick={() => {
                setStep(i);
                setError("");
              }}
            >
              <span>{i < step ? "✓" : i + 1}</span>
              <div>
                <b>{s}</b>
                <small>
                  {i < step ? "Reviewed" : i === step ? "In progress" : "Next"}
                </small>
              </div>
            </button>
          </li>
        ))}
      </ol>
      <form className="card guide-panel" onSubmit={advance}>
        <fieldset
          disabled={busy}
          style={{ border: 0, padding: 0, minWidth: 0 }}
        >
          <p className="eyebrow">STEP {step + 1} OF 5</p>
          <h2>{steps[step]}</h2>
          <p className="small muted">{notice}</p>
          {step === 0 && (
            <>
              <label className="f" htmlFor="assessment-name">
                Assessment name
              </label>
              <Input
                id="assessment-name"
                maxLength={160}
                value={f.name}
                onChange={set("name")}
                placeholder="2026 innovation health check"
              />
              <label className="f" htmlFor="assessment-objective">
                What decision should this assessment help you make?
              </label>
              <Textarea
                id="assessment-objective"
                maxLength={2000}
                value={f.objective}
                onChange={set("objective")}
                placeholder="Establish our innovation baseline and identify our next three priorities."
              />
              <label className="f" htmlFor="assessment-days">
                Collection window in days
              </label>
              <Input
                id="assessment-days"
                type="number"
                min="1"
                max="365"
                value={f.days}
                onChange={set("days")}
              />
              <label className="choice-card">
                <input
                  type="checkbox"
                  checked={f.sandbox}
                  onChange={(e) =>
                    setF((p) => ({ ...p, sandbox: e.target.checked }))
                  }
                />
                <span>
                  <b>Use a sandbox</b>
                  <small>
                    For fabricated test responses. Official reports are blocked.
                  </small>
                </span>
              </label>
            </>
          )}
          {step === 1 && (
            <>
              <p className="muted">
                Who needs a voice? Each selected audience gets a separate
                assessment link.
              </p>
              {f.groups.map((g, i) => (
                <div className="choice-card" key={g.type}>
                  <label>
                    <input
                      type="checkbox"
                      checked={g.on}
                      onChange={(e) =>
                        setF((p) => ({
                          ...p,
                          groups: p.groups.map((x, j) =>
                            j === i ? { ...x, on: e.target.checked } : x,
                          ),
                        }))
                      }
                    />{" "}
                    {g.type === "other" ? "Other stakeholders" : g.label}
                  </label>
                  {g.on && (
                    <div className="guide-fields">
                      {g.type === "other" && (
                        <label>
                          Audience name
                          <Input
                            maxLength={100}
                            value={g.label}
                            onChange={(e) =>
                              setF((p) => ({
                                ...p,
                                groups: p.groups.map((x, j) =>
                                  j === i ? { ...x, label: e.target.value } : x,
                                ),
                              }))
                            }
                          />
                        </label>
                      )}
                      <label>
                        Response target
                        <Input
                          type="number"
                          min="1"
                          max="100000"
                          value={g.target}
                          onChange={(e) =>
                            setF((p) => ({
                              ...p,
                              groups: p.groups.map((x, j) =>
                                j === i ? { ...x, target: e.target.value } : x,
                              ),
                            }))
                          }
                        />
                      </label>
                    </div>
                  )}
                </div>
              ))}
            </>
          )}
          {step === 2 && (
            <>
              <label className="f" htmlFor="assessment-questionnaire">
                Questionnaire version
              </label>
              <select
                className="completion-select"
                id="assessment-questionnaire"
                value={f.questionnaire}
                onChange={set("questionnaire")}
              >
                {versions.map((v) => (
                  <option key={v.id} value={v.id}>
                    Version {v.version}
                    {v.version === "1.0"
                      ? " · classic"
                      : " · stakeholder tailored"}
                  </option>
                ))}
              </select>
              <p className="guide-info">
                Tailored questionnaires give each audience relevant questions.
                Comparisons use shared questions so differences remain
                meaningful.
              </p>
            </>
          )}
          {step === 3 && (
            <>
              <label className="f" htmlFor="assessment-threshold">
                Minimum responses per visible group
              </label>
              <Input
                id="assessment-threshold"
                type="number"
                min="4"
                max="1000"
                value={f.threshold}
                onChange={set("threshold")}
              />
              <p className="guide-info">
                Groups below this threshold stay hidden. Written comments have a
                separate minimum of at least{" "}
                {Math.max(
                  +f.threshold || 4,
                  settings?.default_comment_threshold || 10,
                )}{" "}
                respondents. Small comparison groups also receive privacy
                protection.
              </p>
              <h3>Optional demographic questions</h3>
              <p className="small muted">
                Respondents can always choose “Prefer not to say”. Select only
                details you need.
              </p>
              {DEMO_DIMS.map((d) => (
                <div className="choice-card" key={d.id}>
                  <label>
                    <input
                      type="checkbox"
                      checked={!!f.dims[d.id]}
                      onChange={(e) =>
                        setF((p) => ({
                          ...p,
                          dims: { ...p.dims, [d.id]: e.target.checked },
                        }))
                      }
                    />{" "}
                    {d.label}
                  </label>
                  {d.custom && f.dims[d.id] && (
                    <label className="small">
                      Options, separated by commas
                      <Input
                        value={f.options[d.id] || ""}
                        maxLength={1000}
                        onChange={(e) =>
                          setF((p) => ({
                            ...p,
                            options: { ...p.options, [d.id]: e.target.value },
                          }))
                        }
                        placeholder={d.placeholder}
                      />
                    </label>
                  )}
                </div>
              ))}
            </>
          )}
          {step === 4 && (
            <>
              <h3>{f.name}</h3>
              <p>{f.objective}</p>
              <dl className="review-grid">
                <div>
                  <dt>Workspace</dt>
                  <dd>{org.name}</dd>
                </div>
                <div>
                  <dt>Collection</dt>
                  <dd>{f.days} days</dd>
                </div>
                <div>
                  <dt>Questionnaire</dt>
                  <dd>
                    Version{" "}
                    {versions.find((v) => v.id === f.questionnaire)?.version}
                  </dd>
                </div>
                <div>
                  <dt>Privacy</dt>
                  <dd>{f.threshold} responses per group</dd>
                </div>
              </dl>
              {f.groups
                .filter((g) => g.on)
                .map((g) => (
                  <p key={g.type}>
                    {g.label} · target {g.target}
                    {+g.target < +f.threshold
                      ? " · below the privacy threshold"
                      : ""}
                  </p>
                ))}
              <p className="guide-info">
                This creates a {f.sandbox ? "sandbox" : "draft"} assessment.
                Review its links and settings before opening collection.
              </p>
            </>
          )}
          {error && (
            <div role="alert" className="err">
              {error}
            </div>
          )}
          <div className="guide-controls">
            {step > 0 && (
              <Button
                type="button"
                variant="outline"
                onClick={() => {
                  setStep(step - 1);
                  setError("");
                }}
              >
                Back
              </Button>
            )}
            <Button>
              {busy
                ? "Creating…"
                : step === 4
                  ? "Create assessment draft"
                  : "Continue"}
            </Button>
          </div>
          <label className="small guide-remember">
            <input
              type="checkbox"
              checked={remember}
              onChange={(e) => setRemember(e.target.checked)}
            />{" "}
            Save unfinished setup on this device
          </label>
        </fieldset>
      </form>
    </div>
  );
}
