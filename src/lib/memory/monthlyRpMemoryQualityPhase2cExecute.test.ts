/**
 * #1486 Phase 2C — provider-free gates for the one-shot Luna execute harness.
 */
import assert from "node:assert/strict";
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { describe, it } from "node:test";

import { CHEAPER_INFERENCE_GPT_6_LUNA_MODEL } from "@/lib/chatModels";
import { PHASE2B_TURNS } from "@/lib/memory/monthlyRpMemoryQualityPhase2bFixture";
import {
  MONTHLY_RP_MEMORY_QUALITY_PHASE2C_PLAN,
  PHASE2C_CASE_ID,
  PHASE2C_RAILWAY_SUCCESS_SHA,
  assertPhase2cPreconditions,
  claimPhase2cLiveProvenance,
  readPhase2cLock,
  resolvePhase2cModel,
  writePhase2cLock,
} from "@/lib/memory/monthlyRpMemoryQualityPhase2cExecute";
import { canClaimCurrentLiveProvider } from "@/lib/memory/memoryEvidenceProvenance";

describe("#1486 Phase 2C execute gates", () => {
  it("plans one approved 라이크 18 / 렌 case and keeps Luna as the only model", () => {
    assert.equal(MONTHLY_RP_MEMORY_QUALITY_PHASE2C_PLAN.maxCases, 1);
    assert.equal(MONTHLY_RP_MEMORY_QUALITY_PHASE2C_PLAN.maxAttemptsPerCase, 3);
    assert.equal(MONTHLY_RP_MEMORY_QUALITY_PHASE2C_PLAN.paidEvaluationApproved, true);
    assert.equal(MONTHLY_RP_MEMORY_QUALITY_PHASE2C_PLAN.characterId, 18);
    assert.equal(MONTHLY_RP_MEMORY_QUALITY_PHASE2C_PLAN.expectedModel, CHEAPER_INFERENCE_GPT_6_LUNA_MODEL);
    assert.equal(PHASE2B_TURNS.length, 5);
    assert.equal(resolvePhase2cModel({}), CHEAPER_INFERENCE_GPT_6_LUNA_MODEL);
    assert.equal(resolvePhase2cModel({ BACKGROUND_MEMORY_MODEL: "gpt-5.6-luna" }), CHEAPER_INFERENCE_GPT_6_LUNA_MODEL);
  });

  it("stops when the resolved background model is not Luna", () => {
    const result = assertPhase2cPreconditions({
      env: {
        BACKGROUND_MEMORY_MODEL: "claude-opus-5",
        CHEAPER_INFERENCE_API_KEY: "ci_test",
      } as NodeJS.ProcessEnv,
      lockFile: path.join(mkdtempSync(path.join(tmpdir(), "phase2c-")), "missing.lock.json"),
    });
    assert.equal(result.ok, false);
    if (!result.ok) assert.equal(result.reason, "MODEL_NOT_LUNA");
  });

  it("stops without a Cheaper Inference key and does not invent a substitute", () => {
    const result = assertPhase2cPreconditions({
      env: { BACKGROUND_MEMORY_MODEL: "" } as NodeJS.ProcessEnv,
      lockFile: path.join(mkdtempSync(path.join(tmpdir(), "phase2c-")), "missing.lock.json"),
    });
    assert.equal(result.ok, false);
    if (!result.ok) assert.equal(result.reason, "NO_CHEAPER_INFERENCE_KEY");
  });

  it("refuses a second execute after the lock is completed", () => {
    const lockFile = path.join(mkdtempSync(path.join(tmpdir(), "phase2c-")), "execute.lock.json");
    writePhase2cLock(
      {
        caseId: PHASE2C_CASE_ID,
        status: "completed",
        startedAt: "2026-10-10T00:00:00.000Z",
        finishedAt: "2026-10-10T00:01:00.000Z",
      },
      lockFile
    );
    const result = assertPhase2cPreconditions({
      env: {
        BACKGROUND_MEMORY_MODEL: "gpt-6-luna",
        CHEAPER_INFERENCE_API_KEY: "ci_test",
      } as NodeJS.ProcessEnv,
      lockFile,
    });
    assert.equal(result.ok, false);
    if (!result.ok) assert.equal(result.reason, "ALREADY_EXECUTED");
    assert.equal(readPhase2cLock(lockFile)?.status, "completed");
  });

  it("claims CURRENT_LIVE_PROVIDER only with a real Luna provider text", () => {
    assert.equal(
      claimPhase2cLiveProvenance({
        providerPosts: 1,
        resolvedModel: "gpt-6-luna",
        providerText: "저녁 일곱 시 옥상에서 렌이 라이터를 건넴.",
        railwaySuccessSha: PHASE2C_RAILWAY_SUCCESS_SHA,
        responseModelId: "gpt-6-luna",
      }),
      "CURRENT_LIVE_PROVIDER"
    );
    assert.equal(
      canClaimCurrentLiveProvider(
        claimPhase2cLiveProvenance({
          providerPosts: 0,
          resolvedModel: "gpt-6-luna",
          providerText: "canned",
          railwaySuccessSha: PHASE2C_RAILWAY_SUCCESS_SHA,
        })
      ),
      false
    );
  });
});
