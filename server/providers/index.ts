import { ClaudeProvider } from "./claude";
import type { ThinkProvider } from "./types";

/**
 * To add a provider:
 * 1. Implement ThinkProvider under providers/ (think() must return an object that passes ThinkOutputSchema)
 * 2. Register a name in REGISTRY
 * 3. Set PROVIDER=<name> in .env
 * 4. Add that SDK's error mapping to describeProviderError
 */
const REGISTRY: Record<string, () => ThinkProvider> = {
  claude: () => new ClaudeProvider(),
  // openai: () => new OpenAIProvider(),
  // gemini: () => new GeminiProvider(),
};

let instance: ThinkProvider | undefined;

export function getProvider(): ThinkProvider {
  if (instance) return instance;
  const name = (process.env.PROVIDER ?? "claude").toLowerCase();
  const factory = REGISTRY[name];
  if (!factory) {
    throw new Error(`Unknown PROVIDER="${name}". Available: ${Object.keys(REGISTRY).join(", ")}`);
  }
  instance = factory();
  return instance;
}

/** Map each SDK's errors to an HTTP response; null means unrecognised, fall through to 500. */
export function describeProviderError(err: unknown): { status: number; message: string } | null {
  return ClaudeProvider.describeError(err);
}

export { RefusalError, ThinkOutputSchema, type ThinkInput, type ThinkOutput, type ThinkProvider } from "./types";
