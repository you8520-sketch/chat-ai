/** Isolated TRPG runtime — not used by 1:1 character chat. */

import { CHEAPER_INFERENCE_DEEPSEEK_V4_PRO_MODEL } from "@/lib/chatModels";
import type { TrpgStoryPhase } from "./scenarioPlan";

export const TRPG_GM_MODEL = CHEAPER_INFERENCE_DEEPSEEK_V4_PRO_MODEL;
export const TRPG_MAX_SLOTS = 4;
/** Each AI companion is its own model call, so bots stay at two. */
export const TRPG_MAX_BOTS = 2;
export const TRPG_MIN_SLOTS = 1;
export const TRPG_MEMORY_SEAL_ROUNDS = 4;
export const TRPG_RECENT_ROUND_RAW = 3;
/** GM prose — floor 3000 Korean characters; aim well above so scenes actually exceed it. */
export const TRPG_GM_MIN_CHARS = 3000;
export const TRPG_GM_AIM_CHARS = 4800;
/** Closing `GM: "..."` table-talk inside the narration — situation recap, not a one-liner. */
export const TRPG_GM_CLOSING_MIN_CHARS = 400;
/** Thinking-on + long Hangul; omit would risk provider-default truncation. */
export const TRPG_GM_MAX_TOKENS = 12288;
export const TRPG_NEXT_ROUND_CONTEXT_MAX_CHARS = 400;
export const TRPG_SEAL_SUMMARY_MAX_CHARS = 500;
export const TRPG_SEALED_PROMPT_MAX_CHARS = 2500;
export const TRPG_BOT_SCENE_MAX_CHARS = 2200;
/** Bot-seat PC action — finish a beat in this band; never cut mid-sentence. */
export const TRPG_BOT_MIN_CHARS = 300;
export const TRPG_BOT_AIM_CHARS = 550;
export const TRPG_BOT_ACTION_MAX_CHARS = 800;
export const TRPG_BOT_INTENT_MAX_CHARS = 120;
export const TRPG_BOT_MAX_TOKENS = 2048;
/** Character card fields on a bot-seat call — personality lives here. */
export const TRPG_BOT_CARD_PROMPT_MAX_CHARS = 3500;
export const TRPG_BOT_CARD_FIELD_MAX_CHARS = 800;
export const TRPG_LEDGER_QUEST_MAX = 12;
export const TRPG_LEDGER_NPC_MAX = 16;
export const TRPG_LEDGER_FLAG_MAX = 24;
export const TRPG_LEDGER_ITEM_MAX_CHARS = 80;
/** Same target as Cheaper Inference DeepSeek V4 Pro RP (`CHEAPER_INFERENCE_DEEPSEEK_V4_PRO_GROSS_MARGIN`). */
export const TRPG_GM_GROSS_MARGIN = 0.65;
/** Bot-seat Pro call — same 65% as RP Pro. Not Flash. */
export const TRPG_BOT_GROSS_MARGIN = 0.65;
export const TRPG_BOT_MODEL = CHEAPER_INFERENCE_DEEPSEEK_V4_PRO_MODEL;
export const TRPG_ACTION_MAX_CHARS = 800;
/** Host-written party bonds, applied before campaign start. */
export const TRPG_RELATIONSHIP_MAX_CHARS = 800;
/** Out-of-world party talk. Never sent to GM or bot-seat prompts. */
export const TRPG_PARTY_CHAT_MAX_CHARS = 400;
export const TRPG_PARTY_CHAT_LIMIT = 80;
/** Chat-style forks are forbidden. One campaign is one linear timeline. */
export const TRPG_ALLOW_FORK = false;
export const TRPG_FORK_FORBIDDEN_MESSAGE =
  "TRPG 캠페인은 분기할 수 없습니다. 한 타임라인만 진행됩니다.";

/** Imported character creators — percent of PAID round spend, after the scenario author tier. */
export const TRPG_CHARACTER_ROYALTY_RATE = 0.05;
/** Author tier + character royalties never exceed this share of PAID spend. Character royalties shrink first. */
export const TRPG_CREATOR_REWARD_CAP_RATE = 0.25;

export const TRPG_VISIBILITIES = ["public", "private"] as const;
export type TrpgVisibility = (typeof TRPG_VISIBILITIES)[number];

export function parseTrpgVisibility(value: unknown): TrpgVisibility {
  return value === "public" ? "public" : "private";
}

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
  /** Optional story metadata. Never a round-phase substitute. */
  storyPhase?: TrpgStoryPhase;
  threadsAdd?: string[];
  threadsResolve?: string[];
  endingConditionId?: string;
};

export function assertNeverTrpg(x: never, label: string): never {
  throw new Error(`[TRPG] unhandled ${label}: ${String(x)}`);
}

export function isTrpgRoundPhase(value: string): value is TrpgRoundPhase {
  return (TRPG_ROUND_PHASES as readonly string[]).includes(value);
}
