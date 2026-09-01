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

export type SceneEventActor = "persona" | "character" | "other" | "environment";

export type SceneEvent = {
  id: string;
  order: number;
  sourceMessageId: number;
  sourceRole: SceneSourceRole;
  kind: SceneEventKind;
  actor: SceneEventActor;
  text: string;
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

export type SceneSourceSegmentKind = "dialogue" | "action" | "narration";

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
  role: SceneSourceRole
): SceneSourceSegment[] {
  const gap = text.slice(start, end);
  const trimmed = gap.trim();
  if (!trimmed) return [];
  const gapStart = start + gap.indexOf(trimmed);
  const gapEnd = gapStart + trimmed.length;
  if (role === "user") {
    const spoken = cleanLine(trimmed);
    if (!spoken || isSceneActionText(spoken)) return [];
    return [{ start: gapStart, end: gapEnd, kind: "dialogue", text: spoken }];
  }
  const narration = cleanLine(trimmed);
  if (!narration) return [];
  return [{ start: gapStart, end: gapEnd, kind: "narration", text: narration }];
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
  for (const span of marked) {
    if (span.start > cursor) {
      segments.push(...gapSegments(text, cursor, span.start, role));
    }
    segments.push({
      start: span.start,
      end: span.end,
      kind: span.kind,
      text: span.text,
    });
    cursor = span.end;
  }
  if (cursor < text.length) {
    segments.push(...gapSegments(text, cursor, text.length, role));
  }
  return segments;
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
    };
  }
  if (segment.kind === "dialogue") {
    return {
      sourceMessageId: message.id,
      sourceRole: message.role,
      kind: "dialogue",
      actor: actorForRole(message.role),
      text: segment.text,
    };
  }
  const isEcho =
    message.role === "assistant" &&
    previousUserAction != null &&
    textsOverlap(previousUserAction.text, segment.text);
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
    if (!textsOverlap(previous.text, event.text)) return event;
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

function stripDialogueTextsFromSceneText(
  raw: string,
  events: readonly SceneEvent[]
): string {
  let text = normalizeSceneBriefWhitespace(raw);
  for (const event of events) {
    if (event.kind !== "dialogue" || !event.text) continue;
    text = text.split(event.text).join(" ");
    text = text.replace(
      new RegExp(`[“"'‘]${event.text.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}[”"'’]`, "g"),
      " "
    );
  }
  return normalizeSceneBriefWhitespace(text);
}

/** Normalize planner/user scene text to visual-only when dialogue leaked in. */
export function normalizeUserFacingSceneDescription(
  raw: string,
  events: readonly SceneEvent[],
  fallback = ""
): string {
  const stripped = stripDialogueTextsFromSceneText(raw, events);
  if (stripped) return stripped;
  return buildUserFacingVisualDescription(events, fallback);
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
  const persona = events.find((event) => event.actor === "persona" && event.kind !== "dialogue");
  const character = events.find(
    (event) => event.actor === "character" && event.kind !== "dialogue"
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
  const nonDialogueUsable = usable.filter((event) => event.kind !== "dialogue");
  const heroEvents = (nonDialogueUsable.length ? nonDialogueUsable : usable).slice(
    0,
    Math.min(3, nonDialogueUsable.length || usable.length)
  );
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
      const dialogue = (patch.dialogue ?? panel.dialogue).map((line) => {
        const previous = panel.dialogue.find(
          (item) => item.speaker === line.speaker && item.text === line.text
        );
        if (previous && previous.text === line.text && previous.speaker === line.speaker) {
          return previous;
        }
        return { ...line, provenance: "user_edit" as const };
      });
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
  eventsRaw: readonly unknown[]
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
    events.push({
      id,
      order: Number.isFinite(order) ? order : index + 1,
      sourceMessageId,
      sourceRole,
      kind,
      actor,
      text,
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

export type ScenePlanValidation =
  | { ok: true; plan: ScenePlan }
  | { ok: false; reason: string };

export type ValidateScenePlanOptions = {
  /** When false (default), AI/planner output may not declare provenance=user_edit. */
  allowUserEdits?: boolean;
  personaName?: string;
  characterName?: string;
  contentKind?: ContentKind;
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
    const parsed = parseSubmittedEvents(eventsRaw);
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
        if (derived) return derived;
        return normalizeUserFacingSceneDescription(raw, panelEvents, derived);
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
  const defaultHero = usableVisual
    .filter((event) => event.kind !== "dialogue")
    .slice(0, Math.min(3, usableVisual.length))
    .map((event) => event.id);
  if (!defaultHero.length) {
    defaultHero.push(
      ...usableVisual.slice(0, Math.min(3, usableVisual.length)).map((event) => event.id)
    );
  }

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
        if (derived) return derived;
        return normalizeUserFacingSceneDescription(
          raw,
          heroEventsForDescription,
          derived
        );
      })(),
      recommendedPanelCount: recommended,
      panels,
      castMentions,
    },
  };
}

export function buildScenePlanPrompt(opts: {
  contentKind?: ContentKind;
  characterName: string;
  personaName: string;
  messages: readonly SceneSourceMessage[];
}): string {
  const contentKind = opts.contentKind ?? "character";
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
    "10. heroEventIds may select a subset of canonical visual events for a single illustration. assistant_echo is forbidden in heroEventIds.",
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
  return panel.sourceEventIds
    .map((id) => eventsById.get(id))
    .filter((event): event is SceneEvent => event !== undefined && !isPersonaOwnedEvent(event))
    .map((event) => event.text)
    .join(" ")
    .trim();
}

function visiblePlanCanonicalEvents(plan: ScenePlan): string {
  return visualEvents(plan.events)
    .filter((event) => !isPersonaOwnedEvent(event))
    .map((event) => event.text)
    .join(" ")
    .trim();
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
  const fromEvents = visibleHeroEvents.map((event) => event.text).join(" ").trim();
  if (fromEvents) return fromEvents;
  return projectedBackground;
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
    dialogue: panel.dialogue.filter(
      (line) => visibility.personaVisible || line.speaker !== "persona"
    ),
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

export function collectApprovedComicText(
  plan: ScenePlan,
  visibility: ScenePresentationVisibility = DEFAULT_SCENE_PRESENTATION_VISIBILITY
): string[] {
  return Array.from(
    new Set(
      plan.panels.flatMap((panel) =>
        panel.dialogue
          .filter((line) => visibility.personaVisible || line.speaker !== "persona")
          .map((line) => line.text)
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
