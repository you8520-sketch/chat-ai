/**
 * Shared Leon staging context builder — same path as step76b-staging-leon-rollout.
 * Requires DATA_DIR=data (or env) with Leon id=18 tagged example_dialog applied.
 */
import { getDb } from "@/lib/db";
import { loadCharacterChunksForPrompt } from "@/lib/characterChunks";
import { formatSelectedPersonaForPrompt } from "@/lib/userPersonas";
import { formatUserNoteForPrompt } from "@/lib/persona";
import { OPENROUTER_DEEPSEEK_V4_PRO_MODEL } from "@/lib/chatModels";
import type { ContextBuildInput } from "@/types";
import type { RegisterValidationScene } from "./leon-ren-register-fixtures";

export const LEON_STAGING_CHARACTER_ID = Number(process.env.LEON_STAGING_CHARACTER_ID ?? "18");

export function buildStagingContextFromDb(scene: RegisterValidationScene): ContextBuildInput {
  const db = getDb();
  const row = db
    .prepare(
      `SELECT id, name, gender, system_prompt, world, example_dialog, setting_chunks, setting_chunks_en,
              prompt_translation_hash, speech_profile FROM characters WHERE id = ?`
    )
    .get(LEON_STAGING_CHARACTER_ID) as {
    id: number;
    name: string;
    gender: string;
    system_prompt: string;
    world: string;
    example_dialog: string;
    setting_chunks?: string;
    setting_chunks_en?: string;
    prompt_translation_hash?: string;
    speech_profile?: string;
  } | undefined;

  if (!row) throw new Error(`Leon staging character id=${LEON_STAGING_CHARACTER_ID} not found`);

  const { chunks } = loadCharacterChunksForPrompt(
    {
      id: row.id,
      name: row.name,
      gender: row.gender,
      system_prompt: row.system_prompt,
      world: row.world,
      example_dialog: row.example_dialog,
      setting_chunks: row.setting_chunks,
      setting_chunks_en: row.setting_chunks_en,
      prompt_translation_hash: row.prompt_translation_hash,
      speech_profile: row.speech_profile,
    },
    "렌",
    "렌"
  );

  return {
    charName: row.name,
    personaDisplayName: "렌",
    userNickname: "렌",
    chunks,
    userPersona: formatSelectedPersonaForPrompt("렌", "other", "20대. 직설적."),
    userNote: formatUserNoteForPrompt("레온과 둘만 있을 때는 편한 분위기."),
    longTermMemory: "",
    memoryMeta: "",
    shortTermHistory: scene.shortTermHistory,
    currentUserMessage: scene.currentUserMessage,
    nsfw: true,
    gender: "male",
    userPersonaGender: "other",
    userImpersonation: false,
    novelModeEnabled: false,
    targetResponseChars: 3200,
    completedTurns: 8,
    genres: scene.genres,
    provider: "openrouter",
    modelId: OPENROUTER_DEEPSEEK_V4_PRO_MODEL,
  };
}

/** Step 7.7 Group B — staging Leon with example_dialog swapped only (ablation arm). */
export function buildLeonGroupBAblationContext(
  scene: RegisterValidationScene,
  exampleDialog: string
): ContextBuildInput {
  const base = buildStagingContextFromDb(scene);
  const db = getDb();
  const row = db
    .prepare(
      `SELECT id, name, gender, system_prompt, world, example_dialog, setting_chunks, setting_chunks_en,
              prompt_translation_hash, speech_profile FROM characters WHERE id = ?`
    )
    .get(LEON_STAGING_CHARACTER_ID) as {
    id: number;
    name: string;
    gender: string;
    system_prompt: string;
    world: string;
    example_dialog: string;
    setting_chunks?: string;
    setting_chunks_en?: string;
    prompt_translation_hash?: string;
    speech_profile?: string;
  } | undefined;

  if (!row) throw new Error(`Leon staging character id=${LEON_STAGING_CHARACTER_ID} not found`);

  const { chunks } = loadCharacterChunksForPrompt(
    {
      id: row.id,
      name: row.name,
      gender: row.gender,
      system_prompt: row.system_prompt,
      world: row.world,
      example_dialog: exampleDialog,
      setting_chunks: row.setting_chunks,
      setting_chunks_en: row.setting_chunks_en,
      prompt_translation_hash: row.prompt_translation_hash,
      speech_profile: row.speech_profile,
    },
    "렌",
    "렌"
  );

  return { ...base, chunks };
}
