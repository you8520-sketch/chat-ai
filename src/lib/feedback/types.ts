export type FeedbackVote = 1 | -1;

export type MessageFeedback = {
  id: number;
  userId: number;
  messageId: number;
  chatId: number;
  vote: FeedbackVote;
  reasons: string[];
  comment: string;
  variantIndex: number;
  createdAt: string;
  updatedAt: string;
};

export type GenerationSnapshotInput = {
  messageId: number;
  chatId: number;
  userId: number;
  characterId: number;
  variantIndex: number;
  userMessageId: number | null;
  model: string;
  provider: string;
  route: string;
  writingStyle: string;
  nsfw: number;
  inputTokens: number;
  outputTokens: number;
  promptHash: string;
  contextJson: string;
};

export type PreferenceEventInput = {
  userId: number;
  chatId: number;
  messageId: number | null;
  eventType: string;
  payload?: Record<string, unknown>;
};

export type MessageScore = {
  messageId: number;
  qualityScore: number;
  confidence: number;
  signalCount: number;
  continuationRate: number;
  engagementScore: number;
  updatedAt: string;
};

export type QualitySignalType =
  | "feedback_like"
  | "feedback_dislike"
  | "bookmark"
  | "regenerate"
  | "variant_switch"
  | "refund"
  | "continuation"
  | "engagement_positive"
  | "engagement_negative";

export type QualitySignal = {
  type: QualitySignalType;
  reasons?: string[];
};

export type GenerationContextInput = {
  promptAudit?: {
    breakdown?: Record<string, number>;
    systemPromptTokens?: number;
    historyTokens?: number;
    currentUserTurnTokens?: number;
    totalAssembledTokens?: number;
    sectionCount?: number;
    duplicates?: { label: string }[];
    inefficiencies?: string[];
  };
  writingStyle: string;
  completedTurns: number;
  targetResponseChars: number;
  userImpersonation: boolean;
  truncatedMemory?: boolean;
  model: string;
  provider: string;
  route: string;
  speechProfileCharName?: string | null;
  nsfw: boolean;
  regenerate?: boolean;
  variantIndex?: number;
};
