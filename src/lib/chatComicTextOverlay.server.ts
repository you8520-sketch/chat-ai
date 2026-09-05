import sharp, { type Metadata } from "sharp";

import {
  compileComicPanelOverlayLayouts,
  compileComicTextOnlyOverlaySvg,
  compileComicTextOverlaySvg,
  countComicPanelDialogueSuppressed,
  wrapKoreanText,
  type ComicFinalTextEligibilityContext,
  type PanelOverlayLayout,
  type SpeechBubbleLayout,
} from "@/lib/chatComicTextOverlay";
import type { ComicBlankBalloonTextStrategy } from "@/lib/chatComicDiagnostic";
import {
  DEFAULT_SCENE_PRESENTATION_VISIBILITY,
  type ScenePlan,
  type ScenePresentationVisibility,
} from "@/lib/chatImageScenePlan";
import type { ChatImageVisualSubject } from "@/lib/chatImageVisualIdentity";

export const COMIC_FINAL_WEBP_OPTIONS = { quality: 90, effort: 4 } as const;

export type BlankBalloonRegion = {
  panelIndex: number;
  x: number;
  y: number;
  width: number;
  height: number;
  area: number;
};

export type BlankBalloonDetectionAudit = {
  strategy: ComicBlankBalloonTextStrategy;
  /** Structural balloon slots GPT is asked to draw (canonical dialogue rows). */
  expectedProviderBalloonRegionCount: number;
  /** Dialogue slots the application text policy approves for server glyph insertion. */
  approvedServerTextRegionCount: number;
  /** Dialogue slots intentionally suppressed by the application text policy. */
  policySuppressedTextRegionCount: number;
  /** Alias of approvedServerTextRegionCount — server text regions to fill. */
  expectedTextRegionCount: number;
  detectedRegionCount: number;
  /** Dialogue slots actually inserted (bubbles only). */
  insertedTextRegionCount: number;
  insertedNarrationRegionCount: number;
  /** approvedServerTextRegionCount − inserted dialogue slots (detector failures only). */
  missingTextRegionCount: number;
  ambiguousRegionCount: number;
  rejectedRegionCount: number;
  /** Admin gate: do not promote hybrid to normal-user production while false. */
  textInsertionComplete: boolean;
};

function pixelLuminance(r: number, g: number, b: number): number {
  return 0.2126 * r + 0.7152 * g + 0.0722 * b;
}

function isBrightInterior(data: Buffer, offset: number): boolean {
  const r = data[offset] ?? 0;
  const g = data[offset + 1] ?? 0;
  const b = data[offset + 2] ?? 0;
  const alpha = data[offset + 3] ?? 0;
  return alpha > 200 && r >= 225 && g >= 225 && b >= 225 && Math.max(r, g, b) - Math.min(r, g, b) <= 38;
}

/**
 * Conservative local detector for enclosed, bright balloon interiors.
 * It intentionally rejects edge-connected white areas and weak/ambiguous
 * components instead of placing text over unknown artwork.
 */
