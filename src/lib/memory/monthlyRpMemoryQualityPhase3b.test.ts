/**
 * #1486 Phase 3B — archival Path A packet. Provider POST 0 in CI.
 * Cursor does not score reply quality. The paid execute script must stay deleted.
 */
import assert from "node:assert/strict";
import { existsSync, readFileSync } from "node:fs";
import path from "node:path";
import { describe, it } from "node:test";

import { MAIN_RP_MODEL_IDS } from "@/lib/chatModels";
import {
  MONTHLY_RP_MEMORY_QUALITY_PHASE3A_PLAN_EVIDENCE,
  MONTHLY_RP_MEMORY_QUALITY_PHASE3B_SAMPLE_EVIDENCE,
  canClaimCurrentLiveProvider,
  canClaimCurrentProductionParity,
} from "@/lib/memory/memoryEvidenceProvenance";
import { PHASE3A_REUSED_PROBES } from "@/lib/memory/monthlyRpMemoryQualityPhase3aPlan";

const EVIDENCE_DIR = "docs/audits/monthly-rp-memory-quality-phase3b-2026-10-10";
const EXECUTE_SCRIPT = "scripts/monthly-rp-memory-quality-phase3b-execute.ts";

const EXPECTED_CASE_IDS = MAIN_RP_MODEL_IDS.flatMap((modelId) => [
  `phase3b_t6_${modelId}`,
  `phase3b_t50_${modelId}`,
]);

type Phase3bCase = {
  caseId: string;
  horizon: "t6" | "t50";
  modelId: string;
  wireModelId: string;
  ok: boolean;
  httpStatus: number;
  error: string | null;
  cursorQualityScore: null;
  retrievalSource: string;
  storedSummary: { construction: string };
  finalWire: { owner: string };
  generationPostIndex: number;
};

describe("#1486 Phase 3B Path A archival packet", () => {
  it("refuses a paid rerun and keeps the execute script deleted", () => {
    assert.equal(existsSync(EXECUTE_SCRIPT), false);
    assert.equal(MONTHLY_RP_MEMORY_QUALITY_PHASE3B_SAMPLE_EVIDENCE.rerunAuthorized, false);
    assert.equal(MONTHLY_RP_MEMORY_QUALITY_PHASE3B_SAMPLE_EVIDENCE.paidEvaluationApproved, false);
    assert.equal(MONTHLY_RP_MEMORY_QUALITY_PHASE3B_SAMPLE_EVIDENCE.providerPosts, 8);
    assert.equal(MONTHLY_RP_MEMORY_QUALITY_PHASE3B_SAMPLE_EVIDENCE.lunaPosts, 0);
    assert.equal(MONTHLY_RP_MEMORY_QUALITY_PHASE3B_SAMPLE_EVIDENCE.productionDbWrites, 0);
    assert.equal(MONTHLY_RP_MEMORY_QUALITY_PHASE3A_PLAN_EVIDENCE.paidEvaluationApproved, false);
    const packageJson = JSON.parse(readFileSync("package.json", "utf8")) as {
      scripts?: Record<string, string>;
    };
    assert.equal(
      Object.values(packageJson.scripts ?? {}).some((script) => script.includes("phase3b-execute")),
      false
    );
  });

  it("archives eight Path A cases with assemblePrimaryRpRequest final-wire and no Cursor scores", () => {
    const evidence = JSON.parse(
      readFileSync(path.join(EVIDENCE_DIR, "evidence.json"), "utf8")
    ) as {
      providerPosts: number;
      lunaPosts: number;
      productionDbWrites: number;
      path: string;
      cases: Phase3bCase[];
    };
    assert.equal(evidence.path, "A_SEEDED_MEMORY");
    assert.equal(evidence.providerPosts, 8);
    assert.equal(evidence.lunaPosts, 0);
    assert.equal(evidence.productionDbWrites, 0);
    assert.deepEqual(
      evidence.cases.map((row) => row.caseId),
      EXPECTED_CASE_IDS
    );
    assert.equal(evidence.cases.length, 8);
    for (const row of evidence.cases) {
      assert.equal(row.cursorQualityScore, null);
      assert.equal(row.retrievalSource, "ISOLATED_SEEDED_SQLITE");
      assert.equal(row.storedSummary.construction, "SEEDED_NOT_LUNA");
      assert.equal(row.finalWire.owner, "assemblePrimaryRpRequest");
      assert.ok(row.generationPostIndex >= 1 && row.generationPostIndex <= 8);
      assert.equal(existsSync(path.join(EVIDENCE_DIR, "final-wire", `${row.caseId}.json`)), true);
      assert.equal(existsSync(path.join(EVIDENCE_DIR, "responses", `${row.caseId}.txt`)), true);
    }
    const gemini = evidence.cases.filter((row) => row.modelId === "gemini-3.8-flash");
    assert.equal(gemini.length, 2);
    assert.equal(
      gemini.every((row) => row.ok === false && row.httpStatus === 401),
      true
    );
    assert.equal(
      gemini.every((row) => (row.error ?? "").includes("User not found")),
      true
    );
    assert.equal(
      gemini.every((row) => row.wireModelId === "google/gemini-3.8-flash"),
      true
    );
    const succeeded = evidence.cases.filter((row) => row.ok);
    assert.equal(succeeded.length, 6);
    assert.equal(
      canClaimCurrentLiveProvider(MONTHLY_RP_MEMORY_QUALITY_PHASE3B_SAMPLE_EVIDENCE.provenance),
      true
    );
    assert.equal(
      canClaimCurrentProductionParity({
        executionHost: MONTHLY_RP_MEMORY_QUALITY_PHASE3B_SAMPLE_EVIDENCE.executionHost,
        runtimeShaSource: MONTHLY_RP_MEMORY_QUALITY_PHASE3B_SAMPLE_EVIDENCE.runtimeShaSource,
        observedRuntimeSha: MONTHLY_RP_MEMORY_QUALITY_PHASE3B_SAMPLE_EVIDENCE.observedRuntimeSha,
        characterSheetRead: false,
        productionPersonaRead: false,
      }),
      false
    );
  });

  it("keeps Phase 3A A/B probes and does not treat this as Path B or production identity", () => {
    assert.match(PHASE3A_REUSED_PROBES.t6.factText, /우산/);
    assert.match(PHASE3A_REUSED_PROBES.t50.factText, /옥상에서 처음으로 담배를/);
    assert.equal(PHASE3A_REUSED_PROBES.t6.query, "그때 우산 같이 썼던 거 기억나?");
    assert.equal(PHASE3A_REUSED_PROBES.t50.query, "옥상에서 담배 피웠던 첫날 기억해?");
    assert.equal(MONTHLY_RP_MEMORY_QUALITY_PHASE3B_SAMPLE_EVIDENCE.identitySource, "FIXTURE_NOT_PRODUCTION_SHEET");
    assert.equal(existsSync("src/lib/memory/monthlyRpMemoryQualityPhase1.test.ts"), true);
    assert.equal(existsSync("src/lib/memory/monthlyRpMemoryQualityPhase2b.test.ts"), true);
    assert.equal(existsSync("src/lib/memory/monthlyRpMemoryQualityPhase3a.test.ts"), true);
    assert.equal(existsSync("docs/audits/monthly-rp-memory-quality-phase2c-2026-10-10/evidence.json"), true);
  });
});
