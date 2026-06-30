import type { ChatMsg, TokenUsage } from "@/lib/ai";
import { callBackgroundMemory, estimateTokens } from "@/lib/ai";
import { visibleAssistantDisplayCharCount } from "@/lib/chatDisplayLength";
import {
  extractFencedHtmlBlock,
  responseHasHtmlVisualCard,
  splitChatRichBlocks,
} from "@/lib/chatRichContent";
import { loadChatRelationshipMeta } from "@/lib/memory/memory-relationship-meta";
import {
  buildHtmlStatusWindowCardInnerHtml,
  buildHtmlStatusWindowCardFromFields,
  enforceHtmlStatusWindowFieldLabels,
  extractStatusFieldPairsFromHtml,
  isGenericHtmlStatusWindowInner,
  isPlaceholderStatusFieldContent,
  isPreservableOocHtmlInner,
  ensureOocHtmlSectionSpacing,
  isOocCreativeHtmlRichEnough,
  oocFlashHtmlMustBeRejected,
  enforceOocAppearanceSectionFromSettingInner,
  OOC_APPEARANCE_SERVER_PLACEHOLDER,
  buildOocCategoryCardReferenceTemplate,
  parseOocBracketCategories,
  parseOocCardTitle,
  oocRequestsCategoryCard,
  oocRequestsDetailedContent,
  userRequestsBroadRpContext,
  userRequestsConversationHistoryReference,
  userRequestsLongTermMemoryReference,
  combineFlashLongTermMemoryBody,
  OOC_DETAILED_MIN_PLAIN_CHARS,
  resolveOocMinPlainChars,
  visiblePlainFromHtmlInner,
  oocRequestsAnonymousInbox,
  polishHtmlVisualCardInner,
  resolveHtmlFlashPlacement,
  stripPromotedHtmlVisualCardContent,
  type HtmlFlashPlacement,
  type HtmlVisualCardPolicy,
} from "@/lib/htmlVisualCardPolicy";
import { stripAllStatusWindowOutputArtifacts } from "@/lib/statusMeta/stripArtifacts";
import {
  sanitizeVisualAppearance,
  type VisualAppearancePolicy,
} from "@/lib/visualAnchor";
import { ABSOLUTE_MAX_RESPONSE_CHARS, clampTextToCharCap } from "@/lib/responseLength";

/** 본문 ↔ 상태창(HTML) 사이 빈 줄 2줄 이상 */
export const STATUS_WINDOW_BODY_GAP = "\n\n\n";
const PROSE_HTML_SEPARATOR = STATUS_WINDOW_BODY_GAP;
/** HTML visual card 생성 — RP 후 2차 Flash (prose baseline 있음) */
const FLASH_ASSISTANT_PROSE_MAX = 12_000;
const FLASH_CHARACTER_SETTING_MAX = 8_000;
const FLASH_MEMORY_MAX = 5_000;
const FLASH_LOREBOOK_MAX = 4_000;
const FLASH_PREVIOUS_HTML_MAX = 3_000;
/** RP 후 2차 HTML — 최근 raw 대화 (토큰) */
export const HTML_FLASH_RECENT_HISTORY_MAX_TOKENS = 3_000;
/** OOC·HTML 전용 턴 — 조립 목표·API hard cap (system+userBlock) */
export const HTML_OOC_FLASH_INPUT_TARGET_TOKENS = 20_000;
export const HTML_ONLY_TURN_MAX_INPUT_TOKENS = 24_000;
/** OOC HTML — 섹션별 char/token 상한 (추구미·카테고리 카드 등) */
export const OOC_FLASH_RECENT_HISTORY_MAX_TOKENS = 8_000;
const OOC_FLASH_CHARACTER_SETTING_MAX = 6_000;
const OOC_FLASH_MEMORY_MAX = 8_000;
const OOC_FLASH_LOREBOOK_MAX = 1_800;
const OOC_FLASH_USER_NOTE_MAX = 2_500;
const OOC_FLASH_USER_PERSONA_MAX = 900;
const OOC_FLASH_MEMORY_HINTS_ONLY_MAX = 1_200;
/** RP 후 2차 HTML — 출력 상한 (메인 prose cap 보호) */
export const HTML_FLASH_MAX_OUTPUT_TOKENS = 6000;
/** HTML 요청 전용 턴 — 출력 상한 (실제 출력량으로 과금) */
export const HTML_ONLY_TURN_MAX_OUTPUT_TOKENS = 8_000;
/** 영수증·UI 표시명 (실제 API: DeepSeek V3) */
export const HTML_ONLY_MODEL_LABEL = "HTML전용모델";

/** Flash ```html 부착 시 RP prose cap에서 뺄 최소·최대 예약 */
export const HTML_FLASH_OUTPUT_RESERVE_MIN_CHARS = 900;
export const HTML_FLASH_OUTPUT_RESERVE_MAX_CHARS = 1800;

/** standing·턴 트리거 HTML — fallback 템플릿 크기 기준 예약량 */
export function resolveHtmlFlashOutputReserveChars(statusFieldLabels: string[] = []): number {
  const fallbackLen = buildFallbackHtmlVisualCard(statusFieldLabels).length;
  return Math.min(
    HTML_FLASH_OUTPUT_RESERVE_MAX_CHARS,
    Math.max(HTML_FLASH_OUTPUT_RESERVE_MIN_CHARS, fallbackLen)
  );
}

/** API/Flash 실패 시 — 유저노트 필드가 있을 때만 최소 ```html 카드 (기본 3필드 없음) */
export function buildFallbackHtmlVisualCard(statusFieldLabels: string[]): string {
  if (statusFieldLabels.length === 0) return "";
  const html = buildHtmlStatusWindowCardInnerHtml(statusFieldLabels, "—");
  return `\`\`\`html\n${html.trim()}\n\`\`\``;
}

/** ```html 펜스·중첩 펜스 제거 — inner HTML만 */
export function unwrapHtmlVisualCardInner(htmlBlock: string): string {
  let inner = htmlBlock.trim();
  for (let i = 0; i < 4 && /^```html/i.test(inner); i++) {
    inner = inner.replace(/^```html\s*/i, "").trim();
    inner = inner.replace(/```[\s\S]*$/, "").trim();
  }
  return inner.replace(/```\s*$/, "").trim();
}

export function wrapHtmlVisualCardInner(innerHtml: string): string {
  const inner = unwrapHtmlVisualCardInner(innerHtml);
  if (!inner) return "";
  return `\`\`\`html\n${inner}\n\`\`\``;
}

/** Flash·clamp — 닫힌 div 구조인지 (중간 잘림 방지) */
export function isCompleteHtmlStatusCardInner(inner: string): boolean {
  const t = inner.trim();
  if (!t || t.length < 80) return false;
  if (!/<div\b/i.test(t)) return false;
  const opens = (t.match(/<div\b/gi) ?? []).length;
  const closes = (t.match(/<\/div>/gi) ?? []).length;
  return opens >= 1 && closes >= opens;
}

/** OOC 커스텀 HTML — div 균형 없어도 사용 가능한 최소 품질 */
export function isUsableOocCreativeHtmlInner(inner: string): boolean {
  const t = inner.trim();
  if (t.length < 180) return false;
  return /<(?:div|section|main|article|ul|ol)\b/i.test(t);
}

function isAcceptedOocCreativeHtmlInner(inner: string, oocUserMessage = ""): boolean {
  if (oocFlashHtmlMustBeRejected(inner)) return false;
  if (oocUserMessage.trim()) {
    return isOocCreativeHtmlRichEnough(inner, oocUserMessage);
  }
  return isUsableOocCreativeHtmlInner(inner) || isPreservableOocHtmlInner(inner);
}

