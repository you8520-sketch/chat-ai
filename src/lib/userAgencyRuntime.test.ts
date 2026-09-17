/**
 * UA1–12, LEN1–5, CTX1–10 — user agency / length / contextual callback gates.
 */
import assert from "node:assert/strict";
import { describe, it } from "node:test";

import { AUTO_PROGRESSION_BLOCK_TITLE } from "@/lib/autoProgressionRules";
import { IMMERSIVE_PROSE_BLOCK } from "@/lib/advancedProseNsfwGuidelines";
import {
  buildNoGodmoddingBlock,
  COLLABORATIVE_INTERACTIVE_OWNER_TITLE,
  EXAMPLE_DIALOG_STYLE_ONLY_NOTE,
} from "@/lib/noGodmodding";
import {
  buildCurrentUserInputWrapper,
  CURRENT_USER_INPUT_HEADER,
  wrapCurrentUserInput,
} from "@/lib/currentUserInputLabel";
import { resolveChatRuntimeMode } from "@/lib/chatRuntimeMode";
import { NARRATIVE_DENSITY_BLOCK } from "@/lib/sceneExpansionPolicy";
import { USER_TAIL_LENGTH_OWNER_SENTENCE } from "@/lib/responseLength";
import { buildContext } from "@/services/contextBuilder";

const user = "테스트_유저";
const ai = "테스트_AI";

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

function ownerText(built: ReturnType<typeof buildContext>): string {
  const section = built.meta.trackedSections?.find((s) => s.id === "no-godmodding");
  assert.ok(section, "no-godmodding section missing");
  return section!.text;
}

function lastUserMessage(built: ReturnType<typeof buildContext>): string {
  const last = built.history.at(-1);
  assert.equal(last?.role, "user");
  return String(last?.content ?? "");
}

describe("UA — user agency runtime gates", () => {
  it("UA1 AUTO→MANUAL: manual turn uses interactive owner, not auto block", () => {
    const autoHistory = [
      { role: "user" as const, content: "계속 가자." },
      {
        role: "assistant" as const,
        content:
          '서린은 고개를 끄덕였다. "[B]가 말했다. 「그래, 같이 가자.」" 그리고 복도를 따라 걸음을 옮겼다.',
      },
    ];
    const built = buildInteractive("그를 바라본다.", {
      shortTermHistory: autoHistory,
    });
    const owner = ownerText(built);
    assert.equal(
      resolveChatRuntimeMode({ isContinue: false, legacyNovelModeEnabled: false }),
      "interactive"
    );
    assert.equal(owner.includes(COLLABORATIVE_INTERACTIVE_OWNER_TITLE), true);
    assert.equal(owner.includes(AUTO_PROGRESSION_BLOCK_TITLE), false);
    assert.equal(built.systemPrompt.includes(AUTO_PROGRESSION_BLOCK_TITLE), false);
    assert.match(owner, /자동진행 턴/);
    assert.match(owner, /현재 interactive 턴/);
  });

  it("UA2 wrapper resets auto co-narration on manual turn", () => {
    const wrapped = wrapCurrentUserInput("그를 바라본다.", { mode: "interactive" });
    assert.ok(wrapped.includes(CURRENT_USER_INPUT_HEADER));
    assert.match(wrapped, /Prior auto-progression co-narration does not carry over/);
    assert.match(wrapped, /scene history only/);
  });

  it("UA3 auto turn still allows auto owner", () => {
    const built = buildInteractive("", { isContinue: true, currentUserMessage: "..." });
    const owner = ownerText(built);
    assert.ok(owner.includes(AUTO_PROGRESSION_BLOCK_TITLE));
    assert.match(owner, /interactive 턴으로 넘어가면/);
  });

  it("UA4 example-dialog note blocks auto history as permission", () => {
    assert.match(EXAMPLE_DIALOG_STYLE_ONLY_NOTE, /이전 자동진행 턴/);
  });

  it("UA5 MINOR1 cup reach — minor co-narration allowed", () => {
    const owner = ownerText(buildInteractive("컵을 받으려고 손을 내민다."));
    assert.match(owner, /물건 수취/);
    assert.match(owner, /중요한 선택/);
  });

  it("UA6 MINOR2 elevator — direct result ok, no chained major intent", () => {
    const owner = ownerText(buildInteractive("엘리베이터 버튼을 누른다."));
    assert.match(owner, /기계의 직접 결과/);
    assert.match(owner, /연쇄 이동/);
    assert.match(owner, /층 선택/);
  });

  it("UA7 current-turn runtime mode is canonical permission source", () => {
    const owner = buildNoGodmoddingBlock(ai, user, "standard");
    assert.match(owner, /현재 턴의 런타임 모드/);
  });

  it("UA8 auto wrapper preserves co-narration semantics", () => {
    const w = buildCurrentUserInputWrapper({ mode: "auto_progression" });
    assert.match(w, /co-narration/);
  });

  it("UA9 delegated turn uses delegation wrapper, not auto", () => {
    const w = buildCurrentUserInputWrapper({ mode: "current_turn_ooc_delegated" });
    assert.match(w, /THIS TURN only/);
  });

  it("UA10 manual turn owner appears exactly once in assembled prompt", () => {
    const built = buildInteractive("안녕.");
    const owner = ownerText(built);
    assert.equal(owner.split(COLLABORATIVE_INTERACTIVE_OWNER_TITLE).length - 1, 1);
  });

  it("UA11 adult handoff wrapper preserved for handoff path", () => {
    const w = buildCurrentUserInputWrapper({ mode: "interactive", adultHandoff: true });
    assert.match(w, /즉각적인 결과/);
  });

  it("UA12 OOC co-narration does not inject collaborative owner title", () => {
    const owner = buildNoGodmoddingBlock(ai, user, "coNarration");
    assert.equal(owner.includes(COLLABORATIVE_INTERACTIVE_OWNER_TITLE), false);
  });
});

