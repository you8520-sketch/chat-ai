/** Isolated TRPG runtime — not used by 1:1 character chat. */

export const TRPG_GM_MODEL = "deepseek-v4-pro";
export const TRPG_MAX_SLOTS = 4;
export const TRPG_MIN_SLOTS = 1;
export const TRPG_MEMORY_SEAL_ROUNDS = 4;
export const TRPG_RECENT_ROUND_RAW = 3;
/** GM prose — same aim band as 1:1 DeepSeek RP, floor at 3000 characters, no upper cap. */
export const TRPG_GM_MIN_CHARS = 3000;
export const TRPG_GM_AIM_CHARS = 3200;
export const TRPG_NEXT_ROUND_CONTEXT_MAX_CHARS = 400;
export const TRPG_SEAL_SUMMARY_MAX_CHARS = 500;
export const TRPG_SEALED_PROMPT_MAX_CHARS = 2500;
export const TRPG_BOT_SCENE_MAX_CHARS = 1400;
export const TRPG_LEDGER_QUEST_MAX = 12;
export const TRPG_LEDGER_NPC_MAX = 16;
export const TRPG_LEDGER_FLAG_MAX = 24;
export const TRPG_LEDGER_ITEM_MAX_CHARS = 80;
/** Same target as Cheaper Inference DeepSeek V4 Pro RP (`CHEAPER_INFERENCE_DEEPSEEK_V4_PRO_GROSS_MARGIN`). */
export const TRPG_GM_GROSS_MARGIN = 0.65;
/** Bot-seat Pro call — same 65% as RP Pro. Not Flash. */
export const TRPG_BOT_GROSS_MARGIN = 0.65;
export const TRPG_BOT_MODEL = "deepseek-v4-pro";
export const TRPG_ACTION_MAX_CHARS = 800;

export const TRPG_ROUND_PHASES = [
  "CHARACTER_SETUP",
  "WAITING_FOR_PLAYERS",
  "ACTION_INPUT",
  "BOT_ACTION",
  "LOCKING_ACTIONS",
  "ADJUDICATING",
  "ROLLING",
  "GENERATING_NARRATION",
  "APPLYING_STATE",
  "ROUND_COMPLETE",
  "CAMPAIGN_COMPLETE",
  "ERROR_RECOVERY",
] as const;

export type TrpgRoundPhase = (typeof TRPG_ROUND_PHASES)[number];

export const TRPG_PARTICIPANT_KINDS = ["human", "ai_character"] as const;
export type TrpgParticipantKind = (typeof TRPG_PARTICIPANT_KINDS)[number];

export const TRPG_PARTICIPANT_STATUSES = [
  "active",
  "incapacitated",
  "spectating",
  "disconnected",
] as const;
export type TrpgParticipantStatus = (typeof TRPG_PARTICIPANT_STATUSES)[number];

export const TRPG_ACTION_SOURCES = ["human", "bot_model", "host_fill"] as const;
export type TrpgActionSource = (typeof TRPG_ACTION_SOURCES)[number];

export const TRPG_SUCCESS_TIERS = [
  "CRITICAL_FAILURE",
  "SEVERE_FAILURE",
  "FAILURE",
  "PARTIAL_SUCCESS",
  "SUCCESS",
  "GREAT_SUCCESS",
  "CRITICAL_SUCCESS",
] as const;
export type TrpgSuccessTier = (typeof TRPG_SUCCESS_TIERS)[number];

export const TRPG_NAT_RULES = ["critical", "shift_one", "numeric"] as const;
export type TrpgNatRule = (typeof TRPG_NAT_RULES)[number];

export const TRPG_BILLING_MODES = ["split_even", "host_pays"] as const;
export type TrpgBillingMode = (typeof TRPG_BILLING_MODES)[number];

export const DEFAULT_TRPG_BILLING_MODE: TrpgBillingMode = "split_even";

export type TrpgStatDefinition = {
  key: string;
  label: string;
  description: string;
  min: number;
  max: number;
};

export type TrpgDiceRules = {
  die: 20;
  dc: number;
  severeFailureMargin: number;
  greatSuccessMargin: number;
  partialWindow: number;
  nat1: TrpgNatRule;
  nat20: TrpgNatRule;
};

export const DEFAULT_TRPG_DICE_RULES: TrpgDiceRules = {
  die: 20,
  dc: 12,
  severeFailureMargin: 10,
  greatSuccessMargin: 10,
  partialWindow: 1,
  nat1: "critical",
  nat20: "critical",
};

export type TrpgSheetSnapshot = {
  participantId: number;
  name: string;
  playerName: string;
  level: number;
  hp: number;
  maxHp: number;
  stats: Record<string, number>;
  conditions: string[];
  inventory: string[];
  location: string;
  modifiersNote: string;
};

export type TrpgStateDelta = {
  players: Array<{
    participantId: number;
    hp?: number;
    conditions?: string[];
    inventoryAdd?: string[];
    inventoryRemove?: string[];
    location?: string;
  }>;
  location?: string;
  nextRoundContext?: string;
  campaignFinished?: boolean;
  questsAdd?: string[];
  questsRemove?: string[];
  npcsAdd?: string[];
  npcsRemove?: string[];
  flagsAdd?: string[];
  flagsRemove?: string[];
};

export function assertNeverTrpg(x: never, label: string): never {
  throw new Error(`[TRPG] unhandled ${label}: ${String(x)}`);
}

export function isTrpgRoundPhase(value: string): value is TrpgRoundPhase {
  return (TRPG_ROUND_PHASES as readonly string[]).includes(value);
}
