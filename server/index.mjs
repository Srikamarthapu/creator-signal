import cors from "cors";
import dotenv from "dotenv";
import express from "express";
import { Agent, run } from "@openai/agents";
import { z } from "zod";
import {
  ResearchSessionConflictError,
  draftGroundedCampaignBrief,
  draftGroundedOutreach,
  getResearchSessionSnapshot,
  planCreatorDiscovery,
  runGroundedCampaignAgent,
  upsertResearchSession
} from "./research-agent.mjs";
import {
  acceptWorkspaceInvitation,
  authenticateRequest,
  cancelAccountRequest,
  createCampaignFromShortlist,
  createCampaignTask,
  createAccountRequest,
  createWorkspaceInvitation,
  finishProviderJob,
  isPlatformOperator,
  loadCampaignBrief,
  loadCampaignFromWorkspace,
  loadSupportDashboard,
  loadWorkspaceSettings,
  loadShortlistFromWorkspace,
  loadResearchFromWorkspace,
  organizationEntitlementAccess,
  previewWorkspaceInvitation,
  removeWorkspaceMember,
  requestOwnerKey,
  saveCampaignBrief,
  persistAgentExchange,
  persistResearchSnapshot,
  revokeWorkspaceInvitation,
  saveCreatorFromResearch,
  setCampaignStatus,
  setCampaignTaskStatus,
  setShortlistEntryDecision,
  startProviderJob,
  transitionShortlist,
  transitionCampaignBrief,
  transitionOutreachDraft,
  updateAccountProfile,
  updateOrganizationEntitlement,
  updateOutreachDraft,
  updateWorkspaceMember,
  userOrganizationRole,
  userCanManageOrganization,
  userCanAccessOrganization,
  storeOutreachDraft,
  workspaceIntegrationStatus
} from "./supabase-workspace.mjs";

dotenv.config({ path: ".env.local", quiet: true });
dotenv.config({ quiet: true });

const app = express();
const port = Number(process.env.API_PORT || 8787);

app.use(cors({ origin: ["http://127.0.0.1:5173", "http://localhost:5173"] }));
app.use(express.json({ limit: "1mb" }));

app.use("/api", async (request, response, next) => {
  try {
    request.creatorSignalAuth = await authenticateRequest(request);
    const publicPath = request.path === "/health"
      || request.path === "/integrations/status"
      || /^\/invitations\/[A-Za-z0-9_-]{20,100}$/.test(request.path);
    if (!publicPath && workspaceIntegrationStatus().authRequired && !request.creatorSignalAuth.user) {
      response.status(401).json({ error: "Sign in to use creator research in this environment." });
      return;
    }
    next();
  } catch {
    response.status(503).json({ error: "Account verification is temporarily unavailable." });
  }
});

const ProductIntelligenceRequest = z.object({
  product: z.string().trim().min(1).max(140),
  goal: z.string().trim().max(60).optional(),
  platform: z.string().trim().max(40).optional(),
  audience: z.string().trim().max(60).optional(),
  budget: z.string().trim().max(60).optional(),
  creatorCriteria: z.string().trim().max(240).optional()
});

const ResearchScopedProductRequest = ProductIntelligenceRequest.extend({
  researchSessionId: z.string().uuid().optional(),
  organizationId: z.string().uuid().optional()
});

const ProductBrief = z.object({
  summary: z.string(),
  demandSignals: z.array(z.string()).min(3).max(6),
  searchAngles: z.array(z.string()).min(3).max(6),
  outreachCues: z.array(z.string()).min(2).max(5),
  caution: z.string()
});

const CreatorInput = z.object({
  id: z.string().trim().min(1).max(80),
  name: z.string().trim().min(1).max(120),
  niche: z.string().trim().min(1).max(160),
  platforms: z.array(z.string().trim().max(40)).max(4),
  contentThemes: z.array(z.string().trim().max(80)).max(8),
  suggestedAngle: z.string().trim().max(300).optional(),
  whyMatch: z.string().trim().max(600)
});

const CreatorEnrichmentRequest = ProductIntelligenceRequest.extend({
  creators: z.array(CreatorInput).min(1).max(10)
});

const SourceSchema = z.object({
  title: z.string(),
  source: z.string(),
  description: z.string(),
  link: z.string().optional(),
  rank: z.number()
});

const CreatorResearchBrief = z.object({
  audienceDemandTerms: z.array(z.string()).min(2).max(6),
  agentSummary: z.string(),
  outreachAngle: z.string(),
  confidence: z.enum(["Low", "Medium", "High"]),
  caveat: z.string()
});

const RealInfluencerCandidate = z.object({
  displayName: z.string(),
  handle: z.string().optional(),
  platform: z.string(),
  profileUrl: z.string().optional(),
  sourceUrl: z.string(),
  sourceTitle: z.string(),
  sourceDescription: z.string(),
  niche: z.string(),
  matchReason: z.string(),
  evidence: z.array(z.string()).min(1).max(4),
  confidence: z.enum(["Low", "Medium", "High"]),
  sourceType: z.enum(["profile", "post", "article", "searchResult"])
});

const RealInfluencerExtraction = z.object({
  candidates: z.array(RealInfluencerCandidate).max(12),
  caveat: z.string()
});

const RealInfluencerForEvaluation = RealInfluencerCandidate.extend({
  matchScore: z.number().min(0).max(100).optional()
});

const RealInfluencerEvaluationRequest = ProductIntelligenceRequest.extend({
  researchSessionId: z.string().uuid().optional(),
  organizationId: z.string().uuid().optional(),
  influencers: z.array(RealInfluencerForEvaluation).min(1).max(12)
});

const AgentMessageInput = z.object({
  id: z.string().uuid().optional(),
  role: z.enum(["user", "assistant"]),
  content: z.string().trim().min(1).max(2400)
});

const AgentChatRequest = z.object({
  researchSessionId: z.string().uuid(),
  organizationId: z.string().uuid().optional(),
  messages: z.array(AgentMessageInput).min(1).max(20)
});

const AgentDiscoveryRequest = z.object({
  organizationId: z.string().uuid(),
  messages: z.array(AgentMessageInput).min(1).max(20),
  currentSearch: z.object({
    product: z.string().trim().max(140).default(""),
    goal: z.string().trim().max(60).default("Sales"),
    budget: z.string().trim().max(60).default("$1k to $5k"),
    platform: z.enum(["Any", "TikTok", "Instagram", "YouTube"]).default("Any"),
    audience: z.string().trim().max(60).default("Audience not yet narrowed"),
    creatorCriteria: z.string().trim().max(240).default("")
  }).default({
    product: "",
    goal: "Sales",
    budget: "$1k to $5k",
    platform: "Any",
    audience: "Audience not yet narrowed",
    creatorCriteria: ""
  })
});

const SaveCreatorRequest = z.object({
  organizationId: z.string().uuid(),
  researchSessionId: z.string().uuid(),
  sourceUrl: z.string().url().max(600)
});

const WorkspaceResourceRequest = z.object({
  organizationId: z.string().uuid()
});

const CampaignBriefContent = z.object({
  campaignName: z.string().trim().min(1).max(160),
  objective: z.string().trim().min(1).max(1000),
  audience: z.string().trim().min(1).max(500),
  platforms: z.array(z.string().trim().min(1).max(60)).min(1).max(4),
  geography: z.string().trim().min(1).max(240),
  budget: z.object({
    label: z.string().trim().min(1).max(120),
    creatorSpend: z.string().trim().min(1).max(240)
  }),
  timing: z.object({
    launchDate: z.string().trim().min(1).max(120),
    campaignWindow: z.string().trim().min(1).max(240)
  }),
  deliverables: z.array(z.string().trim().min(1).max(300)).min(1).max(8),
  creatorCriteria: z.string().trim().min(1).max(1000),
  keyMessage: z.string().trim().min(1).max(1000),
  successMeasures: z.array(z.string().trim().min(1).max(240)).min(1).max(8),
  assumptions: z.array(z.string().trim().min(1).max(320)).max(10)
});

const CampaignBriefGenerateRequest = WorkspaceResourceRequest.extend({
  messages: z.array(AgentMessageInput).max(20).default([])
});

const CampaignBriefUpdateRequest = WorkspaceResourceRequest.extend({
  brief: CampaignBriefContent
});

const CampaignBriefTransitionRequest = WorkspaceResourceRequest.extend({
  status: z.enum(["draft", "review", "approved", "rejected"])
});

const ShortlistDecisionRequest = WorkspaceResourceRequest.extend({
  decision: z.enum(["saved", "rejected", "restored", "archived"]),
  reasons: z.array(z.string().trim().min(1).max(80)).max(4).default([]),
  notes: z.string().trim().max(1000).optional()
}).superRefine((value, context) => {
  if (value.decision === "rejected" && !value.reasons.length) {
    context.addIssue({ code: "custom", message: "Choose at least one rejection reason.", path: ["reasons"] });
  }
});

const ShortlistTransitionRequest = WorkspaceResourceRequest.extend({
  status: z.enum(["draft", "review", "approved", "archived"])
});

const CampaignFromShortlistRequest = WorkspaceResourceRequest.extend({
  name: z.string().trim().min(1).max(160),
  creatorBudgetCents: z.number().int().min(0).max(1_000_000_000_00).nullable().optional(),
  startsOn: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).optional(),
  endsOn: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).optional()
});

const CampaignStatusRequest = WorkspaceResourceRequest.extend({
  status: z.enum(["draft", "sourcing", "outreach", "negotiation", "contracted", "active", "review", "complete", "cancelled"])
});

const CampaignTaskRequest = WorkspaceResourceRequest.extend({
  title: z.string().trim().min(1).max(240),
  dueAt: z.string().datetime({ offset: true }).nullable().optional()
});

const CampaignTaskStatusRequest = WorkspaceResourceRequest.extend({
  status: z.enum(["open", "in_progress", "blocked", "done", "cancelled"])
});

const OutreachDraftGenerateRequest = WorkspaceResourceRequest.extend({
  creatorId: z.string().uuid()
});

const OutreachDraftUpdateRequest = WorkspaceResourceRequest.extend({
  subject: z.string().trim().max(160).optional(),
  body: z.string().trim().min(1).max(6000)
});

const OutreachDraftTransitionRequest = WorkspaceResourceRequest.extend({
  status: z.enum(["draft", "review", "approved", "rejected"])
});

const WorkspaceInvitationRequest = WorkspaceResourceRequest.extend({
  email: z.string().trim().email().max(240),
  role: z.enum(["admin", "marketer", "approver", "analyst"])
});

const WorkspaceMemberRequest = WorkspaceResourceRequest.extend({
  role: z.enum(["owner", "admin", "marketer", "approver", "analyst"]),
  status: z.enum(["active", "suspended"])
});

const AccountRequestInput = z.object({
  requestType: z.enum(["export", "deletion"])
});

const AccountProfileInput = z.object({
  displayName: z.string().trim().min(1).max(120),
  accountType: z.enum(["creator", "professional", "business"])
});

const EntitlementUpdateInput = z.object({
  plan: z.enum(["pilot", "starter", "growth", "enterprise", "internal"]),
  status: z.enum(["trialing", "active", "past_due", "suspended", "cancelled"]),
  seatLimit: z.number().int().min(1).max(1000),
  researchRunsLimit: z.number().int().min(0).max(1_000_000),
  endsAt: z.string().datetime({ offset: true }).nullable().optional()
});

const RealInfluencerEvaluationItem = z.object({
  displayName: z.string(),
  sourceUrl: z.string(),
  aiScore: z.number().min(0).max(100),
  verdict: z.enum(["Strong fit", "Good fit", "Check fit", "Weak fit"]),
  summary: z.string(),
  strengths: z.array(z.string()).min(1).max(3),
  risks: z.array(z.string()).min(1).max(3),
  recommendedUse: z.string(),
  confidence: z.enum(["Low", "Medium", "High"]),
  scoringMethod: z.enum(["ai", "source"])
});

const RealInfluencerEvaluationOutput = z.object({
  evaluations: z.array(RealInfluencerEvaluationItem).min(1).max(12),
  note: z.string()
});

const productSignalAgent = new Agent({
  name: "CreatorSignal Product Research Analyst",
  model: process.env.OPENAI_MODEL || "gpt-5.5",
  instructions: [
    "You summarize public product research for a creator-marketing prototype.",
    "Never claim influencer analytics, scraping of social profiles, campaign performance, emails, or real creator identity data.",
    "Use only the provided Bright Data search snippets and the user's product context.",
    "If evidence is thin, say so plainly and keep the brief conservative.",
    "Return concise, practical JSON for a brand marketer."
  ].join(" "),
  outputType: ProductBrief
});

const creatorResearchAgent = new Agent({
  name: "CreatorSignal Creator Discovery Analyst",
  model: process.env.OPENAI_MODEL || "gpt-5.5",
  instructions: [
    "You enrich fictional creator cards with public web discovery context.",
    "Use only the supplied Bright Data SERP sources and scraped snippets.",
    "Do not invent real creator names, follower counts, emails, platform verification, conversion analytics, or contact data.",
    "If public sources are broad category pages rather than profile-specific evidence, say the confidence is Low or Medium.",
    "Summarize how the live public web context supports the fictional creator's niche fit and outreach angle.",
    "Return concise JSON."
  ].join(" "),
  outputType: CreatorResearchBrief
});

const realInfluencerExtractionAgent = new Agent({
  name: "CreatorSignal Real Influencer Extractor",
  model: process.env.OPENAI_MODEL || "gpt-5.5",
  instructions: [
    "Extract real public creator or influencer candidates from Bright Data search results.",
    "Only use names, handles, platforms, URLs, and evidence visible in the provided source title, source hostname, URL, and description.",
    "Do not invent follower counts, emails, audience analytics, contact data, or profile URLs.",
    "If a source is an article about creators rather than a creator profile/post, label sourceType as article and confidence Low or Medium.",
    "Prefer public social profile/post results and shoppable creator posts when present.",
    "Return concise structured JSON."
  ].join(" "),
  outputType: RealInfluencerExtraction
});

const realInfluencerEvaluationAgent = new Agent({
  name: "CreatorSignal Influencer Fit Evaluator",
  model: process.env.OPENAI_MODEL || "gpt-5.5",
  instructions: [
    "Evaluate source-backed public creator candidates for a brand marketer.",
    "Use only the supplied source titles, URLs, descriptions, evidence, product, goal, platform, and audience.",
    "Do not invent followers, rates, emails, demographics, conversion analytics, private contact data, or platform verification.",
    "Score fit from 0-100 based on visible product relevance, creator/source quality, campaign risk, and commercial usefulness.",
    "Return concise JSON."
  ].join(" "),
  outputType: RealInfluencerEvaluationOutput
});

function hasBrightDataConfig() {
  return Boolean(
    process.env.BRIGHT_DATA_API_KEY &&
      process.env.BRIGHT_DATA_SEARCH_URL &&
      process.env.BRIGHT_DATA_SERP_ZONE
  );
}

function hasOpenAIConfig() {
  return Boolean(process.env.OPENAI_API_KEY);
}

function hasGoogleAIConfig() {
  return Boolean(process.env.GOOGLE_API_KEY || process.env.GEMINI_API_KEY);
}

function hasNvidiaConfig() {
  return Boolean(process.env.NVIDIA_API_KEY || process.env.NVIDIA_NIM_API_KEY);
}

function configuredAIProvider() {
  const preferred = String(process.env.AI_PROVIDER || "").toLowerCase();
  if ((preferred === "nvidia" || preferred === "nim") && hasNvidiaConfig()) return "nvidia";
  if (preferred === "google" && hasGoogleAIConfig()) return "google";
  if (preferred === "openai" && hasOpenAIConfig()) return "openai";
  if (hasOpenAIConfig()) return "openai";
  if (hasNvidiaConfig()) return "nvidia";
  if (hasGoogleAIConfig()) return "google";
  return "local";
}

function configuredAIModel() {
  if (configuredAIProvider() === "nvidia") return process.env.NVIDIA_MODEL || "z-ai/glm-5.2";
  if (configuredAIProvider() === "google") return process.env.GOOGLE_MODEL || "gemini-3.5-flash";
  if (configuredAIProvider() === "openai") return process.env.OPENAI_MODEL || "gpt-5.5";
  return "rules-based-source-extraction";
}

function configuredAIDisplayName() {
  if (configuredAIProvider() === "nvidia") return "NVIDIA NIM";
  if (configuredAIProvider() === "google") return "Google Gemini";
  if (configuredAIProvider() === "openai") return "OpenAI Agents SDK";
  return "Rules-based source extraction";
}

function friendlyAIUnavailableNote(error, fallbackLabel = "rules-based source extraction") {
  const message = error instanceof Error ? error.message : String(error || "");
  if (/429|quota|rate.?limit|too many requests/i.test(message)) {
    return `${configuredAIDisplayName()} hit a quota or rate limit; returned ${fallbackLabel}.`;
  }
  if (/401|403|unauthorized|forbidden|api key|permission/i.test(message)) {
    return `${configuredAIDisplayName()} credentials were rejected; returned ${fallbackLabel}.`;
  }
  if (/abort|timed out|timeout/i.test(message)) {
    return `${configuredAIDisplayName()} was slow for this interactive run; returned ${fallbackLabel}.`;
  }
  if (/response budget|interactive/i.test(message)) {
    return `${configuredAIDisplayName()} exceeded the interactive response budget; returned ${fallbackLabel}.`;
  }
  if (/unavailable|failed|non-json|validation/i.test(message)) {
    return `${configuredAIDisplayName()} was unavailable; returned ${fallbackLabel}.`;
  }
  return `${configuredAIDisplayName()} could not complete this run; returned ${fallbackLabel}.`;
}

