/**
 * Local one-command Luna PRECALL. Reuses the live execute identity,
 * journal resolve, key-present, and isolated-DB owners. Does not POST,
 * does not create or reset the durable journal, and does not flip approval.
 */
import { existsSync, readFileSync, writeFileSync } from "node:fs";
import { spawnSync } from "node:child_process";
import path from "node:path";
import { paidRunnerRequestBodyFingerprint } from "@/lib/rpQualityPaidRunner";
import {
  assertIsolatedTestDatabaseActive,
  installIsolatedTestDatabase,
  uninstallIsolatedTestDatabase,
} from "@/lib/test/isolatedTestDatabase";
import {
  LUNA_SUMMARY_APPROVED_BATCH_FINGERPRINTS,
  LUNA_SUMMARY_EXPERIMENT_KEY_ENV,
  LUNA_SUMMARY_HARD_MAXIMUM_USD,
  LUNA_SUMMARY_MAX_NETWORK_ATTEMPTS,
  LUNA_SUMMARY_PLANNED_POSTS,
} from "./memory50TurnLunaSummaryPrepare";
import {
  LUNA_SUMMARY_CANONICAL_JOURNAL_DIR,
  LUNA_SUMMARY_JOURNAL_DIR_ENV,
  LUNA_SUMMARY_LIVE_APPROVAL_STATUS,
  LUNA_SUMMARY_LIVE_BATCH_FINGERPRINTS,
  LUNA_SUMMARY_LIVE_COUPLED_APPROVAL_MANIFEST,
  LUNA_SUMMARY_LIVE_EXECUTE_MANIFEST,
  LUNA_SUMMARY_LIVE_WIRE_CONTRACT,
  journalHasReservedHistory,
  lunaExecuteExperimentKeyPresent,
  resolveLunaSummaryJournalDirectory,
  verifyLunaRequestIdentity,
  type LunaDurableJournal,
  type LunaLiveApprovalStatus,
} from "./memory50TurnLunaSummaryExecute";

export const LUNA_SUMMARY_CURSOR_SECRET_ENV = "hav_luna_memory50_test" as const;
export const LUNA_SUMMARY_PRECALL_CACHE_FILENAME = "luna-summary-precall-cache.json" as const;
export const LUNA_SUMMARY_PRECALL_CACHE_VERSION = 1 as const;
export const LUNA_SUMMARY_CLOUD_CANNOT_VERIFY_WSL =
  "Cloud Agent cannot perform Windows/WSL local verification" as const;
export const LUNA_SUMMARY_PRECALL_REPORT_FILENAME = "luna-summary-precall-report.json" as const;

export type LunaPrecallHostKind = "cloud" | "wsl2" | "linux" | "windows" | "unknown";
export type LunaPrecallVerdict =
  | "READY_FOR_APPROVAL"
  | "BLOCKED"
  | "ALREADY_EXECUTED"
  | "UNRESOLVED_NO_RETRY";

export type LunaPrecallHost = {
  kind: LunaPrecallHostKind;
  cloudAgent: boolean;
  wsl2: boolean;
  cloudCannotVerifyWsl: boolean;
};

export type LunaPrecallIdentity = {
  ok: boolean;
  reason: string | null;
  liveExecuteManifestFingerprint: string;
  liveSealFingerprints: string[];
  prepareFingerprints: string[];
  liveApprovalStatus: LunaLiveApprovalStatus;
};

export type LunaSummaryPrecallReport = {
  command: "luna:precall";
  verdict: LunaPrecallVerdict;
  blocker: string | null;
  LIVE_PRECALL_READY: boolean;
  cloudAgent: boolean;
  cloudCannotVerifyWsl: boolean;
  cloudReport: string | null;
  hostKind: LunaPrecallHostKind;
  wsl2: boolean;
  repoSha: string | null;
  nodeVersion: string;
  nodeOk: boolean;
  journalDirectory: string | null;
  journalDirectoryOk: boolean;
  journalDirectoryExists: boolean;
  journalFileExists: boolean;
  journalDurable: boolean;
  journalReason: string | null;
  journalReservedHistory: boolean;
  journalHasUnknownUnresolved: boolean;
  journalExecuted: boolean | null;
  journalNetworkAttempts: number | null;
  createdJournal: false;
  deletedHistory: false;
  keyPresent: boolean;
  keyEqualsProduction: boolean;
  keyMappedFromCursorSecret: boolean;
  keyEnvName: typeof LUNA_SUMMARY_EXPERIMENT_KEY_ENV;
  isolatedDbOk: boolean;
  isolatedDbInstalledThenUninstalled: boolean;
  identityOk: boolean;
  identityReused: boolean;
  identityReason: string | null;
  liveExecuteManifestFingerprint: string;
  liveSealFingerprints: string[];
  prepareFingerprints: string[];
  liveApprovalStatus: LunaLiveApprovalStatus;
  plannedPosts: typeof LUNA_SUMMARY_PLANNED_POSTS;
  maximumNetworkAttempts: typeof LUNA_SUMMARY_MAX_NETWORK_ATTEMPTS;
  maxTokens: null;
  hardMaximumUsd: typeof LUNA_SUMMARY_HARD_MAXIMUM_USD;
  spendCapPresent: false;
  callCountCap: typeof LUNA_SUMMARY_PLANNED_POSTS;
  identityFingerprint: string;
  cacheHit: boolean;
  paidPosts: 0;
  networkPosts: 0;
  blockers: string[];
};

