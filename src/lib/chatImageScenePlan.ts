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

export type ScenePlan = {
  sceneBackground: string;
  atmosphere?: string;
  events: SceneEvent[];
  heroEventIds: string[];
  heroScene: string;
  recommendedPanelCount: ScenePanelCount;
  panels: ScenePanel[];
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
    situation: events.map((event) => event.text).join(" ").trim() || sceneBackground,
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
  const background =
    usable.find((event) => event.kind === "environment")?.text ||
    messages.map((message) => message.text).join(" ").slice(0, 160) ||
    "대화가 이어지는 장면";
  const groups = groupEventsContiguously(events, resolvedCount);
  const heroEvents = usable.slice(0, Math.min(3, usable.length));
  return {
    sceneBackground: background,
    atmosphere: undefined,
    events,
    heroEventIds: heroEvents.map((event) => event.id),
    heroScene: heroEvents.map((event) => event.text).join(" ").trim() || background,
    recommendedPanelCount,
    panels: groups.map((group, index) =>
      panelFromEvents(index + 1, group, background)
    ),
  };
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

function sourceById(
  messages: readonly SceneSourceMessage[],
  id: number
): SceneSourceMessage | undefined {
  return messages.find((message) => message.id === id);
}

type GroundedSceneEvent = {
  event: SceneEvent;
  messageOrder: number;
  sourceStart: number;
};

function segmentMatchesEvent(
  segment: SceneSourceSegment,
  message: SceneSourceMessage,
  event: SceneEvent
): boolean {
  if (segment.text !== event.text) return false;
  if (event.sourceRole !== message.role) return false;
  if (segment.kind === "dialogue") {
    return event.kind === "dialogue" && event.actor === actorForRole(message.role);
  }
  if (segment.kind === "action") {
    return message.role === "user"
      ? event.kind === "action" && event.actor === "persona"
      : event.kind === "reaction" && event.actor === "character";
  }
  if (message.role === "assistant") {
    return (
      (event.kind === "reaction" ||
        event.kind === "assistant_echo" ||
        event.kind === "environment") &&
      (event.actor === "character" || event.actor === "environment")
    );
  }
  return event.kind === "environment" && event.actor === "environment";
}

function groundSceneEvent(
  event: SceneEvent,
  messages: readonly SceneSourceMessage[]
): GroundedSceneEvent | null {
  const message = sourceById(messages, event.sourceMessageId);
  if (!message) return null;
  const segments = extractOrderedSceneSegments(message.text, message.role);
  for (const segment of segments) {
    if (!segmentMatchesEvent(segment, message, event)) continue;
    return {
      event,
      messageOrder: message.order,
      sourceStart: segment.start,
    };
  }
  return null;
}

function chronologySignature(items: readonly GroundedSceneEvent[]): string {
  return items
    .map(
      (item) =>
        `${item.messageOrder}:${item.sourceStart}:${item.event.sourceMessageId}:${item.event.text}`
    )
    .join("\n");
}

type SourceGroundedEventsResult =
  | { ok: false; reason: string }
  | { ok: true; events: SceneEvent[] };

function normalizeSourceGroundedEvents(
  events: readonly SceneEvent[],
  messages: readonly SceneSourceMessage[]
): SourceGroundedEventsResult {
  const bySubmittedOrder = [...events].sort((left, right) => left.order - right.order);
  const grounded: GroundedSceneEvent[] = [];
  for (const event of bySubmittedOrder) {
    const meta = groundSceneEvent(event, messages);
    if (!meta) {
      return { ok: false, reason: "event text not source-backed" };
    }
    grounded.push(meta);
  }

  const canonical = [...grounded].sort(
    (left, right) =>
      left.messageOrder - right.messageOrder || left.sourceStart - right.sourceStart
  );
  if (chronologySignature(grounded) !== chronologySignature(canonical)) {
    return { ok: false, reason: "event chronology not source-backed" };
  }

  return {
    ok: true,
    events: canonical.map((item, index) => ({
      ...item.event,
      order: index + 1,
    })),
  };
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
  const eventsRaw = Array.isArray(source.events) ? source.events : null;
  if (!eventsRaw?.length) return { ok: false, reason: "events missing" };

  const events: SceneEvent[] = [];
  const seenIds = new Set<string>();
  for (const [index, row] of eventsRaw.entries()) {
    if (!row || typeof row !== "object") return { ok: false, reason: "event invalid" };
    const item = row as Record<string, unknown>;
    const id = cleanLine(item.id, 24) || nextEventId(index);
    if (seenIds.has(id)) return { ok: false, reason: "duplicate event" };
    seenIds.add(id);
    const sourceMessageId = Number(item.sourceMessageId);
    const message = sourceById(messages, sourceMessageId);
    if (!message) return { ok: false, reason: "sourceMessageId missing" };
    const sourceRole = item.sourceRole === "user" || item.sourceRole === "assistant"
      ? item.sourceRole
      : null;
    if (!sourceRole || sourceRole !== message.role) {
      return { ok: false, reason: "sourceRole mismatch" };
    }
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

  const grounded = normalizeSourceGroundedEvents(events, messages);
  if (!grounded.ok) return grounded;
  const normalizedEvents = grounded.events;
  const eventsById = new Map(normalizedEvents.map((event) => [event.id, event]));

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

  const usedVisual = new Set<string>();
  let lastEventOrder = 0;
  const panels: ScenePanel[] = [];
  for (const [index, row] of panelsRaw.entries()) {
    if (!row || typeof row !== "object") return { ok: false, reason: "panel invalid" };
    const item = row as Record<string, unknown>;
    const sourceEventIds = Array.isArray(item.sourceEventIds)
      ? item.sourceEventIds.map((id) => cleanLine(id, 24)).filter(Boolean)
      : [];
    const panelEvents: SceneEvent[] = [];
    for (const id of sourceEventIds) {
      const event = eventsById.get(id);
      if (!event) return { ok: false, reason: "panel sourceEvent missing" };
      if (event.order < lastEventOrder) {
        return { ok: false, reason: "panel chronology reversed" };
      }
      lastEventOrder = event.order;
      if (event.kind === "assistant_echo") {
        return { ok: false, reason: "assistant_echo used as visual beat" };
      }
      if (usedVisual.has(event.id)) {
        return { ok: false, reason: "source event duplicated across panels" };
      }
      usedVisual.add(event.id);
      panelEvents.push(event);
    }

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
      situation: cleanLine(item.situation, 240) || panelEvents.map((event) => event.text).join(" "),
      backgroundOverride: cleanLine(item.backgroundOverride, 160) || undefined,
      personaAction: cleanLine(item.personaAction, 160) || undefined,
      characterAction: cleanLine(item.characterAction, 160) || undefined,
      dialogue,
    });
  }

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

  return {
    ok: true,
    plan: {
      sceneBackground: cleanLine(source.sceneBackground, 200) || "대화가 이어지는 장면",
      atmosphere: cleanLine(source.atmosphere, 120) || undefined,
      events: normalizedEvents,
      heroEventIds: heroEventIds.length
        ? heroEventIds
        : visualEvents(normalizedEvents)
            .slice(0, Math.min(3, normalizedEvents.length))
            .map((event) => event.id),
      heroScene: cleanLine(source.heroScene, 320) || visualEvents(normalizedEvents).slice(0, 3).map((event) => event.text).join(" "),
      recommendedPanelCount: recommended,
      panels,
    },
  };
}