/** 불완전·중첩 펜스 HTML → compact 재조립 또는 fallback */
export function ensureHtmlVisualCardBlock(
  htmlBlock: string,
  fallbackStatusLabels: string[] = [],
  budget = ABSOLUTE_MAX_RESPONSE_CHARS,
  opts?: { skipGenericFallback?: boolean; oocUserMessage?: string }
): string {
  const skipGenericFallback = opts?.skipGenericFallback === true;
  const oocUserMessage = opts?.oocUserMessage ?? "";
  let polishedInner = polishHtmlVisualCardInner(unwrapHtmlVisualCardInner(htmlBlock));
  if (skipGenericFallback && oocUserMessage.trim()) {
    polishedInner = ensureOocHtmlSectionSpacing(polishedInner, oocUserMessage);
  }
  const normalized = wrapHtmlVisualCardInner(polishedInner);
  const inner = unwrapHtmlVisualCardInner(normalized);
  if (skipGenericFallback && oocFlashHtmlMustBeRejected(inner)) {
    console.warn("[html-flash] ensureHtmlVisualCardBlock — rejected OOC-invalid status template");
    return "";
  }
  if (skipGenericFallback && oocUserMessage.trim() && !isOocCreativeHtmlRichEnough(inner, oocUserMessage)) {
    console.warn("[html-flash] ensureHtmlVisualCardBlock — rejected thin OOC HTML (header-only / insufficient Q&A)", {
      innerChars: inner.length,
    });
    return "";
  }
  if (isCompleteHtmlStatusCardInner(inner)) {
    if (fallbackStatusLabels.length > 0) {
      const enforced = enforceHtmlStatusWindowFieldLabels(normalized, fallbackStatusLabels);
      if (enforced) return enforced;
    }
    return normalized;
  }

  if (skipGenericFallback && isAcceptedOocCreativeHtmlInner(inner, oocUserMessage)) {
    console.warn("[html-flash] OOC creative HTML — accepting partial card", {
      originalChars: htmlBlock.length,
      innerChars: inner.length,
    });
    return normalized;
  }

  if (skipGenericFallback) {
    console.warn("[html-flash] OOC creative HTML incomplete — no compact rebuild", {
      originalChars: htmlBlock.length,
    });
    return inner ? normalized : "";
  }

  const rebuilt =
    rebuildCompactHtmlBlock(htmlBlock, budget, fallbackStatusLabels) ??
    rebuildCompactHtmlBlock(normalized, budget, fallbackStatusLabels);
  if (rebuilt && isCompleteHtmlStatusCardInner(unwrapHtmlVisualCardInner(rebuilt))) {
    console.warn("[html-flash] incomplete HTML — rebuilt compact card", {
      originalChars: htmlBlock.length,
      rebuiltChars: rebuilt.length,
    });
    return rebuilt;
  }

  const fallback = buildFallbackHtmlVisualCard(
    fallbackStatusLabels.length > 0 ? fallbackStatusLabels : []
  );
  if (!fallback) {
    console.warn("[html-flash] incomplete HTML — no fallback (status field labels empty)");
    return inner ? normalized : "";
  }
  console.warn("[html-flash] incomplete HTML — using fallback template", {
    originalChars: htmlBlock.length,
    fallbackChars: fallback.length,
  });
  return fitHtmlBlockToBudget(fallback, budget, fallbackStatusLabels);
}

export function extractProseWithoutHtml(text: string): string {
  return splitChatRichBlocks(text)
    .filter((b) => b.kind === "novel")
    .map((b) => b.text)
    .join("\n\n")
    .trim();
}

function proseCandidateFromRaw(raw: string): string {
  const trimmed = raw.trim();
  if (!trimmed) return "";
  const stripped = stripAllStatusWindowOutputArtifacts(trimmed).trim();
  const novel = extractProseWithoutHtml(stripped);
  if (novel) return novel;
  if (responseHasHtmlVisualCard(stripped)) return "";
  return stripped;
}

/**
 * HTML Flash 부착용 RP baseline — savedText가 status strip으로 비면 stream-visible prose 사용.
 * 유저가 스트림에서 본 본문이 HTML-only replace로 사라지는 것 방지.
 */
export function resolveProseBaselineForHtmlFlash(opts: {
  savedText: string;
  streamVisible?: string;
}): string {
  const fromSaved = proseCandidateFromRaw(opts.savedText);
  const fromStream = proseCandidateFromRaw(opts.streamVisible ?? "");
  const candidates = [fromSaved, fromStream].filter((t) => t.length > 0);
  if (candidates.length === 0) return "";
  return candidates.reduce((best, cur) =>
    visibleAssistantDisplayCharCount(cur) >= visibleAssistantDisplayCharCount(best) ? cur : best
  );
}

/** cap 초과 Flash HTML — 필드 내용 유지하며 compact 템플릿으로 재조립 */
function rebuildCompactHtmlBlock(
  htmlBlock: string,
  budget: number,
  orderedLabels: string[] = []
): string | null {
  const pairs = extractStatusFieldPairsFromHtml(htmlBlock);
  if (pairs.length === 0) return null;

  const contentByLabel = new Map<string, string>();
  for (const { label, content } of pairs) {
    if (!isPlaceholderStatusFieldContent(content)) {
      contentByLabel.set(label.trim().toLowerCase(), content);
    }
  }

  const labels = orderedLabels.length > 0 ? orderedLabels : pairs.map((p) => p.label);
  let fields = labels.map((label) => {
    const key = label.trim().toLowerCase();
    const fromPair = pairs.find((p) => p.label.trim().toLowerCase() === key);
    const content =
      contentByLabel.get(key) ??
      (fromPair && !isPlaceholderStatusFieldContent(fromPair.content) ? fromPair.content : "—");
    return { label, content };
  });

  const hasRealContent = fields.some((f) => !isPlaceholderStatusFieldContent(f.content));
  if (!hasRealContent) return null;

  const toFence = (card: string) => `\`\`\`html\n${card.trim()}\n\`\`\``;
  let card = buildHtmlStatusWindowCardFromFields(fields);
  let fenced = toFence(card);
  if (fenced.length <= budget) return fenced;

  for (let round = 0; round < 24 && fenced.length > budget; round++) {
    const excess = fenced.length - budget;
    const trimPerField = Math.ceil(excess / Math.max(fields.length, 1)) + 6;
    let changed = false;
    fields = fields.map((f) => {
      if (f.content.length <= 10) return f;
      changed = true;
      const nextLen = Math.max(10, f.content.length - trimPerField);
      const trimmed = f.content.slice(0, nextLen).trim();
      return { ...f, content: trimmed.endsWith("…") ? trimmed : `${trimmed}…` };
    });
    if (!changed) break;
    card = buildHtmlStatusWindowCardFromFields(fields);
    fenced = toFence(card);
  }

  return fenced.length <= budget ? fenced : null;
}

/** cap 초과 시 Flash HTML fallback·축소 — HTML 출력 공간 우선 */
function fitHtmlBlockToBudget(
  htmlBlock: string,
  budget: number,
  fallbackStatusLabels: string[] = [],
  opts?: { skipCompactRebuild?: boolean }
): string {
  const html = htmlBlock.trim();
  if (budget <= 0) return "";
  if (html.length <= budget) {
    return wrapHtmlVisualCardInner(unwrapHtmlVisualCardInner(html));
  }

  if (opts?.skipCompactRebuild) {
    console.info("[html-flash] OOC HTML over budget — keeping structure (no compact rebuild)", {
      originalChars: html.length,
      budget,
    });
    return wrapHtmlVisualCardInner(unwrapHtmlVisualCardInner(html));
  }

  const compact = rebuildCompactHtmlBlock(html, budget, fallbackStatusLabels);
  if (compact) {
    console.info("[html-flash] oversized HTML — rebuilt compact card with extracted field content", {
      originalChars: html.length,
      rebuiltChars: compact.length,
      budget,
      fields: fallbackStatusLabels.length || extractStatusFieldPairsFromHtml(html).length,
    });
    return compact;
  }

  // 라벨 기반 fallback 시도
  const labeledFallback = buildFallbackHtmlVisualCard(fallbackStatusLabels);
  if (labeledFallback.length <= budget) {
    console.warn("[html-flash] oversized HTML — using labeled fallback", {
      originalChars: html.length,
      budget,
    });
    return labeledFallback;
  }
  // compact 3-field fallback 시도
  const compactFallback = buildFallbackHtmlVisualCard([]);
  if (compactFallback.length <= budget) {
    console.warn("[html-flash] oversized HTML — using compact 3-field fallback", {
      originalChars: html.length,
      labeledFallbackChars: labeledFallback.length,
      budget,
    });
    return compactFallback;
  }
  console.warn("[html-flash] HTML exceeds budget — using minimal 3-field fallback without mid-tag slice", {
    originalChars: html.length,
    compactFallbackChars: compactFallback.length,
    budget,
  });
  return compactFallback;
}

/** HTML block이 cap에서 차지할 수 있는 최대 비율 — 산문 최소 600자 확보 */
const MIN_PROSE_BUDGET_CHARS = 600;

