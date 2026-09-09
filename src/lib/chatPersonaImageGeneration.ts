import {
  GENDER_LABELS,
  parseCharacterGender,
  resolveCharacterGender,
} from "@/lib/characterGender";
import { buildChatImageSubjectGenderLock } from "@/lib/chatImageGender";
import { extractVisualAppearance } from "@/lib/chatImageVisualIdentity";

export function extractPersonaAppearance(description: unknown): string {
  return extractVisualAppearance(description);
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
