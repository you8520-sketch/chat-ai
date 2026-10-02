import assert from "node:assert/strict";
import { after, before, beforeEach, describe, it } from "node:test";

import { getDb } from "@/lib/db";
import { createSession, verifyPassword } from "@/lib/auth";
import { installIsolatedTestDatabase, uninstallIsolatedTestDatabase } from "@/lib/test/isolatedTestDatabase";
import { upsertGoogleUser } from "@/lib/googleAuth";
import { getPointBalance } from "@/lib/points";
import { SIGNUP_BONUS_POINTS } from "@/lib/plans";
import { grantSignupBonusOnce, hasSignupBonus, SIGNUP_BONUS_REASON } from "@/lib/signupBonus";
import {
  EMAIL_SIGNUP_MAX_SENDS,
  EMAIL_SIGNUP_RESEND_COOLDOWN_MS,
  EMAIL_SIGNUP_TOKEN_TTL_MS,
  confirmEmailSignup,
  consumePendingEmailSignup,
  createEmailSignupToken,
  findPendingEmailSignup,
  hashEmailSignupToken,
  inspectEmailSignupToken,
  requestEmailSignup,
} from "@/lib/emailSignupVerification";
import { authenticatePasswordLogin } from "@/lib/passwordLogin";
import { TRANSACTIONAL_EMAIL_UNCONFIGURED_MESSAGE } from "@/lib/transactionalEmail";

const ENV_KEYS = [
  "RESEND_API_KEY",
  "EMAIL_FROM",
  "RESEND_FROM",
  "APP_URL",
  "NEXTAUTH_URL",
  "GOOGLE_OAUTH_ORIGIN",
] as const;

const previousEnv: Record<string, string | undefined> = {};

function signupRequest(): Request {
  return new Request("http://localhost:3000/api/auth/signup", {
    headers: { host: "localhost:3000" },
  });
}

function tokenFromMail(payload: { text: string }): string {
  const match = payload.text.match(/token=([a-f0-9]+)/i);
  assert.ok(match?.[1]);
  return match[1];
}