function mergeProseAndHtmlWithinCap(opts: {
  prose: string;
  html: string;
  cap: number;
  order: "html-first" | "prose-first";
  fallbackStatusLabels?: string[];
  skipCompactRebuild?: boolean;
}): string {
  const trimmedProse = opts.prose.trim();
  const html = opts.html.trim();
  const labels = opts.fallbackStatusLabels ?? [];
  const fitOpts = opts.skipCompactRebuild ? { skipCompactRebuild: true } : undefined;

  if (!html) return clampTextToCharCap(trimmedProse, opts.cap);
  if (!trimmedProse) {
    return fitHtmlBlockToBudget(html, opts.cap, labels, fitOpts);
  }

  const combined =
    opts.order === "html-first"
      ? `${html}${PROSE_HTML_SEPARATOR}${trimmedProse}`
      : `${trimmedProse}${PROSE_HTML_SEPARATOR}${html}`;
  if (combined.length <= opts.cap) return combined;

  const sepLen = PROSE_HTML_SEPARATOR.length;
  // HTML이 산문을 600자 미만으로 압축하지 못하도록 HTML 최대 예산 제한
  const maxHtmlBudget = Math.max(0, opts.cap - MIN_PROSE_BUDGET_CHARS - sepLen);
  const fittedHtml = fitHtmlBlockToBudget(html, maxHtmlBudget, labels, fitOpts);
  if (!fittedHtml) return clampTextToCharCap(trimmedProse, opts.cap);

  const proseBudget = opts.cap - fittedHtml.length - sepLen;
  if (proseBudget <= 0) {
    return fitHtmlBlockToBudget(html, opts.cap, labels, fitOpts);
  }

  const prosePart = clampTextToCharCap(trimmedProse, proseBudget);

  return opts.order === "html-first"
    ? `${fittedHtml}${PROSE_HTML_SEPARATOR}${prosePart}`
    : `${prosePart}${PROSE_HTML_SEPARATOR}${fittedHtml}`;
}

/** RP + ```html — 5,000자 상한 (HTML 우선 · RP는 남는 분량) */
export function attachHtmlBlockBeforeProse(
  prose: string,
  htmlBlock: string,
  cap = ABSOLUTE_MAX_RESPONSE_CHARS,
  fallbackStatusLabels: string[] = [],
  opts?: { skipCompactRebuild?: boolean }
): string {
  return mergeProseAndHtmlWithinCap({
    prose,
    html: htmlBlock,
    cap,
    order: "html-first",
    fallbackStatusLabels,
    skipCompactRebuild: opts?.skipCompactRebuild,
  });
}

export function attachHtmlBlockAtPlacement(
  prose: string,
  htmlBlock: string,
  placement: HtmlFlashPlacement,
  cap = ABSOLUTE_MAX_RESPONSE_CHARS,
  fallbackStatusLabels: string[] = [],
  opts?: { skipCompactRebuild?: boolean }
): string {
  return placement === "top"
    ? attachHtmlBlockBeforeProse(prose, htmlBlock, cap, fallbackStatusLabels, opts)
    : attachHtmlBlockWithinCap(prose, htmlBlock, cap, fallbackStatusLabels, opts);
}

/** RP + ```html — 5,000자 상한 (HTML tail 우선 · RP는 남는 분량) */
export function attachHtmlBlockWithinCap(
  prose: string,
  htmlBlock: string,
  cap = ABSOLUTE_MAX_RESPONSE_CHARS,
  fallbackStatusLabels: string[] = [],
  opts?: { skipCompactRebuild?: boolean }
): string {
  return mergeProseAndHtmlWithinCap({
    prose,
    html: htmlBlock,
    cap,
    order: "prose-first",
    fallbackStatusLabels,
    skipCompactRebuild: opts?.skipCompactRebuild,
  });
}

import { stripBrokenHtmlFragmentAtEnd, stripBrokenHtmlTailSafely } from "@/lib/htmlTailStrip";

export { stripBrokenHtmlFragmentAtEnd, stripBrokenHtmlTailSafely } from "@/lib/htmlTailStrip";

/** OOC HTML tail strip — 본문(Q&A)이 사라지면 strip 취소 */
export function stripBrokenHtmlFragmentPreservingOocBody(
  text: string,
  oocUserMessage = ""
): { text: string; stripped: boolean } {
  const result = stripBrokenHtmlFragmentAtEnd(text);
  if (!result.stripped || !oocUserMessage.trim() || !responseHasHtmlVisualCard(text)) {
    return result;
  }
  const richBefore = isOocCreativeHtmlRichEnough(
    unwrapHtmlVisualCardInner(text),
    oocUserMessage
  );
  const richAfter = isOocCreativeHtmlRichEnough(
    unwrapHtmlVisualCardInner(result.text),
    oocUserMessage
  );
  if (richBefore && !richAfter) {
    console.warn("[html-clamp] OOC HTML strip skipped — would remove inbox/message body");
    return { text, stripped: false };
  }
  return result;
}

/** cap 이내 응답 — 재병합 없이 펜스·inner HTML만 정규화 */
function normalizeHtmlVisualCardInFullResponse(text: string, oocUserMessage = ""): string {
  const blocks = splitChatRichBlocks(text);
  const parts: string[] = [];

  for (const block of blocks) {
    if (block.kind === "html") {
      let inner = polishHtmlVisualCardInner(unwrapHtmlVisualCardInner(block.text));
      if (oocUserMessage.trim()) {
        inner = ensureOocHtmlSectionSpacing(inner, oocUserMessage);
      }
      const acceptable = oocUserMessage.trim()
        ? isAcceptedOocCreativeHtmlInner(inner, oocUserMessage)
        : isCompleteHtmlStatusCardInner(inner) ||
          isUsableOocCreativeHtmlInner(inner) ||
          isPreservableOocHtmlInner(inner);
      if (acceptable) {
        parts.push(wrapHtmlVisualCardInner(inner));
      }
      continue;
    }
    if (block.kind === "novel" && block.text.trim()) {
      parts.push(block.text.trim());
    } else if (block.kind === "markdown-table") {
      parts.push(block.text);
    }
  }

  return parts.join(PROSE_HTML_SEPARATOR).trim();
}

/** HTML tail 보존하며 전체 응답을 cap 이내로 */
export function clampFullResponsePreservingHtml(
  text: string,
  cap = ABSOLUTE_MAX_RESPONSE_CHARS,
  oocUserMessage?: string
): string {
  const trimmed = text.trim();
  const oocMsg = oocUserMessage ?? "";
  if (!responseHasHtmlVisualCard(trimmed)) {
    return clampTextToCharCap(trimmed, cap);
  }
  if (trimmed.length <= cap) {
    const normalized = normalizeHtmlVisualCardInFullResponse(trimmed, oocMsg);
    return stripBrokenHtmlFragmentPreservingOocBody(normalized, oocMsg).text;
  }
  const blocks = splitChatRichBlocks(trimmed);
  const htmlBlocks = blocks.filter((b) => b.kind === "html");
  const htmlFence = htmlBlocks
    .map((b) => wrapHtmlVisualCardInner(b.text))
    .filter(Boolean)
    .join(PROSE_HTML_SEPARATOR);
  const prose = extractProseWithoutHtml(trimmed);
  const firstHtmlIdx = blocks.findIndex((b) => b.kind === "html");
  const firstNovelIdx = blocks.findIndex((b) => b.kind === "novel");
  const placement: HtmlFlashPlacement =
    firstHtmlIdx >= 0 && (firstNovelIdx < 0 || firstHtmlIdx < firstNovelIdx) ? "top" : "bottom";
  console.log("[html-clamp] clampFullResponsePreservingHtml", {
    textChars: trimmed.length,
    proseChars: prose.length,
    htmlFenceChars: htmlFence.length,
    placement,
    cap,
  });
  const merged = attachHtmlBlockAtPlacement(prose, htmlFence, placement, cap, [], {
    skipCompactRebuild: Boolean(oocMsg.trim()),
  });
  console.log("[html-clamp] merged", { mergedChars: merged.length });
  return stripBrokenHtmlFragmentPreservingOocBody(merged, oocMsg).text;
}

function clipTail(text: string, max: number): string {
  const t = text.trim();
  if (t.length <= max) return t;
  return t.slice(-max);
}

/** 코어 설정·canonical 블록 — 앞부분(외형·정체성) 보존 */
function clipHead(text: string, max: number): string {
  const t = text.trim();
  if (t.length <= max) return t;
  return t.slice(0, max);
}

function formatPreviousHtmlFromHistory(history: ChatMsg[] | undefined, maxChars: number): string {
  if (!history?.length) return "";
  for (let i = history.length - 1; i >= 0; i--) {
    const msg = history[i]!;
    if (msg.role !== "assistant") continue;
    const htmlBlocks = splitChatRichBlocks(msg.content).filter((b) => b.kind === "html");
    if (htmlBlocks.length === 0) continue;
    return clipTail(htmlBlocks.map((b) => b.text.trim()).join("\n\n"), maxChars);
  }
  return "";
}

