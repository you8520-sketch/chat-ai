import { ARCHIVE_RELEVANCE_THRESHOLD } from "./memory-constants";
import { resolveMemoryBudgetFromCapacity } from "./memory-capacity-shared";
import type { ChatMemoryRow, MemoryInjection, MemoryTier } from "./memory-types";
import { calcUsedChars } from "./memory-db";

/** 한글·영문 키워드 추출 (API 없음) */
export function extractKeywords(text: string): string[] {
  const normalized = text
    .toLowerCase()
    .replace(/[^\w\s가-힣]/g, " ")
    .split(/\s+/)
    .map((w) => w.trim())
    .filter((w) => w.length >= 2);
  return [...new Set(normalized)];
}

export function scoreArchiveRelevance(archive: string, keywords: string[]): number {
  if (!archive.trim() || keywords.length === 0) return 0;
  const lower = archive.toLowerCase();
  return keywords.filter((k) => lower.includes(k)).length;
}

export function shouldIncludeArchive(archive: string, userMessage: string): boolean {
  const keywords = extractKeywords(userMessage);
  const score = scoreArchiveRelevance(archive, keywords);
  if (score >= ARCHIVE_RELEVANCE_THRESHOLD) return true;
  if (keywords.length <= 2 && score >= 1) return true;
  return false;
}

export function buildMemoryContext(opts: {
  memory: Pick<ChatMemoryRow, "pinned_facts" | "recent_summary" | "archive_summary" | "membership_tier">;
  userMessage: string;
  tier?: MemoryTier;
  memoryCapacity: number;
  /** Gemini bulk — archive를 관련성 무관 항상 주입 */
  includeArchiveAlways?: boolean;
  /** DeepSeek — 요약본이 raw history와 겹칠 때 환각 방지 헤더 */
  pastEventSummaryDedupe?: boolean;
}): MemoryInjection {
  const tier = opts.tier ?? opts.memory.membership_tier ?? "free";
  const budget = resolveMemoryBudgetFromCapacity(opts.memoryCapacity);

  // 레거시 pinned_facts가 남아 있으면 로어북 앞에 합쳐서 주입 (마이그레이션 전 안전망)
  const legacyPinned = opts.memory.pinned_facts?.trim() ?? "";
  const lorebookRaw = [legacyPinned, opts.memory.recent_summary?.trim() ?? ""]
    .filter(Boolean)
    .join("\n\n");
  const recent = lorebookRaw;

  let archive = "";
  let archiveIncluded = false;
  const rawArchive = opts.memory.archive_summary?.trim() ?? "";
  if (
    rawArchive &&
    (opts.includeArchiveAlways || shouldIncludeArchive(rawArchive, opts.userMessage))
  ) {
    archive = rawArchive;
    archiveIncluded = true;
  }

  const parts: string[] = [];
  if (recent) {
    if (opts.pastEventSummaryDedupe) {
      parts.push(
        `[과거 사건 요약본]
이 요약본은 최근 대화(히스토리) 이전의 과거 사건들이다. 최근 대화와 내용이 겹치더라도 동일한 하나의 사건으로 인지할 것.

${recent}`
      );
    } else {
      parts.push(
        `[현재기억]
최근 대화(히스토리)에 없는 이전 구간의 요약이다. 연속성은 히스토리와 관계 메모를 우선한다.

${recent}`
      );
    }
  }

  const usedChars = calcUsedChars({
    pinned_facts: "",
    recent_summary: recent,
    archive_summary: archiveIncluded ? archive : "",
  });

  return {
    text: parts.join("\n\n"),
    archiveText: archiveIncluded ? archive : "",
    pinnedChars: 0,
    recentChars: recent.length,
    archiveChars: archive.length,
    archiveIncluded,
    usedChars,
    limit: budget.total,
    tier,
  };
}
