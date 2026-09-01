/**
 * Canonical Scene Builder owner: source sanitization, Scene Plan schema,
 * chronology/provenance validation, and deterministic fallback/reflow.
 * Provider calls live in chatImageScenePlanner.ts so client UI can import this
 * module. Does not own visual identity, eye traits, or composition.
 */

import {
  extractUserSpokenDialogue,
  isSceneActionText,
  normalizeSceneBriefWhitespace,
  stripChatTurnMarkup,
} from "@/lib/chatImageSceneBrief";
import type { ContentKind } from "@/lib/simulationMode";

export const SCENE_PLAN_MAX_SOURCE_CHARS = 24_000;
export const SCENE_PLAN_MAX_PROVIDER_ATTEMPTS = 2;
export const SCENE_PLAN_RETRY_COUNT = 0;

export type SceneSourceRole = "user" | "assistant";

export type SceneSourceMessage = {
  id: number;
  order: number;
  role: SceneSourceRole;
  text: string;
};

export type SceneEventKind =
  | "dialogue"
  | "action"
  | "reaction"
  | "environment"
  | "assistant_echo";

export type SceneSourceSegmentKind = "dialogue" | "action" | "narration";

export type SceneEventActor = "persona" | "character" | "other" | "environment";

export type SceneEvent = {
  id: string;
  order: number;
  sourceMessageId: number;
  sourceRole: SceneSourceRole;
  kind: SceneEventKind;
  actor: SceneEventActor;
  text: string;
  /** Original source segment kind — used for grounded panel action ownership. */
  segmentKind: SceneSourceSegmentKind;
};

export type SceneDialogueSpeaker = "persona" | "character" | "other";
export type SceneDialogueProvenance = "source" | "user_edit";

export type SceneDialogue = {
  speaker: SceneDialogueSpeaker;
  text: string;
  sourceEventId?: string;
  provenance: SceneDialogueProvenance;
};

export type ScenePanelCount = 2 | 3 | 4;

export type ScenePanel = {
  index: number;
  sourceEventIds: string[];
  situation: string;
  backgroundOverride?: string;
  personaAction?: string;
  characterAction?: string;
  dialogue: SceneDialogue[];
};

import type { SceneCastMention } from "@/lib/chatImageCast";
import { validateCastMentions } from "@/lib/chatImageCast";

export type { SceneCastMention } from "@/lib/chatImageCast";

export type ScenePlan = {
  sceneBackground: string;
  atmosphere?: string;
  events: SceneEvent[];
  heroEventIds: string[];
  heroScene: string;
  recommendedPanelCount: ScenePanelCount;
  panels: ScenePanel[];
  castMentions?: SceneCastMention[];
};

function cleanLine(raw: unknown, max = 400): string {
  return normalizeSceneBriefWhitespace(String(raw ?? "")).slice(0, max);
}

/** Preserve typing-safe raw dialogue while editing — no trim or whitespace collapse. */
export function preserveDialogueEditText(raw: unknown, max = 160): string {
  return String(raw ?? "").slice(0, max);
}

/** Canonical final dialogue text for bubbles, whitelist, and audits. */
export function normalizeDialogueTextForOutput(raw: unknown, max = 160): string {
  return normalizeSceneBriefWhitespace(String(raw ?? "")).slice(0, max);
}

const QUOTE_ATTRIBUTION_LINKER =
  /^(?:이라고|라고|이라며|라며|이라면서|라면서)\s*/u;

function hasQuoteAttributionLinker(text: string): boolean {
  return QUOTE_ATTRIBUTION_LINKER.test(text.trim());
}

function isConcurrentReactionLinker(text: string): boolean {
  return /^(?:이라며|라며|이라면서|라면서)/u.test(text.trim());
}

function actorForRole(role: SceneSourceRole): SceneEventActor {
  return role === "user" ? "persona" : "character";
}

function nextEventId(index: number): string {
  return `E${index + 1}`;
}

export function sanitizeSceneSourceText(raw: string): string {
  return stripChatTurnMarkup(raw).slice(0, SCENE_PLAN_MAX_SOURCE_CHARS);
}

export function buildSceneSourceMessages(
  rows: ReadonlyArray<{
    id?: number | null;
    role: SceneSourceRole;
    content: string;
  }>
): SceneSourceMessage[] {
  const messages: SceneSourceMessage[] = [];
  for (const row of rows) {
    const text = sanitizeSceneSourceText(row.content);
    if (!text) continue;
    const id =
      Number.isInteger(row.id) && Number(row.id) > 0
        ? Number(row.id)
        : messages.length + 1;
    messages.push({
      id,
      order: messages.length + 1,
      role: row.role,
      text,
    });
  }
  return messages;
}

export function formatSceneSourcePreview(messages: readonly SceneSourceMessage[]): string {
  return messages
    .map((message) => {
      const label = message.role === "user" ? "유저" : "캐릭터";
      return `${label}: ${message.text}`;
    })
    .join("\n");
}

export function extractQuotedLines(text: string): string[] {
  const out: string[] = [];
  const pattern = /“([^”]+)”|"([^"]+)"|‘([^’]+)’|'([^']+)'/g;
  for (const match of text.matchAll(pattern)) {
    const line = cleanLine(match[1] ?? match[2] ?? match[3] ?? match[4]);
    if (line.length < 1 || isSceneActionText(line)) continue;
    if (!out.includes(line)) out.push(line);
  }
  return out;
}

export function extractActionSegments(text: string): string[] {
  const out: string[] = [];
  const patterns = [/\*([^*]+)\*/g, /\(([^)]+)\)/g, /（([^）]+)）/g];
  for (const pattern of patterns) {
    for (const match of text.matchAll(pattern)) {
      const line = cleanLine(match[1]);
      if (line.length < 1) continue;
      if (!out.includes(line)) out.push(line);
    }
  }
  return out;
}

function spokenLinesForMessage(message: SceneSourceMessage): string[] {
  const quoted = extractQuotedLines(message.text);
  if (quoted.length) return quoted;
  if (message.role !== "user") return [];
  const spoken = extractUserSpokenDialogue(message.text);
  return spoken ? [spoken] : [];
}

function remainderNarration(text: string): string {
  return cleanLine(
    text
      .replace(/\*[^*]+\*/g, " ")
      .replace(/\([^)]*\)/g, " ")
      .replace(/（[^）]*）/g, " ")
      .replace(/“[^”]*”|"[^"]*"|‘[^’]*’|'[^']*'/g, " ")
  );
}

function significantTokens(text: string): string[] {
  return cleanLine(text)
    .replace(/[.!?。…,，*]/g, " ")
    .split(/\s+/)
    .map((token) => token.replace(/(는다|니다|였다|했다|다|자)$/g, ""))
    .filter((token) => token.length >= 2);
}

function textsOverlap(left: string, right: string): boolean {
  const a = significantTokens(left);
  const b = significantTokens(right);
  if (!a.length || !b.length) return false;
  const shared = a.filter((token) =>
    b.some((other) => other.includes(token) || token.includes(other))
  );
  const baseline = Math.min(a.length, b.length);
  return shared.length >= Math.min(2, baseline) && shared.length / baseline >= 0.5;
}

function splitKoreanClauses(text: string): string[] {
  return cleanLine(text)
    .split(/(?<=자|고|며|서)\s+|[.!?。…]\s+/)
    .map((part) => cleanLine(part))
    .filter(Boolean);
}

/** First complete visual beat for storyboard preview — clause/sentence safe, no mid-word ellipsis. */
export function projectCompleteVisualBeat(text: string): string {
  const normalized = text.replace(/\s+/g, " ").trim();
  if (!normalized) return "";

  const sentenceParts = normalized
    .split(/(?<=[.!?…])\s+/)
    .map((part) => part.trim())
    .filter(Boolean);
  if (sentenceParts.length >= 1 && sentenceParts[0]) {
    return sentenceParts[0];
  }

  const clauses = splitKoreanClauses(normalized);
  if (clauses.length === 1) return clauses[0]!;
  return clauses[0] ?? normalized;
}

export type SceneSourceSegment = {
  start: number;
  end: number;
  kind: SceneSourceSegmentKind;
  text: string;
};

type MarkedSpan = {
  start: number;
  end: number;
  kind: "dialogue" | "action";
  text: string;
};

