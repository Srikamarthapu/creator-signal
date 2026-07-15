export type Platform = "TikTok" | "Instagram" | "YouTube";
export type CampaignRisk = "Low" | "Medium" | "High";

export type SearchState = {
  product: string;
  goal: string;
  budget: string;
  platform: Platform | "Any";
  audience: string;
  creatorCriteria?: string;
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
  campaignAgent: {
    configured: boolean;
    model: string;
    provider: string;
    displayName: string;
    grounding: string;
  };
  workspace: {
    configured: boolean;
    persistenceConfigured: boolean;
    authRequired: boolean;
    provider: "supabase";
  };
};

export type ResearchSessionMeta = {
  id: string;
  conversationId?: string;
  product: string;
  sourceCount: number;
  creatorCount: number;
  createdAt: string;
  expiresAt: string;
  grounded: true;
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
  researchSession: ResearchSessionMeta;
  workspacePersistence?: WorkspacePersistence;
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
  researchSession: ResearchSessionMeta;
  workspacePersistence?: WorkspacePersistence;
  caveat: string;
  disclaimer: string;
};

export type CampaignAgentRole = "user" | "assistant";

export type CampaignAgentAction = {
  id: string;
  type: "save_creator";
  creatorName: string;
  sourceUrl: string;
  evidenceId: string;
  label: string;
  requiresConfirmation: true;
  status: "pending" | "processing" | "saved" | "failed";
  result?: {
    shortlistId: string;
    entryId: string;
  };
  error?: string;
};

export type CampaignAgentMessage = {
  id: string;
  role: CampaignAgentRole;
  content: string;
  citations?: CampaignAgentCitation[];
  actions?: CampaignAgentAction[];
  toolsUsed?: CampaignAgentToolTrace[];
  providerUsed?: boolean;
  model?: string;
  note?: string;
  createdAt: string;
};

export type CampaignAgentCitation = {
  id: string;
  title: string;
  url: string;
  excerpt: string;
  creatorName?: string;
};

export type CampaignAgentToolTrace = {
  name: string;
  label: string;
};

export type CampaignBriefStatus = "draft" | "review" | "approved" | "rejected";

export type CampaignBriefContent = {
  campaignName: string;
  objective: string;
  audience: string;
  platforms: string[];
  geography: string;
  budget: {
    label: string;
    creatorSpend: string;
  };
  timing: {
    launchDate: string;
    campaignWindow: string;
  };
  deliverables: string[];
  creatorCriteria: string;
  keyMessage: string;
  successMeasures: string[];
  assumptions: string[];
};

export type CampaignBriefRecord = {
  id: string;
  organizationId: string;
  researchRunId: string;
  status: CampaignBriefStatus;
  version: number;
  brief: CampaignBriefContent;
  citations: CampaignAgentCitation[];
  provider: "nvidia" | "source_retrieval" | "user";
  model: string | null;
  createdBy: string;
  reviewedBy: string | null;
  reviewedAt: string | null;
  approvedBy: string | null;
  approvedAt: string | null;
  createdAt: string;
  updatedAt: string;
};

export type CampaignBriefPermissions = {
  role: WorkspaceRole;
  canEdit: boolean;
  canApprove: boolean;
};

export type CampaignAgentResponse = {
  status: "ok";
  session: ResearchSessionMeta;
  answer: string;
  citations: CampaignAgentCitation[];
  actions: CampaignAgentAction[];
  suggestions: string[];
  toolsUsed: CampaignAgentToolTrace[];
  providerUsed: boolean;
  model: string;
  note: string;
  grounded: true;
  disclaimer: string;
  workspacePersistence?: WorkspacePersistence & {
    conversationId?: string;
    userMessageId?: string;
    assistantMessageId?: string;
  };
};

export type DiscoveryAgentResponse = {
  conversationId: string;
  action: "clarify" | "search";
  answer: string;
  searchPlan: SearchState | null;
  toolsUsed: CampaignAgentToolTrace[];
  providerUsed: boolean;
  model: string;
  note: string;
  grounded: false;
  grounding: "customer_requirements";
  disclaimer: string;
  workspacePersistence?: WorkspacePersistence & {
    conversationId?: string;
    userMessageId?: string;
    assistantMessageId?: string;
    agentRunId?: string;
  };
};

export type WorkspacePersistence = {
  saved: boolean;
  reason?: string;
  researchRunId?: string;
  conversationId?: string;
  conversationLinked?: boolean;
  conversationCompletionSaved?: boolean;
  creatorCount?: number;
  evidenceCount?: number;
};

