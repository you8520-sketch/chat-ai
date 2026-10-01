/**
 * Periodic hav.chat DNS/TLS/health observer.
 * Railway remains the certificate issuance owner.
 * Post-deploy verification remains the deploy-SHA owner.
 */
import { appendFileSync, writeFileSync } from "node:fs";
import dns from "node:dns/promises";
import tls from "node:tls";
import { pathToFileURL } from "node:url";

export const DOMAIN_SSL_HOSTNAME = "hav.chat";
export const DOMAIN_SSL_ORIGIN = `https://${DOMAIN_SSL_HOSTNAME}`;
export const DOMAIN_SSL_HEALTH_PATH = "/health";
export const DOMAIN_SSL_WORKFLOW_PATH = ".github/workflows/domain-ssl-monitor.yml";
export const DOMAIN_SSL_EVIDENCE_PREFIX = "domain-ssl-monitor ";
export const DOMAIN_SSL_REQUEST_TIMEOUT_MS = 5_000;
export const DOMAIN_SSL_MAX_ATTEMPTS = 3;
export const DOMAIN_SSL_RETRY_DELAY_MS = 1_500;
export const DOMAIN_SSL_TOTAL_BUDGET_MS = 25_000;
export const DOMAIN_SSL_WARN_DAYS = 21;
export const DOMAIN_SSL_CRITICAL_DAYS = 7;

export type DomainSslCheckState = "OK" | "WARNING" | "FAIL" | "UNVERIFIED";

export type DomainSslDnsEvidence = {
  state: DomainSslCheckState;
  reason: string | null;
  addressCount: number;
};

export type DomainSslTlsEvidence = {
  state: DomainSslCheckState;
  reason: string | null;
  daysLeft: number | null;
  hostnameOk: boolean | null;
  authorized: boolean | null;
};

export type DomainSslHealthEvidence = {
  state: DomainSslCheckState;
  reason: string | null;
};

export type DomainSslEvidence = {
  state: DomainSslCheckState;
  hostname: typeof DOMAIN_SSL_HOSTNAME;
  checkedAt: string;
  attempts: number;
  reason: string | null;
  dns: DomainSslDnsEvidence;
  tls: DomainSslTlsEvidence;
  health: DomainSslHealthEvidence;
};

export type DomainSslMonitorHeadline = {
  state: DomainSslCheckState;
  checkedAt: string;
  reason: string | null;
  htmlUrl: string;
  runConclusion: string | null;
  attempts: number;
  dns: DomainSslDnsEvidence;
  tls: DomainSslTlsEvidence;
  health: DomainSslHealthEvidence;
};

export type DomainSslMonitorView = {
  status: "OK" | "UNAVAILABLE";
  error: string | null;
  latest: DomainSslMonitorHeadline | null;
};

export type ParsedDomainSslRun = {
  runId: number;
  htmlUrl: string;
  createdAt: string;
  conclusion: string | null;
  evidence: DomainSslEvidence | null;
};

export type DnsProbe =
  | { kind: "ok"; addressCount: number }
  | { kind: "not_found" }
  | { kind: "timeout" }
  | { kind: "error"; retryable: boolean; reason: string };

export type TlsProbe =
  | {
      kind: "connected";
      authorized: boolean;
      authorizationError: string | null;
      hostnameOk: boolean;
      validToMs: number | null;
    }
  | { kind: "timeout" }
  | { kind: "error"; retryable: boolean; reason: string };

export type HealthProbe =
  | { kind: "ok" }
  | { kind: "http"; status: number; retryable: boolean }
  | { kind: "contract"; reason: string }
  | { kind: "redirect"; external: boolean }
  | { kind: "timeout" }
  | { kind: "error"; retryable: boolean; reason: string };

export type DomainSslPorts = {
  resolveDns: (hostname: string, timeoutMs: number) => Promise<DnsProbe>;
  connectTls: (hostname: string, timeoutMs: number) => Promise<TlsProbe>;
  fetchHealth: (url: string, timeoutMs: number) => Promise<HealthProbe>;
};

const RETRYABLE_HTTP = new Set([502, 503, 504]);
const RETRYABLE_DNS = new Set(["EAGAIN", "EAI_AGAIN", "ETIMEOUT", "ETIMEDOUT"]);
const RETRYABLE_CONNECT = new Set(["ECONNRESET", "ECONNREFUSED", "ETIMEDOUT", "EPIPE"]);

