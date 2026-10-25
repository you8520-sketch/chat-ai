import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { classifyChatOocIntent } from "@/lib/chatOocPriority";
import {
  CANONICAL_GENERATION_SEMANTICS,
  filterCanonicalMessageRows,
  nextPersistedModelRouteState,
  resolveGenerationSemantics,
  resolveOocSceneRenderIntent,
  shouldCommitCanonicalTurnState,
} from "@/lib/oocSceneRender";
import { resolveAutoContinueHistoryTurns } from "@/lib/continueNarrative";
import { messagesToTurns } from "@/lib/hybridMemory";
import { isTurnEligibleForMemoryRecord } from "./memory-ooc-filter";
import { shouldRequestEpisodicInSharedInitial } from "./memory-episodic-shared";
import {
  classifyMemoryBatchScopes,
  classifyMemoryTurnScope,
  resolveEpisodicTurnEligibility,
  selectEpisodicEligibleTurnEntries,
  type TurnScopeClass,
} from "./memory-summary-scope";

const cases: Array<{ label: string; user: string; canonical: boolean; scope: TurnScopeClass }> = [
  {
    label: "exact GPT review case",
    user: "[OOC: 현재 에피소드 중단. 새 에피소드 시작. 본편과 별개로 캐릭터 설정에 맞는 샘플 장면을 보여줘.]",
    canonical: false, scope: "plain_ooc",
  },
  {
    label: "본편과 별개 without a sample keyword",
    user: "[OOC: 새 에피소드 시작. 본편과 별개로 캐릭터 설정에 맞는 축제 장면을 보여줘.]",
    canonical: false, scope: "plain_ooc",
  },
  {
    label: "샘플 장면 without a separate-main keyword",
    user: "[OOC: 새 에피소드 시작. 캐릭터 설정에 맞는 샘플 장면을 보여줘.]",
    canonical: false, scope: "plain_ooc",
  },
  {
    label: "explicit 비정사 외전, reset itself requests the new scene",
    user: "[OOC: 새 에피소드 시작. 비정사 외전으로 캐릭터 설정을 참고해 축제를 서술해.]",
    canonical: false, scope: "meaningful_noncanon",
  },
  {
    label: "ordinary T80-like scene reset without isolation",
    user: "[OOC: 현재 에피소드 중단. 새 에피소드 시작. 캐릭터 설정과 세계관을 참고해 축제에서 선물을 건네는 장면을 서술해.]",
    canonical: true, scope: "main_rp",
  },
];

describe("scene reset control and canonical isolation share the existing owners", () => {
  for (const fixture of cases) {
    it(`${fixture.label}: summary and Episodic admission`, () => {
      assert.equal(classifyChatOocIntent(fixture.user), "rp_scene_reset");
      for (const previousWasNoncanonOrBranch of [false, true]) {
        const opts = { previousWasNoncanonOrBranch };
        assert.equal(classifyMemoryTurnScope(fixture.user, opts), fixture.scope);
        assert.equal(resolveEpisodicTurnEligibility(fixture.user, opts).eligible, fixture.canonical);
        assert.equal(shouldRequestEpisodicInSharedInitial({
          userMessage: fixture.user, memoryFeatureEnabled: true, ...opts,
        }), fixture.canonical);
        const entries = [{ turnIndex: 80, turn: { user: fixture.user, assistant: "축제의 장면." } }];
        assert.equal(classifyMemoryBatchScopes(entries, opts).mainTurns.length, fixture.canonical ? 1 : 0);
        assert.equal(selectEpisodicEligibleTurnEntries(entries, opts).length, fixture.canonical ? 1 : 0);
      }
      assert.equal(isTurnEligibleForMemoryRecord(fixture.user), fixture.canonical);
    });

    it(`${fixture.label}: generation metadata and canonical state commit`, () => {
      assert.equal(resolveOocSceneRenderIntent(fixture.user), !fixture.canonical);
      const semantics = resolveGenerationSemantics({ userMessage: fixture.user });
      assert.equal(semantics.canonical, fixture.canonical);
      assert.equal(shouldCommitCanonicalTurnState(semantics), fixture.canonical);
      assert.equal(nextPersistedModelRouteState("previous", "advanced", semantics), fixture.canonical ? "advanced" : "previous");
      // Regen of a formerly canonical row re-evaluates the original source text.
      assert.equal(resolveGenerationSemantics({
        userMessage: fixture.user, inherited: CANONICAL_GENERATION_SEMANTICS,
      }).canonical, fixture.canonical);
      if (!fixture.canonical) {
        assert.equal(resolveGenerationSemantics({ userMessage: "다시 써줘.", inherited: semantics }).canonical, false);
      }
    });
  }

  it("isolation beats inherited branch continuation without opening a new main scene", () => {
    const user = "[OOC: 새 에피소드 시작. 본편과 별개인 샘플 장면을 보여줘. 그대로 계속 진행해.]";
    assert.equal(classifyMemoryTurnScope(user, { previousWasNoncanonOrBranch: true }), "plain_ooc");
    assert.equal(resolveGenerationSemantics({ userMessage: user }).canonical, false);
  });

  it("legacy isolated pairs stay out of continuation; explicit return resumes main", () => {
    const rows = [
      { id: 1, role: "user" as const, content: "광장으로 간다.", model: "user" },
      { id: 2, role: "assistant" as const, content: "본편의 광장.", model: "test", user_message_id: 1 },
      { id: 3, role: "user" as const, content: cases[0]!.user, model: "user" },
      { id: 4, role: "assistant" as const, content: "별개 장면의 사건.", model: "test", user_message_id: 3 },
    ];
    const canonical = filterCanonicalMessageRows(rows);
    assert.deepEqual(canonical.map((row) => row.id), [1, 2]);
    const continued = resolveAutoContinueHistoryTurns(messagesToTurns(canonical));
    assert.equal(continued.historyTurns.length, 1);
    assert.equal(continued.historyTurns[0]!.assistant, "본편의 광장.");
    const returnToMain = "(OOC: 본편으로 돌아가자. IF 종료.)";
    assert.equal(classifyMemoryTurnScope(returnToMain), "branch_close");
    assert.equal(resolveGenerationSemantics({ userMessage: returnToMain }).canonical, true);
    assert.equal(classifyMemoryTurnScope("광장을 다시 걸어간다."), "main_rp");
  });

  it("pure settings, HTML mocks, and hard stops retain their exclusions", () => {
    for (const user of [
      "(OOC: HTML로 SNS UI mockup 보여줘)",
      "(OOC: 문체를 더 짧게 써줘)",
      "OOC: 여기서 RP 끝. 더 이상 장면 진행하지 마.",
    ]) {
      const entries = [{ turnIndex: 1, turn: { user, assistant: "조정 응답." } }];
      assert.equal(classifyMemoryBatchScopes(entries).mainTurns.filter(({ turn }) => isTurnEligibleForMemoryRecord(turn.user)).length, 0);
      assert.equal(resolveOocSceneRenderIntent(user), false);
    }
  });
});
