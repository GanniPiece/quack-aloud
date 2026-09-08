import fs from "node:fs";
import path from "node:path";
import { DATA_DIR } from "./graph";

/**
 * Runtime settings the user can change from the app (Settings dialog), stored next to the
 * projects so a Docker volume keeps them. Values here win over environment variables;
 * the environment is the fallback for people who prefer .env.
 */
export const SETTINGS_PATH = path.join(DATA_DIR, "settings.json");

export type Effort = "low" | "medium" | "high" | "xhigh" | "max";
export const EFFORTS: Effort[] = ["low", "medium", "high", "xhigh", "max"];

export interface StoredSettings {
  provider?: string;
  /** API keys by provider name, e.g. { claude: "sk-ant-..." } */
  apiKeys?: Record<string, string>;
  model?: string;
  effort?: Effort;
}

export function readSettings(): StoredSettings {
  try {
    const raw = JSON.parse(fs.readFileSync(SETTINGS_PATH, "utf8")) as StoredSettings;
    return raw && typeof raw === "object" ? raw : {};
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
  const next: StoredSettings = { ...cur, apiKeys: { ...(cur.apiKeys ?? {}) } };
  if (patch.provider !== undefined) next.provider = patch.provider || undefined;
  const provider = patch.provider || cur.provider || process.env.PROVIDER || "claude";
  if (patch.apiKey !== undefined) {
    if (patch.apiKey.trim()) next.apiKeys![provider] = patch.apiKey.trim();
    else delete next.apiKeys![provider];
  }
  if (patch.model !== undefined) next.model = patch.model.trim() || undefined;
  if (patch.effort !== undefined) next.effort = EFFORTS.includes(patch.effort) ? patch.effort : undefined;
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
const ENV_MODEL: Record<string, string> = { claude: "CLAUDE_MODEL" };
const ENV_EFFORT: Record<string, string> = { claude: "CLAUDE_EFFORT" };

/** Effective configuration: stored settings first, environment second. */
export function resolveConfig(): ResolvedConfig {
  const s = readSettings();
  const provider = (s.provider || process.env.PROVIDER || "claude").toLowerCase();
  const stored = s.apiKeys?.[provider];
  const env = ENV_KEY[provider] ? process.env[ENV_KEY[provider]] : undefined;
  const apiKey = stored || env || undefined;
  const envEffort = ENV_EFFORT[provider] ? (process.env[ENV_EFFORT[provider]] as Effort | undefined) : undefined;
  return {
    provider,
    apiKey,
    keySource: stored ? "settings" : env ? "env" : "none",
    model: s.model || (ENV_MODEL[provider] ? process.env[ENV_MODEL[provider]] : undefined) || undefined,
    effort: s.effort ?? (envEffort && EFFORTS.includes(envEffort) ? envEffort : undefined),
  };
}

/** "sk-ant-…3f9a" style hint so the dialog can show that a key exists without revealing it. */
export function maskKey(key: string | undefined): string | null {
  if (!key) return null;
  if (key.length <= 8) return "••••";
  return `${key.slice(0, 6)}…${key.slice(-4)}`;
}
