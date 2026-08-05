/**
 * Offline prompt integrity gate for structured scene-focus palette.
 * Must pass before any production canary model calls.
 *
 * Run: node --conditions=react-server --import tsx --test src/lib/sceneFocusPalette.offline.test.ts
 */
import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { describe, it } from "node:test";

import type { ChatMsg } from "@/lib/ai";
import {
  buildSceneDirective,
  renderSceneDirectiveForPrompt,
} from "@/lib/sceneDirective";
import {
  ACTIVE_DYAD_PALETTE,
  ACTIVE_DYAD_SCENE_ENGINE_MOTION,
} from "@/lib/sceneFocusPalette";
import {
  RP_DIAGNOSTIC_CANARY_ENV,
  resolveCanarySceneFocusPalette,
  resolveCanarySceneFocusState,
  resolveRpDiagnosticCanary,
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

function sha(text: string): string {
  return createHash("sha256").update(text, "utf8").digest("hex");
}

function countSystemHeaders(block: string): number {
  return (block.match(/^\[/gm) ?? []).length;
}

describe("structured scene focus — offline integrity", () => {
  it("Test 1 — default parity: null palette is byte-identical to production builder", () => {
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
    assert.equal(sha(ra), sha(rb));
    assert.equal(a.focusDiagnostics, null);
    assert.equal(b.focusDiagnostics, null);
    assert.doesNotMatch(ra, /ACTIVE_DYAD|장면 초점/);
  });

  it("Test 2 — ACTIVE_DYAD structural difference: no new section header; only SceneDirective content changes", () => {
    const prod = buildSceneDirective({
      mode: "interactive",
      recentMessages: recent,
      currentUserMessage: recent[1]!.content,
      chatId: 9001,
      currentTurn: 1,
      contentKind: "character",
      primaryCharacterName: "라이크",
    });
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
    const prodBlock = renderSceneDirectiveForPrompt(prod);
    const dyadBlock = renderSceneDirectiveForPrompt(dyad);

    // Same structural headers — no new [장면 초점] / system section.
    assert.doesNotMatch(dyadBlock, /\[장면 초점/);
    assert.doesNotMatch(dyadBlock, /ACTIVE_DYAD/);
    assert.doesNotMatch(dyadBlock, /NPC를 만들지 마라|외부 사건을 시작하지 마라|행정 절차/);
    assert.equal(countSystemHeaders(prodBlock), countSystemHeaders(dyadBlock));
    assert.match(prodBlock, /\[PRIVATE SCENE ENGINE RULE\]/);
    assert.match(dyadBlock, /\[PRIVATE SCENE ENGINE RULE\]/);
    assert.match(dyadBlock, /\[이번 턴 장면 지시 - 비공개\]/);

    // Content differs inside SceneDirective only.
    assert.notEqual(sha(prodBlock), sha(dyadBlock));
    assert.match(dyadBlock, new RegExp(ACTIVE_DYAD_SCENE_ENGINE_MOTION.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")));
    // Production engine motion (NPC/world enumeration) replaced.
    assert.doesNotMatch(
      dyadBlock,
      /관계, 단서, 환경, NPC, 세계 반응, 생활 변수, 이전 선택의 결과/
    );
  });

  it("Test 3 — external source withholding", () => {
    const dyad = buildSceneDirective({
      mode: "interactive",
      recentMessages: recent,
      currentUserMessage: recent[1]!.content,
      chatId: 42,
      currentTurn: 1,
      contentKind: "character",
      primaryCharacterName: "라이크",
      // Force NPC-grounded signal so production would often pick npc_action.
      triggeredEventText: "경비 담당자가 등록 절차를 안내한다.",
      sceneFocusPalette: ACTIVE_DYAD_PALETTE,
    });
    const sources = dyad.focusDiagnostics?.resolvedProgressionSources ?? [];
    assert.ok(dyad.focusDiagnostics);
    assert.ok(!sources.includes("NEW_SPEAKING_NPC"));
    assert.ok(!sources.includes("ADMINISTRATIVE_PROCESS"));
    assert.ok(!sources.includes("NEW_EXTERNAL_EVENT"));
    assert.ok(!dyad.progressionTypes.includes("npc_action"));
    assert.ok(!dyad.progressionTypes.includes("world_reaction"));
  });

  it("Test 4 — replacement source presence", () => {
    const dyad = buildSceneDirective({
      mode: "interactive",
      recentMessages: recent,
      currentUserMessage: recent[1]!.content,
      chatId: 77,
      currentTurn: 2,
      contentKind: "character",
      primaryCharacterName: "라이크",
      sceneFocusPalette: ACTIVE_DYAD_PALETTE,
    });
    const sources = dyad.focusDiagnostics?.resolvedProgressionSources ?? [];
    assert.ok(
      sources.includes("PRIMARY_DECISION") || sources.includes("PRIMARY_ACTION"),
      `expected PRIMARY_DECISION/ACTION in ${JSON.stringify(sources)}`
    );
    assert.ok(
      sources.includes("RELATIONSHIP_MOVEMENT") ||
        sources.includes("EXISTING_ENVIRONMENT"),
      `expected RELATIONSHIP_MOVEMENT/EXISTING_ENVIRONMENT in ${JSON.stringify(sources)}`
    );
  });

  it("Test 5 — beat count preservation", () => {
    // Run several seeds — resolvedBeatCount must never drop below requested.
    for (const chatId of [1, 2, 3, 11, 99, 1001]) {
      const dyad = buildSceneDirective({
        mode: "interactive",
        recentMessages: recent,
        currentUserMessage: recent[1]!.content,
        chatId,
        currentTurn: 1,
        contentKind: "character",
        primaryCharacterName: "라이크",
        triggeredEventText: "방문객과 직원이 서류를 들고 다가온다.",
        sceneFocusPalette: ACTIVE_DYAD_PALETTE,
      });
      const d = dyad.focusDiagnostics!;
      assert.ok(d.resolvedBeatCount >= d.requestedBeatCount);
      assert.equal(d.replacementSources.length, d.externalSourcesWithheld.length);
      assert.equal(d.resolvedBeatCount, dyad.progressionTypes.length);
    }
  });

  it("canary helper: ACTIVE_DYAD for first 2 turns; null after; env override for STALLING", () => {
    const saved = {
      e: process.env[RP_DIAGNOSTIC_CANARY_ENV.ENABLED],
      u: process.env[RP_DIAGNOSTIC_CANARY_ENV.USER_IDS],
      m: process.env[RP_DIAGNOSTIC_CANARY_ENV.MODEL_IDS],
      v: process.env[RP_DIAGNOSTIC_CANARY_ENV.VARIANT],
      s: process.env[RP_DIAGNOSTIC_CANARY_ENV.SCENE_FOCUS_STATE],
    };
    try {
      process.env[RP_DIAGNOSTIC_CANARY_ENV.ENABLED] = "true";
      process.env[RP_DIAGNOSTIC_CANARY_ENV.USER_IDS] = "34";
      process.env[RP_DIAGNOSTIC_CANARY_ENV.MODEL_IDS] = "deepseek-v4-pro";
      process.env[RP_DIAGNOSTIC_CANARY_ENV.VARIANT] = "structured_scene_focus_active_dyad";
      delete process.env[RP_DIAGNOSTIC_CANARY_ENV.SCENE_FOCUS_STATE];

      const canary = resolveRpDiagnosticCanary({
        userId: 34,
        modelId: "deepseek-v4-pro",
        contentKind: "character",
      });
      assert.ok(canary);
      assert.equal(rpDiagnosticUsesStructuredSceneFocus(canary!.variant), true);
      assert.equal(
        resolveCanarySceneFocusState({ canary, completedTurns: 0 }),
        "ACTIVE_DYAD"
      );
      assert.equal(
        resolveCanarySceneFocusState({ canary, completedTurns: 1 }),
        "ACTIVE_DYAD"
      );
      assert.equal(resolveCanarySceneFocusState({ canary, completedTurns: 2 }), null);
      assert.ok(resolveCanarySceneFocusPalette({ canary, completedTurns: 0 }));

      process.env[RP_DIAGNOSTIC_CANARY_ENV.SCENE_FOCUS_STATE] = "STALLING";
      assert.equal(
        resolveCanarySceneFocusState({ canary, completedTurns: 2 }),
        "STALLING"
      );
    } finally {
      for (const [k, v] of Object.entries({
        [RP_DIAGNOSTIC_CANARY_ENV.ENABLED]: saved.e,
        [RP_DIAGNOSTIC_CANARY_ENV.USER_IDS]: saved.u,
        [RP_DIAGNOSTIC_CANARY_ENV.MODEL_IDS]: saved.m,
        [RP_DIAGNOSTIC_CANARY_ENV.VARIANT]: saved.v,
        [RP_DIAGNOSTIC_CANARY_ENV.SCENE_FOCUS_STATE]: saved.s,
      })) {
        if (v === undefined) delete process.env[k];
        else process.env[k] = v;
      }
    }
  });
});
