import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { describe, it } from "node:test";
import { mergeMechanicsOwnedDelta } from "./mechanicsMerge";
import { parseFlashOrEmpty, resolveRoundMechanics } from "./mechanicsResolve";
import { parseFlashMechanicsOutput } from "./mechanicsValidate";
import type { FlashMechanicsOutput, MechanicsActorInput, MechanicsResolution, TrpgOngoingEffect } from "./mechanicsTypes";
import type { TrpgSheetSnapshot } from "./types";

function sheet(partial: Partial<TrpgSheetSnapshot> = {}): TrpgSheetSnapshot {
  return {
    participantId: 1,
    name: "강이현",
    playerName: "현",
    level: 1,
    hp: 20,
    maxHp: 25,
    stats: { str: 8, dex: 8, con: 8, int: 8, wis: 8, cha: 8, res: 8 },
    conditions: [],
    inventory: ["붕대", "해독제"],
    location: "",
    modifiersNote: "",
    ...partial,
  };
}

function ren(partial: Partial<TrpgSheetSnapshot> = {}): TrpgSheetSnapshot {
  return sheet({ participantId: 2, name: "렌", playerName: "렌", inventory: [], ...partial });
}

function actor(partial: Partial<MechanicsActorInput> = {}): MechanicsActorInput {
  return {
    participantId: 1,
    name: "강이현",
    actionType: "attack",
    body: "벤다",
    tier: "FAILURE",
    d20: 6,
    modifier: 1,
    finalScore: 7,
    dc: 12,
    statKey: "str",
    ...partial,
  };
}

function poison(partial: Partial<TrpgOngoingEffect> = {}): TrpgOngoingEffect {
  return {
    id: 10,
    campaignId: 1,
    participantId: 2,
    label: "중독",
    kind: "periodic_harm",
    severity: "MEDIUM",
    stackKey: "poison",
    stackPolicy: "refresh",
    sourceRound: 5,
    appliedRound: 5,
    startsRound: 6,
    tickClass: "LIGHT",
    remainingTicks: 3,
    lastTickRound: null,
    recoveryMode: "save_or_treatment",
    recoveryStat: "res",
    treatmentMode: "item_or_support",
    requiredItem: null,
    actionModifier: 0,
    metadata: {},
    ...partial,
  };
}

function resolve(partial: Partial<Parameters<typeof resolveRoundMechanics>[0]>): MechanicsResolution {
  return resolveRoundMechanics({
    campaignId: 1,
    roundId: 200,
    roundNumber: 6,
    sheets: [sheet(), ren()],
    effects: [],
    actors: [actor()],
    flash: null,
    fallback: "none",
    calledFlash: true,
    model: "deepseek-v4-flash-0731",
    latencyMs: 8,
    baseDc: 12,
    rng: () => 4,
    recoveryRng: () => 1,
    ...partial,
  });
}

