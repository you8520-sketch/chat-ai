/**
 * Deterministic Muse source-style fingerprint.
 * Structural metrics only — no personality/semantic labels.
 * Owner: last visible canonical assistant RAW that enters the next prompt.
 * Does not use UI paragraph-display transforms.
 */
import { getCanonicalProseBody } from "@/lib/canonicalProse";
import { extractQuoteBlocks } from "@/lib/dialogueMetrics";
import { stripEmotionTagsForDisplay } from "@/lib/emotionTag";
import {
  stripInternalTagLeakage,
  stripModelXmlLeakage,
  stripRpMetaPreamble,
} from "@/lib/narrativeRules";
import { stripStatusWidgetFromAssistantProse } from "@/lib/statusWidget/proseStrip";
import { isCheaperInferenceMuseSpark12Model } from "@/lib/chatModels";

export const MUSE_SOURCE_STYLE_FINGERPRINT_HEADER =
  "[MUSE SOURCE STYLE FINGERPRINT — OBSERVED / SOFT]";

export const MUSE_SOURCE_STYLE_FINGERPRINT_MAX_CHARS = 500;

export const MUSE_FINGERPRINT_FORBIDDEN_LABELS = [
  "능글맞음",
  "냉정함",
  "다정함",
  "집착",
  "야성적",
  "서정적",
  "에로틱",
  "장난스러움",
] as const;

export const LIKE_SPECIFIC_V1_PHRASES = [
  "미세한 환경음과 거리감",
  "얇은 농담",
  "능글맞음",
  "어색하게 비치는 진심",
  "장난스러운 반응",
] as const;

const NONCANONICAL_OOC_RE = /\[NONCANONICAL OOC SCENE\]/i;
const TOOL_BLOCK_RE = /<(?:tool_call|tool|function_call)\b[\s\S]*?<\/(?:tool_call|tool|function_call)>/gi;
const THINK_BLOCK_RE = /<(?:think|thinking|reason(?:ing)?)>[\s\S]*?<\/(?:think|thinking|reason(?:ing)?)>/gi;
const FENCED_META_RE = /```(?:html|json|xml|javascript|ts|tool)[\s\S]*?```/gi;
const SYSTEM_LINE_RE = /^(?:\[(?:System|SYSTEM|내부 지침)[^\]]*\]|<System\b.*)$/gm;

export type MuseFingerprintConfidence = "HIGH" | "MEDIUM" | "LOW";

export type MuseSourceStyleMetrics = {
  source_visible_chars: number;
  sentence_char_median: number;
  sentence_char_p75: number;
  paragraph_char_median: number;
  paragraph_char_p75: number;
  paragraphs_per_1000_chars: number;
  one_sentence_paragraph_share: number;
  dialogue_char_share: number;
  dialogue_blocks_per_1000_chars: number;
  usable_prose_paragraphs: number;
  dialogue_blocks: number;
};

export type MuseSourceStyleFingerprint = {
  confidence: MuseFingerprintConfidence;
  metrics: MuseSourceStyleMetrics | null;
  block: string | null;
  canonicalRaw: string;
};

export type MuseStyleDistance = {
  overall: number;
  features: Record<string, number>;
};

const METRIC_KEYS = [
  "sentence_char_median",
  "sentence_char_p75",
  "paragraph_char_median",
  "paragraph_char_p75",
  "paragraphs_per_1000_chars",
  "one_sentence_paragraph_share",
  "dialogue_char_share",
  "dialogue_blocks_per_1000_chars",
] as const;

function assertNever(value: never): never {
  throw new Error(`unexpected fingerprint confidence: ${String(value)}`);
}

export function isNoncanonicalOocAssistantRaw(raw: string): boolean {
  return NONCANONICAL_OOC_RE.test(raw);
}

export function canonicalizeLastVisibleAssistantRaw(raw: string): string {
  if (!raw.trim()) return "";
  if (isNoncanonicalOocAssistantRaw(raw)) return "";
  let text = getCanonicalProseBody(raw);
  text = stripStatusWidgetFromAssistantProse(text);
  text = stripInternalTagLeakage(text);
  text = stripRpMetaPreamble(text);
  text = stripModelXmlLeakage(text);
  text = stripEmotionTagsForDisplay(text);
  text = text.replace(FENCED_META_RE, "");
  text = text.replace(TOOL_BLOCK_RE, "");
  text = text.replace(THINK_BLOCK_RE, "");
  text = text.replace(SYSTEM_LINE_RE, "");
  return text.replace(/\n{3,}/g, "\n\n").trim();
}

export function splitCanonicalParagraphs(text: string): string[] {
  return text
    .split(/\n\s*\n/)
    .map((p) => p.trim())
    .filter(Boolean);
}

