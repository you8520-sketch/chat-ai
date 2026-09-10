/**
 * Canonical price for every image product launched from a chat or TRPG room.
 * This is the BASE price for one provider generation request and already
 * includes the base identity-reference pack (persona + main character =
 * CHAT_IMAGE_BASE_IDENTITY_REFERENCES). Every extra identity reference above
 * the base adds the canonical additional-identity-reference surcharge.
 */
export const CHAT_ROOM_IMAGE_GENERATION_POINTS = 180;

/**
 * Identity references included in the base template price. A normal duo scene
 * (persona + main character) sends exactly this many identity references.
 */
export const CHAT_IMAGE_BASE_IDENTITY_REFERENCES = 2;

/**
 * PROPOSED — additional identity-reference surcharge, in points per identity
 * reference above CHAT_IMAGE_BASE_IDENTITY_REFERENCES.
 *
 * NOT an arbitrary number: it covers the marginal provider upstream cost of
 * one extra input reference image (the provider bills every attached
 * reference image as image input tokens; calculateGptImage2CostUsd reads
 * usage.input_tokens_details.image_tokens at $8/1M). 20P = ~11% of the 180P
 * base — a conservative proposal pending validation against recorded
 * upstream_cost_usd after the feature ships. Adjust this ONE constant to
 * change the surcharge everywhere.
 */
export const CHAT_IMAGE_REFERENCE_SURCHARGE_POINTS = 20;

/**
 * Additional-points surcharge for identity references above the base. The
 * pricing input is ALWAYS the server-grounded final identity-reference
 * attachment count — never a client-selected cast/participant count. Counts
 * at or below the base incur no surcharge (no negative surcharge).
 */
export function resolveImageIdentityReferenceSurcharge(identityReferenceCount: number): number {
  const extraReferences = Math.max(0, identityReferenceCount - CHAT_IMAGE_BASE_IDENTITY_REFERENCES);
  return extraReferences * CHAT_IMAGE_REFERENCE_SURCHARGE_POINTS;
}

/**
 * Canonical final required points for ONE image generation request. Single
 * pricing owner shared by regular illustration, regular comic (fixed 4-panel
 * page = one provider generation request — surcharge is counted once per
 * request, never multiplied by panelCount), and TRPG party illustration.
 */
export function resolveImageGenerationRequiredPoints(
  identityReferenceCount: number,
  basePoints: number = CHAT_ROOM_IMAGE_GENERATION_POINTS
): number {
  return basePoints + resolveImageIdentityReferenceSurcharge(identityReferenceCount);
}