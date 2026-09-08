import { useEffect, useState } from "react";
import { api, type AuthUser, type SettingsInfo, type UserRecord } from "../api";

interface Props {
  onClose: () => void;
  /** Called after a successful save so the app can refresh its health pill */
  onSaved: () => void;
  /** Who is signed in; the owner also sees the accounts section */
  me: AuthUser | null;
}

function Accounts({ me }: { me: AuthUser }) {
  const [users, setUsers] = useState<UserRecord[] | null>(null);
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [msg, setMsg] = useState<string | null>(null);
  const reload = () => api.listUsers().then(setUsers).catch((err) => setMsg((err as Error).message));
  useEffect(() => {
    void reload();
  }, []);
  const add = async () => {
    setMsg(null);
    try {
      await api.addUser(email, password);
      setEmail("");
      setPassword("");
      await reload();
    } catch (err) {
      setMsg((err as Error).message);
    }
  };
  const remove = async (u: UserRecord) => {
    setMsg(null);
    try {
      await api.removeUser(u.id);
      await reload();
    } catch (err) {
      setMsg((err as Error).message);
    }
  };
  return (
    <details className="field">
      <summary>Accounts</summary>
      <ul className="user-list">
        {users?.map((u) => (
          <li key={u.id}>
            <span>{u.email}</span>
            <small>{u.role}</small>
            {u.email !== me.email && <button className="link" onClick={() => remove(u)}>remove</button>}
          </li>
        ))}
      </ul>
      <div className="field-row">
        <input type="email" placeholder="Email" value={email} onChange={(e) => setEmail(e.target.value)} />
        <input type="password" autoComplete="new-password" placeholder="Password (8+)" value={password} onChange={(e) => setPassword(e.target.value)} />
      </div>
      <div className="modal-actions">
        {msg && <small className="pw-msg">{msg}</small>}
        <button className="ghost" onClick={add} disabled={!email.includes("@") || password.length < 8}>Add account</button>
      </div>
    </details>
  );
}

/**
 * API key, provider, model, and effort, saved on the server (data/settings.json). The key is
 * write-only from here: the dialog only ever sees a masked hint of what is stored.
 */
export function SettingsDialog({ onClose, onSaved, me }: Props) {
  const [info, setInfo] = useState<SettingsInfo | null>(null);
  const [provider, setProvider] = useState("");
  const [apiKey, setApiKey] = useState("");
  const [model, setModel] = useState("");
  const [effort, setEffort] = useState("");
  const [clearKey, setClearKey] = useState(false);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [pwCurrent, setPwCurrent] = useState("");
  const [pwNext, setPwNext] = useState("");
  const [pwBusy, setPwBusy] = useState(false);
  const [pwMsg, setPwMsg] = useState<string | null>(null);

  const changePassword = async () => {
    setPwBusy(true);
    setPwMsg(null);
    try {
      await api.changePassword(pwCurrent, pwNext);
      setPwCurrent("");
      setPwNext("");
      setPwMsg("Password changed. Other sessions were signed out.");
    } catch (err) {
      setPwMsg((err as Error).message);
    } finally {
      setPwBusy(false);
    }
  };

  useEffect(() => {
    api
      .getSettings()
      .then((s) => {
        setInfo(s);
        setProvider(s.provider);
        setModel(s.model);
        setEffort(s.effort ?? "");
      })
      .catch((err) => setError((err as Error).message));
  }, []);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") onClose();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [onClose]);

  const save = async () => {
    setSaving(true);
    setError(null);
    try {
      const patch: Parameters<typeof api.putSettings>[0] = { provider, model, effort };
      if (clearKey) patch.apiKey = "";
      else if (apiKey.trim()) patch.apiKey = apiKey.trim();
      const next = await api.putSettings(patch);
      setInfo(next);
      setApiKey("");
      setClearKey(false);
      onSaved();
      onClose();
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setSaving(false);
    }
  };

  return (
    <div className="modal-backdrop" onMouseDown={(e) => e.target === e.currentTarget && onClose()}>
      <div className="modal" role="dialog" aria-label="Settings">
        <h2>Settings</h2>
        {!info && !error && <p className="muted">Loading…</p>}
        {info && (
          <>
            <label className="field">
              <span>Provider</span>
              <select value={provider} onChange={(e) => setProvider(e.target.value)}>
                {info.providers.map((p) => (
                  <option key={p} value={p}>{p}</option>
                ))}
              </select>
            </label>
            <label className="field">
              <span>API key</span>
              <input
                type="password"
                autoComplete="off"
                value={apiKey}
                placeholder={info.keyConfigured ? `Stored (${info.keyMasked}); type to replace` : "sk-ant-…"}
                disabled={clearKey}
                onChange={(e) => setApiKey(e.target.value)}
              />
              <small>
                {info.keyConfigured
                  ? info.keySource === "env"
                    ? "Currently from the environment (.env). A key saved here takes precedence."
                    : "Saved on this server in data/settings.json (readable by its owner only). It is never sent back to the browser."
                  : "Billed per token by the provider, separately from any chat subscription. Saved on the server, never in the browser."}
              </small>
              {info.keyConfigured && info.keySource === "settings" && (
                <label className="check">
                  <input type="checkbox" checked={clearKey} onChange={(e) => setClearKey(e.target.checked)} /> Remove the stored key
                </label>
              )}
            </label>
            <div className="field-row">
              <label className="field">
                <span>Model</span>
                <input value={model} onChange={(e) => setModel(e.target.value)} placeholder="claude-opus-5" />
              </label>
              <label className="field">
                <span>Effort</span>
                <select value={effort} onChange={(e) => setEffort(e.target.value)}>
                  {info.efforts.map((e) => (
                    <option key={e} value={e}>{e}</option>
                  ))}
                </select>
                <small>Higher is slower and costs more.</small>
              </label>
            </div>
          </>
        )}
        {error && <div className="chat-error">{error}</div>}
        <details className="field">
          <summary>Change password</summary>
          <div className="field-row">
            <input type="password" autoComplete="current-password" placeholder="Current password" value={pwCurrent} onChange={(e) => setPwCurrent(e.target.value)} />
            <input type="password" autoComplete="new-password" placeholder="New password (8+)" value={pwNext} onChange={(e) => setPwNext(e.target.value)} />
          </div>
          <div className="modal-actions">
            {pwMsg && <small className="pw-msg">{pwMsg}</small>}
            <button className="ghost" onClick={changePassword} disabled={pwBusy || pwNext.length < 8}>{pwBusy ? "Changing…" : "Change"}</button>
          </div>
        </details>
        {me?.role === "owner" && <Accounts me={me} />}
        <div className="modal-actions">
          <button className="ghost" onClick={onClose}>Cancel</button>
          <button className="primary" onClick={save} disabled={!info || saving}>
            {saving ? "Saving…" : "Save"}
          </button>
        </div>
      </div>
    </div>
  );
}
