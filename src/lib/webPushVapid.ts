import "server-only";

import type Database from "better-sqlite3";
import webpush from "web-push";
import { getDb } from "@/lib/db";

export type WebPushVapidConfig = {
  publicKey: string;
  privateKey: string;
  subject: string;
  source: "env" | "app_meta";
};

const META_KEY = "web_push_vapid_json";

let cached: WebPushVapidConfig | null = null;

export function resetWebPushVapidCache(): void {
  cached = null;
}

function isWebPushDisabled(): boolean {
  return process.env.DISABLE_WEB_PUSH === "1";
}

export function isValidVapidSubject(value: string): boolean {
  if (/^mailto:[^\s@]+@[^\s@]+$/i.test(value)) return true;
  try {
    return new URL(value).protocol === "https:";
  } catch {
    return false;
  }
}

export function deriveVapidSubject(): string {
  const explicit = process.env.WEB_PUSH_SUBJECT?.trim() ?? "";
  if (isValidVapidSubject(explicit)) return explicit;

  for (const raw of [process.env.NEXTAUTH_URL, process.env.OPENROUTER_HTTP_REFERER]) {
    const value = raw?.trim() ?? "";
    if (!value) continue;
    try {
      const url = new URL(value);
      if (url.protocol === "https:") return url.origin;
    } catch {
      // Try the next candidate.
    }
  }

  const email = process.env.ADMIN_EMAILS?.split(",")[0]?.trim() ?? "";
  if (email.includes("@")) return `mailto:${email}`;
  return "mailto:noreply@localhost";
}

function readEnvConfig(): WebPushVapidConfig | null {
  const publicKey = process.env.WEB_PUSH_VAPID_PUBLIC_KEY?.trim() ?? "";
  const privateKey = process.env.WEB_PUSH_VAPID_PRIVATE_KEY?.trim() ?? "";
  if (!publicKey || !privateKey) return null;
  return {
    publicKey,
    privateKey,
    subject: deriveVapidSubject(),
    source: "env",
  };
}

function parseStoredConfig(value: string): Omit<WebPushVapidConfig, "source"> | null {
  try {
    const parsed = JSON.parse(value) as Partial<WebPushVapidConfig>;
    if (
      typeof parsed.publicKey !== "string" ||
      !parsed.publicKey ||
      typeof parsed.privateKey !== "string" ||
      !parsed.privateKey
    ) {
      return null;
    }
    const subject =
      typeof parsed.subject === "string" && isValidVapidSubject(parsed.subject)
        ? parsed.subject
        : deriveVapidSubject();
    return { publicKey: parsed.publicKey, privateKey: parsed.privateKey, subject };
  } catch {
    return null;
  }
}

function ensureAppMeta(db: Database.Database): void {
  db.exec(`
    CREATE TABLE IF NOT EXISTS app_meta (
      key TEXT PRIMARY KEY,
      value TEXT NOT NULL
    );
  `);
}

function readStoredConfig(db: Database.Database): WebPushVapidConfig | null {
  ensureAppMeta(db);
  const row = db.prepare("SELECT value FROM app_meta WHERE key=?").get(META_KEY) as
    | { value: string }
    | undefined;
  if (!row) return null;
  const parsed = parseStoredConfig(row.value);
  return parsed ? { ...parsed, source: "app_meta" } : null;
}

function loadOrCreateStoredConfig(db: Database.Database): WebPushVapidConfig {
  const existing = readStoredConfig(db);
  if (existing) return existing;

  const generated = webpush.generateVAPIDKeys();
  const created: WebPushVapidConfig = {
    publicKey: generated.publicKey,
    privateKey: generated.privateKey,
    subject: deriveVapidSubject(),
    source: "app_meta",
  };
  db.prepare("INSERT OR IGNORE INTO app_meta (key, value) VALUES (?, ?)").run(
    META_KEY,
    JSON.stringify({
      publicKey: created.publicKey,
      privateKey: created.privateKey,
      subject: created.subject,
    })
  );
  return readStoredConfig(db) ?? created;
}

export function resolveWebPushVapidConfig(db?: Database.Database): WebPushVapidConfig | null {
  if (isWebPushDisabled()) return null;
  if (cached) return cached;

  const fromEnv = readEnvConfig();
  if (fromEnv) {
    cached = fromEnv;
    return cached;
  }

  cached = loadOrCreateStoredConfig(db ?? getDb());
  return cached;
}
