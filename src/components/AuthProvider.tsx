import type { Session, User } from "@supabase/supabase-js";
import {
  createContext,
  type ReactNode,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useState
} from "react";
import { supabase, supabaseConfigured } from "../lib/supabase";

export type AccountType = "creator" | "professional" | "business";

export type WorkspaceMembership = {
  id: string;
  orgId: string;
  role: "owner" | "admin" | "marketer" | "approver" | "analyst";
  organization: {
    id: string;
    name: string;
    slug: string;
    organizationType: "personal" | "business" | "agency";
  };
};

type Profile = {
  id: string;
  displayName: string | null;
  accountType: AccountType;
  onboardingCompleted: boolean;
};

type SignUpInput = {
  email: string;
  password: string;
  fullName: string;
  accountType: AccountType;
  organizationName?: string;
};

type AuthContextValue = {
  configured: boolean;
  loading: boolean;
  workspaceLoading: boolean;
  session: Session | null;
  user: User | null;
  profile: Profile | null;
  memberships: WorkspaceMembership[];
  activeOrganization: WorkspaceMembership["organization"] | null;
  activeMembership: WorkspaceMembership | null;
  error: string;
  signUp: (input: SignUpInput) => Promise<string>;
  signIn: (email: string, password: string) => Promise<void>;
  signOut: () => Promise<void>;
  requestPasswordReset: (email: string) => Promise<void>;
  updatePassword: (password: string) => Promise<void>;
  switchOrganization: (organizationId: string) => void;
  refreshWorkspace: () => Promise<void>;
};

const AuthContext = createContext<AuthContextValue | null>(null);

function activeOrgStorageKey(userId: string) {
  return `creator_signal_active_org:${userId}`;
}

function normalizeMembership(row: Record<string, unknown>): WorkspaceMembership | null {
  const organizationValue = row.organizations;
  const organization = Array.isArray(organizationValue) ? organizationValue[0] : organizationValue;
  if (!organization || typeof organization !== "object") return null;
  const record = organization as Record<string, unknown>;
  if (typeof row.id !== "string" || typeof row.org_id !== "string" || typeof row.role !== "string") return null;
  if (typeof record.id !== "string" || typeof record.name !== "string" || typeof record.slug !== "string") return null;
  return {
    id: row.id,
    orgId: row.org_id,
    role: row.role as WorkspaceMembership["role"],
    organization: {
      id: record.id,
      name: record.name,
      slug: record.slug,
      organizationType: (record.organization_type || "personal") as WorkspaceMembership["organization"]["organizationType"]
    }
  };
}

