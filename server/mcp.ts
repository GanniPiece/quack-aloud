import "dotenv/config";
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { z } from "zod";
import { createCanvasTool, createProjectTool, duckTurnTool, listProjectsTool, readCanvasTool } from "./mcpTools";
import { ORGANISE_RULES } from "./prompt";
import { ThinkOutputSchema } from "./providers/types";

/**
 * MCP server (stdio) so Claude Code, Codex, Antigravity, or any MCP client can be the duck without an
 * API key and without hand-editing JSON: the agent reads the canvas, decides the decomposition,
 * and hands it to duck_turn, which applies the same merge logic the in-app chat uses.
 *
 *   claude mcp add quack-aloud -- npx tsx server/mcp.ts     (or the .mcp.json in this repo)
 */

const INSTRUCTIONS = `You are the duck of Quack Aloud, a thinking canvas. The user thinks out loud; you file what they say as cards on their open canvas.

How to work:
1. list_projects, then read_canvas for the canvas the user names. MCP cannot see the browser's selected canvas; use the most recently updated one as a default and ask if the target is unclear.
2. Decompose the user's message with the rules below, reusing existing ids for groups and cards.
3. Call duck_turn with the user's message and your decomposition. It does placement, id collisions, hierarchy, and history; the browser updates live.
4. Reply to the user with the saved reply returned by duck_turn, which may normalize your proposed reply when guidance is off.

Guidance: when the user asks for it ("guide", "引導", "質疑"), pass guide=true and you may add up to 3 cards of your own (question, insight, todo, challenge) and reply conversationally (2–3 sentences, at most one question, push back when you doubt something). Otherwise pass guide=false, add only origin="user" cards, and make "reply" one sentence saying what you filed; duck cards are dropped in that mode anyway.

${ORGANISE_RULES}`;

const text = (value: unknown) => ({ content: [{ type: "text" as const, text: JSON.stringify(value, null, 2) }] });

export function createMcpServer(): McpServer {
  const server = new McpServer({ name: "quack-aloud", version: "0.1.0" }, { instructions: INSTRUCTIONS });

  server.registerTool(
    "list_projects",
    { title: "List projects", description: "Projects and their canvases, most recently used first, with card counts." },
    async () => text(listProjectsTool()),
  );

  server.registerTool(
    "read_canvas",
    {
      title: "Read a canvas",
      description: "Groups, cards (without coordinates), relations, and recent chat of one canvas. Omit canvas for the project's most recent one.",
      inputSchema: {
        project: z.string().describe("Project id from list_projects"),
        canvas: z.string().optional().describe("Canvas id; default: the most recently updated canvas of the project"),
        messages: z.number().int().min(0).max(50).optional().describe("How many recent chat messages to include (default 10)"),
      },
    },
    async (input) => text(readCanvasTool(input)),
  );

  server.registerTool(
    "create_project",
    {
      title: "Create a project",
      description: "A new project with one empty canvas. Use when the user asks for a new project.",
      inputSchema: { name: z.string().min(1), canvasName: z.string().optional().describe("Name of the first canvas (default 'Main')") },
    },
    async (input) => text(createProjectTool(input)),
  );

  server.registerTool(
    "create_canvas",
    {
      title: "Create a canvas",
      description: "A new empty canvas inside an existing project (e.g. 'Concept', 'Characters').",
      inputSchema: { project: z.string(), name: z.string().min(1) },
    },
    async (input) => text(createCanvasTool(input)),
  );

  server.registerTool(
    "duck_turn",
    {
      title: "File one message as cards",
      description:
        "Apply one turn of the duck: the user's message plus your decomposition (groups, updates, nodes, edges, remove_edges, layout, root, reply). Placement, id collisions, hierarchy, and chat history are handled here; the browser updates live. Returns what was added.",
      inputSchema: {
        project: z.string(),
        canvas: z.string().optional().describe("Default: the project's most recently updated canvas"),
        message: z.string().min(1).describe("The user's message, verbatim; it goes into the chat history"),
        guide: z.boolean().optional().describe("true when the user asked for guidance; otherwise cards of kind question/insight/todo/challenge are dropped"),
        ...ThinkOutputSchema.shape,
      },
    },
    async (input) => text(duckTurnTool(input)),
  );

  return server;
}

async function main() {
  const server = createMcpServer();
  await server.connect(new StdioServerTransport());
}

// Only start the transport when run directly (tests import createMcpServer)
if (process.argv[1] && /mcp\.(ts|js)$/.test(process.argv[1])) {
  main().catch((err) => {
    console.error("[mcp]", err);
    process.exit(1);
  });
}
