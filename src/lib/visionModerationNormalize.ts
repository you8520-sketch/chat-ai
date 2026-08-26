/** Shared vision moderation normalization — unit-tested without API calls. */

export type VisionModerationFlags = {
  tag: string;
  adultFlagged: boolean;
  moderationReject: boolean;
  moderationReason: string;
};

function moderationBlob(parsed: Pick<VisionModerationFlags, "tag" | "moderationReason">): string {
  return `${parsed.tag} ${parsed.moderationReason}`.trim();
}

/** Model output hints at back/shoulder-only framing — not front chest or genitals. */
const BACK_ONLY_EXPOSURE_RE =
  /(?:등짝|등\s*노출|뒤(?:돌|에서|모습|통|쪽|를)?|후면|등\s*보|어깨(?:만|노출)?|등\s*라인|back\s*view)/iu;

/** Explicit sexual surfaces / poses — keep adult classification when present. */
const EXPLICIT_SEXUAL_SURFACE_RE =
  /(?:가슴|유방|유두|젖(?:꼭지)?|nipple|breasts?|전면\s*노출|앞모습|속옷|란제리|팬티|브라|성기|음부|음경|항문|엉덩|힙|buttocks?|하의\s*탈|전라|나체|누드|성행위|성적\s*포즈|선정적\s*포즈|자위|삽입|topless|nude)/iu;

const BACK_ONLY_TAG_RE = /^(?:등짝|뒤돌|후면|등\s*노출|어깨(?:노출)?)/u;

/**
 * Downgrade false-positive adult flags for back/shoulder-only character art.
 * Never overrides hard rejects (genitals, explicit acts, minors).
 */
export function normalizeVisionModerationFlags<T extends VisionModerationFlags>(parsed: T): T {
  if (parsed.moderationReject || !parsed.adultFlagged) return parsed;

  const blob = moderationBlob(parsed);
  const tag = parsed.tag.trim();

  const backOnlyHint = BACK_ONLY_EXPOSURE_RE.test(blob) || BACK_ONLY_TAG_RE.test(tag);
  if (backOnlyHint && !EXPLICIT_SEXUAL_SURFACE_RE.test(blob)) {
    return { ...parsed, adultFlagged: false };
  }

  return parsed;
}
