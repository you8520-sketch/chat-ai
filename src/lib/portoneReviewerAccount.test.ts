import assert from "node:assert/strict";
import crypto from "node:crypto";
import { after, before, beforeEach, describe, it } from "node:test";

import { getDb } from "@/lib/db";
import { createSession, verifyPassword } from "@/lib/auth";
import { canAccessAdultContent, shouldHideAdultListings } from "@/lib/adultVerification";
import { isAdminUser } from "@/lib/isAdminUser";
import { installIsolatedTestDatabase, uninstallIsolatedTestDatabase } from "@/lib/test/isolatedTestDatabase";
import { authenticatePasswordLogin } from "@/lib/passwordLogin";
import { hasSignupBonus } from "@/lib/signupBonus";
import {
  PORTONE_REVIEWER_ACCOUNT_KIND,
  PORTONE_REVIEWER_GIFT_MESSAGE,
  PORTONE_REVIEWER_KG_TEST_CHANNEL_KEY,
  PORTONE_REVIEWER_KG_TEST_ENABLE_FLAG,
  PORTONE_REVIEWER_KG_TEST_STORE_ID,
  PORTONE_REVIEWER_LOGIN_ALIAS,
  PORTONE_REVIEWER_PAID_API_MESSAGE,
  PORTONE_REVIEWER_LOGIN_MAX_FAILURES,
  PORTONE_REVIEWER_PAYMENTS_NOT_READY_MESSAGE,
  PORTONE_REVIEWER_PAYMENTS_UNVERIFIED_REASON,
  canAccessPortoneCheckout,
  findPortoneReviewerAccount,
  getPaidProviderCallBlockReason,
  getPointGiftBlockReason,
  inspectPortoneReviewerPaymentsReadiness,
  isPortoneReviewerPaymentsReady,
  provisionPortoneReviewerAccount,
  revokeUserSessions,
  setPortoneReviewerLoginDisabled,
} from "@/lib/portoneReviewerAccount";

const ENV_KEYS = [
  "PORTONE_REVIEWER_PAYMENTS_ENABLED",
  PORTONE_REVIEWER_KG_TEST_ENABLE_FLAG,
  "PORTONE_REVIEWER_STORE_ID",
  "PORTONE_REVIEWER_CHANNEL_KEY",
  "PORTONE_CHARGE_ENABLED",
  "NEXT_PUBLIC_PORTONE_STORE_ID",
  "NEXT_PUBLIC_PORTONE_CHANNEL_KEY",
  "PORTONE_API_SECRET",
  "ADMIN_EMAILS",
] as const;

const previousEnv: Record<string, string | undefined> = {};

function reviewerPassword(): string {
  return `rev-${crypto.randomBytes(8).toString("hex")}`;
}

