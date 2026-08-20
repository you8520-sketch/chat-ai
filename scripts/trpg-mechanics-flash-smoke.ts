/**
 * Local/safe Flash 0731 smoke for PR #515 blockers.
 * Does not enable TRPG_MECHANICS_REFEREE_ENABLED (default stays false).
 * One Flash call per fixture. thinking.disabled + reasoning_effort=none.
 */
import { adaptTrpgReplySuggestionChatBody } from "../src/lib/trpg/replySuggestions";
import {
  buildMechanicsRefereeUserBlock,
  callTrpgMechanicsReferee,
  TRPG_MECHANICS_REFEREE_SYSTEM,
} from "../src/lib/trpg/mechanicsReferee";
import { parseFlashOrEmpty, resolveRoundMechanics } from "../src/lib/trpg/mechanicsResolve";
import { isTrpgMechanicsRefereeEnabled, TRPG_MECHANICS_REFEREE_MODEL } from "../src/lib/trpg/mechanicsTypes";
import type { MechanicsActorInput, TrpgOngoingEffect } from "../src/lib/trpg/mechanicsTypes";
import type { TrpgSheetSnapshot } from "../src/lib/trpg/types";

function sheet(id: number, name: string, hp: number, inventory: string[]): TrpgSheetSnapshot {
  return {
    participantId: id,
    name,
    playerName: name,
    level: 1,
    hp,
    maxHp: 25,
    stats: { str: 8, dex: 8, con: 8, int: 8, wis: 8, cha: 8, res: 8 },
    conditions: [],
    inventory,
    location: "폐허",
    modifiersNote: "",
  };
}

function actor(partial: Partial<MechanicsActorInput> & Pick<MechanicsActorInput, "participantId" | "name">): MechanicsActorInput {
  return {
    actionType: "free",
    body: "",
    tier: "FAILURE",
    d20: 6,
    modifier: 1,
    finalScore: 7,
    dc: 12,
    statKey: "str",
    ...partial,
  };
}

function poison(id: number, participantId: number): TrpgOngoingEffect {
  return {
    id,
    campaignId: 1,
    participantId,
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
  };
}

const fixtures = [
  {
    name: "melee_failure_harm",
    scene: "폐허 복도. 독니 달린 적이 칼을 받아친다.",
    actors: [actor({ participantId: 1, name: "강이현", actionType: "attack", body: "근접으로 벤다", tier: "FAILURE" })],
    sheets: [sheet(1, "강이현", 20, ["해독제"])],
    effects: [] as TrpgOngoingEffect[],
  },
  {
    name: "safe_investigate_failure_no_harm",
    scene: "안전한 방. 먼지와 책만 있다. 위협 없음.",
    actors: [actor({ participantId: 1, name: "강이현", actionType: "investigate", body: "책장을 살핀다", tier: "FAILURE" })],
    sheets: [sheet(1, "강이현", 20, ["해독제"])],
    effects: [] as TrpgOngoingEffect[],
  },
  {
    name: "poison_application",
    scene: "독니 달린 적이 강이현의 팔을 스친다. 전투 중.",
    actors: [actor({ participantId: 1, name: "강이현", actionType: "attack", body: "독니 달린 적에게 벤다", tier: "FAILURE" })],
    sheets: [sheet(1, "강이현", 20, ["해독제"])],
    effects: [] as TrpgOngoingEffect[],
  },
  {
    name: "self_antidote",
    scene: "강이현이 해독제를 마신다.",
    actors: [actor({ participantId: 1, name: "강이현", actionType: "use_item", body: "해독제를 마신다", tier: "SUCCESS", d20: 16, finalScore: 17 })],
    sheets: [sheet(1, "강이현", 18, ["해독제"])],
    effects: [poison(10, 1)],
  },
  {
    name: "ally_antidote",
    scene: "강이현이 중독된 렌에게 해독제를 사용한다.",
    actors: [actor({ participantId: 1, name: "강이현", actionType: "use_item", body: "렌에게 해독제를 사용한다", tier: "SUCCESS", d20: 15, finalScore: 16 })],
    sheets: [sheet(1, "강이현", 20, ["해독제"]), sheet(2, "렌", 16, [])],
    effects: [poison(10, 2)],
  },
  {
    name: "paralysis_recovery",
    scene: "렌이 마비에서 벗어나려 이를 악문다.",
    actors: [actor({ participantId: 2, name: "렌", actionType: "free", body: "몸을 일으키려 한다", tier: "PARTIAL_SUCCESS", d20: 10, finalScore: 11 })],
    sheets: [sheet(2, "렌", 18, [])],
    effects: [
      {
        ...poison(11, 2),
        label: "마비",
        kind: "control" as const,
        stackKey: "paralysis",
        tickClass: null,
        remainingTicks: 2,
        recoveryMode: "save_or_treatment" as const,
        actionModifier: -1,
      },
    ],
  },
];