export function buildScenePlanPrompt(opts: {
  characterName: string;
  personaName: string;
  messages: readonly SceneSourceMessage[];
}): string {
  return [
    "You extract a chronological Scene Plan for Korean chat-roleplay illustration and comic generation.",
    `Chat character name: ${opts.characterName}`,
    `User persona name: ${opts.personaName}`,
    "Return JSON only, no markdown fences, with this exact schema:",
    JSON.stringify({
      sceneBackground: "shared place / time / lighting",
      atmosphere: "optional mood",
      events: [
        {
          id: "E1",
          order: 1,
          sourceMessageId: 1,
          sourceRole: "user",
          kind: "action",
          actor: "persona",
          text: "verbatim contiguous excerpt",
        },
      ],
      heroEventIds: ["E1"],
      heroScene: "one-image summary of the hero beats",
      recommendedPanelCount: 2,
      panels: [
        {
          index: 1,
          sourceEventIds: ["E1"],
          situation: "what happens in this cut",
          backgroundOverride: "",
          personaAction: "optional",
          characterAction: "optional",
          dialogue: [
            {
              speaker: "persona",
              text: "verbatim spoken line",
              sourceEventId: "E2",
              provenance: "source",
            },
          ],
        },
      ],
    }),
    "Rules:",
    "1. SOURCE FORMAT is already sanitized. Keep chronology. Do not invent new events.",
    "2. EVENT TEXT must be a verbatim contiguous excerpt from its declared sourceMessageId. Never paraphrase, summarize, or rewrite event text. Summaries belong only in situation, heroScene, sceneBackground, or atmosphere.",
    "3. Never invent user dialogue. USER spoken dialogue may only be copied from user messages. Never paraphrase, complete, or promote assistant-narrated user speech into persona dialogue.",
    "4. CHARACTER spoken dialogue may only be copied from assistant messages.",
    "5. Preserve user actions (*...*, (...), （...）) as action events. Do not drop action-only user turns.",
    "6. If the assistant only recaps the immediately preceding user action, mark that beat kind=assistant_echo. Do not use assistant_echo as its own visual panel beat. Keep the new assistant reaction/action.",
    "7. recommendedPanelCount must be 2, 3, or 4. Silent panels with empty dialogue are valid. Do not invent filler speech.",
    "8. Panel sourceEventIds must stay in chronological order. Do not move a later event before an earlier one.",
    "9. sceneBackground is the shared default location. Add backgroundOverride only when place/time actually changes.",
    "10. Do not describe hair color, hair part, bangs, iris, pupil, outfit identity, or relative height. Those belong to other owners.",
    "11. heroEventIds / heroScene summarize the same events for a single illustration.",
    "12. provenance=source dialogue must reference the exact matching dialogue SceneEvent via sourceEventId.",
    "SOURCE MESSAGES:",
    JSON.stringify(opts.messages, null, 2),
  ].join("\n\n");
}

