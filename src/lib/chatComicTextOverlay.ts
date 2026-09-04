/**
 * Comic Text Layer — deterministic server-side overlay for speech / narration / SFX.
 * Visual Layer (provider image) must not be the source of truth for readable text.
 */

import sharp from "sharp";

import { compileChatComicPanelSpec } from "@/lib/chatComicPanelSpec";
import type { ChatComicPanelCount } from "@/lib/chatComicGeneration";
import type { ChatImageCastGroundedManifest } from "@/lib/chatImageCastManifest";
import type { SceneEventSubjectBinding } from "@/lib/chatImageCast";
import {
  DEFAULT_SCENE_PRESENTATION_VISIBILITY,
  normalizeDialogueTextForOutput,
  projectComicPanelBeat,
  resolveScenePresentationVisibility,
  type ScenePlan,
  type ScenePresentationVisibility,
} from "@/lib/chatImageScenePlan";
import {
  projectSceneTextForSafeImageGeneration,
  shouldOmitDialogueFromImageProjection,
} from "@/lib/chatImageSafeVisualProjection";
import { deriveOverlayNarrationCandidate } from "@/lib/chatComicSafeStructure";
import type { ChatImageVisualSubject } from "@/lib/chatImageVisualIdentity";

export type ComicOverlaySlot =
  | "top_left"
  | "top_right"
  | "bottom_left"
  | "bottom_right"
  | "upper_center"
  | "narration_top"
  | "narration_bottom"
  | "lower_center";

export type ComicOverlayElementKind = "speech" | "narration" | "sfx";

export type ComicOverlayElement = {
  kind: ComicOverlayElementKind;
  panelIndex: number;
  slot: ComicOverlaySlot;
  text: string;
  speakerLabel?: string;
};

export type ComicTextOverlayPlan = {
  panelCount: ChatComicPanelCount;
  elements: ComicOverlayElement[];
  safetyFallbackUsed: boolean;
};

export type ComicTextOverlayPolicyMode = "ordinary" | "strict_fallback";

/** Canonical overlay text safety policy owner. */
export function resolveOverlayDialogueText(
  text: string,
  mode: ComicTextOverlayPolicyMode
): string | null {
  const normalized = normalizeDialogueTextForOutput(text);
  if (!normalized) return null;
  if (mode === "strict_fallback") {
    const projected = projectSceneTextForSafeImageGeneration(normalized, { isDialogue: true });
    if (projected.omitFromImage || !projected.text.trim()) return null;
    return projected.text.trim();
  }
  if (shouldOmitDialogueFromImageProjection(normalized)) return null;
  return normalized;
}

function resolveOverlayNarrationText(
  text: string,
  mode: ComicTextOverlayPolicyMode
): string | null {
  if (mode === "strict_fallback") {
    return deriveOverlayNarrationCandidate(text);
  }
  const candidate = deriveOverlayNarrationCandidate(text);
  if (!candidate) return null;
  if (shouldOmitDialogueFromImageProjection(candidate)) return null;
  return candidate;
}

const SFX_PATTERN = /^[가-힣]{1,4}[!?…]*$/u;

function deriveDeterministicSfx(plan: ScenePlan, panelIndex: number): string | null {
  const panel = plan.panels.find((item) => item.index === panelIndex);
  if (!panel) return null;
  for (const eventId of panel.sourceEventIds) {
    const event = plan.events.find((item) => item.id === eventId);
    const raw = event?.text.trim() ?? "";
    if (!raw || raw.length > 6) continue;
    if (SFX_PATTERN.test(raw)) return raw;
  }
  return null;
}

function slotForBubble(panelIndex: number, bubbleIndex: number): ComicOverlaySlot {
  if (bubbleIndex % 2 === 0) return "top_right";
  return "top_left";
}

