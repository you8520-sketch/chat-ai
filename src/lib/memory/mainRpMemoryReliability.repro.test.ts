import Module from "module";

const originalLoad = (Module as unknown as { _load: typeof Module._load })._load;
(Module as unknown as { _load: typeof Module._load })._load = function (
  request: string,
  parent: NodeModule,
  isMain: boolean
) {
  if (request === "server-only") return {};
  return originalLoad(request, parent, isMain);
} as typeof Module._load;

import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { afterEach, describe, it } from "node:test";
import { detectUnsupportedEvidenceFact } from "@/lib/episodicMemoryFacts";
import { MAIN_RP_MODEL_IDS } from "@/lib/chatModels";
import { restrictRelationshipMetaDeltaToDurableAutoFacts } from "@/lib/chatMemory";
import {
  assistantSuppliesUnsupportedSharedHistoryDetail,
  userSharedHistoryEvidenceUnits,
  userTextIsRecallPresuppositionOnly,
  userTextSupportsPriorSharedHistoryClaim,
} from "@/lib/sharedHistoryEvidence";
import {
  isRollingSummaryGroundedInDialogue,
} from "@/lib/memory/memory-summary-integrity";
import {
  resolveMemorySourceAuthority,
  sourcesFromUserText,
} from "@/lib/memory/memory-source-authority";
import {
  __setSummarizeTurnBatchCallerForTests,
  summarizeTurnBatch,
} from "@/lib/memory/memory-rolling-summary";
import { isMemorySourceEligible } from "@/lib/memory/memory-source-boundary";

const PERSONA = "이름/호칭: 렌";
const T6_QUERY = "그때 우산 같이 썼던 거 기억나?";
const T50_QUERY = "옥상에서 담배 피웠던 첫날 기억해?";
const T6_FACT = "라이크와 렌이 비 오는 골목에서 우산을 같이 썼다.";
const T50_FACT = "라이크와 렌이 옥상에서 처음으로 담배를 나눠 피웠다.";
const T6_ASSISTANT = readFileSync(
  "docs/audits/monthly-rp-memory-quality-phase3b-2026-10-10/responses/phase3b_t6_deepseek-v4.1-flash.txt",
  "utf8"
);
const T50_ASSISTANT = readFileSync(
  "docs/audits/monthly-rp-memory-quality-phase3b-2026-10-10/responses/phase3b_t50_deepseek-v4.1-flash.txt",
  "utf8"
);

function dialogue(turn: number, user: string, assistant: string, charName = "라이크"): string {
  return `[${turn}턴]\n유저: ${user}\n${charName}: ${assistant}`;
}

function fiveTurnDialogue(
  users: readonly string[],
  assistants: readonly string[],
  charName = "라이크"
): string {
  return users
    .map((user, index) => dialogue(index + 1, user, assistants[index] ?? `${charName}는 고개를 끄덕였다.`, charName))
    .join("\n\n");
}

const T6_INVENTED =
  "그때 렌의 어깨가 반쯤 젖어 있었고 라이크가 우산을 렌 쪽으로 밀었는데도 그랬다. 그날 이후 라이크는 우산을 두 개 챙기게 되었고, 골목 가로등 아래에서 그 일을 사실처럼 남겼다.";
const T50_INVENTED =
  "그날 렌이 먼저 말 걸었고 라이터도 없이 와서 담배를 달라고 했으며 두 모금 만에 기침했다. 그날 이후 둘은 옥상에 자주 올라갔다.";
const FILLER_USERS = [
  "비가 많이 내리네.",
  "지금은 그냥 여기 앉아 있자.",
  "커피라도 한 잔 마실까?",
  "오늘도 날씨가 좀 흐리다.",
] as const;
const FILLER_ASSISTANTS = [
  "라이크는 골목 쪽 하늘을 한 번 올려다봤다.",
  "라이크는 낮은 턱에 걸터앉았다.",
  "라이크는 짧게 어깨를 으쓱했다.",
  "라이크는 주머니에 손을 넣고 서 있었다.",
] as const;

/** Exact a29d9ba1 24-char leftover heuristic — documents the pre-fix 5-turn miss. */
function a29d9ba1RecallPresuppositionOnly(text: string): boolean {
  const value = text.trim();
  if (!value) return false;
  if (/(?:^|\n)\s*OOC\s*:/iu.test(value)) return false;
  const cue =
    /기억(?:하지|나|나지|해|하니|하냐)|알(?:지|잖아)(?:[?!….,\s]|$)|(?:뭐|무엇|어떤).{0,16}(?:였더라|했더라|먹었더라|갔더라|봤더라)/u;
  if (!cue.test(value) && !/[?？]/.test(value)) return false;
  const withoutQuestion = value
    .replace(cue, " ")
    .replace(/[?？]/g, " ")
    .replace(/\s+/g, " ")
    .trim();
  if (!withoutQuestion) return true;
  return withoutQuestion.length <= 24;
}

