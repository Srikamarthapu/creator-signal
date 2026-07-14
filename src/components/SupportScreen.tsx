import {
  Activity,
  AlertTriangle,
  CheckCircle2,
  Clock3,
  DatabaseZap,
  Gauge,
  Loader2,
  RefreshCcw,
  Save,
  ShieldAlert,
  SlidersHorizontal,
  UsersRound,
  X
} from "lucide-react";
import { useCallback, useEffect, useMemo, useState } from "react";
import { apiFetch } from "../lib/api";
import { AuthScreen } from "./AuthScreen";
import { useAuth } from "./AuthProvider";

type ProviderJobStatus = "running" | "complete" | "degraded" | "failed";
type EntitlementPlan = "pilot" | "starter" | "growth" | "enterprise" | "internal";
type EntitlementStatus = "trialing" | "active" | "past_due" | "suspended" | "cancelled";

type ProviderJob = {
  id: string;
  organizationId: string;
  organizationName: string;
  requestedByEmail: string | null;
  provider: "bright_data" | "nvidia" | "source_retrieval";
  operation: string;
  status: ProviderJobStatus;
  model: string | null;
  latencyMs: number | null;
  sourceCount: number;
  errorCategory: string | null;
  errorSummary: string | null;
  createdAt: string;
};

type Entitlement = {
  organizationId: string;
  organizationName: string;
  plan: EntitlementPlan;
  status: EntitlementStatus;
  seatLimit: number;
  researchRunsLimit: number;
  researchRunsUsed: number;
  startsAt: string;
  endsAt: string | null;
  updatedAt: string;
};

type SupportDashboard = {
  summary: {
    jobsLast24Hours: number;
    completeLast24Hours: number;
    degradedLast24Hours: number;
    failedLast24Hours: number;
    workspaces: number;
    restrictedWorkspaces: number;
  };
  jobs: ProviderJob[];
  entitlements: Entitlement[];
};

type EntitlementDraft = {
  plan: EntitlementPlan;
  status: EntitlementStatus;
  seatLimit: number;
  researchRunsLimit: number;
  endsAt: string;
};

const planOptions: EntitlementPlan[] = ["pilot", "starter", "growth", "enterprise", "internal"];
const statusOptions: EntitlementStatus[] = ["trialing", "active", "past_due", "suspended", "cancelled"];

function formatLabel(value: string) {
  return value.replace(/_/g, " ").replace(/\b\w/g, (letter: string) => letter.toUpperCase());
}

function formatDateTime(value: string | null) {
  if (!value) return "No end date";
  return new Intl.DateTimeFormat(undefined, {
    month: "short",
    day: "numeric",
    year: "numeric",
    hour: "numeric",
    minute: "2-digit"
  }).format(new Date(value));
}

function dateTimeInputValue(value: string | null) {
  if (!value) return "";
  const date = new Date(value);
  const local = new Date(date.getTime() - date.getTimezoneOffset() * 60_000);
  return local.toISOString().slice(0, 16);
}

function formatLatency(value: number | null) {
  if (value === null) return "In progress";
  if (value < 1000) return `${value} ms`;
  return `${(value / 1000).toFixed(value >= 10_000 ? 0 : 1)} s`;
}

async function readApi<T>(response: Response, fallback: string): Promise<T> {
  const payload = await response.json().catch(() => null);
  if (!response.ok) throw new Error(payload?.error || fallback);
  return payload as T;
}

function entitlementDraft(entitlement: Entitlement): EntitlementDraft {
  return {
    plan: entitlement.plan,
    status: entitlement.status,
    seatLimit: entitlement.seatLimit,
    researchRunsLimit: entitlement.researchRunsLimit,
    endsAt: dateTimeInputValue(entitlement.endsAt)
  };
}

