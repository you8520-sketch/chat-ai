/**
 * In-process sealed-pack owner for the live operator CLI.
 * Reads canonical production rows with the existing PRECALL loader, assembles
 * through preparePaidRunnerPack, and never writes request bodies to disk.
 */
import { isFullGitSha, validateLiveProof } from "@/lib/rpQualityPrecall";
import type { PaidRunnerDenialReason } from "@/lib/rpQualityPaidRunner";
import { PrecallRowsStop, loadPrecallProductionRows } from "./rpQualityPrecallProductionRows";
import {
  paidRunnerIdentityHashesMatchProof,
  preparePaidRunnerPack,
  type PaidRunnerPreparedPack,
} from "./rpQualityPaidRunnerPrepare";
import { resolveCanonicalProductionDbPath } from "./rpQualityPaidRunnerCanonicalDb";
import { observePaidRunnerRuntimeSha } from "./rpQualityPaidRunnerRuntimeSha";

export { observePaidRunnerRuntimeSha, resolveCanonicalProductionDbPath };

export function loadInProcessPaidRunnerPack(input: {
  runtimeSha: string;
  expectedProductionSha: string;
  originalDataDir: string;
  env: NodeJS.ProcessEnv;
}):
  | { ok: true; pack: PaidRunnerPreparedPack }
  | { ok: false; reason: PaidRunnerDenialReason } {
  if (!isFullGitSha(input.runtimeSha)) {
    return { ok: false, reason: "RUNTIME_SHA_UNAVAILABLE" };
  }
  if (!isFullGitSha(input.expectedProductionSha)) {
    return { ok: false, reason: "RUNTIME_SHA_MISMATCH" };
  }
  if (input.runtimeSha.toLowerCase() !== input.expectedProductionSha.trim().toLowerCase()) {
    return { ok: false, reason: "RUNTIME_SHA_MISMATCH" };
  }
  const dbPath = resolveCanonicalProductionDbPath(input.originalDataDir);
  if (!dbPath) {
    return { ok: false, reason: "SEAL_VALIDATION_FAILED" };
  }
  try {
    const loaded = loadPrecallProductionRows({
      dbPath,
      deployedGitSha: input.runtimeSha,
      env: input.env,
    });
    const proof = validateLiveProof(loaded.proof, { expectedDeploySha: input.runtimeSha });
    if (proof.status !== "VERIFIED") {
      return { ok: false, reason: "RUNTIME_SHA_MISMATCH" };
    }
    const pack = preparePaidRunnerPack({
      rows: loaded.rows,
      mainSha: input.runtimeSha,
      productionDeploySha: loaded.proof.deployedGitSha,
    });
    const identityOk = paidRunnerIdentityHashesMatchProof(pack.manifest.identityHashes, {
      greetingSha256: loaded.proof.greetingSha256,
      systemPromptSha256: loaded.proof.systemPromptSha256,
      worldSha256: loaded.proof.worldSha256,
      settingChunksSha256: loaded.proof.settingChunksSha256,
      personaPublicSha256: loaded.proof.personaPublicSha256,
    });
    if (!identityOk) {
      return { ok: false, reason: "IDENTITY_HASH_MISMATCH" };
    }
    if (pack.manifest.productionDeploySha !== input.runtimeSha) {
      return { ok: false, reason: "RUNTIME_SHA_MISMATCH" };
    }
    return { ok: true, pack };
  } catch (error) {
    if (error instanceof PrecallRowsStop) {
      if (
        error.code === "CHARACTER_IDENTITY_MISMATCH" ||
        error.code === "CHARACTER_ROW_COUNT_INVALID" ||
        error.code === "PERSONA_COUNT_INVALID" ||
        error.code === "ADMIN_IDENTITY_AMBIGUOUS"
      ) {
        return { ok: false, reason: "IDENTITY_HASH_MISMATCH" };
      }
      return { ok: false, reason: "SEAL_VALIDATION_FAILED" };
    }
    return { ok: false, reason: "SEAL_VALIDATION_FAILED" };
  }
}
