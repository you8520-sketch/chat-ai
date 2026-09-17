/**
 * UA1–12, LEN1–5, CTX1–6/8–10, OWNER1–9 — user agency / length / owner consolidation gates.
 */
import assert from "node:assert/strict";
import { describe, it } from "node:test";

import { AUTO_PROGRESSION_BLOCK_TITLE } from "@/lib/autoProgressionRules";
import { IMMERSIVE_PROSE_BLOCK } from "@/lib/advancedProseNsfwGuidelines";
import {
  buildNoGodmoddingBlock,
  COLLABORATIVE_INTERACTIVE_OWNER_BLOCK,
  COLLABORATIVE_INTERACTIVE_OWNER_TITLE,
  EXAMPLE_DIALOG_STYLE_ONLY_NOTE,
} from "@/lib/noGodmodding";
import {
  buildCurrentUserInputWrapper,
  CURRENT_USER_INPUT_HEADER,
  wrapCurrentUserInput,
} from "@/lib/currentUserInputLabel";
import { resolveChatRuntimeMode } from "@/lib/chatRuntimeMode";
import { extractReconvergenceHooks } from "@/lib/reconvergenceState";
import { NARRATIVE_DENSITY_BLOCK } from "@/lib/sceneExpansionPolicy";
import { USER_TAIL_LENGTH_OWNER_SENTENCE } from "@/lib/responseLength";
import { buildContext } from "@/services/contextBuilder";

const user = "테스트_유저";
const ai = "테스트_AI";

const CALLBACK_SEMANTIC_MARKERS = [
  "present first",
  "relevant할 때만",
  "그대로 복사",
  "매 턴 의무적으로 회상",
  "같은 기억·키워드·상징·비유",
  "설정 문장·기억 문장",
] as const;

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

