import { describe, it, expect, vi } from "vitest";

/* app/lib/lifecycle.js is a thin client over the lifecycle RPCs. What is worth
   testing here is the part that runs in the browser: that the client's idea of
   which fields are locked matches the database's, and that it refuses obviously
   invalid input before spending a round trip. The RPCs themselves are enforced
   in Postgres and verified in supabase/verify/0013_phase1_assertions.sql. */

vi.mock("../lib/supabase.js", () => ({ sb: () => { throw new Error("no network in unit tests"); } }));

const mod = await import("../app/lib/lifecycle.js");
const { LOCKED_AFTER_LAUNCH, isLocked, lockReason, extendCampaign } = mod;

/* This list must stay identical to the fields named in fs_campaigns_lock_guard.
   If someone adds a field to one and not the other, the UI will either offer an
   edit the server refuses, or grey out something that is actually editable. */
const SERVER_LOCKED_FIELDS = [
  "questionnaire_version_id", "demographics", "segments",
  "anonymity_threshold", "confidentiality_notice", "opens_at",
];

describe("locked fields mirror the database trigger", () => {
  it("names exactly the fields fs_campaigns_lock_guard refuses", () => {
    expect([...LOCKED_AFTER_LAUNCH].sort()).toEqual([...SERVER_LOCKED_FIELDS].sort());
  });

  it("locks nothing while the campaign is a draft", () => {
    for (const f of SERVER_LOCKED_FIELDS) expect(isLocked(f, "draft")).toBe(false);
  });

  it("locks every one of them once the campaign has opened", () => {
    for (const status of ["open", "closed", "archived"]) {
      for (const f of SERVER_LOCKED_FIELDS) expect(isLocked(f, status)).toBe(true);
    }
  });

  it("leaves operational fields editable after launch", () => {
    for (const f of ["name", "thankyou_message", "closed_message", "client_context"]) {
      expect(isLocked(f, "open")).toBe(false);
    }
  });

  it("explains the lock only when something is actually locked", () => {
    expect(lockReason("draft")).toBeNull();
    expect(lockReason("open")).toMatch(/revised campaign draft/i);
  });
});

describe("post-launch changes require a reason", () => {
  it("refuses an empty or too-short reason without calling the server", async () => {
    for (const bad of [undefined, null, "", "   ", "too short"]) {
      const r = await extendCampaign("c1", new Date().toISOString(), bad);
      expect(r.ok).toBe(false);
      expect(r.error).toMatch(/at least 10 characters/i);
    }
  });

  it("accepts a real reason and then attempts the call", async () => {
    // sb() throws in this environment, which proves it got past validation.
    await expect(extendCampaign("c1", new Date().toISOString(), "Client asked for another week to reach frontline staff"))
      .rejects.toThrow(/no network/);
  });
});
