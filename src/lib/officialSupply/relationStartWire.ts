import {
  characterSettingInputForRow,
  loadCharacterChunksForPromptReadOnly,
  type CharacterSettingRow,
} from "@/lib/characterChunks";
import { createCharacterFromForm, type SessionUser } from "@/lib/characterFormSave";
import { CHEAPER_INFERENCE_DEEPSEEK_V41_FLASH_MODEL } from "@/lib/chatModels";
import { buildPrivateSpeechControlBlock, parseCreatorDescriptionCompiled } from "@/lib/creatorDescriptionTriggerCompiler";
import { getDb } from "@/lib/db";
import { buildOfficialCharacterFormBody } from "@/lib/officialSupply/characterText";
import { ensureOfficialSharedWorldLibraryRow } from "@/lib/officialSupply/officialSharedWorld";
import {
  compileRelationStartDraft,
  loadRelationStartWorld,
  type RelationStartCandidate,
} from "@/lib/officialSupply/relationStartCandidates";
import type { OfficialCharacterDraft } from "@/lib/officialSupply/types";
import { createSiteManagedStudioAccount } from "@/lib/siteManagedAccounts";
import { characterSettingSourceOverflowChars } from "@/utils/characterParser";
import { buildContext } from "@/services/contextBuilder";

export type RelationStartWire = {
  draft: OfficialCharacterDraft;
  systemPrompt: string;
  settingOverflowChars: number;
};

/**
 * Saves the compiled candidate through the real form-save path and assembles the final RP
 * system prompt with the production `buildContext`. The caller owns the isolated test DB.
 * The appearance block is the later image-lock owner, so it stays empty here.
 */
export async function buildRelationStartWire(candidate: RelationStartCandidate, draft = compileRelationStartDraft(candidate)): Promise<RelationStartWire> {
  const db = getDb();
  const studio = createSiteManagedStudioAccount({
    nickname: `공식스튜디오-${candidate.key}`,
    email: `official-${candidate.key}@site-managed.invalid`,
  });
  const { world } = loadRelationStartWorld();
  const shared = ensureOfficialSharedWorldLibraryRow({ db, creatorId: studio.id, bible: world });
  const body = buildOfficialCharacterFormBody({
    draft,
    appearanceBlock: "",
    assets: [{ url: `/uploads/${candidate.key}.webp`, tag: "대표", width: 1024, height: 1536, viewerBlur: false }],
    worldId: shared.worldId,
  });
  const owner: SessionUser = { id: studio.id, nickname: studio.nickname, email: studio.email, is_adult: 1 };
  const created = await createCharacterFromForm(owner, body);
  if (!created.ok) throw new Error(`relation start candidate save failed: ${created.error}`);

  const row = db.prepare("SELECT * FROM characters WHERE id = ?").get(created.id) as CharacterSettingRow & {
    world: string;
    system_prompt: string;
    speech_personality: string | null;
    speech_traits: string | null;
    example_dialog: string | null;
    creator_compiled_description_json: string | null;
  };
  const { chunks } = loadCharacterChunksForPromptReadOnly(row, "기록관", "기록관");
  const built = buildContext({
    charName: draft.name,
    chunks,
    userNickname: "기록관",
    speechPersonality: row.speech_personality ?? "",
    speechTraits: row.speech_traits ?? "",
    systemPrompt: row.system_prompt,
    world: row.world,
    exampleDialog: row.example_dialog ?? "",
    privateSpeechControlBlock: buildPrivateSpeechControlBlock(parseCreatorDescriptionCompiled(row.creator_compiled_description_json)),
    shortTermHistory: [],
    currentUserMessage: "상황을 알려 줘.",
    nsfw: false,
    gender: draft.gender,
    provider: "cheaperinference",
    modelId: CHEAPER_INFERENCE_DEEPSEEK_V41_FLASH_MODEL,
    completedTurns: 0,
  });
  return {
    draft,
    systemPrompt: built.systemPrompt,
    settingOverflowChars: characterSettingSourceOverflowChars(characterSettingInputForRow(row)),
  };
}
