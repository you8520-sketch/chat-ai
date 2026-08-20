import type { CharacterAsset } from "@/lib/characterAssets";
import type { TrpgActionType } from "./actionTypes";
import type { TrpgResolutionOrderEntry } from "./initiative";
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
  | "bot_pending"
  | "host_fill";

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
  maxSlots: number;
  pointPool: number;
  statDefs: TrpgStatDefinition[];
  diceRules: TrpgDiceRules;
  suggestedPcStats: Record<string, number> | null;
  viewerParticipantId: number | null;
  viewerPersonaId: number | null;
  viewerIsHost: boolean;
  needsHostFill: boolean;
  hostFillBotIds: number[];
  round: {
    id: number | null;
    number: number;
    phase: TrpgRoundPhase | "NONE";
  };
  participants: TrpgPublicParticipant[];
  sheets: TrpgSheetHudCard[];
  myDraft: {
    body: string;
    actionType: TrpgActionType | null;
    selectedStat: string | null;
    locked: boolean;
  } | null;
  currentRolls: TrpgPublicRoll[];
  resolutionOrder?: TrpgResolutionOrderEntry[];
  currentNarration: string | null;
  log: TrpgPublicLog[];
  workType: string;
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
  /** Long-form story stage. Independent from round.phase. */
  storyPhase?: string;
  /** Host-only sanitized GM failure line. Never includes prompt, key, or raw provider body. */
  gmFailureHint?: string | null;
  gmFailureKind?: string | null;
  gmFailureBillingSubstage?: string | null;
  gmFailureBillingErrorCode?: string | null;
  hasPendingGmResult?: boolean;
  ongoingEffects?: TrpgPublicOngoingEffect[];
  mechanicsLines?: TrpgMechanicsHudLine[];
  /** Server-authoritative safe-rest eligibility. UI must not re-parse the scene. */
  safeRest?: TrpgSafeRestSnapshot;
  showRecoveryHint?: boolean;
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

export function isListedTrpgCampaign(snap: TrpgCampaignSnapshot): boolean {
  if (snap.round.number > 0) return true;
  if (snap.round.phase !== "NONE") return true;
  return snap.participants.filter((p) => p.kind === "human").length > 1;
}
