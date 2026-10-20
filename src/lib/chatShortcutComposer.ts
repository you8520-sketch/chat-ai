import { CHAT_MESSAGE_MAX } from "@/lib/chatModels";

/** Personal RP composer snippets. Not user notes, not TRPG actions. */
export const CHAT_SHORTCUT_NAME_MAX = 40;
export const CHAT_SHORTCUT_DESCRIPTION_MAX = 80;
export const CHAT_SHORTCUT_CONTENT_MAX = CHAT_MESSAGE_MAX;
export const CHAT_SHORTCUT_MAX_PER_USER = 40;

export const CHAT_SHORTCUT_INSERT_TOO_LONG_MESSAGE =
  "단축어를 넣으면 입력 길이 제한을 넘습니다. 기존 내용을 줄인 뒤 다시 넣어 주세요.";
export const CHAT_SHORTCUT_INSERT_DEFERRED_MESSAGE =
  "한글 입력이 끝나면 단축어를 넣습니다.";
export const CHAT_SHORTCUT_INSERT_LOCKED_MESSAGE =
  "전송 중에는 단축어를 넣을 수 없습니다.";

export type ChatShortcutDraft = {
  name: string;
  description: string;
  content: string;
};

export function validateChatShortcutDraft(
  input: { name: unknown; description?: unknown; content: unknown }
): { ok: true; value: ChatShortcutDraft } | { ok: false; error: string } {
  const name = typeof input.name === "string" ? input.name.replace(/\s+/g, " ").trim() : "";
  const description =
    typeof input.description === "string" ? input.description.trim() : "";
  const content = typeof input.content === "string" ? input.content : "";

  if (!name) return { ok: false, error: "단축어 이름을 입력하세요." };
  if (name.length > CHAT_SHORTCUT_NAME_MAX) {
    return { ok: false, error: `단축어 이름은 ${CHAT_SHORTCUT_NAME_MAX}자까지입니다.` };
  }
  if (description.includes("\n") || description.includes("\r")) {
    return { ok: false, error: "설명은 한 줄로 입력하세요." };
  }
  if (description.length > CHAT_SHORTCUT_DESCRIPTION_MAX) {
    return { ok: false, error: `설명은 ${CHAT_SHORTCUT_DESCRIPTION_MAX}자까지입니다.` };
  }
  if (!content.trim()) return { ok: false, error: "단축어 내용을 입력하세요." };
  if (content.length > CHAT_SHORTCUT_CONTENT_MAX) {
    return { ok: false, error: `단축어 내용은 ${CHAT_SHORTCUT_CONTENT_MAX}자까지입니다.` };
  }
  return { ok: true, value: { name, description, content } };
}

export type ChatShortcutInsertResult =
  | { action: "defer"; message: string }
  | { action: "reject"; message: string; draft: string }
  | { action: "apply"; next: string; caret: number };

/**
 * Insert shortcut text at the caret without replacing the existing draft.
 * A selected range is kept and shifted; overflow refuses instead of slicing.
 * While Hangul composition is active, defer so the committed syllable stays.
 */
export function planChatShortcutInsert(input: {
  composing: boolean;
  locked?: boolean;
  draft: string;
  domDraft?: string;
  selectionStart: number;
  selectionEnd: number;
  insert: string;
  maxChars?: number;
}): ChatShortcutInsertResult {
  if (input.locked) {
    return {
      action: "reject",
      message: CHAT_SHORTCUT_INSERT_LOCKED_MESSAGE,
      draft: input.draft,
    };
  }
  if (input.composing) {
    return { action: "defer", message: CHAT_SHORTCUT_INSERT_DEFERRED_MESSAGE };
  }

  const maxChars = input.maxChars ?? CHAT_MESSAGE_MAX;
  const draft = input.domDraft ?? input.draft;
  const insert = input.insert;
  if (!insert) {
    return { action: "reject", message: "넣을 단축어 내용이 없습니다.", draft };
  }

  const start = clampIndex(Math.min(input.selectionStart, input.selectionEnd), draft.length);
  const next = `${draft.slice(0, start)}${insert}${draft.slice(start)}`;
  if (next.length > maxChars) {
    return { action: "reject", message: CHAT_SHORTCUT_INSERT_TOO_LONG_MESSAGE, draft };
  }
  return { action: "apply", next, caret: start + insert.length };
}

function clampIndex(value: number, length: number): number {
  if (!Number.isFinite(value)) return length;
  return Math.min(length, Math.max(0, Math.trunc(value)));
}
