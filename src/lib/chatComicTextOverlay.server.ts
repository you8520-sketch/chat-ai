import sharp, { type Metadata } from "sharp";

import { compileComicTextOverlaySvg } from "@/lib/chatComicTextOverlay";
import type { ScenePlan, ScenePresentationVisibility } from "@/lib/chatImageScenePlan";
import type { ChatImageVisualSubject } from "@/lib/chatImageVisualIdentity";

export const COMIC_FINAL_WEBP_OPTIONS = { quality: 90, effort: 4 } as const;

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
