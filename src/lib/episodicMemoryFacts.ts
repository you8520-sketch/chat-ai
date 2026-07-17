import type Database from "better-sqlite3";
import { sanitizeExtractedFacts } from "@/lib/statusWidget/extractedFacts";
import type { ExtractedStatusFact, ExtractedStatusFactImportance } from "@/lib/statusWidget/types";
import {
  classifyEpisodicFactTemporalNature,
  isClearlyTemporaryEpisodicFact,
} from "@/lib/episodicMemoryTemporal";

export {
  classifyEpisodicFactTemporalNature,
  isClearlyTemporaryEpisodicFact,
  CLEARLY_TEMPORARY_EPISODIC_ATTRIBUTES,
  looksLikeCompletedHistoricalEvent,
} from "@/lib/episodicMemoryTemporal";
export type { EpisodicFactTemporalNature } from "@/lib/episodicMemoryTemporal";

export type PersistEpisodicMemoryFactsInput = {
  chatId: number;
  characterId?: number | null;
  userId?: number | null;
  sourceTurn: number;
  facts?: ExtractedStatusFact[] | null;
  metadata?: Record<string, unknown>;
  /**
   * Regeneration: delete existing facts for this chat/source_turn (same character/user)
   * before inserting the new attempt. Unrelated turns are never touched.
   */
  replaceSourceTurn?: boolean;
};

export type EpisodicMemoryFactRecord = ExtractedStatusFact & {
  id: number;
  chat_id: number;
  character_id: number | null;
  user_id: number | null;
  source_turn: number;
  created_at: string;
  metadata: string;
};

export type GetEpisodicMemoryForPromptInput = {
  chatId: number;
  characterId?: number | null;
  userId?: number | null;
  currentTurn?: number | null;
  currentUserMessage?: string | null;
  recentChatText?: string | null;
  longTermMemoryText?: string | null;
  relationshipMemoryText?: string | null;
  lorebookText?: string | null;
  triggeredEventText?: string | null;
  candidateLimit?: number;
  maxFacts?: number;
  maxChars?: number;
  minAgeTurns?: number;
  dynamicMemoryTotalMaxChars?: number;
};

export type EpisodicMemoryDebugFact = EpisodicMemoryFactRecord & {
  would_inject: boolean;
  blocked_reason: string | null;
  duplicate_reason: EpisodicMemoryDuplicateReason | null;
  budget_reason: EpisodicMemoryBudgetReason | null;
  final_rank: number | null;
};

const EPISODIC_MEMORY_PROMPT_MAX_FACTS = 8;
const EPISODIC_MEMORY_PROMPT_MAX_CHARS = 1000;
const EPISODIC_MEMORY_CANDIDATE_LIMIT = 100;
const EPISODIC_MEMORY_DEFAULT_MIN_AGE_TURNS = 3;
const DYNAMIC_MEMORY_TOTAL_MAX_CHARS = 2500;
const IMPORTANCE_RANK: Record<ExtractedStatusFactImportance, number> = {
  critical: 3,
  important: 2,
  normal: 1,
};

export type EpisodicMemoryDuplicateReason =
  | "duplicate_recent_chat"
  | "duplicate_long_term_memory"
  | "duplicate_lorebook"
  | "duplicate_relationship_memory"
  | "duplicate_triggered_event"
  | "duplicate_subject_attribute";

export type EpisodicMemoryBudgetReason =
  | "max_facts"
  | "max_chars"
  | "dynamic_memory_total_budget";

export type EpisodicMemorySelectionDebug = {
  id: number;
  source_turn: number;
  category: string;
  subject: string;
  attribute: string;
  value: string;
  importance: string;
  fact_text: string;
  would_inject: boolean;
  blocked_reason: string | null;
  duplicate_reason: EpisodicMemoryDuplicateReason | null;
  budget_reason: EpisodicMemoryBudgetReason | null;
  final_rank: number | null;
};

const EPISODIC_MEMORY_CONTAMINATION_PATTERNS: Array<{ reason: string; pattern: RegExp }> = [
  { reason: "status_or_countdown_mechanic", pattern: /D-?DAY|디데이|사망일|죽는 날|카운트다운/i },
  { reason: "trigger_metadata", pattern: /트리거|trigger_id|status_key|event_key/i },
  { reason: "speech_register_rule", pattern: /해요체|다나까체|말투\s*규칙|대사\s*규칙|speech_style/i },
  { reason: "runtime_metadata", pattern: /source_turn|extracted_facts|runtime_events/i },
  { reason: "private_visibility_marker", pattern: /user_only|engine_only/i },
];

