/**
 * Base price (2 grounded identity references included) for LD illustration and
 * TRPG party illustration — one provider generation request.
 */
export const CHAT_ILLUSTRATION_BASE_POINTS = 150;

/**
 * Base price (2 grounded identity references included) for 4-cut / horizontal
 * comic generation — unchanged while illustration base is reduced.
 */
export const CHAT_COMIC_BASE_POINTS = 180;

/**
 * Historical alias for the comic base price. Illustration/TRPG must use
 * CHAT_ILLUSTRATION_BASE_POINTS (via resolveChatLdIllustrationPrice).
 */
export const CHAT_ROOM_IMAGE_GENERATION_POINTS = CHAT_COMIC_BASE_POINTS;

/**
 * Identity references included in the base template price: the first two
 * identity-reference attachments of a request. In normal character chat these
 * are typically the persona and the main character; TRPG party scenes count
 * their own grounded participant references against the same base.
 */
export const CHAT_IMAGE_BASE_IDENTITY_REFERENCES = 2;

/**
 * APPROVED INITIAL SURCHARGE (test-phase value) — additional
 * identity-reference surcharge, in points per identity reference above
 * CHAT_IMAGE_BASE_IDENTITY_REFERENCES.
 *
 * NOT a cost-validated final price. Confirmed facts: GPT Image image input
 * tokens are billed, and every extra reference image adds image input tokens
 * (calculateGptImage2CostUsd reads usage.input_tokens_details.image_tokens).
 * Exact 2->3->4 marginal token/cost samples are NOT yet observed.
 *
 * Process: collect production cost cohorts (options_json.identityReferenceCount
 * + upstream_cost_usd + model), then adjust this ONE constant if the observed
 * cohorts require it. The 20P value is an approved initial/provisional product
 * surcharge pending observed cost cohorts.
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
 * Canonical final required points for ONE image generation request. Product
 * base (illustration vs comic) is passed explicitly; surcharge is counted once
 * per request, never multiplied by panelCount.
 */
export function resolveImageGenerationRequiredPoints(
  identityReferenceCount: number,
  basePoints: number
): number {
  return basePoints + resolveImageIdentityReferenceSurcharge(identityReferenceCount);
}