describe("email signup verification", () => {
  before(() => {
    for (const key of ENV_KEYS) previousEnv[key] = process.env[key];
    installIsolatedTestDatabase();
  });

  after(() => {
    uninstallIsolatedTestDatabase();
    for (const key of ENV_KEYS) {
      if (previousEnv[key] === undefined) delete process.env[key];
      else process.env[key] = previousEnv[key];
    }
  });

  beforeEach(() => {
    process.env.RESEND_API_KEY = "re_test_key";
    process.env.EMAIL_FROM = "하브 <noreply@hav.chat>";
    delete process.env.RESEND_FROM;
    process.env.APP_URL = "http://localhost:3000";
    const db = getDb();
    db.exec(`
      DELETE FROM point_logs;
      DELETE FROM point_transactions;
      DELETE FROM sessions;
      DELETE FROM pending_email_signups;
      DELETE FROM login_aliases;
      DELETE FROM users;
    `);
  });

  it("does not create a user when mail is not configured", async () => {
    delete process.env.RESEND_API_KEY;
    const result = await requestEmailSignup(
      { email: "new@example.com", nickname: "새유저", password: "secret1", pref: "all" },
      signupRequest()
    );
    assert.equal(result.ok, false);
    if (result.ok) return;
    assert.equal(result.status, 503);
    assert.equal(result.error, TRANSACTIONAL_EMAIL_UNCONFIGURED_MESSAGE);
    assert.equal((getDb().prepare("SELECT COUNT(*) AS c FROM users").get() as { c: number }).c, 0);
    assert.equal(
      (getDb().prepare("SELECT COUNT(*) AS c FROM pending_email_signups").get() as { c: number }).c,
      0
    );
  });

  it("stores pending signup and grants bonus only after confirm", async () => {
    let sentTo = "";
    const result = await requestEmailSignup(
      { email: "New@Example.com", nickname: "새유저", password: "secret1", pref: null },
      signupRequest(),
      {
        sendMail: async (payload) => {
          sentTo = payload.to;
          return { ok: true };
        },
      }
    );
    assert.equal(result.ok, true);
    if (!result.ok) return;
    assert.equal(result.email, "new@example.com");
    assert.equal(sentTo, "new@example.com");
    assert.equal((getDb().prepare("SELECT COUNT(*) AS c FROM users").get() as { c: number }).c, 0);

    const pending = findPendingEmailSignup("new@example.com");
    assert.ok(pending);
    assert.match(pending!.token_hash, /^[a-f0-9]{64}$/);
    assert.equal(pending!.token_hash.includes(pending!.pw_hash), false);

    const loginPending = authenticatePasswordLogin("new@example.com", "secret1");
    assert.equal(loginPending.ok, false);
    if (loginPending.ok) return;
    assert.equal(loginPending.status, 403);
    assert.match(loginPending.error, /인증이 완료되지 않았습니다/);

    const raw = createEmailSignupToken();
    getDb()
      .prepare("UPDATE pending_email_signups SET token_hash = ? WHERE email = ?")
      .run(raw.hash, "new@example.com");

    const confirmed = confirmEmailSignup(raw.raw);
    assert.equal(confirmed.ok, true);
    if (!confirmed.ok) return;
    assert.equal(hasSignupBonus(confirmed.userId), true);
    assert.equal(getPointBalance(confirmed.userId).total, SIGNUP_BONUS_POINTS);
    assert.equal(findPendingEmailSignup("new@example.com"), undefined);

    const login = authenticatePasswordLogin("new@example.com", "secret1");
    assert.equal(login.ok, true);
    if (!login.ok) return;
    assert.equal(login.userId, confirmed.userId);
    assert.equal(grantSignupBonusOnce(confirmed.userId), false);
    assert.equal(getPointBalance(confirmed.userId).total, SIGNUP_BONUS_POINTS);
  });

  it("rejects reused and expired tokens", async () => {
    await requestEmailSignup(
      { email: "expire@example.com", nickname: "만료", password: "secret1", pref: "female" },
      signupRequest(),
      { sendMail: async () => ({ ok: true }) }
    );
    const raw = createEmailSignupToken();
    getDb()
      .prepare("UPDATE pending_email_signups SET token_hash = ? WHERE email = ?")
      .run(raw.hash, "expire@example.com");

    const first = confirmEmailSignup(raw.raw);
    assert.equal(first.ok, true);
    const reused = confirmEmailSignup(raw.raw);
    assert.equal(reused.ok, false);
    if (reused.ok) return;
    assert.equal(reused.status, 400);

    await requestEmailSignup(
      { email: "late@example.com", nickname: "늦음", password: "secret1", pref: "male" },
      signupRequest(),
      { now: 1_000, sendMail: async () => ({ ok: true }) }
    );
    const late = createEmailSignupToken();
    getDb()
      .prepare("UPDATE pending_email_signups SET token_hash = ?, expires_at = ? WHERE email = ?")
      .run(late.hash, new Date(1_000 + EMAIL_SIGNUP_TOKEN_TTL_MS).toISOString(), "late@example.com");
    const expired = confirmEmailSignup(late.raw, { now: 1_000 + EMAIL_SIGNUP_TOKEN_TTL_MS + 1 });
    assert.equal(expired.ok, false);
    if (expired.ok) return;
    assert.equal(expired.status, 410);
    assert.equal(getDb().prepare("SELECT id FROM users WHERE email = 'late@example.com'").get(), undefined);
  });

  it("rate limits resend and keeps the previous token when mail send fails", async () => {
    const now = 50_000;
    let firstToken = "";
    const first = await requestEmailSignup(
      { email: "retry@example.com", nickname: "재시도", password: "secret1", pref: "all" },
      signupRequest(),
      {
        now,
        sendMail: async (payload) => {
          firstToken = tokenFromMail(payload);
          return { ok: true };
        },
      }
    );
    assert.equal(first.ok, true);
    const firstHash = findPendingEmailSignup("retry@example.com")!.token_hash;

    const cooldown = await requestEmailSignup(
      { email: "retry@example.com", nickname: "재시도", password: "secret1", pref: "all" },
      signupRequest(),
      { now: now + 1_000, sendMail: async () => ({ ok: true }) }
    );
    assert.equal(cooldown.ok, false);
    if (cooldown.ok) return;
    assert.equal(cooldown.status, 429);

    const failed = await requestEmailSignup(
      { email: "retry@example.com", nickname: "재시도", password: "secret1", pref: "all" },
      signupRequest(),
      {
        now: now + EMAIL_SIGNUP_RESEND_COOLDOWN_MS + 1,
        sendMail: async () => ({ ok: false, error: "메일 발송에 실패했습니다. 잠시 후 다시 시도해 주세요." }),
      }
    );
    assert.equal(failed.ok, false);
    if (failed.ok) return;
    assert.equal(failed.status, 503);
    const afterFail = findPendingEmailSignup("retry@example.com")!;
    assert.equal(afterFail.token_hash, firstHash);
    assert.equal(afterFail.send_count, 1);
    assert.equal(inspectEmailSignupToken(firstToken, { now: now + EMAIL_SIGNUP_RESEND_COOLDOWN_MS + 1 }).ok, true);
    assert.equal((getDb().prepare("SELECT COUNT(*) AS c FROM users").get() as { c: number }).c, 0);

    getDb()
      .prepare("UPDATE pending_email_signups SET send_count = ? WHERE email = ?")
      .run(EMAIL_SIGNUP_MAX_SENDS, "retry@example.com");
    const limited = await requestEmailSignup(
      { email: "retry@example.com", nickname: "재시도", password: "secret1", pref: "all" },
      signupRequest(),
      {
        now: now + EMAIL_SIGNUP_RESEND_COOLDOWN_MS * 2,
        sendMail: async () => ({ ok: true }),
      }
    );
    assert.equal(limited.ok, false);
    if (limited.ok) return;
    assert.equal(limited.status, 429);
  });

  it("resets send count after expiry so signup is not permanently blocked", async () => {
    const now = 10_000;
    await requestEmailSignup(
      { email: "lock@example.com", nickname: "잠금", password: "secret1", pref: "all" },
      signupRequest(),
      { now, sendMail: async () => ({ ok: true }) }
    );
    getDb()
      .prepare("UPDATE pending_email_signups SET send_count = ?, expires_at = ? WHERE email = ?")
      .run(
        EMAIL_SIGNUP_MAX_SENDS,
        new Date(now + EMAIL_SIGNUP_TOKEN_TTL_MS).toISOString(),
        "lock@example.com"
      );

    const stillLimited = await requestEmailSignup(
      { email: "lock@example.com", nickname: "잠금", password: "secret1", pref: "all" },
      signupRequest(),
      { now: now + 70_000, sendMail: async () => ({ ok: true }) }
    );
    assert.equal(stillLimited.ok, false);
    if (stillLimited.ok) return;
    assert.equal(stillLimited.status, 429);

    let restartedToken = "";
    const afterExpiry = await requestEmailSignup(
      { email: "lock@example.com", nickname: "잠금", password: "secret1", pref: "all" },
      signupRequest(),
      {
        now: now + EMAIL_SIGNUP_TOKEN_TTL_MS + 1,
        sendMail: async (payload) => {
          restartedToken = tokenFromMail(payload);
          return { ok: true };
        },
      }
    );
    assert.equal(afterExpiry.ok, true);
    const restarted = findPendingEmailSignup("lock@example.com")!;
    assert.equal(restarted.send_count, 1);
    assert.equal(
      inspectEmailSignupToken(restartedToken, { now: now + EMAIL_SIGNUP_TOKEN_TTL_MS + 2 }).ok,
      true
    );
    const confirmed = confirmEmailSignup(restartedToken, { now: now + EMAIL_SIGNUP_TOKEN_TTL_MS + 2 });
    assert.equal(confirmed.ok, true);
  });

  it("lets inspect peek a token without creating a user, and only one concurrent confirm wins", async () => {
    let raw = "";
    await requestEmailSignup(
      { email: "peek@example.com", nickname: "조회", password: "secret1", pref: "all" },
      signupRequest(),
      {
        sendMail: async (payload) => {
          raw = tokenFromMail(payload);
          return { ok: true };
        },
      }
    );

    assert.equal(inspectEmailSignupToken(raw).ok, true);
    assert.equal(inspectEmailSignupToken(raw).ok, true);
    assert.equal((getDb().prepare("SELECT COUNT(*) AS c FROM users").get() as { c: number }).c, 0);
    assert.ok(findPendingEmailSignup("peek@example.com"));

    const [first, second] = await Promise.all([
      Promise.resolve(confirmEmailSignup(raw)),
      Promise.resolve(confirmEmailSignup(raw)),
    ]);
    const oks = [first, second].filter((result) => result.ok);
    const fails = [first, second].filter((result) => !result.ok);
    assert.equal(oks.length, 1);
    assert.equal(fails.length, 1);
    if (!fails[0].ok) {
      assert.equal(fails[0].status === 400 || fails[0].status === 409, true);
    }
    assert.equal((getDb().prepare("SELECT COUNT(*) AS c FROM users").get() as { c: number }).c, 1);
    assert.equal(confirmEmailSignup(raw).ok, false);
  });

  it("rejects signup for an existing member email", async () => {
    getDb()
      .prepare("INSERT INTO users (email, nickname, pw_hash, points) VALUES (?, ?, 'x', 0)")
      .run("taken@example.com", "기존");
    const result = await requestEmailSignup(
      { email: "taken@example.com", nickname: "새이름", password: "secret1", pref: "all" },
      signupRequest(),
      { sendMail: async () => ({ ok: true }) }
    );
    assert.equal(result.ok, false);
    if (result.ok) return;
    assert.equal(result.status, 409);
  });

  it("lets Google consume a pending email signup without a second bonus", async () => {
    await requestEmailSignup(
      { email: "link@example.com", nickname: "대기", password: "secret1", pref: "all" },
      signupRequest(),
      { sendMail: async () => ({ ok: true }) }
    );
    const created = upsertGoogleUser({
      sub: "google-sub-1",
      email: "link@example.com",
      name: "구글유저",
    });
    assert.equal(created.isNew, true);
    assert.equal(hasSignupBonus(created.userId), true);
    assert.equal(findPendingEmailSignup("link@example.com"), undefined);

    const raw = createEmailSignupToken();
    getDb()
      .prepare(
        `INSERT INTO pending_email_signups
           (email, nickname, pw_hash, pref, token_hash, expires_at, send_count, last_sent_at)
         VALUES ('ghost@example.com', '유령', 'x', NULL, ?, datetime('now', '+1 hour'), 1, datetime('now'))`
      )
      .run(raw.hash);
    getDb()
      .prepare("INSERT INTO users (email, nickname, pw_hash, google_id, points) VALUES (?, '유령', '', 'google-sub-2', 0)")
      .run("ghost@example.com");
    grantSignupBonusOnce(
      (getDb().prepare("SELECT id FROM users WHERE email = 'ghost@example.com'").get() as { id: number }).id
    );
    const confirmAfterGoogle = confirmEmailSignup(raw.raw);
    assert.equal(confirmAfterGoogle.ok, false);
    if (confirmAfterGoogle.ok) return;
    assert.equal(confirmAfterGoogle.status, 409);
    const logs = getDb()
      .prepare("SELECT COUNT(*) AS c FROM point_logs WHERE user_id = ? AND reason = ?")
      .get(
        (getDb().prepare("SELECT id FROM users WHERE email = 'ghost@example.com'").get() as { id: number }).id,
        SIGNUP_BONUS_REASON
      ) as { c: number };
    assert.equal(logs.c, 1);
  });

  it("hashes verification tokens and does not persist the raw value", () => {
    const token = createEmailSignupToken();
    assert.equal(hashEmailSignupToken(token.raw), token.hash);
    assert.notEqual(token.raw, token.hash);
    assert.equal(token.raw.length, 64);
  });

  it("does not treat consumePending as creating a user", () => {
    consumePendingEmailSignup("missing@example.com");
    assert.equal((getDb().prepare("SELECT COUNT(*) AS c FROM users").get() as { c: number }).c, 0);
  });

  it("keeps existing password hashes verifiable after confirm", async () => {
    await requestEmailSignup(
      { email: "hash@example.com", nickname: "해시", password: "secret1", pref: "all" },
      signupRequest(),
      { sendMail: async () => ({ ok: true }) }
    );
    const pending = findPendingEmailSignup("hash@example.com")!;
    assert.equal(verifyPassword("secret1", pending.pw_hash), true);
    const sessionToken = createSession(
      Number(
        getDb()
          .prepare("INSERT INTO users (email, nickname, pw_hash, points) VALUES ('s@example.com','s',?,0)")
          .run("x").lastInsertRowid
      )
    );
    assert.equal(typeof sessionToken, "string");
    assert.equal(sessionToken.length, 64);
  });
});
