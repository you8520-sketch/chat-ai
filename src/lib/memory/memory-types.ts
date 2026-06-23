export type MemoryTier = "free" | "basic" | "pro";

export type ChatMemoryRow = {
  id: number;
  chat_id: number;
  user_id: number;
  character_id: number;
  pinned_facts: string;
  recent_summary: string;
  archive_summary: string;
  membership_tier: MemoryTier;
  used_chars: number;
  message_count: number;
  summarized_turn_count: number;
  last_compressed_at: string | null;
  created_at: string;
  updated_at: string;
};

/** @deprecated chat_memories 사용 — ChatMemoryRow */
export type CharacterMemoryRow = ChatMemoryRow;

export type MemoryBufferRow = {
  id: number;
  user_id: number;
  character_id: number;
  chat_id: number | null;
  role: "user" | "assistant";
  content: string;
  message_index: number;
  created_at: string;
};

export type MemoryInjection = {
  /** [현재기억] — recent_summary / lorebook UI 본문 */
  text: string;
  /** [과거 기억] — archive_summary (프롬프트 identity/rules 아래 별도 주입) */
  archiveText: string;
  pinnedChars: number;
  recentChars: number;
  archiveChars: number;
  archiveIncluded: boolean;
  usedChars: number;
  limit: number;
  tier: MemoryTier;
};

export type MemorySnapshot = {
  /** 로어북 본문 (recent_summary 컬럼에 저장) */
  lorebook: string;
  recentSummary: string;
  archiveSummary: string;
  usedChars: number;
  limit: number;
  memoryCapacity: number;
  tier: MemoryTier;
  bufferCount: number;
  messagesUntilCompression: number;
  budget: { pinned: number; recent: number; lorebook?: number; archive: number; total: number };
};
