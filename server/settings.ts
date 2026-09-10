import fs from "node:fs";
import path from "node:path";
import { DATA_DIR } from "./graph";
import { providerEfforts, type Effort } from "./providerConfig";
export type { Effort } from "./providerConfig";

/**
 * Runtime settings the user can change from the app (Settings dialog), stored next to the
 * projects so a Docker volume keeps them. Values here win over environment variables;
 * the environment is the fallback for people who prefer .env.
 */
export const SETTINGS_PATH = path.join(DATA_DIR, "settings.json");

export interface StoredSettings {
  provider?: string;
  /** API keys by provider name, e.g. { claude: "sk-ant-..." } */
  apiKeys?: Record<string, string>;
  providerSettings?: Record<string, { model?: string; effort?: Effort }>;
}

export function readSettings(): StoredSettings {
  try {
    const raw = JSON.parse(fs.readFileSync(SETTINGS_PATH, "utf8")) as StoredSettings & { model?: string; effort?: Effort };
    if (!raw || typeof raw !== "object" || Array.isArray(raw)) return {};
    // Read old installations without changing their selected provider or touching keys.
    // The migrated shape is persisted the next time the owner saves Settings.
    const { model, effort, ...settings } = raw;
    if (model !== undefined || effort !== undefined) {
      const provider = (raw.provider || process.env.PROVIDER || "claude").toLowerCase();
      settings.providerSettings = {
        ...settings.providerSettings,
        [provider]: { model, effort, ...settings.providerSettings?.[provider] },
      };
    }
    return settings;
  } catch {
    return {};
  }
}

export function writeSettings(next: StoredSettings): void {
  fs.mkdirSync(DATA_DIR, { recursive: true });
  const tmp = `${SETTINGS_PATH}.tmp`;
  fs.writeFileSync(tmp, JSON.stringify(next, null, 2) + "\n", { mode: 0o600 });
  fs.renameSync(tmp, SETTINGS_PATH);
  try {
    fs.chmodSync(SETTINGS_PATH, 0o600);
  } catch {
    /* not every filesystem supports it */
  }
}

/** Merge a partial update. An empty apiKey clears the stored key for that provider. */
export function updateSettings(patch: { provider?: string; apiKey?: string; model?: string; effort?: Effort }): StoredSettings {
  const cur = readSettings();
  const next: StoredSettings = { ...cur, apiKeys: { ...cur.apiKeys }, providerSettings: { ...cur.providerSettings } };
  if (patch.provider !== undefined) next.provider = patch.provider.toLowerCase() || undefined;
  const provider = (patch.provider || cur.provider || process.env.PROVIDER || "claude").toLowerCase();
  if (patch.apiKey !== undefined) {
    if (patch.apiKey.trim()) next.apiKeys![provider] = patch.apiKey.trim();
    else delete next.apiKeys![provider];
  }
  const prefs = { ...next.providerSettings![provider] };
  if (patch.model !== undefined) prefs.model = patch.model.trim() || undefined;
  if (patch.effort !== undefined) prefs.effort = providerEfforts(provider).includes(patch.effort) ? patch.effort : undefined;
  next.providerSettings![provider] = prefs;
  if (Object.keys(next.apiKeys!).length === 0) delete next.apiKeys;
  writeSettings(next);
  return next;
}

export interface ResolvedConfig {
  provider: string;
  apiKey: string | undefined;
  /** Where the key came from, for the settings dialog */
  keySource: "settings" | "env" | "none";
  model: string | undefined;
  effort: Effort | undefined;
}

const ENV_KEY: Record<string, string> = { claude: "ANTHROPIC_API_KEY", openai: "OPENAI_API_KEY", gemini: "GEMINI_API_KEY" };
const ENV_MODEL: Record<string, string> = { claude: "CLAUDE_MODEL", openai: "OPENAI_MODEL" };
const ENV_EFFORT: Record<string, string> = { claude: "CLAUDE_EFFORT", openai: "OPENAI_EFFORT" };

/** Effective configuration: stored settings first, environment second. */
export function resolveConfig(selectedProvider?: string): ResolvedConfig {
  const s = readSettings();
  const provider = (selectedProvider || s.provider || process.env.PROVIDER || "claude").toLowerCase();
  const stored = s.apiKeys?.[provider];
  const env = ENV_KEY[provider] ? process.env[ENV_KEY[provider]] : undefined;
  const apiKey = stored || env || undefined;
  const envEffort = ENV_EFFORT[provider] ? (process.env[ENV_EFFORT[provider]] as Effort | undefined) : undefined;
  const prefs = s.providerSettings?.[provider];
  const effort = prefs?.effort ?? envEffort;
  return {
    provider,
    apiKey,
    keySource: stored ? "settings" : env ? "env" : "none",
    model: prefs?.model || (ENV_MODEL[provider] ? process.env[ENV_MODEL[provider]] : undefined) || undefined,
    effort: effort && providerEfforts(provider).includes(effort) ? effort : undefined,
  };
}

/** "sk-ant-…3f9a" style hint so the dialog can show that a key exists without revealing it. */
export function maskKey(key: string | undefined): string | null {
  if (!key) return null;
  if (key.length <= 8) return "••••";
  return `${key.slice(0, 6)}…${key.slice(-4)}`;
}
