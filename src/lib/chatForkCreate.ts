import type Database from "better-sqlite3";

/** Fork child chat INSERT — omits retired legacy mirrors and relies on their physical defaults. */
export const FORK_CHAT_INSERT_SQL = `INSERT INTO chats (
  user_id, character_id, mode, memory_pending, memory_meta,
  memory_archived_turns, gemini_model, user_note, selected_persona_id,
  target_response_chars, title, writing_style_override, memory_capacity,
  narrative_pov, pov_character_name, user_authoring_level
) VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)`;

export type ForkChatInsertParams = {
  userId: number;
  characterId: number;
  mode: string;
  memoryPending: string;
  memoryMeta: string;
  memoryArchivedTurns: number;
  geminiModel: string;
  userNote: string;
  selectedPersonaId: number | null;
  targetResponseChars: number;
  title: string;
  writingStyleOverride: string;
  memoryCapacity: number;
  narrativePov: string;
  povCharacterName: string;
  userAuthoringLevel: string;
};

export function insertForkChatRow(db: Database.Database, params: ForkChatInsertParams): number {
  const info = db.prepare(FORK_CHAT_INSERT_SQL).run(
    params.userId,
    params.characterId,
    params.mode,
    params.memoryPending,
    params.memoryMeta,
    params.memoryArchivedTurns,
    params.geminiModel,
    params.userNote,
    params.selectedPersonaId,
    params.targetResponseChars,
    params.title,
    params.writingStyleOverride,
    params.memoryCapacity,
    params.narrativePov,
    params.povCharacterName,
    params.userAuthoringLevel
  );
  return Number(info.lastInsertRowid);
}
