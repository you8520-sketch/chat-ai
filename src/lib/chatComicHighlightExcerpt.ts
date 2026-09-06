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
import { projectTextForSafeImagePrompt } from "@/lib/chatImageSafeVisualProjection";
import { resolveComicProviderReadableTextEligibility } from "@/lib/chatComicPanelSpec";

export type ComicSpeakerBinding = { characterLabel: string; characterName: string; personaLabel: string; personaName: string };

export type ComicHighlightExcerptAudit = {
  fullSourceCharCount: number;
  highlightSourceCharCount: number;
  highlightCompressionRatio: number;
  sourceDialogueCountInHighlight: number;
  /** Proven structural property — the excerpt is built from canonical events only. */
  narrativeSourceOwner: "canonical_events_only";
  focusEventCount: number;
  focusContiguous: boolean;
};

export type ComicHighlightSourceExcerpt = {
  anchorEventId: string;
  focusEventIds: string[];
  text: string;
  audit: ComicHighlightExcerptAudit;
};

/** Reuse the existing provider-readable comic text eligibility owner (no new safety policy). */
function isProviderReadableDialogue(text: string, adultGrounded: boolean, realPersonRestricted: boolean): boolean {
  return resolveComicProviderReadableTextEligibility({ text, adultGrounded, realPersonRestricted });
}

function eventLine(
  event: SceneEvent,
  binding: ComicSpeakerBinding,
  projection: { adultGrounded: boolean; realPersonRestricted: boolean }
): string | null {
  if (event.kind === "dialogue") {
    if (!isProviderReadableDialogue(event.text, projection.adultGrounded, projection.realPersonRestricted)) {
      return null;
    }
    const speaker =
      event.actor === "character"
        ? `${binding.characterLabel} (${binding.characterName})`
        : event.actor === "persona"
          ? `${binding.personaLabel} (${binding.personaName})`
          : event.speakerName?.trim() || event.actor;
    return `${speaker}: "${event.text}"`;
  }
  // Action / environment / narration context → existing safe image-text projection.
  const projected = projectTextForSafeImagePrompt(event.text, { adultGrounded: projection.adultGrounded });
  const text = projected.trim();
  if (!text) return null;
  return event.kind === "environment" ? `[context] ${text}` : `[action] ${text}`;
}

/**
 * Builds the source-preserving highlight excerpt from canonical focus events.
 * Existing provider-safe projection is applied to the provider input ONLY —
 * canonical events are never mutated. Internal/request metadata can never enter it.
 */
export function buildComicHighlightSourceExcerpt(
  plan: ScenePlan,
  selection: ComicHighlightSelection,
  binding: ComicSpeakerBinding,
  safety: { adultGrounded?: boolean; realPersonRestricted?: boolean } = {}
): ComicHighlightSourceExcerpt {
  const visual = visualEvents(plan.events);
  const eventsById = new Map(plan.events.map((event) => [event.id, event]));
  const projection = {
    adultGrounded: safety.adultGrounded ?? false,
    realPersonRestricted: safety.realPersonRestricted ?? false,
  };
  const focus = selection.focusEventIds
    .map((id) => eventsById.get(id))
    .filter((event): event is SceneEvent => Boolean(event));
  const lines = focus
    .map((event) => eventLine(event, binding, projection))
    .filter((line): line is string => Boolean(line));
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
      narrativeSourceOwner: "canonical_events_only",
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
    "Use only spoken lines from the selected source scene. You may omit lines for comic pacing, but do not invent new spoken dialogue.",
    "Usually use around 1-2 speech bubbles per dialogue-bearing panel. Silent reaction panels are allowed. Do not force dialogue when the source scene is quiet.",
    "Use at most 0-2 short narration boxes when they genuinely help with time, location, or an off-panel transition. Do not paste long prose.",
    "Keep every spoken line associated with the correct character.",
    "Choose camera, framing, reactions, balloon placement, and visual rhythm yourself. Use varied natural manhwa composition.",
    "Never render internal system/control metadata, and never render the [action]/[context] prompt markers as visible comic text.",
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

/**
 * Provider autopilot section — SPEAKER BINDING + SELECTED SOURCE EXCERPT.
 * GPT owns the 3/4-panel breakdown, dialogue density, narration, camera, and
 * visual rhythm from this source-grounded highlight. No per-panel plans.
 * Existing provider-safe projection is applied to the provider input.
 */
export function renderComicAutopilotSection(opts: {
  plan: ScenePlan;
  selection: ComicHighlightSelection;
  binding: ComicSpeakerBinding;
  adultGrounded?: boolean;
  realPersonRestricted?: boolean;
}): string {
  const excerpt = buildComicHighlightSourceExcerpt(opts.plan, opts.selection, opts.binding, {
    adultGrounded: opts.adultGrounded,
    realPersonRestricted: opts.realPersonRestricted,
  });
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
    "The [action]/[context] markers are prompt roles, not visible comic text.",
    "Keep every speech balloon with the character who says that source line.",
  ].join("\n");
}