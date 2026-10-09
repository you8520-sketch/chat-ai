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
    assert.match(TRPG_GM_SYSTEM, /sole authority for that human PC's voluntary action, movement, route choice, dialogue, allegiance, decision, and inner state/);
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

describe("TRPG GM location-ownership prompt contract (#1462 F)", () => {
  const moon = "달을 주머니에 넣는다.";
  const walk = "주점으로 간다.";

  function resolveUser(body: string): string {
    return buildTrpgGmUserBlock({
      worldBrief: "회린 부두. 주점과 성소가 보인다.",
      memoryBlock: "[TRPG STRUCTURED STATE — authoritative; do not contradict HP/items/location/flags]\nlocation=회린 부두",
      opening: false,
      actions: [humanAction({ name: "한결", body })],
    });
  }

  it("F: mechanics Rules no longer treat bare location as GM-owned PC relocation", () => {
    assert.doesNotMatch(
      TRPG_GM_SYSTEM,
      /Inventory, location, quests, NPCs, flags, and story progress remain yours/
    );
    assert.match(
      TRPG_GM_SYSTEM,
      /Inventory, quests, NPCs, flags, story progress, and world\/NPC location remain yours/
    );
    assert.match(
      TRPG_GM_SYSTEM,
      /sole authority for that human PC's voluntary action, movement, route choice/
    );
  });

  it("F resolve prompt still labels the moon action as the only human authority", () => {
    const user = resolveUser(moon);
    assert.match(user, /\[RESOLVE THIS ROUND\]/);
    assert.ok(user.includes(TRPG_GM_LABEL_HUMAN_ACTION));
    assert.equal(user.split(moon).length - 1, 1);
    assert.doesNotMatch(user, /Do not invent the human PC's voluntary movement/);
  });

  it("explicit declared walk remains a canonical human action", () => {
    const user = resolveUser(walk);
    assert.ok(user.includes(TRPG_GM_LABEL_HUMAN_ACTION));
    assert.equal(user.split(walk).length - 1, 1);
    assert.match(TRPG_GM_SYSTEM, /For routine_traversal no-check actions, the submitted traversal succeeds/);
  });

  it("ROUND CRAFT still lets the world open destinations without choosing PC movement", () => {
    assert.match(TRPG_GM_SYSTEM, /open fiction outward via reachable space, destination, route/);
    assert.match(TRPG_GM_SYSTEM, /not permission to choose PC movement/);
    assert.match(TRPG_GM_SYSTEM, /movement stays player choice/);
    assert.match(TRPG_GM_SYSTEM, /Extra NPCs: invent world extras/);
  });

  it("opening, resolve, and regenerate share the same system owner and add no new section", () => {
    const opening = buildTrpgGmUserBlock({
      worldBrief: "회린 부두",
      memoryBlock: "",
      opening: true,
      actions: [],
    });
    const regen = buildTrpgGmUserBlock({
      worldBrief: "회린 부두",
      memoryBlock: "",
      opening: false,
      regenerate: true,
      actions: [humanAction({ name: "한결", body: moon })],
    });
    assert.match(opening, /Do not invent the human PC's voluntary movement, route choice, dialogue, decision, or inner commitment/);
    assert.match(regen, /\[REGENERATE — same locked actions and dice/);
    assert.equal((TRPG_GM_SYSTEM.match(/\[ROUND CRAFT\]/g) ?? []).length, 1);
    assert.doesNotMatch(TRPG_GM_SYSTEM, /\[PLAYER AGENCY\]/);
    assert.doesNotMatch(TRPG_GM_SYSTEM, /\[LOCATION AUTHORITY\]/);
    assert.match(TRPG_GM_SYSTEM, /\[LENGTH — SCENE RESPONSIVE\]/);
    assert.match(TRPG_GM_SYSTEM, /Use the terminal ROUND NARRATION BUDGET as the sole numeric length contract/);
  });
});
