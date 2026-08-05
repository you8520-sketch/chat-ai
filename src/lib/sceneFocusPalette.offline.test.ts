/**
 * Offline integrity — ACTIVE_DYAD concrete 3-beat serializer.
 *
 * Run: node --conditions=react-server --import tsx --test src/lib/sceneFocusPalette.offline.test.ts
 */
import assert from "node:assert/strict";
import { describe, it } from "node:test";

import type { ChatMsg } from "@/lib/ai";
import {
  ACTIVE_DYAD_NEUTRALIZED_BASE_ENGINE_RULE,
  BASE_SCENE_ENGINE_RULE,
  buildSceneDirective,
  extractSceneEngineRule,
  measureSerializedSceneBeatBudget,
  renderSceneDirectiveForPrompt,
} from "@/lib/sceneDirective";
import {
  ACTIVE_DYAD_CONCRETE_BEATS_PALETTE,
  ACTIVE_DYAD_PALETTE,
  buildConcreteActiveDyadBeats,
  concreteBeatKindsPresent,
} from "@/lib/sceneFocusPalette";
import {
  RP_DIAGNOSTIC_CANARY_ENV,
  resolveCanarySceneFocusPalette,
  resolveRpDiagnosticCanary,
  rpDiagnosticUsesConcreteBeatSerializer,
} from "@/lib/rpDiagnosticCanary";

const recent: ChatMsg[] = [
  {
    role: "assistant",
    content: "라이크가 가만히 렌을 바라보다가, 짧게 숨을 골랐다. 「……렌?」",
  },
  { role: "user", content: "나는 렌이라고 부르면 돼....나는 본기억이 안나는데....나 알아?(갸웃)" },
];

describe("concrete beat serializer — offline", () => {
  it("default parity: null palette byte-identical", () => {
    const a = buildSceneDirective({
      mode: "interactive",
      recentMessages: recent,
      currentUserMessage: recent[1]!.content,
      chatId: 1,
      currentTurn: 1,
      contentKind: "character",
      primaryCharacterName: "라이크",
    });
    const b = buildSceneDirective({
      mode: "interactive",
      recentMessages: recent,
      currentUserMessage: recent[1]!.content,
      chatId: 1,
      currentTurn: 1,
      contentKind: "character",
      primaryCharacterName: "라이크",
      sceneFocusPalette: null,
    });
    assert.equal(renderSceneDirectiveForPrompt(a), renderSceneDirectiveForPrompt(b));
    assert.equal(extractSceneEngineRule(renderSceneDirectiveForPrompt(a)), BASE_SCENE_ENGINE_RULE);
  });

  it("concrete beats: exactly 3 bullets; engine matches PR#239 neutralization", () => {
    const d = buildSceneDirective({
      mode: "interactive",
      recentMessages: recent,
      currentUserMessage: recent[1]!.content,
      chatId: 9,
      currentTurn: 1,
      contentKind: "character",
      primaryCharacterName: "라이크",
      sceneFocusPalette: ACTIVE_DYAD_CONCRETE_BEATS_PALETTE,
    });
    const block = renderSceneDirectiveForPrompt(d);
    assert.equal(extractSceneEngineRule(block), ACTIVE_DYAD_NEUTRALIZED_BASE_ENGINE_RULE);

    const bullets = [...block.matchAll(/^- (.+)$/gm)].map((m) => m[1]!);
    assert.equal(bullets.length, 3);
    const kinds = concreteBeatKindsPresent(bullets);
    assert.deepEqual(kinds, [
      "INTERPRETATION",
      "DECISION_OR_ACTION",
      "CONSEQUENCE_AND_OPEN_REACTION",
    ]);

    assert.match(block, /다음 장면 힌트:\n- /);
    // No duplicate single compressed ACTIVE_DYAD hint sentence alongside bullets.
    assert.doesNotMatch(block, /다음 장면 힌트: 주 캐릭터가/);
    assert.doesNotMatch(block, /먼저|다음으로|마지막으로/);
    assert.doesNotMatch(block, /NPC|직원|경비|등록|검사|호출|보고|새 인물|세계가 개입/);
    assert.doesNotMatch(block, /\[장면 초점/);

    const budget = measureSerializedSceneBeatBudget({
      sceneDirectiveBlock: block,
      requestedBeatCount: d.focusDiagnostics?.requestedBeatCount,
      resolvedBeatCount: d.focusDiagnostics?.resolvedBeatCount,
    });
    assert.ok(budget.serializedConcreteBeatInstructionCount >= 4);
    assert.ok(budget.nextBeatHintClauseCount >= 3);
    assert.ok(budget.primaryDecisionActionCueCount >= 2);
    assert.ok(budget.relationshipEnvironmentCueCount >= 1);
    assert.equal(budget.openReactionCuePresent, true);
  });

  it("neutral palette without concrete flag keeps single-line hint", () => {
    const d = buildSceneDirective({
      mode: "interactive",
      recentMessages: recent,
      currentUserMessage: recent[1]!.content,
      chatId: 3,
      currentTurn: 1,
      contentKind: "character",
      primaryCharacterName: "라이크",
      sceneFocusPalette: ACTIVE_DYAD_PALETTE,
    });
    const block = renderSceneDirectiveForPrompt(d);
    assert.match(block, /^다음 장면 힌트: /m);
    assert.equal([...block.matchAll(/^- /gm)].length, 0);
  });

  it("buildConcreteActiveDyadBeats always returns 3 internal beats", () => {
    const beats = buildConcreteActiveDyadBeats(["PRIMARY_DECISION"]);
    assert.equal(beats.length, 3);
    assert.deepEqual(concreteBeatKindsPresent(beats), [
      "INTERPRETATION",
      "DECISION_OR_ACTION",
      "CONSEQUENCE_AND_OPEN_REACTION",
    ]);
  });

  it("canary variant resolves concrete palette", () => {
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
      process.env[RP_DIAGNOSTIC_CANARY_ENV.VARIANT] = "structured_active_dyad_concrete_beats";
      const canary = resolveRpDiagnosticCanary({
        userId: 34,
        modelId: "deepseek-v4-pro",
        contentKind: "character",
      });
      assert.ok(canary);
      assert.equal(rpDiagnosticUsesConcreteBeatSerializer(canary!.variant), true);
      const palette = resolveCanarySceneFocusPalette({ canary, completedTurns: 0 });
      assert.equal(palette?.serializeConcreteBeats, true);
      assert.equal(palette?.state, "ACTIVE_DYAD");
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