async function main() {
  const outbound = adaptTrpgReplySuggestionChatBody({ model: TRPG_MECHANICS_REFEREE_MODEL });
  const report: Record<string, unknown> = {
    FLAG_DEFAULT: isTrpgMechanicsRefereeEnabled({}),
    MODEL: TRPG_MECHANICS_REFEREE_MODEL,
    thinking: outbound.thinking,
    reasoning_effort: outbound.reasoning_effort,
    fixtures: [] as unknown[],
  };
  if (report.FLAG_DEFAULT !== false) {
    throw new Error("TRPG_MECHANICS_REFEREE_ENABLED must default false");
  }
  if (JSON.stringify(outbound.thinking) !== JSON.stringify({ type: "disabled" }) || outbound.reasoning_effort !== "none") {
    throw new Error("Flash true-off missing");
  }

  for (const fixture of fixtures) {
    const user = buildMechanicsRefereeUserBlock({
      scene: fixture.scene,
      resolutionOrder: "[RESOLUTION ORDER]\n1",
      actors: fixture.actors,
      sheets: fixture.sheets,
      effects: fixture.effects,
      specialRules: "",
    });
    let flash: Awaited<ReturnType<typeof callTrpgMechanicsReferee>> | null = null;
    let lastError = "";
    for (let attempt = 0; attempt < 3 && !flash; attempt++) {
      try {
        flash = await callTrpgMechanicsReferee({
          system: TRPG_MECHANICS_REFEREE_SYSTEM,
          user,
        });
      } catch (error) {
        lastError = error instanceof Error ? error.message : String(error);
        await new Promise((resolve) => setTimeout(resolve, 1500 * (attempt + 1)));
      }
    }
    if (!flash) {
      (report.fixtures as unknown[]).push({
        name: fixture.name,
        FLASH_CALLS_PER_ROUND: 1,
        fallbackPath: "flash_failure",
        error: lastError,
      });
      continue;
    }
    const parsed = parseFlashOrEmpty(flash.text);
    const resolved = resolveRoundMechanics({
      campaignId: 1,
      roundId: 1,
      roundNumber: 6,
      sheets: fixture.sheets,
      effects: fixture.effects,
      actors: fixture.actors,
      flash: parsed,
      flashRaw: flash.text,
      fallback: "none",
      calledFlash: true,
      model: flash.model,
      latencyMs: flash.latencyMs,
      baseDc: 12,
      scene: fixture.scene,
      rng: () => 3,
      recoveryRng: () => 4,
    });
    const row = {
      name: fixture.name,
      FLASH_CALLS_PER_ROUND: resolved.observability.FLASH_CALLS_PER_ROUND,
      latencyMs: flash.latencyMs,
      model: flash.model,
      flashEffects: parsed.effects.length,
      serverHarm: resolved.observability.MECHANICS_HARM_COUNT,
      serverHeal: resolved.observability.MECHANICS_HEAL_COUNT,
      ongoingAdds: resolved.ongoingAdds.map((item) => item.label),
      ongoingCleared: resolved.ongoingClearedIds,
      hpAfter: resolved.hpAfter,
      validation: resolved.validation,
      flashPreview: flash.text.slice(0, 280),
    };
    if (row.FLASH_CALLS_PER_ROUND > 1) {
      throw new Error(`${fixture.name} FLASH_CALLS_PER_ROUND=${row.FLASH_CALLS_PER_ROUND}`);
    }
    (report.fixtures as unknown[]).push(row);
    console.log(JSON.stringify(row, null, 2));
  }

  const tick = resolveRoundMechanics({
    campaignId: 1,
    roundId: 2,
    roundNumber: 6,
    sheets: [sheet(1, "강이현", 20, ["해독제"])],
    effects: [poison(10, 1)],
    actors: [actor({ participantId: 1, name: "강이현", actionType: "investigate", body: "주변을 살핀다", tier: "SUCCESS", d20: 14, finalScore: 15 })],
    flash: null,
    fallback: "flash_failure",
    calledFlash: false,
    model: null,
    latencyMs: 0,
    baseDc: 12,
    scene: "안전한 방",
    rng: () => 3,
    recoveryRng: () => 1,
  });
  (report.fixtures as unknown[]).push({
    name: "poison_next_round_tick",
    FLASH_CALLS_PER_ROUND: tick.observability.FLASH_CALLS_PER_ROUND,
    ongoingTicks: tick.ongoingTicks.length,
    hpAfter: tick.hpAfter,
  });

  const malformed = resolveRoundMechanics({
    campaignId: 1,
    roundId: 3,
    roundNumber: 6,
    sheets: [sheet(1, "강이현", 20, ["해독제"])],
    effects: [poison(10, 1)],
    actors: [actor({ participantId: 1, name: "강이현", actionType: "attack", body: "벤다", tier: "FAILURE" })],
    flash: parseFlashOrEmpty("{not-json"),
    fallback: "flash_failure",
    calledFlash: true,
    model: TRPG_MECHANICS_REFEREE_MODEL,
    latencyMs: 1,
    baseDc: 12,
    rng: () => 3,
    recoveryRng: () => 1,
  });
  (report.fixtures as unknown[]).push({
    name: "flash_malformed_fallback",
    FLASH_CALLS_PER_ROUND: malformed.observability.FLASH_CALLS_PER_ROUND,
    fallback: malformed.fallback,
    ongoingTicks: malformed.ongoingTicks.length,
    hpAfter: malformed.hpAfter,
  });

  try {
    await callTrpgMechanicsReferee({
      system: TRPG_MECHANICS_REFEREE_SYSTEM,
      user: "Return {",
    });
    (report.fixtures as unknown[]).push({ name: "flash_timeout_or_short", note: "call returned" });
  } catch (error) {
    (report.fixtures as unknown[]).push({
      name: "flash_timeout_or_short",
      fallbackPath: "flash_failure",
      error: error instanceof Error ? error.message : String(error),
    });
  }

  console.log(JSON.stringify({ ok: true, FLAG_DEFAULT: report.FLAG_DEFAULT, thinking: report.thinking, reasoning_effort: report.reasoning_effort }, null, 2));
}

void main().catch((error) => {
  console.error(error);
  process.exit(1);
});