function collectMarkedSpans(text: string): MarkedSpan[] {
  const spans: MarkedSpan[] = [];
  const patterns: Array<{ kind: MarkedSpan["kind"]; re: RegExp }> = [
    { kind: "action", re: /\*([^*]+)\*/g },
    { kind: "action", re: /\(([^)]+)\)/g },
    { kind: "action", re: /（([^）]+)）/g },
    { kind: "dialogue", re: /“([^”]+)”/g },
    { kind: "dialogue", re: /"([^"]+)"/g },
    { kind: "dialogue", re: /‘([^’]+)’/g },
    { kind: "dialogue", re: /'([^']+)'/g },
  ];
  for (const { kind, re } of patterns) {
    for (const match of text.matchAll(re)) {
      const full = match[0] ?? "";
      const inner = cleanLine(match[1] ?? "");
      const start = match.index ?? 0;
      if (!inner || !full) continue;
      if (kind === "dialogue" && isSceneActionText(inner)) continue;
      spans.push({ start, end: start + full.length, kind, text: inner });
    }
  }
  spans.sort((left, right) => left.start - right.start || left.end - right.end);
  const filtered: MarkedSpan[] = [];
  let cursor = 0;
  for (const span of spans) {
    if (span.start < cursor) continue;
    filtered.push(span);
    cursor = span.end;
  }
  return filtered;
}

function gapSegments(
  text: string,
  start: number,
  end: number,
  role: SceneSourceRole,
  afterDialogue: boolean
): SceneSourceSegment[] {
  const gap = text.slice(start, end);
  const trimmed = gap.trim();
  if (!trimmed) return [];
  const gapStart = start + gap.indexOf(trimmed);
  const gapEnd = gapStart + trimmed.length;
  if (afterDialogue && hasQuoteAttributionLinker(trimmed)) {
    return classifyPostDialogueGap(text, gapStart, gapEnd);
  }
  if (role === "user") {
    const spoken = cleanLine(trimmed);
    if (!spoken || isSceneActionText(spoken)) return [];
    return [{ start: gapStart, end: gapEnd, kind: "dialogue", text: spoken }];
  }
  if (afterDialogue) {
    return classifyPostDialogueGap(text, gapStart, gapEnd);
  }
  const narration = cleanLine(trimmed);
  if (!narration) return [];
  return [{ start: gapStart, end: gapEnd, kind: "narration", text: narration }];
}

function hasVisualActionCue(text: string): boolean {
  const trimmed = cleanLine(text);
  if (!trimmed) return false;
  if (/\*[^*]+\*/.test(trimmed)) return true;
  if (/[을를]\s/.test(trimmed)) return true;
  if (/^(?:그|그녀|그들|[가-힣]{1,8}(?:이|가))\s/.test(trimmed)) return true;
  if (/(?:다가|했다|한다|며|고)(?:[\s.!?。…]|$)/u.test(trimmed)) return true;
  return trimmed.length >= 8;
}

/** Extract visual narration from a post-quote gap; drop pure speech-attribution tails. */
function extractVisualFromPostQuoteGap(trimmed: string): string | null {
  const linkMatch = trimmed.match(
    /^(?:이라고|라고|이라며|라며|이라면서|라면서)\s*([\s\S]+)$/
  );
  if (!linkMatch) {
    return hasVisualActionCue(trimmed) ? cleanLine(trimmed) : null;
  }
  const linkerPrefix = trimmed.match(/^(?:이라고|라고|이라며|라며|이라면서|라면서)/u)?.[0] ?? "";
  const tail = cleanLine(linkMatch[1] ?? "");
  if (!tail) return null;

  const connectiveMatch = tail.match(/^[\p{L}]+(?:하고|하며|며)\s+([\s\S]+)$/u);
  if (connectiveMatch) {
    const action = cleanLine(connectiveMatch[1] ?? "");
    if (action && (hasVisualActionCue(action) || /[을를]/.test(action))) return action;
  }

  const concurrentMatch = tail.match(/^[\s\S]+?며\s+([\s\S]+)$/);
  if (concurrentMatch) {
    const action = cleanLine(concurrentMatch[1] ?? "");
    if (action && (hasVisualActionCue(action) || /[을를]/.test(action))) return action;
  }

  const sentenceMatch = tail.match(/^[^.!?。…]+[.!?。…]\s*([\s\S]+)$/);
  if (sentenceMatch) {
    const next = cleanLine(sentenceMatch[1] ?? "");
    if (next && hasVisualActionCue(next)) return next;
  }

  if (isConcurrentReactionLinker(linkerPrefix)) {
    if (isMalformedAttributionText(tail) && !/[을를]/.test(tail)) return null;
    return tail;
  }

  if (/[을를]/.test(tail) && tail.length >= 4) return tail;
  return null;
}

function classifyPostDialogueGap(
  text: string,
  gapStart: number,
  gapEnd: number
): SceneSourceSegment[] {
  const trimmed = text.slice(gapStart, gapEnd).trim();
  if (!trimmed) return [];
  if (QUOTE_ATTRIBUTION_LINKER.test(trimmed)) {
    const visual = extractVisualFromPostQuoteGap(trimmed);
    if (!visual) return [];
    const localStart = text.indexOf(visual, gapStart);
    const start = localStart >= gapStart ? localStart : gapStart;
    return [
      {
        start,
        end: start + visual.length,
        kind: "narration",
        text: visual,
      },
    ];
  }
  const narration = cleanLine(trimmed);
  if (!narration) return [];
  const localStart = text.indexOf(narration, gapStart);
  const start = localStart >= gapStart ? localStart : gapStart;
  return [
    {
      start,
      end: start + narration.length,
      kind: "narration",
      text: narration,
    },
  ];
}

/** Detect user-facing fields polluted by post-quote speech-attribution residue. */
export function isMalformedAttributionText(text: string): boolean {
  const trimmed = cleanLine(text);
  if (!trimmed) return false;
  if (/^(?:이라고|라고|이라며|라며|이라면서|라면서)(?:\s|$)/u.test(trimmed)) return true;
  if (
    /^(?:이라고|라고|이라며|라며|이라면서|라면서)[\p{L}\s]{0,48}[.!?。…]*$/u.test(trimmed) &&
    !hasVisualActionCue(trimmed)
  ) {
    return true;
  }
  return false;
}

/** Canonical intra-message segmenter — events follow source span order, not bucket order. */
export function extractOrderedSceneSegments(
  text: string,
  role: SceneSourceRole
): SceneSourceSegment[] {
  const marked = collectMarkedSpans(text);
  if (!marked.length) {
    if (role === "user") {
      const spoken = spokenLinesForMessage({ id: 0, order: 0, role, text });
      if (!spoken.length) return [];
      return spoken.map((line, index) => ({
        start: index,
        end: index + line.length,
        kind: "dialogue" as const,
        text: line,
      }));
    }
    const narration = remainderNarration(text);
    if (!narration) return [];
    return splitKoreanClauses(narration).map((clause, index) => ({
      start: index,
      end: index + clause.length,
      kind: "narration" as const,
      text: clause,
    }));
  }

  const segments: SceneSourceSegment[] = [];
  let cursor = 0;
  let previousSpanKind: MarkedSpan["kind"] | null = null;
  for (const span of marked) {
    if (span.start > cursor) {
      segments.push(
        ...gapSegments(text, cursor, span.start, role, previousSpanKind === "dialogue")
      );
    }
    segments.push({
      start: span.start,
      end: span.end,
      kind: span.kind,
      text: span.text,
    });
    previousSpanKind = span.kind;
    cursor = span.end;
  }
  if (cursor < text.length) {
    segments.push(
      ...gapSegments(text, cursor, text.length, role, previousSpanKind === "dialogue")
    );
  }
  return segments;
}

function isAssistantEchoOfUserAction(userActionText: string, segmentText: string): boolean {
  if (!textsOverlap(userActionText, segmentText)) return false;
  const userTokens = significantTokens(userActionText);
  const segmentTokens = significantTokens(segmentText);
  if (segmentTokens.length > Math.max(3, userTokens.length * 2)) return false;
  return true;
}

function segmentToEvent(
  message: SceneSourceMessage,
  segment: SceneSourceSegment,
  previousUserAction: SceneEvent | undefined
): Omit<SceneEvent, "id" | "order"> {
  if (segment.kind === "action") {
    return {
      sourceMessageId: message.id,
      sourceRole: message.role,
      kind: message.role === "assistant" ? "reaction" : "action",
      actor: actorForRole(message.role),
      text: segment.text,
      segmentKind: "action",
    };
  }
  if (segment.kind === "dialogue") {
    return {
      sourceMessageId: message.id,
      sourceRole: message.role,
      kind: "dialogue",
      actor: actorForRole(message.role),
      text: segment.text,
      segmentKind: "dialogue",
    };
  }
  const isEcho =
    message.role === "assistant" &&
    previousUserAction != null &&
    isAssistantEchoOfUserAction(previousUserAction.text, segment.text);
  return {
    sourceMessageId: message.id,
    sourceRole: message.role,
    kind: isEcho
      ? "assistant_echo"
      : message.role === "assistant"
        ? "reaction"
        : "environment",
    actor: message.role === "assistant" ? "character" : "environment",
    text: segment.text,
    segmentKind: "narration",
  };
}