export function episodicMemoryRecallEnabled(env = process.env): boolean {
  const raw = env.EPISODIC_MEMORY_RECALL_ENABLED?.trim().toLowerCase();
  if (raw === "0" || raw === "false" || raw === "off" || raw === "disabled") return false;
  if (raw === "1" || raw === "true" || raw === "on" || raw === "enabled") return true;
  return env.NODE_ENV !== "production";
}

/** True when production would save facts but not inject them into prompts. */
export function episodicMemoryRecallDisabledInProduction(env = process.env): boolean {
  return env.NODE_ENV === "production" && !episodicMemoryRecallEnabled(env);
}

const EPISODIC_RECALL_PROD_WARN =
  "Episodic memory facts are being saved but recall injection is disabled in production. Set EPISODIC_MEMORY_RECALL_ENABLED=1 on Railway to inject retrieved facts.";

/** Boot / config warning — call once at server start. */
export function warnEpisodicMemoryRecallDisabledInProduction(env = process.env): boolean {
  if (!episodicMemoryRecallDisabledInProduction(env)) return false;
  console.warn(`[EpisodicMemory] ${EPISODIC_RECALL_PROD_WARN}`);
  return true;
}

export function resolveEpisodicMemoryMinAgeTurns(env = process.env): number {
  const raw = env.EPISODIC_MEMORY_MIN_AGE_TURNS?.trim();
  if (!raw) return EPISODIC_MEMORY_DEFAULT_MIN_AGE_TURNS;
  const parsed = Number(raw);
  if (!Number.isFinite(parsed)) return EPISODIC_MEMORY_DEFAULT_MIN_AGE_TURNS;
  return Math.max(0, Math.min(100, Math.trunc(parsed)));
}

export function resolveEpisodicMemoryMaxFacts(env = process.env): number {
  const raw = env.EPISODIC_MEMORY_MAX_FACTS?.trim();
  if (!raw) return EPISODIC_MEMORY_PROMPT_MAX_FACTS;
  const parsed = Number(raw);
  if (!Number.isFinite(parsed)) return EPISODIC_MEMORY_PROMPT_MAX_FACTS;
  return Math.max(1, Math.min(32, Math.trunc(parsed)));
}

export function resolveEpisodicMemoryMaxChars(env = process.env): number {
  const raw = env.EPISODIC_MEMORY_MAX_CHARS?.trim();
  if (!raw) return EPISODIC_MEMORY_PROMPT_MAX_CHARS;
  const parsed = Number(raw);
  if (!Number.isFinite(parsed)) return EPISODIC_MEMORY_PROMPT_MAX_CHARS;
  return Math.max(100, Math.min(4000, Math.trunc(parsed)));
}

export function resolveDynamicMemoryTotalMaxChars(env = process.env): number {
  const raw = env.DYNAMIC_MEMORY_TOTAL_MAX_CHARS?.trim();
  if (!raw) return DYNAMIC_MEMORY_TOTAL_MAX_CHARS;
  const parsed = Number(raw);
  if (!Number.isFinite(parsed)) return DYNAMIC_MEMORY_TOTAL_MAX_CHARS;
  return Math.max(500, Math.min(10000, Math.trunc(parsed)));
}

export function episodicMemoryDebugApiEnabled(env = process.env): boolean {
  if (env.NODE_ENV !== "production") return true;
  const raw = env.EPISODIC_MEMORY_DEBUG_API_ENABLED?.trim().toLowerCase();
  return raw === "1" || raw === "true" || raw === "on" || raw === "enabled";
}

export function detectEpisodicMemoryContamination(
  fact: Pick<ExtractedStatusFact, "value" | "fact_text">
): string | null {
  const text = `${fact.value ?? ""}\n${fact.fact_text ?? ""}`;
  for (const { reason, pattern } of EPISODIC_MEMORY_CONTAMINATION_PATTERNS) {
    if (pattern.test(text)) return reason;
  }
  return null;
}

function filterContaminatedFactsForSave(facts: ExtractedStatusFact[]): ExtractedStatusFact[] {
  return facts.filter((fact) => !detectEpisodicMemoryContamination(fact));
}

/** Dev/audit — counts for [StatusMemoryPipeline] without inserting. */
export type EpisodicFactPersistSummary = {
  rawCount: number;
  validCount: number;
  insertableCount: number;
  skippedCount: number;
  skippedReasons: string[];
  insertable: ExtractedStatusFact[];
};

