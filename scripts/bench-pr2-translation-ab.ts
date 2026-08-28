#!/usr/bin/env npx tsx
/**
 * PR-2 translation A/B harness — Luna vs DeepSeek V4 Flash.
 * Requires RUN_REAL_TRANSLATION_AB=1 and CHEAPER_INFERENCE_API_KEY.
 * Does NOT change production defaults.
 */
import Module from "module";

const originalLoad = Module._load;
Module._load = function (request, parent, isMain) {
  if (request === "server-only") return {};
  return originalLoad.call(this, request, parent, isMain);
} as typeof Module._load;

import { execSync } from "node:child_process";
import {
  DEFAULT_OUT_DIR,
  auditTranslationPlan,
  buildFixtures,
  printAuditReport,
  runTranslationAbBenchmark,
  validateF12SourceChars,
} from "./lib/pr2TranslationAbHarness";

async function main() {
  validateF12SourceChars();
  const fixtures = await buildFixtures();

  const f12Fixture = fixtures.find((fixture) => fixture.id === "F12");
  if (!f12Fixture || f12Fixture.chunks.length <= 1) {
    throw new Error("F12 must produce more than one production CharacterChunk");
  }

  const promptTranslation = await import("@/lib/promptTranslation");
  const audit = await auditTranslationPlan(fixtures);
  printAuditReport(audit, promptTranslation);

  if (audit.oversizedBatchCount > 0) {
    console.log("AB_STATUS=BLOCKED_PRODUCTION_BATCH_INVARIANT");
    for (const batch of audit.oversizedBatches) {
      console.error(
        `oversized batch fixture=${batch.fixtureId} index=${batch.batchIndex} chars=${batch.sourceChars} chunks=${JSON.stringify(batch.chunks)}`
      );
    }
    process.exit(1);
  }

  if (!audit.requestBudgetLe40) {
    console.log("AB_STATUS=BLOCKED_REQUEST_BUDGET");
    process.exit(1);
  }

  if (process.env.RUN_REAL_TRANSLATION_AB !== "1") {
    console.log("AB_STATUS=NOT_RUN — set RUN_REAL_TRANSLATION_AB=1 to execute");
    console.log("provider calls=0");
    process.exit(0);
  }
  if (!process.env.CHEAPER_INFERENCE_API_KEY?.trim()) {
    console.log("AB_STATUS=NOT_RUN — missing CHEAPER_INFERENCE_API_KEY");
    console.log("provider calls=0");
    process.exit(0);
  }

  const { CHEAPER_INFERENCE_DEEPSEEK_V4_FLASH_MODEL, CHEAPER_INFERENCE_GPT_56_LUNA_MODEL } =
    await import("@/lib/chatModels");
  const { callPromptTranslation } = await import("@/lib/ai");

  const harnessHead = execSync("git rev-parse HEAD", { encoding: "utf8" }).trim();

  const result = await runTranslationAbBenchmark({
    outDir: DEFAULT_OUT_DIR,
    fixtures,
    audit,
    lunaModel: CHEAPER_INFERENCE_GPT_56_LUNA_MODEL,
    flashModel: CHEAPER_INFERENCE_DEEPSEEK_V4_FLASH_MODEL,
    callPromptTranslation,
    promptTranslation,
    harnessHead,
  });

  console.log("AB_PER_FIXTURE_MODEL_MAP_TEST=PASS");

  if (result.attemptedProviderRequestCount !== audit.plannedProviderRequestCount) {
    console.warn(
      `ACTUAL_PROVIDER_REQUEST_COUNT=${result.attemptedProviderRequestCount} differs from PLANNED_PROVIDER_REQUEST_COUNT=${audit.plannedProviderRequestCount}`
    );
  } else {
    console.log(`ACTUAL_PROVIDER_REQUEST_COUNT=${result.attemptedProviderRequestCount}`);
  }

  console.log(
    `fixture_count=${result.fixtureCount} logical_chunk_count=${result.logicalChunkCount} batch_count=${result.batchCount} attempted_provider_request_count=${result.attemptedProviderRequestCount} successful_provider_request_count=${result.successfulProviderRequestCount} failed_provider_request_count=${result.failedProviderRequestCount}`
  );
  console.log("AB_STATUS=RUN complete");
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