export function extractDeterministicEvents(
  messages: readonly SceneSourceMessage[]
): SceneEvent[] {
  const events: SceneEvent[] = [];
  const push = (partial: Omit<SceneEvent, "id" | "order">) => {
    events.push({
      ...partial,
      id: nextEventId(events.length),
      order: events.length + 1,
    });
  };

  for (const message of messages) {
    const segments = extractOrderedSceneSegments(message.text, message.role);
    for (const segment of segments) {
      const previousUserAction = [...events]
        .reverse()
        .find((event) => event.sourceRole === "user" && event.kind === "action");
      push(segmentToEvent(message, segment, previousUserAction));
    }
  }

  return markAssistantEchoes(events);
}

export function markAssistantEchoes(events: readonly SceneEvent[]): SceneEvent[] {
  return events.map((event, index) => {
    if (event.sourceRole !== "assistant" || event.kind === "dialogue") return event;
    const previous = events
      .slice(0, index)
      .reverse()
      .find((candidate) => candidate.sourceRole === "user" && candidate.kind === "action");
    if (!previous) return event;
    if (!isAssistantEchoOfUserAction(previous.text, event.text)) return event;
    return { ...event, kind: "assistant_echo" };
  });
}

export function visualEvents(events: readonly SceneEvent[]): SceneEvent[] {
  return events.filter((event) => event.kind !== "assistant_echo");
}

/** Non-dialogue visual beats only — canonical user-facing scene description owner. */
export function buildUserFacingVisualDescription(
  events: readonly SceneEvent[],
  fallback = ""
): string {
  const description = events
    .filter((event) => event.kind !== "dialogue")
    .map((event) => event.text)
    .join(" ")
    .trim();
  return description || fallback;
}

/** User-facing hero scene projection — visual beats only; heroEventIds may include dialogue. */
export function projectUserFacingHeroScene(
  plan: ScenePlan,
  heroEventIds: readonly string[] = plan.heroEventIds
): string {
  const eventsById = new Map(plan.events.map((event) => [event.id, event]));
  const heroEvents = heroEventIds
    .map((id) => eventsById.get(id))
    .filter((event): event is SceneEvent => event !== undefined);
  return buildUserFacingVisualDescription(heroEvents, plan.sceneBackground);
}

/** Environment-only background from canonical events — no dialogue/narration fallback. */
export function resolveDeterministicSceneBackground(
  events: readonly SceneEvent[]
): string {
  return (
    visualEvents(events)
      .find((event) => event.kind === "environment")
      ?.text.trim() ?? ""
  );
}

export function recommendPanelCount(eventCount: number): ScenePanelCount {
  if (eventCount <= 3) return 2;
  if (eventCount <= 5) return 3;
  return 4;
}

export function groupEventsContiguously(
  events: readonly SceneEvent[],
  panelCount: ScenePanelCount
): SceneEvent[][] {
  const usable = visualEvents(events);
  const groups: SceneEvent[][] = Array.from({ length: panelCount }, () => []);
  if (usable.length === 0) return groups;

  const base = Math.floor(usable.length / panelCount);
  const extra = usable.length % panelCount;
  let cursor = 0;
  for (let index = 0; index < panelCount; index += 1) {
    const size = base + (index < extra ? 1 : 0);
    groups[index] = usable.slice(cursor, cursor + size);
    cursor += size;
  }
  return groups;
}

function panelFromEvents(
  index: number,
  events: readonly SceneEvent[],
  sceneBackground: string
): ScenePanel {
  const persona = events.find(
    (event) => event.segmentKind === "action" && event.actor === "persona"
  );
  const character = events.find(
    (event) => event.segmentKind === "action" && event.actor === "character"
  );
  const dialogue: SceneDialogue[] = events
    .filter((event) => event.kind === "dialogue")
    .map((event) => ({
      speaker:
        event.actor === "persona" || event.actor === "character" || event.actor === "other"
          ? event.actor
          : "other",
      text: event.text,
      sourceEventId: event.id,
      provenance: "source",
    }));
  return {
    index,
    sourceEventIds: events.map((event) => event.id),
    situation:
      buildUserFacingVisualDescription(events, sceneBackground) || sceneBackground,
    personaAction: persona?.text,
    characterAction: character?.text,
    dialogue,
  };
}

export function buildDeterministicScenePlan(
  messages: readonly SceneSourceMessage[],
  panelCount?: ScenePanelCount
): ScenePlan {
  const events = extractDeterministicEvents(messages);
  const usable = visualEvents(events);
  const recommendedPanelCount = recommendPanelCount(usable.length);
  const resolvedCount = panelCount ?? recommendedPanelCount;
  const background = resolveDeterministicSceneBackground(events);
  const groups = groupEventsContiguously(events, resolvedCount);
  const heroEvents = usable.slice(0, Math.min(3, usable.length));
  const heroScene = buildUserFacingVisualDescription(heroEvents, background);
  return {
    sceneBackground: background,
    atmosphere: undefined,
    events,
    heroEventIds: heroEvents.map((event) => event.id),
    heroScene: heroScene || background,
    recommendedPanelCount,
    panels: groups.map((group, index) =>
      panelFromEvents(index + 1, group, background)
    ),
  };
}

/** GM route-choice / next-decision beats should not pollute default TRPG hero focus. */
export function isTrpgNextDecisionEvent(event: SceneEvent): boolean {
  const text = event.text;
  if (event.kind === "dialogue" && event.sourceRole === "assistant") {
    return /선택/.test(text) && /(통로|어디|어느|방향|갈)/.test(text);
  }
  if (event.kind === "environment") {
    return /(통로|갈림)/.test(text) && /(선택|좌|우)/.test(text);
  }
  return false;
}

/** Post-action rest / corridor survey beats after the main action cluster. */
export function isTrpgPostActionRestEvent(event: SceneEvent): boolean {
  if (isTrpgNextDecisionEvent(event)) return true;
  if (/통로/.test(event.text) && /(좌|우|보인)/.test(event.text)) return true;
  return /숨을 고르|장비를 정리|장비 정리/.test(event.text);
}

function capTrpgFocusPoolAtRescueCompletion(pool: readonly SceneEvent[]): readonly SceneEvent[] {
  let lastRescueIndex = -1;
  for (let index = 0; index < pool.length; index += 1) {
    if (/끌어올|맞물린/.test(pool[index]!.text)) lastRescueIndex = index;
  }
  return lastRescueIndex >= 0 ? pool.slice(0, lastRescueIndex + 1) : pool;
}

function scoreTrpgFocusWindow(events: readonly SceneEvent[], startIndex: number): number {
  let score = 0;
  for (const event of events) {
    if (event.kind === "action" || event.kind === "reaction") score += 3;
    else if (event.kind === "dialogue") score += 0.5;
    else score += 0.25;
  }
  score -= Math.max(0, events.length - 1) * 0.75;
  score += startIndex * 0.2;
  return score;
}

function compareTrpgFocusCandidate(
  left: { ids: string[]; score: number; start: number },
  right: { ids: string[]; score: number; start: number }
): number {
  if (right.score !== left.score) return right.score - left.score;
  if (left.ids.length !== right.ids.length) return left.ids.length - right.ids.length;
  return right.start - left.start;
}

/** Deterministic one-drawable-moment subset for TRPG illustration focus recovery. */
export function selectDeterministicTrpgFocusEventIds(events: readonly SceneEvent[]): string[] {
  const visual = visualEvents(events);
  const firstRestIndex = visual.findIndex((event) => isTrpgPostActionRestEvent(event));
  const pool =
    firstRestIndex >= 0
      ? visual.slice(0, firstRestIndex).filter((event) => !isTrpgNextDecisionEvent(event))
      : visual.filter((event) => !isTrpgNextDecisionEvent(event));

  if (!pool.length) {
    const fallback = visual.filter((event) => !isTrpgNextDecisionEvent(event));
    return fallback
      .slice(0, Math.min(TRPG_ILLUSTRATION_MAX_HERO_EVENT_IDS, fallback.length))
      .map((event) => event.id);
  }

  const focusPool = capTrpgFocusPoolAtRescueCompletion(pool);
  const maxWindow = TRPG_ILLUSTRATION_MAX_HERO_EVENT_IDS;
  let best = { ids: [] as string[], score: Number.NEGATIVE_INFINITY, start: 0 };

  for (let start = 0; start < focusPool.length; start += 1) {
    for (let len = 1; len <= Math.min(maxWindow, focusPool.length - start); len += 1) {
      const window = focusPool.slice(start, start + len);
      const candidate = {
        ids: window.map((event) => event.id),
        score: scoreTrpgFocusWindow(window, start),
        start,
      };
      if (compareTrpgFocusCandidate(best, candidate) > 0) {
        best = candidate;
      }
    }
  }

  return best.ids.length
    ? best.ids
    : focusPool.slice(0, Math.min(maxWindow, focusPool.length)).map((event) => event.id);
}

