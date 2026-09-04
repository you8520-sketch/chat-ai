import sharp, { type Metadata } from "sharp";
import type { SceneDialogue, ScenePanel, ScenePlan, ScenePresentationVisibility } from "@/lib/chatImageScenePlan";
import { isEligibleSpeechDialogue, normalizeDialogueTextForOutput } from "@/lib/chatImageScenePlan";
import {
  buildPromptSubjectMap,
  resolveSpeakerSubject,
  visiblePromptSubjects,
  type PromptSubjectMap,
} from "@/lib/chatImagePromptSubjectMap";
import {
  classifyRawVisualRisk,
  containsRawRiskySourceLeak,
} from "@/lib/chatImageSafeVisualProjection";
import type { ChatImageVisualSubject } from "@/lib/chatImageVisualIdentity";

/**
 * COMIC TEXT OVERLAY SUB-SYSTEM (OVERLAY-FIRST ARCHITECTURE)
 *
 * Korean font runtime (Railway/Nixpacks): `noto-fonts-cjk-sans` in nixpacks.toml.
 * CI installs `fonts-noto-cjk` in validate-chat-image-generator workflow.
 * SVG font-family fallbacks: Nanum* → Noto Sans CJK KR → sans-serif.
 *
 * Primary Canonical Owners:
 * - TEXT_OVERLAY_SAFETY_POLICY_OWNER: Sanitizes and authorizes overlay text
 * - BUBBLE_OWNER: Computes speech bubble geometry, tail placement, text wrap
 * - NARRATION_OWNER: Computes narration / caption box geometry when appropriate
 * - SFX_OWNER: Extracts onomatopoeia cues and computes stylized SFX placement
 * - FINAL_COMIC_TEXT_LAYER_OWNER: Compiles SVG document and composites onto image bytes
 */

export const TEXT_OVERLAY_SAFETY_POLICY_OWNER = "chatComicTextOverlay:safetyPolicy";
export const BUBBLE_OWNER = "chatComicTextOverlay:bubble";
export const NARRATION_OWNER = "chatComicTextOverlay:narration";
export const SFX_OWNER = "chatComicTextOverlay:sfx";
export const FINAL_COMIC_TEXT_LAYER_OWNER = "chatComicTextOverlay:compiler";
export const FINAL_SAVED_IMAGE_OWNER = "api/chat/comic-generation:postProcess";

const MAX_PANEL_DIALOGUE = 4;
const DEFAULT_BUBBLE_FONT_SIZE = 23;
const MIN_BUBBLE_FONT_SIZE = 16;
const MAX_BUBBLE_HEIGHT_RATIO = 0.52;

export type TextOverlaySafetyContext = {
  isSafetyFallback?: boolean;
  adultGrounded?: boolean;
  personaVisible?: boolean;
};

export type SpeechBubbleLayout = {
  speaker: "persona" | "character" | "other";
  speakerName?: string;
  rawText: string;
  renderedText: string;
  renderedLines: string[];
  provenance?: SceneDialogue["provenance"];
  fitsInPanel: boolean;
  x: number;
  y: number;
  width: number;
  height: number;
  tailX: number;
  tailY: number;
  tailTargetX: number;
  tailTargetY: number;
  fontSize: number;
};

export type NarrationBoxLayout = {
  x: number;
  y: number;
  width: number;
  height: number;
  lines: string[];
  fontSize: number;
};

export type SfxLayout = {
  text: string;
  x: number;
  y: number;
  fontSize: number;
  rotation: number;
};

export type PanelOverlayLayout = {
  panelIndex: number;
  bubbles: SpeechBubbleLayout[];
  narration?: NarrationBoxLayout;
  sfx?: SfxLayout;
};

// ============================================================================
// 1. TEXT_OVERLAY_SAFETY_POLICY_OWNER
// ============================================================================

/**
 * Authorizes dialogue for text overlay rendering.
 * - Ordinary safe flirt / everyday romance -> allowed
 * - Risky explicit dialogue -> omitted from overlay (especially on safety fallback)
 * - Persona hidden -> persona dialogue omitted
 * - Non-dialogue fragments -> filtered out
 */
export function filterDialogueForTextOverlay(
  dialogue: readonly SceneDialogue[],
  context: TextOverlaySafetyContext = {}
): SceneDialogue[] {
  const personaVisible = context.personaVisible !== false;
  const isSafetyFallback = context.isSafetyFallback === true;

  const approved: SceneDialogue[] = [];

  for (const line of dialogue) {
    const raw = String(line.text ?? "").trim();
    if (!raw) continue;

    // Filter non-dialogue fragments for source lines ("살상 무기", etc.)
    // User-edited lines preserve exact author intent
    if (line.provenance !== "user_edit" && !isEligibleSpeechDialogue(raw)) {
      continue;
    }

    // Persona hidden policy: suppress persona dialogue
    if (!personaVisible && (line.speaker === "persona" || line.speakerName === "유저")) {
      continue;
    }

    // Safety policy: check for risky or explicit content
    const riskCategories = classifyRawVisualRisk(raw);
    const hasRawLeak = containsRawRiskySourceLeak(raw);

    if (isSafetyFallback) {
      // In Tier-2 safety fallback mode: strictly omit any risky or explicit dialogue
      if (riskCategories.length > 0 || hasRawLeak) {
        continue;
      }
    } else {
      // In normal mode: omit strong explicit adult, graphic violence, or self harm
      if (
        hasRawLeak ||
        riskCategories.includes("adult_explicit") ||
        riskCategories.includes("graphic_violence") ||
        riskCategories.includes("self_harm")
      ) {
        continue;
      }
    }

    approved.push(line);
  }

  return approved;
}

