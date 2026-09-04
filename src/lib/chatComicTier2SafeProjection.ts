/**
 * Tier-2 comic-only positive safe text projection.
 * Uses general-audience substitutes — no negative sexual policy vocabulary.
 */

import { sanitizeChatTurnForIllustrationPrompt } from "@/lib/chatImageIllustrationSanitizer";
import {
  classifyRawVisualRisk,
  type SafeVisualProjectionResult,
  type SafeVisualReasonCategory,
} from "@/lib/chatImageSafeVisualProjection";

const INTIMATE_BEDROOM_CONTEXT =
  /(?:침대\s*(?:에서|위(?:에서)?)|이불(?:\s*(?:속|아래|위|밑))?|시트(?:\s*(?:아래|위))?|bedroom|(?:^|[\s,.])bed(?:$|[\s,.]))/iu;

/** Positive Tier-2 bedroom rest — preserves location without policy negative wording. */
export const TIER2_BEDROOM_REST_POSITIVE =
  "Private bedroom; the same characters resting close together, modestly covered by sheets or clothing, calm tender expressions, warm quiet lighting.";

/** Positive Tier-2 affection — preserves warmth without policy negative wording. */
export const TIER2_AFFECTION_POSITIVE =
  "The same characters together in the same location, calm affectionate proximity, modest covered framing, readable emotional expressions.";

export const TIER2_GRAPHIC_AFTERMATH_POSITIVE =
  "Emotional aftermath scene: concern and fatigue visible through expression and posture, no injury depicted.";

export const TIER2_EMOTIONAL_DISTRESS_POSITIVE =
  "Same location; emotional distress visible through expression and posture only.";

/** Canonical positive-only Tier-2 comic safe depiction contract. */
export const COMIC_TIER2_POSITIVE_SAFE_DEPICTION =
  "GENERAL-AUDIENCE VISUAL CONTRACT — family-safe manhwa depiction suitable for all ages. Every character remains fully clothed or modestly covered. Use ordinary resting, sitting, standing, or conversational body language. Preserve cast identity, location continuity, and emotional tone. Calm affectionate closeness is allowed.";

function tier2PositiveSubstitute(
  categories: readonly SafeVisualReasonCategory[],
  raw: string
): string {
  if (categories.includes("adult_explicit")) {
    return INTIMATE_BEDROOM_CONTEXT.test(raw)
      ? TIER2_BEDROOM_REST_POSITIVE
      : TIER2_AFFECTION_POSITIVE;
  }
  if (categories.includes("graphic_violence")) {
    return TIER2_GRAPHIC_AFTERMATH_POSITIVE;
  }
  if (categories.includes("self_harm")) {
    return TIER2_EMOTIONAL_DISTRESS_POSITIVE;
  }
  return sanitizeChatTurnForIllustrationPrompt(raw);
}

/** Tier-2 comic image projection — positive substitutes only, never adult-grounded allowance. */
export function projectSceneTextForTier2Comic(raw: string): SafeVisualProjectionResult {
  const rawTrimmed = String(raw ?? "").trim();
  const reasonCategories = classifyRawVisualRisk(rawTrimmed);

  if (!reasonCategories.length) {
    const sanitized = sanitizeChatTurnForIllustrationPrompt(rawTrimmed);
    return {
      text: sanitized,
      applied: sanitized !== rawTrimmed,
      omitFromImage: false,
      reasonCategories: [],
    };
  }

  return {
    text: tier2PositiveSubstitute(reasonCategories, rawTrimmed),
    applied: true,
    omitFromImage: false,
    reasonCategories,
  };
}

export function projectSceneBlockForTier2Comic(raw: string): SafeVisualProjectionResult {
  const rawTrimmed = String(raw ?? "").trim();
  if (!rawTrimmed) {
    return {
      text: "",
      applied: false,
      omitFromImage: false,
      reasonCategories: [],
    };
  }

  const fragments = rawTrimmed
    .split(/\n+/)
    .flatMap((line) => line.split(/(?<=[.!?…])\s+/u))
    .map((part) => part.trim())
    .filter(Boolean);

  if (!fragments.length) {
    return {
      text: "",
      applied: false,
      omitFromImage: false,
      reasonCategories: [],
    };
  }

  const categories: SafeVisualReasonCategory[] = [];
  let applied = false;
  const projected = fragments.map((fragment) => {
    const result = projectSceneTextForTier2Comic(fragment);
    if (result.applied) applied = true;
    categories.push(...result.reasonCategories);
    return result.omitFromImage ? null : result.text;
  });

  return {
    text: projected.filter(Boolean).join("\n"),
    applied,
    omitFromImage: projected.every((line) => line == null),
    reasonCategories: [...new Set(categories)],
  };
}

export function containsBedroomBedContext(text: string): boolean {
  return /(?:bedroom|bed|침실|침대|이불)/iu.test(text);
}

export function containsSafeLyingOrRestContext(text: string): boolean {
  return /(?:누(?:워|운|어|워서)|lying|reclin|resting|rest(?:ing)?|sleep(?:ing)?|이불(?:\s*(?:속|아래|덮)))/iu.test(
    text
  );
}

/** Whole-action Tier-2 pose replacement when source action carries visual risk. */
export function canonicalTier2SafePose(opts: {
  personaAction?: string;
  characterAction?: string;
  situation?: string;
  background?: string;
}): string | null {
  const actions = [opts.personaAction, opts.characterAction].filter(Boolean) as string[];
  const risky = actions.some((text) => classifyRawVisualRisk(text).length > 0);
  if (!risky) return null;

  const haystack = [
    opts.personaAction,
    opts.characterAction,
    opts.situation,
    opts.background,
  ]
    .filter(Boolean)
    .join(" ");

  const bedroom = containsBedroomBedContext(haystack);
  const lying = containsSafeLyingOrRestContext(haystack);
  const hugging = /(?:껴안|포옹|안아|hug|embrace|closeness)/iu.test(haystack);

  if (bedroom && lying) {
    return "same characters resting on the bed with modest covered clothing and calm expressions";
  }
  if (bedroom) {
    return "same characters in the bedroom with modest covered clothing and calm expressions";
  }
  if (hugging) {
    return "same characters sharing calm affectionate proximity with modest covered clothing";
  }
  return "same cast in the same location with modest posture and readable expressions";
}
