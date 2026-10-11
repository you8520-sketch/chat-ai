import { destinationRefinesDeclared } from "./campaignLedger";
import type { TrpgCampaignContext } from "./campaignContext";
import { clampHpAmount, rollDiceExpression, type DiceRng } from "./mechanicsDice";
import type { ThreatStrikeRecord } from "./mechanicsTypes";
import { parseScenarioEncounters, type TrpgScenarioEncounter } from "./scenarioPlan";
import type { TrpgSheetSnapshot } from "./types";

/**
 * Author-approved threats for a campaign. The only trusted source is the human-authored scenario
 * template snapshot taken when the campaign started. A model-generated sandbox director plan is not
 * consulted, and nothing the GM writes during play can add or alter an encounter.
 */
export function governedEncounters(ctx: TrpgCampaignContext | null): TrpgScenarioEncounter[] {
  if (!ctx || ctx.sourceMode !== "scenario") return [];
  return parseScenarioEncounters(ctx.scenarioSnapshot?.plan?.encounters);
}

function eligibleTargets(
  encounter: TrpgScenarioEncounter,
  sheets: ReadonlyMap<number, TrpgSheetSnapshot>
): TrpgSheetSnapshot[] {
  return [...sheets.values()]
    .filter((sheet) => sheet.hp > 0)
    .filter((sheet) => destinationRefinesDeclared(encounter.location, sheet.location))
    .sort((a, b) => a.participantId - b.participantId);
}

/**
 * Decides this round's server strikes. Mutates `sheets` HP so later owners see the post-strike state.
 * Presence is the seat's own server-bound location (the same place matcher that authorizes movement),
 * read from the start-of-round sheets, so a party that just arrived has had one round before it can be
 * struck and a party that left is out of reach. Per active encounter, in authored order: pick one
 * eligible target, roll d20 against the hit DC, and on a hit roll the encounter's damage class dice.
 * Every number here is server-rolled; no GM input is read.
 * No cap, stacking or area rule is applied across encounters in this slice.
 */
export function resolveThreatStrikes(opts: {
  encounters: readonly TrpgScenarioEncounter[];
  roundNumber: number;
  priorStrikes: Readonly<Record<string, number>>;
  sheets: Map<number, TrpgSheetSnapshot>;
  rng: DiceRng;
  rollD20: () => number;
  baseDc: number;
}): ThreatStrikeRecord[] {
  const out: ThreatStrikeRecord[] = [];
  for (const encounter of opts.encounters) {
    const used = opts.priorStrikes[encounter.id] ?? 0;
    if (opts.roundNumber < encounter.activateRound || used >= encounter.maxStrikes) continue;
    const eligible = eligibleTargets(encounter, opts.sheets);
    if (eligible.length === 0) continue;
    const pick = Math.min(eligible.length, Math.max(1, opts.rng(eligible.length)));
    const target = opts.sheets.get(eligible[pick - 1]!.participantId)!;
    const dc = encounter.hitDc ?? opts.baseDc;
    const d20 = opts.rollD20();
    const hit = d20 >= dc;
    const hpBefore = target.hp;
    let dice: ThreatStrikeRecord["dice"] = null;
    if (hit) {
      dice = rollDiceExpression(encounter.damageClass, target.maxHp, opts.rng);
      target.hp = clampHpAmount(target.hp - dice.amount, target.maxHp);
    }
    out.push({
      encounterId: encounter.id,
      name: encounter.name,
      kind: encounter.kind,
      targetParticipantId: target.participantId,
      eligibleParticipantIds: eligible.map((sheet) => sheet.participantId),
      strikeIndex: used + 1,
      d20,
      dc,
      hit,
      damageClass: encounter.damageClass,
      dice,
      hpBefore,
      hpAfter: target.hp,
    });
  }
  return out;
}

export function formatThreatStrikeLines(
  strikes: readonly ThreatStrikeRecord[],
  nameOf: (participantId: number) => string
): string[] {
  return strikes.map((strike) =>
    strike.hit
      ? `THREAT_STRIKE ${strike.name} → ${nameOf(strike.targetParticipantId)}: d20 ${strike.d20} vs DC ${strike.dc} HIT, ${strike.dice?.expression ?? ""} = ${strike.dice?.total ?? 0}, HP ${strike.hpBefore} → ${strike.hpAfter}`
      : `THREAT_STRIKE ${strike.name} → ${nameOf(strike.targetParticipantId)}: d20 ${strike.d20} vs DC ${strike.dc} MISS, no damage`
  );
}