function hasBrightDataUnlockerConfig() {
  return Boolean(
    process.env.BRIGHT_DATA_API_KEY &&
      process.env.BRIGHT_DATA_FETCH_URL &&
      process.env.BRIGHT_DATA_UNLOCKER_ZONE
  );
}

function googleModelCandidates() {
  const primary = process.env.GOOGLE_MODEL || "gemini-3.5-flash";
  const fallbacks = String(process.env.GOOGLE_FALLBACK_MODELS || "gemini-2.5-flash,gemma-4-31b-it")
    .split(",")
    .map((model) => model.trim())
    .filter(Boolean);
  return [...new Set([primary, ...fallbacks])];
}

function nvidiaModelCandidates() {
  const primary = process.env.NVIDIA_MODEL || "z-ai/glm-5.2";
  const fallbacks = String(process.env.NVIDIA_FALLBACK_MODELS || "")
    .split(",")
    .map((model) => model.trim())
    .filter(Boolean);
  return [...new Set([primary, ...fallbacks])];
}

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function extractJsonObject(text) {
  const value = String(text || "").trim();
  if (!value) return null;
  try {
    return JSON.parse(value);
  } catch {
    const fenced = value.match(/```(?:json)?\s*([\s\S]*?)```/i)?.[1];
    if (fenced) {
      try {
        return JSON.parse(fenced);
      } catch {
        return null;
      }
    }
    const first = value.indexOf("{");
    const last = value.lastIndexOf("}");
    if (first >= 0 && last > first) {
      try {
        return JSON.parse(value.slice(first, last + 1));
      } catch {
        return null;
      }
    }
    return null;
  }
}

async function runGoogleStructured(prompt, schemaHint) {
  const apiKey = process.env.GOOGLE_API_KEY || process.env.GEMINI_API_KEY;
  if (!apiKey) throw new Error("Google API key is not configured.");

  const errors = [];
  for (const model of googleModelCandidates()) {
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), Number(process.env.GOOGLE_MODEL_TIMEOUT_MS || 18000));
    let response;
    try {
      response = await fetch(`https://generativelanguage.googleapis.com/v1beta/models/${encodeURIComponent(model)}:generateContent?key=${encodeURIComponent(apiKey)}`, {
        method: "POST",
        signal: controller.signal,
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          contents: [
            {
              role: "user",
              parts: [
                {
                  text: [
                    "Return only valid JSON. Do not wrap it in markdown.",
                    schemaHint,
                    prompt
                  ].join("\n\n")
                }
              ]
            }
          ],
          generationConfig: {
            temperature: 0.15,
            responseMimeType: "application/json"
          }
        })
      });
    } catch (error) {
      errors.push(`${model}: ${error instanceof Error && error.name === "AbortError" ? "timed out" : error instanceof Error ? error.message : "request failed"}`);
      clearTimeout(timeout);
      continue;
    } finally {
      clearTimeout(timeout);
    }

    if (!response.ok) {
      const detail = await response.text().catch(() => "");
      errors.push(`${model}: ${response.status} ${detail.slice(0, 180)}`);
      continue;
    }

    const data = await response.json();
    const text = data?.candidates?.[0]?.content?.parts?.map((part) => part.text || "").join("\n") || "";
    const parsed = extractJsonObject(text);
    if (parsed) return { output: parsed, model };
    errors.push(`${model}: non-JSON output`);
  }

  throw new Error(`Google AI models unavailable: ${errors.join(" | ")}`);
}

async function runNvidiaStructured(prompt, schemaHint, options = {}) {
  const apiKey = process.env.NVIDIA_API_KEY || process.env.NVIDIA_NIM_API_KEY;
  if (!apiKey) throw new Error("NVIDIA NIM API key is not configured.");

  const baseUrl = process.env.NVIDIA_BASE_URL || "https://integrate.api.nvidia.com/v1";
  const connectTimeoutMs = Number(options.timeoutMs || process.env.NVIDIA_MODEL_TIMEOUT_MS || 90000);
  const inactivityMs = Number(process.env.NVIDIA_STREAM_INACTIVITY_MS || 15000);
  const attempts = Math.max(1, Math.min(3, Number(options.attempts || process.env.NVIDIA_MODEL_ATTEMPTS || 2)));
  const maxTokens = Number(options.maxTokens || process.env.NVIDIA_MAX_TOKENS || 700);
  const errors = [];

  for (const model of nvidiaModelCandidates()) {
    for (let attempt = 1; attempt <= attempts; attempt += 1) {
      const controller = new AbortController();
      // Initial timeout covers the connection + first token (time-to-first-token).
      // Once streaming starts, we switch to an inactivity timeout that resets on each chunk.
      let currentTimeout = setTimeout(() => controller.abort(), connectTimeoutMs + (attempt - 1) * 15000);
      let response;
      try {
        response = await fetch(`${baseUrl.replace(/\/$/, "")}/chat/completions`, {
          method: "POST",
          signal: controller.signal,
          headers: {
            Authorization: `Bearer ${apiKey}`,
            "Content-Type": "application/json",
            Accept: "text/event-stream"
          },
          body: JSON.stringify({
            model,
            messages: [
              {
                role: "system",
                content: "Return compact valid JSON only. Do not wrap it in markdown. Do not include reasoning. Use only the provided context."
              },
              {
                role: "user",
                content: [schemaHint, prompt].join("\n\n")
              }
            ],
            response_format: { type: "json_object" },
            temperature: 0,
            top_p: 1,
            max_tokens: maxTokens,
            stream: true
          })
        });
      } catch (error) {
        clearTimeout(currentTimeout);
        errors.push(`${model} attempt ${attempt}: ${error instanceof Error && error.name === "AbortError" ? "timed out waiting for first response" : error instanceof Error ? error.message : "request failed"}`);
        continue;
      }

      if (!response.ok) {
        clearTimeout(currentTimeout);
        const detail = await response.text().catch(() => "");
        errors.push(`${model} attempt ${attempt}: ${response.status} ${detail.slice(0, 180)}`);
        if (response.status === 429 || response.status >= 500) {
          const retryAfter = Number(response.headers.get("retry-after") || 0);
          await sleep(Math.min(5000, Math.max(750, retryAfter * 1000 || attempt * 1000)));
          continue;
        }
        break;
      }

      // --- Stream SSE chunks with inactivity timeout ---
      // As long as the model keeps sending tokens, the connection stays alive.
      // Only times out if the model goes silent for NVIDIA_STREAM_INACTIVITY_MS (default 15s).
      let accumulated = "";
      try {
        const reader = response.body.getReader();
        const decoder = new TextDecoder();

        // Switch from connect timeout to inactivity timeout now that we have a response
        clearTimeout(currentTimeout);
        currentTimeout = setTimeout(() => controller.abort(), inactivityMs);

        while (true) {
          const { done, value } = await reader.read();
          if (done) break;

          // Reset inactivity timer on every chunk received
          clearTimeout(currentTimeout);
          currentTimeout = setTimeout(() => controller.abort(), inactivityMs);

          const chunk = decoder.decode(value, { stream: true });
          const lines = chunk.split("\n");
          for (const line of lines) {
            const trimmed = line.trim();
            if (!trimmed || !trimmed.startsWith("data:")) continue;
            const payload = trimmed.slice(5).trim();
            if (payload === "[DONE]") continue;
            try {
              const parsed = JSON.parse(payload);
              const delta = parsed?.choices?.[0]?.delta?.content || "";
              accumulated += delta;
            } catch { /* skip malformed SSE lines */ }
          }
        }
      } catch (error) {
        clearTimeout(currentTimeout);
        if (error instanceof Error && error.name === "AbortError" && accumulated.length > 0) {
          // Model went silent mid-stream — try to salvage what we got
          const parsed = extractJsonObject(accumulated);
          if (parsed) return { output: parsed, model };
        }
        errors.push(`${model} attempt ${attempt}: ${error instanceof Error && error.name === "AbortError" ? "stream stalled (inactivity timeout)" : error instanceof Error ? error.message : "stream failed"}`);
        continue;
      } finally {
        clearTimeout(currentTimeout);
      }

      const parsed = extractJsonObject(accumulated);
      if (parsed) return { output: parsed, model };
      errors.push(`${model} attempt ${attempt}: non-JSON output`);
    }
  }

  throw new Error(`NVIDIA NIM unavailable: ${errors.join(" | ")}`);
}

function sanitizeSource(item, index) {
  const title = String(item.title || item.source || `Result ${index + 1}`).slice(0, 180);
  const source = String(item.source || item.display_link || "Public web result").slice(0, 120);
  const description = String(item.description || item.snippet || item.text || "").slice(0, 360);
  const link = String(item.link || item.url || "").slice(0, 500);
  return { title, source, description, link, rank: Number(item.rank || index + 1) };
}

function decodeHtml(value) {
  return String(value)
    .replace(/&amp;/g, "&")
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&nbsp;/g, " ");
}

function stripTags(value) {
  return decodeHtml(String(value).replace(/<[^>]+>/g, " ").replace(/\s+/g, " ").trim());
}

function normalizeSearchHref(href) {
  const decodedHref = decodeHtml(href);
  try {
    if (decodedHref.startsWith("/url?") || decodedHref.startsWith("https://www.google.com/url?")) {
      const parsed = new URL(decodedHref, "https://www.google.com");
      return parsed.searchParams.get("q") || "";
    }
    if (decodedHref.startsWith("http")) return decodedHref;
  } catch {
    return "";
  }
  return "";
}

function extractSearchResultsFromHtml(html) {
  const results = [];
  const seen = new Set();
  const anchorRegex = /<a\s+[^>]*href="([^"]+)"[^>]*>([\s\S]*?)<\/a>/gi;
  let match;

  while ((match = anchorRegex.exec(html)) && results.length < 10) {
    const link = normalizeSearchHref(match[1]);
    if (!link || seen.has(link)) continue;
    let hostname = "";
    try {
      hostname = new URL(link).hostname.replace(/^www\./, "");
    } catch {
      continue;
    }
    if (/google|gstatic|schema\.org|accounts\.youtube/.test(hostname)) continue;

    const anchorText = stripTags(match[2]);
    const title = anchorText
      .replace(/^More results from\s+/i, "")
      .replace(/\s+-\s+Google Search$/i, "")
      .trim();
    if (title.length < 8) continue;

    seen.add(link);
    results.push({
      title: title.slice(0, 180),
      source: hostname,
      description: `Public search result from ${hostname}.`,
      link,
      rank: results.length + 1
    });
  }

  return results;
}

function collectSerpItems(payload) {
  const candidates = [
    payload.organic,
    payload.results,
    payload.top_results,
    payload.news,
    payload.shopping,
    payload.related,
    payload.people_also_ask,
    payload.peopleAlsoAsk,
    payload.discussions_and_forums
  ];

  const flattened = candidates
    .filter(Array.isArray)
    .flat()
    .filter(Boolean);

  if (typeof payload.body === "string") {
    flattened.push(...extractSearchResultsFromHtml(payload.body));
  }

  if (Array.isArray(payload.answers)) {
    flattened.push(
      ...payload.answers.map((answer, index) => ({
        title: "Search answer",
        source: "Bright Data SERP answer",
        description: answer?.value?.text || answer?.text || "",
        rank: index + 1
      }))
    );
  }

  if (!flattened.length && payload.general?.page_title) {
    flattened.push({
      title: payload.general.page_title,
      source: payload.general.search_engine || "Bright Data SERP",
      description: `Parsed SERP metadata for "${payload.general.query || "the product search"}".`,
      rank: 1
    });
  }

  return flattened;
}

