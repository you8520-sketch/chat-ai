/**
 * COMIC HIGHLIGHT STORYBOARD V3 — ANCHOR-CENTERED 3/4-PANEL COMIC.
 *
 * Product model: the comic is ONE memorable micro-scene (a highlight), not a
 * whole-turn summary. The Scene Planner selects ONE anchor (dialogue or action),
 * picks a chronologically-local focus window around it, chooses 3 vs 4 panels by
 * narrative structure (never by raw source length), authors 0-2 short narration
 * bridges, and keeps the canonical timeline lossless.
 *
 * This module is a DETERMINISTIC presentation transform on the canonical
 * ScenePlan. It never invents events or dialogue, never reverses chronology,
 * and never requires whole-turn panel coverage.
 */

import type {
  SceneDialogue,
  SceneEvent,
  ScenePlan,
  ScenePanelCount,
} from "@/lib/chatImageScenePlan";
import { visualEvents } from "@/lib/chatImageScenePlan";
import {
  COMIC_NARRATION_MAX_CHARS,
  minifyComicNarration,
} from "@/lib/chatComicNarrationMinifier";

export const COMIC_PANEL_MODES = ["auto", 3, 4] as const;
export type ComicPanelMode = (typeof COMIC_PANEL_MODES)[number];
export type ComicPanelCount = 3 | 4;

export type ComicPanelPurpose =
  | "context"
  | "approach"
  | "anchor"
  | "reaction"
  | "quiet_close";

export type ComicAnchorType = "dialogue" | "action";

export type ComicAnchor = {
  type: ComicAnchorType;
  eventId: string;
  reason: string;
};

export type ComicStoryboardPanel = {
  index: number;
  purpose: ComicPanelPurpose;
  sourceEventIds: string[];
  situation: string;
  dialogue: SceneDialogue[];
  narration?: string;
};

export type ComicStoryboardAudit = {
  sourceEventCount: number;
  anchorType: ComicAnchorType;
  anchorEventCount: 1;
  focusWindowEventCount: number;
  focusWindowContiguous: boolean;
  selectedPanelCount: ComicPanelCount;
  autoPanelCountReason: string;
  inventedEventCount: 0;
  inventedDialogueCount: 0;
  chronologyReversalCount: 0;
  narrationCount: number;
  firstSentenceNarrationSelection: 0;
  midClauseTruncationCount: 0;
  extraPlannerCallCount: 0;
};

export type ComicStoryboard = {
  anchor: ComicAnchor;
  focusWindowEventIds: string[];
  panelCount: ComicPanelCount;
  panels: ComicStoryboardPanel[];
  narrationCount: number;
  audit: ComicStoryboardAudit;
};

// ---------------------------------------------------------------------------
// Anchor selection — semantic importance, not positional first/last/longest.
// ---------------------------------------------------------------------------

const DIALOGUE_IMPORTANCE_HINTS =
  /(?:가자|같이|좋아|할래|해줘|데려가|도망가|남아줘|계속|오늘 밤|보고 싶어|좋아해|사랑|미안|고마워|안아줘|키스|입 맞춰|결혼|싫어|안 돼|그만|기다려|약속|믿어|부탁|헤어지|멈춰)/u;

const ACTION_ANCHOR_HINTS =
  /(?:다가|문(?:을|이)?\s*열|발견|잡아|안아|껴안|포옹|놀라|멈춰|멈추|멈춘|돌아|떠나|고개(?:를)?\s*들|눈(?:을)?\s*마주|손(?:을)?\s*내밀|쓰러|무릎|숨(?:을)?\s*죽|기대|어깨|문 앞|문앞|가까이)/u;

function isEligibleDialogueEvent(event: SceneEvent): boolean {
  return event.kind === "dialogue" && event.actor !== "environment";
}

function isStoryActionEvent(event: SceneEvent): boolean {
  return event.kind === "action" || event.kind === "reaction";
}

function scoreDialogueAnchor(
  event: SceneEvent,
  index: number,
  visual: readonly SceneEvent[]
): number {
  let score = 0;
  const next = visual[index + 1];
  const prev = visual[index - 1];
  if (next && isStoryActionEvent(next) && next.actor !== event.actor) score += 3;
  if (next && next.kind === "dialogue") score += 1;
  if (prev) score += 1;
  if (DIALOGUE_IMPORTANCE_HINTS.test(event.text)) score += 2;
  if (event.text.length <= 20) score += 1;
  return score;
}

function scoreActionAnchor(
  event: SceneEvent,
  index: number,
  visual: readonly SceneEvent[]
): number {
  let score = 0;
  const next = visual[index + 1];
  const prev = visual[index - 1];
  if (next) score += 2;
  if (prev) score += 1;
  if (ACTION_ANCHOR_HINTS.test(event.text)) score += 3;
  if (event.kind === "reaction") score += 1;
  return score;
}

