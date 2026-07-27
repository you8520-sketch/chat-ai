import type { CharacterGender } from "@/lib/characterGender";
import {
  formatSelectedPersonaForPrompt,
  type PersonaPromptCoNarrationOpts,
} from "@/lib/userPersonas";
import { toPublicPersonaDescription } from "@/lib/personaSecretLegacyMarkers";
import type { PublicPersonaDescription } from "@/lib/personaSecretTypes";

/** Public persona only — never includes secret_description. */
export function formatPublicPersonaForPrompt(
  name: string,
  gender: CharacterGender,
  publicDescription: PublicPersonaDescription | string,
  opts?: PersonaPromptCoNarrationOpts
): string | null {
  return formatSelectedPersonaForPrompt(
    name,
    gender,
    toPublicPersonaDescription(String(publicDescription ?? "")),
    opts
  );
}