async function requestBrightDataSerp(query) {
  if (!hasBrightDataConfig()) {
    return {
      ok: false,
      sources: [],
      error: "Bright Data is not configured on the local server."
    };
  }

  const searchUrl = new URL("https://www.google.com/search");
  searchUrl.searchParams.set("q", query.trim());
  searchUrl.searchParams.set("hl", "en");
  searchUrl.searchParams.set("gl", process.env.BRIGHT_DATA_COUNTRY || "us");

  const response = await fetch(process.env.BRIGHT_DATA_SEARCH_URL, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${process.env.BRIGHT_DATA_API_KEY}`,
      "Content-Type": "application/json"
    },
    body: JSON.stringify({
      zone: process.env.BRIGHT_DATA_SERP_ZONE,
      url: searchUrl.toString(),
      format: "json"
    })
  });

  const rawBody = await response.text();
  if (!response.ok) {
    return {
      ok: false,
      sources: [],
      status: response.status,
      error: `Bright Data returned ${response.status}. ${rawBody.slice(0, 180)}`
    };
  }

  let payload;
  try {
    payload = JSON.parse(rawBody);
  } catch {
    return {
      ok: false,
      sources: [],
      status: response.status,
      error: "Bright Data returned a non-JSON response for the SERP request."
    };
  }

  const sources = collectSerpItems(payload).slice(0, 6).map(sanitizeSource);

  return {
    ok: true,
    sources,
    meta: {
      query: payload.general?.query || searchUrl.searchParams.get("q"),
      searchEngine: payload.general?.search_engine || "google",
      location: payload.general?.location || process.env.BRIGHT_DATA_COUNTRY || "us"
    }
  };
}

async function fetchBrightDataSerp({ product, goal, platform, audience }) {
  const modifiers = [goal, platform, audience, "shopping questions", "customer demand"]
    .filter(Boolean)
    .join(" ");
  return requestBrightDataSerp(`${productDiscoveryPhrase(product)} ${modifiers}`.trim());
}

function sourceLooksFetchable(link) {
  if (!link) return false;
  try {
    const hostname = new URL(link).hostname.toLowerCase();
    return !/(instagram|tiktok|youtube|facebook|x\.com|twitter|linkedin|reddit|pinterest)/.test(hostname);
  } catch {
    return false;
  }
}

function platformFromSource(source) {
  const text = `${source.source || ""} ${source.link || ""} ${source.title || ""}`.toLowerCase();
  if (text.includes("instagram")) return "Instagram";
  if (text.includes("tiktok")) return "TikTok";
  if (text.includes("youtube")) return "YouTube";
  if (text.includes("pinterest")) return "Pinterest";
  return "Public web";
}

function handleFromSource(source) {
  const title = decodeHtml(source.title || "");
  try {
    const url = new URL(source.link);
    const parts = url.pathname.split("/").filter(Boolean);
    if (/tiktok/i.test(url.hostname) && parts[0]?.startsWith("@")) {
      return parts[0].replace(/^@/, "");
    }
    if (/instagram/i.test(url.hostname) && parts[0] && !["p", "reel", "explore"].includes(parts[0])) return parts[0].replace(/^@/, "");
    if (/youtube/i.test(url.hostname) && parts[0]?.startsWith("@")) return parts[0].replace(/^@/, "");
  } catch {
    // Fall back to parsing the title when the URL is not usable.
  }

  const patterns = [
    /Instagram\s*[·|-]\s*([a-zA-Z0-9._]+)/i,
    /TikTok\s*[·|-]\s*@?([a-zA-Z0-9._]+)/i,
    /@([a-zA-Z0-9._]{3,})/
  ];
  for (const pattern of patterns) {
    const match = title.match(pattern);
    if (match?.[1]) return match[1].trim().replace(/\s+/g, "");
  }
  return undefined;
}

function displayNameFromSource(source, handle) {
  const title = decodeHtml(source.title || "");
  const youtubePublisher = title.match(/YouTube\s*[·|-]\s*([^·|]+?)(?=\s+\d[\d.,]*[KMB]?\+?\s+(?:views|subscribers)|\s*[·|]|$)/i)?.[1]?.trim();
  if (youtubePublisher && youtubePublisher.length <= 80) return youtubePublisher;
  const beforePipe = title.split("|")[0]?.trim();
  if (beforePipe && beforePipe.length >= 3 && beforePipe.length <= 40 && !/instagram|tiktok|youtube|things|type|comment/i.test(beforePipe)) {
    return beforePipe;
  }
  if (handle) return `@${handle}`;
  const beforePlatform = title.split(/Instagram|TikTok|YouTube/i)[0]?.replace(/[·|-]+$/g, "").trim();
  if (beforePlatform && beforePlatform.length >= 3 && beforePlatform.length <= 55) return beforePlatform;
  return source.source || "Public creator result";
}

function displayNameLooksUsable(value) {
  return Boolean(value && !/^(read more|more|learn more|view profile|watch now|instagram|tiktok|youtube|public creator result)$/i.test(String(value).trim()));
}

function sourceTypeFromSource(source) {
  const text = `${source.link || ""} ${source.title || ""}`.toLowerCase();
  if (/instagram\.com\/(p|reel)\//.test(text) || /tiktok\.com\/@.+\/video/.test(text) || /youtube\.com\/shorts/.test(text)) return "post";
  if (/instagram\.com\/[^/]+\/?$/.test(text) || /tiktok\.com\/@[^/]+\/?$/.test(text) || /youtube\.com\/@[^/]+/.test(text)) return "profile";
  if (!/(instagram|tiktok|youtube|pinterest)/.test(text)) return "article";
  return "searchResult";
}

function textLooksLikeNonCreatorPage(text) {
  if (/(tiktok\.com\/(?:discover|content|tag|shop)|instagram\.com\/explore|youtube\.com\/results)/i.test(text)) return true;
  return /\b(official store|official site|shop now|add to cart|where to buy|retailer|brand store|product page|specs|specifications|best budget|best gaming mouse|review roundup|buying guide|rtings|amazon|walmart|target|tiktok shop affiliate|affiliate marketing|make money|seller center|dropshipping|how to sell|shop affiliate|creator marketplace|seller academy|business tutorial)\b/i.test(text);
}

function sourceLooksLikeCreatorCandidate(source) {
  const type = sourceTypeFromSource(source);
  const text = decodeHtml(`${source.source || ""} ${source.link || ""} ${source.title || ""} ${source.description || ""}`);
  if (textLooksLikeNonCreatorPage(text)) return false;
  if (type === "profile" || type === "post") return true;
  if (/(instagram|tiktok|youtube|pinterest)\.com/i.test(text)) return true;
  if (/\b(creator|influencer|ugc creator|content creator)\b/i.test(text)) return true;
  return false;
}

function candidateLooksLikeCreator(candidate) {
  const text = decodeHtml([
    candidate.displayName,
    candidate.handle,
    candidate.platform,
    candidate.sourceUrl,
    candidate.sourceTitle,
    candidate.sourceDescription,
    candidate.niche,
    candidate.matchReason,
    ...(candidate.evidence || [])
  ].join(" "));
  if (textLooksLikeNonCreatorPage(text)) return false;
  if (candidate.sourceType === "profile" || candidate.sourceType === "post") return true;
  if (/(instagram|tiktok|youtube|pinterest)\.com/i.test(text)) return true;
  if (/\b(creator|influencer|ugc creator|content creator)\b/i.test(text)) return true;
  return false;
}

function sourceEvidence(source, product) {
  const text = decodeHtml(`${source.title || ""} ${source.description || ""}`);
  const evidence = [];
  const likes = text.match(/(\d[\d.,]*\s*[kKmMbB]?\+?\s*(?:likes|views|subscribers))/i)?.[1];
  if (likes) evidence.push(`Search result mentions ${likes}.`);
  if (/shop|link|links|ltk|affiliate/i.test(text)) evidence.push("Source text includes shopping/link intent.");
  if (product && text.toLowerCase().includes(product.toLowerCase().split(" ")[0])) evidence.push(`Source text matches "${product}".`);
  if (!evidence.length) evidence.push("Matched by Bright Data public search result.");
  return evidence.slice(0, 4);
}

function compactSourcesForAI(sources, maxSources = 6) {
  return sources.slice(0, maxSources).map((source) => ({
    title: decodeHtml(source.title || "").slice(0, 130),
    source: decodeHtml(source.source || "").slice(0, 80),
    description: decodeHtml(source.description || "").slice(0, 220),
    link: source.link || "",
    rank: source.rank
  }));
}

function compactCandidatesForAI(candidates, maxCandidates = 8) {
  return candidates.slice(0, maxCandidates).map((candidate) => ({
    displayName: candidate.displayName,
    handle: candidate.handle,
    platform: candidate.platform,
    sourceUrl: candidate.sourceUrl,
    sourceTitle: candidate.sourceTitle.slice(0, 130),
    sourceDescription: candidate.sourceDescription.slice(0, 220),
    niche: candidate.niche,
    evidence: candidate.evidence,
    confidence: candidate.confidence,
    sourceType: candidate.sourceType
  }));
}

function productIntentTerms(product) {
  const normalized = String(product || "").trim().toLowerCase();
  const words = normalized
    .split(/[^a-z0-9]+/)
    .map((word) => word.trim())
    .filter((word) => word.length >= 2);
  const intentMap = {
    mouse: ["computer mouse", "gaming mouse", "wireless mouse", "ergonomic mouse", "pc setup", "desk setup", "keyboard"],
    mice: ["computer mouse", "gaming mouse", "wireless mouse", "ergonomic mouse", "pc setup", "desk setup", "keyboard"],
    keyboard: ["computer keyboard", "mechanical keyboard", "gaming keyboard", "wireless keyboard", "desk setup", "typing setup", "tech review"],
    phone: ["smartphone", "iphone", "android phone", "samsung galaxy", "mobile phone", "phone review", "tech review", "phone camera", "phone accessories"],
    smartphone: ["smartphone", "iphone", "android phone", "samsung galaxy", "mobile phone", "phone review", "tech review", "phone camera"],
    iphone: ["iphone", "smartphone", "apple phone", "ios", "phone review", "tech review", "phone camera"],
    android: ["android phone", "smartphone", "samsung galaxy", "google pixel", "phone review", "tech review", "phone camera"],
    laptop: ["laptop", "tech review", "desk setup", "computer setup", "productivity setup", "creator setup"],
    headphones: ["headphones", "wireless headphones", "audio gear", "tech review", "desk setup"],
    earbuds: ["earbuds", "wireless earbuds", "audio gear", "tech review", "everyday carry"],
    bottle: ["water bottle", "reusable bottle", "tumbler", "hydration bottle", "insulated bottle"],
    desk: ["desk setup", "standing desk", "home office desk", "workspace", "desk accessories"]
  };
  const mapped = words.flatMap((word) => intentMap[word] || []);
  return [...new Set([normalized, ...words, ...mapped].filter(Boolean))];
}

function productNegativeTerms(product) {
  const normalized = String(product || "").toLowerCase();
  if (/\b(mouse|mice)\b/.test(normalized)) {
    return ["mickey", "minnie", "disney", "rodent", "rat", "pest control", "trap"];
  }
  if (/\b(phone|smartphone|iphone|android)\b/.test(normalized)) {
    return ["phone number", "call center", "customer service", "tiktok shop affiliate", "affiliate marketing", "make money", "seller center", "dropshipping", "how to sell", "course"];
  }
  if (/\bkeyboard\b/.test(normalized)) {
    return ["piano", "music keyboard", "midi", "synthesizer", "typing test", "typing course"];
  }
  return [];
}

function productSearchCategory(product) {
  const normalized = String(product || "").toLowerCase();
  if (/\b(phone|smartphone|iphone|android)\b/.test(normalized)) return "phone";
  if (/\b(mouse|mice)\b/.test(normalized)) return "mouse";
  if (/\bkeyboard\b/.test(normalized)) return "keyboard";
  if (/\b(laptop|computer|monitor|headphones|earbuds|camera|microphone)\b/.test(normalized)) return "tech";
  return "general";
}

function productDiscoveryPhrase(product) {
  const normalized = String(product || "").trim();
  const terms = productIntentTerms(normalized);
  const negatives = productNegativeTerms(normalized).map((term) => `-${term.replace(/\s+/g, "-")}`);
  if (/\b(mouse|mice)\b/i.test(normalized)) {
    return [`"${normalized}"`, `"computer mouse"`, `"gaming mouse"`, `"wireless mouse"`, ...negatives].join(" ");
  }
  if (productSearchCategory(normalized) === "phone") {
    return [`"${normalized}"`, `"smartphone"`, `"phone review"`, `"tech review"`, ...negatives].join(" ");
  }
  if (productSearchCategory(normalized) === "keyboard") {
    return [`"${normalized}"`, `"mechanical keyboard"`, `"desk setup"`, `"tech review"`, ...negatives].join(" ");
  }
  if (terms.length > 1) {
    return [`"${normalized}"`, ...terms.slice(1, 4).map((term) => `"${term}"`), ...negatives].join(" ");
  }
  return [normalized, ...negatives].filter(Boolean).join(" ");
}

function productRelevanceScore(product, value) {
  const text = decodeHtml(value || "").toLowerCase();
  if (!text.trim()) return 0;
  const negatives = productNegativeTerms(product);
  if (negatives.some((term) => text.includes(term))) return -5;

  const terms = productIntentTerms(product);
  let score = 0;
  for (const term of terms) {
    if (!term) continue;
    if (term.includes(" ") && text.includes(term)) score += 4;
    else if (new RegExp(`\\b${term.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}\\b`, "i").test(text)) score += 2;
  }
  if (/\b(shop|shopping|link in bio|comment shop|ltk|affiliate|amazon|review|setup|haul|finds|gift guide)\b/i.test(text)) score += 1;
  if (/\b(instagram|tiktok|youtube|pinterest|creator|influencer)\b/i.test(text)) score += 1;
  return score;
}

function sourceRelevanceScore(product, source) {
  return productRelevanceScore(product, `${source.title || ""} ${source.description || ""} ${source.source || ""} ${source.link || ""}`);
}

function candidateRelevanceScore(product, candidate) {
  return productRelevanceScore(
    product,
    [
      candidate.displayName,
      candidate.handle,
      candidate.platform,
      candidate.sourceUrl,
      candidate.sourceTitle,
      candidate.sourceDescription,
      candidate.niche,
      candidate.matchReason,
      ...(candidate.evidence || [])
    ].join(" ")
  );
}

function dedupeRealInfluencerCandidates(candidates) {
  const seen = new Set();
  return candidates.filter((candidate) => {
    const key = [
      candidate.platform || "Public web",
      candidate.handle || candidate.profileUrl || candidate.displayName || candidate.sourceUrl
    ]
      .join("::")
      .toLowerCase();
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });
}

function sourceBackedResults(product, sources) {
  return sources
    .map((source) => ({ source, relevanceScore: sourceRelevanceScore(product, source) }))
    .filter((item) => item.relevanceScore >= 2)
    .sort((a, b) => b.relevanceScore - a.relevanceScore)
    .map((item) => item.source);
}

function discoveryQueries(input) {
  const platformSites = {
    TikTok: "site:tiktok.com",
    Instagram: "site:instagram.com",
    YouTube: "site:youtube.com"
  };
  const platform = input.platform && input.platform !== "Any"
    ? `${input.platform} ${platformSites[input.platform] || ""}`.trim()
    : "Instagram TikTok YouTube";
  const productPhrase = productDiscoveryPhrase(input.product);
  const creatorCriteria = String(input.creatorCriteria || "").replace(/[^\p{L}\p{N}\s'&+-]/gu, " ").replace(/\s+/g, " ").trim().slice(0, 180);
  const criteria = creatorCriteria ? ` ${creatorCriteria}` : "";
  const category = productSearchCategory(input.product);
  if (category === "phone") {
    return [
      `${productPhrase} ${platform} smartphone tech creator review${criteria}`,
      `${productPhrase} ${platform} phone reviewer influencer hands on${criteria}`,
      `${productPhrase} ${platform} iphone android creator camera review${criteria}`
    ];
  }
  if (category === "keyboard" || category === "mouse") {
    return [
      `${productPhrase} ${platform} desk setup tech creator review${criteria}`,
      `${productPhrase} ${platform} gaming setup creator product review${criteria}`,
      `${productPhrase} ${platform} influencer hands on review setup${criteria}`
    ];
  }
  if (category === "tech") {
    return [
      `${productPhrase} ${platform} tech creator review${criteria}`,
      `${productPhrase} ${platform} creator setup hands on${criteria}`,
      `${productPhrase} ${platform} influencer product review${criteria}`
    ];
  }
  return [
    `${productPhrase} ${platform} creator review shopping links${criteria}`,
    `${productPhrase} ${platform} creator product review${criteria}`,
    `${productPhrase} ${platform} influencer hands on demo${criteria}`
  ];
}

function normalizeRealInfluencerExtraction(value) {
  const sourceTypes = new Set(["profile", "post", "article", "searchResult"]);
  const confidenceValues = new Set(["Low", "Medium", "High"]);
  const candidates = Array.isArray(value?.candidates) ? value.candidates : [];
  return {
    candidates: candidates.slice(0, 12).map((candidate) => {
      const normalized = {
        displayName: String(candidate?.displayName || candidate?.name || "Public creator result"),
        platform: String(candidate?.platform || "Public web"),
        sourceUrl: String(candidate?.sourceUrl || candidate?.url || candidate?.profileUrl || ""),
        sourceTitle: String(candidate?.sourceTitle || candidate?.title || "Public source result"),
        sourceDescription: String(candidate?.sourceDescription || candidate?.description || "Public search result."),
        niche: String(candidate?.niche || "Creator discovery result"),
        matchReason: String(candidate?.matchReason || candidate?.reason || "Matched by public source evidence."),
        evidence: Array.isArray(candidate?.evidence) && candidate.evidence.length
          ? candidate.evidence.slice(0, 4).map((item) => String(item))
          : ["Matched by public source evidence."],
        confidence: confidenceValues.has(candidate?.confidence) ? candidate.confidence : "Medium",
        sourceType: sourceTypes.has(candidate?.sourceType) ? candidate.sourceType : "searchResult"
      };
      if (candidate?.handle) normalized.handle = String(candidate.handle).replace(/^@/, "");
      if (candidate?.profileUrl) normalized.profileUrl = String(candidate.profileUrl);
      return normalized;
    }),
    caveat: String(value?.caveat || "AI extraction normalized from public source evidence.")
  };
}

function fallbackRealInfluencers(input, sources) {
  const candidates = sources
    .filter((source) => source.link && sourceLooksLikeCreatorCandidate(source))
    .slice(0, 12)
    .map((source, index) => {
      const handle = handleFromSource(source);
      const platform = platformFromSource(source);
      const sourceType = sourceTypeFromSource(source);
      const evidence = sourceEvidence(source, input.product);
      const relevanceScore = Math.max(0, sourceRelevanceScore(input.product, source));
      return {
        displayName: displayNameFromSource(source, handle),
        handle,
        platform,
        profileUrl: sourceType === "profile" ? source.link : undefined,
        sourceUrl: source.link,
        sourceTitle: decodeHtml(source.title),
        sourceDescription: decodeHtml(source.description || `Public ${platform} result.`),
        niche: input.product || "Creator discovery result",
        matchReason: `Matched "${input.product}" through a Bright Data public search result.`,
        evidence,
        confidence: sourceType === "profile" || sourceType === "post" ? "Medium" : "Low",
        sourceType,
        matchScore: Math.min(99, Math.max(64, 72 + relevanceScore * 4 - index * 2))
      };
    })
    .filter((candidate) => displayNameLooksUsable(candidate.displayName) && candidateLooksLikeCreator(candidate) && candidateRelevanceScore(input.product, candidate) >= 2);
  return dedupeRealInfluencerCandidates(candidates);
}

async function extractRealInfluencers(input, sources) {
  const fallback = fallbackRealInfluencers(input, sources);
  const provider = configuredAIProvider();
  const aiMode = String(process.env.REAL_INFLUENCER_AI_MODE || "fast").toLowerCase();
  if (provider === "local" || !fallback.length || aiMode !== "enhance") {
    return {
      candidates: fallback,
      usedOpenAIAgents: false,
      caveat: provider === "local"
        ? "Bright Data returned source-backed public creator candidates. Add an AI provider key to score them automatically."
        : "Bright Data source extraction returned immediately; AI fit scoring is evaluated separately on each creator card."
    };
  }

  try {
    const payload = {
      product: input.product,
      goal: input.goal,
      platform: input.platform,
      audience: input.audience,
      creatorCriteria: input.creatorCriteria,
      sourceCandidates: compactCandidatesForAI(fallback),
      sources: compactSourcesForAI(sources),
      guardrail: "Never invent fields that are not visible in the supplied sourceCandidates or sources."
    };
    let usedModel = configuredAIModel();
    const finalOutput =
      provider === "google" || provider === "nvidia"
        ? await (async () => {
            const runStructured = provider === "google" ? runGoogleStructured : runNvidiaStructured;
            const structuredResult = await runStructured(
              JSON.stringify(payload),
              [
                "Schema: {\"candidates\":[{\"displayName\":\"string\",\"handle\":\"optional string\",\"platform\":\"string\",\"profileUrl\":\"optional string\",\"sourceUrl\":\"string\",\"sourceTitle\":\"string\",\"sourceDescription\":\"string\",\"niche\":\"string\",\"matchReason\":\"string\",\"evidence\":[\"string\"],\"confidence\":\"Low|Medium|High\",\"sourceType\":\"profile|post|article|searchResult\"}],\"caveat\":\"string\"}",
                "Clean and rank the supplied sourceCandidates from Bright Data. Use only names, handles, platforms, URLs, and evidence visible in source titles, hostnames, URLs, and descriptions. Do not invent follower counts, emails, analytics, contact data, or profile URLs.",
                `Keep only candidates where the visible source text is related to this product intent: ${productIntentTerms(input.product).join(", ")}.`
              ].join("\n"),
              {
                timeoutMs: Number(process.env.NVIDIA_REAL_INFLUENCER_TIMEOUT_MS || 60000),
                attempts: Number(process.env.NVIDIA_MODEL_ATTEMPTS || 2),
                maxTokens: 520
              }
            );
            usedModel = structuredResult.model;
            return structuredResult.output;
          })()
        : (await run(
            realInfluencerExtractionAgent,
            JSON.stringify({
        product: input.product,
        goal: input.goal,
        platform: input.platform,
        audience: input.audience,
        sourceCandidates: compactCandidatesForAI(fallback),
        sources: compactSourcesForAI(sources),
        guardrail: "Never invent fields that are not visible in the supplied sourceCandidates or sources."
      }),
            { maxTurns: 3 }
          )).finalOutput;
    const parsed = RealInfluencerExtraction.safeParse(normalizeRealInfluencerExtraction(finalOutput));
    if (!parsed.success) {
      return {
        candidates: fallback,
        usedOpenAIAgents: true,
        caveat: `${configuredAIDisplayName()} extraction validation failed; displayed rules-based Bright Data source extraction.`
      };
    }

    const candidates = dedupeRealInfluencerCandidates(parsed.data.candidates
      .filter((candidate) => candidate.sourceUrl && displayNameLooksUsable(candidate.displayName) && candidateLooksLikeCreator(candidate) && candidateRelevanceScore(input.product, candidate) >= 2)
      .map((candidate, index) => ({
        ...candidate,
        displayName: decodeHtml(candidate.displayName),
        sourceTitle: decodeHtml(candidate.sourceTitle),
        sourceDescription: decodeHtml(candidate.sourceDescription),
        evidence: candidate.evidence.map(decodeHtml),
        matchScore: Math.min(99, Math.max(64, 78 + candidateRelevanceScore(input.product, candidate) * 3 - index * 2))
      })));

    return {
      candidates: candidates.length ? candidates : fallback,
      usedOpenAIAgents: true,
      caveat: `${parsed.data.caveat} Model: ${usedModel}.`
    };
  } catch (error) {
    return {
      candidates: fallback,
      usedOpenAIAgents: false,
      caveat: friendlyAIUnavailableNote(error, "rules-based Bright Data source extraction")
    };
  }
}

function evaluationVerdict(score) {
  if (score >= 86) return "Strong fit";
  if (score >= 74) return "Good fit";
  if (score >= 58) return "Check fit";
  return "Weak fit";
}

function localInfluencerEvaluation(input, influencer, index = 0) {
  const relevance = candidateRelevanceScore(input.product, influencer);
  const sourceBonus = influencer.sourceType === "profile" ? 10 : influencer.sourceType === "post" ? 8 : influencer.sourceType === "searchResult" ? 3 : 0;
  const confidenceBonus = influencer.confidence === "High" ? 10 : influencer.confidence === "Medium" ? 5 : 0;
  const riskPenalty = realSourceRiskPenalty(influencer);
  const score = Math.min(94, Math.max(42, 58 + relevance * 4 + sourceBonus + confidenceBonus - riskPenalty - index));
  const verdict = evaluationVerdict(score);
  const product = input.product || "the product";
  return {
    displayName: influencer.displayName,
    sourceUrl: influencer.sourceUrl,
    aiScore: Math.round(score),
    verdict,
    summary: `${influencer.displayName} has visible public source evidence connected to ${product}. Treat the score as source-based until full creator analytics are verified.`,
    strengths: [
      influencer.matchReason || `Visible source text connects this creator result to ${product}.`,
      `${influencer.platform} source context can support a native ${input.goal || "campaign"} test.`
    ],
    risks: [
      influencer.sourceType === "article" ? "Article/list evidence is weaker than a direct creator profile or post." : "Verify the linked profile, rates, audience fit, and availability before outreach.",
      "No private audience analytics, emails, or conversion data were inferred."
    ],
    recommendedUse: `Use for a source-backed ${input.goal || "creator"} shortlist pass; reference the linked public evidence in outreach.`,
    confidence: influencer.confidence,
    scoringMethod: "source"
  };
}

function realSourceRiskPenalty(influencer) {
  if (influencer.confidence === "Low" || influencer.sourceType === "article") return 12;
  if (influencer.sourceType === "searchResult") return 7;
  return 0;
}

function normalizeInfluencerEvaluationOutput(value, input, influencers) {
  const fallback = influencers.map((influencer, index) => localInfluencerEvaluation(input, influencer, index));
  const rawEvaluations = Array.isArray(value?.evaluations) ? value.evaluations : [];
  const byKey = new Map();
  const byUrl = new Map();
  for (const raw of rawEvaluations) {
    const normalized = {
      displayName: String(raw?.displayName || ""),
      sourceUrl: String(raw?.sourceUrl || ""),
      aiScore: Math.round(Number(raw?.aiScore ?? raw?.score ?? 0)),
      verdict: String(raw?.verdict || ""),
      summary: String(raw?.summary || ""),
      strengths: Array.isArray(raw?.strengths) ? raw.strengths.map((item) => String(item)).filter(Boolean).slice(0, 3) : [],
      risks: Array.isArray(raw?.risks) ? raw.risks.map((item) => String(item)).filter(Boolean).slice(0, 3) : [],
      recommendedUse: String(raw?.recommendedUse || raw?.recommendation || ""),
      confidence: String(raw?.confidence || ""),
      scoringMethod: "ai"
    };
    const key = `${normalized.sourceUrl}::${normalized.displayName}`.toLowerCase();
    byKey.set(key, normalized);
    if (normalized.sourceUrl) byUrl.set(normalized.sourceUrl.toLowerCase(), normalized);
  }

  return {
    evaluations: fallback.map((fallbackItem) => {
      const candidate =
        byKey.get(`${fallbackItem.sourceUrl}::${fallbackItem.displayName}`.toLowerCase()) ||
        byUrl.get(fallbackItem.sourceUrl.toLowerCase());
      if (!candidate) return fallbackItem;
      const boundedScore = Math.min(100, Math.max(0, candidate.aiScore || fallbackItem.aiScore));
      return {
        displayName: fallbackItem.displayName,
        sourceUrl: fallbackItem.sourceUrl,
        aiScore: boundedScore,
        verdict: evaluationVerdict(boundedScore),
        summary: candidate.summary || fallbackItem.summary,
        strengths: candidate.strengths.length ? candidate.strengths : fallbackItem.strengths,
        risks: candidate.risks.length ? candidate.risks : fallbackItem.risks,
        recommendedUse: candidate.recommendedUse || fallbackItem.recommendedUse,
        confidence: ["Low", "Medium", "High"].includes(candidate.confidence) ? candidate.confidence : fallbackItem.confidence,
        scoringMethod: candidate.scoringMethod
      };
    }),
    note: String(value?.note || "Creator fit evaluated from supplied public source evidence.")
  };
}

function evaluationKey(item) {
  return `${item.sourceUrl || ""}::${item.displayName || ""}`.toLowerCase();
}

function chunkItems(items, size) {
  const chunks = [];
  for (let index = 0; index < items.length; index += size) {
    chunks.push(items.slice(index, index + size));
  }
  return chunks;
}

async function runInfluencerEvaluationChunk(input, influencers, provider, batchIndex, batchCount) {
  const payload = {
    product: input.product,
    goal: input.goal,
    platform: input.platform,
    audience: input.audience,
    creatorCriteria: input.creatorCriteria,
    batch: `${batchIndex + 1} of ${batchCount}`,
    influencers: compactCandidatesForAI(influencers, influencers.length),
    scoringRules: [
      "Reward direct visible product/category relevance.",
      "Reward direct profile/post evidence over articles or generic search results.",
      "Penalize marketplace, affiliate marketing education, seller tutorials, or non-creator pages.",
      "Do not infer private analytics, follower counts, rates, emails, or conversion data."
    ]
  };
  let usedModel = configuredAIModel();
  const finalOutput =
    provider === "google" || provider === "nvidia"
      ? await (async () => {
          const runStructured = provider === "google" ? runGoogleStructured : runNvidiaStructured;
          const structuredResult = await runStructured(
            JSON.stringify(payload),
            [
              "Schema: {\"evaluations\":[{\"displayName\":\"string\",\"sourceUrl\":\"string\",\"aiScore\":0,\"verdict\":\"Strong fit|Good fit|Check fit|Weak fit\",\"summary\":\"string\",\"strengths\":[\"string\"],\"risks\":[\"string\"],\"recommendedUse\":\"string\",\"confidence\":\"Low|Medium|High\"}],\"note\":\"string\"}",
              "Evaluate every supplied influencer for product fit using only the supplied public source fields. Preserve displayName and sourceUrl exactly. Keep summary, strengths, risks, and recommendedUse short.",
              `Product intent terms: ${productIntentTerms(input.product).join(", ")}.`
            ].join("\n"),
            {
              timeoutMs: Number(process.env.NVIDIA_CREATOR_EVALUATION_TIMEOUT_MS || 90000),
              attempts: Number(process.env.NVIDIA_CREATOR_EVALUATION_ATTEMPTS || 1),
              maxTokens: Number(process.env.NVIDIA_CREATOR_EVALUATION_MAX_TOKENS || 650)
            }
          );
          usedModel = structuredResult.model;
          return structuredResult.output;
        })()
      : (await run(
          realInfluencerEvaluationAgent,
          JSON.stringify(payload),
          { maxTurns: 3 }
        )).finalOutput;

  const normalized = normalizeInfluencerEvaluationOutput(finalOutput, input, influencers);
  const parsed = RealInfluencerEvaluationOutput.safeParse(normalized);
  if (!parsed.success) {
    throw new Error(`${configuredAIDisplayName()} evaluation validation failed.`);
  }

  return {
    evaluations: parsed.data.evaluations.map((evaluation) => ({
      ...evaluation,
      scoringMethod: "ai"
    })),
    model: usedModel,
    note: parsed.data.note
  };
}

async function evaluateRealInfluencers(input) {
  const influencers = input.influencers
    .filter((influencer) => influencer.sourceUrl && displayNameLooksUsable(influencer.displayName) && candidateLooksLikeCreator(influencer))
    .slice(0, 12);
  const fallback = influencers.map((influencer, index) => localInfluencerEvaluation(input, influencer, index));
  const provider = configuredAIProvider();
  if (provider === "local" || !influencers.length) {
    return {
      evaluations: fallback,
      usedOpenAIAgents: false,
      model: configuredAIModel(),
      note: provider === "local"
        ? "No AI provider key is configured; returned source-based creator fit scores."
        : "No eligible public creator candidates were available for AI evaluation."
    };
  }

  try {
    const batchSize = Math.max(1, Math.min(5, Number(process.env.NVIDIA_CREATOR_EVALUATION_BATCH_SIZE || 3)));
    const batches = provider === "openai" ? [influencers] : chunkItems(influencers, batchSize);
    const settled = await Promise.allSettled(
      batches.map((batch, batchIndex) => runInfluencerEvaluationChunk(input, batch, provider, batchIndex, batches.length))
    );
    const aiEvaluationMap = new Map();
    const usedModels = new Set();
    const failures = [];

    for (const [index, result] of settled.entries()) {
      if (result.status === "fulfilled") {
        usedModels.add(result.value.model);
        for (const evaluation of result.value.evaluations) {
          aiEvaluationMap.set(evaluationKey(evaluation), evaluation);
        }
      } else {
        failures.push(result.reason instanceof Error ? result.reason.message : String(result.reason || "AI evaluation batch failed."));
        const retryDelayMs = Math.max(0, Number(process.env.NVIDIA_CREATOR_EVALUATION_RETRY_DELAY_MS || 2500));
        for (const influencer of batches[index]) {
          if (retryDelayMs) await sleep(retryDelayMs);
          try {
            const retryResult = await runInfluencerEvaluationChunk(input, [influencer], provider, 0, 1);
            usedModels.add(retryResult.model);
            for (const evaluation of retryResult.evaluations) {
              aiEvaluationMap.set(evaluationKey(evaluation), evaluation);
            }
          } catch (retryError) {
            failures.push(retryError instanceof Error ? retryError.message : String(retryError || "AI single-card retry failed."));
          }
        }
      }
    }

    const evaluations = fallback.map((fallbackItem) => aiEvaluationMap.get(evaluationKey(fallbackItem)) || fallbackItem);
    const aiCount = evaluations.filter((evaluation) => evaluation.scoringMethod === "ai").length;

    if (!aiCount) {
      return {
        evaluations: fallback,
        usedOpenAIAgents: false,
        model: configuredAIModel(),
        note: failures.length
          ? friendlyAIUnavailableNote(new Error(failures.join(" | ")), "source-based creator fit scores")
          : `${configuredAIDisplayName()} ran, but no AI evaluations were returned; returned source-based creator fit scores.`
      };
    }

    return {
      evaluations,
      usedOpenAIAgents: true,
      model: [...usedModels].join(", ") || configuredAIModel(),
      note: failures.length
        ? `${configuredAIDisplayName()} scored ${aiCount} of ${evaluations.length} creator cards; source scoring filled the rest.`
        : `${configuredAIDisplayName()} (${[...usedModels].join(", ") || configuredAIModel()}) scored all ${evaluations.length} creator cards from supplied Bright Data source evidence.`
    };
  } catch (error) {
    return {
      evaluations: fallback,
      usedOpenAIAgents: false,
      model: configuredAIModel(),
      note: friendlyAIUnavailableNote(error, "source-based creator fit scores")
    };
  }
}

function matchesRequestedPlatform({ platform, link, sourceUrl, title, source, description }, requestedPlatform) {
  if (!requestedPlatform || requestedPlatform === "Any") return true;
  const requested = requestedPlatform.toLowerCase();
  const explicit = String(platform || "").toLowerCase();
  if (explicit && explicit !== "public web") return explicit === requested;
  const detected = platformFromSource({ link: link || sourceUrl, title, source, description }).toLowerCase();
  return detected === requested;
}

async function discoverRealInfluencers(input) {
  const queries = discoveryQueries(input);
  const results = await Promise.all(queries.map((query) => requestBrightDataSerp(query).catch(() => ({ ok: false, sources: [] }))));
  const sources = [];
  const seen = new Set();
  for (const result of results) {
    for (const source of result.sources || []) {
      const key = source.link || source.title;
      if (!key || seen.has(key)) continue;
      seen.add(key);
      sources.push(source);
    }
  }
  const relevantSources = sourceBackedResults(input.product, sources)
    .filter((source) => matchesRequestedPlatform(source, input.platform));
  const creatorSources = relevantSources.filter(sourceLooksLikeCreatorCandidate).slice(0, 8);
  const extraction = await extractRealInfluencers(input, creatorSources);
  const candidates = extraction.candidates
    .filter((candidate) => matchesRequestedPlatform(candidate, input.platform));
  return {
    sources: creatorSources,
    candidates,
    usedOpenAIAgents: extraction.usedOpenAIAgents,
    caveat: creatorSources.length
      ? `${extraction.caveat}${input.platform && input.platform !== "Any" ? ` Results are restricted to ${input.platform}.` : ""}`
      : `Bright Data returned ${sources.length} public sources, but none showed enough visible ${input.platform && input.platform !== "Any" ? `${input.platform} ` : ""}creator evidence for "${input.product}". Try a more specific product phrase or broaden the platform.`,
    brightDataUsed: results.some((result) => result.ok)
  };
}

function htmlToText(html) {
  return html
    .replace(/<script[\s\S]*?<\/script>/gi, " ")
    .replace(/<style[\s\S]*?<\/style>/gi, " ")
    .replace(/<[^>]+>/g, " ")
    .replace(/&nbsp;/g, " ")
    .replace(/&amp;/g, "&")
    .replace(/\s+/g, " ")
    .trim()
    .slice(0, 1600);
}

async function fetchBrightDataPageText(url) {
  if (!hasBrightDataUnlockerConfig() || !sourceLooksFetchable(url)) return null;

  const response = await fetch(process.env.BRIGHT_DATA_FETCH_URL, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${process.env.BRIGHT_DATA_API_KEY}`,
      "Content-Type": "application/json"
    },
    body: JSON.stringify({
      zone: process.env.BRIGHT_DATA_UNLOCKER_ZONE,
      url,
      format: "raw"
    })
  });

  if (!response.ok) return null;
  return htmlToText(await response.text());
}

