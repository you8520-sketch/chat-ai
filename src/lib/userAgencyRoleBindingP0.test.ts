import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
  buildNoGodmoddingBlock,
  COLLABORATIVE_INTERACTIVE_OWNER_TITLE,
  CURRENT_TURN_OOC_DELEGATION_OWNER_TITLE,
} from "@/lib/noGodmodding";
import { AUTO_PROGRESSION_BLOCK_TITLE } from "@/lib/autoProgressionRules";
import { GEMINI31_USER_AGENCY_SUPPLEMENT_TITLE } from "@/lib/gemini31UserAgencyAdapter";
import { buildContext } from "@/services/contextBuilder";
import {
  CHEAPER_INFERENCE_DEEPSEEK_V4_PRO_MODEL,
  OPENROUTER_GEMINI_31_PRO_MODEL,
} from "@/lib/chatModels";

const user = "테스트_유저_캐릭터";
const ai = "테스트_AI_캐릭터";

function buildInteractive(
  userMessage: string,
  opts: Partial<Parameters<typeof buildContext>[0]> = {}
) {
  return buildContext({
    charName: ai,
    chunks: [],
    userNickname: user,
    userPersona: `이름/호칭: ${user}`,
    shortTermHistory: [],
    currentUserMessage: userMessage,
    nsfw: false,
    provider: "openrouter",
    isContinue: false,
    novelModeEnabled: false,
    userImpersonation: false,
    personaDisplayName: user,
    completedTurns: 2,
    ...opts,
  });
}

const ROLE_BINDING = "확정된 행동의 주체·대상·방향은 이번 응답의 기준으로 유지한다";
const B_ACTION_STAYS = "시작하거나 완료한 행동은 [B]의 행동으로 두고";
const A_REACTS = "반응·대응·대사·직접 결과를 이어간다";
const RESPONSE_POINT = "[B]가 이어갈 반응점으로 둔다";
const CURRENT_INPUT_PRECEDENCE =
  "현재 입력이 역할·대상·방향 전환을 명시하면 가장 최신 입력의 관계를 기준으로 갱신한다";
const CO_TITLE = "[USER CONTROL MODE - LIMITED CO-NARRATION]";

function assertIncludes(text: string, needle: string, msg?: string): void {
  assert.ok(text.includes(needle), `${msg ?? ""} expected to include: ${needle}`);
}

function ownerOf(built: ReturnType<typeof buildContext>): string {
  const section = built.meta.trackedSections?.find((s) => s.id === "no-godmodding");
  assert.ok(section, "no-godmodding section missing");
  return section!.text;
}