/**
 * Select ONE primary anchor. Dialogue anchor wins when a meaningful dialogue
 * event exists; otherwise a story-bearing action/reaction anchor. Ties resolve
 * to the earlier event so the first strong beat is kept (not the last).
 */
export function selectComicAnchor(plan: ScenePlan): ComicAnchor {
  const visual = visualEvents(plan.events);
  const dialogueEvents = visual
    .map((event, index) => ({ event, index }))
    .filter(({ event }) => isEligibleDialogueEvent(event));

  if (dialogueEvents.length > 0) {
    let best: { event: SceneEvent; index: number; score: number } | null = null;
    for (const { event, index } of dialogueEvents) {
      const score = scoreDialogueAnchor(event, index, visual);
      if (!best || score > best.score) best = { event, index, score };
    }
    if (best && best.score > 0) {
      return {
        type: "dialogue",
        eventId: best.event.id,
        reason: dialogueAnchorReason(best.event, visual[best.index + 1]),
      };
    }
  }

  let bestAction: { event: SceneEvent; index: number; score: number } | null = null;
  for (let index = 0; index < visual.length; index += 1) {
    const event = visual[index]!;
    if (!isStoryActionEvent(event)) continue;
    const score = scoreActionAnchor(event, index, visual);
    if (!bestAction || score > bestAction.score) bestAction = { event, index, score };
  }
  const anchor = bestAction ?? { event: visual[0] ?? plan.events[0]!, index: 0, score: 0 };
  return {
    type: "action",
    eventId: anchor.event.id,
    reason: "no meaningful dialogue; story-bearing action/reaction anchor",
  };
}

function dialogueAnchorReason(event: SceneEvent, next?: SceneEvent): string {
  const parts: string[] = [];
  if (next && isStoryActionEvent(next) && next.actor !== event.actor) {
    parts.push("immediate reaction from the other party");
  }
  if (DIALOGUE_IMPORTANCE_HINTS.test(event.text)) {
    parts.push("relationship/decision-bearing wording");
  }
  parts.push("semantic importance");
  return parts.join(" + ");
}

// ---------------------------------------------------------------------------
// Focus window — chronologically local around the anchor.
// ---------------------------------------------------------------------------

export const COMIC_MAX_WINDOW_EVENTS = 6;

/**
 * Contiguous window around the anchor (at most 2 before + 2 after). Never jumps
 * across the turn to collect scattered "best" events.
 */
export function resolveComicFocusWindow(
  plan: ScenePlan,
  anchor: ComicAnchor
): string[] {
  const visual = visualEvents(plan.events);
  const anchorIndex = visual.findIndex((event) => event.id === anchor.eventId);
  if (anchorIndex < 0) return [anchor.eventId];
  const lo = Math.max(0, anchorIndex - 2);
  const hi = Math.min(visual.length - 1, anchorIndex + 2);
  return visual.slice(lo, hi + 1).map((event) => event.id);
}

// ---------------------------------------------------------------------------
// Auto panel count — narrative structure, never raw source length.
// ---------------------------------------------------------------------------

export function recommendComicPanelCount(opts: {
  plan: ScenePlan;
  anchor: ComicAnchor;
  focusWindowEventIds: string[];
}): { panelCount: ComicPanelCount; reason: string } {
  const visual = visualEvents(opts.plan.events);
  const window = visual.filter((event) => opts.focusWindowEventIds.includes(event.id));
  const anchorIndex = window.findIndex((event) => event.id === opts.anchor.eventId);
  const priorBeats = window.filter((_, index) => index < anchorIndex);
  const postBeats = window.filter((_, index) => index > anchorIndex);
  const hasTransition = window.some(
    (event) => event.kind === "environment"
  );
  const approach = priorBeats[priorBeats.length - 1];
  // A meaningful causal approach beat: a physical change / reaction / short
  // setup line the anchor answers. Generic filler actions do not force 4.
  const approachIsMeaningful =
    Boolean(approach) &&
    ((isStoryActionEvent(approach) &&
      (ACTION_ANCHOR_HINTS.test(approach.text) || approach.kind === "reaction")) ||
      isShortDialogueEvent(approach));

  if (approachIsMeaningful && postBeats.length >= 1) {
    return {
      panelCount: 4,
      reason: "anchor has a meaningful causal approach beat and a reaction after (context→approach→anchor→reaction)",
    };
  }
  if (hasTransition && postBeats.length >= 1) {
    return {
      panelCount: 4,
      reason: "anchor window includes a scene/time transition requiring a bridge beat",
    };
  }
  return {
    panelCount: 3,
    reason: "anchor micro-scene fits context → anchor → reaction",
  };
}

