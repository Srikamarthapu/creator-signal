import {
  AlertTriangle,
  BarChart3,
  Check,
  CircleDollarSign,
  Copy,
  ExternalLink,
  Loader2,
  Mail,
  RefreshCcw,
  Search,
  ShieldCheck,
  SlidersHorizontal,
} from "lucide-react";
import { FormEvent, useEffect, useMemo, useState } from "react";
import { readLocal, storageKeys, writeLocal } from "./lib/storage";
import type {
  CampaignRisk,
  IntegrationStatus,
  Platform,
  ProductIntelligence,
  RealInfluencer,
  RealInfluencerResponse,
  SearchState
} from "./lib/types";

const goals = ["Sales", "Awareness", "UGC", "Product launch"];
const budgets = ["Under $1k", "$1k to $5k", "$5k to $20k", "$20k plus"];
const platforms: Array<Platform | "Any"> = ["Any", "TikTok", "Instagram", "YouTube"];
const audiences = ["Gen Z", "Millennial", "Premium", "Budget"];
type RealSortMode = "match" | "cost" | "risk" | "evidence";
type RealIntentFilter = "Any" | "Shopping intent" | "Review/demo" | "Creator/UGC" | "Direct product fit";
type RealQualityFilter = "Any" | "High confidence" | "Social source" | "Profile source" | "Article/list";
type RealCostFilter = "Any" | "Lower" | "Medium" | "Higher";
const evidenceLabels = {
  profile: "Creator profile",
  post: "Creator post",
  article: "Article or list",
  searchResult: "Search result"
} satisfies Record<RealInfluencer["sourceType"], string>;
const avatarSizeClass = {
  small: "avatar-small",
  default: "avatar-default",
  large: "avatar-large"
} satisfies Record<"small" | "default" | "large", string>;

const defaultSearch: SearchState = {
  product: "",
  goal: "Sales",
  budget: "$1k to $5k",
  platform: "Instagram",
  audience: "Millennial"
};

function readStoredSearch() {
  const saved = readLocal<SearchState>(storageKeys.lastSearch, defaultSearch);
  return {
    ...defaultSearch,
    ...saved,
    product: saved.product?.trim() || defaultSearch.product
  };
}

function pathFromWindow() {
  return window.location.pathname;
}

function initials(name: string) {
  return name
    .split(" ")
    .map((part) => part[0])
    .join("")
    .replace(".", "")
    .slice(0, 2)
    .toUpperCase();
}

function riskTone(value: CampaignRisk) {
  if (value === "Low") return "tone-good";
  if (value === "Medium") return "tone-watch";
  return "tone-risk";
}

function riskOrder(value: CampaignRisk) {
  if (value === "Low") return 0;
  if (value === "Medium") return 1;
  return 2;
}

function confidenceOrder(value: RealInfluencer["confidence"]) {
  if (value === "High") return 0;
  if (value === "Medium") return 1;
  return 2;
}

function sourceTypeOrder(value: RealInfluencer["sourceType"]) {
  if (value === "profile") return 0;
  if (value === "post") return 1;
  if (value === "searchResult") return 2;
  return 3;
}

function realInfluencerEvidenceLabel(value: RealInfluencer["sourceType"]) {
  return evidenceLabels[value];
}

function realInfluencerRisk(influencer: RealInfluencer): CampaignRisk {
  if (influencer.confidence === "Low" || influencer.sourceType === "article") return "High";
  if (influencer.confidence === "High" && (influencer.sourceType === "profile" || influencer.sourceType === "post")) return "Low";
  return "Medium";
}

function realInfluencerCostRank(influencer: RealInfluencer) {
  const platform = influencer.platform.toLowerCase();
  if (platform.includes("youtube")) return 3;
  if (platform.includes("instagram")) return influencer.sourceType === "profile" ? 3 : 2;
  if (platform.includes("tiktok")) return influencer.sourceType === "profile" ? 2 : 1;
  return 1;
}

function realInfluencerCostTier(influencer: RealInfluencer) {
  const rank = realInfluencerCostRank(influencer);
  if (rank >= 3) return "Higher";
  if (rank === 2) return "Medium";
  return "Lower";
}

function realInfluencerText(influencer: RealInfluencer) {
  return [
    influencer.displayName,
    influencer.handle,
    influencer.platform,
    influencer.sourceUrl,
    influencer.sourceTitle,
    influencer.sourceDescription,
    influencer.niche,
    influencer.matchReason,
    ...influencer.evidence
  ]
    .filter(Boolean)
    .join(" ")
    .toLowerCase();
}

function productKeywords(product: string) {
  return product
    .toLowerCase()
    .split(/[^a-z0-9]+/)
    .map((word) => word.trim())
    .filter((word) => word.length >= 3 && !["the", "and", "for", "with"].includes(word));
}

function hasDirectProductFit(influencer: RealInfluencer, product: string) {
  const text = realInfluencerText(influencer);
  const keywords = productKeywords(product);
  return keywords.length ? keywords.some((keyword) => text.includes(keyword)) : true;
}

function realInfluencerBuyerSignals(influencer: RealInfluencer, product: string) {
  const text = realInfluencerText(influencer);
  const signals = [];
  if (/\b(shop|shopping|link in bio|comment shop|ltk|affiliate|amazon|storefront|buy|gift guide)\b/i.test(text)) signals.push("Shopping intent");
  if (/\b(review|setup|haul|unboxing|demo|try on|routine|comparison|before and after)\b/i.test(text)) signals.push("Review/demo");
  if (/\b(creator|influencer|ugc|content creator|collab|sponsored)\b/i.test(text)) signals.push("Creator/UGC");
  if (hasDirectProductFit(influencer, product)) signals.push("Direct product fit");
  return [...new Set(signals)];
}

function realInfluencerMatchesIntent(influencer: RealInfluencer, product: string, filter: RealIntentFilter) {
  return filter === "Any" || realInfluencerBuyerSignals(influencer, product).includes(filter);
}

function realInfluencerMatchesQuality(influencer: RealInfluencer, filter: RealQualityFilter) {
  if (filter === "Any") return true;
  if (filter === "High confidence") return influencer.confidence === "High";
  if (filter === "Social source") return influencer.sourceType === "profile" || influencer.sourceType === "post";
  if (filter === "Profile source") return influencer.sourceType === "profile";
  return influencer.sourceType === "article";
}