function localProductBrief({ product, goal, platform, audience }, sources) {
  const snippets = sources.map((source) => source.description).filter(Boolean);
  const productPhrase = product.toLowerCase();
  const hasWorkwear = /blazer|work|office|linen|capsule|petite/.test(productPhrase);
  const hasBeauty = /beauty|serum|skin|makeup|spf|hair/.test(productPhrase);
  const hasFitness = /fitness|protein|wellness|supplement|pilates/.test(productPhrase);

  const demandSignals = hasWorkwear
    ? [
        "Questions about fit, sizing, styling context, and direct shopping links are the strongest public demand signals.",
        "Office and warm-weather use cases are likely clearer than generic fashion positioning.",
        "Creator evidence should emphasize audience requests for practical styling and repeatable outfits."
      ]
    : hasBeauty
      ? [
          "Questions about routine fit, ingredients, shade or skin-type matching, and visible outcomes are the strongest public demand signals.",
          "Creator evidence should prioritize educational content and saved/commented product questions.",
          "Offer copy should avoid medical or guaranteed-result language."
        ]
      : hasFitness
        ? [
            "Questions about routine integration, taste or comfort, beginner suitability, and consistency are the strongest public demand signals.",
            "Creator evidence should prioritize habit-building content and audience requests for practical plans.",
            "Offer copy should avoid health outcome guarantees."
          ]
        : [
            "Audience questions about use case, price, comparison, and purchase links are the strongest public demand signals.",
            "Creator evidence should connect the product to repeated comment themes, not follower count.",
            "Offer copy should stay specific to the creator's niche and the brand's launch goal."
          ];

  return {
    summary: snippets.length
      ? `Live brief for ${product}: public search snippets are available for demand and outreach context.`
      : `Live brief for ${product}: public source snippets are limited, so verify creator-specific evidence in the real influencer results.`,
    demandSignals,
    searchAngles: [
      `${product} customer questions`,
      `${product} styling ideas`,
      `${product} reviews and shopping intent`,
      [product, goal, audience].filter(Boolean).join(" ")
    ].filter(Boolean),
    outreachCues: [
      `Reference the creator's niche and the clearest audience signal before mentioning ${product}.`,
      platform ? `Keep the ask native to ${platform} and reference the visible public source that matched.` : "Keep the ask tied to the recommended campaign format.",
      "Use source-backed copy and review the linked public evidence before outreach."
    ],
    caution: "Product research is public web context. Verify creator availability, rates, and analytics before committing budget."
  };
}