/** Retain user_edit lines first when over capacity; restore original panel dialogue order. */
export function selectDialogueForPanelLayout(
  dialogue: readonly SceneDialogue[],
  capacity = MAX_PANEL_DIALOGUE
): SceneDialogue[] {
  if (dialogue.length <= capacity) return [...dialogue];
  const indexed = dialogue.map((line, originalIndex) => ({ line, originalIndex }));
  const selected: Array<{ line: SceneDialogue; originalIndex: number }> = [];
  for (const item of indexed) {
    if (item.line.provenance !== "user_edit") continue;
    if (selected.length >= capacity) break;
    selected.push(item);
  }
  for (const item of indexed) {
    if (item.line.provenance === "user_edit") continue;
    if (selected.length >= capacity) break;
    selected.push(item);
  }
  selected.sort((left, right) => left.originalIndex - right.originalIndex);
  return selected.map((item) => item.line);
}

export const OVERLAY_PREFLIGHT_USER_MESSAGE =
  "한 컷에 들어갈 대사가 너무 많습니다. 대사를 줄이거나 다른 컷으로 나눠 주세요.";

type BubbleGeometry = {
  renderedLines: string[];
  renderedText: string;
  fontSize: number;
  bubbleWidth: number;
  bubbleHeight: number;
  lineHeight: number;
  paddingH: number;
  paddingV: number;
  fitsInPanel: boolean;
};

function charsPerLineForBubbleInnerWidth(innerWidth: number, fontSize: number): number {
  return Math.max(4, Math.floor(innerWidth / Math.max(fontSize * 0.9, 8)));
}

function computeBubbleGeometry(opts: {
  text: string;
  panelWidth: number;
  panelHeight: number;
  provenance?: SceneDialogue["provenance"];
}): BubbleGeometry {
  const paddingH = 22;
  const paddingV = 16;
  const { panelWidth, panelHeight } = opts;
  const maxBubbleHeight = Math.max(80, panelHeight * MAX_BUBBLE_HEIGHT_RATIO);
  const maxWidthRatio = opts.provenance === "user_edit" ? 0.88 : 0.52;
  const cleanText = opts.text.trim();

  for (let fontSize = DEFAULT_BUBBLE_FONT_SIZE; fontSize >= MIN_BUBBLE_FONT_SIZE; fontSize -= 1) {
    const lineHeight = fontSize * 1.35;
    const maxBubbleWidth = panelWidth * maxWidthRatio;
    const innerWidth = maxBubbleWidth - paddingH * 2;
    const charsPerLine = charsPerLineForBubbleInnerWidth(innerWidth, fontSize);
    const renderedLines = wrapKoreanText(cleanText, charsPerLine);
    const maxLineChars = Math.max(...renderedLines.map((line) => line.length), 1);
    const textWidth = Math.max(120, maxLineChars * fontSize * 0.95);
    const bubbleWidth = Math.min(maxBubbleWidth, textWidth + paddingH * 2);
    const bubbleHeight = renderedLines.length * lineHeight + paddingV * 2;

    if (bubbleHeight <= maxBubbleHeight) {
      return {
        renderedLines,
        renderedText: cleanText,
        fontSize,
        bubbleWidth,
        bubbleHeight,
        lineHeight,
        paddingH,
        paddingV,
        fitsInPanel: true,
      };
    }
  }

  const fontSize = MIN_BUBBLE_FONT_SIZE;
  const lineHeight = fontSize * 1.35;
  const maxBubbleWidth = panelWidth * maxWidthRatio;
  const innerWidth = maxBubbleWidth - paddingH * 2;
  const charsPerLine = charsPerLineForBubbleInnerWidth(innerWidth, fontSize);
  const renderedLines = wrapKoreanText(cleanText, charsPerLine);
  const maxLineChars = Math.max(...renderedLines.map((line) => line.length), 1);
  const textWidth = Math.max(120, maxLineChars * fontSize * 0.95);
  const bubbleWidth = Math.min(maxBubbleWidth, textWidth + paddingH * 2);
  const bubbleHeight = renderedLines.length * lineHeight + paddingV * 2;

  return {
    renderedLines,
    renderedText: cleanText,
    fontSize,
    bubbleWidth,
    bubbleHeight,
    lineHeight,
    paddingH,
    paddingV,
    fitsInPanel: bubbleHeight <= maxBubbleHeight,
  };
}

export function bubbleVisibleRenderedText(bubble: SpeechBubbleLayout): string {
  return bubble.renderedText;
}

// ============================================================================
// 2. BUBBLE_OWNER (Geometry & Placement)
// ============================================================================

