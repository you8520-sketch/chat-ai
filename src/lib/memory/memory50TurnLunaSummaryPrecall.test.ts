import Module from "module";

const originalLoad = (Module as unknown as { _load: typeof Module._load })._load;
(Module as unknown as { _load: typeof Module._load })._load = function (
  request: string,
  parent: NodeModule,
  isMain: boolean
) {
  if (request === "server-only") return {};
  return originalLoad(request, parent, isMain);
} as typeof Module._load;

import assert from "node:assert/strict";
import { existsSync, mkdtempSync, readdirSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { describe, it } from "node:test";
import {
  LUNA_SUMMARY_APPROVED_BATCH_FINGERPRINTS,
  LUNA_SUMMARY_EXPERIMENT_KEY_ENV,
} from "./memory50TurnLunaSummaryPrepare";
import {
  LUNA_SUMMARY_CANONICAL_JOURNAL_DIR,
  LUNA_SUMMARY_JOURNAL_DIR_ENV,
  LUNA_SUMMARY_LIVE_APPROVAL_STATUS,
  LUNA_SUMMARY_LIVE_BATCH_FINGERPRINTS,
  LUNA_SUMMARY_LIVE_EXECUTE_MANIFEST,
  type LunaDurableJournal,
  type LunaDurableJournalEntry,
} from "./memory50TurnLunaSummaryExecute";
import {
  LUNA_SUMMARY_CLOUD_CANNOT_VERIFY_WSL,
  LUNA_SUMMARY_CURSOR_SECRET_ENV,
  LUNA_SUMMARY_PRECALL_CACHE_FILENAME,
  applyLunaExperimentKeyFromCursorSecret,
  detectLunaPrecallHost,
  formatLunaPrecallStdout,
  lunaPrecallJournalDurable,
  lunaPrecallNodeOk,
  lunaSummaryPrecallIdentityFingerprint,
  probeLunaPrecallIsolatedDatabase,
  runLunaSummaryLocalPrecall,
  type LunaPrecallHost,
  type LunaPrecallIdentity,
} from "./memory50TurnLunaSummaryPrecall";

const EXPERIMENT = "luna-precall-experiment-only-not-production";
const SECRET_VALUE = "cursor-secret-must-not-appear-in-report-9f3c";
const REPO_SHA = "b864d7eb0123456789abcdef0123456789abcd01";

function wslHost(): LunaPrecallHost {
  return {
    kind: "wsl2",
    cloudAgent: false,
    wsl2: true,
    cloudCannotVerifyWsl: false,
  };
}

function cloudHost(): LunaPrecallHost {
  return {
    kind: "cloud",
    cloudAgent: true,
    wsl2: false,
    cloudCannotVerifyWsl: true,
  };
}

function okIdentity(): LunaPrecallIdentity {
  return {
    ok: true,
    reason: null,
    liveExecuteManifestFingerprint: LUNA_SUMMARY_LIVE_EXECUTE_MANIFEST,
    liveSealFingerprints: [...LUNA_SUMMARY_LIVE_BATCH_FINGERPRINTS],
    prepareFingerprints: [...LUNA_SUMMARY_APPROVED_BATCH_FINGERPRINTS],
    liveApprovalStatus: LUNA_SUMMARY_LIVE_APPROVAL_STATUS,
  };
}

function journalDir(): string {
  return mkdtempSync(path.join(tmpdir(), "luna-summary-journal-"));
}

function missingJournalDir(): string {
  return path.join(tmpdir(), `luna-summary-journal-missing-${process.pid}-${Date.now()}`);
}

function reservedEntry(): LunaDurableJournalEntry {
  return {
    batchIndex: 1,
    turnStart: 1,
    turnEnd: 5,
    requestKind: "background-memory-extract",
    requestFingerprint: LUNA_SUMMARY_LIVE_BATCH_FINGERPRINTS[0]!,
    status: "SETTLED",
    accepted: true,
    rejectedReason: null,
    rawSummaryFingerprint: null,
    storedSummaryFingerprint: null,
    promptTokens: 1,
    completionTokens: 1,
    billedUsd: null,
    settlementSource: "estimate_not_bill",
    providerRequestId: null,
    networkAttempts: 1,
  };
}

function reservedJournal(): LunaDurableJournal {
  return {
    manifestFingerprint: LUNA_SUMMARY_LIVE_EXECUTE_MANIFEST,
    requestIdentityFingerprint: LUNA_SUMMARY_LIVE_EXECUTE_MANIFEST,
    executed: false,
    networkAttempts: 1,
    entries: [reservedEntry()],
  };
}

async function runReady(overrides: Parameters<typeof runLunaSummaryLocalPrecall>[0] = {}) {
  const directory = overrides.journalDirectory ?? journalDir();
  return runLunaSummaryLocalPrecall({
    env: { [LUNA_SUMMARY_EXPERIMENT_KEY_ENV]: EXPERIMENT },
    journalDirectory: directory,
    nodeVersion: "v22.12.0",
    persistCache: false,
    detectHost: wslHost,
    readRepoSha: () => REPO_SHA,
    verifyIdentity: async () => okIdentity(),
    probeIsolatedDatabase: () => ({ ok: true, installedThenUninstalled: false }),
    ...overrides,
  });
}

describe("Luna local PRECALL one-command (provider-free)", () => {
  it("reports that Cloud Agent cannot verify Windows/WSL and stays not ready with 0 posts", async () => {
    const missing = missingJournalDir();
    const report = await runLunaSummaryLocalPrecall({
      env: { CURSOR_AGENT: "1", CLOUD_AGENT_INJECTED_SECRET_NAMES: LUNA_SUMMARY_CURSOR_SECRET_ENV },
      journalDirectory: missing,
      nodeVersion: "v22.12.0",
      persistCache: false,
      detectHost: cloudHost,
      readRepoSha: () => REPO_SHA,
      verifyIdentity: async () => okIdentity(),
      probeIsolatedDatabase: () => ({ ok: true, installedThenUninstalled: false }),
    });
    assert.equal(report.LIVE_PRECALL_READY, false);
    assert.equal(report.verdict, "BLOCKED");
    assert.equal(report.blocker, "CLOUD_AGENT_WRONG_HOST");
    assert.equal(report.cloudAgent, true);
    assert.equal(report.cloudCannotVerifyWsl, true);
    assert.equal(report.cloudReport, LUNA_SUMMARY_CLOUD_CANNOT_VERIFY_WSL);
    assert.equal(report.hostKind, "cloud");
    assert.equal(report.paidPosts, 0);
    assert.equal(report.networkPosts, 0);
    assert.equal(report.createdJournal, false);
    assert.equal(report.deletedHistory, false);
    assert.ok(report.blockers.includes("CLOUD_AGENT_WRONG_HOST"));
    assert.equal(existsSync(missing), false);

    const canonical = await runLunaSummaryLocalPrecall({
      env: { [LUNA_SUMMARY_EXPERIMENT_KEY_ENV]: EXPERIMENT },
      nodeVersion: "v22.12.0",
      persistCache: false,
      detectHost: cloudHost,
      readRepoSha: () => REPO_SHA,
      verifyIdentity: async () => okIdentity(),
      probeIsolatedDatabase: () => ({ ok: true, installedThenUninstalled: false }),
    });
    assert.equal(canonical.journalDirectory, LUNA_SUMMARY_CANONICAL_JOURNAL_DIR);
    assert.equal(canonical.LIVE_PRECALL_READY, false);
    assert.equal(canonical.verdict, "BLOCKED");
    assert.equal(canonical.blocker, "CLOUD_AGENT_WRONG_HOST");
    assert.equal(canonical.paidPosts, 0);
    assert.equal(canonical.createdJournal, false);
    assert.notEqual(canonical.journalDirectory, missing);
    assert.equal(LUNA_SUMMARY_JOURNAL_DIR_ENV, "MEMORY_LUNA_SUMMARY_JOURNAL_DIR");

    const cloudDir = journalDir();
    const cloudCached = await runLunaSummaryLocalPrecall({
      env: { [LUNA_SUMMARY_EXPERIMENT_KEY_ENV]: EXPERIMENT },
      journalDirectory: cloudDir,
      nodeVersion: "v22.12.0",
      persistCache: true,
      detectHost: cloudHost,
      readRepoSha: () => REPO_SHA,
      verifyIdentity: async () => okIdentity(),
      probeIsolatedDatabase: () => ({ ok: true, installedThenUninstalled: false }),
    });
    assert.equal(cloudCached.LIVE_PRECALL_READY, false);
    assert.equal(existsSync(path.join(cloudDir, LUNA_SUMMARY_PRECALL_CACHE_FILENAME)), false);
  });

  it("detects Cloud from the live host markers without treating this VM as WSL", () => {
    const host = detectLunaPrecallHost({
      env: { CURSOR_AGENT: "1" },
      platform: "linux",
      pathExists: (target) => target === "/cursor/stores/self",
    });
    assert.deepEqual(host, {
      kind: "cloud",
      cloudAgent: true,
      wsl2: false,
      cloudCannotVerifyWsl: true,
    });
    const wsl = detectLunaPrecallHost({
      env: { WSL_DISTRO_NAME: "Ubuntu" },
      platform: "linux",
      pathExists: () => false,
    });
    assert.equal(wsl.kind, "wsl2");
    assert.equal(wsl.cloudCannotVerifyWsl, false);
  });

  it("does not create a journal directory or journal file when the store is missing", async () => {
    const missing = missingJournalDir();
    const report = await runReady({
      journalDirectory: missing,
      persistCache: true,
    });
    assert.equal(report.LIVE_PRECALL_READY, false);
    assert.equal(report.verdict, "BLOCKED");
    assert.equal(report.blocker, "JOURNAL_DIRECTORY_MISSING");
    assert.equal(report.journalDirectoryExists, false);
    assert.equal(report.createdJournal, false);
    assert.equal(existsSync(missing), false);
    assert.ok(report.blockers.includes("JOURNAL_DIRECTORY_MISSING"));
  });

  it("does not delete reserved journal history and stays not ready", async () => {
    const directory = journalDir();
    const journalPath = path.join(
      directory,
      `luna-summary-journal-${LUNA_SUMMARY_LIVE_EXECUTE_MANIFEST}.json`
    );
    const before = `${JSON.stringify(reservedJournal(), null, 2)}\n`;
    writeFileSync(journalPath, before, "utf8");
    const report = await runReady({
      journalDirectory: directory,
      persistCache: false,
    });
    assert.equal(report.LIVE_PRECALL_READY, false);
    assert.equal(report.verdict, "BLOCKED");
    assert.equal(report.blocker, "PRIOR_RESERVED_HISTORY");
    assert.equal(report.journalReservedHistory, true);
    assert.equal(report.journalFileExists, true);
    assert.equal(report.deletedHistory, false);
    assert.equal(report.createdJournal, false);
    assert.equal(readFileSync(journalPath, "utf8"), before);
    assert.ok(report.blockers.includes("PRIOR_RESERVED_HISTORY"));
    assert.deepEqual(
      readdirSync(directory).filter((name) => name.startsWith("luna-summary-journal-")),
      [`luna-summary-journal-${LUNA_SUMMARY_LIVE_EXECUTE_MANIFEST}.json`]
    );
  });

  it("reuses the cached identity for the same SHA and host, and re-verifies when cost identity changes", async () => {
    const directory = journalDir();
    let verifyCalls = 0;
    const verifyIdentity = async () => {
      verifyCalls += 1;
      return okIdentity();
    };
    const first = await runReady({
      journalDirectory: directory,
      persistCache: true,
      verifyIdentity,
    });
    assert.equal(first.cacheHit, false);
    assert.equal(first.identityReused, false);
    assert.equal(verifyCalls, 1);
    assert.equal(existsSync(path.join(directory, LUNA_SUMMARY_PRECALL_CACHE_FILENAME)), true);

    const second = await runReady({
      journalDirectory: directory,
      persistCache: true,
      verifyIdentity,
    });
    assert.equal(second.LIVE_PRECALL_READY, true);
    assert.equal(second.verdict, "READY_FOR_APPROVAL");
    assert.equal(second.cacheHit, true);
    assert.equal(second.identityReused, true);
    assert.equal(verifyCalls, 1);
    assert.equal(second.liveExecuteManifestFingerprint, LUNA_SUMMARY_LIVE_EXECUTE_MANIFEST);

    const cachePath = path.join(directory, LUNA_SUMMARY_PRECALL_CACHE_FILENAME);
    const cached = JSON.parse(readFileSync(cachePath, "utf8")) as {
      identityFingerprint: string;
    };
    writeFileSync(
      cachePath,
      `${JSON.stringify({
        ...JSON.parse(readFileSync(cachePath, "utf8")),
        identityFingerprint: "0".repeat(64),
      })}\n`,
      "utf8"
    );
    assert.notEqual(cached.identityFingerprint, "0".repeat(64));
    const third = await runReady({
      journalDirectory: directory,
      persistCache: true,
      verifyIdentity,
    });
    assert.equal(third.cacheHit, false);
    assert.equal(verifyCalls, 2);
  });

  it("maps the Cursor secret name in-process without leaking the value", async () => {
    const mappedEnv: NodeJS.ProcessEnv = { [LUNA_SUMMARY_CURSOR_SECRET_ENV]: SECRET_VALUE };
    const mapped = applyLunaExperimentKeyFromCursorSecret(mappedEnv);
    assert.equal(mapped.mapped, true);
    assert.equal(mapped.present, true);
    assert.equal(mapped.equalsProduction, false);
    assert.equal(mappedEnv[LUNA_SUMMARY_EXPERIMENT_KEY_ENV], SECRET_VALUE);

    const reportEnv: NodeJS.ProcessEnv = { [LUNA_SUMMARY_CURSOR_SECRET_ENV]: SECRET_VALUE };
    const report = await runReady({
      env: reportEnv,
    });
    assert.equal(report.keyPresent, true);
    assert.equal(report.keyMappedFromCursorSecret, true);
    assert.equal(report.keyEnvName, LUNA_SUMMARY_EXPERIMENT_KEY_ENV);
    const serialized = JSON.stringify(report);
    assert.equal(serialized.includes(SECRET_VALUE), false);
    assert.equal(serialized.includes("cursor-secret-must-not-appear"), false);
  });

  it("rejects a production-key collision without printing the key", async () => {
    const env: NodeJS.ProcessEnv = {
      [LUNA_SUMMARY_EXPERIMENT_KEY_ENV]: SECRET_VALUE,
      CHEAPER_INFERENCE_API_KEY: SECRET_VALUE,
    };
    const report = await runReady({ env });
    assert.equal(report.LIVE_PRECALL_READY, false);
    assert.equal(report.verdict, "BLOCKED");
    assert.equal(report.blocker, "PRODUCTION_KEY_FORBIDDEN");
    assert.equal(report.keyEqualsProduction, true);
    assert.equal(report.paidPosts, 0);
    assert.ok(report.blockers.includes("PRODUCTION_KEY_FORBIDDEN"));
    assert.equal(JSON.stringify(report).includes(SECRET_VALUE), false);
  });

  it("probes isolated DB through the existing helper and restores DATA_DIR", async () => {
    const previous = process.env.DATA_DIR;
    const probe = probeLunaPrecallIsolatedDatabase();
    assert.equal(probe.ok, true);
    assert.equal(probe.installedThenUninstalled, true);
    assert.equal(process.env.DATA_DIR, previous);
    const report = await runReady({
      probeIsolatedDatabase: probeLunaPrecallIsolatedDatabase,
    });
    assert.equal(report.isolatedDbOk, true);
    assert.equal(report.isolatedDbInstalledThenUninstalled, true);
    assert.equal(process.env.DATA_DIR, previous);
    assert.equal(report.paidPosts, 0);
  });

  it("is ready on WSL2 with journal, key, isolated DB, and live identity pins", async () => {
    const directory = journalDir();
    const report = await runReady({ journalDirectory: directory });
    assert.equal(report.LIVE_PRECALL_READY, true);
    assert.equal(report.verdict, "READY_FOR_APPROVAL");
    assert.equal(report.blocker, null);
    assert.equal(report.command, "luna:precall");
    assert.equal(report.hostKind, "wsl2");
    assert.equal(report.nodeOk, true);
    assert.equal(report.repoSha, REPO_SHA);
    assert.equal(report.journalDirectoryOk, true);
    assert.equal(report.journalDirectoryExists, true);
    assert.equal(report.journalDurable, true);
    assert.equal(report.keyPresent, true);
    assert.equal(report.isolatedDbOk, true);
    assert.equal(report.identityOk, true);
    assert.equal(report.liveApprovalStatus, "APPROVED");
    assert.equal(report.liveExecuteManifestFingerprint, LUNA_SUMMARY_LIVE_EXECUTE_MANIFEST);
    assert.deepEqual(report.liveSealFingerprints, [...LUNA_SUMMARY_LIVE_BATCH_FINGERPRINTS]);
    assert.equal(report.plannedPosts, 10);
    assert.equal(report.maximumNetworkAttempts, 10);
    assert.equal(report.maxTokens, null);
    assert.equal(report.hardMaximumUsd, "UNBOUNDED_WITHOUT_REQUEST_MAX_TOKENS");
    assert.equal(report.spendCapPresent, false);
    assert.equal(report.paidPosts, 0);
    assert.equal(report.networkPosts, 0);
    assert.equal(report.identityFingerprint, lunaSummaryPrecallIdentityFingerprint());
    const source = readFileSync(new URL("./memory50TurnLunaSummaryPrecall.ts", import.meta.url), "utf8");
    assert.equal(source.includes("runAuthorizedLunaSummaryExperiment"), false);
    assert.equal(source.includes("createLunaDurableJournalStore"), false);
    assert.ok(lunaPrecallNodeOk("v22.12.0"));
    assert.equal(lunaPrecallNodeOk("v20.19.0"), false);
    assert.equal(LUNA_SUMMARY_CANONICAL_JOURNAL_DIR.endsWith("luna-summary-journal-v1"), true);
  });

  it("does not treat a Cloud or /mnt/c journal path as durable", () => {
    assert.equal(lunaPrecallJournalDurable(LUNA_SUMMARY_CANONICAL_JOURNAL_DIR, "wsl2"), true);
    assert.equal(lunaPrecallJournalDurable(LUNA_SUMMARY_CANONICAL_JOURNAL_DIR, "cloud"), false);
    assert.equal(lunaPrecallJournalDurable("/mnt/c/Users/ray/luna-summary-journal-v1", "wsl2"), false);
  });

  it("prints ALREADY_EXECUTED and UNRESOLVED_NO_RETRY without rewriting journal history", async () => {
    const executedDir = journalDir();
    const executedPath = path.join(
      executedDir,
      `luna-summary-journal-${LUNA_SUMMARY_LIVE_EXECUTE_MANIFEST}.json`
    );
    const executed = reservedJournal();
    executed.executed = true;
    writeFileSync(executedPath, `${JSON.stringify(executed)}\n`, "utf8");
    const executedReport = await runReady({ journalDirectory: executedDir });
    assert.equal(executedReport.verdict, "ALREADY_EXECUTED");
    assert.equal(executedReport.LIVE_PRECALL_READY, false);
    assert.equal(executedReport.paidPosts, 0);
    assert.equal(JSON.parse(readFileSync(executedPath, "utf8")).executed, true);
    assert.match(formatLunaPrecallStdout(executedReport), /^ALREADY_EXECUTED\n/);

    const unknownDir = journalDir();
    const unknownPath = path.join(
      unknownDir,
      `luna-summary-journal-${LUNA_SUMMARY_LIVE_EXECUTE_MANIFEST}.json`
    );
    const unknown = reservedJournal();
    unknown.entries[0] = { ...unknown.entries[0]!, status: "UNKNOWN_UNRESOLVED" };
    writeFileSync(unknownPath, `${JSON.stringify(unknown)}\n`, "utf8");
    const unknownReport = await runReady({ journalDirectory: unknownDir });
    assert.equal(unknownReport.verdict, "UNRESOLVED_NO_RETRY");
    assert.equal(unknownReport.journalHasUnknownUnresolved, true);
    assert.equal(unknownReport.deletedHistory, false);
    assert.equal(JSON.parse(readFileSync(unknownPath, "utf8")).entries[0].status, "UNKNOWN_UNRESOLVED");
    assert.match(formatLunaPrecallStdout(unknownReport), /^UNRESOLVED_NO_RETRY\n/);
  });
});
