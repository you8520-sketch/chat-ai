import assert from "node:assert/strict";
import fs from "node:fs";
import { describe, it } from "node:test";
import { actionNeedsCheck } from "./actionCheck";
import { TRPG_ACTION_TYPES, TRPG_VISIBLE_ACTION_TYPES, isTrpgActionType } from "./actionTypes";
import {
  applyReplySuggestionClick,
  normalizeTrpgReplyStance,
  replyStanceLabelKo,
  TRPG_REPLY_STANCES,
  type TrpgReplySuggestion,
} from "./replySuggestionShared";
import {
  buildReplySuggestionPublicContext,
  parseReplySuggestions,
  TRPG_REPLY_SUGGESTION_AIM_MAX_CHARS,
  TRPG_REPLY_SUGGESTION_AIM_MIN_CHARS,
} from "./replySuggestions";

function suggestionJson(
  rows: Array<{
    stance?: unknown;
    actionType?: unknown;
    action_type?: unknown;
    stage?: string;
    speech?: string;
    text?: string;
  }>
): string {
  return JSON.stringify({ suggestions: rows });
}

function compactTokens(text: string): Set<string> {
  return new Set(
    text
      .replace(/[「」『』"'“”.,!?~…\s]/g, " ")
      .split(/\s+/)
      .filter((token) => token.length >= 2)
  );
}

function jaccard(a: string, b: string): number {
  const left = compactTokens(a);
  const right = compactTokens(b);
  let overlap = 0;
  for (const token of left) {
    if (right.has(token)) overlap += 1;
  }
  const union = left.size + right.size - overlap;
  return union === 0 ? 1 : overlap / union;
}

function assertStanceQuality(parsed: TrpgReplySuggestion[], sceneTokens: string[]): void {
  assert.deepEqual(
    parsed.map((row) => row.stance),
    ["good", "neutral", "evil"]
  );
  const stages = parsed.map((row) => row.stage);
  assert.equal(new Set(stages).size, 3);
  assert.ok(jaccard(stages[0] ?? "", stages[1] ?? "") < 0.55, "good/neutral must be distinct actions");
  assert.ok(jaccard(stages[0] ?? "", stages[2] ?? "") < 0.55, "good/evil must be distinct actions");
  assert.ok(jaccard(stages[1] ?? "", stages[2] ?? "") < 0.55, "neutral/evil must be distinct actions");
  for (const row of parsed) {
    const blob = `${row.stage} ${row.speech} ${row.text}`;
    assert.ok(
      sceneTokens.some((token) => blob.includes(token)),
      `suggestion must stay in the current scene: ${row.stage}`
    );
    assert.doesNotMatch(blob, /동료가\s+\S+(?:한다|했다)|일행이\s+(?:동의|따른다|고개를)/);
    assert.doesNotMatch(blob, /SECRET_|숨겨진\s*동기|미래의\s*국면|디렉터/);
    assert.doesNotMatch(blob, /이미\s+(?:열었|제압|알아냈|찾아냈|설득했)|성공했다/);
    assert.ok(TRPG_VISIBLE_ACTION_TYPES.includes(row.actionType));
  }
}

describe("TRPG reply suggestion stances", () => {
  it("normalizes English keys and exact Korean aliases only", () => {
    assert.deepEqual(TRPG_REPLY_STANCES, ["good", "neutral", "evil"]);
    assert.equal(normalizeTrpgReplyStance("GOOD"), "good");
    assert.equal(normalizeTrpgReplyStance("Neutral"), "neutral");
    assert.equal(normalizeTrpgReplyStance("EVIL"), "evil");
    assert.equal(normalizeTrpgReplyStance("선의"), "good");
    assert.equal(normalizeTrpgReplyStance("중립"), "neutral");
    assert.equal(normalizeTrpgReplyStance("악의"), "evil");
    assert.equal(normalizeTrpgReplyStance("chaos"), null);
    assert.equal(normalizeTrpgReplyStance("선한"), null);
    assert.equal(normalizeTrpgReplyStance("hero"), null);
    assert.equal(replyStanceLabelKo("good"), "선의");
    assert.equal(replyStanceLabelKo("neutral"), "중립");
    assert.equal(replyStanceLabelKo("evil"), "악의");
  });

  it("A. reorders random provider stance order to good, neutral, evil", () => {
    const parsed = parseReplySuggestions(
      suggestionJson([
        { stance: "evil", actionType: "persuade", text: "퇴로를 막고 정보를 뜯어내려 한다." },
        { stance: "good", actionType: "support", text: "부상자를 먼저 뒤로 물린다." },
        { stance: "neutral", actionType: "investigate", text: "문틈과 바닥 흔적을 확인한다." },
      ])
    );
    assert.deepEqual(
      parsed.map((row) => row.stance),
      ["good", "neutral", "evil"]
    );
    assert.deepEqual(
      parsed.map((row) => row.actionType),
      ["support", "investigate", "persuade"]
    );
  });

  it("B. accepts Korean stance aliases and still canonicalizes order", () => {
    const parsed = parseReplySuggestions(
      suggestionJson([
        { stance: "악의", actionType: "attack", text: "상대가 대응하기 전에 출구를 차단한다." },
        { stance: "선의", actionType: "defend", text: "동료를 가리고 상대에게 멈추라고 손짓한다." },
        { stance: "중립", actionType: "free", text: "거리를 유지한 채 출구와 인원을 다시 센다." },
      ])
    );
    assert.deepEqual(
      parsed.map((row) => row.stance),
      ["good", "neutral", "evil"]
    );
  });

  it("C. rejects a duplicate stance set", () => {
    assert.throws(
      () =>
        parseReplySuggestions(
          suggestionJson([
            { stance: "good", actionType: "support", text: "부상자를 뒤로 물린다." },
            { stance: "good", actionType: "defend", text: "문을 등지고 동료를 가린다." },
            { stance: "evil", actionType: "persuade", text: "퇴로를 막고 협박한다." },
          ])
        ),
      /행동 예시를 읽지 못했습니다/
    );
  });

  it("D. rejects a missing stance without synthesizing a replacement", () => {
    assert.throws(
      () =>
        parseReplySuggestions(
          suggestionJson([
            { stance: "good", actionType: "support", text: "부상자를 뒤로 물린다." },
            { stance: "evil", actionType: "persuade", text: "퇴로를 막고 협박한다." },
          ])
        ),
      /행동 예시를 읽지 못했습니다/
    );
  });

  it("E. rejects stealth or use_item in suggestion output without deleting backend types", () => {
    assert.equal(isTrpgActionType("stealth"), true);
    assert.equal(isTrpgActionType("use_item"), true);
    assert.ok(TRPG_ACTION_TYPES.includes("stealth"));
    assert.ok(TRPG_ACTION_TYPES.includes("use_item"));
    assert.throws(
      () =>
        parseReplySuggestions(
          suggestionJson([
            { stance: "good", actionType: "support", text: "부상자를 뒤로 물린다." },
            { stance: "neutral", actionType: "stealth", text: "벽에 붙어 문틈을 엿본다." },
            { stance: "evil", actionType: "persuade", text: "퇴로를 막고 협박한다." },
          ])
        ),
      /행동 예시를 읽지 못했습니다/
    );
    assert.throws(
      () =>
        parseReplySuggestions(
          suggestionJson([
            { stance: "good", actionType: "support", text: "부상자를 뒤로 물린다." },
            { stance: "neutral", actionType: "use_item", text: "열쇠를 꺼내 구멍에 넣는다." },
            { stance: "evil", actionType: "persuade", text: "퇴로를 막고 협박한다." },
          ])
        ),
      /행동 예시를 읽지 못했습니다/
    );
  });

  it("F. click fills composer text and action type only", () => {
    const parsed = parseReplySuggestions(
      suggestionJson([
        { stance: "good", actionType: "support", text: "부상자를 뒤로 물린다." },
        { stance: "neutral", actionType: "investigate", text: "문틈과 바닥 흔적을 확인한다." },
        { stance: "evil", actionType: "persuade", text: "퇴로를 막고 협박한다." },
      ])
    );
    const filled = applyReplySuggestionClick(parsed[2]!);
    assert.equal(filled.actionType, "persuade");
    assert.equal(filled.actionBody, "퇴로를 막고 협박한다.");
    assert.equal(filled.inputOrigin, "reply_suggestion");
    assert.equal(filled.autoSubmit, false);
    const client = fs.readFileSync("src/app/trpg/[id]/TrpgRoomClient.tsx", "utf8");
    assert.match(client, /from ["']@\/lib\/trpg\/replySuggestionShared["']/);
    assert.match(client, /applyReplySuggestionClick\(item\)/);
    const pick = client.match(/onPickSuggestion=\{\(item\) => \{[\s\S]*?\}\}/);
    assert.ok(pick, "room client must keep an onPickSuggestion fill handler");
    assert.doesNotMatch(pick[0], /onSendAction|void run\(|\/action`|rollD20|advance/);
  });
});

describe("TRPG reply suggestion quality fixtures", () => {
  it("1. wounded ally + nearby danger stays structurally diverse", () => {
    const parsed = parseReplySuggestions(
      suggestionJson([
        {
          stance: "good",
          actionType: "support",
          stage: "피 흘리는 동료 허리를 받쳐 기둥 뒤로 한 걸음 물린 뒤, 자신은 그 앞을 막아선 채 손바닥을 들어 다가오는 기척을 일단 멈춘다.",
          speech: "먼저 얘부터 빼. 지금은 싸울 생각 없어. 한 발만 물러서.",
        },
        {
          stance: "neutral",
          actionType: "investigate",
          stage: "동료에게는 손짓만 남기고 자신은 낮은 자세로 복도 모퉁이와 피 자국, 발소리를 세며 적이 몇인지부터 가늠한다.",
          speech: "움직이지 마. 몇인지, 어디서 오는지 내가 먼저 셀게.",
        },
        {
          stance: "evil",
          actionType: "free",
          stage: "다친 동료를 미끼처럼 통로에 남겨 둔 채 자신만 옆 문으로 빠져 상대의 등 뒤를 선점할 자리를 잡는다.",
          speech: "네가 소리 질러. 그 틈에 내가 뒤에서 끝낸다.",
        },
      ])
    );
    assertStanceQuality(parsed, ["동료", "피", "복도", "적"]);
  });

  it("2. suspicious locked room stays structurally diverse", () => {
    const parsed = parseReplySuggestions(
      suggestionJson([
        {
          stance: "good",
          actionType: "persuade",
          stage: "일행을 문에서 한 걸음 뒤로 물리며 손잡이에는 손대지 않은 채, 문 너머를 향해 싸울 뜻이 없음을 먼저 알린다.",
          speech: "안에 누가 있든 우린 약탈하러 온 게 아냐. 문부터 열지 말고 대답해.",
        },
        {
          stance: "neutral",
          actionType: "investigate",
          stage: "잠긴 문의 경첩과 열쇠구멍, 문틈으로 새는 공기와 바닥 먼지를 손가락으로 훑어 최근 드나든 흔적부터 확인한다.",
          speech: "손대지 마. 자국이 새것이면 안에 아직 있어.",
        },
        {
          stance: "evil",
          actionType: "attack",
          stage: "일행이 망설이는 사이 어깨로 문짝을 들이받아 잠금을 깨고, 안에 있는 상대가 무기를 들 틈을 주지 않으려 한다.",
          speech: "대답 기다릴 시간 없어. 부수고 들어가 먼저 제압한다.",
        },
      ])
    );
    assertStanceQuality(parsed, ["문", "잠긴", "경첩"]);
  });

  it("3. hostile NPC negotiation stays structurally diverse", () => {
    const parsed = parseReplySuggestions(
      suggestionJson([
        {
          stance: "good",
          actionType: "persuade",
          stage: "양손을 보이며 한 발 물러서고, 상대의 칼끝이 자신과 동료를 동시에 겨누지 않게 시선을 낮춘 채 말을 고른다.",
          speech: "여기서 치면 둘 다 끝이야. 칼 내리고 조건만 듣자. 우린 지나갈 길만 필요해.",
        },
        {
          stance: "neutral",
          actionType: "investigate",
          stage: "칼끝에는 손을 대지 않은 채 상대의 시선, 뒤에 숨은 인원, 출구 두 곳을 눈으로만 세며 흥정 여지를 잰다.",
          speech: "원하는 게 통과료야, 정보야. 숫자부터 말해. 나는 아직 안 움직여.",
        },
        {
          stance: "evil",
          actionType: "persuade",
          stage: "상대의 약한 손목 쪽을 힐끗 본 뒤 한 걸음 다가서 목소리를 낮추고, 거짓 지원을 미끼로 무기를 내리게 압박한다.",
          speech: "네 뒤에 있는 사람, 우리 쪽에 팔았다. 지금 칼 내려. 아니면 그 입부터 연다.",
        },
      ])
    );
    assertStanceQuality(parsed, ["칼", "상대", "출구"]);
  });

  it("4. unknown artifact stays structurally diverse", () => {
    const parsed = parseReplySuggestions(
      suggestionJson([
        {
          stance: "good",
          actionType: "defend",
          stage: "동료가 빛나는 조각에 손을 뻗기 전에 손목을 가볍게 막고, 자신은 조각과 일행 사이에 서서 거리를 유지한다.",
          speech: "만지지 마. 누가 다치기 전에 내가 막을게. 일단 한 걸음만 물러서.",
        },
        {
          stance: "neutral",
          actionType: "investigate",
          stage: "맨손으로는 대지 않고 막대 끝으로 조각 둘레의 먼지와 열기, 새겨진 선만 밀어 보며 반응을 살핀다.",
          speech: "직접 집지 마. 열과 글자부터 확인하고 옮길지 정하자.",
        },
        {
          stance: "evil",
          actionType: "free",
          stage: "일행이 망설이는 사이 소매로 조각을 감싸 품에 넣고, 나중에 혼자 쓸 수 있게 시선만 반대쪽으로 돌린다.",
          speech: "이건 내가 맡는다. 너희는 입구나 보고 있어. 나눠 줄지는 내가 정한다.",
        },
      ])
    );
    assertStanceQuality(parsed, ["조각", "동료", "일행"]);
  });

  it("keeps the existing 80–120 length contract in the generation prompt", () => {
    assert.equal(TRPG_REPLY_SUGGESTION_AIM_MIN_CHARS, 80);
    assert.equal(TRPG_REPLY_SUGGESTION_AIM_MAX_CHARS, 120);
    const { system } = buildReplySuggestionPublicContext({
      scene: "폐역",
      persona: null,
      recentActions: [],
      self: null,
      party: [],
    });
    assert.match(system, /80–120 Korean characters/);
    assert.doesNotMatch(system, /chaos|comic|romance|coward|hero/);
  });
});

describe("TRPG visible action composer ownership", () => {
  it("renders exactly six primary chips and keeps contextual recovery separate", () => {
    const room = fs.readFileSync("src/app/trpg/TrpgCampaignRoom.tsx", "utf8");
    assert.match(room, /TRPG_VISIBLE_ACTION_TYPES\.map/);
    assert.doesNotMatch(room, /TRPG_ACTION_TYPES\.map/);
    assert.match(room, /data-trpg-action-chip=\{kind\}/);
    assert.match(room, /🩹 응급처치/);
    assert.match(room, /💊 상태 치료/);
    assert.match(room, /🏕 안전한 휴식/);
    assert.match(room, /data-contextual="first-aid"/);
    assert.match(room, /from ["']@\/lib\/trpg\/replySuggestionShared["']/);
    assert.doesNotMatch(room, /from ["']@\/lib\/trpg\/replySuggestions["']/);
    assert.match(room, /replyStanceLabelKo\(item\.stance\)/);
    assert.match(room, /actionTypeLabelKo\(item\.actionType\)/);
  });

  it("does not change actionNeedsCheck ownership for chips or free", () => {
    assert.equal(actionNeedsCheck({ body: "칼을 뽑는다.", actionType: "attack" }), true);
    assert.equal(actionNeedsCheck({ body: "한 발 물러선다", actionType: "defend" }), true);
    assert.equal(actionNeedsCheck({ body: "주변을 본다", actionType: "investigate" }), true);
    assert.equal(actionNeedsCheck({ body: "목소리를 낮춘다", actionType: "persuade" }), true);
    assert.equal(actionNeedsCheck({ body: "「알겠어.」", actionType: "free" }), false);
    assert.equal(actionNeedsCheck({ body: "고개를 끄덕인다. 「알겠어.」", actionType: "free" }), false);
    assert.equal(actionNeedsCheck({ body: "잠긴 문을 억지로 연다.", actionType: "free" }), true);
    assert.equal(actionNeedsCheck({ body: "그림자에 선다", actionType: "stealth" }), true);
  });
});
