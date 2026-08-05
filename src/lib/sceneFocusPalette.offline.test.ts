/**
 * Offline integrity — ACTIVE_DYAD single world-motion cue neutralization.
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
  renderSceneDirectiveForPrompt,
  renderSceneEngineRule,
} from "@/lib/sceneDirective";
import { ACTIVE_DYAD_PALETTE, ACTIVE_DYAD_SCENE_ENGINE_MOTION } from "@/lib/sceneFocusPalette";
import {
  RP_DIAGNOSTIC_CANARY_ENV,
  resolveCanarySceneFocusState,
  resolveRpDiagnosticCanary,
  rpDiagnosticNeutralizesWorldMotionCue,
  rpDiagnosticUsesStructuredSceneFocus,
} from "@/lib/rpDiagnosticCanary";

const recent: ChatMsg[] = [
  {
    role: "assistant",
    content:
      "라이크가 가만히 렌을 바라보다가, 짧게 숨을 골랐다. 「……렌?」 목소리가 낮았다.",
  },
  { role: "user", content: "나는 렌이라고 부르면 돼....나는 본기억이 안나는데....나 알아?(갸웃)" },
];

function engineLines(rule: string): string[] {
  return rule.split("\n");
}

describe("ACTIVE_DYAD single world-motion cue neutralization — offline", () => {
  it("default parity: null palette keeps BASE_SCENE_ENGINE_RULE byte-identical", () => {
    const a = buildSceneDirective({
      mode: "interactive",
      recentMessages: recent,
      currentUserMessage: recent[1]!.content,
      chatId: 9001,
      currentTurn: 1,
      contentKind: "character",
      primaryCharacterName: "라이크",
    });
    const b = buildSceneDirective({
      mode: "interactive",
      recentMessages: recent,
      currentUserMessage: recent[1]!.content,
      chatId: 9001,
      currentTurn: 1,
      contentKind: "character",
      primaryCharacterName: "라이크",
      sceneFocusPalette: null,
    });
    const ra = renderSceneDirectiveForPrompt(a);
    const rb = renderSceneDirectiveForPrompt(b);
    assert.equal(ra, rb);
    assert.equal(extractSceneEngineRule(ra), BASE_SCENE_ENGINE_RULE);
    assert.equal(renderSceneEngineRule(null), BASE_SCENE_ENGINE_RULE);
  });

  it("ACTIVE_DYAD: single substring diff only; header/final/line/clause parity", () => {
    const dyad = buildSceneDirective({
      mode: "interactive",
      recentMessages: recent,
      currentUserMessage: recent[1]!.content,
      chatId: 9001,
      currentTurn: 1,
      contentKind: "character",
      primaryCharacterName: "라이크",
      sceneFocusPalette: ACTIVE_DYAD_PALETTE,
    });
    const block = renderSceneDirectiveForPrompt(dyad);
    const activeRule = extractSceneEngineRule(block);

    assert.equal(
      activeRule.replace("주 캐릭터의 선택·행동", "NPC, 세계 반응"),
      BASE_SCENE_ENGINE_RULE
    );
    assert.equal(activeRule, ACTIVE_DYAD_NEUTRALIZED_BASE_ENGINE_RULE);
    assert.equal(renderSceneEngineRule(ACTIVE_DYAD_PALETTE), ACTIVE_DYAD_NEUTRALIZED_BASE_ENGINE_RULE);

    const baseLines = engineLines(BASE_SCENE_ENGINE_RULE);
    const activeLines = engineLines(activeRule);
    assert.equal(activeLines.length, baseLines.length);
    assert.equal(activeLines[0], baseLines[0]);
    assert.equal(activeLines[2], baseLines[2]);
    assert.notEqual(activeLines[1], baseLines[1]);
    assert.match(activeLines[1]!, /주 캐릭터의 선택·행동/);
    assert.doesNotMatch(activeLines[1]!, /NPC,\s*세계 반응/);

    // Must NOT use the short palette motion rewrite.
    assert.doesNotMatch(block, new RegExp(ACTIVE_DYAD_SCENE_ENGINE_MOTION.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")));
    assert.doesNotMatch(block, /\[장면 초점|NPC를 만들지 마라/);

    // Clause structure: still one motion sentence (one period / one "움직인다").
    assert.equal(
      (activeLines[1]!.match(/움직인다/g) ?? []).length,
      (baseLines[1]!.match(/움직인다/g) ?? []).length
    );
    assert.equal(activeLines[1]!.endsWith("움직인다."), true);
  });

  it("external withhold + beat preservation still hold", () => {
    const dyad = buildSceneDirective({
      mode: "interactive",
      recentMessages: recent,
      currentUserMessage: recent[1]!.content,
      chatId: 42,
      currentTurn: 1,
      contentKind: "character",
      primaryCharacterName: "라이크",
      triggeredEventText: "경비 담당자가 등록 절차를 안내한다.",
      sceneFocusPalette: ACTIVE_DYAD_PALETTE,
    });
    const sources = dyad.focusDiagnostics?.resolvedProgressionSources ?? [];
    assert.ok(!sources.includes("NEW_SPEAKING_NPC"));
    assert.ok(!sources.includes("NEW_EXTERNAL_EVENT"));
    assert.ok(dyad.focusDiagnostics!.resolvedBeatCount >= dyad.focusDiagnostics!.requestedBeatCount);
  });

  it("canary variant structured_active_dyad_neutral_world_motion resolves", () => {
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
        "structured_active_dyad_neutral_world_motion";
      const canary = resolveRpDiagnosticCanary({
        userId: 34,
        modelId: "deepseek-v4-pro",
        contentKind: "character",
      });
      assert.ok(canary);
      assert.equal(rpDiagnosticUsesStructuredSceneFocus(canary!.variant), true);
      assert.equal(rpDiagnosticNeutralizesWorldMotionCue(canary!.variant), true);
      assert.equal(
        resolveCanarySceneFocusState({ canary, completedTurns: 0 }),
        "ACTIVE_DYAD"
      );
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
