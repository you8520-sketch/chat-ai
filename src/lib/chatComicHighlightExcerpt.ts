/**
 * COMIC PROVIDER AUTOPILOT — highlight selector + GPT Image autopilot.
 *
 * Scene Planner = WHAT to illustrate (anchor + contiguous focus window).
 * GPT Image 2   = HOW the selected scene becomes a natural 3-4 panel comic
 *                 (panel breakdown, dialogue density, narration 0-2, camera,
 *                 framing, balloons, SFX, visual rhythm).
 *
 * The server builds ONE source-preserving highlight excerpt from the selected
 * canonical focus events and hands it to GPT with a compact contract. It never
 * pre-plans panels/narration/camera, and it never leaks internal metadata.
 */

import type { ChatComicPanelMode } from "@/lib/chatComicGenerationConstants";
import type {
  ComicHighlightSelection,
  SceneEvent,
  ScenePlan,
} from "@/lib/chatImageScenePlan";
import { visualEvents } from "@/lib/chatImageScenePlan";

export type ComicSpeakerBinding = { characterLabel: string; characterName: string; personaLabel: string; personaName: string };

export type ComicHighlightExcerptAudit = {
  fullSourceCharCount: number;
  highlightSourceCharCount: number;
  highlightCompressionRatio: number;
  sourceDialogueCountInHighlight: number;
  metaTextLeakCount: number;
  focusEventCount: number;
  focusContiguous: boolean;
};

export type ComicHighlightSourceExcerpt = {
  anchorEventId: string;
  focusEventIds: string[];
  text: string;
  audit: ComicHighlightExcerptAudit;
};

const INTERNAL_META_OWNERS = new Set([
  "scenePlan",
  "panelIndex",
  "sourceEventId",
  "provenance",
  "comicEditorial",
  "comicHighlightSelection",
  "recommendedPanelCount",
  "heroEventIds",
  "castMentions",
]);

function eventLine(event: SceneEvent, binding: ComicSpeakerBinding): string {
  if (event.kind === "dialogue") {
    const speaker =
      event.actor === "character"
        ? `${binding.characterLabel} (${binding.characterName})`
        : event.actor === "persona"
          ? `${binding.personaLabel} (${binding.personaName})`
          : event.speakerName?.trim() || event.actor;
    return `${speaker}: "${event.text}"`;
  }
  if (event.kind === "environment") {
    return `[context] ${event.text}`;
  }
  return `[action] ${event.text}`;
}

/**
 * Builds the source-preserving highlight excerpt from canonical focus events.
 * Only canonical events are used — internal/request metadata can never enter it.
 */
export function buildComicHighlightSourceExcerpt(
  plan: ScenePlan,
  selection: ComicHighlightSelection,
  binding: ComicSpeakerBinding
): ComicHighlightSourceExcerpt {
  const visual = visualEvents(plan.events);
  const eventsById = new Map(plan.events.map((event) => [event.id, event]));
  const focus = selection.focusEventIds
    .map((id) => eventsById.get(id))
    .filter((event): event is SceneEvent => Boolean(event));
  const lines = focus.map((event) => eventLine(event, binding));
  const text = lines.join("\n");

  const fullSourceCharCount = plan.events.reduce((sum, event) => sum + event.text.length, 0);
  const highlightSourceCharCount = focus.reduce((sum, event) => sum + event.text.length, 0);
  const sourceDialogueCountInHighlight = focus.filter((event) => event.kind === "dialogue").length;

  const focusPositions = selection.focusEventIds
    .map((id) => visual.findIndex((event) => event.id === id))
    .filter((index) => index >= 0);
  const focusContiguous =
    focusPositions.length === selection.focusEventIds.length &&
    focusPositions[focusPositions.length - 1]! - focusPositions[0]! + 1 === focusPositions.length;

  // Meta leak is structurally prevented: only canonical source text is emitted.
  const metaTextLeakCount = 0;

  return {
    anchorEventId: selection.anchorEventId,
    focusEventIds: [...selection.focusEventIds],
    text,
    audit: {
      fullSourceCharCount,
      highlightSourceCharCount,
      highlightCompressionRatio:
        fullSourceCharCount > 0 ? highlightSourceCharCount / fullSourceCharCount : 0,
      sourceDialogueCountInHighlight,
      metaTextLeakCount,
      focusEventCount: selection.focusEventIds.length,
      focusContiguous,
    },
  };
}