export type LunaSummaryPrecallInput = {
  env?: NodeJS.ProcessEnv;
  cwd?: string;
  journalDirectory?: string | null;
  nodeVersion?: string;
  persistCache?: boolean;
  detectHost?: () => LunaPrecallHost;
  readRepoSha?: (cwd: string) => string | null;
  verifyIdentity?: () => Promise<LunaPrecallIdentity>;
  probeIsolatedDatabase?: () => { ok: boolean; installedThenUninstalled: boolean };
};

type PrecallCache = {
  version: typeof LUNA_SUMMARY_PRECALL_CACHE_VERSION;
  repoSha: string;
  hostKind: LunaPrecallHostKind;
  nodeMinor: string;
  identityFingerprint: string;
  identity: LunaPrecallIdentity;
};

function nodeMinor(version: string): string {
  const match = /^v?(\d+)\.(\d+)/.exec(version);
  return match ? `${match[1]}.${match[2]}` : "";
}

export function lunaPrecallNodeOk(version: string): boolean {
  const match = /^v?(\d+)\.(\d+)\.(\d+)/.exec(version);
  if (!match) return false;
  const major = Number(match[1]);
  const minor = Number(match[2]);
  const patch = Number(match[3]);
  if (major !== major || minor !== minor || patch !== patch) return false;
  if (major > 22) return true;
  if (major < 22) return false;
  if (minor > 12) return true;
  if (minor < 12) return false;
  return patch >= 0;
}

export function detectLunaPrecallHost(input?: {
  env?: NodeJS.ProcessEnv;
  platform?: NodeJS.Platform;
  pathExists?: (target: string) => boolean;
}): LunaPrecallHost {
  const env = input?.env ?? process.env;
  const pathExists = input?.pathExists ?? existsSync;
  const cloudAgent =
    Boolean(env.CLOUD_AGENT_INJECTED_SECRET_NAMES?.trim()) ||
    env.CURSOR_AGENT === "1" ||
    env.CURSOR_AGENT === "true" ||
    pathExists("/cursor/stores/self");
  if (cloudAgent) {
    return {
      kind: "cloud",
      cloudAgent: true,
      wsl2: false,
      cloudCannotVerifyWsl: true,
    };
  }
  const wsl2 =
    Boolean(env.WSL_DISTRO_NAME?.trim()) ||
    pathExists("/proc/sys/fs/binfmt_misc/WSLInterop");
  if (wsl2) {
    return {
      kind: "wsl2",
      cloudAgent: false,
      wsl2: true,
      cloudCannotVerifyWsl: false,
    };
  }
  const platform = input?.platform ?? process.platform;
  const kind: LunaPrecallHostKind =
    platform === "win32" ? "windows" : platform === "linux" ? "linux" : "unknown";
  return {
    kind,
    cloudAgent: false,
    wsl2: false,
    cloudCannotVerifyWsl: false,
  };
}

export function applyLunaExperimentKeyFromCursorSecret(env: NodeJS.ProcessEnv): {
  mapped: boolean;
  present: boolean;
  equalsProduction: boolean;
  envName: typeof LUNA_SUMMARY_EXPERIMENT_KEY_ENV;
} {
  const app = env[LUNA_SUMMARY_EXPERIMENT_KEY_ENV]?.trim() ?? "";
  const cursor = env[LUNA_SUMMARY_CURSOR_SECRET_ENV]?.trim() ?? "";
  let mapped = false;
  if (!app && cursor) {
    env[LUNA_SUMMARY_EXPERIMENT_KEY_ENV] = cursor;
    mapped = true;
  }
  const key = lunaExecuteExperimentKeyPresent(env);
  return {
    mapped,
    present: key.present,
    equalsProduction: key.equalsProduction,
    envName: key.envName,
  };
}

