/**
 * Timeline anchors for 5-turn rolling summaries.
 *
 * Problem: the batch summary prompt has no preservation slot for a *reference*
 * to an out-of-batch past event ("T80 proposal already happened") or for a
 * return to an earlier story point ("resume after the Milgram disclosure").
 * The only explicit statement of that operation lives in OOC, which the
 * summary prompt must exclude, so the reference is silently dropped.
 *
 * Design: inside the existing rolling-summary owner, run ONE small structured
 * extraction over the batch's opening region (first turn USER + the leading
 * ASSISTANT paragraphs) and prepend a single bounded timeline line to the
 * summary body. Prepending to `summary` keeps every downstream consumer
 * (Recent Narrative / Stored History / Global rebuild / Global compact /
 * manual Global) consistent without a second metadata channel.
 *
 * Guards:
 * - No new table, no new memory system, no work-specific patterns.
 * - Anchors are grounded in a verbatim ASSISTANT quote, never in OOC text.
 * - New-episode starts and event cancellations are NOT anchors.
 * - Extraction failure/empty output = today's behaviour, byte-identical.
 */

import { messageHasOocMarkers } from "@/lib/chatOocPriority";
import { clampMemoryRecordSummary } from "./memory-summary-clamp";

export const TIMELINE_ANCHOR_REQUEST_KIND = "background-memory-timeline-anchor";
export const TIMELINE_ANCHOR_LINE_MAX_CHARS = 120;
export const TIMELINE_ANCHOR_MAX_ITEMS = 2;

/** Leading-region budgets. The goal is a framing decision, not a re-summary. */
const OPENING_USER_MAX_CHARS = 900;
const OPENING_ASSISTANT_MAX_CHARS = 1400;
const OPENING_ASSISTANT_MAX_PARAGRAPHS = 3;

export type TimelineAnchorMode =
  | "past_event_reference"
  | "resume_from_earlier_point";

export type TimelineAnchor = {
  mode: TimelineAnchorMode;
  /** Short Korean event label, e.g. an already-happened public proposal. */
  label: string;
  /** Anchors only ever mark events as already past. */
  asOf: "past";
  /** Verbatim span from the ASSISTANT source, >= 6 chars. Never OOC. */
  sourceQuote: string;
  /** Required for resume_from_earlier_point: the point the story returns to. */
  resumePoint?: string;
};

export type BatchOpeningRegion = {
  userText: string;
  assistantText: string;
  paragraphs: number;
};

/** First `[N턴]\n유저: ...\n<speaker>: ...` block of the formatted batch. */
export function extractBatchOpeningRegion(dialogue: string): BatchOpeningRegion | null {
  const block = (dialogue ?? "").split(/\n\n(?=\[\d+턴\]\n유저: )/)[0] ?? "";
  const match = block.match(/^\s*\[\d+턴\]\s*\n유저:\s*([\s\S]*?)\n[^:\n]+:\s*([\s\S]*)$/);
  if (!match) return null;
  const userText = (match[1] ?? "").trim().slice(0, OPENING_USER_MAX_CHARS);
  const assistantFull = (match[2] ?? "").trim();
  const paragraphs: string[] = [];
  let chars = 0;
  for (const paragraph of assistantFull.split(/\n\n/)) {
    const trimmed = paragraph.trim();
    if (!trimmed) continue;
    if (paragraphs.length >= OPENING_ASSISTANT_MAX_PARAGRAPHS) break;
    if (paragraphs.length > 0 && chars + trimmed.length > OPENING_ASSISTANT_MAX_CHARS) break;
    paragraphs.push(trimmed);
    chars += trimmed.length + 2;
  }
  const assistantText = paragraphs.join("\n\n").slice(0, OPENING_ASSISTANT_MAX_CHARS);
  if (!assistantText) return null;
  return { userText, assistantText, paragraphs: paragraphs.length };
}

/**
 * Generic retrospective framing markers (language-level, not work-specific).
 * Only consulted in the leading region; a miss means no extra call and no
 * behaviour change, so a narrow marker set costs recall, not correctness.
 */
const RETROSPECTIVE_FRAMING =
  /한때|예전에|과거|이전에|흩어진\s*지|지\s*오래였|되돌아|돌아가|기억으로\s*남|이미\s*있었던|이미\s*일어난|earlier|previously|in\s+the\s+past|long\s+ago/i;