export function classifyCertificateExpiry(daysLeft: number): DomainSslCheckState {
  if (!Number.isFinite(daysLeft)) return "UNVERIFIED";
  if (daysLeft < DOMAIN_SSL_CRITICAL_DAYS) return "FAIL";
  if (daysLeft <= DOMAIN_SSL_WARN_DAYS) return "WARNING";
  return "OK";
}

export function daysUntil(validToMs: number, nowMs: number): number {
  return (validToMs - nowMs) / 86_400_000;
}

export function rollupDomainSslState(
  states: readonly DomainSslCheckState[]
): DomainSslCheckState {
  if (states.includes("FAIL")) return "FAIL";
  if (states.includes("UNVERIFIED")) return "UNVERIFIED";
  if (states.includes("WARNING")) return "WARNING";
  return "OK";
}

function shortReason(value: unknown): string | null {
  return typeof value === "string" && value.trim() ? value.trim().slice(0, 80) : null;
}

function asRecord(value: unknown): Record<string, unknown> | null {
  return value && typeof value === "object" && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : null;
}

function asCheckState(value: unknown): DomainSslCheckState | null {
  return value === "OK" || value === "WARNING" || value === "FAIL" || value === "UNVERIFIED"
    ? value
    : null;
}

function parseDnsEvidence(value: unknown): DomainSslDnsEvidence {
  const record = asRecord(value);
  const state = asCheckState(record?.state);
  if (!record || !state) {
    return { state: "UNVERIFIED", reason: "evidence_missing", addressCount: 0 };
  }
  return {
    state,
    reason: shortReason(record.reason),
    addressCount: typeof record.addressCount === "number" && record.addressCount >= 0
      ? record.addressCount
      : 0,
  };
}

function parseTlsEvidence(value: unknown): DomainSslTlsEvidence {
  const record = asRecord(value);
  const state = asCheckState(record?.state);
  if (!record || !state) {
    return {
      state: "UNVERIFIED",
      reason: "evidence_missing",
      daysLeft: null,
      hostnameOk: null,
      authorized: null,
    };
  }
  return {
    state,
    reason: shortReason(record.reason),
    daysLeft: typeof record.daysLeft === "number" && Number.isFinite(record.daysLeft)
      ? record.daysLeft
      : null,
    hostnameOk: typeof record.hostnameOk === "boolean" ? record.hostnameOk : null,
    authorized: typeof record.authorized === "boolean" ? record.authorized : null,
  };
}

function parseHealthEvidence(value: unknown): DomainSslHealthEvidence {
  const record = asRecord(value);
  const state = asCheckState(record?.state);
  if (!record || !state) {
    return { state: "UNVERIFIED", reason: "evidence_missing" };
  }
  return { state, reason: shortReason(record.reason) };
}

export function parseDomainSslEvidence(message: string): DomainSslEvidence | null {
  const trimmed = message.trim();
  if (!trimmed.startsWith(DOMAIN_SSL_EVIDENCE_PREFIX)) return null;
  try {
    const parsed = JSON.parse(trimmed.slice(DOMAIN_SSL_EVIDENCE_PREFIX.length)) as Partial<DomainSslEvidence>;
    const state = asCheckState(parsed.state);
    if (!state) return null;
    if (parsed.hostname !== DOMAIN_SSL_HOSTNAME) return null;
    const dnsEvidence = parseDnsEvidence(parsed.dns);
    const tlsEvidence = parseTlsEvidence(parsed.tls);
    const healthEvidence = parseHealthEvidence(parsed.health);
    return {
      state,
      hostname: DOMAIN_SSL_HOSTNAME,
      checkedAt: typeof parsed.checkedAt === "string" ? parsed.checkedAt : "",
      attempts: typeof parsed.attempts === "number" && parsed.attempts >= 0 ? parsed.attempts : 0,
      reason: shortReason(parsed.reason),
      dns: dnsEvidence,
      tls: tlsEvidence,
      health: healthEvidence,
    };
  } catch {
    return null;
  }
}

