import {
  GENDER_LABELS,
  parseCharacterGender,
  resolveCharacterGender,
} from "@/lib/characterGender";
import { buildChatImageSubjectGenderLock } from "@/lib/chatImageGender";

export const CHAT_PERSONA_IMAGE_TEMPLATE_ID = "persona_portrait_ld" as const;
export const CHAT_PERSONA_IMAGE_TEMPLATE_NAME = "페르소나 3:5 LD 이미지";

// OpenAI Images requires both sides divisible by 16; keep exact 3:5.
export const CHAT_PERSONA_IMAGE_OUTPUT_WIDTH = 864;
export const CHAT_PERSONA_IMAGE_OUTPUT_HEIGHT = 1440;
// Keep a post-response size check in the route as a defensive fallback for
// configured provider/model overrides.
export const CHAT_PERSONA_IMAGE_API_OUTPUT_SIZE =
  `${CHAT_PERSONA_IMAGE_OUTPUT_WIDTH}x${CHAT_PERSONA_IMAGE_OUTPUT_HEIGHT}` as const;
export const CHAT_PERSONA_IMAGE_QUALITY = "medium" as const;
export const CHAT_PERSONA_IMAGE_DEFAULT_POINTS = 200;

const APPEARANCE_SIGNAL =
  /(?:외모|외형|생김새|인상|머리|헤어|금발|은발|흑발|갈색머리|적발|눈|눈동자|벽안|적안|녹안|키|신장|체격|체형|피부|얼굴|복장|의상|옷|교복|정장|드레스|후드|장신구|안경|귀걸이|흉터|문신|점|날개|뿔|귀|꼬리|appearance|hair|eyes?|height|build|skin|face|outfit|clothes?|accessor(?:y|ies)|scar|tattoo)/i;

export function extractPersonaAppearance(description: unknown): string {
  const normalized = String(description ?? "")
    .replace(/\r\n?/g, "\n")
    .replace(/[ \t]+/g, " ")
    .trim();
  if (!normalized) return "";

  const segments = normalized
    .split(/\n+|(?<=[.!?。！？])\s+/)
    .map((segment) => segment.trim())
    .filter((segment) => segment && APPEARANCE_SIGNAL.test(segment));
  return segments.join("\n").slice(0, 1_600).trim();
}

export function personaImageReadiness(persona: {
  gender?: unknown;
  description?: unknown;
} | null) {
  const missing: string[] = [];
  if (!persona) return { ready: false, missing: ["선택 페르소나"] };

  const gender = parseCharacterGender(persona.gender);
  if (!gender) missing.push("페르소나 성별 설정");
  const appearance = extractPersonaAppearance(persona.description);
  if (!appearance) missing.push("페르소나 외관 설정");
  return {
    ready: missing.length === 0,
    missing,
    gender: gender ?? "other",
    appearance,
  };
}

export function buildChatPersonaImagePrompt(opts: {
  personaName: string;
  gender: unknown;
  appearance: string;
  characterName: string;
}) {
  const gender = resolveCharacterGender(opts.gender);
  return [
    "Create one polished vertical 3:5 full-body or three-quarter character portrait of the user persona described below.",
    `Reference image 1 is ONLY the art-style reference from the chat character ${opts.characterName}. Match its line quality, rendering, coloring, lighting, facial design language, texture, and overall finish. Do not copy that character's identity, face, hair, outfit, body, accessories, or pose.`,
    `The depicted subject is ${opts.personaName}, not ${opts.characterName}. Exactly one person.`,
    `Saved gender setting: ${GENDER_LABELS[gender]}. Respect this setting exactly; when it is 기타, follow the appearance description without forcing a binary presentation.`,
    buildChatImageSubjectGenderLock({
      label: "user persona",
      name: opts.personaName,
      gender,
    }),
    "Saved appearance features (authoritative identity description):",
    opts.appearance,
    "Preserve every concrete appearance feature above. Do not invent conflicting hair, eye, body, clothing, accessory, species, or gender traits.",
    "Use a clean, cohesive, profile-friendly composition with the face and important details away from crop edges. Neutral simple background that complements the reference artwork.",
    "No other people, duplicate body, text, caption, signature, logo, watermark, frame, comic panel, or speech bubble.",
    "Compose natively for an exact 864x1440 pixel canvas (3:5). Keep safe space in case a provider override requires a centered fallback crop.",
  ].join("\n\n");
}

export function resolveChatPersonaImagePrice() {
  return CHAT_PERSONA_IMAGE_DEFAULT_POINTS;
}
