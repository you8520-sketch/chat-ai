import type {
  ExactOverlapHit,
  SettingExactOverlapAudit,
  SettingSourceBucket,
} from "./types";

export type SettingSource = {
  bucket: SettingSourceBucket;
  text: string;
};

const DEFAULT_EXCLUDE = [
  "렌",
  "에녹",
  "마더",
  "성채",
  "안개",
  "총성",
  "방독면",
  "저격",
  "변이체",
  "포자",
  "Level",
  "레벨",
];

function normalizeForOverlap(s: string): string {
  return s
    .toLowerCase()
    .replace(/[\s\n\r\t]+/g, "")
    .replace(/[.,!?;:'"“”‘’…·—–\-_/\\()[\]{}]/g, "");
}

function isExcluded(snippet: string, exclude: string[]): boolean {
  const n = normalizeForOverlap(snippet);
  if (n.length < 8) return true;
  for (const ex of exclude) {
    const en = normalizeForOverlap(ex);
    if (en && n === en) return true;
  }
  return false;
}

/** Longest common substring length on normalized strings (bounded O(n*m) for audit sizes). */
export function longestCommonSubstring(
  aRaw: string,
  bRaw: string,
  maxScan = 12_000
): { len: number; snippet: string } {
  const a = normalizeForOverlap(aRaw).slice(0, maxScan);
  const b = normalizeForOverlap(bRaw).slice(0, maxScan);
  if (!a || !b) return { len: 0, snippet: "" };
  let best = 0;
  let bestEnd = 0;
  const prev = new Array<number>(b.length + 1).fill(0);
  const cur = new Array<number>(b.length + 1).fill(0);
  for (let i = 1; i <= a.length; i++) {
    for (let j = 1; j <= b.length; j++) {
      if (a[i - 1] === b[j - 1]) {
        cur[j] = prev[j - 1]! + 1;
        if (cur[j]! > best) {
          best = cur[j]!;
          bestEnd = i;
        }
      } else {
        cur[j] = 0;
      }
    }
    for (let j = 0; j <= b.length; j++) {
      prev[j] = cur[j]!;
      cur[j] = 0;
    }
  }
  return {
    len: best,
    snippet: best > 0 ? a.slice(bestEnd - best, bestEnd) : "",
  };
}

function countMatchingNgrams(
  aRaw: string,
  bRaw: string,
  n = 12
): number {
  const a = normalizeForOverlap(aRaw);
  const b = normalizeForOverlap(bRaw);
  if (a.length < n || b.length < n) return 0;
  const set = new Set<string>();
  for (let i = 0; i + n <= b.length; i++) set.add(b.slice(i, i + n));
  let hits = 0;
  const seen = new Set<string>();
  for (let i = 0; i + n <= a.length; i++) {
    const g = a.slice(i, i + n);
    if (set.has(g) && !seen.has(g)) {
      seen.add(g);
      hits += 1;
    }
  }
  return hits;
}

export function computeSettingExactOverlapAudit(input: {
  output: string;
  sources: SettingSource[];
  excludeList?: string[];
  alarmMinChars?: number;
}): SettingExactOverlapAudit {
  const exclude = input.excludeList ?? DEFAULT_EXCLUDE;
  const alarmMin = input.alarmMinChars ?? 18;
  const hits: ExactOverlapHit[] = [];
  let longest = 0;
  let matching_ngram_count = 0;

  for (const src of input.sources) {
    if (!src.text?.trim()) continue;
    const { len, snippet } = longestCommonSubstring(input.output, src.text);
    matching_ngram_count += countMatchingNgrams(input.output, src.text);
    if (len >= alarmMin && !isExcluded(snippet, exclude)) {
      hits.push({
        bucket: src.bucket,
        overlap_chars: len,
        snippet: snippet.slice(0, 80),
      });
    }
    longest = Math.max(longest, len);
  }

  return {
    longest_common_substring_chars: longest,
    matching_ngram_count,
    source_overlap_span_count: hits.length,
    hits,
    alarm_18_plus: hits.some((h) => h.overlap_chars >= alarmMin),
  };
}
