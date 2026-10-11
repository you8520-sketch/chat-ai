import { namesOverlap } from "./memoryHorizon";
import { DIRECT_DICE, TIER_HARM_CAP, hpUnit } from "./mechanicsDice";
import { resolveParticipantHp } from "./mechanicsMerge";
import { MECHANICS_CLASSES, type MechanicsClass, type MechanicsResolution } from "./mechanicsTypes";
import { hasPhysicalThreatCue } from "./mechanicsValidate";
import type { TrpgActionType } from "./actionTypes";
import type { TrpgSheetSnapshot, TrpgStateDelta, TrpgSuccessTier } from "./types";

/**
 * Slice 1a shadow: classifies how well a GM HP drop is grounded in SERVER facts and
 * derives the server-approvable envelope from the existing mechanics owner
 * (TIER_HARM_CAP / DIRECT_DICE / hpUnit). Pure and read-only: the result is never
 * applied to sheets, HP, conditions or items.
 *
 * Authority rule: a GM HP number, NPC name, cause string or ID is never a trust
 * basis. Grounding comes only from (a) server persistent effects, (b) a human
 * action whose server d20 tier was fixed at round lock, (c) scenario/ledger state
 * committed before this round. Narrative creation by the GM stays unrestricted;
 * only mechanical damage approval is judged here.
 */

export const THREAT_GROUNDINGS = [
  "AUTHORED",
  "ESTABLISHED",
  "CURRENT_CHECK",
  "GM_PROPOSAL",
  "UNGROUNDED",
  "ONGOING",
] as const;
export type ThreatGrounding = (typeof THREAT_GROUNDINGS)[number];

export const THREAT_SHADOW_VERDICTS = [
  "SERVER_EXPLAINED",
  "CANDIDATE_WITHIN_ENVELOPE",
  "CANDIDATE_NEEDS_MULTI_SOURCE",
  "CANDIDATE_EXCEEDS_ENVELOPE",
  "NO_SELF_APPROVAL_NEW_THREAT",
  "NO_SERVER_BASIS",
] as const;
export type ThreatShadowVerdict = (typeof THREAT_SHADOW_VERDICTS)[number];

export type ThreatShadowPolicyFlag =
  | "MULTI_SOURCE_SAME_TARGET"
  | "ONE_SOURCE_MULTI_TARGET"
  | "AUTONOMOUS_THREAT_UNVERIFIABLE";