export function AuthProvider({ children }: { children: ReactNode }) {
  const [loading, setLoading] = useState(supabaseConfigured);
  const [workspaceLoading, setWorkspaceLoading] = useState(false);
  const [session, setSession] = useState<Session | null>(null);
  const [profile, setProfile] = useState<Profile | null>(null);
  const [memberships, setMemberships] = useState<WorkspaceMembership[]>([]);
  const [activeOrganizationId, setActiveOrganizationId] = useState("");
  const [error, setError] = useState("");
  const user = session?.user || null;

  const refreshWorkspace = useCallback(async () => {
    if (!supabase || !user) {
      setProfile(null);
      setMemberships([]);
      setActiveOrganizationId("");
      setWorkspaceLoading(false);
      return;
    }
    setWorkspaceLoading(true);
    setError("");
    try {
      const [profileResult, membershipResult] = await Promise.all([
        supabase
          .from("profiles")
          .select("id, display_name, account_type, onboarding_completed")
          .eq("id", user.id)
          .maybeSingle(),
        supabase
          .from("memberships")
          .select("id, org_id, role, organizations!inner(id, name, slug, organization_type)")
          .eq("user_id", user.id)
          .eq("status", "active")
      ]);
      if (profileResult.error) throw profileResult.error;
      if (membershipResult.error) throw membershipResult.error;

      const profileRow = profileResult.data;
      setProfile(profileRow ? {
        id: profileRow.id,
        displayName: profileRow.display_name,
        accountType: profileRow.account_type as AccountType,
        onboardingCompleted: profileRow.onboarding_completed
      } : null);

      const nextMemberships = (membershipResult.data || [])
        .map((row) => normalizeMembership(row as unknown as Record<string, unknown>))
        .filter((row): row is WorkspaceMembership => Boolean(row));
      setMemberships(nextMemberships);
      const stored = localStorage.getItem(activeOrgStorageKey(user.id)) || "";
      const selected = nextMemberships.find((membership) => membership.orgId === stored) || nextMemberships[0];
      setActiveOrganizationId(selected?.orgId || "");
    } finally {
      setWorkspaceLoading(false);
    }
  }, [user]);

  useEffect(() => {
    if (!supabase) return;
    let active = true;
    supabase.auth.getSession().then(({ data, error: sessionError }) => {
      if (!active) return;
      if (sessionError) setError(sessionError.message);
      setSession(data.session);
      setLoading(false);
    });
    const { data: subscription } = supabase.auth.onAuthStateChange((_event, nextSession) => {
      setSession(nextSession);
      setLoading(false);
    });
    return () => {
      active = false;
      subscription.subscription.unsubscribe();
    };
  }, []);

  useEffect(() => {
    if (!user) {
      setProfile(null);
      setMemberships([]);
      setActiveOrganizationId("");
      return;
    }
    void refreshWorkspace().catch((workspaceError) => {
      setError(workspaceError instanceof Error ? workspaceError.message : "Could not load your workspace.");
    });
  }, [refreshWorkspace, user]);

  const activeMembership = memberships.find((membership) => membership.orgId === activeOrganizationId) || null;

  const value = useMemo<AuthContextValue>(() => ({
    configured: supabaseConfigured,
    loading,
    workspaceLoading,
    session,
    user,
    profile,
    memberships,
    activeOrganization: activeMembership?.organization || null,
    activeMembership,
    error,
    signUp: async (input) => {
      if (!supabase) throw new Error("Supabase is not connected yet.");
      const { data, error: signUpError } = await supabase.auth.signUp({
        email: input.email,
        password: input.password,
        options: {
          emailRedirectTo: `${window.location.origin}/auth/callback`,
          data: {
            full_name: input.fullName,
            account_type: input.accountType,
            organization_name: input.organizationName || input.fullName
          }
        }
      });
      if (signUpError) throw signUpError;
      return data.session
        ? "Your workspace is ready."
        : "Check your email to verify the account, then return to sign in.";
    },
    signIn: async (email, password) => {
      if (!supabase) throw new Error("Supabase is not connected yet.");
      const { error: signInError } = await supabase.auth.signInWithPassword({ email, password });
      if (signInError) throw signInError;
    },
    signOut: async () => {
      if (!supabase) return;
      const { error: signOutError } = await supabase.auth.signOut();
      if (signOutError) throw signOutError;
    },
    requestPasswordReset: async (email) => {
      if (!supabase) throw new Error("Supabase is not connected yet.");
      const { error: resetError } = await supabase.auth.resetPasswordForEmail(email, {
        redirectTo: `${window.location.origin}/reset-password`
      });
      if (resetError) throw resetError;
    },
    updatePassword: async (password) => {
      if (!supabase) throw new Error("Supabase is not connected yet.");
      const { error: updateError } = await supabase.auth.updateUser({ password });
      if (updateError) throw updateError;
    },
    switchOrganization: (organizationId) => {
      if (!user || !memberships.some((membership) => membership.orgId === organizationId)) return;
      localStorage.setItem(activeOrgStorageKey(user.id), organizationId);
      setActiveOrganizationId(organizationId);
    },
    refreshWorkspace
  }), [activeMembership, error, loading, memberships, profile, refreshWorkspace, session, user, workspaceLoading]);

  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>;
}

export function useAuth() {
  const value = useContext(AuthContext);
  if (!value) throw new Error("useAuth must be used inside AuthProvider.");
  return value;
}