export async function detectBlankBalloonRegions(
  imageBuffer: Buffer,
  panelCount: number
): Promise<BlankBalloonRegion[]> {
  const metadata = await sharp(imageBuffer, { failOn: "none" }).metadata();
  if (!metadata.width || !metadata.height || panelCount <= 0) return [];
  const sampleWidth = Math.min(256, metadata.width);
  const { data, info } = await sharp(imageBuffer, { failOn: "none" })
    .resize({ width: sampleWidth, fit: "inside", withoutEnlargement: true })
    .ensureAlpha()
    .raw()
    .toBuffer({ resolveWithObject: true });
  const samplePanelHeight = info.height / panelCount;
  const visited = new Uint8Array(info.width * info.height);
  const regions: BlankBalloonRegion[] = [];
  const directions = [
    [-1, 0],
    [1, 0],
    [0, -1],
    [0, 1],
  ] as const;

  const indexOf = (x: number, y: number) => y * info.width + x;
  const isInsidePanel = (y: number, panelIndex: number) => {
    const top = Math.floor(panelIndex * samplePanelHeight);
    const bottom = Math.ceil((panelIndex + 1) * samplePanelHeight);
    return y >= top && y < bottom;
  };

  for (let y = 0; y < info.height; y += 1) {
    for (let x = 0; x < info.width; x += 1) {
      const startIndex = indexOf(x, y);
      if (visited[startIndex]) continue;
      visited[startIndex] = 1;
      if (!isBrightInterior(data, startIndex * info.channels)) continue;

      const queue = [startIndex];
      let cursor = 0;
      let area = 0;
      let minX = x;
      let maxX = x;
      let minY = y;
      let maxY = y;
      while (cursor < queue.length) {
        const current = queue[cursor++]!;
        const currentX = current % info.width;
        const currentY = Math.floor(current / info.width);
        area += 1;
        minX = Math.min(minX, currentX);
        maxX = Math.max(maxX, currentX);
        minY = Math.min(minY, currentY);
        maxY = Math.max(maxY, currentY);
        const panelIndex = Math.min(
          panelCount - 1,
          Math.max(0, Math.floor(currentY / samplePanelHeight))
        );
        for (const [dx, dy] of directions) {
          const nextX = currentX + dx;
          const nextY = currentY + dy;
          if (
            nextX < 0 ||
            nextX >= info.width ||
            nextY < 0 ||
            nextY >= info.height ||
            !isInsidePanel(nextY, panelIndex)
          ) {
            continue;
          }
          const nextIndex = indexOf(nextX, nextY);
          if (visited[nextIndex]) continue;
          visited[nextIndex] = 1;
          if (isBrightInterior(data, nextIndex * info.channels)) {
            queue.push(nextIndex);
          }
        }
      }

      const panelIndex = Math.min(
        panelCount - 1,
        Math.max(0, Math.floor(((minY + maxY) / 2) / samplePanelHeight))
      );
      const panelTop = Math.floor(panelIndex * samplePanelHeight);
      const panelBottom = Math.ceil((panelIndex + 1) * samplePanelHeight);
      const touchesPanelBoundary =
        minX <= 1 ||
        maxX >= info.width - 2 ||
        minY <= panelTop + 1 ||
        maxY >= panelBottom - 2;
      const panelArea = info.width * (panelBottom - panelTop);
      if (
        touchesPanelBoundary ||
        area < Math.max(60, panelArea * 0.002) ||
        area > panelArea * 0.55
      ) {
        continue;
      }

      let ringPixels = 0;
      let darkRingPixels = 0;
      for (let ringY = minY - 2; ringY <= maxY + 2; ringY += 1) {
        for (let ringX = minX - 2; ringX <= maxX + 2; ringX += 1) {
          if (
            ringX < 0 ||
            ringX >= info.width ||
            ringY < panelTop ||
            ringY >= panelBottom ||
            (ringX >= minX && ringX <= maxX && ringY >= minY && ringY <= maxY)
          ) {
            continue;
          }
          ringPixels += 1;
          const offset = indexOf(ringX, ringY) * info.channels;
          const luminance = pixelLuminance(
            data[offset] ?? 0,
            data[offset + 1] ?? 0,
            data[offset + 2] ?? 0
          );
          if (luminance < 180) darkRingPixels += 1;
        }
      }
      if (!ringPixels || darkRingPixels / ringPixels < 0.06) continue;

      const scaleX = metadata.width / info.width;
      const scaleY = metadata.height / info.height;
      const xStart = Math.round(minX * scaleX) + 2;
      const yStart = Math.round(minY * scaleY) + 2;
      const xEnd = Math.round((maxX + 1) * scaleX) - 2;
      const yEnd = Math.round((maxY + 1) * scaleY) - 2;
      const width = xEnd - xStart;
      const height = yEnd - yStart;
      if (width < 44 || height < 20) continue;
      regions.push({
        panelIndex,
        x: xStart,
        y: yStart,
        width,
        height,
        area,
      });
    }
  }

  return regions.sort((left, right) =>
    left.panelIndex - right.panelIndex || left.y - right.y || left.x - right.x
  );
}

function regionSide(
  x: number,
  width: number,
  panelWidth: number
): "left" | "center" | "right" {
  const center = (x + width / 2) / panelWidth;
  if (center < 0.42) return "left";
  if (center > 0.58) return "right";
  return "center";
}

function fitBubbleToRegion(
  bubble: SpeechBubbleLayout,
  region: BlankBalloonRegion
): SpeechBubbleLayout | null {
  for (let fontSize = bubble.fontSize; fontSize >= 16; fontSize -= 1) {
    const charsPerLine = Math.max(
      4,
      Math.floor(Math.max(0, region.width - 44) / Math.max(fontSize * 0.9, 8))
    );
    const renderedLines = wrapKoreanText(bubble.renderedText, charsPerLine);
    const height = renderedLines.length * fontSize * 1.35 + 32;
    if (height > region.height) continue;
    return {
      ...bubble,
      renderedLines,
      fontSize,
      x: region.x,
      y: region.y,
      width: region.width,
      height: region.height,
    };
  }
  return null;
}

