/**
 * PRECALL egress owner. Must be the FIRST import of every PRECALL entrypoint:
 * ES module evaluation follows import order, so nothing that is imported later
 * can capture a real transport, a provider credential, or the real data dir.
 *
 * Fail-closed: every outbound attempt is recorded (channel + host only) and then
 * rejected before any socket, DNS query or HTTP request is created. Nothing here
 * forwards to a real transport, retries, or falls back.
 *
 * Scope: global fetch, net/tls/http(s)/undici (all connect through
 * `net.Socket.prototype.connect`), and dns. No app imports.
 */
import dns from "node:dns";
import { mkdtempSync } from "node:fs";
import net from "node:net";
import { tmpdir } from "node:os";
import path from "node:path";

const PROVIDER_CREDENTIAL_ENV = [
  "CHEAPER_INFERENCE_API_KEY",
  "CHEAPER_INFERENCE_BENCHMARK_API_KEY",
  "OPENROUTER_API_KEY",
  "OPENAI_API_KEY",
  "GEMINI_API_KEY",
  "GOOGLE_API_KEY",
  "FLUENCE_API_KEY",
  "TURSO_DATABASE_URL",
  "TURSO_AUTH_TOKEN",
  "TURSO_DATABASE_TURSO_AUTH_TOKEN",
] as const;

export type PrecallEgressChannel =
  | "fetch"
  | "net.connect"
  | "dns.lookup"
  | "dns.resolve"
  | "dns.promises.lookup"
  | "dns.promises.resolve";

export type PrecallEgressAttempt = {
  channel: PrecallEgressChannel;
  host: string;
};

export class PrecallEgressBlockedError extends Error {
  constructor(readonly channel: PrecallEgressChannel) {
    super(`PRECALL_EGRESS_BLOCKED:${channel}`);
    this.name = "PrecallEgressBlockedError";
  }
}

export const precallOriginalDataDir = process.env.DATA_DIR ?? "";

for (const name of PROVIDER_CREDENTIAL_ENV) delete process.env[name];

/** Anything that opens the app DB during module init lands in this empty dir. */
export const precallTempDataDir = mkdtempSync(path.join(tmpdir(), "precall-empty-data-"));
process.env.DATA_DIR = precallTempDataDir;

const attempts: PrecallEgressAttempt[] = [];

export function precallEgressAttempts(): readonly PrecallEgressAttempt[] {
  return attempts;
}

function block(channel: PrecallEgressChannel, host: unknown): never {
  attempts.push({ channel, host: typeof host === "string" ? host.slice(0, 120) : "<unknown>" });
  throw new PrecallEgressBlockedError(channel);
}

function hostOfFetchInput(input: unknown): string {
  try {
    if (typeof input === "string") return new URL(input).hostname;
    if (input instanceof URL) return input.hostname;
    if (input && typeof input === "object" && "url" in input) {
      return new URL(String((input as { url: unknown }).url)).hostname;
    }
  } catch {
    return "<invalid-url>";
  }
  return "<unknown>";
}

function hostOfConnectArgs(args: unknown[]): string {
  const first = args[0];
  if (first && typeof first === "object") {
    const options = first as { host?: unknown; path?: unknown };
    if (typeof options.host === "string") return options.host;
    if (typeof options.path === "string") return "<unix-socket>";
    return "localhost";
  }
  if (typeof first === "string") return "<unix-socket>";
  return typeof args[1] === "string" ? args[1] : "localhost";
}

globalThis.fetch = (async (input: unknown) => {
  block("fetch", hostOfFetchInput(input));
}) as typeof fetch;

net.Socket.prototype.connect = function blockedConnect(...args: unknown[]): never {
  return block("net.connect", hostOfConnectArgs(args));
} as typeof net.Socket.prototype.connect;

dns.lookup = ((hostname: unknown) => block("dns.lookup", hostname)) as typeof dns.lookup;
dns.resolve = ((hostname: unknown) => block("dns.resolve", hostname)) as typeof dns.resolve;
dns.promises.lookup = (async (hostname: unknown) =>
  block("dns.promises.lookup", hostname)) as typeof dns.promises.lookup;
dns.promises.resolve = (async (hostname: unknown) =>
  block("dns.promises.resolve", hostname)) as typeof dns.promises.resolve;