describe("LEN — length vs user agency gates", () => {
  it("LEN1 length owner forbids [B] dialogue/action as filler", () => {
    assert.match(USER_TAIL_LENGTH_OWNER_SENTENCE, /\[B\]의 새 직접 대사/);
    assert.match(USER_TAIL_LENGTH_OWNER_SENTENCE, /분량 채우기/);
  });

  it("LEN2 density prioritizes AI psychology/perception/action", () => {
    assert.match(NARRATIVE_DENSITY_BLOCK, /\[AI_CAST\]의 현재 심리/);
  });

  it("LEN3 density forbids emotion paraphrase repetition", () => {
    assert.match(NARRATIVE_DENSITY_BLOCK, /같은 감정 paraphrase/);
  });

  it("LEN4 immersive prose forbids fabricated canon echo obligation", () => {
    assert.match(IMMERSIVE_PROSE_BLOCK, /relevant할 때만/);
    assert.match(IMMERSIVE_PROSE_BLOCK, /의무적으로 회상하지 않는다/);
  });

  it("LEN5 adult handoff local reciprocal response preserved in wrapper", () => {
    const w = buildCurrentUserInputWrapper({ mode: "interactive", adultHandoff: true });
    assert.match(w, /비자발적 신체 반응/);
  });
});

describe("CTX — contextual callback gates", () => {
  it("CTX1–3 present-first + transform canon to action (not explain)", () => {
    assert.match(IMMERSIVE_PROSE_BLOCK, /present first/);
    assert.match(IMMERSIVE_PROSE_BLOCK, /행동·대사 선택을 바꾸/);
    assert.match(NARRATIVE_DENSITY_BLOCK, /flashback·설정 복습·문장 그대로 echo/);
  });

  it("CTX4 irrelevant memory — no mandatory callback quota", () => {
    assert.match(NARRATIVE_DENSITY_BLOCK, /매 턴 callback 의무는 없다/);
  });

  it("CTX5 anti-fixation requires new function on reuse", () => {
    assert.match(IMMERSIVE_PROSE_BLOCK, /새 정보·판단·감정 변화·행동 결과/);
  });

  it("CTX6 no verbatim canon/memory echo", () => {
    assert.match(IMMERSIVE_PROSE_BLOCK, /그대로 복사/);
    assert.match(NARRATIVE_DENSITY_BLOCK, /문장 그대로 echo/);
  });

  it("CTX7 memory callback is not active reconvergence hook (PR931 invariant)", () => {
    const owner = ownerText(buildInteractive("안녕."));
    assert.match(owner, /매 턴 의무적으로 회상하지 않는다/);
  });

  it("CTX8 persona use does not authorize inner thought fabrication", () => {
    const owner = ownerText(buildInteractive("안녕."));
    assert.match(owner, /새로운 직접 대사/);
    assert.match(owner, /감정 결론/);
  });

  it("CTX9 present scene first — no unnecessary flashback expansion", () => {
    assert.match(NARRATIVE_DENSITY_BLOCK, /과거 설명·flashback/);
  });

  it("CTX10 same memory/keyword non-functional repetition forbidden", () => {
    assert.match(NARRATIVE_DENSITY_BLOCK, /무기능 반복/);
    assert.match(IMMERSIVE_PROSE_BLOCK, /같은 기억·키워드·상징·비유/);
  });
});

describe("UA-AUTO1 assembled prompt evidence", () => {
  it("manual after auto history: user tail has interactive wrapper, not auto wrapper", () => {
    const built = buildInteractive("그를 바라본다.", {
      shortTermHistory: [
        { role: "user", content: "계속." },
        {
          role: "assistant",
          content: '"[B]가 말했다. 「그래, 같이 가자.」" 이동했다.',
        },
      ],
    });
    const userTail = lastUserMessage(built);
    assert.match(userTail, /Prior auto-progression co-narration does not carry over/);
    assert.doesNotMatch(userTail, /limited\/full user co-narration per \[NO GODMODDING\] \/ novel rules/);
  });
});
