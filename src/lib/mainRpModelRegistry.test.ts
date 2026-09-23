/**
 * Main RP model registry — canonical 6-model role invariant.
 *
 * ONE source of truth: MAIN_RP_MODEL_IDS / MAIN_RP_USER_SELECTABLE_OPTIONS.
 * Exactly 6 Main RP models; all others are MainRP=false (auxiliary/vision/
 * historical only). API=0.
 */
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, it } from "node:test";
import {
  CHEAPER_INFERENCE_CLAUDE_OPUS_55_MODEL,
  CHEAPER_INFERENCE_CLAUDE_OPUS_5_MODEL,
  CHEAPER_INFERENCE_DEEPSEEK_V4_FLASH_MODEL,
  CHEAPER_INFERENCE_DEEPSEEK_V41_FLASH_MODEL,
  CHEAPER_INFERENCE_DEEPSEEK_V4_PRO_MODEL,
  CHEAPER_INFERENCE_GEMINI_31_PRO_PREVIEW_MODEL,
  CHEAPER_INFERENCE_GEMINI_37_FLASH_MODEL,
  CHEAPER_INFERENCE_GPT_56_LUNA_MODEL,
  CHEAPER_INFERENCE_GPT_56_TERRA_MODEL,
  CLAUDE_OPUS_MODEL,
  MAIN_RP_MODEL_IDS,
  MAIN_RP_USER_SELECTABLE_OPTIONS,
  OPENROUTER_GEMINI_36_FLASH_MODEL,
  SELECTED_AI_OPTIONS,
  USER_SELECTABLE_AI_OPTIONS,
  isMainRpModel,
  isUserSelectableAI,
  userSelectableAIOptionsForUser,
  type SelectedAI,
} from "@/lib/chatModels";

const REPO_ROOT = resolve(process.cwd());

