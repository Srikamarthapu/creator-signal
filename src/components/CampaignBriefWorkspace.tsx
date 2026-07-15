import {
  AlertTriangle,
  Check,
  CheckCircle2,
  ClipboardCheck,
  ExternalLink,
  FilePenLine,
  Loader2,
  LockKeyhole,
  RefreshCcw,
  Save,
  Send,
  Sparkles,
  X
} from "lucide-react";
import { type FormEvent, useCallback, useEffect, useMemo, useState } from "react";
import { apiFetch } from "../lib/api";
import type {
  CampaignAgentMessage,
  CampaignBriefContent,
  CampaignBriefPermissions,
  CampaignBriefRecord,
  CampaignBriefStatus,
  ResearchSessionMeta
} from "../lib/types";
import { useAuth } from "./AuthProvider";

type CampaignBriefResponse = {
  campaignBrief: CampaignBriefRecord | null;
  permissions: CampaignBriefPermissions;
};

type CampaignBriefGenerationResponse = {
  campaignBrief: CampaignBriefRecord;
  providerUsed: boolean;
  model: string;
  note: string;
  grounded: true;
};

function formatLabel(value: string) {
  return value.replace(/_/g, " ").replace(/\b\w/g, (letter: string) => letter.toUpperCase());
}

function formatDate(value: string | null) {
  if (!value) return "Not yet";
  return new Intl.DateTimeFormat(undefined, {
    month: "short",
    day: "numeric",
    year: "numeric",
    hour: "numeric",
    minute: "2-digit"
  }).format(new Date(value));
}

function listText(values: string[]) {
  return values.join("\n");
}

function parseList(value: string, maxItems: number) {
  return [...new Set(value.split(/\n|;/).map((item) => item.trim()).filter(Boolean))].slice(0, maxItems);
}

async function readApi<T>(response: Response, fallback: string): Promise<T> {
  const payload = await response.json().catch(() => null);
  if (!response.ok) throw new Error(payload?.error || fallback);
  return payload as T;
}

function BriefField({ label, value }: { label: string; value: string }) {
  return <div className="campaign-brief-field"><small>{label}</small><p>{value}</p></div>;
}

function BriefList({ label, values }: { label: string; values: string[] }) {
  return (
    <div className="campaign-brief-field">
      <small>{label}</small>
      <ul>{values.map((value) => <li key={value}>{value}</li>)}</ul>
    </div>
  );
}