export function summarizeEpisodicFactPersistCandidates(
  raw: unknown
): EpisodicFactPersistSummary {
  const rawArr = Array.isArray(raw) ? raw : [];
  const valid = sanitizeExtractedFacts(raw);
  const afterContamination = filterContaminatedFactsForSave(valid);
  const insertable = dedupeFactsWithinResponse(afterContamination);
  const skippedReasons: string[] = [];
  const schemaRejected = rawArr.length - valid.length;
  if (schemaRejected > 0) skippedReasons.push(`schema_rejected:${schemaRejected}`);
  const contaminated = valid.length - afterContamination.length;
  if (contaminated > 0) skippedReasons.push(`contamination:${contaminated}`);
  const deduped = afterContamination.length - insertable.length;
  if (deduped > 0) skippedReasons.push(`within_response_dedupe:${deduped}`);
  return {
    rawCount: rawArr.length,
    validCount: valid.length,
    insertableCount: insertable.length,
    skippedCount: Math.max(0, rawArr.length - insertable.length),
    skippedReasons,
    insertable,
  };
}

export type StatusMemoryPipelineTrace = {
  request_id?: string | null;
  message_id?: number | null;
  statusBlockFound: boolean;
  parsedStatusKeys: string[];
  missingRequiredStatusKeys: string[];
  extractedFactsRawCount: number;
  extractedFactsValidCount: number;
  extractedFactsInsertedCount: number;
  extractedFactsSkippedCount: number;
  skippedReasons: string[];
  recallCandidateCount?: number;
  recallInjectedCount?: number;
  recallBlockedReasons?: string[];
};

/** Development-only pipeline trace — never logs full prose. */
export function logStatusMemoryPipelineDev(trace: StatusMemoryPipelineTrace): void {
  if (process.env.NODE_ENV === "production") return;
  console.info("[StatusMemoryPipeline]", JSON.stringify(trace));
}

export function ensureEpisodicMemoryFactsTable(db: Database.Database): void {
  db.exec(`
    CREATE TABLE IF NOT EXISTS episodic_memory_facts (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      chat_id INTEGER NOT NULL,
      character_id INTEGER,
      user_id INTEGER,
      source_turn INTEGER NOT NULL,
      category TEXT NOT NULL,
      subject TEXT NOT NULL,
      attribute TEXT NOT NULL,
      value TEXT NOT NULL,
      importance TEXT NOT NULL,
      fact_text TEXT NOT NULL,
      metadata TEXT NOT NULL DEFAULT '{}',
      created_at TEXT NOT NULL DEFAULT (datetime('now'))
    );
    CREATE INDEX IF NOT EXISTS idx_episodic_memory_facts_chat_turn
      ON episodic_memory_facts(chat_id, source_turn, id);
    CREATE INDEX IF NOT EXISTS idx_episodic_memory_facts_lookup
      ON episodic_memory_facts(chat_id, category, subject, attribute);
  `);
}

function dedupeFactsWithinResponse(facts: ExtractedStatusFact[]): ExtractedStatusFact[] {
  const out: ExtractedStatusFact[] = [];
  const seen = new Set<string>();
  for (const fact of facts) {
    const key = `${fact.category}:${fact.subject}:${fact.attribute}:${fact.value}`;
    if (seen.has(key)) continue;
    seen.add(key);
    out.push(fact);
    if (out.length >= 3) break;
  }
  return out;
}

function finitePositiveInt(value: number): number | null {
  if (!Number.isFinite(value)) return null;
  const n = Math.trunc(value);
  return n > 0 ? n : null;
}

function metadataAssistantMessageId(metadata?: Record<string, unknown>): number | null {
  const raw = metadata?.assistant_message_id;
  if (typeof raw === "number" && Number.isFinite(raw) && raw > 0) return Math.trunc(raw);
  if (typeof raw === "string" && /^\d+$/.test(raw.trim())) return Number(raw.trim());
  return null;
}

function metadataRequestId(metadata?: Record<string, unknown>): string | null {
  const raw = metadata?.request_id;
  if (typeof raw !== "string") return null;
  const t = raw.trim();
  return t || null;
}

function shouldReplaceSourceTurn(input: PersistEpisodicMemoryFactsInput): boolean {
  if (input.replaceSourceTurn === true) return true;
  return input.metadata?.regenerated === true;
}