export default function App() {
  const [path, setPath] = useState(pathFromWindow);
  const [searchState, setSearchState] = useState<SearchState>(readStoredSearch);
  const [formState, setFormState] = useState<SearchState>(readStoredSearch);
  const [validationError, setValidationError] = useState("");
  const [saveMessage, setSaveMessage] = useState("");
  const [sortMode, setSortMode] = useState<RealSortMode>("match");
  const [riskFilter, setRiskFilter] = useState<CampaignRisk | "Any">("Any");
  const [platformFilter, setPlatformFilter] = useState("Any");
  const [intentFilter, setIntentFilter] = useState<RealIntentFilter>("Any");
  const [qualityFilter, setQualityFilter] = useState<RealQualityFilter>("Any");
  const [costFilter, setCostFilter] = useState<RealCostFilter>("Any");
  const [integrationStatus, setIntegrationStatus] = useState<IntegrationStatus | null>(null);
  const [intelligence, setIntelligence] = useState<ProductIntelligence | null>(null);
  const [intelligenceLoading, setIntelligenceLoading] = useState(false);
  const [intelligenceError, setIntelligenceError] = useState("");
  const [realInfluencers, setRealInfluencers] = useState<RealInfluencer[]>([]);
  const [realInfluencersLoading, setRealInfluencersLoading] = useState(false);
  const [realInfluencersError, setRealInfluencersError] = useState("");
  const [realInfluencerMeta, setRealInfluencerMeta] = useState<RealInfluencerResponse | null>(null);
  const [realOutreachInfluencer, setRealOutreachInfluencer] = useState<RealInfluencer | null>(null);

  useEffect(() => {
    const onPopState = () => setPath(pathFromWindow());
    window.addEventListener("popstate", onPopState);
    return () => window.removeEventListener("popstate", onPopState);
  }, []);

  useEffect(() => {
    fetch("/api/integrations/status")
      .then((response) => response.json())
      .then((data: IntegrationStatus) => setIntegrationStatus(data))
      .catch(() => setIntegrationStatus(null));
  }, []);

  const persist = <T,>(key: string, value: T) => {
    const result = writeLocal(key, value);
    if (!result.ok) setSaveMessage(result.message);
  };

  const navigate = (nextPath: string) => {
    window.history.pushState({}, "", nextPath);
    setPath(nextPath);
    window.scrollTo({ top: 0, behavior: "smooth" });
  };

  const requestIntelligence = async (nextSearch: SearchState) => {
    setIntelligenceLoading(true);
    setIntelligenceError("");
    setIntelligence(null);
    try {
      const response = await fetch("/api/product-intelligence", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          product: nextSearch.product,
          goal: nextSearch.goal,
          platform: nextSearch.platform === "Any" ? undefined : nextSearch.platform,
          audience: nextSearch.audience
        })
      });
      if (!response.ok) throw new Error("Product intelligence request failed.");
      const data = (await response.json()) as ProductIntelligence;
      setIntelligence(data);
    } catch (error) {
      setIntelligenceError(error instanceof Error ? error.message : "Product intelligence request failed.");
    } finally {
      setIntelligenceLoading(false);
    }
  };

  const requestRealInfluencers = async (nextSearch: SearchState) => {
    setRealInfluencersLoading(true);
    setRealInfluencersError("");
    setRealInfluencers([]);
    setRealInfluencerMeta(null);
    try {
      const response = await fetch("/api/real-influencers", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          product: nextSearch.product,
          goal: nextSearch.goal,
          platform: nextSearch.platform === "Any" ? undefined : nextSearch.platform,
          audience: nextSearch.audience
        })
      });
      if (!response.ok) throw new Error("Real influencer discovery request failed.");
      const data = (await response.json()) as RealInfluencerResponse;
      setRealInfluencers(data.influencers);
      setRealInfluencerMeta(data);
    } catch (error) {
      setRealInfluencersError(error instanceof Error ? error.message : "Real influencer discovery request failed.");
    } finally {
      setRealInfluencersLoading(false);
    }
  };

  const submitSearch = (event: FormEvent) => {
    event.preventDefault();
    if (!formState.product.trim()) {
      setValidationError("Enter a product or category to start.");
      return;
    }
    const nextSearch = { ...formState, product: formState.product.trim() };
    setValidationError("");
    setSortMode("match");
    setRiskFilter("Any");
    setPlatformFilter("Any");
    setIntentFilter("Any");
    setQualityFilter("Any");
    setCostFilter("Any");
    setSearchState(nextSearch);
    persist(storageKeys.lastSearch, nextSearch);
    navigate("/results");
    void requestRealInfluencers(nextSearch);
    void requestIntelligence(nextSearch);
  };

  const localWorkflowPath = path.startsWith("/creator/") || path === "/shortlist" || path === "/campaigns" || path.startsWith("/campaign/");

  useEffect(() => {
    if (path !== "/results" || !searchState.product.trim()) return;
    if (realInfluencers.length || realInfluencersLoading || realInfluencerMeta || realInfluencersError) return;
    void requestRealInfluencers(searchState);
    void requestIntelligence(searchState);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [path, searchState.product, searchState.goal, searchState.platform, searchState.audience]);

  return (
    <div className="min-h-dvh bg-mist text-ink">
      <TopNav path={path} navigate={navigate} />
      <main className="mx-auto flex w-full max-w-7xl flex-col gap-6 px-4 py-6 sm:px-6 lg:px-8">
        {saveMessage ? (
          <div className="notice" role="status" aria-live="polite">
            <Check className="h-4 w-4" />
            <span>{saveMessage}</span>
          </div>
        ) : null}

        {path === "/" ? (
          <SearchScreen
            formState={formState}
            setFormState={setFormState}
            validationError={validationError}
            submitSearch={submitSearch}
            integrationStatus={integrationStatus}
          />
        ) : null}

        {path === "/results" ? (
          <ResultsScreen
            searchState={searchState}
            formState={formState}
            setFormState={setFormState}
            submitSearch={submitSearch}
            validationError={validationError}
            sortMode={sortMode}
            setSortMode={setSortMode}
            riskFilter={riskFilter}
            setRiskFilter={setRiskFilter}
            platformFilter={platformFilter}
            setPlatformFilter={setPlatformFilter}
            intentFilter={intentFilter}
            setIntentFilter={setIntentFilter}
            qualityFilter={qualityFilter}
            setQualityFilter={setQualityFilter}
            costFilter={costFilter}
            setCostFilter={setCostFilter}
            intelligence={intelligence}
            intelligenceLoading={intelligenceLoading}
            intelligenceError={intelligenceError}
            refreshIntelligence={() => requestIntelligence(searchState)}
            realInfluencers={realInfluencers}
            realInfluencersLoading={realInfluencersLoading}
            realInfluencersError={realInfluencersError}
            realInfluencerMeta={realInfluencerMeta}
            refreshRealInfluencers={() => requestRealInfluencers(searchState)}
            openRealOutreach={(influencer) => setRealOutreachInfluencer(influencer)}
          />
        ) : null}

        {localWorkflowPath ? (
          <LocalWorkflowRemoved navigate={navigate} />
        ) : null}
      </main>

      {realOutreachInfluencer ? (
        <RealOutreachDrawer
          influencer={realOutreachInfluencer}
          product={searchState.product || formState.product || "your product"}
          close={() => setRealOutreachInfluencer(null)}
        />
      ) : null}
    </div>
  );
}