export function missingDomainSslEvidence(reason = "awaiting_live_run"): DomainSslEvidence {
  return {
    state: "UNVERIFIED",
    hostname: DOMAIN_SSL_HOSTNAME,
    checkedAt: "",
    attempts: 0,
    reason,
    dns: { state: "UNVERIFIED", reason, addressCount: 0 },
    tls: {
      state: "UNVERIFIED",
      reason,
      daysLeft: null,
      hostnameOk: null,
      authorized: null,
    },
    health: { state: "UNVERIFIED", reason },
  };
}

export function projectDomainSslMonitor(input: {
  runs: readonly ParsedDomainSslRun[];
  readError?: string | null;
}): DomainSslMonitorView {
  if (input.readError) {
    return { status: "UNAVAILABLE", error: input.readError, latest: null };
  }
  const newest = [...input.runs].sort((a, b) => b.createdAt.localeCompare(a.createdAt))[0];
  if (!newest) {
    const empty = missingDomainSslEvidence();
    return {
      status: "OK",
      error: null,
      latest: {
        state: empty.state,
        checkedAt: empty.checkedAt,
        reason: empty.reason,
        htmlUrl: "",
        runConclusion: null,
        attempts: 0,
        dns: empty.dns,
        tls: empty.tls,
        health: empty.health,
      },
    };
  }
  const evidence = newest.evidence ?? missingDomainSslEvidence("evidence_missing");
  return {
    status: "OK",
    error: null,
    latest: {
      state: evidence.state,
      checkedAt: evidence.checkedAt || newest.createdAt,
      reason: evidence.reason,
      htmlUrl: newest.htmlUrl,
      runConclusion: newest.conclusion,
      attempts: evidence.attempts,
      dns: evidence.dns,
      tls: evidence.tls,
      health: evidence.health,
    },
  };
}

function emptyTls(): DomainSslTlsEvidence {
  return {
    state: "UNVERIFIED",
    reason: "not_run",
    daysLeft: null,
    hostnameOk: null,
    authorized: null,
  };
}

function emptyHealth(): DomainSslHealthEvidence {
  return { state: "UNVERIFIED", reason: "not_run" };
}

function classifyDns(probe: DnsProbe): DomainSslDnsEvidence {
  switch (probe.kind) {
    case "ok":
      return {
        state: probe.addressCount > 0 ? "OK" : "FAIL",
        reason: probe.addressCount > 0 ? null : "dns_empty",
        addressCount: probe.addressCount,
      };
    case "not_found":
      return { state: "FAIL", reason: "dns_not_found", addressCount: 0 };
    case "timeout":
      return { state: "UNVERIFIED", reason: "dns_timeout", addressCount: 0 };
    case "error":
      return {
        state: probe.retryable ? "UNVERIFIED" : "FAIL",
        reason: probe.reason.slice(0, 80),
        addressCount: 0,
      };
    default: {
      const _exhaustive: never = probe;
      return _exhaustive;
    }
  }
}

function classifyTls(probe: TlsProbe, nowMs: number): DomainSslTlsEvidence {
  switch (probe.kind) {
    case "timeout":
      return {
        state: "UNVERIFIED",
        reason: "tls_timeout",
        daysLeft: null,
        hostnameOk: null,
        authorized: null,
      };
    case "error":
      return {
        state: probe.retryable ? "UNVERIFIED" : "FAIL",
        reason: probe.reason.slice(0, 80),
        daysLeft: null,
        hostnameOk: null,
        authorized: null,
      };
    case "connected": {
      if (!probe.hostnameOk) {
        return {
          state: "FAIL",
          reason: "tls_hostname_mismatch",
          daysLeft: null,
          hostnameOk: false,
          authorized: probe.authorized,
        };
      }
      if (!probe.authorized) {
        return {
          state: "FAIL",
          reason: shortReason(probe.authorizationError) ?? "tls_untrusted",
          daysLeft: null,
          hostnameOk: true,
          authorized: false,
        };
      }
      if (probe.validToMs == null) {
        return {
          state: "UNVERIFIED",
          reason: "tls_expiry_unreadable",
          daysLeft: null,
          hostnameOk: true,
          authorized: true,
        };
      }
      const daysLeft = daysUntil(probe.validToMs, nowMs);
      const state = classifyCertificateExpiry(daysLeft);
      const reason =
        state === "FAIL"
          ? daysLeft <= 0
            ? "tls_expired"
            : "tls_expiry_critical"
          : state === "WARNING"
            ? "tls_expiry_warning"
            : null;
      return {
        state,
        reason,
        daysLeft: Math.round(daysLeft * 10) / 10,
        hostnameOk: true,
        authorized: true,
      };
    }
    default: {
      const _exhaustive: never = probe;
      return _exhaustive;
    }
  }
}

