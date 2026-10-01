import type Database from "better-sqlite3";
import { loadCharacterChunksForPromptReadOnly } from "@/lib/characterChunks";
import { toPublicPersonaDescription } from "@/lib/personaSecretLegacyMarkers";
import { hashForensicsText } from "@/lib/streamTurnForensics";

type QualificationCharacterRow = {
  id: number;
  name: string;
  gender: string | null;
  description: string;
  system_prompt: string;
  world: string;
  example_dialog: string;
  setting_chunks: string | null;
  setting_chunks_en: string | null;
  prompt_translation_hash: string | null;
  speech_profile: string | null;
  creator_compiled_description_json: string | null;
  appearance_raw: string | null;
  appearance_compiled: string | null;
  narration_style_instructions: string | null;
  content_kind: string | null;
};

type QualificationPersonaRow = {
  id: number;
  name: string;
  gender: string;
  description: string;
  speech_examples: string;
};

export type RpQualificationFixtureResult =
  | {
      ok: false;
      code: "character_not_found" | "persona_not_found";
    }
  | {
      ok: false;
      code: "persona_ambiguous";
      candidates: Array<{
        id: number;
        gender: string;
        descriptionChars: number;
      }>;
    }
  | {
      ok: true;
      fixture: {
        schemaVersion: 1;
        character: {
          id: number;
          name: string;
          sourceHash: string | null;
          sourceFieldNonNull: Record<string, boolean>;
          source: QualificationCharacterRow;
          finalSelected: {
            usedEnglish: boolean;
            chunks: Array<{
              id: string;
              category: string;
              importance: string;
              content: string;
              chars: number;
              contentHash: string | null;
            }>;
          };
        };
        persona: {
          id: number;
          name: string;
          gender: string;
          description: string;
          descriptionChars: number;
          descriptionHash: string | null;
          speechExamples: string;
          speechExamplesChars: number;
          speechExamplesHash: string | null;
          mainPromptFields: ["name", "gender", "description"];
        };
      };
    };

/**
 * Read-only production qualification fixture projection.
 * Never selects persona secret_description, auth/session data, email, or credentials.
 */
export function readRpQualificationFixture(
  db: Database.Database,
  input: {
    characterId: number;
    adminUserId: number;
    adminNickname: string;
    personaName: string;
  }
): RpQualificationFixtureResult {
  const character = db
    .prepare(
      `SELECT id, name, gender, description, system_prompt, world, example_dialog,
              setting_chunks, setting_chunks_en, prompt_translation_hash,
              speech_profile, creator_compiled_description_json,
              appearance_raw, appearance_compiled,
              narration_style_instructions, content_kind
       FROM characters
       WHERE id=?`
    )
    .get(input.characterId) as QualificationCharacterRow | undefined;

  if (!character) return { ok: false, code: "character_not_found" };

  const personas = db
    .prepare(
      `SELECT id, name, gender, description, speech_examples
       FROM user_personas
       WHERE user_id=? AND name=?
       ORDER BY id ASC`
    )
    .all(input.adminUserId, input.personaName) as QualificationPersonaRow[];

  if (personas.length === 0) return { ok: false, code: "persona_not_found" };

  if (personas.length > 1) {
    return {
      ok: false,
      code: "persona_ambiguous",
      candidates: personas.map((persona) => ({
        id: persona.id,
        gender: persona.gender,
        descriptionChars: toPublicPersonaDescription(persona.description ?? "").length,
      })),
    };
  }

  const persona = personas[0]!;
  const publicDescription = toPublicPersonaDescription(persona.description ?? "");
  const speechExamples = persona.speech_examples ?? "";

  const { chunks, usedEnglish } = loadCharacterChunksForPromptReadOnly(
    character,
    persona.name,
    input.adminNickname
  );

  const sourceFieldNonNull = Object.fromEntries(
    Object.entries(character).map(([key, value]) => [key, value !== null && value !== undefined])
  );

  return {
    ok: true,
    fixture: {
      schemaVersion: 1,
      character: {
        id: character.id,
        name: character.name,
        sourceHash: hashForensicsText(JSON.stringify(character)),
        sourceFieldNonNull,
        source: character,
        finalSelected: {
          usedEnglish,
          chunks: chunks.map((chunk) => ({
            id: chunk.id,
            category: chunk.category,
            importance: chunk.importance,
            content: chunk.content,
            chars: chunk.content.length,
            contentHash: hashForensicsText(chunk.content),
          })),
        },
      },
      persona: {
        id: persona.id,
        name: persona.name,
        gender: persona.gender,
        description: publicDescription,
        descriptionChars: publicDescription.length,
        descriptionHash: hashForensicsText(publicDescription),
        speechExamples,
        speechExamplesChars: speechExamples.length,
        speechExamplesHash: hashForensicsText(speechExamples),
        mainPromptFields: ["name", "gender", "description"],
      },
    },
  };
}