export function buildDeterministicTrpgFocusHeroScene(plan: ScenePlan): {
  heroEventIds: string[];
  heroScene: string;
} {
  const heroEventIds = selectDeterministicTrpgFocusEventIds(plan.events);
  const heroEvents = heroEventIds
    .map((id) => plan.events.find((event) => event.id === id))
    .filter((event): event is SceneEvent => event !== undefined);
  const heroScene =
    buildUserFacingVisualDescription(heroEvents, plan.sceneBackground) || plan.sceneBackground;
  return { heroEventIds, heroScene };
}

export function applyApprovedAiScenePlan(
  aiPlan: ScenePlan,
  panelCount: ScenePanelCount
): ScenePlan {
  return reflowScenePlanPanels(aiPlan, panelCount);
}

export function reflowScenePlanPanels(
  plan: ScenePlan,
  panelCount: ScenePanelCount
): ScenePlan {
  const groups = groupEventsContiguously(plan.events, panelCount);
  return {
    ...plan,
    panels: groups.map((group, index) =>
      panelFromEvents(index + 1, group, plan.sceneBackground)
    ),
  };
}

/** Canonical dialogue provenance owner for panel presentation edits. */
export function normalizePanelDialogueEdits(
  previous: readonly SceneDialogue[],
  next: readonly SceneDialogue[]
): SceneDialogue[] {
  const result: SceneDialogue[] = [];
  for (const line of next) {
    const speaker = line.speaker;
    if (speaker !== "persona" && speaker !== "character" && speaker !== "other") {
      continue;
    }
    const editText = preserveDialogueEditText(line.text, 160);
    const outputText = normalizeDialogueTextForOutput(line.text, 160);
    if (!outputText && !editText.trim()) {
      if (line.provenance === "user_edit") {
        result.push({ speaker, text: "", provenance: "user_edit" });
      }
      continue;
    }
    if (line.provenance === "user_edit") {
      result.push({ speaker, text: editText, provenance: "user_edit" });
      continue;
    }
    const sourceEventId = cleanLine(line.sourceEventId, 24) || undefined;
    if (sourceEventId) {
      const prior = previous.find((item) => item.sourceEventId === sourceEventId);
      if (
        prior &&
        prior.provenance === "source" &&
        normalizeDialogueTextForOutput(prior.text) === outputText &&
        prior.speaker === speaker
      ) {
        result.push(prior);
        continue;
      }
      result.push({ speaker, text: editText, provenance: "user_edit" });
      continue;
    }
    result.push({ speaker, text: editText, provenance: "user_edit" });
  }
  return result;
}

export function updatePanelDialogueAtIndex(
  plan: ScenePlan,
  panelIndex: number,
  lineIndex: number,
  patch: Partial<Pick<SceneDialogue, "speaker" | "text">>
): ScenePlan {
  const panel = plan.panels.find((item) => item.index === panelIndex);
  if (!panel || lineIndex < 0 || lineIndex >= panel.dialogue.length) return plan;
  const dialogue = panel.dialogue.map((line, index) =>
    index === lineIndex ? { ...line, ...patch } : line
  );
  return applyUserPanelEdits(plan, panelIndex, { dialogue });
}

export function movePanelDialogueLine(
  plan: ScenePlan,
  panelIndex: number,
  lineIndex: number,
  direction: "up" | "down"
): ScenePlan {
  const panel = plan.panels.find((item) => item.index === panelIndex);
  if (!panel) return plan;
  const target = direction === "up" ? lineIndex - 1 : lineIndex + 1;
  if (target < 0 || target >= panel.dialogue.length) return plan;
  const dialogue = [...panel.dialogue];
  const [item] = dialogue.splice(lineIndex, 1);
  if (!item) return plan;
  dialogue.splice(target, 0, item);
  return applyUserPanelEdits(plan, panelIndex, { dialogue });
}

export function addPanelDialogueLine(
  plan: ScenePlan,
  panelIndex: number,
  speaker: SceneDialogueSpeaker = "persona"
): ScenePlan {
  const panel = plan.panels.find((item) => item.index === panelIndex);
  if (!panel) return plan;
  return applyUserPanelEdits(plan, panelIndex, {
    dialogue: [
      ...panel.dialogue,
      { speaker, text: "", provenance: "user_edit" as const },
    ],
  });
}

export function removePanelDialogueLine(
  plan: ScenePlan,
  panelIndex: number,
  lineIndex: number
): ScenePlan {
  const panel = plan.panels.find((item) => item.index === panelIndex);
  if (!panel) return plan;
  return applyUserPanelEdits(
    plan,
    panelIndex,
    { dialogue: panel.dialogue.filter((_, index) => index !== lineIndex) }
  );
}

export function applyUserPanelEdits(
  plan: ScenePlan,
  panelIndex: number,
  patch: Partial<
    Pick<
      ScenePanel,
      "situation" | "backgroundOverride" | "personaAction" | "characterAction" | "dialogue"
    >
  >
): ScenePlan {
  return {
    ...plan,
    panels: plan.panels.map((panel) => {
      if (panel.index !== panelIndex) return panel;
      const dialogue = patch.dialogue
        ? normalizePanelDialogueEdits(panel.dialogue, patch.dialogue)
        : panel.dialogue;
      return {
        ...panel,
        ...patch,
        dialogue,
      };
    }),
  };
}

/** Canonical user-edit owner for illustration fields. Does not mutate events. */
export function applyUserIllustrationEdits(
  plan: ScenePlan,
  patch: Partial<
    Pick<ScenePlan, "heroScene" | "sceneBackground" | "atmosphere" | "heroEventIds">
  >
): ScenePlan {
  const eventIds = new Set(plan.events.map((event) => event.id));
  const heroEventIds = (patch.heroEventIds ?? plan.heroEventIds).filter((id) =>
    eventIds.has(id)
  );
  return {
    ...plan,
    heroScene: patch.heroScene ?? plan.heroScene,
    sceneBackground: patch.sceneBackground ?? plan.sceneBackground,
    atmosphere: patch.atmosphere ?? plan.atmosphere,
    heroEventIds,
  };
}

type ParsedSubmittedEvents =
  | { ok: false; reason: string }
  | { ok: true; events: SceneEvent[] };

function parseSubmittedEvents(
  eventsRaw: readonly unknown[],
  eventsById?: ReadonlyMap<string, SceneEvent>
): ParsedSubmittedEvents {
  const events: SceneEvent[] = [];
  const seenIds = new Set<string>();
  for (const [index, row] of eventsRaw.entries()) {
    if (!row || typeof row !== "object") return { ok: false, reason: "event invalid" };
    const item = row as Record<string, unknown>;
    const id = cleanLine(item.id, 24) || nextEventId(index);
    if (seenIds.has(id)) return { ok: false, reason: "duplicate event" };
    seenIds.add(id);
    const sourceMessageId = Number(item.sourceMessageId);
    if (!Number.isFinite(sourceMessageId)) {
      return { ok: false, reason: "sourceMessageId missing" };
    }
    const sourceRole = item.sourceRole === "user" || item.sourceRole === "assistant"
      ? item.sourceRole
      : null;
    if (!sourceRole) return { ok: false, reason: "sourceRole mismatch" };
    const kind = item.kind;
    if (
      kind !== "dialogue" &&
      kind !== "action" &&
      kind !== "reaction" &&
      kind !== "environment" &&
      kind !== "assistant_echo"
    ) {
      return { ok: false, reason: "event kind invalid" };
    }
    const actor = item.actor;
    if (
      actor !== "persona" &&
      actor !== "character" &&
      actor !== "other" &&
      actor !== "environment"
    ) {
      return { ok: false, reason: "event actor invalid" };
    }
    const text = cleanLine(item.text, 400);
    if (!text) return { ok: false, reason: "event text empty" };
    const order = Number(item.order);
    const canonical = eventsById?.get(id);
    const segmentKindRaw = item.segmentKind;
    const segmentKind: SceneSourceSegmentKind =
      segmentKindRaw === "action" ||
      segmentKindRaw === "dialogue" ||
      segmentKindRaw === "narration"
        ? segmentKindRaw
        : canonical?.segmentKind ??
          (kind === "dialogue"
            ? "dialogue"
            : kind === "action"
              ? "action"
              : "narration");
    events.push({
      id,
      order: Number.isFinite(order) ? order : index + 1,
      sourceMessageId,
      sourceRole,
      kind,
      actor,
      text,
      segmentKind,
    });
  }
  return { ok: true, events };
}

