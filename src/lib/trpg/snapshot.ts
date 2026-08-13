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
};

export type TrpgPublicLog = {
  roundNumber: number;
  rolls: TrpgPublicRoll[];
  narration: string | null;
  actions: Array<{ participantId: number; name: string; body: string; revealed: boolean }>;
};

export type TrpgCampaignSnapshot = {
  id: number;
  title: string;
  inviteCode: string;
  hostUserId: number;
  sourceCharacterId: number | null;
  worldBrief: string;
  billingMode: TrpgBillingMode;
  campaignStatus: string;
  maxSlots: number;
  pointPool: number;
  statDefs: TrpgStatDefinition[];
  diceRules: TrpgDiceRules;
  viewerParticipantId: number | null;
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
};
