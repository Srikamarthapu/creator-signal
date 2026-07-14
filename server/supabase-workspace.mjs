import crypto from "node:crypto";
import { createClient } from "@supabase/supabase-js";
import dotenv from "dotenv";

dotenv.config({ path: ".env.local", quiet: true });
dotenv.config({ quiet: true });

const supabaseUrl = (process.env.SUPABASE_URL || process.env.VITE_SUPABASE_URL || "").trim();
const publishableKey = (process.env.SUPABASE_PUBLISHABLE_KEY || process.env.VITE_SUPABASE_PUBLISHABLE_KEY || "").trim();
const secretKey = (process.env.SUPABASE_SECRET_KEY || process.env.SUPABASE_SERVICE_ROLE_KEY || "").trim();

const authClient = supabaseUrl && publishableKey
  ? createClient(supabaseUrl, publishableKey, { auth: { autoRefreshToken: false, persistSession: false } })
  : null;

export const workspaceAdmin = supabaseUrl && secretKey
  ? createClient(supabaseUrl, secretKey, { auth: { autoRefreshToken: false, persistSession: false } })
  : null;

export function workspaceIntegrationStatus() {
  return {
    configured: Boolean(authClient),
    persistenceConfigured: Boolean(workspaceAdmin),
    authRequired: String(process.env.REQUIRE_AUTH || "").toLowerCase() === "true"
  };
}

export async function authenticateRequest(request) {
  const authorization = String(request.headers.authorization || "");
  const match = authorization.match(/^Bearer\s+(.+)$/i);
  if (!authClient || !match) return { user: null, token: "" };
  const { data, error } = await authClient.auth.getUser(match[1]);
  if (error || !data.user) return { user: null, token: "" };
  return { user: data.user, token: match[1] };
}

export function requestOwnerKey(request) {
  if (request.creatorSignalAuth?.user?.id) return `user:${request.creatorSignalAuth.user.id}`;
  const address = request.ip || request.socket?.remoteAddress || "local";
  const agent = String(request.headers["user-agent"] || "local").slice(0, 200);
  return `local:${crypto.createHash("sha256").update(`${address}:${agent}`).digest("hex").slice(0, 24)}`;
}

export async function userCanAccessOrganization(userId, organizationId) {
  if (!workspaceAdmin || !userId || !organizationId) return false;
  const { data, error } = await workspaceAdmin
    .from("memberships")
    .select("id")
    .eq("org_id", organizationId)
    .eq("user_id", userId)
    .eq("status", "active")
    .maybeSingle();
  return !error && Boolean(data);
}

export async function userOrganizationRole(userId, organizationId) {
  if (!workspaceAdmin || !userId || !organizationId) return null;
  const { data, error } = await workspaceAdmin
    .from("memberships")
    .select("role")
    .eq("org_id", organizationId)
    .eq("user_id", userId)
    .eq("status", "active")
    .maybeSingle();
  return error ? null : data?.role || null;
}

export async function userCanManageOrganization(userId, organizationId) {
  return ["owner", "admin", "marketer"].includes(await userOrganizationRole(userId, organizationId));
}

function throwOnError(result, operation) {
  if (result.error) throw new Error(`${operation}: ${result.error.message}`);
  return result.data;
}

function sourceType(value) {
  if (value === "searchResult") return "search_result";
  return ["profile", "post", "article"].includes(value) ? value : "search_result";
}

async function assertResearchOwnership(organizationId, researchId) {
  const existingRun = throwOnError(await workspaceAdmin
    .from("research_runs")
    .select("org_id")
    .eq("id", researchId)
    .maybeSingle(), "Check research ownership");
  if (existingRun && existingRun.org_id !== organizationId) {
    throw new Error("Research run identifier already belongs to another organization.");
  }
}

async function upsertResearchRun({ userId, organizationId, snapshot, productBrief }) {
  const now = new Date();
  await assertResearchOwnership(organizationId, snapshot.id);
  throwOnError(await workspaceAdmin.from("research_runs").upsert({
    id: snapshot.id,
    org_id: organizationId,
    created_by: userId,
    status: "complete",
    search_input: snapshot.input,
    provider_snapshot: {
      discovery: "bright_data",
      model: process.env.NVIDIA_MODEL || "z-ai/glm-5.2",
      grounded: true
    },
    source_count: snapshot.sourceCount,
    creator_count: snapshot.creatorCount,
    product_brief: productBrief || undefined,
    completed_at: now.toISOString()
  }, { onConflict: "id" }), "Save research run");
}

function creatorIdentityKey(influencer) {
  return crypto.createHash("sha256").update([
    influencer.platform,
    influencer.handle || influencer.profileUrl || influencer.sourceUrl
  ].join(":").toLowerCase()).digest("hex");
}

async function upsertInfluencerEvidence({ organizationId, snapshot, influencer }) {
  const now = new Date();

  const creatorData = throwOnError(await workspaceAdmin.from("creator_records").upsert({
    org_id: organizationId,
    display_name: influencer.displayName,
    handle: influencer.handle || null,
    platform: influencer.platform,
    profile_url: influencer.profileUrl || null,
    niche: influencer.niche,
    identity_key: creatorIdentityKey(influencer),
    verification_class: "public_evidence",
    last_observed_at: now.toISOString()
  }, { onConflict: "org_id,identity_key" }).select("id").single(), "Save creator");

  const creatorId = creatorData.id;
  const evidenceData = throwOnError(await workspaceAdmin.from("evidence_sources").upsert({
    org_id: organizationId,
    research_run_id: snapshot.id,
    creator_id: creatorId,
    provider: "bright_data",
    source_url: influencer.sourceUrl,
    source_type: sourceType(influencer.sourceType),
    title: influencer.sourceTitle,
    excerpt: influencer.sourceDescription,
    verification_class: "public_evidence",
    confidence: influencer.confidence.toLowerCase(),
    observed_at: now.toISOString(),
    expires_at: new Date(now.getTime() + 30 * 24 * 60 * 60 * 1000).toISOString(),
    content_hash: crypto.createHash("sha256").update(`${influencer.sourceTitle}:${influencer.sourceDescription}`).digest("hex")
  }, { onConflict: "research_run_id,source_url" }).select("id").single(), "Save evidence");

  const recommendationData = throwOnError(await workspaceAdmin.from("creator_recommendations").upsert({
    org_id: organizationId,
    research_run_id: snapshot.id,
    creator_id: creatorId,
    primary_evidence_id: evidenceData.id,
    source_score: influencer.matchScore,
    confidence: influencer.confidence.toLowerCase(),
    match_reason: influencer.matchReason,
    strengths: influencer.evidence,
    risks: [],
    recommended_use: `Review the linked public evidence before outreach for ${snapshot.input.product}.`,
    model_snapshot: { discovery: "bright_data", score_type: "source" }
  }, { onConflict: "research_run_id,creator_id" }).select("id").single(), "Save recommendation");

  return {
    sourceUrl: influencer.sourceUrl,
    creatorId,
    evidenceId: evidenceData.id,
    recommendationId: recommendationData.id
  };
}