function formatRecentHistoryForFlash(
  history: ChatMsg[] | undefined,
  maxTokens: number,
  appearancePolicy?: VisualAppearancePolicy | null
): string {
  if (!history?.length || maxTokens <= 0) return "";

  const linesFromEnd: string[] = [];
  let tokens = 0;

  for (let i = history.length - 1; i >= 0; i--) {
    const msg = history[i]!;
    const line = `[${msg.role}] ${msg.content.trim()}`;
    if (!line.trim()) continue;
    const separator = linesFromEnd.length > 0 ? "\n\n" : "";
    const addTokens = estimateTokens(`${separator}${line}`);
    if (tokens + addTokens > maxTokens && linesFromEnd.length > 0) break;
    linesFromEnd.unshift(line);
    tokens += addTokens;
    if (tokens >= maxTokens) break;
  }

  let result = linesFromEnd.join("\n\n");
  if (appearancePolicy && (appearancePolicy.hair || appearancePolicy.eyes)) {
    result = sanitizeVisualAppearance(result, appearancePolicy);
  }
  return result;
}

function extractCanonicalAppearanceProfileForOoc(canonicalBlock?: string): string | null {
  if (!canonicalBlock?.trim()) return null;
  const m =
    canonicalBlock.match(/\[외형 profile\]\n([\s\S]*?)(?:\n\n\[|$)/) ??
    canonicalBlock.match(/\[외형 lines from setting\]\n([\s\S]*?)(?:\n\n\[|$)/);
  return m?.[1]?.trim().slice(0, 600) ?? null;
}

function buildOocAppearanceCategoryPlaceholders(
  categories: string[]
): Record<string, string> | undefined {
  const wantsAppearance = categories.some((c) =>
    /^(?:외형|외모)$/i.test(c.replace(/\([^)]*\)/g, "").trim())
  );
  if (!wantsAppearance) return undefined;
  return { 외형: OOC_APPEARANCE_SERVER_PLACEHOLDER };
}

function applyOocAppearanceSectionLock(
  block: string | null,
  userMessage: string,
  canonicalBlock?: string
): string | null {
  if (!block) return null;
  const profile = extractCanonicalAppearanceProfileForOoc(canonicalBlock);
  if (!profile) return block;
  const inner = unwrapHtmlVisualCardInner(block);
  const locked = enforceOocAppearanceSectionFromSettingInner(inner, userMessage, profile);
  if (locked === inner) return block;
  return wrapHtmlVisualCardInner(locked);
}

function applyAppearancePolicyToOocHtml(
  block: string,
  policy: VisualAppearancePolicy | null | undefined
): string {
  if (!policy || (!policy.hair && !policy.eyes)) return block;
  const inner = unwrapHtmlVisualCardInner(block);
  const sanitized = sanitizeVisualAppearance(inner, policy);
  if (sanitized === inner) return block;
  return wrapHtmlVisualCardInner(sanitized);
}

function buildFlashHistoryMemoryGuidance(
  userMessage: string,
  historyMaxTokens: number
): string {
  const asksHistory = userRequestsConversationHistoryReference(userMessage);
  const asksMemory = userRequestsLongTermMemoryReference(userMessage);
  if (!asksHistory && !asksMemory) return "";
  const lines = [
    "[HISTORY vs MEMORY]",
    `[RECENT CHAT HISTORY] ≤ ${historyMaxTokens.toLocaleString()} tokens (newest last). Older context → single [LONG-TERM MEMORY] only.`,
  ];
  if (asksHistory && asksMemory) {
    lines.push("Use recent raw + [LONG-TERM MEMORY] once — no duplicate memory blocks.");
  } else if (asksHistory) {
    lines.push("Older turns beyond the cap → [LONG-TERM MEMORY] only.");
  } else if (asksMemory) {
    lines.push("Use [LONG-TERM MEMORY] only for stored recall.");
  }
  return lines.join("\n");
}

export type HtmlFlashContextBudget = {
  inputTargetTokens: number;
  settingMax: number;
  memoryMax: number;
  loreMax: number;
  historyMaxTokens: number;
  userNoteMax: number;
  personaMax: number;
  includeHistory: boolean;
  includeMemory: boolean;
  includeLore: boolean;
  includeUserNote: boolean;
};

/** OOC·HTML 전용 vs RP 후 2차 Flash — 섹션별 상한·포함 여부 */
export function resolveHtmlFlashContextBudget(
  userMessage: string,
  flashMode?: {
    displayUserInputOnly?: boolean;
    oocCreativeBrief?: boolean;
    chatOocExclusive?: boolean;
    htmlOnlyDedicatedTurn?: boolean;
  }
): HtmlFlashContextBudget {
  const oocDedicated =
    flashMode?.htmlOnlyDedicatedTurn === true ||
    flashMode?.oocCreativeBrief === true ||
    flashMode?.chatOocExclusive === true ||
    flashMode?.displayUserInputOnly === true;

  if (!oocDedicated) {
    return {
      inputTargetTokens: 12_000,
      settingMax: FLASH_CHARACTER_SETTING_MAX,
      memoryMax: FLASH_MEMORY_MAX,
      loreMax: FLASH_LOREBOOK_MAX,
      historyMaxTokens: HTML_FLASH_RECENT_HISTORY_MAX_TOKENS,
      userNoteMax: 4_000,
      personaMax: 2_000,
      includeHistory: true,
      includeMemory: true,
      includeLore: true,
      includeUserNote: true,
    };
  }

  const asksHistory = userRequestsConversationHistoryReference(userMessage);
  const asksMemory = userRequestsLongTermMemoryReference(userMessage);
  const asksBroad = userRequestsBroadRpContext(userMessage);

  return {
    inputTargetTokens: HTML_OOC_FLASH_INPUT_TARGET_TOKENS,
    settingMax: OOC_FLASH_CHARACTER_SETTING_MAX,
    memoryMax:
      asksMemory || asksBroad ? OOC_FLASH_MEMORY_MAX : OOC_FLASH_MEMORY_HINTS_ONLY_MAX,
    loreMax: asksBroad ? OOC_FLASH_LOREBOOK_MAX : 0,
    historyMaxTokens: asksHistory
      ? OOC_FLASH_RECENT_HISTORY_MAX_TOKENS
      : asksBroad
        ? 1_500
        : 0,
    userNoteMax: OOC_FLASH_USER_NOTE_MAX,
    personaMax: OOC_FLASH_USER_PERSONA_MAX,
    includeHistory: asksHistory || asksBroad,
    includeMemory: asksMemory || asksBroad,
    includeLore: asksBroad,
    includeUserNote: asksBroad,
  };
}

function flashUsesCreativeStatusDesign(policy: HtmlVisualCardPolicy): boolean {
  return policy.statusFieldLabels.length > 0;
}

function buildHtmlFlashCreativeStatusWindowPrompt(
  policy: HtmlVisualCardPolicy,
  placement: HtmlFlashPlacement
): string {
  const placementHint =
    policy.standing || placement === "bottom"
      ? "Render BELOW RP prose (status window area)"
      : "Render ABOVE RP prose";
  const doodleFieldIdx = policy.statusFieldLabels.findIndex((f) => /낙서|카오모지|이모지/.test(f));
  return `[HTML STATUS WINDOW — CREATIVE DESIGN]
You design a clean, minimal, mobile-friendly HTML status card for this RP turn.
- ${placementHint}.
- One visually distinct section/block per listed field — label text must match [STATUS FIELD LABELS] exactly (same order).
- You MAY choose layout, spacing, soft colors, borders, shadows — keep it simple and readable (light card #fff–#f9fafb, body text #111–#333).
- Do NOT copy a rigid REFERENCE skeleton or a centered "상태창" banner. No HP/MP/SAN/RPG stat bars unless that exact label is listed.
- Output exactly ONE \`\`\`html fenced block. Compact single-line inline CSS.
- Fill each field from scene context (RP prose, memory, setting, history) — no placeholder "(장면에 맞게…)".
${doodleFieldIdx >= 0 ? `- Field ${doodleFieldIdx + 1} (doodle) may include kaomoji/emoji in content only.` : "- No emoji in HTML except doodle field if listed."}
[STATUS FIELD LABELS — one section each, exact label text]
${policy.statusFieldLabels.map((f, i) => `${i + 1}. ${f}`).join("\n")}`;
}

function buildHtmlFlashV3SystemBrief(opts: {
  cardKind: string;
  hasStatusFields: boolean;
}): string {
  const layoutHints = opts.hasStatusFields
    ? "- [STATUS FIELD LABELS]: one labeled box/section per field — exact label text, scene-specific Korean content."
    : `- Layout from [USER MESSAGE] + context:
  · lists / TOP5 / guides → white card, stacked sections
  · messenger / 카톡 / DM / 문자 → chat bubbles (gray bg, left/right)
  · alert / 경고 / warning → red header + body panel
  · document / memo / report → titled sections, readable paragraphs`;

  return `[HTML VISUAL CARD — V3]
You generate ONLY the \`\`\`html visual card for this turn (${opts.cardKind}).
- RP prose is in [ASSISTANT REPLY — prose only]. Do NOT rewrite or continue RP outside the fence.
- Output exactly ONE \`\`\`html fenced block. No text before or after.
${layoutHints}
- Mobile-first: max-width ~550px (messenger ~400px), padding 12–16px, 14–16px body, word-break: keep-all.
- Contrast: body #111–#333 on #fff / #f8f9fa — never similar-luminance text/background pairs.
- No emoji in HTML unless a doodle field in [STATUS FIELD LABELS] explicitly allows it.
- Scene-specific Korean from RP, memory, setting, persona, lore — no "(장면에 맞게…)" placeholders.
- Compact single-line inline CSS. HTML body under 3,200 characters.
- FORBIDDEN unless requested: HP/MP/SAN/RPG bars, generic "상태창" banner, verbatim example skeleton copy.`;
}

/** V3 HTML 2차 호출 system prompt — policy·placement·flashMode 조합 */
export function buildHtmlFlashSystemPrompt(
  policy: HtmlVisualCardPolicy,
  placement: HtmlFlashPlacement,
  flashMode?: {
    displayUserInputOnly?: boolean;
    oocCreativeBrief?: boolean;
    chatOocExclusive?: boolean;
    htmlOnlyDedicatedTurn?: boolean;
  }
): string {
  const htmlOnlyOutput =
    flashMode?.htmlOnlyDedicatedTurn === true || flashMode?.displayUserInputOnly === true;
  const htmlOutputBudget = htmlOnlyOutput
    ? HTML_ONLY_TURN_MAX_OUTPUT_TOKENS
    : HTML_FLASH_MAX_OUTPUT_TOKENS;
  const oocCustomHtml =
    flashMode?.oocCreativeBrief === true || flashMode?.chatOocExclusive === true;

  if (flashMode?.displayUserInputOnly === true) {
    return `[HTML 전용 출력]
You generate ONLY a \`\`\`html visual card for this turn. The main RP model was NOT used.
- [USER MESSAGE — this turn] is the primary layout and content spec — implement exactly what the user asks for in HTML.
- Ground content in [LONG-TERM MEMORY], [USER NOTE], [USER PERSONA], [CHARACTER & WORLD SETTING], [ACTIVE LORE / LOREBOOK], and [RECENT CHAT HISTORY] when the user references them.
- [RECENT CHAT HISTORY] is at most ${HTML_FLASH_RECENT_HISTORY_MAX_TOKENS.toLocaleString()} tokens — older/accumulated context comes from the single [LONG-TERM MEMORY] section (once), not more raw turns.
- Do NOT invent RP narration outside the \`\`\`html block.
- Output exactly ONE \`\`\`html fenced block. No text before or after the fence.
- HTML output budget: up to ${htmlOutputBudget.toLocaleString()} output tokens — use as much as needed within that cap (not a character target).
- Input context may include up to ${HTML_OOC_FLASH_INPUT_TARGET_TOKENS.toLocaleString()} tokens of memory, persona, setting, lore, and history — use what you need.
- Dark body text (#111–#333) on light backgrounds; mobile-responsive (max-width, padding, readable font-size).
- Korean preferred when the scene is Korean. Never leave requested sections empty — infer accurately from provided context.`;
  }

  if (oocCustomHtml) {
    return `[OOC CREATIVE HTML — HTML 전용]
The user's OOC in [USER MESSAGE — this turn] is the ONLY layout/content spec — NOT user-note standing status window, NOT REFERENCE card templates.
- Main RP prose is intentionally empty. Do NOT add scene narration outside the \`\`\`html block.
- Implement the exact UI/layout/content the OOC describes (e.g. anonymous message inbox / 트위터·X 네임드 계정 익명 메시지함 mockup referencing real anonymous-message-site UX).
- Use [LONG-TERM MEMORY], [USER NOTE], [USER PERSONA], [CHARACTER & WORLD SETTING], [ACTIVE LORE / LOREBOOK], and [RECENT CHAT HISTORY] as grounding when the OOC asks to reference them.
- [RECENT CHAT HISTORY] ≤ ${OOC_FLASH_RECENT_HISTORY_MAX_TOKENS.toLocaleString()} tokens when provided (recent raw only). Older/accumulated context → single [LONG-TERM MEMORY] (never duplicate).
- If OOC says HTML without code fences — output raw HTML inside ONE \`\`\`html fence anyway (server requirement; chat renders it as formatted HTML).
- When OOC lists bracketed categories (e.g. [외형 · 키워드 · …]), copy the [REFERENCE] skeleton from the user block — one \`<section>\` per category with visible gaps. Never cram all fields into one paragraph.
- «외형» / appearance section body is filled server-side from character setting — use the REFERENCE placeholder; focus creative detail on other categories.
- When OOC asks for detail (자세히, 상세, 풍부): minimum **${OOC_DETAILED_MIN_PLAIN_CHARS} characters** of visible Korean text in the HTML (tags excluded); minimum 5 full-sentence bullet lines per category **except «외형»** — concrete scene examples, not one-line keywords.
- Default OOC card style: white rounded card, soft section boxes, indigo category labels — simple and pretty (see REFERENCE in user block when present).
- When OOC asks for readability (가독성, 줄바꿈, 항목 구분), stack list items as separate \`<p>\` lines inside each section.
- Dark body text (#111–#333) on light backgrounds; mobile-responsive (max-width, padding, readable font-size).
- Honor quantitative OOC requirements (e.g. "5+ questions and answers" means at least five of each, detailed and comic).
- Structure: brief account header (handle, bio) then **separate message-list body** — NEVER stop after the bio.
- FORBIDDEN — instant rejection: "상태창" banner; field boxes labeled 현재 상황 / 속마음 / 다음 행동; em-dash "—" placeholder fields; REFERENCE template copy; profile-only output with no messages.
- NEVER reuse RP status-window field slots — build the OOC UI (message threads, cards, inbox rows, Q&A blocks).
- User note / persona may appear only as lore context — never as the output format when OOC specifies a different UI.
- Output exactly ONE \`\`\`html fenced block. No text before or after the fence.
- HTML output budget: up to ${htmlOutputBudget.toLocaleString()} tokens. Write rich, scene-specific Korean content.`;
  }

  const cardKind = policy.standing
    ? "status window UI — appears BELOW RP prose (no card title banner)"
    : placement === "top"
      ? "visual card — appears ABOVE RP prose in the UI"
      : "visual card — appears BELOW RP prose in the UI";

  if (flashUsesCreativeStatusDesign(policy)) {
    return `${buildHtmlFlashCreativeStatusWindowPrompt(policy, placement)}

[HTML GENERATION]
You generate ONLY the \`\`\`html visual card for this turn (${cardKind}).
- RP prose is already complete in [ASSISTANT REPLY — prose only]. Do NOT rewrite or continue RP.
- Output exactly ONE \`\`\`html fenced block. No text before or after the fence.
- Total HTML body must stay under 3,200 characters so RP prose is not truncated.
- Never contradict provided context. Korean preferred when the scene is Korean.`;
  }

  const statusFieldRules =
    policy.standing && policy.statusFieldLabels.length > 0
      ? `
- Status window: output ONLY the ${policy.statusFieldLabels.length} field(s) in [STATUS FIELD LABELS] — one labeled box each, same order, same label text.
- FORBIDDEN unless that exact label is in the list: HP, MP, SAN, 호감도, 가이딩, 유동스탯, {{char}} name header, pipe-separated RPG stat bars, extra fields.`
      : policy.standing
        ? `
- Status window: use field-box template only — no HP/RPG stat bar. Do not invent stat slots.`
        : "";

  return `${buildHtmlFlashV3SystemBrief({
    cardKind,
    hasStatusFields: policy.statusFieldLabels.length > 0,
  })}${statusFieldRules ? `\n${statusFieldRules.trim()}` : ""}`;
}

export type HtmlVisualCardFlashContext = {
  chatId: number;
  charName: string;
  personaName: string;
  userMessage: string;
  assistantProse: string;
  userNote?: string;
  userPersona?: string;
  characterSetting?: string;
  /** 설정 [외형] 원문 — OOC «외형» 서버 lock 전용 (Flash 프롬프트 미주입) */
  canonicalAppearanceBlock?: string;
  appearanceSanitizePolicy?: VisualAppearancePolicy | null;
  memoryBlock?: string;
  archiveMemory?: string;
  recentHistory?: ChatMsg[];
  loreBlock?: string;
};

/** Flash user block — statusMeta extract와 동일하게 장기기억·히스토리·설정 주입 */
export function buildHtmlVisualCardFlashUserBlock(
  ctx: HtmlVisualCardFlashContext,
  policy?: Pick<HtmlVisualCardPolicy, "standing" | "statusFieldLabels">,
  placement?: HtmlFlashPlacement,
  flashMode?: {
    displayUserInputOnly?: boolean;
    oocCreativeBrief?: boolean;
    chatOocExclusive?: boolean;
    htmlOnlyDedicatedTurn?: boolean;
    /** HTML 전용 — 30k 입력 토큰 fit 시 섹션 char 상한 스케일 (0–1) */
    htmlContextCharScale?: number;
  }
): string {
  const displayUserInputOnly = flashMode?.displayUserInputOnly === true;
  const oocCreativeBrief = flashMode?.oocCreativeBrief === true;
  const chatOocExclusive = flashMode?.chatOocExclusive === true;
  const budget = resolveHtmlFlashContextBudget(ctx.userMessage, flashMode);
  const contextScale =
    flashMode?.htmlContextCharScale != null
      ? Math.min(1, Math.max(0.2, flashMode.htmlContextCharScale))
      : 1;
  const scaleCap = (n: number) =>
    contextScale < 1 ? Math.max(200, Math.floor(n * contextScale)) : n;
  const settingMax = scaleCap(budget.settingMax);
  const memoryMax = scaleCap(budget.memoryMax);
  const loreMax = scaleCap(budget.loreMax);
  const historyMaxTokens = Math.max(
    0,
    Math.floor(budget.historyMaxTokens * contextScale)
  );
  const userNoteMax = scaleCap(budget.userNoteMax);
  const personaMax = scaleCap(budget.personaMax);
  const rel = loadChatRelationshipMeta(ctx.chatId);
  const memoryHints = [
    rel.thoughts?.length ? `NPC thoughts (memory): ${rel.thoughts.slice(-5).join(" · ")}` : "",
    rel.items?.length ? `Items: ${rel.items.slice(-5).join(" · ")}` : "",
    rel.promises?.length
      ? `Promises: ${rel.promises
          .slice(-3)
          .map((p) => p.text)
          .join(" · ")}`
      : "",
    rel.honorifics?.length ? `Honorifics: ${rel.honorifics.slice(-3).join(" · ")}` : "",
  ]
    .filter(Boolean)
    .join("\n");

  const memoryCombined = combineFlashLongTermMemoryBody(ctx.memoryBlock, ctx.archiveMemory);
  const recentHistoryBlock =
    budget.includeHistory && historyMaxTokens > 0
      ? formatRecentHistoryForFlash(
          ctx.recentHistory,
          historyMaxTokens,
          ctx.appearanceSanitizePolicy
        )
      : "";
  const previousHtml =
    !chatOocExclusive && !oocCreativeBrief
      ? formatPreviousHtmlFromHistory(ctx.recentHistory, FLASH_PREVIOUS_HTML_MAX)
      : "";
  const userNoteRaw = ctx.userNote?.trim() ?? "";
  const userNoteForFlash =
    chatOocExclusive && userNoteRaw
      ? stripPromotedHtmlVisualCardContent(userNoteRaw)
      : userNoteRaw;
  const userNoteClipped =
    budget.includeUserNote && userNoteForFlash
      ? clipTail(userNoteForFlash, userNoteMax)
      : "";
  const userPersonaClipped = ctx.userPersona?.trim()
    ? clipTail(ctx.userPersona.trim(), personaMax)
    : "";
  const statusFields =
    oocCreativeBrief || chatOocExclusive ? [] : (policy?.statusFieldLabels?.filter(Boolean) ?? []);
  const oocCategories =
    oocCreativeBrief || chatOocExclusive ? parseOocBracketCategories(ctx.userMessage) : [];

  return [
    chatOocExclusive
      ? `[CHAT OOC EXCLUSIVE — HIGHEST PRIORITY]
User note standing status window, extra HTML cards, and markdown status directives are SUSPENDED this turn.
Execute ONLY the chat OOC in [USER MESSAGE — this turn]. Do NOT append user-note status window or generic template fields.
Use memory/setting/history only as lore context to fill what the OOC asks for.`
      : "",
    !chatOocExclusive && policy?.standing != null
      ? `[HTML POLICY]\n${policy.standing ? "Standing status window — every turn" : "Turn-trigger HTML — this turn only"}`
      : "",
    placement
      ? `[UI PLACEMENT]\n${placement === "top" ? "Render ABOVE RP prose" : "Render BELOW RP prose (status window area)"}`
      : "",
    statusFields.length > 0
      ? `[STATUS FIELD LABELS — ONLY these labels; one box per field; no extra stats]
${statusFields.map((l, i) => `${i + 1}. ${l}`).join("\n")}`
      : "",
    oocCategories.length >= 2
      ? `[OOC CATEGORY CARD — REQUIRED LAYOUT]
Use the REFERENCE template below EXACTLY for structure (outer card + one <section> per category). Replace placeholder body text only — keep spacing, borders, and section breaks.
Categories (one section each, bold label + body, never one run-on paragraph):
${oocCategories.map((l, i) => `${i + 1}. ${l.replace(/\([^)]*\)/g, "").trim()}`).join("\n")}
End with "최종 결론" section if OOC asks for it.
${
  oocRequestsDetailedContent(ctx.userMessage)
    ? `[OOC DETAIL — REQUIRED]
User asked for rich/detailed content. **Target ≥${OOC_DETAILED_MIN_PLAIN_CHARS} visible Korean characters** in the HTML (excluding tags).
Each category section except «외형»: at least 5 full-sentence bullet lines (concrete, comic, scene-specific — NOT keyword lists).`
    : ""
}

[REFERENCE — copy this HTML skeleton]
\`\`\`html
${buildOocCategoryCardReferenceTemplate(
  oocCategories,
  {
    title: parseOocCardTitle(ctx.userMessage),
    categoryPlaceholders: buildOocAppearanceCategoryPlaceholders(oocCategories),
  }
)}
\`\`\``
      : oocRequestsCategoryCard(ctx.userMessage)
        ? `[OOC CATEGORY CARD — style]
Use clean card layout: white rounded container, one soft-gradient section per category, indigo labels, 12px+ gap between sections.`
        : "",
    !chatOocExclusive && previousHtml
      ? `[PREVIOUS TURN HTML CARD — style & continuity reference]\n${previousHtml}`
      : "",
    ctx.characterSetting?.trim()
      ? `[CHARACTER CANON — FLASH CONTEXT]\n${clipHead(ctx.characterSetting.trim(), settingMax)}`
      : "",
    buildFlashHistoryMemoryGuidance(ctx.userMessage, historyMaxTokens),
    userPersonaClipped ? `[USER PERSONA]\n${userPersonaClipped}` : "",
    budget.includeMemory && memoryCombined
      ? `[LONG-TERM MEMORY]\n${clipTail(memoryCombined, memoryMax)}`
      : memoryHints
        ? `[MEMORY HINTS]\n${clipTail(
            memoryHints,
            budget.includeMemory ? 800 : OOC_FLASH_MEMORY_HINTS_ONLY_MAX
          )}`
        : "",
    userNoteClipped
      ? chatOocExclusive
        ? `[USER NOTE — lore/world context ONLY; ignore status-window & HTML display format lines; OOC UI spec wins]\n${userNoteClipped}`
        : `[USER NOTE — reference RAG]\n${userNoteClipped}`
      : "",
    budget.includeLore && ctx.loreBlock?.trim()
      ? `[ACTIVE LORE / LOREBOOK — contextual RAG]\n${clipTail(ctx.loreBlock.trim(), loreMax)}`
      : "",
    `[CHARACTER] ${ctx.charName}`,
    `[USER PERSONA NAME] ${ctx.personaName}`,
    recentHistoryBlock ? `[RECENT CHAT HISTORY]\n${recentHistoryBlock}` : "",
    `[USER MESSAGE — this turn]\n${ctx.userMessage.trim()}`,
    displayUserInputOnly
      ? `[DISPLAY ONLY — NO RP]
The user asked for HTML-only output — no new RP prose.
Follow [USER MESSAGE — this turn] as the layout and content spec. Use [LONG-TERM MEMORY], [USER NOTE], [USER PERSONA], [CHARACTER & WORLD SETTING], and [ACTIVE LORE / LOREBOOK] when the user asks to reference them.
Do NOT invent scene narration or dialogue beyond what the user message and provided context support.`
      : oocCreativeBrief
        ? `[OOC CREATIVE BRIEF — this turn]
Read [USER MESSAGE — this turn] OOC instructions carefully. Use RECENT CHAT, MEMORY, CHARACTER SETTING, and PREVIOUS HTML (if any) only as context to fill the OOC-requested UI and messages.
Do NOT output the generic status-window field template unless the OOC explicitly asks for it.
Do NOT write RP prose outside the HTML card.`
        : `[ASSISTANT REPLY — prose only]\n${ctx.assistantProse.trim().slice(0, FLASH_ASSISTANT_PROSE_MAX)}`,
    `[TASK]
Generate the \`\`\`html visual card for this turn per policy above.
${
  displayUserInputOnly
    ? "DISPLAY-ONLY turn — source content is [USER MESSAGE — this turn]; ASSISTANT RP is intentionally empty."
    : oocCreativeBrief
      ? "OOC CREATIVE turn — follow [USER MESSAGE — this turn] OOC layout and content requirements exactly; ignore default status-field slots unless OOC lists them."
      : "Use RECENT CHAT, MEMORY, CHARACTER SETTING, PREVIOUS HTML (if any), and ASSISTANT REPLY to fill each field accurately."
}
${statusFields.length > 0 ? `Include exactly ${statusFields.length} field box(es) matching [STATUS FIELD LABELS] — same labels, same order. No HP/RPG bar, no undeclared fields.` : oocCreativeBrief ? "Build the full custom UI described in OOC — rich, detailed, scene-specific Korean content." : "Use the status-window field-box template — no HP/RPG stat bar."}
Match Korean tone when the scene is Korean. Never leave listed fields empty — infer from context.`,
  ]
    .filter(Boolean)
    .join("\n\n");
}

