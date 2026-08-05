/**
 * Offline integrity — DeepSeek SHORT HISTORY single-clause neutralization.
 *
 * Run: node --conditions=react-server --import tsx --test src/lib/deepseekOpeningCue.offline.test.ts
 */
import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { describe, it } from "node:test";

import type { ChatMsg } from "@/lib/ai";
import {
  ACTIVE_DYAD_NEUTRALIZED_BASE_ENGINE_RULE,
  BASE_SCENE_ENGINE_RULE,
  buildSceneDirective,
  extractSceneEngineRule,
  renderSceneDirectiveForPrompt,
} from "@/lib/sceneDirective";
import { ACTIVE_DYAD_CONCRETE_BEATS_PALETTE } from "@/lib/sceneFocusPalette";
import {
  DEEPSEEK_BOTTOM_REMINDER,
  DEEPSEEK_SHORT_HISTORY_LENGTH_EXTRA,
  DEEPSEEK_SHORT_HISTORY_LENGTH_EXTRA_INTERNAL,
  DEEPSEEK_SHORT_HISTORY_SUSTAIN_CLAUSE,
  DEEPSEEK_SHORT_HISTORY_SUSTAIN_CLAUSE_INTERNAL,
  resolveDeepSeekShortHistoryLengthExtra,
} from "@/lib/deepseekPromptStructure";
import {
  RP_DIAGNOSTIC_CANARY_ENV,
  resolveCanarySceneFocusPalette,
  resolveRpDiagnosticCanary,
  rpDiagnosticNeutralizesDeepSeekOpeningWorldCue,
  rpDiagnosticUsesConcreteBeatSerializer,
} from "@/lib/rpDiagnosticCanary";

function sha16(s: string): string {
  return createHash("sha256").update(s).digest("hex").slice(0, 16);
}

const recent: ChatMsg[] = [
  {
    role: "assistant",
    content: "라이크가 가만히 렌을 바라보다가, 짧게 숨을 골랐다. 「……렌?」",
  },
  {
    role: "user",
    content: "나는 렌이라고 부르면 돼....나는 본기억이 안나는데....나 알아?(갸웃)",
  },
];

