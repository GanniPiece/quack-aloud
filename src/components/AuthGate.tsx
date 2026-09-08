import { useCallback, useEffect, useState, type ReactNode } from "react";
import { api, type AuthStatus } from "../api";
import { DuckIcon } from "./DuckIcon";

/**
 * Shows the setup screen (first run), the sign-in screen, or the app. Any API call that comes
 * back 401 raises the "qa:unauthorized" event, which brings the sign-in screen back.
 */
export function AuthGate({ children }: { children: ReactNode }) {
  const [status, setStatus] = useState<AuthStatus | null>(null);
  const [error, setError] = useState<string | null>(null);

  const refresh = useCallback(() => {
    api
      .authStatus()
      .then(setStatus)
      .catch((err) => setError((err as Error).message));
  }, []);

  useEffect(() => {
    refresh();
    const onUnauthorized = () => setStatus((s) => (s ? { ...s, user: null } : s));
    window.addEventListener("qa:unauthorized", onUnauthorized);
    return () => window.removeEventListener("qa:unauthorized", onUnauthorized);
  }, [refresh]);

  if (error) return <Screen title="Cannot reach the server"><p className="auth-error">{error}</p></Screen>;
  if (!status) return <Screen title="Loading…" />;
  if (!status.authRequired || status.user) return <>{children}</>;
  return status.configured ? <SignIn onDone={refresh} /> : <Setup onDone={refresh} />;
}

function Screen({ title, children }: { title: string; children?: ReactNode }) {
  return (
    <div className="auth-screen">
      <div className="auth-card">
        <DuckIcon size={72} />
        <h1>{title}</h1>
        {children}
      </div>
    </div>
  );
}

function Setup({ onDone }: { onDone: () => void }) {
  const [email, setEmail] = useState("");
  const [pw, setPw] = useState("");
  const [again, setAgain] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (pw !== again) {
      setError("The two passwords differ.");
      return;
    }
    setBusy(true);
    setError(null);
    try {
      await api.authSetup(email, pw);
      onDone();
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setBusy(false);
    }
  };
  return (
    <Screen title="Create the owner account">
      <p className="muted">This app talks to a paid API, so it asks everyone to sign in. This first account is the owner; it can add more accounts in Settings.</p>
      <form onSubmit={submit} className="auth-form">
        <input type="email" autoFocus autoComplete="username" placeholder="Email" value={email} onChange={(e) => setEmail(e.target.value)} />
        <input type="password" autoComplete="new-password" placeholder="Password (8+ characters)" value={pw} onChange={(e) => setPw(e.target.value)} />
        <input type="password" autoComplete="new-password" placeholder="Again" value={again} onChange={(e) => setAgain(e.target.value)} />
        {error && <div className="auth-error">{error}</div>}
        <button className="primary" disabled={busy || !email.includes("@") || pw.length < 8 || !again}>{busy ? "Creating…" : "Create account"}</button>
      </form>
    </Screen>
  );
}

function SignIn({ onDone }: { onDone: () => void }) {
  const [email, setEmail] = useState("");
  const [pw, setPw] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    setBusy(true);
    setError(null);
    try {
      await api.authLogin(email, pw);
      setPw("");
      onDone();
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setBusy(false);
    }
  };
  return (
    <Screen title="Sign in">
      <form onSubmit={submit} className="auth-form">
        <input type="email" autoFocus autoComplete="username" placeholder="Email" value={email} onChange={(e) => setEmail(e.target.value)} />
        <input type="password" autoComplete="current-password" placeholder="Password" value={pw} onChange={(e) => setPw(e.target.value)} />
        {error && <div className="auth-error">{error}</div>}
        <button className="primary" disabled={busy || !email || !pw}>{busy ? "Signing in…" : "Sign in"}</button>
      </form>
    </Screen>
  );
}