function normalizeStringArray(value, fallback, minItems, maxItems) {
  const items = Array.isArray(value)
    ? value.map((item) => String(item || "").trim()).filter(Boolean)
    : [];
  const merged = [...items, ...fallback].filter(Boolean);
  return [...new Set(merged)].slice(0, maxItems).concat(fallback).slice(0, Math.max(minItems, Math.min(maxItems, merged.length || fallback.length)));
}

function normalizeProductBrief(value, input, sources) {
  const fallback = localProductBrief(input, sources);
  return {
    summary: String(value?.summary || fallback.summary),
    demandSignals: normalizeStringArray(value?.demandSignals, fallback.demandSignals, 3, 6),
    searchAngles: normalizeStringArray(value?.searchAngles, fallback.searchAngles, 3, 6),
    outreachCues: normalizeStringArray(value?.outreachCues, fallback.outreachCues, 2, 5),
    caution: String(value?.caution || fallback.caution)
  };
}

function deriveDemandTerms(product, creator, sources, scrapedTexts) {
  const text = [
    product,
    creator.niche,
    ...creator.contentThemes,
    creator.whyMatch,
    ...sources.map((source) => `${source.title} ${source.description}`),
    ...scrapedTexts
  ]
    .join(" ")
    .toLowerCase();

  const preferred = [
    "shopping links",
    "try on",
    "styling",
    "workwear",
    "petite sizing",
    "renter friendly",
    "budget decor",
    "capsule wardrobe",
    "affiliate",
    "product review",
    "routine",
    "comparison",
    "small space",
    "summer",
    "office outfits",
    "gifted collaboration"
  ];

  const matches = preferred.filter((term) => text.includes(term));
  const fallback = creator.contentThemes.map((theme) => theme.toLowerCase()).slice(0, 4);
  return [...new Set([...matches, ...fallback])].slice(0, 6);
}

function localCreatorResearchBrief({ product }, creator, sources, scrapedTexts) {
  const audienceDemandTerms = deriveDemandTerms(product, creator, sources, scrapedTexts);
  const sourceCount = sources.length;
  return {
    audienceDemandTerms,
    agentSummary: sourceCount
      ? `Bright Data found public web context around ${creator.niche.toLowerCase()} and ${product || "this product category"}. Treat it as discovery context, not verified analytics for ${creator.name}.`
      : `No strong public web enrichment was returned for ${creator.niche.toLowerCase()}; use this only as secondary context.`,
    outreachAngle: `${creator.suggestedAngle || creator.whyMatch}`.slice(0, 180),
    confidence: sourceCount >= 4 ? "Medium" : "Low",
    caveat: "Live sources are public web discovery data. They are not verified creator platform analytics."
  };
}

async function buildAgentBrief(input, brightDataResult) {
  const provider = configuredAIProvider();
  if (provider === "local") {
    return {
      brief: localProductBrief(input, brightDataResult.sources),
      usedOpenAIAgents: false,
      agentNote: "No AI provider key is configured; returned rules-based source brief."
    };
  }

  try {
    const payload = {
      product: input.product,
      goal: input.goal,
      platform: input.platform,
      audience: input.audience,
      creatorCriteria: input.creatorCriteria,
      brightDataSources: compactSourcesForAI(brightDataResult.sources, 5),
      guardrail:
        "Only summarize product demand context. Do not infer real creator analytics or social scraping."
    };
    let usedModel = configuredAIModel();
    const finalOutput =
      provider === "google" || provider === "nvidia"
        ? await (async () => {
            const runStructured = provider === "google" ? runGoogleStructured : runNvidiaStructured;
            const structuredResult = await runStructured(
              JSON.stringify(payload),
              [
                "Schema: {\"summary\":\"string\",\"demandSignals\":[\"string\"],\"searchAngles\":[\"string\"],\"outreachCues\":[\"string\"],\"caution\":\"string\"}",
                "Summarize public product research for a creator marketing workflow. Use only supplied Bright Data search snippets and product context. If evidence is thin, say so plainly.",
                `Product intent terms: ${productIntentTerms(input.product).join(", ")}.`
              ].join("\n"),
              {
                timeoutMs: Number(process.env.NVIDIA_PRODUCT_BRIEF_TIMEOUT_MS || 60000),
                attempts: Number(process.env.NVIDIA_MODEL_ATTEMPTS || 2),
                maxTokens: 460
              }
            );
            usedModel = structuredResult.model;
            return structuredResult.output;
          })()
        : (await run(
            productSignalAgent,
            JSON.stringify({
        product: input.product,
        goal: input.goal,
        platform: input.platform,
        audience: input.audience,
        brightDataSources: compactSourcesForAI(brightDataResult.sources, 5),
        guardrail:
          "Only summarize product demand context. Do not infer real creator analytics or social scraping."
      }),
            { maxTurns: 3 }
          )).finalOutput;

    const parsed = ProductBrief.safeParse(normalizeProductBrief(finalOutput, input, brightDataResult.sources));
    if (!parsed.success) {
      return {
        brief: localProductBrief(input, brightDataResult.sources),
        usedOpenAIAgents: true,
        agentNote: `${configuredAIDisplayName()} ran, but output validation failed; returned rules-based source brief.`
      };
    }

    return {
      brief: parsed.data,
      usedOpenAIAgents: true,
      agentNote: `${configuredAIDisplayName()} (${usedModel}) generated this brief from the supplied product context and Bright Data snippets.`
    };
  } catch (error) {
    return {
      brief: localProductBrief(input, brightDataResult.sources),
      usedOpenAIAgents: false,
      agentNote: friendlyAIUnavailableNote(error, "rules-based source brief")
    };
  }
}

async function buildCreatorResearchBrief(input, creator, sources, scrapedTexts) {
  const provider = configuredAIProvider();
  if (provider === "local") {
    return {
      brief: localCreatorResearchBrief(input, creator, sources, scrapedTexts),
      usedOpenAIAgents: false,
      agentNote: "No AI provider key is configured; returned rules-based source creator enrichment."
    };
  }

  try {
    const payload = {
      product: input.product || "the searched product",
      goal: input.goal,
      platform: input.platform,
      audience: input.audience,
      creator: {
        id: creator.id,
        name: creator.name,
        niche: creator.niche,
        platforms: creator.platforms,
        contentThemes: creator.contentThemes,
        whyMatch: creator.whyMatch
      },
      brightDataSources: sources,
      scrapedPageSnippets: scrapedTexts,
      guardrail:
        "Use public web discovery context only. Do not make up real metrics, emails, verification, social profile claims, or conversion analytics."
    };
    let usedModel = configuredAIModel();
    const finalOutput =
      provider === "google" || provider === "nvidia"
        ? await (async () => {
            const runStructured = provider === "google" ? runGoogleStructured : runNvidiaStructured;
            const structuredResult = await runStructured(
              JSON.stringify(payload),
              [
                "Schema: {\"audienceDemandTerms\":[\"string\"],\"agentSummary\":\"string\",\"outreachAngle\":\"string\",\"confidence\":\"Low|Medium|High\",\"caveat\":\"string\"}",
                "Summarize how public web context supports this creator niche fit and outreach angle. Do not invent metrics, emails, verification, profile claims, or analytics."
              ].join("\n"),
              {
                timeoutMs: Number(process.env.NVIDIA_CREATOR_ENRICHMENT_TIMEOUT_MS || 60000),
                attempts: Number(process.env.NVIDIA_MODEL_ATTEMPTS || 2),
                maxTokens: 460
              }
            );
            usedModel = structuredResult.model;
            return structuredResult.output;
          })()
        : (await run(
            creatorResearchAgent,
            JSON.stringify({
        product: input.product || "the searched product",
        goal: input.goal,
        platform: input.platform,
        audience: input.audience,
        creator: {
          id: creator.id,
          name: creator.name,
          niche: creator.niche,
          platforms: creator.platforms,
          contentThemes: creator.contentThemes,
          whyMatch: creator.whyMatch
        },
        brightDataSources: sources,
        scrapedPageSnippets: scrapedTexts,
        guardrail:
          "Use public web discovery context only. Do not make up real metrics, emails, verification, social profile claims, or conversion analytics."
      }),
            { maxTurns: 3 }
          )).finalOutput;

    const parsed = CreatorResearchBrief.safeParse(finalOutput);
    if (!parsed.success) {
      return {
        brief: localCreatorResearchBrief(input, creator, sources, scrapedTexts),
        usedOpenAIAgents: true,
        agentNote: `${configuredAIDisplayName()} ran, but creator enrichment validation failed; returned rules-based source enrichment.`
      };
    }

    return {
      brief: parsed.data,
      usedOpenAIAgents: true,
      agentNote: `${configuredAIDisplayName()} (${usedModel}) summarized Bright Data creator discovery context.`
    };
  } catch (error) {
    return {
      brief: localCreatorResearchBrief(input, creator, sources, scrapedTexts),
      usedOpenAIAgents: false,
      agentNote: friendlyAIUnavailableNote(error, "rules-based source enrichment")
    };
  }
}

const creatorResearchCache = new Map();

function creatorResearchQuery(input, creator) {
  const platformTerms = creator.platforms.join(" OR ");
  const product = input.product || creator.contentThemes[0] || creator.niche;
  return [
    `"${creator.niche}"`,
    product,
    platformTerms,
    "influencer OR creator",
    "audience questions",
    "shopping links"
  ]
    .filter(Boolean)
    .join(" ");
}

async function enrichCreator(input, creator) {
  const cacheKey = JSON.stringify({
    product: input.product || "",
    goal: input.goal || "",
    audience: input.audience || "",
    creatorId: creator.id,
    niche: creator.niche
  });
  if (creatorResearchCache.has(cacheKey)) return creatorResearchCache.get(cacheKey);

  const serpResult = await requestBrightDataSerp(creatorResearchQuery(input, creator)).catch((error) => ({
    ok: false,
    sources: [],
    error: error instanceof Error ? error.message : "Bright Data creator research failed."
  }));
  const sources = (serpResult.sources || []).slice(0, 4);
  const fetchable = sources.find((source) => sourceLooksFetchable(source.link));
  const scrapedText = fetchable?.link ? await fetchBrightDataPageText(fetchable.link).catch(() => null) : null;
  const scrapedTexts = scrapedText ? [scrapedText] : [];
  const agentResult = await buildCreatorResearchBrief(input, creator, sources, scrapedTexts);

  const enrichment = {
    creatorId: creator.id,
    sourceCount: sources.length,
    scrapedPageCount: scrapedTexts.length,
    sources,
    audienceDemandTerms: agentResult.brief.audienceDemandTerms,
    agentSummary: agentResult.brief.agentSummary,
    outreachAngle: agentResult.brief.outreachAngle,
    confidence: agentResult.brief.confidence,
    caveat: agentResult.brief.caveat,
    brightDataUsed: Boolean(serpResult.ok),
    openaiAgentsUsed: agentResult.usedOpenAIAgents,
    agentNote: agentResult.agentNote,
    error: serpResult.error
  };

  creatorResearchCache.set(cacheKey, enrichment);
  return enrichment;
}

const agentRateBuckets = new Map();

function agentRequestAllowed(request, sessionId) {
  const now = Date.now();
  const windowMs = 60_000;
  const limit = Math.max(5, Number(process.env.AGENT_CHAT_RATE_LIMIT_PER_MINUTE || 24));
  const key = `${request.ip || request.socket?.remoteAddress || "local"}:${sessionId}`;
  const bucket = agentRateBuckets.get(key);
  if (!bucket || bucket.resetAt <= now) {
    agentRateBuckets.set(key, { count: 1, resetAt: now + windowMs });
    return true;
  }
  if (bucket.count >= limit) return false;
  bucket.count += 1;
  return true;
}

function updateResearchSession(response, payload) {
  try {
    return upsertResearchSession(payload);
  } catch (error) {
    if (error instanceof ResearchSessionConflictError) {
      response.status(409).json({ error: error.message });
      return null;
    }
    throw error;
  }
}

async function persistWorkspaceResearch(request, input, productBrief) {
  if (!input.organizationId) return { saved: false, reason: "No organization selected." };
  const user = request.creatorSignalAuth?.user;
  if (!user) return { saved: false, reason: "Sign in to save this research." };
  if (!workspaceIntegrationStatus().persistenceConfigured) return { saved: false, reason: "Supabase persistence is not connected." };
  if (!await userCanManageOrganization(user.id, input.organizationId)) {
    return { saved: false, reason: "This workspace role cannot save research." };
  }
  const snapshot = getResearchSessionSnapshot(input.researchSessionId, requestOwnerKey(request));
  if (!snapshot) return { saved: false, reason: "The research session is no longer available." };
  try {
    const persisted = await persistResearchSnapshot({
      userId: user.id,
      organizationId: input.organizationId,
      snapshot,
      productBrief
    });
    return {
      saved: true,
      researchRunId: persisted.researchRunId,
      creatorCount: persisted.creatorRecords.length,
      evidenceCount: persisted.creatorRecords.length + persisted.productEvidenceIds.length
    };
  } catch (error) {
    console.error("Workspace research persistence failed", error instanceof Error ? error.message : error);
    return { saved: false, reason: "Research completed, but durable workspace save failed." };
  }
}

async function requireWorkspaceProductAccess(request, response, organizationId, researchRunId) {
  const integration = workspaceIntegrationStatus();
  if (!integration.persistenceConfigured) return true;
  if (!organizationId) {
    if (integration.authRequired) {
      response.status(400).json({ error: "Choose a workspace before using creator research." });
      return false;
    }
    return true;
  }
  const user = request.creatorSignalAuth?.user;
  if (!user) {
    response.status(401).json({ error: "Sign in to use this workspace." });
    return false;
  }
  try {
    const access = await organizationEntitlementAccess({
      organizationId,
      userId: user.id,
      researchRunId
    });
    if (!access.allowed) {
      const status = /do not have access/i.test(access.reason) ? 403 : 402;
      response.status(status).json({ error: access.reason, entitlement: access.entitlement });
      return false;
    }
    request.creatorSignalEntitlement = access.entitlement;
    return true;
  } catch (error) {
    console.error("Workspace entitlement check failed", error instanceof Error ? error.message : error);
    response.status(503).json({ error: "Workspace access could not be verified right now." });
    return false;
  }
}

async function ensureWorkspaceResearchSession(request, organizationId, researchRunId) {
  const ownerKey = requestOwnerKey(request);
  const existing = getResearchSessionSnapshot(researchRunId, ownerKey);
  if (existing || !organizationId || !workspaceIntegrationStatus().persistenceConfigured) return existing;
  const saved = await loadResearchFromWorkspace({ organizationId, researchRunId });
  if (!saved) return null;
  upsertResearchSession({
    id: saved.id,
    ownerKey,
    input: saved.input,
    productSources: saved.productSources,
    influencers: saved.influencers
  });
  return getResearchSessionSnapshot(researchRunId, ownerKey);
}

async function beginProviderDiagnostic(input) {
  try {
    return await startProviderJob(input);
  } catch (error) {
    console.error("Provider diagnostic start failed", error instanceof Error ? error.message : error);
    return null;
  }
}

async function completeProviderDiagnostic(input) {
  try {
    await finishProviderJob(input);
  } catch (error) {
    console.error("Provider diagnostic completion failed", error instanceof Error ? error.message : error);
  }
}

app.get("/api/health", (_request, response) => {
  response.json({ ok: true, service: "creator-signal-api" });
});

app.get("/api/integrations/status", (_request, response) => {
  response.json({
    brightData: {
      configured: hasBrightDataConfig(),
      searchUrlConfigured: Boolean(process.env.BRIGHT_DATA_SEARCH_URL),
      serpZoneConfigured: Boolean(process.env.BRIGHT_DATA_SERP_ZONE),
      country: process.env.BRIGHT_DATA_COUNTRY || "us"
    },
    openaiAgents: {
      configured: configuredAIProvider() !== "local",
      model: configuredAIModel(),
      provider: configuredAIProvider(),
      displayName: configuredAIDisplayName()
    },
    campaignAgent: {
      configured: hasNvidiaConfig(),
      model: process.env.NVIDIA_MODEL || "z-ai/glm-5.2",
      provider: "nvidia",
      displayName: "GLM 5.2 via NVIDIA NIM",
      grounding: "Bright Data research sessions"
    },
    workspace: {
      ...workspaceIntegrationStatus(),
      provider: "supabase"
    }
  });
});