function classifyHealth(probe: HealthProbe): DomainSslHealthEvidence {
  switch (probe.kind) {
    case "ok":
      return { state: "OK", reason: null };
    case "http":
      return {
        state: probe.retryable ? "UNVERIFIED" : "FAIL",
        reason: `health_http_${probe.status}`,
      };
    case "contract":
      return { state: "FAIL", reason: probe.reason };
    case "redirect":
      return { state: "FAIL", reason: probe.external ? "external_redirect" : "redirect_not_followed" };
    case "timeout":
      return { state: "UNVERIFIED", reason: "health_timeout" };
    case "error":
      return {
        state: probe.retryable ? "UNVERIFIED" : "FAIL",
        reason: probe.reason.slice(0, 80),
      };
    default: {
      const _exhaustive: never = probe;
      return _exhaustive;
    }
  }
}

function retryableDns(probe: DnsProbe): boolean {
  return probe.kind === "timeout" || (probe.kind === "error" && probe.retryable);
}

function retryableTls(probe: TlsProbe): boolean {
  return probe.kind === "timeout" || (probe.kind === "error" && probe.retryable);
}

function retryableHealth(probe: HealthProbe): boolean {
  return (
    probe.kind === "timeout" ||
    (probe.kind === "http" && probe.retryable) ||
    (probe.kind === "error" && probe.retryable)
  );
}

/** Convert thrown timeout sentinels into promise rejection, never an uncaught timer error. */
export async function withTimeout<T>(
  work: Promise<T>,
  timeoutMs: number,
  onTimeout: () => T
): Promise<T> {
  let timer: ReturnType<typeof setTimeout> | undefined;
  try {
    return await Promise.race([
      work,
      new Promise<T>((resolve, reject) => {
        timer = setTimeout(() => {
          try {
            resolve(onTimeout());
          } catch (error) {
            reject(error);
          }
        }, timeoutMs);
      }),
    ]);
  } finally {
    if (timer) clearTimeout(timer);
  }
}

export async function resolveOfficialDns(
  hostname: string,
  timeoutMs: number
): Promise<DnsProbe> {
  try {
    const rows = await withTimeout(
      dns.lookup(hostname, { all: true }),
      timeoutMs,
      () => {
        throw Object.assign(new Error("dns_timeout"), { code: "ETIMEOUT" });
      }
    );
    const usable = rows.filter((row) => row.family === 4 || row.family === 6);
    if (usable.length === 0) return { kind: "not_found" };
    return { kind: "ok", addressCount: usable.length };
  } catch (error) {
    const code = error && typeof error === "object" && "code" in error
      ? String((error as { code?: unknown }).code ?? "")
      : "";
    if (code === "ENOTFOUND" || code === "ENODATA" || code === "ESERVFAIL") {
      return { kind: "not_found" };
    }
    if (code === "ETIMEOUT" || code === "ETIMEDOUT") return { kind: "timeout" };
    return {
      kind: "error",
      retryable: RETRYABLE_DNS.has(code),
      reason: code || "dns_error",
    };
  }
}

function certHasHostname(cert: tls.PeerCertificate, hostname: string): boolean {
  const alt = String(cert.subjectaltname ?? "");
  const names = alt
    .split(",")
    .map((part) => part.trim())
    .filter((part) => part.startsWith("DNS:"))
    .map((part) => part.slice(4).toLowerCase());
  const cn = String(cert.subject?.CN ?? "").toLowerCase();
  const wanted = hostname.toLowerCase();
  return names.includes(wanted) || cn === wanted;
}

