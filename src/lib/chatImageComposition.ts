/**
 * Canonical relative-scale owner for duo image products.
 * Only couple stamp currently exposes a height control; do not invent
 * speculative translations for products with no runtime caller.
 */

export type ChatImageRelativeScale = "same_height" | "user_taller" | "partner_taller";

export type ChatImageCompositionSpec = {
  scale: ChatImageRelativeScale;
  characterName: string;
  personaName: string;
};

export type CoupleStampHeightId = "same" | "character_taller" | "persona_taller";

function displayName(
  role: "user persona" | "chat character",
  spec: ChatImageCompositionSpec
): string {
  return role === "user persona"
    ? spec.personaName.trim() || "user persona"
    : spec.characterName.trim() || "chat character";
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

/** Single canonical composition block. Couple-stamp is the only runtime caller. */
export function renderChatImageCompositionBlock(spec: ChatImageCompositionSpec): string {
  const persona = displayName("user persona", spec);
  const character = displayName("chat character", spec);

  if (spec.scale === "same_height") {
    return [
      "COMPOSITION — relative scale (mandatory):",
      `Keep ${persona} and ${character} at the same relative visual stature.`,
      "Match eye-line and shoulder relationship where standing height is visible.",
      "In every circular badge: equal eye-line inside the circle — neither person taller.",
    ].join("\n");
  }

  const taller = spec.scale === "user_taller" ? persona : character;
  const shorter = spec.scale === "user_taller" ? character : persona;
  const tallerRole = spec.scale === "user_taller" ? "user persona" : "chat character";

  return [
    "COMPOSITION — relative scale (mandatory):",
    `${taller} must read visibly taller than ${shorter}.`,
    "Do NOT equalize sizes for cuteness or template symmetry.",
    `${taller}: higher visual stature — higher eye-line / shoulder relationship where the pose shows standing height.`,
    `${shorter}: slightly shorter visual stature.`,
    `In ALL four badges including the tight cheek close-up (where standing height is hard to show): the ${tallerRole} has slightly stronger frame share / presence. The other person stays slightly less dominant even when faces are zoomed in.`,
  ].join("\n");
}
