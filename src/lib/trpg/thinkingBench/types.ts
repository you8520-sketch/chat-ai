import type { TrpgSheetSnapshot, TrpgSuccessTier } from "../types";
import type { TrpgResolutionOrderEntry } from "../initiative";
import type { TrpgStoryPhase } from "../scenarioPlan";

export type ThinkingMode = "enabled" | "disabled";

export type ThinkingBenchArm = "on" | "true_off" | "misconfigured_disabled";

export type BenchActionKind = "human" | "bot";

export type BenchActionSpec = {
  participantId: number;
  name: string;
  kind: BenchActionKind;
  body: string;
  intent?: string;
  needsCheck?: boolean;
  statKey: string;
  statLabel?: string;
  statValue?: number | null;
  d20: number | null;
  finalScore: number | null;
  dc: number | null;
  tier: TrpgSuccessTier | null;
};

export type ThinkingBenchCase = {
  id: string;
  title: string;
  system: string;
  user: string;
  opening: boolean;
  currentStoryPhase: TrpgStoryPhase | null;
  secretTokens: string[];
  expectedNames: string[];
  actions: BenchActionSpec[];
  sheets: TrpgSheetSnapshot[];
  resolutionOrder: TrpgResolutionOrderEntry[];
  allowCampaignFinished: boolean;
  centralConflict?: string;
  goal?: string;
};

export type UsageField = number | "unavailable";

export type RawUsageRecord = {
  prompt_tokens: UsageField;
  completion_tokens: UsageField;
  cached_tokens: UsageField;
  reasoning_tokens: UsageField;
  visible_completion_tokens: UsageField;
  completion_tokens_details: unknown;
  cost: unknown;
  extra: Record<string, unknown>;
};

export type QualityFinding = {
  code: string;
  detail: string;
};

export type QualityReport = {
  parseSuccess: boolean;
  narrationPresent: boolean;
  deltaValid: boolean;
  diceContradictions: QualityFinding[];
  actionOmissions: QualityFinding[];
  agencyErrors: QualityFinding[];
  stateErrors: QualityFinding[];
  scenarioErrors: QualityFinding[];
  initiativeErrors: QualityFinding[];
};

export type ThinkingBenchCallRecord = {
  caseId: string;
  arm: ThinkingBenchArm;
  thinking: ThinkingMode;
  httpStatus: number | null;
  success: boolean;
  ttftMs: number | null;
  wallLatencyMs: number;
  responseChars: number;
  koreanChars: number;
  usage: RawUsageRecord;
  parseSuccess: boolean;
  actionOmissions: number;
  diceContradictions: number;
  stateErrors: number;
  agencyErrors: number;
  quality: QualityReport;
  error?: string;
};
