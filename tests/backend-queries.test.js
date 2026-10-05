import { beforeAll, describe, expect, it } from "vitest";
import { build } from "esbuild";
import vm from "node:vm";
import { checked, readAll } from "../supabase/functions/_shared/query.js";

const bundles = {};
beforeAll(async () => {
  for (const slug of ["fs-results", "fs-responses-ops"]) {
    const built = await build({
      entryPoints: [`supabase/functions/${slug}/index.ts`], bundle: true,
      write: false, platform: "node", format: "cjs",
      plugins: [{ name: "fake-admin", setup(b) {
        b.onResolve({ filter: /^npm:/ }, () => ({ path: "admin", namespace: "fake" }));
        b.onLoad({ filter: /.*/, namespace: "fake" }, () => ({ contents: "export const createClient = () => globalThis.admin;" }));
      } }],
    });
    bundles[slug] = built.outputFiles[0].text;
  }
});

function fixture({ count = 40, questions = 50, cap = 1000, failTable, failOffset = 0, failWrite = false, role = "owner" } = {}) {
  const q = Array.from({ length: questions }, (_, i) => ({ key: `p_${i}`, text: `Question ${i}` }));
  const responses = Array.from({ length: count }, (_, i) => ({ id: `r${String(i).padStart(5, "0")}`, campaign_id: "camp", group_id: "group", valid: true, submitted_at: "2026-10-05", demo: {} }));
  const tables = {
    fs_campaigns: [{ id: "camp", org_id: "org", questionnaire_version_id: "qv", anonymity_threshold: 4 }],
    fs_memberships: role ? [{ id: "mem", org_id: "org", user_id: "user", role }] : [],
    fs_campaign_governance: [{ id: "gov", campaign_id: "camp", score_threshold: 4, comment_threshold: 6, suppression_mode: "strong" }],
    fs_orgs: [{ id: "org", name: "Example" }],
    fs_questionnaire_versions: [{ id: "qv", version: 1, definition: { pillars: [{ id: "p", short: "P", name: "Pillar", weight: 1, questions: q }], scale: [{ code: "yes" }] } }],
    fs_groups: [{ id: "group", campaign_id: "camp", type: "staff", label: "Staff" }],
    fs_responses: responses,
    fs_answers: responses.flatMap((r, i) => q.map((question, j) => ({ id: i * questions + j, response_id: r.id, question_key: question.key, choice: "yes", value: i < count / 2 ? 20 : 80, not_scored: false }))),
    fs_comments: [{ id: "comment", response_id: responses[0]?.id, pillar: "p", body: "Example", in_report: true, themes: ["collaboration"] }],
    fs_progress: [], fs_audit: [],
  };
  const ranges = [];
  class Query {
    constructor(table) { this.table = table; this.filters = []; this.start = 0; this.end = Infinity; this.orders = []; }
    select() { return this; }
    eq(key, value) { this.filters.push((r) => r[key] === value); return this; }
    in(key, values) { this.filters.push((r) => values.includes(r[key])); return this; }
    order(key) { this.orders.push(key); return this; }
    range(start, end) { this.start = start; this.end = end; ranges.push([this.table, start, end]); return this; }
    maybeSingle() { this.one = true; return this; }
    single() { this.one = true; return this; }
    update(value) { this.write = value; return this; }
    insert() { this.inserted = true; return this; }
    then(resolve, reject) {
      if ((this.table === failTable && this.start >= failOffset) || (this.write && failWrite)) return Promise.resolve({ data: null, error: { message: "Internal sensitive database failure" } }).then(resolve, reject);
      let rows = tables[this.table].filter((r) => this.filters.every((f) => f(r)));
      rows = [...rows].sort((a, b) => {
        for (const key of this.orders) { if (a[key] !== b[key]) return a[key] < b[key] ? -1 : 1; }
        return 0;
      });
      if (this.write) rows.forEach((r) => Object.assign(r, this.write));
      rows = rows.slice(this.start, Math.min(this.end + 1, this.start + cap));
      return Promise.resolve({ data: this.one ? rows[0] || null : rows, error: null }).then(resolve, reject);
    }
  }
  const admin = { from: (table) => new Query(table), auth: { getUser: async () => ({ data: { user: { id: "user" } }, error: null }) } };
  const call = async (slug, action = "list", extra = {}) => {
    let handle;
    vm.runInNewContext(bundles[slug], { admin, Request, Response, URL, Deno: { env: { get: () => "test" }, serve: (f) => { handle = f; } } });
    const request = slug === "fs-results"
      ? new Request("https://example.test/?campaign_id=camp&detail=1", { headers: { Authorization: "Bearer test" } })
      : new Request("https://example.test/", { method: "POST", headers: { Authorization: "Bearer test" }, body: JSON.stringify({ campaign_id: "camp", action, ...extra }) });
    const result = await handle(request);
    return { status: result.status, body: await result.json() };
  };
  return { admin, ranges, call, tables };
}

