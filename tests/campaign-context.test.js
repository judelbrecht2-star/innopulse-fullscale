import { describe, it, expect } from "vitest";
import { defaultCampaign, campaignHref } from "../app/lib/campaign-context";

const campaigns = [
  { id: "sandbox", status: "open", is_sandbox: true },
  { id: "archived", status: "archived" },
  { id: "draft", status: "draft" },
  { id: "closed", status: "closed" },
  { id: "open", status: "open" },
];
describe("campaign continuity", () => {
  it("defaults to an official open cycle over a newer sandbox or draft", () => expect(defaultCampaign(campaigns).id).toBe("open"));
  it("honours a specific closed campaign throughout the workflow", () => expect(defaultCampaign(campaigns, "closed").id).toBe("closed"));
  it("lets an explicit sandbox request exercise its own workflow", () => expect(defaultCampaign(campaigns, "sandbox").id).toBe("sandbox"));
  it("rejects stale or other-tenant IDs without dropping the current org context", () => expect(defaultCampaign(campaigns, "other-tenant").id).toBe("open"));
  it("prefers collected official evidence when no official cycle is open", () => expect(defaultCampaign(campaigns.filter(c => c.id !== "open")).id).toBe("closed"));
  it("handles an empty organisation", () => expect(defaultCampaign([])).toBeNull());
  it("encodes a campaign ID for workflow links", () => expect(campaignHref("/reports", "a&b")).toBe("/reports?campaign=a%26b"));
});
