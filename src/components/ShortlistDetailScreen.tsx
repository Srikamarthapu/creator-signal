import {
  ArrowLeft,
  BadgeCheck,
  CalendarDays,
  CircleDollarSign,
  ExternalLink,
  FileCheck2,
  Loader2,
  LockKeyhole,
  RotateCcw,
  ShieldCheck,
  X
} from "lucide-react";
import { type FormEvent, useCallback, useEffect, useMemo, useState } from "react";
import { apiFetch } from "../lib/api";
import type { ShortlistDecision, ShortlistDetailResponse, ShortlistStatus } from "../lib/types";
import { AuthScreen } from "./AuthScreen";
import { useAuth } from "./AuthProvider";

const rejectionReasons = [
  "Product mismatch",
  "Audience mismatch",
  "Weak evidence",
  "Budget mismatch",
  "Brand safety concern",
  "Not active enough",
  "Duplicate creator",
  "Other"
];

function formatDate(value: string | null | undefined) {
  if (!value) return "Not recorded";
  return new Intl.DateTimeFormat(undefined, { month: "short", day: "numeric", year: "numeric" }).format(new Date(value));
}

function initials(name: string) {
  return name.split(/\s+/).map((part) => part[0]).join("").slice(0, 2).toUpperCase();
}

function statusLabel(status: ShortlistStatus) {
  if (status === "review") return "In review";
  return status[0].toUpperCase() + status.slice(1);
}

function decisionLabel(decision: ShortlistDecision) {
  if (decision === "rejected") return "Rejected";
  if (decision === "archived") return "Archived";
  return "Selected";
}

