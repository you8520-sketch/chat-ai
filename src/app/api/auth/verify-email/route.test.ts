import assert from "node:assert/strict";
import Module from "node:module";
import { after, before, beforeEach, describe, it } from "node:test";

const cookieJar = new Map<string, string>();

const nodeModule = Module as unknown as {
  _load: (request: string, parent: unknown, isMain: boolean) => unknown;
};
const originalLoad = nodeModule._load;
nodeModule._load = function (this: unknown, request: string, parent: unknown, isMain: boolean) {
  if (request === "next/headers") {
    return {
      cookies: async () => ({
        get(name: string) {
          const value = cookieJar.get(name);
          return value === undefined ? undefined : { value };
        },
      }),
    };
  }
  return originalLoad.call(this, request, parent, isMain);
};

import { getDb } from "@/lib/db";
import { installIsolatedTestDatabase, uninstallIsolatedTestDatabase } from "@/lib/test/isolatedTestDatabase";
import { requestEmailSignup } from "@/lib/emailSignupVerification";
import { EMAIL_VERIFY_COOKIE_NAME, SESSION_COOKIE_NAME } from "@/lib/sessionCookie";

const ENV_KEYS = ["RESEND_API_KEY", "EMAIL_FROM", "APP_URL", "NEXTAUTH_URL", "GOOGLE_OAUTH_ORIGIN"] as const;
const previousEnv: Record<string, string | undefined> = {};

function tokenFromMail(payload: { text: string }): string {
  const match = payload.text.match(/token=([a-f0-9]+)/i);
  assert.ok(match?.[1]);
  return match[1];
}

describe("verify-email GET/POST split", () => {
  before(async () => {
    for (const key of ENV_KEYS) previousEnv[key] = process.env[key];
    installIsolatedTestDatabase();
  });

  after(() => {
    uninstallIsolatedTestDatabase();
    nodeModule._load = originalLoad;
    for (const key of ENV_KEYS) {
      if (previousEnv[key] === undefined) delete process.env[key];
      else process.env[key] = previousEnv[key];
    }
  });

  beforeEach(() => {
    cookieJar.clear();
    process.env.RESEND_API_KEY = "re_test_key";
    process.env.EMAIL_FROM = "하브 <noreply@hav.chat>";
    process.env.APP_URL = "https://hav.chat";
    getDb().exec(`
      DELETE FROM point_logs;
      DELETE FROM point_transactions;
      DELETE FROM sessions;
      DELETE FROM pending_email_signups;
      DELETE FROM users;
    `);
  });

  it("GET only prepares a confirm cookie and POST creates the account once", async () => {
    const { GET, POST } = await import("./route");
    let raw = "";
    await requestEmailSignup(
      { email: "scan@example.com", nickname: "스캔", password: "secret1", pref: "all" },
      new Request("https://hav.chat/api/auth/signup"),
      {
        sendMail: async (payload) => {
          raw = tokenFromMail(payload);
          return { ok: true };
        },
      }
    );

    const peek = await GET(new Request(`https://hav.chat/api/auth/verify-email?token=${raw}`));
    assert.equal(peek.status, 303);
    assert.equal(peek.headers.get("location"), "https://hav.chat/signup/verify");
    assert.doesNotMatch(peek.headers.get("location") ?? "", /token=/);
    const setCookie = peek.headers.get("set-cookie") ?? "";
    assert.match(setCookie, new RegExp(`${EMAIL_VERIFY_COOKIE_NAME}=`));
    assert.equal((getDb().prepare("SELECT COUNT(*) AS c FROM users").get() as { c: number }).c, 0);

    const scannerAgain = await GET(new Request(`https://hav.chat/api/auth/verify-email?token=${raw}`));
    assert.equal(scannerAgain.status, 303);
    assert.equal((getDb().prepare("SELECT COUNT(*) AS c FROM users").get() as { c: number }).c, 0);

    cookieJar.set(EMAIL_VERIFY_COOKIE_NAME, raw);
    const created = await POST(new Request("https://hav.chat/api/auth/verify-email", { method: "POST" }));
    assert.equal(created.status, 303);
    assert.equal(created.headers.get("location"), "https://hav.chat/?verified=1");
    assert.match(created.headers.get("set-cookie") ?? "", new RegExp(`${SESSION_COOKIE_NAME}=`));
    assert.equal((getDb().prepare("SELECT COUNT(*) AS c FROM users").get() as { c: number }).c, 1);

    const reused = await POST(new Request("https://hav.chat/api/auth/verify-email", { method: "POST" }));
    assert.equal(reused.status, 303);
    assert.equal(reused.headers.get("location"), "https://hav.chat/login?verify=failed");
    assert.equal((getDb().prepare("SELECT COUNT(*) AS c FROM users").get() as { c: number }).c, 1);
  });
});
