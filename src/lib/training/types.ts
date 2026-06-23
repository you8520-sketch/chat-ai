export const TRAINING_TAGS = [
  "speech_consistency",
  "pacing",
  "lore_consistency",
  "forced_romance",
  "user_overcontrol",
  "immersion_quality",
  "first_turn_quality",
  "dialogue_realism",
] as const;

export type TrainingTag = (typeof TRAINING_TAGS)[number];

export type TagLabel = "positive" | "negative" | "neutral";

export type TagScore = {
  tag: TrainingTag;
  score: number;
  label: TagLabel;
  source: "heuristic" | "ai";
};

export type AnalysisCandidate = {
  messageId: number;
  chatId: number;
  userId: number;
  content: string;
  vote: number | null;
  reasons: string[];
  feedbackUpdatedAt: string | null;
  qualityScore: number | null;
  isRefunded: boolean;
  regenerateCount: number;
  contextJson: string;
  completedTurns: number | null;
  feedbackFingerprint: string;
};

export type TrainingAnalysisRunResult = {
  runId: number;
  processed: number;
  skipped: number;
  failed: number;
};

export type ConversationExport = {
  messages: { role: "system" | "user" | "assistant"; content: string }[];
  metadata: Record<string, unknown>;
};

export type PreferencePairExport = {
  prompt: string;
  chosen: string;
  rejected: string;
  metadata: Record<string, unknown>;
};

export type DatasetExportResult = {
  runId: number;
  goodCount: number;
  badCount: number;
  pairCount: number;
  exportDir: string;
};
