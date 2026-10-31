import type { CharacterAsset } from "@/lib/characterAssets";
import type { TrpgPublicAiCharacterAssets } from "./aiCharacterContext";
import type { TrpgPublicScenarioNpcImage } from "./scenarioNpcAssets";
import type { TrpgActionType } from "./actionTypes";
import type { PublicExploration } from "./explorationPublic";
import type { TrpgPublicGoal } from "./campaignGoals";
import type { TrpgResolutionOrderEntry } from "./initiative";
import type { TrpgParticipantAdjudicationOutcome } from "./roundAdjudication";
import type { TrpgSheetHudCard } from "./sheetView";
import type {
  TrpgActionSource,
  TrpgBillingMode,
  TrpgDiceRules,
  TrpgParticipantKind,
  TrpgParticipantStatus,
  TrpgRoundPhase,
  TrpgStatDefinition,
  TrpgSuccessTier,
} from "./types";

export type TrpgReadyState =
  | "writing"
  | "submitted"
  | "disconnected"
  | "incapacitated"
  | "spectating"
  | "bot_pending";

export type TrpgPublicParticipant = {
  id: number;
  slotIndex: number;
  kind: TrpgParticipantKind;
  userId: number | null;
  characterId: number | null;
  displayName: string;
  canAct: boolean;
  status: TrpgParticipantStatus;
  ready: TrpgReadyState;
  hasSheet: boolean;
  sheetConfirmed: boolean;
};

export type TrpgPublicRoll = {
  participantId: number;
  name: string;
  d20: number;
  statKey: string;
  finalScore: number;
  dc: number;
  tier: TrpgSuccessTier;
  success: boolean;
  actionBody: string;
  actionType: TrpgActionType | null;
  kind: TrpgParticipantKind;
};

export type TrpgPublicAction = {
  participantId: number;
  name: string;
  body: string;
  revealed: boolean;
  kind: TrpgParticipantKind;
  actionType: TrpgActionType | null;
};

export type TrpgPublicLog = {
  roundNumber: number;
  rolls: TrpgPublicRoll[];
  narration: string | null;
  actions: TrpgPublicAction[];
  billedPoints: number | null;
  viewerSharePoints: number | null;
  humanCount?: number;
  botCount?: number;
  billingHint?: string;
  billingMode?: TrpgBillingMode;
};

export type TrpgPartyChatMessage = {
  id: number;
  participantId: number;
  userId: number;
  name: string;
  body: string;
  createdAt: string;
  isSelf: boolean;
};

