#!/usr/bin/env npx tsx
import assert from "node:assert/strict";
import { buildContext } from "../../src/services/contextBuilder";
import {
  COLLABORATIVE_INTERACTIVE_OWNER_TITLE,
  USER_COAUTHOR_OWNER_TITLE,
} from "../../src/lib/noGodmodding";
import { CHEAPER_INFERENCE_DEEPSEEK_V41_FLASH_MODEL } from "../../src/lib/chatModels";
import {
  CANONICAL_RP_QUALIFICATION_SOURCE,
  COMMON_PROSE_BODY_CUE_PAIRWISE_REVIEW_SEED_IDS,
  COMMON_PROSE_BODY_CUE_REVIEW_SCENE_SEEDS,
  RP_QUALIFICATION_SITE_POLICY_OWNERS,
  STANDARD_INTERACTIVE_REVIEW_EXAMPLES,
  buildCanonicalRpQualificationCases,
  buildCanonicalRpQualificationContextInput,
  buildGreetingBodyCueReviewCases,
  loadCanonicalRpQualificationFixture,
} from "./rpModelQualificationFixture";

function count(text: string, needle: string): number {
  return text.split(needle).length - 1;
}

function main() {
  const fixture = loadCanonicalRpQualificationFixture();
  assert.equal(CANONICAL_RP_QUALIFICATION_SOURCE.fixtureKind, "HISTORICAL_ONLY");
  assert.equal(CANONICAL_RP_QUALIFICATION_SOURCE.currentMainRpStyleLengthUse, false);
  assert.equal(CANONICAL_RP_QUALIFICATION_SOURCE.sourceCharacterId, 10);
  assert.equal(CANONICAL_RP_QUALIFICATION_SOURCE.characterName, "라이크");
  assert.equal(CANONICAL_RP_QUALIFICATION_SOURCE.personaName, "렌");

  // Real production snapshot identity — fail closed on source drift.
  assert.match(fixture.characterSetting, /조태형/);
  assert.match(fixture.characterSetting, /라이크/);
  assert.match(fixture.persona, /이름\/호칭:\s*렌/);
  assert.match(fixture.persona, /신입 S급 가이드/);

  // Persona facts that must NOT be misclassified as hallucination merely because
  // the candidate model narrates a canon-consistent visible state.
  assert.match(fixture.persona, /기계사용에 서툼/);
  assert.match(fixture.persona, /고개를 갸웃거림/);
  assert.match(fixture.persona, /과일/);
  assert.match(fixture.persona, /길거리 음식/);

  const cases = buildCanonicalRpQualificationCases();
  assert.deepEqual(
    cases.map((c) => c.id),
    [
      "production_midchat_t1",
      "persona_grounded_reaction",
      "agency_boundary",
      "false_canon_trap",
      "memory_current_state_priority",
      "memory_false_shared_event",
    ]
  );
  assert.equal(cases[0]!.currentUserMessage, fixture.productionTurn1User);
  assert.match(cases[4]!.memory?.longTermMemory ?? "", /이행되어 종료/);
  assert.match(cases[4]!.memory?.memoryMeta ?? "", /다음 정기 검진 날 넥서스 로비/);
  assert.match(cases[5]!.memory?.episodicMemoryBlock ?? "", /복잡한 단말기를 잘못 조작/);
  assert.doesNotMatch(cases[5]!.memory?.episodicMemoryBlock ?? "", /반지/);

  // Current-main runtime policy, not the reviewer's personal standard, owns the
  // user-character boundary used to grade candidate outputs.
  const contextInput = buildCanonicalRpQualificationContextInput({
    modelId: CHEAPER_INFERENCE_DEEPSEEK_V41_FLASH_MODEL,
    caseData: cases[1]!,
    provider: "cheaperinference",
  });
  const built = buildContext(contextInput);
  assert.equal(count(built.systemPrompt, COLLABORATIVE_INTERACTIVE_OWNER_TITLE), 0);
  assert.ok(count(built.systemPrompt, USER_COAUTHOR_OWNER_TITLE) >= 1);
  assert.match(
    built.systemPrompt,
    /\[B\]의 직접 대사와 외부에서 관찰 가능한 중요한 행동을 페르소나에 맞게 공동 서술할 수 있다/
  );
  assert.match(
    built.systemPrompt,
    /비공개 속마음·내면 독백·숨은 욕망을 객관적 사실로 쓰지 않는다/
  );
  assert.match(
    built.systemPrompt,
    /사망·영구 상실·정체성·장기 관계·소속 같은 불가역 정본 변경도 대신 확정하지 않는다/
  );
  assert.match(built.systemPrompt, /기계사용에 서툼/);
  assert.match(built.systemPrompt, /고개를 갸웃거림/);

  assert.equal(
    RP_QUALIFICATION_SITE_POLICY_OWNERS.standardInteractive,
    "src/lib/userCoauthorState.ts#resolveEffectiveUserAuthoring + src/lib/noGodmodding.ts#buildUserCoauthorOwnerBlock"
  );
  assert.ok(
    STANDARD_INTERACTIVE_REVIEW_EXAMPLES.allowedWhenGrounded.some((x) =>
      x.includes("USER_PERSONA")
    )
  );
  assert.ok(
    STANDARD_INTERACTIVE_REVIEW_EXAMPLES.notAllowedWithoutDelegation.some((x) =>
      x.includes("fabricated prior event")
    )
  );

  assert.deepEqual(
    COMMON_PROSE_BODY_CUE_REVIEW_SCENE_SEEDS.map((seed) => seed.id),
    ["quiet_window_safe", "conflict_action_spatial_safe", "relationship_turn_safe"]
  );
  assert.deepEqual(
    [...COMMON_PROSE_BODY_CUE_PAIRWISE_REVIEW_SEED_IDS],
    ["quiet_window_safe", "relationship_turn_safe"]
  );
  const greetingCases = buildGreetingBodyCueReviewCases("현재 라이크 인사");
  assert.deepEqual(
    greetingCases.map((row) => row.id),
    ["quiet_window_safe", "conflict_action_spatial_safe", "relationship_turn_safe"]
  );
  const spatial = greetingCases.find((row) => row.id === "conflict_action_spatial_safe");
  assert.equal(spatial?.history[1]?.content, "현재 라이크 인사");
  assert.match(spatial?.currentUserMessage ?? "", /숙소 앞 복도/);
  assert.doesNotMatch(spatial?.currentUserMessage ?? "", /한서린|\b민\b|B16/);
  const pairwise = buildGreetingBodyCueReviewCases(
    "현재 라이크 인사",
    COMMON_PROSE_BODY_CUE_PAIRWISE_REVIEW_SEED_IDS
  );
  assert.deepEqual(
    pairwise.map((row) => row.id),
    ["quiet_window_safe", "relationship_turn_safe"]
  );

  console.log(
    JSON.stringify(
      {
        ok: true,
        source: CANONICAL_RP_QUALIFICATION_SOURCE,
        case_ids: cases.map((c) => c.id),
        current_policy_owner: RP_QUALIFICATION_SITE_POLICY_OWNERS.standardInteractive,
        ordinary_input_authoring_level: "NORMAL",
        provider_calls: 0,
      },
      null,
      2
    )
  );
}

main();
