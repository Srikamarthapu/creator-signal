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

function hasBrightDataUnlockerConfig() {
  return Boolean(
    process.env.BRIGHT_DATA_API_KEY &&
      process.env.BRIGHT_DATA_FETCH_URL &&
      process.env.BRIGHT_DATA_UNLOCKER_ZONE
  );
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
  return requestBrightDataSerp(`${product} ${modifiers}`.trim());
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
  return source.source || "Public web";
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

function sourceTypeFromSource(source) {
  const text = `${source.link || ""} ${source.title || ""}`.toLowerCase();
  if (/instagram\.com\/(p|reel)\//.test(text) || /tiktok\.com\/@.+\/video/.test(text) || /youtube\.com\/shorts/.test(text)) return "post";
  if (/instagram\.com\/[^/]+\/?$/.test(text) || /tiktok\.com\/@[^/]+\/?$/.test(text) || /youtube\.com\/@[^/]+/.test(text)) return "profile";
  if (!/(instagram|tiktok|youtube|pinterest)/.test(text)) return "article";
  return "searchResult";
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

function fallbackRealInfluencers(input, sources) {
  return sources
    .filter((source) => source.link)
    .slice(0, 12)
    .map((source, index) => {
      const handle = handleFromSource(source);
      const platform = platformFromSource(source);
      const sourceType = sourceTypeFromSource(source);
      const evidence = sourceEvidence(source, input.product);
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
        matchScore: Math.max(64, 96 - index * 4)
      };
    });
}

async function extractRealInfluencers(input, sources) {
  const fallback = fallbackRealInfluencers(input, sources);
  if (!hasOpenAIConfig() || !fallback.length) {
    return {
      candidates: fallback,
      usedOpenAIAgents: false,
      caveat: "OpenAI extraction unavailable; displayed deterministic Bright Data source extraction."
    };
  }

  try {
    const result = await run(
      realInfluencerExtractionAgent,
      JSON.stringify({
        product: input.product,
        goal: input.goal,
        platform: input.platform,
        audience: input.audience,
        sources,
        guardrail: "Never invent fields that are not visible in the supplied sources."
      }),
      { maxTurns: 3 }
    );
    const parsed = RealInfluencerExtraction.safeParse(result.finalOutput);
    if (!parsed.success) {
      return {
        candidates: fallback,
        usedOpenAIAgents: true,
        caveat: "OpenAI extraction validation failed; displayed deterministic Bright Data source extraction."
      };
    }

    const candidates = parsed.data.candidates
      .filter((candidate) => candidate.sourceUrl)
      .map((candidate, index) => ({
        ...candidate,
        displayName: decodeHtml(candidate.displayName),
        sourceTitle: decodeHtml(candidate.sourceTitle),
        sourceDescription: decodeHtml(candidate.sourceDescription),
        evidence: candidate.evidence.map(decodeHtml),
        matchScore: Math.max(64, 98 - index * 4)
      }));

    return {
      candidates: candidates.length ? candidates : fallback,
      usedOpenAIAgents: true,
      caveat: parsed.data.caveat
    };
  } catch (error) {
    return {
      candidates: fallback,
      usedOpenAIAgents: false,
      caveat: `OpenAI extraction unavailable: ${error instanceof Error ? error.message : "unknown error"}`
    };
  }
}

async function discoverRealInfluencers(input) {
  const platform = input.platform && input.platform !== "Any" ? input.platform : "Instagram TikTok YouTube";
  const queries = [
    `${input.product} ${platform} influencer creator shopping links`,
    `${input.product} ${platform} "comment SHOP" creator`
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
  const extraction = await extractRealInfluencers(input, sources);
  return {
    sources,
    candidates: extraction.candidates,
    usedOpenAIAgents: extraction.usedOpenAIAgents,
    caveat: extraction.caveat,
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
        "Questions about fit, sizing, styling context, and direct shopping links are the strongest local signals.",
        "Office and warm-weather use cases are likely clearer than generic fashion positioning.",
        "Creator evidence should emphasize audience requests for practical styling and repeatable outfits."
      ]
    : hasBeauty
      ? [
          "Questions about routine fit, ingredients, shade or skin-type matching, and visible outcomes are the strongest local signals.",
          "Creator evidence should prioritize educational content and saved/commented product questions.",
          "Offer copy should avoid medical or guaranteed-result language."
        ]
      : hasFitness
        ? [
            "Questions about routine integration, taste or comfort, beginner suitability, and consistency are the strongest local signals.",
            "Creator evidence should prioritize habit-building content and audience requests for practical plans.",
            "Offer copy should avoid health outcome guarantees."
          ]
        : [
            "Audience questions about use case, price, comparison, and purchase links are the strongest local signals.",
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
      "Use copy, save draft, or local campaign planning only."
    ],
    caution: "Product research is public web context. Verify creator availability, rates, and analytics before committing budget."
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
      : `No strong public web enrichment was returned for ${creator.niche.toLowerCase()}; use this only as fallback context.`,
    outreachAngle: `${creator.suggestedAngle || creator.whyMatch}`.slice(0, 180),
    confidence: sourceCount >= 4 ? "Medium" : "Low",
    caveat: "Live sources are public web discovery data. They are not verified creator platform analytics."
  };
}

async function buildAgentBrief(input, brightDataResult) {
  if (!hasOpenAIConfig()) {
    return {
      brief: localProductBrief(input, brightDataResult.sources),
      usedOpenAIAgents: false,
      agentNote: "OPENAI_API_KEY is not configured; returned deterministic local brief."
    };
  }

  try {
    const result = await run(
      productSignalAgent,
      JSON.stringify({
        product: input.product,
        goal: input.goal,
        platform: input.platform,
        audience: input.audience,
        brightDataSources: brightDataResult.sources,
        guardrail:
          "Only summarize product demand context. Do not infer real creator analytics or social scraping."
      }),
      { maxTurns: 3 }
    );

    const parsed = ProductBrief.safeParse(result.finalOutput);
    if (!parsed.success) {
      return {
        brief: localProductBrief(input, brightDataResult.sources),
        usedOpenAIAgents: true,
        agentNote: "OpenAI Agents SDK ran, but output validation failed; returned deterministic local brief."
      };
    }

    return {
      brief: parsed.data,
      usedOpenAIAgents: true,
      agentNote: "OpenAI Agents SDK generated this brief from the supplied product context and Bright Data snippets."
    };
  } catch (error) {
    return {
      brief: localProductBrief(input, brightDataResult.sources),
      usedOpenAIAgents: false,
      agentNote: `OpenAI Agents SDK was unavailable: ${error instanceof Error ? error.message : "unknown error"}`
    };
  }
}

async function buildCreatorResearchBrief(input, creator, sources, scrapedTexts) {
  if (!hasOpenAIConfig()) {
    return {
      brief: localCreatorResearchBrief(input, creator, sources, scrapedTexts),
      usedOpenAIAgents: false,
      agentNote: "OPENAI_API_KEY is not configured; returned deterministic local creator enrichment."
    };
  }

  try {
    const result = await run(
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
    );

    const parsed = CreatorResearchBrief.safeParse(result.finalOutput);
    if (!parsed.success) {
      return {
        brief: localCreatorResearchBrief(input, creator, sources, scrapedTexts),
        usedOpenAIAgents: true,
        agentNote: "OpenAI Agents SDK ran, but creator enrichment validation failed; returned deterministic local enrichment."
      };
    }

    return {
      brief: parsed.data,
      usedOpenAIAgents: true,
      agentNote: "OpenAI Agents SDK summarized Bright Data creator discovery context."
    };
  } catch (error) {
    return {
      brief: localCreatorResearchBrief(input, creator, sources, scrapedTexts),
      usedOpenAIAgents: false,
      agentNote: `OpenAI Agents SDK was unavailable: ${error instanceof Error ? error.message : "unknown error"}`
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
      configured: hasOpenAIConfig(),
      model: process.env.OPENAI_MODEL || "gpt-5.5"
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
      model: process.env.OPENAI_MODEL || "gpt-5.5"
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
      model: process.env.OPENAI_MODEL || "gpt-5.5"
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
