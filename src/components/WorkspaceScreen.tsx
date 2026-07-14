import {
  ArrowRight,
  BriefcaseBusiness,
  CheckCircle2,
  Clock3,
  FolderSearch,
  LayoutDashboard,
  ListChecks,
  Loader2,
  Plus,
  Search,
  Settings
} from "lucide-react";
import { type FormEvent, useCallback, useEffect, useMemo, useState } from "react";
import { supabase } from "../lib/supabase";
import { AuthScreen } from "./AuthScreen";
import { useAuth } from "./AuthProvider";

export type WorkspaceView = "overview" | "shortlists" | "campaigns";

type CampaignRow = {
  id: string;
  name: string;
  product: string;
  status: string;
  platform: string | null;
  creator_budget_cents: number | null;
  currency: string;
  updated_at: string;
};

type ShortlistRow = {
  id: string;
  name: string;
  status: string;
  campaign_id: string | null;
  updated_at: string;
  shortlist_entries: Array<{ count: number }>;
};

type ResearchRow = {
  id: string;
  status: string;
  search_input: Record<string, unknown>;
  creator_count: number;
  source_count: number;
  updated_at: string;
};

function formatDate(value: string) {
  return new Intl.DateTimeFormat(undefined, { month: "short", day: "numeric", year: "numeric" }).format(new Date(value));
}

function formatBudget(cents: number | null, currency: string) {
  if (cents === null) return "Budget not set";
  return new Intl.NumberFormat(undefined, {
    style: "currency",
    currency,
    maximumFractionDigits: 0
  }).format(cents / 100);
}

function productFromResearch(row: ResearchRow) {
  const product = row.search_input?.product;
  return typeof product === "string" && product.trim() ? product : "Untitled research";
}

