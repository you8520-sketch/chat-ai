import { toPublicPersonaDescription } from "@/lib/personaSecretLegacyMarkers";
import type {
  DbUserPersona,
  OwnerPersonaEditorItem,
  PublicPersonaListItem,
} from "@/lib/userPersonasClient";

/** Client/list DTO — never includes secret_description. */
export type PublicPersonaClientRow = PublicPersonaListItem;

export function toPublicPersonaClientRow(
  persona: Pick<
    DbUserPersona,
    | "id"
    | "user_id"
    | "name"
    | "memo"
    | "gender"
    | "description"
    | "speech_examples"
    | "image_url"
    | "image_focus_x"
    | "image_focus_y"
    | "created_at"
  >
): PublicPersonaClientRow {
  return {
    id: persona.id,
    user_id: persona.user_id,
    name: persona.name,
    memo: persona.memo,
    gender: persona.gender,
    description: toPublicPersonaDescription(persona.description),
    speech_examples: persona.speech_examples,
    image_url: persona.image_url,
    image_focus_x: persona.image_focus_x,
    image_focus_y: persona.image_focus_y,
    created_at: persona.created_at,
  };
}

export function toPublicPersonaClientRows(
  personas: Array<
    Pick<
      DbUserPersona,
      | "id"
      | "user_id"
      | "name"
      | "memo"
      | "gender"
      | "description"
      | "speech_examples"
      | "image_url"
      | "image_focus_x"
      | "image_focus_y"
      | "created_at"
    >
  >
): PublicPersonaClientRow[] {
  return personas.map(toPublicPersonaClientRow);
}

/** Owner editor DTO when Boundary is ON — secret field included; description still stripped. */
export type EditorPersonaClientRow = OwnerPersonaEditorItem;

export function toEditorPersonaClientRow(persona: DbUserPersona): EditorPersonaClientRow {
  return {
    ...toPublicPersonaClientRow(persona),
    secret_description: persona.secret_description ?? "",
  };
}

export function toEditorPersonaClientRows(personas: DbUserPersona[]): EditorPersonaClientRow[] {
  return personas.map(toEditorPersonaClientRow);
}
