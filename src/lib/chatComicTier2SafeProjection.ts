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

/** Tier-2 visual beat buckets used to collapse duplicate contact/intimacy arc replay. */
export type Tier2PhysicalBeatCategory =
  | "kiss"
  | "embrace"
  | "close_proximity"
  | "resting"
  | "seated"
  | "standing"
  | "blush_emotion"
  | "general";

/** Mood-neutral continuity pose — does not inject new emotion; atmosphere stays in shared owner. */
export const TIER2_PANEL_CONTINUITY_POSE =
  "same cast in the same location — maintain safe visual continuity";

/** Global per-panel clothing safety contract in Tier-2 renderer (not a scene fact). */
export const TIER2_PANEL_GLOBAL_CLOTHING_CONTRACT = "modest covered clothing";

/**
 * Structured-source beat category — decided once from ScenePlan panel fields,
 * never re-inferred from rendered pose/situation strings.
 */
export function deriveTier2PhysicalBeatCategoryFromStructuredSource(opts: {
  personaAction?: string;
  characterAction?: string;
  situation?: string;
  background?: string;
}): Tier2PhysicalBeatCategory {
  const haystack = [
    opts.personaAction,
    opts.characterAction,
    opts.situation,
    opts.background,
  ]
    .filter(Boolean)
    .join(" ");
  if (!haystack.trim()) return "general";
  if (/(?:키스|kiss)/iu.test(haystack)) return "kiss";
  if (/(?:껴안|포옹|안아|감싸\s*안|어깨(?:를)?\s*(?:감|안)|hug|embrace)/iu.test(haystack)) {
    return "embrace";
  }
  if (
    /(?:가까|밀착|볼(?:에|을)|이마(?:를)?\s*(?:맞|대)|손(?:을)?\s*(?:잡|맞)|어깨(?:를)?\s*(?:감|안)|속삭|마주보|whisper|close(?:ly)?\s+(?:together|proximity)|affectionate\s+proximity)/iu.test(
      haystack
    )
  ) {
    return "close_proximity";
  }
  if (containsSafeLyingOrRestContext(haystack)) return "resting";
  if (/(?:앉(?:아|은|어)|seated|sitting)/iu.test(haystack)) return "seated";
  if (/(?:서(?:\s)?(?:있|서)|standing)/iu.test(haystack)) return "standing";
  if (/(?:홍조|수줍|부끄|blush|flushed|shy)/iu.test(haystack)) return "blush_emotion";
  return "general";
}

function isTier2DialogueFiller(text: string): boolean {
  const trimmed = text.trim();
  if (!trimmed) return true;
  if (/^(?:…|\.{2,3}|~+|ㅋ+|ㅎ+)$/u.test(trimmed)) return true;
  if (/^(?:응\.?|아\.?|음\.?|네\.?|응\.\.\.|아\.\.\.)$/u.test(trimmed)) return true;
  return trimmed.length <= 1;
}

/** Canonical Tier-2 dialogue cap — one representative line per panel, chronology preserved. */
export function boundTier2PanelDialogue(dialogue: readonly string[] | undefined): string[] {
  if (!dialogue?.length) return [];
  const meaningful = dialogue
    .map((line) => String(line ?? "").trim())
    .filter((line) => line && !isTier2DialogueFiller(line));
  const selected = meaningful[0] ?? dialogue.map((line) => String(line ?? "").trim()).find(Boolean);
  return selected ? [selected] : [];
}

export function deriveTier2PanelVisualBeat(opts: {
  personaAction?: string;
  characterAction?: string;
  situation?: string;
  background?: string;
}): { poseHint: string; physicalBeatCategory: Tier2PhysicalBeatCategory } {
  const physicalBeatCategory = deriveTier2PhysicalBeatCategoryFromStructuredSource(opts);
  const canonical = canonicalTier2SafePose(opts);
  if (canonical) {
    return { poseHint: canonical, physicalBeatCategory };
  }

  const persona = opts.personaAction ? projectSceneBlockForTier2Comic(opts.personaAction).text.trim() : "";
  const character = opts.characterAction
    ? projectSceneBlockForTier2Comic(opts.characterAction).text.trim()
    : "";
  const combined = [persona, character].filter(Boolean).join("; ");
  if (combined) {
    return { poseHint: combined, physicalBeatCategory };
  }

  const situation = String(opts.situation ?? "").trim();
  if (/누(?:워|운|어)/u.test(situation)) {
    return {
      poseHint: "same characters resting on the bed with modest covered clothing and calm expressions",
      physicalBeatCategory,
    };
  }
  if (/앉(?:아|은|어)/u.test(situation)) {
    return {
      poseHint: "same characters seated in the same location with modest posture",
      physicalBeatCategory,
    };
  }
  if (/서(?: 있|서)/u.test(situation)) {
    return {
      poseHint: "same characters standing in the same location with readable expressions",
      physicalBeatCategory,
    };
  }
  return {
    poseHint: "same cast in the same location with modest posture and readable expressions",
    physicalBeatCategory,
  };
}
