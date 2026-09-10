import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { emptyGraph } from "../../shared/graph";
import { buildThinkInput } from "../prompt";
import { applyThinkResult } from "../graph";
import { OpenAIProvider } from "./openai";
import { describeProviderError, RefusalError } from "./index";
import type { ThinkOutput } from "./types";

const output: ThinkOutput = {
  reply: "Filed the database under Performance.", layout: "themes", root: null,
  groups: [{ id: "performance", title: "Performance" }], updates: [],
  nodes: [{ id: "database", label: "Database", kind: "entity", origin: "user", group: "performance", source: "database", detail: null, seq: null, anchor_id: null }],
  edges: [], remove_edges: [],
};
const input = buildThinkInput(emptyGraph(), "The database is slow", false);
const response = (content: unknown[] = [{ type: "output_text", text: JSON.stringify(output), annotations: [] }]) => ({
  id: "resp_test", object: "response", status: "completed",
  output: [{ id: "msg_test", type: "message", role: "assistant", status: "completed", content }],
});
let fetchMock: ReturnType<typeof vi.fn>;
beforeEach(() => {
  fetchMock = vi.fn().mockImplementation(async () => new Response(JSON.stringify(response()), { headers: { "Content-Type": "application/json" } }));
  vi.stubGlobal("fetch", fetchMock);
});
afterEach(() => vi.unstubAllGlobals());

describe("OpenAI browser provider", () => {
  it("uses the real SDK to send the shared prompt/schema and produces a mergeable result", async () => {
    const provider = new OpenAIProvider({ apiKey: "test-openai-key" });
    const result = await provider.think(input);
    expect(result).toEqual(output);
    const [url, init] = fetchMock.mock.calls[0];
    expect(String(url)).toBe("https://api.openai.com/v1/responses");
    expect(new Headers(init.headers).get("authorization")).toBe("Bearer test-openai-key");
    const body = JSON.parse(init.body);
    expect(body).toMatchObject({ model: "gpt-5.4-mini", instructions: input.system, reasoning: { effort: "medium" }, store: false });
    expect(body.input.at(-1)).toEqual({ role: "user", content: input.userText });
    expect(body.text.format).toMatchObject({ type: "json_schema", strict: true });
    expect(body.text.format.schema.properties).toHaveProperty("remove_edges");
    expect(body.tools).toBeUndefined();
    const graph = applyThinkResult(emptyGraph(), "The database is slow", result, { guide: false });
    expect(graph.nodes[0].label).toBe("Database");
    expect(graph.messages).toHaveLength(2);
  });

  it("passes conversation history and guidance, with configured model and effort", async () => {
    const graph = emptyGraph();
    graph.messages = [{ role: "user", content: "Earlier thought", ts: 1 }];
    const guided = buildThinkInput(graph, "Guide me", true);
    await new OpenAIProvider({ apiKey: "test", model: "gpt-5.4", effort: "none" }).think(guided);
    const body = JSON.parse(fetchMock.mock.calls[0][1].body);
    expect(body.instructions).toBe(guided.system);
    expect(body.input[0]).toEqual({ role: "user", content: "Earlier thought" });
    expect(body).toMatchObject({ model: "gpt-5.4", reasoning: { effort: "none" } });
  });

  it("reports refusals without accepting a graph result", async () => {
    fetchMock.mockResolvedValue(new Response(JSON.stringify(response([{ type: "refusal", refusal: "Cannot help with that." }])), { headers: { "Content-Type": "application/json" } }));
    await expect(new OpenAIProvider({ apiKey: "test" }).think(input)).rejects.toBeInstanceOf(RefusalError);
  });

  it("rejects incomplete responses before any canvas can be saved", async () => {
    fetchMock.mockResolvedValue(new Response(JSON.stringify({ ...response([{ type: "output_text", text: '{"reply":', annotations: [] }]), status: "incomplete", incomplete_details: { reason: "max_output_tokens" } }), { headers: { "Content-Type": "application/json" } }));
    await expect(new OpenAIProvider({ apiKey: "test" }).think(input)).rejects.toThrow("max_output_tokens");
  });

  it("rejects schema-invalid model output", async () => {
    fetchMock.mockResolvedValue(new Response(JSON.stringify(response([{ type: "output_text", text: '{"reply":"missing cards"}', annotations: [] }])), { headers: { "Content-Type": "application/json" } }));
    await expect(new OpenAIProvider({ apiKey: "test" }).think(input)).rejects.toThrow();
  });

  it("maps SDK authentication failures for the browser", async () => {
    fetchMock.mockResolvedValue(new Response(JSON.stringify({ error: { message: "Invalid API key", type: "invalid_request_error" } }), { status: 401 }));
    const err = await new OpenAIProvider({ apiKey: "bad" }).think(input).catch((error: unknown) => error);
    expect(describeProviderError(err)).toEqual({ status: 401, message: "The OpenAI API key was rejected. Check it in Settings." });
    expect(new OpenAIProvider().configured()).toBe(false);
  });
});