function oocFlashBlockAccepted(block: string | null, userMessage: string): boolean {
  if (!block) return false;
  const inner = unwrapHtmlVisualCardInner(block);
  if (oocFlashHtmlMustBeRejected(inner)) return false;
  if (!isOocCreativeHtmlRichEnough(inner, userMessage)) return false;
  return true;
}

function normalizeHtmlFlashOutput(
  raw: string,
  oocCustomHtml = false,
  userMessage = ""
): string | null {
  const trimmed = raw.trim();
  if (!trimmed) return null;
  const inner = polishHtmlVisualCardInner(
    unwrapHtmlVisualCardInner(extractFencedHtmlBlock(trimmed) ?? trimmed)
  );
  if (!inner) return null;
  if (oocCustomHtml) {
    if (oocFlashHtmlMustBeRejected(inner)) {
      console.warn("[html-flash] rejected OOC-invalid HTML (status-window template or placeholder fields)");
      return null;
    }
    const spaced = userMessage.trim()
      ? ensureOocHtmlSectionSpacing(inner, userMessage)
      : inner;
    if (isAcceptedOocCreativeHtmlInner(spaced, userMessage)) {
      return wrapHtmlVisualCardInner(spaced);
    }
    return null;
  }
  if (isCompleteHtmlStatusCardInner(inner)) {
    return wrapHtmlVisualCardInner(inner);
  }
  return null;
}

