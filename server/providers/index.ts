import { resolveConfig, type ResolvedConfig } from "../settings";
import { ClaudeProvider } from "./claude";
import { OpenAIProvider } from "./openai";
import type { ThinkProvider } from "./types";

/**
 * To add a provider:
 * 1. Implement ThinkProvider under providers/ (think() must return an object that passes ThinkOutputSchema)
 * 2. Register a factory in REGISTRY; it receives the resolved config (api key, model, effort)
 * 3. Add that SDK's error mapping to describeProviderError
 * 4. Pick it in Settings, or set PROVIDER=<name> in .env
 */
const REGISTRY: Record<string, (cfg: ResolvedConfig) => ThinkProvider> = {
  claude: (cfg) => new ClaudeProvider({ apiKey: cfg.apiKey, model: cfg.model, effort: cfg.effort }),
  openai: (cfg) => new OpenAIProvider({ apiKey: cfg.apiKey, model: cfg.model, effort: cfg.effort }),
  // gemini: (cfg) => new GeminiProvider({ ... }),
};

export const PROVIDER_NAMES = Object.keys(REGISTRY);

let instance: { key: string; provider: ThinkProvider } | undefined;

/** The provider for the current settings; rebuilt whenever the settings change. */
export function getProvider(provider?: string): ThinkProvider {
  const cfg = resolveConfig(provider);
  const factory = REGISTRY[cfg.provider];
  if (!factory) {
    throw new Error(`Unknown provider "${cfg.provider}". Available: ${PROVIDER_NAMES.join(", ")}`);
  }
  const key = JSON.stringify([cfg.provider, cfg.apiKey, cfg.model, cfg.effort]);
  if (!instance || instance.key !== key) instance = { key, provider: factory(cfg) };
  return instance.provider;
}

/** Map each SDK's errors to an HTTP response; null means unrecognised, fall through to 500. */
export function describeProviderError(err: unknown): { status: number; message: string } | null {
  return ClaudeProvider.describeError(err) ?? OpenAIProvider.describeError(err);
}

export { RefusalError, ThinkOutputSchema, type ThinkInput, type ThinkOutput, type ThinkProvider } from "./types";
