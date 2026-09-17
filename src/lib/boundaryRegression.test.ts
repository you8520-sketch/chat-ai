/**
 * BOUND1–BOUND10: location hook + boundary execution contract regression.
 */
import assert from "node:assert/strict";
import { describe, it } from "node:test";

import { SCENE_POLICY_BENCHMARK_FIXTURES } from "@/lib/scenePolicyBenchmarkDataset";
import {
  advanceV2ReconvergenceForBenchmark,
  buildScenePolicyInputFromFixture,
} from "@/lib/scenePolicyBenchmarkHarness";
import {
  buildSceneDirectiveV2,
  renderSceneDirectiveV2ForPrompt,
  resolveBoundaryExecutionContract,
} from "@/lib/sceneDirectiveV2";
import {
  advanceReconvergenceState,
  defaultReconvergenceState,
  extractReconvergenceHooks,
  hasSharedLocationReconvergenceEvidence,
  prepareReconvergenceTransition,
} from "@/lib/reconvergenceState";
import { ensureReconvergenceSchema } from "@/lib/reconvergenceSchema";
import Database from "better-sqlite3";

describe("boundary regression BOUND1–BOUND10", () => {
  it("BOUND1 solo arrival does not create known_shared_location", () => {
    assert.equal(hasSharedLocationReconvergenceEvidence("집에 도착했다."), false);
    const hooks = extractReconvergenceHooks({
      currentUserMessage: "집에 도착했다.",
      currentTurn: 2,
    });
    assert.equal(hooks.some((h) => h.type === "known_shared_location"), false);
  });

  it("BOUND2 explicit shared meeting creates location evidence", () => {
    const msg = "우리 둘 다 그 카페에서 만나자.";
    assert.equal(hasSharedLocationReconvergenceEvidence(msg), true);
    const hooks = extractReconvergenceHooks({
      currentUserMessage: msg,
      currentTurn: 1,
    });
    assert.ok(hooks.some((h) => h.type === "known_shared_location"));
  });

  it("BOUND3 찾아오지 마 blocks physical approach in contract", () => {
    const contract = resolveBoundaryExecutionContract({
      lifecycle: "temporary_quiet",
      noContactKind: "temporary_quiet",
      currentUserMessage: "오늘은 그만. 찾아오지 마.",
    });
    assert.ok(contract);
    assert.equal(contract!.blocksPhysicalApproach, true);
  });

  it("BOUND4 혼자 있고 싶어 allows routine, blocks gift/drop-off", () => {
    const contract = resolveBoundaryExecutionContract({
      lifecycle: "temporary_quiet",
      noContactKind: "temporary_quiet",
      currentUserMessage: "혼자 있고 싶어.",
    });
    assert.ok(contract);
    assert.equal(contract!.allowsIndependentRoutine, true);
    assert.equal(contract!.blocksGiftOrDropOff, true);
  });

  it("BOUND5 연락하지 마 blocks remote contact and clarification demand", () => {
    const contract = resolveBoundaryExecutionContract({
      lifecycle: "temporary_quiet",
      noContactKind: "temporary_quiet",
      currentUserMessage: "연락하지 마.",
    });
    assert.ok(contract);
    assert.equal(contract!.blocksRemoteContact, true);
    assert.equal(contract!.blocksBoundaryNegotiation, true);
  });

  it("BOUND6 assistant schedule question does not create durable hook", () => {
    const hooks = extractReconvergenceHooks({
      recentMessages: [{ role: "assistant", content: "내일 오전 회의 일정표를 확인할까요?" }],
      currentUserMessage: "…",
      currentTurn: 2,
    });
    assert.equal(hooks.some((h) => h.type === "confirmed_schedule"), false);
  });

  it("BOUND7 assistant item mention does not create shared_item", () => {
    const hooks = extractReconvergenceHooks({
      recentMessages: [{ role: "assistant", content: "서류 봉투를 책상에 올려둔다." }],
      currentUserMessage: "고마워.",
      currentTurn: 2,
    });
    assert.equal(hooks.some((h) => h.type === "shared_item"), false);
  });

  it("BOUND8 B13 user shared item preserved", () => {
    const fixture = SCENE_POLICY_BENCHMARK_FIXTURES.find((f) => f.id === "B13a")!;
    const input = buildScenePolicyInputFromFixture(fixture);
    const { nextState } = advanceV2ReconvergenceForBenchmark({
      policyInput: input,
      previousState: fixture.reconvergenceState,
    });
    assert.ok(nextState.unresolvedHooks.some((h) => h.type === "shared_item"));
  });

  it("BOUND9 user-confirmed schedule preserved", () => {
    const hooks = extractReconvergenceHooks({
      currentUserMessage: "내일 점심 회의 일정 확정이야.",
      currentTurn: 1,
    });
    assert.ok(hooks.some((h) => h.type === "confirmed_schedule"));
  });

  it("BOUND10 authoritative trigger may defer isolation when reunion implied", () => {
    const db = new Database(":memory:");
    ensureReconvergenceSchema(db);
    const base = {
      ...defaultReconvergenceState(1, 1),
      state: "separated" as const,
      separationTurn: 1,
      reconvergenceDueTurn: 3,
      unresolvedHooks: [
        {
          type: "established_contact_channel" as const,
          summary: "연락",
          sourceTurn: 1,
          confidence: "high" as const,
        },
      ],
    };
    const pending = prepareReconvergenceTransition({
      namespace: "production",
      chatId: 1,
      characterId: 1,
      currentTurn: 3,
      currentUserMessage: "잠깐 쉰다.",
      triggeredEventText: "민이 문 앞에 도착했다.",
      triggerPresent: true,
      triggerImpliesReunion: true,
      previousOverride: base,
      requestId: "bound10",
      db,
    });
    assert.ok(
      pending.reasonCodes.includes("TRIGGER_FULFILLED_RECONVERGENCE") ||
        pending.reasonCodes.includes("AUTHORITATIVE_TRIGGER_DEFERRED_RECONVERGENCE")
    );
    db.close();
  });
});

