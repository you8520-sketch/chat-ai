import { namesOverlap } from "./memoryHorizon";
import { DIRECT_DICE, TIER_HARM_CAP, hpUnit } from "./mechanicsDice";
import { resolveParticipantHp } from "./mechanicsMerge";
import { MECHANICS_CLASSES, type MechanicsClass, type MechanicsResolution } from "./mechanicsTypes";
import { hasPhysicalThreatCue } from "./mechanicsValidate";
import type { TrpgActionType } from "./actionTypes";
import type { TrpgSheetSnapshot, TrpgStateDelta, TrpgSuccessTier } from "./types";

/**
 * Slice 1a shadow: reports how well a GM HP drop is grounded in SERVER facts.
 * Pure and read-only: nothing here is applied to sheets, HP, conditions or items,
 * and nothing here is an approval.
 *
 * What the server can actually prove today:
 *   - server ongoing ticks (ONGOING), and
 *   - that a seat's d20 tier was frozen at round lock.
 * What the server cannot prove today (no typed threat record, no authored scene
 * presence, no structured target — `trpg_action_submissions.target` is never
 * written): that an enemy/hazard exists in this scene, is engaged, or targeted
 * the damaged seat. A frozen roll is not evidence of any of those, and neither is
 * a template NPC name, a GM-writable ledger NPC name, or a word in player text.
 * Those only produce an INSUFFICIENT_GROUNDING diagnostic with a potential ceiling
 * (TIER_HARM_CAP → DIRECT_DICE × hpUnit) for later comparison. AUTHORED /
 * ESTABLISHED / CURRENT_CHECK become reachable only with a server-owned threat record.
 *
 * Free text from non-human seats (bot_model / host_fill) is a model assertion, so it
 * never feeds engagement cues or NPC-name hints; their structured action type and
 * frozen tier still count, so an AI seat responding to a threat is not discarded.
 */

export const THREAT_GROUNDINGS = ["ONGOING", "INSUFFICIENT_GROUNDING", "GM_PROPOSAL", "UNGROUNDED"] as const;
export type ThreatGrounding = (typeof THREAT_GROUNDINGS)[number];

export const THREAT_SHADOW_VERDICTS = [
  "SERVER_EXPLAINED",
  "INSUFFICIENT_GROUNDING",
  "NO_SELF_APPROVAL_NEW_THREAT",
  "NO_SERVER_BASIS",
] as const;
export type ThreatShadowVerdict = (typeof THREAT_SHADOW_VERDICTS)[number];

export type ThreatShadowPolicyFlag =
  | "TARGET_BINDING_UNAVAILABLE"
  | "MULTI_SOURCE_SAME_TARGET"
  | "ONE_SOURCE_MULTI_TARGET"
  | "AUTONOMOUS_THREAT_UNVERIFIABLE";

export type ThreatShadowActor = {
  participantId: number;
  actionType: TrpgActionType | null;
  body: string;
  tier: TrpgSuccessTier | null;
  /** `trpg_action_submissions.source`; only "human" text is treated as a player assertion. */
  source: string | null;
};

export type ThreatShadowInput = {
  roundId: number;
  roundNumber: number;
  startSheets: readonly TrpgSheetSnapshot[];
  appliedSheets: readonly TrpgSheetSnapshot[];
  gmDelta: TrpgStateDelta;
  mechanics: MechanicsResolution | null;
  actors: readonly ThreatShadowActor[];
  authoredNpcNames: readonly string[];
  ledgerNpcNames: readonly string[];
};

/** Diagnostic only: a frozen roll on an engaged-looking action. Not proof of any threat. */
export type ThreatShadowSignal = {
  sourceParticipantId: number;
  sourceKind: "HUMAN" | "NON_HUMAN";
  engagement: "ACTION_TYPE" | "HUMAN_TEXT_CUE";
  tier: TrpgSuccessTier;
  potentialCeilingClass: Exclude<MechanicsClass, "NONE">;
  expression: string;
  maxUnits: number;
  /** Name match against template / ledger NPCs in human text. Presence in the scene stays unverified. */
  nameHint: { name: string; listedIn: "TEMPLATE" | "LEDGER_GM_WRITABLE" } | null;
  threatPresence: "UNVERIFIED";
  targetBinding: "UNVERIFIED";
  matchedTargets: number[];
  gmOmitted: boolean;
};

export type ThreatShadowClaim = {
  eventKey: string;
  targetParticipantId: number;
  grounding: ThreatGrounding;
  verdict: ThreatShadowVerdict;
  startHp: number;
  gmHp: number;
  gmDropHp: number;
  serverTickHp: number;
  unexplainedDropHp: number;
  neededClass: Exclude<MechanicsClass, "NONE"> | "BEYOND_CRITICAL" | null;
  appliedHp: number;
  appliedGmDropHp: number;
  signalSources: number[];
  signalBasis: "SELF_ACTION" | "OTHER_ACTOR" | "NONE";
  potentialCeilingSingleHp: number;
  potentialCeilingCombinedHp: number;
  /** Informational comparison with the potential ceiling; null when no signal exists. Never an approval. */
  withinPotentialCeiling: boolean | null;
  newThreatThisRound: boolean;
  divergence: boolean;
};

