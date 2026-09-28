#!/usr/bin/env npx tsx
import assert from "node:assert/strict";
import { buildContext } from "../../src/services/contextBuilder";
import { COLLABORATIVE_INTERACTIVE_OWNER_TITLE } from "../../src/lib/noGodmodding";
import { OPENROUTER_DEEPSEEK_V4_PRO_MODEL } from "../../src/lib/chatModels";
import {
  CANONICAL_RP_QUALIFICATION_SOURCE,
  RP_QUALIFICATION_SITE_POLICY_OWNERS,
  STANDARD_INTERACTIVE_REVIEW_EXAMPLES,
  buildCanonicalRpQualificationCases,
  buildCanonicalRpQualificationContextInput,
  loadCanonicalRpQualificationFixture,
} from "./rpModelQualificationFixture";

function count(text: string, needle: string): number {
  return text.split(needle).length - 1;
}

function main() {
  const fixture = loadCanonicalRpQualificationFixture();
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
    ]
  );
  assert.equal(cases[0]!.currentUserMessage, fixture.productionTurn1User);

  // Current-main runtime policy, not the reviewer's personal standard, owns the
  // user-character boundary used to grade candidate outputs.
  const contextInput = buildCanonicalRpQualificationContextInput({
    modelId: OPENROUTER_DEEPSEEK_V4_PRO_MODEL,
    caseData: cases[1]!,
    provider: "cheaperinference",
  });
  const built = buildContext(contextInput);
  assert.equal(count(built.systemPrompt, COLLABORATIVE_INTERACTIVE_OWNER_TITLE), 1);
  assert.match(built.systemPrompt, /USER_PERSONA.*외형·등급·능력·직업·소속·성격·과거/s);
  assert.match(
    built.systemPrompt,
    /짧은 표정·시선·비자발적 반응.*사소한 이동·접촉·물건 수취·일상 행동/s
  );
  assert.match(
    built.systemPrompt,
    /새로운 직접 대사, 중요한 선택·동의·거절, 관계·목표·소속·정체성을 바꾸는 결정/
  );
  assert.match(built.systemPrompt, /기계사용에 서툼/);
  assert.match(built.systemPrompt, /고개를 갸웃거림/);

  assert.equal(
    RP_QUALIFICATION_SITE_POLICY_OWNERS.standardInteractive,
    "src/lib/noGodmodding.ts#COLLABORATIVE_INTERACTIVE_OWNER_BLOCK"
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

  console.log(
    JSON.stringify(
      {
        ok: true,
        source: CANONICAL_RP_QUALIFICATION_SOURCE,
        case_ids: cases.map((c) => c.id),
        current_policy_owner: RP_QUALIFICATION_SITE_POLICY_OWNERS.standardInteractive,
        provider_calls: 0,
      },
      null,
      2
    )
  );
}

main();
