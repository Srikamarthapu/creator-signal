import { creators } from "../data/creators";
import type { Platform } from "../data/creators";
import type { RankedCreator } from "./types";

const normalize = (value: string) => value.toLowerCase().replace(/[^a-z0-9\s]/g, " ");

const tokenize = (query: string) =>
  normalize(query)
    .split(/\s+/)
    .map((token) => token.trim())
    .filter((token) => token.length > 2);

export function rankCreators(query: string, platform: Platform | "Any"): RankedCreator[] {
  const terms = tokenize(query);
  const normalizedQuery = normalize(query).trim();
  const candidates = platform === "Any" ? creators : creators.filter((creator) => creator.platforms.includes(platform));

  return candidates
    .map((creator) => {
      const normalizedNiche = normalize(creator.niche).trim();
      const haystack = normalize(
        [
          creator.niche,
          creator.whyMatch,
          creator.bestCampaign,
          creator.suggestedAngle,
          ...creator.audienceSignals,
          ...creator.contentThemes
        ].join(" ")
      );
      const matches = terms.filter((term) => haystack.includes(term));
      const phraseBoost =
        normalizedQuery.length > 4 && (normalizedQuery.includes(normalizedNiche) || haystack.includes(normalizedQuery))
          ? 10
          : 0;
      const score = Math.min(99, creator.audienceFit + matches.length * 8 + phraseBoost);
      const matchReasons = matches.length
        ? matches.slice(0, 4).map((term) => `Contains "${term}" in mock audience evidence.`)
        : ["Ranked from deterministic mock audience fit."];
      return {
        ...creator,
        prototypeMatchScore: score,
        matchReasons
      };
    })
    .sort((a, b) => b.prototypeMatchScore - a.prototypeMatchScore);
}
