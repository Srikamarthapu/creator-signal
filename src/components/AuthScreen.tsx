import { ArrowRight, BriefcaseBusiness, Check, KeyRound, Sparkles, UserRound, UsersRound } from "lucide-react";
import { type FormEvent, useEffect, useState } from "react";
import { type AccountType, useAuth } from "./AuthProvider";

type AuthMode = "sign-in" | "sign-up" | "forgot" | "reset";

const accountOptions: Array<{
  id: AccountType;
  label: string;
  detail: string;
  icon: typeof BriefcaseBusiness;
}> = [
  { id: "business", label: "Business", detail: "Build campaigns with a team workspace.", icon: BriefcaseBusiness },
  { id: "professional", label: "Professional", detail: "Manage creator work for clients or yourself.", icon: UserRound },
  { id: "creator", label: "Creator", detail: "Prepare for opportunities and collaboration.", icon: Sparkles }
];

export function AuthScreen({
  initialMode = "sign-in",
  navigate,
  afterAuthPath = "/workspace",
  context
}: {
  initialMode?: AuthMode;
  navigate: (path: string) => void;
  afterAuthPath?: string;
  context?: {
    eyebrow: string;
    title: string;
    detail: string;
  };
}) {
  const auth = useAuth();
  const [mode, setMode] = useState<AuthMode>(initialMode);
  const [accountType, setAccountType] = useState<AccountType>("business");
  const [fullName, setFullName] = useState("");
  const [organizationName, setOrganizationName] = useState("");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [working, setWorking] = useState(false);
  const [message, setMessage] = useState("");
  const [error, setError] = useState("");

  useEffect(() => setMode(initialMode), [initialMode]);

  useEffect(() => {
    if (auth.user && mode !== "reset") navigate(afterAuthPath);
  }, [afterAuthPath, auth.user, mode, navigate]);

  const submit = async (event: FormEvent) => {
    event.preventDefault();
    if (!auth.configured || working) return;
    setWorking(true);
    setError("");
    setMessage("");
    try {
      if (mode === "sign-up") {
        const result = await auth.signUp({ email, password, fullName, accountType, organizationName });
        setMessage(result);
      } else if (mode === "forgot") {
        await auth.requestPasswordReset(email);
        setMessage("Check your email for a secure password reset link.");
      } else if (mode === "reset") {
        await auth.updatePassword(password);
        setMessage("Password updated. Your account is ready.");
        window.setTimeout(() => navigate(afterAuthPath), 700);
      } else {
        await auth.signIn(email, password);
      }
    } catch (submitError) {
      setError(submitError instanceof Error ? submitError.message : "Authentication could not be completed.");
    } finally {
      setWorking(false);
    }
  };

  const changeMode = (nextMode: AuthMode) => {
    setMode(nextMode);
    setError("");
    setMessage("");
  };

  return (
    <section className="auth-shell">
      <div className="auth-context">
        <span className="auth-context-icon"><UsersRound className="h-6 w-6" /></span>
        <p className="eyebrow">{context?.eyebrow || "Creator partnerships workspace"}</p>
        <h1>{context?.title || "Move from real evidence to an approved campaign."}</h1>
        <p>{context?.detail || "One account can participate as a creator and belong to one or more business workspaces. Access follows workspace membership, never an editable profile label."}</p>
        <div className="auth-trust-list">
          <span><Check className="h-4 w-4" /> Source-backed creator research</span>
          <span><Check className="h-4 w-4" /> Private organization workspaces</span>
          <span><Check className="h-4 w-4" /> Human approval before consequential actions</span>
        </div>
      </div>

      <div className="auth-form-panel">
        {!auth.configured ? (
          <div className="auth-setup-state" role="status">
            <KeyRound className="h-6 w-6" />
            <div>
              <h2>Connect Supabase to enable accounts</h2>
              <p>The authentication and workspace foundation is installed, but this environment has no Supabase project configured yet.</p>
            </div>
          </div>
        ) : null}

        {mode !== "forgot" && mode !== "reset" ? (
          <div className="auth-mode-switch" role="tablist" aria-label="Account access">
            <button type="button" role="tab" aria-selected={mode === "sign-in"} onClick={() => changeMode("sign-in")}>Sign in</button>
            <button type="button" role="tab" aria-selected={mode === "sign-up"} onClick={() => changeMode("sign-up")}>Create account</button>
          </div>
        ) : null}

        <div className="auth-form-heading">
          <p className="eyebrow">{mode === "sign-up" ? "New workspace" : mode === "forgot" ? "Account recovery" : mode === "reset" ? "Secure account" : "Welcome back"}</p>
          <h2>{mode === "sign-up" ? "Choose how you are starting" : mode === "forgot" ? "Reset your password" : mode === "reset" ? "Choose a new password" : "Sign in to your workspace"}</h2>
        </div>

        <form className="auth-form" onSubmit={submit}>
          {mode === "sign-up" ? (
            <fieldset className="account-type-picker">
              <legend>Starting as</legend>
              {accountOptions.map((option) => {
                const Icon = option.icon;
                return (
                  <label key={option.id} className={accountType === option.id ? "account-type-option account-type-option-selected" : "account-type-option"}>
                    <input type="radio" name="account-type" value={option.id} checked={accountType === option.id} onChange={() => setAccountType(option.id)} />
                    <Icon className="h-5 w-5" />
                    <span><b>{option.label}</b><small>{option.detail}</small></span>
                  </label>
                );
              })}
            </fieldset>
          ) : null}

          {mode === "sign-up" ? (
            <label>
              <span>Your name</span>
              <input value={fullName} onChange={(event) => setFullName(event.target.value)} autoComplete="name" required maxLength={120} />
            </label>
          ) : null}

          {mode === "sign-up" && accountType === "business" ? (
            <label>
              <span>Business name</span>
              <input value={organizationName} onChange={(event) => setOrganizationName(event.target.value)} autoComplete="organization" required maxLength={120} />
            </label>
          ) : null}

          {mode !== "reset" ? (
            <label>
              <span>Email</span>
              <input type="email" value={email} onChange={(event) => setEmail(event.target.value)} autoComplete="email" required maxLength={240} />
            </label>
          ) : null}

          {mode !== "forgot" ? (
            <label>
              <span>Password</span>
              <input type="password" value={password} onChange={(event) => setPassword(event.target.value)} autoComplete={mode === "sign-in" ? "current-password" : "new-password"} minLength={8} required />
            </label>
          ) : null}

          {error || auth.error ? <p className="auth-form-error" role="alert">{error || auth.error}</p> : null}
          {message ? <p className="auth-form-success" role="status">{message}</p> : null}

          <button className="primary-button auth-submit" type="submit" disabled={!auth.configured || working}>
            <span>{working ? "Working..." : mode === "sign-up" ? "Create workspace" : mode === "forgot" ? "Send reset link" : mode === "reset" ? "Update password" : "Sign in"}</span>
            <ArrowRight className="h-4 w-4" />
          </button>

          {mode === "sign-in" ? <button className="auth-text-button" type="button" onClick={() => changeMode("forgot")}>Forgot password?</button> : null}
          {mode === "forgot" || mode === "reset" ? <button className="auth-text-button" type="button" onClick={() => changeMode("sign-in")}>Return to sign in</button> : null}
        </form>
      </div>
    </section>
  );
}