describe("complete backend campaign reads", () => {
  it("counts all 2000 answers in a 40-person batch, including the high-scoring second half", async () => {
    const { call } = fixture();
    const result = await call("fs-results");
    expect(result.status).toBe(200);
    expect(result.body.overall.score).toBe(50);
    expect(result.body.questions[0].groups.group.n_scored).toBe(40);
  });
  it("includes responses after the default 1000-row cap", async () => {
    const { call } = fixture({ count: 1040, questions: 1 });
    const result = await call("fs-results");
    expect(result.body.overall.n).toBe(1040);
    expect(result.body.overall.score).toBe(50);
  });
  it("keeps response answer counts complete", async () => {
    const { call } = fixture({ count: 100, questions: 50 });
    const result = await call("fs-responses-ops");
    expect(result.body.responses).toHaveLength(100);
    expect(result.body.responses.every((r) => r.agg.answered === 50)).toBe(true);
  });
  it("continues through pages shorter than the requested range", async () => {
    const { admin } = fixture({ count: 40, questions: 1, cap: 7 });
    const { data } = await readAll(() => admin.from("fs_responses").select("id"));
    expect(data).toHaveLength(40);
  });
  it.each(["fs-results", "fs-responses-ops"])("%s rejects a failed governance lookup instead of lowering the threshold", async (slug) => {
    const { call } = fixture({ failTable: "fs_campaign_governance" });
    const result = await call(slug);
    expect(result.status).toBe(503);
    expect(result.body).toEqual({ error: "Could not complete this request. Please try again." });
  });
  it("discards earlier answer pages if a later page fails", async () => {
    const { call } = fixture({ failTable: "fs_answers", failOffset: 500 });
    expect((await call("fs-results")).status).toBe(503);
  });
  it("does not claim a comment was saved when its write failed", async () => {
    const { call, tables } = fixture({ failWrite: true });
    const result = await call("fs-responses-ops", "flag_comment", { comment_id: "comment", in_report: false });
    expect(result.status).toBe(503);
    expect(tables.fs_comments[0].in_report).toBe(true);
  });
  it("still locks individual content for an owner below the comment threshold", async () => {
    const { call } = fixture({ count: 4, questions: 1 });
    const result = await call("fs-responses-ops", "detail", { response_id: "r00000" });
    expect(result.body.locked).toBe(true);
    expect(result.body).not.toHaveProperty("comments");
  });
  it.each(["fs-results", "fs-responses-ops"])("%s still refuses an account without membership", async (slug) => {
    const { call } = fixture({ role: null });
    expect((await call(slug)).status).toBe(403);
  });
  it("rejects errors on checked single-row and write operations", async () => {
    await expect(checked(Promise.resolve({ data: null, error: { message: "private" } }))).rejects.toThrow("Database operation failed.");
  });
});
