import type { CharacterGender } from "@/lib/characterGender";
import {
  formatSelectedPersonaForPrompt,
  type PersonaPromptCoNarrationOpts,
} from "@/lib/userPersonas";
import { splitPersonaSecretItems } from "@/lib/personaSecretItems";

/** Public persona only — never includes secret_description. */
export function formatPublicPersonaForPrompt(
  name: string,
  gender: CharacterGender,
  publicDescription: string,
  opts?: PersonaPromptCoNarrationOpts
): string | null {
  return formatSelectedPersonaForPrompt(name, gender, publicDescription, opts);
}

/** Novel / explicit full co-narration only — separate from [USER_PERSONA]. */
export function formatPrivatePersonaSecretForNovelNarration(
  secretDescription: string
): string | null {
  const items = splitPersonaSecretItems(secretDescription);
  if (items.length === 0) return null;
  const body = items.map((i) => i.normalizedText).join("\n\n");
  return `[PRIVATE USER PERSONA SECRET — B NARRATION ONLY]
For co-narrating [B] only. NOT [A] or NPC knowledge unless revealed in-scene.
Do not disclose or infer these as [A] knowledge in interactive dialogue.

${body}`;
}
