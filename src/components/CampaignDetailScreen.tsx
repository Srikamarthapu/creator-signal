import {
  ArrowLeft,
  BadgeCheck,
  Check,
  CheckCircle2,
  ClipboardCheck,
  Copy,
  ExternalLink,
  FileText,
  History,
  ListTodo,
  Loader2,
  LockKeyhole,
  Mail,
  Plus,
  RefreshCcw,
  Send,
  ShieldCheck,
  Sparkles
} from "lucide-react";
import { type FormEvent, useCallback, useEffect, useMemo, useState } from "react";
import { apiFetch } from "../lib/api";
import type {
  CampaignDetailResponse,
  CampaignStatus,
  CampaignTaskStatus,
  OutreachApprovalStatus
} from "../lib/types";
import { AuthScreen } from "./AuthScreen";
import { useAuth } from "./AuthProvider";

const campaignStages: CampaignStatus[] = ["draft", "sourcing", "outreach", "negotiation", "contracted", "active", "review", "complete"];
const statusTransitions: Record<CampaignStatus, CampaignStatus[]> = {
  draft: ["sourcing", "cancelled"],
  sourcing: ["draft", "outreach", "cancelled"],
  outreach: ["sourcing", "negotiation", "active", "cancelled"],
  negotiation: ["outreach", "contracted", "cancelled"],
  contracted: ["negotiation", "active", "cancelled"],
  active: ["contracted", "review", "cancelled"],
  review: ["active", "complete", "cancelled"],
  complete: [],
  cancelled: []
};

function formatLabel(value: string) {
  return value.replace(/_/g, " ").replace(/^./, (letter) => letter.toUpperCase());
}

function formatDate(value: string | null | undefined) {
  if (!value) return "Not set";
  const date = /^\d{4}-\d{2}-\d{2}$/.test(value) ? new Date(`${value}T12:00:00`) : new Date(value);
  return new Intl.DateTimeFormat(undefined, { month: "short", day: "numeric", year: "numeric" }).format(date);
}

function formatMoney(cents: number | null, currency: string) {
  if (cents === null) return "Not set";
  return new Intl.NumberFormat(undefined, { style: "currency", currency, maximumFractionDigits: 0 }).format(cents / 100);
}

function activityLabel(eventType: string) {
  const labels: Record<string, string> = {
    "campaign.created_from_shortlist": "Campaign created from approved shortlist",
    "campaign.status_changed": "Campaign stage changed",
    "campaign.task_created": "Campaign task created",
    "campaign.task_status_changed": "Campaign task updated",
    "outreach.draft_created": "Grounded outreach draft created",
    "outreach.draft_edited": "Outreach draft edited",
    "outreach.approval_status_changed": "Outreach approval status changed"
  };
  return labels[eventType] || formatLabel(eventType.replace(/\./g, " "));
}

type DraftEdit = { subject: string; body: string };

