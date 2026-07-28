import type { CharacterGender } from "./characterGender";

/** Stripped public persona description — safe for model/scan/policy/client runtime. */
export type PublicPersonaDescription = string & {
  readonly __brand: "PublicPersonaDescription";
};

/** Raw secret_description payload — never pass to public formatters/scanners. */
export type SecretPersonaDescription = string & {
  readonly __brand: "SecretPersonaDescription";
};

export type PublicPersonaRow = {
  id: number;
  userId: number;
  name: string;
  gender: CharacterGender;
  description: PublicPersonaDescription;
};

export type PersonaSecretPayload = {
  personaId: number;
  secretDescription: SecretPersonaDescription;
};

export function asPublicPersonaDescription(value: string): PublicPersonaDescription {
  return value as PublicPersonaDescription;
}

export function asSecretPersonaDescription(value: string): SecretPersonaDescription {
  return value as SecretPersonaDescription;
}