export function lunaSummaryPrecallIdentityFingerprint(): string {
  return paidRunnerRequestBodyFingerprint({
    liveExecuteManifest: LUNA_SUMMARY_LIVE_EXECUTE_MANIFEST,
    liveBatchFingerprints: [...LUNA_SUMMARY_LIVE_BATCH_FINGERPRINTS],
    prepareBatchFingerprints: [...LUNA_SUMMARY_APPROVED_BATCH_FINGERPRINTS],
    wire: { ...LUNA_SUMMARY_LIVE_WIRE_CONTRACT },
    plannedPosts: LUNA_SUMMARY_PLANNED_POSTS,
    maxAttempts: LUNA_SUMMARY_MAX_NETWORK_ATTEMPTS,
    liveApprovalStatus: LUNA_SUMMARY_LIVE_APPROVAL_STATUS,
    coupledApprovalManifest: LUNA_SUMMARY_LIVE_COUPLED_APPROVAL_MANIFEST,
  });
}

export function readLunaPrecallRepoSha(cwd: string): string | null {
  const result = spawnSync("git", ["rev-parse", "HEAD"], {
    cwd,
    encoding: "utf8",
  });
  if (result.status !== 0) return null;
  const sha = result.stdout.trim();
  return /^[a-f0-9]{40}$/.test(sha) ? sha : null;
}

export function probeLunaPrecallIsolatedDatabase(): {
  ok: boolean;
  installedThenUninstalled: boolean;
} {
  installIsolatedTestDatabase();
  try {
    assertIsolatedTestDatabaseActive();
    return { ok: true, installedThenUninstalled: true };
  } catch {
    return { ok: false, installedThenUninstalled: true };
  } finally {
    uninstallIsolatedTestDatabase();
  }
}

function journalFilePath(directory: string): string {
  return path.join(directory, `luna-summary-journal-${LUNA_SUMMARY_LIVE_EXECUTE_MANIFEST}.json`);
}

function cacheFilePath(directory: string): string {
  return path.join(directory, LUNA_SUMMARY_PRECALL_CACHE_FILENAME);
}

export function lunaPrecallJournalDurable(
  directory: string,
  hostKind: LunaPrecallHostKind
): boolean {
  if (hostKind === "cloud") return false;
  const resolved = path.resolve(directory);
  if (resolved === "/mnt/c" || resolved.startsWith(`/mnt/c${path.sep}`)) return false;
  return true;
}

function inspectExistingJournal(directory: string | null): {
  directoryExists: boolean;
  fileExists: boolean;
  reservedHistory: boolean;
  hasUnknownUnresolved: boolean;
  executed: boolean | null;
  networkAttempts: number | null;
} {
  if (!directory || !existsSync(directory)) {
    return {
      directoryExists: false,
      fileExists: false,
      reservedHistory: false,
      hasUnknownUnresolved: false,
      executed: null,
      networkAttempts: null,
    };
  }
  const file = journalFilePath(directory);
  if (!existsSync(file)) {
    return {
      directoryExists: true,
      fileExists: false,
      reservedHistory: false,
      hasUnknownUnresolved: false,
      executed: false,
      networkAttempts: 0,
    };
  }
  try {
    const parsed = JSON.parse(readFileSync(file, "utf8")) as LunaDurableJournal;
    if (!parsed || parsed.manifestFingerprint !== LUNA_SUMMARY_LIVE_EXECUTE_MANIFEST) {
      return {
        directoryExists: true,
        fileExists: true,
        reservedHistory: true,
        hasUnknownUnresolved: false,
        executed: null,
        networkAttempts: null,
      };
    }
    return {
      directoryExists: true,
      fileExists: true,
      reservedHistory: journalHasReservedHistory(parsed),
      hasUnknownUnresolved: parsed.entries.some((entry) => entry.status === "UNKNOWN_UNRESOLVED"),
      executed: parsed.executed,
      networkAttempts: parsed.networkAttempts,
    };
  } catch {
    return {
      directoryExists: true,
      fileExists: true,
      reservedHistory: true,
      hasUnknownUnresolved: false,
      executed: null,
      networkAttempts: null,
    };
  }
}

