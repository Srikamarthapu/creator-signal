import type { Campaign, TimelineStep } from "./types";

export const defaultTimelineSteps: TimelineStep[] = [
  { day: 1, title: "Outreach draft ready", status: "Complete" },
  { day: 3, title: "Follow up", status: "Pending" },
  { day: 5, title: "Product shipped", status: "Pending" },
  { day: 9, title: "Creator submits draft", status: "Pending" },
  { day: 10, title: "Brand approval", status: "Pending" },
  { day: 12, title: "Post goes live", status: "Pending" },
  { day: 19, title: "Performance review", status: "Pending" }
];

export function createCampaign({
  creatorId,
  product,
  budget,
  campaign
}: {
  creatorId: string;
  product: string;
  budget: string;
  campaign: string;
}): Campaign {
  return {
    id: `campaign-${creatorId}-${Date.now()}`,
    creatorId,
    product,
    budget,
    campaign,
    createdAt: new Date().toISOString(),
    steps: defaultTimelineSteps.map((step) => ({ ...step }))
  };
}