export type ThreatShadowReport = {
  roundId: number;
  roundNumber: number;
  claims: ThreatShadowClaim[];
  signals: ThreatShadowSignal[];
  policyOpen: ThreatShadowPolicyFlag[];
};

type HarmClass = Exclude<MechanicsClass, "NONE">;

const HARM_CLASSES = MECHANICS_CLASSES.filter((klass): klass is HarmClass => klass !== "NONE");

function maxUnitsOf(klass: HarmClass): number {
  const spec = DIRECT_DICE[klass];
  return spec.count * spec.sides;
}

function neededClassFor(dropHp: number, maxHp: number): ThreatShadowClaim["neededClass"] {
  if (dropHp <= 0) return null;
  const unit = hpUnit(maxHp);
  return HARM_CLASSES.find((klass) => maxUnitsOf(klass) * unit >= dropHp) ?? "BEYOND_CRITICAL";
}

function serverTickDrop(mechanics: MechanicsResolution | null, participantId: number): number {
  if (!mechanics) return 0;
  return mechanics.ongoingTicks
    .filter((row) => row.participantId === participantId)
    .reduce((sum, row) => sum + Math.max(0, row.hpBefore - row.hpAfter), 0);
}

function nameHintFor(
  body: string,
  authored: readonly string[],
  ledgerOnly: readonly string[]
): ThreatShadowSignal["nameHint"] {
  const hit = (names: readonly string[]) =>
    names.find((name) => name.trim().length >= 2 && namesOverlap(body, name)) ?? null;
  const template = hit(authored);
  if (template) return { name: template, listedIn: "TEMPLATE" };
  const ledger = hit(ledgerOnly);
  return ledger ? { name: ledger, listedIn: "LEDGER_GM_WRITABLE" } : null;
}

function buildSignals(input: ThreatShadowInput): ThreatShadowSignal[] {
  const authoredSet = new Set(input.authoredNpcNames);
  const ledgerOnly = input.ledgerNpcNames.filter((name) => !authoredSet.has(name));
  const skipped = new Set(
    (input.mechanics?.actors ?? []).filter((row) => row.skippedPhysicalAction).map((row) => row.participantId)
  );
  const out: ThreatShadowSignal[] = [];
  for (const actor of input.actors) {
    if (actor.tier == null || skipped.has(actor.participantId)) continue;
    const cap = TIER_HARM_CAP[actor.tier];
    if (cap === "NONE") continue;
    const human = actor.source === "human";
    const byType = actor.actionType === "attack" || actor.actionType === "defend";
    if (!byType && !(human && hasPhysicalThreatCue(actor.body))) continue;
    const spec = DIRECT_DICE[cap];
    out.push({
      sourceParticipantId: actor.participantId,
      sourceKind: human ? "HUMAN" : "NON_HUMAN",
      engagement: byType ? "ACTION_TYPE" : "HUMAN_TEXT_CUE",
      tier: actor.tier,
      potentialCeilingClass: cap,
      expression: `${spec.count}d${spec.sides}`,
      maxUnits: maxUnitsOf(cap),
      nameHint: human ? nameHintFor(actor.body, input.authoredNpcNames, ledgerOnly) : null,
      threatPresence: "UNVERIFIED",
      targetBinding: "UNVERIFIED",
      matchedTargets: [],
      gmOmitted: true,
    });
  }
  return out;
}

