"use client";
import { useEffect, useMemo, useRef, useState } from "react";
import { useParams } from "next/navigation";
import { FN_BASE } from "../../../lib/supabase";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import { NativeSelect, NativeSelectOption } from "@/components/ui/native-select";
import { Check } from "iconoir-react";
import { restoreDraft, missingQuestions } from "../../lib/respondent-draft";

export default function Respond() {
  const { token } = useParams();
  const [state, setState] = useState("loading"); // loading | intro | form | sending | done | error
  const [err, setErr] = useState("");
  const [data, setData] = useState(null);
  const [consent, setConsent] = useState(false);
  const [answers, setAnswers] = useState({});
  const [comments, setComments] = useState({});
  const [restored, setRestored] = useState(false);
  const [segment, setSegment] = useState("");
  const [demo, setDemo] = useState({});
  const [thanks, setThanks] = useState(null);
  const [draftSaved, setDraftSaved] = useState(false);
  const draftKey = "fs_draft_" + token;
  const doneKey = "fs_done_" + token;
  const saveTimer = useRef(null);
  const lastBeacon = useRef(0);
  const refKey = "fs_ref_" + token;
  function clientRef() {
    try {
      let r = localStorage.getItem(refKey);
      if (!r) {
        const b = new Uint8Array(8); crypto.getRandomValues(b);
        r = Array.from(b, (x) => x.toString(16).padStart(2, "0")).join("");
        localStorage.setItem(refKey, r);
      }
      return r;
    } catch { return "anon"; }
  }
  function beacon(answeredNow, totalNow, force) {
    const now = Date.now();
    if (!force && now - lastBeacon.current < 5000) return;
    lastBeacon.current = now;
    try {
      fetch(`${FN_BASE}/fs-respond`, {
        method: "POST", headers: { "Content-Type": "application/json" }, keepalive: true,
        body: JSON.stringify({ action: "progress", token, ref: clientRef(), answered: answeredNow, total: totalNow }),
      }).catch(() => {});
    } catch { /* progress is best-effort */ }
  }

  useEffect(() => {
    (async () => {
      try {
        const r = await fetch(`${FN_BASE}/fs-respond?token=${encodeURIComponent(token)}`);
        const j = await r.json();
        if (!r.ok) { setErr(j.error || "This link is not valid."); setState("error"); return; }
        setData(j);
        // Soft duplicate guard: this device already submitted for this link (F5)
        try {
          if (localStorage.getItem(doneKey)) {
            setThanks("You've already submitted from this device — thank you again.");
            setState("done");
            return;
          }
        } catch { /* ignore */ }
        // Restore a saved draft (answers stay on this device until submitted)
        try {
          const raw = localStorage.getItem(draftKey);
          if (raw) {
            const d = JSON.parse(raw);
            const clean = restoreDraft(d, j);
            if (Object.keys(clean.answers).length || Object.keys(clean.comments).length || Object.keys(clean.demo).length || clean.segment) {
              setAnswers(clean.answers);
              setComments(clean.comments);
              setDemo(clean.demo);
              setSegment(clean.segment);
              setConsent(true);
              setRestored(true);
              setDraftSaved(true);
              setState("form");
              return;
            }
          }
        } catch { /* ignore a bad draft */ }
        setState("intro");
      } catch {
        setErr("Could not load the assessment. Please check your connection and try again.");
        setState("error");
      }
    })();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [token]);

  // Autosave the draft (debounced) whenever answers/comments change mid-form
  useEffect(() => {
    if (state !== "form") return;
    if (saveTimer.current) clearTimeout(saveTimer.current);
    saveTimer.current = setTimeout(() => {
      try { localStorage.setItem(draftKey, JSON.stringify({ answers, comments, demo, segment, at: Date.now() })); setDraftSaved(true); }
      catch { setDraftSaved(false); }
      beacon(Object.keys(answers).length, total, false);
    }, 400);
    return () => { if (saveTimer.current) clearTimeout(saveTimer.current); };
  }, [answers, comments, demo, segment, state, draftKey]);

  const total = useMemo(
    () => data ? data.questionnaire.pillars.reduce((s, p) => s + p.questions.length, 0) : 0,
    [data]
  );
  const missing = data ? missingQuestions(data.questionnaire, answers) : [];
  const answered = total - missing.length;
  const pct = total ? Math.round((answered / total) * 100) : 0;

  async function submit() {
    if (state === "sending") return;
    if (missing.length) {
      const firstMissing = missing[0];
      if (firstMissing) {
        const el = document.getElementById("q_" + firstMissing.key);
        if (el) { el.scrollIntoView({ behavior: "smooth", block: "center" }); el.querySelector("input")?.focus({ preventScroll: true }); }
      }
      setErr(`Please answer all questions — ${total - answered} remaining.`);
      return;
    }
    try { localStorage.setItem(draftKey, JSON.stringify({ answers, comments, demo, segment, at: Date.now() })); setDraftSaved(true); } catch { setDraftSaved(false); }
    setErr(""); setState("sending");
    try {
      const r = await fetch(`${FN_BASE}/fs-respond`, {
        method: "POST", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ token, answers, comments, consent: true, ref: clientRef(), segment: segment || null, demo }),
      });
      const j = await r.json();
      if (r.status === 409) {
        // A used invitation and this device's duplicate are different cases.
        // Preserve the draft until the server positively confirms success.
        setErr((j.error || "This invitation has already been used.") + " We could not confirm this submission. Your answers remain on this page; contact the person who sent the link.");
        setState("form"); return;
      }
      if (!r.ok) { setErr(j.error || "Could not submit."); setState("form"); return; }
      try { localStorage.setItem(doneKey, "1"); localStorage.removeItem(draftKey); } catch {}
      setThanks(j.thankyou_message || data?.campaign?.thankyou_message || null);
      setState("done");
      window.scrollTo({ top: 0 });
    } catch {
      setErr("Network problem while submitting — your answers are still on this page. Please try again before closing it.");
      setState("form");
    }
  }

  if (state === "loading") return <div className="rshell"><p className="muted">Loading…</p></div>;

  if (state === "error") return (
    <div className="rshell"><div style={{ maxWidth: 560, margin: "60px auto" }} className="card">
      <h1>Assessment unavailable</h1>
      <p>{err}</p>
      <p className="muted small">If you believe this is a mistake, contact the person who sent you the link.</p>
      <Button variant="outline" onClick={() => window.location.reload()}>Try again</Button>
    </div></div>
  );

  if (state === "done") return (
    <div className="rshell"><div style={{ maxWidth: 560, margin: "60px auto" }} className="card">
      <h1>Thank you <Check className="inline size-4 -mt-0.5" /></h1>
      <p>{thanks || "Your responses have been recorded."}</p>
      <p className="muted small">
        No name or email is stored with your answers. Reports and dashboards only ever show
        group results, and a group stays hidden until enough people have responded. Your
        individual answers and written comments are visible only to the organisation&apos;s
        assessment team for data-quality checks. Reports may include privacy-eligible
        excerpts from written feedback. See the <a href="/privacy">privacy notice</a> for more detail.
      </p>
    </div></div>
  );

  const q = data.questionnaire;

  if (state === "intro") return (
    <div className="rshell"><div style={{ maxWidth: 640, margin: "40px auto" }}>
      <div className="card">
        {data.campaign?.is_sandbox ? (
          <div style={{ border: "1px solid var(--amber, #b7791f)", background: "#fffaf0", borderRadius: 9, padding: "9px 11px", marginBottom: 12, fontSize: 13 }}>
            <b>Sandbox test</b> — this response is for product validation and cannot enter an official report.
          </div>
        ) : null}
        <div className="small muted" style={{ marginBottom: 6 }}>
          {data.org?.name} · {data.campaign?.name}
        </div>
        <h1>Innovation health assessment</h1>
        <p>
          You&apos;ve been invited to contribute as part of the{" "}
          <b>{data.group?.label}</b> group. It takes about 10–12 minutes:{" "}
          {total} short statements — choose how strongly you agree with each.
        </p>
        <p className="muted small">
          If you genuinely can&apos;t judge a statement, choose <b>Don&apos;t know</b>;
          if it doesn&apos;t apply to your relationship with the organisation, choose{" "}
          <b>Not applicable</b>. These are never counted against the organisation&apos;s score.
        </p>
        <p className="muted small">
          When browser storage is available, your progress saves on this device.
          Check the saving status at the end of the form before closing this page.
        </p>
        <label className="qopt" style={{ marginTop: 16 }}>
          <input type="checkbox" checked={consent} onChange={(e) => setConsent(e.target.checked)} />
          <span className="small">
            I consent to my responses being used to assess this organisation&apos;s innovation
            health. No name or email is collected. Reports only ever show group results
            (hidden until enough people respond); my individual answers are visible only to
            the organisation&apos;s assessment team for data-quality checks.{" "}
            <a href="/privacy" target="_blank" style={{ color: "inherit" }}>Privacy notice</a>
          </span>
        </label>
        <div style={{ marginTop: 16 }}>
          <Button disabled={!consent} onClick={() => { setState("form"); beacon(0, total, true); }}>
            Start the assessment →
          </Button>
        </div>
      </div>
    </div></div>
  );

  // form
  return (
    <div className="rshell"><div style={{ maxWidth: 760, margin: "0 auto" }}>
      <div className="progressbar" role="progressbar" aria-label="Assessment completion" aria-valuenow={answered} aria-valuemin={0} aria-valuemax={total}>
        <div className="track"><div className="fill" style={{ width: pct + "%" }} /></div>
        <div className="lab"><span>{answered} of {total} answered</span><span>{pct}%</span></div>
      </div>

      {restored ? (
        <div className="ok">
          Welcome back — we restored the {answered} answer{answered === 1 ? "" : "s"} you&apos;d
          already given on this device.
        </div>
      ) : null}

      {Array.isArray(data.campaign?.demographics) && data.campaign.demographics.length ? (
        <section>
          <div className="pilhead">
            <div className="n">About you</div>
            <h2>A little context (all optional)</h2>
            <div className="small muted">
              Every question below is optional. Answers are used only for group-level analysis —
              results for groupings with too few people are hidden. Avoid sharing details
              that could identify you or someone else in written feedback.
            </div>
          </div>
          <div className="qblock" style={{ display: "grid", gap: 14 }}>
            {data.campaign.demographics.map((dim) => (
              <div key={dim.id}>
                <label className="f" htmlFor={"demo_" + dim.id}>{dim.question || dim.label}</label>
                <NativeSelect
                  id={"demo_" + dim.id} disabled={state === "sending"}
                  value={demo[dim.id] || ""}
                  onChange={(e) => setDemo((d) => ({ ...d, [dim.id]: e.target.value }))}
                  style={{ maxWidth: 340 }}
                >
                  <NativeSelectOption value="">Prefer not to say</NativeSelectOption>
                  {(dim.options || []).map((o) => <NativeSelectOption key={o} value={o}>{o}</NativeSelectOption>)}
                </NativeSelect>
              </div>
            ))}
          </div>
        </section>
      ) : data.campaign?.segments?.length ? (
        <div className="qblock">
          <div className="qtext">Which area do you work in / deal with? <span className="muted">(optional — used only for group-level analysis, hidden below the anonymity threshold)</span></div>
          <NativeSelect aria-label="Area you work in or deal with" disabled={state === "sending"} value={segment} onChange={(e) => setSegment(e.target.value)} style={{ maxWidth: 340 }}>
            <NativeSelectOption value="">Prefer not to say</NativeSelectOption>
            {data.campaign.segments.map((sg) => <NativeSelectOption key={sg} value={sg}>{sg}</NativeSelectOption>)}
          </NativeSelect>
        </div>
      ) : null}

      {q.pillars.map((p, pi) => (
        <section key={p.id}>
          <div className="pilhead">
            <div className="n">Section {pi + 1} of {q.pillars.length}</div>
            <h2>{p.name}</h2>
            <div className="small muted">{p.desc}</div>
          </div>
          {p.questions.map((qq, qi) => (
            <fieldset className="qblock" key={qq.key} id={"q_" + qq.key} disabled={state === "sending"}>
              <legend className="qtext">{qi + 1}. {qq.text}</legend>
              {q.scale.map((s) => (
                <label key={s.code} className={"qopt" + (answers[qq.key] === s.code ? " sel" : "")}>
                  <input
                    type="radio" name={qq.key} value={s.code}
                    checked={answers[qq.key] === s.code}
                    onChange={() => setAnswers((a) => ({ ...a, [qq.key]: s.code }))}
                  />
                  {s.label}
                </label>
              ))}
            </fieldset>
          ))}
          <div style={{ margin: "16px 0 8px" }}>
            <label className="f" htmlFor={"comment_" + p.id}>{p.commentPrompt} <span className="muted">(optional)</span></label>
            <Textarea
              id={"comment_" + p.id} disabled={state === "sending"}
              value={comments[p.id] || ""}
              onChange={(e) => setComments((c) => ({ ...c, [p.id]: e.target.value }))}
              placeholder="Optional — your comments are anonymous."
            />
          </div>
        </section>
      ))}

      {err ? <div role="alert" className="err">{err}</div> : null}
      <div style={{ margin: "22px 0 40px" }}>
        <Button onClick={submit} disabled={state === "sending"}>
          {state === "sending" ? "Submitting…" : "Submit my responses"}
        </Button>
        <p className="small muted" style={{ marginTop: 8 }}>
          {draftSaved ? "Progress saved on this device. You can return using the same link." : "Keep this page open until you submit. Saving on this device may be unavailable."}
        </p>
      </div>
    </div></div>
  );
}