function pairDetectedRegions(
  layouts: readonly PanelOverlayLayout[],
  regions: readonly BlankBalloonRegion[],
  width: number,
  height: number,
  panelCount: number
): {
  layouts: PanelOverlayLayout[];
  ambiguousRegionCount: number;
  rejectedRegionCount: number;
  insertedBubbleRegionCount: number;
  insertedNarrationRegionCount: number;
} {
  const used = new Set<number>();
  let ambiguousRegionCount = 0;
  let rejectedRegionCount = 0;
  let insertedBubbleRegionCount = 0;
  let insertedNarrationRegionCount = 0;
  const panelHeight = height / panelCount;
  const pairedLayouts = layouts.map((layout) => {
    const nextBubbles: SpeechBubbleLayout[] = [];
    const expected = [
      ...layout.bubbles.map((bubble) => ({ kind: "bubble" as const, bubble })),
      ...(layout.narration ? [{ kind: "narration" as const, narration: layout.narration }] : []),
    ];
    let nextNarration: PanelOverlayLayout["narration"];

    for (const item of expected) {
      const source =
        item.kind === "bubble" ? item.bubble : item.narration;
      const sourceX = source.x;
      const sourceY = source.y;
      const sourceWidth = source.width;
      const sourceHeight = source.height;
      const sourcePanelIndex = layout.panelIndex - 1;
      const sourceCenterX = sourceX + sourceWidth / 2;
      const sourceCenterY = sourceY + sourceHeight / 2;
      const sourceSide = regionSide(sourceX, sourceWidth, width);
      const matches = regions
        .map((region, index) => ({ region, index }))
        .filter(({ region, index }) => {
          if (used.has(index) || region.panelIndex !== sourcePanelIndex) return false;
          const regionCenterX = region.x + region.width / 2;
          const regionCenterY = region.y + region.height / 2;
          const distance = Math.hypot(
            (regionCenterX - sourceCenterX) / width,
            (regionCenterY - sourceCenterY) / panelHeight
          );
          if (distance > 0.48) return false;
          if (item.kind === "narration") {
            return regionCenterY < sourcePanelIndex * panelHeight + panelHeight * 0.72;
          }
          return regionSide(region.x, region.width, width) === sourceSide;
        });

      if (matches.length !== 1) {
        if (matches.length > 1) ambiguousRegionCount += 1;
        else rejectedRegionCount += 1;
        continue;
      }

      const match = matches[0]!;
      used.add(match.index);
      if (item.kind === "bubble") {
        const fitted = fitBubbleToRegion(item.bubble, match.region);
        if (!fitted) {
          rejectedRegionCount += 1;
          continue;
        }
        nextBubbles.push(fitted);
        insertedBubbleRegionCount += 1;
      } else {
        if (
          match.region.width < item.narration.width * 0.45 ||
          match.region.height < item.narration.height * 0.7
        ) {
          rejectedRegionCount += 1;
          continue;
        }
        nextNarration = {
          ...item.narration,
          x: match.region.x,
          y: match.region.y,
          width: match.region.width,
          height: match.region.height,
        };
        insertedNarrationRegionCount += 1;
      }
    }

    return {
      ...layout,
      bubbles: nextBubbles,
      narration: nextNarration,
    };
  });

  return {
    layouts: pairedLayouts,
    ambiguousRegionCount,
    rejectedRegionCount,
    insertedBubbleRegionCount,
    insertedNarrationRegionCount,
  };
}

/** Re-encode provider bytes through the same final WebP settings without SVG composite. */
export async function encodeComicFinalWebpWithoutOverlay(imageBuffer: Buffer): Promise<Buffer> {
  return await sharp(imageBuffer, { failOn: "none" })
    .webp(COMIC_FINAL_WEBP_OPTIONS)
    .toBuffer();
}

/**
 * Composites deterministic manhwa text overlay onto generated image bytes.
 * Server-only — uses Sharp for pixel composite and WebP encode.
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
    throw new Error(
      `Invalid image buffer for comic text overlay: ${err instanceof Error ? err.message : String(err)}`
    );
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
    .webp(COMIC_FINAL_WEBP_OPTIONS)
    .toBuffer();
}

/**
 * Experimental admin-only renderer. It never draws a speech-balloon or
 * narration-box body; only approved text glyphs are composited.
 */
