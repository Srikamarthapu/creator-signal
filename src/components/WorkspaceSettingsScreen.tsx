import {
  AlertTriangle,
  BriefcaseBusiness,
  Check,
  Clock3,
  Copy,
  Download,
  Gauge,
  KeyRound,
  LayoutDashboard,
  ListChecks,
  Loader2,
  LogOut,
  RefreshCcw,
  Search,
  Settings,
  ShieldCheck,
  Trash2,
  UserPlus,
  UserRound,
  UsersRound,
  X
} from "lucide-react";
import { type FormEvent, useCallback, useEffect, useMemo, useState } from "react";
import { apiFetch } from "../lib/api";
import { type AccountType, useAuth } from "./AuthProvider";
import { AuthScreen } from "./AuthScreen";

type WorkspaceRole = "owner" | "admin" | "marketer" | "approver" | "analyst";
type MembershipStatus = "active" | "suspended";
type SettingsSection = "team" | "account";

type WorkspaceMember = {
  id: string;
  userId: string;
  displayName: string;
  email: string | null;
  accountType: AccountType;
  role: WorkspaceRole;
  status: MembershipStatus;
  isCurrentUser: boolean;
  joinedAt: string;
  updatedAt: string;
};

type WorkspaceInvitation = {
  id: string;
  email: string;
  role: Exclude<WorkspaceRole, "owner">;
  status: "pending" | "accepted" | "revoked" | "expired";
  expiresAt: string;
  acceptedAt: string | null;
  createdAt: string;
};

type AccountRequest = {
  id: string;
  requestType: "export" | "deletion";
  status: "requested" | "processing" | "complete" | "cancelled";
  requestedAt: string;
  completedAt: string | null;
};

type SettingsData = {
  organization: {
    id: string;
    name: string;
    slug: string;
    organizationType: string;
    createdAt: string;
    updatedAt: string;
  };
  members: WorkspaceMember[];
  invitations: WorkspaceInvitation[];
  profile: {
    id: string;
    displayName: string | null;
    accountType: AccountType;
    onboardingCompleted: boolean;
  } | null;
  entitlement: {
    organizationId: string;
    plan: "pilot" | "starter" | "growth" | "enterprise" | "internal";
    status: "trialing" | "active" | "past_due" | "suspended" | "cancelled";
    seatLimit: number;
    researchRunsLimit: number;
    researchRunsUsed: number;
    activeSeats: number;
    startsAt: string;
    endsAt: string | null;
    updatedAt: string;
  } | null;
  accountRequests: AccountRequest[];
  activity: Array<{
    id: number;
    actorUserId: string | null;
    eventType: string;
    createdAt: string;
  }>;
  permissions: {
    role: WorkspaceRole;
    canManageTeam: boolean;
    canManageOwners: boolean;
  };
};

type InvitationCreation = {
  invitation: WorkspaceInvitation;
  inviteLink: string;
  delivery: "share_link";
  note: string;
};

const invitationRoles: Array<{ value: Exclude<WorkspaceRole, "owner">; label: string }> = [
  { value: "admin", label: "Admin" },
  { value: "marketer", label: "Marketer" },
  { value: "approver", label: "Approver" },
  { value: "analyst", label: "Analyst" }
];

const roleLabels: Record<WorkspaceRole, string> = {
  owner: "Owner",
  admin: "Admin",
  marketer: "Marketer",
  approver: "Approver",
  analyst: "Analyst"
};

const activityLabels: Record<string, string> = {
  "workspace.invitation_created": "Invitation link created",
  "workspace.invitation_revoked": "Invitation revoked",
  "workspace.invitation_accepted": "Invitation accepted",
  "workspace.member_updated": "Member access updated",
  "workspace.member_removed": "Member removed"
};

function formatDate(value: string) {
  return new Intl.DateTimeFormat(undefined, { month: "short", day: "numeric", year: "numeric" }).format(new Date(value));
}

function initials(name: string) {
  return name.split(/\s+/).filter(Boolean).map((part) => part[0]).join("").slice(0, 2).toUpperCase() || "CS";
}

function usagePercent(used: number, limit: number) {
  if (limit <= 0) return used > 0 ? 100 : 0;
  return Math.min(100, Math.round((used / limit) * 100));
}

