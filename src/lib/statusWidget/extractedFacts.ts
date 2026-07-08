import type {
  ExtractedStatusFact,
  ExtractedStatusFactCategory,
  ExtractedStatusFactImportance,
} from "./types";

const FACT_CATEGORIES = new Set<ExtractedStatusFactCategory>([
  "relationship",
  "character",
  "setting",
  "item",
  "preference",
  "rule",
  "quest",
  "location",
  "organization",
]);

const FACT_IMPORTANCE = new Set<ExtractedStatusFactImportance>([
  "critical",
  "important",
  "normal",
]);

const SNAKE_CASE_RE = /^[a-z][a-z0-9]*(?:_[a-z0-9]+)*$/;
const FORBIDDEN_FACT_FIELDS = new Set(["source_turn", "id", "uuid", "timestamp"]);

function cleanString(value: unknown): string {
  if (typeof value !== "string" && typeof value !== "number") return "";
  return String(value).replace(/\s+/g, " ").trim();
}

function koreanCharCount(value: string): number {
  return (value.match(/[가-힣]/g) ?? []).length;
}

function hasNaturalKoreanSentenceEnding(value: string): boolean {
  const t = value.trim().replace(/[.!?。！？]+$/, "");
  return /(?:다|요|니다|한다|했다|된다|있다|없다|이다|였다|한다|원한다|선호한다|좋아한다|싫어한다|기억한다)$/.test(t);
}

function hasForbiddenMetadataField(obj: Record<string, unknown>): boolean {
  return Object.keys(obj).some((key) => FORBIDDEN_FACT_FIELDS.has(key));
}

function isCompleteKoreanSentence(value: string): boolean {
  const t = value.trim();
  if (!t || t.length > 180) return false;
  if (koreanCharCount(t) < 10) return false;
  if (!/[가-힣]/.test(t)) return false;
  if (!hasNaturalKoreanSentenceEnding(t)) return false;
  if (/^(?:그|그녀|그것|저것|그들|그 사람|그 장소|그 물건)(?:은|는|이|가|을|를|에게|와|과)/.test(t)) {
    return false;
  }
  return true;
}

function isConciseFactValue(value: string): boolean {
  const t = value.trim();
  if (!t || t.length > 80) return false;
  if (/\s/.test(t)) return false;
  if (/[.!?。！？]$/.test(t)) return false;
  if (/[가-힣].*(?:다|요|니다|한다|했다|된다|있다|없다|이다|였다)$/.test(t)) return false;
  return true;
}

export function sanitizeExtractedFacts(raw: unknown): ExtractedStatusFact[] {
  if (!Array.isArray(raw)) return [];

  const out: ExtractedStatusFact[] = [];
  const seen = new Set<string>();

  for (const item of raw) {
    if (!item || typeof item !== "object" || Array.isArray(item)) continue;
    const obj = item as Record<string, unknown>;
    if (hasForbiddenMetadataField(obj)) continue;
    const category = cleanString(obj.category) as ExtractedStatusFactCategory;
    const subject = cleanString(obj.subject);
    const attribute = cleanString(obj.attribute);
    const value = cleanString(obj.value);
    const importance = cleanString(obj.importance) as ExtractedStatusFactImportance;
    const factText = cleanString(obj.fact_text);

    if (!FACT_CATEGORIES.has(category)) continue;
    if (!FACT_IMPORTANCE.has(importance)) continue;
    if (subject.length > 64 || attribute.length > 64) continue;
    if (!SNAKE_CASE_RE.test(subject) || !SNAKE_CASE_RE.test(attribute)) continue;
    if (!isConciseFactValue(value)) continue;
    if (!isCompleteKoreanSentence(factText)) continue;

    const dedupeKey = `${category}:${subject}:${attribute}:${value}:${factText}`;
    if (seen.has(dedupeKey)) continue;
    seen.add(dedupeKey);
    out.push({
      category,
      subject,
      attribute,
      value,
      importance,
      fact_text: factText,
    });
    if (out.length >= 3) break;
  }

  return out;
}

export function mergeExtractedFacts(
  ...groups: Array<ExtractedStatusFact[] | null | undefined>
): ExtractedStatusFact[] {
  const out: ExtractedStatusFact[] = [];
  const seen = new Set<string>();
  for (const group of groups) {
    for (const fact of group ?? []) {
      const key = `${fact.category}:${fact.subject}:${fact.attribute}:${fact.value}:${fact.fact_text}`;
      if (seen.has(key)) continue;
      seen.add(key);
      out.push(fact);
      if (out.length >= 3) return out;
    }
  }
  return out;
}