export function evaluateThreatShadow(input: ThreatShadowInput): ThreatShadowReport {
  const signals = buildSignals(input);
  const knownNpcs = new Set([...input.authoredNpcNames, ...input.ledgerNpcNames].map((name) => name.trim()));
  const newThreatThisRound = (input.gmDelta.npcsAdd ?? []).some((name) => {
    const trimmed = name.trim();
    return trimmed.length > 0 && !knownNpcs.has(trimmed);
  });
  const appliedById = new Map(input.appliedSheets.map((sheet) => [sheet.participantId, sheet]));
  const claims: ThreatShadowClaim[] = [];
  const seen = new Set<number>();

  for (const patch of input.gmDelta.players ?? []) {
    if (seen.has(patch.participantId)) continue;
    seen.add(patch.participantId);
    const start = input.startSheets.find((sheet) => sheet.participantId === patch.participantId);
    const gmHp = patch.hp;
    if (
      !start ||
      typeof gmHp !== "number" ||
      !Number.isInteger(gmHp) ||
      gmHp < 0 ||
      gmHp > start.maxHp ||
      gmHp >= start.hp
    ) {
      continue;
    }
    const gmDropHp = start.hp - gmHp;
    const serverTickHp = serverTickDrop(input.mechanics, start.participantId);
    const unexplainedDropHp = Math.max(0, gmDropHp - serverTickHp);
    const appliedHp = appliedById.get(start.participantId)?.hp ?? start.hp;
    const floorHp =
      input.mechanics?.complete === true
        ? resolveParticipantHp({
            startHp: start.hp,
            maxHp: start.maxHp,
            resolution: input.mechanics,
            participantId: start.participantId,
            gmHp: null,
          })
        : start.hp;
    const appliedGmDropHp = Math.max(0, floorHp - appliedHp);

    const own = signals.filter((row) => row.sourceParticipantId === start.participantId);
    const matched =
      own.length > 0 ? own : signals.filter((row) => row.sourceParticipantId !== start.participantId);
    const signalBasis: ThreatShadowClaim["signalBasis"] =
      matched.length === 0 ? "NONE" : own.length > 0 ? "SELF_ACTION" : "OTHER_ACTOR";
    for (const row of matched) {
      row.matchedTargets.push(start.participantId);
      row.gmOmitted = false;
    }
    const unit = hpUnit(start.maxHp);
    const singleHp = matched.reduce((max, row) => Math.max(max, row.maxUnits * unit), 0);
    const combinedHp = matched.reduce((sum, row) => sum + row.maxUnits * unit, 0);

    let grounding: ThreatGrounding;
    let verdict: ThreatShadowVerdict;
    if (unexplainedDropHp === 0) {
      grounding = "ONGOING";
      verdict = "SERVER_EXPLAINED";
    } else if (matched.length > 0) {
      grounding = "INSUFFICIENT_GROUNDING";
      verdict = "INSUFFICIENT_GROUNDING";
    } else if (newThreatThisRound) {
      grounding = "GM_PROPOSAL";
      verdict = "NO_SELF_APPROVAL_NEW_THREAT";
    } else {
      grounding = "UNGROUNDED";
      verdict = "NO_SERVER_BASIS";
    }

    claims.push({
      eventKey: `threat-shadow:${input.roundId}:hp_drop:${start.participantId}`,
      targetParticipantId: start.participantId,
      grounding,
      verdict,
      startHp: start.hp,
      gmHp,
      gmDropHp,
      serverTickHp,
      unexplainedDropHp,
      neededClass: neededClassFor(unexplainedDropHp, start.maxHp),
      appliedHp,
      appliedGmDropHp,
      signalSources: matched.map((row) => row.sourceParticipantId),
      signalBasis,
      potentialCeilingSingleHp: singleHp,
      potentialCeilingCombinedHp: combinedHp,
      withinPotentialCeiling: matched.length === 0 ? null : unexplainedDropHp <= singleHp,
      newThreatThisRound,
      divergence: verdict !== "SERVER_EXPLAINED",
    });
  }

  const policyOpen = new Set<ThreatShadowPolicyFlag>();
  if (claims.some((claim) => claim.verdict === "INSUFFICIENT_GROUNDING")) {
    policyOpen.add("TARGET_BINDING_UNAVAILABLE");
  }
  if (claims.some((claim) => claim.signalBasis === "OTHER_ACTOR" && claim.signalSources.length > 1)) {
    policyOpen.add("MULTI_SOURCE_SAME_TARGET");
  }
  if (signals.some((row) => row.matchedTargets.length > 1)) {
    policyOpen.add("ONE_SOURCE_MULTI_TARGET");
  }
  if (
    claims.some((claim) => claim.verdict === "NO_SERVER_BASIS") &&
    (input.authoredNpcNames.length > 0 || input.ledgerNpcNames.length > 0)
  ) {
    policyOpen.add("AUTONOMOUS_THREAT_UNVERIFIABLE");
  }

  return {
    roundId: input.roundId,
    roundNumber: input.roundNumber,
    claims,
    signals,
    policyOpen: [...policyOpen],
  };
}

export function formatThreatShadowLog(report: ThreatShadowReport): string {
  const verdicts: Record<string, number> = {};
  for (const claim of report.claims) verdicts[claim.verdict] = (verdicts[claim.verdict] ?? 0) + 1;
  const gmDropApplied = report.claims.filter((claim) => claim.appliedGmDropHp > 0).length;
  return (
    `[trpg-threat-shadow] round=${report.roundNumber} claims=${report.claims.length} ` +
    `signals=${report.signals.length} gmOmittedSignals=${report.signals.filter((row) => row.gmOmitted).length} ` +
    `gmDropApplied=${gmDropApplied} verdicts=${JSON.stringify(verdicts)} ` +
    `groundings=${JSON.stringify(report.claims.map((claim) => `${claim.targetParticipantId}:${claim.grounding}`))} ` +
    `policyOpen=${JSON.stringify(report.policyOpen)}`
  );
}

export function threatShadowHasSignal(report: ThreatShadowReport): boolean {
  return report.claims.length > 0 || report.signals.length > 0;
}
