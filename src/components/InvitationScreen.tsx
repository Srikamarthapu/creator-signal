import { ArrowRight, Check, Clock3, Loader2, ShieldCheck, UsersRound, X } from "lucide-react";
import { useEffect, useState } from "react";
import { apiFetch } from "../lib/api";
import { AuthScreen } from "./AuthScreen";
import { useAuth } from "./AuthProvider";

type InvitationPreview = {
  id: string;
  organizationId: string | null;
  organizationName: string;
  invitedEmail: string;
  role: "admin" | "marketer" | "approver" | "analyst";
  status: "pending" | "accepted" | "revoked" | "expired";
  expiresAt: string;
};

const roleLabels: Record<InvitationPreview["role"], string> = {
  admin: "Admin",
  marketer: "Marketer",
  approver: "Approver",
  analyst: "Analyst"
};

function formatDate(value: string) {
  return new Intl.DateTimeFormat(undefined, { month: "long", day: "numeric", year: "numeric" }).format(new Date(value));
}

export function InvitationScreen({ token, navigate }: { token: string; navigate: (path: string) => void }) {
  const auth = useAuth();
  const [invitation, setInvitation] = useState<InvitationPreview | null>(null);
  const [loading, setLoading] = useState(true);
  const [working, setWorking] = useState(false);
  const [error, setError] = useState("");
  const [acceptedOrganizationId, setAcceptedOrganizationId] = useState("");

  useEffect(() => {
    let active = true;
    setLoading(true);
    setError("");
    apiFetch(`/api/invitations/${encodeURIComponent(token)}`)
      .then(async (response) => {
        const payload = await response.json().catch(() => null);
        if (!response.ok) throw new Error(payload?.error || "Invitation not found.");
        return payload.invitation as InvitationPreview;
      })
      .then((preview) => {
        if (active) setInvitation(preview);
      })
      .catch((previewError) => {
        if (active) setError(previewError instanceof Error ? previewError.message : "Invitation not found.");
      })
      .finally(() => {
        if (active) setLoading(false);
      });
    return () => {
      active = false;
    };
  }, [token]);

  useEffect(() => {
    if (!acceptedOrganizationId) return;
    const membership = auth.memberships.find((candidate) => candidate.orgId === acceptedOrganizationId);
    if (!membership) return;
    auth.switchOrganization(acceptedOrganizationId);
    navigate("/workspace");
  }, [acceptedOrganizationId, auth, navigate]);

  const acceptInvitation = async () => {
    if (!auth.user || working) return;
    setWorking(true);
    setError("");
    try {
      const response = await apiFetch(`/api/invitations/${encodeURIComponent(token)}/accept`, { method: "POST" });
      const payload = await response.json().catch(() => null);
      if (!response.ok) throw new Error(payload?.error || "The invitation could not be accepted.");
      setAcceptedOrganizationId(payload.organizationId);
      await auth.refreshWorkspace();
    } catch (acceptError) {
      setError(acceptError instanceof Error ? acceptError.message : "The invitation could not be accepted.");
    } finally {
      setWorking(false);
    }
  };

  if (loading || auth.loading) {
    return <div className="workspace-loading" role="status"><Loader2 className="h-5 w-5 animate-spin" /> Checking invitation...</div>;
  }

  if (error && !invitation) {
    return (
      <section className="invitation-state invitation-state-error">
        <span><X className="h-6 w-6" /></span>
        <p className="eyebrow">Workspace invitation</p>
        <h1>Invitation unavailable</h1>
        <p>{error}</p>
        <button className="secondary-button" type="button" onClick={() => navigate("/")}>Return to CreatorSignal</button>
      </section>
    );
  }

  if (!invitation) return null;

  if (!auth.user) {
    return (
      <AuthScreen
        navigate={navigate}
        afterAuthPath={`/invite/${token}`}
        context={{
          eyebrow: "Workspace invitation",
          title: `Join ${invitation.organizationName}`,
          detail: `${invitation.invitedEmail} was invited as ${roleLabels[invitation.role]}. Sign in or create that account to continue.`
        }}
      />
    );
  }

  if (invitation.status !== "pending") {
    const detail = invitation.status === "expired"
      ? "This link has expired. Ask a workspace owner or admin to create a new invitation."
      : invitation.status === "accepted"
        ? "This invitation has already been accepted."
        : "This invitation was revoked by the workspace team.";
    return (
      <section className="invitation-state">
        <span><Clock3 className="h-6 w-6" /></span>
        <p className="eyebrow">{invitation.organizationName}</p>
        <h1>Invitation {invitation.status}</h1>
        <p>{detail}</p>
        <button className="secondary-button" type="button" onClick={() => navigate("/workspace")}>Open workspace</button>
      </section>
    );
  }

  return (
    <section className="invitation-state invitation-accept-state">
      <span><UsersRound className="h-6 w-6" /></span>
      <p className="eyebrow">Workspace invitation</p>
      <h1>Join {invitation.organizationName}</h1>
      <div className="invitation-facts">
        <div><ShieldCheck className="h-4 w-4" /><span><small>Role</small><strong>{roleLabels[invitation.role]}</strong></span></div>
        <div><Clock3 className="h-4 w-4" /><span><small>Expires</small><strong>{formatDate(invitation.expiresAt)}</strong></span></div>
      </div>
      <p>Signed in as <strong>{auth.user.email}</strong>. Access is granted only when this matches the invited address.</p>
      {error ? <div className="workspace-error" role="alert"><p>{error}</p></div> : null}
      {acceptedOrganizationId ? (
        <div className="invitation-accepted" role="status"><Check className="h-5 w-5" /> Joining workspace...</div>
      ) : (
        <div className="invitation-state-actions">
          <button className="ghost-button" type="button" onClick={() => navigate("/workspace")}>Not now</button>
          <button className="primary-button" type="button" disabled={working} onClick={() => void acceptInvitation()}>{working ? <Loader2 className="h-4 w-4 animate-spin" /> : <ArrowRight className="h-4 w-4" />} Accept invitation</button>
        </div>
      )}
    </section>
  );
}
