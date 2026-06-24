import type { CharacterGender } from "@/lib/characterGender";
import type { CharacterGenre } from "@/lib/characterGenres";
import type { ChatMsg } from "@/lib/ai";
/** 캐릭터 설정 분할 단위 */
export interface CharacterChunk {
  id: string;
  characterId: string;
  content: string;
  category:
    | "identity"
    | "personality"
    | "speech"
    | "background"
    | "relationships"
    | "abilities"
    | "world"
    | "other";
  importance: "CRITICAL" | "CONTEXTUAL" | "SUPPLEMENTAL";
  tokenCount: number;
  keywords: string[];
}

export type ChunkCategory = CharacterChunk["category"];
export type ChunkImportance = CharacterChunk["importance"];

/** 캐릭터 제작 시 파서 입력 */
export type CharacterSettingInput = {
  characterId: string;
  systemPrompt: string;
  world?: string;
  exampleDialog?: string;
  statusWindowPrompt?: string;
  characterName?: string;
  gender?: CharacterGender | string;
};

/** ContextBuilder 입력 */
export type ContextBuildInput = {
  charName: string;
  chunks: CharacterChunk[];
  userNickname: string;
  userPersona?: string | null;
  userNote?: string | null;
  longTermMemory?: string | null;
  /** archive_summary — identity/rules 아래 별도 주입 */
  archiveMemory?: string | null;
  shortTermHistory: ChatMsg[];
  currentUserMessage: string;
  nsfw: boolean;
  gender?: CharacterGender;
  assetTags?: string[];
  memoryMeta?: string | null;
  party?: boolean;
  tokenBudget?: number;
  modelId?: string;
  /** ON이면 AI가 사용자 페르소나 대사·행동도 작성 (OOC 레거시) */
  userImpersonation?: boolean;
  /** 소설 모드 — UI 토글; userImpersonation보다 우선하는 전면 co-narration */
  novelModeEnabled?: boolean;
  personaDisplayName?: string;
  /** AI 출력 목표 글자 수 (채팅방별) */
  targetResponseChars?: number;
  /** 현재 턴 직전까지 완료된 대화 턴 수 */
  completedTurns?: number;
  /** Selected User Persona 성별 (호칭·관계 규칙용) */
  userPersonaGender?: CharacterGender;
  /** openrouter — 히스토리 예산·소설 타임라인 조립 분기 */
  provider?: "gemini" | "openrouter";
  /** 캐릭터 장르 — narrative style layer 톤 매칭 */
  genres?: CharacterGenre[];
  /** 캐릭터 설정이 영문 번역본으로 주입될 때 true — 한국어 출력 지시어 append */
  useEnglishCharacterPrompt?: boolean;
  /** 자동진행 버튼 — currentUserMessage는 continue command 원문 */
  isContinue?: boolean;
  /** 재생성 — assistant 턴만 교체, rejectedAssistantDraft는 히스토리에서 제거됨 */
  regenerate?: boolean;
  /** 재생성 대상 assistant 초안 — diverge 참고용 */
  rejectedAssistantDraft?: string | null;
  /** RAG — 유저 발화 기준 캐릭터 로어 검색 결과 ([CONTEXTUAL LORE]) */
  contextualLore?: string | null;
  /** 키워드 로어북 — 유저 입력 매칭 시 원문 주입 (번역 없음) */
  keywordLorebookBlock?: string | null;
  /** 플랫폼 전역 로어북 — Depth 0 tail (트리거 매칭 시) */
  globalLorebookBlock?: string | null;
  /** chat_turn_summaries 최신 3개 — [RECENT NARRATIVE CONTEXT] (read-only) */
  recentNarrativeContext?: string | null;
  /** 이중언어 대사 감지 — system_prompt / world / example_dialog (chunks 외 원문) */
  systemPrompt?: string;
  world?: string;
  exampleDialog?: string;
  /** Gemini static cache 6순위 — chat_turn_summaries(5턴마다 저장) 최신 1~15개 블록 */
  staticHistoryBlock?: string | null;
  /** Gemini — Static/Dynamic 분리 조립 (explicit cache) */
  geminiStaticDynamicMode?: boolean;
  /** 대화 시작 첫 메시지(인사) — UI 전용이 아니라 모델에 장면·위치 주입 */
  openingSceneGreeting?: string | null;
  /** 제작자 상태창 위젯 ON — Flash 방화벽·상태 정책 분기 */
  statusWidgetActive?: boolean;
  /** Gemini 3.1 Pro — HTML 상태창을 Flash 2차 호출 없이 메인 모델이 직접 출력 */
  mainModelOwnsHtmlVisualCard?: boolean;
  /** DeepSeek/Qwen — 메인 모델이 관계메모 JSON tail 출력 */
  mainModelOwnsRelationshipExtract?: boolean;
  /** 제작자 상태창 필드 지시 — [rule-length-control] 직후 주입 (route에서 조립) */
  statusWidgetPromptBlock?: string | null;
  /** debug/prompt_dump.txt 출처 — chat route=db, audit scripts=audit, mock fixture=mock */
  promptDumpSource?: import("@/services/promptDebugDump").PromptDumpSource;
  /** source=db 등 헤더에 표시할 부가 정보 (chat id 등) */
  promptDumpDetail?: string | null;
};