function TopNav({
  path,
  navigate
}: {
  path: string;
  navigate: (path: string) => void;
}) {
  const searchActive = path === "/" || path === "/results" || path.startsWith("/creator/");
  return (
    <header className="sticky top-0 z-30 border-b border-line bg-mist/85 backdrop-blur-xl">
      <div className="mx-auto grid h-20 max-w-7xl grid-cols-[1fr_auto_1fr] items-center gap-4 px-4 sm:px-6 lg:px-8">
        <div className="justify-self-start">
          <button className={`nav-button nav-button-quiet ${searchActive ? "nav-button-active" : ""}`} onClick={() => navigate("/")} aria-label="Start a creator search">
            <Search className="h-4 w-4" />
            <span>Search</span>
          </button>
        </div>
        <button className="brand" onClick={() => navigate("/")} aria-label="Go to CreatorSignal search">
          <span className="brand-mark">CS</span>
          <span>CreatorSignal</span>
        </button>
        <div className="justify-self-end" aria-hidden="true" />
      </div>
    </header>
  );
}

function SearchScreen({
  formState,
  setFormState,
  validationError,
  submitSearch,
  integrationStatus
}: {
  formState: SearchState;
  setFormState: (next: SearchState) => void;
  validationError: string;
  submitSearch: (event: FormEvent) => void;
  integrationStatus: IntegrationStatus | null;
}) {
  return (
    <section className="showcase-grid">
      <div className="hero-panel">
        <div className="hero-copy">
          <p className="eyebrow">Audience demand search</p>
          <h1>Find creators with audiences already leaning toward your product.</h1>
          <p>
            Rank creator fit, source public evidence, build a shortlist, and move into outreach from one calm workspace.
          </p>
        </div>

        <form className="creator-command" onSubmit={submitSearch}>
          <label className="field-label" htmlFor="product-search">
            Product or category
          </label>
          <div className="search-row">
            <Search className="h-5 w-5 text-muted" aria-hidden="true" />
            <input
              id="product-search"
              value={formState.product}
              onChange={(event) => setFormState({ ...formState, product: event.target.value })}
              placeholder="petite linen blazer"
              className="search-input"
              aria-describedby={validationError ? "search-error" : undefined}
            />
            <button className="primary-button shrink-0" type="submit">
              <Search className="h-4 w-4" />
              Find creators
            </button>
          </div>
          {validationError ? (
            <p id="search-error" className="error-text" role="alert">
              {validationError}
            </p>
          ) : null}

          <div className="control-grid">
            <SegmentedControl label="Goal" value={formState.goal} options={goals} onChange={(goal) => setFormState({ ...formState, goal })} />
            <SegmentedControl label="Budget" value={formState.budget} options={budgets} onChange={(budget) => setFormState({ ...formState, budget })} />
            <SegmentedControl
              label="Platform"
              value={formState.platform}
              options={platforms}
              onChange={(platform) => setFormState({ ...formState, platform: platform as Platform | "Any" })}
            />
            <SegmentedControl
              label="Audience"
              value={formState.audience}
              options={audiences}
              onChange={(audience) => setFormState({ ...formState, audience })}
            />
          </div>
        </form>

        <div className="source-promise-grid" aria-label="Real creator discovery workflow">
          {[
            ["Bright Data", "Searches live public web results for creator evidence."],
            ["Source links", "Every creator card must trace back to a visible public result."],
            ["AI structuring", "NVIDIA NIM formats source-backed candidates when available."],
            ["Real-only results", "Seeded demo profiles are excluded from discovery."]
          ].map(([label, description]) => (
            <div className="source-promise-card" key={label}>
              <span className="status-light status-light-on" />
              <div>
                <strong>{label}</strong>
                <p>{description}</p>
              </div>
            </div>
          ))}
        </div>
      </div>

      <aside className="preview-rail">
        <IntegrationPanel status={integrationStatus} />
        <div className="surface p-5">
          <h2 className="section-title">Real-Only Discovery</h2>
          <div className="mt-5 grid gap-3">
            {[
              ["Live", "Bright Data source search"],
              ["Real", "Public creator evidence"],
              ["Clean", "Seeded demo profiles excluded"]
            ].map(([value, label]) => (
              <div className="stat-row" key={label}>
                <strong>{value}</strong>
                <span>{label}</span>
              </div>
            ))}
          </div>
        </div>
      </aside>
    </section>
  );
}