describe("V2 boundary materialization", () => {
  it("R5 temporary_quiet renders boundary contract block, not generic hold", () => {
    const directive = buildSceneDirectiveV2({
      mode: "interactive",
      currentUserMessage: "오늘은 그만. 찾아오지 마.",
      recentMessages: [{ role: "user", content: "오늘은 그만. 찾아오지 마." }],
      currentTurn: 1,
    });
    assert.equal(directive.reconvergenceState.state, "temporary_quiet");
    assert.ok(directive.boundaryExecution);
    assert.equal(directive.pacingDecision, "hold_current_beat");
    assert.equal(directive.eventBudget, 0);
    assert.deepEqual(directive.progressionTypes, []);
    const block = renderSceneDirectiveV2ForPrompt(directive);
    assert.match(block, /분리·침묵·거리 경계/);
    assert.match(block, /방문·재접근/);
    assert.doesNotMatch(block, /현재 행동·접촉·대화·업무를 자연스럽게 이어/);
  });

  it("R1 T2 separated solo activity has no location hook and boundary hold", () => {
    const afterT1 = advanceReconvergenceState({
      previous: defaultReconvergenceState(0, 0),
      currentTurn: 1,
      currentUserMessage: "오늘은 여기까지. 들어가.",
      recentMessages: [{ role: "user", content: "오늘은 여기까지. 들어가." }],
    }).state;
    const t2 = advanceReconvergenceState({
      previous: afterT1,
      currentTurn: 2,
      currentUserMessage: "집에 도착했다.",
      recentMessages: [
        { role: "user", content: "오늘은 여기까지. 들어가." },
        { role: "assistant", content: "고개를 끄덕인다." },
        { role: "user", content: "집에 도착했다." },
      ],
    });
    assert.equal(t2.state.state, "separated");
    assert.equal(t2.state.unresolvedHooks.some((h) => h.type === "known_shared_location"), false);

    const directive = buildSceneDirectiveV2({
      mode: "interactive",
      currentUserMessage: "집에 도착했다.",
      recentMessages: [
        { role: "user", content: "오늘은 여기까지. 들어가." },
        { role: "assistant", content: "고개를 끄덕인다." },
        { role: "user", content: "집에 도착했다." },
      ],
      reconvergenceState: afterT1,
      currentTurn: 2,
    });
    assert.equal(directive.pacingDecision, "hold_current_beat");
    assert.ok(directive.boundaryExecution);
    assert.equal(directive.reconvergenceState.state, "separated");
  });
});