app.post("/api/product-intelligence", async (request, response) => {
  const parsed = ResearchScopedProductRequest.safeParse(request.body);
  if (!parsed.success) {
    response.status(400).json({
      error: "Enter a product or category to start."
    });
    return;
  }

  const input = parsed.data;
  if (!await requireWorkspaceProductAccess(request, response, input.organizationId, input.researchSessionId)) return;
  const brightDataJob = await beginProviderDiagnostic({
    organizationId: input.organizationId,
    userId: request.creatorSignalAuth?.user?.id,
    researchRunId: input.researchSessionId,
    provider: "bright_data",
    operation: "product_research",
    metadata: { product: input.product }
  });
  const brightDataResult = await fetchBrightDataSerp(input).catch((error) => ({
    ok: false,
    sources: [],
    error: error instanceof Error ? error.message : "Bright Data request failed."
  }));
  await completeProviderDiagnostic({
    job: brightDataJob,
    status: brightDataResult.ok ? "complete" : "degraded",
    sourceCount: brightDataResult.sources.length,
    errorCategory: brightDataResult.ok ? null : "provider_unavailable",
    errorSummary: brightDataResult.error,
    metadata: { researchSessionId: input.researchSessionId || null }
  });
  const aiProviderJob = configuredAIProvider() === "nvidia"
    ? await beginProviderDiagnostic({
        organizationId: input.organizationId,
        userId: request.creatorSignalAuth?.user?.id,
        researchRunId: input.researchSessionId,
        provider: "nvidia",
        operation: "product_brief",
        model: configuredAIModel(),
        metadata: { product: input.product }
      })
    : null;
  const agentResult = await buildAgentBrief(input, brightDataResult);
  const agentHealthy = agentResult.usedOpenAIAgents && !/validation failed|unavailable|timed out/i.test(agentResult.agentNote);
  await completeProviderDiagnostic({
    job: aiProviderJob,
    status: agentHealthy ? "complete" : "degraded",
    sourceCount: brightDataResult.sources.length,
    errorCategory: agentHealthy ? null : "model_fallback",
    errorSummary: agentHealthy ? null : agentResult.agentNote,
    metadata: { researchSessionId: input.researchSessionId || null }
  });
  const researchSession = updateResearchSession(response, {
    id: input.researchSessionId,
    ownerKey: requestOwnerKey(request),
    input,
    productSources: brightDataResult.sources
  });
  if (!researchSession) return;
  const workspacePersistence = await persistWorkspaceResearch(request, { ...input, researchSessionId: researchSession.id }, agentResult.brief);

  response.json({
    product: input.product,
    brightData: {
      used: brightDataResult.ok,
      sources: brightDataResult.sources,
      meta: brightDataResult.meta,
      error: brightDataResult.error
    },
    openaiAgents: {
      used: agentResult.usedOpenAIAgents,
      note: agentResult.agentNote
    },
    brief: agentResult.brief,
    researchSession,
    workspacePersistence,
    disclaimer:
      "Product research may come from live public web results. Verify creator-specific analytics, rates, and availability before committing budget."
  });
});

app.post("/api/creator-enrichment", async (request, response) => {
  const parsed = CreatorEnrichmentRequest.safeParse(request.body);
  if (!parsed.success) {
    response.status(400).json({
      error: "Provide at least one creator to enrich."
    });
    return;
  }

  const input = parsed.data;
  const enrichments = await Promise.all(input.creators.map((creator) => enrichCreator(input, creator)));

  response.json({
    product: input.product || "",
    brightData: {
      used: enrichments.some((item) => item.brightDataUsed),
      mode: "SERP API plus Web Unlocker for fetchable public result pages",
      enrichedCreators: enrichments.length
    },
    openaiAgents: {
      used: enrichments.some((item) => item.openaiAgentsUsed),
      model: configuredAIModel()
    },
    enrichments,
    disclaimer:
      "Bright Data enrichment is public web discovery context. It is not verified social platform analytics, contact data, or campaign performance."
  });
});

app.post("/api/evaluate-influencers", async (request, response) => {
  const parsed = RealInfluencerEvaluationRequest.safeParse(request.body);
  if (!parsed.success) {
    response.status(400).json({
      error: "Provide product context and at least one source-backed influencer to evaluate."
    });
    return;
  }

  const input = parsed.data;
  if (!await requireWorkspaceProductAccess(request, response, input.organizationId, input.researchSessionId)) return;
  const providerJob = await beginProviderDiagnostic({
    organizationId: input.organizationId,
    userId: request.creatorSignalAuth?.user?.id,
    researchRunId: input.researchSessionId,
    provider: "nvidia",
    operation: "creator_evaluation",
    model: configuredAIModel(),
    metadata: { creatorCount: input.influencers.length }
  });
  const result = await evaluateRealInfluencers(input);
  await completeProviderDiagnostic({
    job: providerJob,
    status: result.usedOpenAIAgents ? "complete" : "degraded",
    sourceCount: input.influencers.length,
    errorCategory: result.usedOpenAIAgents ? null : "model_fallback",
    errorSummary: result.usedOpenAIAgents ? null : result.note,
    metadata: { evaluationCount: result.evaluations.length }
  });
  response.json({
    product: input.product,
    openaiAgents: {
      used: result.usedOpenAIAgents,
      model: result.model,
      note: result.note
    },
    evaluations: result.evaluations,
    disclaimer:
      "AI fit scores use only the supplied public Bright Data source evidence. Verify rates, audience analytics, rights, and availability before committing budget."
  });
});

app.post("/api/real-influencers", async (request, response) => {
  const parsed = ResearchScopedProductRequest.safeParse(request.body);
  if (!parsed.success) {
    response.status(400).json({
      error: "Enter a product or category to start."
    });
    return;
  }

  const input = parsed.data;
  if (!await requireWorkspaceProductAccess(request, response, input.organizationId, input.researchSessionId)) return;
  const providerJob = await beginProviderDiagnostic({
    organizationId: input.organizationId,
    userId: request.creatorSignalAuth?.user?.id,
    researchRunId: input.researchSessionId,
    provider: "bright_data",
    operation: "creator_discovery",
    metadata: { product: input.product, platform: input.platform || "Any" }
  });
  const discovery = await discoverRealInfluencers(input);
  const researchSession = updateResearchSession(response, {
    id: input.researchSessionId,
    ownerKey: requestOwnerKey(request),
    input,
    influencerSources: discovery.sources,
    influencers: discovery.candidates
  });
  if (!researchSession) return;
  const workspacePersistence = await persistWorkspaceResearch(request, { ...input, researchSessionId: researchSession.id });
  await completeProviderDiagnostic({
    job: providerJob,
    status: discovery.brightDataUsed ? "complete" : "degraded",
    sourceCount: discovery.sources.length,
    errorCategory: discovery.brightDataUsed ? null : "provider_unavailable",
    errorSummary: discovery.brightDataUsed ? null : discovery.caveat,
    metadata: {
      researchSessionId: researchSession.id,
      creatorCount: discovery.candidates.length,
      workspaceSaved: workspacePersistence.saved
    }
  });
  response.json({
    product: input.product,
    brightData: {
      used: discovery.brightDataUsed,
      sourceCount: discovery.sources.length,
      mode: "Bright Data SERP API public influencer discovery"
    },
    openaiAgents: {
      used: discovery.usedOpenAIAgents,
      model: configuredAIModel()
    },
    influencers: discovery.candidates,
    researchSession,
    workspacePersistence,
    caveat: discovery.caveat,
    disclaimer:
      "These are real public web results discovered via Bright Data. Metrics are shown only when visible in source text; no private analytics or contact data is inferred."
  });
});

app.post("/api/agent/discovery", async (request, response) => {
  const parsed = AgentDiscoveryRequest.safeParse(request.body);
  if (!parsed.success) {
    response.status(400).json({ error: "Tell the discovery agent what you want to promote." });
    return;
  }
  const user = request.creatorSignalAuth?.user;
  if (!user) {
    response.status(401).json({ error: "Sign in to plan and save creator discovery." });
    return;
  }
  if (!await requireWorkspaceProductAccess(request, response, parsed.data.organizationId)) return;
  if (!agentRequestAllowed(request, `discovery:${user.id}`)) {
    response.status(429).json({ error: "The discovery agent is receiving too many requests. Try again in a minute." });
    return;
  }

  let providerJob = null;
  try {
    providerJob = await beginProviderDiagnostic({
      organizationId: parsed.data.organizationId,
      userId: user.id,
      provider: "nvidia",
      operation: "discovery_planning",
      model: process.env.NVIDIA_MODEL || "z-ai/glm-5.2",
      metadata: { messageCount: parsed.data.messages.length }
    });
    const result = await planCreatorDiscovery({
      messages: parsed.data.messages,
      currentSearch: parsed.data.currentSearch,
      nvidia: {
        apiKey: process.env.NVIDIA_API_KEY || process.env.NVIDIA_NIM_API_KEY,
        baseUrl: process.env.NVIDIA_BASE_URL || "https://integrate.api.nvidia.com/v1",
        model: process.env.NVIDIA_MODEL || "z-ai/glm-5.2",
        timeoutMs: Number(process.env.NVIDIA_AGENT_TIMEOUT_MS || 60000),
        discoveryMaxTokens: Number(process.env.NVIDIA_AGENT_DISCOVERY_MAX_TOKENS || 700)
      }
    });
    await completeProviderDiagnostic({
      job: providerJob,
      status: result.providerUsed ? "complete" : "degraded",
      sourceCount: 0,
      errorCategory: result.providerUsed ? null : "model_fallback",
      errorSummary: result.providerUsed ? null : result.note,
      metadata: {
        action: result.action,
        toolsUsed: result.toolsUsed.map((tool) => tool.name)
      }
    });
    response.json({
      ...result,
      grounded: false,
      grounding: "customer_requirements",
      disclaimer: "Creator identities and recommendations are returned only after the live Bright Data search runs."
    });
  } catch (error) {
    await completeProviderDiagnostic({
      job: providerJob,
      status: "failed",
      sourceCount: 0,
      errorCategory: "request_failed",
      errorSummary: error instanceof Error ? error.message : "Discovery planning failed."
    });
    console.error("Discovery agent planning failed", error instanceof Error ? error.message : error);
    response.status(503).json({ error: "The discovery agent could not plan this search right now." });
  }
});

app.post("/api/agent/chat", async (request, response) => {
  const parsed = AgentChatRequest.safeParse(request.body);
  if (!parsed.success) {
    response.status(400).json({ error: "Send a message from an active creator research session." });
    return;
  }

  if (!await requireWorkspaceProductAccess(
    request,
    response,
    parsed.data.organizationId,
    parsed.data.researchSessionId
  )) return;

  if (!agentRequestAllowed(request, parsed.data.researchSessionId)) {
    response.status(429).json({ error: "The campaign copilot is receiving too many requests. Try again in a minute." });
    return;
  }

  try {
    const activeResearch = await ensureWorkspaceResearchSession(
      request,
      parsed.data.organizationId,
      parsed.data.researchSessionId
    );
    if (!activeResearch) {
      response.status(410).json({ error: "This research session expired. Run the creator search again to refresh its evidence." });
      return;
    }
  } catch (error) {
    console.error("Campaign copilot research resume failed", error instanceof Error ? error.message : error);
    response.status(503).json({ error: "The saved research session could not be opened right now." });
    return;
  }

  const providerJob = await beginProviderDiagnostic({
    organizationId: parsed.data.organizationId,
    userId: request.creatorSignalAuth?.user?.id,
    researchRunId: parsed.data.researchSessionId,
    provider: "nvidia",
    operation: "campaign_agent_chat",
    model: process.env.NVIDIA_MODEL || "z-ai/glm-5.2",
    metadata: { messageCount: parsed.data.messages.length }
  });

  const result = await runGroundedCampaignAgent({
    sessionId: parsed.data.researchSessionId,
    ownerKey: requestOwnerKey(request),
    messages: parsed.data.messages,
    nvidia: {
      apiKey: process.env.NVIDIA_API_KEY || process.env.NVIDIA_NIM_API_KEY,
      baseUrl: process.env.NVIDIA_BASE_URL || "https://integrate.api.nvidia.com/v1",
      model: process.env.NVIDIA_MODEL || "z-ai/glm-5.2",
      timeoutMs: Number(process.env.NVIDIA_AGENT_TIMEOUT_MS || 60000),
      toolMaxTokens: Number(process.env.NVIDIA_AGENT_TOOL_MAX_TOKENS || 900),
      answerMaxTokens: Number(process.env.NVIDIA_AGENT_ANSWER_MAX_TOKENS || 1000)
    }
  });

  if (result.status === "missing") {
    await completeProviderDiagnostic({
      job: providerJob,
      status: "failed",
      sourceCount: 0,
      errorCategory: "research_session_missing",
      errorSummary: "The grounded research session was unavailable."
    });
    response.status(410).json({ error: "This research session expired. Run the creator search again to refresh its evidence." });
    return;
  }

  let workspacePersistence = { saved: false, reason: "No organization selected." };
  if (parsed.data.organizationId && request.creatorSignalAuth?.user && workspaceIntegrationStatus().persistenceConfigured) {
    const canPersist = await userCanManageOrganization(request.creatorSignalAuth.user.id, parsed.data.organizationId);
    const snapshot = canPersist
      ? getResearchSessionSnapshot(parsed.data.researchSessionId, requestOwnerKey(request))
      : null;
    const userMessage = [...parsed.data.messages].reverse().find((message) => message.role === "user");
    if (snapshot && userMessage) {
      try {
        const persisted = await persistAgentExchange({
          userId: request.creatorSignalAuth.user.id,
          organizationId: parsed.data.organizationId,
          snapshot,
          userMessage,
          agentResult: result
        });
        workspacePersistence = { saved: true, ...persisted };
      } catch (error) {
        console.error("Campaign copilot persistence failed", error instanceof Error ? error.message : error);
        workspacePersistence = { saved: false, reason: "The answer is available, but conversation save failed." };
      }
    }
  }

  await completeProviderDiagnostic({
    job: providerJob,
    status: result.providerUsed ? "complete" : "degraded",
    sourceCount: result.citations?.length || 0,
    errorCategory: result.providerUsed ? null : "model_fallback",
    errorSummary: result.providerUsed ? null : result.note,
    metadata: { toolsUsed: result.toolsUsed?.map((tool) => tool.name) || [] }
  });

  response.json({
    ...result,
    workspacePersistence,
    grounded: true,
    disclaimer: "Answers are restricted to the Bright Data public evidence displayed in this research session. Verify rates, availability, audience analytics, rights, and performance directly."
  });
});

app.get("/api/workspace/research/:researchRunId/campaign-brief", async (request, response) => {
  const parsed = z.object({
    researchRunId: z.string().uuid(),
    organizationId: z.string().uuid()
  }).safeParse({
    researchRunId: request.params.researchRunId,
    organizationId: request.query.organizationId
  });
  if (!parsed.success) {
    response.status(400).json({ error: "Choose a valid workspace research session." });
    return;
  }
  const user = request.creatorSignalAuth?.user;
  if (!user) {
    response.status(401).json({ error: "Sign in to open the campaign brief." });
    return;
  }
  const role = await userOrganizationRole(user.id, parsed.data.organizationId);
  if (!role) {
    response.status(403).json({ error: "You do not have access to that workspace." });
    return;
  }
  try {
    const campaignBrief = await loadCampaignBrief(parsed.data);
    response.json({
      campaignBrief,
      permissions: {
        role,
        canEdit: ["owner", "admin", "marketer"].includes(role),
        canApprove: ["owner", "admin", "approver"].includes(role)
      }
    });
  } catch (error) {
    console.error("Campaign brief load failed", error instanceof Error ? error.message : error);
    response.status(503).json({ error: "The campaign brief could not be loaded right now." });
  }
});

app.post("/api/workspace/research/:researchRunId/campaign-brief/generate", async (request, response) => {
  const parsed = CampaignBriefGenerateRequest.extend({ researchRunId: z.string().uuid() }).safeParse({
    ...request.body,
    researchRunId: request.params.researchRunId
  });
  if (!parsed.success) {
    response.status(400).json({ error: "Send valid campaign requirements from an active research session." });
    return;
  }
  const user = request.creatorSignalAuth?.user;
  if (!user) {
    response.status(401).json({ error: "Sign in to prepare a campaign brief." });
    return;
  }
  if (!await userCanManageOrganization(user.id, parsed.data.organizationId)) {
    response.status(403).json({ error: "A workspace manager role is required to prepare a campaign brief." });
    return;
  }
  if (!await requireWorkspaceProductAccess(
    request,
    response,
    parsed.data.organizationId,
    parsed.data.researchRunId
  )) return;
  if (!agentRequestAllowed(request, `${parsed.data.researchRunId}:campaign-brief`)) {
    response.status(429).json({ error: "Campaign brief planning is receiving too many requests. Try again in a minute." });
    return;
  }

  let providerJob = null;
  try {
    const snapshot = await ensureWorkspaceResearchSession(
      request,
      parsed.data.organizationId,
      parsed.data.researchRunId
    );
    if (!snapshot) {
      response.status(410).json({ error: "This research session expired. Refresh the creator search before preparing a brief." });
      return;
    }
    providerJob = await beginProviderDiagnostic({
      organizationId: parsed.data.organizationId,
      userId: user.id,
      researchRunId: parsed.data.researchRunId,
      provider: "nvidia",
      operation: "campaign_brief",
      model: process.env.NVIDIA_MODEL || "z-ai/glm-5.2",
      metadata: { messageCount: parsed.data.messages.length }
    });
    const result = await draftGroundedCampaignBrief({
      sessionId: parsed.data.researchRunId,
      ownerKey: requestOwnerKey(request),
      messages: parsed.data.messages,
      nvidia: {
        apiKey: process.env.NVIDIA_API_KEY || process.env.NVIDIA_NIM_API_KEY,
        baseUrl: process.env.NVIDIA_BASE_URL || "https://integrate.api.nvidia.com/v1",
        model: process.env.NVIDIA_MODEL || "z-ai/glm-5.2",
        timeoutMs: Number(process.env.NVIDIA_AGENT_TIMEOUT_MS || 60000),
        briefMaxTokens: Number(process.env.NVIDIA_AGENT_BRIEF_MAX_TOKENS || 1400)
      }
    });
    if (result.status === "missing") {
      await completeProviderDiagnostic({
        job: providerJob,
        status: "failed",
        sourceCount: 0,
        errorCategory: "research_session_missing",
        errorSummary: "The grounded research session was unavailable."
      });
      response.status(410).json({ error: "This research session expired. Refresh the creator search before preparing a brief." });
      return;
    }
    const normalized = CampaignBriefContent.safeParse(result.brief);
    if (!normalized.success) {
      await completeProviderDiagnostic({
        job: providerJob,
        status: "failed",
        sourceCount: result.citations?.length || 0,
        errorCategory: "output_validation",
        errorSummary: "The campaign brief did not pass structured validation."
      });
      response.status(502).json({ error: "The campaign brief could not be validated. Try generating it again." });
      return;
    }
    const campaignBrief = await saveCampaignBrief({
      organizationId: parsed.data.organizationId,
      researchRunId: parsed.data.researchRunId,
      userId: user.id,
      brief: normalized.data,
      citations: result.citations,
      provider: result.providerUsed ? "nvidia" : "source_retrieval",
      model: result.providerUsed ? result.model : null
    });
    await completeProviderDiagnostic({
      job: providerJob,
      status: result.providerUsed ? "complete" : "degraded",
      sourceCount: result.citations.length,
      errorCategory: result.providerUsed ? null : "model_fallback",
      errorSummary: result.providerUsed ? null : result.note,
      metadata: {
        campaignBriefId: campaignBrief.id,
        version: campaignBrief.version,
        toolsUsed: result.toolsUsed.map((tool) => tool.name)
      }
    });
    response.status(201).json({
      campaignBrief,
      toolsUsed: result.toolsUsed,
      providerUsed: result.providerUsed,
      model: result.model,
      note: result.note,
      grounded: true
    });
  } catch (error) {
    await completeProviderDiagnostic({
      job: providerJob,
      status: "failed",
      sourceCount: 0,
      errorCategory: "request_failed",
      errorSummary: error instanceof Error ? error.message : "Campaign brief generation failed."
    });
    sendWorkspaceWorkflowError(response, error, "The campaign brief could not be prepared right now.");
  }
});

