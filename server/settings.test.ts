import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";

const tmp = fs.mkdtempSync(path.join(os.tmpdir(), "quack-aloud-settings-"));
process.env.DATA_DIR = tmp;
const { maskKey, readSettings, resolveConfig, updateSettings, SETTINGS_PATH } = await import("./settings");

describe("settings", () => {
  beforeEach(() => {
    for (const key of ["PROVIDER", "ANTHROPIC_API_KEY", "CLAUDE_MODEL", "CLAUDE_EFFORT", "OPENAI_API_KEY", "OPENAI_MODEL", "OPENAI_EFFORT"]) delete process.env[key];
  });
  afterEach(() => {
    fs.rmSync(SETTINGS_PATH, { force: true });
    delete process.env.ANTHROPIC_API_KEY;
    delete process.env.CLAUDE_EFFORT;
  });

  it("falls back to defaults when nothing is set", () => {
    expect(readSettings()).toEqual({});
    expect(resolveConfig()).toEqual({ provider: "claude", apiKey: undefined, keySource: "none", model: undefined, effort: undefined });
  });

  it("reads the environment when there is no stored key", () => {
    process.env.ANTHROPIC_API_KEY = "sk-ant-env-1234";
    process.env.CLAUDE_EFFORT = "high";
    const cfg = resolveConfig();
    expect(cfg.apiKey).toBe("sk-ant-env-1234");
    expect(cfg.keySource).toBe("env");
    expect(cfg.effort).toBe("high");
  });

  it("stored settings win over the environment, and the file is owner-only", () => {
    process.env.ANTHROPIC_API_KEY = "sk-ant-env-1234";
    updateSettings({ apiKey: "  sk-ant-stored-9999 ", model: "claude-sonnet-5", effort: "low" });
    const cfg = resolveConfig();
    expect(cfg).toMatchObject({ apiKey: "sk-ant-stored-9999", keySource: "settings", model: "claude-sonnet-5", effort: "low" });
    const mode = fs.statSync(SETTINGS_PATH).mode & 0o777;
    expect(mode).toBe(0o600);
  });

  it("an empty key removes the stored one and reveals the environment again", () => {
    process.env.ANTHROPIC_API_KEY = "sk-ant-env-1234";
    updateSettings({ apiKey: "sk-ant-stored-9999" });
    updateSettings({ apiKey: "" });
    expect(readSettings().apiKeys).toBeUndefined();
    expect(resolveConfig().keySource).toBe("env");
  });

  it("keeps keys per provider and ignores unknown efforts", () => {
    updateSettings({ provider: "claude", apiKey: "sk-ant-a" });
    updateSettings({ provider: "openai", apiKey: "sk-o" });
    expect(readSettings()).toMatchObject({ provider: "openai", apiKeys: { claude: "sk-ant-a", openai: "sk-o" } });
    updateSettings({ provider: "claude", effort: "bogus" as never });
    expect(resolveConfig()).toMatchObject({ provider: "claude", apiKey: "sk-ant-a", effort: undefined });
  });

  it("masks keys without revealing them", () => {
    expect(maskKey(undefined)).toBeNull();
    expect(maskKey("short")).toBe("••••");
    expect(maskKey("sk-ant-api03-abcdefghij3f9a")).toBe("sk-ant…3f9a");
  });

  it("migrates legacy preferences to their provider and keeps them when switching", () => {
    fs.writeFileSync(SETTINGS_PATH, JSON.stringify({ provider: "claude", model: "claude-custom", effort: "max", apiKeys: { claude: "old-key" } }));
    expect(resolveConfig()).toMatchObject({ provider: "claude", model: "claude-custom", effort: "max", apiKey: "old-key" });
    updateSettings({ provider: "openai", apiKey: "openai-key", model: "gpt-5.4-mini", effort: "none" });
    expect(resolveConfig()).toMatchObject({ provider: "openai", model: "gpt-5.4-mini", effort: "none", apiKey: "openai-key" });
    updateSettings({ provider: "claude" });
    expect(resolveConfig()).toMatchObject({ model: "claude-custom", effort: "max", apiKey: "old-key" });
    expect(resolveConfig("openai")).toMatchObject({ model: "gpt-5.4-mini", effort: "none", apiKey: "openai-key" });
    const stored = JSON.parse(fs.readFileSync(SETTINGS_PATH, "utf8"));
    expect(stored).not.toHaveProperty("model");
    expect(stored).not.toHaveProperty("effort");
  });

  it("keeps old settings without an explicit provider under the previous effective provider", () => {
    fs.writeFileSync(SETTINGS_PATH, JSON.stringify({ model: "claude-old", effort: "high" }));
    updateSettings({ provider: "openai" });
    expect(resolveConfig().model).toBeUndefined();
    expect(resolveConfig("claude")).toMatchObject({ model: "claude-old", effort: "high" });
  });

  it("uses OpenAI environment defaults without mixing provider credentials or efforts", () => {
    process.env.OPENAI_API_KEY = "openai-env";
    process.env.OPENAI_MODEL = "gpt-5.4";
    process.env.OPENAI_EFFORT = "low";
    process.env.ANTHROPIC_API_KEY = "claude-env";
    process.env.CLAUDE_EFFORT = "max";
    expect(resolveConfig("openai")).toMatchObject({ apiKey: "openai-env", model: "gpt-5.4", effort: "low" });
    updateSettings({ provider: "openai", model: "gpt-5.4-mini", effort: "high" });
    expect(resolveConfig()).toMatchObject({ model: "gpt-5.4-mini", effort: "high" });
    updateSettings({ model: "" });
    expect(resolveConfig().model).toBe("gpt-5.4");
    process.env.OPENAI_EFFORT = "max";
    updateSettings({ effort: "max" });
    expect(resolveConfig().effort).toBeUndefined();
  });
});
