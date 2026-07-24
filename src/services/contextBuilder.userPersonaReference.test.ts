import assert from "node:assert/strict";
import { describe, it } from "node:test";

import { buildContext } from "./contextBuilder";

function build(
  gender: "male" | "female" | "other",
  overrides: { isContinue?: boolean; regenerate?: boolean } = {}
) {
  return buildContext({
    charName: "히유",
    contentKind: "character",
    chunks: [],
    userNickname: "계정 닉네임",
    personaDisplayName: "렌",
    userPersona: `이름/호칭: 렌\n성별: ${gender}`,
    userPersonaGender: gender,
    shortTermHistory: [],
    currentUserMessage: overrides.isContinue ? "continue" : "문을 연다.",
    nsfw: false,
    provider: "openrouter",
    narrativePov: { mode: "third_person", povCharacterName: "히유" },
    ...overrides,
  });
}

describe("contextBuilder user persona reference owner", () => {
  it("injects exactly one current-turn owner on main, continue, and regenerate", () => {
    for (const built of [
      build("female"),
      build("female", { isContinue: true }),
      build("female", { regenerate: true }),
    ]) {
      assert.equal(
        (built.systemPrompt.match(/\[USER PERSONA REFERENCE OWNER — CURRENT TURN\]/g) ?? [])
          .length,
        1
      );
      assert.doesNotMatch(
        built.openRouterSystemSplit?.systemRulesBlock ?? "",
        /\[USER PERSONA REFERENCE OWNER/
      );
      assert.match(
        built.openRouterSystemSplit?.dynamicBlock ?? "",
        /\[USER PERSONA REFERENCE OWNER/
      );
      assert.equal((built.systemPrompt.match(/확정 성별: 여성/g) ?? []).length, 1);
      assert.doesNotMatch(built.systemPrompt, /\[사용자 페르소나 성별:/);
      assert.doesNotMatch(built.systemPrompt, /\[성별 최종 확인/);
    }
  });

  it("uses the selected persona name and gender rather than the account nickname", () => {
    const built = build("male");
    assert.match(built.systemPrompt, /이름\/호칭: 렌\. 확정 성별: 남성/);
    assert.doesNotMatch(
      built.openRouterSystemSplit?.dynamicBlock ?? "",
      /이름\/호칭: 계정 닉네임/
    );
  });

  it("keeps the reference owner close to and independent from the POV owner", () => {
    const built = build("female");
    const dynamic = built.openRouterSystemSplit?.dynamicBlock ?? "";
    const referenceIndex = dynamic.indexOf("[USER PERSONA REFERENCE OWNER");
    const povIndex = dynamic.indexOf("[NARRATIVE POV OWNER");
    assert.ok(referenceIndex >= 0);
    assert.ok(povIndex > referenceIndex);
    assert.match(dynamic, /Speech Lock/);
    assert.match(dynamic, /No Godmodding/);
  });
});
