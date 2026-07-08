import type { Creator } from "../data/creators";

export type OutreachTone = "Friendly" | "Professional" | "Direct";

export function generateOutreachMessage({
  creator,
  product,
  campaignType,
  offer,
  tone
}: {
  creator: Creator;
  product: string;
  campaignType: string;
  offer: string;
  tone: OutreachTone;
}) {
  const topTheme = creator.contentThemes[0]?.toLowerCase() || creator.niche.toLowerCase();
  const signal = creator.audienceSignals[0]?.toLowerCase() || "shopping and styling questions";

  if (tone === "Professional") {
    return [
      `Hi ${creator.name},`,
      "",
      `I'm reaching out about a potential brand collaboration around ${product}. Your creator profile is focused on ${creator.niche.toLowerCase()}, and the audience signals point to questions around ${topTheme} and "${signal}".`,
      "",
      `We think the best fit could be a ${campaignType.toLowerCase()} with ${offer.toLowerCase()}, centered on ${creator.suggestedAngle.toLowerCase()}`,
      "",
      "Would you be open to discussing a campaign this month?",
      "",
      "Best,",
      "Team"
    ].join("\n");
  }

  if (tone === "Direct") {
    return [
      `Hi ${creator.name},`,
      "",
      `We are launching ${product} and think your ${creator.niche.toLowerCase()} audience is a strong fit based on demand signals like "${signal}".`,
      "",
      `The campaign idea is ${campaignType.toLowerCase()} with ${offer.toLowerCase()}, focused on ${creator.suggestedAngle.toLowerCase()}`,
      "",
      "Open to talking this month?",
      "",
      "Best,",
      "Team"
    ].join("\n");
  }

  return [
    `Hi ${creator.name},`,
    "",
    `Loved your content around ${creator.niche.toLowerCase()}. We are launching ${product}, and your audience seems aligned based on the questions they ask around ${topTheme} and "${signal}".`,
    "",
    `We think the best fit could be a ${campaignType.toLowerCase()} with ${offer.toLowerCase()}, focused on ${creator.suggestedAngle.toLowerCase()}`,
    "",
    "Would you be open to discussing a campaign this month?",
    "",
    "Best,",
    "Team"
  ].join("\n");
}
