import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { countTrpgNarrationChars, TRPG_GM_RICH_MIN_CHARS } from "./gmNarrationBudget";
import {
  buildTrpgGmUserBlock,
  TRPG_GM_LABEL_AI_SCENE_PROSE,
  TRPG_GM_LABEL_AI_VISIBLE_PROSE,
  TRPG_GM_LABEL_HUMAN_ACTION,
  TRPG_GM_SYSTEM,
} from "./gmPrompt";

function padRich(seed: string): string {
  let out = seed.trim();
  while (countTrpgNarrationChars(out) < TRPG_GM_RICH_MIN_CHARS) out += " 먼지가 인다.";
  return out;
}

type GmAction = Parameters<typeof buildTrpgGmUserBlock>[0]["actions"][number];

function humanAction(opts: {
  participantId?: number;
  name?: string;
  body: string;
  tier?: string | null;
}): GmAction {
  return {
    participantId: opts.participantId ?? 1,
    name: opts.name ?? "렌",
    body: opts.body,
    participantKind: "human",
    statKey: "dex",
    d20: 12,
    finalScore: 12,
    dc: 11,
    tier: opts.tier ?? "SUCCESS",
  };
}

function aiAction(opts: {
  participantId: number;
  name: string;
  body: string;
  intent?: string;
  tier?: string | null;
}): GmAction {
  return {
    participantId: opts.participantId,
    name: opts.name,
    body: opts.body,
    intent: opts.intent,
    participantKind: "ai_character",
    statKey: "dex",
    d20: 10,
    finalScore: 10,
    dc: 11,
    tier: opts.tier ?? "SUCCESS",
  };
}

function extractActionSections(block: string): string {
  const start = block.indexOf("[ACTION participantId=");
  return start >= 0 ? block.slice(start) : block;
}

function containsLabel(block: string, label: string): boolean {
  return block.includes(label);
}

const HUMAN_GESTURE = "주변을 살피며 두 동료에게 조용히 따라오라는 손짓을 한다.";

