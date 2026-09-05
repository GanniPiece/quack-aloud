import { z } from "zod";
import type { Graph } from "../../shared/graph";

// Every provider must return this shape; graph.ts merges nothing else.
const LayoutEnum = z.enum(["themes", "layered", "timeline", "mindmap"]);

export const ThinkOutputSchema = z.object({
  reply: z.string().describe("Reply to the user; see the system prompt for length and tone"),
  layout: LayoutEnum.nullable().describe(
    "Which arrangement fits the whole canvas now: timeline for narratives and processes, mindmap for knowledge around a central concept, layered for cause/effect or dependency chains, themes for a loose collection. Null to keep the current one",
  ),
  root: z.string().nullable().describe("Node id of the central concept, for mindmap. Null if none"),
  groups: z.array(
    z.object({
      id: z.string().describe("Short slug, e.g. symbols"),
      title: z.string().describe("1–3 word theme title in the user's language"),
    }),
  ).describe("New themes to create. Reuse existing group ids from the canvas instead of recreating them"),
  updates: z.array(
    z.object({
      id: z.string().describe("Id of an existing node"),
      label: z.string().nullable().describe("New label, or null to keep"),
      detail: z.string().nullable().describe("New detail, or null to keep"),
      group: z.string().nullable().describe("Move to this group id, or null to keep"),
      seq: z.number().int().nullable().describe("New timeline position, or null to keep"),
    }),
  ).describe("Refinements to existing cards when new input clarifies or extends them"),
  nodes: z.array(
    z.object({
      id: z.string().describe("Short slug, e.g. alice, saw-dead-cat"),
      label: z.string().describe("1–5 words: a noun for entities, a short verb phrase for events, a short statement for claims. Never a full sentence"),
      detail: z.string().nullable().describe("Attribute or clarification, e.g. '3 times', 'twice, saw nothing'. Null if none"),
      source: z.string().nullable().describe("The fragment of the user's sentence this came from, verbatim"),
      origin: z.enum(["user", "ai"]),
      kind: z.enum(["entity", "event", "claim", "question", "insight", "todo", "challenge"]),
      group: z.string().nullable().describe("Group id this card belongs to (existing or created this turn)"),
      seq: z.number().int().nullable().describe("Position on the story timeline (1, 2, 3, ...) for time-bound events; null otherwise"),
      anchor_id: z.string().nullable().describe("Existing node id this card follows from, else null"),
    }),
  ),
  edges: z.array(
    z.object({
      source: z.string(),
      target: z.string(),
      label: z.string().nullable().describe("The verb or relation, 1–4 words, e.g. says, saw, doesn't believe, in, causes"),
      origin: z.enum(["user", "ai"]),
    }),
  ),
});

export type ThinkOutput = z.infer<typeof ThinkOutputSchema>;

/** What a provider receives: prompt material already assembled; the provider only sends it and returns JSON. */
export interface ThinkInput {
  system: string;
  history: { role: "user" | "assistant"; content: string }[];
  userText: string;
  graph: Graph;
  /** true = the duck may add its own questions and observations; false = organise only */
  guide: boolean;
}

export interface ThinkProvider {
  /** Name shown in the UI, e.g. "claude" */
  readonly name: string;
  /** Model id in use */
  readonly model: string;
  /** Reasoning effort or equivalent setting, undefined if none */
  readonly effort?: string;
  /** Whether credentials are present; the UI warns when false */
  configured(): boolean;
  think(input: ThinkInput): Promise<ThinkOutput>;
}

/** Thrown when the model declines to answer; the server maps it to 422. */
export class RefusalError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "RefusalError";
  }
}
