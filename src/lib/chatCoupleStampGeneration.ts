export const CHAT_COUPLE_STAMP_TEMPLATE_ID = "couple_stamps_4" as const;
export const CHAT_COUPLE_STAMP_TEMPLATE_NAME = "커플 인장 4종";
export const CHAT_COUPLE_STAMP_TEMPLATE_PREVIEW_URL =
  "/image-templates/sd-couple-stamps-4.webp";

export const CHAT_COUPLE_STAMP_GENERATION_DEFAULT_POINTS = 220;
export const CHAT_COUPLE_STAMP_API_OUTPUT_WIDTH = 816;
export const CHAT_COUPLE_STAMP_API_OUTPUT_HEIGHT = 816;
export const CHAT_COUPLE_STAMP_API_OUTPUT_SIZE =
  `${CHAT_COUPLE_STAMP_API_OUTPUT_WIDTH}x${CHAT_COUPLE_STAMP_API_OUTPUT_HEIGHT}` as const;
export const CHAT_COUPLE_STAMP_OUTPUT_WIDTH = 800;
export const CHAT_COUPLE_STAMP_OUTPUT_HEIGHT = 800;
export const CHAT_COUPLE_STAMP_QUALITY = "medium" as const;

export function buildChatCoupleStampPrompt(opts: {
  characterName: string;
  personaName: string;
}): string {
  return [
    "Create one polished square 2-by-2 contact sheet containing exactly four equal circular couple profile icons for Twitter/X.",
    "Reference image 1 is the fixed layout and finish reference. Preserve its four equal circular badges, generous social-profile safe margins and four visibly different illustration finishes. Do not copy its people.",
    `Reference image 2 is the identity reference for chat character ${opts.characterName}. Reference image 3 is the identity reference for user persona ${opts.personaName}.`,
    "Identity separation is critical. Preserve each person's hair color, eye color, hairstyle, facial details, accessories and signature outfit impression in every badge. Never blend, swap or duplicate the two identities.",
    "Use these exact four fixed variants:",
    "1. TOP LEFT — clean bold-line chibi selfie. Cat-ear and oversized cat-paw glove theme. Both raise one paw toward the camera. This is the only badge with cat ears or cat-paw gloves.",
    "2. TOP RIGHT — soft pastel watercolor chibi. No animal ears, animal hood or paw gloves. The couple cuddles ordinary teddy-bear and bunny plush toys with tiny ribbons and hearts.",
    "3. BOTTOM LEFT — retro sticker/doodle chibi. Both wear loose bunny-ear hoodies and form one small heart together using normal bare hands. No cat ears and no paw gloves.",
    "4. BOTTOM RIGHT — glossy premium mini-anime. No animal ears, animal hood, paw gloves or plush animals. One hugs the other from behind, cheek-to-cheek, with small flowers, stars and a ribbon frame.",
    "Keep both faces, all head accessories and the important gesture fully inside each circle. No overlap between cells.",
    "Exactly two recurring people per badge and exactly four badges. No extra person, identity swap, merged face, text, letters, signature, logo, watermark, UI, screenshot border or cropping mark.",
  ].join("\n\n");
}

export function resolveChatCoupleStampPrice(): number {
  return CHAT_COUPLE_STAMP_GENERATION_DEFAULT_POINTS;
}
