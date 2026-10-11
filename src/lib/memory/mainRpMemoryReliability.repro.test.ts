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
  userTextIsRecallPresuppositionOnly,
  userTextSupportsPriorSharedHistoryClaim,
} from "@/lib/sharedHistoryEvidence";
import {
  isRollingSummaryGroundedInDialogue,
} from "@/lib/memory/memory-summary-integrity";
import {
  __setSummarizeTurnBatchCallerForTests,
  summarizeTurnBatch,
} from "@/lib/memory/memory-rolling-summary";

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

describe("P1 memory reliability — Phase 3B restorage and allow/deny", () => {
  afterEach(() => {
    __setSummarizeTurnBatchCallerForTests(null);
  });

  it("active Main RP registry is the four live models", () => {
    assert.deepEqual([...MAIN_RP_MODEL_IDS], [
      "deepseek-v4.1-flash",
      "gemini-3.8-flash",
      "gpt-6.1-sol",
      "claude-opus-5.5",
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
    const invented =
      "그때 렌의 어깨가 반쯤 젖어 있었고 라이크가 우산을 렌 쪽으로 밀었는데도 그랬다. 그날 이후 라이크는 우산을 두 개 챙기게 되었다.";
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
    const invented =
      "그날 렌이 먼저 말 걸었고 라이터도 없이 와서 담배를 달라고 했으며 두 모금 만에 기침했다. 그날 이후 둘은 옥상에 자주 올라갔다.";
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