async function readApi<T>(response: Response, fallback: string): Promise<T> {
  const payload = await response.json().catch(() => null);
  if (!response.ok) throw new Error(payload?.error || fallback);
  return payload as T;
}

export function WorkspaceSettingsScreen({ navigate }: { navigate: (path: string) => void }) {
  const auth = useAuth();
  const [section, setSection] = useState<SettingsSection>("team");
  const [settings, setSettings] = useState<SettingsData | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");
  const [success, setSuccess] = useState("");
  const [inviteEmail, setInviteEmail] = useState("");
  const [inviteRole, setInviteRole] = useState<Exclude<WorkspaceRole, "owner">>("marketer");
  const [latestInvitation, setLatestInvitation] = useState<InvitationCreation | null>(null);
  const [workingId, setWorkingId] = useState("");
  const [profileName, setProfileName] = useState("");
  const [accountType, setAccountType] = useState<AccountType>("business");

  const loadSettings = useCallback(async () => {
    if (!auth.activeOrganization) return;
    setLoading(true);
    setError("");
    try {
      const query = new URLSearchParams({ organizationId: auth.activeOrganization.id });
      const nextSettings = await readApi<SettingsData>(
        await apiFetch(`/api/workspace/settings?${query}`),
        "Workspace settings could not be loaded."
      );
      setSettings(nextSettings);
      setProfileName(nextSettings.profile?.displayName || auth.user?.email?.split("@")[0] || "");
      setAccountType(nextSettings.profile?.accountType || "professional");
    } catch (loadError) {
      setError(loadError instanceof Error ? loadError.message : "Workspace settings could not be loaded.");
    } finally {
      setLoading(false);
    }
  }, [auth.activeOrganization, auth.user?.email]);

  useEffect(() => {
    void loadSettings();
  }, [loadSettings]);

  const clearMessages = () => {
    setError("");
    setSuccess("");
  };

  const createInvitation = async (event: FormEvent) => {
    event.preventDefault();
    if (!auth.activeOrganization || workingId) return;
    clearMessages();
    setWorkingId("invite");
    try {
      const created = await readApi<InvitationCreation>(await apiFetch("/api/workspace/invitations", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          organizationId: auth.activeOrganization.id,
          email: inviteEmail,
          role: inviteRole
        })
      }), "The invitation link could not be created.");
      setLatestInvitation(created);
      setInviteEmail("");
      setSuccess("Invitation link ready to share.");
      await loadSettings();
    } catch (inviteError) {
      setError(inviteError instanceof Error ? inviteError.message : "The invitation link could not be created.");
    } finally {
      setWorkingId("");
    }
  };

  const copyInvitation = async () => {
    if (!latestInvitation) return;
    try {
      await navigator.clipboard.writeText(latestInvitation.inviteLink);
      setSuccess("Invitation link copied.");
    } catch {
      setError("The link could not be copied. Select it and copy it manually.");
    }
  };

  const reissueInvitation = async (invitation: WorkspaceInvitation) => {
    if (!auth.activeOrganization || workingId) return;
    clearMessages();
    setWorkingId(invitation.id);
    try {
      const created = await readApi<InvitationCreation>(await apiFetch("/api/workspace/invitations", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          organizationId: auth.activeOrganization.id,
          email: invitation.email,
          role: invitation.role
        })
      }), "A new invitation link could not be created.");
      setLatestInvitation(created);
      setSuccess("A fresh seven-day invitation link is ready.");
      await loadSettings();
    } catch (reissueError) {
      setError(reissueError instanceof Error ? reissueError.message : "A new invitation link could not be created.");
    } finally {
      setWorkingId("");
    }
  };

  const revokeInvitation = async (invitation: WorkspaceInvitation) => {
    if (!auth.activeOrganization || workingId || !window.confirm(`Revoke the invitation for ${invitation.email}?`)) return;
    clearMessages();
    setWorkingId(invitation.id);
    try {
      await readApi(await apiFetch(`/api/workspace/invitations/${invitation.id}/revoke`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ organizationId: auth.activeOrganization.id })
      }), "The invitation could not be revoked.");
      setSuccess("Invitation revoked.");
      await loadSettings();
    } catch (revokeError) {
      setError(revokeError instanceof Error ? revokeError.message : "The invitation could not be revoked.");
    } finally {
      setWorkingId("");
    }
  };

  const updateMember = async (member: WorkspaceMember, update: Partial<Pick<WorkspaceMember, "role" | "status">>) => {
    if (!auth.activeOrganization || workingId) return;
    const nextRole = update.role || member.role;
    const nextStatus = update.status || member.status;
    if (nextStatus === "suspended" && member.status !== "suspended" && !window.confirm(`Suspend ${member.displayName}'s workspace access?`)) return;
    clearMessages();
    setWorkingId(member.id);
    try {
      await readApi(await apiFetch(`/api/workspace/members/${member.id}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          organizationId: auth.activeOrganization.id,
          role: nextRole,
          status: nextStatus
        })
      }), "The member access could not be updated.");
      setSuccess(`${member.displayName}'s access was updated.`);
      await loadSettings();
    } catch (memberError) {
      setError(memberError instanceof Error ? memberError.message : "The member access could not be updated.");
    } finally {
      setWorkingId("");
    }
  };

  const removeMember = async (member: WorkspaceMember) => {
    if (!auth.activeOrganization || workingId || !window.confirm(`Remove ${member.displayName} from ${auth.activeOrganization.name}?`)) return;
    clearMessages();
    setWorkingId(member.id);
    try {
      await readApi(await apiFetch(`/api/workspace/members/${member.id}`, {
        method: "DELETE",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ organizationId: auth.activeOrganization.id })
      }), "The member could not be removed.");
      setSuccess(`${member.displayName} was removed from this workspace.`);
      await loadSettings();
    } catch (removeError) {
      setError(removeError instanceof Error ? removeError.message : "The member could not be removed.");
    } finally {
      setWorkingId("");
    }
  };

  const saveProfile = async (event: FormEvent) => {
    event.preventDefault();
    if (workingId) return;
    clearMessages();
    setWorkingId("profile");
    try {
      await readApi(await apiFetch("/api/account/profile", {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ displayName: profileName, accountType })
      }), "Your profile could not be updated.");
      await auth.refreshWorkspace();
      setSuccess("Account profile updated.");
      await loadSettings();
    } catch (profileError) {
      setError(profileError instanceof Error ? profileError.message : "Your profile could not be updated.");
    } finally {
      setWorkingId("");
    }
  };

  const createAccountDataRequest = async (requestType: AccountRequest["requestType"]) => {
    if (workingId) return;
    if (requestType === "deletion" && !window.confirm("Submit an account deletion request? Your account will remain active while the request is reviewed.")) return;
    clearMessages();
    setWorkingId(requestType);
    try {
      await readApi(await apiFetch("/api/account/requests", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ requestType })
      }), "The account request could not be submitted.");
      setSuccess(requestType === "export" ? "Account export requested." : "Account deletion request submitted.");
      await loadSettings();
    } catch (requestError) {
      setError(requestError instanceof Error ? requestError.message : "The account request could not be submitted.");
    } finally {
      setWorkingId("");
    }
  };

  const cancelAccountDataRequest = async (accountRequest: AccountRequest) => {
    if (workingId) return;
    clearMessages();
    setWorkingId(accountRequest.id);
    try {
      await readApi(await apiFetch(`/api/account/requests/${accountRequest.id}/cancel`, { method: "POST" }), "The account request could not be cancelled.");
      setSuccess("Account request cancelled.");
      await loadSettings();
    } catch (cancelError) {
      setError(cancelError instanceof Error ? cancelError.message : "The account request could not be cancelled.");
    } finally {
      setWorkingId("");
    }
  };

  const openRequests = useMemo(() => settings?.accountRequests.filter((request) => ["requested", "processing"].includes(request.status)) || [], [settings]);

  if (!auth.configured || (!auth.loading && !auth.user)) return <AuthScreen navigate={navigate} afterAuthPath="/settings" />;
  if (auth.loading || auth.workspaceLoading || (loading && !settings)) {
    return <div className="workspace-loading" role="status"><Loader2 className="h-5 w-5 animate-spin" /> Loading settings...</div>;
  }
  if (!auth.activeOrganization) {
    return <div className="workspace-error" role="alert"><p>Your account is not connected to a workspace yet.</p><button type="button" onClick={() => void auth.refreshWorkspace()}>Retry</button></div>;
  }

  return (
    <section className="workspace-shell">
      <header className="workspace-heading">
        <div>
          <p className="eyebrow">{auth.activeOrganization.name}</p>
          <h1>Settings</h1>
          <p>Manage workspace access and your personal account.</p>
        </div>
        {auth.memberships.length > 1 ? (
          <label className="workspace-switcher">
            <span>Workspace</span>
            <select value={auth.activeOrganization.id} onChange={(event) => auth.switchOrganization(event.target.value)}>
              {auth.memberships.map((membership) => <option key={membership.id} value={membership.orgId}>{membership.organization.name}</option>)}
            </select>
          </label>
        ) : null}
      </header>

      <nav className="workspace-tabs" aria-label="Workspace views">
        <button title="Overview" onClick={() => navigate("/workspace")}><LayoutDashboard className="h-4 w-4" /><span>Overview</span></button>
        <button title="Shortlists" onClick={() => navigate("/shortlist")}><ListChecks className="h-4 w-4" /><span>Shortlists</span></button>
        <button title="Campaigns" onClick={() => navigate("/campaigns")}><BriefcaseBusiness className="h-4 w-4" /><span>Campaigns</span></button>
        <button className="workspace-tab-active" title="Settings" aria-current="page"><Settings className="h-4 w-4" /><span>Settings</span></button>
      </nav>

      {error ? <div className="workspace-error" role="alert"><p>{error}</p><button type="button" onClick={() => setError("")}><X className="h-4 w-4" /> Dismiss</button></div> : null}
      {success ? <div className="settings-success" role="status" aria-live="polite"><Check className="h-4 w-4" /> {success}</div> : null}

      <div className="settings-layout">
        <aside className="settings-sidebar" aria-label="Settings sections">
          <button className={section === "team" ? "settings-sidebar-active" : ""} type="button" onClick={() => setSection("team")}>
            <UsersRound className="h-4 w-4" /><span><strong>Team</strong><small>{settings?.members.length || 0} members</small></span>
          </button>
          <button className={section === "account" ? "settings-sidebar-active" : ""} type="button" onClick={() => setSection("account")}>
            <UserRound className="h-4 w-4" /><span><strong>Account</strong><small>Profile and data</small></span>
          </button>
        </aside>

        <div className="settings-content">
          {section === "team" ? (
            <>
              <header className="settings-section-heading">
                <div><p className="eyebrow">Workspace access</p><h2>Team</h2><p>Roles control who can manage campaigns, approve work, or view reporting.</p></div>
                <span className="settings-role-badge"><ShieldCheck className="h-4 w-4" /> {settings ? roleLabels[settings.permissions.role] : "Member"}</span>
              </header>

              {settings?.entitlement ? (
                <section className="settings-band workspace-entitlement-band">
                  <header>
                    <div><Gauge className="h-4 w-4" /><h3>Workspace access</h3></div>
                    <span className={`workspace-entitlement-status workspace-entitlement-${settings.entitlement.status}`}>{settings.entitlement.status.replace(/_/g, " ")}</span>
                  </header>
                  <div className="workspace-entitlement-overview">
                    <div className="workspace-entitlement-plan"><small>Current plan</small><strong>{settings.entitlement.plan}</strong><p>{settings.entitlement.endsAt ? `Access through ${formatDate(settings.entitlement.endsAt)}` : "No scheduled end date"}</p></div>
                    <div className="workspace-entitlement-meter">
                      <span><strong>Team seats</strong><small>{settings.entitlement.activeSeats} of {settings.entitlement.seatLimit}</small></span>
                      <progress value={usagePercent(settings.entitlement.activeSeats, settings.entitlement.seatLimit)} max={100} aria-label="Team seat usage" />
                    </div>
                    <div className="workspace-entitlement-meter">
                      <span><strong>Research this month</strong><small>{settings.entitlement.researchRunsUsed} of {settings.entitlement.researchRunsLimit}</small></span>
                      <progress value={usagePercent(settings.entitlement.researchRunsUsed, settings.entitlement.researchRunsLimit)} max={100} aria-label="Monthly research usage" />
                    </div>
                  </div>
                </section>
              ) : null}

              {settings?.permissions.canManageTeam ? (
                <form className="team-invite-form" onSubmit={createInvitation}>
                  <label><span>Email address</span><input type="email" value={inviteEmail} onChange={(event) => setInviteEmail(event.target.value)} required maxLength={240} autoComplete="off" placeholder="teammate@company.com" /></label>
                  <label><span>Role</span><select value={inviteRole} onChange={(event) => setInviteRole(event.target.value as Exclude<WorkspaceRole, "owner">)}>{invitationRoles.map((role) => <option value={role.value} key={role.value}>{role.label}</option>)}</select></label>
                  <button className="primary-button" type="submit" disabled={workingId === "invite"}>{workingId === "invite" ? <Loader2 className="h-4 w-4 animate-spin" /> : <UserPlus className="h-4 w-4" />} Invite</button>
                </form>
              ) : null}

              {latestInvitation ? (
                <div className="invitation-link-panel">
                  <div><span className="invitation-link-icon"><KeyRound className="h-4 w-4" /></span><div><strong>Share this link securely</strong><small>No email was sent automatically. This link expires in seven days.</small></div></div>
                  <div className="invitation-link-field"><input value={latestInvitation.inviteLink} readOnly aria-label="Invitation link" /><button className="secondary-button" type="button" onClick={() => void copyInvitation()}><Copy className="h-4 w-4" /> Copy</button><button className="ghost-icon-button" type="button" aria-label="Hide invitation link" title="Hide invitation link" onClick={() => setLatestInvitation(null)}><X className="h-4 w-4" /></button></div>
                </div>
              ) : null}

              <section className="settings-band">
                <header><div><UsersRound className="h-4 w-4" /><h3>Members</h3></div><span>{settings?.members.filter((member) => member.status === "active").length || 0} active</span></header>
                <div className="team-member-list">
                  {settings?.members.map((member) => {
                    const canEdit = settings.permissions.canManageTeam && !member.isCurrentUser && (settings.permissions.canManageOwners || member.role !== "owner");
                    return (
                      <div className={`team-member-row ${member.status === "suspended" ? "team-member-row-suspended" : ""}`} key={member.id}>
                        <span className="team-avatar">{initials(member.displayName)}</span>
                        <div className="team-member-identity"><strong>{member.displayName}{member.isCurrentUser ? " (you)" : ""}</strong><small>{member.email || "Email unavailable"}</small></div>
                        <label className="team-control"><span className="sr-only">Role for {member.displayName}</span><select value={member.role} disabled={!canEdit || workingId === member.id} onChange={(event) => void updateMember(member, { role: event.target.value as WorkspaceRole })}>{settings.permissions.canManageOwners ? <option value="owner">Owner</option> : null}{invitationRoles.map((role) => <option value={role.value} key={role.value}>{role.label}</option>)}</select></label>
                        <label className="team-control"><span className="sr-only">Access for {member.displayName}</span><select value={member.status} disabled={!canEdit || workingId === member.id} onChange={(event) => void updateMember(member, { status: event.target.value as MembershipStatus })}><option value="active">Active</option><option value="suspended">Suspended</option></select></label>
                        {canEdit ? <button className="ghost-icon-button team-remove-button" type="button" disabled={workingId === member.id} onClick={() => void removeMember(member)} aria-label={`Remove ${member.displayName}`} title={`Remove ${member.displayName}`}>{workingId === member.id ? <Loader2 className="h-4 w-4 animate-spin" /> : <Trash2 className="h-4 w-4" />}</button> : <span className="team-member-lock"><ShieldCheck className="h-4 w-4" /></span>}
                      </div>
                    );
                  })}
                </div>
              </section>

              {settings?.permissions.canManageTeam && settings.invitations.length ? (
                <section className="settings-band">
                  <header><div><Clock3 className="h-4 w-4" /><h3>Invitations</h3></div><span>{settings.invitations.filter((invitation) => invitation.status === "pending").length} pending</span></header>
                  <div className="invitation-list">
                    {settings.invitations.map((invitation) => (
                      <div className="invitation-row" key={invitation.id}>
                        <div><strong>{invitation.email}</strong><small>{roleLabels[invitation.role]} · {invitation.status === "pending" ? `Expires ${formatDate(invitation.expiresAt)}` : invitation.status}</small></div>
                        <span className={`invitation-status invitation-status-${invitation.status}`}>{invitation.status}</span>
                        {invitation.status === "pending" ? <button className="ghost-icon-button" type="button" disabled={workingId === invitation.id} onClick={() => void revokeInvitation(invitation)} aria-label={`Revoke invitation for ${invitation.email}`} title="Revoke invitation"><X className="h-4 w-4" /></button> : invitation.status === "expired" || invitation.status === "revoked" ? <button className="ghost-icon-button" type="button" disabled={workingId === invitation.id} onClick={() => void reissueInvitation(invitation)} aria-label={`Create a new invitation for ${invitation.email}`} title="Create new link"><RefreshCcw className="h-4 w-4" /></button> : <span />}
                      </div>
                    ))}
                  </div>
                </section>
              ) : null}

              {settings?.activity.length ? (
                <section className="settings-band settings-activity-band">
                  <header><div><Clock3 className="h-4 w-4" /><h3>Recent access activity</h3></div></header>
                  <div className="settings-activity-list">{settings.activity.map((event) => <div key={event.id}><span /><p><strong>{activityLabels[event.eventType] || "Workspace access changed"}</strong><small>{formatDate(event.createdAt)}</small></p></div>)}</div>
                </section>
              ) : null}
            </>
          ) : (
            <>
              <header className="settings-section-heading">
                <div><p className="eyebrow">Personal settings</p><h2>Account</h2><p>Your profile follows you across every workspace you join.</p></div>
              </header>

              <form className="account-profile-form" onSubmit={saveProfile}>
                <label><span>Display name</span><input value={profileName} onChange={(event) => setProfileName(event.target.value)} required maxLength={120} autoComplete="name" /></label>
                <label><span>Primary account path</span><select value={accountType} onChange={(event) => setAccountType(event.target.value as AccountType)}><option value="business">Business</option><option value="professional">Professional</option><option value="creator">Creator</option></select></label>
                <label><span>Email address</span><input value={auth.user?.email || ""} readOnly aria-readonly="true" /></label>
                <div className="account-profile-actions"><button className="primary-button" type="submit" disabled={workingId === "profile"}>{workingId === "profile" ? <Loader2 className="h-4 w-4 animate-spin" /> : <Check className="h-4 w-4" />} Save profile</button></div>
              </form>

              <section className="settings-band account-security-band">
                <header><div><KeyRound className="h-4 w-4" /><h3>Security</h3></div></header>
                <div className="account-action-row"><div><strong>Password</strong><small>Send a secure reset link to {auth.user?.email || "your account email"}.</small></div><button className="secondary-button" type="button" onClick={() => auth.user?.email && void auth.requestPasswordReset(auth.user.email).then(() => setSuccess("Password reset email requested.")).catch((resetError) => setError(resetError instanceof Error ? resetError.message : "The reset email could not be requested."))}><KeyRound className="h-4 w-4" /> Reset password</button></div>
                <div className="account-action-row"><div><strong>Signed-in session</strong><small>Sign out of this browser and return to public search.</small></div><button className="secondary-button" type="button" onClick={() => void auth.signOut().then(() => navigate("/"))}><LogOut className="h-4 w-4" /> Sign out</button></div>
              </section>

              <section className="settings-band account-data-band">
                <header><div><Download className="h-4 w-4" /><h3>Account data</h3></div></header>
                <div className="account-action-row"><div><strong>Export your data</strong><small>Request a portable copy of your profile and workspace participation data.</small></div><button className="secondary-button" type="button" disabled={workingId === "export" || openRequests.some((request) => request.requestType === "export")} onClick={() => void createAccountDataRequest("export")}>{workingId === "export" ? <Loader2 className="h-4 w-4 animate-spin" /> : <Download className="h-4 w-4" />} Request export</button></div>
                <div className="account-action-row account-danger-row"><div><strong>Delete account</strong><small>Submit a reviewed deletion request. Workspace-owned campaign records are handled separately.</small></div><button className="secondary-button" type="button" disabled={workingId === "deletion" || openRequests.some((request) => request.requestType === "deletion")} onClick={() => void createAccountDataRequest("deletion")}><AlertTriangle className="h-4 w-4" /> Request deletion</button></div>
                {openRequests.length ? <div className="account-request-list">{openRequests.map((request) => <div key={request.id}><span><Clock3 className="h-4 w-4" /><strong>{request.requestType === "export" ? "Data export" : "Account deletion"}</strong><small>{request.status} · {formatDate(request.requestedAt)}</small></span>{request.status === "requested" ? <button className="ghost-button" type="button" disabled={workingId === request.id} onClick={() => void cancelAccountDataRequest(request)}>Cancel</button> : null}</div>)}</div> : null}
              </section>
            </>
          )}
        </div>
      </div>
    </section>
  );
}
