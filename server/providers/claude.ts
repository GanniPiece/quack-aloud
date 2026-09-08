import Anthropic from "@anthropic-ai/sdk";
import { zodOutputFormat } from "@anthropic-ai/sdk/helpers/zod";
import { RefusalError, ThinkOutputSchema, type ThinkInput, type ThinkOutput, type ThinkProvider } from "./types";

type Effort = "low" | "medium" | "high" | "xhigh" | "max";

export interface ClaudeOptions {
  apiKey?: string;
  model?: string;
  effort?: Effort;
}

export class ClaudeProvider implements ThinkProvider {
  readonly name = "claude";
  readonly model: string;
  readonly effort: Effort;
  private readonly apiKey: string | undefined;
  private client: Anthropic | null = null;

  constructor(opts: ClaudeOptions = {}) {
    this.apiKey = opts.apiKey;
    this.model = opts.model ?? "claude-opus-5";
    this.effort = opts.effort ?? "medium";
  }

  configured() {
    return Boolean(this.apiKey);
  }

  async think(input: ThinkInput): Promise<ThinkOutput> {
    if (!this.client) this.client = new Anthropic({ apiKey: this.apiKey });
    const response = await this.client.messages.parse({
      model: this.model,
      max_tokens: 16000,
      system: [{ type: "text", text: input.system, cache_control: { type: "ephemeral" } }],
      output_config: { effort: this.effort, format: zodOutputFormat(ThinkOutputSchema) },
      messages: [...input.history, { role: "user", content: input.userText }],
    });

    if (response.stop_reason === "refusal") {
      throw new RefusalError(response.stop_details?.explanation ?? "the model declined this message");
    }
    if (!response.parsed_output) {
      throw new Error("the model did not return valid JSON");
    }
    return response.parsed_output;
  }

  /** Map SDK errors to an HTTP status and message; other providers should offer the same. */
  static describeError(err: unknown): { status: number; message: string } | null {
    if (err instanceof Anthropic.AuthenticationError) {
      return { status: 401, message: "The API key was rejected. Check it in Settings." };
    }
    if (err instanceof Anthropic.RateLimitError) {
      return { status: 429, message: "Rate limited. Wait a moment and try again." };
    }
    if (err instanceof Anthropic.APIError) {
      return { status: err.status ?? 502, message: `Claude API error ${err.status ?? ""}: ${err.message}` };
    }
    return null;
  }
}
