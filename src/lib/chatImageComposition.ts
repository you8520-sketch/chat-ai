/**
 * Canonical relative-scale / composition intent for duo image products.
 * Product modules translate this spec; they must not invent their own scale wording.
 */

export type ChatImageRelativeScale = "same_height" | "user_taller" | "partner_taller";

export type ChatImageCompositionProduct =
  | "gift_sd"
  | "emoticon"
  | "couple_stamp"
  | "ld_duo"
  | "ld_party";

export type ChatImageCompositionSpec = {
  scale: ChatImageRelativeScale;
  product: ChatImageCompositionProduct;
  characterName: string;
  personaName: string;
};

export type CoupleStampHeightId = "same" | "character_taller" | "persona_taller";

const SCALE_ASSERTIONS: Record<
  ChatImageRelativeScale,
  { taller: "user persona" | "chat character" | null; shorter: "user persona" | "chat character" | null }
> = {
  same_height: { taller: null, shorter: null },
  user_taller: { taller: "user persona", shorter: "chat character" },
  partner_taller: { taller: "chat character", shorter: "user persona" },
};

function displayName(role: "user persona" | "chat character", spec: ChatImageCompositionSpec): string {
  return role === "user persona"
    ? spec.personaName.trim() || "user persona"
    : spec.characterName.trim() || "chat character";
}

function scaleHeader(spec: ChatImageCompositionSpec): string {
  const { scale } = spec;
  if (scale === "same_height") {
    return [
      "COMPOSITION — relative scale (mandatory):",
      `Keep ${displayName("user persona", spec)} and ${displayName("chat character", spec)} at the same relative scale.`,
      "Match eye-line, head size, shoulder level, and silhouette presence. Do not make either person dominate frame share.",
    ].join("\n");
  }

  const meta = SCALE_ASSERTIONS[scale];
  const tallerName = displayName(meta.taller!, spec);
  const shorterName = displayName(meta.shorter!, spec);

  return [
    "COMPOSITION — relative scale (mandatory):",
    `${tallerName} must read visibly LARGER than ${shorterName}.`,
    "Do NOT equalize sizes for cuteness or template symmetry.",
    `${tallerName}: larger head/body silhouette, higher eye-line when standing, broader shoulder presence, and greater frame share.`,
    `${shorterName}: slightly smaller silhouette and lower dominance in the frame.`,
  ].join("\n");
}

function productTranslation(spec: ChatImageCompositionSpec): string {
  switch (spec.product) {
    case "couple_stamp":
      if (spec.scale === "same_height") {
        return "In every circular badge: equal eye-line inside the circle — neither person taller or larger.";
      }
      if (spec.scale === "user_taller") {
        return [
          "In ALL four badges including the tight cheek close-up:",
          "the user persona must occupy more of the circle — larger head, broader upper-body presence, and higher visual dominance.",
          "The chat character stays slightly smaller even when faces are zoomed in.",
        ].join(" ");
      }
      return [
        "In ALL four badges including the tight cheek close-up:",
        "the chat character must occupy more of the circle — larger head, broader upper-body presence, and higher visual dominance.",
        "The user persona stays slightly smaller even when faces are zoomed in.",
      ].join(" ");
    case "gift_sd":
      if (spec.scale === "same_height") {
        return "SD chibi duo: equal standing height and balanced head size in the gift-box layout.";
      }
      if (spec.scale === "user_taller") {
        return "SD chibi duo: user persona slightly taller / larger silhouette than the chat character while keeping the template layout.";
      }
      return "SD chibi duo: chat character slightly taller / larger silhouette than the user persona while keeping the template layout.";
    case "emoticon":
      if (spec.scale === "same_height") {
        return "Emoticon panels: equal head size when both appear; solo panels unchanged.";
      }
      if (spec.scale === "user_taller") {
        return "Duo panels: user persona slightly larger frame share; solo panels unchanged.";
      }
      return "Duo panels: chat character slightly larger frame share; solo panels unchanged.";
    case "ld_duo":
      if (spec.scale === "same_height") {
        return "Full-body or mid-shot: matched standing height and shoulder line.";
      }
      if (spec.scale === "user_taller") {
        return "Full-body or mid-shot: user persona visibly taller — higher shoulder line and larger body presence.";
      }
      return "Full-body or mid-shot: chat character visibly taller — higher shoulder line and larger body presence.";
    case "ld_party":
      return "Party illustration: relative scale applies only to the named duo pair when both appear; do not resize unrelated cast members.";
    default: {
      const _exhaustive: never = spec.product;
      return _exhaustive;
    }
  }
}

export function coupleStampHeightToRelativeScale(
  raw: unknown,
  fallback: ChatImageRelativeScale = "same_height"
): ChatImageRelativeScale {
  const value = String(raw ?? "");
  switch (value as CoupleStampHeightId) {
    case "persona_taller":
      return "user_taller";
    case "character_taller":
      return "partner_taller";
    case "same":
      return "same_height";
    default:
      return fallback;
  }
}

export function isChatImageRelativeScale(value: unknown): value is ChatImageRelativeScale {
  return value === "same_height" || value === "user_taller" || value === "partner_taller";
}

/** Single canonical composition block for prompt assembly. */
export function renderChatImageCompositionBlock(spec: ChatImageCompositionSpec): string {
  if (spec.scale === "same_height" && spec.product === "ld_party") {
    return "";
  }
  return [scaleHeader(spec), productTranslation(spec)].filter(Boolean).join("\n");
}
