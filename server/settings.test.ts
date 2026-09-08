import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, beforeAll, describe, expect, it } from "vitest";

const tmp = fs.mkdtempSync(path.join(os.tmpdir(), "quack-aloud-settings-"));
process.env.DATA_DIR = tmp;
const { maskKey, readSettings, resolveConfig, updateSettings, SETTINGS_PATH } = await import("./settings");

describe("settings", () => {
  beforeAll(() => {
    delete process.env.PROVIDER;
    delete process.env.ANTHROPIC_API_KEY;
    delete process.env.CLAUDE_MODEL;
    delete process.env.CLAUDE_EFFORT;
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
});
