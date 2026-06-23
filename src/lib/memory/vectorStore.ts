import { scoreChunkRelevance } from "@/utils/characterParser";
import type { CharacterChunk } from "@/types";

export type VectorSearchHit = {
  text: string;
  score: number;
  chunkId: string;
  category: CharacterChunk["category"];
};

const MIN_RAG_SCORE = 1;

/**
 * 캐릭터 설정 청크 키워드·맥락 매칭 RAG.
 * (향후 임베딩 DB 연동 시 search() 시그니처 유지)
 */
export function search(
  chunks: CharacterChunk[],
  userQuery: string,
  recentContext = "",
  limit = 3
): VectorSearchHit[] {
  const query = userQuery.trim();
  if (!query || chunks.length === 0) return [];

  const scored = chunks
    .map((chunk) => ({
      chunk,
      score: scoreChunkRelevance(chunk, query, recentContext),
    }))
    .filter(({ score }) => score >= MIN_RAG_SCORE)
    .sort((a, b) => b.score - a.score || b.chunk.tokenCount - a.chunk.tokenCount)
    .slice(0, limit);

  return scored.map(({ chunk, score }) => ({
    text: chunk.content.trim(),
    score,
    chunkId: chunk.id,
    category: chunk.category,
  }));
}

/** 검색 hit → 시스템 프롬프트 [CONTEXTUAL LORE] 블록 */
export function buildContextualLoreBlock(hits: VectorSearchHit[]): string {
  if (hits.length === 0) return "";
  const body = hits.map((h) => h.text).join("\n\n");
  return `[CONTEXTUAL LORE: (${body})]`;
}
