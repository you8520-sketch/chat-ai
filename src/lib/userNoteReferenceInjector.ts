import { ARCHIVE_RELEVANCE_THRESHOLD } from "@/lib/memory/memory-constants";
import { extractKeywords } from "@/lib/memory/memory-injector";

/** 확장구간 — 턴당 키워드 매칭 주입 상한 (전체 9,000자 통주입 금지) */
export const USER_NOTE_REFERENCE_INJECT_MAX_CHARS = 2_500;

const REFERENCE_CHUNK_SOFT_MAX = 800;

export function splitReferenceUserNoteChunks(reference: string): string[] {
  const trimmed = reference.trim();
  if (!trimmed) return [];

  const paragraphs = trimmed
    .split(/\n{2,}/)
    .map((s) => s.trim())
    .filter(Boolean);

  const out: string[] = [];
  for (const paragraph of paragraphs) {
    if (paragraph.length <= REFERENCE_CHUNK_SOFT_MAX) {
      out.push(paragraph);
      continue;
    }
    let buf = "";
    for (const line of paragraph.split(/\n/).map((l) => l.trim()).filter(Boolean)) {
      if (buf.length + line.length + 1 > REFERENCE_CHUNK_SOFT_MAX && buf) {
        out.push(buf);
        buf = line;
      } else {
        buf = buf ? `${buf}\n${line}` : line;
      }
    }
    if (buf) out.push(buf);
  }
  return out;
}

function koreanLooseTokenHit(haystack: string, token: string): boolean {
  if (token.length < 2) return false;
  if (haystack.includes(token)) return true;
  if (token.length >= 3 && haystack.includes(token.slice(0, token.length - 1))) return true;
  if (token.length >= 4 && haystack.includes(token.slice(0, token.length - 2))) return true;
  return false;
}

/** 유저 입력 ↔ 확장구간 양방향 키워드·어간 매칭 (한국어 조사 대응) */
export function scoreReferenceChunkRelevance(chunk: string, queryText: string): number {
  const chunkLower = chunk.toLowerCase();
  const queryLower = queryText.toLowerCase();
  let score = 0;

  for (const kw of extractKeywords(queryText)) {
    if (koreanLooseTokenHit(chunkLower, kw)) score += 2;
  }
  for (const kw of extractKeywords(chunk)) {
    if (koreanLooseTokenHit(queryLower, kw)) score += 2;
  }
  return score;
}

function referenceChunkMatchesQuery(chunk: string, queryText: string): boolean {
  const score = scoreReferenceChunkRelevance(chunk, queryText);
  if (score >= ARCHIVE_RELEVANCE_THRESHOLD) return true;
  if (extractKeywords(queryText).length <= 2 && score >= 1) return true;
  return false;
}

/** 유저 입력·최근 맥락 키워드와 매칭된 확장구간만 선택 (통주입 금지) */
export function selectReferenceUserNoteForInjection(opts: {
  reference: string;
  userMessage: string;
  recentContext?: string;
  maxInjectChars?: number;
}): string {
  const chunks = splitReferenceUserNoteChunks(opts.reference);
  if (chunks.length === 0) return "";

  const queryText = [opts.userMessage.trim(), opts.recentContext?.trim()]
    .filter(Boolean)
    .join("\n");
  if (!queryText.trim()) return "";

  const maxChars = opts.maxInjectChars ?? USER_NOTE_REFERENCE_INJECT_MAX_CHARS;

  const scored = chunks
    .map((chunk) => ({ chunk, score: scoreReferenceChunkRelevance(chunk, queryText) }))
    .filter(({ chunk }) => referenceChunkMatchesQuery(chunk, queryText))
    .sort((a, b) => b.score - a.score);

  const selected: string[] = [];
  let used = 0;
  for (const { chunk } of scored) {
    const sep = selected.length ? 2 : 0;
    if (used + sep + chunk.length > maxChars) break;
    selected.push(chunk);
    used += sep + chunk.length;
  }

  return selected.join("\n\n");
}

export function buildReferenceUserNotePromptBlock(injected: string): string {
  const body = injected.trim();
  if (!body) return "";
  return `[유저노트 확장구간 — 키워드 매칭 · 이번 턴만 · 원문 그대로 · 번역·요약·改変 금지]\n${body}`;
}