/** A batch is a candidate only when the opening region can carry a timeline frame. */
export function isTimelineAnchorCandidate(region: BatchOpeningRegion | null): boolean {
  if (!region) return false;
  if (messageHasOocMarkers(region.userText)) return true;
  return RETROSPECTIVE_FRAMING.test(region.assistantText);
}

export function buildTimelineAnchorExtractionMessages(region: BatchOpeningRegion): {
  system: string;
  user: string;
} {
  const system = `[시간선 앵커 추출]
아래는 RP 배치 첫 턴의 USER 메시지와 ASSISTANT 응답 앞부분이다.
이 배치가 (1) 이미 일어난 과거 사건을 과거로 남긴 채 참조하는지, (2) 이야기를 이전 시점으로 되돌려 재개하는지 판정한다.

판단 규칙:
- ASSISTANT의 실현된 서술에 근거가 있어야 한다. USER의 OOC/지시는 판단 근거로만 사용하고, OOC 명령문 자체를 사건으로 저장하지 않는다.
- (1) 과거 사건 참조: ASSISTANT 서술이 이 배치 이전의 사건을 이미 지나간 일로 되짚으면 해당한다.
- (2) 이전 시점 복귀: ASSISTANT 서술이 배치 안의 뒤 사건이 아니라 이미 지나간 특정 지점 직후에서 장면을 다시 시작하면 해당한다. resumePoint에는 그 재개 지점을 쓴다.
- (1)과 (2)는 동시에 성립할 수 있다. 둘 다 성립하면 앵커를 두 개 반환한다.
- 새 에피소드 시작, 단순 장면 전환, 현재 진행 중인 사건은 시간선 앵커가 아니다.
- 사건 취소·무효화·정정은 시간선 앵커가 아니다.
- 원문에 없는 사건·인과·관계를 만들지 않는다. 인물의 자기 규정을 다른 지위(배우자·반려자 등)로 바꾸지 않는다.
- label은 어떤 사건인지 특정되도록 행위나 대상을 포함해 쓴다(막연한 "소동"만 쓰지 않는다).
- 확실하지 않으면 빈 배열을 반환한다.

출력은 JSON 객체 하나만:
{"timelineAnchors":[{"mode":"past_event_reference|resume_from_earlier_point","label":"...","asOf":"past","sourceQuote":"...","resumePoint":""}]}
- label: 사건 자체를 30자 이내 한국어로.
- sourceQuote: ASSISTANT 원문에서 문자 그대로 복사한 6자 이상의 절 또는 문장. USER/OOC 원문에서 가져오지 않는다.
- resume_from_earlier_point일 때만 resumePoint에 재개 지점을 30자 이내로 쓴다. 그 외에는 빈 문자열.
- timelineAnchors는 최대 2개, 없으면 [].`;
  const user = `[USER 원문 — OOC는 판단 근거이며 저장 대상이 아님]\n${region.userText}\n\n[ASSISTANT 원문]\n${region.assistantText}`;
  return { system, user };
}

function asRecord(value: unknown): Record<string, unknown> | null {
  return value && typeof value === "object" && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : null;
}

/** Tolerant JSON extraction: accepts a raw object or a fenced ```json block. */
export function parseTimelineAnchorJson(raw: string): unknown[] | null {
  const text = (raw ?? "").trim();
  if (!text) return null;
  const candidates = [
    text,
    ...[...text.matchAll(/```(?:json)?\s*([\s\S]*?)```/g)].map((m) => (m[1] ?? "").trim()),
  ];
  for (const candidate of candidates) {
    if (!candidate) continue;
    const start = candidate.indexOf("{");
    const end = candidate.lastIndexOf("}");
    if (start < 0 || end <= start) continue;
    try {
      const parsed = asRecord(JSON.parse(candidate.slice(start, end + 1)));
      const list = parsed?.timelineAnchors;
      if (Array.isArray(list)) return list;
    } catch {
      // try the next candidate
    }
  }
  return null;
}

/**
 * Keep only anchors that are structurally valid AND grounded in the ASSISTANT
 * text. Anything else (fabricated quote, OOC quote, new episode, cancellation,
 * invented relationship) is dropped rather than corrected by hand.
 */
