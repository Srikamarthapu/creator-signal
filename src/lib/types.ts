export type Platform = "TikTok" | "Instagram" | "YouTube";
export type CampaignRisk = "Low" | "Medium" | "High";

export type SearchState = {
  product: string;
  goal: string;
  budget: string;
  platform: Platform | "Any";
  audience: string;
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

export type InfluencerEvaluation = {
  displayName: string;
  sourceUrl: string;
  aiScore: number;
  verdict: "Strong fit" | "Good fit" | "Check fit" | "Weak fit";
  summary: string;
  strengths: string[];
  risks: string[];
  recommendedUse: string;
  confidence: "Low" | "Medium" | "High";
  scoringMethod: "ai" | "source";
};

export type InfluencerEvaluationResponse = {
  product: string;
  openaiAgents: {
    used: boolean;
    model: string;
    note: string;
  };
  evaluations: InfluencerEvaluation[];
  disclaimer: string;
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
