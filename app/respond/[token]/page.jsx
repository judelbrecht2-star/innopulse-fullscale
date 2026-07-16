"use client";
import { useEffect, useMemo, useRef, useState } from "react";
import { useParams } from "next/navigation";
import { FN_BASE } from "../../../lib/supabase";

export default function Respond() {
  const { token } = useParams();
  const [state, setState] = useState("loading"); // loading | intro | form | sending | done | error
  const [err, setErr] = useState("");
  const [data, setData] = useState(null);
  const [consent, setConsent] = useState(false);
  const [answers, setAnswers] = useState({});
  const [comments, setComments] = useState({});
  const [restored, setRestored] = useState(false);
  const [thanks, setThanks] = useState(null);
  const draftKey = "fs_draft_" + token;
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
        // Restore a saved draft (answers stay on this device until submitted)
        try {
          const raw = localStorage.getItem(draftKey);
          if (raw) {
            const d = JSON.parse(raw);
            if (d && d.answers && Object.keys(d.answers).length > 0) {
              setAnswers(d.answers || {});
              setComments(d.comments || {});
              setConsent(true);
              setRestored(true);
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
      try { localStorage.setItem(draftKey, JSON.stringify({ answers, comments, at: Date.now() })); } catch {}
      beacon(Object.keys(answers).length, total, false);
    }, 400);
    return () => { if (saveTimer.current) clearTimeout(saveTimer.current); };
  }, [answers, comments, state, draftKey]);

  const total = useMemo(
    () => data ? data.questionnaire.pillars.reduce((s, p) => s + p.questions.length, 0) : 0,
    [data]
  );
  const answered = Object.keys(answers).length;
  const pct = total ? Math.round((answered / total) * 100) : 0;

  async function submit() {
    if (answered < total) {
      const firstMissing = data.questionnaire.pillars.flatMap((p) => p.questions).find((q) => !answers[q.key]);
      if (firstMissing) {
        const el = document.getElementById("q_" + firstMissing.key);
        if (el) el.scrollIntoView({ behavior: "smooth", block: "center" });
      }
      setErr(`Please answer all questions — ${total - answered} remaining.`);
      return;
    }
    setErr(""); setState("sending");
    try {
      const r = await fetch(`${FN_BASE}/fs-respond`, {
        method: "POST", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ token, answers, comments, consent: true, ref: clientRef() }),
      });
      const j = await r.json();
      if (!r.ok) { setErr(j.error || "Could not submit."); setState("form"); return; }
      try { localStorage.removeItem(draftKey); } catch {}
      setThanks(j.thankyou_message || data?.campaign?.thankyou_message || null);
      setState("done");
      window.scrollTo({ top: 0 });
    } catch {
      setErr("Network problem while submitting — your answers are still saved on this device. Please try again.");
      setState("form");
    }
  }

  if (state === "loading") return <div className="rshell"><p className="muted">Loading…</p></div>;

  if (state === "error") return (
    <div className="rshell"><div style={{ maxWidth: 560, margin: "60px auto" }} className="card">
      <h1>Assessment unavailable</h1>
      <p>{err}</p>
      <p className="muted small">If you believe this is a mistake, contact the person who sent you the link.</p>
    </div></div>
  );

  if (state === "done") return (
    <div className="rshell"><div style={{ maxWidth: 560, margin: "60px auto" }} className="card">
      <h1>Thank you ✓</h1>
      <p>{thanks || "Your responses have been recorded anonymously."}</p>
      <p className="muted small">
        Results are only ever reported for groups, never for individuals, and only once
        a group has enough responses to protect anonymity.
      </p>
    </div></div>
  );

  const q = data.questionnaire;

  if (state === "intro") return (
    <div className="rshell"><div style={{ maxWidth: 640, margin: "40px auto" }}>
      <div className="card">
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
          Your progress saves automatically on this device — you can close the page and
          pick up where you left off using the same link.
        </p>
        <label className="qopt" style={{ marginTop: 16 }}>
          <input type="checkbox" checked={consent} onChange={(e) => setConsent(e.target.checked)} />
          <span className="small">
            I consent to my anonymous responses being used to assess this organisation&apos;s
            innovation health. No name or email is collected with my answers.
          </span>
        </label>
        <div style={{ marginTop: 16 }}>
          <button className="btn btn-primary" disabled={!consent} onClick={() => { setState("form"); beacon(0, total, true); }}>
            Start the assessment →
          </button>
        </div>
      </div>
    </div></div>
  );

  // form
  return (
    <div className="rshell"><div style={{ maxWidth: 760, margin: "0 auto" }}>
      <div className="progressbar">
        <div className="track"><div className="fill" style={{ width: pct + "%" }} /></div>
        <div className="lab"><span>{answered} of {total} answered</span><span>{pct}%</span></div>
      </div>

      {restored ? (
        <div className="ok">
          Welcome back — we restored the {answered} answer{answered === 1 ? "" : "s"} you&apos;d
          already given on this device.
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
            <div className="qblock" key={qq.key} id={"q_" + qq.key}>
              <div className="qtext">{qi + 1}. {qq.text}</div>
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
            </div>
          ))}
          <div style={{ margin: "16px 0 8px" }}>
            <label className="f">{p.commentPrompt} <span className="muted">(optional)</span></label>
            <textarea
              value={comments[p.id] || ""}
              onChange={(e) => setComments((c) => ({ ...c, [p.id]: e.target.value }))}
              placeholder="Optional — your comments are anonymous."
            />
          </div>
        </section>
      ))}

      {err ? <div className="err">{err}</div> : null}
      <div style={{ margin: "22px 0 40px" }}>
        <button className="btn btn-primary" onClick={submit} disabled={state === "sending"}>
          {state === "sending" ? "Submitting…" : "Submit my responses"}
        </button>
        <p className="small muted" style={{ marginTop: 8 }}>
          Progress autosaves on this device until you submit.
        </p>
      </div>
    </div></div>
  );
}