app.patch("/api/workspace/research/:researchRunId/campaign-brief", async (request, response) => {
  const parsed = CampaignBriefUpdateRequest.extend({ researchRunId: z.string().uuid() }).safeParse({
    ...request.body,
    researchRunId: request.params.researchRunId
  });
  if (!parsed.success) {
    response.status(400).json({ error: parsed.error.issues[0]?.message || "Complete the structured campaign brief." });
    return;
  }
  const user = request.creatorSignalAuth?.user;
  if (!user) {
    response.status(401).json({ error: "Sign in to edit the campaign brief." });
    return;
  }
  try {
    const current = await loadCampaignBrief(parsed.data);
    if (!current) {
      response.status(404).json({ error: "Campaign brief not found." });
      return;
    }
    const campaignBrief = await saveCampaignBrief({
      organizationId: parsed.data.organizationId,
      researchRunId: parsed.data.researchRunId,
      userId: user.id,
      brief: parsed.data.brief,
      citations: current.citations,
      provider: "user",
      model: null
    });
    response.json({ saved: true, campaignBrief });
  } catch (error) {
    sendWorkspaceWorkflowError(response, error, "The campaign brief could not be saved.");
  }
});

app.post("/api/workspace/research/:researchRunId/campaign-brief/transition", async (request, response) => {
  const parsed = CampaignBriefTransitionRequest.extend({ researchRunId: z.string().uuid() }).safeParse({
    ...request.body,
    researchRunId: request.params.researchRunId
  });
  if (!parsed.success) {
    response.status(400).json({ error: "Choose a valid campaign brief status." });
    return;
  }
  const user = request.creatorSignalAuth?.user;
  if (!user) {
    response.status(401).json({ error: "Sign in to review the campaign brief." });
    return;
  }
  try {
    const campaignBrief = await transitionCampaignBrief({
      organizationId: parsed.data.organizationId,
      researchRunId: parsed.data.researchRunId,
      userId: user.id,
      status: parsed.data.status
    });
    response.json({ saved: true, campaignBrief });
  } catch (error) {
    sendWorkspaceWorkflowError(response, error, "The campaign brief status could not be changed.");
  }
});

app.post("/api/workspace/shortlist", async (request, response) => {
  const parsed = SaveCreatorRequest.safeParse(request.body);
  if (!parsed.success) {
    response.status(400).json({ error: "Choose a source-backed creator from an active research session." });
    return;
  }
  const user = request.creatorSignalAuth?.user;
  if (!user) {
    response.status(401).json({ error: "Sign in before saving creators to a workspace." });
    return;
  }
  if (!workspaceIntegrationStatus().persistenceConfigured) {
    response.status(503).json({ error: "Supabase persistence is not connected in this environment." });
    return;
  }
  const allowed = await userCanManageOrganization(user.id, parsed.data.organizationId);
  if (!allowed) {
    response.status(403).json({ error: "You do not have access to that workspace." });
    return;
  }
  const snapshot = getResearchSessionSnapshot(parsed.data.researchSessionId, requestOwnerKey(request));
  if (!snapshot) {
    response.status(410).json({ error: "This research session expired. Run the creator search again before saving." });
    return;
  }
  try {
    const saved = await saveCreatorFromResearch({
      userId: user.id,
      organizationId: parsed.data.organizationId,
      snapshot,
      sourceUrl: parsed.data.sourceUrl
    });
    if (!saved) {
      response.status(404).json({ error: "That creator is not part of this Bright Data research session." });
      return;
    }
    response.json({ saved: true, ...saved });
  } catch (error) {
    console.error("Workspace shortlist persistence failed", error instanceof Error ? error.message : error);
    response.status(503).json({ error: "The creator could not be saved right now. No local placeholder was created." });
  }
});

function sendWorkspaceWorkflowError(response, error, fallback) {
  const rawMessage = error instanceof Error ? error.message : "";
  const message = rawMessage.includes(": ") ? rawMessage.slice(rawMessage.indexOf(": ") + 2) : rawMessage;
  if (/role is required|membership is required|sign in with|verified account|only an owner|workspace manager (?:role )?is required|an approver (?:must|can)|approver must/i.test(message)) {
    response.status(403).json({ error: message });
    return;
  }
  if (/not found/i.test(message)) {
    response.status(404).json({ error: message });
    return;
  }
  if (/valid invitation email|valid workspace role|valid membership status|invalid/i.test(message)) {
    response.status(400).json({ error: message });
    return;
  }
  if (/approve|reopen|shortlist|campaign|creator|date|budget|reason|already|invitation|expired|pending|workspace access|account request/i.test(message)) {
    response.status(409).json({ error: message });
    return;
  }
  console.error(fallback, rawMessage || error);
  response.status(503).json({ error: fallback });
}

app.get("/api/invitations/:token", async (request, response) => {
  const parsed = z.object({ token: z.string().regex(/^[A-Za-z0-9_-]{20,100}$/) }).safeParse(request.params);
  if (!parsed.success) {
    response.status(404).json({ error: "Invitation not found." });
    return;
  }
  try {
    const invitation = await previewWorkspaceInvitation(parsed.data.token);
    if (!invitation) {
      response.status(404).json({ error: "Invitation not found." });
      return;
    }
    response.json({ invitation });
  } catch (error) {
    console.error("Workspace invitation preview failed", error instanceof Error ? error.message : error);
    response.status(503).json({ error: "This invitation cannot be checked right now." });
  }
});

app.post("/api/invitations/:token/accept", async (request, response) => {
  const parsed = z.object({ token: z.string().regex(/^[A-Za-z0-9_-]{20,100}$/) }).safeParse(request.params);
  if (!parsed.success) {
    response.status(404).json({ error: "Invitation not found." });
    return;
  }
  const user = request.creatorSignalAuth?.user;
  if (!user) {
    response.status(401).json({ error: "Sign in with the invited email to join this workspace." });
    return;
  }
  try {
    const accepted = await acceptWorkspaceInvitation({ token: parsed.data.token, userId: user.id });
    response.json({ accepted: true, ...accepted });
  } catch (error) {
    sendWorkspaceWorkflowError(response, error, "The workspace invitation could not be accepted.");
  }
});

app.get("/api/workspace/settings", async (request, response) => {
  const parsed = z.object({ organizationId: z.string().uuid() }).safeParse(request.query);
  if (!parsed.success) {
    response.status(400).json({ error: "Choose a valid workspace." });
    return;
  }
  const user = request.creatorSignalAuth?.user;
  if (!user) {
    response.status(401).json({ error: "Sign in to open workspace settings." });
    return;
  }
  try {
    const settings = await loadWorkspaceSettings({
      organizationId: parsed.data.organizationId,
      userId: user.id
    });
    if (!settings) {
      response.status(403).json({ error: "You do not have access to that workspace." });
      return;
    }
    response.json(settings);
  } catch (error) {
    console.error("Workspace settings load failed", error instanceof Error ? error.message : error);
    response.status(503).json({ error: "Workspace settings could not be loaded right now." });
  }
});

app.post("/api/workspace/invitations", async (request, response) => {
  const parsed = WorkspaceInvitationRequest.safeParse(request.body);
  if (!parsed.success) {
    response.status(400).json({ error: parsed.error.issues[0]?.message || "Enter a valid team invitation." });
    return;
  }
  const user = request.creatorSignalAuth?.user;
  if (!user) {
    response.status(401).json({ error: "Sign in to invite a workspace member." });
    return;
  }
  try {
    const created = await createWorkspaceInvitation({
      organizationId: parsed.data.organizationId,
      userId: user.id,
      email: parsed.data.email,
      role: parsed.data.role,
      appOrigin: process.env.APP_ORIGIN || "http://127.0.0.1:5173"
    });
    response.status(201).json({
      ...created,
      note: "Copy this link now. Only its secure hash is stored, and no email was sent automatically."
    });
  } catch (error) {
    sendWorkspaceWorkflowError(response, error, "The team invitation could not be created.");
  }
});

app.post("/api/workspace/invitations/:invitationId/revoke", async (request, response) => {
  const parsed = WorkspaceResourceRequest.extend({ invitationId: z.string().uuid() }).safeParse({
    ...request.body,
    invitationId: request.params.invitationId
  });
  if (!parsed.success) {
    response.status(400).json({ error: "Choose a valid pending invitation." });
    return;
  }
  const user = request.creatorSignalAuth?.user;
  if (!user) {
    response.status(401).json({ error: "Sign in to revoke a workspace invitation." });
    return;
  }
  try {
    await revokeWorkspaceInvitation({
      organizationId: parsed.data.organizationId,
      invitationId: parsed.data.invitationId,
      userId: user.id
    });
    response.json({ revoked: true });
  } catch (error) {
    sendWorkspaceWorkflowError(response, error, "The invitation could not be revoked.");
  }
});

app.patch("/api/workspace/members/:membershipId", async (request, response) => {
  const parsed = WorkspaceMemberRequest.extend({ membershipId: z.string().uuid() }).safeParse({
    ...request.body,
    membershipId: request.params.membershipId
  });
  if (!parsed.success) {
    response.status(400).json({ error: "Choose a valid member role and access state." });
    return;
  }
  const user = request.creatorSignalAuth?.user;
  if (!user) {
    response.status(401).json({ error: "Sign in to manage workspace members." });
    return;
  }
  try {
    const membership = await updateWorkspaceMember({
      organizationId: parsed.data.organizationId,
      membershipId: parsed.data.membershipId,
      userId: user.id,
      role: parsed.data.role,
      status: parsed.data.status
    });
    response.json({ saved: true, membership });
  } catch (error) {
    sendWorkspaceWorkflowError(response, error, "The member access could not be updated.");
  }
});

app.delete("/api/workspace/members/:membershipId", async (request, response) => {
  const parsed = WorkspaceResourceRequest.extend({ membershipId: z.string().uuid() }).safeParse({
    ...request.body,
    membershipId: request.params.membershipId
  });
  if (!parsed.success) {
    response.status(400).json({ error: "Choose a valid workspace member." });
    return;
  }
  const user = request.creatorSignalAuth?.user;
  if (!user) {
    response.status(401).json({ error: "Sign in to manage workspace members." });
    return;
  }
  try {
    await removeWorkspaceMember({
      organizationId: parsed.data.organizationId,
      membershipId: parsed.data.membershipId,
      userId: user.id
    });
    response.json({ removed: true });
  } catch (error) {
    sendWorkspaceWorkflowError(response, error, "The workspace member could not be removed.");
  }
});

app.patch("/api/account/profile", async (request, response) => {
  const parsed = AccountProfileInput.safeParse(request.body);
  if (!parsed.success) {
    response.status(400).json({ error: parsed.error.issues[0]?.message || "Complete your account profile." });
    return;
  }
  const user = request.creatorSignalAuth?.user;
  if (!user) {
    response.status(401).json({ error: "Sign in to update your account." });
    return;
  }
  try {
    const profile = await updateAccountProfile({ userId: user.id, ...parsed.data });
    response.json({ saved: true, profile });
  } catch (error) {
    sendWorkspaceWorkflowError(response, error, "Your account profile could not be updated.");
  }
});

app.post("/api/account/requests", async (request, response) => {
  const parsed = AccountRequestInput.safeParse(request.body);
  if (!parsed.success) {
    response.status(400).json({ error: "Choose a valid account request." });
    return;
  }
  const user = request.creatorSignalAuth?.user;
  if (!user) {
    response.status(401).json({ error: "Sign in to manage your account data." });
    return;
  }
  try {
    const accountRequest = await createAccountRequest({ userId: user.id, requestType: parsed.data.requestType });
    response.status(201).json({ created: true, accountRequest });
  } catch (error) {
    sendWorkspaceWorkflowError(response, error, "The account request could not be created.");
  }
});

app.post("/api/account/requests/:requestId/cancel", async (request, response) => {
  const parsed = z.object({ requestId: z.string().uuid() }).safeParse(request.params);
  if (!parsed.success) {
    response.status(400).json({ error: "Choose a valid account request." });
    return;
  }
  const user = request.creatorSignalAuth?.user;
  if (!user) {
    response.status(401).json({ error: "Sign in to manage your account data." });
    return;
  }
  try {
    await cancelAccountRequest({ userId: user.id, requestId: parsed.data.requestId });
    response.json({ cancelled: true });
  } catch (error) {
    sendWorkspaceWorkflowError(response, error, "The account request could not be cancelled.");
  }
});

app.get("/api/internal/support", async (request, response) => {
  const parsed = z.object({
    attentionOnly: z.enum(["true", "false"]).optional().transform((value) => value === "true")
  }).safeParse(request.query);
  if (!parsed.success) {
    response.status(400).json({ error: "Choose a valid support health filter." });
    return;
  }
  const user = request.creatorSignalAuth?.user;
  if (!user) {
    response.status(401).json({ error: "Sign in to open the support console." });
    return;
  }
  try {
    const dashboard = await loadSupportDashboard({
      userId: user.id,
      attentionOnly: parsed.data.attentionOnly
    });
    if (!dashboard) {
      response.status(403).json({ error: "A platform operator role is required." });
      return;
    }
    response.json(dashboard);
  } catch (error) {
    console.error("Support dashboard load failed", error instanceof Error ? error.message : error);
    response.status(503).json({ error: "The support console could not be loaded right now." });
  }
});

app.patch("/api/internal/organizations/:organizationId/entitlement", async (request, response) => {
  const resource = z.object({ organizationId: z.string().uuid() }).safeParse(request.params);
  const input = EntitlementUpdateInput.safeParse(request.body);
  if (!resource.success || !input.success) {
    response.status(400).json({ error: input.success ? "Choose a valid workspace." : input.error.issues[0]?.message || "Enter valid workspace access limits." });
    return;
  }
  const user = request.creatorSignalAuth?.user;
  if (!user) {
    response.status(401).json({ error: "Sign in to manage workspace access." });
    return;
  }
  if (!await isPlatformOperator(user.id)) {
    response.status(403).json({ error: "A platform operator role is required." });
    return;
  }
  try {
    const entitlement = await updateOrganizationEntitlement({
      organizationId: resource.data.organizationId,
      userId: user.id,
      ...input.data
    });
    response.json({ saved: true, entitlement });
  } catch (error) {
    sendWorkspaceWorkflowError(response, error, "Workspace access could not be updated.");
  }
});

app.get("/api/workspace/shortlists/:shortlistId", async (request, response) => {
  const parsed = z.object({
    shortlistId: z.string().uuid(),
    organizationId: z.string().uuid()
  }).safeParse({
    shortlistId: request.params.shortlistId,
    organizationId: request.query.organizationId
  });
  if (!parsed.success) {
    response.status(400).json({ error: "Choose a valid shortlist." });
    return;
  }
  const user = request.creatorSignalAuth?.user;
  if (!user) {
    response.status(401).json({ error: "Sign in to open this shortlist." });
    return;
  }
  const role = await userOrganizationRole(user.id, parsed.data.organizationId);
  if (!role) {
    response.status(403).json({ error: "You do not have access to that workspace." });
    return;
  }
  try {
    const data = await loadShortlistFromWorkspace(parsed.data);
    if (!data) {
      response.status(404).json({ error: "That shortlist was not found." });
      return;
    }
    response.json({
      ...data,
      permissions: {
        role,
        canManage: ["owner", "admin", "marketer"].includes(role),
        canApprove: ["owner", "admin", "approver"].includes(role)
      }
    });
  } catch (error) {
    console.error("Workspace shortlist load failed", error instanceof Error ? error.message : error);
    response.status(503).json({ error: "The shortlist could not be loaded right now." });
  }
});