/** Word-wraps Korean text into lines that fit within a character budget. */
export function wrapKoreanText(text: string, maxCharsPerLine = 14): string[] {
  const clean = text.replace(/\s+/g, " ").trim();
  if (!clean) return [];
  if (clean.length <= maxCharsPerLine) return [clean];

  const words = clean.split(" ");
  const lines: string[] = [];
  let current = "";

  for (const word of words) {
    if (!current) {
      current = word;
      continue;
    }
    if ((current + " " + word).length <= maxCharsPerLine) {
      current += " " + word;
    } else {
      lines.push(current);
      current = word;
    }
  }

  if (current) {
    lines.push(current);
  }

  // Fallback for long words without spaces
  const splitLines: string[] = [];
  for (const line of lines) {
    if (line.length <= maxCharsPerLine + 3) {
      splitLines.push(line);
    } else {
      for (let i = 0; i < line.length; i += maxCharsPerLine) {
        splitLines.push(line.slice(i, i + maxCharsPerLine));
      }
    }
  }

  return splitLines.length ? splitLines : [clean];
}

function escapeXml(unsafe: string): string {
  return unsafe
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&apos;");
}

function bubbleBounds(layout: SpeechBubbleLayout): OverlayRect {
  return { x: layout.x, y: layout.y, width: layout.width, height: layout.height };
}

function toOverlapRect(rect: OverlayRect): { x: number; y: number; w: number; h: number } {
  return { x: rect.x, y: rect.y, w: rect.width, h: rect.height };
}

function rectsOverlap(
  a: { x: number; y: number; w: number; h: number },
  b: { x: number; y: number; w: number; h: number },
  margin = 10
): boolean {
  return !(
    a.x + a.w + margin <= b.x ||
    b.x + b.w + margin <= a.x ||
    a.y + a.h + margin <= b.y ||
    b.y + b.h + margin <= a.y
  );
}

function resolveBubbleOverlaps(
  layouts: SpeechBubbleLayout[],
  panelX: number,
  panelY: number,
  panelWidth: number,
  panelHeight: number
): void {
  const minY = panelY + 12;
  const maxY = panelY + panelHeight - 20;
  for (let i = 1; i < layouts.length; i++) {
    const current = layouts[i]!;
    for (let j = 0; j < i; j++) {
      const previous = layouts[j]!;
      if (!rectsOverlap(toOverlapRect(bubbleBounds(current)), toOverlapRect(bubbleBounds(previous)))) continue;
      current.y = Math.min(maxY - current.height, previous.y + previous.height + 14);
      current.tailY = current.y + current.height;
      current.tailTargetY = current.tailY + 28;
    }
    current.y = Math.max(minY, Math.min(current.y, maxY - current.height));
    current.x = Math.max(panelX + 12, Math.min(current.x, panelX + panelWidth - current.width - 12));
  }
}

export function countLayoutOverlaps(
  layouts: readonly { x: number; y: number; width: number; height: number }[]
): number {
  let count = 0;
  for (let i = 0; i < layouts.length; i++) {
    for (let j = i + 1; j < layouts.length; j++) {
      const a = layouts[i]!;
      const b = layouts[j]!;
      if (
        rectsOverlap(
          toOverlapRect({ x: a.x, y: a.y, width: a.width, height: a.height }),
          toOverlapRect({ x: b.x, y: b.y, width: b.width, height: b.height })
        )
      ) {
        count += 1;
      }
    }
  }
  return count;
}

type OverlayRect = { x: number; y: number; width: number; height: number };

function narrationRect(layout: NarrationBoxLayout): OverlayRect {
  return { x: layout.x, y: layout.y, width: layout.width, height: layout.height };
}

function sfxRect(layout: SfxLayout): OverlayRect {
  const pad = layout.fontSize * 0.6;
  return {
    x: layout.x - pad,
    y: layout.y - layout.fontSize,
    width: layout.fontSize * layout.text.length * 0.55,
    height: layout.fontSize * 1.4,
  };
}

function bubbleTailPoints(layout: SpeechBubbleLayout): Array<{ x: number; y: number }> {
  return [
    { x: layout.tailX, y: layout.tailY },
    { x: layout.tailTargetX, y: layout.tailTargetY },
  ];
}

/** Count all overlay element collisions within one panel (bubble/narration/SFX). */
export function countPanelOverlayCollisions(layout: PanelOverlayLayout): number {
  const rects: OverlayRect[] = layout.bubbles.map(bubbleBounds);
  if (layout.narration) rects.push(narrationRect(layout.narration));
  if (layout.sfx) rects.push(sfxRect(layout.sfx));
  return countLayoutOverlaps(rects);
}

export function countElementsOutsidePanel(
  layout: PanelOverlayLayout,
  panelX: number,
  panelY: number,
  panelWidth: number,
  panelHeight: number
): number {
  let count = 0;
  const within = (rect: OverlayRect) =>
    rect.x >= panelX &&
    rect.y >= panelY &&
    rect.x + rect.width <= panelX + panelWidth &&
    rect.y + rect.height <= panelY + panelHeight;

  for (const bubble of layout.bubbles) {
    if (!within(bubbleBounds(bubble))) count += 1;
    for (const point of bubbleTailPoints(bubble)) {
      if (
        point.x < panelX ||
        point.y < panelY ||
        point.x > panelX + panelWidth ||
        point.y > panelY + panelHeight
      ) {
        count += 1;
      }
    }
  }
  if (layout.narration && !within(narrationRect(layout.narration))) count += 1;
  if (layout.sfx && !within(sfxRect(layout.sfx))) count += 1;
  return count;
}

