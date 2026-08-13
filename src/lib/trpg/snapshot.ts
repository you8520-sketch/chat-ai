import type { TrpgActionType } from "./actionTypes";
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
  currentNarration: string | null;
  log: TrpgPublicLog[];
  workType: string;
  lastBilledPoints: number | null;
  gmGrossMargin: number;
  botGrossMargin: number;
  partyChat: TrpgPartyChatMessage[];
  /** Latest GM scene the host may reroll, or null. */
  canRerollRoundNumber: number | null;
  narrationRerolling: boolean;
};

export function isListedTrpgCampaign(snap: TrpgCampaignSnapshot): boolean {
  if (snap.round.number > 0) return true;
  if (snap.round.phase !== "NONE") return true;
  return snap.participants.filter((p) => p.kind === "human").length > 1;
}
