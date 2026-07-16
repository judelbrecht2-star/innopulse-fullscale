// InnoPulse automatic findings engine.
// Deterministic rules that map answer signatures (score bands, exec–employee gaps,
// Don't-know rates, polarisation, group-specific items) to evidence-disciplined
// conclusions. Every rule cites the exact questions that fired it, states its
// evidence class + confidence, offers alternative explanations, and names the
// validation step. Single-signal rules stay "hypothesis"; conclusions upgrade to
// "supported" only with converging evidence — never invented from pillar averages.

const LOW = 40, MID = 55, HIGH = 70, GAP = 25, DKHI = 30, SD_POL = 34;

export const CLASS = {
  OBS: "Observed finding",
  SUP: "Supported interpretation",
  HYP: "Plausible hypothesis",
};

function ctx(results) {
  const qs = {};
  for (const q of results.questions || []) qs[q.key] = q;
  const vis = {};
  for (const g of results.groups || []) if (!g.suppressed) vis[g.type] = g;
  const m = (k, t) => qs[k]?.groups?.[t]?.mean ?? null;
  const sd = (k, t) => qs[k]?.groups?.[t]?.sd ?? null;
  const dk = (k, t) => {
    const e = qs[k]?.groups?.[t]; if (!e) return null;
    const tot = (e.n_scored || 0) + (e.n_dkna || 0);
    return tot ? Math.round((e.n_dkna / tot) * 100) : null;
  };
  const gapEE = (k) => {
    const a = m(k, "executive"), b = m(k, "employee");
    return a == null || b == null ? null : Math.round((a - b) * 10) / 10;
  };
  const avg = (keys, t) => {
    const v = keys.map((k) => m(k, t)).filter((x) => x != null);
    return v.length ? Math.round((v.reduce((s, x) => s + x, 0) / v.length) * 10) / 10 : null;
  };
  const dkAvg = (keys, t) => {
    const v = keys.map((k) => dk(k, t)).filter((x) => x != null);
    return v.length ? Math.round(v.reduce((s, x) => s + x, 0) / v.length) : null;
  };
  const cite = (k, t) => {
    const e = qs[k]?.groups?.[t];
    return e ? `[${qs[k].pillar_short} | ${k} | ${t} | n=${e.n_scored} | ${e.mean ?? "—"}${e.n_dkna ? ` | DK ${dk(k, t)}%` : ""}]` : `[${k} | ${t} | no data]`;
  };
  return { qs, vis, allGroups: results.groups || [], m, sd, dk, gapEE, avg, dkAvg, cite };
}

// ISO 56001:2024 clause mapping — shown on each finding so a Full-Scale report
// doubles as an ISO-readiness evidence pack.
const ISO = {
  paper_strategy: "Clause 6 · Planning", espoused_vs_funded: "Clause 5 · Leadership",
  strategic_opacity: "Clause 6 · Planning", inside_out_illusion: "Clause 6 · Planning",
  safety_gap: "Clause 5 · Leadership & culture", cynicism_loop: "Clause 10 · Improvement",
  blame_residue: "Clause 7 · Support (culture)", capability_no_runway: "Clause 7 · Support (resources)",
  training_mirage: "Clause 7 · Support (competence)", manager_bottleneck: "Clause 5 · Leadership",
  idea_blackhole: "Clause 8 · Operation", process_theatre: "Clause 8 · Operation",
  no_evidence_gates: "Clause 8 · Operation (portfolio)", late_customer_involvement: "Clause 8 · Operation",
  procurement_friction: "Clause 8 · Operation (collaboration)", value_invisibility: "Clause 9 · Performance evaluation",
  last_mile_gap: "Clause 9 · Performance evaluation", success_without_story: "Clause 10 · Improvement",
  silo_signal: "Clause 7 · Support (knowledge)", polarised_experience: "Clause 9 · Performance evaluation",
  partner_arms_length: "Clause 4 · Context (interested parties)", no_risk_appetite: "Clause 5 · Leadership (risk appetite)",
  frontline_disempowered: "Clause 5 · Leadership (empowerment)", digital_gap: "Clause 7 · Support (infrastructure)",
  participation_bias: "Clause 9 · Performance evaluation (data quality)", info_asymmetry: "Clause 7 · Support (awareness & communication)",
};

