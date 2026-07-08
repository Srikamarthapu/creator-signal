import {
  AlertTriangle,
  ArrowLeft,
  BarChart3,
  Bookmark,
  CalendarDays,
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
  Trash2
} from "lucide-react";
import { FormEvent, useEffect, useMemo, useState } from "react";
import { creators, getCreatorById, type CampaignRisk, type Creator, type Platform, type PurchaseIntent } from "./data/creators";
import { createCampaign } from "./lib/campaigns";
import { generateOutreachMessage, type OutreachTone } from "./lib/outreach";
import { rankCreators } from "./lib/ranking";
import { readLocal, storageKeys, writeLocal } from "./lib/storage";
import type {
  Campaign,
  CreatorEnrichment,
  CreatorEnrichmentResponse,
  Draft,
  IntegrationStatus,
  ProductIntelligence,
  RankedCreator,
  RealInfluencer,
  RealInfluencerResponse,
  SearchState,
  TimelineStatus
} from "./lib/types";

const goals = ["Sales", "Awareness", "UGC", "Product launch"];
const budgets = ["Under $1k", "$1k to $5k", "$5k to $20k", "$20k plus"];
const platforms: Array<Platform | "Any"> = ["Any", "TikTok", "Instagram", "YouTube"];
const audiences = ["Gen Z", "Millennial", "Premium", "Budget"];
const campaignTypes = ["Try on reel", "Story set", "UGC only", "Affiliate"];
const offerTypes = ["$900 flat", "Gifted plus commission", "Custom"];
const tones: OutreachTone[] = ["Friendly", "Professional", "Direct"];
const statusCycle: TimelineStatus[] = ["Pending", "Complete", "Blocked"];
const avatarSizeClass = {
  small: "avatar-small",
  default: "avatar-default",
  large: "avatar-large"
} satisfies Record<"small" | "default" | "large", string>;
const mosaicClassNames = ["mosaic-card mosaic-card-1", "mosaic-card mosaic-card-2", "mosaic-card mosaic-card-3", "mosaic-card mosaic-card-4"];

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

function toneClass(value: PurchaseIntent | CampaignRisk | TimelineStatus) {
  if (value === "High" || value === "Complete") return "tone-good";
  if (value === "Medium" || value === "Pending") return "tone-watch";
  return "tone-risk";
}

function unsupportedQuery(product: string, results: RankedCreator[]) {
  const query = product.trim().toLowerCase();
  if (!query) return false;
  const supported = [
    "petite",
    "linen",
    "blazer",
    "workwear",
    "fashion",
    "beauty",
    "skin",
    "coffee",
    "decor",
    "fitness",
    "pilates",
    "wellness",
    "travel",
    "desk",
    "productivity"
  ];
  return !supported.some((term) => query.includes(term)) && results.every((creator) => creator.matchReasons[0]?.startsWith("Ranked"));
}