function ResultsScreen({
  searchState,
  formState,
  setFormState,
  submitSearch,
  validationError,
  sortMode,
  setSortMode,
  riskFilter,
  setRiskFilter,
  platformFilter,
  setPlatformFilter,
  intentFilter,
  setIntentFilter,
  qualityFilter,
  setQualityFilter,
  costFilter,
  setCostFilter,
  intelligence,
  intelligenceLoading,
  intelligenceError,
  refreshIntelligence,
  realInfluencers,
  realInfluencersLoading,
  realInfluencersError,
  realInfluencerMeta,
  refreshRealInfluencers,
  openRealOutreach
}: {
  searchState: SearchState;
  formState: SearchState;
  setFormState: (next: SearchState) => void;
  submitSearch: (event: FormEvent) => void;
  validationError: string;
  sortMode: RealSortMode;
  setSortMode: (mode: RealSortMode) => void;
  riskFilter: CampaignRisk | "Any";
  setRiskFilter: (risk: CampaignRisk | "Any") => void;
  platformFilter: string;
  setPlatformFilter: (platform: string) => void;
  intentFilter: RealIntentFilter;
  setIntentFilter: (intent: RealIntentFilter) => void;
  qualityFilter: RealQualityFilter;
  setQualityFilter: (quality: RealQualityFilter) => void;
  costFilter: RealCostFilter;
  setCostFilter: (cost: RealCostFilter) => void;
  intelligence: ProductIntelligence | null;
  intelligenceLoading: boolean;
  intelligenceError: string;
  refreshIntelligence: () => void;
  realInfluencers: RealInfluencer[];
  realInfluencersLoading: boolean;
  realInfluencersError: string;
  realInfluencerMeta: RealInfluencerResponse | null;
  refreshRealInfluencers: () => void;
  openRealOutreach: (influencer: RealInfluencer) => void;
}) {
  const [filtersOpen, setFiltersOpen] = useState(false);
  const showRealResults = realInfluencers.length > 0;
  const product = searchState.product || formState.product || "";
  const countMatching = (predicate: (influencer: RealInfluencer) => boolean) => realInfluencers.filter(predicate).length;
  const platformOptions = useMemo(() => {
    const values = [...new Set(realInfluencers.map((influencer) => influencer.platform).filter(Boolean))].sort();
    return [
      { label: "All", value: "Any", count: realInfluencers.length },
      ...values.map((platform) => ({
        label: platform,
        value: platform,
        count: realInfluencers.filter((influencer) => influencer.platform === platform).length
      }))
    ];
  }, [realInfluencers]);
  const intentOptions = useMemo<Array<{ label: string; value: RealIntentFilter; count: number }>>(() => {
    return [
      { label: "All", value: "Any", count: realInfluencers.length },
      { label: "Shopping intent", value: "Shopping intent", count: countMatching((influencer) => realInfluencerMatchesIntent(influencer, product, "Shopping intent")) },
      { label: "Review/demo", value: "Review/demo", count: countMatching((influencer) => realInfluencerMatchesIntent(influencer, product, "Review/demo")) },
      { label: "Creator/UGC", value: "Creator/UGC", count: countMatching((influencer) => realInfluencerMatchesIntent(influencer, product, "Creator/UGC")) },
      { label: "Product fit", value: "Direct product fit", count: countMatching((influencer) => realInfluencerMatchesIntent(influencer, product, "Direct product fit")) }
    ];
  }, [product, realInfluencers]);
  const qualityOptions = useMemo<Array<{ label: string; value: RealQualityFilter; count: number }>>(() => [
    { label: "All", value: "Any", count: realInfluencers.length },
    { label: "High confidence", value: "High confidence", count: countMatching((influencer) => realInfluencerMatchesQuality(influencer, "High confidence")) },
    { label: "Social source", value: "Social source", count: countMatching((influencer) => realInfluencerMatchesQuality(influencer, "Social source")) },
    { label: "Profile", value: "Profile source", count: countMatching((influencer) => realInfluencerMatchesQuality(influencer, "Profile source")) },
    { label: "Article/list", value: "Article/list", count: countMatching((influencer) => realInfluencerMatchesQuality(influencer, "Article/list")) }
  ], [realInfluencers]);
  const costOptions = useMemo<Array<{ label: string; value: RealCostFilter; count: number }>>(() => [
    { label: "All", value: "Any", count: realInfluencers.length },
    { label: "Lower", value: "Lower", count: countMatching((influencer) => realInfluencerCostTier(influencer) === "Lower") },
    { label: "Medium", value: "Medium", count: countMatching((influencer) => realInfluencerCostTier(influencer) === "Medium") },
    { label: "Higher", value: "Higher", count: countMatching((influencer) => realInfluencerCostTier(influencer) === "Higher") }
  ], [realInfluencers]);
  const riskOptions = useMemo<Array<{ label: string; value: CampaignRisk | "Any"; count: number }>>(() => [
    { label: "All", value: "Any", count: realInfluencers.length },
    { label: "Low", value: "Low", count: countMatching((influencer) => realInfluencerRisk(influencer) === "Low") },
    { label: "Medium", value: "Medium", count: countMatching((influencer) => realInfluencerRisk(influencer) === "Medium") },
    { label: "High", value: "High", count: countMatching((influencer) => realInfluencerRisk(influencer) === "High") }
  ], [realInfluencers]);
  const filteredRealInfluencers = realInfluencers
    .filter((influencer) => platformFilter === "Any" || influencer.platform === platformFilter)
    .filter((influencer) => realInfluencerMatchesIntent(influencer, product, intentFilter))
    .filter((influencer) => realInfluencerMatchesQuality(influencer, qualityFilter))
    .filter((influencer) => costFilter === "Any" || realInfluencerCostTier(influencer) === costFilter)
    .filter((influencer) => riskFilter === "Any" || realInfluencerRisk(influencer) === riskFilter)
    .sort((a, b) => {
      if (sortMode === "cost") return realInfluencerCostRank(a) - realInfluencerCostRank(b);
      if (sortMode === "risk") return riskOrder(realInfluencerRisk(a)) - riskOrder(realInfluencerRisk(b));
      if (sortMode === "evidence") {
        return confidenceOrder(a.confidence) - confidenceOrder(b.confidence) || sourceTypeOrder(a.sourceType) - sourceTypeOrder(b.sourceType) || b.matchScore - a.matchScore;
      }
      return b.matchScore - a.matchScore;
    });
  const activeFilterLabels = [
    sortMode !== "match" ? `Sorted by ${sortMode === "cost" ? "lowest cost" : sortMode === "risk" ? "lowest risk" : "strongest evidence"}` : "",
    platformFilter !== "Any" ? `Platform: ${platformFilter}` : "",
    intentFilter !== "Any" ? `Intent: ${intentFilter}` : "",
    qualityFilter !== "Any" ? `Quality: ${qualityFilter}` : "",
    costFilter !== "Any" ? `Cost: ${costFilter}` : "",
    riskFilter !== "Any" ? `Risk: ${riskFilter}` : ""
  ].filter(Boolean);
  const hasActiveRealFilters = activeFilterLabels.length > 0;
  const activeMenuFilterCount = [platformFilter, intentFilter, qualityFilter, costFilter, riskFilter].filter((value) => value !== "Any").length;
  const resetRealFilters = () => {
    setSortMode("match");
    setRiskFilter("Any");
    setPlatformFilter("Any");
    setIntentFilter("Any");
    setQualityFilter("Any");
    setCostFilter("Any");
  };
  return (
    <section className="results-grid">
      <div className="flex flex-col gap-4">
        <div className="surface p-5">
          <div className="flex flex-col gap-4 lg:flex-row lg:items-end lg:justify-between">
            <div>
              <p className="eyebrow">Ranked creator results</p>
              <h1 className="mt-2 text-3xl font-semibold">Search results for "{searchState.product || "your product"}"</h1>
              <p className="mt-2 text-sm text-muted">
                {searchState.goal} / {searchState.budget} / {searchState.platform}
              </p>
            </div>
            <form className="mini-search" onSubmit={submitSearch}>
              <input
                value={formState.product}
                onChange={(event) => setFormState({ ...formState, product: event.target.value })}
                aria-label="Search another product"
              />
              <button className="secondary-button" type="submit">
                <Search className="h-4 w-4" />
                Search
              </button>
            </form>
          </div>
          {validationError ? <p className="error-text mt-3">{validationError}</p> : null}
          <div className="toolbar-strip mt-5">
            <FilterSelect
              icon={<SlidersHorizontal className="h-4 w-4" />}
              label="Prioritize"
              value={sortMode}
              options={[
                { label: "Best match", value: "match" },
                { label: "Lowest cost", value: "cost" },
                { label: "Lowest risk", value: "risk" },
                { label: "Strongest evidence", value: "evidence" }
              ]}
              onChange={(value) => setSortMode(value as RealSortMode)}
            />
            <button className="secondary-button" type="button" onClick={refreshRealInfluencers} disabled={realInfluencersLoading}>
              {realInfluencersLoading ? <Loader2 className="h-4 w-4 animate-spin" /> : <Search className="h-4 w-4" />}
              Find real influencers
            </button>
            {showRealResults ? (
              <button
                className={`secondary-button filter-toggle-button ${filtersOpen ? "filter-toggle-button-active" : ""}`}
                type="button"
                aria-expanded={filtersOpen}
                aria-controls="creator-filter-menu"
                onClick={() => setFiltersOpen((open) => !open)}
              >
                <SlidersHorizontal className="h-4 w-4" />
                {filtersOpen ? "Hide filters" : "Filters"}
                {activeMenuFilterCount ? <span className="nav-count">{activeMenuFilterCount}</span> : null}
              </button>
            ) : null}
            {hasActiveRealFilters ? (
              <button
                className="ghost-button"
                type="button"
                onClick={resetRealFilters}
              >
                Reset filters
              </button>
            ) : null}
          </div>
          {showRealResults && (filtersOpen || hasActiveRealFilters) ? (
            <div className="filter-panel mt-4">
              <div className="filter-panel-header">
                <div>
                  <p className="eyebrow">Filter menu</p>
                  <h2>{filtersOpen ? "Refine the creator list" : "Applied filters"}</h2>
                </div>
                <div className="filter-impact" aria-live="polite">
                  <span>
                    <strong>{filteredRealInfluencers.length}</strong>
                    visible
                  </span>
                  <span>
                    <strong>{Math.max(0, realInfluencers.length - filteredRealInfluencers.length)}</strong>
                    hidden
                  </span>
                </div>
              </div>
              {filtersOpen ? (
                <div id="creator-filter-menu" className="filter-menu-grid">
                  <FilterSelect
                  icon={<ExternalLink className="h-4 w-4" />}
                  label="Platform"
                  value={platformFilter}
                  options={platformOptions.map((option) => ({ label: `${option.label} (${option.count})`, value: option.value }))}
                  onChange={setPlatformFilter}
                />
                  <FilterSelect
                  icon={<BarChart3 className="h-4 w-4" />}
                  label="Buyer intent"
                  value={intentFilter}
                  options={intentOptions.map((option) => ({ label: `${option.label} (${option.count})`, value: option.value }))}
                  onChange={(value) => setIntentFilter(value as RealIntentFilter)}
                />
                  <FilterSelect
                  icon={<ShieldCheck className="h-4 w-4" />}
                  label="Source quality"
                  value={qualityFilter}
                  options={qualityOptions.map((option) => ({ label: `${option.label} (${option.count})`, value: option.value }))}
                  onChange={(value) => setQualityFilter(value as RealQualityFilter)}
                />
                  <FilterSelect
                  icon={<CircleDollarSign className="h-4 w-4" />}
                  label="Estimated cost"
                  value={costFilter}
                  options={costOptions.map((option) => ({ label: `${option.label} (${option.count})`, value: option.value }))}
                  onChange={(value) => setCostFilter(value as RealCostFilter)}
                />
                  <FilterSelect
                  icon={<AlertTriangle className="h-4 w-4" />}
                  label="Campaign risk"
                  value={riskFilter}
                  options={riskOptions.map((option) => ({ label: `${option.label} (${option.count})`, value: option.value }))}
                  onChange={(value) => setRiskFilter(value as CampaignRisk | "Any")}
                />
                </div>
              ) : null}
              {activeFilterLabels.length ? (
                <div className="active-filter-row" aria-label="Active filters">
                  {activeFilterLabels.map((label) => (
                    <span className="active-filter-chip" key={label}>
                      {label}
                    </span>
                  ))}
                </div>
              ) : (
                <p className="mt-3 text-sm text-muted">
                  Use filters to narrow by channel, buying signal, source quality, expected cost, and campaign risk.
                </p>
              )}
            </div>
          ) : null}
          {showRealResults ? (
            <p className="mt-3 text-sm text-muted">
              Showing {filteredRealInfluencers.length} of {realInfluencers.length} source-backed creators.
            </p>
          ) : null}
          {realInfluencersError ? (
            <p className="mt-3 flex items-center gap-2 text-sm font-medium text-caution">
              <AlertTriangle className="h-4 w-4" />
              {realInfluencersError}
            </p>
          ) : null}
        </div>

        {realInfluencersLoading && !showRealResults ? (
          <div className="creator-card" aria-live="polite">
            <div className="flex items-center gap-3">
              <Loader2 className="h-5 w-5 animate-spin text-signal-700" />
              <div>
                <h2 className="text-lg font-semibold">Finding real public influencer results</h2>
                <p className="mt-1 text-sm text-muted">Bright Data is searching public web results and the configured AI provider is structuring source-backed candidates.</p>
              </div>
            </div>
            <div className="mt-5 space-y-3">
              <div className="skeleton h-4 w-3/4" />
              <div className="skeleton h-4 w-full" />
              <div className="skeleton h-4 w-2/3" />
            </div>
          </div>
        ) : null}

        {!realInfluencersLoading && showRealResults ? (
          <>
            <RealResultsBanner meta={realInfluencerMeta} />
            {filteredRealInfluencers.length ? (
              filteredRealInfluencers.map((influencer) => (
                <RealInfluencerCard
                  key={`${influencer.sourceUrl}-${influencer.displayName}`}
                  influencer={influencer}
                  product={product}
                  openRealOutreach={openRealOutreach}
                />
              ))
            ) : (
              <FilteredRealResultsState resetRealFilters={resetRealFilters} />
            )}
          </>
        ) : !realInfluencersLoading && searchState.product.trim() ? (
          <NoRealResultsState product={searchState.product} refreshRealInfluencers={refreshRealInfluencers} />
        ) : !realInfluencersLoading ? (
          <EmptyState />
        ) : null}
      </div>

      <ProductIntelligencePanel
        intelligence={intelligence}
        loading={intelligenceLoading}
        error={intelligenceError}
        refresh={refreshIntelligence}
      />
    </section>
  );
}