export function classifyLunaPrecallVerdict(input: {
  cloudAgent: boolean;
  executed: boolean | null;
  hasUnknownUnresolved: boolean;
  reservedHistory: boolean;
  blockers: string[];
}): { verdict: LunaPrecallVerdict; blocker: string | null } {
  if (input.cloudAgent) {
    return { verdict: "BLOCKED", blocker: "CLOUD_AGENT_WRONG_HOST" };
  }
  if (input.executed) {
    return { verdict: "ALREADY_EXECUTED", blocker: null };
  }
  if (input.hasUnknownUnresolved) {
    return { verdict: "UNRESOLVED_NO_RETRY", blocker: null };
  }
  if (input.reservedHistory) {
    return { verdict: "BLOCKED", blocker: "PRIOR_RESERVED_HISTORY" };
  }
  if (input.blockers.length > 0) {
    return { verdict: "BLOCKED", blocker: input.blockers[0] ?? "BLOCKED" };
  }
  return { verdict: "READY_FOR_APPROVAL", blocker: null };
}

export function formatLunaPrecallStdout(report: LunaSummaryPrecallReport): string {
  const cost = `spendCapPresent=false hardMaximumUsd=${report.hardMaximumUsd} plannedPosts=${report.plannedPosts} maxTokens=null`;
  switch (report.verdict) {
    case "BLOCKED":
      return `BLOCKED\n${report.blocker ?? "BLOCKED"}\n${cost}`;
    case "READY_FOR_APPROVAL":
    case "ALREADY_EXECUTED":
    case "UNRESOLVED_NO_RETRY":
      return `${report.verdict}\n${cost}`;
    default: {
      const exhaustive: never = report.verdict;
      return exhaustive;
    }
  }
}

async function defaultVerifyIdentity(): Promise<LunaPrecallIdentity> {
  const identity = await verifyLunaRequestIdentity();
  return {
    ok: identity.ok,
    reason: identity.reason,
    liveExecuteManifestFingerprint: identity.liveExecuteManifestFingerprint,
    liveSealFingerprints: [...identity.liveSealFingerprints],
    prepareFingerprints: [...identity.batchFingerprints],
    liveApprovalStatus: identity.liveApprovalStatus,
  };
}

function loadCache(input: {
  directory: string | null;
  repoSha: string | null;
  hostKind: LunaPrecallHostKind;
  nodeMinor: string;
  identityFingerprint: string;
}): PrecallCache | null {
  if (!input.directory || !input.repoSha || !existsSync(input.directory)) return null;
  const file = cacheFilePath(input.directory);
  if (!existsSync(file)) return null;
  try {
    const parsed = JSON.parse(readFileSync(file, "utf8")) as PrecallCache;
    if (
      parsed.version !== LUNA_SUMMARY_PRECALL_CACHE_VERSION ||
      parsed.repoSha !== input.repoSha ||
      parsed.hostKind !== input.hostKind ||
      parsed.nodeMinor !== input.nodeMinor ||
      parsed.identityFingerprint !== input.identityFingerprint ||
      !parsed.identity ||
      typeof parsed.identity.ok !== "boolean"
    ) {
      return null;
    }
    return parsed;
  } catch {
    return null;
  }
}

function writeCache(directory: string, cache: PrecallCache): void {
  if (!existsSync(directory)) return;
  writeFileSync(cacheFilePath(directory), `${JSON.stringify(cache)}\n`, "utf8");
}

