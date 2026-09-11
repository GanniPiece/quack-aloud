/** Browser API providers. Coding agents connect separately through MCP. */
export type Effort = "none" | "low" | "medium" | "high" | "xhigh" | "max";

export const PROVIDER_DEFAULTS: Record<string, { model: string; effort: Effort; efforts: Effort[]; keyPlaceholder: string }> = {
  claude: {
    model: "claude-opus-5", effort: "medium",
    efforts: ["low", "medium", "high", "xhigh", "max"], keyPlaceholder: "sk-ant-…",
  },
  openai: {
    model: "gpt-5.4-mini", effort: "medium",
    efforts: ["none", "low", "medium", "high", "xhigh"], keyPlaceholder: "OpenAI API key",
  },
};

export function providerEfforts(provider: string): Effort[] {
  return PROVIDER_DEFAULTS[provider]?.efforts ?? [];
}