/** Compile deterministic overlay elements from canonical ScenePlan dialogue + structure. */
export function compileChatComicTextOverlay(opts: {
  plan: ScenePlan;
  personaName: string;
  characterName: string;
  subjects: readonly ChatImageVisualSubject[];
  contentKind?: Parameters<typeof resolveScenePresentationVisibility>[0]["contentKind"];
  castManifest?: ChatImageCastGroundedManifest | null;
  eventSubjectBindings?: readonly SceneEventSubjectBinding[];
  safetyFallbackUsed: boolean;
}): ComicTextOverlayPlan {
  const visibility = resolveScenePresentationVisibility({
    contentKind: opts.contentKind,
    castManifest: opts.castManifest,
  });
  const mode: ComicTextOverlayPolicyMode = opts.safetyFallbackUsed
    ? "strict_fallback"
    : "ordinary";
  const panelCount = opts.plan.panels.length as ChatComicPanelCount;
  const spec = compileChatComicPanelSpec({
    plan: opts.plan,
    personaName: opts.personaName,
    characterName: opts.characterName,
    visibility,
    castSelected: opts.castManifest?.subjects.filter((subject) => subject.included),
    subjects: opts.subjects,
    eventSubjectBindings: opts.eventSubjectBindings,
  });

  const elements: ComicOverlayElement[] = [];

  for (const panel of spec.panels) {
    let bubbleIndex = 0;
    for (const bubble of panel.speechBubbles) {
      const text = resolveOverlayDialogueText(bubble.text, mode);
      if (!text) continue;
      elements.push({
        kind: "speech",
        panelIndex: panel.index,
        slot: slotForBubble(panel.index, bubbleIndex),
        text,
        speakerLabel: bubble.speakerLabel !== "other" ? bubble.speakerLabel : bubble.speaker,
      });
      bubbleIndex += 1;
    }

    if (bubbleIndex === 0) {
      const beat = projectComicPanelBeat(opts.plan, opts.plan.panels[panel.index - 1]!, visibility);
      const narration = resolveOverlayNarrationText(beat.situation, mode);
      if (narration) {
        elements.push({
          kind: "narration",
          panelIndex: panel.index,
          slot: "narration_top",
          text: narration,
        });
      }
    }

    const sfx = deriveDeterministicSfx(opts.plan, panel.index);
    if (sfx && !shouldOmitDialogueFromImageProjection(sfx)) {
      elements.push({
        kind: "sfx",
        panelIndex: panel.index,
        slot: "bottom_right",
        text: sfx,
      });
    }
  }

  return {
    panelCount,
    elements,
    safetyFallbackUsed: opts.safetyFallbackUsed,
  };
}

function escapeXml(text: string): string {
  return text
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&apos;");
}

function wrapText(text: string, maxCharsPerLine: number, maxLines: number): string[] {
  const words = text.replace(/\s+/g, " ").trim().split(" ");
  const lines: string[] = [];
  let current = "";
  for (const word of words) {
    const next = current ? `${current} ${word}` : word;
    if (next.length <= maxCharsPerLine) {
      current = next;
      continue;
    }
    if (current) lines.push(current);
    current = word;
    if (lines.length >= maxLines) break;
  }
  if (current && lines.length < maxLines) lines.push(current);
  if (lines.length > maxLines) return lines.slice(0, maxLines);
  if (text.length > maxCharsPerLine * maxLines && lines.length) {
    const last = lines[lines.length - 1] ?? "";
    lines[lines.length - 1] = `${last.slice(0, Math.max(0, maxCharsPerLine - 1)).trimEnd()}…`;
  }
  return lines;
}

function overlayFontFamily(): string {
  const fromEnv = process.env.COMIC_OVERLAY_FONT_FAMILY?.trim();
  if (fromEnv) return fromEnv;
  return "WenQuanYi Micro Hei, Noto Sans CJK KR, sans-serif";
}

function panelRegion(
  width: number,
  height: number,
  panelCount: number,
  panelIndex: number
): { x: number; y: number; w: number; h: number } {
  const h = Math.floor(height / panelCount);
  const y = (panelIndex - 1) * h;
  return { x: 0, y, w: width, h };
}