function countMarkerHits(text: string, markers: readonly string[]): number {
  return markers.filter((m) => text.includes(m)).length;
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

  it("UA4 example-dialog note is style-only — no auto-history permission rule", () => {
    assert.doesNotMatch(EXAMPLE_DIALOG_STYLE_ONLY_NOTE, /이전 자동진행 턴/);
    assert.doesNotMatch(EXAMPLE_DIALOG_STYLE_ONLY_NOTE, /현재 턴 권한/);
    assert.match(EXAMPLE_DIALOG_STYLE_ONLY_NOTE, /말투·분위기 참고용/);
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

  it("LEN3 immersive prose forbids micro-action/emotion paraphrase filler", () => {
    assert.match(IMMERSIVE_PROSE_BLOCK, /미세 행동·반복 해설/);
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
    assert.match(IMMERSIVE_PROSE_BLOCK, /설정 문장·기억 문장을 그대로 복사/);
  });

  it("CTX4 irrelevant memory — no mandatory callback quota", () => {
    assert.match(IMMERSIVE_PROSE_BLOCK, /의무적으로 회상하지 않는다/);
    assert.doesNotMatch(NARRATIVE_DENSITY_BLOCK, /매 턴 callback 의무/);
  });

  it("CTX5 anti-fixation requires new function on reuse", () => {
    assert.match(IMMERSIVE_PROSE_BLOCK, /새 정보·판단·감정 변화·행동 결과/);
  });

  it("CTX6 no verbatim canon/memory echo", () => {
    assert.match(IMMERSIVE_PROSE_BLOCK, /그대로 복사/);
    assert.doesNotMatch(NARRATIVE_DENSITY_BLOCK, /문장 그대로 echo/);
  });

  it("CTX7 static memory/lorebook cannot become active reconvergence hooks (PROV1–3)", () => {
    const loreOnly = extractReconvergenceHooks({
      currentUserMessage: "오늘은 여기까지. 들어가.",
      lorebookText:
        "두 사람은 같은 팀에서 통신 단말기를 사용하며 기지에서 함께 근무한다.",
      currentTurn: 1,
    });
    assert.equal(loreOnly.length, 0);

    const memoryOnly = extractReconvergenceHooks({
      memoryText: "우리 관계는 오래된 지인이다.",
      currentTurn: 1,
    });
    assert.equal(memoryOnly.length, 0);

    const crossSource = extractReconvergenceHooks({
      memoryText: "우리 관계는 오래된 지인이다.",
      lorebookText: "도시 중앙에는 병원이 있다.",
      currentTurn: 1,
    });
    assert.equal(crossSource.length, 0);
  });

  it("CTX8 persona use does not authorize inner thought fabrication", () => {
    const owner = ownerText(buildInteractive("안녕."));
    assert.match(owner, /새로운 직접 대사/);
    assert.match(owner, /감정 결론/);
  });

  it("CTX9 present scene first — no unnecessary flashback expansion", () => {
    assert.match(IMMERSIVE_PROSE_BLOCK, /현재 장면/);
    assert.doesNotMatch(NARRATIVE_DENSITY_BLOCK, /flashback/);
  });

  it("CTX10 same memory/keyword non-functional repetition forbidden", () => {
    assert.match(IMMERSIVE_PROSE_BLOCK, /같은 기억·키워드·상징·비유/);
    assert.doesNotMatch(NARRATIVE_DENSITY_BLOCK, /무기능 반복/);
  });
});

describe("OWNER — responsibility consolidation gates", () => {
  it("OWNER1 contextual callback semantics live in IMMERSIVE PROSE only", () => {
    const proseHits = countMarkerHits(IMMERSIVE_PROSE_BLOCK, CALLBACK_SEMANTIC_MARKERS);
    assert.ok(proseHits >= 4, "IMMERSIVE PROSE must own callback contract");
    assert.equal(
      countMarkerHits(COLLABORATIVE_INTERACTIVE_OWNER_BLOCK, CALLBACK_SEMANTIC_MARKERS),
      0
    );
    assert.equal(countMarkerHits(NARRATIVE_DENSITY_BLOCK, CALLBACK_SEMANTIC_MARKERS), 0);
  });

  it("OWNER2 collaborative interactive owner is user-authoring permission only", () => {
    assert.match(COLLABORATIVE_INTERACTIVE_OWNER_BLOCK, /현재 interactive 턴/);
    assert.match(COLLABORATIVE_INTERACTIVE_OWNER_BLOCK, /정본으로 사용할 수 있다/);
    assert.doesNotMatch(COLLABORATIVE_INTERACTIVE_OWNER_BLOCK, /매 턴 의무적으로 회상/);
    assert.doesNotMatch(COLLABORATIVE_INTERACTIVE_OWNER_BLOCK, /설정 문장을 그대로 되풀이/);
    assert.doesNotMatch(COLLABORATIVE_INTERACTIVE_OWNER_BLOCK, /같은 기억·키워드/);
  });

  it("OWNER3 example-dialog note is style boundary only", () => {
    assert.match(EXAMPLE_DIALOG_STYLE_ONLY_NOTE, /STYLE ONLY/);
    assert.doesNotMatch(EXAMPLE_DIALOG_STYLE_ONLY_NOTE, /자동진행/);
    assert.doesNotMatch(EXAMPLE_DIALOG_STYLE_ONLY_NOTE, /scene history/);
  });

  it("OWNER4 manual assembled prompt: collaborative owner title exactly once", () => {
    const built = buildInteractive("안녕.");
    const owner = ownerText(built);
    assert.equal(owner.split(COLLABORATIVE_INTERACTIVE_OWNER_TITLE).length - 1, 1);
    assert.equal(built.systemPrompt.split(COLLABORATIVE_INTERACTIVE_OWNER_TITLE).length - 1, 1);
  });

  it("OWNER5 manual current-user wrapper: AUTO→MANUAL recency reset present", () => {
    const wrapped = wrapCurrentUserInput("그를 바라본다.", { mode: "interactive" });
    assert.match(wrapped, /Prior auto-progression co-narration does not carry over/);
    assert.match(wrapped, /scene history only/);
  });

  it("OWNER6 auto assembled prompt: auto owner present, collaborative owner absent", () => {
    const built = buildInteractive("", { isContinue: true, currentUserMessage: "..." });
    const owner = ownerText(built);
    assert.ok(owner.includes(AUTO_PROGRESSION_BLOCK_TITLE));
    assert.equal(owner.includes(COLLABORATIVE_INTERACTIVE_OWNER_TITLE), false);
  });

  it("OWNER7 AUTO history + next MANUAL: auto permission absent, manual wrapper active", () => {
    const built = buildInteractive("그를 바라본다.", {
      shortTermHistory: [
        { role: "user", content: "계속." },
        { role: "assistant", content: '"[B]가 말했다. 「그래.」" 이동했다.' },
      ],
    });
    const owner = ownerText(built);
    assert.equal(owner.includes(AUTO_PROGRESSION_BLOCK_TITLE), false);
    const userTail = lastUserMessage(built);
    assert.match(userTail, /Prior auto-progression co-narration does not carry over/);
  });

  it("OWNER8 NARRATIVE DENSITY does not duplicate full contextual-callback contract", () => {
    assert.match(NARRATIVE_DENSITY_BLOCK, /\[IMMERSIVE PROSE\]를 따른다/);
    assert.doesNotMatch(NARRATIVE_DENSITY_BLOCK, /present first/);
    assert.doesNotMatch(NARRATIVE_DENSITY_BLOCK, /relevant할 때만/);
    assert.doesNotMatch(NARRATIVE_DENSITY_BLOCK, /그대로 복사/);
    assert.doesNotMatch(NARRATIVE_DENSITY_BLOCK, /무기능 반복/);
  });

  it("OWNER9 USER_TAIL length owner stays compact — no prose anti-fixation duplicate", () => {
    assert.match(USER_TAIL_LENGTH_OWNER_SENTENCE, /3,200자 이상/);
    assert.match(USER_TAIL_LENGTH_OWNER_SENTENCE, /\[AI_CAST\]/);
    assert.match(USER_TAIL_LENGTH_OWNER_SENTENCE, /분량 채우기/);
    assert.doesNotMatch(USER_TAIL_LENGTH_OWNER_SENTENCE, /같은 감정·상태/);
    assert.doesNotMatch(USER_TAIL_LENGTH_OWNER_SENTENCE, /의무적으로 회상/);
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