export function verifyTimelineAnchors(
  items: unknown[] | null,
  assistantText: string
): TimelineAnchor[] {
  if (!items?.length) return [];
  const source = assistantText.replace(/\s+/g, " ").trim();
  const out: TimelineAnchor[] = [];
  const seen = new Set<string>();
  for (const item of items) {
    const rec = asRecord(item);
    if (!rec) continue;
    const mode = rec.mode;
    if (mode !== "past_event_reference" && mode !== "resume_from_earlier_point") continue;
    const label = typeof rec.label === "string" ? rec.label.replace(/\s+/g, " ").trim() : "";
    if (!label || label.length > 40 || /OOC/i.test(label)) continue;
    if (seen.has(label)) continue;
    const asOf = rec.asOf;
    if (asOf !== "past") continue;
    const quote = typeof rec.sourceQuote === "string" ? rec.sourceQuote.trim() : "";
    if (quote.length < 6) continue;
    // Verbatim grounding, whitespace-tolerant on both sides only.
    if (!source.includes(quote.replace(/\s+/g, " ").trim())) continue;
    const resumePointRaw = typeof rec.resumePoint === "string" ? rec.resumePoint.replace(/\s+/g, " ").trim() : "";
    if (mode === "resume_from_earlier_point" && (!resumePointRaw || resumePointRaw.length > 40)) continue;
    seen.add(label);
    out.push({
      mode,
      label,
      asOf: "past",
      sourceQuote: quote,
      ...(resumePointRaw ? { resumePoint: resumePointRaw } : {}),
    });
    if (out.length >= TIMELINE_ANCHOR_MAX_ITEMS) break;
  }
  return out;
}

function clipLabel(text: string, max = 30): string {
  const t = text.replace(/\s+/g, " ").trim();
  return t.length > max ? `${t.slice(0, max - 1)}…` : t;
}

/** One bounded line; no OOC wording, no turn numbers, no invented causality. */
export function formatTimelineAnchorLine(anchors: TimelineAnchor[]): string {
  if (!anchors.length) return "";
  const parts: string[] = [];
  const past = anchors.filter((a) => a.mode === "past_event_reference").map((a) => a.label);
  const resumes = anchors
    .filter((a) => a.mode === "resume_from_earlier_point")
    .map((a) => a.resumePoint ?? a.label);
  if (past.length) parts.push(`과거: ${past.map((l) => clipLabel(l)).join(", ")}`);
  if (resumes.length) parts.push(`재개 지점: ${resumes.map((l) => clipLabel(l)).join(", ")}`);
  if (!parts.length) return "";
  let line = `[시간선] ${parts.join(" · ")}.`;
  // Drop trailing items rather than cutting a word, keeping the line bounded.
  while (line.length > TIMELINE_ANCHOR_LINE_MAX_CHARS && (past.length || resumes.length)) {
    if (past.length > 1) past.pop();
    else if (resumes.length > 1) resumes.pop();
    else break;
    const rebuilt: string[] = [];
    if (past.length) rebuilt.push(`과거: ${past.map((l) => clipLabel(l)).join(", ")}`);
    if (resumes.length) rebuilt.push(`재개 지점: ${resumes.map((l) => clipLabel(l)).join(", ")}`);
    line = `[시간선] ${rebuilt.join(" · ")}.`;
  }
  return line.length <= TIMELINE_ANCHOR_LINE_MAX_CHARS ? line : "";
}

/**
 * Prepend the timeline line inside the existing summary budget.
 * Returns the summary unchanged when there is nothing to add, when the summary
 * already states the anchor, or when the budget cannot hold both.
 */
export function prependTimelineAnchorLine(
  summary: string,
  anchors: TimelineAnchor[],
  maxChars: number
): string {
  const text = summary.trim();
  if (!text || !anchors.length) return summary;
  const remaining = anchors.filter((a) => {
    const key = clipLabel(a.label).replace(/…$/, "");
    return key.length >= 2 && !text.includes(key);
  });
  const line = formatTimelineAnchorLine(remaining);
  if (!line) return summary;
  const proseBudget = maxChars - line.length - 1;
  // The anchor is optional; the summary's minimum length is not.
  if (proseBudget < 80) return summary;
  const prose = clampMemoryRecordSummary(text, proseBudget, 80);
  // Never trade the summary itself for an anchor.
  if (prose.length < 80 || prose.length + line.length + 1 > maxChars) return summary;
  return `${line} ${prose}`;
}