export function usableProseParagraphs(text: string): string[] {
  return splitCanonicalParagraphs(text).filter((p) => p.replace(/\s+/g, "").length >= 8);
}

function protectEllipsis(text: string): string {
  return text.replace(/\.{3,}/g, "\u2026").replace(/…+/g, "\u2026");
}

export function splitCanonicalSentences(text: string): string[] {
  const protectedText = protectEllipsis(text.replace(/\s+/g, " ").trim());
  if (!protectedText) return [];
  return protectedText
    .split(/(?<=[.!?。！？])\s*/)
    .map((s) => s.replace(/\u2026/g, "...").trim())
    .filter((s) => s.replace(/\s+/g, "").length > 0);
}

function percentile(sorted: number[], p: number): number {
  if (sorted.length === 0) return 0;
  if (sorted.length === 1) return sorted[0]!;
  const idx = (sorted.length - 1) * p;
  const lo = Math.floor(idx);
  const hi = Math.ceil(idx);
  const a = sorted[lo]!;
  const b = sorted[hi]!;
  return a + (b - a) * (idx - lo);
}

function median(values: number[]): number {
  return percentile([...values].sort((a, b) => a - b), 0.5);
}

function p75(values: number[]): number {
  return percentile([...values].sort((a, b) => a - b), 0.75);
}

function round1(n: number): number {
  return Number(n.toFixed(1));
}

function roundInt(n: number): number {
  return Math.round(n);
}

export function extractFingerprintDialogueSpans(text: string): string[] {
  return extractQuoteBlocks(text);
}

export function computeMuseSourceStyleMetrics(canonicalRaw: string): MuseSourceStyleMetrics {
  const visible = canonicalRaw.length;
  const paragraphs = usableProseParagraphs(canonicalRaw);
  const allParagraphs = splitCanonicalParagraphs(canonicalRaw);
  const paraLens = paragraphs.map((p) => p.length);
  const sentences = paragraphs.flatMap((p) => splitCanonicalSentences(p));
  const sentLens = sentences.map((s) => s.length);
  const oneSentence = paragraphs.filter((p) => splitCanonicalSentences(p).length === 1).length;
  const dialogueSpans = extractFingerprintDialogueSpans(canonicalRaw);
  const dialogueChars = dialogueSpans.reduce((sum, s) => sum + s.length, 0);
  const per1000 = visible > 0 ? visible / 1000 : 0;
  return {
    source_visible_chars: visible,
    sentence_char_median: sentLens.length ? roundInt(median(sentLens)) : 0,
    sentence_char_p75: sentLens.length ? roundInt(p75(sentLens)) : 0,
    paragraph_char_median: paraLens.length ? roundInt(median(paraLens)) : 0,
    paragraph_char_p75: paraLens.length ? roundInt(p75(paraLens)) : 0,
    paragraphs_per_1000_chars:
      per1000 > 0 ? round1(allParagraphs.length / per1000) : 0,
    one_sentence_paragraph_share:
      paragraphs.length > 0 ? Number((oneSentence / paragraphs.length).toFixed(4)) : 0,
    dialogue_char_share: visible > 0 ? Number((dialogueChars / visible).toFixed(4)) : 0,
    dialogue_blocks_per_1000_chars:
      per1000 > 0 ? round1(dialogueSpans.length / per1000) : 0,
    usable_prose_paragraphs: paragraphs.length,
    dialogue_blocks: dialogueSpans.length,
  };
}

export function resolveMuseFingerprintConfidence(
  metrics: MuseSourceStyleMetrics
): MuseFingerprintConfidence {
  if (metrics.source_visible_chars >= 2000 && metrics.usable_prose_paragraphs >= 8) {
    return "HIGH";
  }
  if (metrics.source_visible_chars >= 1000) return "MEDIUM";
  return "LOW";
}

function pct(share: number): number {
  return Math.round(share * 100);
}