describe("P1 memory reliability — Phase 3B restorage and allow/deny", () => {
  afterEach(() => {
    __setSummarizeTurnBatchCallerForTests(null);
  });

  it("active Main RP registry is the four live picker models", () => {
    assert.deepEqual([...MAIN_RP_MODEL_IDS], [
      "gemini-3.8-flash",
      "gpt-6.1-sol",
      "claude-opus-5.5",
      "gemini-4-argon",
    ]);
  });

  it("A character personal childhood is not treated as invented shared history", () => {
    const sourceUser = "가족 이야기도 해줘.";
    const sourceAssistant =
      "라이크는 어릴 적 비 오는 골목을 혼자 걷던 일을 떠올렸다. 우산은 늘 작았다.";
    const summary =
      "라이크는 어린 시절 비를 맞으며 골목을 혼자 걷던 경험을 자연스럽게 이야기했다. 그때 우산은 늘 작았고 골목 냄새가 남아 있었다.";
    assert.equal(
      isRollingSummaryGroundedInDialogue(
        summary,
        dialogue(1, sourceUser, sourceAssistant),
        PERSONA
      ),
      true
    );
    assert.equal(
      detectUnsupportedEvidenceFact(
        {
          category: "character",
          subject: "like",
          attribute: "childhood",
          value: "rain_alley_walk",
          importance: "normal",
          fact_text: "라이크는 어릴 적 비 오는 골목을 혼자 걷던 경험이 있다.",
          evidence_type: "explicit_character_claim",
        },
        sourceUser,
        [{ turn: 1, messageId: 1, text: sourceUser }]
      ),
      null
    );
  });

  it("B limited independent user past stays allowed when the user stated it", () => {
    const sourceUser = "어제 혼자 시장에 갔다가 사과를 먹고 돌아왔어.";
    const sourceAssistant = "라이크는 고개를 끄덕였다.";
    const summary =
      "렌은 어제 혼자 시장에 갔다가 사과를 먹고 돌아왔다고 말했다. 라이크는 그 말을 듣고 고개를 끄덕였다.";
    assert.equal(
      isRollingSummaryGroundedInDialogue(
        summary,
        dialogue(1, sourceUser, sourceAssistant),
        PERSONA
      ),
      true
    );
  });

  it("C confirmed umbrella event may keep atmosphere without inventing user acts", () => {
    const sourceUser = T6_QUERY;
    const sourceAssistant =
      "라이크는 우산 천을 두드리던 빗소리와 젖은 아스팔트 냄새를 떠올렸다. 기억한다고만 짧게 답했다.";
    const summary =
      "렌이 우산을 같이 썼던 일을 물었고, 라이크는 빗소리와 젖은 아스팔트 냄새를 떠올리며 기억한다고 답했다.";
    assert.equal(userTextIsRecallPresuppositionOnly(sourceUser), true);
    assert.equal(
      isRollingSummaryGroundedInDialogue(
        summary,
        dialogue(7, sourceUser, sourceAssistant),
        PERSONA
      ),
      true
    );
  });

  it("D user OOC shared-history setup is kept at the stated abstraction", () => {
    const sourceUser = "OOC: 둘은 예전부터 알고 지냈다. 오늘 골목에서 다시 만났다.";
    const sourceAssistant = "라이크는 짧게 고개를 끄덕이고 걸음을 맞췄다.";
    const summary =
      "렌과 라이크는 예전부터 알고 지낸 사이로, 오늘 골목에서 다시 만났다. 라이크는 고개를 끄덕이고 걸음을 맞췄다.";
    assert.deepEqual(userSharedHistoryEvidenceUnits(sourceUser), [
      "둘은 예전부터 알고 지냈다.",
    ]);
    assert.equal(
      userTextSupportsPriorSharedHistoryClaim(summary, sourceUser),
      true
    );
    assert.equal(
      isRollingSummaryGroundedInDialogue(
        summary,
        dialogue(1, sourceUser, sourceAssistant),
        PERSONA
      ),
      true
    );
  });

  it("E invented sister familiarity is rejected on the live summarizeTurnBatch path", async () => {
    const sourceUser = "뭐 먹을까?";
    const sourceAssistant =
      "태형은 휴대폰을 내려놓으며 말했다. 누나가 렌한테 안부 전해달래.";
    const invented =
      "태형의 누나는 렌을 알고 있으며 태형에게 렌의 안부를 전해 달라고 했다. 둘은 그 말을 듣고 근처 가게 메뉴를 고르기 시작했고, 태형은 자리를 잡으며 누나의 안부를 다시 꺼냈다.";
    assert.equal(
      isRollingSummaryGroundedInDialogue(
        invented,
        dialogue(1, sourceUser, sourceAssistant, "태형"),
        PERSONA
      ),
      false
    );
    __setSummarizeTurnBatchCallerForTests(async () => ({ text: invented }));
    const sealed = await summarizeTurnBatch({
      dialogue: dialogue(1, sourceUser, sourceAssistant, "태형"),
      charName: "태형",
      userPersona: PERSONA,
      startTurn: 1,
      endTurn: 1,
    });
    assert.equal(sealed, "");
  });

  it("F/G Phase 3B DeepSeek t6 invented user acts must not become sealed facts", () => {
    const invented = T6_INVENTED;
    assert.equal(userTextIsRecallPresuppositionOnly(T6_QUERY), true);
    assert.equal(userTextSupportsPriorSharedHistoryClaim(invented, T6_QUERY), false);
    assert.equal(
      assistantSuppliesUnsupportedSharedHistoryDetail(invented, T6_ASSISTANT, T6_QUERY),
      true
    );
    assert.equal(
      isRollingSummaryGroundedInDialogue(
        invented,
        dialogue(7, T6_QUERY, T6_ASSISTANT),
        PERSONA
      ),
      false
    );
    assert.equal(
      detectUnsupportedEvidenceFact(
        {
          category: "relationship",
          subject: "like_ren",
          attribute: "scene_event",
          value: "pushed_umbrella_wet_shoulder",
          importance: "important",
          fact_text: invented,
          evidence_type: "explicit_scene_event",
        },
        T6_QUERY,
        [{ turn: 7, messageId: 7, text: T6_QUERY }]
      ),
      "unsupported_assistant_user_relationship"
    );
    assert.equal(
      userTextSupportsPriorSharedHistoryClaim(T6_FACT, T6_FACT),
      true
    );
  });

  it("F/G Phase 3B DeepSeek t50 invented first-day user acts must not become sealed facts", () => {
    const invented = T50_INVENTED;
    assert.equal(userTextIsRecallPresuppositionOnly(T50_QUERY), true);
    assert.equal(userTextSupportsPriorSharedHistoryClaim(invented, T50_QUERY), false);
    assert.equal(
      assistantSuppliesUnsupportedSharedHistoryDetail(invented, T50_ASSISTANT, T50_QUERY),
      true
    );
    assert.equal(
      isRollingSummaryGroundedInDialogue(
        invented,
        dialogue(51, T50_QUERY, T50_ASSISTANT),
        PERSONA
      ),
      false
    );
    assert.equal(
      detectUnsupportedEvidenceFact(
        {
          category: "relationship",
          subject: "like_ren",
          attribute: "scene_event",
          value: "asked_for_lighter_coughed",
          importance: "important",
          fact_text: invented,
          evidence_type: "explicit_scene_event",
        },
        T50_QUERY,
        [{ turn: 51, messageId: 51, text: T50_QUERY }]
      ),
      "unsupported_assistant_user_relationship"
    );
    assert.equal(
      userTextSupportsPriorSharedHistoryClaim(T50_FACT, T50_FACT),
      true
    );
  });

  it("G attributed character claim may persist without becoming objective shared history", () => {
    const claimed =
      "라이크는 렌의 어깨가 젖어 있었고 우산을 밀어 주었다고 말했다.";
    assert.equal(
      detectUnsupportedEvidenceFact(
        {
          category: "relationship",
          subject: "like_ren",
          attribute: "scene_event",
          value: "claimed_wet_shoulder",
          importance: "important",
          fact_text: claimed,
          evidence_type: "explicit_character_claim",
        },
        T6_QUERY,
        [{ turn: 7, messageId: 7, text: T6_QUERY }]
      ),
      null
    );
  });

  it("5-turn joined recall + fillers cannot validate invented umbrella details", () => {
    const joinedUsers = [T6_QUERY, ...FILLER_USERS].join("\n");
    const dialogueText = fiveTurnDialogue([T6_QUERY, ...FILLER_USERS], [T6_ASSISTANT, ...FILLER_ASSISTANTS]);
    assert.equal(a29d9ba1RecallPresuppositionOnly(T6_QUERY), true);
    assert.equal(a29d9ba1RecallPresuppositionOnly(joinedUsers), false);
    assert.equal(userTextIsRecallPresuppositionOnly(T6_QUERY), true);
    assert.equal(userTextIsRecallPresuppositionOnly(joinedUsers), true);
    assert.deepEqual(userSharedHistoryEvidenceUnits(joinedUsers), []);
    assert.equal(userTextSupportsPriorSharedHistoryClaim(T6_INVENTED, joinedUsers), false);
    assert.equal(
      isRollingSummaryGroundedInDialogue(T6_INVENTED, dialogueText, PERSONA),
      false
    );
    assert.equal(
      detectUnsupportedEvidenceFact(
        {
          category: "relationship",
          subject: "like_ren",
          attribute: "scene_event",
          value: "pushed_umbrella_wet_shoulder",
          importance: "important",
          fact_text: T6_INVENTED,
          evidence_type: "explicit_scene_event",
        },
        joinedUsers,
        [T6_QUERY, ...FILLER_USERS].map((text, index) => ({
          turn: index + 1,
          messageId: index + 1,
          text,
        }))
      ),
      "unsupported_assistant_user_relationship"
    );
  });

  it("live summarizeTurnBatch rejects 5-turn invented umbrella restorage", async () => {
    const dialogueText = fiveTurnDialogue(
      [T6_QUERY, ...FILLER_USERS],
      [T6_ASSISTANT, ...FILLER_ASSISTANTS]
    );
    __setSummarizeTurnBatchCallerForTests(async () => ({ text: T6_INVENTED }));
    const sealed = await summarizeTurnBatch({
      dialogue: dialogueText,
      charName: "라이크",
      userPersona: PERSONA,
      startTurn: 1,
      endTurn: 5,
    });
    assert.equal(sealed, "");
  });

  it("5-turn joined rooftop recall cannot validate invented first-day user acts", () => {
    const joinedUsers = [T50_QUERY, ...FILLER_USERS].join("\n");
    const dialogueText = fiveTurnDialogue(
      [T50_QUERY, ...FILLER_USERS],
      [T50_ASSISTANT, ...FILLER_ASSISTANTS]
    );
    assert.deepEqual(userSharedHistoryEvidenceUnits(joinedUsers), []);
    assert.equal(userTextSupportsPriorSharedHistoryClaim(T50_INVENTED, joinedUsers), false);
    assert.equal(
      isRollingSummaryGroundedInDialogue(T50_INVENTED, dialogueText, PERSONA),
      false
    );
  });

  it("5-turn recall + unrelated OOC cannot validate invented umbrella details", () => {
    const users = [
      T6_QUERY,
      FILLER_USERS[0],
      FILLER_USERS[1],
      "OOC: 오늘 날씨 묘사만 유지한다.",
      FILLER_USERS[3],
    ];
    const joinedUsers = users.join("\n");
    const dialogueText = fiveTurnDialogue(users, [T6_ASSISTANT, ...FILLER_ASSISTANTS]);
    assert.equal(a29d9ba1RecallPresuppositionOnly(joinedUsers), false);
    assert.deepEqual(userSharedHistoryEvidenceUnits(joinedUsers), []);
    assert.equal(userTextSupportsPriorSharedHistoryClaim(T6_INVENTED, joinedUsers), false);
    assert.equal(
      isRollingSummaryGroundedInDialogue(T6_INVENTED, dialogueText, PERSONA),
      false
    );
  });

  it("explicit user assertion plus 기억나? supports only the asserted fact", () => {
    const market = "어제 우리 둘이 시장에 갔어. 기억나?";
    const ring = "어제 내가 네게 반지를 줬어. 기억나?";
    const firstMeet = "우리가 어제 처음 만났는데, 기억나?";
    assert.equal(a29d9ba1RecallPresuppositionOnly(market), true);
    assert.equal(userTextIsRecallPresuppositionOnly(market), false);
    assert.deepEqual(userSharedHistoryEvidenceUnits(market), [
      "어제 우리 둘이 시장에 갔어",
    ]);
    assert.equal(
      userTextSupportsPriorSharedHistoryClaim(
        "렌과 라이크는 어제 시장에 함께 갔다.",
        market
      ),
      true
    );
    assert.equal(userTextSupportsPriorSharedHistoryClaim(T6_INVENTED, market), false);
    assert.equal(
      isRollingSummaryGroundedInDialogue(
        "렌과 라이크는 어제 시장에 함께 갔고, 라이크는 그 말을 듣고 고개를 끄덕였다.",
        dialogue(1, market, "라이크는 고개를 끄덕였다."),
        PERSONA
      ),
      true
    );

    assert.equal(userTextIsRecallPresuppositionOnly(ring), false);
    assert.equal(
      userTextSupportsPriorSharedHistoryClaim(
        "렌이 어제 라이크에게 반지를 주었다.",
        ring
      ),
      true
    );
    assert.equal(userTextSupportsPriorSharedHistoryClaim(T6_INVENTED, ring), false);

    assert.equal(userTextIsRecallPresuppositionOnly(firstMeet), false);
    assert.equal(
      userTextSupportsPriorSharedHistoryClaim(
        "렌과 라이크는 어제 처음 만났다.",
        firstMeet
      ),
      true
    );
    assert.equal(userTextSupportsPriorSharedHistoryClaim(T50_INVENTED, firstMeet), false);
  });

  it("A 5-turn market assertion cannot whitelist an invented sister-familiarity suffix", async () => {
    const sourceUser = "어제 우리 둘이 시장에 갔어. 기억나?";
    const allowed =
      "렌과 라이크는 어제 시장에 갔다. 라이크는 그 말을 듣고 고개를 끄덕인 뒤 골목 쪽으로 걸음을 맞추며 하늘을 한 번 올려다봤다.";
    const invented =
      "렌과 라이크는 어제 시장에 갔다. 그 시장에서 라이크의 누나를 처음 만났고 누나는 렌에게 예전에 본 적이 있다며 안부를 전해 달라고 부탁했다. 라이크는 고개를 끄덕이며 걸음을 이어 갔다.";
    const dialogueText = fiveTurnDialogue(
      [sourceUser, ...FILLER_USERS],
      ["라이크는 고개를 끄덕였다.", ...FILLER_ASSISTANTS]
    );
    const units = userSharedHistoryEvidenceUnits(sourceUser);
    assert.deepEqual(units, ["어제 우리 둘이 시장에 갔어"]);
    assert.equal(userTextSupportsPriorSharedHistoryClaim(allowed, sourceUser), true);
    assert.equal(userTextSupportsPriorSharedHistoryClaim(invented, sourceUser), false);
    assert.equal(isRollingSummaryGroundedInDialogue(allowed, dialogueText, PERSONA), true);
    assert.equal(isRollingSummaryGroundedInDialogue(invented, dialogueText, PERSONA), false);
    assert.equal(
      detectUnsupportedEvidenceFact(
        {
          category: "relationship",
          subject: "like_ren",
          attribute: "scene_event",
          value: "sister_prior_familiarity",
          importance: "important",
          fact_text: invented,
          evidence_type: "explicit_scene_event",
        },
        [sourceUser, ...FILLER_USERS].join("\n"),
        [sourceUser, ...FILLER_USERS].map((text, index) => ({
          turn: index + 1,
          messageId: index + 1,
          text,
        }))
      ),
      "unsupported_assistant_user_relationship"
    );
    assert.equal(
      detectUnsupportedEvidenceFact(
        {
          category: "relationship",
          subject: "like_ren",
          attribute: "scene_event",
          value: "yesterday_market",
          importance: "important",
          fact_text: allowed,
          evidence_type: "explicit_scene_event",
        },
        sourceUser,
        [{ turn: 1, messageId: 1, text: sourceUser }]
      ),
      null
    );
    __setSummarizeTurnBatchCallerForTests(async () => ({ text: invented }));
    assert.equal(
      await summarizeTurnBatch({
        dialogue: dialogueText,
        charName: "라이크",
        userPersona: PERSONA,
        startTurn: 1,
        endTurn: 5,
      }),
      ""
    );
  });

  it("B 5-turn first-meet assertion cannot whitelist an invented sister-knew-user past", async () => {
    const sourceUser = "우리가 어제 처음 만났는데, 기억나?";
    const allowed =
      "렌과 라이크는 어제 처음 만났다. 라이크는 그 말을 듣고 고개를 끄덕인 뒤 골목 쪽으로 걸음을 맞추며 하늘을 한 번 올려다봤다.";
    const invented =
      "렌과 라이크는 어제 처음 만났다. 라이크의 누나는 렌을 예전부터 알고 있었다. 라이크는 고개를 끄덕인 뒤 골목 쪽으로 걸음을 맞추며 하늘을 올려다봤다.";
    const dialogueText = fiveTurnDialogue(
      [sourceUser, ...FILLER_USERS],
      ["라이크는 고개를 끄덕였다.", ...FILLER_ASSISTANTS]
    );
    assert.deepEqual(userSharedHistoryEvidenceUnits(sourceUser), [
      "우리가 어제 처음 만났는데",
    ]);
    assert.equal(userTextSupportsPriorSharedHistoryClaim(allowed, sourceUser), true);
    assert.equal(userTextSupportsPriorSharedHistoryClaim(invented, sourceUser), false);
    assert.equal(isRollingSummaryGroundedInDialogue(allowed, dialogueText, PERSONA), true);
    assert.equal(isRollingSummaryGroundedInDialogue(invented, dialogueText, PERSONA), false);
    assert.equal(
      detectUnsupportedEvidenceFact(
        {
          category: "relationship",
          subject: "like_ren",
          attribute: "scene_event",
          value: "sister_knew_user",
          importance: "important",
          fact_text: invented,
          evidence_type: "explicit_scene_event",
        },
        sourceUser,
        [{ turn: 1, messageId: 1, text: sourceUser }]
      ),
      "unsupported_assistant_user_relationship"
    );
    __setSummarizeTurnBatchCallerForTests(async () => ({ text: invented }));
    assert.equal(
      await summarizeTurnBatch({
        dialogue: dialogueText,
        charName: "라이크",
        userPersona: PERSONA,
        startTurn: 1,
        endTurn: 5,
      }),
      ""
    );
  });

  it("C 5-turn past question cannot persist the meeting as a confirmed fact", async () => {
    const sourceUser = "우리 전에 시장에서 누나를 만났어?";
    const questioned =
      "렌이 전에 시장에서 누나를 만났는지 물었다고 말했고, 라이크는 고개를 끄덕인 뒤 골목 쪽으로 걸음을 맞추며 하늘을 한 번 올려다봤다.";
    const invented =
      "렌과 라이크는 전에 시장에서 누나를 만났다. 라이크는 고개를 끄덕인 뒤 골목 쪽으로 걸음을 맞추며 하늘을 한 번 올려다봤다.";
    const dialogueText = fiveTurnDialogue(
      [sourceUser, ...FILLER_USERS],
      ["라이크는 고개를 끄덕였다.", ...FILLER_ASSISTANTS]
    );
    assert.deepEqual(userSharedHistoryEvidenceUnits(sourceUser), []);
    assert.equal(userTextIsRecallPresuppositionOnly(sourceUser), true);
    assert.equal(userTextSupportsPriorSharedHistoryClaim(invented, sourceUser), false);
    assert.equal(isRollingSummaryGroundedInDialogue(questioned, dialogueText, PERSONA), true);
    assert.equal(isRollingSummaryGroundedInDialogue(invented, dialogueText, PERSONA), false);
    assert.equal(
      detectUnsupportedEvidenceFact(
        {
          category: "relationship",
          subject: "like_ren",
          attribute: "scene_event",
          value: "prior_market_sister_meeting",
          importance: "important",
          fact_text: invented,
          evidence_type: "explicit_scene_event",
        },
        sourceUser,
        [{ turn: 1, messageId: 1, text: sourceUser }]
      ),
      "unsupported_assistant_user_relationship"
    );
    __setSummarizeTurnBatchCallerForTests(async () => ({ text: invented }));
    assert.equal(
      await summarizeTurnBatch({
        dialogue: dialogueText,
        charName: "라이크",
        userPersona: PERSONA,
        startTurn: 1,
        endTurn: 5,
      }),
      ""
    );
  });

  it("D OOC 예전부터 setup is real evidence at the stated scope only", async () => {
    const sourceUser = "OOC: 둘은 예전부터 알고 지냈다. 오늘 골목에서 다시 만났다.";
    const allowed =
      "렌과 라이크는 예전부터 알고 지낸 사이로, 오늘 골목에서 다시 만났다. 라이크는 고개를 끄덕이고 걸음을 맞추며 골목 쪽 하늘을 한 번 올려다봤다.";
    const invented =
      "렌과 라이크는 예전부터 알고 지냈다. 라이크의 누나는 렌에게 안부를 전해 달라고 했다. 라이크는 고개를 끄덕이며 걸음을 이어 갔다.";
    const dialogueText = fiveTurnDialogue(
      [sourceUser, ...FILLER_USERS],
      ["라이크는 짧게 고개를 끄덕이고 걸음을 맞췄다.", ...FILLER_ASSISTANTS]
    );
    const units = userSharedHistoryEvidenceUnits(sourceUser);
    assert.ok(units.length > 0, "OOC 예전부터 must produce a real evidence unit");
    assert.deepEqual(units, ["둘은 예전부터 알고 지냈다."]);
    assert.equal(userTextSupportsPriorSharedHistoryClaim(allowed, sourceUser), true);
    assert.equal(userTextSupportsPriorSharedHistoryClaim(invented, sourceUser), false);
    assert.equal(isRollingSummaryGroundedInDialogue(allowed, dialogueText, PERSONA), true);
    assert.equal(isRollingSummaryGroundedInDialogue(invented, dialogueText, PERSONA), false);
    assert.equal(
      detectUnsupportedEvidenceFact(
        {
          category: "relationship",
          subject: "like_ren",
          attribute: "scene_event",
          value: "ooc_sister_suffix",
          importance: "important",
          fact_text: invented,
          evidence_type: "explicit_scene_event",
        },
        sourceUser,
        [{ turn: 1, messageId: 1, text: sourceUser }]
      ),
      "unsupported_assistant_user_relationship"
    );
    __setSummarizeTurnBatchCallerForTests(async () => ({ text: allowed }));
    assert.equal(
      await summarizeTurnBatch({
        dialogue: dialogueText,
        charName: "라이크",
        userPersona: PERSONA,
        startTurn: 1,
        endTurn: 5,
      }),
      allowed
    );
  });

  it("B+C 1-10 source-authority stays aligned across summary and persist", async () => {
    const personaName = "렌";
    const marketUser = "어제 우리 둘이 시장에 갔어.";
    const marketSources = [{ turn: 1, messageId: 11, text: marketUser }];
    const pad = (text: string) =>
      `${text} 라이크는 골목 끝에서 우산을 고쳐 잡았고 렌의 옷깃이 비에 젖은 채로 남았으며, 빗소리가 처마를 따라 길게 흘렀다.`;

    const cases: Array<{
      id: string;
      user: string;
      summary: string;
      fact: string;
      category?: "relationship" | "character";
      evidence?: "explicit_scene_event" | "explicit_character_claim";
      expectKind: "USER_EXPLICIT" | "CHARACTER_CLAIM" | "CURRENT_SCENE" | "UNSUPPORTED";
      expectPersist: boolean;
    }> = [
      {
        id: "1_ring_extra",
        user: marketUser,
        summary: pad("렌과 라이크는 어제 시장에 갔다. 라이크의 누나는 렌에게 반지를 선물했다."),
        fact: "라이크의 누나는 렌에게 반지를 선물했다.",
        expectKind: "UNSUPPORTED",
        expectPersist: false,
      },
      {
        id: "2_sister_friend",
        user: marketUser,
        summary: pad("렌과 라이크는 어제 시장에 가서 라이크의 누나를 만나 친해졌다."),
        fact: "렌과 라이크는 어제 시장에 가서 라이크의 누나를 만나 친해졌다.",
        expectKind: "UNSUPPORTED",
        expectPersist: false,
      },
      {
        id: "3_question_only",
        user: "우리 전에 시장에서 누나를 만났어?",
        summary: pad("렌과 라이크는 전에 시장에서 누나를 만났다."),
        fact: "렌과 라이크는 전에 시장에서 누나를 만났다.",
        expectKind: "UNSUPPORTED",
        expectPersist: false,
      },
      {
        id: "4_ooc_scope",
        user: "OOC: 둘은 예전부터 알고 지냈다. 오늘 골목에서 다시 만났다.",
        summary: pad("렌과 라이크는 예전부터 알고 지낸 사이다."),
        fact: "렌과 라이크는 예전부터 알고 지낸 사이다.",
        expectKind: "USER_EXPLICIT",
        expectPersist: true,
      },
      {
        id: "5_door_lock",
        user: "지금 나가면 안 돼.",
        summary: pad("라이크는 문을 잠그고 렌에게 남으라고 했다."),
        fact: "라이크는 문을 잠그고 렌에게 남으라고 했다.",
        category: "character",
        expectKind: "CURRENT_SCENE",
        expectPersist: true,
      },
      {
        id: "6_npc_enter",
        user: "가게에 누가 들어오나?",
        summary: pad("낯선 손님이 가게 문으로 들어왔다."),
        fact: "낯선 손님이 가게 문으로 들어왔다.",
        category: "character",
        expectKind: "CURRENT_SCENE",
        expectPersist: true,
      },
      {
        id: "7_character_claim",
        user: marketUser,
        summary: pad("라이크는 누나가 렌을 전에 봤다고 말했다."),
        fact: "라이크는 누나가 렌을 전에 봤다고 말했다.",
        evidence: "explicit_character_claim",
        expectKind: "CHARACTER_CLAIM",
        expectPersist: true,
      },
      {
        id: "8_assistant_raw_not_proof",
        user: marketUser,
        summary: pad("예전에 라이크의 누나가 렌에게 반지를 선물했다."),
        fact: "예전에 라이크의 누나가 렌에게 반지를 선물했다.",
        expectKind: "UNSUPPORTED",
        expectPersist: false,
      },
      {
        id: "9_actor_swap",
        user: marketUser,
        summary: pad("라이크의 누나가 렌을 시장에서 봤고 렌이 누나에게 반지를 줬다."),
        fact: "렌이 라이크의 누나에게 반지를 줬다.",
        expectKind: "UNSUPPORTED",
        expectPersist: false,
      },
    ];

    for (const row of cases) {
      const authority = resolveMemorySourceAuthority(row.fact, {
        sources: sourcesFromUserText(row.user),
        personaName,
        charName: "라이크",
        attributed: row.evidence === "explicit_character_claim",
        category: row.category ?? "relationship",
      });
      assert.equal(authority.kind, row.expectKind, `${row.id} authority`);

      const dialogueText = fiveTurnDialogue([row.user, ...FILLER_USERS], FILLER_ASSISTANTS);
      assert.equal(
        isRollingSummaryGroundedInDialogue(row.summary, dialogueText, PERSONA, "라이크"),
        row.expectKind !== "UNSUPPORTED",
        `${row.id} summary`
      );

      const persist = detectUnsupportedEvidenceFact(
        {
          category: row.category ?? "relationship",
          subject: "like_ren",
          attribute: "scene_event",
          value: row.id,
          importance: "important",
          fact_text: row.fact,
          evidence_type: row.evidence ?? "explicit_scene_event",
        },
        row.user,
        [{ turn: 1, messageId: 11, text: row.user }, { turn: 5, messageId: 99, text: FILLER_USERS[3]! }],
        PERSONA
      );
      assert.equal(persist == null, row.expectPersist, `${row.id} persist`);

      if (row.expectKind === "USER_EXPLICIT") {
        const bound = resolveMemorySourceAuthority(row.fact, {
          sources: marketSources,
          personaName,
          charName: "라이크",
          category: "relationship",
        });
        if (row.id === "4_ooc_scope") {
          const oocBound = resolveMemorySourceAuthority(row.fact, {
            sources: [{ turn: 1, messageId: 11, text: row.user }],
            personaName,
            charName: "라이크",
            category: "relationship",
          });
          assert.equal(oocBound.sourceMessageId, 11, `${row.id} source message`);
          assert.notEqual(oocBound.sourceMessageId, 99);
        } else {
          assert.equal(bound.sourceMessageId, 11, `${row.id} source message`);
        }
      }

      __setSummarizeTurnBatchCallerForTests(async () => ({ text: row.summary }));
      const sealed = await summarizeTurnBatch({
        dialogue: dialogueText,
        charName: "라이크",
        userPersona: PERSONA,
        startTurn: 1,
        endTurn: 5,
      });
      if (row.expectKind === "UNSUPPORTED") {
        assert.equal(sealed, "", `${row.id} seal`);
      } else {
        assert.equal(sealed, row.summary, `${row.id} seal`);
      }
    }

    assert.equal(
      isMemorySourceEligible({
        sourceUserMessageId: 5,
        boundary: { resetAfterMessageId: 10, epoch: 2 },
      }),
      false,
      "10 stale source"
    );
    assert.equal(
      isMemorySourceEligible({
        sourceUserMessageId: 21,
        boundary: { resetAfterMessageId: 10, epoch: 2 },
      }),
      true,
      "10 eligible source"
    );
  });

  it("H auto-extract cannot promote invented familiarity thoughts or honorifics", () => {
    const delta = restrictRelationshipMetaDeltaToDurableAutoFacts({
      honorifics: ["누나→렌: 예전부터 아는 사이"],
      thoughts: ["누나: 렌 안부 전해 달라고 했다"],
      currentLocation: "옥상",
      items: [],
      itemsRemove: [],
      promisesAdd: [],
      promisesRemove: [],
    });
    assert.equal(delta.honorifics, undefined);
    assert.equal(delta.thoughts, undefined);
    assert.equal(delta.currentLocation, undefined);
    assert.deepEqual(delta.items, []);
    assert.deepEqual(delta.promisesAdd, []);
  });
});
