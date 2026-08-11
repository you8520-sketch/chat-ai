import { resolveCharacterGender } from "@/lib/characterGender";
import {
  buildImageGenderLockPrompt,
  type ImagePromptGender,
} from "@/lib/chatImageGeneration";

/**
 * Canonical gender wiring for ALL chat image-generation modes
 * (SD gift, emoticon, couple stamp, comic, current-turn LD, persona portrait,
 * and any future image tabs under ChatImageGeneratorPanel).
 *
 * Rules for new tabs:
 * 1. Load `characters.gender` and `user_personas.gender` from DB.
 * 2. Resolve with `resolveImagePromptGender`.
 * 3. Pass required genders into the prompt builder (do not omit / silently default).
 * 4. Include `buildChatImagePairGenderLock` (two subjects) or
 *    `buildChatImageSubjectGenderLock` (persona-only) in the final image prompt.
 */

export type ChatImageGenderPair = {
  characterName: string;
  characterGender: ImagePromptGender;
  personaName: string;
  personaGender: ImagePromptGender;
};

export type ChatImageGenderSubject = {
  label: string;
  name: string;
  gender: ImagePromptGender;
};

export function resolveImagePromptGender(value: unknown): ImagePromptGender {
  return resolveCharacterGender(value);
}

export function genderWordForImagePrompt(gender: ImagePromptGender): string {
  if (gender === "male") return "male";
  if (gender === "female") return "female";
  return "gender-unspecified";
}

/** Required pair lock for character + persona image modes. */
export function buildChatImagePairGenderLock(pair: ChatImageGenderPair): string {
  return buildImageGenderLockPrompt([
    {
      label: "chat character",
      name: pair.characterName,
      gender: pair.characterGender,
    },
    {
      label: "user persona",
      name: pair.personaName,
      gender: pair.personaGender,
    },
  ]);
}

/** Single-subject lock (e.g. persona portrait). */
export function buildChatImageSubjectGenderLock(
  subject: ChatImageGenderSubject
): string {
  return buildImageGenderLockPrompt([subject]);
}

/** Resolve both genders from raw DB / API values. */
export function resolveChatImageGenderPair(opts: {
  characterName: string;
  characterGender: unknown;
  personaName: string;
  personaGender: unknown;
}): ChatImageGenderPair {
  return {
    characterName: String(opts.characterName ?? "").trim() || "캐릭터",
    characterGender: resolveImagePromptGender(opts.characterGender),
    personaName: String(opts.personaName ?? "").trim() || "페르소나",
    personaGender: resolveImagePromptGender(opts.personaGender),
  };
}
