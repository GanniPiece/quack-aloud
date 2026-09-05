import { describe, expect, it } from "vitest";
import { emptyGraph, type Graph } from "../shared/graph";
import { buildThinkInput, GUIDE_PROMPT, ORGANIZE_PROMPT } from "./prompt";

const graph: Graph = {
  ...emptyGraph(),
  groups: [{ id: "g", title: "G" }],
  nodes: [{ id: "a", label: "A", detail: "d", source: "the original sentence", origin: "user", kind: "entity", group: "g", seq: 2, x: 5, y: 6, createdAt: 1 }],
  edges: [{ id: "e", source: "a", target: "a", label: "self", origin: "ai" }],
  messages: Array.from({ length: 30 }, (_, i) => ({ role: i % 2 ? "assistant" : "user", content: `m${i}`, ts: i })) as Graph["messages"],
  layout: "mindmap",
};

describe("buildThinkInput", () => {
  it("picks the prompt by mode", () => {
    expect(buildThinkInput(graph, "hi", true).system).toBe(GUIDE_PROMPT);
    expect(buildThinkInput(graph, "hi", false).system).toBe(ORGANIZE_PROMPT);
    expect(buildThinkInput(graph, "hi", false).guide).toBe(false);
  });

  it("keeps only the last 20 messages", () => {
    const { history } = buildThinkInput(graph, "hi", true);
    expect(history).toHaveLength(20);
    expect(history[0].content).toBe("m10");
    expect(history.at(-1)!.content).toBe("m29");
  });

  it("prefixes the message with the canvas, without positions or provenance", () => {
    const { userText } = buildThinkInput(graph, "my thought", true);
    expect(userText.startsWith("<canvas>")).toBe(true);
    expect(userText.endsWith("my thought")).toBe(true);
    const canvas = JSON.parse(userText.slice("<canvas>".length, userText.indexOf("</canvas>")));
    expect(canvas.layout).toBe("mindmap");
    expect(canvas.groups).toEqual([{ id: "g", title: "G" }]);
    expect(canvas.nodes[0]).toEqual({ id: "a", label: "A", detail: "d", origin: "user", kind: "entity", group: "g", seq: 2 });
    expect(JSON.stringify(canvas)).not.toContain("original sentence");
    expect(canvas.edges[0]).toEqual({ source: "a", target: "a", label: "self", origin: "ai" });
  });

  it("both prompts forbid full sentences as labels", () => {
    for (const p of [GUIDE_PROMPT, ORGANIZE_PROMPT]) {
      expect(p).toContain("Never write a full sentence as a label");
      expect(p).toContain("kind=\"entity\"");
    }
    expect(ORGANIZE_PROMPT).toContain("No cards with kind \"question\"");
    expect(GUIDE_PROMPT).toContain("At most 3 per turn");
  });
});