export function persistEpisodicMemoryFactsBestEffort(
  db: Database.Database,
  input: PersistEpisodicMemoryFactsInput
): number {
  try {
    const chatId = finitePositiveInt(input.chatId);
    const sourceTurn = finitePositiveInt(input.sourceTurn);
    if (!chatId || !sourceTurn) return 0;

    const characterId =
      input.characterId != null && Number.isFinite(input.characterId)
        ? Math.trunc(input.characterId)
        : null;
    const userId =
      input.userId != null && Number.isFinite(input.userId)
        ? Math.trunc(input.userId)
        : null;

    const assistantMessageId = metadataAssistantMessageId(input.metadata);
    const requestId = metadataRequestId(input.metadata);

    // Idempotent finalize: same assistant message + request already persisted → no-op.
    if (assistantMessageId != null && requestId) {
      const existing = db
        .prepare(
          `SELECT COUNT(*) AS c FROM episodic_memory_facts
           WHERE chat_id = ?
             AND json_extract(metadata, '$.assistant_message_id') = ?
             AND json_extract(metadata, '$.request_id') = ?`
        )
        .get(chatId, assistantMessageId, requestId) as { c: number };
      if (existing.c > 0) return 0;
    }

    const replaceTurn = shouldReplaceSourceTurn(input);
    if (replaceTurn) {
      // Option B: wipe prior attempts for this logical turn only.
      db.prepare(
        `DELETE FROM episodic_memory_facts
         WHERE chat_id = ?
           AND source_turn = ?
           AND (? IS NULL OR character_id IS NULL OR character_id = ?)
           AND (? IS NULL OR user_id IS NULL OR user_id = ?)`
      ).run(chatId, sourceTurn, characterId, characterId, userId, userId);
    }

    const facts = dedupeFactsWithinResponse(
      filterContaminatedFactsForSave(sanitizeExtractedFacts(input.facts))
    );
    if (facts.length === 0) return 0;

    const metadataJson = JSON.stringify(input.metadata ?? {});

    const insert = db.prepare(`
      INSERT INTO episodic_memory_facts
        (chat_id, character_id, user_id, source_turn, category, subject, attribute, value, importance, fact_text, metadata)
      VALUES
        (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `);

    const tx = db.transaction((rows: ExtractedStatusFact[]) => {
      for (const fact of rows) {
        insert.run(
          chatId,
          characterId,
          userId,
          sourceTurn,
          fact.category,
          fact.subject,
          fact.attribute,
          fact.value,
          fact.importance,
          fact.fact_text,
          metadataJson
        );
      }
    });

    tx(facts);

    if (process.env.NODE_ENV !== "production") {
      console.info("[EpisodicMemory] saved facts:", {
        chat_id: chatId,
        source_turn: sourceTurn,
        replaced_source_turn: replaceTurn,
        facts: facts.map((fact) => ({
          category: fact.category,
          subject: fact.subject,
          attribute: fact.attribute,
          value: fact.value,
          importance: fact.importance,
          fact_text: fact.fact_text,
        })),
      });
    }

    return facts.length;
  } catch (e) {
    console.error("[EpisodicMemory] failed to save facts:", (e as Error).message);
    return 0;
  }
}

function tokenizeForSimpleBoost(text: string): string[] {
  return [
    ...new Set(
      text
        .toLowerCase()
        .split(/[^a-z0-9가-힣_]+/i)
        .map((x) => x.trim())
        .filter((x) => x.length >= 2)
        .slice(0, 32)
    ),
  ];
}

function factSearchText(fact: ExtractedStatusFact): string {
  return `${fact.subject} ${fact.attribute} ${fact.value} ${fact.fact_text}`.toLowerCase();
}

function keywordBoost(fact: ExtractedStatusFact, currentUserMessage: string): number {
  const tokens = tokenizeForSimpleBoost(currentUserMessage);
  if (tokens.length === 0) return 0;
  const haystack = factSearchText(fact);
  return Math.min(2, tokens.filter((token) => haystack.includes(token)).length);
}

function normalizeForMemoryDedupe(text: string): string {
  return text
    .toLowerCase()
    .replace(/[^a-z0-9가-힣]+/gi, "")
    .trim();
}

function tokenizeForMemoryDedupe(text: string): string[] {
  return [
    ...new Set(
      text
        .toLowerCase()
        .split(/[^a-z0-9가-힣]+/gi)
        .map((token) => token.trim())
        .filter((token) => token.length >= 2)
        .slice(0, 48)
    ),
  ];
}

function textLooksDuplicated(fact: EpisodicMemoryFactRecord, sourceText?: string | null): boolean {
  if (!sourceText) return false;
  const normalizedSource = normalizeForMemoryDedupe(sourceText);
  if (normalizedSource.length < 8) return false;

  const normalizedFact = normalizeForMemoryDedupe(fact.fact_text);
  if (normalizedFact.length >= 8 && normalizedSource.includes(normalizedFact)) return true;
  if (normalizedFact.length >= 16 && normalizedFact.includes(normalizedSource)) return true;

  const normalizedValue = normalizeForMemoryDedupe(fact.value);
  if (normalizedValue.length >= 4 && normalizedSource.includes(normalizedValue)) return true;

  const tokens = tokenizeForMemoryDedupe(fact.fact_text).filter((token) => token.length >= 3);
  if (tokens.length < 3) return false;
  const hits = tokens.filter((token) => normalizedSource.includes(normalizeForMemoryDedupe(token))).length;
  return hits >= 3 && hits / tokens.length >= 0.6;
}

