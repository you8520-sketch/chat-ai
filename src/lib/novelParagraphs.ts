import { fixCommonJapaneseLeaksInKoreanProse } from "@/lib/koreanProseSanitize";

export type NovelParagraphKind = "narration" | "dialogue" | "mixed";

export type NovelSegment = { kind: "narration" | "dialogue" | "special"; text: string };

/** 큰따옴표 — ASCII + curly (모델 출력 변형, 줄바꿈 포함). 발화는 "…"만. */
const QUOTED_DIALOGUE_BODY = String.raw`[\s\S]*?`;
const DIALOGUE_PAIR_RE = new RegExp(
  `(?:"${QUOTED_DIALOGUE_BODY}"|\u201C${QUOTED_DIALOGUE_BODY}\u201D)`,
  "g"
);
const HAS_DIALOGUE_QUOTE_RE = /(?:"|\u201C|\u201D)/;
/** 닫는 따옴표 직후 — 인용·서술 속 인용(실제 대사 블록 아님) */
const INLINE_NARRATED_QUOTE_AFTER_RE =
  /^(?:이)?(?:라고(?:요|만|서|도)?|라며|라는|라던|하고|하며|고\s+말|고\s+(?:외치|속삭|중얼|답|대답|응|설명|묻|되물)|란|처럼|같은|라서|이라서|라니|이라니|라자|이라자)/;
const QUOTED_ONLY_LINE_RE = /^(?:"([^"\n]+)"|\u201C([^\u201D\n]+)\u201D)$/;
const PURE_DIALOGUE_LINE_RE = new RegExp(
  `^(?:"${QUOTED_DIALOGUE_BODY}"|\u201C${QUOTED_DIALOGUE_BODY}\u201D)$`
);

const OPEN_DIALOGUE_QUOTE_CHARS = new Set(['"', "\u201C"]);

function isInlineNarratedQuote(content: string, _quoteStart: number, quoteEnd: number): boolean {
  const after = content.slice(quoteEnd).replace(/^\s+/, "");
  if (INLINE_NARRATED_QUOTE_AFTER_RE.test(after)) return true;
  const afterBreak = content.slice(quoteEnd).replace(/^\s*(?:\n+\s*)+/, "");
  return INLINE_NARRATED_QUOTE_AFTER_RE.test(afterBreak);
}

function hasStandaloneDialogueQuote(content: string): boolean {
  for (const m of content.matchAll(new RegExp(DIALOGUE_PAIR_RE.source, "g"))) {
    const idx = m.index ?? 0;
    if (!isInlineNarratedQuote(content, idx, idx + m[0].length)) return true;
  }
  return false;
}

function matchingCloseDialogueQuote(open: string): string {
  switch (open) {
    case '"':
      return '"';
    case "\u201C":
      return "\u201D";
    default:
      return open;
  }
}

/** 따옴표로 열린 대사 블록은 줄바꿈이 있어도 한 덩어리로 유지 */
function readQuotedSpan(content: string, start: number): number {
  const open = content[start]!;
  const close = matchingCloseDialogueQuote(open);
  let j = start + 1;
  while (j < content.length && content[j] !== close) j++;
  if (j < content.length) j += 1;
  return j;
}

function splitQuoteAwareLines(content: string): string[] {
  const result: string[] = [];
  let i = 0;
  const len = content.length;

  while (i < len) {
    while (i < len && content[i] === "\n") i++;
    if (i >= len) break;

    if (OPEN_DIALOGUE_QUOTE_CHARS.has(content[i]!)) {
      const quoteStart = i;
      const quoteEnd = readQuotedSpan(content, quoteStart);

      if (isInlineNarratedQuote(content, quoteStart, quoteEnd)) {
        let k = quoteEnd;
        while (k < len) {
          if (content[k] === "\n") break;
          if (OPEN_DIALOGUE_QUOTE_CHARS.has(content[k]!)) {
            const nestedStart = k;
            const nestedEnd = readQuotedSpan(content, nestedStart);
            if (!isInlineNarratedQuote(content, nestedStart, nestedEnd)) break;
            k = nestedEnd;
            continue;
          }
          k++;
        }
        const chunk = content.slice(quoteStart, k);
        for (const line of chunk.split(/\n+/).map((l) => l.trim()).filter(Boolean)) {
          result.push(line);
        }
        i = k;
        continue;
      }

      const block = content.slice(quoteStart, quoteEnd).trim();
      if (block) result.push(block);
      i = quoteEnd;
      continue;
    }

    let j = i;
    while (j < len) {
      if (content[j] === "\n") break;
      if (OPEN_DIALOGUE_QUOTE_CHARS.has(content[j]!)) {
        const quoteStart = j;
        const quoteEnd = readQuotedSpan(content, quoteStart);
        if (isInlineNarratedQuote(content, quoteStart, quoteEnd)) {
          j = quoteEnd;
          continue;
        }
        break;
      }
      j++;
    }
    const chunk = content.slice(i, j);
    for (const line of chunk.split(/\n+/).map((l) => l.trim()).filter(Boolean)) {
      result.push(line);
    }
    i = j;
  }

  return result;
}

