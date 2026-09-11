import OpenAI from "openai";
import { zodTextFormat } from "openai/helpers/zod";
import { PROVIDER_DEFAULTS, type Effort } from "../providerConfig";
import { RefusalError, ThinkOutputSchema, type ThinkInput, type ThinkOutput, type ThinkProvider } from "./types";

export interface OpenAIOptions {
  apiKey?: string;
  model?: string;
  effort?: Effort;
}

/** Direct API calls only: no Codex process, account login, or agent tools. */
export class OpenAIProvider implements ThinkProvider {
  readonly name = "openai";
  readonly model: string;
  readonly effort: Exclude<Effort, "max">;
  private readonly apiKey: string | undefined;
  private client: OpenAI | null = null;

  constructor(opts: OpenAIOptions = {}) {
    this.apiKey = opts.apiKey;
    this.model = opts.model || PROVIDER_DEFAULTS.openai.model;
    this.effort = opts.effort && opts.effort !== "max" ? opts.effort : "medium";
  }

  configured() { return Boolean(this.apiKey); }

  async think(input: ThinkInput): Promise<ThinkOutput> {
    if (!this.client) this.client = new OpenAI({ apiKey: this.apiKey, timeout: 120_000, maxRetries: 1 });
    const response = await this.client.responses.parse({
      model: this.model,
      instructions: input.system,
      input: [...input.history, { role: "user", content: input.userText }],
      reasoning: { effort: this.effort },
      text: { format: zodTextFormat(ThinkOutputSchema, "duck_turn") },
      max_output_tokens: 16000,
      store: false,
    });

    for (const item of response.output) {
      if (item.type !== "message") continue;
      for (const content of item.content) {
        if (content.type === "refusal") throw new RefusalError(content.refusal);
      }
    }
    if (response.status !== "completed") {
      throw new Error(`OpenAI response was ${response.status}: ${response.incomplete_details?.reason ?? response.error?.message ?? "try again"}`);
    }
    if (!response.output_parsed) throw new Error("OpenAI did not return a structured result. Try again.");
    return ThinkOutputSchema.parse(response.output_parsed);
  }

  static describeError(err: unknown): { status: number; message: string } | null {
    if (err instanceof OpenAI.AuthenticationError) return { status: 401, message: "The OpenAI API key was rejected. Check it in Settings." };
    if (err instanceof OpenAI.RateLimitError) return { status: 429, message: "OpenAI rate or usage limit reached. Check your API quota, or try again later." };
    if (err instanceof OpenAI.APIConnectionTimeoutError) return { status: 504, message: "OpenAI took too long to respond. Try again." };
    if (err instanceof OpenAI.APIConnectionError) return { status: 502, message: "Could not connect to OpenAI. Try again." };
    if (err instanceof OpenAI.APIError) return { status: err.status ?? 502, message: `OpenAI API error ${err.status ?? ""}: ${err.message}` };
    return null;
  }
}