export function formatApprovedScenePlanForIllustration(plan: ScenePlan): string {
  const heroEvents = plan.events.filter((event) => plan.heroEventIds.includes(event.id));
  const dialogue = heroEvents
    .filter((event) => event.kind === "dialogue")
    .map((event) => `${event.actor}: “${event.text}”`);
  return [
    `Background: ${plan.sceneBackground}`,
    plan.atmosphere ? `Atmosphere: ${plan.atmosphere}` : "",
    `Hero scene: ${plan.heroScene}`,
    heroEvents.length
      ? `Hero beats:\n${heroEvents.map((event) => `- ${event.kind}: ${event.text}`).join("\n")}`
      : "",
    dialogue.length
      ? `Key dialogue (acting/emotion only — do not render as readable text):\n${dialogue.join("\n")}`
      : "No spoken dialogue — express the beat through body language.",
  ]
    .filter(Boolean)
    .join("\n");
}

export function formatApprovedScenePlanForComic(plan: ScenePlan): string {
  const panels = plan.panels
    .map((panel) => {
      const dialogue = panel.dialogue.length
        ? panel.dialogue
            .map((line) => `${line.speaker}: “${line.text}”`)
            .join(" | ")
        : "No speech bubble";
      return [
        `PANEL ${panel.index}`,
        `Situation: ${panel.situation}`,
        `Background: ${panel.backgroundOverride || plan.sceneBackground}`,
        panel.personaAction ? `Persona action: ${panel.personaAction}` : "",
        panel.characterAction ? `Character action: ${panel.characterAction}` : "",
        `Exact Korean text: ${dialogue}`,
      ]
        .filter(Boolean)
        .join("\n");
    })
    .join("\n\n");
  return [
    `Shared background: ${plan.sceneBackground}`,
    plan.atmosphere ? `Atmosphere: ${plan.atmosphere}` : "",
    `Panel count: ${plan.panels.length}`,
    panels,
  ]
    .filter(Boolean)
    .join("\n\n");
}

export function collectApprovedComicText(plan: ScenePlan): string[] {
  return Array.from(
    new Set(
      plan.panels.flatMap((panel) => panel.dialogue.map((line) => line.text).filter(Boolean))
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