export type BuiltContext = {
  systemPrompt: string;
  history: ChatMsg[];
  /** Resolved status-window policy for this turn (JSON pipeline + prompt) */
  statusWindowPolicy?: import("@/lib/statusWindowNotePolicy").UserNoteStatusWindowPolicy;
  /** HTML visual card — note/persona 중복 제거용 (주입은 globalLorebookBlock) */
  htmlVisualCardPolicy?: import("@/lib/htmlVisualCardPolicy").HtmlVisualCardPolicy;
  /** 주입된 전역 로어북 블록 (Depth 0 tail) */
  globalLorebookBlock?: string;
  /** Gemini explicit cache — Static(CachedContent) / Dynamic(contents) 분리 */
  geminiSplit?: import("@/types").GeminiContextSplit;
  /** OpenRouter Anthropic — cache_control 분리용 (provider=openrouter) */
  openRouterSystemSplit?: import("@/lib/openRouterCache").OpenRouterSystemSplit;
  /** OpenRouter — keyword/global lorebook (cached system·history 아래, user 직전) */
  openRouterDynamicLorePrefix?: string;
  meta: {
    estimatedSystemTokens: number;
    estimatedHistoryTokens: number;
    /** system + history 합산 추정 (gemini-bulk cache threshold 판단) */
    estimatedInputTokens?: number;
    tokenBudget: number;
    includedChunkIds: string[];
    skippedChunkIds: string[];
    /** 캐릭터 설정에서 이중언어 대사(EN/zh/ja+KO 등) 감지 */
    bilingualDialogue?: boolean;
    truncatedMemory: boolean;
    promptAudit?: import("@/services/promptAudit").PromptAuditResult;
    trackedSections?: import("@/services/promptAudit").TrackedPromptSection[];
    /** explicit cache 경로 — non-cached contents tail 주입용 */
    visualAnchorTail?: string;
    geminiBulkPadded?: boolean;
    /** static cache padding 적용 여부 */
    staticCachePaddingApplied?: boolean;
  };
};

/** Gemini Static(CachedContent) / Dynamic(contents) 분리 페이로드 */
export type GeminiContextSplit = {
  staticPrompt: string;
  staticFingerprint: string;
  dynamicSystemTail: string;
  dynamicHistory: ChatMsg[];
  staticEstimatedTokens: number;
  staticPaddingApplied: boolean;
};

export const CHUNK_CATEGORIES: ChunkCategory[] = [
  "identity",
  "personality",
  "speech",
  "background",
  "relationships",
  "abilities",
  "world",
  "other",
];

export const DEFAULT_SYSTEM_TOKEN_BUDGET = 28_000;
/** @deprecated Gemini: GEMINI_HISTORY_TOKEN_BUDGET · Claude: CLAUDE_HISTORY_TOKEN_BUDGET (contextTrack.ts) */
export const MAX_HISTORY_TOKENS = 8_000;
export const DEFAULT_HISTORY_TOKEN_BUDGET = MAX_HISTORY_TOKENS;
/** OpenRouter — 레거시 참조값 (Claude 히스토리는 CLAUDE_HISTORY_TOKEN_BUDGET=8_000 사용) */
export const OPENROUTER_HISTORY_TOKEN_BUDGET = 14_000;

/** 모델별 시스템 프롬프트 토큰 상한 (보수적) */
export const MODEL_SYSTEM_BUDGETS: Record<string, number> = {
  "gemini-2.5-flash": 28_000,
  "gemini-3-flash-preview": 28_000,
  "cohere/command-r-plus": 20_000,
  "meta-llama/llama-3-8b-instruct": 12_000,
  "anthropic/claude-opus-4.5": 28_000,
  "anthropic/claude-3-opus": 28_000,
  "anthropic/claude-3.5-sonnet": 28_000,
  "anthropic/claude-sonnet-4": 28_000,
  "google/gemini-3.1-pro-preview": 28_000,
  "deepseek/deepseek-v4-pro": 28_000,
  "qwen/qwen3.7-max": 28_000,
  "google/gemini-2.5-pro": 28_000,
  "google/gemini-2.5-flash": 28_000,
  "google/gemini-3.1-flash-lite": 28_000,
  default: DEFAULT_SYSTEM_TOKEN_BUDGET,
};