export type GenerateHtmlVisualCardOpts = HtmlVisualCardFlashContext & {
  policy: HtmlVisualCardPolicy;
  placement?: HtmlFlashPlacement;
  /** RP 생략 — [USER MESSAGE] 내용만 HTML로 표시 */
  displayUserInputOnly?: boolean;
  /** OOC 커스텀 HTML 연출 — 상태창 템플릿 대신 OOC 지시 따름 */
  oocCreativeBrief?: boolean;
  /** 채팅 OOC rp_unrelated — 유저노트 상태창/HTML 무시 */
  chatOocExclusive?: boolean;
  /** HTML 전용 턴 — 메인 RP 미호출, 30k 입력 컨텍스트·6k 출력 */
  htmlOnlyDedicatedTurn?: boolean;
};

export type HtmlVisualCardFlashGenerateResult = {
  html: string | null;
  usage: TokenUsage | null;
  /** system+userBlock 조립 추정 — API usage 없을 때 영수증·과금 fallback */
  promptEstimateTokens: number;
  /** Flash API/품질 거부 — html null 시 원인 */
  flashError?: string | null;
};

function flashGenerateResult(
  html: string | null,
  usage: TokenUsage | null,
  promptEstimateTokens: number,
  flashError?: string | null
): HtmlVisualCardFlashGenerateResult {
  return { html, usage, promptEstimateTokens, flashError: flashError ?? null };
}