function canonicalEventTimelineSignature(events: readonly SceneEvent[]): string {
  return [...events]
    .sort((left, right) => left.order - right.order)
    .map(
      (event) =>
        `${event.sourceMessageId}:${event.sourceRole}:${event.kind}:${event.actor}:${event.text}`
    )
    .join("\n");
}

function eventsMatchCanonical(
  submitted: readonly SceneEvent[],
  canonical: readonly SceneEvent[]
): boolean {
  if (submitted.length !== canonical.length) return false;
  const orderedSubmitted = [...submitted].sort((left, right) => left.order - right.order);
  const orderedCanonical = [...canonical].sort((left, right) => left.order - right.order);
  for (let index = 0; index < orderedCanonical.length; index += 1) {
    const left = orderedSubmitted[index];
    const right = orderedCanonical[index];
    if (!left || !right) return false;
    if (
      left.id !== right.id ||
      left.sourceMessageId !== right.sourceMessageId ||
      left.sourceRole !== right.sourceRole ||
      left.kind !== right.kind ||
      left.actor !== right.actor ||
      left.text !== right.text
    ) {
      return false;
    }
  }
  return true;
}

function validatePanelVisualCoverage(
  panels: readonly ScenePanel[],
  canonicalEvents: readonly SceneEvent[],
  eventsById: ReadonlyMap<string, SceneEvent>
): ScenePlanValidation | { ok: true } {
  const requiredVisual = visualEvents(canonicalEvents);
  const requiredIds = new Set(requiredVisual.map((event) => event.id));
  const usedVisual = new Set<string>();
  let lastEventOrder = 0;

  for (const panel of panels) {
    for (const id of panel.sourceEventIds) {
      const event = eventsById.get(id);
      if (!event) return { ok: false, reason: "panel sourceEvent missing" };
      if (event.kind === "assistant_echo") {
        return { ok: false, reason: "assistant_echo used as visual beat" };
      }
      if (event.order < lastEventOrder) {
        return { ok: false, reason: "panel chronology reversed" };
      }
      lastEventOrder = event.order;
      if (usedVisual.has(event.id)) {
        return { ok: false, reason: "source event duplicated across panels" };
      }
      usedVisual.add(event.id);
    }
  }

  if (usedVisual.size !== requiredIds.size) {
    return { ok: false, reason: "panel visual event omission" };
  }
  for (const id of requiredIds) {
    if (!usedVisual.has(id)) {
      return { ok: false, reason: "panel visual event omission" };
    }
  }
  return { ok: true };
}

function dialogueOwnershipMatches(
  speaker: SceneDialogueSpeaker,
  event: SceneEvent
): boolean {
  if (speaker === "persona") {
    return event.actor === "persona" && event.sourceRole === "user";
  }
  if (speaker === "character") {
    return event.actor === "character" && event.sourceRole === "assistant";
  }
  return true;
}

export type ScenePlanIntent = "general" | "trpg_illustration";

export const TRPG_ILLUSTRATION_MAX_HERO_EVENT_IDS = 4;

export type ScenePlanValidation =
  | { ok: true; plan: ScenePlan }
  | { ok: false; reason: string };

export type ValidateScenePlanOptions = {
  /** When false (default), AI/planner output may not declare provenance=user_edit. */
  allowUserEdits?: boolean;
  personaName?: string;
  characterName?: string;
  contentKind?: ContentKind;
  scenePlanIntent?: ScenePlanIntent;
};

export function validateScenePlan(
  raw: unknown,
  messages: readonly SceneSourceMessage[],
  opts: ValidateScenePlanOptions = {}
): ScenePlanValidation {
  const allowUserEdits = opts.allowUserEdits === true;
  if (!raw || typeof raw !== "object") {
    return { ok: false, reason: "scene plan missing" };
  }
  const source = raw as Record<string, unknown>;
  const canonicalEvents = extractDeterministicEvents(messages);
  const eventsById = new Map(canonicalEvents.map((event) => [event.id, event]));

  const eventsRaw = Array.isArray(source.events) ? source.events : null;
  if (eventsRaw?.length) {
    const parsed = parseSubmittedEvents(eventsRaw, eventsById);
    if (!parsed.ok) return parsed;
    if (!eventsMatchCanonical(parsed.events, canonicalEvents)) {
      if (parsed.events.length !== canonicalEvents.length) {
        return { ok: false, reason: "event omission" };
      }
      const orderedSubmitted = [...parsed.events].sort((left, right) => left.order - right.order);
      const orderedCanonical = [...canonicalEvents].sort((left, right) => left.order - right.order);
      const hasFalseEcho = orderedSubmitted.some((event, index) => {
        const canonical = orderedCanonical[index];
        return (
          canonical &&
          event.kind === "assistant_echo" &&
          canonical.kind !== "assistant_echo"
        );
      });
      if (hasFalseEcho) {
        return { ok: false, reason: "assistant_echo not allowed from planner" };
      }
      return { ok: false, reason: "canonical event mismatch" };
    }
  }

  const panelCount = Number(source.recommendedPanelCount);
  const panelsRaw = Array.isArray(source.panels) ? source.panels : null;
  if (!panelsRaw?.length) return { ok: false, reason: "panels missing" };
  const count = panelsRaw.length;
  if (count !== 2 && count !== 3 && count !== 4) {
    return { ok: false, reason: "panel count invalid" };
  }
  if (Number.isFinite(panelCount) && panelCount !== 2 && panelCount !== 3 && panelCount !== 4) {
    return { ok: false, reason: "recommendedPanelCount invalid" };
  }

  const panels: ScenePanel[] = [];
  for (const [index, row] of panelsRaw.entries()) {
    if (!row || typeof row !== "object") return { ok: false, reason: "panel invalid" };
    const item = row as Record<string, unknown>;
    const sourceEventIds = Array.isArray(item.sourceEventIds)
      ? item.sourceEventIds.map((id) => cleanLine(id, 24)).filter(Boolean)
      : [];

    const dialogueRaw = Array.isArray(item.dialogue) ? item.dialogue : [];
    const dialogue: SceneDialogue[] = [];
    for (const lineRaw of dialogueRaw) {
      if (!lineRaw || typeof lineRaw !== "object") continue;
      const line = lineRaw as Record<string, unknown>;
      const speaker = line.speaker;
      if (speaker !== "persona" && speaker !== "character" && speaker !== "other") {
        return { ok: false, reason: "dialogue speaker invalid" };
      }
      const text = cleanLine(line.text, 160);
      if (!text) continue;
      const provenance = line.provenance === "user_edit" ? "user_edit" : "source";
      if (provenance === "user_edit") {
        if (!allowUserEdits) {
          return { ok: false, reason: "user_edit not allowed from planner" };
        }
      } else {
        const sourceEventId = cleanLine(line.sourceEventId, 24);
        if (!sourceEventId) {
          return { ok: false, reason: "dialogue sourceEventId missing" };
        }
        const linked = eventsById.get(sourceEventId);
        if (!linked || linked.kind !== "dialogue") {
          return { ok: false, reason: "dialogue sourceEvent mismatch" };
        }
        if (linked.text !== text) {
          return { ok: false, reason: "dialogue text mismatch" };
        }
        if (!dialogueOwnershipMatches(speaker, linked)) {
          return { ok: false, reason: "dialogue speaker ownership mismatch" };
        }
      }
      dialogue.push({
        speaker,
        text,
        sourceEventId:
          provenance === "source"
            ? cleanLine(line.sourceEventId, 24) || undefined
            : typeof line.sourceEventId === "string"
              ? line.sourceEventId
              : undefined,
        provenance,
      });
    }

    panels.push({
      index: index + 1,
      sourceEventIds,
      situation: (() => {
        const panelEvents = sourceEventIds
          .map((id) => eventsById.get(id))
          .filter((event): event is SceneEvent => event !== undefined);
        const derived = buildUserFacingVisualDescription(
          panelEvents,
          cleanLine(source.sceneBackground, 200)
        );
        const raw = cleanLine(item.situation, 240);
        if (allowUserEdits && raw) return raw;
        return derived;
      })(),
      backgroundOverride: cleanLine(item.backgroundOverride, 160) || undefined,
      personaAction: cleanLine(item.personaAction, 160) || undefined,
      characterAction: cleanLine(item.characterAction, 160) || undefined,
      dialogue,
    });
  }

  const coverage = validatePanelVisualCoverage(panels, canonicalEvents, eventsById);
  if (!coverage.ok) return coverage;

  const heroEventIds = Array.isArray(source.heroEventIds)
    ? source.heroEventIds.map((id) => cleanLine(id, 24)).filter(Boolean)
    : [];
  for (const id of heroEventIds) {
    const hero = eventsById.get(id);
    if (!hero) return { ok: false, reason: "heroEventIds invalid" };
    if (hero.kind === "assistant_echo") {
      return { ok: false, reason: "hero uses assistant_echo" };
    }
  }

  const recommended: ScenePanelCount =
    panelCount === 2 || panelCount === 3 || panelCount === 4 ? panelCount : count;

  const usableVisual = visualEvents(canonicalEvents);
  const defaultHero = usableVisual.slice(0, Math.min(3, usableVisual.length)).map((event) => event.id);

  const resolvedHeroIds = heroEventIds.length ? heroEventIds : defaultHero;
  const heroEventsForDescription = resolvedHeroIds
    .map((id) => eventsById.get(id))
    .filter((event): event is SceneEvent => event !== undefined);

  const castMentionsRaw = Array.isArray(source.castMentions) ? source.castMentions : [];
  const castMentionsParsed = castMentionsRaw
    .map((item): SceneCastMention | null => {
      if (!item || typeof item !== "object") return null;
      const row = item as Record<string, unknown>;
      const name = cleanLine(row.name, 24);
      const sourceEventIds = Array.isArray(row.sourceEventIds)
        ? row.sourceEventIds.map((id) => cleanLine(id, 24)).filter(Boolean)
        : [];
      const actorEventIds = Array.isArray(row.actorEventIds)
        ? row.actorEventIds.map((id) => cleanLine(id, 24)).filter(Boolean)
        : [];
      if (!name || !sourceEventIds.length) return null;
      return {
        name,
        sourceEventIds,
        ...(actorEventIds.length ? { actorEventIds } : {}),
      };
    })
    .filter((item): item is SceneCastMention => Boolean(item));
  const reservedNames = [opts.personaName, opts.characterName].filter(
    (name): name is string => Boolean(name?.trim())
  );
  const castMentions = castMentionsParsed.length
    ? validateCastMentions(castMentionsParsed, canonicalEvents, reservedNames)
    : undefined;

  return {
    ok: true,
    plan: {
      sceneBackground: cleanLine(source.sceneBackground, 200),
      atmosphere: cleanLine(source.atmosphere, 120) || undefined,
      events: canonicalEvents,
      heroEventIds: resolvedHeroIds,
      heroScene: (() => {
        const derived = buildUserFacingVisualDescription(
          heroEventsForDescription,
          cleanLine(source.sceneBackground, 200)
        );
        const raw = cleanLine(source.heroScene, 320);
        if (allowUserEdits && raw) return raw;
        return derived;
      })(),
      recommendedPanelCount: recommended,
      panels,
      castMentions,
    },
  };
}

