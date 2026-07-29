import type { CharacterGender } from "@/lib/characterGender";

type PublicPersonaUpdateInput = {
  name: string;
  memo: string;
  gender: CharacterGender;
  description: string;
  image_url: string;
  image_focus_x: number;
  image_focus_y: number;
};

/** Normal persona edits deliberately cannot carry secret source. */
export function buildPublicPersonaUpdatePayload(input: PublicPersonaUpdateInput): PublicPersonaUpdateInput {
  return { ...input };
}

/** Secret source is sent only by the explicit owner save action. */
export function buildExplicitSecretSavePayload(secretDescription: string): { secret_description: string } {
  return { secret_description: secretDescription };
}
