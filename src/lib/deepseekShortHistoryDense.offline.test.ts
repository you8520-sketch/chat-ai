/**
 * Offline integrity — dense-internal SHORT HISTORY sustain re-substitution.
 *
 * Run: node --conditions=react-server --import tsx --test src/lib/deepseekShortHistoryDense.offline.test.ts
 */
import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { describe, it } from "node:test";

import {
  DEEPSEEK_SHORT_HISTORY_LENGTH_EXTRA,
  DEEPSEEK_SHORT_HISTORY_LENGTH_EXTRA_DENSE_INTERNAL,
  DEEPSEEK_SHORT_HISTORY_LENGTH_EXTRA_INTERNAL,
  DEEPSEEK_SHORT_HISTORY_SUSTAIN_CLAUSE,
  DEEPSEEK_SHORT_HISTORY_SUSTAIN_CLAUSE_DENSE_INTERNAL,
  DEEPSEEK_SHORT_HISTORY_SUSTAIN_CLAUSE_INTERNAL,
  resolveDeepSeekShortHistoryLengthExtra,
} from "@/lib/deepseekPromptStructure";
import {
  ACTIVE_DYAD_NEUTRALIZED_BASE_ENGINE_RULE,
  BASE_SCENE_ENGINE_RULE,
  buildSceneDirective,
  extractSceneEngineRule,
  renderSceneDirectiveForPrompt,
} from "@/lib/sceneDirective";
import { ACTIVE_DYAD_CONCRETE_BEATS_PALETTE } from "@/lib/sceneFocusPalette";
import {
  RP_DIAGNOSTIC_CANARY_ENV,
  resolveCanarySceneFocusPalette,
  resolveRpDiagnosticCanary,
  rpDiagnosticUsesConcreteBeatSerializer,
  rpDiagnosticUsesDenseInternalShortHistorySustain,
} from "@/lib/rpDiagnosticCanary";

function sha16(s: string): string {
  return createHash("sha256").update(s).digest("hex").slice(0, 16);
}

const HEADER_AND_BODY_PREFIX =
  "[SHORT HISTORY]\n" +
  "Recent assistant length is context, not a response-length example. " +
  "In this single response, develop a full scene of roughly normal requested length even with sparse history. ";

describe("dense-internal SHORT HISTORY sustain — offline", () => {
  it("production SHORT HISTORY byte-identical when canary flags OFF", () => {
    const a = resolveDeepSeekShortHistoryLengthExtra([]);
    assert.equal(a, DEEPSEEK_SHORT_HISTORY_LENGTH_EXTRA);
    assert.ok(a!.includes(DEEPSEEK_SHORT_HISTORY_SUSTAIN_CLAUSE));
  });

  it("only sustain clause differs vs PR #241 internal; header/first/second sentences parity", () => {
    const pr241 = DEEPSEEK_SHORT_HISTORY_LENGTH_EXTRA_INTERNAL;
    const dense = DEEPSEEK_SHORT_HISTORY_LENGTH_EXTRA_DENSE_INTERNAL;
    assert.equal(pr241.startsWith(HEADER_AND_BODY_PREFIX), true);
    assert.equal(dense.startsWith(HEADER_AND_BODY_PREFIX), true);
    assert.equal(
      pr241.replace(DEEPSEEK_SHORT_HISTORY_SUSTAIN_CLAUSE_INTERNAL, ""),
      dense.replace(DEEPSEEK_SHORT_HISTORY_SUSTAIN_CLAUSE_DENSE_INTERNAL, "")
    );
    assert.notEqual(pr241, dense);
    assert.notEqual(sha16(pr241), sha16(dense));

    const resolved = resolveDeepSeekShortHistoryLengthExtra([], {
      denseInternalSustain: true,
    });
    assert.equal(resolved, dense);
  });

  it("dense clause has internal density cues and zero external/admin cues", () => {
    const c = DEEPSEEK_SHORT_HISTORY_SUSTAIN_CLAUSE_DENSE_INTERNAL;
    assert.doesNotMatch(
      c,
      /\b(NPC|new character|outside world|world reaction|staff|guard|registration|inspection|report|call)\b/i
    );
    assert.doesNotMatch(c, /\benvironment\b/);
    assert.match(c, /specific interpretation/);
    assert.match(c, /consequential primary-character choices/);
    assert.match(c, /concrete action/);
    assert.match(c, /observable change within the existing scene/);
    assert.match(c, /relationship development/);
    assert.match(c, /necessary inner experience/);
    assert.match(c, /concrete opening for the user's response/);
  });

  it("SceneDirective / concrete beats / engine parity unchanged", () => {
    const recent = [
      { role: "assistant" as const, content: "라이크가 렌을 바라봤다." },
      { role: "user" as const, content: "나는 렌이라고 부르면 돼." },
    ];
    const prod = buildSceneDirective({
      mode: "interactive",
      recentMessages: recent,
      currentUserMessage: recent[1]!.content,
      chatId: 1,
      currentTurn: 1,
      contentKind: "character",
      primaryCharacterName: "라이크",
    });
    const cand = buildSceneDirective({
      mode: "interactive",
      recentMessages: recent,
      currentUserMessage: recent[1]!.content,
      chatId: 1,
      currentTurn: 1,
      contentKind: "character",
      primaryCharacterName: "라이크",
      sceneFocusPalette: ACTIVE_DYAD_CONCRETE_BEATS_PALETTE,
    });
    assert.equal(
      extractSceneEngineRule(renderSceneDirectiveForPrompt(prod)),
      BASE_SCENE_ENGINE_RULE
    );
    const candBlock = renderSceneDirectiveForPrompt(cand);
    assert.equal(
      extractSceneEngineRule(candBlock),
      ACTIVE_DYAD_NEUTRALIZED_BASE_ENGINE_RULE
    );
    assert.equal([...candBlock.matchAll(/^- (.+)$/gm)].length, 3);
  });

  it("variant resolves dense sustain + concrete palette", () => {
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
        "structured_active_dyad_concrete_beats_ds_short_history_dense_internal";
      const canary = resolveRpDiagnosticCanary({
        userId: 34,
        modelId: "deepseek-v4-pro",
        contentKind: "character",
      });
      assert.ok(canary);
      assert.equal(rpDiagnosticUsesConcreteBeatSerializer(canary!.variant), true);
      assert.equal(
        rpDiagnosticUsesDenseInternalShortHistorySustain(canary!.variant),
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
});