export function CampaignBriefWorkspace({
  session,
  messages,
  navigate
}: {
  session: ResearchSessionMeta;
  messages: CampaignAgentMessage[];
  navigate: (path: string) => void;
}) {
  const auth = useAuth();
  const [record, setRecord] = useState<CampaignBriefRecord | null>(null);
  const [permissions, setPermissions] = useState<CampaignBriefPermissions | null>(null);
  const [draft, setDraft] = useState<CampaignBriefContent | null>(null);
  const [editing, setEditing] = useState(false);
  const [loading, setLoading] = useState(false);
  const [working, setWorking] = useState("");
  const [error, setError] = useState("");
  const [success, setSuccess] = useState("");

  const loadBrief = useCallback(async () => {
    if (!auth.activeOrganization || !auth.user) return;
    setLoading(true);
    setError("");
    try {
      const query = new URLSearchParams({ organizationId: auth.activeOrganization.id });
      const data = await readApi<CampaignBriefResponse>(
        await apiFetch(`/api/workspace/research/${session.id}/campaign-brief?${query}`),
        "The campaign brief could not be loaded."
      );
      setRecord(data.campaignBrief);
      setPermissions(data.permissions);
      setDraft(data.campaignBrief?.brief || null);
    } catch (loadError) {
      setError(loadError instanceof Error ? loadError.message : "The campaign brief could not be loaded.");
    } finally {
      setLoading(false);
    }
  }, [auth.activeOrganization, auth.user, session.id]);

  useEffect(() => {
    setRecord(null);
    setPermissions(null);
    setDraft(null);
    setEditing(false);
    setError("");
    setSuccess("");
    void loadBrief();
  }, [loadBrief]);

  const clearMessages = () => {
    setError("");
    setSuccess("");
  };

  const generateBrief = async () => {
    if (!auth.activeOrganization || working) return;
    if (record && !globalThis.confirm("Replace the current draft with a new version based on this conversation?")) return;
    clearMessages();
    setWorking("generate");
    try {
      const generated = await readApi<CampaignBriefGenerationResponse>(await apiFetch(
        `/api/workspace/research/${session.id}/campaign-brief/generate`,
        {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            organizationId: auth.activeOrganization.id,
            messages: messages.slice(-16).map((message) => ({ role: message.role, content: message.content }))
          })
        }
      ), "The campaign brief could not be prepared.");
      setRecord(generated.campaignBrief);
      setDraft(generated.campaignBrief.brief);
      setEditing(false);
      setSuccess(generated.providerUsed ? "Grounded draft prepared with GLM 5.2." : "Conservative source-only draft prepared.");
    } catch (generateError) {
      setError(generateError instanceof Error ? generateError.message : "The campaign brief could not be prepared.");
    } finally {
      setWorking("");
    }
  };

  const saveDraft = async (event: FormEvent) => {
    event.preventDefault();
    if (!auth.activeOrganization || !draft || working) return;
    clearMessages();
    setWorking("save");
    try {
      const data = await readApi<{ campaignBrief: CampaignBriefRecord }>(await apiFetch(
        `/api/workspace/research/${session.id}/campaign-brief`,
        {
          method: "PATCH",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ organizationId: auth.activeOrganization.id, brief: draft })
        }
      ), "The campaign brief could not be saved.");
      setRecord(data.campaignBrief);
      setDraft(data.campaignBrief.brief);
      setEditing(false);
      setSuccess(`Version ${data.campaignBrief.version} saved as a draft.`);
    } catch (saveError) {
      setError(saveError instanceof Error ? saveError.message : "The campaign brief could not be saved.");
    } finally {
      setWorking("");
    }
  };

  const transition = async (status: CampaignBriefStatus) => {
    if (!auth.activeOrganization || working) return;
    const needsConfirmation = status === "approved" || status === "rejected" || (status === "draft" && record?.status === "approved");
    if (needsConfirmation && !globalThis.confirm(
      status === "approved"
        ? "Approve this campaign brief for the workspace?"
        : status === "rejected"
          ? "Reject this brief and return it for revision?"
          : "Reopen this approved brief as a draft? The current approval marker will be cleared."
    )) return;
    clearMessages();
    setWorking(`status:${status}`);
    try {
      const data = await readApi<{ campaignBrief: CampaignBriefRecord }>(await apiFetch(
        `/api/workspace/research/${session.id}/campaign-brief/transition`,
        {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ organizationId: auth.activeOrganization.id, status })
        }
      ), "The campaign brief status could not be changed.");
      setRecord(data.campaignBrief);
      setDraft(data.campaignBrief.brief);
      setEditing(false);
      setSuccess(
        status === "review"
          ? "Campaign brief submitted for review."
          : status === "approved"
            ? "Campaign brief approved."
            : status === "rejected"
              ? "Campaign brief returned for revision."
              : "Campaign brief reopened as a draft."
      );
    } catch (transitionError) {
      setError(transitionError instanceof Error ? transitionError.message : "The campaign brief status could not be changed.");
    } finally {
      setWorking("");
    }
  };

  const canEditCurrent = permissions?.canEdit && record && ["draft", "rejected"].includes(record.status);
  const statusActions = useMemo(() => {
    if (!record || !permissions) return null;
    if (["draft", "rejected"].includes(record.status) && permissions.canEdit) {
      return <button className="primary-button" type="button" disabled={Boolean(working)} onClick={() => void transition("review")}><Send className="h-4 w-4" /> Submit for review</button>;
    }
    if (record.status === "review") {
      return (
        <>
          {permissions.canApprove ? <button className="primary-button" type="button" disabled={Boolean(working)} onClick={() => void transition("approved")}><Check className="h-4 w-4" /> Approve</button> : null}
          {permissions.canApprove ? <button className="secondary-button campaign-brief-reject" type="button" disabled={Boolean(working)} onClick={() => void transition("rejected")}><X className="h-4 w-4" /> Reject</button> : null}
          {permissions.canEdit ? <button className="secondary-button" type="button" disabled={Boolean(working)} onClick={() => void transition("draft")}><RefreshCcw className="h-4 w-4" /> Withdraw</button> : null}
        </>
      );
    }
    if (record.status === "approved" && permissions.canEdit) {
      return <button className="secondary-button" type="button" disabled={Boolean(working)} onClick={() => void transition("draft")}><FilePenLine className="h-4 w-4" /> Reopen draft</button>;
    }
    return null;
  }, [permissions, record, working]);

  if (!auth.user || !auth.activeOrganization) {
    return (
      <div className="campaign-brief-empty">
        <span><LockKeyhole className="h-5 w-5" /></span>
        <h3>Sign in to prepare a brief</h3>
        <p>Campaign briefs are saved to a private workspace and require human approval.</p>
        <button className="primary-button" type="button" onClick={() => navigate("/auth")}>Sign in</button>
      </div>
    );
  }

  if (loading && !permissions) {
    return <div className="campaign-brief-loading"><Loader2 className="h-5 w-5 animate-spin" /> Opening campaign brief...</div>;
  }

  if (!record) {
    return (
      <div className="campaign-brief-empty">
        <span><ClipboardCheck className="h-5 w-5" /></span>
        <h3>No campaign brief yet</h3>
        <p>The draft will use this conversation, search context, and current source evidence. Unresolved decisions remain labeled.</p>
        {error ? <div className="copilot-error" role="alert"><p>{error}</p></div> : null}
        {permissions?.canEdit ? (
          <button className="primary-button" type="button" disabled={working === "generate"} onClick={() => void generateBrief()}>
            {working === "generate" ? <Loader2 className="h-4 w-4 animate-spin" /> : <Sparkles className="h-4 w-4" />}
            Prepare draft
          </button>
        ) : <p className="campaign-brief-role-note">A workspace manager must prepare the first draft.</p>}
      </div>
    );
  }

  return (
    <div className="campaign-brief-workspace">
      <header className="campaign-brief-heading">
        <div>
          <div className="campaign-brief-title-line">
            <h3>{record.brief.campaignName}</h3>
            <span className={`campaign-brief-status campaign-brief-status-${record.status}`}>{formatLabel(record.status)}</span>
          </div>
          <p>Version {record.version} · {record.provider === "nvidia" ? "GLM 5.2 draft" : record.provider === "user" ? "Human edited" : "Source-only draft"} · Updated {formatDate(record.updatedAt)}</p>
        </div>
        {canEditCurrent && !editing ? (
          <button className="ghost-icon-button" type="button" onClick={() => { setDraft(record.brief); setEditing(true); }} aria-label="Edit campaign brief" title="Edit campaign brief"><FilePenLine className="h-4 w-4" /></button>
        ) : null}
      </header>

      {error ? <div className="copilot-error" role="alert"><p>{error}</p><button type="button" onClick={() => setError("")}>Dismiss</button></div> : null}
      {success ? <div className="campaign-brief-success" role="status"><CheckCircle2 className="h-4 w-4" /> {success}</div> : null}

      {editing && draft ? (
        <form className="campaign-brief-form" onSubmit={saveDraft}>
          <label><span>Campaign name</span><input value={draft.campaignName} maxLength={160} required onChange={(event) => setDraft({ ...draft, campaignName: event.target.value })} /></label>
          <label><span>Objective</span><textarea value={draft.objective} maxLength={1000} required rows={3} onChange={(event) => setDraft({ ...draft, objective: event.target.value })} /></label>
          <label><span>Audience</span><textarea value={draft.audience} maxLength={500} required rows={2} onChange={(event) => setDraft({ ...draft, audience: event.target.value })} /></label>
          <div className="campaign-brief-form-grid">
            <label><span>Platforms</span><input value={draft.platforms.join(", ")} required onChange={(event) => setDraft({ ...draft, platforms: event.target.value.split(",").map((value) => value.trim()).filter(Boolean).slice(0, 4) })} /></label>
            <label><span>Geography</span><input value={draft.geography} maxLength={240} required onChange={(event) => setDraft({ ...draft, geography: event.target.value })} /></label>
            <label><span>Budget</span><input value={draft.budget.label} maxLength={120} required onChange={(event) => setDraft({ ...draft, budget: { ...draft.budget, label: event.target.value } })} /></label>
            <label><span>Creator spend</span><input value={draft.budget.creatorSpend} maxLength={240} required onChange={(event) => setDraft({ ...draft, budget: { ...draft.budget, creatorSpend: event.target.value } })} /></label>
            <label><span>Launch date</span><input value={draft.timing.launchDate} maxLength={120} required onChange={(event) => setDraft({ ...draft, timing: { ...draft.timing, launchDate: event.target.value } })} /></label>
            <label><span>Campaign window</span><input value={draft.timing.campaignWindow} maxLength={240} required onChange={(event) => setDraft({ ...draft, timing: { ...draft.timing, campaignWindow: event.target.value } })} /></label>
          </div>
          <label><span>Deliverables · one per line</span><textarea value={listText(draft.deliverables)} required rows={3} onChange={(event) => setDraft({ ...draft, deliverables: parseList(event.target.value, 8) })} /></label>
          <label><span>Creator criteria</span><textarea value={draft.creatorCriteria} maxLength={1000} required rows={3} onChange={(event) => setDraft({ ...draft, creatorCriteria: event.target.value })} /></label>
          <label><span>Key message</span><textarea value={draft.keyMessage} maxLength={1000} required rows={3} onChange={(event) => setDraft({ ...draft, keyMessage: event.target.value })} /></label>
          <label><span>Success measures · one per line</span><textarea value={listText(draft.successMeasures)} required rows={3} onChange={(event) => setDraft({ ...draft, successMeasures: parseList(event.target.value, 8) })} /></label>
          <label><span>Assumptions · one per line</span><textarea value={listText(draft.assumptions)} rows={4} onChange={(event) => setDraft({ ...draft, assumptions: parseList(event.target.value, 10) })} /></label>
          <div className="campaign-brief-form-actions">
            <button className="primary-button" type="submit" disabled={working === "save"}>{working === "save" ? <Loader2 className="h-4 w-4 animate-spin" /> : <Save className="h-4 w-4" />} Save draft</button>
            <button className="secondary-button" type="button" disabled={working === "save"} onClick={() => { setDraft(record.brief); setEditing(false); }}>Cancel</button>
          </div>
        </form>
      ) : (
        <div className="campaign-brief-readout">
          <section><BriefField label="Objective" value={record.brief.objective} /><BriefField label="Audience" value={record.brief.audience} /></section>
          <section className="campaign-brief-grid"><BriefField label="Platforms" value={record.brief.platforms.join(", ")} /><BriefField label="Geography" value={record.brief.geography} /><BriefField label="Budget" value={`${record.brief.budget.label} · ${record.brief.budget.creatorSpend}`} /><BriefField label="Timing" value={`${record.brief.timing.launchDate} · ${record.brief.timing.campaignWindow}`} /></section>
          <section><BriefList label="Deliverables" values={record.brief.deliverables} /><BriefField label="Creator criteria" value={record.brief.creatorCriteria} /><BriefField label="Key message" value={record.brief.keyMessage} /><BriefList label="Success measures" values={record.brief.successMeasures} /></section>
          <section className="campaign-brief-assumptions"><div><AlertTriangle className="h-4 w-4" /><strong>Assumptions requiring confirmation</strong></div><ul>{record.brief.assumptions.map((assumption) => <li key={assumption}>{assumption}</li>)}</ul></section>
          {record.citations.length ? <section className="campaign-brief-sources"><strong>Source references</strong>{record.citations.map((citation) => <a key={citation.id} href={citation.url} target="_blank" rel="noreferrer"><span>{citation.id}</span><span><b>{citation.creatorName || citation.title}</b><small>{citation.title}</small></span><ExternalLink className="h-3.5 w-3.5" /></a>)}</section> : null}
          {record.status === "approved" ? <section className="campaign-brief-approved"><CheckCircle2 className="h-4 w-4" /><p><strong>Approved</strong><small>{formatDate(record.approvedAt)}</small></p></section> : null}
        </div>
      )}

      {!editing ? (
        <footer className="campaign-brief-actions">
          <div>{statusActions}</div>
          {canEditCurrent ? <button className="secondary-button" type="button" disabled={Boolean(working)} onClick={() => void generateBrief()}><Sparkles className="h-4 w-4" /> Regenerate</button> : null}
        </footer>
      ) : null}
    </div>
  );
}