function subjectAttributeLooksRepresented(
  fact: EpisodicMemoryFactRecord,
  sourceText?: string | null
): boolean {
  if (!sourceText) return false;
  const normalizedSource = normalizeForMemoryDedupe(sourceText);
  const subject = normalizeForMemoryDedupe(fact.subject);
  const attribute = normalizeForMemoryDedupe(fact.attribute);
  if (subject.length < 3 || attribute.length < 3) return false;
  return normalizedSource.includes(subject) && normalizedSource.includes(attribute);
}

function findDuplicateReason(
  fact: EpisodicMemoryFactRecord,
  input: GetEpisodicMemoryForPromptInput
): EpisodicMemoryDuplicateReason | null {
  if (textLooksDuplicated(fact, input.recentChatText)) return "duplicate_recent_chat";
  if (textLooksDuplicated(fact, input.longTermMemoryText)) return "duplicate_long_term_memory";
  if (textLooksDuplicated(fact, input.relationshipMemoryText)) return "duplicate_relationship_memory";
  if (textLooksDuplicated(fact, input.lorebookText)) return "duplicate_lorebook";
  if (textLooksDuplicated(fact, input.triggeredEventText)) return "duplicate_triggered_event";

  const higherPriorityText = [
    input.recentChatText,
    input.longTermMemoryText,
    input.relationshipMemoryText,
    input.lorebookText,
    input.triggeredEventText,
  ]
    .filter(Boolean)
    .join("\n");
  if (subjectAttributeLooksRepresented(fact, higherPriorityText)) {
    return "duplicate_subject_attribute";
  }
  return null;
}

function higherPriorityDynamicTextLength(input: GetEpisodicMemoryForPromptInput): number {
  return [
    input.longTermMemoryText,
    input.relationshipMemoryText,
    input.lorebookText,
  ].reduce((sum, text) => sum + (text?.length ?? 0), 0);
}

function compareFactsForPrompt(
  a: EpisodicMemoryFactRecord,
  b: EpisodicMemoryFactRecord,
  currentMessage: string
): number {
  const aImportance = IMPORTANCE_RANK[a.importance];
  const bImportance = IMPORTANCE_RANK[b.importance];
  if (aImportance !== bImportance) return bImportance - aImportance;

  const aBoost = keywordBoost(a, currentMessage);
  const bBoost = keywordBoost(b, currentMessage);
  if (aBoost !== bBoost) return bBoost - aBoost;

  if (b.source_turn !== a.source_turn) return b.source_turn - a.source_turn;
  return b.id - a.id;
}

function resolveLatestFactsByLogicalKey(rows: EpisodicMemoryFactRecord[]): EpisodicMemoryFactRecord[] {
  const byKey = new Map<string, EpisodicMemoryFactRecord>();
  for (const row of rows) {
    const key = `${row.category}:${row.subject}:${row.attribute}`;
    const prev = byKey.get(key);
    if (!prev || row.source_turn > prev.source_turn || (row.source_turn === prev.source_turn && row.id > prev.id)) {
      byKey.set(key, row);
    }
  }
  return [...byKey.values()];
}

export function formatEpisodicMemoryPromptSection(
  facts: EpisodicMemoryFactRecord[],
  maxFacts = EPISODIC_MEMORY_PROMPT_MAX_FACTS,
  maxChars = EPISODIC_MEMORY_PROMPT_MAX_CHARS
): string {
  if (facts.length === 0) return "";

  const lines: string[] = [];
  let usedChars = 0;
  for (const fact of facts.slice(0, maxFacts)) {
    const nextChars = usedChars + fact.fact_text.length;
    // Never inject a truncated/incomplete fact_text — skip when over budget.
    if (nextChars > maxChars) {
      if (lines.length === 0) break;
      break;
    }
    lines.push(`- [T${fact.source_turn}] ${fact.fact_text}`);
    usedChars = nextChars;
  }

  if (lines.length === 0) return "";
  return [
    "[EPISODIC MEMORY - RETRIEVED FACTS]",
    "These are retrieved episodic memories from earlier turns.",
    "These are historical or durable facts from earlier turns.",
    "Do not treat time-sensitive facts as the current state.",
    "For current location, condition, emotion, action, and scene state, prefer the recent raw conversation.",
    "Use them only when relevant to the current scene.",
    "If retrieved memories conflict with each other, the higher turn number is more recent and must be preferred.",
    "If retrieved memories conflict with the character canon or world rules, canon and world rules win.",
    "Do not mention this memory section to the user.",
    ...lines,
  ].join("\n");
}

