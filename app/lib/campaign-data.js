"use client";
import { sb } from "../../lib/supabase";
import { activeMembership } from "./org";

async function readAll(makeQuery, label) {
  const rows = [];
  const size = 500;
  for (let offset = 0; ; offset += size) {
    const { data, error } = await makeQuery().range(offset, offset + size - 1);
    if (error) throw new Error(`Could not load ${label}. ${error.message}`);
    rows.push(...(data || []));
    if (!data || data.length < size) return rows;
  }
}

export async function listOrgCampaigns(userId, columns) {
  const membership = await activeMembership(userId);
  if (!membership) throw new Error("Your account is not linked to an organisation. Ask your workspace owner to add you.");
  const campaigns = await readAll(() => sb().from("fs_campaigns")
    .select(columns).eq("org_id", membership.org_id).order("created_at", { ascending: false }).order("id"), "campaigns");
  return { campaigns, membership };
}

export async function campaignRows(table, columns, campaigns) {
  if (!campaigns.length) return [];
  // Chunk IDs as well as rows: long URLs and the Data API's row cap must not truncate totals.
  const rows = [];
  for (let i = 0; i < campaigns.length; i += 100) {
    const ids = campaigns.slice(i, i + 100).map((c) => c.id);
    rows.push(...await readAll(() => sb().from(table).select(columns).in("campaign_id", ids).order("id"), table.replace("fs_", "")));
  }
  return rows;
}