describe("TRPG human PC agency — trust boundary owners", () => {
  it("system prompt defines human precedence and actor-only AI prose authority", () => {
    assert.match(TRPG_GM_SYSTEM, /AUTHORITATIVE HUMAN PC ACTION/);
    assert.match(TRPG_GM_SYSTEM, /actor-only established context/);
    assert.match(TRPG_GM_SYSTEM, /When bot prose conflicts with a human's authoritative action, the human action wins/);
    assert.match(TRPG_GM_SYSTEM, /Do not treat cross-actor claims inside bot prose as established fact/);
    assert.doesNotMatch(TRPG_GM_SYSTEM, /\[VISIBLE ACTION PROSE — established context for its outcome\]/);
    assert.doesNotMatch(TRPG_GM_SYSTEM, /\[ACTION PROSE — scene material for this resolution\]/);
  });

  it("opening user block preserves AI companion staging and blocks human agency invention", () => {
    const opening = buildTrpgGmUserBlock({
      worldBrief: "회색 생태권",
      memoryBlock: "",
      opening: true,
      actions: [],
    });
    assert.match(opening, /You may portray AI companions with brief in-character action and dialogue/);
    assert.match(opening, /Do not invent the human PC's voluntary movement, route choice, dialogue, decision, or inner commitment/);
    assert.doesNotMatch(opening, /\[ACTION participantId=/);
  });
});

describe("TRPG human PC agency — deterministic regression matrix", () => {
  it("A: #812 regression — bot cross-PC movement prose is actor-only, human action authoritative", () => {
    const bot1Prose = padRich(
      "렌의 뒤를 바짝 따르며 좌우 갈림길의 환경 수치를 빠르게 갱신했다. 데이터 패드 센서를 우측 환기구 방향으로 조준했다."
    );
    const bot2Prose = padRich(
      "렌이 신중하게 손짓을 보내며 발을 떼자마자, 권태현은 반사적으로 마체테를 치켜들며 한 걸음 앞서 나갔다."
    );
    const block = buildTrpgGmUserBlock({
      worldBrief: "회색 생태권",
      memoryBlock: "",
      opening: false,
      actions: [
        humanAction({ body: HUMAN_GESTURE }),
        aiAction({
          participantId: 2,
          name: "강이현",
          body: bot1Prose,
          intent: "강이현은 데이터 패드의 센서를 우측 환기 보조 통로로 향해 스캔하려 했다.",
        }),
        aiAction({
          participantId: 3,
          name: "권태현",
          body: bot2Prose,
          intent: "권태현은 마체테를 쥔 채 렌의 앞을 가로막아 우측 환기 통로 입구를 엄호하려 했다.",
        }),
      ],
    });
    const actions = extractActionSections(block);
    assert.match(actions, new RegExp(TRPG_GM_LABEL_HUMAN_ACTION.replace(/[[\]]/g, "\\$&")));
    assert.match(actions, /actorKind=human/);
    assert.match(actions, /actorKind=ai_character/);
    assert.match(actions, new RegExp(TRPG_GM_LABEL_AI_VISIBLE_PROSE.replace(/[[\]]/g, "\\$&")));
    assert.match(actions, /주변을 살피며 두 동료에게 조용히 따라오라는 손짓을 한다/);
    assert.equal((actions.match(new RegExp(TRPG_GM_LABEL_HUMAN_ACTION.replace(/[[\]]/g, "\\$&"), "g")) ?? []).length, 1);
    assert.equal((actions.match(new RegExp(TRPG_GM_LABEL_AI_VISIBLE_PROSE.replace(/[[\]]/g, "\\$&"), "g")) ?? []).length, 2);
    assert.match(TRPG_GM_SYSTEM, /human action wins/);
  });

  it("B: explicit contradiction — human stationary beats bot cross-PC movement claim", () => {
    const block = buildTrpgGmUserBlock({
      worldBrief: "검문소",
      memoryBlock: "",
      opening: false,
      actions: [
        humanAction({ body: "렌은 제자리에서 손만 들어 신호한다." }),
        aiAction({
          participantId: 2,
          name: "권태현",
          body: padRich("렌이 우측 통로로 뛰어가기 시작했다. 권태현은 그 뒤를 따라 달렸다."),
          intent: "권태현은 우측 통로 입구를 엄호하려 했다.",
        }),
      ],
    });
    const actions = extractActionSections(block);
    assert.match(actions, /렌은 제자리에서 손만 들어 신호한다/);
    assert.match(actions, /actorKind=human.*density=BRIEF/s);
    assert.match(actions, /actorKind=ai_character/);
    assert.match(TRPG_GM_SYSTEM, /sole canon for that human's voluntary action/);
    assert.match(TRPG_GM_SYSTEM, /never for another PC's voluntary action/);
  });

  it("C: explicit human route choice remains authoritative", () => {
    const block = buildTrpgGmUserBlock({
      worldBrief: "검문소",
      memoryBlock: "",
      opening: false,
      actions: [humanAction({ body: "우측 환기 통로로 이동한다." })],
    });
    assert.match(block, /우측 환기 통로로 이동한다/);
    assert.ok(containsLabel(block, TRPG_GM_LABEL_HUMAN_ACTION));
    assert.match(TRPG_GM_SYSTEM, /Resolve only the fictionally necessary consequences of submitted actions/);
  });

  it("D: AI bot own movement/action authority preserved via intent and actor-only prose", () => {
    const block = buildTrpgGmUserBlock({
      worldBrief: "검문소",
      memoryBlock: "",
      opening: false,
      actions: [
        humanAction({ body: "주변을 살핀다." }),
        aiAction({
          participantId: 2,
          name: "강이현",
          body: padRich("강이현은 우측 환기구로 다가가 패드 센서를 들이밀었다."),
          intent: "강이현이 우측 환기구로 다가가 스캔한다.",
        }),
      ],
    });
    assert.match(block, /\[INTENT\]\n강이현이 우측 환기구로 다가가 스캔한다/);
    assert.ok(containsLabel(block, TRPG_GM_LABEL_AI_VISIBLE_PROSE));
    assert.match(block, /actorKind=ai_character/);
  });

  it("E: Bot2 reacts to Bot1 intent — sequential cooperation preserved", () => {
    const block = buildTrpgGmUserBlock({
      worldBrief: "검문소",
      memoryBlock: "",
      opening: false,
      actions: [
        humanAction({ body: "전방을 주시한다." }),
        aiAction({
          participantId: 2,
          name: "강이현",
          body: padRich("강이현은 우측 환기구를 스캔했다."),
          intent: "우측을 스캔한다.",
        }),
        aiAction({
          participantId: 3,
          name: "권태현",
          body: padRich("스캔하는 강이현 앞을 엄호하며 마체테를 세웠다."),
          intent: "스캔하는 강이현 앞을 엄호한다.",
        }),
      ],
    });
    assert.match(block, /\[INTENT\]\n우측을 스캔한다/);
    assert.match(block, /\[INTENT\]\n스캔하는 강이현 앞을 엄호한다/);
    assert.equal((block.match(/actorKind=ai_character/g) ?? []).length, 2);
  });

  it("F: human brief action uses authoritative label not legacy scene material", () => {
    const block = buildTrpgGmUserBlock({
      worldBrief: "폐역",
      memoryBlock: "",
      opening: false,
      actions: [humanAction({ body: "문을 향해 총을 쏜다." })],
    });
    assert.ok(containsLabel(block, TRPG_GM_LABEL_HUMAN_ACTION));
    assert.match(TRPG_GM_SYSTEM, /Resolve only the fictionally necessary consequences of submitted actions/);
    assert.match(TRPG_GM_SYSTEM, /next meaningful decision remains with that player/);
  });

  it("G: AI brief action uses actor-only scene material label", () => {
    const block = buildTrpgGmUserBlock({
      worldBrief: "폐역",
      memoryBlock: "",
      opening: false,
      actions: [
        humanAction({ body: "숨는다." }),
        aiAction({ participantId: 2, name: "권태현", body: "앞을 본다." }),
      ],
    });
    assert.ok(containsLabel(block, TRPG_GM_LABEL_AI_SCENE_PROSE));
    assert.doesNotMatch(block, /\[ACTION PROSE — scene material for this resolution\]/);
  });

  it("H: default participantKind is human for backward-compatible callers", () => {
    const block = buildTrpgGmUserBlock({
      worldBrief: "폐역",
      memoryBlock: "",
      opening: false,
      actions: [
        {
          participantId: 1,
          name: "렌",
          body: "문을 연다.",
          statKey: "str",
          d20: 10,
          finalScore: 10,
          dc: 12,
          tier: "SUCCESS",
        },
      ],
    });
    assert.match(block, /actorKind=human/);
    assert.ok(containsLabel(block, TRPG_GM_LABEL_HUMAN_ACTION));
  });
});

describe("TRPG human PC agency — final gates", () => {
  it("contract flags for GPT review", () => {
    const block = buildTrpgGmUserBlock({
      worldBrief: "검문소",
      memoryBlock: "",
      opening: false,
      actions: [
        humanAction({ body: HUMAN_GESTURE }),
        aiAction({
          participantId: 2,
          name: "강이현",
          body: padRich("렌의 뒤를 따르며 우측을 스캔했다."),
          intent: "우측 환기구를 스캔한다.",
        }),
      ],
    });
    assert.equal((block.match(TRPG_GM_LABEL_HUMAN_ACTION) ?? []).length, 1);
    assert.ok(containsLabel(block, TRPG_GM_LABEL_AI_VISIBLE_PROSE));
    assert.match(TRPG_GM_SYSTEM, /When bot prose conflicts with a human's authoritative action, the human action wins/);
    assert.match(TRPG_GM_SYSTEM, /Do not treat cross-actor claims inside bot prose as established fact/);
  });
});
