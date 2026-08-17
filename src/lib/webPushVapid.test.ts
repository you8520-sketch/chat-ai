import assert from "node:assert/strict";
import test from "node:test";
import Database from "better-sqlite3";
import {
  deriveVapidSubject,
  isValidVapidSubject,
  resetWebPushVapidCache,
  resolveWebPushVapidConfig,
} from "./webPushVapid";

const ENV_KEYS = [
  "WEB_PUSH_VAPID_PUBLIC_KEY",
  "WEB_PUSH_VAPID_PRIVATE_KEY",
  "WEB_PUSH_SUBJECT",
  "DISABLE_WEB_PUSH",
  "NEXTAUTH_URL",
  "OPENROUTER_HTTP_REFERER",
  "ADMIN_EMAILS",
] as const;

const originalEnv = Object.fromEntries(ENV_KEYS.map((key) => [key, process.env[key]]));

function clearManagedEnv(): void {
  for (const key of ENV_KEYS) delete process.env[key];
}

function restoreManagedEnv(): void {
  for (const key of ENV_KEYS) {
    const value = originalEnv[key];
    if (value === undefined) delete process.env[key];
    else process.env[key] = value;
  }
}

function createMetaDb() {
  const db = new Database(":memory:");
  db.exec(`
    CREATE TABLE app_meta (
      key TEXT PRIMARY KEY,
      value TEXT NOT NULL
    );
  `);
  return db;
}

test.beforeEach(() => {
  clearManagedEnv();
  resetWebPushVapidCache();
});

test.after(() => {
  resetWebPushVapidCache();
  restoreManagedEnv();
});

test("accepts mailto and https VAPID subjects", () => {
  assert.equal(isValidVapidSubject("mailto:ops@example.com"), true);
  assert.equal(isValidVapidSubject("https://hobby.ai"), true);
  assert.equal(isValidVapidSubject("http://localhost:3000"), false);
  assert.equal(isValidVapidSubject("ops@example.com"), false);
});

test("derives a https subject from the public site URL", () => {
  process.env.OPENROUTER_HTTP_REFERER = "https://playai.example/";
  assert.equal(deriveVapidSubject(), "https://playai.example");
});

test("prefers explicit env keys over generated app_meta keys", () => {
  const db = createMetaDb();
  process.env.WEB_PUSH_VAPID_PUBLIC_KEY = "env-public";
  process.env.WEB_PUSH_VAPID_PRIVATE_KEY = "env-private";
  process.env.WEB_PUSH_SUBJECT = "mailto:ops@example.com";

  const config = resolveWebPushVapidConfig(db);
  assert.ok(config);
  assert.equal(config.source, "env");
  assert.equal(config.publicKey, "env-public");
  assert.equal(config.subject, "mailto:ops@example.com");
  const stored = db.prepare("SELECT COUNT(*) AS c FROM app_meta").get() as { c: number };
  assert.equal(stored.c, 0);
  db.close();
});

test("generates VAPID keys once and reuses the stored pair", () => {
  const db = createMetaDb();
  process.env.ADMIN_EMAILS = "owner@example.com";

  const first = resolveWebPushVapidConfig(db);
  assert.ok(first);
  assert.equal(first.source, "app_meta");
  assert.equal(first.subject, "mailto:owner@example.com");
  assert.ok(first.publicKey.length > 20);
  assert.ok(first.privateKey.length > 20);

  resetWebPushVapidCache();
  const second = resolveWebPushVapidConfig(db);
  assert.ok(second);
  assert.equal(second.publicKey, first.publicKey);
  assert.equal(second.privateKey, first.privateKey);
  const count = db.prepare("SELECT COUNT(*) AS c FROM app_meta").get() as { c: number };
  assert.equal(count.c, 1);
  db.close();
});

test("DISABLE_WEB_PUSH=1 keeps push off even when a database is available", () => {
  const db = createMetaDb();
  process.env.DISABLE_WEB_PUSH = "1";
  assert.equal(resolveWebPushVapidConfig(db), null);
  db.close();
});
