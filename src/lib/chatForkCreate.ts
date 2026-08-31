import type Database from "better-sqlite3";

/** Fork child chat INSERT — omits legacy chats.memory (absent on M2+). */
export const FORK_CHAT_INSERT_SQL = `INSERT INTO chats (
  user_id, character_id, mode, memory_pending, memory_meta,
  memory_archived_turns, current_summary, gemini_model, user_note, selected_persona_id,
  user_impersonation, target_response_chars, title, writing_style_override, memory_capacity,
  narrative_pov, pov_character_name
) VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)`;

export type ForkChatInsertParams = {
  userId: number;
  characterId: number;
  mode: string;
  memoryPending: string;
  memoryMeta: string;
  memoryArchivedTurns: number;
  currentSummary: string;
  geminiModel: string;
  userNote: string;
  selectedPersonaId: number | null;
  userImpersonation: number;
  targetResponseChars: number;
  title: string;
  writingStyleOverride: string;
  memoryCapacity: number;
  narrativePov: string;
  povCharacterName: string;
};

export function insertForkChatRow(db: Database.Database, params: ForkChatInsertParams): number {
  const info = db.prepare(FORK_CHAT_INSERT_SQL).run(
    params.userId,
    params.characterId,
    params.mode,
    params.memoryPending,
    params.memoryMeta,
    params.memoryArchivedTurns,
    params.currentSummary,
    params.geminiModel,
    params.userNote,
    params.selectedPersonaId,
    params.userImpersonation,
    params.targetResponseChars,
    params.title,
    params.writingStyleOverride,
    params.memoryCapacity,
    params.narrativePov,
    params.povCharacterName
  );
  return Number(info.lastInsertRowid);
}
