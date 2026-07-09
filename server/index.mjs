import cors from "cors";
import dotenv from "dotenv";
import express from "express";
import { Agent, run } from "@openai/agents";
import { z } from "zod";

dotenv.config({ path: ".env.local", quiet: true });
dotenv.config({ quiet: true });

const app = express();
const port = Number(process.env.API_PORT || 8787);

app.use(cors({ origin: ["http://127.0.0.1:5173", "http://localhost:5173"] }));
app.use(express.json({ limit: "1mb" }));

const ProductIntelligenceRequest = z.object({
  product: z.string().trim().min(1).max(140),
  goal: z.string().trim().max(60).optional(),
  platform: z.string().trim().max(40).optional(),
  audience: z.string().trim().max(60).optional()
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
  const patterns = [
    /Instagram\s*[·|-]\s*([a-zA-Z0-9._]+)/i,
    /TikTok\s*[·|-]\s*@?([a-zA-Z0-9._]+)/i,
    /YouTube\s*[·|-]\s*([a-zA-Z0-9._\s]+)/i,
    /@([a-zA-Z0-9._]{3,})/
  ];
  for (const pattern of patterns) {
    const match = title.match(pattern);
    if (match?.[1]) return match[1].trim().replace(/\s+/g, "");
  }

  try {
    const url = new URL(source.link);
    const parts = url.pathname.split("/").filter(Boolean);
    if (/(instagram|tiktok|youtube)/i.test(url.hostname) && parts[0] && !["p", "reel", "shorts", "watch"].includes(parts[0])) {
      return parts[0].replace(/^@/, "");
    }
  } catch {
    return undefined;
  }
  return undefined;
}

function displayNameFromSource(source, handle) {
  const title = decodeHtml(source.title || "");
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
  return /\b(official store|official site|shop now|add to cart|where to buy|retailer|brand store|product page|specs|specifications|best budget|best gaming mouse|review roundup|buying guide|rtings|amazon|walmart|target)\b/i.test(text);
}

function sourceLooksLikeCreatorCandidate(source) {
  const type = sourceTypeFromSource(source);
  const text = decodeHtml(`${source.source || ""} ${source.link || ""} ${source.title || ""} ${source.description || ""}`);
  if (type === "profile" || type === "post") return true;
  if (/(instagram|tiktok|youtube|pinterest)\.com/i.test(text) && !textLooksLikeNonCreatorPage(text)) return true;
  if (/\b(creator|influencer|ugc creator|content creator)\b/i.test(text) && !textLooksLikeNonCreatorPage(text)) return true;
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
  if (candidate.sourceType === "profile" || candidate.sourceType === "post") return true;
  if (/(instagram|tiktok|youtube|pinterest)\.com/i.test(text) && !textLooksLikeNonCreatorPage(text)) return true;
  if (/\b(creator|influencer|ugc creator|content creator)\b/i.test(text) && !textLooksLikeNonCreatorPage(text)) return true;
  return false;
}

function sourceEvidence(source, product) {
  const text = decodeHtml(`${source.title || ""} ${source.description || ""}`);
  const evidence = [];
  const likes = text.match(/(\d+[kKmM+]*\s*(?:likes|views|subscribers))/i)?.[1];
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
  return [];
}

function productDiscoveryPhrase(product) {
  const normalized = String(product || "").trim();
  const terms = productIntentTerms(normalized);
  const negatives = productNegativeTerms(normalized).map((term) => `-${term.replace(/\s+/g, "-")}`);
  if (/\b(mouse|mice)\b/i.test(normalized)) {
    return [`"${normalized}"`, `"computer mouse"`, `"gaming mouse"`, `"wireless mouse"`, ...negatives].join(" ");
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

function sourceBackedResults(product, sources) {
  return sources
    .map((source) => ({ source, relevanceScore: sourceRelevanceScore(product, source) }))
    .filter((item) => item.relevanceScore >= 2)
    .sort((a, b) => b.relevanceScore - a.relevanceScore)
    .map((item) => item.source);
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
  return sources
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
    .filter((candidate) => displayNameLooksUsable(candidate.displayName));
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
        ? "AI extraction unavailable; displayed rules-based Bright Data source extraction."
        : "Fast mode: displayed Bright Data source extraction immediately. Set REAL_INFLUENCER_AI_MODE=enhance to let the AI provider rerank results."
    };
  }

  try {
    const payload = {
      product: input.product,
      goal: input.goal,
      platform: input.platform,
      audience: input.audience,
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

    const candidates = parsed.data.candidates
      .filter((candidate) => candidate.sourceUrl && displayNameLooksUsable(candidate.displayName) && candidateLooksLikeCreator(candidate) && candidateRelevanceScore(input.product, candidate) >= 2)
      .map((candidate, index) => ({
        ...candidate,
        displayName: decodeHtml(candidate.displayName),
        sourceTitle: decodeHtml(candidate.sourceTitle),
        sourceDescription: decodeHtml(candidate.sourceDescription),
        evidence: candidate.evidence.map(decodeHtml),
        matchScore: Math.min(99, Math.max(64, 78 + candidateRelevanceScore(input.product, candidate) * 3 - index * 2))
      }));

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

async function discoverRealInfluencers(input) {
  const platform = input.platform && input.platform !== "Any" ? input.platform : "Instagram TikTok YouTube";
  const productPhrase = productDiscoveryPhrase(input.product);
  const queries = [
    `${productPhrase} ${platform} creator review shopping links`,
    `${productPhrase} ${platform} "comment SHOP" creator`,
    `${productPhrase} ${platform} influencer product review setup`
  ];
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
  const relevantSources = sourceBackedResults(input.product, sources);
  const creatorSources = relevantSources.filter(sourceLooksLikeCreatorCandidate).slice(0, 8);
  const extraction = await extractRealInfluencers(input, creatorSources);
  return {
    sources: creatorSources,
    candidates: extraction.candidates,
    usedOpenAIAgents: extraction.usedOpenAIAgents,
    caveat: creatorSources.length
      ? extraction.caveat
      : `Bright Data returned ${sources.length} public sources, but none showed enough visible creator evidence for "${input.product}". Try a more specific product phrase.`,
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
    }
  });
});

app.post("/api/product-intelligence", async (request, response) => {
  const parsed = ProductIntelligenceRequest.safeParse(request.body);
  if (!parsed.success) {
    response.status(400).json({
      error: "Enter a product or category to start."
    });
    return;
  }

  const input = parsed.data;
  const brightDataResult = await fetchBrightDataSerp(input).catch((error) => ({
    ok: false,
    sources: [],
    error: error instanceof Error ? error.message : "Bright Data request failed."
  }));
  const agentResult = await buildAgentBrief(input, brightDataResult);

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

app.post("/api/real-influencers", async (request, response) => {
  const parsed = ProductIntelligenceRequest.safeParse(request.body);
  if (!parsed.success) {
    response.status(400).json({
      error: "Enter a product or category to start."
    });
    return;
  }

  const input = parsed.data;
  const discovery = await discoverRealInfluencers(input);
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
    caveat: discovery.caveat,
    disclaimer:
      "These are real public web results discovered via Bright Data. Metrics are shown only when visible in source text; no private analytics or contact data is inferred."
  });
});

app.listen(port, "127.0.0.1", () => {
  console.log(`CreatorSignal API listening on http://127.0.0.1:${port}`);
});