export async function renderComicBlankBalloonHybrid(opts: {
  imageBuffer: Buffer;
  panelCount: number;
  plan: ScenePlan;
  visibility?: ScenePresentationVisibility;
  isSafetyFallback?: boolean;
  adultGrounded?: boolean;
  subjects?: readonly ChatImageVisualSubject[];
  textStrategy: ComicBlankBalloonTextStrategy;
  finalTextPolicy?: ComicFinalTextEligibilityContext;
}): Promise<{ buffer: Buffer; detection: BlankBalloonDetectionAudit }> {
  if (!opts.imageBuffer || opts.imageBuffer.length === 0) {
    throw new Error("Cannot render blank-balloon hybrid on empty image buffer");
  }

  let metadata: Metadata;
  try {
    metadata = await sharp(opts.imageBuffer, { failOn: "none" }).metadata();
  } catch (err) {
    throw new Error(
      `Invalid image buffer for blank-balloon hybrid: ${err instanceof Error ? err.message : String(err)}`
    );
  }
  if (!metadata.width || !metadata.height) {
    throw new Error("Invalid image buffer metadata for blank-balloon hybrid");
  }

  const visibility = opts.visibility ?? DEFAULT_SCENE_PRESENTATION_VISIBILITY;
  const plannedLayouts = compileComicPanelOverlayLayouts({
    width: metadata.width,
    height: metadata.height,
    panelCount: opts.panelCount,
    plan: opts.plan,
    visibility,
    safetyContext: {
      isSafetyFallback: opts.isSafetyFallback,
      adultGrounded: opts.adultGrounded,
      personaVisible: visibility.personaVisible,
      finalTextPolicy: opts.finalTextPolicy,
    },
    subjects: opts.subjects,
  });
  const approvedServerTextRegionCount = plannedLayouts.reduce(
    (count, layout) => count + layout.bubbles.length,
    0
  );
  const policySuppressedTextRegionCount = opts.finalTextPolicy
    ? countComicPanelDialogueSuppressed({
        plan: opts.plan,
        visibility,
        context: opts.finalTextPolicy,
      })
    : 0;
  const expectedProviderBalloonRegionCount =
    approvedServerTextRegionCount + policySuppressedTextRegionCount;
  let textLayouts = plannedLayouts;
  let detection: BlankBalloonDetectionAudit = {
    strategy: opts.textStrategy,
    expectedProviderBalloonRegionCount,
    approvedServerTextRegionCount,
    policySuppressedTextRegionCount,
    expectedTextRegionCount: approvedServerTextRegionCount,
    detectedRegionCount: approvedServerTextRegionCount,
    insertedTextRegionCount: approvedServerTextRegionCount,
    insertedNarrationRegionCount: 0,
    missingTextRegionCount: 0,
    ambiguousRegionCount: 0,
    rejectedRegionCount: 0,
    textInsertionComplete: true,
  };

  if (opts.textStrategy === "local_image_detection") {
    const regions = await detectBlankBalloonRegions(opts.imageBuffer, opts.panelCount);
    const paired = pairDetectedRegions(
      plannedLayouts,
      regions,
      metadata.width,
      metadata.height,
      opts.panelCount
    );
    textLayouts = paired.layouts;
    const missingTextRegionCount = Math.max(
      0,
      approvedServerTextRegionCount - paired.insertedBubbleRegionCount
    );
    detection = {
      strategy: opts.textStrategy,
      expectedProviderBalloonRegionCount,
      approvedServerTextRegionCount,
      policySuppressedTextRegionCount,
      expectedTextRegionCount: approvedServerTextRegionCount,
      detectedRegionCount: regions.length,
      insertedTextRegionCount: paired.insertedBubbleRegionCount,
      insertedNarrationRegionCount: paired.insertedNarrationRegionCount,
      missingTextRegionCount,
      ambiguousRegionCount: paired.ambiguousRegionCount,
      rejectedRegionCount: paired.rejectedRegionCount,
      textInsertionComplete: paired.insertedBubbleRegionCount === approvedServerTextRegionCount,
    };
  }

  const svgDoc = compileComicTextOnlyOverlaySvg({
    width: metadata.width,
    height: metadata.height,
    panelLayouts: textLayouts,
  });
  const buffer = await sharp(opts.imageBuffer, { failOn: "none" })
    .composite([{ input: Buffer.from(svgDoc) }])
    .webp(COMIC_FINAL_WEBP_OPTIONS)
    .toBuffer();
  return { buffer, detection };
}