// Each rule: { id, title, severity 1..3, run(c) -> null | {klass, confidence, text, evidence[], alternatives, validate} }
const RULES = [
  {
    id: "participation_bias", title: "Participation is low enough to bias every other number", severity: 3,
    run: (c) => {
      // participation is not privacy-sensitive — check ALL groups, including suppressed ones
      const weak = (c.allGroups || []).filter((g) => g.target_n >= 5 && g.n / g.target_n < 0.5);
      if (!weak.length) return null;
      return {
        klass: CLASS.OBS, confidence: "High",
        text: `${weak.map((g) => `${g.label || g.type} reached ${Math.round((g.n / g.target_n) * 100)}% of target (${g.n}/${g.target_n})`).join("; ")}. Survey-methodology research puts healthy census-style participation at roughly 70–88%; below ~50%, the people who answer tend to be the most engaged advocates or the most frustrated critics, so every score in this report may over-weight the extremes. Read all findings for these groups as directional until coverage improves — and treat the low participation itself as a finding: people vote on whether feedback is worth giving.`,
        evidence: weak.map((g) => `[coverage | ${g.type} | ${g.n}/${g.target_n}]`),
        alternatives: "Unrealistic target sizes; survey window too short or badly timed; access problems (frontline staff without desks or devices).",
        validate: "Extend the window with one sponsored reminder from the group's own leader (not HR); if participation doesn't move, ask why in the next townhall — the answer is diagnostic.",
      };
    },
  },
  {
    id: "info_asymmetry", title: "Don't-know answers follow the hierarchy — an information-access gradient", severity: 2,
    run: (c) => {
      if (!c.vis.executive || !c.vis.employee) return null;
      const shared = Object.values(c.qs).filter((q) => !q.audience || (q.audience.includes("executive") && q.audience.includes("employee")));
      let eSum = 0, xSum = 0, n = 0;
      for (const q of shared) {
        const de = c.dk(q.key, "employee"), dx = c.dk(q.key, "executive");
        if (de == null || dx == null) continue;
        eSum += de; xSum += dx; n++;
      }
      if (n < 10) return null;
      const eAvg = Math.round(eSum / n), xAvg = Math.round(xSum / n);
      if (eAvg < 20 || eAvg - xAvg < 15) return null;
      return {
        klass: CLASS.OBS, confidence: "High",
        text: `On the same ${n} questions, employees answer "Don't know" ${eAvg}% of the time against ${xAvg}% for executives. When Don't-know patterns by hierarchy like this, the survey literature reads it as information access, not disengagement: the organisation's innovation machinery is visible from the top and opaque from below. This inflates the exec–employee score gap too — part of the "disagreement" is simply that one group can see the object being rated.`,
        evidence: [`[shared items | employee DK ${eAvg}% vs executive DK ${xAvg}% | ${n} questions]`],
        alternatives: "Survey-taking style (employees more willing to admit uncertainty); genuinely decentralised work where corporate initiatives are irrelevant to daily roles.",
        validate: "Publish a one-page 'how innovation works here' explainer, then re-ask five high-DK items in a pulse 60 days later — access problems move, style differences don't.",
      };
    },
  },
  {
    id: "paper_strategy", title: "Strategy exists on paper, not in people's line of sight", severity: 3,
    run: (c) => {
      if (!c.vis.employee) return null;
      const doc = Math.max(c.m("sii_0", "executive") ?? -1, c.m("sii_0", "employee") ?? -1);
      const los = c.m("sii_em0", "employee"), comm = c.m("sii_1", "employee");
      if (doc < MID || los == null || comm == null) return null;
      if (los >= LOW && comm >= LOW) return null;
      const both = los < LOW && comm < LOW;
      return {
        klass: both ? CLASS.SUP : CLASS.HYP, confidence: both ? "Medium-High" : "Medium",
        text: `A documented strategy is acknowledged (sii_0 ≈ ${doc}), but employees score its communication at ${comm} and their own line of sight ("how my team's work connects") at ${los}. The strategy exists as an artefact; it has not become operational meaning for the people expected to act on it.`,
        evidence: [c.cite("sii_0", c.vis.executive ? "executive" : "employee"), c.cite("sii_1", "employee"), c.cite("sii_em0", "employee")],
        alternatives: "Recent strategy refresh not yet cascaded; communication happened but in channels employees don't use; sample skews to teams outside the strategy's focus.",
        validate: "Ask five randomly chosen employees to name the organisation's top two innovation priorities. If they can't, the finding stands.",
      };
    },
  },
  {
    id: "espoused_vs_funded", title: "Leadership sponsorship isn't matched by resources", severity: 3,
    run: (c) => {
      if (!c.vis.executive || !c.vis.employee) return null;
      const sponsor = c.avg(["sii_4", "sii_5"], "executive");
      const fundEmp = c.m("sii_3", "employee"), timeEmp = c.m("iem_3", "employee");
      if (sponsor == null || sponsor < HIGH) return null;
      if ((fundEmp ?? 100) >= LOW && (timeEmp ?? 100) >= LOW) return null;
      return {
        klass: CLASS.SUP, confidence: "Medium-High",
        text: `Executives rate their sponsorship of innovation at ${sponsor}, but employees rate funding adequacy at ${fundEmp ?? "—"} and time/space to innovate at ${timeEmp ?? "—"}. Espoused priority without allocated slack is the most common credibility gap in innovation systems: people hear the speeches and check the budget.`,
        evidence: [c.cite("sii_4", "executive"), c.cite("sii_5", "executive"), c.cite("sii_3", "employee"), c.cite("iem_3", "employee")],
        alternatives: "Resources are allocated centrally and invisible to teams; a genuine investment cycle is planned but not yet felt; employees interpret 'resources' as headcount only.",
        validate: "Inspect the last two budget cycles: what % of discretionary spend and protected time is traceably tied to innovation activity?",
      };
    },
  },
  {
    id: "strategic_opacity", title: "Employees can't see the strategic machinery at all", severity: 2,
    run: (c) => {
      if (!c.vis.employee) return null;
      const d = c.dkAvg(["sii_8", "sii_9", "sii_3"], "employee");
      if (d == null || d < DKHI) return null;
      return {
        klass: CLASS.OBS, confidence: "High",
        text: `${d}% of employee answers on prioritisation, measurement and funding of innovation are "Don't know". This is not a negative rating — it is missing visibility. People cannot align with machinery they cannot see, and high Don't-know here typically precedes low engagement scores next cycle.`,
        evidence: [c.cite("sii_8", "employee"), c.cite("sii_9", "employee"), c.cite("sii_3", "employee")],
        alternatives: "Genuinely new processes nobody has communicated yet; respondents from support functions distant from innovation work; some Don't-know answering reflects survey shortcutting (satisficing) rather than true opacity — the validation step separates the two.",
        validate: "Check whether prioritisation criteria and innovation KPIs are published anywhere an ordinary employee can reach in under two clicks.",
      };
    },
  },
  {
    id: "inside_out_illusion", title: "The organisation believes it listens; customers disagree", severity: 3,
    run: (c) => {
      if (!c.vis.customer) return null;
      const internal = Math.max(c.m("sii_7", "executive") ?? -1, c.m("sii_7", "employee") ?? -1);
      const cust = c.m("sii_cu0", "customer");
      if (internal < HIGH || cust == null || cust >= LOW + 10) return null;
      return {
        klass: CLASS.SUP, confidence: "Medium-High",
        text: `Internally, "innovation is informed by customer needs" scores ${internal}; customers score "this organisation understands the problems we are trying to solve" at ${cust}. The inside-out story and the outside-in experience have diverged — the most commercially dangerous gap in this instrument.`,
        evidence: [c.cite("sii_7", "executive"), c.cite("sii_cu0", "customer")],
        alternatives: "Customer sample drawn from an unhappy segment; listening happens in functions customers never see; recent service issue colouring answers.",
        validate: "Trace the last three product/service decisions to a documented customer input. If the chain is missing, the internal score is aspiration, not practice.",
      };
    },
  },
  {
    id: "safety_gap", title: "Leaders believe it's safe to speak; employees don't experience it", severity: 3,
    run: (c) => {
      if (!c.vis.executive || !c.vis.employee) return null;
      const g0 = c.gapEE("iem_0"), g2 = c.gapEE("iem_2");
      const emp = c.m("iem_em0", "employee");
      const fired = (g0 != null && g0 >= GAP && (c.m("iem_0", "employee") ?? 100) < MID);
      if (!fired) return null;
      const converging = emp != null && emp < MID;
      return {
        klass: converging ? CLASS.SUP : CLASS.HYP, confidence: converging ? "High" : "Medium",
        text: `On "safe to take risks without blame", executives sit ${g0} points above employees${g2 != null ? ` (encouragement of experimentation shows a similar ${g2}-point gap)` : ""}${converging ? `, and the direct personal item — "I can raise an idea with my manager without it counting against me" — scores ${emp}` : ""}. This is the classic leader blind spot documented in psychological-safety research: safety is judged by those who grant it but experienced by those who need it, and people lower in a status hierarchy find speaking up hardest — so a team can look engaged while members sit on concerns they would never raise. Expect the survey itself to under-state the problem for the same reason.`,
        evidence: [c.cite("iem_0", "executive"), c.cite("iem_0", "employee"), converging ? c.cite("iem_em0", "employee") : c.cite("iem_2", "employee")].filter(Boolean),
        alternatives: "A single team's bad experience dominating a small sample; a recent restructuring making all risk feel personal; executives answering about formal policy rather than behaviour.",
        validate: "In the next three leadership meetings, count who challenges an idea and what happens to them. Run skip-level listening sessions with no managers present.",
      };
    },
  },
  {
    id: "cynicism_loop", title: "Idea invitations without visible implementation — the cynicism loop", severity: 3,
    run: (c) => {
      if (!c.vis.employee) return null;
      const invited = c.m("iem_4", "employee");
      const seen = c.m("roi_em0", "employee"), landed = c.m("roi_1", "employee");
      if (invited == null || invited < MID) return null;
      if ((seen ?? 100) >= LOW && (landed ?? 100) >= LOW) return null;
      return {
        klass: CLASS.SUP, confidence: "High",
        text: `Employees confirm they are asked for ideas (${invited}) but score "I see ideas from people like me actually implemented" at ${seen ?? "—"} and "good ideas reliably get implemented" at ${landed ?? "—"}. This is the signature of a reinforcing loop: each unanswered invitation teaches people that contributing changes nothing. Expect declining submission volumes and survey participation if unaddressed — the silence will look like contentment.`,
        evidence: [c.cite("iem_4", "employee"), c.cite("roi_em0", "employee"), c.cite("roi_1", "employee")],
        alternatives: "Ideas are implemented but never attributed or communicated back; long delivery cycles mean wins exist but post-date most people's submissions.",
        validate: "Pull the idea log: what % of submissions received any decision within 60 days? Publish three closed loops ('you said → we did / we won't, because') and measure submission volume 90 days later.",
      };
    },
  },
  {
    id: "blame_residue", title: "Experimentation is encouraged in words; failure is still punished in memory", severity: 2,
    run: (c) => {
      if (!c.vis.employee) return null;
      const learn = c.m("iem_1", "employee"), encourage = Math.max(c.m("iem_2", "executive") ?? -1, c.m("iem_2", "employee") ?? -1);
      const recog = c.m("iem_em1", "employee");
      if (learn == null || learn >= LOW || encourage < MID) return null;
      const conv = recog != null && recog < LOW;
      return {
        klass: conv ? CLASS.SUP : CLASS.HYP, confidence: conv ? "Medium-High" : "Medium",
        text: `Encouragement to experiment scores ${encourage}, but "lessons from unsuccessful initiatives are used for learning rather than punishment" scores ${learn} with employees${conv ? `, and recognition for trying ("even when it doesn't work out") sits at ${recog}` : ""}. People calibrate risk on what happened to the last person who failed, not on this year's slogan.`,
        evidence: [c.cite("iem_2", "employee"), c.cite("iem_1", "employee"), conv ? c.cite("iem_em1", "employee") : null].filter(Boolean),
        alternatives: "One well-known failure story dominating perception; conflation of performance management with project outcomes.",
        validate: "Name the last failed initiative: what formally happened to its owner? Is there any post-mortem artefact that reads as learning rather than fault-finding?",
      };
    },
  },
  {
    id: "capability_no_runway", title: "Capability exists but has no runway (time famine)", severity: 2,
    run: (c) => {
      if (!c.vis.employee) return null;
      const skills = c.m("oic_0", "employee"), time = c.m("iem_3", "employee");
      if (skills == null || time == null || skills < MID || time >= LOW) return null;
      return {
        klass: CLASS.SUP, confidence: "Medium-High",
        text: `Employees rate their innovation skills at ${skills} but time and space to use them at ${time}. Training more people will not move outcomes; the constraint is slack, not skill. This pattern typically shows up downstream as good pilot ideas that never progress because no one has hours to run them.`,
        evidence: [c.cite("oic_0", "employee"), c.cite("iem_3", "employee")],
        alternatives: "Seasonal workload peak at survey time; 'time' read as permission — a psychological-safety issue wearing a calendar costume.",
        validate: "Sample five recent idea submitters: how many hours were they formally given to develop the idea? Zero hours confirms the constraint.",
      };
    },
  },
  {
    id: "training_mirage", title: "Training exists in the catalogue, not in people's hands", severity: 2,
    run: (c) => {
      if (!c.vis.executive || !c.vis.employee) return null;
      const exec = c.m("oic_1", "executive"), emp = c.m("oic_em0", "employee");
      if (exec == null || emp == null || exec < MID || emp >= LOW) return null;
      return {
        klass: CLASS.SUP, confidence: "Medium-High",
        text: `Executives rate training availability at ${exec}; employees rate having actually received practical innovation training or coaching at ${emp}. The offer exists; the uptake pathway is broken — access, awareness, manager release time, or relevance.`,
        evidence: [c.cite("oic_1", "executive"), c.cite("oic_em0", "employee")],
        alternatives: "Training is new and hasn't reached cohorts yet; employees discount e-learning as 'not practical'.",
        validate: "Pull LMS completion for innovation modules by department, and ask three managers when they last released someone for it.",
      };
    },
  },
  {
    id: "manager_bottleneck", title: "The middle layer interrupts leadership intent", severity: 3,
    run: (c) => {
      if (!c.vis.employee) return null;
      const mgr = c.m("oic_2", "employee"), voice = c.m("iem_em0", "employee");
      const top = c.vis.executive ? c.avg(["sii_4", "sii_5"], "executive") : null;
      if (mgr == null || mgr >= LOW) return null;
      const conv = voice != null && voice < MID;
      return {
        klass: conv ? CLASS.SUP : CLASS.HYP, confidence: conv ? "Medium-High" : "Medium",
        text: `Employees rate managers' ability to lead innovation at ${mgr}${conv ? ` and safety of raising ideas with their manager at ${voice}` : ""}${top != null && top >= HIGH ? `, while executive sponsorship self-rates at ${top}` : ""}. Strategy doesn't fail at the top or the front line — it fails at the layer that translates one into the other. Managers here are the transmission, and the transmission is slipping.`,
        evidence: [c.cite("oic_2", "employee"), conv ? c.cite("iem_em0", "employee") : null, top != null ? c.cite("sii_5", "executive") : null].filter(Boolean),
        alternatives: "Managers lack delegated authority rather than skill; spans of control too wide for any coaching behaviour.",
        validate: "Ask managers directly: what are you measured on, and where does innovation rank? If it's absent from their scorecards, the system — not the managers — is the cause.",
      };
    },
  },
  {
    id: "idea_blackhole", title: "There is no visible pathway for an idea", severity: 3,
    run: (c) => {
      if (!c.vis.employee) return null;
      const knows = c.m("ipm_em0", "employee") ?? c.m("ipm_2", "employee");
      const captured = c.m("ipm_4", "employee");
      if (knows == null || knows >= LOW) return null;
      const conv = captured != null && captured < MID;
      return {
        klass: conv ? CLASS.SUP : CLASS.HYP, confidence: conv ? "High" : "Medium",
        text: `"I know exactly where to submit an idea and what happens next" scores ${knows}${conv ? `; "ideas are captured so they are not lost" scores ${captured}` : ""}. Before any cultural interpretation, note the mechanical fact: there is no functioning front door. Culture change cannot compensate for a missing letterbox.`,
        evidence: [c.cite("ipm_em0", "employee"), conv ? c.cite("ipm_4", "employee") : c.cite("ipm_2", "employee")].filter(Boolean),
        alternatives: "A channel exists but is branded/localised so people don't recognise it in survey language.",
        validate: "Ask ten employees 'where would you send an idea today?' — count distinct answers. More than two answers = no pathway.",
      };
    },
  },
  {
    id: "process_theatre", title: "Process exists in documentation, not in lived experience", severity: 2,
    run: (c) => {
      if (!c.vis.executive || !c.vis.employee) return null;
      const keys = ["ipm_1", "ipm_6"];
      const gaps = keys.map((k) => c.gapEE(k)).filter((g) => g != null && g >= GAP);
      if (!gaps.length) return null;
      const ex = c.avg(keys, "executive"), em = c.avg(keys, "employee");
      return {
        klass: gaps.length > 1 ? CLASS.SUP : CLASS.HYP, confidence: gaps.length > 1 ? "Medium-High" : "Medium",
        text: `On defined process and clear evaluation criteria, executives average ${ex} while employees average ${em} (gap ≥ ${GAP} on ${gaps.length} item${gaps.length > 1 ? "s" : ""}). Executives are likely rating the process as designed; employees are rating the process as encountered. Both are telling the truth about different objects.`,
        evidence: [c.cite("ipm_1", "executive"), c.cite("ipm_1", "employee"), c.cite("ipm_6", "employee")],
        alternatives: "Process applies only to large capital projects employees never touch; recent process rollout not yet socialised.",
        validate: "Take the last five ideas submitted and map their actual journey against the documented stages. Count how many stages happened in practice.",
      };
    },
  },
  {
    id: "no_evidence_gates", title: "Projects aren't killed, pivoted or scaled on evidence (executive admission)", severity: 2,
    run: (c) => {
      if (!c.vis.executive) return null;
      const v = c.m("ipm_ex0", "executive");
      if (v == null || v >= LOW) return null;
      return {
        klass: CLASS.OBS, confidence: "High",
        text: `Executives themselves score "governance gates kill, pivot or scale projects based on evidence" at ${v}. This is a self-report against interest, which makes it unusually credible. The likely symptom set: zombie projects consuming capacity, and genuinely good ideas queuing behind them.`,
        evidence: [c.cite("ipm_ex0", "executive")],
        alternatives: "Portfolio too young to have needed kill decisions yet.",
        validate: "Count projects stopped in the last 12 months. Zero stops with a full portfolio is not discipline — it's drift.",
      };
    },
  },
  {
    id: "late_customer_involvement", title: "Customers are consulted after the fact, not during development", severity: 2,
    run: (c) => {
      if (!c.vis.customer) return null;
      const cust = c.m("ipm_cu0", "customer");
      const internal = Math.max(c.m("ipm_3", "executive") ?? -1, c.m("ipm_3", "employee") ?? -1);
      if (cust == null || cust >= LOW) return null;
      const conv = internal >= MID;
      return {
        klass: conv ? CLASS.SUP : CLASS.HYP, confidence: conv ? "Medium-High" : "Medium",
        text: `Customers score "we are invited to give input during development, not only after launch" at ${cust}${conv ? `, while internally "customers are involved during development" scores ${internal}` : ""}. Involvement is being counted internally (surveys sent, demos held) but not experienced externally as influence.`,
        evidence: [c.cite("ipm_cu0", "customer"), conv ? c.cite("ipm_3", "executive") : null].filter(Boolean),
        alternatives: "B2B account managers filter contact so only some customer roles ever see development activity.",
        validate: "For the current top three development efforts, list the customer touchpoints before feature-freeze. Dates tell the story.",
      };
    },
  },
  {
    id: "procurement_friction", title: "Contracting blocks partner pilots", severity: 2,
    run: (c) => {
      if (!c.vis.partner) return null;
      const v = c.m("ipm_pa1", "partner");
      const rel = c.m("iem_pa0", "partner");
      if (v == null || v >= LOW) return null;
      return {
        klass: CLASS.OBS, confidence: "High",
        text: `Partners score "contracting and procurement make it practical to pilot together" at ${v}${rel != null ? ` (being treated as an innovation partner: ${rel})` : ""}. This is a named, fixable constraint — pilot-friendly contracting templates and a fast-track threshold — rather than a culture problem.`,
        evidence: [c.cite("ipm_pa1", "partner"), rel != null ? c.cite("iem_pa0", "partner") : null].filter(Boolean),
        alternatives: "One recent procurement dispute colouring the sample.",
        validate: "Measure elapsed days from 'agreed pilot' to 'signed paperwork' for the last three joint initiatives.",
      };
    },
  },
  {
    id: "value_invisibility", title: "Nobody can see whether innovation pays", severity: 2,
    run: (c) => {
      const types = ["executive", "employee"].filter((t) => c.vis[t]);
      if (!types.length) return null;
      const hits = [];
      for (const t of types) {
        const d = c.dkAvg(["roi_2", "roi_4", "roi_5"], t);
        if (d != null && d >= DKHI) hits.push(`${t} ${d}%`);
      }
      const track = c.vis.executive ? c.m("roi_ex0", "executive") : null;
      if (!hits.length && (track == null || track >= LOW)) return null;
      return {
        klass: CLASS.OBS, confidence: "High",
        text: `${hits.length ? `Don't-know rates on benefit tracking and value delivery reach ${hits.join(", ")}. ` : ""}${track != null && track < LOW ? `Executives score "innovation investments tracked with capex rigour" at ${track}. ` : ""}Value may well be created — but it is not measured or not narrated, which makes innovation budgets the easiest line to cut and successes impossible to reinforce.`,
        evidence: [c.cite("roi_2", types[0]), c.cite("roi_4", types[0]), track != null ? c.cite("roi_ex0", "executive") : null].filter(Boolean),
        alternatives: "Benefits tracked in finance systems invisible to respondents (which is still an internal-communication finding).",
        validate: "Request the benefits register for the last three implemented initiatives. If it takes more than a day to produce, the finding stands.",
      };
    },
  },
  {
    id: "last_mile_gap", title: "The system generates ideas it cannot land (last-mile constraint)", severity: 3,
    run: (c) => {
      const g = Object.values(c.vis)[0]; if (!g) return null;
      const overall = {};
      for (const p of ["sii", "iem", "oic"]) overall[p] = null;
      // use whichever internal group is visible for upstream read
      const t = c.vis.employee ? "employee" : (c.vis.executive ? "executive" : null);
      if (!t) return null;
      const upstream = c.avg(["sii_1", "iem_4", "oic_0"], t);
      const landing = c.avg(["roi_0", "roi_1"], t);
      if (upstream == null || landing == null) return null;
      if (upstream < MID || landing >= LOW + 5) return null;
      return {
        klass: CLASS.SUP, confidence: "Medium-High",
        text: `Upstream conditions (${t} view: clarity, invitation, skills) average ${upstream}, but transition-to-operations and reliable implementation average ${landing}. The constraint is at the last mile: adoption, handover and operational ownership — not idea generation. More ideation investment would make this worse, not better, by widening the funnel into a blocked pipe.`,
        evidence: [c.cite("roi_0", t), c.cite("roi_1", t), c.cite("iem_4", t)],
        alternatives: "A few large stuck projects dominating perception while small improvements land quietly.",
        validate: "List initiatives 'implemented' in the last year and check operational ownership today — who runs it, in whose budget?",
      };
    },
  },
  {
    id: "success_without_story", title: "Value is real externally but invisible internally", severity: 2,
    run: (c) => {
      if (!c.vis.customer || !c.vis.employee) return null;
      const cust = c.avg(["roi_cu0", "roi_cu1"], "customer");
      const emp = c.avg(["roi_em0", "roi_1"], "employee");
      if (cust == null || emp == null || cust < MID || emp >= LOW + 5) return null;
      return {
        klass: CLASS.SUP, confidence: "Medium",
        text: `Customers rate delivered value at ${cust} while employees rate visible implementation at ${emp}. Read together: innovation is landing in the market, but the wins aren't narrated back into the organisation. This is the cheapest finding to fix on the whole assessment — the substance already exists; only the storytelling is missing.`,
        evidence: [c.cite("roi_cu0", "customer"), c.cite("roi_em0", "employee")],
        alternatives: "Different time horizons (customers judging older releases); wins concentrated in one unit employees elsewhere never hear about.",
        validate: "Count internal communications in the last quarter that named a shipped innovation and its result. If under three, run the win-narration experiment for 90 days.",
      };
    },
  },
  {
    id: "silo_signal", title: "Knowledge and collaboration are trapped in silos", severity: 2,
    run: (c) => {
      if (!c.vis.employee) return null;
      const collab = c.m("iem_10", "employee"), share = c.m("iem_12", "employee");
      if (collab == null || share == null) return null;
      if (collab >= LOW || share >= LOW) return null;
      return {
        klass: CLASS.SUP, confidence: "Medium-High",
        text: `Cross-functional collaboration (${collab}) and open knowledge sharing (${share}) both sit in the Low band for employees. Two independent items agreeing makes structural siloing likely — innovation here would depend on heroic individual networks rather than designed flow.`,
        evidence: [c.cite("iem_10", "employee"), c.cite("iem_12", "employee")],
        alternatives: "Physical/geographic separation; incentive schemes that reward unit performance only.",
        validate: "Map the contributors of the last three innovations: how many functions appear? One function per project confirms the silo reading.",
      };
    },
  },
  {
    id: "polarised_experience", title: "The average hides two different organisations", severity: 2,
    run: (c) => {
      if (!c.vis.employee) return null;
      const hot = [];
      for (const q of Object.values(c.qs)) {
        const e = q.groups?.employee;
        if (e && e.sd != null && e.n_scored >= 5 && e.sd >= SD_POL) hot.push({ q, e });
      }
      if (hot.length < 2) return null;
      hot.sort((a, b) => b.e.sd - a.e.sd);
      const top = hot.slice(0, 3);
      return {
        klass: CLASS.OBS, confidence: "High",
        text: `${hot.length} questions show strongly split employee answers (SD ≥ ${SD_POL}), led by: ${top.map(({ q, e }) => `"${q.text.slice(0, 60)}…" (mean ${e.mean}, SD ${e.sd})`).join("; ")}. Means on these items are statements about nobody: part of the organisation lives one reality, part another — usually split by department, site or manager. Treat every average on these items with suspicion until segmented.`,
        evidence: top.map(({ q }) => c.cite(q.key, "employee")),
        alternatives: "Mixed tenure (new joiners vs veterans) rather than structural pockets.",
        validate: "Re-run the next cycle with a department/site segment field, or hold two focus groups sampled from opposite ends of these items.",
      };
    },
  },
  {
    id: "partner_arms_length", title: "Partners are suppliers in practice, whatever the strategy says", severity: 2,
    run: (c) => {
      if (!c.vis.partner) return null;
      const treat = c.m("iem_pa0", "partner"), fit = c.m("sii_pa0", "partner");
      if (treat == null || treat >= LOW) return null;
      const conv = fit != null && fit < MID;
      return {
        klass: conv ? CLASS.SUP : CLASS.HYP, confidence: conv ? "Medium-High" : "Medium",
        text: `Partners score "treated as an innovation partner, not only a supplier" at ${treat}${conv ? ` and their understanding of where they fit in the innovation direction at ${fit}` : ""}. Ecosystem innovation is claimed by most strategies and practised by few; here the ecosystem itself is reporting the gap.`,
        evidence: [c.cite("iem_pa0", "partner"), conv ? c.cite("sii_pa0", "partner") : null].filter(Boolean),
        alternatives: "Sample dominated by transactional suppliers rather than strategic partners.",
        validate: "Ask the top three strategic partners when they were last invited into a roadmap conversation rather than an RFQ.",
      };
    },
  },
  {
    id: "no_risk_appetite", title: "No explicit risk appetite for innovation investment", severity: 2,
    run: (c) => {
      if (!c.vis.executive) return null;
      const v = c.m("iem_ex0", "executive");
      if (v == null || v >= LOW) return null;
      return {
        klass: CLASS.OBS, confidence: "High",
        text: `Executives score "the board/exco has set an explicit risk appetite for innovation investments" at ${v}. Without a stated appetite, every decision defaults to personal risk aversion — and middle managers inherit the most conservative interpretation. Many downstream 'culture' symptoms trace back to this single governance gap.`,
        evidence: [c.cite("iem_ex0", "executive")],
        alternatives: "Appetite exists inside an ERM document nobody connects to innovation.",
        validate: "One board agenda item: agree and publish the loss the organisation is willing to take on experiments per year.",
      };
    },
  },
  {
    id: "frontline_disempowered", title: "Customers can see that frontline staff aren't empowered", severity: 2,
    run: (c) => {
      if (!c.vis.customer) return null;
      const cust = c.m("oic_cu0", "customer");
      if (cust == null || cust >= LOW) return null;
      const emp = c.vis.employee ? c.m("iem_em0", "employee") : null;
      const conv = emp != null && emp < MID;
      return {
        klass: conv ? CLASS.SUP : CLASS.HYP, confidence: conv ? "Medium-High" : "Medium",
        text: `Customers score "the people we deal with are empowered to solve problems in new ways" at ${cust}${conv ? `, converging with employees' own account of voice safety (${emp})` : ""}. Disempowerment is rarely invisible — customers feel it as scripts, escalations and 'I'll have to check'. This is an external symptom of an internal authority design.`,
        evidence: [c.cite("oic_cu0", "customer"), conv ? c.cite("iem_em0", "employee") : null].filter(Boolean),
        alternatives: "Regulatory constraints genuinely limit frontline discretion in this industry.",
        validate: "List the top five customer requests frontline staff cannot resolve without escalation, and what rule blocks each.",
      };
    },
  },
  {
    id: "digital_gap", title: "Tools and data capability are the binding constraint", severity: 1,
    run: (c) => {
      const t = c.vis.employee ? "employee" : (c.vis.executive ? "executive" : null);
      if (!t) return null;
      const tools = c.m("oic_6", t), digital = c.m("oic_7", t);
      if (tools == null || digital == null || tools >= LOW || digital >= LOW) return null;
      return {
        klass: CLASS.SUP, confidence: "Medium",
        text: `Both tooling (${tools}) and technical/digital/data capability (${digital}) sit in the Low band (${t} view). When both items agree, innovation work likely dies in spreadsheets and access requests before it ever reaches an evaluation gate.`,
        evidence: [c.cite("oic_6", t), c.cite("oic_7", t)],
        alternatives: "A single painful legacy system dragging perception of an otherwise adequate stack.",
        validate: "Time-box a test: how long does it take a motivated team to get data access + a sandbox for a small experiment? Days vs months answers this.",
      };
    },
  },
];

// Evaluate all rules. Returns findings sorted by severity desc, then class rank.
export function evaluateFindings(results) {
  if (!results?.questions?.length) return [];
  const c = ctx(results);
  const out = [];
  for (const r of RULES) {
    try {
      const f = r.run(c);
      if (f) out.push({ id: r.id, title: r.title, severity: r.severity, iso: ISO[r.id] || null, ...f });
    } catch { /* a rule must never break the page */ }
  }
  const rank = { [CLASS.OBS]: 0, [CLASS.SUP]: 1, [CLASS.HYP]: 2 };
  out.sort((a, b) => b.severity - a.severity || rank[a.klass] - rank[b.klass]);
  return out;
}

export const RULE_COUNT = RULES.length;
