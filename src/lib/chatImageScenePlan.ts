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
    const actions = extractActionSegments(message.text);
    const spoken = spokenLinesForMessage(message);
    const narration = remainderNarration(message.text);

    for (const action of actions) {
      push({
        sourceMessageId: message.id,
        sourceRole: message.role,
        kind: message.role === "assistant" ? "reaction" : "action",
        actor: actorForRole(message.role),
        text: action,
      });
    }
    for (const line of spoken) {
      push({
        sourceMessageId: message.id,
        sourceRole: message.role,
        kind: "dialogue",
        actor: actorForRole(message.role),
        text: line,
      });
    }
    if (
      narration &&
      !spoken.includes(narration) &&
      !actions.includes(narration) &&
      !isSceneActionText(narration)
    ) {
      const previousUserAction = [...events]
        .reverse()
        .find((event) => event.sourceRole === "user" && event.kind === "action");
      const clauses =
        message.role === "assistant" && previousUserAction
          ? splitKoreanClauses(narration)
          : [narration];
      for (const clause of clauses) {
        const isEcho =
          message.role === "assistant" &&
          previousUserAction &&
          textsOverlap(previousUserAction.text, clause);
        push({
          sourceMessageId: message.id,
          sourceRole: message.role,
          kind: isEcho
            ? "assistant_echo"
            : message.role === "assistant"
              ? "reaction"
              : "environment",
          actor: message.role === "assistant" ? "character" : "environment",
          text: clause,
        });
      }
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

function dialogueAllowedForSpeaker(
  messages: readonly SceneSourceMessage[],
  speaker: SceneDialogueSpeaker
): string[] {
  const roles: SceneSourceRole[] =
    speaker === "persona" ? ["user"] : speaker === "character" ? ["assistant"] : ["user", "assistant"];
  return messages
    .filter((message) => roles.includes(message.role))
    .flatMap((message) => spokenLinesForMessage(message));
}

export type ScenePlanValidation =
  | { ok: true; plan: ScenePlan }
  | { ok: false; reason: string };

export function validateScenePlan(
  raw: unknown,
  messages: readonly SceneSourceMessage[]
): ScenePlanValidation {
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

  const ordered = [...events].sort((a, b) => a.order - b.order);
  for (let index = 1; index < ordered.length; index += 1) {
    if (ordered[index]!.order <= ordered[index - 1]!.order) {
      return { ok: false, reason: "event order invalid" };
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
      const event = events.find((candidate) => candidate.id === id);
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
      if (provenance === "source") {
        const allowed = dialogueAllowedForSpeaker(messages, speaker);
        if (speaker === "persona" && !allowed.some((itemText) => itemText.includes(text) || text.includes(itemText))) {
          return { ok: false, reason: "persona dialogue not in user source" };
        }
        if (speaker === "character" && !allowed.some((itemText) => itemText.includes(text) || text.includes(itemText))) {
          return { ok: false, reason: "character dialogue not in assistant source" };
        }
      }
      dialogue.push({
        speaker,
        text,
        sourceEventId: typeof line.sourceEventId === "string" ? line.sourceEventId : undefined,
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
    const hero = events.find((event) => event.id === id);
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
      events,
      heroEventIds: heroEventIds.length
        ? heroEventIds
        : visualEvents(events)
            .slice(0, Math.min(3, events.length))
            .map((event) => event.id),
      heroScene: cleanLine(source.heroScene, 320) || visualEvents(events).slice(0, 3).map((event) => event.text).join(" "),
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
          text: "verbatim or tightly grounded beat",
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
    "2. Never invent user dialogue. USER spoken dialogue may only be copied from user messages. Never paraphrase, complete, or promote assistant-narrated user speech into persona dialogue.",
    "3. CHARACTER spoken dialogue may only be copied from assistant messages.",
    "4. Preserve user actions (*...*, (...), （...）) as action events. Do not drop action-only user turns.",
    "5. If the assistant only recaps the immediately preceding user action, mark that beat kind=assistant_echo. Do not use assistant_echo as its own visual panel beat. Keep the new assistant reaction/action.",
    "6. recommendedPanelCount must be 2, 3, or 4. Silent panels with empty dialogue are valid. Do not invent filler speech.",
    "7. Panel sourceEventIds must stay in chronological order. Do not move a later event before an earlier one.",
    "8. sceneBackground is the shared default location. Add backgroundOverride only when place/time actually changes.",
    "9. Do not describe hair color, hair part, bangs, iris, pupil, outfit identity, or relative height. Those belong to other owners.",
    "10. heroEventIds / heroScene summarize the same events for a single illustration.",
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