function RealResultsBanner({ meta }: { meta: RealInfluencerResponse | null }) {
  return (
    <div className="rounded-lg border border-signal-100 bg-signal-50 p-4 text-sm text-signal-900">
      <div className="flex flex-col gap-2 sm:flex-row sm:items-center sm:justify-between">
        <div>
          <p className="font-semibold">Real public influencer results</p>
          <p className="mt-1 text-signal-700">
            Bright Data discovered {meta?.brightData.sourceCount ?? 0} public source results. The configured AI provider structured source-backed candidates.
          </p>
        </div>
        <span className="live-pill live-pill-agent">{meta?.openaiAgents.used ? "AI structured" : "Rules-based extraction"}</span>
      </div>
      {meta?.caveat ? <p className="mt-3 text-xs leading-5 text-signal-700">{meta.caveat}</p> : null}
      <p className="mt-3 text-xs leading-5 text-signal-700">
        {meta?.disclaimer || "Displayed names and handles come from public search results. No private analytics or contact data is inferred."}
      </p>
    </div>
  );
}

function NoRealResultsState({
  product,
  refreshRealInfluencers
}: {
  product: string;
  refreshRealInfluencers: () => void;
}) {
  return (
    <div className="surface p-8 text-center">
      <Search className="mx-auto h-8 w-8 text-muted" />
      <h2 className="mt-4 text-xl font-semibold">No source-backed influencer results yet.</h2>
      <p className="mx-auto mt-2 max-w-xl text-muted">
        Bright Data did not return usable public creator candidates for "{product}" in this run.
      </p>
      <button className="secondary-button mx-auto mt-5" onClick={refreshRealInfluencers}>
        <RefreshCcw className="h-4 w-4" />
        Retry public search
      </button>
    </div>
  );
}