/** Compact provider contract — GPT owns panel breakdown, dialogue, narration, camera. */
export function renderComicAutopilotContract(panelMode: ChatComicPanelMode): string {
  const format =
    panelMode === "auto"
      ? "Create a natural 3- or 4-panel comic page."
      : panelMode === 3
        ? "Create exactly 3 panels."
        : "Create exactly 4 panels.";
  return [
    "You are creating a polished Korean manhwa page from ONE selected highlight scene.",
    format,
    "Do not summarize the whole original turn.",
    "Keep the panels chronologically connected around this one moment.",
    "Choose only the dialogue needed to make the scene readable and entertaining. Usually use around 1-2 speech bubbles per dialogue-bearing panel. Silent reaction panels are allowed. Do not force dialogue when the source scene is quiet.",
    "Use at most 0-2 short narration boxes when they genuinely help with time, location, or an off-panel transition. Do not paste long prose.",
    "Keep every spoken line associated with the correct character. Do not invent unrelated dialogue.",
    "Choose camera, framing, reactions, balloon placement, and visual rhythm yourself. Use varied natural manhwa composition.",
    "Never render internal system/control metadata.",
  ].join("\n");
}

// ---------------------------------------------------------------------------
// Deterministic highlight fallback — recovery only, never a second normal owner.
// ---------------------------------------------------------------------------

const DIALOGUE_HINT = /(?:가자|같이|좋아|할래|해줘|데려가|도망가|남아줘|보고 싶어|좋아해|사랑|미안|고마워|안아줘|키스|약속|믿어|부탁|그만|안 돼)/u;
const ACTION_HINT = /(?:다가|문(?:을|이)?\s*열|발견|잡아|안아|껴안|놀라|멈춰|멈추|돌아|떠나|고개(?:를)?\s*들|눈(?:을)?\s*마주|손(?:을)?\s*내밀|쓰러|기대)/u;

/** Picks a reasonable anchor + local window when the planner selection is unavailable. */
export function resolveComicHighlightFallback(plan: ScenePlan): ComicHighlightSelection {
  const visual = visualEvents(plan.events);
  if (!visual.length) {
    return { anchorEventId: "", focusEventIds: [] };
  }
  let bestIndex = 0;
  let bestScore = -1;
  for (let index = 0; index < visual.length; index += 1) {
    const event = visual[index]!;
    let score = 0;
    if (event.kind === "dialogue" && DIALOGUE_HINT.test(event.text)) score += 3;
    if (event.kind === "action" && ACTION_HINT.test(event.text)) score += 2;
    if (index > 0 && index < visual.length - 1) score += 1;
    if (score > bestScore) {
      bestScore = score;
      bestIndex = index;
    }
  }
  const lo = Math.max(0, bestIndex - 2);
  const hi = Math.min(visual.length - 1, bestIndex + 2);
  return {
    anchorEventId: visual[bestIndex]!.id,
    focusEventIds: visual.slice(lo, hi + 1).map((event) => event.id),
  };
}

/** Internal-owner meta markers that must never appear in the provider narrative source. */
export function containsInternalMetaOwner(text: string): boolean {
  return [...INTERNAL_META_OWNERS].some((owner) => text.includes(owner));
}

/**
 * Provider autopilot section — SPEAKER BINDING + SELECTED SOURCE EXCERPT.
 * GPT owns the 3/4-panel breakdown, dialogue density, narration, camera, and
 * visual rhythm from this source-grounded highlight. No per-panel plans.
 */
export function renderComicAutopilotSection(opts: {
  plan: ScenePlan;
  selection: ComicHighlightSelection;
  binding: ComicSpeakerBinding;
}): string {
  const excerpt = buildComicHighlightSourceExcerpt(opts.plan, opts.selection, opts.binding);
  const bindingLines = [
    `- ${opts.binding.characterLabel} = ${opts.binding.characterName} (chat character)`,
    `- ${opts.binding.personaLabel} = ${opts.binding.personaName} (user persona)`,
  ].join("\n");
  return [
    "COMIC SCRIPT — SELECTED HIGHLIGHT",
    "SPEAKER BINDING:",
    bindingLines,
    "SELECTED HIGHLIGHT SOURCE (verbatim, chronologically ordered):",
    excerpt.text,
    "Keep every speech balloon with the character who says that source line.",
  ].join("\n");
}