export function ShortlistDetailScreen({
  shortlistId,
  navigate
}: {
  shortlistId: string;
  navigate: (path: string) => void;
}) {
  const auth = useAuth();
  const [data, setData] = useState<ShortlistDetailResponse | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");
  const [busyAction, setBusyAction] = useState("");
  const [rejectEntryId, setRejectEntryId] = useState("");
  const [rejectReason, setRejectReason] = useState(rejectionReasons[0]);
  const [rejectNotes, setRejectNotes] = useState("");
  const [campaignOpen, setCampaignOpen] = useState(false);
  const [campaignName, setCampaignName] = useState("");
  const [budget, setBudget] = useState("");
  const [startsOn, setStartsOn] = useState("");
  const [endsOn, setEndsOn] = useState("");

  const loadShortlist = useCallback(async (signal?: AbortSignal) => {
    if (!auth.activeOrganization) return;
    setLoading(true);
    setError("");
    try {
      const response = await apiFetch(`/api/workspace/shortlists/${shortlistId}?organizationId=${encodeURIComponent(auth.activeOrganization.id)}`, { signal });
      const payload = await response.json().catch(() => null);
      if (!response.ok) throw new Error(payload?.error || "The shortlist could not be loaded.");
      setData(payload as ShortlistDetailResponse);
    } catch (loadError) {
      if (loadError instanceof Error && loadError.name === "AbortError") return;
      setError(loadError instanceof Error ? loadError.message : "The shortlist could not be loaded.");
    } finally {
      if (!signal?.aborted) setLoading(false);
    }
  }, [auth.activeOrganization, shortlistId]);

  useEffect(() => {
    if (!auth.activeOrganization) return;
    const controller = new AbortController();
    void loadShortlist(controller.signal);
    return () => controller.abort();
  }, [auth.activeOrganization, loadShortlist]);

  useEffect(() => {
    if (!data || campaignName) return;
    const product = data.research?.search.product?.trim();
    setCampaignName(product ? `${product} creator campaign` : data.shortlist.name.replace(/shortlist$/i, "campaign"));
  }, [campaignName, data]);

  const selectedEntries = useMemo(
    () => data?.entries.filter((entry) => entry.decision === "saved" || entry.decision === "restored") || [],
    [data]
  );
  const rejectedEntries = (data?.entries.length || 0) - selectedEntries.length;
  const locked = data?.shortlist.status === "approved" || data?.shortlist.status === "archived";

  const runMutation = async (key: string, request: () => Promise<Response>, successMessage: string) => {
    if (busyAction) return false;
    setBusyAction(key);
    setError("");
    setNotice("");
    try {
      const response = await request();
      const payload = await response.json().catch(() => null);
      if (!response.ok) throw new Error(payload?.error || "The workspace change could not be saved.");
      await loadShortlist();
      setNotice(successMessage);
      return true;
    } catch (mutationError) {
      setError(mutationError instanceof Error ? mutationError.message : "The workspace change could not be saved.");
      return false;
    } finally {
      setBusyAction("");
    }
  };

  const saveDecision = async (entryId: string, decision: ShortlistDecision, reasons: string[] = [], notes = "") => runMutation(
    `decision:${entryId}`,
    () => apiFetch(`/api/workspace/shortlists/${shortlistId}/entries/${entryId}`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ organizationId: auth.activeOrganization?.id, decision, reasons, notes })
    }),
    decision === "rejected" ? "Creator feedback saved." : "Creator restored to the shortlist."
  );

  const transition = async (status: ShortlistStatus) => runMutation(
    `status:${status}`,
    () => apiFetch(`/api/workspace/shortlists/${shortlistId}/transition`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ organizationId: auth.activeOrganization?.id, status })
    }),
    status === "review" ? "Shortlist moved to review." : status === "approved" ? "Shortlist approved." : "Shortlist status updated."
  );

  const submitRejection = async (event: FormEvent) => {
    event.preventDefault();
    if (!rejectEntryId) return;
    const saved = await saveDecision(rejectEntryId, "rejected", [rejectReason], rejectNotes);
    if (saved) {
      setRejectEntryId("");
      setRejectReason(rejectionReasons[0]);
      setRejectNotes("");
    }
  };

  const createCampaign = async (event: FormEvent) => {
    event.preventDefault();
    const budgetCents = budget.trim() ? Math.round(Number(budget) * 100) : null;
    if (budgetCents !== null && (!Number.isFinite(budgetCents) || budgetCents < 0)) {
      setError("Enter a valid creator budget.");
      return;
    }
    if (endsOn && startsOn && endsOn < startsOn) {
      setError("Campaign end date must follow its start date.");
      return;
    }
    if (busyAction) return;
    setBusyAction("campaign");
    setError("");
    try {
      const response = await apiFetch(`/api/workspace/shortlists/${shortlistId}/campaign`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          organizationId: auth.activeOrganization?.id,
          name: campaignName,
          creatorBudgetCents: budgetCents,
          startsOn: startsOn || undefined,
          endsOn: endsOn || undefined
        })
      });
      const payload = await response.json().catch(() => null);
      if (!response.ok) throw new Error(payload?.error || "The campaign could not be created.");
      navigate(`/campaign/${payload.campaignId}`);
    } catch (campaignError) {
      setError(campaignError instanceof Error ? campaignError.message : "The campaign could not be created.");
    } finally {
      setBusyAction("");
    }
  };

  if (!auth.configured || (!auth.loading && !auth.user)) {
    return <AuthScreen navigate={navigate} afterAuthPath={`/shortlist/${shortlistId}`} />;
  }
  if (auth.loading || auth.workspaceLoading) {
    return <div className="workspace-loading" role="status"><Loader2 className="h-5 w-5 animate-spin" /> Loading your shortlist...</div>;
  }
  if (!auth.activeOrganization) {
    return <div className="workspace-error" role="alert"><p>Your account is not connected to a workspace.</p><button type="button" onClick={() => void auth.refreshWorkspace()}>Retry</button></div>;
  }
  if (loading && !data) {
    return <div className="workspace-loading" role="status"><Loader2 className="h-5 w-5 animate-spin" /> Loading creator evidence...</div>;
  }
  if (!data) {
    return <div className="workspace-error" role="alert"><p>{error || "This shortlist is unavailable."}</p><button type="button" onClick={() => navigate("/shortlist")}>Return to shortlists</button></div>;
  }

  return (
    <section className="shortlist-detail-shell">
      <button className="detail-back-button" type="button" onClick={() => navigate("/shortlist")}>
        <ArrowLeft className="h-4 w-4" /> Shortlists
      </button>

      <header className="detail-heading">
        <div>
          <div className="detail-title-line">
            <h1>{data.shortlist.name}</h1>
            <span className={`workflow-status workflow-status-${data.shortlist.status}`}>{statusLabel(data.shortlist.status)}</span>
          </div>
          <p>{data.research?.search.product || "Source-backed creator research"} · Updated {formatDate(data.shortlist.updatedAt)}</p>
        </div>
        <div className="detail-actions">
          {data.shortlist.status === "draft" && data.permissions.canManage ? (
            <button className="primary-button" type="button" onClick={() => void transition("review")} disabled={Boolean(busyAction) || !selectedEntries.length}>
              {busyAction === "status:review" ? <Loader2 className="h-4 w-4 animate-spin" /> : <FileCheck2 className="h-4 w-4" />} Submit for review
            </button>
          ) : null}
          {data.shortlist.status === "review" && data.permissions.canApprove ? (
            <button className="primary-button" type="button" onClick={() => void transition("approved")} disabled={Boolean(busyAction)}>
              {busyAction === "status:approved" ? <Loader2 className="h-4 w-4 animate-spin" /> : <BadgeCheck className="h-4 w-4" />} Approve shortlist
            </button>
          ) : null}
          {data.shortlist.status === "review" && data.permissions.canManage ? (
            <button className="secondary-button" type="button" onClick={() => void transition("draft")} disabled={Boolean(busyAction)}>Withdraw review</button>
          ) : null}
          {data.shortlist.status === "approved" && data.permissions.canManage ? (
            data.shortlist.campaignId ? (
              <button className="primary-button" type="button" onClick={() => navigate(`/campaign/${data.shortlist.campaignId}`)}>Open campaign</button>
            ) : (
              <button className="primary-button" type="button" onClick={() => setCampaignOpen(true)}><FileCheck2 className="h-4 w-4" /> Create campaign</button>
            )
          ) : null}
          {data.shortlist.status === "approved" && data.permissions.canManage && !data.shortlist.campaignId ? (
            <button className="secondary-button" type="button" onClick={() => void transition("review")} disabled={Boolean(busyAction)}><RotateCcw className="h-4 w-4" /> Reopen review</button>
          ) : null}
        </div>
      </header>

      {notice ? <div className="notice" role="status"><BadgeCheck className="h-4 w-4" /><span>{notice}</span></div> : null}
      {error ? <div className="workspace-error" role="alert"><p>{error}</p><button type="button" onClick={() => setError("")}>Dismiss</button></div> : null}

      <div className="shortlist-summary-band" aria-label="Shortlist summary">
        <div><span>Selected</span><strong>{selectedEntries.length}</strong></div>
        <div><span>Rejected</span><strong>{rejectedEntries}</strong></div>
        <div><span>Evidence sources</span><strong>{data.entries.filter((entry) => entry.evidence).length}</strong></div>
        <div><span>Workspace role</span><strong>{data.permissions.role}</strong></div>
      </div>

      <div className="approval-strip">
        <span className="approval-strip-icon">{locked ? <LockKeyhole className="h-4 w-4" /> : <ShieldCheck className="h-4 w-4" />}</span>
        <div>
          <strong>{data.shortlist.status === "approved" ? `Approved ${formatDate(data.shortlist.approvedAt)}` : data.shortlist.status === "review" ? "Awaiting an authorized approver" : "Creator decisions remain editable"}</strong>
          <p>{locked ? "Approved creator decisions are locked to preserve the reviewed evidence set." : "Every rejection and status change is recorded in the workspace audit history."}</p>
        </div>
      </div>

      <section className="shortlist-roster">
        <header>
          <div><p className="eyebrow">Evidence-backed roster</p><h2>{data.entries.length} saved creators</h2></div>
          <span>{data.research?.sourceCount || data.entries.length} research sources</span>
        </header>
        <div className="shortlist-entry-list">
          {data.entries.map((entry) => {
            const creator = entry.creator;
            const score = entry.recommendation?.aiScore ?? entry.recommendation?.sourceScore;
            const isRejected = entry.decision === "rejected" || entry.decision === "archived";
            return (
              <article className={`shortlist-entry ${isRejected ? "shortlist-entry-rejected" : ""}`} key={entry.id}>
                <div className="shortlist-creator-identity">
                  <span className="shortlist-avatar">{initials(creator?.displayName || "Creator")}</span>
                  <div>
                    <div className="shortlist-name-line"><h3>{creator?.displayName || "Creator record unavailable"}</h3><span className={`decision-pill decision-pill-${entry.decision}`}>{decisionLabel(entry.decision)}</span></div>
                    <p>{creator?.handle ? `@${creator.handle} · ` : ""}{creator?.platform || "Unknown platform"} · {creator?.niche || "Niche not recorded"}</p>
                  </div>
                </div>
                <div className="shortlist-fit">
                  <span>Match</span>
                  <strong>{score === null || score === undefined ? "--" : Math.round(score)}</strong>
                  <small>{entry.recommendation?.confidence || entry.evidence?.confidence || "low"} confidence</small>
                </div>
                <div className="shortlist-evidence">
                  <span>Why this creator</span>
                  <p>{entry.recommendation?.matchReason || entry.evidence?.excerpt || "No recommendation explanation was saved."}</p>
                  {entry.evidence ? (
                    <a href={entry.evidence.sourceUrl} target="_blank" rel="noreferrer"><ExternalLink className="h-3.5 w-3.5" /> {entry.evidence.title}</a>
                  ) : <small>Evidence record unavailable</small>}
                  {entry.decisionReasons.length ? <small className="decision-reason">Reason: {entry.decisionReasons.join(", ")}{entry.notes ? ` · ${entry.notes}` : ""}</small> : null}
                </div>
                <div className="shortlist-entry-actions">
                  {data.permissions.canManage && !locked ? (
                    isRejected ? (
                      <button className="secondary-button" type="button" onClick={() => void saveDecision(entry.id, "restored")} disabled={Boolean(busyAction)}>
                        {busyAction === `decision:${entry.id}` ? <Loader2 className="h-4 w-4 animate-spin" /> : <RotateCcw className="h-4 w-4" />} Restore
                      </button>
                    ) : (
                      <button className="ghost-button" type="button" onClick={() => setRejectEntryId(entry.id)} disabled={Boolean(busyAction)}>Reject</button>
                    )
                  ) : <span className="locked-label"><LockKeyhole className="h-3.5 w-3.5" /> Locked</span>}
                </div>
              </article>
            );
          })}
        </div>
      </section>

      {rejectEntryId ? (
        <div className="dialog-backdrop" role="presentation" onMouseDown={(event) => event.target === event.currentTarget && setRejectEntryId("")}>
          <form className="workflow-dialog" role="dialog" aria-modal="true" aria-labelledby="reject-creator-title" onSubmit={submitRejection}>
            <header><div><p className="eyebrow">Decision feedback</p><h2 id="reject-creator-title">Reject this creator</h2></div><button className="ghost-icon-button" type="button" onClick={() => setRejectEntryId("")} aria-label="Close"><X className="h-5 w-5" /></button></header>
            <label><span>Primary reason</span><select value={rejectReason} onChange={(event) => setRejectReason(event.target.value)}>{rejectionReasons.map((reason) => <option key={reason}>{reason}</option>)}</select></label>
            <label><span>Decision notes</span><textarea value={rejectNotes} onChange={(event) => setRejectNotes(event.target.value)} maxLength={1000} placeholder="Optional context for the team" /></label>
            <footer><button className="ghost-button" type="button" onClick={() => setRejectEntryId("")}>Cancel</button><button className="primary-button" type="submit" disabled={Boolean(busyAction)}>{busyAction ? <Loader2 className="h-4 w-4 animate-spin" /> : null} Save rejection</button></footer>
          </form>
        </div>
      ) : null}

      {campaignOpen ? (
        <div className="dialog-backdrop" role="presentation" onMouseDown={(event) => event.target === event.currentTarget && setCampaignOpen(false)}>
          <form className="workflow-dialog workflow-dialog-wide" role="dialog" aria-modal="true" aria-labelledby="create-campaign-title" onSubmit={createCampaign}>
            <header><div><p className="eyebrow">Approved activation</p><h2 id="create-campaign-title">Create campaign</h2></div><button className="ghost-icon-button" type="button" onClick={() => setCampaignOpen(false)} aria-label="Close"><X className="h-5 w-5" /></button></header>
            <label><span>Campaign name</span><input value={campaignName} onChange={(event) => setCampaignName(event.target.value)} required maxLength={160} /></label>
            <div className="workflow-form-grid">
              <label><span><CircleDollarSign className="h-3.5 w-3.5" /> Creator budget (USD)</span><input type="number" min="0" step="1" value={budget} onChange={(event) => setBudget(event.target.value)} placeholder="5000" /></label>
              <label><span><CalendarDays className="h-3.5 w-3.5" /> Start date</span><input type="date" value={startsOn} onChange={(event) => setStartsOn(event.target.value)} /></label>
              <label><span><CalendarDays className="h-3.5 w-3.5" /> End date</span><input type="date" value={endsOn} min={startsOn || undefined} onChange={(event) => setEndsOn(event.target.value)} /></label>
            </div>
            <div className="campaign-conversion-summary"><BadgeCheck className="h-4 w-4" /><span>{selectedEntries.length} approved creators and their source evidence will remain linked to this campaign.</span></div>
            <footer><button className="ghost-button" type="button" onClick={() => setCampaignOpen(false)}>Cancel</button><button className="primary-button" type="submit" disabled={Boolean(busyAction)}>{busyAction === "campaign" ? <Loader2 className="h-4 w-4 animate-spin" /> : <FileCheck2 className="h-4 w-4" />} Create campaign</button></footer>
          </form>
        </div>
      ) : null}
    </section>
  );
}
