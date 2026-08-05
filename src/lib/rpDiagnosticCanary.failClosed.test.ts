/**
 * Fail-closed RP diagnostic canary scope tests (§4).
 * Run: node --conditions=react-server --import tsx --test src/lib/rpDiagnosticCanary.failClosed.test.ts
 */
import assert from "node:assert/strict";
import { describe, it, beforeEach, afterEach } from "node:test";
import {
  RP_DIAGNOSTIC_CANARY_ENV,
  resolveRpDiagnosticCanary,
} from "@/lib/rpDiagnosticCanary";

const ENV_KEYS = [
  RP_DIAGNOSTIC_CANARY_ENV.ENABLED,
  RP_DIAGNOSTIC_CANARY_ENV.USER_IDS,
  RP_DIAGNOSTIC_CANARY_ENV.MODEL_IDS,
  RP_DIAGNOSTIC_CANARY_ENV.VARIANT,
  RP_DIAGNOSTIC_CANARY_ENV.DEBUG,
] as const;

function saveEnv(): Record<string, string | undefined> {
  const out: Record<string, string | undefined> = {};
  for (const k of ENV_KEYS) out[k] = process.env[k];
  return out;
}

function restoreEnv(saved: Record<string, string | undefined>) {
  for (const k of ENV_KEYS) {
    if (saved[k] === undefined) delete process.env[k];
    else process.env[k] = saved[k];
  }
}

function enableCanary(variant = "ds_pipeline_baseline") {
  process.env[RP_DIAGNOSTIC_CANARY_ENV.ENABLED] = "true";
  process.env[RP_DIAGNOSTIC_CANARY_ENV.USER_IDS] = "34";
  process.env[RP_DIAGNOSTIC_CANARY_ENV.MODEL_IDS] = "deepseek-v4-pro";
  process.env[RP_DIAGNOSTIC_CANARY_ENV.VARIANT] = variant;
}

describe("RP diagnostic canary fail-closed scope", () => {
  let saved: Record<string, string | undefined>;

  beforeEach(() => {
    saved = saveEnv();
  });

  afterEach(() => {
    restoreEnv(saved);
  });

  it("user 34 + deepseek-v4-pro + single_primary → canary applies", () => {
    enableCanary();
    const res = resolveRpDiagnosticCanary({
      userId: 34,
      modelId: "deepseek-v4-pro",
      contentKind: "character",
    });
    assert.ok(res?.active);
    assert.equal(res?.variant, "ds_pipeline_baseline");
    assert.equal(res?.sceneMode, "single_primary");
  });

  it("user 34 + other model → not applied", () => {
    enableCanary();
    const res = resolveRpDiagnosticCanary({
      userId: 34,
      modelId: "gemini-2.5-flash",
      contentKind: "character",
    });
    assert.equal(res, null);
  });

  it("other user + deepseek-v4-pro → not applied", () => {
    enableCanary();
    const res = resolveRpDiagnosticCanary({
      userId: 99,
      modelId: "deepseek-v4-pro",
      contentKind: "character",
    });
    assert.equal(res, null);
  });

  it("simulation contentKind → not applied", () => {
    enableCanary();
    const res = resolveRpDiagnosticCanary({
      userId: 34,
      modelId: "deepseek-v4-pro",
      contentKind: "simulation",
    });
    assert.equal(res, null);
  });

  it("canary env OFF → not applied", () => {
    process.env[RP_DIAGNOSTIC_CANARY_ENV.ENABLED] = "false";
    process.env[RP_DIAGNOSTIC_CANARY_ENV.USER_IDS] = "34";
    process.env[RP_DIAGNOSTIC_CANARY_ENV.MODEL_IDS] = "deepseek-v4-pro";
    const res = resolveRpDiagnosticCanary({
      userId: 34,
      modelId: "deepseek-v4-pro",
      contentKind: "character",
    });
    assert.equal(res, null);
  });

  it("empty user allowlist → not applied", () => {
    process.env[RP_DIAGNOSTIC_CANARY_ENV.ENABLED] = "true";
    process.env[RP_DIAGNOSTIC_CANARY_ENV.USER_IDS] = "";
    process.env[RP_DIAGNOSTIC_CANARY_ENV.MODEL_IDS] = "deepseek-v4-pro";
    const res = resolveRpDiagnosticCanary({
      userId: 34,
      modelId: "deepseek-v4-pro",
      contentKind: "character",
    });
    assert.equal(res, null);
  });

  it("common_dialogue_resume_single_owner: exact variant match for allowlisted scope", () => {
    enableCanary("common_dialogue_resume_single_owner");
    const res = resolveRpDiagnosticCanary({
      userId: 34,
      modelId: "deepseek-v4-pro",
      contentKind: "character",
    });
    assert.ok(res?.active);
    assert.equal(res?.variant, "common_dialogue_resume_single_owner");
    assert.equal(res?.sceneMode, "single_primary");
  });

  it("common_dialogue_resume_single_owner: non-allowlisted user remains fail-closed", () => {
    enableCanary("common_dialogue_resume_single_owner");
    const res = resolveRpDiagnosticCanary({
      userId: 99,
      modelId: "deepseek-v4-pro",
      contentKind: "character",
    });
    assert.equal(res, null);
  });
});