function FilteredRealResultsState({ resetRealFilters }: { resetRealFilters: () => void }) {
  return (
    <div className="surface p-8 text-center">
      <SlidersHorizontal className="mx-auto h-8 w-8 text-muted" />
      <h2 className="mt-4 text-xl font-semibold">No creator results match these filters.</h2>
      <p className="mx-auto mt-2 max-w-xl text-muted">
        Adjust platform, buyer intent, source quality, cost, or campaign risk to review the remaining source-backed results.
      </p>
      <button className="secondary-button mx-auto mt-5" type="button" onClick={resetRealFilters}>
        Reset filters
      </button>
    </div>
  );
}

function LocalWorkflowRemoved({ navigate }: { navigate: (path: string) => void }) {
  return (
    <div className="surface p-8 text-center">
      <ShieldCheck className="mx-auto h-9 w-9 text-signal-700" />
      <h1 className="mt-4 text-2xl font-semibold">Live discovery only.</h1>
      <p className="mx-auto mt-3 max-w-2xl text-muted">
        CreatorSignal now shows only public creator results discovered through Bright Data. Search a product to load source-backed creator cards.
      </p>
      <button className="primary-button mx-auto mt-6" onClick={() => navigate("/")}>
        <Search className="h-4 w-4" />
        Start live creator search
      </button>
    </div>
  );
}