export default function App() {
  const [path, setPath] = useState(pathFromWindow);
  const [searchState, setSearchState] = useState<SearchState>(readStoredSearch);
  const [formState, setFormState] = useState<SearchState>(readStoredSearch);
  const [validationError, setValidationError] = useState("");
  const [saveMessage, setSaveMessage] = useState("");
  const [sortMode, setSortMode] = useState<"match" | "cost" | "risk">("match");
  const [riskFilter, setRiskFilter] = useState<CampaignRisk | "Any">("Any");
  const [shortlistIds, setShortlistIds] = useState<string[]>(() => readLocal(storageKeys.shortlist, []));
  const [drafts, setDrafts] = useState<Draft[]>(() => readLocal(storageKeys.drafts, []));
  const [campaigns, setCampaigns] = useState<Campaign[]>(() => readLocal(storageKeys.campaigns, []));
  const [outreachCreatorId, setOutreachCreatorId] = useState<string | null>(null);
  const [integrationStatus, setIntegrationStatus] = useState<IntegrationStatus | null>(null);
  const [intelligence, setIntelligence] = useState<ProductIntelligence | null>(null);
  const [intelligenceLoading, setIntelligenceLoading] = useState(false);
  const [intelligenceError, setIntelligenceError] = useState("");
  const [creatorEnrichmentById, setCreatorEnrichmentById] = useState<Record<string, CreatorEnrichment>>({});
  const [creatorEnrichmentLoading, setCreatorEnrichmentLoading] = useState(false);
  const [creatorEnrichmentError, setCreatorEnrichmentError] = useState("");
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

  const requestCreatorEnrichment = async (nextSearch: SearchState, creatorsToEnrich: RankedCreator[]) => {
    if (!creatorsToEnrich.length) return;
    setCreatorEnrichmentLoading(true);
    setCreatorEnrichmentError("");
    try {
      const response = await fetch("/api/creator-enrichment", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          product: nextSearch.product,
          goal: nextSearch.goal,
          platform: nextSearch.platform === "Any" ? undefined : nextSearch.platform,
          audience: nextSearch.audience,
          creators: creatorsToEnrich.slice(0, 10).map((creator) => ({
            id: creator.id,
            name: creator.name,
            niche: creator.niche,
            platforms: creator.platforms,
            contentThemes: creator.contentThemes,
            suggestedAngle: creator.suggestedAngle,
            whyMatch: creator.whyMatch
          }))
        })
      });
      if (!response.ok) throw new Error("Creator enrichment request failed.");
      const data = (await response.json()) as CreatorEnrichmentResponse;
      const nextById = data.enrichments.reduce<Record<string, CreatorEnrichment>>((accumulator, enrichment) => {
        accumulator[enrichment.creatorId] = enrichment;
        return accumulator;
      }, {});
      setCreatorEnrichmentById((current) => ({ ...current, ...nextById }));
    } catch (error) {
      setCreatorEnrichmentError(error instanceof Error ? error.message : "Creator enrichment request failed.");
    } finally {
      setCreatorEnrichmentLoading(false);
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
    setSearchState(nextSearch);
    persist(storageKeys.lastSearch, nextSearch);
    navigate("/results");
    void requestRealInfluencers(nextSearch);
    void requestIntelligence(nextSearch);
  };

  const rankedCreators = useMemo(() => {
    const ranked = rankCreators(searchState.product, searchState.platform);
    const filtered = riskFilter === "Any" ? ranked : ranked.filter((creator) => creator.campaignRisk === riskFilter);
    return [...filtered].sort((a, b) => {
      if (sortMode === "cost") return a.costEstimate - b.costEstimate;
      if (sortMode === "risk") return a.campaignRisk.localeCompare(b.campaignRisk);
      return b.prototypeMatchScore - a.prototypeMatchScore;
    });
  }, [searchState.product, searchState.platform, riskFilter, sortMode]);

  const visibleResults = unsupportedQuery(searchState.product, rankedCreators) ? [] : rankedCreators;
  const visibleCreatorKey = visibleResults.map((creator) => creator.id).join("|");
  const selectedCreatorId = path.startsWith("/creator/") ? path.replace("/creator/", "") : "";
  const selectedCreator = selectedCreatorId ? getCreatorById(selectedCreatorId) || null : null;
  const campaignId = path.startsWith("/campaign/") ? path.replace("/campaign/", "") : "";
  const selectedCampaign = campaigns.find((campaign) => campaign.id === campaignId) || campaigns[0] || null;

  const toggleShortlist = (creatorId: string) => {
    const next = shortlistIds.includes(creatorId)
      ? shortlistIds.filter((id) => id !== creatorId)
      : [...shortlistIds, creatorId];
    setShortlistIds(next);
    persist(storageKeys.shortlist, next);
    setSaveMessage(shortlistIds.includes(creatorId) ? "Removed from shortlist." : "Saved to shortlist locally.");
  };

  const saveDraft = (creator: Creator, message: string) => {
    const next = [
      {
        id: `draft-${creator.id}-${Date.now()}`,
        creatorId: creator.id,
        product: searchState.product,
        message,
        createdAt: new Date().toISOString()
      },
      ...drafts
    ];
    setDrafts(next);
    persist(storageKeys.drafts, next);
    setSaveMessage("Draft created locally.");
  };

  const createPlan = (creator: Creator) => {
    const campaign = createCampaign({
      creatorId: creator.id,
      product: searchState.product || "your product",
      budget: searchState.budget,
      campaign: creator.bestCampaign
    });
    const next = [campaign, ...campaigns];
    setCampaigns(next);
    persist(storageKeys.campaigns, next);
    navigate(`/campaign/${campaign.id}`);
  };

  const updateStepStatus = (campaignIdToUpdate: string, stepIndex: number) => {
    const next = campaigns.map((campaign) => {
      if (campaign.id !== campaignIdToUpdate) return campaign;
      const steps = campaign.steps.map((step, index) => {
        if (index !== stepIndex) return step;
        const nextIndex = (statusCycle.indexOf(step.status) + 1) % statusCycle.length;
        return { ...step, status: statusCycle[nextIndex] };
      });
      return { ...campaign, steps };
    });
    setCampaigns(next);
    persist(storageKeys.campaigns, next);
  };

  const openOutreach = (creator: Creator) => {
    setOutreachCreatorId(creator.id);
  };

  const closeOutreach = () => {
    setOutreachCreatorId(null);
  };

  useEffect(() => {
    if (path !== "/results" || !searchState.product.trim()) return;
    if (realInfluencers.length || realInfluencersLoading || realInfluencerMeta || realInfluencersError) return;
    void requestRealInfluencers(searchState);
    void requestIntelligence(searchState);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [path, searchState.product, searchState.goal, searchState.platform, searchState.audience]);

  return (
    <div className="min-h-dvh bg-mist text-ink">
      <TopNav path={path} navigate={navigate} shortlistCount={shortlistIds.length} />
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

        {path.startsWith("/creator/") ? (
          <CreatorProfileScreen
            creator={selectedCreator}
            searchState={searchState}
            isShortlisted={selectedCreator ? shortlistIds.includes(selectedCreator.id) : false}
            toggleShortlist={toggleShortlist}
            openOutreach={openOutreach}
            createPlan={createPlan}
            navigate={navigate}
            enrichment={selectedCreator ? creatorEnrichmentById[selectedCreator.id] : undefined}
            enrichmentLoading={creatorEnrichmentLoading}
          />
        ) : null}

        {path === "/shortlist" ? (
          <ShortlistScreen
            shortlistIds={shortlistIds}
            toggleShortlist={toggleShortlist}
            navigate={navigate}
            openOutreach={openOutreach}
          />
        ) : null}

        {path.startsWith("/campaign/") || path === "/campaigns" ? (
          <CampaignScreen
            campaign={selectedCampaign}
            updateStepStatus={updateStepStatus}
            navigate={navigate}
          />
        ) : null}
      </main>

      {outreachCreatorId ? (
        <OutreachDrawer
          creator={getCreatorById(outreachCreatorId)}
          product={searchState.product || formState.product || "your product"}
          enrichment={creatorEnrichmentById[outreachCreatorId]}
          close={closeOutreach}
          saveDraft={saveDraft}
        />
      ) : null}
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
  navigate,
  shortlistCount
}: {
  path: string;
  navigate: (path: string) => void;
  shortlistCount: number;
}) {
  const navItems = [
    { label: "Shortlist", path: "/shortlist", icon: Bookmark },
    { label: "Campaigns", path: "/campaigns", icon: CalendarDays }
  ];
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
        <nav className="flex items-center justify-end gap-2" aria-label="Primary navigation">
          {navItems.map((item) => {
            const isActive =
              item.path === "/" ? path === "/" || path === "/results" || path.startsWith("/creator/") : path.startsWith(item.path);
            const Icon = item.icon;
            return (
              <button
                key={item.path}
                className={`nav-button ${isActive ? "nav-button-active" : ""}`}
                onClick={() => navigate(item.path)}
              >
                <Icon className="h-4 w-4" />
                <span className="nav-label">{item.label}</span>
                {item.label === "Shortlist" && shortlistCount ? <span className="nav-count">{shortlistCount}</span> : null}
              </button>
            );
          })}
        </nav>
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
  const previewCreators = creators.slice(0, 4);
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

        <div className="creator-mosaic" aria-label="Creator discovery preview">
          {previewCreators.map((creator, index) => (
            <div className={mosaicClassNames[index] || "mosaic-card"} key={creator.id}>
              <Avatar creator={creator} />
              <div>
                <strong>{creator.name}</strong>
                <span>{creator.niche}</span>
              </div>
              <small>{creator.audienceFit}</small>
            </div>
          ))}
        </div>

        <PrototypeDisclaimer className="mt-6" />
      </div>

      <aside className="preview-rail">
        <IntegrationPanel status={integrationStatus} />
        <div className="surface p-5">
          <h2 className="section-title">Signal Board</h2>
          <div className="mt-5 grid gap-3">
            {[
              ["91", "Top audience fit"],
              ["$700", "Median creator cost"],
              ["4", "Campaign paths"]
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
  sortMode: "match" | "cost" | "risk";
  setSortMode: (mode: "match" | "cost" | "risk") => void;
  riskFilter: CampaignRisk | "Any";
  setRiskFilter: (risk: CampaignRisk | "Any") => void;
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
  const showRealResults = realInfluencers.length > 0;
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
              label="Sort"
              value={sortMode}
              options={[
                { label: "Match", value: "match" },
                { label: "Cost", value: "cost" },
                { label: "Risk", value: "risk" }
              ]}
              onChange={(value) => setSortMode(value as "match" | "cost" | "risk")}
            />
            <FilterSelect
              icon={<ShieldCheck className="h-4 w-4" />}
              label="Risk"
              value={riskFilter}
              options={[
                { label: "Any", value: "Any" },
                { label: "Low", value: "Low" },
                { label: "Medium", value: "Medium" },
                { label: "High", value: "High" }
              ]}
              onChange={(value) => setRiskFilter(value as CampaignRisk | "Any")}
            />
            <button className="secondary-button" onClick={refreshRealInfluencers}>
              {realInfluencersLoading ? <Loader2 className="h-4 w-4 animate-spin" /> : <Search className="h-4 w-4" />}
              Find real influencers
            </button>
          </div>
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
                <p className="mt-1 text-sm text-muted">Bright Data is searching public web results and OpenAI Agents is structuring source-backed candidates.</p>
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
            {realInfluencers.map((influencer) => (
              <RealInfluencerCard
                key={`${influencer.sourceUrl}-${influencer.displayName}`}
                influencer={influencer}
                openRealOutreach={openRealOutreach}
              />
            ))}
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

function CreatorCard({
  creator,
  isShortlisted,
  toggleShortlist,
  openOutreach,
  navigate,
  enrichment,
  enrichmentLoading
}: {
  creator: RankedCreator;
  isShortlisted: boolean;
  toggleShortlist: (creatorId: string) => void;
  openOutreach: (creator: Creator) => void;
  navigate: (path: string) => void;
  enrichment?: CreatorEnrichment;
  enrichmentLoading: boolean;
}) {
  return (
    <article className="creator-card">
      <div className="creator-card-header">
        <div className="creator-summary">
          <Avatar creator={creator} />
          <div className="min-w-0">
            <div className="flex flex-wrap items-center gap-2">
              <h2 className="text-xl font-semibold">{creator.name}</h2>
              <span className="prototype-pill">Local fallback</span>
            </div>
            <p className="mt-1 text-sm text-muted">
              {creator.niche} | {creator.platforms.join(", ")} | {creator.followers} followers
            </p>
          </div>
        </div>
        <div className="score-box score-box-compact">
          <span>{creator.prototypeMatchScore}</span>
          <small>Fallback match score</small>
        </div>
      </div>

      <div className="mt-5 grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
        <MetricBadge icon={<BarChart3 />} label="Purchase intent" value={creator.purchaseIntent} tone={toneClass(creator.purchaseIntent)} />
        <MetricBadge icon={<ShieldCheck />} label="Campaign risk" value={creator.campaignRisk} tone={toneClass(creator.campaignRisk)} />
        <MetricBadge icon={<CircleDollarSign />} label="Estimated cost" value={creator.estimatedCost} />
        <MetricBadge icon={<CalendarDays />} label="Best campaign" value={creator.bestCampaign} />
      </div>

      <div className="why-box">
        <h3>Why this creator</h3>
        <p>{creator.whyMatch}</p>
      </div>

      <CreatorEnrichmentStrip enrichment={enrichment} loading={enrichmentLoading} />

      <div className="mt-5 flex flex-wrap gap-2">
        <button className="primary-button" onClick={() => navigate(`/creator/${creator.id}`)}>
          View profile
        </button>
        <button className="secondary-button" onClick={() => toggleShortlist(creator.id)}>
          <Bookmark className="h-4 w-4" />
          {isShortlisted ? "Shortlisted" : "Add to shortlist"}
        </button>
        <button className="ghost-button" onClick={() => openOutreach(creator)}>
          <Mail className="h-4 w-4" />
          Generate outreach
        </button>
      </div>
    </article>
  );
}

function RealResultsBanner({ meta }: { meta: RealInfluencerResponse | null }) {
  return (
    <div className="rounded-lg border border-signal-100 bg-signal-50 p-4 text-sm text-signal-900">
      <div className="flex flex-col gap-2 sm:flex-row sm:items-center sm:justify-between">
        <div>
          <p className="font-semibold">Real public influencer results</p>
          <p className="mt-1 text-signal-700">
            Bright Data discovered {meta?.brightData.sourceCount ?? 0} public source results. OpenAI Agents structured source-backed candidates.
          </p>
        </div>
        <span className="live-pill live-pill-agent">{meta?.openaiAgents.used ? "OpenAI extracted" : "Deterministic extraction"}</span>
      </div>
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

function RealInfluencerCard({
  influencer,
  openRealOutreach
}: {
  influencer: RealInfluencer;
  openRealOutreach: (influencer: RealInfluencer) => void;
}) {
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
              {influencer.niche} | {influencer.platform} | {influencer.sourceType}
            </p>
          </div>
        </div>
        <div className="score-box score-box-compact">
          <span>{influencer.matchScore}</span>
          <small>Source match score</small>
        </div>
      </div>

      <div className="mt-5 grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
        <MetricBadge icon={<BarChart3 />} label="Evidence type" value={influencer.sourceType} />
        <MetricBadge icon={<ShieldCheck />} label="Confidence" value={influencer.confidence} tone={toneClass(influencer.confidence)} />
        <MetricBadge icon={<ExternalLink />} label="Platform" value={influencer.platform} />
        <MetricBadge icon={<Search />} label="Data source" value="Bright Data SERP" />
      </div>

      <div className="why-box">
        <h3>Why this result matches</h3>
        <p>{influencer.matchReason}</p>
      </div>

      <div className="live-enrichment">
        <p className="eyebrow">Source-backed evidence</p>
        <p className="mt-2 text-sm font-semibold">{influencer.sourceTitle}</p>
        <p className="mt-2 text-sm leading-6 text-muted">{influencer.sourceDescription}</p>
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

function CreatorProfileScreen({
  creator,
  searchState,
  isShortlisted,
  toggleShortlist,
  openOutreach,
  createPlan,
  navigate,
  enrichment,
  enrichmentLoading
}: {
  creator: Creator | null;
  searchState: SearchState;
  isShortlisted: boolean;
  toggleShortlist: (creatorId: string) => void;
  openOutreach: (creator: Creator) => void;
  createPlan: (creator: Creator) => void;
  navigate: (path: string) => void;
  enrichment?: CreatorEnrichment;
  enrichmentLoading: boolean;
}) {
  if (!creator) {
    return (
      <div className="surface p-6">
        <button className="ghost-button" onClick={() => navigate("/results")}>
          <ArrowLeft className="h-4 w-4" />
          Back to results
        </button>
        <p className="mt-6 error-text">Creator not found in local fallback data.</p>
      </div>
    );
  }

  return (
    <section className="grid gap-6 lg:grid-cols-[minmax(0,1fr)_360px]">
      <div className="surface overflow-hidden">
        <div className="border-b border-line p-5">
          <button className="ghost-button" onClick={() => navigate("/results")}>
            <ArrowLeft className="h-4 w-4" />
            Back to results
          </button>
        </div>
        <div className="p-5 sm:p-8">
          <div className="flex flex-col gap-6 sm:flex-row sm:items-center sm:justify-between">
            <div className="flex gap-4">
              <Avatar creator={creator} size="large" />
              <div>
                <h1 className="text-4xl font-semibold">{creator.name}</h1>
                <p className="mt-2 text-muted">
                  {creator.niche} creator | {creator.platforms.join(", ")} | {creator.followers} followers
                </p>
                <PrototypeDisclaimer className="mt-4" />
              </div>
            </div>
            <div className="score-box score-box-large">
              <span>{creator.audienceFit}</span>
              <small>Audience fit</small>
            </div>
          </div>

          <div className="mt-8 grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
            <MetricBadge icon={<BarChart3 />} label="Purchase intent" value={creator.purchaseIntent} tone={toneClass(creator.purchaseIntent)} />
            <MetricBadge icon={<ShieldCheck />} label="Campaign risk" value={creator.campaignRisk} tone={toneClass(creator.campaignRisk)} />
            <MetricBadge icon={<CircleDollarSign />} label="Estimated cost" value={creator.estimatedCost} />
            <MetricBadge icon={<CalendarDays />} label="Best campaign" value={creator.bestCampaign} />
          </div>

          <section className="profile-section">
            <h2>Why this creator</h2>
            <p>{creator.whyMatch}</p>
          </section>

          <section className="profile-section">
            <h2>Top audience signals</h2>
            <ol className="signal-list">
              {creator.audienceSignals.map((signal, index) => (
                <li key={signal}>
                  <span>{index + 1}</span>
                  <p>"{signal}"</p>
                </li>
              ))}
            </ol>
          </section>

          <section className="profile-section">
            <h2>Recommended campaign</h2>
            <p className="font-medium text-ink">{creator.bestCampaign}</p>
            <h3 className="mt-5 text-sm font-semibold">Suggested angle</h3>
            <p>{creator.suggestedAngle}</p>
          </section>

          <section className="profile-section">
            <h2>Live public web enrichment</h2>
            <CreatorEnrichmentStrip enrichment={enrichment} loading={enrichmentLoading} expanded />
          </section>

          <div className="mt-8 flex flex-wrap gap-2">
            <button className="primary-button" onClick={() => openOutreach(creator)}>
              <Mail className="h-4 w-4" />
              Generate outreach
            </button>
            <button className="secondary-button" onClick={() => toggleShortlist(creator.id)}>
              <Bookmark className="h-4 w-4" />
              {isShortlisted ? "Shortlisted" : "Add to shortlist"}
            </button>
            <button className="secondary-button" onClick={() => createPlan(creator)}>
              <CalendarDays className="h-4 w-4" />
              Create plan
            </button>
          </div>
        </div>
      </div>

      <aside className="flex flex-col gap-4">
        <div className="surface p-5">
          <h2 className="section-title">Content themes</h2>
          <div className="mt-4 flex flex-wrap gap-2">
            {creator.contentThemes.map((theme) => (
              <span className="chip" key={theme}>
                {theme}
              </span>
            ))}
          </div>
        </div>
        <div className="surface p-5">
          <h2 className="section-title">Current search context</h2>
          <dl className="mt-4 space-y-3 text-sm">
            <Definition label="Product" value={searchState.product || "Not set"} />
            <Definition label="Goal" value={searchState.goal} />
            <Definition label="Budget" value={searchState.budget} />
            <Definition label="Audience" value={searchState.audience} />
          </dl>
        </div>
      </aside>
    </section>
  );
}

function CreatorEnrichmentStrip({
  enrichment,
  loading,
  expanded = false
}: {
  enrichment?: CreatorEnrichment;
  loading: boolean;
  expanded?: boolean;
}) {
  if (loading && !enrichment) {
    return (
      <div className="live-enrichment" aria-live="polite">
        <div className="flex items-center justify-between gap-3">
          <div>
            <p className="eyebrow">Bright Data influencer scrape</p>
            <h3 className="mt-1 text-sm font-semibold">Checking public creator context</h3>
          </div>
          <Loader2 className="h-4 w-4 animate-spin text-signal-700" />
        </div>
        <div className="mt-4 space-y-2">
          <div className="skeleton h-3 w-4/5" />
          <div className="skeleton h-3 w-2/3" />
        </div>
      </div>
    );
  }

  if (!enrichment) return null;

  return (
    <div className={`live-enrichment ${expanded ? "live-enrichment-expanded" : ""}`}>
      <div className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
        <div>
          <p className="eyebrow">Bright Data influencer scrape</p>
          <h3 className="mt-1 text-sm font-semibold">Public web enrichment</h3>
        </div>
        <div className="flex flex-wrap gap-2">
          <span className="live-pill">{enrichment.sourceCount} SERP results</span>
          {enrichment.scrapedPageCount > 0 ? (
            <span className="live-pill">{enrichment.scrapedPageCount} pages scraped</span>
          ) : null}
          <span className={`live-pill ${toneClass(enrichment.confidence)}`}>{enrichment.confidence} confidence</span>
          {enrichment.openaiAgentsUsed ? <span className="live-pill live-pill-agent">OpenAI agent</span> : null}
        </div>
      </div>
      <p className="mt-3 text-sm leading-6 text-muted">{enrichment.agentSummary}</p>
      <div className="mt-3 flex flex-wrap gap-2">
        {enrichment.audienceDemandTerms.slice(0, expanded ? 6 : 4).map((term) => (
          <span className="live-term" key={term}>
            {term}
          </span>
        ))}
      </div>
      {expanded || enrichment.sources.length ? (
        <div className="mt-4 grid gap-2">
          {enrichment.sources.slice(0, expanded ? 4 : 2).map((source) =>
            source.link ? (
              <a className="source-link" href={source.link} target="_blank" rel="noreferrer" key={`${source.rank}-${source.title}`}>
                <span>{source.title}</span>
                <ExternalLink className="h-3.5 w-3.5" />
              </a>
            ) : (
              <div className="source-link" key={`${source.rank}-${source.title}`}>
                <span>{source.title}</span>
              </div>
            )
          )}
        </div>
      ) : null}
      <p className="mt-3 text-xs leading-5 text-muted">{enrichment.caveat}</p>
    </div>
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

function OutreachDrawer({
  creator,
  product,
  enrichment,
  close,
  saveDraft
}: {
  creator: Creator | undefined;
  product: string;
  enrichment?: CreatorEnrichment;
  close: () => void;
  saveDraft: (creator: Creator, message: string) => void;
}) {
  const [campaignType, setCampaignType] = useState(campaignTypes[0]);
  const [offer, setOffer] = useState(offerTypes[0]);
  const [tone, setTone] = useState<OutreachTone>("Friendly");
  const [copyState, setCopyState] = useState("Copy message");

  if (!creator) return null;

  const baseMessage = generateOutreachMessage({
    creator,
    product,
    campaignType,
    offer,
    tone
  });
  const message = enrichment?.outreachAngle
    ? [
        baseMessage,
        "",
        `Live research note: Public web discovery also suggests the angle "${enrichment.outreachAngle}". This is not verified platform analytics.`
      ].join("\n")
    : baseMessage;

  const copyMessage = async () => {
    await navigator.clipboard.writeText(message);
    setCopyState("Copied");
    window.setTimeout(() => setCopyState("Copy message"), 1500);
  };

  return (
    <div className="drawer-backdrop" role="dialog" aria-modal="true" aria-labelledby="outreach-title">
      <div className="drawer">
        <div className="drawer-header">
          <div>
            <p className="eyebrow">Local draft generator</p>
            <h2 id="outreach-title" className="text-2xl font-semibold">
              Generate outreach
            </h2>
          </div>
          <button className="ghost-button" onClick={close}>
            Close
          </button>
        </div>

        <div className="space-y-6 p-5">
          <dl className="grid gap-3 rounded-md border border-line bg-mist p-4 text-sm sm:grid-cols-2">
            <Definition label="Creator" value={creator.name} />
            <Definition label="Product" value={product} />
          </dl>
          <SegmentedControl label="Campaign type" value={campaignType} options={campaignTypes} onChange={setCampaignType} />
          <SegmentedControl label="Offer" value={offer} options={offerTypes} onChange={setOffer} />
          <SegmentedControl label="Tone" value={tone} options={tones} onChange={(nextTone) => setTone(nextTone as OutreachTone)} />
          <div>
            <label className="field-label" htmlFor="suggested-message">
              Suggested message
            </label>
            <textarea id="suggested-message" className="message-box" value={message} readOnly />
          </div>
          <div className="flex flex-wrap gap-2">
            <button className="primary-button" onClick={copyMessage}>
              <Copy className="h-4 w-4" />
              {copyState}
            </button>
            <button
              className="secondary-button"
              onClick={() => {
                saveDraft(creator, message);
                close();
              }}
            >
              Save draft locally
            </button>
          </div>
          <p className="text-sm text-muted">No email is sent. No real email address is requested.</p>
        </div>
      </div>
    </div>
  );
}

function CampaignScreen({
  campaign,
  updateStepStatus,
  navigate
}: {
  campaign: Campaign | null;
  updateStepStatus: (campaignId: string, stepIndex: number) => void;
  navigate: (path: string) => void;
}) {
  if (!campaign) {
    return (
      <div className="surface p-6">
        <h1 className="text-3xl font-semibold">Campaign plan</h1>
        <p className="mt-4 text-muted">No local campaign timeline has been created yet.</p>
        <button className="primary-button mt-6" onClick={() => navigate("/results")}>
          Back to results
        </button>
      </div>
    );
  }

  const creator = getCreatorById(campaign.creatorId);

  return (
    <section className="surface overflow-hidden">
      <div className="border-b border-line p-5">
        <button className="ghost-button" onClick={() => (creator ? navigate(`/creator/${creator.id}`) : navigate("/results"))}>
          <ArrowLeft className="h-4 w-4" />
          Back to profile
        </button>
      </div>
      <div className="p-5 sm:p-8">
        <p className="eyebrow">Local workflow tracker</p>
        <h1 className="mt-2 text-3xl font-semibold">Campaign plan</h1>
        <div className="mt-5 grid gap-3 rounded-md border border-line bg-mist p-4 text-sm sm:grid-cols-2 lg:grid-cols-4">
          <Definition label="Creator" value={creator?.name || "Creator not found"} />
          <Definition label="Product" value={campaign.product} />
          <Definition label="Campaign" value={campaign.campaign} />
          <Definition label="Budget" value={`${campaign.budget} estimated`} />
        </div>

        <div className="mt-8">
          <h2 className="section-title">Timeline</h2>
          <div className="mt-4 divide-y divide-line rounded-md border border-line bg-white">
            {campaign.steps.map((step, index) => (
              <button key={`${step.day}-${step.title}`} className="timeline-step" onClick={() => updateStepStatus(campaign.id, index)}>
                <span className="day-pill">Day {step.day}</span>
                <span className="min-w-0 flex-1 text-left">{step.title}</span>
                <span className={`status-pill ${toneClass(step.status)}`}>{step.status}</span>
              </button>
            ))}
          </div>
        </div>

        <div className="mt-6 flex flex-wrap gap-2">
          <button className="secondary-button" onClick={() => navigate("/campaigns")}>
            Save campaign
          </button>
          {creator ? (
            <button className="ghost-button" onClick={() => navigate(`/creator/${creator.id}`)}>
              Back to profile
            </button>
          ) : null}
        </div>
        <p className="mt-5 text-sm text-muted">This is a local workflow timeline. No calendar booking or scheduling is created.</p>
      </div>
    </section>
  );
}

function ShortlistScreen({
  shortlistIds,
  toggleShortlist,
  navigate,
  openOutreach
}: {
  shortlistIds: string[];
  toggleShortlist: (creatorId: string) => void;
  navigate: (path: string) => void;
  openOutreach: (creator: Creator) => void;
}) {
  const shortlisted = creators.filter((creator) => shortlistIds.includes(creator.id));

  if (!shortlisted.length) {
    return (
      <div className="surface p-6">
        <p className="eyebrow">Shortlist</p>
        <h1 className="mt-2 text-3xl font-semibold">Compare saved creators</h1>
        <p className="mt-4 text-muted">No creators saved yet. Add creators from results to compare match, cost, risk, and purchase intent.</p>
        <button className="primary-button mt-6" onClick={() => navigate("/results")}>
          View results
        </button>
      </div>
    );
  }

  return (
    <section className="surface overflow-hidden">
      <div className="border-b border-line p-5">
        <p className="eyebrow">Shortlist</p>
        <h1 className="mt-2 text-3xl font-semibold">Compare saved creators</h1>
      </div>
      <div className="overflow-x-auto p-5">
        <table className="shortlist-table">
          <thead>
            <tr>
              <th>Creator</th>
              <th>Match</th>
              <th>Cost</th>
              <th>Risk</th>
              <th>Purchase intent</th>
              <th>Action</th>
            </tr>
          </thead>
          <tbody>
            {shortlisted.map((creator) => (
              <tr key={creator.id}>
                <td>
                  <button className="table-creator" onClick={() => navigate(`/creator/${creator.id}`)}>
                    <Avatar creator={creator} size="small" />
                    <span>{creator.name}</span>
                  </button>
                </td>
                <td>{creator.audienceFit}</td>
                <td>{creator.estimatedCost}</td>
                <td>
                  <span className={`status-pill ${toneClass(creator.campaignRisk)}`}>{creator.campaignRisk}</span>
                </td>
                <td>{creator.purchaseIntent}</td>
                <td>
                  <div className="flex gap-2">
                    <button className="ghost-icon-button" aria-label={`Generate outreach for ${creator.name}`} onClick={() => openOutreach(creator)}>
                      <Mail className="h-4 w-4" />
                    </button>
                    <button className="ghost-icon-button" aria-label={`Remove ${creator.name}`} onClick={() => toggleShortlist(creator.id)}>
                      <Trash2 className="h-4 w-4" />
                    </button>
                  </div>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
        <button className="primary-button mt-5" onClick={() => openOutreach(shortlisted[0])}>
          Generate outreach for selected
        </button>
      </div>
      <PrototypeDisclaimer className="m-5" />
    </section>
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
        OpenAI Agents SDK {intelligence.openaiAgents.used ? "used for summary" : "not used for this run"}
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
          label="OpenAI Agents SDK"
          ready={Boolean(status?.openaiAgents.configured)}
          detail={status?.openaiAgents.configured ? `${status.openaiAgents.model} configured` : "Add OPENAI_API_KEY to enable live agent brief"}
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

function PrototypeDisclaimer({ className = "" }: { className?: string }) {
  return (
    <p className={`prototype-disclaimer ${className}`}>
      Local fallback profile. Use real public results for source-backed discovery.
    </p>
  );
}

function Avatar({ creator, size = "default" }: { creator: Pick<Creator, "name">; size?: "small" | "default" | "large" }) {
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