describe("Main RP canonical 6-model registry", () => {
  it("MAIN_RP_MODEL_COUNT=6 and picker count=6 (single source of truth)", () => {
    assert.equal(MAIN_RP_MODEL_IDS.length, 6);
    assert.equal(MAIN_RP_USER_SELECTABLE_OPTIONS.length, 6);
    assert.equal(SELECTED_AI_OPTIONS.length, 6);
    assert.equal(USER_SELECTABLE_AI_OPTIONS.length, 6);
    assert.equal(userSelectableAIOptionsForUser(false).length, 6);
    assert.equal(userSelectableAIOptionsForUser(true).length, 6);
  });

  it("canonical 6 are the exact expected ids and all selectable", () => {
    assert.deepEqual(
      [...MAIN_RP_MODEL_IDS].sort(),
      [
        CHEAPER_INFERENCE_CLAUDE_OPUS_55_MODEL,
        CHEAPER_INFERENCE_DEEPSEEK_V4_PRO_MODEL,
        CHEAPER_INFERENCE_DEEPSEEK_V41_FLASH_MODEL,
        CHEAPER_INFERENCE_GEMINI_31_PRO_PREVIEW_MODEL,
        CHEAPER_INFERENCE_GEMINI_37_FLASH_MODEL,
        CHEAPER_INFERENCE_GPT_56_TERRA_MODEL,
      ].sort()
    );
    for (const modelId of MAIN_RP_MODEL_IDS) {
      assert.equal(isMainRpModel(modelId), true, modelId);
      assert.equal(isUserSelectableAI(modelId, false), true, modelId);
      assert.equal(isUserSelectableAI(modelId, true), true, modelId);
    }
  });

  it("retired models are MainRP=false and never selectable (even for admins)", () => {
    const retired = [
      CHEAPER_INFERENCE_GPT_56_LUNA_MODEL,
      CHEAPER_INFERENCE_DEEPSEEK_V4_FLASH_MODEL,
      OPENROUTER_GEMINI_36_FLASH_MODEL,
      CLAUDE_OPUS_MODEL,
      CHEAPER_INFERENCE_CLAUDE_OPUS_5_MODEL,
    ];
    for (const modelId of retired) {
      assert.equal(isMainRpModel(modelId), false, modelId);
      assert.equal(isUserSelectableAI(modelId, false), false, modelId);
      assert.equal(isUserSelectableAI(modelId, true), false, modelId);
      assert.ok(
        !SELECTED_AI_OPTIONS.some((o) => o.id === modelId),
        `${modelId} must not be a Main RP registry row`
      );
      assert.ok(
        !USER_SELECTABLE_AI_OPTIONS.some((o) => o.id === modelId),
        `${modelId} must not be in the picker`
      );
    }
  });

  it("Main RP registry rows are derived from the canonical owner (no hand-expanded parallel list)", () => {
    for (const option of MAIN_RP_USER_SELECTABLE_OPTIONS) {
      assert.ok(MAIN_RP_MODEL_IDS.includes(option.id), option.id);
    }
    for (const modelId of MAIN_RP_MODEL_IDS) {
      assert.ok(MAIN_RP_USER_SELECTABLE_OPTIONS.some((o) => o.id === modelId), modelId);
    }
  });

  it("MANUALLY_DUPLICATED_MAIN_RP_MODEL_LISTS=0 — MODEL_IDS is derived, not hand-written", () => {
    const source = readFileSync(
      resolve(REPO_ROOT, "src/lib/chatModels.ts"),
      "utf8"
    );
    const mapDecl = source.match(/MAIN_RP_MODEL_IDS[\s\S]*?MAIN_RP_USER_SELECTABLE_OPTIONS\.map/);
    assert.ok(mapDecl, "MAIN_RP_MODEL_IDS must be derived via .map from the canonical picker");
    assert.equal(
      (source.match(/MAIN_RP_MODEL_IDS\s*[:=]\s*\[/g) ?? []).length,
      0,
      "MAIN_RP_MODEL_IDS must not be a literal array declaration"
    );
    assert.match(source, /SELECTED_AI_OPTIONS = MAIN_RP_USER_SELECTABLE_OPTIONS/);
    assert.match(source, /USER_SELECTABLE_AI_OPTIONS = MAIN_RP_USER_SELECTABLE_OPTIONS/);
  });

  it("SELECTED_AI is the exact canonical literal union (not widened to string)", () => {
    const typed: SelectedAI = CHEAPER_INFERENCE_DEEPSEEK_V4_PRO_MODEL;
    const v41Typed: SelectedAI = CHEAPER_INFERENCE_DEEPSEEK_V41_FLASH_MODEL;
    assert.ok(typeof typed === "string");
    assert.ok(typeof v41Typed === "string");
    assert.deepEqual(
      [...MAIN_RP_MODEL_IDS],
      MAIN_RP_USER_SELECTABLE_OPTIONS.map((o) => o.id)
    );
    // @ts-expect-error — a retired model id must NOT be assignable to SelectedAI.
    const _retiredRejected: SelectedAI = CHEAPER_INFERENCE_GPT_56_LUNA_MODEL;
    void _retiredRejected;
    // @ts-expect-error — Opus 5 retired from Main RP union.
    const _opusRejected: SelectedAI = CHEAPER_INFERENCE_CLAUDE_OPUS_5_MODEL;
    void _opusRejected;
  });

  it("RETIRED_RP_ADAPTER_COUNT=0 / RETIRED_RP_CANARY_COUNT=0 / RETIRED_RP_ENV_FLAG_COUNT=0", () => {
    const chatModelsSrc = readFileSync(resolve(REPO_ROOT, "src/lib/chatModels.ts"), "utf8");
    const rpSrc = readFileSync(resolve(REPO_ROOT, "src/lib/rpDiagnosticCanary.ts"), "utf8");
    const ctxSrc = readFileSync(resolve(REPO_ROOT, "src/services/contextBuilder.ts"), "utf8");
    for (const src of [chatModelsSrc, rpSrc, ctxSrc]) {
      assert.equal(/TERRA_PROMPT_CANARY|terraTerminalLengthOwner/.test(src), false);
      assert.equal(/resolveTerraPromptCanary|TerraPromptCanaryResolution/.test(src), false);
    }
  });

  it("RETIRED_MODEL_IN_MAIN_RP_MATRIX=0 — main Rp registry never lists retired ids", () => {
    const retiredIds = [
      CHEAPER_INFERENCE_GPT_56_LUNA_MODEL,
      CHEAPER_INFERENCE_DEEPSEEK_V4_FLASH_MODEL,
      OPENROUTER_GEMINI_36_FLASH_MODEL,
      CLAUDE_OPUS_MODEL,
      CHEAPER_INFERENCE_CLAUDE_OPUS_5_MODEL,
    ];
    for (const list of [MAIN_RP_MODEL_IDS, [...MAIN_RP_USER_SELECTABLE_OPTIONS].map((o) => o.id)]) {
      for (const retired of retiredIds) {
        assert.ok(!list.includes(retired), retired);
      }
    }
  });
});