describe("portone reviewer account", () => {
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
    process.env.PORTONE_CHARGE_ENABLED = "0";
    delete process.env.PORTONE_REVIEWER_PAYMENTS_ENABLED;
    delete process.env[PORTONE_REVIEWER_KG_TEST_ENABLE_FLAG];
    delete process.env.PORTONE_REVIEWER_STORE_ID;
    delete process.env.PORTONE_REVIEWER_CHANNEL_KEY;
    delete process.env.NEXT_PUBLIC_PORTONE_STORE_ID;
    delete process.env.NEXT_PUBLIC_PORTONE_CHANNEL_KEY;
    delete process.env.PORTONE_API_SECRET;
    delete process.env.ADMIN_EMAILS;
    const db = getDb();
    db.exec(`
      DELETE FROM point_logs;
      DELETE FROM point_transactions;
      DELETE FROM sessions;
      DELETE FROM login_aliases;
      DELETE FROM pending_email_signups;
      DELETE FROM users;
    `);
  });

  it("provisions an isolated alias login without a signup bonus", () => {
    const password = reviewerPassword();
    const provisioned = provisionPortoneReviewerAccount({ password });
    assert.equal(provisioned.alias, PORTONE_REVIEWER_LOGIN_ALIAS);
    assert.equal(hasSignupBonus(provisioned.userId), false);

    const row = getDb()
      .prepare("SELECT email, is_admin, account_kind, login_disabled, pw_hash FROM users WHERE id = ?")
      .get(provisioned.userId) as {
      email: string;
      is_admin: number;
      account_kind: string;
      login_disabled: number;
      pw_hash: string;
    };
    assert.equal(row.account_kind, PORTONE_REVIEWER_ACCOUNT_KIND);
    assert.equal(row.is_admin, 0);
    assert.equal(row.login_disabled, 0);
    assert.equal(verifyPassword(password, row.pw_hash), true);
    assert.equal(password === PORTONE_REVIEWER_LOGIN_ALIAS, false);

    const aliasLogin = authenticatePasswordLogin(PORTONE_REVIEWER_LOGIN_ALIAS, password);
    assert.equal(aliasLogin.ok, true);
    if (!aliasLogin.ok) return;
    assert.equal(aliasLogin.userId, provisioned.userId);

    process.env.ADMIN_EMAILS = row.email;
    assert.equal(
      isAdminUser({ email: row.email, is_admin: 1, account_kind: row.account_kind }),
      false
    );
    assert.equal(
      canAccessAdultContent({
        email: row.email,
        is_adult: 1,
        is_admin: 1,
        account_kind: row.account_kind,
      }),
      false
    );
    assert.equal(
      shouldHideAdultListings({
        email: row.email,
        is_adult: 1,
        is_admin: 1,
        nsfw_on: 1,
        account_kind: row.account_kind,
      }),
      true
    );
    assert.equal(getPaidProviderCallBlockReason({ account_kind: row.account_kind }), PORTONE_REVIEWER_PAID_API_MESSAGE);
    assert.equal(getPointGiftBlockReason({ account_kind: row.account_kind }), PORTONE_REVIEWER_GIFT_MESSAGE);
  });

  it("does not report checkout ready without the test-channel flag and keys", () => {
    const password = reviewerPassword();
    const provisioned = provisionPortoneReviewerAccount({ password });
    const reviewer = { account_kind: PORTONE_REVIEWER_ACCOUNT_KIND };
    assert.equal(isPortoneReviewerPaymentsReady(), false);
    assert.equal(canAccessPortoneCheckout(reviewer), false);
    assert.equal(canAccessPortoneCheckout({ account_kind: "standard" }), false);

    process.env.PORTONE_REVIEWER_PAYMENTS_ENABLED = "1";
    process.env.NEXT_PUBLIC_PORTONE_STORE_ID = "iamporttest_3";
    process.env.NEXT_PUBLIC_PORTONE_CHANNEL_KEY = "channel-key-test";
    process.env.PORTONE_API_SECRET = "secret_test";
    const readiness = inspectPortoneReviewerPaymentsReadiness();
    assert.equal(readiness.ready, false);
    assert.equal(readiness.reason, PORTONE_REVIEWER_PAYMENTS_UNVERIFIED_REASON);
    assert.equal(isPortoneReviewerPaymentsReady(), false);
    assert.equal(canAccessPortoneCheckout(reviewer), false);
    assert.equal(canAccessPortoneCheckout({ account_kind: "standard" }), false);
    assert.equal(PORTONE_REVIEWER_PAYMENTS_NOT_READY_MESSAGE.length > 0, true);
    assert.ok(findPortoneReviewerAccount()?.id === provisioned.userId);
  });

  it("does not enable global payments when only the reviewer flag is on", () => {
    process.env.PORTONE_REVIEWER_PAYMENTS_ENABLED = "1";
    process.env.PORTONE_CHARGE_ENABLED = "0";
    process.env.NEXT_PUBLIC_PORTONE_STORE_ID = "iamporttest_3";
    process.env.NEXT_PUBLIC_PORTONE_CHANNEL_KEY = "channel-key-test";
    process.env.PORTONE_API_SECRET = "secret_test";
    assert.equal(canAccessPortoneCheckout({ account_kind: "standard" }), false);
    assert.equal(canAccessPortoneCheckout({ account_kind: PORTONE_REVIEWER_ACCOUNT_KIND }), false);
  });

  it("opens reviewer KG test checkout only with the explicit flag, secret, and confirmed identifiers", () => {
    const reviewer = { account_kind: PORTONE_REVIEWER_ACCOUNT_KIND };
    process.env[PORTONE_REVIEWER_KG_TEST_ENABLE_FLAG] = "1";
    process.env.PORTONE_API_SECRET = "secret_test";
    const ready = inspectPortoneReviewerPaymentsReadiness();
    assert.equal(ready.ready, true);
    if (!ready.ready) return;
    assert.equal(ready.storeId, PORTONE_REVIEWER_KG_TEST_STORE_ID);
    assert.equal(ready.channelKey, PORTONE_REVIEWER_KG_TEST_CHANNEL_KEY);
    assert.equal(canAccessPortoneCheckout(reviewer), true);
    assert.equal(canAccessPortoneCheckout({ account_kind: "standard" }), false);
  });

  it("rejects a reviewer flag that points at a different store or channel", () => {
    process.env[PORTONE_REVIEWER_KG_TEST_ENABLE_FLAG] = "1";
    process.env.PORTONE_API_SECRET = "secret_test";
    process.env.PORTONE_REVIEWER_STORE_ID = "store-not-the-confirmed-kg-test";
    process.env.PORTONE_REVIEWER_CHANNEL_KEY = PORTONE_REVIEWER_KG_TEST_CHANNEL_KEY;
    const readiness = inspectPortoneReviewerPaymentsReadiness();
    assert.equal(readiness.ready, false);
    if (readiness.ready) return;
    assert.equal(readiness.reason, "channel_mismatch");
    assert.equal(canAccessPortoneCheckout({ account_kind: PORTONE_REVIEWER_ACCOUNT_KIND }), false);
  });

  it("does not treat an env name or missing secret as a verified test channel", () => {
    process.env[PORTONE_REVIEWER_KG_TEST_ENABLE_FLAG] = "1";
    const missingSecret = inspectPortoneReviewerPaymentsReadiness();
    assert.equal(missingSecret.ready, false);
    if (missingSecret.ready) return;
    assert.equal(missingSecret.reason, "secret_missing");

    process.env.PORTONE_API_SECRET = "secret_test";
    process.env.PORTONE_REVIEWER_STORE_ID = PORTONE_REVIEWER_KG_TEST_STORE_ID;
    process.env.PORTONE_REVIEWER_CHANNEL_KEY = "channel-key-live-or-other";
    const mismatch = inspectPortoneReviewerPaymentsReadiness();
    assert.equal(mismatch.ready, false);
    if (mismatch.ready) return;
    assert.equal(mismatch.reason, "channel_mismatch");
  });

  it("locks the reviewer alias after repeated failed logins", () => {
    const password = reviewerPassword();
    provisionPortoneReviewerAccount({ password });
    for (let i = 0; i < PORTONE_REVIEWER_LOGIN_MAX_FAILURES - 1; i++) {
      const failed = authenticatePasswordLogin(PORTONE_REVIEWER_LOGIN_ALIAS, "wrong-password");
      assert.equal(failed.ok, false);
      if (failed.ok) return;
      assert.equal(failed.status, 401);
    }
    const locked = authenticatePasswordLogin(PORTONE_REVIEWER_LOGIN_ALIAS, "wrong-password");
    assert.equal(locked.ok, false);
    if (locked.ok) return;
    assert.equal(locked.status, 429);
    const stillLocked = authenticatePasswordLogin(PORTONE_REVIEWER_LOGIN_ALIAS, password);
    assert.equal(stillLocked.ok, false);
    if (stillLocked.ok) return;
    assert.equal(stillLocked.status, 429);
  });

  it("revokes sessions when the reviewer is disabled", () => {
    const password = reviewerPassword();
    const provisioned = provisionPortoneReviewerAccount({ password });
    const token = createSession(provisioned.userId);
    assert.ok(token);
    setPortoneReviewerLoginDisabled(provisioned.userId, true);
    const session = getDb()
      .prepare("SELECT token FROM sessions WHERE user_id = ?")
      .get(provisioned.userId);
    assert.equal(session, undefined);
    const login = authenticatePasswordLogin(PORTONE_REVIEWER_LOGIN_ALIAS, password);
    assert.equal(login.ok, false);
    if (login.ok) return;
    assert.equal(login.status, 403);
    assert.equal(revokeUserSessions(provisioned.userId), 0);
  });

  it("refuses to convert an ordinary member into the reviewer", () => {
    getDb()
      .prepare("INSERT INTO users (email, nickname, pw_hash, points, account_kind) VALUES (?, '일반', 'x', 0, 'standard')")
      .run("member@example.com");
    assert.throws(
      () => provisionPortoneReviewerAccount({ password: reviewerPassword(), email: "member@example.com" }),
      /Refusing to convert/
    );
  });
});