function buildOocCreativeFlashRetryBlock(
  userMessage: string,
  attempt: 1 | 2,
  plainChars?: number
): string {
  const minChars = resolveOocMinPlainChars(userMessage);
  const detailed = oocRequestsDetailedContent(userMessage);
  const category = oocRequestsCategoryCard(userMessage);
  const cats = parseOocBracketCategories(userMessage);
  const reason =
    plainChars != null
      ? `TOO SHORT (${plainChars} visible chars; need ≥${minChars})`
      : "REJECTED";

  if (category) {
    const catList =
      cats.length > 0
        ? cats.map((c, i) => `${i + 1}. ${c.replace(/\([^)]*\)/g, "").trim()}`).join("\n")
        : "(see bracket list in [USER MESSAGE])";
    return `[${attempt === 2 ? "FINAL " : ""}RETRY — ${reason}]
Previous output failed quality check. User OOC requests a **category card** (추구미 / bracket sections).
Rebuild per [REFERENCE]: one <section> per category with visible spacing:
${catList}
${detailed ? `- EACH section except «외형»: ≥5 full-sentence Korean bullet lines with concrete examples — NOT one-line keywords.` : "- Each section except «외형»: substantive multi-line content, not keyword stubs."}
- **Total visible text ≥${minChars} characters** (HTML tags excluded).
- Include «최종 결론» section if OOC asks.
- FORBIDDEN: RP status-window fields, "—" placeholders, single run-on paragraph.`;
  }

  if (oocRequestsAnonymousInbox(userMessage)) {
    if (attempt === 2) {
      return `[FINAL RETRY — ${reason}]
Build a Twitter/X-style **anonymous message inbox** UI:
- Part 1: account header (name, handle, short bio) — brief only.
- Part 2: **main content** — at least 5 anonymous fan messages AND 5 admin/account replies, each several sentences, comic and detailed Korean.
- Total visible text ≥${minChars} characters.
- Single-line inline CSS; dark text (#111–#333); mobile-friendly.
- NO status-window field boxes. NO "—" placeholders.`;
    }
    return `[RETRY — ${reason}]
You returned generic status fields, empty placeholders, OR a profile/header ONLY without the message list body.
Build the FULL anonymous inbox UI: profile header PLUS at least 5 detailed fan questions AND 5 detailed answers (comic Korean).
Do NOT stop after the account bio.`;
  }

  return `[RETRY — ${reason}]
Expand OOC HTML — minimum ${minChars} visible Korean characters. Follow [USER MESSAGE] layout; add scene-specific detail.`;
}