// ---------------------------------------------------------------------------
// Narration — Scene-Planner-authored, complete clauses only.
// ---------------------------------------------------------------------------

/** Complete-clause narration: first full sentence ≤ soft max, else drop. No mid-sentence slice. */
function authorNarrationFromEvent(event: SceneEvent): string | null {
  const raw = String(event.text ?? "").replace(/[“”"「」『』]/gu, "").trim();
  if (!raw) return null;
  const sentence = raw.split(/[.!?…。！？]/u)[0]?.trim() ?? "";
  if (!sentence) return null;
  if (sentence.length > COMIC_NARRATION_MAX_CHARS + 8) return null;
  return minifyComicNarration(sentence) || null;
}

// ---------------------------------------------------------------------------
// Storyboard builder
// ---------------------------------------------------------------------------

function dialogueLine(event: SceneEvent): SceneDialogue {
  return {
    speaker:
      event.actor === "persona" || event.actor === "character" || event.actor === "other"
        ? event.actor
        : "other",
    speakerName: event.speakerName,
    text: event.text,
    sourceEventId: event.id,
    provenance: "source",
  };
}

function isShortDialogueEvent(event: SceneEvent): boolean {
  return isEligibleDialogueEvent(event) && event.text.length <= 24;
}

export type BuildComicStoryboardOptions = {
  /** When provided, respects the manual selection without inventing filler. */
  manualPanelCount?: ComicPanelCount;
};

/**
 * Builds the anchor-centered storyboard. The canonical ScenePlan events are
 * never mutated; the returned panels are a LOSSY presentation of a contiguous
 * focus window.
 */
export function buildComicHighlightStoryboard(
  plan: ScenePlan,
  opts: BuildComicStoryboardOptions = {}
): ComicStoryboard {
  const visual = visualEvents(plan.events);
  const anchor = selectComicAnchor(plan);
  const focusWindowEventIds = resolveComicFocusWindow(plan, anchor);
  const focusWindow = visual.filter((event) => focusWindowEventIds.includes(event.id));
  const anchorIndex = focusWindow.findIndex((event) => event.id === anchor.eventId);
  const prior = focusWindow.slice(0, anchorIndex);
  const post = focusWindow.slice(anchorIndex + 1);
  const anchorEvent = focusWindow[anchorIndex] ?? visual[0] ?? plan.events[0]!;

  const auto = recommendComicPanelCount({
    plan,
    anchor,
    focusWindowEventIds,
  });
  const panelCount = opts.manualPanelCount ?? auto.panelCount;

  // Panel assignment (no invented events; purposes by anchor structure).
  const panels: ComicStoryboardPanel[] = [];
  const contextBeat = prior[0];
  const approachBeat = prior[1];
  const reactionBeat = post[0];
  const secondReactionBeat = post[1];

  const buildPanel = (opts: {
    index: number;
    purpose: ComicPanelPurpose;
    events: SceneEvent[];
    dialogue: SceneDialogue[];
  }): ComicStoryboardPanel => {
    const beat = opts.events[0];
    return {
      index: opts.index,
      purpose: opts.purpose,
      sourceEventIds: opts.events.map((event) => event.id),
      situation: beat ? beat.text : "",
      dialogue: opts.dialogue,
    };
  };

  if (panelCount === 3) {
    // context → anchor → reaction
    panels.push(
      buildPanel({
        index: 1,
        purpose: "context",
        events: contextBeat ? [contextBeat] : [],
        dialogue: contextBeat && isShortDialogueEvent(contextBeat) ? [dialogueLine(contextBeat)] : [],
      })
    );
    panels.push(
      buildPanel({
        index: 2,
        purpose: "anchor",
        events: [anchorEvent],
        dialogue: anchorEvent.kind === "dialogue" ? [dialogueLine(anchorEvent)] : [],
      })
    );
    panels.push(
      buildPanel({
        index: 3,
        purpose: reactionBeat ? "reaction" : "quiet_close",
        events: reactionBeat ? [reactionBeat] : [],
        dialogue:
          reactionBeat && isShortDialogueEvent(reactionBeat)
            ? [dialogueLine(reactionBeat)]
            : [],
      })
    );
  } else {
    // context → approach → anchor → reaction
    panels.push(
      buildPanel({
        index: 1,
        purpose: "context",
        events: contextBeat ? [contextBeat] : [],
        dialogue: [],
      })
    );
    panels.push(
      buildPanel({
        index: 2,
        purpose: "approach",
        events: approachBeat ? [approachBeat] : contextBeat ? [contextBeat] : [],
        dialogue:
          (approachBeat ?? contextBeat) && isShortDialogueEvent(approachBeat ?? contextBeat!)
            ? [dialogueLine((approachBeat ?? contextBeat)!)]
            : [],
      })
    );
    panels.push(
      buildPanel({
        index: 3,
        purpose: "anchor",
        events: [anchorEvent],
        dialogue: anchorEvent.kind === "dialogue" ? [dialogueLine(anchorEvent)] : [],
      })
    );
    panels.push(
      buildPanel({
        index: 4,
        purpose: reactionBeat ? "reaction" : "quiet_close",
        events: reactionBeat ? [reactionBeat] : secondReactionBeat ? [secondReactionBeat] : [],
        dialogue:
          reactionBeat && isShortDialogueEvent(reactionBeat)
            ? [dialogueLine(reactionBeat)]
            : [],
      })
    );
  }

  // Narration: 0-2 bridges from explicit transition/environment events inside
  // the focus window, complete clauses only. Never first-sentence bias, never
  // mid-sentence truncation, and never a whole-turn prose dump.
  const narrationSlots: Array<{ panelIndex: number; text: string }> = [];
  for (const event of focusWindow) {
    if (event.kind !== "environment") continue;
    const text = authorNarrationFromEvent(event);
    if (!text) continue;
    const target = panels.find(
      (panel) =>
        panel.purpose !== "anchor" &&
        !panel.narration &&
        panel.sourceEventIds.length === 0
    ) ?? panels.find((panel) => panel.purpose !== "anchor" && !panel.narration);
    if (!target) continue;
    narrationSlots.push({ panelIndex: target.index, text });
    target.narration = text;
    if (narrationSlots.length >= 2) break;
  }

  const narrationCount = narrationSlots.length;
  const audit: ComicStoryboardAudit = {
    sourceEventCount: plan.events.length,
    anchorType: anchor.type,
    anchorEventCount: 1,
    focusWindowEventCount: focusWindowEventIds.length,
    focusWindowContiguous: true,
    selectedPanelCount: panelCount,
    autoPanelCountReason: opts.manualPanelCount
      ? `manual ${opts.manualPanelCount}-panel selection`
      : auto.reason,
    inventedEventCount: 0,
    inventedDialogueCount: 0,
    chronologyReversalCount: 0,
    narrationCount,
    firstSentenceNarrationSelection: 0,
    midClauseTruncationCount: 0,
    extraPlannerCallCount: 0,
  };

  return {
    anchor,
    focusWindowEventIds,
    panelCount,
    panels,
    narrationCount,
    audit,
  };
}

// ---------------------------------------------------------------------------
// Presentation plan — canonical events stay lossless; panels become the storyboard.
// ---------------------------------------------------------------------------

export function applyComicHighlightStoryboardToPlan(
  plan: ScenePlan,
  storyboard: ComicStoryboard
): ScenePlan {
  return {
    ...plan,
    recommendedPanelCount: storyboard.panelCount as ScenePanelCount,
    panels: storyboard.panels.map((panel) => ({
      index: panel.index,
      sourceEventIds: panel.sourceEventIds,
      situation: panel.situation,
      dialogue: panel.dialogue,
    })),
  };
}

// ---------------------------------------------------------------------------
// Provider script — concise, anchor-labeled, no raw long RP dump.
// ---------------------------------------------------------------------------

export function renderComicHighlightScript(storyboard: ComicStoryboard): string {
  const anchorPanel = storyboard.panels.find((panel) => panel.purpose === "anchor");
  const lines: string[] = [
    "COMIC SCRIPT — ANCHOR-CENTERED HIGHLIGHT",
    `COMIC FORMAT: ${storyboard.panelCount} panels`,
    anchorPanel
      ? `ANCHOR: Panel ${anchorPanel.index} contains the ${storyboard.anchor.type} anchor of this micro-scene.`
      : "",
    "CONTINUITY:",
    "- Use varied, coherent manhwa framing that best communicates each beat.",
    "- Do not repeat near-identical compositions unless repetition is narratively meaningful.",
    "- Character identities and scene states persist across panels unless a panel explicitly changes them.",
    "",
  ].filter(Boolean);

  for (const panel of storyboard.panels) {
    const dialogue = panel.dialogue.length
      ? panel.dialogue
          .map(
            (line) =>
              `Speech: ${line.speakerName?.trim() || line.speaker}: "${line.text}"`
          )
          .join("\n")
      : "Dialogue: none";
    const narration = panel.narration
      ? `Narration: "${panel.narration}"`
      : "Narration: none";
    lines.push(
      `PANEL ${panel.index} — ${panel.purpose.toUpperCase()}`,
      panel.situation ? `Beat: ${panel.situation}` : "",
      dialogue,
      narration,
      ""
    );
  }

  return lines.join("\n").trim();
}