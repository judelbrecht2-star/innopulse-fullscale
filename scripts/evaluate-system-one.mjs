import { evaluationCases } from "./system-one-cases.mjs";
import { SYSTEM_ONE_APPLICATIONS, validateSystemOneResponse } from "../app/lib/system-one.js";

const API_URL = "https://api.typesafe.ai/v1/systemone";
const args = new Set(process.argv.slice(2));
const dryRun = args.has("--dry-run");
const key = process.env.TYPESAFE_API_KEY;
const applicationArg = process.argv.find((arg) => arg.startsWith("--application="));
const application = applicationArg?.split("=")[1] || null;
const selected = application ? evaluationCases.filter((item) => item.application === application) : evaluationCases;

function groupBy(items, keyOf) {
  return items.reduce((groups, item) => {
    const key = keyOf(item);
    (groups[key] ||= []).push(item);
    return groups;
  }, {});
}

if (!selected.length) {
  console.error(`No evaluation cases found for application: ${application}`);
  process.exit(2);
}

function evaluateExpectation(answer, expected) {
  if (!answer) return { pass: false, reason: "missing answer" };
  if (expected.choice && !expected.choice.includes(answer.choice)) {
    return { pass: false, reason: `choice ${answer.choice} not in ${expected.choice.join(", ")}` };
  }
  const value = answer.type === "noul" ? answer.noul : answer.type === "score" ? answer.score : null;
  if (expected.min != null && !(value >= expected.min)) return { pass: false, reason: `${value} < ${expected.min}` };
  if (expected.max != null && !(value <= expected.max)) return { pass: false, reason: `${value} > ${expected.max}` };
  return { pass: true };
}

async function callTypeSafe(request) {
  let delay = 500;
  for (let attempt = 1; attempt <= 3; attempt++) {
    const started = performance.now();
    const response = await fetch(API_URL, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${key}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify(request),
      signal: AbortSignal.timeout(20000),
    });
    const latencyMs = Math.round(performance.now() - started);
    const body = await response.json().catch(() => ({}));
    if (response.ok) return { body, latencyMs };
    if ((response.status === 429 || response.status === 529) && attempt < 3) {
      await new Promise((resolve) => setTimeout(resolve, delay));
      delay *= 2;
      continue;
    }
    throw new Error(`TypeSafe request failed (${response.status}): ${body.detail || body.error || "unknown error"}`);
  }
  throw new Error("TypeSafe request failed after retries.");
}

function dryRunSummary() {
  const grouped = groupBy(selected, (item) => item.application);
  console.log("System One evaluation plan (no network calls)\n");
  for (const [id, cases] of Object.entries(grouped)) {
    const meta = SYSTEM_ONE_APPLICATIONS[id];
    const questions = cases.reduce((sum, item) => sum + Object.keys(item.request.questions).length, 0);
    console.log(`${meta.label}: ${cases.length} cases, ${questions} typed judgments — recommendation: ${meta.recommendation}`);
  }
  console.log(`\n${selected.length} synthetic cases validated. Set TYPESAFE_API_KEY in the current PowerShell session and run npm run eval:jev for live results.`);
}

if (dryRun) {
  dryRunSummary();
  process.exit(0);
}

if (!key) {
  console.error("TYPESAFE_API_KEY is not set. Set it in the current PowerShell session, then run npm run eval:jev. The key is never read from project files.");
  process.exit(2);
}

const results = [];
for (const item of selected) {
  try {
    const { body, latencyMs } = await callTypeSafe(item.request);
    const contract = validateSystemOneResponse(item.request, body);
    const checks = Object.entries(item.expect).map(([question, expected]) => ({
      question,
      ...evaluateExpectation(body.answers?.[question], expected),
    }));
    const pass = contract.ok && checks.every((check) => check.pass);
    results.push({ id: item.id, application: item.application, pass, latencyMs, model: body.model, usage: body.usage, contract, checks });
    console.log(`${pass ? "PASS" : "FAIL"} ${item.application}/${item.id} (${latencyMs} ms)`);
    for (const check of checks.filter((entry) => !entry.pass)) console.log(`  ${check.question}: ${check.reason}`);
  } catch (error) {
    results.push({ id: item.id, application: item.application, pass: false, error: error.message });
    console.log(`ERROR ${item.application}/${item.id}: ${error.message}`);
  }
}

const grouped = groupBy(results, (item) => item.application);
console.log("\nApplication scorecard");
for (const [id, items] of Object.entries(grouped)) {
  const passed = items.filter((item) => item.pass).length;
  const latencies = items.map((item) => item.latencyMs).filter(Number.isFinite);
  const meanLatency = latencies.length ? Math.round(latencies.reduce((a, b) => a + b, 0) / latencies.length) : null;
  console.log(`${SYSTEM_ONE_APPLICATIONS[id].label}: ${passed}/${items.length} passed${meanLatency == null ? "" : `, mean ${meanLatency} ms`}`);
}

process.exit(results.every((item) => item.pass) ? 0 : 1);