export function buildScenePlanPrompt(opts: {
  contentKind?: ContentKind;
  scenePlanIntent?: ScenePlanIntent;
  characterName: string;
  personaName: string;
  messages: readonly SceneSourceMessage[];
}): string {
  const contentKind = opts.contentKind ?? "character";
  const scenePlanIntent = opts.scenePlanIntent ?? "general";
  const canonicalEvents = extractDeterministicEvents(opts.messages);
  const visual = visualEvents(canonicalEvents);
  const identityLines =
    contentKind === "simulation"
      ? [`Simulation title (NOT A PERSON): ${opts.characterName}`]
      : [`Chat character name: ${opts.characterName}`];
  return [
    "You group server-owned canonical events into a Scene Plan for Korean chat-roleplay illustration and comic generation.",
    ...identityLines,
    `User persona name: ${opts.personaName}`,
    "CANONICAL EVENTS (server-owned timeline — use these IDs only; do not add, omit, reorder, or reclassify):",
    JSON.stringify(canonicalEvents, null, 2),
    "Return JSON only, no markdown fences, with this exact schema:",
    JSON.stringify({
      sceneBackground: "shared place / time / lighting",
      atmosphere: "optional mood",
      heroEventIds: visual.slice(0, 2).map((event) => event.id),
      heroScene: "one-image summary of selected hero beats",
      recommendedPanelCount: 2,
      castMentions: [
        {
          name: "supporting name from source only",
          sourceEventIds: ["E2"],
          actorEventIds: ["E2"],
        },
      ],
      panels: [
        {
          index: 1,
          sourceEventIds: visual.slice(0, 2).map((event) => event.id),
          situation: "what happens in this cut",
          backgroundOverride: "",
          personaAction: "optional presentation-only action wording",
          characterAction: "optional presentation-only reaction wording",
          dialogue: [
            {
              speaker: "persona",
              text: "verbatim spoken line from canonical dialogue event",
              sourceEventId: "E1",
              provenance: "source",
            },
          ],
        },
      ],
    }),
    "Rules:",
    "1. CANONICAL EVENTS are fixed. Do not return an events array. Never invent, omit, reorder, or reclassify events.",
    "2. assistant_echo classification is server-owned. Never assign or change event kinds.",
    "3. Group adjacent canonical events into 2, 3, or 4 panels. Every visual canonical event must appear exactly once across panels, in chronological order. assistant_echo is never a panel beat.",
    "4. Never invent user dialogue. USER spoken dialogue may only reference canonical dialogue events via sourceEventId.",
    "5. CHARACTER spoken dialogue may only reference canonical dialogue events via sourceEventId.",
    "6. Silent panels with empty dialogue are valid. Do not invent filler speech.",
    "7. sceneBackground is the shared default location. Add backgroundOverride only when place/time actually changes.",
    "8. personaAction / characterAction are presentation-only. They must not rewrite canonical event text.",
    "9. Do not describe hair color, hair part, bangs, iris, pupil, outfit identity, or relative height. Those belong to other owners.",
    "10. heroEventIds may select a subset of canonical visual events for a single illustration. assistant_echo is forbidden in heroEventIds. heroEventIds must NOT copy every panel sourceEventId — pick only the beats needed for one still image.",
    "11. heroScene and panel situation are visual-only summaries. Never include verbatim spoken dialogue — dialogue belongs only in panel dialogue arrays.",
    "12. provenance=source dialogue must reference the exact matching dialogue canonical event via sourceEventId.",
    "13. castMentions is optional supporting-name suggestions only. Each name must appear verbatim in at least one linked sourceEventId event text. Never force inclusion.",
    "14. CAST MENTIONS — separate presence evidence from actor attribution:",
    "   sourceEventIds: events where the supporting character is present, named, addressed, targeted, or otherwise scene-relevant (candidate detection evidence).",
    "   actorEventIds: ONLY events where that supporting character is the actual acting or speaking subject (final event-subject binding input).",
    "   actorEventIds must be a subset of sourceEventIds. Omit actorEventIds or use [] when the character is only looked at, touched, spoken to, mentioned, observed, or the object of another person's action.",
    '   Example — "태형이 이현을 바라봤다." for 이현: sourceEventIds=[that event id], actorEventIds=[].',
    '   Example — "이현이 손을 흔들었다." for 이현: sourceEventIds=[that event id], actorEventIds=[that event id].',
    "   Example — pronoun continuation: when coreference to the same supporting character is unambiguous across two canonical events, both ids may appear in sourceEventIds and actorEventIds.",
    "   Do NOT put an event in actorEventIds merely because the character is looked at, touched, spoken to, mentioned, observed, or acted upon by someone else.",
    ...(scenePlanIntent === "trpg_illustration"
      ? [
          "TRPG ILLUSTRATION MODE (single still image):",
          `heroEventIds MUST contain 1–${TRPG_ILLUSTRATION_MAX_HERO_EVENT_IDS} visual events forming ONE drawable moment in the same immediate action/reaction cluster.`,
          "Do NOT select the whole turn, every panel beat, post-action rest, corridor survey, or GM next-choice prompt unless that choice moment is explicitly the focus.",
          "Panel coverage rules still apply to panels only. Choosing a hero subset is NOT omitting canonical events from the server timeline.",
        ]
      : []),
    "SOURCE MESSAGES:",
    JSON.stringify(opts.messages, null, 2),
  ].join("\n\n");
}

export type ScenePresentationVisibility = {
  personaVisible: boolean;
};

export const DEFAULT_SCENE_PRESENTATION_VISIBILITY: ScenePresentationVisibility = {
  personaVisible: true,
};

