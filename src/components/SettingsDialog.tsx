import { useEffect, useState } from "react";
import { api, type AuthUser, type McpInfo, type SettingsInfo, type UserRecord } from "../api";

interface Props {
  onClose: () => void;
  /** Called after a successful save so the app can refresh its health pill */
  onSaved: () => void;
  /** Who is signed in; the owner also sees the accounts section */
  me: AuthUser | null;
}

function McpAccess() {
  const [info, setInfo] = useState<McpInfo | null>(null);
  const [msg, setMsg] = useState<string | null>(null);
  const [shown, setShown] = useState(false);
  const load = () => api.mcpInfo().then(setInfo).catch((err) => setMsg((err as Error).message));
  useEffect(() => {
    void load();
  }, []);
  const copy = async (text: string, what: string) => {
    try {
      await navigator.clipboard.writeText(text);
      setMsg(`${what} copied.`);
    } catch {
      setMsg("Copy failed; select the text and copy it yourself.");
    }
  };
  const rotate = async () => {
    setMsg(null);
    try {
      await api.rotateMcpToken();
      await load();
      setMsg("New token issued; agents using the old one must be updated.");
    } catch (err) {
      setMsg((err as Error).message);
    }
  };
  return (
    <details className="field">
      <summary>MCP access</summary>
      <small>Agents (Claude Code, Codex, Antigravity) can drive the duck over HTTP at the address below with this bearer token. Anyone holding the token can read and write every project.</small>
      {info && (
        <>
          <div className="token-row">
            <code>{shown ? info.token : "•".repeat(24)}</code>
            <button className="link" onClick={() => setShown((s) => !s)}>{shown ? "hide" : "show"}</button>
            <button className="link" onClick={() => copy(info.token, "Token")}>copy</button>
          </div>
          <small>Endpoint: <code>{info.url}</code></small>
          <div className="token-row">
            <small>Claude Code:</small>
            <button className="link" onClick={() => copy(info.claudeCode, "Command")}>copy the add command</button>
          </div>
          <div className="token-row">
            <small>Codex:</small>
            <button className="link" onClick={() => copy(info.codexConfig, "Codex HTTP config")}>copy HTTP config</button>
            <button className="link" onClick={() => copy(info.codex, "Codex command")}>copy the add command</button>
          </div>
          <small>Codex in this repo uses local MCP by default. For HTTP, replace its .codex/config.toml MCP table with the copied HTTP config. For other workspaces, use the add command. Set QUACK_ALOUD_MCP_TOKEN to the token above in Codex's launch environment, then restart Codex. Antigravity accepts the endpoint and an Authorization: Bearer header.</small>
          <div className="modal-actions">
            {msg && <small className="pw-msg">{msg}</small>}
            <button className="ghost" onClick={rotate} disabled={info.source === "env"} title={info.source === "env" ? "Set by MCP_TOKEN in the environment" : "Issue a new token"}>Rotate token</button>
          </div>
        </>
      )}
      {!info && msg && <small className="pw-msg">{msg}</small>}
    </details>
  );
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
  const selected = info?.configurations[provider];
  const canEdit = me?.role === "owner";

  const selectProvider = (name: string) => {
    const config = info?.configurations[name];
    if (!config) return;
    setProvider(name);
    setModel(config.model);
    setEffort(config.effort ?? "");
    // A typed key must never be carried into another provider's save request.
    setApiKey("");
    setClearKey(false);
    setError(null);
  };

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
        {info && selected && (
          <fieldset className="provider-settings" disabled={!canEdit || saving}>
            {!canEdit && <p className="muted">Only the owner can change the shared AI settings.</p>}
            <label className="field">
              <span>Provider</span>
              <select value={provider} onChange={(e) => selectProvider(e.target.value)}>
                {info.providers.map((p) => (
                  <option key={p} value={p}>{p}</option>
                ))}
              </select>
              <small>Browser chat uses the selected provider's API key. Save before switching to keep edits; switching loads that provider's saved settings.</small>
            </label>
            <label className="field">
              <span>API key</span>
              <input
                type="password"
                autoComplete="off"
                value={apiKey}
                placeholder={selected.keyConfigured ? `Configured (${selected.keyMasked}); type to replace` : selected.keyPlaceholder}
                disabled={clearKey}
                onChange={(e) => setApiKey(e.target.value)}
              />
              <small>
                {selected.keyConfigured
                  ? selected.keySource === "env"
                    ? "Currently from the environment (.env). A key saved here takes precedence."
                    : "Saved on this server in data/settings.json (readable by its owner only). It is never sent back to the browser."
                  : "Billed per token by the provider, separately from any chat subscription. Saved on the server, never in the browser."}
              </small>
              {selected.keyConfigured && selected.keySource === "settings" && (
                <label className="check">
                  <input type="checkbox" checked={clearKey} onChange={(e) => setClearKey(e.target.checked)} /> Remove the stored key
                </label>
              )}
            </label>
            <div className="field-row">
              <label className="field">
                <span>Model</span>
                <input value={model} onChange={(e) => setModel(e.target.value)} placeholder={selected.defaultModel} />
              </label>
              <label className="field">
                <span>Effort</span>
                <select value={effort} onChange={(e) => setEffort(e.target.value)}>
                  {selected.efforts.map((e) => (
                    <option key={e} value={e}>{e}</option>
                  ))}
                </select>
                <small>Higher is slower and costs more.</small>
              </label>
            </div>
          </fieldset>
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
        {me?.role === "owner" && <McpAccess />}
        {me?.role === "owner" && <Accounts me={me} />}
        <div className="modal-actions">
          <button className="ghost" onClick={onClose}>Cancel</button>
          <button className="primary" onClick={save} disabled={!info || saving || !canEdit}>
            {saving ? "Saving…" : "Save"}
          </button>
        </div>
      </div>
    </div>
  );
}