export type TrpgCampaignSnapshot = {
  id: number;
  title: string;
  inviteCode: string;
  invitePath: string;
  hostUserId: number;
  sourceCharacterId: number | null;
  worldBrief: string;
  relationshipBrief: string;
  billingMode: TrpgBillingMode;
  billingModeLocked: boolean;
  campaignStatus: string;
  /** Server-side ending decision stored on the latest committed GM round. */
  endingDecision?: { kind: string; reason?: string } | null;
  maxSlots: number;
  pointPool: number;
  statDefs: TrpgStatDefinition[];
  diceRules: TrpgDiceRules;
  suggestedPcStats: Record<string, number> | null;
  viewerParticipantId: number | null;
  viewerPersonaId: number | null;
  viewerUserId: number;
  viewerIsHost: boolean;
  botRetryRequired: boolean;
  /**
   * @deprecated Stale pre-#636 client compatibility only.
   * Manual host-fill no longer exists. Always false.
   */
  needsHostFill: boolean;
  /**
   * @deprecated Stale pre-#636 client compatibility only.
   * Manual host-fill no longer exists. Always empty.
   */
  hostFillBotIds: number[];
  round: {
    id: number | null;
    number: number;
    phase: TrpgRoundPhase | "NONE";
    /** Server-frozen current-round presentation roster, ordered by resolution order. */
    expectedPresentationActorIds?: number[];
  };
  participants: TrpgPublicParticipant[];
  sheets: TrpgSheetHudCard[];
  myDraft: {
    body: string;
    actionType: TrpgActionType | null;
    selectedStat: string | null;
    locked: boolean;
    /** Server-confirmed items this seat accepted with the locked submission. */
    acceptedItems?: string[];
  } | null;
  /** Own-seat offers from the previous committed round. Offers are not held; `held` is the current quantity. */
  myItemOffers?: { fromRound: number; items: Array<{ name: string; held: number }> } | null;
  currentRolls: TrpgPublicRoll[];
  resolutionOrder?: TrpgResolutionOrderEntry[];
  /** Participant ids with completed server adjudication (roll, no-roll, or skipped). */
  adjudicatedParticipantIds?: number[];
  /** Authoritative per-participant adjudication outcome for the active round. */
  participantAdjudicationOutcomes?: Record<number, TrpgParticipantAdjudicationOutcome>;
  currentNarration: string | null;
  /** Live provider-stream narration draft during GENERATING_NARRATION. */
  gmNarrationDraft: { text: string } | null;
  log: TrpgPublicLog[];
  workType: string;
  shouldKickAdvance: boolean;
  botGenerationInFlight: boolean;
  gmGenerationInFlight: boolean;
  processStartedAtMs: number | null;
  processStage: string | null;
  lastBilledPoints: number | null;
  partyHumanCount: number;
  partyBotCount: number;
  gmGrossMargin: number;
  botGrossMargin: number;
  partyChat: TrpgPartyChatMessage[];
  /** Latest GM scene the host may reroll, or null. */
  canRerollRoundNumber: number | null;
  narrationRerolling: boolean;
  scenarioAssets: CharacterAsset[];
  aiCharacterAssets: TrpgPublicAiCharacterAssets[];
  scenarioNpcImages: TrpgPublicScenarioNpcImage[];
  /** Long-form story stage. Independent from round.phase. */
  storyPhase?: string;
  /** Player-safe goal projection of the server's goal state: no criterion, evidence, or source. */
  goals?: TrpgPublicGoal[];
  /** Host-only sanitized GM failure line. Never includes prompt, key, or raw provider body. */
  gmFailureHint?: string | null;
  gmFailureKind?: string | null;
  gmFailureBillingSubstage?: string | null;
  gmFailureBillingErrorCode?: string | null;
  hasPendingGmResult?: boolean;
  ongoingEffects?: TrpgPublicOngoingEffect[];
  mechanicsLines?: TrpgMechanicsHudLine[];
  /** Server-owned threat/strike projection for the minimal combat JSX. */
  combat?: TrpgPublicCombat | null;
  /** Unexecuted acts from the viewer's last plan, with server reasons. */
  actionPlanWarnings?: TrpgActionPlanWarning[];
  /** Server-authoritative safe-rest eligibility. UI must not re-parse the scene. */
  safeRest?: TrpgSafeRestSnapshot;
  showRecoveryHint?: boolean;
  /** Fogged exploration projection. Null when this campaign has no map. */
  exploration?: PublicExploration | null;
};

export type TrpgSafeRestBlockedReason =
  | "full_hp"
  | "physical_threat"
  | "combat_active"
  | "cooldown"
  | "incapacitated";

export type TrpgSafeRestSnapshot = {
  available: boolean;
  healAmount: number;
  blockedReason: TrpgSafeRestBlockedReason | null;
};

export type TrpgPublicOngoingEffect = {
  participantId: number;
  label: string;
  kind: string;
  severity: string;
  remainingTicks: number;
  recoveryHint: string;
};

export type TrpgMechanicsHudLine = {
  participantId: number;
  text: string;
};

export type TrpgPublicCombatStrike = {
  encounterId: string;
  name: string;
  kind: "enemy" | "hazard";
  targetParticipantId: number;
  d20: number;
  dc: number;
  hit: boolean;
  damageClass: string;
  diceExpression: string;
  diceRolls: number[];
  diceTotal: number;
  damageUnit: number;
  amount: number;
  hpBefore: number;
  hpAfter: number;
};

export type TrpgPublicCombat = {
  encounters: Array<{
    /** Opaque display key; never the internal scenario encounter id. */
    key: string;
    name: string;
    kind: "enemy" | "hazard";
    location: string;
    ended: boolean;
    strikes: TrpgPublicCombatStrike[];
  }>;
};

export type TrpgActionPlanWarning = {
  index: number;
  kind: string;
  reason: string;
  evidence: string;
};

export function isListedTrpgCampaign(snap: TrpgCampaignSnapshot): boolean {
  if (snap.round.number > 0) return true;
  if (snap.round.phase !== "NONE") return true;
  return snap.participants.filter((p) => p.kind === "human").length > 1;
}
