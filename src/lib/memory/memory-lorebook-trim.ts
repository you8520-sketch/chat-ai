import { estimateTokens } from "@/lib/tokenEstimate";

export const LOREBOOK_OMIT_OLD_PREFIX = "…(오래된 기억 일부 생략)";
export const MEMORY_TOKEN_OMIT_PREFIX = "…(프롬프트 토큰 한도 — 앞부분 생략)";

const MEMORY_BLOCK_SPLIT = /\n\n(?=\[\d+~\d+턴\])/;

/** `[1~5턴]` 블록 단위 분리. 맨 앞 레거시(pinned)는 첫 블록 */
export function splitLorebookBlocks(text: string): string[] {
  const trimmed = text.trim();
  if (!trimmed) return [];
  return trimmed.split(MEMORY_BLOCK_SPLIT).filter(Boolean);
}

/** 문자 수 — 오래된 블록부터 제거, 최신 블록 우선 */
export function clampLorebookPreferRecentChars(
  text: string,
  maxChars: number
): { text: string; truncated: boolean } {
  const trimmed = text.trim();
  if (!trimmed || maxChars <= 0) return { text: "", truncated: false };
  if (trimmed.length <= maxChars) return { text: trimmed, truncated: false };

  const blocks = splitLorebookBlocks(trimmed);
  if (blocks.length === 0) return { text: "", truncated: false };

  const kept: string[] = [];
  let len = 0;
  let droppedBlocks = 0;

  for (let i = blocks.length - 1; i >= 0; i--) {
    const block = blocks[i];
    const sep = kept.length ? 2 : 0;
    if (len + sep + block.length <= maxChars) {
      kept.unshift(block);
      len += sep + block.length;
    } else {
      droppedBlocks++;
    }
  }

  if (kept.length === 0) {
    const last = blocks[blocks.length - 1]!;
    const prefixLen = LOREBOOK_OMIT_OLD_PREFIX.length + 2;
    const budget = Math.max(80, maxChars - prefixLen);
    const tail = last.length <= budget ? last : last.slice(-budget).trimStart();
    return {
      text: `${LOREBOOK_OMIT_OLD_PREFIX}\n\n${tail}`,
      truncated: true,
    };
  }

  let result = kept.join("\n\n");
  const truncated = droppedBlocks > 0 || kept.length < blocks.length;
  if (truncated) {
    result = `${LOREBOOK_OMIT_OLD_PREFIX}\n\n${result}`;
  }
  return { text: result, truncated };
}

function truncateSuffixByTokens(
  text: string,
  maxTokens: number,
  omitPrefix = LOREBOOK_OMIT_OLD_PREFIX
): { text: string; truncated: boolean } {
  const trimmed = text.trim();
  if (!trimmed) return { text: "", truncated: false };
  if (estimateTokens(trimmed) <= maxTokens) return { text: trimmed, truncated: false };

  let lo = 0;
  let hi = trimmed.length;
  while (lo < hi) {
    const mid = Math.floor((lo + hi) / 2);
    if (estimateTokens(trimmed.slice(mid)) <= maxTokens) hi = mid;
    else lo = mid + 1;
  }

  const suffix = trimmed.slice(lo).trimStart();
  return {
    text: lo > 0 ? `${omitPrefix}\n\n${suffix}` : suffix,
    truncated: lo > 0,
  };
}

/** 시스템 프롬프트 토큰 한도 — 압축 본문 꼬리 우선 (블록 삭제 아님) */
export function truncateMemorySuffixByTokens(
  text: string,
  maxTokens: number
): { text: string; truncated: boolean } {
  return truncateSuffixByTokens(text, maxTokens, MEMORY_TOKEN_OMIT_PREFIX);
}

/** 토큰 — 오래된 블록부터 제거, 최신 블록·꼬리 우선 */
export function clampLorebookPreferRecentTokens(
  text: string,
  maxTokens: number
): { text: string; truncated: boolean } {
  const trimmed = text.trim();
  if (!trimmed || maxTokens <= 0) return { text: "", truncated: false };
  if (estimateTokens(trimmed) <= maxTokens) return { text: trimmed, truncated: false };

  const blocks = splitLorebookBlocks(trimmed);
  const kept: string[] = [];
  let used = 0;
  let droppedBlocks = 0;

  for (let i = blocks.length - 1; i >= 0; i--) {
    const block = blocks[i];
    const blockTokens = estimateTokens(block);
    const gap = kept.length ? estimateTokens("\n\n") : 0;

    if (used + gap + blockTokens <= maxTokens) {
      kept.unshift(block);
      used += gap + blockTokens;
    } else if (kept.length === 0) {
      return truncateSuffixByTokens(block, maxTokens);
    } else {
      droppedBlocks++;
    }
  }

  let result = kept.join("\n\n");
  const truncated = droppedBlocks > 0 || kept.length < blocks.length;
  if (truncated) {
    result = `${LOREBOOK_OMIT_OLD_PREFIX}\n\n${result}`;
  }
  return { text: result, truncated };
}