type SpeakerSide = "left" | "right" | "center";

function resolveSpeakerSide(
  speaker: SceneDialogue["speaker"],
  subjectMap: PromptSubjectMap,
  personaVisible: boolean
): SpeakerSide {
  const subject = resolveSpeakerSubject(subjectMap, speaker);
  if (!subject) return "center";
  const visible = visiblePromptSubjects(subjectMap, personaVisible);
  if (visible.length <= 1) return "center";
  const index = visible.findIndex((entry) => entry.label === subject.label);
  if (index <= 0) return "left";
  if (index >= visible.length - 1) return "right";
  return "center";
}

function shouldShowSpeakerNameBadge(
  speaker: SceneDialogue["speaker"],
  speakerName?: string
): boolean {
  if (!speakerName?.trim()) return false;
  return speaker === "other";
}

function clampBubbleToPanel(
  bubble: SpeechBubbleLayout,
  panelX: number,
  panelY: number,
  panelWidth: number,
  panelHeight: number
): void {
  const margin = 12;
  const maxTailY = panelY + panelHeight - margin;
  bubble.y = Math.max(panelY + margin, Math.min(bubble.y, maxTailY - bubble.height));
  bubble.x = Math.max(
    panelX + margin,
    Math.min(bubble.x, panelX + panelWidth - bubble.width - margin)
  );
  bubble.tailY = bubble.y + bubble.height;
  bubble.tailTargetY = Math.min(bubble.tailY + 24, maxTailY);
  if (bubble.tailTargetX < panelX + margin) bubble.tailTargetX = panelX + margin;
  if (bubble.tailTargetX > panelX + panelWidth - margin) {
    bubble.tailTargetX = panelX + panelWidth - margin;
  }
}

function resolvePanelTextCollisions(opts: {
  bubbles: SpeechBubbleLayout[];
  narration?: NarrationBoxLayout;
  sfx?: SfxLayout;
  panelX: number;
  panelY: number;
  panelWidth: number;
  panelHeight: number;
}): { bubbles: SpeechBubbleLayout[]; narration?: NarrationBoxLayout; sfx?: SfxLayout } {
  let { bubbles, narration, sfx } = opts;
  const { panelX, panelY, panelWidth, panelHeight } = opts;

  resolveBubbleOverlaps(bubbles, panelX, panelY, panelWidth, panelHeight);

  if (narration && bubbles.some((bubble) => rectsOverlap(toOverlapRect(bubbleBounds(bubble)), toOverlapRect(narrationRect(narration!))))) {
    narration = {
      ...narration,
      y: panelY + panelHeight - narration.height - 16,
    };
    if (bubbles.some((bubble) => rectsOverlap(toOverlapRect(bubbleBounds(bubble)), toOverlapRect(narrationRect(narration!))))) {
      narration = undefined;
    }
  }

  if (sfx) {
    const sfxBox = sfxRect(sfx);
    const collides =
      bubbles.some((bubble) => rectsOverlap(toOverlapRect(bubbleBounds(bubble)), toOverlapRect(sfxBox))) ||
      (narration ? rectsOverlap(toOverlapRect(narrationRect(narration)), toOverlapRect(sfxBox)) : false);
    if (collides) sfx = undefined;
  }

  for (const bubble of bubbles) {
    clampBubbleToPanel(bubble, panelX, panelY, panelWidth, panelHeight);
  }

  return { bubbles, narration, sfx };
}

function findDropCandidateIndex(bubbles: readonly SpeechBubbleLayout[]): number {
  for (let index = bubbles.length - 1; index >= 0; index -= 1) {
    if (bubbles[index]?.provenance !== "user_edit") return index;
  }
  return -1;
}

/** Final-state layout: bounded second pass + deterministic drop when still impossible. */
function finalizePanelOverlayLayout(
  layout: PanelOverlayLayout,
  panelX: number,
  panelY: number,
  panelWidth: number,
  panelHeight: number
): PanelOverlayLayout {
  let bubbles = [...layout.bubbles];
  let narration = layout.narration;
  let sfx = layout.sfx;

  for (let pass = 0; pass < 2; pass += 1) {
    const resolved = resolvePanelTextCollisions({
      bubbles,
      narration,
      sfx,
      panelX,
      panelY,
      panelWidth,
      panelHeight,
    });
    bubbles = resolved.bubbles;
    narration = resolved.narration;
    sfx = resolved.sfx;
    if (countPanelOverlayCollisions({ panelIndex: layout.panelIndex, bubbles, narration, sfx }) === 0) {
      break;
    }
  }

  let current: PanelOverlayLayout = { panelIndex: layout.panelIndex, bubbles, narration, sfx };
  let guard = 0;
  while (
    countPanelOverlayCollisions(current) > 0 &&
    current.bubbles.length > 0 &&
    guard < MAX_PANEL_DIALOGUE
  ) {
    guard += 1;
    const dropIndex = findDropCandidateIndex(current.bubbles);
    if (dropIndex < 0) break;
    const nextBubbles = current.bubbles.filter((_, index) => index !== dropIndex);
    const resolved = resolvePanelTextCollisions({
      bubbles: nextBubbles,
      narration: current.narration,
      sfx: current.sfx,
      panelX,
      panelY,
      panelWidth,
      panelHeight,
    });
    current = {
      panelIndex: layout.panelIndex,
      bubbles: resolved.bubbles,
      narration: resolved.narration,
      sfx: resolved.sfx,
    };
  }

  return current;
}