describe("TRPG mechanics P0/P1 blockers", () => {
  it("1. A heals B → B HP increases, A unchanged", () => {
    const out = resolve({
      sheets: [sheet({ hp: 20 }), ren({ hp: 10 })],
      actors: [actor({ actionType: "support", body: "렌의 상처를 치료한다", tier: "SUCCESS" })],
      flash: {
        effects: [
          {
            sourceParticipantId: 1,
            targetParticipantId: 2,
            directEffect: "heal",
            directClass: "LIGHT",
            cause: "healing",
          },
        ],
      },
    });
    assert.ok((out.hpAfter["2"] ?? 0) > 10);
    assert.equal(out.hpAfter["1"], 20);
    assert.equal(out.actors[0]?.direct?.sourceParticipantId, 1);
    assert.equal(out.actors[0]?.direct?.targetParticipantId, 2);
  });

  it("2. A uses antidote on poisoned B → B poison removed", () => {
    const out = resolve({
      effects: [poison()],
      actors: [actor({ actionType: "use_item", body: "렌에게 해독제를 사용한다", tier: "SUCCESS" })],
      flash: {
        effects: [
          {
            sourceParticipantId: 1,
            targetParticipantId: 2,
            directEffect: "none",
            directClass: "NONE",
            cause: "none",
            ongoingRemoveIds: [10],
            consumeItem: "해독제",
          },
        ],
      },
    });
    assert.ok(out.ongoingClearedIds.includes(10));
    assert.deepEqual(out.consumeItems, [{ participantId: 1, item: "해독제" }]);
  });

  it("3. treatment FAILURE → poison not removed", () => {
    const out = resolve({
      effects: [poison()],
      actors: [actor({ actionType: "use_item", body: "렌에게 해독제를 사용한다", tier: "FAILURE" })],
      flash: {
        effects: [
          {
            sourceParticipantId: 1,
            targetParticipantId: 2,
            directEffect: "none",
            directClass: "NONE",
            cause: "none",
            ongoingRemoveIds: [10],
            consumeItem: "해독제",
          },
        ],
      },
    });
    assert.equal(out.ongoingClearedIds.includes(10), false);
    assert.equal(out.consumeItems.length, 0);
  });

  it("4. treatment PARTIAL → reduction policy exact", () => {
    const out = resolve({
      effects: [poison({ remainingTicks: 3 })],
      actors: [actor({ actionType: "use_item", body: "렌에게 해독제를 사용한다", tier: "PARTIAL_SUCCESS" })],
      flash: {
        effects: [
          {
            sourceParticipantId: 1,
            targetParticipantId: 2,
            directEffect: "none",
            directClass: "NONE",
            cause: "none",
            ongoingRemoveIds: [10],
            consumeItem: "해독제",
          },
        ],
      },
    });
    assert.equal(out.ongoingClearedIds.includes(10), false);
    const update = out.ongoingUpdates.find((row) => row.id === 10);
    assert.ok(update);
    assert.equal(update?.remainingTicks, 1);
  });

  it("5. specific_item mismatch → remove rejected", () => {
    const out = resolve({
      effects: [poison({ treatmentMode: "specific_item", requiredItem: "전설의해독제" })],
      actors: [actor({ actionType: "use_item", body: "렌에게 해독제를 사용한다", tier: "SUCCESS" })],
      flash: {
        effects: [
          {
            sourceParticipantId: 1,
            targetParticipantId: 2,
            directEffect: "none",
            directClass: "NONE",
            cause: "none",
            ongoingRemoveIds: [10],
            consumeItem: "해독제",
          },
        ],
      },
    });
    assert.equal(out.ongoingClearedIds.includes(10), false);
  });

  it("6. investigate SUCCESS safe room + Flash poison → ongoing add rejected", () => {
    const out = resolve({
      actors: [actor({ actionType: "investigate", body: "안전한 방을 살핀다", tier: "SUCCESS" })],
      scene: "안전한 방. 위협 없음.",
      flash: {
        effects: [
          {
            participantId: 1,
            directEffect: "none",
            directClass: "NONE",
            cause: "none",
            ongoingAdd: [
              {
                label: "중독",
                kind: "periodic_harm",
                severity: "MEDIUM",
                tickClass: "LIGHT",
                durationBand: "MEDIUM",
                recoveryMode: "save_or_treatment",
                recoveryStat: "res",
                treatmentMode: "item_or_support",
                stackKey: "poison",
              },
            ],
          },
        ],
      },
    });
    assert.equal(out.ongoingAdds.length, 0);
  });

  it("7. stealth FAILURE under gunfire + hazard/enemy_counter → harm allowed", () => {
    const out = resolve({
      actors: [actor({ actionType: "stealth", body: "총격 속에서 숨는다", tier: "FAILURE" })],
      scene: "적의 총격이 복도를 가른다.",
      flash: {
        effects: [{ participantId: 1, directEffect: "harm", directClass: "HEAVY", cause: "enemy_counter" }],
      },
    });
    assert.equal(out.actors[0]?.direct?.effect, "harm");
    assert.ok((out.hpAfter["1"] ?? 20) < 20);
  });

  it("8. investigate FAILURE trap → harm allowed", () => {
    const out = resolve({
      actors: [actor({ actionType: "investigate", body: "바닥의 함정을 살피다 밟는다", tier: "FAILURE" })],
      scene: "숨겨진 함정이 바닥 아래에 있다.",
      flash: {
        effects: [{ participantId: 1, directEffect: "harm", directClass: "MEDIUM", cause: "hazard" }],
      },
    });
    assert.equal(out.actors[0]?.direct?.effect, "harm");
    assert.ok((out.hpAfter["1"] ?? 20) < 20);
  });

  it("9. existing poison tick occurs BEFORE direct heal", () => {
    const out = resolve({
      sheets: [sheet({ hp: 20, participantId: 2, name: "렌" })],
      effects: [poison({ participantId: 2 })],
      actors: [actor({ participantId: 2, name: "렌", actionType: "support", body: "상처를 치료한다", tier: "SUCCESS" })],
      flash: {
        effects: [{ participantId: 2, directEffect: "heal", directClass: "LIGHT", cause: "healing" }],
      },
      rng: () => 4,
    });
    assert.equal(out.ongoingTicks.length, 1);
    assert.equal(out.ongoingTicks[0]?.hpBefore, 20);
    assert.equal(out.ongoingTicks[0]?.hpAfter, 16);
    assert.equal(out.actors[0]?.direct?.effect, "heal");
    assert.equal(out.actors[0]?.direct?.hpBefore, 16);
    assert.ok((out.actors[0]?.direct?.hpAfter ?? 0) > 16);
    const tickAt = out.packet.indexOf("ONGOING:");
    const actionAt = out.packet.indexOf("CURRENT ACTION:");
    assert.ok(tickAt >= 0 && actionAt > tickAt);
  });

  it("10. pre-action poison reduces HP to 0 → current action incapacitation", () => {
    const out = resolve({
      sheets: [sheet({ hp: 3, participantId: 1, name: "강이현" })],
      effects: [poison({ participantId: 1, tickClass: "LIGHT" })],
      actors: [actor({ actionType: "attack", body: "벤다", tier: "FAILURE" })],
      flash: {
        effects: [{ participantId: 1, directEffect: "harm", directClass: "HEAVY", cause: "enemy_counter" }],
      },
      rng: () => 8,
    });
    assert.equal(out.actors[0]?.preActionHp, 0);
    assert.equal(out.actors[0]?.skippedPhysicalAction, true);
    assert.equal(out.actors[0]?.skipReason, "PRE_ACTION_HP_ZERO");
    assert.equal(out.actors[0]?.direct?.effect, "none");
    assert.equal(out.hpAfter["1"], 0);
    assert.match(out.packet, /PRE_ACTION_HP_ZERO/);
    assert.match(out.packet, /쓰러짐/);
  });

  it("11. invalid GM inventory delta → mechanics damage cannot silently disappear", () => {
    const resolution = resolve({
      sheets: [sheet({ hp: 20 })],
      actors: [actor()],
      flash: {
        effects: [{ participantId: 1, directEffect: "harm", directClass: "HEAVY", cause: "enemy_counter" }],
      },
      rng: () => 5,
    });
    assert.ok((resolution.hpAfter["1"] ?? 20) < 20);
    const merged = mergeMechanicsOwnedDelta(
      [sheet({ hp: 20, inventory: ["붕대"] })],
      { players: [{ participantId: 1, hp: 20, inventoryRemove: ["존재하지않는유물"] }] },
      resolution
    );
    assert.equal(merged.ok, true);
    if (merged.ok) {
      assert.equal(merged.INVALID_GM_INVENTORY_DELTA, true);
      assert.equal(merged.AUTHORITATIVE_DAMAGE_NOT_LOST, true);
      assert.equal(merged.next[0]?.hp, resolution.hpAfter["1"]);
    }
  });

  it("12. fallback poison tick + legitimate GM heal → heal survives after tick", () => {
    const resolution = resolve({
      sheets: [sheet({ hp: 20, participantId: 1 })],
      effects: [poison({ participantId: 1 })],
      flash: null,
      fallback: "flash_failure",
      calledFlash: false,
      rng: () => 4,
    });
    assert.equal(resolution.ongoingTicks[0]?.hpAfter, 16);
    const merged = mergeMechanicsOwnedDelta(
      [sheet({ hp: 20, participantId: 1 })],
      { players: [{ participantId: 1, hp: 21 }] },
      resolution
    );
    assert.equal(merged.ok, true);
    if (merged.ok) assert.equal(merged.next[0]?.hp, 21);
  });

  it("13. persistent control remainingTicks=-1 → active, not silently ignored", () => {
    const out = resolve({
      effects: [
        {
          ...poison({
            id: 11,
            participantId: 1,
            label: "마비",
            kind: "control",
            stackKey: "paralysis",
            tickClass: null,
            remainingTicks: -1,
            recoveryMode: "save_or_treatment",
            treatmentMode: "generic_support",
            actionModifier: -1,
          }),
        },
      ],
      recoveryRng: () => 2,
    });
    assert.equal(out.actionModifiers["1"], -1);
    assert.equal(out.preActionRecoveries[0]?.success, false);
    assert.equal(out.ongoingClearedIds.includes(11), false);
  });

  it("14. regen/debuff → rejected in V1", () => {
    const parsed = parseFlashMechanicsOutput(
      JSON.stringify({
        effects: [
          {
            participantId: 1,
            directEffect: "none",
            directClass: "NONE",
            cause: "none",
            ongoingAdd: [
              {
                label: "재생",
                kind: "regen",
                severity: "LIGHT",
                durationBand: "MEDIUM",
                recoveryMode: "duration",
                recoveryStat: "res",
                treatmentMode: "none",
                stackKey: "regen",
              },
              {
                label: "약화",
                kind: "debuff",
                severity: "LIGHT",
                durationBand: "MEDIUM",
                recoveryMode: "duration",
                recoveryStat: "res",
                treatmentMode: "none",
                stackKey: "weak",
              },
            ],
          },
        ],
      } satisfies FlashMechanicsOutput)
    );
    assert.equal(parsed.effects[0]?.ongoingAdd?.length, 0);
    const out = resolve({ flash: parsed });
    assert.equal(out.ongoingAdds.length, 0);
  });

  it("15. ally treatment retry → no double item consume, no double effect clear", () => {
    const first = resolve({
      effects: [poison()],
      actors: [actor({ actionType: "use_item", body: "렌에게 해독제를 사용한다", tier: "SUCCESS" })],
      flash: {
        effects: [
          {
            sourceParticipantId: 1,
            targetParticipantId: 2,
            directEffect: "none",
            directClass: "NONE",
            cause: "none",
            ongoingRemoveIds: [10],
            consumeItem: "해독제",
          },
        ],
      },
    });
    assert.equal(first.consumeItems.length, 1);
    assert.ok(first.ongoingClearedIds.includes(10));
    const retry = resolve({
      effects: [poison()],
      existing: first,
      actors: [actor({ actionType: "use_item", body: "렌에게 해독제를 사용한다", tier: "SUCCESS" })],
      flash: {
        effects: [
          {
            sourceParticipantId: 1,
            targetParticipantId: 2,
            directEffect: "none",
            directClass: "NONE",
            cause: "none",
            ongoingRemoveIds: [10],
            consumeItem: "해독제",
          },
        ],
      },
    });
    assert.equal(retry.consumeItems.length, 1);
    assert.deepEqual(retry.ongoingClearedIds, first.ongoingClearedIds);
    assert.equal(retry.packet, first.packet);
  });

  it("server-owned treatment still clears when Flash omits remove ids", () => {
    const out = resolve({
      effects: [poison()],
      actors: [actor({ actionType: "use_item", body: "렌에게 해독제를 사용한다", tier: "SUCCESS" })],
      flash: { effects: [] },
    });
    assert.ok(out.ongoingClearedIds.includes(10));
    assert.deepEqual(out.consumeItems, [{ participantId: 1, item: "해독제" }]);
  });

  it("specialRules owner is scenario plan, not world_brief", () => {
    const round = readFileSync("src/lib/trpg/mechanicsRound.ts", "utf8");
    assert.match(round, /resolvedCampaignPlan/);
    assert.match(round, /publicSpecialRulesText/);
    assert.doesNotMatch(round, /world_brief/);
    const worldBriefLike = resolve({
      specialRules: "",
      scene: "세계관 설명에는 저주와 영구가 있다",
      flash: {
        effects: [
          {
            participantId: 1,
            directEffect: "none",
            directClass: "NONE",
            cause: "none",
            ongoingAdd: [
              {
                label: "저주",
                kind: "control",
                severity: "HEAVY",
                durationBand: "PERSISTENT",
                recoveryMode: "persistent",
                recoveryStat: "res",
                treatmentMode: "specific_item",
                requiredItem: "전설의해독제",
                stackKey: "curse",
              },
            ],
          },
        ],
      },
    });
    assert.equal(worldBriefLike.ongoingAdds[0]?.recoveryMode, "save_or_treatment");
    assert.notEqual(worldBriefLike.ongoingAdds[0]?.remainingTicks, -1);
  });
});

describe("TRPG mechanics parse aliases", () => {
  it("maps legacy participantId to source and target", () => {
    const parsed = parseFlashOrEmpty(
      JSON.stringify({
        effects: [{ participantId: 7, directEffect: "harm", directClass: "LIGHT", cause: "hazard" }],
      })
    );
    assert.equal(parsed.effects[0]?.sourceParticipantId, 7);
    assert.equal(parsed.effects[0]?.targetParticipantId, 7);
  });
});
