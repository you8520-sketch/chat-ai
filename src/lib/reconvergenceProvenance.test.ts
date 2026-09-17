/**
 * PROV1–7, PARITY1–4, PART1–5: reconvergence provenance + transition parity gates.
 */
import assert from "node:assert/strict";
import { describe, it } from "node:test";

import {
  advanceReconvergenceState,
  defaultReconvergenceState,
  detectPartingIntent,
  extractReconvergenceHooks,
  prepareReconvergenceTransition,
} from "@/lib/reconvergenceState";
import { ensureReconvergenceSchema } from "@/lib/reconvergenceSchema";
import {
  buildSceneDirectiveV2,
  getUpdatedReconvergenceStateFromBuild,
} from "@/lib/sceneDirectiveV2";
import Database from "better-sqlite3";

const R1_USER = "오늘은 여기까지. 들어가.";

function canonicalEvidence(overrides: Record<string, unknown> = {}) {
  return {
    mode: "interactive" as const,
    recentMessages: [{ role: "user" as const, content: R1_USER }],
    currentUserMessage: R1_USER,
    memoryText: "우리 관계는 오래된 지인이다.",
    relationshipMemoryText: "",
    lorebookText:
      "두 사람은 같은 팀에서 통신 단말기를 사용하며 기지에서 함께 근무한다.",
    triggeredEventText: "",
    reconvergenceState: defaultReconvergenceState(1, 1),
    currentTurn: 1,
    isRegenerate: false,
    ...overrides,
  };
}

describe("PROV1–7 static context provenance", () => {
  it("PROV1 static lorebook alone cannot originate active unresolved hook", () => {
    const hooks = extractReconvergenceHooks({
      currentUserMessage: R1_USER,
      lorebookText:
        "두 사람은 같은 팀에서 통신 단말기를 사용하며 기지에서 함께 근무한다.",
      currentTurn: 1,
    });
    assert.equal(hooks.length, 0);
  });

  it("PROV2 static memory alone cannot originate active unresolved hook", () => {
    const hooks = extractReconvergenceHooks({
      memoryText: "우리 관계는 오래된 지인이다.",
      currentTurn: 1,
    });
    assert.equal(hooks.length, 0);
  });

  it("PROV3 cross-source relation marker + unrelated location cannot combine", () => {
    const hooks = extractReconvergenceHooks({
      memoryText: "우리 관계는 오래된 지인이다.",
      lorebookText: "도시 중앙에는 병원이 있다.",
      currentTurn: 1,
    });
    assert.equal(hooks.length, 0);
  });

  it("PROV4 assistant speculation remains excluded", () => {
    const hooks = extractReconvergenceHooks({
      recentMessages: [
        { role: "user", content: R1_USER },
        { role: "assistant", content: "내일 회의 일정을 확인해 볼게. 코트는 내가 맡아둘게." },
      ],
      currentUserMessage: R1_USER,
      currentTurn: 1,
    });
    assert.equal(hooks.some((h) => h.type === "confirmed_schedule"), false);
    assert.equal(hooks.some((h) => h.type === "shared_item"), false);
  });

  it("PROV5 real current-user shared item remains detected", () => {
    const hooks = extractReconvergenceHooks({
      recentMessages: [{ role: "user", content: "코트 맡아줘. 다음에 받을게." }],
      currentUserMessage: "먼저 갈게.",
      currentTurn: 1,
    });
    assert.ok(hooks.some((h) => h.type === "shared_item"));
  });

  it("PROV6 real current-user confirmed schedule remains detected", () => {
    const hooks = extractReconvergenceHooks({
      currentUserMessage: "그럼 내일 점심 회의 일정 확정이야.",
      currentTurn: 1,
    });
    assert.ok(hooks.some((h) => h.type === "confirmed_schedule"));
  });

  it("PROV7 active authoritative trigger remains usable", () => {
    const hooks = extractReconvergenceHooks({
      currentUserMessage: "잠깐 쉰다.",
      triggeredEventText: "내일 오전 회의 일정이 확정되었다.",
      currentTurn: 2,
    });
    assert.ok(hooks.some((h) => h.type === "confirmed_schedule"));
  });
});

