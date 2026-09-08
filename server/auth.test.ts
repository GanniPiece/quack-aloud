import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, beforeAll, describe, expect, it } from "vitest";

const tmp = fs.mkdtempSync(path.join(os.tmpdir(), "quack-aloud-auth-"));
process.env.DATA_DIR = tmp;
const auth = await import("./auth");

describe("auth", () => {
  beforeAll(() => {
    delete process.env.APP_PASSWORD;
    delete process.env.AUTH_DISABLED;
  });
  afterEach(() => {
    fs.rmSync(auth.AUTH_PATH, { force: true });
    delete process.env.APP_PASSWORD;
    delete process.env.AUTH_DISABLED;
  });

  it("starts unconfigured and refuses sessions", () => {
    expect(auth.hasPassword()).toBe(false);
    expect(auth.passwordSource()).toBe("none");
    expect(auth.verifyPassword("anything")).toBe(false);
    expect(() => auth.issueSession()).toThrow();
    expect(auth.verifySession("x.y.z")).toBe(false);
  });

  it("validates passwords", () => {
    expect(auth.validatePassword("short")).toMatch(/at least 8/);
    expect(auth.validatePassword(42)).toMatch(/text/);
    expect(auth.validatePassword("long enough")).toBeNull();
  });

  it("sets, verifies, and stores the password owner-only", () => {
    auth.setPassword("correct horse battery");
    expect(auth.passwordSource()).toBe("file");
    expect(auth.verifyPassword("correct horse battery")).toBe(true);
    expect(auth.verifyPassword("correct horse batterx")).toBe(false);
    expect(fs.statSync(auth.AUTH_PATH).mode & 0o777).toBe(0o600);
    const raw = fs.readFileSync(auth.AUTH_PATH, "utf8");
    expect(raw).not.toContain("correct horse");
  });

  it("issues sessions that expire and die when the password changes", () => {
    auth.setPassword("correct horse battery");
    const now = Date.now();
    const token = auth.issueSession(now);
    expect(auth.verifySession(token, now)).toBe(true);
    expect(auth.verifySession(token, now + 31 * 86_400_000)).toBe(false);
    expect(auth.verifySession(token.slice(0, -2) + "zz", now)).toBe(false);
    auth.setPassword("a brand new password");
    expect(auth.verifySession(token, now)).toBe(false);
  });

  it("accepts APP_PASSWORD from the environment until a file password exists", () => {
    process.env.APP_PASSWORD = "from-the-environment";
    expect(auth.hasPassword()).toBe(true);
    expect(auth.passwordSource()).toBe("env");
    expect(auth.verifyPassword("from-the-environment")).toBe(true);
    auth.setPassword("file wins over env");
    expect(auth.passwordSource()).toBe("file");
    expect(auth.verifyPassword("from-the-environment")).toBe(false);
    expect(auth.verifyPassword("file wins over env")).toBe(true);
  });

  it("locks an address after repeated failures, and clears on success", () => {
    const now = 1_000_000;
    for (let i = 0; i < 5; i++) auth.recordLogin("1.2.3.4", false, now);
    expect(auth.loginLocked("1.2.3.4", now)).toBeGreaterThan(0);
    expect(auth.loginLocked("1.2.3.4", now + 31_000)).toBe(0);
    auth.recordLogin("5.6.7.8", false, now);
    auth.recordLogin("5.6.7.8", true, now);
    for (let i = 0; i < 4; i++) auth.recordLogin("5.6.7.8", false, now);
    expect(auth.loginLocked("5.6.7.8", now)).toBe(0); // the success reset the count
  });

  it("parses cookies and honours AUTH_DISABLED", () => {
    expect(auth.parseCookies("a=1; qa_session=x%2Ey; b=2")).toEqual({ a: "1", qa_session: "x.y", b: "2" });
    process.env.AUTH_DISABLED = "1";
    expect(auth.authDisabled()).toBe(true);
  });
});