describe("DeepSeek opening single-cue neutralization — offline", () => {
  it("production SHORT HISTORY byte-identical when neutralization OFF", () => {
    const a = resolveDeepSeekShortHistoryLengthExtra([]);
    const b = resolveDeepSeekShortHistoryLengthExtra([], {
      neutralizeEnvironmentCue: false,
    });
    assert.equal(a, DEEPSEEK_SHORT_HISTORY_LENGTH_EXTRA);
    assert.equal(b, DEEPSEEK_SHORT_HISTORY_LENGTH_EXTRA);
    assert.ok(a!.includes(DEEPSEEK_SHORT_HISTORY_SUSTAIN_CLAUSE));
    assert.ok(!a!.includes("the primary character's choices and actions"));
  });

  it("candidate differs only in sustain clause", () => {
    const prod = resolveDeepSeekShortHistoryLengthExtra([]);
    const cand = resolveDeepSeekShortHistoryLengthExtra([], {
      neutralizeEnvironmentCue: true,
    });
    assert.equal(cand, DEEPSEEK_SHORT_HISTORY_LENGTH_EXTRA_INTERNAL);
    assert.ok(prod && cand);
    assert.notEqual(prod, cand);
    assert.ok(cand!.includes(DEEPSEEK_SHORT_HISTORY_SUSTAIN_CLAUSE_INTERNAL));
    assert.doesNotMatch(cand!, /\benvironment\b/);
    // Header / length framing identical.
    assert.equal(
      prod!.replace(DEEPSEEK_SHORT_HISTORY_SUSTAIN_CLAUSE, ""),
      cand!.replace(DEEPSEEK_SHORT_HISTORY_SUSTAIN_CLAUSE_INTERNAL, "")
    );
    // Exactly one clause change — hashes differ; BOTTOM_REMINDER untouched.
    assert.notEqual(sha16(prod!), sha16(cand!));
    assert.equal(sha16(DEEPSEEK_BOTTOM_REMINDER), sha16(DEEPSEEK_BOTTOM_REMINDER));
  });

  it("SceneDirective / concrete beats / engine parity with PR #240", () => {
    const concrete = buildSceneDirective({
      mode: "interactive",
      recentMessages: recent,
      currentUserMessage: recent[1]!.content,
      chatId: 11,
      currentTurn: 1,
      contentKind: "character",
      primaryCharacterName: "라이크",
      sceneFocusPalette: ACTIVE_DYAD_CONCRETE_BEATS_PALETTE,
    });
    const block = renderSceneDirectiveForPrompt(concrete);
    assert.equal(extractSceneEngineRule(block), ACTIVE_DYAD_NEUTRALIZED_BASE_ENGINE_RULE);
    assert.equal([...block.matchAll(/^- (.+)$/gm)].length, 3);

    const prod = buildSceneDirective({
      mode: "interactive",
      recentMessages: recent,
      currentUserMessage: recent[1]!.content,
      chatId: 11,
      currentTurn: 1,
      contentKind: "character",
      primaryCharacterName: "라이크",
    });
    assert.equal(
      extractSceneEngineRule(renderSceneDirectiveForPrompt(prod)),
      BASE_SCENE_ENGINE_RULE
    );
  });

  it("variant enables concrete palette + DeepSeek opening neutralization", () => {
    const saved = {
      e: process.env[RP_DIAGNOSTIC_CANARY_ENV.ENABLED],
      u: process.env[RP_DIAGNOSTIC_CANARY_ENV.USER_IDS],
      m: process.env[RP_DIAGNOSTIC_CANARY_ENV.MODEL_IDS],
      v: process.env[RP_DIAGNOSTIC_CANARY_ENV.VARIANT],
    };
    try {
      process.env[RP_DIAGNOSTIC_CANARY_ENV.ENABLED] = "true";
      process.env[RP_DIAGNOSTIC_CANARY_ENV.USER_IDS] = "34";
      process.env[RP_DIAGNOSTIC_CANARY_ENV.MODEL_IDS] = "deepseek-v4-pro";
      process.env[RP_DIAGNOSTIC_CANARY_ENV.VARIANT] =
        "structured_active_dyad_concrete_beats_ds_opening_neutral";
      const canary = resolveRpDiagnosticCanary({
        userId: 34,
        modelId: "deepseek-v4-pro",
        contentKind: "character",
      });
      assert.ok(canary);
      assert.equal(rpDiagnosticUsesConcreteBeatSerializer(canary!.variant), true);
      assert.equal(
        rpDiagnosticNeutralizesDeepSeekOpeningWorldCue(canary!.variant),
        true
      );
      const palette = resolveCanarySceneFocusPalette({ canary, completedTurns: 0 });
      assert.equal(palette?.serializeConcreteBeats, true);
    } finally {
      for (const [k, v] of Object.entries({
        [RP_DIAGNOSTIC_CANARY_ENV.ENABLED]: saved.e,
        [RP_DIAGNOSTIC_CANARY_ENV.USER_IDS]: saved.u,
        [RP_DIAGNOSTIC_CANARY_ENV.MODEL_IDS]: saved.m,
        [RP_DIAGNOSTIC_CANARY_ENV.VARIANT]: saved.v,
      })) {
        if (v === undefined) delete process.env[k];
        else process.env[k] = v;
      }
    }
  });

  it("no NPC ban / length owner / new section literals in neutralized clause", () => {
    assert.doesNotMatch(
      DEEPSEEK_SHORT_HISTORY_SUSTAIN_CLAUSE_INTERNAL,
      /NPC|금지|TARGET_LENGTH|MINIMUM_FLOOR|dialogue share|narration/
    );
  });
});