export function layoutPanelBubbles(opts: {
  dialogue: readonly SceneDialogue[];
  panelX: number;
  panelY: number;
  panelWidth: number;
  panelHeight: number;
  personaVisible?: boolean;
  subjects?: readonly ChatImageVisualSubject[];
  reservedTop?: number;
}): SpeechBubbleLayout[] {
  const { dialogue, panelX, panelY, panelWidth, panelHeight } = opts;
  if (!dialogue.length) return [];

  const subjectMap = opts.subjects?.length ? buildPromptSubjectMap(opts.subjects) : null;
  const personaVisible = opts.personaVisible !== false;
  const topOffset = opts.reservedTop ?? 0;
  const layouts: SpeechBubbleLayout[] = [];

  let leftIndex = 0;
  let rightIndex = 0;
  let centerIndex = 0;

  const selected = selectDialogueForPanelLayout(dialogue);

  for (const line of selected) {
    const geometry = computeBubbleGeometry({
      text: line.text,
      panelWidth,
      panelHeight,
      provenance: line.provenance,
    });
    const { renderedLines, renderedText, fontSize, bubbleWidth, bubbleHeight, fitsInPanel } = geometry;

    const side = subjectMap
      ? resolveSpeakerSide(line.speaker, subjectMap, personaVisible)
      : line.speaker === "character"
        ? "left"
        : line.speaker === "persona"
          ? "right"
          : "center";

    let x: number;
    let y: number;
    let tailX: number;
    let tailY: number;
    let tailTargetX: number;
    let tailTargetY: number;

    if (side === "left") {
      x = panelX + 44;
      y = panelY + topOffset + 32 + leftIndex * (bubbleHeight + 18);
      tailX = x + 36;
      tailY = y + bubbleHeight;
      tailTargetX = panelX + Math.floor(panelWidth * 0.22);
      tailTargetY = tailY + 24;
      leftIndex += 1;
    } else if (side === "right") {
      x = panelX + panelWidth - bubbleWidth - 44;
      y = panelY + topOffset + 36 + rightIndex * (bubbleHeight + 18);
      tailX = x + bubbleWidth - 36;
      tailY = y + bubbleHeight;
      tailTargetX = panelX + Math.floor(panelWidth * 0.78);
      tailTargetY = tailY + 24;
      rightIndex += 1;
    } else {
      x = panelX + (panelWidth - bubbleWidth) / 2;
      y = panelY + topOffset + 40 + centerIndex * (bubbleHeight + 16);
      tailX = x + bubbleWidth / 2;
      tailY = y + bubbleHeight;
      tailTargetX = x + bubbleWidth / 2;
      tailTargetY = tailY + 24;
      centerIndex += 1;
    }

    layouts.push({
      speaker: line.speaker,
      speakerName: line.speakerName,
      rawText: line.text,
      renderedText,
      renderedLines,
      provenance: line.provenance,
      fitsInPanel,
      x,
      y,
      width: bubbleWidth,
      height: bubbleHeight,
      tailX,
      tailY,
      tailTargetX,
      tailTargetY,
      fontSize,
    });
  }

  return layouts;
}

/** Unified per-panel text layout owner — narration, bubbles, optional SFX with collision policy. */
export function layoutPanelOverlay(opts: {
  panel: ScenePanel;
  approvedDialogue: readonly SceneDialogue[];
  panelX: number;
  panelY: number;
  panelWidth: number;
  panelHeight: number;
  personaVisible?: boolean;
  subjects?: readonly ChatImageVisualSubject[];
}): PanelOverlayLayout {
  const { panel, panelX, panelY, panelWidth, panelHeight } = opts;
  const personaVisible = opts.personaVisible !== false;

  const denseSpeech = opts.approvedDialogue.length >= 3;
  let narration = denseSpeech
    ? undefined
    : layoutPanelNarration({
        panel,
        panelX,
        panelY,
        panelWidth,
        panelHeight,
        hasBubbles: opts.approvedDialogue.length > 0,
      });
  const reservedTop = narration ? narration.height + 28 : 0;

  const bubbles = layoutPanelBubbles({
    dialogue: opts.approvedDialogue,
    panelX,
    panelY,
    panelWidth,
    panelHeight,
    personaVisible,
    subjects: opts.subjects,
    reservedTop,
  });

  let sfx = extractPanelSfxCue(panel);
  if (sfx) {
    sfx = {
      ...sfx,
      x: panelX + panelWidth * 0.52,
      y: panelY + panelHeight * 0.72,
    };
  }

  return finalizePanelOverlayLayout(
    {
      panelIndex: panel.index,
      bubbles,
      narration,
      sfx,
    },
    panelX,
    panelY,
    panelWidth,
    panelHeight
  );
}

