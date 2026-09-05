import Anthropic from "@anthropic-ai/sdk";
import { zodOutputFormat } from "@anthropic-ai/sdk/helpers/zod";
import { RefusalError, ThinkOutputSchema, type ThinkInput, type ThinkOutput, type ThinkProvider } from "./types";

type Effort = "low" | "medium" | "high" | "xhigh" | "max";

export class ClaudeProvider implements ThinkProvider {
  readonly name = "claude";
  readonly model = process.env.CLAUDE_MODEL ?? "claude-opus-5";
  readonly effort = (process.env.CLAUDE_EFFORT ?? "medium") as Effort;
  private client = new Anthropic();

  configured() {
    return Boolean(process.env.ANTHROPIC_API_KEY);
  }

  async think(input: ThinkInput): Promise<ThinkOutput> {
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
      return { status: 401, message: "Invalid or missing API key. Check ANTHROPIC_API_KEY in .env." };
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
