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
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import {
  installIsolatedTestDatabase,
  uninstallIsolatedTestDatabase,
} from "../src/lib/test/isolatedTestDatabase.ts";
import { LUNA_SUMMARY_EXPERIMENT_KEY_ENV } from "../src/lib/memory/memory50TurnLunaSummaryPrepare.ts";
import {
  lunaExecuteExperimentKeyPresent,
  runAuthorizedLunaSummaryExperiment,
  verifyLunaRequestIdentity,
} from "../src/lib/memory/memory50TurnLunaSummaryExecute.ts";

async function main(): Promise<void> {
  const identity = await verifyLunaRequestIdentity();
  const key = lunaExecuteExperimentKeyPresent();
  installIsolatedTestDatabase();
  try {
    const result = await runAuthorizedLunaSummaryExperiment({
      userCostApproved: true,
      experimentKey: process.env[LUNA_SUMMARY_EXPERIMENT_KEY_ENV] ?? null,
      env: process.env,
      journalDirectory: mkdtempSync(path.join(tmpdir(), "luna-attempt-")),
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
      liveSealFingerprints: identity.liveSealFingerprints,
      prepareFingerprints: identity.batchFingerprints,
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