export type ThreatShadowActor = {
  participantId: number;
  actionType: TrpgActionType | null;
  body: string;
  tier: TrpgSuccessTier | null;
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

export type ThreatShadowCandidate = {
  sourceParticipantId: number;
  tier: TrpgSuccessTier;
  capClass: Exclude<MechanicsClass, "NONE">;
  expression: string;
  maxUnits: number;
  origin: "AUTHORED" | "ESTABLISHED" | "UNBOUND";
  boundNpc: string | null;
  boundTargets: number[];
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
  candidateSources: number[];
  candidateBasis: "SELF" | "OTHER_ACTOR" | "NONE";
  singleMaxHp: number;
  combinedMaxHp: number;
  newThreatThisRound: boolean;
  divergence: boolean;
  insufficientGrounding: boolean;
};

export type ThreatShadowReport = {
  roundId: number;
  roundNumber: number;
  claims: ThreatShadowClaim[];
  candidates: ThreatShadowCandidate[];
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

function boundNpcName(body: string, names: readonly string[]): string | null {
  return names.find((name) => name.trim().length >= 2 && namesOverlap(body, name)) ?? null;
}

function buildCandidates(input: ThreatShadowInput): ThreatShadowCandidate[] {
  const authored = input.authoredNpcNames;
  const authoredSet = new Set(authored);
  const established = input.ledgerNpcNames.filter((name) => !authoredSet.has(name));
  const skipped = new Set(
    (input.mechanics?.actors ?? []).filter((row) => row.skippedPhysicalAction).map((row) => row.participantId)
  );
  const out: ThreatShadowCandidate[] = [];
  for (const actor of input.actors) {
    if (actor.tier == null || skipped.has(actor.participantId)) continue;
    const cap = TIER_HARM_CAP[actor.tier];
    if (cap === "NONE") continue;
    const engaged =
      actor.actionType === "attack" || actor.actionType === "defend" || hasPhysicalThreatCue(actor.body);
    if (!engaged) continue;
    const authoredHit = boundNpcName(actor.body, authored);
    const establishedHit = authoredHit ? null : boundNpcName(actor.body, established);
    const spec = DIRECT_DICE[cap];
    out.push({
      sourceParticipantId: actor.participantId,
      tier: actor.tier,
      capClass: cap,
      expression: `${spec.count}d${spec.sides}`,
      maxUnits: maxUnitsOf(cap),
      origin: authoredHit ? "AUTHORED" : establishedHit ? "ESTABLISHED" : "UNBOUND",
      boundNpc: authoredHit ?? establishedHit,
      boundTargets: [],
      gmOmitted: true,
    });
  }
  return out;
}

export function evaluateThreatShadow(input: ThreatShadowInput): ThreatShadowReport {
  const candidates = buildCandidates(input);
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

    const own = candidates.filter((row) => row.sourceParticipantId === start.participantId);
    const bound = own.length > 0 ? own : candidates.filter((row) => row.sourceParticipantId !== start.participantId);
    const candidateBasis: ThreatShadowClaim["candidateBasis"] =
      bound.length === 0 ? "NONE" : own.length > 0 ? "SELF" : "OTHER_ACTOR";
    for (const row of bound) {
      row.boundTargets.push(start.participantId);
      row.gmOmitted = false;
    }
    const unit = hpUnit(start.maxHp);
    const singleMaxHp = bound.reduce((max, row) => Math.max(max, row.maxUnits * unit), 0);
    const combinedMaxHp = bound.reduce((sum, row) => sum + row.maxUnits * unit, 0);

    let grounding: ThreatGrounding;
    let verdict: ThreatShadowVerdict;
    if (unexplainedDropHp === 0) {
      grounding = "ONGOING";
      verdict = "SERVER_EXPLAINED";
    } else if (bound.length > 0) {
      const origins = bound.map((row) => row.origin);
      grounding = origins.includes("AUTHORED")
        ? "AUTHORED"
        : origins.includes("ESTABLISHED")
          ? "ESTABLISHED"
          : "CURRENT_CHECK";
      verdict =
        unexplainedDropHp <= singleMaxHp
          ? "CANDIDATE_WITHIN_ENVELOPE"
          : bound.length > 1 && unexplainedDropHp <= combinedMaxHp
            ? "CANDIDATE_NEEDS_MULTI_SOURCE"
            : "CANDIDATE_EXCEEDS_ENVELOPE";
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
      candidateSources: bound.map((row) => row.sourceParticipantId),
      candidateBasis,
      singleMaxHp,
      combinedMaxHp,
      newThreatThisRound,
      divergence: verdict !== "SERVER_EXPLAINED" && verdict !== "CANDIDATE_WITHIN_ENVELOPE",
      insufficientGrounding: grounding === "UNGROUNDED" || grounding === "GM_PROPOSAL",
    });
  }

  const policyOpen = new Set<ThreatShadowPolicyFlag>();
  if (claims.some((claim) => claim.candidateBasis === "OTHER_ACTOR" && claim.candidateSources.length > 1)) {
    policyOpen.add("MULTI_SOURCE_SAME_TARGET");
  }
  if (candidates.some((row) => row.boundTargets.length > 1)) {
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
    candidates,
    policyOpen: [...policyOpen],
  };
}

export function formatThreatShadowLog(report: ThreatShadowReport): string {
  const verdicts: Record<string, number> = {};
  for (const claim of report.claims) verdicts[claim.verdict] = (verdicts[claim.verdict] ?? 0) + 1;
  const gmDropApplied = report.claims.filter((claim) => claim.appliedGmDropHp > 0).length;
  return (
    `[trpg-threat-shadow] round=${report.roundNumber} claims=${report.claims.length} ` +
    `candidates=${report.candidates.length} gmOmittedCandidates=${report.candidates.filter((row) => row.gmOmitted).length} ` +
    `gmDropApplied=${gmDropApplied} verdicts=${JSON.stringify(verdicts)} ` +
    `groundings=${JSON.stringify(report.claims.map((claim) => `${claim.targetParticipantId}:${claim.grounding}`))} ` +
    `policyOpen=${JSON.stringify(report.policyOpen)}`
  );
}

export function threatShadowHasSignal(report: ThreatShadowReport): boolean {
  return report.claims.length > 0 || report.candidates.length > 0;
}
