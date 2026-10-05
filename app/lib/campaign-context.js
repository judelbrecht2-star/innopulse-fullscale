// Campaign choice travels with the workflow; sandbox data never wins the default.
export function defaultCampaign(campaigns, requestedId) {
  const requested = campaigns.find((c) => c.id === requestedId);
  if (requested) return requested;
  const official = campaigns.filter((c) => !c.is_sandbox && c.status !== "archived");
  return official.find((c) => c.status === "open")
    || official.find((c) => c.status === "closed")
    || official[0] || campaigns.find((c) => c.status !== "archived") || campaigns[0] || null;
}

export function campaignHref(path, campaignId) {
  return campaignId ? `${path}?campaign=${encodeURIComponent(campaignId)}` : path;
}

export function requestedCampaignId() {
  if (typeof window === "undefined") return null;
  return new URLSearchParams(window.location.search).get("campaign");
}

export function campaignSelectionHref(currentHref, campaignId) {
  const url = new URL(currentHref);
  if (campaignId) url.searchParams.set("campaign", campaignId);
  else url.searchParams.delete("campaign");
  return url.pathname + url.search + url.hash;
}

export function setCampaignUrl(campaignId) {
  if (typeof window === "undefined") return;
  window.history.replaceState(null, "", campaignSelectionHref(window.location.href, campaignId));
}