export function connectOfficialTls(
  hostname: string,
  timeoutMs: number
): Promise<TlsProbe> {
  return new Promise((resolve) => {
    let settled = false;
    const done = (probe: TlsProbe) => {
      if (settled) return;
      settled = true;
      socket.removeAllListeners();
      socket.destroy();
      resolve(probe);
    };
    const socket = tls.connect({
      host: hostname,
      port: 443,
      servername: hostname,
      timeout: timeoutMs,
    });
    socket.on("timeout", () => done({ kind: "timeout" }));
    socket.on("error", (error) => {
      const code = error && typeof error === "object" && "code" in error
        ? String((error as { code?: unknown }).code ?? "")
        : "";
      if (code === "ETIMEDOUT") {
        done({ kind: "timeout" });
        return;
      }
      done({
        kind: "error",
        retryable: RETRYABLE_CONNECT.has(code),
        reason: code || "tls_error",
      });
    });
    socket.on("secureConnect", () => {
      const cert = socket.getPeerCertificate();
      const validToMs = cert.valid_to ? Date.parse(cert.valid_to) : NaN;
      done({
        kind: "connected",
        authorized: socket.authorized === true,
        authorizationError: socket.authorizationError
          ? String(socket.authorizationError)
          : null,
        hostnameOk: certHasHostname(cert, hostname),
        validToMs: Number.isFinite(validToMs) ? validToMs : null,
      });
    });
  });
}

export async function fetchOfficialHealth(
  url: string,
  timeoutMs: number,
  fetchImpl: typeof fetch = fetch
): Promise<HealthProbe> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    const response = await fetchImpl(url, {
      method: "GET",
      redirect: "manual",
      signal: controller.signal,
      headers: { Accept: "application/json" },
    });
    if (response.status >= 300 && response.status < 400) {
      const location = response.headers.get("location");
      let official = false;
      if (location) {
        try {
          official = new URL(location, DOMAIN_SSL_ORIGIN).origin === DOMAIN_SSL_ORIGIN;
        } catch {
          official = false;
        }
      }
      await response.body?.cancel().catch(() => undefined);
      return { kind: "redirect", external: !official };
    }
    if (RETRYABLE_HTTP.has(response.status)) {
      await response.body?.cancel().catch(() => undefined);
      return { kind: "http", status: response.status, retryable: true };
    }
    if (response.status !== 200) {
      await response.body?.cancel().catch(() => undefined);
      return { kind: "http", status: response.status, retryable: false };
    }
    const text = await response.text();
    if (!text.trim()) return { kind: "contract", reason: "health_empty" };
    try {
      const body = JSON.parse(text) as unknown;
      const record = asRecord(body);
      if (record?.status === "ok") return { kind: "ok" };
      return { kind: "contract", reason: "health_contract" };
    } catch {
      return { kind: "contract", reason: "health_invalid_json" };
    }
  } catch (error) {
    const aborted = error instanceof Error && error.name === "AbortError";
    if (aborted) return { kind: "timeout" };
    const code = error && typeof error === "object" && "code" in error
      ? String((error as { code?: unknown }).code ?? "")
      : "";
    return {
      kind: "error",
      retryable: RETRYABLE_CONNECT.has(code),
      reason: code || "health_error",
    };
  } finally {
    clearTimeout(timer);
  }
}

export const liveDomainSslPorts: DomainSslPorts = {
  resolveDns: resolveOfficialDns,
  connectTls: connectOfficialTls,
  fetchHealth: fetchOfficialHealth,
};

