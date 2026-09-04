import sharp, { type Metadata } from "sharp";
import type { SceneDialogue, ScenePanel, ScenePlan, ScenePresentationVisibility } from "@/lib/chatImageScenePlan";
import { isEligibleSpeechDialogue } from "@/lib/chatImageScenePlan";
import {
  classifyRawVisualRisk,
  containsRawRiskySourceLeak,
} from "@/lib/chatImageSafeVisualProjection";
import type { ChatImageVisualSubject } from "@/lib/chatImageVisualIdentity";

/**
 * COMIC TEXT OVERLAY SUB-SYSTEM (OVERLAY-FIRST ARCHITECTURE)
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

export type TextOverlaySafetyContext = {
  isSafetyFallback?: boolean;
  adultGrounded?: boolean;
  personaVisible?: boolean;
};

export type SpeechBubbleLayout = {
  speaker: "persona" | "character" | "other";
  speakerName?: string;
  rawText: string;
  x: number;
  y: number;
  width: number;
  height: number;
  tailX: number;
  tailY: number;
  tailTargetX: number;
  tailTargetY: number;
  lines: string[];
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

export function layoutPanelBubbles(opts: {
  dialogue: readonly SceneDialogue[];
  panelX: number;
  panelY: number;
  panelWidth: number;
  panelHeight: number;
  personaVisible?: boolean;
}): SpeechBubbleLayout[] {
  const { dialogue, panelX, panelY, panelWidth, panelHeight } = opts;
  if (!dialogue.length) return [];

  const layouts: SpeechBubbleLayout[] = [];
  const fontSize = 23;
  const lineHeight = fontSize * 1.35;
  const paddingH = 22;
  const paddingV = 16;

  // Staggering budget
  let personaIndex = 0;
  let characterIndex = 0;

  for (const line of dialogue) {
    const lines = wrapKoreanText(line.text, 13);
    const maxLineChars = Math.max(...lines.map((l) => l.length), 3);
    const textWidth = Math.max(120, maxLineChars * fontSize * 0.95);
    const textHeight = lines.length * lineHeight;
    const bubbleWidth = Math.min(panelWidth * 0.46, textWidth + paddingH * 2);
    const bubbleHeight = textHeight + paddingV * 2;

    const isPersona = line.speaker === "persona";
    const isCharacter = line.speaker === "character";

    let x: number;
    let y: number;
    let tailX: number;
    let tailY: number;
    let tailTargetX: number;
    let tailTargetY: number;

    if (isPersona) {
      // Persona placed on left side
      x = panelX + 44;
      y = panelY + 32 + personaIndex * (bubbleHeight + 18);
      // Ensure within panel
      if (y + bubbleHeight > panelY + panelHeight - 20) {
        y = panelY + panelHeight - bubbleHeight - 20;
      }
      tailX = x + 36;
      tailY = y + bubbleHeight;
      tailTargetX = x + 16;
      tailTargetY = tailY + 28;
      personaIndex++;
    } else if (isCharacter) {
      // Character placed on right side
      x = panelX + panelWidth - bubbleWidth - 44;
      y = panelY + 36 + characterIndex * (bubbleHeight + 18);
      if (y + bubbleHeight > panelY + panelHeight - 20) {
        y = panelY + panelHeight - bubbleHeight - 20;
      }
      tailX = x + bubbleWidth - 36;
      tailY = y + bubbleHeight;
      tailTargetX = x + bubbleWidth - 16;
      tailTargetY = tailY + 28;
      characterIndex++;
    } else {
      // Other / Named supporting speaker: placed near center or staggered
      x = panelX + (panelWidth - bubbleWidth) / 2;
      y = panelY + 40 + (personaIndex + characterIndex) * 24;
      tailX = x + bubbleWidth / 2;
      tailY = y + bubbleHeight;
      tailTargetX = x + bubbleWidth / 2;
      tailTargetY = tailY + 28;
    }

    layouts.push({
      speaker: line.speaker,
      speakerName: line.speakerName,
      rawText: line.text,
      x,
      y,
      width: bubbleWidth,
      height: bubbleHeight,
      tailX,
      tailY,
      tailTargetX,
      tailTargetY,
      lines,
      fontSize,
    });
  }

  return layouts;
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
    const bubbles = layoutPanelBubbles({
      dialogue: approvedDialogue,
      panelX,
      panelY,
      panelWidth: width,
      panelHeight,
      personaVisible: visibility.personaVisible,
    });

    // Narration Box
    const narration = layoutPanelNarration({
      panel,
      panelX,
      panelY,
      panelWidth: width,
      panelHeight,
      hasBubbles: bubbles.length > 0,
    });

    if (narration) {
      svgElements.push(`
        <!-- Panel ${i + 1} Narration Box -->
        <g class="narration-box" filter="url(#shadow)">
          <rect x="${narration.x}" y="${narration.y}" width="${narration.width}" height="${narration.height}"
                rx="6" ry="6" fill="#f8fafc" stroke="#334155" stroke-width="2.5" />
          <text x="${narration.x + 14}" y="${narration.y + narration.fontSize + 8}"
                font-family="NanumSquareRound, NanumGothic, NanumBarunGothic, sans-serif"
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
        (bubble.height - bubble.lines.length * bubble.fontSize * 1.35) / 2 +
        bubble.fontSize * 0.95;

      svgElements.push(`
        <!-- Panel ${i + 1} Speech Bubble (${bubble.speaker}) -->
        <g class="speech-bubble" data-text="${escapeXml(bubble.rawText)}" filter="url(#shadow)">
          <path d="${pathData}" fill="#ffffff" stroke="#0f172a" stroke-width="3.5" stroke-linejoin="round" />
          ${
            bubble.speakerName
              ? `<rect x="${bubble.x + 12}" y="${bubble.y - 12}" width="${bubble.speakerName.length * 14 + 16}" height="20" rx="4" fill="#3b82f6" />
                 <text x="${bubble.x + 20}" y="${bubble.y + 2}" font-family="NanumSquareRound, NanumGothic, sans-serif" font-size="11" font-weight="bold" fill="#ffffff">${escapeXml(
                  bubble.speakerName
                )}</text>`
              : ""
          }
          <text x="${textCenterX}" y="${firstLineY}"
                font-family="NanumSquareRound, NanumGothic, NanumBarunGothic, sans-serif"
                font-size="${bubble.fontSize}" font-weight="700" fill="#0f172a" text-anchor="middle">
            ${bubble.lines
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
    const sfx = extractPanelSfxCue(panel);
    if (sfx) {
      const sfxX = panelX + width * 0.52;
      const sfxY = panelY + panelHeight * 0.72;
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
