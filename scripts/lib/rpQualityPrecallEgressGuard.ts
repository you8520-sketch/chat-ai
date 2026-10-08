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
  method: string;
  /** First stack frame outside this guard and node internals: file:line only. */
  origin: string;
};

export class PrecallEgressBlockedError extends Error {
  constructor(readonly channel: PrecallEgressChannel) {
    super(`PRECALL_EGRESS_BLOCKED:${channel}`);
    this.name = "PrecallEgressBlockedError";
  }
}

export const precallOriginalDataDir = process.env.DATA_DIR ?? "";

for (const name of PROVIDER_CREDENTIAL_ENV) delete process.env[name];

/**
 * The prompt-assembly owners import `src/lib/db.ts`, which opens and migrates
 * `DATA_DIR/app.db` at module init. That must land in a scratch dir, never in the
 * production volume. PLAYWRIGHT_PROD_SERVER is dataDir.ts's existing escape hatch
 * for a production-mode process whose data dir is not a mounted volume.
 */
export const precallTempDataDir = mkdtempSync(path.join(tmpdir(), "precall-scratch-data-"));
process.env.DATA_DIR = precallTempDataDir;
process.env.PLAYWRIGHT_PROD_SERVER = "1";

const attempts: PrecallEgressAttempt[] = [];

export function precallEgressAttempts(): readonly PrecallEgressAttempt[] {
  return attempts;
}

/**
 * App-owned import-time side effect: `pointsMuse60` resolves point rates at module
 * init, which schedules a public exchange-rate GET. The guard rejects it before any
 * transport; billing FX for PRECALL comes from the DB snapshot, never from this call.
 * It is the only attempt tolerated. Every other attempt fails the run.
 */
export const PRECALL_KNOWN_BLOCKED_NON_PROVIDER_ATTEMPT = Object.freeze({
  channel: "fetch",
  host: "open.er-api.com",
  method: "GET",
  origin: "src/lib/exchangeRate.ts:71",
} as const);

export function precallUnexpectedEgressAttempts(): readonly PrecallEgressAttempt[] {
  const known = PRECALL_KNOWN_BLOCKED_NON_PROVIDER_ATTEMPT;
  return attempts.filter(
    (attempt) =>
      !(
        attempt.channel === known.channel &&
        attempt.host === known.host &&
        attempt.method === known.method &&
        attempt.origin === known.origin
      )
  );
}

function callerOrigin(): string {
  const frames = (new Error().stack ?? "").split("\n").slice(1);
  for (const frame of frames) {
    const match = /\(?([^()\s]+:\d+):\d+\)?$/.exec(frame.trim());
    const location = match?.[1];
    if (!location || location.startsWith("node:") || location.includes("rpQualityPrecallEgressGuard")) {
      continue;
    }
    return location.replace(/^.*\/(src|scripts|node_modules)\//, "$1/");
  }
  return "<unknown>";
}

function block(channel: PrecallEgressChannel, host: unknown, method = "n/a"): never {
  attempts.push({
    channel,
    host: typeof host === "string" ? host.slice(0, 120) : "<unknown>",
    method,
    origin: callerOrigin(),
  });
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

/**
 * App modules log prompt-assembly diagnostics at init and runtime. Nothing but the
 * runner's final JSON may leave the process, so every console channel is muted.
 */
for (const method of ["log", "info", "debug", "warn", "error", "trace"] as const) {
  console[method] = () => undefined;
}

function methodOfFetch(input: unknown, init: unknown): string {
  const fromInit = (init as { method?: unknown } | undefined)?.method;
  if (typeof fromInit === "string") return fromInit.toUpperCase();
  const fromRequest = (input as { method?: unknown } | null)?.method;
  return typeof fromRequest === "string" ? fromRequest.toUpperCase() : "GET";
}

globalThis.fetch = (async (input: unknown, init?: unknown) => {
  block("fetch", hostOfFetchInput(input), methodOfFetch(input, init));
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
