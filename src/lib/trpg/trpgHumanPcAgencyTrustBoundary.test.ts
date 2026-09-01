import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
  buildTrpgGmUserBlock,
  TRPG_GM_LABEL_AI_ATTEMPT,
  TRPG_GM_LABEL_HUMAN_ACTION,
  TRPG_GM_SYSTEM,
} from "./gmPrompt";

type GmAction = Parameters<typeof buildTrpgGmUserBlock>[0]["actions"][number];

function humanAction(opts: { participantId?: number; name?: string; body: string }): GmAction {
  return {
    participantId: opts.participantId ?? 1,
    name: opts.name ?? "렌",
    body: opts.body,
    participantKind: "human",
    statKey: "dex",
    d20: 12,
    finalScore: 12,
    dc: 11,
    tier: "SUCCESS",
  };
}

function aiAction(opts: { participantId: number; name: string; body: string }): GmAction {
  return {
    participantId: opts.participantId,
    name: opts.name,
    body: opts.body,
    participantKind: "ai_character",
    statKey: "dex",
    d20: 10,
    finalScore: 10,
    dc: 11,
    tier: "SUCCESS",
  };
}

function extractActionSections(block: string): string {
  const start = block.indexOf("[ACTION participantId=");
  return start >= 0 ? block.slice(start) : block;
}

const HUMAN_GESTURE = "주변을 살피며 두 동료에게 조용히 따라오라는 손짓을 한다.";

describe("TRPG human PC agency — structural separation", () => {
  it("system prompt keeps compact human authority without visible-prose labels", () => {
    assert.match(TRPG_GM_SYSTEM, /AUTHORITATIVE HUMAN PC ACTION/);
    assert.match(TRPG_GM_SYSTEM, /AUTHORITATIVE AI PC ATTEMPT/);
    assert.match(TRPG_GM_SYSTEM, /Resolve consequences without inventing new player choices/);
    assert.doesNotMatch(TRPG_GM_SYSTEM, /VISIBLE AI ACTION PROSE/);
    assert.doesNotMatch(TRPG_GM_SYSTEM, /cross-actor claims inside bot prose/);
    assert.doesNotMatch(TRPG_GM_SYSTEM, /When bot prose conflicts/);
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

  it("GM action blocks use canonical labels only", () => {
    const block = buildTrpgGmUserBlock({
      worldBrief: "검문소",
      memoryBlock: "",
      opening: false,
      actions: [
        humanAction({ body: HUMAN_GESTURE }),
        aiAction({
          participantId: 2,
          name: "강이현",
          body: "강이현은 두 경로 위험도를 분석한다.",
        }),
      ],
    });
    const actions = extractActionSections(block);
    assert.ok(actions.includes(TRPG_GM_LABEL_HUMAN_ACTION));
    assert.ok(actions.includes(TRPG_GM_LABEL_AI_ATTEMPT));
    assert.doesNotMatch(actions, /VISIBLE AI ACTION PROSE/);
    assert.doesNotMatch(actions, /AI ACTION PROSE/);
  });

  it("default participantKind is human for backward-compatible callers", () => {
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
    assert.ok(block.includes(TRPG_GM_LABEL_HUMAN_ACTION));
  });
});