export async function monitorOfficialDomain(input: {
  ports?: DomainSslPorts;
  now?: () => Date;
  sleep?: (ms: number) => Promise<void>;
  budgetMs?: number;
  maxAttempts?: number;
  timeoutMs?: number;
  retryDelayMs?: number;
}): Promise<DomainSslEvidence> {
  const ports = input.ports ?? liveDomainSslPorts;
  const now = input.now ?? (() => new Date());
  const sleep = input.sleep ?? ((ms: number) => new Promise((resolve) => setTimeout(resolve, ms)));
  const budgetMs = input.budgetMs ?? DOMAIN_SSL_TOTAL_BUDGET_MS;
  const maxAttempts = input.maxAttempts ?? DOMAIN_SSL_MAX_ATTEMPTS;
  const timeoutMs = input.timeoutMs ?? DOMAIN_SSL_REQUEST_TIMEOUT_MS;
  const retryDelayMs = input.retryDelayMs ?? DOMAIN_SSL_RETRY_DELAY_MS;
  const started = now().getTime();
  const withinBudget = () => now().getTime() - started < budgetMs;
  const checkedAt = () => now().toISOString();

  let attempts = 0;
  let dnsEvidence: DomainSslDnsEvidence = {
    state: "UNVERIFIED",
    reason: "not_run",
    addressCount: 0,
  };

  while (attempts < maxAttempts && withinBudget()) {
    attempts += 1;
    const probe = await ports.resolveDns(DOMAIN_SSL_HOSTNAME, timeoutMs);
    dnsEvidence = classifyDns(probe);
    if (dnsEvidence.state === "OK" || dnsEvidence.state === "FAIL") break;
    if (!retryableDns(probe) || attempts >= maxAttempts || !withinBudget()) break;
    await sleep(retryDelayMs);
  }

  let tlsEvidence = emptyTls();
  if (dnsEvidence.state !== "FAIL" && withinBudget()) {
    let tlsAttempts = 0;
    while (tlsAttempts < maxAttempts && withinBudget()) {
      tlsAttempts += 1;
      attempts += 1;
      const probe = await ports.connectTls(DOMAIN_SSL_HOSTNAME, timeoutMs);
      tlsEvidence = classifyTls(probe, now().getTime());
      if (tlsEvidence.state === "OK" || tlsEvidence.state === "WARNING" || tlsEvidence.state === "FAIL") {
        break;
      }
      if (!retryableTls(probe) || tlsAttempts >= maxAttempts || !withinBudget()) break;
      await sleep(retryDelayMs);
    }
  }

  let healthEvidence = emptyHealth();
  if (dnsEvidence.state !== "FAIL" && tlsEvidence.state !== "FAIL" && withinBudget()) {
    let healthAttempts = 0;
    while (healthAttempts < maxAttempts && withinBudget()) {
      healthAttempts += 1;
      attempts += 1;
      const probe = await ports.fetchHealth(
        `${DOMAIN_SSL_ORIGIN}${DOMAIN_SSL_HEALTH_PATH}`,
        timeoutMs
      );
      healthEvidence = classifyHealth(probe);
      if (healthEvidence.state === "OK" || healthEvidence.state === "FAIL") break;
      if (!retryableHealth(probe) || healthAttempts >= maxAttempts || !withinBudget()) break;
      await sleep(retryDelayMs);
    }
  }

  if (healthEvidence.state === "UNVERIFIED" && healthEvidence.reason === "health_http_503") {
    healthEvidence = { state: "FAIL", reason: "health_http_503" };
  }

  const state = rollupDomainSslState([dnsEvidence.state, tlsEvidence.state, healthEvidence.state]);
  const reason =
    dnsEvidence.state !== "OK"
      ? dnsEvidence.reason
      : tlsEvidence.state !== "OK"
        ? tlsEvidence.reason
        : healthEvidence.reason;

  return {
    state,
    hostname: DOMAIN_SSL_HOSTNAME,
    checkedAt: checkedAt(),
    attempts,
    reason,
    dns: dnsEvidence,
    tls: tlsEvidence,
    health: healthEvidence,
  };
}

export function emitDomainSslEvidence(evidence: DomainSslEvidence): void {
  const json = JSON.stringify(evidence);
  writeFileSync("domain-ssl-monitor.json", `${json}\n`, "utf8");
  const summary = process.env.GITHUB_STEP_SUMMARY;
  if (summary) appendFileSync(summary, `\n\`\`\`json\n${json}\n\`\`\`\n`, "utf8");
  if (process.env.GITHUB_ACTIONS === "true") {
    const safe = `${DOMAIN_SSL_EVIDENCE_PREFIX}${json}`
      .replace(/%/g, "%25")
      .replace(/\r/g, "%0D")
      .replace(/\n/g, "%0A");
    console.log(`::notice title=domain-ssl-monitor::${safe}`);
  }
  console.log(json);
}

async function runCli(): Promise<number> {
  const dryRun =
    process.argv.includes("--dry-run") ||
    process.env.DOMAIN_SSL_DRY_RUN === "1" ||
    process.env.DOMAIN_SSL_DRY_RUN === "true";
  const evidence = await monitorOfficialDomain({});
  emitDomainSslEvidence(evidence);
  if (dryRun) return 0;
  return evidence.state === "FAIL" ? 1 : 0;
}

const invokedDirectly = process.argv[1]
  ? import.meta.url === pathToFileURL(process.argv[1]).href
  : false;

if (invokedDirectly) {
  void runCli().then((code) => {
    process.exitCode = code;
  });
}
