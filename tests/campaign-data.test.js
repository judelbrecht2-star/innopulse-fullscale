import { beforeEach, describe, expect, it, vi } from "vitest";
const mocks = vi.hoisted(() => ({ membership: vi.fn(), from: vi.fn() }));
vi.mock("../app/lib/org", () => ({ activeMembership: mocks.membership }));
vi.mock("../lib/supabase", () => ({ sb: () => ({ from: mocks.from }) }));
import { listOrgCampaigns, campaignRows } from "../app/lib/campaign-data";

function query(response) {
  const q = { select: vi.fn(), eq: vi.fn(), in: vi.fn(), order: vi.fn(), range: vi.fn().mockResolvedValue(response) };
  for (const method of ["select", "eq", "in", "order"]) q[method].mockReturnValue(q);
  return q;
}
beforeEach(() => { vi.clearAllMocks(); mocks.membership.mockResolvedValue({ org_id: "org-a", role: "manager" }); });
describe("organisation data boundary", () => {
  it("filters campaigns to the validated active organisation on every request", async () => {
    const q = query({ data: [{ id: "c-a" }], error: null }); mocks.from.mockReturnValue(q);
    expect((await listOrgCampaigns("user", "id,name")).campaigns).toEqual([{ id: "c-a" }]);
    expect(q.eq).toHaveBeenCalledWith("org_id", "org-a");
  });
  it("never queries campaigns for an unlinked account", async () => {
    mocks.membership.mockResolvedValue(null);
    await expect(listOrgCampaigns("user", "id")).rejects.toThrow(/not linked/);
    expect(mocks.from).not.toHaveBeenCalled();
  });
  it("surfaces a database outage instead of inventing an empty organisation", async () => {
    mocks.from.mockReturnValue(query({ data: null, error: { message: "service unavailable" } }));
    await expect(listOrgCampaigns("user", "id")).rejects.toThrow(/service unavailable/);
  });
  it("only loads related rows for campaigns in the active organisation", async () => {
    const q = query({ data: [{ id: "response-a" }], error: null }); mocks.from.mockReturnValue(q);
    await campaignRows("fs_responses", "id", [{ id: "c-a" }]);
    expect(q.in).toHaveBeenCalledWith("campaign_id", ["c-a"]);
  });
  it("does not accidentally issue an unfiltered query for no campaigns", async () => {
    expect(await campaignRows("fs_reports", "*", [])).toEqual([]);
    expect(mocks.from).not.toHaveBeenCalled();
  });
  it("reads beyond the first API page without silently truncating participation", async () => {
    const first = Array.from({ length: 500 }, (_, i) => ({ id: i }));
    const q = query({ data: [], error: null });
    q.range.mockResolvedValueOnce({ data: first }).mockResolvedValueOnce({ data: [{ id: 500 }] });
    mocks.from.mockReturnValue(q);
    expect(await campaignRows("fs_responses", "id", [{ id: "c-a" }])).toHaveLength(501);
    expect(q.range).toHaveBeenNthCalledWith(2, 500, 999);
    expect(q.in).toHaveBeenCalledTimes(2);
  });
});
