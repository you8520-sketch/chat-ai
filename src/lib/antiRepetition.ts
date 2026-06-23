/** AI 출력 반복·에코(앵무새) 후처리 */

function normalizeChunk(s: string): string {
  return s.replace(/\s+/g, " ").trim().toLowerCase();
}

function splitSentences(text: string): string[] {
  const out: string[] = [];
  const re = /[^.!?…]+(?:[.!?…]["'」』)]*)?\s*/g;
  let m: RegExpExecArray | null;
  while ((m = re.exec(text)) !== null) {
    const s = m[0].trim();
    if (s) out.push(s);
  }
  if (out.length === 0 && text.trim()) return [text.trim()];
  return out;
}

/** 한국어 RP — 줄바꿈·종결 부호 기준 분할 */
function splitSentencesKorean(text: string): string[] {
  const out: string[] = [];
  for (const block of text.split(/\n+/)) {
    const trimmed = block.trim();
    if (!trimmed) continue;
    const subs = trimmed.split(/(?<=[.!?…]["'」』)]*)\s+/);
    for (const s of subs) {
      const t = s.trim();
      if (t) out.push(t);
    }
  }
  if (out.length === 0 && text.trim()) return [text.trim()];
  return out;
}

function countPhraseInWindow(window: string, phrase: string, minPhraseLen: number): number {
  const norm = normalizeChunk(phrase);
  if (norm.length < minPhraseLen) return 0;
  const len = phrase.length;
  let count = 0;
  for (let i = 0; i <= window.length - len; i++) {
    if (normalizeChunk(window.slice(i, i + len)) === norm) count++;
  }
  return count;
}

/** 같은 글자·음절 연타 (아아아… / ……) — 스트리밍 조기 중단 */
export function detectCharStutter(text: string): boolean {
  const t = text.trim();
  if (t.length < 35) return false;

  const tail = t.slice(-120).replace(/\s/g, "");
  if (tail.length < 30) return false;

  const run = tail.match(/(.)\1{14,}/);
  if (run) return true;

  const chars = [...tail];
  const freq = new Map<string, number>();
  for (const c of chars) freq.set(c, (freq.get(c) ?? 0) + 1);
  const max = Math.max(...freq.values());
  if (max / chars.length >= 0.55) return true;

  return false;
}

/** Phrase-echo window — recent tail only (full 1500-char scan false-positive at tier build-up) */
const STREAMING_LOOP_PHRASE_WINDOW = 650;

/** Thematic phrase repetition is normal while building toward ~1800+ tier minimum */
const STREAMING_LOOP_PHRASE_MIN_LEN = 1800;

/** HTML visual card — 템플릿 div/style 반복으로 LOOP_ABORT 오탐 방지 */
export function isHtmlVisualCardGenerationActive(text: string): boolean {
  const idx = text.lastIndexOf("```html");
  if (idx < 0) return false;
  const tail = text.slice(idx + 7);
  return !/```/.test(tail);
}

/**
 * 스트리밍 중 즉시 중단할 반복 루프 (한국어·무공백 문장 대응)
 * — 160자 이후 줄/문장 3연속 검사 (연타 패턴은 35자부터)
 * — phrase-echo는 tier minimum(1800) 이후·최근 650자만 (1500 전체 스캔 오탐 방지)
 */
export function detectStreamingLoop(text: string): boolean {
  const t = text.trim();
  if (isHtmlVisualCardGenerationActive(t)) return false;
  const len = t.length;
  if (len >= 35 && detectCharStutter(t)) return true;
  if (len < 160) return false;

  const lines = t.split("\n").map((l) => l.trim()).filter(Boolean);
  if (lines.length >= 3) {
    const a = normalizeChunk(lines[lines.length - 1]!);
    const b = normalizeChunk(lines[lines.length - 2]!);
    const c = normalizeChunk(lines[lines.length - 3]!);
    if (a.length >= 10 && a === b && b === c) return true;
  }

  const sents = splitSentencesKorean(t);
  if (sents.length >= 3) {
    const last = normalizeChunk(sents[sents.length - 1]!);
    const prev = normalizeChunk(sents[sents.length - 2]!);
    const p2 = normalizeChunk(sents[sents.length - 3]!);
    if (last.length >= 8 && last === prev && prev === p2) return true;
  }

  if (len >= STREAMING_LOOP_PHRASE_MIN_LEN) {
    const tailWindow = t.slice(-Math.min(STREAMING_LOOP_PHRASE_WINDOW, len));
    for (const phraseLen of [20, 35, 50, 70, 100]) {
      if (len < phraseLen * 2) continue;
      const phrase = t.slice(-phraseLen);
      const minHits = phraseLen <= 35 ? 5 : 4;
      if (countPhraseInWindow(tailWindow, phrase, 12) >= minHits) return true;
    }
  }

  if (len >= 400) {
    const tail = t.slice(-500);
    const half = Math.floor(tail.length / 2);
    if (half >= 120 && normalizeChunk(tail.slice(0, half)) === normalizeChunk(tail.slice(half))) {
      return true;
    }
  }

  return false;
}

/** 반복 구간 제거 — 루프 감지 후 저장·표시용 */
export function trimLoopTail(text: string): string {
  return trimLoopTailMinimal(text);
}

/**
 * 최소 제거 — 마지막 줄/문장 3연속 동일일 때만 tail 1회 제거.
 * sanitizeRepetitiveText(문단 dedupe)는 호출하지 않음.
 */
export function trimLoopTailMinimal(text: string): string {
  let out = text.trim();
  if (out.length < 30) return out;

  const sents = splitSentencesKorean(out);
  if (sents.length >= 3) {
    const lastNorm = normalizeChunk(sents[sents.length - 1]!);
    const prev = normalizeChunk(sents[sents.length - 2]!);
    const p2 = normalizeChunk(sents[sents.length - 3]!);
    if (lastNorm.length >= 8 && lastNorm === prev && prev === p2) {
      return sents.slice(0, -1).join("\n").trim();
    }
  }

  const lines = out.split("\n").map((l) => l.trim()).filter(Boolean);
  if (lines.length >= 3) {
    const last = normalizeChunk(lines[lines.length - 1]!);
    const prev = normalizeChunk(lines[lines.length - 2]!);
    const p2 = normalizeChunk(lines[lines.length - 3]!);
    if (last.length >= 10 && last === prev && prev === p2) {
      return lines.slice(0, -1).join("\n");
    }
  }

  return out;
}

/** @deprecated stream-first save — aggressive dedupe; use trimLoopTailMinimal / sanitizeRepetitiveTextMinimal */
export function trimLoopTailAggressive(text: string): string {
  let out = sanitizeRepetitiveText(text);
  const sents = splitSentencesKorean(out);
  if (sents.length >= 2) {
    const lastNorm = normalizeChunk(sents[sents.length - 1]!);
    for (let i = sents.length - 2; i >= Math.max(0, sents.length - 8); i--) {
      if (normalizeChunk(sents[i]!) === lastNorm && lastNorm.length >= 8) {
        return sents.slice(0, i + 1).join("\n").trim();
      }
    }
  }

  const lines = out.split("\n").map((l) => l.trim()).filter(Boolean);
  if (lines.length >= 2) {
    const last = normalizeChunk(lines[lines.length - 1]!);
    for (let i = lines.length - 2; i >= 0; i--) {
      if (normalizeChunk(lines[i]!) === last && last.length >= 10) {
        return lines.slice(0, i + 1).join("\n");
      }
    }
  }

  return out;
}

/** 연속·전역 중복 문장·문단 제거 — aggressive (stream-first save 경로에서 사용 금지) */
export function sanitizeRepetitiveText(text: string): string {
  let out = text.trim();
  if (out.length < 30) return out;

  const sentences = splitSentencesKorean(out);
  if (sentences.length >= 2) {
    const kept: string[] = [];
    let prevNorm = "";
    for (const s of sentences) {
      const norm = normalizeChunk(s);
      if (norm.length >= 8 && norm === prevNorm) continue;
      if (norm.length >= 20 && prevNorm.length >= 20 && prevNorm.includes(norm)) continue;
      kept.push(s);
      prevNorm = norm;
    }
    out = kept.join("\n").trim();
  }

  const paras = out.split(/\n{2,}/).map((p) => p.trim()).filter(Boolean);
  if (paras.length >= 2) {
    const seen = new Set<string>();
    const unique: string[] = [];
    for (const p of paras) {
      const norm = normalizeChunk(p);
      if (norm.length >= 20 && seen.has(norm)) continue;
      if (norm.length >= 20) seen.add(norm);
      unique.push(p);
    }
    out = unique.join("\n\n");
  }

  out = collapseAdjacentDuplicateLines(out);
  return out.trim();
}

/** 최소 dedupe — 바로 인접한 동일 줄만 1회 제거 (문단·전역 dedupe 없음) */
export function sanitizeRepetitiveTextMinimal(text: string): string {
  return collapseAdjacentDuplicateLines(text.trim());
}

/** 저장 경로 — 동일 문단(≥40자 norm)이 다시 나오면 첫 occurrence만 유지 */
export function dedupeGlobalParagraphs(text: string, minNormLen = 40): string {
  const trimmed = text.trim();
  if (trimmed.length < 80) return trimmed;

  const paras = trimmed.split(/\n{2,}/).map((p) => p.trim()).filter(Boolean);
  if (paras.length < 2) return trimmed;

  const seen = new Set<string>();
  const kept: string[] = [];
  for (const p of paras) {
    const norm = normalizeChunk(p);
    if (norm.length >= minNormLen && seen.has(norm)) continue;
    if (norm.length >= minNormLen) seen.add(norm);
    kept.push(p);
  }
  return kept.join("\n\n");
}

/** 같은 줄/문장이 바로 이어서 2번 이상 나오면 1번만 유지 */
function collapseAdjacentDuplicateLines(text: string): string {
  const lines = text.split(/\n/);
  const out: string[] = [];
  let prevNorm = "";
  for (const line of lines) {
    const norm = normalizeChunk(line);
    if (norm.length >= 10 && norm === prevNorm) continue;
    out.push(line);
    prevNorm = norm.length >= 10 ? norm : "";
  }
  return out.join("\n");
}

/** 이어쓰기 append가 기존 본문과 거의 같으면 중단 */
export function isMostlyDuplicateAppend(
  priorText: string,
  appended: string,
  opts?: RecoveryTailOpts
): boolean {
  const a = normalizeChunk(appended);
  if (a.length < 40) return false;
  const priorNorm = normalizeChunk(priorText);
  if (a === priorNorm) return true;

  const charMatchThreshold = opts?.claudeRecovery ? 0.92 : 0.85;

  if (priorNorm.length >= 280 && a.length >= priorNorm.length * 0.6) {
    if (a === priorNorm) return true;
    const probe = Math.min(420, priorNorm.length, a.length);
    if (probe >= 120 && a.slice(0, probe) === priorNorm.slice(0, probe)) return true;
    if (priorNorm.includes(a) || a.includes(priorNorm.slice(0, Math.min(600, priorNorm.length)))) {
      return true;
    }
  }

  const tail = normalizeChunk(priorText.slice(-Math.min(priorText.length, a.length * 2)));
  if (tail.includes(a)) return true;
  if (a.length >= 80 && tail.length >= 80) {
    const shorter = a.length < tail.length ? a : tail.slice(-a.length);
    let matches = 0;
    for (let i = 0; i < shorter.length; i++) {
      if (shorter[i] === a[i]) matches++;
    }
    if (matches / shorter.length > charMatchThreshold) return true;
  }
  return false;
}

function stripRecoveryPrefixOverlap(
  priorText: string,
  continuation: string,
  minOverlap = 160
): string {
  const prior = priorText.trim();
  let cont = continuation;
  if (!prior || !cont.trim()) return continuation;

  const priorHead = prior.slice(0, Math.min(320, prior.length));
  const headIdx = cont.indexOf(priorHead);
  if (headIdx >= 0 && headIdx < 200) {
    const afterFull = cont.slice(headIdx + prior.length).trimStart();
    if (afterFull.length > 0) return afterFull;
    for (let cut = prior.length; cut >= 120; cut -= 40) {
      const slice = prior.slice(0, cut);
      const pos = cont.indexOf(slice);
      if (pos >= 0 && pos < 200) {
        const tail = cont.slice(pos + slice.length).trimStart();
        if (tail.length > 0) return tail;
      }
    }
  }

  const maxOverlap = Math.min(prior.length, cont.length, 2200);
  const floor = Math.max(40, minOverlap);
  for (let o = maxOverlap; o >= floor; o--) {
    if (prior.slice(-o) === cont.slice(0, o)) {
      return cont.slice(o);
    }
  }

  return continuation;
}

export type RecoveryTailOpts = {
  /** Claude prefill tail(50~100자) 겹침 제거 */
  claudeRecovery?: boolean;
  minPrefixOverlap?: number;
  /** Claude — overlap strip만, echo 폐기·문장 dedupe skip */
  bypassEchoDiscard?: boolean;
};

/** recovery 이어쓰기 — 직전 본문과 겹치는 문장 제거, 새 전개만 반환 */
export function extractUniqueRecoveryTail(
  priorText: string,
  continuation: string,
  opts?: RecoveryTailOpts
): string {
  const minOverlap = opts?.minPrefixOverlap ?? (opts?.claudeRecovery ? 40 : 160);
  const prior = priorText.trim();
  let cont = stripRecoveryPrefixOverlap(prior, continuation, minOverlap).trim();
  if (!cont) return "";
  if (opts?.bypassEchoDiscard) return cont;

  const priorNorm = normalizeChunk(prior);
  const contNorm = normalizeChunk(cont);
  if (contNorm === priorNorm) return "";
  if (contNorm.length >= 80 && priorNorm.includes(contNorm)) return "";
  if (isMostlyDuplicateAppend(prior, cont, opts)) return "";

  const priorSents = new Set(
    splitSentencesKorean(prior)
      .map(normalizeChunk)
      .filter((n) => n.length >= 6)
  );
  const uniqueSents: string[] = [];
  for (const s of splitSentencesKorean(cont)) {
    const norm = normalizeChunk(s);
    if (norm.length < 4) continue;
    if (priorSents.has(norm) || priorNorm.includes(norm)) continue;
    uniqueSents.push(s);
  }
  const filtered = uniqueSents.join(" ").trim();
  if (!filtered) return "";
  if (isMostlyDuplicateAppend(prior, filtered, opts)) return "";
  return filtered;
}

/** prior + recovery 병합 결과가 본문 에코(같은 말 반복)면 true */
export function isRecoveryEchoMerge(
  priorText: string,
  mergedText: string,
  opts?: RecoveryTailOpts
): boolean {
  const prior = priorText.trim();
  const merged = mergedText.trim();
  const minGain = opts?.claudeRecovery ? 40 : 80;
  if (prior.length < 160 || merged.length < prior.length + minGain) return false;

  const contPart = merged.slice(prior.length).trim();
  if (!contPart) return false;
  if (isMostlyDuplicateAppend(prior, contPart, opts)) return true;

  const priorNorm = normalizeChunk(prior);
  const contNorm = normalizeChunk(contPart);
  const probeLen = opts?.claudeRecovery ? Math.min(400, contNorm.length) : Math.min(500, contNorm.length);
  if (contNorm.length >= (opts?.claudeRecovery ? 160 : 200) && priorNorm.includes(contNorm.slice(0, probeLen))) {
    return true;
  }

  const contSents = splitSentencesKorean(contPart)
    .map(normalizeChunk)
    .filter((n) => n.length >= 12);
  if (contSents.length >= 2) {
    const priorSet = new Set(
      splitSentencesKorean(prior)
        .map(normalizeChunk)
        .filter((n) => n.length >= 12)
    );
    const dup = contSents.filter((s) => priorSet.has(s)).length;
    const dupRatio = opts?.claudeRecovery ? 0.68 : 0.5;
    if (dup / contSents.length >= dupRatio) return true;
  }

  if (merged.length >= prior.length * 1.55) {
    const probe = Math.min(360, priorNorm.length);
    const echoAt = normalizeChunk(
      merged.slice(Math.floor(prior.length * 0.85), Math.floor(prior.length * 0.85) + probe)
    );
    if (echoAt.length >= 120 && priorNorm.startsWith(echoAt.slice(0, Math.min(200, echoAt.length)))) {
      return true;
    }
  }

  return false;
}

/** @deprecated extractUniqueRecoveryTail 내부 — 테스트·호환 */
export const stripDuplicateRecoveryPrefix = stripRecoveryPrefixOverlap;