function slotBox(
  region: { x: number; y: number; w: number; h: number },
  slot: ComicOverlaySlot,
  kind: ComicOverlayElementKind
): { x: number; y: number; w: number; h: number } {
  const margin = Math.max(12, Math.floor(region.w * 0.04));
  const maxW = Math.floor(region.w * (kind === "narration" ? 0.88 : 0.62));
  const maxH = Math.floor(region.h * (kind === "sfx" ? 0.18 : 0.34));
  switch (slot) {
    case "top_left":
      return { x: region.x + margin, y: region.y + margin, w: maxW, h: maxH };
    case "top_right":
      return { x: region.x + region.w - margin - maxW, y: region.y + margin, w: maxW, h: maxH };
    case "bottom_left":
      return {
        x: region.x + margin,
        y: region.y + region.h - margin - maxH,
        w: maxW,
        h: maxH,
      };
    case "bottom_right":
      return {
        x: region.x + region.w - margin - maxW,
        y: region.y + region.h - margin - maxH,
        w: maxW,
        h: maxH,
      };
    case "upper_center":
    case "narration_top":
      return {
        x: region.x + Math.floor((region.w - maxW) / 2),
        y: region.y + margin,
        w: maxW,
        h: maxH,
      };
    case "narration_bottom":
    case "lower_center":
    default:
      return {
        x: region.x + Math.floor((region.w - maxW) / 2),
        y: region.y + region.h - margin - maxH,
        w: maxW,
        h: maxH,
      };
  }
}

function renderBubbleSvg(opts: {
  x: number;
  y: number;
  w: number;
  h: number;
  lines: string[];
  kind: ComicOverlayElementKind;
  fontSize: number;
}): string {
  const padX = 14;
  const padY = 10;
  const lineHeight = Math.round(opts.fontSize * 1.25);
  const textHeight = opts.lines.length * lineHeight;
  const boxH = Math.max(opts.h, textHeight + padY * 2);
  const boxW = opts.w;
  const rx = opts.kind === "sfx" ? 8 : 18;
  const fill = opts.kind === "narration" ? "rgba(255,255,255,0.92)" : "rgba(255,255,255,0.95)";
  const stroke = "rgba(30,30,30,0.85)";
  const textY = opts.y + padY + opts.fontSize;
  const tspans = opts.lines
    .map((line, index) => {
      const dy = index === 0 ? 0 : lineHeight;
      return `<tspan x="${opts.x + padX}" dy="${dy}">${escapeXml(line)}</tspan>`;
    })
    .join("");
  return [
    `<rect x="${opts.x}" y="${opts.y}" width="${boxW}" height="${boxH}" rx="${rx}" ry="${rx}" fill="${fill}" stroke="${stroke}" stroke-width="2" />`,
    `<text x="${opts.x + padX}" y="${textY}" font-family="${overlayFontFamily()}" font-size="${opts.fontSize}" fill="#111111">${tspans}</text>`,
  ].join("");
}

/** Build SVG overlay for all elements at image dimensions. */
export function buildComicTextOverlaySvg(
  width: number,
  height: number,
  overlay: ComicTextOverlayPlan
): string {
  const shapes: string[] = [];
  for (const element of overlay.elements) {
    const region = panelRegion(width, height, overlay.panelCount, element.panelIndex);
    const box = slotBox(region, element.slot, element.kind);
    const maxChars = element.kind === "sfx" ? 6 : element.kind === "narration" ? 28 : 22;
    const maxLines = element.kind === "sfx" ? 1 : element.kind === "narration" ? 3 : 4;
    const fontSize =
      element.kind === "sfx"
        ? Math.max(16, Math.floor(box.w * 0.08))
        : Math.max(14, Math.floor(box.w * 0.045));
    const lines = wrapText(element.text, maxChars, maxLines);
    if (!lines.length) continue;
    shapes.push(
      renderBubbleSvg({
        x: box.x,
        y: box.y,
        w: box.w,
        h: box.h,
        lines,
        kind: element.kind,
        fontSize,
      })
    );
  }
  return [
    `<svg xmlns="http://www.w3.org/2000/svg" width="${width}" height="${height}">`,
    ...shapes,
    "</svg>",
  ].join("");
}

export async function applyComicTextOverlay(opts: {
  image: Buffer;
  overlay: ComicTextOverlayPlan;
}): Promise<Buffer> {
  if (!opts.overlay.elements.length) return opts.image;
  const metadata = await sharp(opts.image, { failOn: "none" }).metadata();
  const width = metadata.width ?? 0;
  const height = metadata.height ?? 0;
  if (!width || !height) {
    throw new Error("Comic overlay requires image dimensions");
  }
  const svg = Buffer.from(buildComicTextOverlaySvg(width, height, opts.overlay), "utf8");
  return sharp(opts.image, { failOn: "none" })
    .composite([{ input: svg, top: 0, left: 0 }])
    .webp({ quality: 90, effort: 4 })
    .toBuffer();
}
