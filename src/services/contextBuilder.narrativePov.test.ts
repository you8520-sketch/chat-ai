import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { buildRecoveryContinuationSystemPrompt } from "@/lib/turnApiBudget";
import { buildContext } from "./contextBuilder";

function build(overrides: { isContinue?: boolean; regenerate?: boolean } = {}) {
  return buildContext({
    charName: "회색 생태권",
    contentKind: "simulation",
    chunks: [],
    userNickname: "렌",
    shortTermHistory: [],
    currentUserMessage: overrides.isContinue ? "continue" : "문을 연다.",
    nsfw: false,
    provider: "openrouter",
    narrativePov: { mode: "first_person", povCharacterName: "서윤" },
    ...overrides,
  });
}

describe("contextBuilder narrative POV owner", () => {
  it("injects exactly one owner on main, continue, and regenerate", () => {
    for (const built of [build(), build({ isContinue: true }), build({ regenerate: true })]) {
      assert.equal((built.systemPrompt.match(/\[NARRATIVE POV OWNER:/g) ?? []).length, 1);
      assert.match(built.systemPrompt, /FIRST PERSON — POV CHARACTER: 서윤/);
    }
  });

  it("recovery keeps the inherited owner instead of resolving another POV", () => {
    const recoverySystem = `${build().systemPrompt}\n\n${buildRecoveryContinuationSystemPrompt()}`;
    assert.equal((recoverySystem.match(/\[NARRATIVE POV OWNER:/g) ?? []).length, 1);
    assert.match(recoverySystem, /Preserve the already resolved \[NARRATIVE POV OWNER\] unchanged/);
  });
});