const PERSONA_EXCLUDED_PANEL_SITUATION_FALLBACK =
  "Off-camera context only; no additional visible person.";

const PERSONA_EXCLUDED_VISIBLE_CAST_CONTRACT = [
  "VISIBLE CAST IS AUTHORITATIVE.",
  "The user/persona is off-camera and must not appear as a body, face, silhouette, reflection, duplicate, or additional person.",
  "Any user/persona mention in context/background is off-camera context only.",
].join(" ");

function isPersonaOwnedEvent(event: SceneEvent): boolean {
  return event.sourceRole === "user" && event.actor === "persona";
}

function stripPersonaOwnedTexts(raw: string, plan: ScenePlan): string {
  let text = raw;
  for (const event of plan.events) {
    if (isPersonaOwnedEvent(event) && event.text) {
      text = text.split(event.text).join(" ");
    }
  }
  return normalizeSceneBriefWhitespace(text);
}

function visiblePanelCanonicalEvents(panel: ScenePanel, plan: ScenePlan): string {
  const eventsById = new Map(plan.events.map((event) => [event.id, event]));
  const events = panel.sourceEventIds
    .map((id) => eventsById.get(id))
    .filter((event): event is SceneEvent => event !== undefined && !isPersonaOwnedEvent(event));
  return buildUserFacingVisualDescription(events);
}

function visiblePlanCanonicalEvents(plan: ScenePlan): string {
  const events = visualEvents(plan.events).filter((event) => !isPersonaOwnedEvent(event));
  return buildUserFacingVisualDescription(events);
}

function projectVisibleBackground(
  plan: ScenePlan,
  visibility: ScenePresentationVisibility
): string {
  if (visibility.personaVisible) return plan.sceneBackground;
  const projectedRaw = stripPersonaOwnedTexts(plan.sceneBackground, plan);
  if (projectedRaw) return projectedRaw;
  const fromEvents = visiblePlanCanonicalEvents(plan);
  if (fromEvents) return fromEvents;
  return PERSONA_EXCLUDED_PANEL_SITUATION_FALLBACK;
}

function projectScenePresentationField(
  raw: string,
  plan: ScenePlan,
  panel: ScenePanel | null,
  visibility: ScenePresentationVisibility
): string {
  if (visibility.personaVisible) return raw;
  const projectedRaw = stripPersonaOwnedTexts(raw, plan);
  if (projectedRaw) return projectedRaw;
  if (panel) {
    const fromPanelEvents = visiblePanelCanonicalEvents(panel, plan);
    if (fromPanelEvents) return fromPanelEvents;
  }
  return projectVisibleBackground(plan, visibility);
}

function projectHeroScene(
  plan: ScenePlan,
  visibleHeroEvents: readonly SceneEvent[],
  projectedBackground: string,
  visibility: ScenePresentationVisibility
): string {
  if (visibility.personaVisible) return plan.heroScene;
  const projectedRaw = stripPersonaOwnedTexts(plan.heroScene, plan);
  if (projectedRaw) return projectedRaw;
  const fromEvents = buildUserFacingVisualDescription(visibleHeroEvents);
  if (fromEvents) return fromEvents;
  return projectedBackground;
}

/** Illustration generation hero scene with visibility projection — preview parity owner. */
function projectGenerationAuthoritativeHeroScene(
  plan: ScenePlan,
  visibility: ScenePresentationVisibility
): string {
  const heroEvents = plan.events.filter((event) => plan.heroEventIds.includes(event.id));
  const visibleHeroEvents = visibility.personaVisible
    ? heroEvents
    : heroEvents.filter((event) => !isPersonaOwnedEvent(event));
  return projectHeroScene(
    plan,
    visibleHeroEvents,
    projectVisibleBackground(plan, visibility),
    visibility
  );
}

export function resolveScenePresentationVisibility(opts: {
  contentKind?: ContentKind;
  castManifest?: {
    subjects: readonly { role: string; included: boolean }[];
  } | null;
}): ScenePresentationVisibility {
  if (opts.contentKind !== "simulation") {
    return DEFAULT_SCENE_PRESENTATION_VISIBILITY;
  }
  const personaSelected = opts.castManifest?.subjects.some(
    (subject) => subject.role === "persona" && subject.included
  );
  return { personaVisible: Boolean(personaSelected) };
}

export function formatApprovedScenePlanForIllustration(
  plan: ScenePlan,
  visibility: ScenePresentationVisibility = DEFAULT_SCENE_PRESENTATION_VISIBILITY
): string {
  const heroEvents = plan.events.filter((event) => plan.heroEventIds.includes(event.id));
  const visibleHeroEvents = visibility.personaVisible
    ? heroEvents
    : heroEvents.filter((event) => !isPersonaOwnedEvent(event));
  const offCameraEvents = visibility.personaVisible
    ? []
    : plan.events.filter((event) => event.sourceRole === "user");
  const projectedBackground = projectVisibleBackground(plan, visibility);
  const dialogue = visibleHeroEvents
    .filter(
      (event) =>
        event.kind === "dialogue" &&
        (visibility.personaVisible || event.actor !== "persona")
    )
    .map((event) => `${event.actor}: “${event.text}”`);
  const heroScene = projectHeroScene(plan, visibleHeroEvents, projectedBackground, visibility);
  return [
    !visibility.personaVisible ? PERSONA_EXCLUDED_VISIBLE_CAST_CONTRACT : "",
    `Background: ${projectedBackground}`,
    plan.atmosphere ? `Atmosphere: ${plan.atmosphere}` : "",
    `Hero scene: ${heroScene}`,
    visibleHeroEvents.length
      ? `Hero beats:\n${visibleHeroEvents.map((event) => `- ${event.kind}: ${event.text}`).join("\n")}`
      : "",
    offCameraEvents.length
      ? `Off-camera context only (do not render as a visible person):\n${offCameraEvents
          .map((event) => `- ${event.text}`)
          .join("\n")}`
      : "",
    dialogue.length
      ? `Key dialogue (acting/emotion only — do not render as readable text):\n${dialogue.join("\n")}`
      : visibility.personaVisible
        ? "No spoken dialogue — express the beat through body language."
        : "",
  ]
    .filter(Boolean)
    .join("\n");
}

function visiblePanelSituation(
  panel: ScenePanel,
  plan: ScenePlan,
  visibility: ScenePresentationVisibility
): string {
  if (visibility.personaVisible) return panel.situation;
  const projectedRaw = stripPersonaOwnedTexts(panel.situation, plan);
  if (projectedRaw) return projectedRaw;
  const fromPanelEvents = visiblePanelCanonicalEvents(panel, plan);
  if (fromPanelEvents) return fromPanelEvents;
  return projectVisibleBackground(plan, visibility);
}

export type ProjectedComicPanelBeat = {
  situation: string;
  background: string;
  personaAction?: string;
  characterAction?: string;
  dialogue: SceneDialogue[];
};

/** Shared comic projection owner — used by legacy formatter and panel-spec compiler. */
export function projectComicPanelBeat(
  plan: ScenePlan,
  panel: ScenePanel,
  visibility: ScenePresentationVisibility
): ProjectedComicPanelBeat {
  return {
    situation: visiblePanelSituation(panel, plan, visibility),
    background: projectScenePresentationField(
      panel.backgroundOverride || plan.sceneBackground,
      plan,
      panel,
      visibility
    ),
    personaAction:
      visibility.personaVisible && panel.personaAction ? panel.personaAction : undefined,
    characterAction: panel.characterAction || undefined,
    dialogue: panel.dialogue
      .filter((line) => visibility.personaVisible || line.speaker !== "persona")
      .map((line) => ({
        ...line,
        text: normalizeDialogueTextForOutput(line.text),
      }))
      .filter((line) => line.text),
  };
}

export function projectComicSharedContext(
  plan: ScenePlan,
  visibility: ScenePresentationVisibility = DEFAULT_SCENE_PRESENTATION_VISIBILITY
): {
  sharedBackground: string;
  offCameraEvents: SceneEvent[];
} {
  return {
    sharedBackground: projectVisibleBackground(plan, visibility),
    offCameraEvents: visibility.personaVisible
      ? []
      : plan.events.filter((event) => event.sourceRole === "user"),
  };
}

