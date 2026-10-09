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

import { mkdirSync, writeFileSync } from "node:fs";
import {
  installIsolatedTestDatabase,
  uninstallIsolatedTestDatabase,
} from "../src/lib/test/isolatedTestDatabase.ts";
import { LUNA_SUMMARY_EXPERIMENT_KEY_ENV } from "../src/lib/memory/memory50TurnLunaSummaryPrepare.ts";
import {
  LUNA_SUMMARY_CANONICAL_JOURNAL_DIR,
  LUNA_SUMMARY_JOURNAL_DIR_ENV,
  lunaExecuteExperimentKeyPresent,
  resolveLunaSummaryJournalDirectory,
  runAuthorizedLunaSummaryExperiment,
  verifyLunaRequestIdentity,
} from "../src/lib/memory/memory50TurnLunaSummaryExecute.ts";

async function main(): Promise<void> {
  const identity = await verifyLunaRequestIdentity();
  const key = lunaExecuteExperimentKeyPresent();
  const journalDir = resolveLunaSummaryJournalDirectory({
    journalDirectory: process.env[LUNA_SUMMARY_JOURNAL_DIR_ENV] ?? LUNA_SUMMARY_CANONICAL_JOURNAL_DIR,
    env: process.env,
  });
  if (!journalDir.ok) {
    const report = {
      paidPosts: 0,
      networkPosts: 0,
      executed: false,
      abortReason: journalDir.reason,
      keyPresent: key.present,
      keyEqualsProduction: key.equalsProduction,
      identityOk: identity.ok,
      liveApprovalStatus: identity.liveApprovalStatus,
      liveExecuteManifestFingerprint: identity.liveExecuteManifestFingerprint,
      liveSealFingerprints: identity.liveSealFingerprints,
    };
    mkdirSync("/opt/cursor/artifacts", { recursive: true });
    writeFileSync(
      "/opt/cursor/artifacts/memory_50turn_luna_summary_execute_stop.json",
      `${JSON.stringify(report, null, 2)}\n`,
      "utf8"
    );
    console.log(JSON.stringify(report, null, 2));
    return;
  }
  installIsolatedTestDatabase();
  try {
    const result = await runAuthorizedLunaSummaryExperiment({
      userCostApproved: true,
      experimentKey: process.env[LUNA_SUMMARY_EXPERIMENT_KEY_ENV] ?? null,
      env: process.env,
      journalDirectory: journalDir.directory,
      allowRealNetwork: true,
    });
    const report = {
      paidPosts: result.paidPosts,
      networkPosts: result.networkPosts,
      executed: result.executed,
      abortReason: result.abortReason,
      keyPresent: key.present,
      keyEqualsProduction: key.equalsProduction,
      identityOk: identity.ok,
      prepareCaptureUnchanged: identity.shaOnlyDifference.requestPayloadUnchanged,
      liveSealMatchesPrepareCapture: identity.liveSealMatchesPrepareCapture,
      liveSealMatchesLivePins: identity.liveSealMatchesLivePins,
      liveApprovalStatus: identity.liveApprovalStatus,
      liveExecuteManifestFingerprint: identity.liveExecuteManifestFingerprint,
      liveSealFingerprints: identity.liveSealFingerprints,
      prepareFingerprints: identity.batchFingerprints,
      journalDirectory: journalDir.directory,
      sealedRounds: result.sealedRounds,
      frontier: result.frontier,
    };
    mkdirSync("/opt/cursor/artifacts", { recursive: true });
    writeFileSync(
      "/opt/cursor/artifacts/memory_50turn_luna_summary_execute_stop.json",
      `${JSON.stringify(report, null, 2)}\n`,
      "utf8"
    );
    console.log(JSON.stringify(report, null, 2));
  } finally {
    uninstallIsolatedTestDatabase();
  }
}

void main();