async function upsertProductEvidence({ organizationId, snapshot, source }) {
  if (!source.link) return null;
  const now = new Date();
  const evidenceData = throwOnError(await workspaceAdmin.from("evidence_sources").upsert({
    org_id: organizationId,
    research_run_id: snapshot.id,
    creator_id: null,
    provider: "bright_data",
    source_url: source.link,
    source_type: "product_source",
    title: source.title,
    excerpt: source.description,
    verification_class: "public_evidence",
    confidence: source.description ? "medium" : "low",
    observed_at: now.toISOString(),
    expires_at: new Date(now.getTime() + 14 * 24 * 60 * 60 * 1000).toISOString(),
    content_hash: crypto.createHash("sha256").update(`${source.title}:${source.description}`).digest("hex")
  }, { onConflict: "research_run_id,source_url" }).select("id").single(), "Save product evidence");
  return evidenceData.id;
}

export async function persistResearchSnapshot({ userId, organizationId, snapshot, productBrief }) {
  if (!workspaceAdmin) throw new Error("Workspace persistence is not configured.");
  await upsertResearchRun({ userId, organizationId, snapshot, productBrief });
  const [creatorRecords, productEvidence] = await Promise.all([
    Promise.all(snapshot.influencers.map((influencer) => upsertInfluencerEvidence({ organizationId, snapshot, influencer }))),
    Promise.all(snapshot.productSources.map((source) => upsertProductEvidence({ organizationId, snapshot, source })))
  ]);
  return {
    researchRunId: snapshot.id,
    creatorRecords,
    productEvidenceIds: productEvidence.filter(Boolean)
  };
}

export async function saveCreatorFromResearch({ userId, organizationId, snapshot, sourceUrl }) {
  const influencer = snapshot.influencers.find((candidate) => candidate.sourceUrl === sourceUrl);
  if (!influencer) return null;
  const persisted = await persistResearchSnapshot({ userId, organizationId, snapshot });
  const record = persisted.creatorRecords.find((candidate) => candidate.sourceUrl === sourceUrl);
  if (!record) return null;

  let shortlistData = throwOnError(await workspaceAdmin
    .from("shortlists")
    .select("id")
    .eq("org_id", organizationId)
    .eq("research_run_id", snapshot.id)
    .neq("status", "archived")
    .limit(1)
    .maybeSingle(), "Find shortlist");

  if (!shortlistData) {
    shortlistData = throwOnError(await workspaceAdmin.from("shortlists").insert({
      org_id: organizationId,
      research_run_id: snapshot.id,
      name: `${snapshot.input.product} shortlist`,
      status: "draft",
      created_by: userId
    }).select("id").single(), "Create shortlist");
  }

  const entryData = throwOnError(await workspaceAdmin.from("shortlist_entries").upsert({
    org_id: organizationId,
    shortlist_id: shortlistData.id,
    creator_id: record.creatorId,
    recommendation_id: record.recommendationId,
    decision: "saved",
    created_by: userId
  }, { onConflict: "shortlist_id,creator_id" }).select("id").single(), "Save shortlist entry");

  throwOnError(await workspaceAdmin.from("audit_events").insert({
    org_id: organizationId,
    actor_user_id: userId,
    event_type: "creator.shortlisted",
    entity_type: "shortlist_entry",
    entity_id: entryData.id,
    payload: {
      research_run_id: snapshot.id,
      creator_id: record.creatorId,
      evidence_source_id: record.evidenceId
    }
  }), "Record audit event");

  return {
    creatorId: record.creatorId,
    shortlistId: shortlistData.id,
    entryId: entryData.id
  };
}