export function getEpisodicMemoryForPrompt(
  db: Database.Database,
  input: GetEpisodicMemoryForPromptInput,
  env = process.env
): { facts: EpisodicMemoryFactRecord[]; promptBlock: string; debug: EpisodicMemorySelectionDebug[] } {
  if (!episodicMemoryRecallEnabled(env)) return { facts: [], promptBlock: "", debug: [] };

  try {
    const chatId = finitePositiveInt(input.chatId);
    if (!chatId) return { facts: [], promptBlock: "", debug: [] };

    const currentTurn =
      input.currentTurn != null && Number.isFinite(input.currentTurn)
        ? Math.trunc(input.currentTurn)
        : null;
    const candidateLimit = Math.max(
      1,
      Math.min(500, Math.trunc(input.candidateLimit ?? EPISODIC_MEMORY_CANDIDATE_LIMIT))
    );
    const maxFacts = Math.max(
      1,
      Math.min(32, Math.trunc(input.maxFacts ?? resolveEpisodicMemoryMaxFacts(env)))
    );
    const maxChars = Math.max(
      100,
      Math.min(4000, Math.trunc(input.maxChars ?? resolveEpisodicMemoryMaxChars(env)))
    );
    const dynamicMemoryTotalMaxChars = Math.max(
      500,
      Math.min(
        10000,
        Math.trunc(input.dynamicMemoryTotalMaxChars ?? resolveDynamicMemoryTotalMaxChars(env))
      )
    );
    const minAgeTurns = Math.max(
      0,
      Math.min(
        100,
        Math.trunc(input.minAgeTurns ?? resolveEpisodicMemoryMinAgeTurns(env))
      )
    );

    const where: string[] = ["chat_id = ?"];
    const params: Array<number | string> = [chatId];
    if (input.characterId != null && Number.isFinite(input.characterId)) {
      where.push("(character_id IS NULL OR character_id = ?)");
      params.push(Math.trunc(input.characterId));
    }
    if (input.userId != null && Number.isFinite(input.userId)) {
      where.push("(user_id IS NULL OR user_id = ?)");
      params.push(Math.trunc(input.userId));
    }
    if (currentTurn != null) {
      where.push("source_turn < ?");
      params.push(currentTurn);
      if (minAgeTurns > 0) {
        where.push("source_turn <= ?");
        params.push(currentTurn - minAgeTurns);
      }
    }

    const rows = db
      .prepare(
        `SELECT id, chat_id, character_id, user_id, source_turn, category, subject, attribute, value, importance, fact_text, metadata, created_at
         FROM episodic_memory_facts
         WHERE ${where.join(" AND ")}
         ORDER BY source_turn DESC, id DESC
         LIMIT ?`
      )
      .all(...params, candidateLimit) as EpisodicMemoryFactRecord[];

    const validRows = rows.filter((row) => sanitizeExtractedFacts([{
      category: row.category,
      subject: row.subject,
      attribute: row.attribute,
      value: row.value,
      importance: row.importance,
      fact_text: row.fact_text,
    }]).length === 1);
    const uncontaminatedRows: EpisodicMemoryFactRecord[] = [];
    let blockedContaminatedCount = 0;
    let temporarySkippedCount = 0;
    for (const row of validRows) {
      const blockedReason = detectEpisodicMemoryContamination(row);
      if (blockedReason) {
        blockedContaminatedCount += 1;
        if (process.env.NODE_ENV !== "production") {
          console.info("[EpisodicMemory] blocked contaminated retrieved fact:", {
            chat_id: chatId,
            id: row.id,
            source_turn: row.source_turn,
            category: row.category,
            subject: row.subject,
            attribute: row.attribute,
            value: row.value,
            importance: row.importance,
            fact_text: row.fact_text,
            blocked_reason: blockedReason,
          });
        }
        continue;
      }
      // Exclude clearly momentary states before latest-wins / ranking / budget.
      // Recent raw history owns current emotion/pose/action; DB rows stay (no migration).
      if (isClearlyTemporaryEpisodicFact(row)) {
        temporarySkippedCount += 1;
        continue;
      }
      uncontaminatedRows.push(row);
    }
    const resolved = resolveLatestFactsByLogicalKey(uncontaminatedRows);
    const skippedConflictFactsCount = Math.max(0, uncontaminatedRows.length - resolved.length);
    const currentMessage = input.currentUserMessage ?? "";
    const debugById = new Map<number, EpisodicMemorySelectionDebug>();
    for (const fact of resolved) {
      debugById.set(fact.id, {
        id: fact.id,
        source_turn: fact.source_turn,
        category: fact.category,
        subject: fact.subject,
        attribute: fact.attribute,
        value: fact.value,
        importance: fact.importance,
        fact_text: fact.fact_text,
        would_inject: false,
        blocked_reason: null,
        duplicate_reason: null,
        budget_reason: null,
        final_rank: null,
      });
    }

    const deduped: EpisodicMemoryFactRecord[] = [];
    for (const fact of resolved) {
      const duplicateReason = findDuplicateReason(fact, input);
      if (duplicateReason) {
        const debug = debugById.get(fact.id);
        if (debug) debug.duplicate_reason = duplicateReason;
        if (process.env.NODE_ENV !== "production") {
          console.info("[EpisodicMemory] skipped duplicate fact:", {
            chat_id: chatId,
            id: fact.id,
            source_turn: fact.source_turn,
            category: fact.category,
            subject: fact.subject,
            attribute: fact.attribute,
            value: fact.value,
            importance: fact.importance,
            fact_text: fact.fact_text,
            duplicate_reason: duplicateReason,
          });
        }
        continue;
      }
      deduped.push(fact);
    }

    const rankedAll = deduped.sort((a, b) => compareFactsForPrompt(a, b, currentMessage));
    rankedAll.forEach((fact, index) => {
      const debug = debugById.get(fact.id);
      if (debug) debug.final_rank = index + 1;
    });

    const higherPriorityDynamicChars = higherPriorityDynamicTextLength(input);
    const dynamicAvailableChars = dynamicMemoryTotalMaxChars - higherPriorityDynamicChars;
    const effectiveMaxChars = Math.min(maxChars, Math.max(0, dynamicAvailableChars));
    const selected: EpisodicMemoryFactRecord[] = [];
    let usedChars = 0;
    for (const fact of rankedAll) {
      const debug = debugById.get(fact.id);
      let budgetReason: EpisodicMemoryBudgetReason | null = null;
      if (effectiveMaxChars <= 0) {
        budgetReason = "dynamic_memory_total_budget";
      } else if (selected.length >= maxFacts) {
        budgetReason = "max_facts";
      } else if (usedChars + fact.fact_text.length > effectiveMaxChars) {
        budgetReason = "max_chars";
      }

      if (budgetReason) {
        if (debug) debug.budget_reason = budgetReason;
        continue;
      }

      selected.push(fact);
      usedChars += fact.fact_text.length;
      if (debug) debug.would_inject = true;
    }

    const promptBlock = formatEpisodicMemoryPromptSection(selected, maxFacts, effectiveMaxChars);
    const facts = promptBlock ? selected : [];
    const omittedDueToBudgetCount = [...debugById.values()].filter((debug) => debug.budget_reason).length;
    const debug = [...debugById.values()].sort((a, b) => {
      if (a.final_rank == null && b.final_rank == null) return b.source_turn - a.source_turn;
      if (a.final_rank == null) return 1;
      if (b.final_rank == null) return -1;
      return a.final_rank - b.final_rank;
    });

    if (process.env.NODE_ENV !== "production") {
      console.info("[EpisodicMemory] retrieved facts:", {
        chat_id: chatId,
        current_turn: currentTurn,
        selected_count: facts.length,
        selected_facts: facts.map((fact) => ({
          source_turn: fact.source_turn,
          category: fact.category,
          subject: fact.subject,
          attribute: fact.attribute,
          value: fact.value,
          importance: fact.importance,
          fact_text: fact.fact_text,
        })),
        skipped_conflict_facts_count: skippedConflictFactsCount,
        blocked_contaminated_facts_count: blockedContaminatedCount,
        temporary_skipped_count: temporarySkippedCount,
        omitted_due_to_budget_count: omittedDueToBudgetCount,
      });
    }

    return { facts, promptBlock, debug };
  } catch (e) {
    console.error("[EpisodicMemory] failed to retrieve facts:", (e as Error).message);
    return { facts: [], promptBlock: "", debug: [] };
  }
}