export function CampaignDetailScreen({
  campaignId,
  navigate
}: {
  campaignId: string;
  navigate: (path: string) => void;
}) {
  const auth = useAuth();
  const [data, setData] = useState<CampaignDetailResponse | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");
  const [busyAction, setBusyAction] = useState("");
  const [taskTitle, setTaskTitle] = useState("");
  const [taskDueDate, setTaskDueDate] = useState("");
  const [draftEdits, setDraftEdits] = useState<Record<string, DraftEdit>>({});
  const [copiedDraftId, setCopiedDraftId] = useState("");

  const loadCampaign = useCallback(async (signal?: AbortSignal) => {
    if (!auth.activeOrganization) return;
    setLoading(true);
    setError("");
    try {
      const response = await apiFetch(`/api/workspace/campaigns/${campaignId}?organizationId=${encodeURIComponent(auth.activeOrganization.id)}`, { signal });
      const payload = await response.json().catch(() => null);
      if (!response.ok) throw new Error(payload?.error || "The campaign could not be loaded.");
      setData(payload as CampaignDetailResponse);
    } catch (loadError) {
      if (loadError instanceof Error && loadError.name === "AbortError") return;
      setError(loadError instanceof Error ? loadError.message : "The campaign could not be loaded.");
    } finally {
      if (!signal?.aborted) setLoading(false);
    }
  }, [auth.activeOrganization, campaignId]);

  useEffect(() => {
    if (!auth.activeOrganization) return;
    const controller = new AbortController();
    void loadCampaign(controller.signal);
    return () => controller.abort();
  }, [auth.activeOrganization, loadCampaign]);

  useEffect(() => {
    if (!data) return;
    setDraftEdits((current) => {
      const next = { ...current };
      for (const draft of data.outreachDrafts) {
        if (!next[draft.id]) next[draft.id] = { subject: draft.subject || "", body: draft.body };
      }
      return next;
    });
  }, [data]);

  const runMutation = async (key: string, request: () => Promise<Response>, successMessage: string) => {
    if (busyAction) return false;
    setBusyAction(key);
    setError("");
    setNotice("");
    try {
      const response = await request();
      const payload = await response.json().catch(() => null);
      if (!response.ok) throw new Error(payload?.error || "The campaign change could not be saved.");
      await loadCampaign();
      setNotice(successMessage);
      return payload;
    } catch (mutationError) {
      setError(mutationError instanceof Error ? mutationError.message : "The campaign change could not be saved.");
      return false;
    } finally {
      setBusyAction("");
    }
  };

  const changeCampaignStatus = (status: CampaignStatus) => runMutation(
    `campaign-status:${status}`,
    () => apiFetch(`/api/workspace/campaigns/${campaignId}/status`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ organizationId: auth.activeOrganization?.id, status })
    }),
    `Campaign moved to ${formatLabel(status).toLowerCase()}.`
  );

  const createTask = async (event: FormEvent) => {
    event.preventDefault();
    const dueAt = taskDueDate ? new Date(`${taskDueDate}T17:00:00`).toISOString() : null;
    const saved = await runMutation(
      "task:create",
      () => apiFetch(`/api/workspace/campaigns/${campaignId}/tasks`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ organizationId: auth.activeOrganization?.id, title: taskTitle, dueAt })
      }),
      "Campaign task created."
    );
    if (saved) {
      setTaskTitle("");
      setTaskDueDate("");
    }
  };

  const changeTaskStatus = (taskId: string, status: CampaignTaskStatus) => runMutation(
    `task:${taskId}`,
    () => apiFetch(`/api/workspace/campaigns/${campaignId}/tasks/${taskId}`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ organizationId: auth.activeOrganization?.id, status })
    }),
    "Task status updated."
  );

  const generateOutreach = (creatorId: string) => runMutation(
    `generate:${creatorId}`,
    () => apiFetch(`/api/workspace/campaigns/${campaignId}/outreach-drafts`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ organizationId: auth.activeOrganization?.id, creatorId })
    }),
    "A grounded outreach draft was created. Nothing was sent."
  );

  const saveDraft = (draftId: string) => {
    const edit = draftEdits[draftId];
    if (!edit) return Promise.resolve(false);
    return runMutation(
      `draft-edit:${draftId}`,
      () => apiFetch(`/api/workspace/campaigns/${campaignId}/outreach-drafts/${draftId}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ organizationId: auth.activeOrganization?.id, subject: edit.subject, body: edit.body })
      }),
      "Outreach edits saved."
    );
  };

  const transitionDraft = (draftId: string, status: OutreachApprovalStatus) => runMutation(
    `draft-status:${draftId}:${status}`,
    () => apiFetch(`/api/workspace/campaigns/${campaignId}/outreach-drafts/${draftId}/transition`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ organizationId: auth.activeOrganization?.id, status })
    }),
    status === "approved" ? "Outreach approved for manual use." : status === "review" ? "Outreach submitted for review." : "Outreach approval status updated."
  );

  const copyDraft = async (draftId: string) => {
    const edit = draftEdits[draftId];
    if (!edit) return;
    try {
      await navigator.clipboard.writeText(`${edit.subject ? `Subject: ${edit.subject}\n\n` : ""}${edit.body}`);
      setCopiedDraftId(draftId);
      window.setTimeout(() => setCopiedDraftId(""), 1600);
    } catch {
      setError("The outreach draft could not be copied.");
    }
  };

  const selectedCreators = data?.shortlist?.entries.filter((entry) => entry.creator && ["saved", "restored"].includes(entry.decision)) || [];
  const completedTasks = data?.tasks.filter((task) => ["done", "cancelled"].includes(task.status)).length || 0;
  const approvedDrafts = data?.outreachDrafts.filter((draft) => draft.approvalStatus === "approved").length || 0;
  const currentStageIndex = data ? campaignStages.indexOf(data.campaign.status) : -1;
  const latestDraftByCreator = useMemo(() => {
    const map = new Map<string, CampaignDetailResponse["outreachDrafts"][number]>();
    for (const draft of data?.outreachDrafts || []) {
      if (!map.has(draft.creatorId)) map.set(draft.creatorId, draft);
    }
    return map;
  }, [data]);

  if (!auth.configured || (!auth.loading && !auth.user)) {
    return <AuthScreen navigate={navigate} afterAuthPath={`/campaign/${campaignId}`} />;
  }
  if (auth.loading || auth.workspaceLoading) {
    return <div className="workspace-loading" role="status"><Loader2 className="h-5 w-5 animate-spin" /> Loading your campaign...</div>;
  }
  if (!auth.activeOrganization) {
    return <div className="workspace-error" role="alert"><p>Your account is not connected to a workspace.</p><button type="button" onClick={() => void auth.refreshWorkspace()}>Retry</button></div>;
  }
  if (loading && !data) {
    return <div className="workspace-loading" role="status"><Loader2 className="h-5 w-5 animate-spin" /> Loading campaign operations...</div>;
  }
  if (!data) {
    return <div className="workspace-error" role="alert"><p>{error || "This campaign is unavailable."}</p><button type="button" onClick={() => navigate("/campaigns")}>Return to campaigns</button></div>;
  }

  return (
    <section className="campaign-detail-shell">
      <button className="detail-back-button" type="button" onClick={() => navigate("/campaigns")}><ArrowLeft className="h-4 w-4" /> Campaigns</button>

      <header className="detail-heading campaign-detail-heading">
        <div>
          <div className="detail-title-line"><h1>{data.campaign.name}</h1><span className={`campaign-stage-pill campaign-stage-${data.campaign.status}`}>{formatLabel(data.campaign.status)}</span></div>
          <p>{data.campaign.product} · {data.campaign.goal || "Goal not set"} · {data.campaign.platform || "Any platform"}</p>
        </div>
        {data.permissions.canManage && statusTransitions[data.campaign.status].length ? (
          <label className="stage-selector">
            <span>Move stage</span>
            <select value="" onChange={(event) => event.target.value && void changeCampaignStatus(event.target.value as CampaignStatus)} disabled={Boolean(busyAction)}>
              <option value="" disabled>Choose next stage</option>
              {statusTransitions[data.campaign.status].map((status) => <option value={status} key={status}>{formatLabel(status)}</option>)}
            </select>
          </label>
        ) : null}
      </header>

      {notice ? <div className="notice" role="status"><Check className="h-4 w-4" /><span>{notice}</span></div> : null}
      {error ? <div className="workspace-error" role="alert"><p>{error}</p><button type="button" onClick={() => setError("")}>Dismiss</button></div> : null}

      <div className="campaign-stage-track" aria-label="Campaign progress">
        {campaignStages.map((stage, index) => (
          <div className={index < currentStageIndex ? "campaign-stage-step campaign-stage-step-done" : index === currentStageIndex ? "campaign-stage-step campaign-stage-step-current" : "campaign-stage-step"} key={stage}>
            <span>{index < currentStageIndex ? <Check className="h-3.5 w-3.5" /> : index + 1}</span>
            <small>{formatLabel(stage)}</small>
          </div>
        ))}
      </div>

      <div className="campaign-summary-band" aria-label="Campaign summary">
        <div><span>Approved creators</span><strong>{selectedCreators.length}</strong></div>
        <div><span>Tasks complete</span><strong>{completedTasks}/{data.tasks.length}</strong></div>
        <div><span>Outreach approved</span><strong>{approvedDrafts}</strong></div>
        <div><span>Creator budget</span><strong>{formatMoney(data.campaign.creatorBudgetCents, data.campaign.currency)}</strong></div>
        <div><span>Campaign dates</span><strong>{formatDate(data.campaign.startsOn)} - {formatDate(data.campaign.endsOn)}</strong></div>
      </div>

      <div className="campaign-workspace-grid">
        <div className="campaign-primary-column">
          <section className="campaign-section">
            <header><div><p className="eyebrow">Approved roster</p><h2>Creator activation</h2></div>{data.shortlist ? <button className="section-link-button" type="button" onClick={() => navigate(`/shortlist/${data.shortlist?.shortlist.id}`)}>Open shortlist <ExternalLink className="h-3.5 w-3.5" /></button> : null}</header>
            {selectedCreators.length ? (
              <div className="campaign-creator-list">
                {selectedCreators.map((entry) => {
                  const creator = entry.creator!;
                  const latestDraft = latestDraftByCreator.get(creator.id);
                  return (
                    <div className="campaign-creator-row" key={entry.id}>
                      <span className="campaign-creator-avatar">{creator.displayName.split(/\s+/).map((part) => part[0]).join("").slice(0, 2).toUpperCase()}</span>
                      <div><strong>{creator.displayName}</strong><small>{creator.handle ? `@${creator.handle} · ` : ""}{creator.platform} · {creator.niche || "Creator"}</small></div>
                      <span className={`outreach-mini-status outreach-mini-${latestDraft?.approvalStatus || "none"}`}>{latestDraft ? formatLabel(latestDraft.approvalStatus) : "No draft"}</span>
                      {data.permissions.canManage ? (
                        <button className="secondary-button" type="button" onClick={() => void generateOutreach(creator.id)} disabled={Boolean(busyAction)}>
                          {busyAction === `generate:${creator.id}` ? <Loader2 className="h-4 w-4 animate-spin" /> : latestDraft ? <RefreshCcw className="h-4 w-4" /> : <Sparkles className="h-4 w-4" />} {latestDraft ? "New draft" : "Draft outreach"}
                        </button>
                      ) : null}
                    </div>
                  );
                })}
              </div>
            ) : <div className="campaign-empty"><ShieldCheck className="h-5 w-5" /><div><strong>No approved creators</strong><p>Connect an approved source-backed shortlist before preparing outreach.</p></div></div>}
          </section>

          <section className="campaign-section">
            <header><div><p className="eyebrow">Human-reviewed communication</p><h2>Outreach drafts</h2></div><span className="no-send-label"><LockKeyhole className="h-3.5 w-3.5" /> Nothing sends automatically</span></header>
            {data.outreachDrafts.length ? (
              <div className="outreach-draft-list">
                {data.outreachDrafts.map((draft) => {
                  const editable = data.permissions.canManage && ["draft", "rejected"].includes(draft.approvalStatus);
                  const edit = draftEdits[draft.id] || { subject: draft.subject || "", body: draft.body };
                  const dirty = edit.subject !== (draft.subject || "") || edit.body !== draft.body;
                  return (
                    <article className="outreach-draft" key={draft.id}>
                      <header>
                        <div><span className="outreach-draft-icon"><Mail className="h-4 w-4" /></span><div><strong>{draft.creator?.displayName || "Creator outreach"}</strong><small>Created {formatDate(draft.createdAt)}</small></div></div>
                        <span className={`approval-pill approval-pill-${draft.approvalStatus}`}>{formatLabel(draft.approvalStatus)}</span>
                      </header>
                      <div className="outreach-editor">
                        <label><span>Subject</span><input value={edit.subject} readOnly={!editable} onChange={(event) => setDraftEdits((current) => ({ ...current, [draft.id]: { ...edit, subject: event.target.value } }))} maxLength={160} /></label>
                        <label><span>Message</span><textarea value={edit.body} readOnly={!editable} onChange={(event) => setDraftEdits((current) => ({ ...current, [draft.id]: { ...edit, body: event.target.value } }))} maxLength={6000} /></label>
                      </div>
                      <div className="draft-source-row">
                        <span><ShieldCheck className="h-3.5 w-3.5" /> {draft.sourceReferences.length} saved Bright Data source{draft.sourceReferences.length === 1 ? "" : "s"}</span>
                        {draft.sourceReferences.map((source) => <a key={`${draft.id}-${source.url}`} href={source.url} target="_blank" rel="noreferrer">{source.title}<ExternalLink className="h-3 w-3" /></a>)}
                      </div>
                      <footer>
                        <div>
                          {editable && dirty ? <button className="secondary-button" type="button" onClick={() => void saveDraft(draft.id)} disabled={Boolean(busyAction)}>{busyAction === `draft-edit:${draft.id}` ? <Loader2 className="h-4 w-4 animate-spin" /> : <FileText className="h-4 w-4" />} Save edits</button> : null}
                          {data.permissions.canManage && ["draft", "rejected"].includes(draft.approvalStatus) && !dirty ? <button className="primary-button" type="button" onClick={() => void transitionDraft(draft.id, "review")} disabled={Boolean(busyAction)}><Send className="h-4 w-4" /> Submit for review</button> : null}
                          {data.permissions.canManage && draft.approvalStatus === "review" ? <button className="secondary-button" type="button" onClick={() => void transitionDraft(draft.id, "draft")} disabled={Boolean(busyAction)}>Withdraw review</button> : null}
                          {data.permissions.canApprove && draft.approvalStatus === "review" ? <><button className="primary-button" type="button" onClick={() => void transitionDraft(draft.id, "approved")} disabled={Boolean(busyAction)}><BadgeCheck className="h-4 w-4" /> Approve</button><button className="ghost-button" type="button" onClick={() => void transitionDraft(draft.id, "rejected")} disabled={Boolean(busyAction)}>Reject</button></> : null}
                        </div>
                        {draft.approvalStatus === "approved" ? <button className="ghost-button" type="button" onClick={() => void copyDraft(draft.id)}><Copy className="h-4 w-4" /> {copiedDraftId === draft.id ? "Copied" : "Copy approved draft"}</button> : <span className="approval-required-label"><LockKeyhole className="h-3.5 w-3.5" /> Approval required before copy</span>}
                      </footer>
                    </article>
                  );
                })}
              </div>
            ) : <div className="campaign-empty"><Mail className="h-5 w-5" /><div><strong>No outreach drafts</strong><p>Create one from an approved creator to retain its exact supporting source.</p></div></div>}
          </section>
        </div>

        <aside className="campaign-side-column">
          <section className="campaign-side-section">
            <header><ListTodo className="h-4 w-4" /><h2>Tasks</h2><span>{completedTasks}/{data.tasks.length}</span></header>
            {data.permissions.canManage ? (
              <form className="task-create-form" onSubmit={createTask}>
                <input value={taskTitle} onChange={(event) => setTaskTitle(event.target.value)} required maxLength={240} placeholder="Add a campaign task" aria-label="Task title" />
                <input type="date" value={taskDueDate} onChange={(event) => setTaskDueDate(event.target.value)} aria-label="Task due date" />
                <button className="ghost-icon-button" type="submit" aria-label="Add task" title="Add task" disabled={Boolean(busyAction)}>{busyAction === "task:create" ? <Loader2 className="h-4 w-4 animate-spin" /> : <Plus className="h-4 w-4" />}</button>
              </form>
            ) : null}
            <div className="campaign-task-list">
              {data.tasks.map((task) => (
                <div className={`campaign-task campaign-task-${task.status}`} key={task.id}>
                  <button type="button" className="task-check" onClick={() => data.permissions.canManage && void changeTaskStatus(task.id, task.status === "done" ? "open" : "done")} disabled={!data.permissions.canManage || Boolean(busyAction)} aria-label={task.status === "done" ? `Reopen ${task.title}` : `Complete ${task.title}`}>
                    {task.status === "done" ? <CheckCircle2 className="h-4 w-4" /> : <span />}
                  </button>
                  <div><strong>{task.title}</strong><small>{task.dueAt ? `Due ${formatDate(task.dueAt)}` : "No due date"}</small></div>
                  {data.permissions.canManage ? <select value={task.status} onChange={(event) => void changeTaskStatus(task.id, event.target.value as CampaignTaskStatus)} disabled={Boolean(busyAction)} aria-label={`Status for ${task.title}`}><option value="open">Open</option><option value="in_progress">In progress</option><option value="blocked">Blocked</option><option value="done">Done</option><option value="cancelled">Cancelled</option></select> : <span className="task-read-status">{formatLabel(task.status)}</span>}
                </div>
              ))}
            </div>
          </section>

          <section className="campaign-side-section">
            <header><ClipboardCheck className="h-4 w-4" /><h2>Brief</h2></header>
            <dl className="campaign-brief-list"><div><dt>Audience</dt><dd>{data.campaign.audience || "Not set"}</dd></div><div><dt>Deliverable</dt><dd>{data.campaign.deliverable || "Not set"}</dd></div><div><dt>Geography</dt><dd>{data.campaign.geography || "Not set"}</dd></div><div><dt>Dates</dt><dd>{formatDate(data.campaign.startsOn)} - {formatDate(data.campaign.endsOn)}</dd></div></dl>
          </section>

          <section className="campaign-side-section">
            <header><History className="h-4 w-4" /><h2>Recent activity</h2></header>
            <div className="campaign-activity-list">
              {data.activity.length ? data.activity.slice(0, 10).map((activity) => <div key={activity.id}><span /><p><strong>{activityLabel(activity.eventType)}</strong><small>{formatDate(activity.createdAt)}</small></p></div>) : <p className="campaign-side-empty">No campaign activity yet.</p>}
            </div>
          </section>
        </aside>
      </div>
    </section>
  );
}
