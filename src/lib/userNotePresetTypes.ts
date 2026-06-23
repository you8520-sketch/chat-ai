export const USER_NOTE_PRESET_TITLE_MAX = 40;

export type UserNotePresetItem = {
  id: number;
  user_id: number;
  title: string;
  content: string;
  created_at: string;
};

export function sanitizeNotePresetTitle(raw: string): string {
  return raw.trim().slice(0, USER_NOTE_PRESET_TITLE_MAX);
}