export function SupportScreen({ navigate }: { navigate: (path: string) => void }) {
  const auth = useAuth();
  const [dashboard, setDashboard] = useState<SupportDashboard | null>(null);
  const [attentionOnly, setAttentionOnly] = useState(false);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");
  const [success, setSuccess] = useState("");
  const [editingId, setEditingId] = useState("");
  const [draft, setDraft] = useState<EntitlementDraft | null>(null);
  const [saving, setSaving] = useState(false);

  const platformRole = auth.user?.app_metadata?.platform_role;
  const isOperator = platformRole === "operator" || platformRole === "admin";

  const loadDashboard = useCallback(async () => {
    if (!auth.user || !isOperator) return;
    setLoading(true);
    setError("");
    try {
      const query = new URLSearchParams({ attentionOnly: String(attentionOnly) });
      const nextDashboard = await readApi<SupportDashboard>(
        await apiFetch(`/api/internal/support?${query}`),
        "The support console could not be loaded."
      );
      setDashboard(nextDashboard);
    } catch (loadError) {
      setError(loadError instanceof Error ? loadError.message : "The support console could not be loaded.");
    } finally {
      setLoading(false);
    }
  }, [attentionOnly, auth.user, isOperator]);

  useEffect(() => {
    void loadDashboard();
  }, [loadDashboard]);

  const attentionCount = useMemo(() => dashboard?.jobs.filter((job) => ["degraded", "failed"].includes(job.status)).length || 0, [dashboard]);

  const beginEdit = (entitlement: Entitlement) => {
    setEditingId(entitlement.organizationId);
    setDraft(entitlementDraft(entitlement));
    setError("");
    setSuccess("");
  };

  const saveEntitlement = async (entitlement: Entitlement) => {
    if (!draft || saving) return;
    const isRestriction = ["suspended", "cancelled"].includes(draft.status) && draft.status !== entitlement.status;
    if (isRestriction && !globalThis.confirm(`Confirm ${formatLabel(draft.status).toLowerCase()} access for ${entitlement.organizationName}?`)) return;
    setSaving(true);
    setError("");
    setSuccess("");
    try {
      await readApi(await apiFetch(`/api/internal/organizations/${entitlement.organizationId}/entitlement`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          plan: draft.plan,
          status: draft.status,
          seatLimit: Number(draft.seatLimit),
          researchRunsLimit: Number(draft.researchRunsLimit),
          endsAt: draft.endsAt ? new Date(draft.endsAt).toISOString() : null
        })
      }), "Workspace access could not be updated.");
      setEditingId("");
      setDraft(null);
      setSuccess(`${entitlement.organizationName} access updated.`);
      await loadDashboard();
    } catch (saveError) {
      setError(saveError instanceof Error ? saveError.message : "Workspace access could not be updated.");
    } finally {
      setSaving(false);
    }
  };

  if (!auth.configured || (!auth.loading && !auth.user)) return <AuthScreen navigate={navigate} afterAuthPath="/internal/support" />;
  if (auth.loading || auth.workspaceLoading) {
    return <div className="workspace-loading" role="status"><Loader2 className="h-5 w-5 animate-spin" /> Verifying operator access...</div>;
  }
  if (!isOperator) {
    return (
      <div className="workspace-error" role="alert">
        <p>This console is restricted to CreatorSignal platform operators.</p>
        <button type="button" onClick={() => navigate("/workspace")}>Return to workspace</button>
      </div>
    );
  }

  return (
    <section className="workspace-shell support-shell">
      <header className="workspace-heading support-heading">
        <div>
          <p className="eyebrow">Internal operations</p>
          <h1>Provider health</h1>
          <p>Monitor live research providers and control pilot access without exposing credentials or raw requests.</p>
        </div>
        <button className="secondary-button" type="button" disabled={loading} onClick={() => void loadDashboard()}>
          {loading ? <Loader2 className="h-4 w-4 animate-spin" /> : <RefreshCcw className="h-4 w-4" />}
          Refresh
        </button>
      </header>

      {error ? <div className="workspace-error" role="alert"><p>{error}</p><button type="button" onClick={() => setError("")}><X className="h-4 w-4" /> Dismiss</button></div> : null}
      {success ? <div className="settings-success" role="status" aria-live="polite"><CheckCircle2 className="h-4 w-4" /> {success}</div> : null}

      <div className="support-summary" aria-label="Provider health summary">
        <div><Activity className="h-4 w-4" /><span><strong>{dashboard?.summary.jobsLast24Hours ?? 0}</strong><small>Runs in 24 hours</small></span></div>
        <div><CheckCircle2 className="h-4 w-4" /><span><strong>{dashboard?.summary.completeLast24Hours ?? 0}</strong><small>Completed</small></span></div>
        <div className={(dashboard?.summary.degradedLast24Hours || 0) > 0 ? "support-metric-warn" : ""}><AlertTriangle className="h-4 w-4" /><span><strong>{dashboard?.summary.degradedLast24Hours ?? 0}</strong><small>Degraded</small></span></div>
        <div className={(dashboard?.summary.failedLast24Hours || 0) > 0 ? "support-metric-risk" : ""}><ShieldAlert className="h-4 w-4" /><span><strong>{dashboard?.summary.failedLast24Hours ?? 0}</strong><small>Failed</small></span></div>
        <div><UsersRound className="h-4 w-4" /><span><strong>{dashboard?.summary.workspaces ?? 0}</strong><small>Workspaces</small></span></div>
        <div><Gauge className="h-4 w-4" /><span><strong>{dashboard?.summary.restrictedWorkspaces ?? 0}</strong><small>Restricted</small></span></div>
      </div>

      <section className="settings-band support-jobs-band">
        <header>
          <div><DatabaseZap className="h-4 w-4" /><h2>Provider runs</h2></div>
          <div className="support-filter" aria-label="Provider run filter">
            <button className={!attentionOnly ? "support-filter-active" : ""} type="button" onClick={() => setAttentionOnly(false)}>All</button>
            <button className={attentionOnly ? "support-filter-active" : ""} type="button" onClick={() => setAttentionOnly(true)}>Needs attention{attentionCount ? ` (${attentionCount})` : ""}</button>
          </div>
        </header>
        {loading && !dashboard ? (
          <div className="workspace-loading"><Loader2 className="h-5 w-5 animate-spin" /> Loading provider runs...</div>
        ) : dashboard?.jobs.length ? (
          <div className="support-job-list">
            {dashboard.jobs.map((job) => (
              <article className="support-job-row" key={job.id}>
                <span className={`support-status-light support-status-${job.status}`} aria-label={formatLabel(job.status)} />
                <div className="support-job-main">
                  <strong>{formatLabel(job.operation)}</strong>
                  <small>{job.organizationName} · {formatLabel(job.provider)}</small>
                </div>
                <span className={`support-status-label support-status-label-${job.status}`}>{formatLabel(job.status)}</span>
                <div className="support-job-stat"><strong>{job.sourceCount}</strong><small>sources</small></div>
                <div className="support-job-stat"><strong>{formatLatency(job.latencyMs)}</strong><small>{formatDateTime(job.createdAt)}</small></div>
                <div className="support-job-detail">
                  <small>{job.requestedByEmail || "System run"}</small>
                  {job.errorSummary ? <p title={job.errorSummary}>{job.errorSummary}</p> : <p>{job.model || "Provider default"}</p>}
                </div>
              </article>
            ))}
          </div>
        ) : (
          <div className="support-empty"><CheckCircle2 className="h-5 w-5" /><p>{attentionOnly ? "No provider runs need attention." : "No provider runs have been recorded yet."}</p></div>
        )}
      </section>

      <section className="settings-band support-entitlements-band">
        <header><div><SlidersHorizontal className="h-4 w-4" /><h2>Pilot access</h2></div><span>Operator controlled</span></header>
        <div className="support-entitlement-list">
          {dashboard?.entitlements.map((entitlement) => {
            const editing = editingId === entitlement.organizationId && draft;
            return (
              <article className="support-entitlement-row" key={entitlement.organizationId}>
                <div className="support-entitlement-identity">
                  <strong>{entitlement.organizationName}</strong>
                  <small>{formatLabel(entitlement.plan)} · Updated {formatDateTime(entitlement.updatedAt)}</small>
                </div>
                {editing ? (
                  <div className="support-entitlement-editor">
                    <label><span>Plan</span><select value={draft.plan} onChange={(event) => setDraft({ ...draft, plan: event.target.value as EntitlementPlan })}>{planOptions.map((plan) => <option key={plan} value={plan}>{formatLabel(plan)}</option>)}</select></label>
                    <label><span>Status</span><select value={draft.status} onChange={(event) => setDraft({ ...draft, status: event.target.value as EntitlementStatus })}>{statusOptions.map((status) => <option key={status} value={status}>{formatLabel(status)}</option>)}</select></label>
                    <label><span>Seats</span><input type="number" min={1} max={1000} value={draft.seatLimit} onChange={(event) => setDraft({ ...draft, seatLimit: Number(event.target.value) })} /></label>
                    <label><span>Research / month</span><input type="number" min={0} max={1_000_000} value={draft.researchRunsLimit} onChange={(event) => setDraft({ ...draft, researchRunsLimit: Number(event.target.value) })} /></label>
                    <label><span>Ends</span><input type="datetime-local" value={draft.endsAt} onChange={(event) => setDraft({ ...draft, endsAt: event.target.value })} /></label>
                  </div>
                ) : (
                  <div className="support-entitlement-stats">
                    <span className={`support-status-label support-entitlement-${entitlement.status}`}>{formatLabel(entitlement.status)}</span>
                    <span><strong>{entitlement.seatLimit}</strong><small>seats</small></span>
                    <span><strong>{entitlement.researchRunsLimit}</strong><small>research / month</small></span>
                    <span><strong>{formatDateTime(entitlement.endsAt)}</strong><small>access end</small></span>
                  </div>
                )}
                <div className="support-entitlement-actions">
                  {editing ? (
                    <>
                      <button className="primary-button" type="button" disabled={saving} onClick={() => void saveEntitlement(entitlement)}>{saving ? <Loader2 className="h-4 w-4 animate-spin" /> : <Save className="h-4 w-4" />} Save</button>
                      <button className="ghost-icon-button" type="button" disabled={saving} onClick={() => { setEditingId(""); setDraft(null); }} aria-label={`Cancel changes for ${entitlement.organizationName}`} title="Cancel changes"><X className="h-4 w-4" /></button>
                    </>
                  ) : (
                    <button className="secondary-button" type="button" onClick={() => beginEdit(entitlement)}><SlidersHorizontal className="h-4 w-4" /> Edit</button>
                  )}
                </div>
              </article>
            );
          })}
        </div>
      </section>

      <footer className="support-privacy-note"><Clock3 className="h-4 w-4" /><p>Diagnostics store provider status, timing, source counts, and sanitized errors. API keys and raw prompts are never shown here.</p></footer>
    </section>
  );
}