export type SavedResearchResponse = {
  search: Partial<SearchState> & { product: string };
  filterState: Record<string, unknown>;
  productBrief: ProductIntelligence["brief"] | null;
  productSources: ProductIntelligence["brightData"]["sources"];
  influencers: RealInfluencer[];
  messages: CampaignAgentMessage[];
  researchSession: ResearchSessionMeta;
  resumed: true;
};

export type SavedAgentConversationResponse = {
  conversation: {
    id: string;
    title: string;
    researchRunId: string | null;
    messages: CampaignAgentMessage[];
    createdAt: string;
    updatedAt: string;
  };
};

export type WorkspaceRole = "owner" | "admin" | "marketer" | "approver" | "analyst";
export type ShortlistStatus = "draft" | "review" | "approved" | "archived";
export type ShortlistDecision = "saved" | "rejected" | "restored" | "archived";

export type ShortlistDetailResponse = {
  shortlist: {
    id: string;
    name: string;
    status: ShortlistStatus;
    campaignId: string | null;
    researchRunId: string | null;
    approvedBy: string | null;
    approvedAt: string | null;
    createdAt: string;
    updatedAt: string;
  };
  research: {
    id: string;
    search: Partial<SearchState> & { product?: string };
    sourceCount: number;
    creatorCount: number;
    completedAt: string | null;
  } | null;
  entries: Array<{
    id: string;
    decision: ShortlistDecision;
    decisionReasons: string[];
    tags: string[];
    notes: string | null;
    position: number;
    createdAt: string;
    updatedAt: string;
    creator: {
      id: string;
      displayName: string;
      handle: string | null;
      platform: string;
      profileUrl: string | null;
      niche: string | null;
      verificationClass: string;
      lastObservedAt: string;
    } | null;
    recommendation: {
      id: string;
      rank: number | null;
      sourceScore: number | null;
      aiScore: number | null;
      confidence: "low" | "medium" | "high";
      matchReason: string;
      strengths: string[];
      risks: string[];
      recommendedUse: string | null;
    } | null;
    evidence: {
      id: string;
      provider: string;
      sourceUrl: string;
      sourceType: string;
      title: string;
      excerpt: string | null;
      verificationClass: string;
      confidence: "low" | "medium" | "high";
      observedAt: string;
      expiresAt: string | null;
    } | null;
  }>;
  permissions: {
    role: WorkspaceRole;
    canManage: boolean;
    canApprove: boolean;
  };
};

export type CampaignStatus = "draft" | "sourcing" | "outreach" | "negotiation" | "contracted" | "active" | "review" | "complete" | "cancelled";
export type CampaignTaskStatus = "open" | "in_progress" | "blocked" | "done" | "cancelled";
export type OutreachApprovalStatus = "draft" | "review" | "approved" | "rejected";

export type CampaignDetailResponse = {
  campaign: {
    id: string;
    name: string;
    product: string;
    status: CampaignStatus;
    goal: string | null;
    audience: string | null;
    geography: string | null;
    platform: string | null;
    deliverable: string | null;
    creatorBudgetCents: number | null;
    serviceBudgetCents: number | null;
    currency: string;
    brief: Record<string, unknown>;
    startsOn: string | null;
    endsOn: string | null;
    ownerId: string | null;
    createdAt: string;
    updatedAt: string;
  };
  shortlist: Omit<ShortlistDetailResponse, "permissions"> | null;
  tasks: Array<{
    id: string;
    title: string;
    status: CampaignTaskStatus;
    ownerId: string | null;
    dueAt: string | null;
    createdBy: string;
    createdAt: string;
    updatedAt: string;
  }>;
  outreachDrafts: Array<{
    id: string;
    creatorId: string;
    creator: {
      id: string;
      displayName: string;
      handle: string | null;
      platform: string;
      profileUrl: string | null;
      niche: string | null;
    } | null;
    subject: string | null;
    body: string;
    sourceReferences: Array<{
      id?: string;
      title: string;
      url: string;
      excerpt?: string;
      creatorName?: string;
      provider?: string;
    }>;
    approvalStatus: OutreachApprovalStatus;
    approvedBy: string | null;
    approvedAt: string | null;
    createdBy: string;
    createdAt: string;
    updatedAt: string;
  }>;
  activity: Array<{
    id: number;
    actorUserId: string | null;
    eventType: string;
    entityType: string;
    entityId: string | null;
    payload: Record<string, unknown>;
    createdAt: string;
  }>;
  permissions: {
    role: WorkspaceRole;
    canManage: boolean;
    canApprove: boolean;
  };
  campaignAgent: {
    configured: boolean;
    model: string;
  };
};