/** 따옴표 없는 짧은 구어 — 제작자 인사말 등에서만 대사 추정 (AI 본문은 " " 필수) */
const BARE_SPEECH_LINE_RE = /^[^"*「『\n]{1,120}(?:[?!.…~]+)?$/u;
const NARRATION_ENDING_RE =
  /(?:다|했다|하였다|이었다|였다|며|고|면서|더니|다가|자|체|듯|겠다|겠어|겠지)(?:[.…!?,\s]|$)/;
/** 서술·강조 지문 — ~게, ~으로, ~척, 쉼표 나열 등 (대사 아님) */
const NARRATION_DESCRIPTIVE_RE =
  /(?:게|하게|히|히게|스럽게|처럼|듯이|만큼|정도|이며|라며|으며|하면서|오며|으로|척|인\s*척|하는\s*척|체|인\s*체|하는\s*체)(?:[,.…!?]\s*|[,.…!?]$)|,\s*(?:더|조금|아주|매우|점점|한\s)/;
const BARE_SPEECH_ENDING_RE =
  /(?:[?!…]|[ㅋㅎ]+)(?:[.…!?]|$)$|(?:요|네|죠|군|구나|십니까|습니까|할까|일까|하지|거야|잖아|라고|냐|니)(?:[,.…!?]|$)/;

export function isNarrationEmphasisLine(text: string): boolean {
  const trimmed = text.trim();
  if (!trimmed || HAS_DIALOGUE_QUOTE_RE.test(trimmed)) return false;
  if (NARRATION_ENDING_RE.test(trimmed)) return false;
  return NARRATION_DESCRIPTIVE_RE.test(trimmed);
}

/** 강조·펀치 한 줄 — 단독 문단 유지 (흐름 지문과 병합 금지) */
export function isStandaloneNarrationPunchLine(text: string): boolean {
  const trimmed = text.trim();
  if (!trimmed || HAS_DIALOGUE_QUOTE_RE.test(trimmed)) return false;
  if (isNarrationEmphasisLine(trimmed)) return true;
  if (trimmed.length > 45) return false;
  if (NARRATION_ENDING_RE.test(trimmed)) return false;
  return /^[….\s]*[^\s]{1,40}[?!…]+$/u.test(trimmed);
}

export function isBareDialogueLine(text: string): boolean {
  const trimmed = text.trim();
  if (!trimmed || HAS_DIALOGUE_QUOTE_RE.test(trimmed)) return false;
  if (!BARE_SPEECH_LINE_RE.test(trimmed)) return false;
  if (NARRATION_ENDING_RE.test(trimmed)) return false;
  if (NARRATION_DESCRIPTIVE_RE.test(trimmed)) return false;
  return BARE_SPEECH_ENDING_RE.test(trimmed);
}

const GREETING_SEGMENT_RE = /(\*[^*\n]+\*|"[^"]*"|「[^」]*」|『[^』]*』)/g;

function pushGreetingChunk(segments: NovelSegment[], chunk: string) {
  const trimmed = chunk.trim();
  if (!trimmed) return;
  segments.push({
    kind: isBareDialogueLine(trimmed) ? "dialogue" : "narration",
    text: trimmed,
  });
}

/** 제작자 첫 메시지: *지문* · "대사" · 「스킬명」 구분 */
export function parseGreetingSegments(text: string): NovelSegment[] {
  const segments: NovelSegment[] = [];
  let last = 0;
  for (const m of text.matchAll(GREETING_SEGMENT_RE)) {
    const idx = m.index ?? 0;
    if (idx > last) {
      pushGreetingChunk(segments, text.slice(last, idx));
    }
    const token = m[0];
    if (token.startsWith("*")) {
      segments.push({ kind: "narration", text: token.slice(1, -1).trim() });
    } else if (token.startsWith('"')) {
      segments.push({ kind: "dialogue", text: token });
    } else {
      segments.push({ kind: "special", text: token });
    }
    last = idx + token.length;
  }
  if (last < text.length) {
    pushGreetingChunk(segments, text.slice(last));
  }
  return segments;
}

export type NovelParagraphClassifyOpts = { streaming?: boolean };

/** 열린 따옴표 대사(닫히지 않음) — 스트리밍·완료 후 동일하게 대사 문단 */
function isOpenDialogueParagraph(text: string): boolean {
  const trimmed = text.trim();
  if (!trimmed || !OPEN_DIALOGUE_QUOTE_CHARS.has(trimmed[0]!)) return false;
  const quoteEnd = readQuotedSpan(trimmed, 0);
  return quoteEnd >= trimmed.length && !isInlineNarratedQuote(trimmed, 0, quoteEnd);
}

/** 지문 / 대사-only / 혼합(지문+따옴표) — AI 출력은 따옴표 있는 줄만 대사 */
export function classifyNovelParagraph(
  text: string,
  opts?: NovelParagraphClassifyOpts
): NovelParagraphKind {
  const trimmed = text.trim();
  if (!trimmed) return "narration";
  if (isOpenDialogueParagraph(trimmed)) return "dialogue";
  if (PURE_DIALOGUE_LINE_RE.test(trimmed)) return "dialogue";
  if (HAS_DIALOGUE_QUOTE_RE.test(trimmed)) {
    return hasStandaloneDialogueQuote(trimmed) ? "mixed" : "narration";
  }
  return "narration";
}

const NOVEL_SEGMENT_RE = new RegExp(
  `(?:"${QUOTED_DIALOGUE_BODY}"|\u201C${QUOTED_DIALOGUE_BODY}\u201D|「[^」]*」|『[^』]*』)`,
  "g"
);

/** AI 출력: "…"=대사 · 「…」/『…』=스킬·특수 · 나머지=지문 */
export function parseNovelSegments(text: string): NovelSegment[] {
  const segments: NovelSegment[] = [];
  let last = 0;
  for (const m of text.matchAll(NOVEL_SEGMENT_RE)) {
    const idx = m.index ?? 0;
    if (idx > last) {
      segments.push({ kind: "narration", text: text.slice(last, idx) });
    }
    const token = m[0];
    const isQuote = token.startsWith('"') || token.startsWith("\u201C");
    const kind =
      isQuote && !isInlineNarratedQuote(text, idx, idx + token.length)
        ? "dialogue"
        : isQuote
          ? "narration"
          : "special";
    segments.push({ kind, text: token });
    last = idx + token.length;
  }
  if (last < text.length) {
    segments.push({ kind: "narration", text: text.slice(last) });
  }
  return segments;
}

/**
 * 제작자 입력(첫 메시지 등): 줄바꿈(Enter)마다 문단을 나눔.
 */
export function groupAuthorParagraphs(content: string): string[] {
  return content
    .replace(/\r\n/g, "\n")
    .split("\n")
    .map((l) => l.trim())
    .filter(Boolean);
}

/**
 * 한 줄 안에 지문+"대사"가 붙어 있으면 대사마다 줄바꿈으로 분리.
 * 닫히지 않은 열린 따옴표도 지문과 즉시 분리 (스트리밍·저장본 동일).
 */
function insertDialogueLineBreaks(content: string, streaming = false): string {
  if (!HAS_DIALOGUE_QUOTE_RE.test(content)) return content;
  const parts: string[] = [];
  let last = 0;
  for (const m of content.matchAll(DIALOGUE_PAIR_RE)) {
    const idx = m.index ?? 0;
    const end = idx + m[0].length;
    if (isInlineNarratedQuote(content, idx, end)) continue;
    if (idx > last) {
      const narr = content.slice(last, idx).trim();
      if (narr) parts.push(narr);
    }
    parts.push(m[0]);
    last = end;
  }
  if (last < content.length) {
    appendOpenDialogueTailParts(parts, content.slice(last));
  }
  if (parts.length === 0) return content;
  return parts.join("\n");
}

/** tail에 닫히지 않은 대사 따옴표가 있으면 지문과 즉시 분리 */
function appendOpenDialogueTailParts(parts: string[], tail: string): void {
  const trimmed = tail.trim();
  if (!trimmed) return;

  for (let i = 0; i < trimmed.length; i++) {
    if (!OPEN_DIALOGUE_QUOTE_CHARS.has(trimmed[i]!)) continue;

    const quoteStart = i;
    const quoteEnd = readQuotedSpan(trimmed, quoteStart);
    if (isInlineNarratedQuote(trimmed, quoteStart, quoteEnd)) {
      i = quoteEnd < trimmed.length ? quoteEnd : trimmed.length - 1;
      continue;
    }
    if (quoteEnd >= trimmed.length) {
      const before = trimmed.slice(0, quoteStart).trim();
      const dialogue = trimmed.slice(quoteStart).trim();
      if (before) parts.push(before);
      if (dialogue) parts.push(dialogue);
      return;
    }
    i = quoteEnd - 1;
  }

  parts.push(trimmed);
}

/** 지문·대사가 한 줄에 섞인 경우 → 대사는 각각 독립 줄 */
function splitLineByDialogue(line: string, streaming = false): string[] {
  const trimmed = line.trim();
  if (!trimmed || !HAS_DIALOGUE_QUOTE_RE.test(trimmed)) return [trimmed];
  if (PURE_DIALOGUE_LINE_RE.test(trimmed)) return [trimmed];
  return insertDialogueLineBreaks(trimmed, streaming)
    .split(/\n+/)
    .map((l) => l.trim())
    .filter(Boolean);
}

/** 지문 문단 최소 길이 — 미만이면 인접 지문과 병합 시도 */
export const MIN_NARRATION_CHARS_PER_PARAGRAPH = 50;
/** 지문 문단 권장 상한 — 초과 시 문장 경계에서 분할 */
export const MAX_NARRATION_CHARS_PER_PARAGRAPH = 480;
/** @deprecated 프롬프트 전용 — 런타임 검증 미사용 */
export const MIN_NARRATION_PARAGRAPHS = 6;
/** @deprecated MIN_NARRATION_PARAGRAPHS 사용 */
export const MIN_BODY_PARAGRAPHS = MIN_NARRATION_PARAGRAPHS;

function mergeConsecutiveNarrationLines(lines: string[], streaming = false): string[] {
  const out: string[] = [];
  let buf: string[] = [];
  const classifyOpts: NovelParagraphClassifyOpts = { streaming };

  const flush = () => {
    if (buf.length === 0) return;
    const merged = buf.join(" ").replace(/\s{2,}/g, " ").trim();
    buf = [];
    if (!merged) return;
    out.push(merged);
  };

  for (const line of lines) {
    const collapsed = collapseDialogueInternalLineBreaks(line.trim());
    if (!collapsed) continue;
    const kind = classifyNovelParagraph(collapsed, classifyOpts);
    if (kind === "dialogue") {
      flush();
      out.push(collapsed);
    } else if (kind === "mixed") {
      flush();
      for (const part of splitLineByDialogue(collapsed, streaming)) {
        const pk = classifyNovelParagraph(part, classifyOpts);
        if (pk === "dialogue") {
          flush();
          out.push(collapseDialogueInternalLineBreaks(part));
        } else {
          buf.push(part);
        }
      }
    } else {
      buf.push(collapsed);
    }
  }
  flush();
  return out;
}

/** AI가 문장마다 빈 줄을 넣어 만든 짧은 지문 문단을 다시 묶음 */
function isMergeableFlowingNarration(text: string, streaming: boolean): boolean {
  const trimmed = text.trim();
  if (!trimmed) return false;
  const kind = classifyNovelParagraph(trimmed, { streaming });
  if (kind !== "narration") return false;
  if (isNarrationEmphasisLine(trimmed)) return false;
  if (isStandaloneNarrationPunchLine(trimmed)) return false;
  if (/^…+$/.test(trimmed) || /^[….\s]+$/.test(trimmed)) return false;
  return true;
}

function combinedNarrationLength(prev: string, next: string): number {
  return `${prev} ${next}`.replace(/\s{2,}/g, " ").trim().length;
}

function mergeAdjacentShortNarrationParagraphs(
  paragraphs: string[],
  streaming = false
): string[] {
  const out: string[] = [];

  for (const para of paragraphs) {
    const trimmed = para.trim();
    if (!trimmed) continue;

    const prev = out[out.length - 1];
    const prevMergeable = prev ? isMergeableFlowingNarration(prev, streaming) : false;
    const nextMergeable = isMergeableFlowingNarration(trimmed, streaming);

    if (prev && prevMergeable && nextMergeable) {
      if (combinedNarrationLength(prev, trimmed) <= MAX_NARRATION_CHARS_PER_PARAGRAPH) {
        out[out.length - 1] = `${prev} ${trimmed}`;
        continue;
      }
    }

    if (
      prev &&
      prevMergeable &&
      nextMergeable === false &&
      classifyNovelParagraph(trimmed, { streaming }) === "narration" &&
      (prev.length < MIN_NARRATION_CHARS_PER_PARAGRAPH ||
        trimmed.length < MIN_NARRATION_CHARS_PER_PARAGRAPH) &&
      !isStandaloneNarrationPunchLine(trimmed) &&
      combinedNarrationLength(prev, trimmed) <= MAX_NARRATION_CHARS_PER_PARAGRAPH
    ) {
      out[out.length - 1] = `${prev} ${trimmed}`;
      continue;
    }

    out.push(trimmed);
  }

  return out;
}

const NARRATION_SENTENCE_BOUNDARY_RE = /(?<=[.!?…]["'」』)]?)\s+/u;

/** 한 덩어리로 붙은 긴 지문 — 문장 경계에서 분할 (상한 초과 방지) */
function splitOversizedNarrationParagraphs(paragraphs: string[], streaming = false): string[] {
  const out: string[] = [];
  for (const para of paragraphs) {
    const trimmed = para.trim();
    if (!trimmed) continue;
    if (
      classifyNovelParagraph(trimmed, { streaming }) !== "narration" ||
      trimmed.length <= MAX_NARRATION_CHARS_PER_PARAGRAPH
    ) {
      out.push(trimmed);
      continue;
    }

    const sentences = trimmed.split(NARRATION_SENTENCE_BOUNDARY_RE).filter(Boolean);
    if (sentences.length <= 1) {
      out.push(trimmed);
      continue;
    }

    let buf = "";
    for (const sentence of sentences) {
      const candidate = buf ? `${buf} ${sentence}` : sentence;
      if (
        candidate.length > MAX_NARRATION_CHARS_PER_PARAGRAPH &&
        buf.trim()
      ) {
        out.push(buf.trim());
        buf = sentence;
      } else {
        buf = candidate;
      }
    }
    if (buf.trim()) out.push(buf.trim());
  }
  return out;
}

export type GroupNovelParagraphsOpts = { streaming?: boolean };

export function groupNovelParagraphs(content: string, opts?: GroupNovelParagraphsOpts): string[] {
  const streaming = opts?.streaming === true;
  const normalized = collapseBlankLinesInsideDoubleQuotes(content.replace(/\r\n/g, "\n").trim());
  if (!normalized) return [];

  /** 빈 줄(\n\n)만 문단 경계 — 단일 줄바꿈은 같은 문단 안 문장 구분 */
  const blocks = normalized.split(/\n{2,}/).map((b) => b.trim()).filter(Boolean);
  const out: string[] = [];

  for (const block of blocks) {
    const lines: string[] = [];
    for (const line of splitQuoteAwareLines(block)) {
      lines.push(...splitLineByDialogue(line, streaming));
    }
    if (lines.length === 0) continue;
    out.push(...mergeConsecutiveNarrationLines(lines, streaming));
  }

  if (out.length === 0) return [normalized];
  let paragraphs = mergeAdjacentDialogueParagraphs(out);
  paragraphs = explodeMixedParagraphs(paragraphs, streaming);
  paragraphs = mergeAdjacentShortNarrationParagraphs(paragraphs, streaming);
  paragraphs = splitOversizedNarrationParagraphs(paragraphs, streaming);
  return paragraphs.map((p) => stripLeadingPauseEllipsisFromDialogue(p.trim())).filter(Boolean);
}

/** 지문+대사가 한 문단에 붙은 경우 → 지문 / 대사 각각 분리 */
function explodeMixedParagraphs(paragraphs: string[], streaming = false): string[] {
  const out: string[] = [];
  for (const para of paragraphs) {
    const trimmed = para.trim();
    if (!trimmed) continue;
    if (classifyNovelParagraph(trimmed, { streaming }) !== "mixed") {
      out.push(trimmed);
      continue;
    }
    out.push(
      ...mergeConsecutiveNarrationLines(
        splitQuoteAwareLines(trimmed).flatMap((l) => splitLineByDialogue(l, streaming)),
        streaming
      )
    );
  }
  return out;
}

/** 웹소설 pause 표기 — ...·──만 허용, ...... 금지 */
export const PROSE_PAUSE_DASH = "──";

/** ... / ── 앞뒤 공백 정리 */
function normalizePauseSpacing(text: string): string {
  return text
    .replace(/(\S)\s*\.\.\.\s*(?=\S)/g, "$1 ... ")
    .replace(/^\s*\.\.\.\s*(?=\S)/, "... ")
    .replace(/(\S)\s*\.\.\.\s*$/g, "$1 ...")
    .replace(/(\S)\s*──\s*(?=\S)/g, `$1 ${PROSE_PAUSE_DASH} `)
    .replace(/^\s*──\s*(?=\S)/, `${PROSE_PAUSE_DASH} `)
    .replace(/(\S)\s*──\s*$/g, `$1 ${PROSE_PAUSE_DASH}`);
}

/** ... 사용 가능 · ...... 금지(→...) · 유니코드 …→... · ── 정규화 */
export function normalizePauseMarksInText(text: string): string {
  let out = text.replace(/\.{6,}/g, "...");
  out = out.replace(/\.{4,5}/g, "...");
  out = out.replace(/…+/g, "...");
  out = out.replace(/\s*─{2,}\s*/g, ` ${PROSE_PAUSE_DASH} `);
  out = normalizePauseSpacing(out);
  return out.replace(/\s{2,}/g, " ").trim();
}

/** @deprecated normalizePauseMarksInText */
export function replaceEllipsisWithPauseDash(text: string, _maxPerBeat = 1): string {
  return normalizePauseMarksInText(text);
}

/** 대사 본문 pause 정리 */
export function stripEllipsisFromDialogueBody(body: string): string {
  return normalizePauseMarksInText(body.trim());
}

/** 대사 맨 앞·본문 pause 정리 */
export function stripLeadingPauseEllipsisFromDialogue(text: string): string {
  return text.replace(DIALOGUE_PAIR_RE, (match) => {
    const u = unwrapDialogueQuote(match);
    if (!u) return match;
    const body = stripEllipsisFromDialogueBody(u.body);
    return `${u.open}${body}${u.close}`;
  });
}

/** "대사1""대사2"처럼 붙은 연속 따옴표 분리 */
export function splitStuckAdjacentDialogues(text: string): string {
  let out = text;
  for (let i = 0; i < 8; i++) {
    const next = out
      .replace(/"([^"\n]*?)""([^"\n]*?)"/g, '"$1"\n\n"$2"')
      .replace(/\u201D\s*\u201C/g, "\u201D\n\n\u201C");
    if (next === out) break;
    out = next;
  }
  return out;
}

function unwrapDialogueQuote(text: string): { open: string; body: string; close: string } | null {
  const t = text.trim();
  const pairs: [string, string][] = [
    ['"', '"'],
    ["\u201C", "\u201D"],
  ];
  for (const [open, close] of pairs) {
    if (t.startsWith(open) && t.endsWith(close) && t.length >= open.length + close.length) {
      return { open, body: t.slice(open.length, -close.length), close };
    }
  }
  return null;
}

/** 따옴표로만 감싼 연기·요약 라벨(~~척 등) — 실제 발화 아님 */
export function isMisclassifiedDialogueQuote(body: string): boolean {
  const b = body.trim();
  if (!b || b.length > 60) return false;
  if (/(?:\.{2,}|…)/.test(b)) return false;
  if (/[?!]/.test(b)) return false;
  if (/[,，]/.test(b) && b.length > 14) return false;
  if (BARE_SPEECH_ENDING_RE.test(b)) return false;
  if (/(?:척|인\s*척|하는\s*척|체|인\s*체|하는\s*체)$/u.test(b)) return true;
  if (b.length <= 28 && NARRATION_DESCRIPTIVE_RE.test(b)) return true;
  if (isNarrationEmphasisLine(b)) return true;
  return false;
}

/** AI가 지문·연기 라벨에 잘못 붙인 " " 제거 */
export function unwrapMisclassifiedDialogueQuotes(text: string): string {
  return text.replace(DIALOGUE_PAIR_RE, (match) => {
    const u = unwrapDialogueQuote(match);
    if (!u) return match;
    if (isMisclassifiedDialogueQuote(u.body)) return u.body.trim();
    return match;
  });
}

/** 말줄임 정리 — ......→..., …→... */
export function collapseEllipsisSpam(text: string): string {
  const normalizeChunk = (chunk: string): string => normalizePauseMarksInText(chunk);

  const lines = text.split("\n");
  const out: string[] = [];
  let prevEllipsisOnly = false;

  for (const line of lines) {
    const trimmed = line.trim();
    const ellipsisOnly = /^[….\s]+$/.test(trimmed) && /[….]/.test(trimmed);
    if (ellipsisOnly) {
      if (prevEllipsisOnly) continue;
      prevEllipsisOnly = true;
      out.push("...");
      continue;
    }
    prevEllipsisOnly = false;

    if (HAS_DIALOGUE_QUOTE_RE.test(trimmed)) {
      out.push(
        stripLeadingPauseEllipsisFromDialogue(
          trimmed.replace(DIALOGUE_PAIR_RE, (match) => {
            const u = unwrapDialogueQuote(match);
            if (!u) return normalizeChunk(match);
            return `${u.open}${stripEllipsisFromDialogueBody(u.body)}${u.close}`;
          })
        )
      );
    } else {
      out.push(trimmed.split(/(?<=[.!?])\s+/).map(normalizeChunk).join(" "));
    }
  }

  return out.join("\n");
}

/** 열린 " / \u201C 대사 span 안의 줄바꿈 → 공백 (문단 분할 전) */
export function collapseBlankLinesInsideDoubleQuotes(text: string): string {
  const closeFor: Record<string, string> = { '"': '"', "\u201C": "\u201D" };
  let out = "";
  let i = 0;
  let inside = false;
  let closeChar = '"';

  while (i < text.length) {
    const ch = text[i]!;
    if (!inside && OPEN_DIALOGUE_QUOTE_CHARS.has(ch)) {
      inside = true;
      closeChar = closeFor[ch] ?? ch;
      out += ch;
      i++;
      continue;
    }
    if (inside && ch === closeChar) {
      inside = false;
      out += ch;
      i++;
      continue;
    }
    if (inside && (ch === "\n" || ch === "\r")) {
      let j = i;
      while (j < text.length && (text[j] === "\n" || text[j] === "\r")) j++;
      out += " ";
      i = j;
      continue;
    }
    out += ch;
    i++;
  }
  return out;
}

/** 줄바꿈으로 끊긴 간접 인용 — 렌이\\n"…"\\n고 말한 → 렌이 '…'고 말한 */
export function mergeMultilineIndirectSpeechQuotes(text: string): string {
  const lines = text.replace(/\r\n/g, "\n").split("\n");
  const out: string[] = [];
  let i = 0;

  while (i < lines.length) {
    while (i < lines.length && !lines[i]?.trim()) i++;
    if (i >= lines.length) break;

    const prefix = lines[i]!.trim();

    if (!QUOTED_ONLY_LINE_RE.test(prefix)) {
      let j = i + 1;
      while (j < lines.length && !lines[j]?.trim()) j++;
      if (j < lines.length) {
        const quoteLine = lines[j]!.trim();
        const qm = quoteLine.match(QUOTED_ONLY_LINE_RE);
        if (qm) {
          let k = j + 1;
          while (k < lines.length && !lines[k]?.trim()) k++;
          if (k < lines.length) {
            const after = lines[k]!.trim();
            if (INLINE_NARRATED_QUOTE_AFTER_RE.test(after)) {
              const inner = (qm[1] ?? qm[2] ?? "").trim();
              out.push(`${prefix} '${inner}'${after}`);
              i = k + 1;
              continue;
            }
          }
        }
      }
    } else {
      const qm = prefix.match(QUOTED_ONLY_LINE_RE);
      let k = i + 1;
      while (k < lines.length && !lines[k]?.trim()) k++;
      if (qm && k < lines.length) {
        const after = lines[k]!.trim();
        if (INLINE_NARRATED_QUOTE_AFTER_RE.test(after)) {
          const inner = (qm[1] ?? qm[2] ?? "").trim();
          out.push(`'${inner}'${after}`);
          i = k + 1;
          continue;
        }
      }
    }

    out.push(prefix);
    i++;
  }

  return out.join("\n");
}

/** 저장·표시 직전 — 잘못된 대사 따옴표 제거 + 말줄임표 정리 + 지문 문단 정리 */
export function normalizeAiNovelProseLayout(text: string, _opts?: { allowHtml?: boolean }): string {
  let body = text.trimEnd();
  body = splitStuckAdjacentDialogues(body);
  body = unwrapMisclassifiedDialogueQuotes(body);
  body = mergeMultilineIndirectSpeechQuotes(body);
  body = collapseEllipsisSpam(body);
  body = fixCommonJapaneseLeaksInKoreanProse(body);
  body = collapseBlankLinesInsideDoubleQuotes(body);
  body = groupNovelParagraphs(body).join("\n\n").trim();
  return body;
}

/** "…" 안 줄바꿈 → 공백 — 한 대사 한 줄 */
export function collapseDialogueInternalLineBreaks(text: string): string {
  return text.replace(DIALOGUE_PAIR_RE, (match) => {
    const u = unwrapDialogueQuote(match);
    if (!u) return match.replace(/\s*\n+\s*/g, " ");
    const body = u.body.replace(/\s*\n+\s*/g, " ").replace(/\s{2,}/g, " ").trim();
    return `${u.open}${body}${u.close}`;
  });
}

function joinDialogueParagraphs(prev: string, next: string): string {
  const a = unwrapDialogueQuote(prev);
  const b = unwrapDialogueQuote(next);
  if (a && b && a.open === b.open && a.close === b.close) {
    const body = [a.body, b.body]
      .map((x) => x.replace(/\s*\n+\s*/g, " ").trim())
      .filter(Boolean)
      .join(" ");
    return `${a.open}${body}${a.close}`;
  }
  return collapseDialogueInternalLineBreaks(`${prev} ${next}`);
}

function mergeAdjacentDialogueParagraphs(paragraphs: string[]): string[] {
  const out: string[] = [];
  for (const para of paragraphs) {
    const collapsed = collapseDialogueInternalLineBreaks(para);
    const prev = out[out.length - 1];
    if (
      prev &&
      classifyNovelParagraph(prev) === "dialogue" &&
      classifyNovelParagraph(collapsed) === "dialogue"
    ) {
      out[out.length - 1] = joinDialogueParagraphs(prev, collapsed);
    } else {
      out.push(collapsed);
    }
  }
  return out;
}

/** 지문↔대사 전환 시 여백 강화 (em — 채팅 글자 크기에 비례) */
export function novelParagraphSpacingClass(
  kind: NovelParagraphKind,
  prevKind: NovelParagraphKind | null,
  mode: "ai" | "author" = "ai"
): string {
  if (prevKind == null) return "";
  const crossesDialogue =
    (prevKind === "narration" && (kind === "dialogue" || kind === "mixed")) ||
    (prevKind === "dialogue" && kind === "narration") ||
    (prevKind === "mixed" && kind === "narration") ||
    (prevKind === "narration" && kind === "dialogue");

  if (mode === "author") {
    return crossesDialogue ? "mt-[1.75em]" : "mt-[1.25em]";
  }
  return crossesDialogue ? "mt-[1.5em]" : "mt-[1em]";
}
