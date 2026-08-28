import type Database from "better-sqlite3";
import { parseAssets, type CharacterAsset } from "@/lib/characterAssets";
import { resolveCharacterGender, type CharacterGender } from "@/lib/characterGender";
import { eligibleTrpgCharacterAssets, uniqueCharacterAssetTags, viewerVisibleTrpgCharacterAssets } from "./gmSceneAssets";
import type { TrpgParticipantRow } from "./store";

export type TrpgAiCharacterContext = {
  participantId: number;
  characterId: number | null;
  creatorUserId: number | null;
  name: string;
  gender: CharacterGender;
  assets: CharacterAsset[];
};

export type TrpgPublicAiCharacterAssets = {
  participantId: number;
  characterId: number;
  viewerIsCreator: boolean;
  name: string;
  assets: CharacterAsset[];
};

export function readCharacterRowFields(raw: unknown): {
  description: string;
  greeting: string;
  exampleDialog: string;
  systemPrompt: string;
  gender: CharacterGender;
  assets: CharacterAsset[];
  creatorUserId: number | null;
} {
  const ch = raw && typeof raw === "object" ? (raw as Record<string, unknown>) : {};
  const assetsRaw = ch.assets;
  const assets =
    typeof assetsRaw === "string"
      ? parseAssets(assetsRaw)
      : Array.isArray(assetsRaw)
        ? parseAssets(JSON.stringify(assetsRaw))
        : [];
  const creatorRaw = ch.creator_id;
  const creatorUserId =
    typeof creatorRaw === "number" && Number.isInteger(creatorRaw) && creatorRaw > 0 ? creatorRaw : null;
  return {
    description: String(ch.description ?? ""),
    greeting: String(ch.greeting ?? ""),
    exampleDialog: String(ch.example_dialog ?? ""),
    systemPrompt: String(ch.system_prompt ?? ""),
    gender: resolveCharacterGender(ch.gender),
    assets,
    creatorUserId,
  };
}

function emptyContext(participant: TrpgParticipantRow): TrpgAiCharacterContext {
  return {
    participantId: participant.id,
    characterId: participant.character_id,
    creatorUserId: null,
    name: participant.display_name,
    gender: resolveCharacterGender(null),
    assets: [],
  };
}

export function loadTrpgAiCharacterContexts(
  db: Database.Database,
  participants: readonly TrpgParticipantRow[]
): TrpgAiCharacterContext[] {
  const ais = participants.filter((participant) => participant.kind === "ai_character");
  if (ais.length === 0) return [];
  let stmt: { get: (id: number) => unknown } | null = null;
  try {
    stmt = db.prepare(`SELECT * FROM characters WHERE id=?`);
  } catch {
    return ais.map(emptyContext);
  }
  return ais.map((participant) => {
    if (!participant.character_id) return emptyContext(participant);
    try {
      const fields = readCharacterRowFields(stmt.get(participant.character_id));
      return {
        participantId: participant.id,
        characterId: participant.character_id,
        creatorUserId: fields.creatorUserId,
        name: participant.display_name,
        gender: fields.gender,
        assets: eligibleTrpgCharacterAssets(fields.assets),
      };
    } catch {
      return emptyContext(participant);
    }
  });
}

export function toPublicAiCharacterAssets(
  contexts: readonly TrpgAiCharacterContext[],
  viewerUserId: number
): TrpgPublicAiCharacterAssets[] {
  return contexts
    .filter((row): row is TrpgAiCharacterContext & { characterId: number } => row.characterId != null && row.characterId > 0)
    .map((row) => ({
      participantId: row.participantId,
      characterId: row.characterId,
      viewerIsCreator: row.creatorUserId != null && row.creatorUserId === viewerUserId,
      name: row.name,
      assets: row.assets,
    }));
}

export function characterTagsByParticipant(
  contexts: readonly TrpgAiCharacterContext[]
): Map<number, Set<string>> {
  return new Map(
    contexts.map((row) => [row.participantId, new Set(uniqueCharacterAssetTags(row.assets))])
  );
}

export function aiParticipantIdSet(contexts: readonly TrpgAiCharacterContext[]): Set<number> {
  return new Set(contexts.map((row) => row.participantId));
}