function RealInfluencerCard({
  influencer,
  product,
  openRealOutreach
}: {
  influencer: RealInfluencer;
  product: string;
  openRealOutreach: (influencer: RealInfluencer) => void;
}) {
  const buyerSignals = realInfluencerBuyerSignals(influencer, product);
  return (
    <article className="creator-card">
      <div className="creator-card-header">
        <div className="creator-summary">
          <Avatar creator={{ name: influencer.displayName }} />
          <div className="min-w-0">
            <div className="flex flex-wrap items-center gap-2">
              <h2 className="text-xl font-semibold">{influencer.displayName}</h2>
              <span className="prototype-pill">Real public result</span>
              {influencer.handle ? <span className="chip">@{influencer.handle}</span> : null}
            </div>
            <p className="mt-1 text-sm text-muted">
              {influencer.niche} | {influencer.platform} | {realInfluencerEvidenceLabel(influencer.sourceType)}
            </p>
          </div>
        </div>
        <div className="score-box score-box-compact">
          <span>{influencer.matchScore}</span>
          <small>Source match score</small>
        </div>
      </div>

      <div className="mt-5 grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
        <MetricBadge icon={<BarChart3 />} label="Evidence strength" value={influencer.confidence} />
        <MetricBadge icon={<ShieldCheck />} label="Campaign risk" value={realInfluencerRisk(influencer)} tone={riskTone(realInfluencerRisk(influencer))} />
        <MetricBadge icon={<CircleDollarSign />} label="Cost band" value={realInfluencerCostTier(influencer)} />
        <MetricBadge icon={<ExternalLink />} label="Evidence type" value={realInfluencerEvidenceLabel(influencer.sourceType)} />
      </div>

      <div className="why-box">
        <h3>Why this result matches</h3>
        <p>{influencer.matchReason}</p>
      </div>

      <div className="live-enrichment">
        <p className="eyebrow">Source-backed evidence</p>
        <p className="mt-2 text-sm font-semibold">{influencer.sourceTitle}</p>
        <p className="mt-2 text-sm leading-6 text-muted">{influencer.sourceDescription}</p>
        {buyerSignals.length ? (
          <div className="mt-3">
            <p className="text-xs font-semibold uppercase tracking-[0.08em] text-signal-700">Buyer signals used by filters</p>
            <div className="mt-2 flex flex-wrap gap-2">
              {buyerSignals.map((signal) => (
                <span className="signal-chip" key={signal}>
                  {signal}
                </span>
              ))}
            </div>
          </div>
        ) : null}
        <div className="mt-3 flex flex-wrap gap-2">
          {influencer.evidence.map((item) => (
            <span className="live-term" key={item}>
              {item}
            </span>
          ))}
        </div>
      </div>

      <div className="mt-5 flex flex-wrap gap-2">
        <a className="primary-button" href={influencer.sourceUrl} target="_blank" rel="noreferrer">
          <ExternalLink className="h-4 w-4" />
          View source
        </a>
        {influencer.profileUrl ? (
          <a className="secondary-button" href={influencer.profileUrl} target="_blank" rel="noreferrer">
            View profile
          </a>
        ) : null}
        <button className="ghost-button" onClick={() => openRealOutreach(influencer)}>
          <Mail className="h-4 w-4" />
          Draft outreach
        </button>
      </div>
    </article>
  );
}

function RealOutreachDrawer({
  influencer,
  product,
  close
}: {
  influencer: RealInfluencer;
  product: string;
  close: () => void;
}) {
  const [copyState, setCopyState] = useState("Copy message");
  const message = [
    `Hi ${influencer.displayName},`,
    "",
    `I found your public ${influencer.platform} content while researching creators for ${product}. The source context that stood out was: ${influencer.sourceTitle}.`,
    "",
    `We are looking for a creator who can speak to ${influencer.niche}, and your public result appears relevant because ${influencer.matchReason.toLowerCase()}`,
    "",
    "Would you be open to discussing a possible collaboration?",
    "",
    "Best,",
    "Team"
  ].join("\n");

  const copyMessage = async () => {
    await navigator.clipboard.writeText(message);
    setCopyState("Copied");
    window.setTimeout(() => setCopyState("Copy message"), 1500);
  };

  return (
    <div className="drawer-backdrop" role="dialog" aria-modal="true" aria-labelledby="real-outreach-title">
      <div className="drawer">
        <div className="drawer-header">
          <div>
            <p className="eyebrow">Source-backed draft</p>
            <h2 id="real-outreach-title" className="text-2xl font-semibold">
              Draft outreach
            </h2>
          </div>
          <button className="ghost-button" onClick={close}>
            Close
          </button>
        </div>
        <div className="space-y-6 p-5">
          <dl className="grid gap-3 rounded-md border border-line bg-mist p-4 text-sm sm:grid-cols-2">
            <Definition label="Creator result" value={influencer.displayName} />
            <Definition label="Source" value={influencer.platform} />
            <Definition label="Product" value={product} />
            <Definition label="Confidence" value={influencer.confidence} />
          </dl>
          <div>
            <label className="field-label" htmlFor="real-suggested-message">
              Suggested message
            </label>
            <textarea id="real-suggested-message" className="message-box" value={message} readOnly />
          </div>
          <div className="flex flex-wrap gap-2">
            <button className="primary-button" onClick={copyMessage}>
              <Copy className="h-4 w-4" />
              {copyState}
            </button>
            <a className="secondary-button" href={influencer.sourceUrl} target="_blank" rel="noreferrer">
              <ExternalLink className="h-4 w-4" />
              Open source
            </a>
          </div>
          <p className="text-sm text-muted">No email is sent. This draft uses only visible public source context.</p>
        </div>
      </div>
    </div>
  );
}

function ProductIntelligencePanel({
  intelligence,
  loading,
  error,
  refresh
}: {
  intelligence: ProductIntelligence | null;
  loading: boolean;
  error: string;
  refresh: () => void;
}) {
  return (
    <aside className="surface h-fit p-5">
      <div className="flex items-start justify-between gap-4">
        <div>
          <p className="eyebrow">Product research layer</p>
          <h2 className="mt-2 text-xl font-semibold">Live product signals</h2>
        </div>
        <button className="ghost-icon-button" onClick={refresh} aria-label="Refresh product intelligence">
          {loading ? <Loader2 className="h-4 w-4 animate-spin" /> : <RefreshCcw className="h-4 w-4" />}
        </button>
      </div>

      {loading ? (
        <div className="mt-5 space-y-3" aria-live="polite">
          <div className="skeleton h-4 w-3/4" />
          <div className="skeleton h-4 w-full" />
          <div className="skeleton h-4 w-5/6" />
        </div>
      ) : null}

      {error ? (
        <div className="mt-5 rounded-md border border-amber-200 bg-amber-50 p-4 text-sm text-caution">
          <div className="flex gap-2">
            <AlertTriangle className="h-4 w-4 shrink-0" />
            <p>{error}</p>
          </div>
        </div>
      ) : null}

      {intelligence && !loading ? (
        <div className="mt-5 space-y-5">
          <p className="text-sm leading-6 text-muted">{intelligence.brief.summary}</p>
          <IntegrationUseFlags intelligence={intelligence} />
          <MiniList title="Demand signals" items={intelligence.brief.demandSignals} />
          <MiniList title="Search angles" items={intelligence.brief.searchAngles} />
          <MiniList title="Outreach cues" items={intelligence.brief.outreachCues} />
          {intelligence.brightData.sources.length ? (
            <div>
              <h3 className="text-sm font-semibold">Bright Data sources</h3>
              <div className="mt-3 space-y-3">
                {intelligence.brightData.sources.slice(0, 3).map((source) => (
                  <a
                    className="source-link"
                    key={`${source.rank}-${source.title}`}
                    href={source.link}
                    target="_blank"
                    rel="noreferrer"
                  >
                    <span>{source.title}</span>
                    <ExternalLink className="h-3.5 w-3.5" />
                  </a>
                ))}
              </div>
            </div>
          ) : null}
          <p className="rounded-md border border-line bg-mist p-3 text-xs leading-5 text-muted">{intelligence.disclaimer}</p>
        </div>
      ) : null}

      {!intelligence && !loading && !error ? (
        <p className="mt-5 text-sm leading-6 text-muted">
          Search a product to request live product context and source-backed creator discovery.
        </p>
      ) : null}
    </aside>
  );
}

