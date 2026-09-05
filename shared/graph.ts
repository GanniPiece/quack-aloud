// Graph state shared by server and client. data/graph.json is this type serialised.

export type Origin = "user" | "ai";
/**
 * What a card is:
 * - entity: a person, thing, place, or concept (a noun)
 * - event: something that happened or was done
 * - claim: something someone believes, says, or assumes
 * - idea: fallback for hand-added or unclassified cards
 * - question / insight / todo / challenge: the duck's own cards (guidance on);
 *   a challenge is the duck pushing back on something it doubts
 */
export type NodeKind = "entity" | "event" | "claim" | "idea" | "question" | "insight" | "todo" | "challenge";

/** Kinds only the duck creates; dropped when guidance is off. */
export const DUCK_KINDS: NodeKind[] = ["question", "insight", "todo", "challenge"];

/**
 * How the canvas is arranged:
 * - themes: one column per theme with a container (default)
 * - layered: ranked left-to-right by edge direction (cause -> effect, dependency chains)
 * - timeline: events in sequence along a middle axis, entities above, claims below
 * - mindmap: a tree spreading left and right from a root concept
 */
export type LayoutKind = "themes" | "layered" | "timeline" | "mindmap";
export const LAYOUT_LABEL: Record<LayoutKind, string> = {
  themes: "Themes",
  layered: "Layered",
  timeline: "Timeline",
  mindmap: "Mind map",
};

export interface ThoughtNode {
  id: string;
  label: string;
  /** Short clarification or attribute (e.g. "3 times", "twice, saw nothing") */
  detail?: string;
  /** The fragment of the user's sentence this card came from; shown as provenance, not on the card face */
  source?: string;
  origin: Origin;
  kind: NodeKind;
  /** Theme this card belongs to (a Group id). Undefined = loose card. */
  group?: string;
  /** Position on the story timeline (1, 2, 3, ...). Only for time-bound events. */
  seq?: number;
  x: number;
  y: number;
  createdAt: number;
}

/** A theme the duck sorted cards into. Drawn as a labelled container behind its cards. */
export interface Group {
  id: string;
  title: string;
}

export interface ThoughtEdge {
  id: string;
  source: string;
  target: string;
  label?: string;
  origin: Origin;
}

export interface ChatMessage {
  role: "user" | "assistant";
  content: string;
  ts: number;
}

export interface Graph {
  version: 1;
  /** Project name. Each project is one file under data/projects/. */
  name?: string;
  /** Layout pinned by the user; undefined = follow suggestedLayout */
  layout?: LayoutKind;
  /** Layout the duck thinks fits the content */
  suggestedLayout?: LayoutKind;
  /** Central concept for the mind map (a node id) */
  root?: string;
  groups: Group[];
  nodes: ThoughtNode[];
  edges: ThoughtEdge[];
  messages: ChatMessage[];
  updatedAt: number;
}

/** Relation labels that mean "child -> parent" in a hierarchy, in English and Chinese. */
const HIERARCHY_LABEL = /\b(kind|type|sort|part|member|instance|example|subtype|category)s? of\b|\bbelongs? to\b|\bis an?\b|是一種|是一個|屬於|一種|例子|分類|種類|類型|子類|成員|之一/i;

export function isHierarchyEdge(e: { label?: string }): boolean {
  return !!e.label && HIERARCHY_LABEL.test(e.label);
}

export const NODE_W = 220;
/** Nominal card height; CSS clamps label and detail so real cards stay close to this. */
export const NODE_H = 120;
export const GAP_X = 60;
export const GAP_Y = 28;
/** Space reserved above a group's first card for the group title. */
export const GROUP_HEADER = 44;
export const GROUP_PAD = 20;

export const KIND_LABEL: Record<NodeKind, string> = {
  entity: "entity",
  event: "event",
  claim: "claim",
  idea: "idea",
  question: "question",
  insight: "insight",
  todo: "to verify",
  challenge: "challenge",
};

export function emptyGraph(): Graph {
  return { version: 1, groups: [], nodes: [], edges: [], messages: [], updatedAt: 0 };
}

/** Content-only signature (ignores updatedAt and key order) for comparing two graphs. */
export function graphSignature(g: Graph): string {
  return stableStringify({
    name: g.name,
    layout: g.layout,
    suggestedLayout: g.suggestedLayout,
    root: g.root,
    groups: g.groups,
    nodes: g.nodes,
    edges: g.edges,
    messages: g.messages,
  });
}

function stableStringify(value: unknown): string {
  if (Array.isArray(value)) return `[${value.map(stableStringify).join(",")}]`;
  if (value && typeof value === "object") {
    const obj = value as Record<string, unknown>;
    const keys = Object.keys(obj)
      .filter((k) => obj[k] !== undefined)
      .sort();
    return `{${keys.map((k) => `${JSON.stringify(k)}:${stableStringify(obj[k])}`).join(",")}}`;
  }
  return JSON.stringify(value);
}