describe("PART1–PART5 parting detector", () => {
  const cases: Array<[string, string, boolean]> = [
    ["PART1", "오늘은 여기까지. 들어가.", true],
    ["PART2", "여기까지 왔다.", false],
    ["PART3", "여기까지 따라와.", false],
    ["PART4", "길이 여기까지 이어진다.", false],
    ["PART5", "설명은 여기까지 할게.", true],
  ];
  for (const [name, msg, expected] of cases) {
    it(`${name}`, () => {
      assert.equal(detectPartingIntent(msg), expected);
    });
  }
});

describe("PARITY1–4 transition input parity", () => {
  it("PARITY1 build and persistence use identical canonical evidence input", () => {
    const evidence = canonicalEvidence();
    const built = buildSceneDirectiveV2(evidence);
    const buildUpdated = getUpdatedReconvergenceStateFromBuild(evidence, built);
    const persistAdv = advanceReconvergenceState({
      previous: evidence.reconvergenceState,
      currentTurn: evidence.currentTurn,
      currentUserMessage: evidence.currentUserMessage,
      recentMessages: evidence.recentMessages,
      memoryText: evidence.memoryText,
      relationshipMemoryText: evidence.relationshipMemoryText,
      lorebookText: evidence.lorebookText,
      triggeredEventText: evidence.triggeredEventText,
    });
    assert.deepEqual(
      buildUpdated.unresolvedHooks.map((h) => h.type),
      persistAdv.state.unresolvedHooks.map((h) => h.type)
    );
  });

  it("PARITY2 same turn => same unresolvedHooks (prepare vs build)", () => {
    const db = new Database(":memory:");
    ensureReconvergenceSchema(db);
    const evidence = canonicalEvidence();
    const built = buildSceneDirectiveV2(evidence);
    const buildUpdated = getUpdatedReconvergenceStateFromBuild(evidence, built);
    const pending = prepareReconvergenceTransition({
      namespace: "production",
      chatId: 1,
      characterId: 1,
      currentTurn: evidence.currentTurn,
      currentUserMessage: evidence.currentUserMessage,
      recentMessages: evidence.recentMessages,
      memoryText: evidence.memoryText,
      relationshipMemoryText: evidence.relationshipMemoryText,
      lorebookText: evidence.lorebookText,
      triggeredEventText: evidence.triggeredEventText,
      requestId: "parity2",
      previousOverride: evidence.reconvergenceState,
      db,
    });
    assert.deepEqual(
      pending.next.unresolvedHooks.map((h) => h.type),
      buildUpdated.unresolvedHooks.map((h) => h.type)
    );
    db.close();
  });

  it("PARITY3 same turn => same lifecycle state", () => {
    const evidence = canonicalEvidence();
    const built = buildSceneDirectiveV2(evidence);
    const buildUpdated = getUpdatedReconvergenceStateFromBuild(evidence, built);
    const persistAdv = advanceReconvergenceState({
      previous: evidence.reconvergenceState,
      currentTurn: evidence.currentTurn,
      currentUserMessage: evidence.currentUserMessage,
      recentMessages: evidence.recentMessages,
      memoryText: evidence.memoryText,
      relationshipMemoryText: evidence.relationshipMemoryText,
      lorebookText: evidence.lorebookText,
      triggeredEventText: evidence.triggeredEventText,
    });
    assert.equal(buildUpdated.state, persistAdv.state.state);
  });

  it("PARITY4 same turn => same reconvergenceDue semantics on parting", () => {
    const evidence = canonicalEvidence();
    const built = buildSceneDirectiveV2(evidence);
    getUpdatedReconvergenceStateFromBuild(evidence, built);
    const persistAdv = advanceReconvergenceState({
      previous: evidence.reconvergenceState,
      currentTurn: evidence.currentTurn,
      currentUserMessage: evidence.currentUserMessage,
      recentMessages: evidence.recentMessages,
      memoryText: evidence.memoryText,
      relationshipMemoryText: evidence.relationshipMemoryText,
      lorebookText: evidence.lorebookText,
      triggeredEventText: evidence.triggeredEventText,
    });
    assert.equal(persistAdv.state.state, "separated");
    assert.equal(persistAdv.reconvergenceDue, false);
    assert.ok(persistAdv.reasonCodes.includes("SEPARATED_CONFIRMED"));
    assert.equal(built.pacingDecision, "hold_current_beat");
  });
});

describe("past lorebook narrative (CASE C)", () => {
  it("does not become active unresolved hook", () => {
    const hooks = extractReconvergenceHooks({
      lorebookText: "예전에 카페에서 함께 만난 적이 있다.",
      currentTurn: 1,
    });
    assert.equal(hooks.length, 0);
  });
});