export function WorkspaceScreen({ view, navigate }: { view: WorkspaceView; navigate: (path: string) => void }) {
  const auth = useAuth();
  const [campaigns, setCampaigns] = useState<CampaignRow[]>([]);
  const [shortlists, setShortlists] = useState<ShortlistRow[]>([]);
  const [researchRuns, setResearchRuns] = useState<ResearchRow[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");
  const [showCampaignForm, setShowCampaignForm] = useState(false);
  const [campaignName, setCampaignName] = useState("");
  const [product, setProduct] = useState("");
  const [goal, setGoal] = useState("Sales");
  const [platform, setPlatform] = useState("Instagram");
  const [budget, setBudget] = useState("");
  const [saving, setSaving] = useState(false);

  const loadWorkspace = useCallback(async () => {
    if (!supabase || !auth.activeOrganization) return;
    setLoading(true);
    setError("");
    try {
      const organizationId = auth.activeOrganization.id;
      const [campaignResult, shortlistResult, researchResult] = await Promise.all([
        supabase
          .from("campaigns")
          .select("id, name, product, status, platform, creator_budget_cents, currency, updated_at")
          .eq("org_id", organizationId)
          .order("updated_at", { ascending: false })
          .limit(20),
        supabase
          .from("shortlists")
          .select("id, name, status, campaign_id, updated_at, shortlist_entries(count)")
          .eq("org_id", organizationId)
          .order("updated_at", { ascending: false })
          .limit(20),
        supabase
          .from("research_runs")
          .select("id, status, search_input, creator_count, source_count, updated_at")
          .eq("org_id", organizationId)
          .order("updated_at", { ascending: false })
          .limit(10)
      ]);
      const firstError = campaignResult.error || shortlistResult.error || researchResult.error;
      if (firstError) throw firstError;
      setCampaigns((campaignResult.data || []) as CampaignRow[]);
      setShortlists((shortlistResult.data || []) as unknown as ShortlistRow[]);
      setResearchRuns((researchResult.data || []) as ResearchRow[]);
    } catch (workspaceError) {
      setError(workspaceError instanceof Error ? workspaceError.message : "Could not load this workspace.");
    } finally {
      setLoading(false);
    }
  }, [auth.activeOrganization]);

  useEffect(() => {
    void loadWorkspace();
  }, [loadWorkspace]);

  const createCampaign = async (event: FormEvent) => {
    event.preventDefault();
    if (!supabase || !auth.user || !auth.activeOrganization || saving) return;
    setSaving(true);
    setError("");
    try {
      const parsedBudget = budget.trim() ? Math.round(Number(budget) * 100) : null;
      if (parsedBudget !== null && (!Number.isFinite(parsedBudget) || parsedBudget < 0)) {
        throw new Error("Enter a valid creator budget.");
      }
      const { error: insertError } = await supabase.from("campaigns").insert({
        org_id: auth.activeOrganization.id,
        created_by: auth.user.id,
        owner_id: auth.user.id,
        name: campaignName.trim(),
        product: product.trim(),
        goal,
        platform,
        creator_budget_cents: parsedBudget,
        status: "draft"
      });
      if (insertError) throw insertError;
      setCampaignName("");
      setProduct("");
      setBudget("");
      setShowCampaignForm(false);
      await loadWorkspace();
    } catch (campaignError) {
      setError(campaignError instanceof Error ? campaignError.message : "Could not create the campaign.");
    } finally {
      setSaving(false);
    }
  };

  const viewTitle = view === "shortlists" ? "Shortlists" : view === "campaigns" ? "Campaigns" : "Workspace";
  const viewDetail = view === "shortlists"
    ? "Review saved creators and prepare an approval-ready roster."
    : view === "campaigns"
      ? "Move each creator program from brief through completion."
      : "Resume research and keep campaign decisions in one private workspace.";
  const shortlistCount = useMemo(() => shortlists.reduce((total, shortlist) => total + Number(shortlist.shortlist_entries?.[0]?.count || 0), 0), [shortlists]);

  if (!auth.configured || (!auth.loading && !auth.user)) {
    return <AuthScreen navigate={navigate} />;
  }

  if (auth.loading || auth.workspaceLoading) {
    return <div className="workspace-loading" role="status"><Loader2 className="h-5 w-5 animate-spin" /> Loading your workspace...</div>;
  }

  if (!auth.activeOrganization) {
    return <div className="workspace-error" role="alert"><p>Your account is not connected to a workspace yet.</p><button type="button" onClick={() => void auth.refreshWorkspace()}>Retry</button></div>;
  }

  return (
    <section className="workspace-shell">
      <header className="workspace-heading">
        <div>
          <p className="eyebrow">{auth.activeOrganization.name}</p>
          <h1>{viewTitle}</h1>
          <p>{viewDetail}</p>
        </div>
        <div className="workspace-heading-actions">
          {auth.memberships.length > 1 ? (
            <label className="workspace-switcher">
              <span>Workspace</span>
              <select value={auth.activeOrganization.id} onChange={(event) => auth.switchOrganization(event.target.value)}>
                {auth.memberships.map((membership) => <option key={membership.id} value={membership.orgId}>{membership.organization.name}</option>)}
              </select>
            </label>
          ) : null}
          <button className="primary-button" type="button" onClick={() => setShowCampaignForm((current) => !current)}>
            <Plus className="h-4 w-4" /> New campaign
          </button>
        </div>
      </header>

      <nav className="workspace-tabs" aria-label="Workspace views">
        <button className={view === "overview" ? "workspace-tab-active" : ""} title="Overview" onClick={() => navigate("/workspace")}><LayoutDashboard className="h-4 w-4" /><span>Overview</span></button>
        <button className={view === "shortlists" ? "workspace-tab-active" : ""} title="Shortlists" onClick={() => navigate("/shortlist")}><ListChecks className="h-4 w-4" /><span>Shortlists</span></button>
        <button className={view === "campaigns" ? "workspace-tab-active" : ""} title="Campaigns" onClick={() => navigate("/campaigns")}><BriefcaseBusiness className="h-4 w-4" /><span>Campaigns</span></button>
        <button title="Settings" onClick={() => navigate("/settings")}><Settings className="h-4 w-4" /><span>Settings</span></button>
      </nav>

      {showCampaignForm ? (
        <form className="campaign-create-form" onSubmit={createCampaign}>
          <div className="campaign-create-heading"><div><p className="eyebrow">Draft campaign</p><h2>Set the working brief</h2></div><span>Private to {auth.activeOrganization.name}</span></div>
          <div className="campaign-create-grid">
            <label><span>Campaign name</span><input value={campaignName} onChange={(event) => setCampaignName(event.target.value)} required maxLength={160} placeholder="Fall desk setup launch" /></label>
            <label><span>Product</span><input value={product} onChange={(event) => setProduct(event.target.value)} required maxLength={200} placeholder="Ergonomic wireless mouse" /></label>
            <label><span>Goal</span><select value={goal} onChange={(event) => setGoal(event.target.value)}><option>Sales</option><option>Awareness</option><option>UGC</option><option>Product launch</option></select></label>
            <label><span>Platform</span><select value={platform} onChange={(event) => setPlatform(event.target.value)}><option>Instagram</option><option>TikTok</option><option>YouTube</option><option>Any</option></select></label>
            <label><span>Creator budget (USD)</span><input type="number" min="0" step="1" value={budget} onChange={(event) => setBudget(event.target.value)} placeholder="5000" /></label>
          </div>
          <div className="campaign-create-actions"><button className="ghost-button" type="button" onClick={() => setShowCampaignForm(false)}>Cancel</button><button className="primary-button" type="submit" disabled={saving}>{saving ? <Loader2 className="h-4 w-4 animate-spin" /> : <CheckCircle2 className="h-4 w-4" />} Create draft</button></div>
        </form>
      ) : null}

      {error ? <div className="workspace-error" role="alert"><p>{error}</p><button type="button" onClick={() => void loadWorkspace()}>Retry</button></div> : null}

      {view === "overview" ? (
        <>
          <div className="workspace-stats" aria-label="Workspace summary">
            <div><span>Active campaigns</span><strong>{campaigns.filter((campaign) => !["complete", "cancelled"].includes(campaign.status)).length}</strong></div>
            <div><span>Saved creators</span><strong>{shortlistCount}</strong></div>
            <div><span>Research sessions</span><strong>{researchRuns.length}</strong></div>
          </div>
          <div className="workspace-columns">
            <WorkspaceSection title="Recent research" icon={FolderSearch} actionLabel="Start research" onAction={() => navigate("/")}>
              {loading ? <WorkspaceLoadingRows /> : researchRuns.length ? researchRuns.slice(0, 5).map((research) => (
                <button className="workspace-row" type="button" key={research.id} onClick={() => navigate(`/research/${research.id}`)}>
                  <span className="workspace-row-icon"><Search className="h-4 w-4" /></span>
                  <span><b>{productFromResearch(research)}</b><small>{research.creator_count} creators · {research.source_count} sources · {formatDate(research.updated_at)}</small></span>
                  <ArrowRight className="h-4 w-4" />
                </button>
              )) : <WorkspaceEmpty title="No saved research yet" detail="Your first source-backed creator search will appear here after it is saved." action="Start a search" onAction={() => navigate("/")} />}
            </WorkspaceSection>
            <WorkspaceSection title="Campaign activity" icon={BriefcaseBusiness} actionLabel="View campaigns" onAction={() => navigate("/campaigns")}>
              {loading ? <WorkspaceLoadingRows /> : campaigns.length ? campaigns.slice(0, 5).map((campaign) => <CampaignListRow campaign={campaign} navigate={navigate} key={campaign.id} />) : <WorkspaceEmpty title="No campaigns yet" detail="Create a draft when you are ready to turn research into a working plan." action="Create campaign" onAction={() => setShowCampaignForm(true)} />}
            </WorkspaceSection>
          </div>
        </>
      ) : null}

      {view === "campaigns" ? (
        <WorkspaceSection title="All campaigns" icon={BriefcaseBusiness} actionLabel="New campaign" onAction={() => setShowCampaignForm(true)}>
          {loading ? <WorkspaceLoadingRows /> : campaigns.length ? campaigns.map((campaign) => <CampaignListRow campaign={campaign} navigate={navigate} key={campaign.id} />) : <WorkspaceEmpty title="No campaign records" detail="Campaigns stay private to this organization and begin as editable drafts." action="Create campaign" onAction={() => setShowCampaignForm(true)} />}
        </WorkspaceSection>
      ) : null}

      {view === "shortlists" ? (
        <WorkspaceSection title="Saved shortlists" icon={ListChecks} actionLabel="Find creators" onAction={() => navigate("/")}>
          {loading ? <WorkspaceLoadingRows /> : shortlists.length ? shortlists.map((shortlist) => (
            <button className="workspace-row" type="button" key={shortlist.id} onClick={() => navigate(`/shortlist/${shortlist.id}`)}>
              <span className="workspace-row-icon"><ListChecks className="h-4 w-4" /></span>
              <span><b>{shortlist.name}</b><small>{Number(shortlist.shortlist_entries?.[0]?.count || 0)} creators · {shortlist.status} · Updated {formatDate(shortlist.updated_at)}</small></span>
              <ArrowRight className="h-4 w-4" />
            </button>
          )) : <WorkspaceEmpty title="No saved creators" detail="Save a source-backed result to create your first shortlist. No local placeholder creators are used." action="Find creators" onAction={() => navigate("/")} />}
        </WorkspaceSection>
      ) : null}
    </section>
  );
}

function WorkspaceSection({ title, icon: Icon, actionLabel, onAction, children }: { title: string; icon: typeof Clock3; actionLabel: string; onAction: () => void; children: React.ReactNode }) {
  return <section className="workspace-section"><header><div><Icon className="h-4 w-4" /><h2>{title}</h2></div><button type="button" onClick={onAction}>{actionLabel}<ArrowRight className="h-3.5 w-3.5" /></button></header><div>{children}</div></section>;
}

function CampaignListRow({ campaign, navigate }: { campaign: CampaignRow; navigate: (path: string) => void }) {
  return <button className="workspace-row" type="button" onClick={() => navigate(`/campaign/${campaign.id}`)}><span className="workspace-row-icon"><BriefcaseBusiness className="h-4 w-4" /></span><span><b>{campaign.name}</b><small>{campaign.product} · {campaign.platform || "Any platform"} · {formatBudget(campaign.creator_budget_cents, campaign.currency)}</small></span><span className={`campaign-status campaign-status-${campaign.status}`}>{campaign.status}</span></button>;
}

function WorkspaceLoadingRows() {
  return <div className="workspace-loading" role="status"><Loader2 className="h-4 w-4 animate-spin" /> Loading saved work...</div>;
}

function WorkspaceEmpty({ title, detail, action, onAction }: { title: string; detail: string; action: string; onAction: () => void }) {
  return <div className="workspace-empty"><Clock3 className="h-5 w-5" /><div><h3>{title}</h3><p>{detail}</p></div><button className="ghost-button" type="button" onClick={onAction}>{action}</button></div>;
}
