"use client";
import Link from "next/link";
import { campaignHref } from "../lib/campaign-context";

export default function CampaignWorkflow({ campaign, active }) {
  if (!campaign) return null;
  const steps = [
    { id: "setup", label: "Set up", href: `/campaigns/${campaign.id}` },
    { id: "responses", label: "Collect responses", href: campaignHref("/responses", campaign.id) },
    { id: "insights", label: "Review findings", href: campaignHref("/insights", campaign.id) },
    { id: "actions", label: "Plan actions", href: campaignHref("/insights/interventions", campaign.id) },
    { id: "reports", label: "Share report", href: campaignHref("/reports", campaign.id) },
  ];
  return <nav className="campaign-workflow" aria-label="Assessment workflow">
    <div className="workflow-context"><b>{campaign.name}</b><span>{campaign.is_sandbox ? "Sandbox · test responses" : "Assessment cycle"}</span></div>
    <ol>{steps.map((s, i) => <li key={s.id}><Link href={s.href} aria-current={active === s.id ? "step" : undefined}>
      <span aria-hidden="true">{i + 1}</span>{s.label}</Link></li>)}</ol>
  </nav>;
}