describe("P0 — current-turn role binding / user agency (common standard owner)", () => {
  it("standard owner carries exactly one canonical role-binding semantic owner", () => {
    const owner = buildNoGodmoddingBlock(ai, user, "standard");
    assert.equal(owner.split(COLLABORATIVE_INTERACTIVE_OWNER_TITLE).length - 1, 1);
    assertIncludes(owner, ROLE_BINDING);
    assertIncludes(owner, B_ACTION_STAYS);
    assertIncludes(owner, A_REACTS);
    assertIncludes(owner, RESPONSE_POINT);
    assertIncludes(owner, CURRENT_INPUT_PRECEDENCE);
    assert.doesNotMatch(owner, /top|bottom|공수|삽입|체위/);
  });

  it("A — giver → receiver: B gives object to A stays actor=B target=A", () => {
    const owner = ownerOf(buildInteractive("*[B]가 [A]에게 물건을 건넨다.*"));
    assertIncludes(owner, ROLE_BINDING);
    assert.doesNotMatch(owner, /B의 행동을 A가/);
    assert.doesNotMatch(owner, /A의 행동을 B가/);
  });

  it("B — inverse: A gives object to B is also preserved (no bias)", () => {
    const owner = ownerOf(buildInteractive("*[A]가 [B]에게 물건을 건넨다.*"));
    assertIncludes(owner, ROLE_BINDING);
  });

  it("C — attacker → defender: B attacks A; A may actively defend/counter, ownership kept", () => {
    const owner = ownerOf(buildInteractive("*[B]가 [A]를 공격한다.*"));
    assertIncludes(owner, B_ACTION_STAYS);
    assertIncludes(owner, A_REACTS);
    assertIncludes(owner, "능동적으로 수행한다");
  });

  it("D — healer → patient: B treats A; not flipped to B as patient", () => {
    const owner = ownerOf(buildInteractive("*[B]가 [A]의 상처를 치료한다.*"));
    assertIncludes(owner, B_ACTION_STAYS);
    assertIncludes(owner, A_REACTS);
  });

  it("E — user-started action: AI develops A response, leaves B continuation response point", () => {
    const owner = ownerOf(buildInteractive("*[B]가 [A]에게 손을 내밀기 시작한다.*"));
    assertIncludes(owner, ROLE_BINDING);
    assertIncludes(owner, RESPONSE_POINT);
  });

  it("F — user-completed action: canonical state accepted, A continues from result", () => {
    const owner = ownerOf(buildInteractive("*[B]가 [A]에게 물건을 건네 완료했다.*"));
    assertIncludes(owner, ROLE_BINDING);
    assertIncludes(owner, A_REACTS);
  });

  it("G — ambiguous target: stays open, does not lock one direction", () => {
    const owner = ownerOf(buildInteractive("*둘 중 한쪽이 상대에게 다가간다.*"));
    assertIncludes(owner, ROLE_BINDING);
    assertIncludes(owner, "확정되지 않은 정보는 [A]의 관찰·추측");
  });

  it("H — current input overrides stale assistant direction (precedence)", () => {
    const owner = buildNoGodmoddingBlock(ai, user, "standard");
    assertIncludes(owner, CURRENT_INPUT_PRECEDENCE);
  });

  it("I — explicit role switch allowed (role binding ≠ role lock)", () => {
    const owner = buildNoGodmoddingBlock(ai, user, "standard");
    assertIncludes(owner, CURRENT_INPUT_PRECEDENCE);
    assertIncludes(owner, "역할·대상·방향 전환");
  });

  it("J — standard response-point: no new B choice invented", () => {
    const owner = buildNoGodmoddingBlock(ai, user, "standard");
    assertIncludes(owner, RESPONSE_POINT);
    assertIncludes(owner, "이미 시작한 행동의 자연스러운 마무리");
  });

  it("K — coNarration keeps its own contract (no standard role-binding duplication)", () => {
    const block = buildNoGodmoddingBlock(ai, user, "coNarration");
    assertIncludes(block, CO_TITLE);
    assert.equal(block.includes(COLLABORATIVE_INTERACTIVE_OWNER_TITLE), false);
    assertIncludes(block, "사용자가 허용한 범위 안에서만");
  });

  it("L — delegated: allowDialogue / allowMajorActions matrix preserved", () => {
    const dialogOnly = buildNoGodmoddingBlock(ai, user, "currentTurnDelegated", {
      currentTurnDelegation: {
        active: true,
        allowDialogue: true,
        allowMajorActions: false,
        source: "explicit_ooc",
      },
    });
    assertIncludes(dialogOnly, CURRENT_TURN_OOC_DELEGATION_OWNER_TITLE);
    assertIncludes(dialogOnly, "직접 대사를 페르소나 말투·성격에 맞게");
    assert.equal(dialogOnly.includes("대사와 중요한 행동"), false);

    const actionsOnly = buildNoGodmoddingBlock(ai, user, "currentTurnDelegated", {
      currentTurnDelegation: {
        active: true,
        allowDialogue: false,
        allowMajorActions: true,
        source: "explicit_ooc",
      },
    });
    assertIncludes(actionsOnly, "중요한 행동과 페르소나에 맞는 장면 진행");
    assert.equal(actionsOnly.includes("직접 대사를 페르소나 말투"), false);
  });

  it("M — autoContinue keeps broad B co-narration + meaning-preserving continuation", () => {
    const block = buildNoGodmoddingBlock(ai, user, "autoContinue");
    assertIncludes(block, AUTO_PROGRESSION_BLOCK_TITLE);
    assertIncludes(
      block,
      "이미 시작한 행동은 의미를 바꾸지 않는 범위에서 자연스럽게 이어갈 수 있다"
    );
    assertIncludes(block, "대사를 공동 서술할 수 있다");
    assert.equal(block.includes(COLLABORATIVE_INTERACTIVE_OWNER_TITLE), false);
  });

  it("N — adult structural fixture: no sexual vocabulary detector, same common rule passes", () => {
    const owner = ownerOf(
      buildInteractive("*[B] explicitly initiates an intimate action toward [A].*")
    );
    assertIncludes(owner, ROLE_BINDING);
    assertIncludes(owner, B_ACTION_STAYS);
    assert.doesNotMatch(owner, /top|bottom|공수|삽입|체위|성행위/);
  });
});

describe("P0 — production-equivalent final assembled prompt", () => {
  it("standard interactive: role-binding owner exactly once, no stacking", () => {
    for (const modelId of [
      CHEAPER_INFERENCE_DEEPSEEK_V4_PRO_MODEL,
      "gemini-3.7-flash",
      "claude-opus-5",
      "gpt-5.6-luna",
    ]) {
      const built = buildInteractive("안녕.", { modelId, provider: "cheaperinference" });
      const owner = ownerOf(built);
      assert.equal(owner.split(COLLABORATIVE_INTERACTIVE_OWNER_TITLE).length - 1, 1, modelId);
      assertIncludes(owner, ROLE_BINDING, modelId);
      assert.equal(
        built.systemPrompt.split(GEMINI31_USER_AGENCY_SUPPLEMENT_TITLE).length - 1,
        0,
        modelId
      );
      assert.equal(built.systemPrompt.split(AUTO_PROGRESSION_BLOCK_TITLE).length - 1, 0, modelId);
      assert.equal(
        built.systemPrompt.split(CURRENT_TURN_OOC_DELEGATION_OWNER_TITLE).length - 1,
        0,
        modelId
      );
    }
  });

  it("Gemini 3.1 standard interactive: common role-binding + Gemini supplement, both exactly once", () => {
    const built = buildInteractive("안녕.", {
      modelId: OPENROUTER_GEMINI_31_PRO_MODEL,
      provider: "openrouter",
    });
    const owner = ownerOf(built);
    assert.equal(owner.split(COLLABORATIVE_INTERACTIVE_OWNER_TITLE).length - 1, 1);
    assertIncludes(owner, ROLE_BINDING);
    assert.equal(
      built.systemPrompt.split(GEMINI31_USER_AGENCY_SUPPLEMENT_TITLE).length - 1,
      1
    );
    // Both are inside the same no-godmodding section (supplement appended to common owner).
    assertIncludes(owner, GEMINI31_USER_AGENCY_SUPPLEMENT_TITLE);
  });
});