function IntegrationUseFlags({ intelligence }: { intelligence: ProductIntelligence }) {
  return (
    <div className="grid gap-2 text-xs">
      <div className="integration-flag">
        <span className={intelligence.brightData.used ? "flag-dot flag-on" : "flag-dot"} />
        Bright Data {intelligence.brightData.used ? "used for product web research" : "not used"}
      </div>
      <div className="integration-flag">
        <span className={intelligence.openaiAgents.used ? "flag-dot flag-on" : "flag-dot"} />
        AI provider {intelligence.openaiAgents.used ? "used for summary" : "not used for this run"}
      </div>
      <p className="text-muted">{intelligence.openaiAgents.note}</p>
    </div>
  );
}

function IntegrationPanel({ status }: { status: IntegrationStatus | null }) {
  return (
    <div className="surface p-5">
      <h2 className="section-title">Integration Readiness</h2>
      <div className="mt-4 space-y-3">
        <ReadinessRow
          label="Bright Data API"
          ready={Boolean(status?.brightData.configured)}
          detail={status?.brightData.configured ? `SERP zone ready, ${status.brightData.country.toUpperCase()} search` : "Missing local server config"}
        />
        <ReadinessRow
          label="AI provider"
          ready={Boolean(status?.openaiAgents.configured)}
          detail={status?.openaiAgents.configured ? `${status.openaiAgents.displayName}: ${status.openaiAgents.model} configured` : "Add NVIDIA_API_KEY, GOOGLE_API_KEY, or OPENAI_API_KEY to enable live AI extraction"}
        />
      </div>
      <p className="mt-4 text-xs leading-5 text-muted">
        Integrations run on the local API only. Real influencer discovery uses public web sources returned by Bright Data.
      </p>
    </div>
  );
}

function ReadinessRow({ label, ready, detail }: { label: string; ready: boolean; detail: string }) {
  return (
    <div className="readiness-row">
      <span className={`status-light ${ready ? "status-light-on" : ""}`} />
      <div>
        <p className="text-sm font-medium">{label}</p>
        <p className="text-xs text-muted">{detail}</p>
      </div>
    </div>
  );
}

function SegmentedControl({
  label,
  value,
  options,
  onChange
}: {
  label: string;
  value: string;
  options: readonly string[];
  onChange: (value: string) => void;
}) {
  return (
    <fieldset>
      <legend className="field-label">{label}</legend>
      <div className="segmented">
        {options.map((option) => (
          <button
            key={option}
            type="button"
            className={`segment ${value === option ? "segment-active" : ""}`}
            onClick={() => onChange(option)}
          >
            {option}
          </button>
        ))}
      </div>
    </fieldset>
  );
}

function FilterSelect({
  icon,
  label,
  value,
  options,
  onChange
}: {
  icon: React.ReactNode;
  label: string;
  value: string;
  options: Array<{ label: string; value: string }>;
  onChange: (value: string) => void;
}) {
  return (
    <label className="filter-select">
      {icon}
      <span>{label}</span>
      <select value={value} onChange={(event) => onChange(event.target.value)}>
        {options.map((option) => (
          <option key={option.value} value={option.value}>
            {option.label}
          </option>
        ))}
      </select>
    </label>
  );
}

function MetricBadge({
  icon,
  label,
  value,
  tone
}: {
  icon: React.ReactElement;
  label: string;
  value: string | number;
  tone?: string;
}) {
  return (
    <div className="metric-badge">
      <span className={`metric-icon ${tone || ""}`}>{icon}</span>
      <span>
        <small>{label}</small>
        <strong>{value}</strong>
      </span>
    </div>
  );
}

function Avatar({ creator, size = "default" }: { creator: { name: string }; size?: "small" | "default" | "large" }) {
  return <span className={`avatar ${avatarSizeClass[size]}`}>{initials(creator.name)}</span>;
}

function Definition({ label, value }: { label: string; value: string }) {
  return (
    <div>
      <dt className="text-xs font-medium uppercase text-muted">{label}</dt>
      <dd className="mt-1 font-medium text-ink">{value}</dd>
    </div>
  );
}

function MiniList({ title, items }: { title: string; items: string[] }) {
  return (
    <div>
      <h3 className="text-sm font-semibold">{title}</h3>
      <ul className="mt-3 space-y-2 text-sm text-muted">
        {items.map((item) => (
          <li key={item} className="flex gap-2">
            <span className="mt-2 h-1.5 w-1.5 shrink-0 rounded-full bg-signal-600" />
            <span>{item}</span>
          </li>
        ))}
      </ul>
    </div>
  );
}

function EmptyState() {
  return (
    <div className="surface p-8 text-center">
      <Search className="mx-auto h-8 w-8 text-muted" />
      <h2 className="mt-4 text-xl font-semibold">No real influencer search loaded yet.</h2>
      <p className="mx-auto mt-2 max-w-xl text-muted">
        Search a product category like "budget decor," "workwear," or "fitness" to pull public source-backed results.
      </p>
    </div>
  );
}
