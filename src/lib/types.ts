import type { Creator, Platform } from "../data/creators";

export type SearchState = {
  product: string;
  goal: string;
  budget: string;
  platform: Platform | "Any";
  audience: string;
};

export type RankedCreator = Creator & {
  prototypeMatchScore: number;
  matchReasons: string[];
};

export type Draft = {
  id: string;
  creatorId: string;
  product: string;
  message: string;
  createdAt: string;
};

export type TimelineStatus = "Pending" | "Complete" | "Blocked";

export type TimelineStep = {
  day: number;
  title: string;
  status: TimelineStatus;
};

export type Campaign = {
  id: string;
  creatorId: string;
  product: string;
  budget: string;
  campaign: string;
  createdAt: string;
  steps: TimelineStep[];
};

export type IntegrationStatus = {
  brightData: {
    configured: boolean;
    searchUrlConfigured: boolean;
    serpZoneConfigured: boolean;
    country: string;
  };
  openaiAgents: {
    configured: boolean;
    model: string;
    provider: string;
    displayName: string;
  };
};

export type ProductIntelligence = {
  product: string;
  brightData: {
    used: boolean;
    sources: Array<{
      title: string;
      source: string;
      description: string;
      link?: string;
      rank: number;
    }>;
    meta?: {
      query?: string;
      searchEngine?: string;
      location?: string;
    };
    error?: string;
  };
  openaiAgents: {
    used: boolean;
    note: string;
  };
  brief: {
    summary: string;
    demandSignals: string[];
    searchAngles: string[];
    outreachCues: string[];
    caution: string;
  };
  disclaimer: string;
};

export type CreatorEnrichment = {
  creatorId: string;
  sourceCount: number;
  scrapedPageCount: number;
  sources: Array<{
    title: string;
    source: string;
    description: string;
    link?: string;
    rank: number;
  }>;
  audienceDemandTerms: string[];
  agentSummary: string;
  outreachAngle: string;
  confidence: "Low" | "Medium" | "High";
  caveat: string;
  brightDataUsed: boolean;
  openaiAgentsUsed: boolean;
  agentNote: string;
  error?: string;
};

export type CreatorEnrichmentResponse = {
  product: string;
  brightData: {
    used: boolean;
    mode: string;
    enrichedCreators: number;
  };
  openaiAgents: {
    used: boolean;
    model: string;
  };
  enrichments: CreatorEnrichment[];
  disclaimer: string;
};

export type RealInfluencer = {
  displayName: string;
  handle?: string;
  platform: string;
  profileUrl?: string;
  sourceUrl: string;
  sourceTitle: string;
  sourceDescription: string;
  niche: string;
  matchReason: string;
  evidence: string[];
  confidence: "Low" | "Medium" | "High";
  sourceType: "profile" | "post" | "article" | "searchResult";
  matchScore: number;
};

export type RealInfluencerResponse = {
  product: string;
  brightData: {
    used: boolean;
    sourceCount: number;
    mode: string;
  };
  openaiAgents: {
    used: boolean;
    model: string;
  };
  influencers: RealInfluencer[];
  caveat: string;
  disclaimer: string;
};