export function compileComicPanelOverlayLayouts(opts: {
  width: number;
  height: number;
  panelCount: number;
  plan: ScenePlan;
  visibility?: ScenePresentationVisibility;
  safetyContext?: TextOverlaySafetyContext;
  subjects?: readonly ChatImageVisualSubject[];
}): PanelOverlayLayout[] {
  const { width, height, panelCount, plan } = opts;
  const panelHeight = height / panelCount;
  const visibility = opts.visibility ?? { personaVisible: true };
  const safetyContext: TextOverlaySafetyContext = {
    ...opts.safetyContext,
    personaVisible: visibility.personaVisible,
  };
  const layouts: PanelOverlayLayout[] = [];

  for (let i = 0; i < panelCount; i += 1) {
    const panel = plan.panels[i] ?? plan.panels[plan.panels.length - 1];
    if (!panel) continue;
    const approvedDialogue = filterDialogueForTextOverlay(panel.dialogue, safetyContext);
    layouts.push(
      layoutPanelOverlay({
        panel,
        approvedDialogue,
        panelX: 0,
        panelY: i * panelHeight,
        panelWidth: width,
        panelHeight,
        personaVisible: visibility.personaVisible,
        subjects: opts.subjects,
      })
    );
  }

  return layouts;
}

export function collectFinalOverlayRenderedTexts(opts: {
  width: number;
  height: number;
  panelCount: number;
  plan: ScenePlan;
  visibility?: ScenePresentationVisibility;
  safetyContext?: TextOverlaySafetyContext;
  subjects?: readonly ChatImageVisualSubject[];
}): string[] {
  return compileComicPanelOverlayLayouts(opts).flatMap((layout) =>
    layout.bubbles.map((bubble) => bubble.renderedText)
  );
}

/** @deprecated Use collectFinalOverlayRenderedTexts — metadata rawText is not pixel parity. */
export function collectFinalOverlayBubbleTexts(opts: {
  width: number;
  height: number;
  panelCount: number;
  plan: ScenePlan;
  visibility?: ScenePresentationVisibility;
  safetyContext?: TextOverlaySafetyContext;
  subjects?: readonly ChatImageVisualSubject[];
}): string[] {
  return collectFinalOverlayRenderedTexts(opts);
}

export type ComicOverlayPreflightResult =
  | { ok: true }
  | { ok: false; reason: typeof OVERLAY_PREFLIGHT_USER_MESSAGE };

export function validateComicOverlayPreflight(opts: {
  width: number;
  height: number;
  panelCount: number;
  plan: ScenePlan;
  visibility?: ScenePresentationVisibility;
  safetyContext?: TextOverlaySafetyContext;
  subjects?: readonly ChatImageVisualSubject[];
}): ComicOverlayPreflightResult {
  const visibility = opts.visibility ?? { personaVisible: true };
  const safetyContext: TextOverlaySafetyContext = {
    ...opts.safetyContext,
    personaVisible: visibility.personaVisible,
  };
  const panelHeight = opts.height / opts.panelCount;

  for (const panel of opts.plan.panels) {
    const approved = filterDialogueForTextOverlay(panel.dialogue, safetyContext);
    const userEditCount = approved.filter(
      (line) => line.provenance === "user_edit" && line.text.trim()
    ).length;
    if (userEditCount > MAX_PANEL_DIALOGUE) {
      return { ok: false, reason: OVERLAY_PREFLIGHT_USER_MESSAGE };
    }
  }

  const layouts = compileComicPanelOverlayLayouts({
    ...opts,
    visibility,
    safetyContext,
  });

  for (const panel of opts.plan.panels) {
    const approved = filterDialogueForTextOverlay(panel.dialogue, safetyContext);
    const layout = layouts.find((entry) => entry.panelIndex === panel.index);
    if (!layout) continue;
    const panelY = (panel.index - 1) * panelHeight;

    for (const line of approved) {
      if (line.provenance !== "user_edit" || !line.text.trim()) continue;
      const normEdit = normalizeDialogueTextForOutput(line.text);
      const bubble = layout.bubbles.find(
        (entry) =>
          entry.provenance === "user_edit" &&
          normalizeDialogueTextForOutput(entry.rawText) === normEdit
      );
      if (!bubble) {
        return { ok: false, reason: OVERLAY_PREFLIGHT_USER_MESSAGE };
      }
      if (normalizeDialogueTextForOutput(bubble.renderedText) !== normEdit) {
        return { ok: false, reason: OVERLAY_PREFLIGHT_USER_MESSAGE };
      }
      if (!bubble.fitsInPanel) {
        return { ok: false, reason: OVERLAY_PREFLIGHT_USER_MESSAGE };
      }
      const outside = countElementsOutsidePanel(
        { panelIndex: panel.index, bubbles: [bubble] },
        0,
        panelY,
        opts.width,
        panelHeight
      );
      if (outside > 0) {
        return { ok: false, reason: OVERLAY_PREFLIGHT_USER_MESSAGE };
      }
    }
  }

  return { ok: true };
}

// ============================================================================
// 3. NARRATION_OWNER (Captions & Scene Transition Boxes)
// ============================================================================

