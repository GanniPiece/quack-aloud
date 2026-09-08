import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, beforeAll, describe, expect, it } from "vitest";

const tmp = fs.mkdtempSync(path.join(os.tmpdir(), "quack-aloud-auth-"));
process.env.DATA_DIR = tmp;
const auth = await import("./auth");

function reset() {
  fs.rmSync(auth.USERS_PATH, { force: true });
  fs.rmSync(auth.AUTH_PATH, { force: true });
  delete process.env.APP_EMAIL;
  delete process.env.APP_PASSWORD;
  delete process.env.AUTH_DISABLED;
}

describe("accounts", () => {
  beforeAll(reset);
  afterEach(reset);

  it("starts with no users; setup is allowed only then", () => {
    expect(auth.hasUsers()).toBe(false);
    expect(auth.listUsers()).toEqual([]);
    expect(auth.verifyLogin("a@b.c", "anything")).toBeNull();
  });

  it("validates email and password", () => {
    expect(auth.validateEmail("not-an-email")).toMatch(/email/i);
    expect(auth.validateEmail(" Po@Example.com ")).toBeNull();
    expect(auth.validatePassword("short")).toMatch(/at least 8/);
    expect(auth.validatePassword("long enough")).toBeNull();
  });

  it("creates the first user as owner, later ones as members, emails case-insensitive and unique", () => {
    const owner = auth.createUser(" Po@Example.com ", "correct horse battery");
    expect(owner).toMatchObject({ email: "po@example.com", role: "owner" });
    const member = auth.createUser("friend@example.com", "another password");
    expect(member.role).toBe("member");
    expect(() => auth.createUser("PO@example.com", "x".repeat(8))).toThrow(/already/i);
    expect(auth.listUsers().map((u) => u.email)).toEqual(["po@example.com", "friend@example.com"]);
    // the stored file never contains a plain password and is owner-only
    const raw = fs.readFileSync(auth.USERS_PATH, "utf8");
    expect(raw).not.toContain("correct horse");
    expect(fs.statSync(auth.USERS_PATH).mode & 0o777).toBe(0o600);
  });

  it("verifies email + password together", () => {
    auth.createUser("po@example.com", "correct horse battery");
    expect(auth.verifyLogin("PO@EXAMPLE.COM", "correct horse battery")?.email).toBe("po@example.com");
    expect(auth.verifyLogin("po@example.com", "wrong password!")).toBeNull();
    expect(auth.verifyLogin("nobody@example.com", "correct horse battery")).toBeNull();
  });

  it("sessions carry the user and end only when that user's password changes", () => {
    const po = auth.createUser("po@example.com", "correct horse battery");
    const friend = auth.createUser("friend@example.com", "another password");
    const now = Date.now();
    const tPo = auth.issueSession(po.id, now);
    const tFriend = auth.issueSession(friend.id, now);
    expect(auth.verifySession(tPo, now)?.email).toBe("po@example.com");
    expect(auth.verifySession(tFriend, now)?.email).toBe("friend@example.com");
    expect(auth.verifySession(tPo, now + 31 * 86_400_000)).toBeNull(); // expired
    expect(auth.verifySession(tPo.slice(0, -2) + "zz", now)).toBeNull(); // tampered
    auth.changePassword(po.id, "a brand new password");
    expect(auth.verifySession(tPo, now)).toBeNull(); // po's sessions are gone
    expect(auth.verifySession(tFriend, now)?.email).toBe("friend@example.com"); // friend's survive
    expect(auth.verifyLogin("po@example.com", "a brand new password")?.id).toBe(po.id);
  });

  it("deleting a user ends their sessions and protects the last owner", () => {
    const po = auth.createUser("po@example.com", "correct horse battery");
    const friend = auth.createUser("friend@example.com", "another password");
    const t = auth.issueSession(friend.id);
    expect(auth.deleteUser(po.id)).toMatch(/last owner/i);
    expect(auth.deleteUser(friend.id)).toBeNull();
    expect(auth.verifySession(t)).toBeNull();
    expect(auth.listUsers()).toHaveLength(1);
    expect(auth.deleteUser("nope")).toMatch(/no such/i);
  });

  it("seeds the first owner from APP_EMAIL and APP_PASSWORD, once", () => {
    process.env.APP_EMAIL = "ops@example.com";
    process.env.APP_PASSWORD = "from-the-environment";
    expect(auth.seedFromEnv()).toBe(true);
    expect(auth.seedFromEnv()).toBe(false); // users exist now
    expect(auth.verifyLogin("ops@example.com", "from-the-environment")?.role).toBe("owner");
  });

  it("locks an address after repeated failures, and clears on success", () => {
    const now = 1_000_000;
    for (let i = 0; i < 5; i++) auth.recordLogin("1.2.3.4", false, now);
    expect(auth.loginLocked("1.2.3.4", now)).toBeGreaterThan(0);
    expect(auth.loginLocked("1.2.3.4", now + 31_000)).toBe(0);
    auth.recordLogin("5.6.7.8", false, now);
    auth.recordLogin("5.6.7.8", true, now);
    for (let i = 0; i < 4; i++) auth.recordLogin("5.6.7.8", false, now);
    expect(auth.loginLocked("5.6.7.8", now)).toBe(0);
  });

  it("parses cookies and honours AUTH_DISABLED", () => {
    expect(auth.parseCookies("a=1; qa_session=x%2Ey; b=2")).toEqual({ a: "1", qa_session: "x.y", b: "2" });
    process.env.AUTH_DISABLED = "1";
    expect(auth.authDisabled()).toBe(true);
  });
});