export function renderMuseSourceStyleFingerprint(metrics: MuseSourceStyleMetrics): string {
  const block = [
    MUSE_SOURCE_STYLE_FINGERPRINT_HEADER,
    "직전 canonical assistant에서 관찰된 구조:",
    `문장 중앙값 ${metrics.sentence_char_median}자 · p75 ${metrics.sentence_char_p75}자`,
    `문단 중앙값 ${metrics.paragraph_char_median}자 · p75 ${metrics.paragraph_char_p75}자`,
    `1000자당 문단 ${metrics.paragraphs_per_1000_chars}`,
    `1문장 문단 ${pct(metrics.one_sentence_paragraph_share)}%`,
    `대사 글자 비중 ${pct(metrics.dialogue_char_share)}%`,
    `1000자당 대사 블록 ${metrics.dialogue_blocks_per_1000_chars}`,
    "이 값은 할당량이 아니라 직전 출력의 실제 분포다. 문구를 복사하거나 수치를 출력하지 말고, 장면 전체에서 비슷한 구조적 호흡을 자연스럽게 유지한다.",
    "이 블록은 내부 관찰이며 사용자에게 보이지 않는 지침이다. fingerprint 수치·헤더·내부 용어를 본문에 출력하지 않는다.",
  ].join("\n");
  if (block.length > MUSE_SOURCE_STYLE_FINGERPRINT_MAX_CHARS) {
    return block.slice(0, MUSE_SOURCE_STYLE_FINGERPRINT_MAX_CHARS).trimEnd();
  }
  for (const phrase of LIKE_SPECIFIC_V1_PHRASES) {
    if (block.includes(phrase)) throw new Error(`LIKE_SPECIFIC_IN_FINGERPRINT:${phrase}`);
  }
  for (const label of MUSE_FINGERPRINT_FORBIDDEN_LABELS) {
    if (block.includes(label)) throw new Error(`SEMANTIC_LABEL_IN_FINGERPRINT:${label}`);
  }
  return block;
}

export function buildMuseSourceStyleFingerprint(
  lastVisibleCanonicalAssistantRaw: string
): MuseSourceStyleFingerprint {
  const canonicalRaw = canonicalizeLastVisibleAssistantRaw(lastVisibleCanonicalAssistantRaw);
  if (!canonicalRaw) {
    return { confidence: "LOW", metrics: null, block: null, canonicalRaw: "" };
  }
  const metrics = computeMuseSourceStyleMetrics(canonicalRaw);
  const confidence = resolveMuseFingerprintConfidence(metrics);
  switch (confidence) {
    case "HIGH":
    case "MEDIUM":
      return {
        confidence,
        metrics,
        block: renderMuseSourceStyleFingerprint(metrics),
        canonicalRaw,
      };
    case "LOW":
      return { confidence, metrics, block: null, canonicalRaw };
    default:
      return assertNever(confidence);
  }
}

export function stripMuseSourceStyleFingerprint(text: string): string {
  if (!text.includes(MUSE_SOURCE_STYLE_FINGERPRINT_HEADER)) return text;
  const start = text.indexOf(MUSE_SOURCE_STYLE_FINGERPRINT_HEADER);
  const afterHeader = text.slice(start);
  const nextBlock = afterHeader.search(/\n\n\[/);
  const end = nextBlock >= 0 ? start + nextBlock : text.length;
  return `${text.slice(0, start).trimEnd()}\n\n${text.slice(end).trimStart()}`
    .replace(/\n{3,}/g, "\n\n")
    .trim();
}

export function resolveMuseSourceStyleFingerprintBlock(input: {
  lastVisibleCanonicalAssistantRaw?: string;
  adultTargetModelId?: string;
}): string | null {
  if (!input.adultTargetModelId || !isCheaperInferenceMuseSpark12Model(input.adultTargetModelId)) {
    return null;
  }
  const raw = input.lastVisibleCanonicalAssistantRaw ?? "";
  return buildMuseSourceStyleFingerprint(raw).block;
}

export function splitTextIntoCharThirds(text: string): [string, string, string] {
  const paragraphs = splitCanonicalParagraphs(text);
  if (paragraphs.length === 0) return ["", "", ""];
  const total = paragraphs.reduce((sum, p) => sum + p.length, 0);
  const cuts = [total / 3, (2 * total) / 3];
  const buckets: string[][] = [[], [], []];
  let acc = 0;
  let bucket = 0;
  for (const paragraph of paragraphs) {
    if (bucket < 2 && acc >= cuts[bucket]!) bucket += 1;
    buckets[bucket]!.push(paragraph);
    acc += paragraph.length;
  }
  return [
    buckets[0]!.join("\n\n"),
    buckets[1]!.join("\n\n"),
    buckets[2]!.join("\n\n"),
  ];
}

export function computeMuseStyleDistance(
  source: MuseSourceStyleMetrics,
  candidate: MuseSourceStyleMetrics
): MuseStyleDistance {
  const features: Record<string, number> = {};
  let sum = 0;
  for (const key of METRIC_KEYS) {
    const s = source[key];
    const c = candidate[key];
    const floor = key.includes("share") ? 0.01 : 1;
    const delta = Math.abs(c - s) / Math.max(Math.abs(s), floor);
    features[key] = Number(delta.toFixed(4));
    sum += delta;
  }
  return {
    overall: Number((sum / METRIC_KEYS.length).toFixed(4)),
    features,
  };
}

export function lastAssistantRawFromHistory(
  history: Array<{ role: string; content: string }> | undefined
): string {
  if (!history?.length) return "";
  for (let i = history.length - 1; i >= 0; i -= 1) {
    if (history[i]?.role === "assistant") return history[i]!.content ?? "";
  }
  return "";
}