export function layoutPanelNarration(opts: {
  panel: ScenePanel;
  panelX: number;
  panelY: number;
  panelWidth: number;
  panelHeight: number;
  hasBubbles: boolean;
}): NarrationBoxLayout | undefined {
  const { panel, panelX, panelY, panelWidth, hasBubbles } = opts;
  const situation = String(panel.situation ?? "").trim();
  if (!situation) return undefined;

  // Render narration box when:
  // (a) Silent panel (no bubbles), OR
  // (b) Opening panel 1 with explicit location/time context
  const isOpeningWithContext = panel.index === 1 && (panel.backgroundOverride || situation.length >= 8);
  if (hasBubbles && !isOpeningWithContext) {
    return undefined;
  }

  const lines = wrapKoreanText(situation, 18).slice(0, 3);
  if (!lines.length) return undefined;

  const fontSize = 18;
  const lineHeight = fontSize * 1.35;
  const paddingH = 16;
  const paddingV = 12;
  const maxLineChars = Math.max(...lines.map((l) => l.length));
  const width = Math.min(panelWidth * 0.5, maxLineChars * fontSize * 0.9 + paddingH * 2);
  const height = lines.length * lineHeight + paddingV * 2;

  return {
    x: panelX + 36,
    y: panelY + 24,
    width,
    height,
    lines,
    fontSize,
  };
}

// ============================================================================
// 4. SFX_OWNER (Stylized Onomatopoeia)
// ============================================================================

const SFX_CUE_REGEX =
  /(?:쾅|쿵|탁|두근|스윽|스륵|팟|철컥|삐걱|와장창|퍼억|텁|찰칵|콰앙|스스륵|쿵쿵|번쩍)/u;

export function extractPanelSfxCue(panel: ScenePanel): SfxLayout | undefined {
  const text = `${panel.personaAction ?? ""} ${panel.characterAction ?? ""} ${panel.situation ?? ""}`;
  const match = text.match(SFX_CUE_REGEX);
  if (!match) return undefined;

  const rawCue = match[0];
  const sfxText = rawCue.length === 1 ? `${rawCue}!` : rawCue;

  return {
    text: sfxText,
    x: 0, // relative to panel center
    y: 0,
    fontSize: 36,
    rotation: -8,
  };
}

// ============================================================================
// 5. FINAL_COMIC_TEXT_LAYER_OWNER (SVG Composition & Sharp Rendering)
// ============================================================================