export function formatApprovedScenePlanForComic(
  plan: ScenePlan,
  visibility: ScenePresentationVisibility = DEFAULT_SCENE_PRESENTATION_VISIBILITY
): string {
  const { sharedBackground: projectedSharedBackground, offCameraEvents } =
    projectComicSharedContext(plan, visibility);
  const panels = plan.panels
    .map((panel) => {
      const beat = projectComicPanelBeat(plan, panel, visibility);
      const dialogue = beat.dialogue
        .map((line) => `${line.speaker}: “${line.text}”`)
        .join(" | ");
      return [
        `PANEL ${panel.index}`,
        `Situation: ${beat.situation}`,
        `Background: ${beat.background}`,
        beat.personaAction ? `Persona action: ${beat.personaAction}` : "",
        beat.characterAction ? `Character action: ${beat.characterAction}` : "",
        `Exact Korean text: ${dialogue || "No speech bubble"}`,
      ]
        .filter(Boolean)
        .join("\n");
    })
    .join("\n\n");
  return [
    !visibility.personaVisible ? PERSONA_EXCLUDED_VISIBLE_CAST_CONTRACT : "",
    `Shared background: ${projectedSharedBackground}`,
    plan.atmosphere ? `Atmosphere: ${plan.atmosphere}` : "",
    offCameraEvents.length
      ? [
          "OFF-CAMERA CONTEXT ONLY",
          "Do not render the user/persona as a visible person.",
          offCameraEvents.map((event) => `- ${event.text}`).join("\n"),
        ].join("\n")
      : "",
    `Panel count: ${plan.panels.length}`,
    panels,
  ]
    .filter(Boolean)
    .join("\n\n");
}

/** User-facing compact preview limits — display only; generation canonical fields unchanged. */
export const COMPACT_PREVIEW_SITUATION_MAX = 72;
export const COMPACT_PREVIEW_KEY_ACTION_MAX = 96;
export const COMPACT_PREVIEW_BACKGROUND_MAX = 48;
export const COMPACT_PREVIEW_DIALOGUE_VISIBLE_LINES = 2;
export const COMPACT_PREVIEW_DIALOGUE_LINE_MAX = 56;

export function truncateCompactPreviewText(text: string, maxChars: number): string {
  const trimmed = text.replace(/\s+/g, " ").trim();
  if (!trimmed) return "";
  if (trimmed.length <= maxChars) return trimmed;
  const slice = trimmed.slice(0, maxChars);
  const lastSpace = slice.lastIndexOf(" ");
  const clipped = lastSpace > Math.floor(maxChars * 0.55) ? slice.slice(0, lastSpace) : slice;
  return `${clipped.trimEnd()}…`;
}

function compactVisualBeatFromEvents(
  events: readonly SceneEvent[],
  fallback: string,
  _maxChars: number
): string {
  const ordered = events.filter((event) => event.kind !== "assistant_echo");
  const action = ordered.find((event) => event.kind === "action" || event.kind === "reaction");
  if (action?.text.trim()) {
    return projectCompleteVisualBeat(action.text);
  }
  const environment = ordered.find((event) => event.kind === "environment");
  if (environment?.text.trim()) {
    return projectCompleteVisualBeat(environment.text);
  }
  const joined = buildUserFacingVisualDescription(ordered, fallback);
  return projectCompleteVisualBeat(joined || fallback);
}

function normalizeScenePreviewCompareText(text: string): string {
  return text.replace(/\s+/g, " ").trim();
}

function panelEventsInOrder(plan: ScenePlan, panel: ScenePanel): SceneEvent[] {
  const eventsById = new Map(plan.events.map((event) => [event.id, event]));
  return panel.sourceEventIds
    .map((id) => eventsById.get(id))
    .filter((event): event is SceneEvent => event !== undefined);
}

function canonicalDerivedPanelSituation(plan: ScenePlan, panel: ScenePanel): string {
  return normalizeScenePreviewCompareText(
    buildUserFacingVisualDescription(panelEventsInOrder(plan, panel), plan.sceneBackground)
  );
}

function heroSceneMatchesCanonicalDerived(plan: ScenePlan): boolean {
  return (
    normalizeScenePreviewCompareText(plan.heroScene) ===
    normalizeScenePreviewCompareText(projectUserFacingHeroScene(plan))
  );
}

function panelSituationMatchesCanonicalDerived(plan: ScenePlan, panel: ScenePanel): boolean {
  return (
    normalizeScenePreviewCompareText(panel.situation) ===
    canonicalDerivedPanelSituation(plan, panel)
  );
}

export type LdCompactPreviewSummary = {
  background: string;
  keyAction: string;
  atmosphere?: string;
};

/** LD compact storyboard preview — separate from generation `heroScene` owner. */
export function projectLdCompactPreviewSummary(
  plan: ScenePlan,
  visibility: ScenePresentationVisibility = DEFAULT_SCENE_PRESENTATION_VISIBILITY
): LdCompactPreviewSummary {
  const heroEvents = plan.events.filter((event) => plan.heroEventIds.includes(event.id));
  const visibleHeroEvents = visibility.personaVisible
    ? heroEvents
    : heroEvents.filter((event) => !isPersonaOwnedEvent(event));

  const background = truncateCompactPreviewText(
    projectVisibleBackground(plan, visibility),
    COMPACT_PREVIEW_BACKGROUND_MAX
  );
  const keyAction = heroSceneMatchesCanonicalDerived(plan)
    ? compactVisualBeatFromEvents(
        visibleHeroEvents,
        plan.heroScene,
        COMPACT_PREVIEW_KEY_ACTION_MAX
      )
    : truncateCompactPreviewText(
        projectGenerationAuthoritativeHeroScene(plan, visibility),
        COMPACT_PREVIEW_KEY_ACTION_MAX
      );
  const atmosphere = plan.atmosphere?.trim()
    ? truncateCompactPreviewText(plan.atmosphere, COMPACT_PREVIEW_SITUATION_MAX)
    : undefined;

  return { background, keyAction, atmosphere };
}

/** Comic panel compact storyboard line — separate from generation `panel.situation` owner. */
export function projectComicPanelCompactSituation(
  plan: ScenePlan,
  panel: ScenePanel,
  visibility: ScenePresentationVisibility = DEFAULT_SCENE_PRESENTATION_VISIBILITY
): string {
  if (!panelSituationMatchesCanonicalDerived(plan, panel)) {
    return projectCompleteVisualBeat(
      projectComicPanelBeat(plan, panel, visibility).situation
    );
  }

  const panelEvents = panelEventsInOrder(plan, panel);
  const visibleEvents = visibility.personaVisible
    ? panelEvents
    : panelEvents.filter((event) => !isPersonaOwnedEvent(event));

  const fromEvents = compactVisualBeatFromEvents(
    visibleEvents,
    panel.situation,
    COMPACT_PREVIEW_SITUATION_MAX
  );
  if (fromEvents) return fromEvents;

  return projectCompleteVisualBeat(
    projectComicPanelBeat(plan, panel, visibility).situation
  );
}

export type ComicPanelCompactDialogueLine = {
  speaker: SceneDialogueSpeaker;
  text: string;
};

export type ComicPanelCompactDialoguePreview = {
  previewLines: ComicPanelCompactDialogueLine[];
  hiddenCount: number;
  totalVisible: number;
};

/** Comic panel compact dialogue preview — read-only; canonical `panel.dialogue` unchanged. */
export function projectComicPanelCompactDialoguePreview(
  panel: ScenePanel,
  visibility: ScenePresentationVisibility = DEFAULT_SCENE_PRESENTATION_VISIBILITY,
  maxLines: number = COMPACT_PREVIEW_DIALOGUE_VISIBLE_LINES
): ComicPanelCompactDialoguePreview {
  const visible = panel.dialogue.filter(
    (line) =>
      line.text.trim() &&
      (visibility.personaVisible || line.speaker !== "persona")
  );
  const previewLines = visible.slice(0, maxLines).map((line) => ({
    speaker: line.speaker,
    text: normalizeDialogueTextForOutput(line.text),
  }));
  return {
    previewLines,
    hiddenCount: Math.max(0, visible.length - maxLines),
    totalVisible: visible.length,
  };
}

export function collectApprovedComicText(
  plan: ScenePlan,
  visibility: ScenePresentationVisibility = DEFAULT_SCENE_PRESENTATION_VISIBILITY
): string[] {
  return Array.from(
    new Set(
      plan.panels.flatMap((panel) =>
        panel.dialogue
          .filter((line) => visibility.personaVisible || line.speaker !== "persona")
          .map((line) => normalizeDialogueTextForOutput(line.text))
          .filter(Boolean)
      )
    )
  );
}

export function isScenePanelCount(value: unknown): value is ScenePanelCount {
  return value === 2 || value === 3 || value === 4;
}

export function scenePlanHasRawChatLeak(prompt: string): boolean {
  return (
    /Original prose context/i.test(prompt) ||
    /SOURCE PROSE/i.test(prompt) ||
    /SELECTED TURN SCENE BRIEF/i.test(prompt) ||
    /SOURCE TURN:/i.test(prompt)
  );
}