app.patch("/api/workspace/shortlists/:shortlistId/entries/:entryId", async (request, response) => {
  const bodyParsed = ShortlistDecisionRequest.safeParse(request.body);
  const resourceParsed = z.object({
    shortlistId: z.string().uuid(),
    entryId: z.string().uuid()
  }).safeParse({
    shortlistId: request.params.shortlistId,
    entryId: request.params.entryId
  });
  if (!bodyParsed.success || !resourceParsed.success) {
    response.status(400).json({ error: bodyParsed.success ? "Choose a valid shortlist creator." : bodyParsed.error.issues[0]?.message || "Choose a valid creator decision." });
    return;
  }
  const user = request.creatorSignalAuth?.user;
  if (!user) {
    response.status(401).json({ error: "Sign in to update this shortlist." });
    return;
  }
  try {
    await setShortlistEntryDecision({
      organizationId: bodyParsed.data.organizationId,
      shortlistId: resourceParsed.data.shortlistId,
      entryId: resourceParsed.data.entryId,
      userId: user.id,
      decision: bodyParsed.data.decision,
      reasons: bodyParsed.data.reasons,
      notes: bodyParsed.data.notes
    });
    response.json({ saved: true });
  } catch (error) {
    sendWorkspaceWorkflowError(response, error, "The creator decision could not be saved.");
  }
});

app.post("/api/workspace/shortlists/:shortlistId/transition", async (request, response) => {
  const parsed = ShortlistTransitionRequest.extend({ shortlistId: z.string().uuid() }).safeParse({
    ...request.body,
    shortlistId: request.params.shortlistId
  });
  if (!parsed.success) {
    response.status(400).json({ error: "Choose a valid shortlist status." });
    return;
  }
  const user = request.creatorSignalAuth?.user;
  if (!user) {
    response.status(401).json({ error: "Sign in to update this shortlist." });
    return;
  }
  try {
    await transitionShortlist({
      organizationId: parsed.data.organizationId,
      shortlistId: parsed.data.shortlistId,
      userId: user.id,
      status: parsed.data.status
    });
    response.json({ saved: true, status: parsed.data.status });
  } catch (error) {
    sendWorkspaceWorkflowError(response, error, "The shortlist status could not be changed.");
  }
});

app.post("/api/workspace/shortlists/:shortlistId/campaign", async (request, response) => {
  const parsed = CampaignFromShortlistRequest.extend({ shortlistId: z.string().uuid() }).safeParse({
    ...request.body,
    shortlistId: request.params.shortlistId
  });
  if (!parsed.success) {
    response.status(400).json({ error: parsed.error.issues[0]?.message || "Complete the campaign setup." });
    return;
  }
  if (parsed.data.startsOn && parsed.data.endsOn && parsed.data.endsOn < parsed.data.startsOn) {
    response.status(400).json({ error: "Campaign end date must follow its start date." });
    return;
  }
  const user = request.creatorSignalAuth?.user;
  if (!user) {
    response.status(401).json({ error: "Sign in to create a campaign." });
    return;
  }
  try {
    const campaignId = await createCampaignFromShortlist({
      organizationId: parsed.data.organizationId,
      shortlistId: parsed.data.shortlistId,
      userId: user.id,
      name: parsed.data.name,
      creatorBudgetCents: parsed.data.creatorBudgetCents,
      startsOn: parsed.data.startsOn,
      endsOn: parsed.data.endsOn
    });
    response.json({ created: true, campaignId });
  } catch (error) {
    sendWorkspaceWorkflowError(response, error, "The campaign could not be created from this shortlist.");
  }
});

app.get("/api/workspace/campaigns/:campaignId", async (request, response) => {
  const parsed = z.object({
    campaignId: z.string().uuid(),
    organizationId: z.string().uuid()
  }).safeParse({
    campaignId: request.params.campaignId,
    organizationId: request.query.organizationId
  });
  if (!parsed.success) {
    response.status(400).json({ error: "Choose a valid campaign." });
    return;
  }
  const user = request.creatorSignalAuth?.user;
  if (!user) {
    response.status(401).json({ error: "Sign in to open this campaign." });
    return;
  }
  const role = await userOrganizationRole(user.id, parsed.data.organizationId);
  if (!role) {
    response.status(403).json({ error: "You do not have access to that workspace." });
    return;
  }
  try {
    const data = await loadCampaignFromWorkspace(parsed.data);
    if (!data) {
      response.status(404).json({ error: "That campaign was not found." });
      return;
    }
    response.json({
      ...data,
      permissions: {
        role,
        canManage: ["owner", "admin", "marketer"].includes(role),
        canApprove: ["owner", "admin", "approver"].includes(role)
      },
      campaignAgent: {
        configured: hasNvidiaConfig(),
        model: process.env.NVIDIA_MODEL || "z-ai/glm-5.2"
      }
    });
  } catch (error) {
    console.error("Workspace campaign load failed", error instanceof Error ? error.message : error);
    response.status(503).json({ error: "The campaign could not be loaded right now." });
  }
});

app.post("/api/workspace/campaigns/:campaignId/status", async (request, response) => {
  const parsed = CampaignStatusRequest.extend({ campaignId: z.string().uuid() }).safeParse({
    ...request.body,
    campaignId: request.params.campaignId
  });
  if (!parsed.success) {
    response.status(400).json({ error: "Choose a valid campaign stage." });
    return;
  }
  const user = request.creatorSignalAuth?.user;
  if (!user) {
    response.status(401).json({ error: "Sign in to update this campaign." });
    return;
  }
  try {
    await setCampaignStatus({
      organizationId: parsed.data.organizationId,
      campaignId: parsed.data.campaignId,
      userId: user.id,
      status: parsed.data.status
    });
    response.json({ saved: true, status: parsed.data.status });
  } catch (error) {
    sendWorkspaceWorkflowError(response, error, "The campaign stage could not be changed.");
  }
});

app.post("/api/workspace/campaigns/:campaignId/tasks", async (request, response) => {
  const parsed = CampaignTaskRequest.extend({ campaignId: z.string().uuid() }).safeParse({
    ...request.body,
    campaignId: request.params.campaignId
  });
  if (!parsed.success) {
    response.status(400).json({ error: parsed.error.issues[0]?.message || "Enter a valid campaign task." });
    return;
  }
  const user = request.creatorSignalAuth?.user;
  if (!user) {
    response.status(401).json({ error: "Sign in to create campaign tasks." });
    return;
  }
  try {
    await createCampaignTask({
      organizationId: parsed.data.organizationId,
      campaignId: parsed.data.campaignId,
      userId: user.id,
      title: parsed.data.title,
      dueAt: parsed.data.dueAt
    });
    response.status(201).json({ created: true });
  } catch (error) {
    sendWorkspaceWorkflowError(response, error, "The campaign task could not be created.");
  }
});

app.patch("/api/workspace/campaigns/:campaignId/tasks/:taskId", async (request, response) => {
  const parsed = CampaignTaskStatusRequest.extend({
    campaignId: z.string().uuid(),
    taskId: z.string().uuid()
  }).safeParse({
    ...request.body,
    campaignId: request.params.campaignId,
    taskId: request.params.taskId
  });
  if (!parsed.success) {
    response.status(400).json({ error: "Choose a valid task status." });
    return;
  }
  const user = request.creatorSignalAuth?.user;
  if (!user) {
    response.status(401).json({ error: "Sign in to update campaign tasks." });
    return;
  }
  try {
    await setCampaignTaskStatus({
      organizationId: parsed.data.organizationId,
      campaignId: parsed.data.campaignId,
      taskId: parsed.data.taskId,
      userId: user.id,
      status: parsed.data.status
    });
    response.json({ saved: true, status: parsed.data.status });
  } catch (error) {
    sendWorkspaceWorkflowError(response, error, "The campaign task could not be updated.");
  }
});

app.post("/api/workspace/campaigns/:campaignId/outreach-drafts", async (request, response) => {
  const parsed = OutreachDraftGenerateRequest.extend({ campaignId: z.string().uuid() }).safeParse({
    ...request.body,
    campaignId: request.params.campaignId
  });
  if (!parsed.success) {
    response.status(400).json({ error: "Choose a source-backed creator for outreach." });
    return;
  }
  const user = request.creatorSignalAuth?.user;
  if (!user) {
    response.status(401).json({ error: "Sign in to prepare outreach." });
    return;
  }
  if (!await userCanManageOrganization(user.id, parsed.data.organizationId)) {
    response.status(403).json({ error: "A workspace manager role is required." });
    return;
  }
  let providerJob = null;
  try {
    const campaignData = await loadCampaignFromWorkspace({
      organizationId: parsed.data.organizationId,
      campaignId: parsed.data.campaignId
    });
    const entry = campaignData?.shortlist?.entries.find((candidate) => (
      candidate.creator?.id === parsed.data.creatorId && ["saved", "restored"].includes(candidate.decision)
    ));
    const researchRunId = campaignData?.shortlist?.shortlist.researchRunId;
    if (!campaignData || !entry?.creator || !researchRunId) {
      response.status(409).json({ error: "Outreach can only be drafted for an approved creator with saved Bright Data evidence." });
      return;
    }
    if (!await requireWorkspaceProductAccess(request, response, parsed.data.organizationId, researchRunId)) return;
    if (!agentRequestAllowed(request, `${researchRunId}:outreach`)) {
      response.status(429).json({ error: "Outreach drafting is receiving too many requests. Try again in a minute." });
      return;
    }
    const savedResearch = await loadResearchFromWorkspace({
      organizationId: parsed.data.organizationId,
      researchRunId
    });
    if (!savedResearch) {
      response.status(409).json({ error: "The campaign's source research is no longer available." });
      return;
    }
    providerJob = await beginProviderDiagnostic({
      organizationId: parsed.data.organizationId,
      userId: user.id,
      researchRunId,
      provider: "nvidia",
      operation: "outreach_draft",
      model: process.env.NVIDIA_MODEL || "z-ai/glm-5.2",
      metadata: { campaignId: parsed.data.campaignId, creatorId: parsed.data.creatorId }
    });
    upsertResearchSession({
      id: savedResearch.id,
      ownerKey: requestOwnerKey(request),
      input: savedResearch.input,
      productSources: savedResearch.productSources,
      influencers: savedResearch.influencers
    });
    const draft = await draftGroundedOutreach({
      sessionId: savedResearch.id,
      ownerKey: requestOwnerKey(request),
      creator: entry.creator.displayName,
      campaignName: campaignData.campaign.name,
      nvidia: {
        apiKey: process.env.NVIDIA_API_KEY || process.env.NVIDIA_NIM_API_KEY,
        baseUrl: process.env.NVIDIA_BASE_URL || "https://integrate.api.nvidia.com/v1",
        model: process.env.NVIDIA_MODEL || "z-ai/glm-5.2",
        timeoutMs: Number(process.env.NVIDIA_AGENT_TIMEOUT_MS || 60000),
        toolMaxTokens: Number(process.env.NVIDIA_AGENT_TOOL_MAX_TOKENS || 900),
        answerMaxTokens: Number(process.env.NVIDIA_AGENT_ANSWER_MAX_TOKENS || 1000)
      }
    });
    if (draft.status !== "ok" || !draft.citations?.length) {
      await completeProviderDiagnostic({
        job: providerJob,
        status: "degraded",
        sourceCount: draft.citations?.length || 0,
        errorCategory: "grounding_unavailable",
        errorSummary: draft.note || "No valid saved evidence was available for this creator."
      });
      response.status(409).json({ error: "No valid saved evidence was available for this creator." });
      return;
    }
    const sourceReferences = draft.citations.map((citation) => ({
      id: citation.id,
      title: citation.title,
      url: citation.url,
      excerpt: citation.excerpt,
      creatorName: citation.creatorName,
      provider: "bright_data"
    }));
    const savedDraft = await storeOutreachDraft({
      organizationId: parsed.data.organizationId,
      campaignId: parsed.data.campaignId,
      creatorId: parsed.data.creatorId,
      userId: user.id,
      subject: draft.subject,
      body: draft.body,
      sourceReferences
    });
    const savedRecord = Array.isArray(savedDraft) ? savedDraft[0] : savedDraft;
    await completeProviderDiagnostic({
      job: providerJob,
      status: draft.providerUsed ? "complete" : "degraded",
      sourceCount: draft.citations.length,
      errorCategory: draft.providerUsed ? null : "model_fallback",
      errorSummary: draft.providerUsed ? null : draft.note,
      metadata: { campaignId: parsed.data.campaignId, draftId: savedRecord?.id || null }
    });
    response.status(201).json({
      created: true,
      draftId: savedRecord?.id,
      subject: draft.subject,
      body: draft.body,
      sourceReferences,
      providerUsed: draft.providerUsed,
      model: draft.model,
      note: draft.note,
      grounded: true,
      sent: false
    });
  } catch (error) {
    await completeProviderDiagnostic({
      job: providerJob,
      status: "failed",
      sourceCount: 0,
      errorCategory: "request_failed",
      errorSummary: error instanceof Error ? error.message : "Outreach drafting failed."
    });
    sendWorkspaceWorkflowError(response, error, "The source-grounded outreach draft could not be created.");
  }
});

app.patch("/api/workspace/campaigns/:campaignId/outreach-drafts/:draftId", async (request, response) => {
  const parsed = OutreachDraftUpdateRequest.extend({
    campaignId: z.string().uuid(),
    draftId: z.string().uuid()
  }).safeParse({
    ...request.body,
    campaignId: request.params.campaignId,
    draftId: request.params.draftId
  });
  if (!parsed.success) {
    response.status(400).json({ error: parsed.error.issues[0]?.message || "Enter a valid outreach draft." });
    return;
  }
  const user = request.creatorSignalAuth?.user;
  if (!user) {
    response.status(401).json({ error: "Sign in to edit outreach." });
    return;
  }
  try {
    await updateOutreachDraft({
      organizationId: parsed.data.organizationId,
      campaignId: parsed.data.campaignId,
      draftId: parsed.data.draftId,
      userId: user.id,
      subject: parsed.data.subject,
      body: parsed.data.body
    });
    response.json({ saved: true });
  } catch (error) {
    sendWorkspaceWorkflowError(response, error, "The outreach draft could not be edited.");
  }
});

app.post("/api/workspace/campaigns/:campaignId/outreach-drafts/:draftId/transition", async (request, response) => {
  const parsed = OutreachDraftTransitionRequest.extend({
    campaignId: z.string().uuid(),
    draftId: z.string().uuid()
  }).safeParse({
    ...request.body,
    campaignId: request.params.campaignId,
    draftId: request.params.draftId
  });
  if (!parsed.success) {
    response.status(400).json({ error: "Choose a valid outreach approval status." });
    return;
  }
  const user = request.creatorSignalAuth?.user;
  if (!user) {
    response.status(401).json({ error: "Sign in to review outreach." });
    return;
  }
  try {
    await transitionOutreachDraft({
      organizationId: parsed.data.organizationId,
      campaignId: parsed.data.campaignId,
      draftId: parsed.data.draftId,
      userId: user.id,
      status: parsed.data.status
    });
    response.json({ saved: true, status: parsed.data.status });
  } catch (error) {
    sendWorkspaceWorkflowError(response, error, "The outreach approval status could not be changed.");
  }
});

app.get("/api/workspace/research/:researchRunId", async (request, response) => {
  const parsed = z.object({
    researchRunId: z.string().uuid(),
    organizationId: z.string().uuid()
  }).safeParse({
    researchRunId: request.params.researchRunId,
    organizationId: request.query.organizationId
  });
  if (!parsed.success) {
    response.status(400).json({ error: "Choose a valid saved research session." });
    return;
  }
  const user = request.creatorSignalAuth?.user;
  if (!user) {
    response.status(401).json({ error: "Sign in to resume saved research." });
    return;
  }
  if (!workspaceIntegrationStatus().persistenceConfigured) {
    response.status(503).json({ error: "Supabase persistence is not connected in this environment." });
    return;
  }
  if (!await userCanAccessOrganization(user.id, parsed.data.organizationId)) {
    response.status(403).json({ error: "You do not have access to that workspace." });
    return;
  }
  try {
    const saved = await loadResearchFromWorkspace({
      organizationId: parsed.data.organizationId,
      researchRunId: parsed.data.researchRunId
    });
    if (!saved) {
      response.status(404).json({ error: "That saved research session was not found." });
      return;
    }
    const researchSession = upsertResearchSession({
      id: saved.id,
      ownerKey: requestOwnerKey(request),
      input: saved.input,
      productSources: saved.productSources,
      influencers: saved.influencers
    });
    response.json({
      search: saved.input,
      filterState: saved.filterState,
      productBrief: saved.productBrief,
      productSources: saved.productSources,
      influencers: saved.influencers,
      messages: saved.messages,
      researchSession,
      resumed: true
    });
  } catch (error) {
    console.error("Workspace research resume failed", error instanceof Error ? error.message : error);
    response.status(503).json({ error: "Saved research could not be resumed right now." });
  }
});

app.listen(port, "127.0.0.1", () => {
  console.log(`CreatorSignal API listening on http://127.0.0.1:${port}`);
});