export function compileComicTextOverlaySvg(opts: {
  width: number;
  height: number;
  panelCount: number;
  plan: ScenePlan;
  visibility?: ScenePresentationVisibility;
  safetyContext?: TextOverlaySafetyContext;
  subjects?: readonly ChatImageVisualSubject[];
}): string {
  const { width, height, panelCount, plan } = opts;
  const panelHeight = height / panelCount;
  const visibility = opts.visibility ?? { personaVisible: true };
  const safetyContext: TextOverlaySafetyContext = {
    ...opts.safetyContext,
    personaVisible: visibility.personaVisible,
  };

  const svgElements: string[] = [];

  for (let i = 0; i < panelCount; i++) {
    const panel = plan.panels[i] ?? plan.panels[plan.panels.length - 1];
    if (!panel) continue;

    const panelX = 0;
    const panelY = i * panelHeight;

    // Filter dialogue through safety & validity policy
    const approvedDialogue = filterDialogueForTextOverlay(panel.dialogue, safetyContext);
    const panelLayout = layoutPanelOverlay({
      panel,
      approvedDialogue,
      panelX,
      panelY,
      panelWidth: width,
      panelHeight,
      personaVisible: visibility.personaVisible,
      subjects: opts.subjects,
    });
    const bubbles = panelLayout.bubbles;
    const narration = panelLayout.narration;

    if (narration) {
      svgElements.push(`
        <!-- Panel ${i + 1} Narration Box -->
        <g class="narration-box" filter="url(#shadow)">
          <rect x="${narration.x}" y="${narration.y}" width="${narration.width}" height="${narration.height}"
                rx="6" ry="6" fill="#f8fafc" stroke="#334155" stroke-width="2.5" />
          <text x="${narration.x + 14}" y="${narration.y + narration.fontSize + 8}"
                font-family="NanumSquareRound, NanumGothic, NanumBarunGothic, Noto Sans CJK KR, sans-serif"
                font-size="${narration.fontSize}" font-weight="600" fill="#1e293b">
            ${narration.lines
              .map(
                (line, idx) =>
                  `<tspan x="${narration.x + 14}" dy="${idx === 0 ? 0 : narration.fontSize * 1.35}">${escapeXml(
                    line
                  )}</tspan>`
              )
              .join("")}
          </text>
        </g>
      `);
    }

    // Speech Bubbles
    for (const bubble of bubbles) {
      const radius = 18;
      const tailWidth = 20;

      // Draw rounded rectangle + pointer tail as single polygon path
      const left = bubble.x;
      const top = bubble.y;
      const right = bubble.x + bubble.width;
      const bottom = bubble.y + bubble.height;

      const pathData = `
        M ${left + radius} ${top}
        L ${right - radius} ${top}
        A ${radius} ${radius} 0 0 1 ${right} ${top + radius}
        L ${right} ${bottom - radius}
        A ${radius} ${radius} 0 0 1 ${right - radius} ${bottom}
        L ${bubble.tailX + tailWidth} ${bottom}
        L ${bubble.tailTargetX} ${bubble.tailTargetY}
        L ${bubble.tailX - tailWidth} ${bottom}
        L ${left + radius} ${bottom}
        A ${radius} ${radius} 0 0 1 ${left} ${bottom - radius}
        L ${left} ${top + radius}
        A ${radius} ${radius} 0 0 1 ${left + radius} ${top}
        Z
      `;

      const textCenterX = bubble.x + bubble.width / 2;
      const firstLineY =
        bubble.y +
        (bubble.height - bubble.renderedLines.length * bubble.fontSize * 1.35) / 2 +
        bubble.fontSize * 0.95;

      svgElements.push(`
        <!-- Panel ${i + 1} Speech Bubble (${bubble.speaker}) -->
        <g class="speech-bubble" data-text="${escapeXml(bubble.rawText)}" filter="url(#shadow)">
          <path d="${pathData}" fill="#ffffff" stroke="#0f172a" stroke-width="3.5" stroke-linejoin="round" />
          ${
            shouldShowSpeakerNameBadge(bubble.speaker, bubble.speakerName)
              ? `<rect x="${bubble.x + 12}" y="${bubble.y - 12}" width="${(bubble.speakerName?.length ?? 0) * 14 + 16}" height="20" rx="4" fill="#3b82f6" />
                 <text x="${bubble.x + 20}" y="${bubble.y + 2}" font-family="NanumSquareRound, NanumGothic, sans-serif" font-size="11" font-weight="bold" fill="#ffffff">${escapeXml(
                  bubble.speakerName ?? ""
                )}</text>`
              : ""
          }
          <text x="${textCenterX}" y="${firstLineY}"
                font-family="NanumSquareRound, NanumGothic, NanumBarunGothic, Noto Sans CJK KR, sans-serif"
                font-size="${bubble.fontSize}" font-weight="700" fill="#0f172a" text-anchor="middle">
            ${bubble.renderedLines
              .map(
                (line, idx) =>
                  `<tspan x="${textCenterX}" dy="${idx === 0 ? 0 : bubble.fontSize * 1.35}">${escapeXml(
                    line
                  )}</tspan>`
              )
              .join("")}
          </text>
        </g>
      `);
    }

    // SFX (Optional, deterministic on sound cue)
    const sfx = panelLayout.sfx;
    if (sfx) {
      const sfxX = sfx.x;
      const sfxY = sfx.y;
      svgElements.push(`
        <!-- Panel ${i + 1} SFX -->
        <g class="sfx" transform="rotate(${sfx.rotation} ${sfxX} ${sfxY})">
          <text x="${sfxX}" y="${sfxY}"
                font-family="NanumSquareRound, NanumGothic, sans-serif"
                font-size="${sfx.fontSize}" font-weight="900" fill="#fbbf24"
                stroke="#0f172a" stroke-width="4.5" paint-order="stroke fill" text-anchor="middle">
            ${escapeXml(sfx.text)}
          </text>
        </g>
      `);
    }
  }

  return `
    <svg width="${width}" height="${height}" viewBox="0 0 ${width} ${height}" xmlns="http://www.w3.org/2000/svg">
      <defs>
        <filter id="shadow" x="-8%" y="-8%" width="116%" height="116%">
          <feDropShadow dx="1.5" dy="2.5" stdDeviation="3.5" flood-color="#000000" flood-opacity="0.22"/>
        </filter>
      </defs>
      ${svgElements.join("\n")}
    </svg>
  `.trim();
}

/**
 * Composites deterministic manhwa text overlay onto generated image bytes.
 * Returns post-processed WebP Buffer.
 */
export async function renderComicTextOverlay(opts: {
  imageBuffer: Buffer;
  panelCount: number;
  plan: ScenePlan;
  visibility?: ScenePresentationVisibility;
  isSafetyFallback?: boolean;
  adultGrounded?: boolean;
  subjects?: readonly ChatImageVisualSubject[];
}): Promise<Buffer> {
  if (!opts.imageBuffer || opts.imageBuffer.length === 0) {
    throw new Error("Cannot render comic text overlay on empty image buffer");
  }

  let metadata: Metadata;
  try {
    metadata = await sharp(opts.imageBuffer, { failOn: "none" }).metadata();
  } catch (err) {
    throw new Error(`Invalid image buffer for comic text overlay: ${err instanceof Error ? err.message : String(err)}`);
  }
  if (!metadata.width || !metadata.height) {
    throw new Error("Invalid image buffer metadata for comic text overlay");
  }

  const svgDoc = compileComicTextOverlaySvg({
    width: metadata.width,
    height: metadata.height,
    panelCount: opts.panelCount,
    plan: opts.plan,
    visibility: opts.visibility,
    safetyContext: {
      isSafetyFallback: opts.isSafetyFallback,
      adultGrounded: opts.adultGrounded,
      personaVisible: opts.visibility?.personaVisible,
    },
    subjects: opts.subjects,
  });

  return await sharp(opts.imageBuffer, { failOn: "none" })
    .composite([{ input: Buffer.from(svgDoc) }])
    .webp({ quality: 90, effort: 4 })
    .toBuffer();
}