/** DeepSeek V3 — HTML visual card 생성 (상태창 meta extract와 동일 패턴) */
export async function generateHtmlVisualCardWithFlash(
  opts: GenerateHtmlVisualCardOpts
): Promise<HtmlVisualCardFlashGenerateResult> {
  const prose = opts.assistantProse.trim();
  if (!opts.policy.enabled) return flashGenerateResult(null, null, 0);
  const flashEmptyProseOk =
    opts.displayUserInputOnly === true ||
    opts.oocCreativeBrief === true ||
    opts.chatOocExclusive === true ||
    opts.htmlOnlyDedicatedTurn === true;
  if (!prose && !flashEmptyProseOk) return flashGenerateResult(null, null, 0);

  const placement: HtmlFlashPlacement =
    opts.placement ??
    resolveHtmlFlashPlacement(opts.policy, {
      userMessage: opts.userMessage,
      userNote: opts.userNote,
      userPersona: opts.userPersona,
      characterSetting: opts.characterSetting,
    });
  const flashMode = {
    displayUserInputOnly: opts.displayUserInputOnly,
    oocCreativeBrief: opts.oocCreativeBrief,
    chatOocExclusive: opts.chatOocExclusive,
    htmlOnlyDedicatedTurn: opts.htmlOnlyDedicatedTurn,
  };
  const system = buildHtmlFlashSystemPrompt(opts.policy, placement, flashMode);
  const oocCustomHtml = opts.oocCreativeBrief === true || opts.chatOocExclusive === true;
  let userBlock = buildHtmlVisualCardFlashUserBlock(
    opts,
    oocCustomHtml ? { standing: false, statusFieldLabels: [] } : opts.policy,
    placement,
    flashMode
  );

  if (opts.htmlOnlyDedicatedTurn || oocCustomHtml) {
    const budget = resolveHtmlFlashContextBudget(opts.userMessage, flashMode);
    const inputBudget = budget.inputTargetTokens;
    let scale = 1;
    while (estimateTokens(`${system}\n${userBlock}`) > inputBudget && scale > 0.25) {
      scale *= 0.88;
      userBlock = buildHtmlVisualCardFlashUserBlock(
        opts,
        oocCustomHtml ? { standing: false, statusFieldLabels: [] } : opts.policy,
        placement,
        { ...flashMode, htmlContextCharScale: scale }
      );
    }
  }

  if (!userBlock.trim()) {
    console.error("[html-flash] empty user block after assembly", { chatId: opts.chatId });
    return flashGenerateResult(
      null,
      null,
      estimateTokens(`${system}\n${userBlock}`),
      "HTML flash user block empty"
    );
  }

  const promptEstimateTokens = estimateTokens(`${system}\n${userBlock}`);

  console.log("[html-visual-card] generating ```html visual card", {
    chatId: opts.chatId,
    proseChars: prose.length,
    userBlockChars: userBlock.length,
    promptEstimateTokens,
    standing: opts.policy.standing,
    placement,
    statusFields: opts.oocCreativeBrief || opts.chatOocExclusive ? 0 : opts.policy.statusFieldLabels.length,
    displayUserInputOnly: opts.displayUserInputOnly === true,
    oocCreativeBrief: opts.oocCreativeBrief === true,
    chatOocExclusive: opts.chatOocExclusive === true,
    hasMemory: Boolean(opts.memoryBlock?.trim() || opts.archiveMemory?.trim()),
    recentTurns: opts.recentHistory?.length ?? 0,
  });

  let lastFlashError: string | null = null;

  try {
    const maxTokens =
      opts.htmlOnlyDedicatedTurn || opts.displayUserInputOnly
        ? HTML_ONLY_TURN_MAX_OUTPUT_TOKENS
        : HTML_FLASH_MAX_OUTPUT_TOKENS;

    const callFlash = async (systemPrompt: string) => {
      try {
        return await callBackgroundMemory(
          systemPrompt,
          [{ role: "user", content: userBlock }],
          undefined,
          "background-html-visual-card",
          { maxTokens }
        );
      } catch (e) {
        lastFlashError = (e as Error).message ?? String(e);
        throw e;
      }
    };

    const first = await callFlash(system);
    let accumulatedFlashUsage: TokenUsage = first.usage;
    let text = first.text;
    const mergeUsage = (next: TokenUsage) => {
      accumulatedFlashUsage = {
        ...accumulatedFlashUsage,
        inputTokens: accumulatedFlashUsage.inputTokens + next.inputTokens,
        outputTokens: accumulatedFlashUsage.outputTokens + next.outputTokens,
        estimated: accumulatedFlashUsage.estimated || next.estimated,
      };
    };
    let block = normalizeHtmlFlashOutput(text, oocCustomHtml, opts.userMessage);
    if (oocCustomHtml && block && !oocFlashBlockAccepted(block, opts.userMessage)) block = null;

    if (oocCustomHtml && !block) {
      const plainChars = text.trim()
        ? visiblePlainFromHtmlInner(
            polishHtmlVisualCardInner(unwrapHtmlVisualCardInner(extractFencedHtmlBlock(text) ?? text))
          ).length
        : 0;
      console.warn("[html-flash] OOC output rejected or empty — retrying with correction", {
        chatId: opts.chatId,
        preview: text.slice(0, 120),
        plainChars,
      });
      const retrySystem = `${system}\n\n${buildOocCreativeFlashRetryBlock(
        opts.userMessage,
        1,
        plainChars > 0 ? plainChars : undefined
      )}`;
      const second = await callFlash(retrySystem);
      mergeUsage(second.usage);
      text = second.text;
      block = normalizeHtmlFlashOutput(text, oocCustomHtml, opts.userMessage);
      if (block && !oocFlashBlockAccepted(block, opts.userMessage)) block = null;
    }

    if (oocCustomHtml && !block) {
      const plainChars = text.trim()
        ? visiblePlainFromHtmlInner(
            polishHtmlVisualCardInner(unwrapHtmlVisualCardInner(extractFencedHtmlBlock(text) ?? text))
          ).length
        : 0;
      console.warn("[html-flash] OOC 2nd reject — final retry", {
        chatId: opts.chatId,
        preview: text.slice(0, 120),
        plainChars,
      });
      const thirdSystem = `${system}\n\n${buildOocCreativeFlashRetryBlock(
        opts.userMessage,
        2,
        plainChars > 0 ? plainChars : undefined
      )}`;
      const third = await callFlash(thirdSystem);
      mergeUsage(third.usage);
      text = third.text;
      block = normalizeHtmlFlashOutput(text, oocCustomHtml, opts.userMessage);
      if (block && !oocFlashBlockAccepted(block, opts.userMessage)) block = null;
    }

    if (oocCustomHtml && !block && text.trim()) {
      const inner = polishHtmlVisualCardInner(
        unwrapHtmlVisualCardInner(extractFencedHtmlBlock(text) ?? text)
      );
      if (isPreservableOocHtmlInner(inner, opts.userMessage)) {
        console.warn("[html-flash] OOC salvaged preservable partial HTML", {
          chatId: opts.chatId,
          innerChars: inner.length,
        });
        block = wrapHtmlVisualCardInner(inner);
        block = applyOocAppearanceSectionLock(
          block,
          opts.userMessage,
          opts.canonicalAppearanceBlock
        );
      }
    }

    console.log("[html-flash] API usage", {
      chatId: opts.chatId,
      inputTokens: accumulatedFlashUsage.inputTokens,
      outputTokens: accumulatedFlashUsage.outputTokens,
      estimated: accumulatedFlashUsage.estimated,
    });

    if (block) {
      if (oocCustomHtml) {
        const locked = applyOocAppearanceSectionLock(
          block,
          opts.userMessage,
          opts.canonicalAppearanceBlock
        );
        if (!locked) {
          block = null;
        } else {
          block = applyAppearancePolicyToOocHtml(locked, opts.appearanceSanitizePolicy);
          if (!oocFlashBlockAccepted(block, opts.userMessage)) {
            console.warn("[html-flash] OOC block failed final acceptance — discarding", {
              chatId: opts.chatId,
            });
            block = null;
          } else {
            return flashGenerateResult(block, accumulatedFlashUsage, promptEstimateTokens);
          }
        }
      }
      if (block && opts.policy.statusFieldLabels.length > 0) {
        const enforced = enforceHtmlStatusWindowFieldLabels(
          block,
          opts.policy.statusFieldLabels
        );
        if (enforced) return flashGenerateResult(enforced, accumulatedFlashUsage, promptEstimateTokens);
      }
      return flashGenerateResult(block, accumulatedFlashUsage, promptEstimateTokens);
    }

    if (!oocCustomHtml) {
    const partialRebuild = rebuildCompactHtmlBlock(
      text,
      HTML_FLASH_OUTPUT_RESERVE_MAX_CHARS,
      opts.policy.statusFieldLabels
    );
    if (
      partialRebuild &&
      isCompleteHtmlStatusCardInner(unwrapHtmlVisualCardInner(partialRebuild))
    ) {
      console.warn("[html-flash] Flash returned incomplete HTML — rebuilt from partial fields");
      if (opts.policy.statusFieldLabels.length > 0) {
        const enforced = enforceHtmlStatusWindowFieldLabels(
          partialRebuild,
          opts.policy.statusFieldLabels
        );
        if (enforced) return flashGenerateResult(enforced, accumulatedFlashUsage, promptEstimateTokens);
      }
      return flashGenerateResult(partialRebuild, accumulatedFlashUsage, promptEstimateTokens);
    }
    }

    console.warn("[html-flash] Flash returned no usable HTML", {
      preview: text.slice(0, 120),
    });
    if (oocCustomHtml) {
      return flashGenerateResult(
        null,
        accumulatedFlashUsage,
        promptEstimateTokens,
        lastFlashError ?? "no usable HTML after quality checks"
      );
    }
  } catch (e) {
    lastFlashError = (e as Error).message ?? String(e);
    console.error("[html-flash] Flash call failed", lastFlashError);
  }

  if (opts.chatOocExclusive || opts.oocCreativeBrief) {
    return flashGenerateResult(null, null, promptEstimateTokens, lastFlashError);
  }
  const fallback = buildFallbackHtmlVisualCard(opts.policy.statusFieldLabels);
  return flashGenerateResult(fallback || null, null, promptEstimateTokens);
}