export async function runLunaSummaryLocalPrecall(
  input: LunaSummaryPrecallInput = {}
): Promise<LunaSummaryPrecallReport> {
  const env = input.env ?? process.env;
  const cwd = input.cwd ?? process.cwd();
  const nodeVersion = input.nodeVersion ?? process.version;
  const host = (input.detectHost ?? (() => detectLunaPrecallHost({ env })))();
  const repoSha = (input.readRepoSha ?? readLunaPrecallRepoSha)(cwd);
  const nodeOk = lunaPrecallNodeOk(nodeVersion);
  const key = applyLunaExperimentKeyFromCursorSecret(env);
  const identityFingerprint = lunaSummaryPrecallIdentityFingerprint();

  const resolved = resolveLunaSummaryJournalDirectory({
    journalDirectory:
      input.journalDirectory ??
      env[LUNA_SUMMARY_JOURNAL_DIR_ENV] ??
      LUNA_SUMMARY_CANONICAL_JOURNAL_DIR,
    env,
  });
  const journalDirectory = resolved.ok ? resolved.directory : null;
  const journalReason = resolved.ok ? null : resolved.reason;
  const inspected = inspectExistingJournal(journalDirectory);
  const durable = journalDirectory ? lunaPrecallJournalDurable(journalDirectory, host.kind) : false;

  const cache = loadCache({
    directory: journalDirectory,
    repoSha,
    hostKind: host.kind,
    nodeMinor: nodeMinor(nodeVersion),
    identityFingerprint,
  });
  let identity: LunaPrecallIdentity;
  let identityReused = false;
  if (cache) {
    identity = cache.identity;
    identityReused = true;
  } else {
    identity = await (input.verifyIdentity ?? defaultVerifyIdentity)();
  }

  if (
    input.persistCache !== false &&
    !host.cloudAgent &&
    journalDirectory &&
    existsSync(journalDirectory) &&
    repoSha &&
    !identityReused
  ) {
    try {
      writeCache(journalDirectory, {
        version: LUNA_SUMMARY_PRECALL_CACHE_VERSION,
        repoSha,
        hostKind: host.kind,
        nodeMinor: nodeMinor(nodeVersion),
        identityFingerprint,
        identity,
      });
    } catch {
      // Cache is optional. Never create the journal directory to persist it.
    }
  }

  const isolated = (input.probeIsolatedDatabase ?? probeLunaPrecallIsolatedDatabase)();
  const blockers: string[] = [];
  if (host.cloudAgent) blockers.push("CLOUD_AGENT_WRONG_HOST");
  if (!host.wsl2) blockers.push("WSL2_REQUIRED");
  if (!nodeOk) blockers.push("NODE_VERSION");
  if (!repoSha) blockers.push("REPO_SHA_UNAVAILABLE");
  if (!resolved.ok) blockers.push(resolved.reason);
  if (resolved.ok && !inspected.directoryExists) blockers.push("JOURNAL_DIRECTORY_MISSING");
  if (!durable) blockers.push("JOURNAL_NOT_DURABLE");
  if (inspected.reservedHistory) blockers.push("PRIOR_RESERVED_HISTORY");
  if (!key.present) blockers.push("MISSING_EXPERIMENT_KEY");
  if (key.equalsProduction) blockers.push("PRODUCTION_KEY_FORBIDDEN");
  if (!isolated.ok) blockers.push("ISOLATED_TEST_DB_REQUIRED");
  if (!identity.ok) blockers.push(identity.reason ?? "REQUEST_IDENTITY_MISMATCH");

  const classified = classifyLunaPrecallVerdict({
    cloudAgent: host.cloudAgent,
    executed: inspected.executed,
    hasUnknownUnresolved: inspected.hasUnknownUnresolved,
    reservedHistory: inspected.reservedHistory,
    blockers,
  });
  const ready = classified.verdict === "READY_FOR_APPROVAL";

  return {
    command: "luna:precall",
    verdict: classified.verdict,
    blocker: classified.blocker,
    LIVE_PRECALL_READY: ready,
    cloudAgent: host.cloudAgent,
    cloudCannotVerifyWsl: host.cloudCannotVerifyWsl,
    cloudReport: host.cloudAgent ? LUNA_SUMMARY_CLOUD_CANNOT_VERIFY_WSL : null,
    hostKind: host.kind,
    wsl2: host.wsl2,
    repoSha,
    nodeVersion,
    nodeOk,
    journalDirectory,
    journalDirectoryOk: resolved.ok,
    journalDirectoryExists: inspected.directoryExists,
    journalFileExists: inspected.fileExists,
    journalDurable: durable,
    journalReason,
    journalReservedHistory: inspected.reservedHistory,
    journalHasUnknownUnresolved: inspected.hasUnknownUnresolved,
    journalExecuted: inspected.executed,
    journalNetworkAttempts: inspected.networkAttempts,
    createdJournal: false,
    deletedHistory: false,
    keyPresent: key.present,
    keyEqualsProduction: key.equalsProduction,
    keyMappedFromCursorSecret: key.mapped,
    keyEnvName: key.envName,
    isolatedDbOk: isolated.ok,
    isolatedDbInstalledThenUninstalled: isolated.installedThenUninstalled,
    identityOk: identity.ok,
    identityReused,
    identityReason: identity.reason,
    liveExecuteManifestFingerprint: identity.liveExecuteManifestFingerprint,
    liveSealFingerprints: identity.liveSealFingerprints,
    prepareFingerprints: identity.prepareFingerprints,
    liveApprovalStatus: identity.liveApprovalStatus,
    plannedPosts: LUNA_SUMMARY_PLANNED_POSTS,
    maximumNetworkAttempts: LUNA_SUMMARY_MAX_NETWORK_ATTEMPTS,
    maxTokens: null,
    hardMaximumUsd: LUNA_SUMMARY_HARD_MAXIMUM_USD,
    spendCapPresent: false,
    callCountCap: LUNA_SUMMARY_PLANNED_POSTS,
    identityFingerprint,
    cacheHit: identityReused,
    paidPosts: 0,
    networkPosts: 0,
    blockers,
  };
}