export function listEpisodicMemoryFactsForDebug(
  db: Database.Database,
  opts: { chatId: number; limit?: number }
): EpisodicMemoryFactRecord[] {
  const chatId = finitePositiveInt(opts.chatId);
  if (!chatId) return [];
  const limit = Math.max(1, Math.min(500, Math.trunc(opts.limit ?? 100)));
  try {
    return db
      .prepare(
        `SELECT id, chat_id, character_id, user_id, source_turn, category, subject, attribute, value, importance, fact_text, metadata, created_at
         FROM episodic_memory_facts
         WHERE chat_id = ?
         ORDER BY source_turn DESC, id DESC
         LIMIT ?`
      )
      .all(chatId, limit) as EpisodicMemoryFactRecord[];
  } catch (e) {
    console.error("[EpisodicMemory] failed to list debug facts:", (e as Error).message);
    return [];
  }
}

export function inspectEpisodicMemoryFactsForDebug(
  db: Database.Database,
  opts: {
    chatId: number;
    limit?: number;
    currentTurn?: number | null;
    minAgeTurns?: number;
    currentUserMessage?: string | null;
    recentChatText?: string | null;
    longTermMemoryText?: string | null;
    relationshipMemoryText?: string | null;
    lorebookText?: string | null;
    triggeredEventText?: string | null;
    maxFacts?: number;
    maxChars?: number;
    dynamicMemoryTotalMaxChars?: number;
  },
  env = process.env
): EpisodicMemoryDebugFact[] {
  const currentTurn =
    opts.currentTurn != null && Number.isFinite(opts.currentTurn)
      ? Math.trunc(opts.currentTurn)
      : null;
  const minAgeTurns = Math.max(
    0,
    Math.min(100, Math.trunc(opts.minAgeTurns ?? resolveEpisodicMemoryMinAgeTurns(env)))
  );
  const maxFacts = Math.max(
    1,
    Math.min(32, Math.trunc(opts.maxFacts ?? resolveEpisodicMemoryMaxFacts(env)))
  );
  const maxChars = Math.max(
    100,
    Math.min(4000, Math.trunc(opts.maxChars ?? resolveEpisodicMemoryMaxChars(env)))
  );
  const dynamicMemoryTotalMaxChars = Math.max(
    500,
    Math.min(
      10000,
      Math.trunc(opts.dynamicMemoryTotalMaxChars ?? resolveDynamicMemoryTotalMaxChars(env))
    )
  );

  const rows = listEpisodicMemoryFactsForDebug(db, opts);
  const inspected: EpisodicMemoryDebugFact[] = rows.map((fact) => {
    const structurallyValid = sanitizeExtractedFacts([{
      category: fact.category,
      subject: fact.subject,
      attribute: fact.attribute,
      value: fact.value,
      importance: fact.importance,
      fact_text: fact.fact_text,
    }]).length === 1;
    let blockedReason: string | null = null;
    if (!structurallyValid) blockedReason = "invalid_fact_schema";
    if (!blockedReason) blockedReason = detectEpisodicMemoryContamination(fact);
    if (!blockedReason && isClearlyTemporaryEpisodicFact(fact)) {
      blockedReason = "clearly_temporary";
    }
    if (
      !blockedReason &&
      currentTurn != null &&
      currentTurn - fact.source_turn < minAgeTurns
    ) {
      blockedReason = "too_recent";
    }
    if (!blockedReason && currentTurn != null && fact.source_turn >= currentTurn) {
      blockedReason = "future_or_current_turn";
    }
    const duplicateReason = blockedReason
      ? null
      : findDuplicateReason(fact, {
          chatId: opts.chatId,
          currentTurn,
          currentUserMessage: opts.currentUserMessage,
          recentChatText: opts.recentChatText,
          longTermMemoryText: opts.longTermMemoryText,
          relationshipMemoryText: opts.relationshipMemoryText,
          lorebookText: opts.lorebookText,
          triggeredEventText: opts.triggeredEventText,
        });

    return {
      ...fact,
      would_inject: false,
      blocked_reason: blockedReason,
      duplicate_reason: duplicateReason,
      budget_reason: null,
      final_rank: null,
    };
  });

  const eligible = inspected
    .filter((fact) => !fact.blocked_reason && !fact.duplicate_reason)
    .sort((a, b) => compareFactsForPrompt(a, b, opts.currentUserMessage ?? ""));

  eligible.forEach((fact, index) => {
    fact.final_rank = index + 1;
  });

  const higherPriorityDynamicChars = higherPriorityDynamicTextLength({
    chatId: opts.chatId,
    longTermMemoryText: opts.longTermMemoryText,
    relationshipMemoryText: opts.relationshipMemoryText,
    lorebookText: opts.lorebookText,
  });
  const effectiveMaxChars = Math.min(maxChars, Math.max(0, dynamicMemoryTotalMaxChars - higherPriorityDynamicChars));
  const selectedIds = new Set<number>();
  let usedChars = 0;
  for (const fact of eligible) {
    let budgetReason: EpisodicMemoryBudgetReason | null = null;
    if (effectiveMaxChars <= 0) budgetReason = "dynamic_memory_total_budget";
    else if (selectedIds.size >= maxFacts) budgetReason = "max_facts";
    else if (usedChars + fact.fact_text.length > effectiveMaxChars) budgetReason = "max_chars";

    if (budgetReason) {
      fact.budget_reason = budgetReason;
      continue;
    }
    selectedIds.add(fact.id);
    usedChars += fact.fact_text.length;
    fact.would_inject = true;
  }

  return inspected;
}
