import "dotenv/config";
import { createApp } from "./app";
import { mcpToken } from "./mcpHttp";
import { PROJECTS_DIR, listProjects } from "./projects";
import { getProvider } from "./providers";

const PORT = Number(process.env.API_PORT ?? 8787);

createApp().listen(PORT, () => {
  const p = getProvider();
  console.log(`[server] http://localhost:${PORT}  provider=${p.name} model=${p.model} effort=${p.effort ?? "-"}`);
  console.log(`[server] projects: ${PROJECTS_DIR} (${listProjects().length})`);
  console.log(`[server] MCP endpoint: http://localhost:${PORT}/mcp (bearer token in Settings › MCP; ${process.env.MCP_TOKEN ? "from MCP_TOKEN" : "generated"})`);
  void mcpToken();
  if (!p.configured()) {
    console.warn(`[server] no API key for provider "${p.name}"; chat is disabled until one is set in Settings (canvas and agent routes still work)`);
  }
});