function deterministicUuid(value) {
  const bytes = Buffer.from(crypto.createHash("sha256").update(value).digest("hex").slice(0, 32), "hex");
  bytes[6] = (bytes[6] & 0x0f) | 0x40;
  bytes[8] = (bytes[8] & 0x3f) | 0x80;
  const hex = bytes.toString("hex");
  return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-${hex.slice(12, 16)}-${hex.slice(16, 20)}-${hex.slice(20)}`;
}

export async function persistAgentExchange({ userId, organizationId, snapshot, userMessage, agentResult }) {
  if (!workspaceAdmin) throw new Error("Workspace persistence is not configured.");
  await persistResearchSnapshot({ userId, organizationId, snapshot });
  const requestMessageId = userMessage.id || crypto.randomUUID();
  const assistantMessageId = deterministicUuid(`${snapshot.id}:${requestMessageId}:assistant`);

  throwOnError(await workspaceAdmin.from("conversations").upsert({
    id: snapshot.id,
    org_id: organizationId,
    research_run_id: snapshot.id,
    title: `${snapshot.input.product} campaign copilot`,
    created_by: userId
  }, { onConflict: "id" }), "Save conversation");

  throwOnError(await workspaceAdmin.from("conversation_messages").upsert([{
    id: requestMessageId,
    org_id: organizationId,
    conversation_id: snapshot.id,
    author_user_id: userId,
    role: "user",
    content: userMessage.content,
    citations: []
  }, {
    id: assistantMessageId,
    org_id: organizationId,
    conversation_id: snapshot.id,
    author_user_id: null,
    role: "assistant",
    content: agentResult.answer,
    citations: agentResult.citations,
    model: agentResult.model
  }], { onConflict: "id" }), "Save conversation messages");

  const runData = throwOnError(await workspaceAdmin.from("agent_runs").upsert({
    org_id: organizationId,
    conversation_id: snapshot.id,
    requested_by: userId,
    request_message_id: requestMessageId,
    model: agentResult.model,
    provider: agentResult.providerUsed ? "nvidia" : "source_retrieval",
    status: agentResult.providerUsed ? "complete" : "degraded",
    source_count: agentResult.citations.length,
    completed_at: new Date().toISOString()
  }, { onConflict: "conversation_id,request_message_id" }).select("id").single(), "Save agent run");

  throwOnError(await workspaceAdmin.from("agent_tool_calls").delete().eq("agent_run_id", runData.id), "Refresh tool trace");
  if (agentResult.toolsUsed.length) {
    throwOnError(await workspaceAdmin.from("agent_tool_calls").insert(agentResult.toolsUsed.map((tool) => ({
      org_id: organizationId,
      agent_run_id: runData.id,
      tool_name: tool.name,
      output_summary: { label: tool.label },
      status: "complete"
    }))), "Save tool trace");
  }
  return { conversationId: snapshot.id, userMessageId: requestMessageId, assistantMessageId };
}

function toClientSourceType(value) {
  return value === "search_result" ? "searchResult" : value;
}

export async function loadResearchFromWorkspace({ organizationId, researchRunId }) {
  if (!workspaceAdmin) throw new Error("Workspace persistence is not configured.");
  const run = throwOnError(await workspaceAdmin
    .from("research_runs")
    .select("id, search_input, filter_state, product_brief, source_count, creator_count, started_at, completed_at")
    .eq("org_id", organizationId)
    .eq("id", researchRunId)
    .maybeSingle(), "Load research run");
  if (!run) return null;

  const [recommendations, evidenceSources, messages] = await Promise.all([
    workspaceAdmin
      .from("creator_recommendations")
      .select("id, creator_id, primary_evidence_id, rank, source_score, ai_score, confidence, match_reason, strengths, risks, recommended_use, model_snapshot")
      .eq("org_id", organizationId)
      .eq("research_run_id", researchRunId)
      .order("rank", { ascending: true, nullsFirst: false }),
    workspaceAdmin
      .from("evidence_sources")
      .select("id, creator_id, provider, source_url, source_type, title, excerpt, confidence, observed_at, expires_at")
      .eq("org_id", organizationId)
      .eq("research_run_id", researchRunId),
    workspaceAdmin
      .from("conversation_messages")
      .select("id, role, content, citations, model, created_at")
      .eq("org_id", organizationId)
      .eq("conversation_id", researchRunId)
      .in("role", ["user", "assistant"])
      .order("created_at", { ascending: true })
  ]);
  const recommendationRows = throwOnError(recommendations, "Load recommendations") || [];
  const sourceRows = throwOnError(evidenceSources, "Load evidence") || [];
  const messageRows = throwOnError(messages, "Load conversation") || [];
  const creatorIds = [...new Set(recommendationRows.map((row) => row.creator_id).filter(Boolean))];
  const creatorRows = creatorIds.length
    ? throwOnError(await workspaceAdmin
        .from("creator_records")
        .select("id, display_name, handle, platform, profile_url, niche")
        .eq("org_id", organizationId)
        .in("id", creatorIds), "Load creators") || []
    : [];
  const creatorById = new Map(creatorRows.map((creator) => [creator.id, creator]));
  const sourceById = new Map(sourceRows.map((source) => [source.id, source]));
  const creatorSource = new Map(sourceRows.filter((source) => source.creator_id).map((source) => [source.creator_id, source]));

  const influencers = recommendationRows.map((recommendation) => {
    const creator = creatorById.get(recommendation.creator_id);
    const source = sourceById.get(recommendation.primary_evidence_id) || creatorSource.get(recommendation.creator_id);
    if (!creator || !source) return null;
    return {
      displayName: creator.display_name,
      handle: creator.handle || undefined,
      platform: creator.platform,
      profileUrl: creator.profile_url || undefined,
      sourceUrl: source.source_url,
      sourceTitle: source.title,
      sourceDescription: source.excerpt || "Public source evidence saved from Bright Data.",
      niche: creator.niche || "Creator discovery result",
      matchReason: recommendation.match_reason,
      evidence: Array.isArray(recommendation.strengths) ? recommendation.strengths.map(String).slice(0, 4) : [],
      confidence: `${recommendation.confidence || source.confidence || "low"}`.replace(/^./, (letter) => letter.toUpperCase()),
      sourceType: toClientSourceType(source.source_type),
      matchScore: Number(recommendation.ai_score ?? recommendation.source_score ?? 0),
      observedAt: source.observed_at,
      expiresAt: source.expires_at || undefined
    };
  }).filter(Boolean);

  const productSources = sourceRows
    .filter((source) => source.source_type === "product_source")
    .map((source, index) => ({
      title: source.title,
      source: source.provider,
      description: source.excerpt || "",
      link: source.source_url,
      rank: index + 1
    }));

  return {
    id: run.id,
    input: run.search_input,
    filterState: run.filter_state,
    productBrief: run.product_brief,
    productSources,
    influencers,
    messages: messageRows.map((message) => ({
      id: message.id,
      role: message.role,
      content: message.content,
      citations: Array.isArray(message.citations) ? message.citations : [],
      model: message.model || undefined,
      providerUsed: message.role === "assistant" ? message.model === "z-ai/glm-5.2" : undefined,
      createdAt: message.created_at
    }))
  };
}

export async function loadShortlistFromWorkspace({ organizationId, shortlistId }) {
  if (!workspaceAdmin) throw new Error("Workspace persistence is not configured.");
  const shortlist = throwOnError(await workspaceAdmin
    .from("shortlists")
    .select("id, name, status, campaign_id, research_run_id, approved_by, approved_at, created_at, updated_at")
    .eq("org_id", organizationId)
    .eq("id", shortlistId)
    .maybeSingle(), "Load shortlist");
  if (!shortlist) return null;

  const research = shortlist.research_run_id
    ? throwOnError(await workspaceAdmin
        .from("research_runs")
        .select("id, search_input, source_count, creator_count, completed_at")
        .eq("org_id", organizationId)
        .eq("id", shortlist.research_run_id)
        .maybeSingle(), "Load shortlist research")
    : null;

  const entryRows = throwOnError(await workspaceAdmin
    .from("shortlist_entries")
    .select("id, creator_id, recommendation_id, decision, decision_reasons, tags, notes, position, created_at, updated_at")
    .eq("org_id", organizationId)
    .eq("shortlist_id", shortlistId)
    .order("position", { ascending: true })
    .order("created_at", { ascending: true }), "Load shortlist creators") || [];
  const creatorIds = [...new Set(entryRows.map((entry) => entry.creator_id).filter(Boolean))];
  const recommendationIds = [...new Set(entryRows.map((entry) => entry.recommendation_id).filter(Boolean))];

  const [creatorResult, recommendationResult] = await Promise.all([
    creatorIds.length
      ? workspaceAdmin
          .from("creator_records")
          .select("id, display_name, handle, platform, profile_url, niche, verification_class, last_observed_at")
          .eq("org_id", organizationId)
          .in("id", creatorIds)
      : Promise.resolve({ data: [], error: null }),
    recommendationIds.length
      ? workspaceAdmin
          .from("creator_recommendations")
          .select("id, creator_id, primary_evidence_id, rank, source_score, ai_score, confidence, match_reason, strengths, risks, recommended_use")
          .eq("org_id", organizationId)
          .in("id", recommendationIds)
      : Promise.resolve({ data: [], error: null })
  ]);
  const creatorRows = throwOnError(creatorResult, "Load shortlist creator records") || [];
  const recommendationRows = throwOnError(recommendationResult, "Load shortlist recommendations") || [];
  const evidenceIds = [...new Set(recommendationRows.map((recommendation) => recommendation.primary_evidence_id).filter(Boolean))];
  const evidenceRows = evidenceIds.length
    ? throwOnError(await workspaceAdmin
        .from("evidence_sources")
        .select("id, creator_id, provider, source_url, source_type, title, excerpt, verification_class, confidence, observed_at, expires_at")
        .eq("org_id", organizationId)
        .in("id", evidenceIds), "Load shortlist evidence") || []
    : [];

  const creatorById = new Map(creatorRows.map((creator) => [creator.id, creator]));
  const recommendationById = new Map(recommendationRows.map((recommendation) => [recommendation.id, recommendation]));
  const evidenceById = new Map(evidenceRows.map((evidence) => [evidence.id, evidence]));
  return {
    shortlist: {
      id: shortlist.id,
      name: shortlist.name,
      status: shortlist.status,
      campaignId: shortlist.campaign_id,
      researchRunId: shortlist.research_run_id,
      approvedBy: shortlist.approved_by,
      approvedAt: shortlist.approved_at,
      createdAt: shortlist.created_at,
      updatedAt: shortlist.updated_at
    },
    research: research ? {
      id: research.id,
      search: research.search_input,
      sourceCount: research.source_count,
      creatorCount: research.creator_count,
      completedAt: research.completed_at
    } : null,
    entries: entryRows.map((entry) => {
      const creator = creatorById.get(entry.creator_id);
      const recommendation = recommendationById.get(entry.recommendation_id);
      const evidence = recommendation ? evidenceById.get(recommendation.primary_evidence_id) : null;
      return {
        id: entry.id,
        decision: entry.decision,
        decisionReasons: entry.decision_reasons || [],
        tags: entry.tags || [],
        notes: entry.notes,
        position: entry.position,
        createdAt: entry.created_at,
        updatedAt: entry.updated_at,
        creator: creator ? {
          id: creator.id,
          displayName: creator.display_name,
          handle: creator.handle,
          platform: creator.platform,
          profileUrl: creator.profile_url,
          niche: creator.niche,
          verificationClass: creator.verification_class,
          lastObservedAt: creator.last_observed_at
        } : null,
        recommendation: recommendation ? {
          id: recommendation.id,
          rank: recommendation.rank,
          sourceScore: recommendation.source_score === null ? null : Number(recommendation.source_score),
          aiScore: recommendation.ai_score === null ? null : Number(recommendation.ai_score),
          confidence: recommendation.confidence,
          matchReason: recommendation.match_reason,
          strengths: Array.isArray(recommendation.strengths) ? recommendation.strengths : [],
          risks: Array.isArray(recommendation.risks) ? recommendation.risks : [],
          recommendedUse: recommendation.recommended_use
        } : null,
        evidence: evidence ? {
          id: evidence.id,
          provider: evidence.provider,
          sourceUrl: evidence.source_url,
          sourceType: evidence.source_type,
          title: evidence.title,
          excerpt: evidence.excerpt,
          verificationClass: evidence.verification_class,
          confidence: evidence.confidence,
          observedAt: evidence.observed_at,
          expiresAt: evidence.expires_at
        } : null
      };
    })
  };
}

export async function setShortlistEntryDecision({
  organizationId,
  shortlistId,
  entryId,
  userId,
  decision,
  reasons,
  notes
}) {
  if (!workspaceAdmin) throw new Error("Workspace persistence is not configured.");
  return throwOnError(await workspaceAdmin.rpc("workspace_set_shortlist_entry_decision", {
    p_org_id: organizationId,
    p_shortlist_id: shortlistId,
    p_entry_id: entryId,
    p_actor_user_id: userId,
    p_decision: decision,
    p_reasons: reasons,
    p_notes: notes || null
  }), "Save creator decision");
}

export async function transitionShortlist({ organizationId, shortlistId, userId, status }) {
  if (!workspaceAdmin) throw new Error("Workspace persistence is not configured.");
  return throwOnError(await workspaceAdmin.rpc("workspace_transition_shortlist", {
    p_org_id: organizationId,
    p_shortlist_id: shortlistId,
    p_actor_user_id: userId,
    p_status: status
  }), "Update shortlist status");
}

export async function createCampaignFromShortlist({
  organizationId,
  shortlistId,
  userId,
  name,
  creatorBudgetCents,
  startsOn,
  endsOn
}) {
  if (!workspaceAdmin) throw new Error("Workspace persistence is not configured.");
  return throwOnError(await workspaceAdmin.rpc("workspace_create_campaign_from_shortlist", {
    p_org_id: organizationId,
    p_shortlist_id: shortlistId,
    p_actor_user_id: userId,
    p_name: name,
    p_creator_budget_cents: creatorBudgetCents ?? null,
    p_starts_on: startsOn || null,
    p_ends_on: endsOn || null
  }), "Create campaign from shortlist");
}

export async function loadCampaignFromWorkspace({ organizationId, campaignId }) {
  if (!workspaceAdmin) throw new Error("Workspace persistence is not configured.");
  const campaign = throwOnError(await workspaceAdmin
    .from("campaigns")
    .select("id, name, product, status, goal, audience, geography, platform, deliverable, creator_budget_cents, service_budget_cents, currency, brief, starts_on, ends_on, owner_id, created_at, updated_at")
    .eq("org_id", organizationId)
    .eq("id", campaignId)
    .maybeSingle(), "Load campaign");
  if (!campaign) return null;

  const [shortlistResult, taskResult, draftResult, activityResult] = await Promise.all([
    workspaceAdmin
      .from("shortlists")
      .select("id")
      .eq("org_id", organizationId)
      .eq("campaign_id", campaignId)
      .order("updated_at", { ascending: false })
      .limit(1)
      .maybeSingle(),
    workspaceAdmin
      .from("campaign_tasks")
      .select("id, title, status, owner_id, due_at, created_by, created_at, updated_at")
      .eq("org_id", organizationId)
      .eq("campaign_id", campaignId)
      .order("created_at", { ascending: true }),
    workspaceAdmin
      .from("outreach_drafts")
      .select("id, creator_id, subject, body, source_references, approval_status, approved_by, approved_at, created_by, created_at, updated_at")
      .eq("org_id", organizationId)
      .eq("campaign_id", campaignId)
      .order("created_at", { ascending: false }),
    workspaceAdmin
      .from("audit_events")
      .select("id, actor_user_id, event_type, entity_type, entity_id, payload, created_at")
      .eq("org_id", organizationId)
      .order("created_at", { ascending: false })
      .limit(100)
  ]);
  const shortlistRow = throwOnError(shortlistResult, "Load campaign shortlist");
  const taskRows = throwOnError(taskResult, "Load campaign tasks") || [];
  const draftRows = throwOnError(draftResult, "Load outreach drafts") || [];
  const activityRows = throwOnError(activityResult, "Load campaign activity") || [];
  const shortlist = shortlistRow
    ? await loadShortlistFromWorkspace({ organizationId, shortlistId: shortlistRow.id })
    : null;
  const creatorIds = [...new Set(draftRows.map((draft) => draft.creator_id).filter(Boolean))];
  const creatorRows = creatorIds.length
    ? throwOnError(await workspaceAdmin
        .from("creator_records")
        .select("id, display_name, handle, platform, profile_url, niche")
        .eq("org_id", organizationId)
        .in("id", creatorIds), "Load outreach creators") || []
    : [];
  const creatorById = new Map(creatorRows.map((creator) => [creator.id, creator]));

  return {
    campaign: {
      id: campaign.id,
      name: campaign.name,
      product: campaign.product,
      status: campaign.status,
      goal: campaign.goal,
      audience: campaign.audience,
      geography: campaign.geography,
      platform: campaign.platform,
      deliverable: campaign.deliverable,
      creatorBudgetCents: campaign.creator_budget_cents === null ? null : Number(campaign.creator_budget_cents),
      serviceBudgetCents: campaign.service_budget_cents === null ? null : Number(campaign.service_budget_cents),
      currency: campaign.currency,
      brief: campaign.brief,
      startsOn: campaign.starts_on,
      endsOn: campaign.ends_on,
      ownerId: campaign.owner_id,
      createdAt: campaign.created_at,
      updatedAt: campaign.updated_at
    },
    shortlist,
    tasks: taskRows.map((task) => ({
      id: task.id,
      title: task.title,
      status: task.status,
      ownerId: task.owner_id,
      dueAt: task.due_at,
      createdBy: task.created_by,
      createdAt: task.created_at,
      updatedAt: task.updated_at
    })),
    outreachDrafts: draftRows.map((draft) => {
      const creator = creatorById.get(draft.creator_id);
      return {
        id: draft.id,
        creatorId: draft.creator_id,
        creator: creator ? {
          id: creator.id,
          displayName: creator.display_name,
          handle: creator.handle,
          platform: creator.platform,
          profileUrl: creator.profile_url,
          niche: creator.niche
        } : null,
        subject: draft.subject,
        body: draft.body,
        sourceReferences: Array.isArray(draft.source_references) ? draft.source_references : [],
        approvalStatus: draft.approval_status,
        approvedBy: draft.approved_by,
        approvedAt: draft.approved_at,
        createdBy: draft.created_by,
        createdAt: draft.created_at,
        updatedAt: draft.updated_at
      };
    }),
    activity: activityRows.filter((event) => (
      event.entity_id === campaignId || event.payload?.campaign_id === campaignId
    )).slice(0, 30).map((event) => ({
      id: event.id,
      actorUserId: event.actor_user_id,
      eventType: event.event_type,
      entityType: event.entity_type,
      entityId: event.entity_id,
      payload: event.payload,
      createdAt: event.created_at
    }))
  };
}

export async function setCampaignStatus({ organizationId, campaignId, userId, status }) {
  if (!workspaceAdmin) throw new Error("Workspace persistence is not configured.");
  return throwOnError(await workspaceAdmin.rpc("workspace_set_campaign_status", {
    p_org_id: organizationId,
    p_campaign_id: campaignId,
    p_actor_user_id: userId,
    p_status: status
  }), "Update campaign status");
}

export async function createCampaignTask({ organizationId, campaignId, userId, title, dueAt }) {
  if (!workspaceAdmin) throw new Error("Workspace persistence is not configured.");
  return throwOnError(await workspaceAdmin.rpc("workspace_create_campaign_task", {
    p_org_id: organizationId,
    p_campaign_id: campaignId,
    p_actor_user_id: userId,
    p_title: title,
    p_due_at: dueAt || null
  }), "Create campaign task");
}

export async function setCampaignTaskStatus({ organizationId, campaignId, taskId, userId, status }) {
  if (!workspaceAdmin) throw new Error("Workspace persistence is not configured.");
  return throwOnError(await workspaceAdmin.rpc("workspace_set_campaign_task_status", {
    p_org_id: organizationId,
    p_campaign_id: campaignId,
    p_task_id: taskId,
    p_actor_user_id: userId,
    p_status: status
  }), "Update campaign task");
}

export async function storeOutreachDraft({
  organizationId,
  campaignId,
  creatorId,
  userId,
  subject,
  body,
  sourceReferences
}) {
  if (!workspaceAdmin) throw new Error("Workspace persistence is not configured.");
  return throwOnError(await workspaceAdmin.rpc("workspace_store_outreach_draft", {
    p_org_id: organizationId,
    p_campaign_id: campaignId,
    p_creator_id: creatorId,
    p_actor_user_id: userId,
    p_subject: subject,
    p_body: body,
    p_source_references: sourceReferences
  }), "Save outreach draft");
}

export async function transitionOutreachDraft({ organizationId, campaignId, draftId, userId, status }) {
  if (!workspaceAdmin) throw new Error("Workspace persistence is not configured.");
  return throwOnError(await workspaceAdmin.rpc("workspace_transition_outreach_draft", {
    p_org_id: organizationId,
    p_campaign_id: campaignId,
    p_draft_id: draftId,
    p_actor_user_id: userId,
    p_status: status
  }), "Update outreach approval");
}

export async function updateOutreachDraft({ organizationId, campaignId, draftId, userId, subject, body }) {
  if (!workspaceAdmin) throw new Error("Workspace persistence is not configured.");
  return throwOnError(await workspaceAdmin.rpc("workspace_update_outreach_draft", {
    p_org_id: organizationId,
    p_campaign_id: campaignId,
    p_draft_id: draftId,
    p_actor_user_id: userId,
    p_subject: subject,
    p_body: body
  }), "Edit outreach draft");
}

function invitationTokenHash(token) {
  return crypto.createHash("sha256").update(token).digest("hex");
}

function maskEmail(value) {
  const [local = "", domain = ""] = String(value || "").split("@");
  if (!domain) return "Invited account";
  const visible = local.slice(0, Math.min(2, local.length));
  return `${visible}${"*".repeat(Math.max(3, local.length - visible.length))}@${domain}`;
}

function normalizeInvitation(row) {
  return {
    id: row.id,
    email: row.email,
    role: row.role,
    status: row.status,
    expiresAt: row.expires_at,
    acceptedAt: row.accepted_at || null,
    createdAt: row.created_at
  };
}

export async function loadWorkspaceSettings({ organizationId, userId }) {
  if (!workspaceAdmin) throw new Error("Workspace persistence is not configured.");
  const role = await userOrganizationRole(userId, organizationId);
  if (!role) return null;
  const canManageTeam = ["owner", "admin"].includes(role);

  const monthStart = new Date();
  monthStart.setUTCDate(1);
  monthStart.setUTCHours(0, 0, 0, 0);
  const [organizationResult, membershipResult, invitationResult, accountResult, activityResult, profileResult, entitlementResult, usageResult] = await Promise.all([
    workspaceAdmin
      .from("organizations")
      .select("id, name, slug, organization_type, created_at, updated_at")
      .eq("id", organizationId)
      .maybeSingle(),
    workspaceAdmin
      .from("memberships")
      .select("id, user_id, role, status, created_at, updated_at")
      .eq("org_id", organizationId)
      .order("created_at", { ascending: true }),
    canManageTeam
      ? workspaceAdmin
          .from("invitations")
          .select("id, email, role, status, expires_at, accepted_at, created_at")
          .eq("org_id", organizationId)
          .order("created_at", { ascending: false })
          .limit(30)
      : Promise.resolve({ data: [], error: null }),
    workspaceAdmin
      .from("account_requests")
      .select("id, request_type, status, requested_at, completed_at")
      .eq("user_id", userId)
      .order("requested_at", { ascending: false })
      .limit(20),
    workspaceAdmin
      .from("audit_events")
      .select("id, actor_user_id, event_type, entity_type, entity_id, payload, created_at")
      .eq("org_id", organizationId)
      .like("event_type", "workspace.%")
      .order("created_at", { ascending: false })
      .limit(20),
    workspaceAdmin
      .from("profiles")
      .select("id, display_name, account_type, onboarding_completed")
      .eq("id", userId)
      .maybeSingle(),
    workspaceAdmin
      .from("organization_entitlements")
      .select("org_id, plan, status, seat_limit, research_runs_limit, starts_at, ends_at, updated_at")
      .eq("org_id", organizationId)
      .maybeSingle(),
    workspaceAdmin
      .from("research_runs")
      .select("id", { count: "exact", head: true })
      .eq("org_id", organizationId)
      .gte("started_at", monthStart.toISOString())
  ]);

  const organization = throwOnError(organizationResult, "Load organization settings");
  const membershipRows = throwOnError(membershipResult, "Load workspace members") || [];
  const invitationRows = throwOnError(invitationResult, "Load workspace invitations") || [];
  const accountRows = throwOnError(accountResult, "Load account requests") || [];
  const activityRows = throwOnError(activityResult, "Load team activity") || [];
  const profile = throwOnError(profileResult, "Load account profile");
  const entitlement = throwOnError(entitlementResult, "Load workspace entitlement");
  if (usageResult.error) throw new Error(`Load workspace usage: ${usageResult.error.message}`);
  if (!organization) return null;

  const memberProfiles = membershipRows.length
    ? throwOnError(await workspaceAdmin
        .from("profiles")
        .select("id, display_name, account_type")
        .in("id", membershipRows.map((membership) => membership.user_id)), "Load member profiles") || []
    : [];
  const profileById = new Map(memberProfiles.map((memberProfile) => [memberProfile.id, memberProfile]));
  const authUsers = await Promise.all(membershipRows.map(async (membership) => {
    const result = await workspaceAdmin.auth.admin.getUserById(membership.user_id);
    return [membership.user_id, result.error ? null : result.data.user];
  }));
  const authUserById = new Map(authUsers);
  const now = Date.now();

  return {
    organization: {
      id: organization.id,
      name: organization.name,
      slug: organization.slug,
      organizationType: organization.organization_type,
      createdAt: organization.created_at,
      updatedAt: organization.updated_at
    },
    members: membershipRows.map((membership) => {
      const memberProfile = profileById.get(membership.user_id);
      const authUser = authUserById.get(membership.user_id);
      return {
        id: membership.id,
        userId: membership.user_id,
        displayName: memberProfile?.display_name || authUser?.email?.split("@")[0] || "Workspace member",
        email: authUser?.email || null,
        accountType: memberProfile?.account_type || "professional",
        role: membership.role,
        status: membership.status,
        isCurrentUser: membership.user_id === userId,
        joinedAt: membership.created_at,
        updatedAt: membership.updated_at
      };
    }),
    invitations: invitationRows.map((invitation) => ({
      ...normalizeInvitation(invitation),
      status: invitation.status === "pending" && new Date(invitation.expires_at).getTime() <= now
        ? "expired"
        : invitation.status
    })),
    profile: profile ? {
      id: profile.id,
      displayName: profile.display_name,
      accountType: profile.account_type,
      onboardingCompleted: profile.onboarding_completed
    } : null,
    entitlement: entitlement ? {
      organizationId: entitlement.org_id,
      plan: entitlement.plan,
      status: entitlement.status,
      seatLimit: entitlement.seat_limit,
      researchRunsLimit: entitlement.research_runs_limit,
      researchRunsUsed: usageResult.count || 0,
      activeSeats: membershipRows.filter((membership) => membership.status === "active").length,
      startsAt: entitlement.starts_at,
      endsAt: entitlement.ends_at,
      updatedAt: entitlement.updated_at
    } : null,
    accountRequests: accountRows.map((accountRequest) => ({
      id: accountRequest.id,
      requestType: accountRequest.request_type,
      status: accountRequest.status,
      requestedAt: accountRequest.requested_at,
      completedAt: accountRequest.completed_at
    })),
    activity: activityRows.map((event) => ({
      id: event.id,
      actorUserId: event.actor_user_id,
      eventType: event.event_type,
      entityType: event.entity_type,
      entityId: event.entity_id,
      payload: event.payload,
      createdAt: event.created_at
    })),
    permissions: {
      role,
      canManageTeam,
      canManageOwners: role === "owner"
    }
  };
}

export async function createWorkspaceInvitation({ organizationId, userId, email, role, appOrigin }) {
  if (!workspaceAdmin) throw new Error("Workspace persistence is not configured.");
  const token = crypto.randomBytes(32).toString("base64url");
  const expiresAt = new Date(Date.now() + 7 * 24 * 60 * 60 * 1000).toISOString();
  const invitation = throwOnError(await workspaceAdmin.rpc("workspace_create_invitation", {
    p_org_id: organizationId,
    p_actor_user_id: userId,
    p_email: email,
    p_role: role,
    p_token_hash: invitationTokenHash(token),
    p_expires_at: expiresAt
  }), "Create workspace invitation");
  const origin = String(appOrigin || "http://127.0.0.1:5173").replace(/\/$/, "");
  return {
    invitation: normalizeInvitation(invitation),
    inviteLink: `${origin}/invite/${token}`,
    delivery: "share_link"
  };
}

export async function previewWorkspaceInvitation(token) {
  if (!workspaceAdmin) throw new Error("Workspace persistence is not configured.");
  const invitation = throwOnError(await workspaceAdmin
    .from("invitations")
    .select("id, email, role, status, expires_at, accepted_at, organizations!inner(id, name)")
    .eq("token_hash", invitationTokenHash(token))
    .maybeSingle(), "Preview workspace invitation");
  if (!invitation) return null;
  const organizationValue = Array.isArray(invitation.organizations)
    ? invitation.organizations[0]
    : invitation.organizations;
  const expired = invitation.status === "pending" && new Date(invitation.expires_at).getTime() <= Date.now();
  return {
    id: invitation.id,
    organizationId: organizationValue?.id || null,
    organizationName: organizationValue?.name || "CreatorSignal workspace",
    invitedEmail: maskEmail(invitation.email),
    role: invitation.role,
    status: expired ? "expired" : invitation.status,
    expiresAt: invitation.expires_at
  };
}

export async function acceptWorkspaceInvitation({ token, userId }) {
  if (!workspaceAdmin) throw new Error("Workspace persistence is not configured.");
  const result = throwOnError(await workspaceAdmin.rpc("workspace_accept_invitation", {
    p_token_hash: invitationTokenHash(token),
    p_actor_user_id: userId
  }), "Accept workspace invitation");
  return {
    organizationId: result.organization_id,
    organizationName: result.organization_name,
    membershipId: result.membership_id,
    role: result.role
  };
}

export async function revokeWorkspaceInvitation({ organizationId, invitationId, userId }) {
  if (!workspaceAdmin) throw new Error("Workspace persistence is not configured.");
  return throwOnError(await workspaceAdmin.rpc("workspace_revoke_invitation", {
    p_org_id: organizationId,
    p_invitation_id: invitationId,
    p_actor_user_id: userId
  }), "Revoke workspace invitation");
}

export async function updateWorkspaceMember({ organizationId, membershipId, userId, role, status }) {
  if (!workspaceAdmin) throw new Error("Workspace persistence is not configured.");
  return throwOnError(await workspaceAdmin.rpc("workspace_update_member", {
    p_org_id: organizationId,
    p_membership_id: membershipId,
    p_actor_user_id: userId,
    p_role: role,
    p_status: status
  }), "Update workspace member");
}

export async function removeWorkspaceMember({ organizationId, membershipId, userId }) {
  if (!workspaceAdmin) throw new Error("Workspace persistence is not configured.");
  return throwOnError(await workspaceAdmin.rpc("workspace_remove_member", {
    p_org_id: organizationId,
    p_membership_id: membershipId,
    p_actor_user_id: userId
  }), "Remove workspace member");
}

export async function createAccountRequest({ userId, requestType }) {
  if (!workspaceAdmin) throw new Error("Workspace persistence is not configured.");
  const result = throwOnError(await workspaceAdmin.rpc("account_create_request", {
    p_actor_user_id: userId,
    p_request_type: requestType
  }), "Create account request");
  return {
    id: result.id,
    requestType: result.request_type,
    status: result.status,
    requestedAt: result.requested_at,
    completedAt: result.completed_at
  };
}

export async function cancelAccountRequest({ userId, requestId }) {
  if (!workspaceAdmin) throw new Error("Workspace persistence is not configured.");
  return throwOnError(await workspaceAdmin.rpc("account_cancel_request", {
    p_actor_user_id: userId,
    p_request_id: requestId
  }), "Cancel account request");
}

export async function updateAccountProfile({ userId, displayName, accountType }) {
  if (!workspaceAdmin) throw new Error("Workspace persistence is not configured.");
  const profile = throwOnError(await workspaceAdmin
    .from("profiles")
    .update({
      display_name: displayName,
      account_type: accountType,
      onboarding_completed: true
    })
    .eq("id", userId)
    .select("id, display_name, account_type, onboarding_completed")
    .single(), "Update account profile");
  return {
    id: profile.id,
    displayName: profile.display_name,
    accountType: profile.account_type,
    onboardingCompleted: profile.onboarding_completed
  };
}

function normalizeEntitlement(row, usage = 0) {
  if (!row) return null;
  return {
    organizationId: row.org_id,
    plan: row.plan,
    status: row.status,
    seatLimit: row.seat_limit,
    researchRunsLimit: row.research_runs_limit,
    researchRunsUsed: usage,
    startsAt: row.starts_at,
    endsAt: row.ends_at,
    updatedAt: row.updated_at
  };
}

export async function organizationEntitlementAccess({ organizationId, userId, researchRunId }) {
  if (!workspaceAdmin) return { allowed: true, entitlement: null, reason: "Workspace persistence is not configured." };
  if (!await userCanAccessOrganization(userId, organizationId)) {
    return { allowed: false, entitlement: null, reason: "You do not have access to that workspace." };
  }
  const monthStart = new Date();
  monthStart.setUTCDate(1);
  monthStart.setUTCHours(0, 0, 0, 0);
  const [entitlementResult, usageResult] = await Promise.all([
    workspaceAdmin
      .from("organization_entitlements")
      .select("org_id, plan, status, seat_limit, research_runs_limit, starts_at, ends_at, updated_at")
      .eq("org_id", organizationId)
      .maybeSingle(),
    workspaceAdmin
      .from("research_runs")
      .select("id", { count: "exact", head: true })
      .eq("org_id", organizationId)
      .gte("started_at", monthStart.toISOString())
  ]);
  const row = throwOnError(entitlementResult, "Load organization entitlement");
  if (usageResult.error) throw new Error(`Load organization usage: ${usageResult.error.message}`);
  const usage = usageResult.count || 0;
  const entitlement = normalizeEntitlement(row, usage);
  if (!entitlement) return { allowed: false, entitlement: null, reason: "This workspace has no active product access." };
  if (!["trialing", "active"].includes(entitlement.status)) {
    return { allowed: false, entitlement, reason: `This workspace access is ${entitlement.status.replaceAll("_", " ")}.` };
  }
  if (entitlement.endsAt && new Date(entitlement.endsAt).getTime() <= Date.now()) {
    return { allowed: false, entitlement, reason: "This workspace access period has ended." };
  }
  if (entitlement.researchRunsUsed >= entitlement.researchRunsLimit) {
    const existingRun = researchRunId
      ? throwOnError(await workspaceAdmin
          .from("research_runs")
          .select("id")
          .eq("org_id", organizationId)
          .eq("id", researchRunId)
          .maybeSingle(), "Check existing research access")
      : null;
    if (!existingRun) {
      return { allowed: false, entitlement, reason: "This workspace reached its monthly research limit." };
    }
  }
  return { allowed: true, entitlement, reason: "" };
}

function sanitizedProviderSummary(value) {
  return String(value || "")
    .replace(/(sk-|nvapi-|AQ\.|AIza|sb_secret_)[A-Za-z0-9_.-]+/g, "[redacted]")
    .replace(/\s+/g, " ")
    .trim()
    .slice(0, 500) || null;
}

export async function startProviderJob({ organizationId, userId, researchRunId, provider, operation, model, metadata }) {
  if (!workspaceAdmin || !organizationId || !userId) return null;
  if (!await userCanAccessOrganization(userId, organizationId)) return null;
  let linkedResearchRunId = null;
  if (researchRunId) {
    const existingRun = throwOnError(await workspaceAdmin
      .from("research_runs")
      .select("id")
      .eq("org_id", organizationId)
      .eq("id", researchRunId)
      .maybeSingle(), "Check provider research link");
    linkedResearchRunId = existingRun?.id || null;
  }
  const job = throwOnError(await workspaceAdmin.from("provider_jobs").insert({
    org_id: organizationId,
    requested_by: userId,
    research_run_id: linkedResearchRunId,
    provider,
    operation,
    status: "running",
    model: model || null,
    metadata: metadata || {}
  }).select("id, started_at").single(), "Start provider diagnostic");
  return { id: job.id, startedAt: job.started_at, organizationId, researchRunId: researchRunId || null };
}

export async function finishProviderJob({ job, status, sourceCount, errorCategory, errorSummary, metadata }) {
  if (!workspaceAdmin || !job?.id) return;
  const completedAt = new Date();
  const startedAt = new Date(job.startedAt);
  const latencyMs = Math.max(0, completedAt.getTime() - startedAt.getTime());
  const update = {
    status,
    latency_ms: latencyMs,
    source_count: Math.max(0, Number(sourceCount || 0)),
    error_category: errorCategory || null,
    error_summary: sanitizedProviderSummary(errorSummary),
    metadata: metadata || {},
    completed_at: completedAt.toISOString()
  };
  if (job.researchRunId) {
    const existingRun = throwOnError(await workspaceAdmin
      .from("research_runs")
      .select("id")
      .eq("org_id", job.organizationId)
      .eq("id", job.researchRunId)
      .maybeSingle(), "Check completed provider research link");
    if (existingRun) update.research_run_id = existingRun.id;
  }
  throwOnError(await workspaceAdmin.from("provider_jobs").update(update).eq("id", job.id), "Finish provider diagnostic");
}

export async function isPlatformOperator(userId) {
  if (!workspaceAdmin || !userId) return false;
  const { data, error } = await workspaceAdmin.auth.admin.getUserById(userId);
  if (error || !data.user) return false;
  return ["operator", "admin"].includes(data.user.app_metadata?.platform_role);
}

export async function loadSupportDashboard({ userId, attentionOnly = false }) {
  if (!workspaceAdmin) throw new Error("Workspace persistence is not configured.");
  if (!await isPlatformOperator(userId)) return null;
  let jobQuery = workspaceAdmin
    .from("provider_jobs")
    .select("id, org_id, requested_by, research_run_id, provider, operation, status, request_id, model, latency_ms, source_count, error_category, error_summary, metadata, started_at, completed_at, created_at, organizations!inner(id, name)")
    .order("created_at", { ascending: false })
    .limit(100);
  if (attentionOnly) jobQuery = jobQuery.in("status", ["degraded", "failed"]);
  const [jobResult, entitlementResult] = await Promise.all([
    jobQuery,
    workspaceAdmin
      .from("organization_entitlements")
      .select("org_id, plan, status, seat_limit, research_runs_limit, starts_at, ends_at, updated_at, organizations!inner(id, name)")
      .order("updated_at", { ascending: false })
      .limit(100)
  ]);
  const jobRows = throwOnError(jobResult, "Load provider diagnostics") || [];
  const entitlementRows = throwOnError(entitlementResult, "Load organization entitlements") || [];
  const requestedByIds = [...new Set(jobRows.map((job) => job.requested_by).filter(Boolean))];
  const userEntries = await Promise.all(requestedByIds.map(async (requestedBy) => {
    const result = await workspaceAdmin.auth.admin.getUserById(requestedBy);
    return [requestedBy, result.error ? null : result.data.user?.email || null];
  }));
  const emailByUserId = new Map(userEntries);
  const organizationValue = (value) => Array.isArray(value) ? value[0] : value;
  const jobs = jobRows.map((job) => ({
    id: job.id,
    organizationId: job.org_id,
    organizationName: organizationValue(job.organizations)?.name || "Unknown workspace",
    requestedBy: job.requested_by,
    requestedByEmail: emailByUserId.get(job.requested_by) || null,
    researchRunId: job.research_run_id,
    provider: job.provider,
    operation: job.operation,
    status: job.status,
    requestId: job.request_id,
    model: job.model,
    latencyMs: job.latency_ms,
    sourceCount: job.source_count,
    errorCategory: job.error_category,
    errorSummary: job.error_summary,
    metadata: job.metadata,
    startedAt: job.started_at,
    completedAt: job.completed_at,
    createdAt: job.created_at
  }));
  const lastDay = Date.now() - 24 * 60 * 60 * 1000;
  const recentJobs = jobs.filter((job) => new Date(job.createdAt).getTime() >= lastDay);
  return {
    summary: {
      jobsLast24Hours: recentJobs.length,
      completeLast24Hours: recentJobs.filter((job) => job.status === "complete").length,
      degradedLast24Hours: recentJobs.filter((job) => job.status === "degraded").length,
      failedLast24Hours: recentJobs.filter((job) => job.status === "failed").length,
      workspaces: entitlementRows.length,
      restrictedWorkspaces: entitlementRows.filter((row) => !["trialing", "active"].includes(row.status)).length
    },
    jobs,
    entitlements: entitlementRows.map((row) => ({
      ...normalizeEntitlement(row),
      organizationName: organizationValue(row.organizations)?.name || "Unknown workspace"
    }))
  };
}

export async function updateOrganizationEntitlement({
  organizationId,
  userId,
  plan,
  status,
  seatLimit,
  researchRunsLimit,
  endsAt
}) {
  if (!workspaceAdmin) throw new Error("Workspace persistence is not configured.");
  const result = throwOnError(await workspaceAdmin.rpc("platform_update_entitlement", {
    p_org_id: organizationId,
    p_actor_user_id: userId,
    p_plan: plan,
    p_status: status,
    p_seat_limit: seatLimit,
    p_research_runs_limit: researchRunsLimit,
    p_ends_at: endsAt || null
  }), "Update organization entitlement");
  return normalizeEntitlement(result);
}
