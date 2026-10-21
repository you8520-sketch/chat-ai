/** Personal RP composer snippets. Not user notes, not TRPG actions. */
export const CHAT_SHORTCUT_NAME_MAX = 30;
export const CHAT_SHORTCUT_DESCRIPTION_MAX = 80;
/** Independent of CHAT_MESSAGE_MAX: the expanded message is still checked against that limit. */
export const CHAT_SHORTCUT_CONTENT_MAX = 500;
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

/**
 * Length limits apply to values the caller is changing. A field that still equals the
 * stored value (rows saved under an older, larger limit) passes unchanged so an
 * unrelated edit never truncates or blocks existing data.
 */
export function validateChatShortcutDraft(
  input: { name: unknown; description?: unknown; content: unknown },
  existing?: ChatShortcutDraft | null
): { ok: true; value: ChatShortcutDraft } | { ok: false; error: string } {
  const name = typeof input.name === "string" ? input.name.replace(/\s+/g, " ").trim() : "";
  const description =
    typeof input.description === "string" ? input.description.trim() : "";
  const content = typeof input.content === "string" ? input.content : "";

  if (!name) return { ok: false, error: "단축어 이름을 입력하세요." };
  if (name.length > CHAT_SHORTCUT_NAME_MAX && name !== existing?.name) {
    return { ok: false, error: `단축어 이름은 ${CHAT_SHORTCUT_NAME_MAX}자까지입니다.` };
  }
  if (description.includes("\n") || description.includes("\r")) {
    return { ok: false, error: "설명은 한 줄로 입력하세요." };
  }
  if (description.length > CHAT_SHORTCUT_DESCRIPTION_MAX && description !== existing?.description) {
    return { ok: false, error: `설명은 ${CHAT_SHORTCUT_DESCRIPTION_MAX}자까지입니다.` };
  }
  if (!content.trim()) return { ok: false, error: "단축어 내용을 입력하세요." };
  if (content.length > CHAT_SHORTCUT_CONTENT_MAX && content !== existing?.content) {
    return { ok: false, error: `단축어 내용은 ${CHAT_SHORTCUT_CONTENT_MAX}자까지입니다.` };
  }
  return { ok: true, value: { name, description, content } };
}

/**
 * compositionend 직후 브라우저가 같은 턴에 보내는 insertCompositionText echo만 무시한다.
 * 확정 문자열과 값이 같다는 이유로는 판단하지 않는다. echo가 아니면 억제를 유지하지 않는다.
 */
export function shortcutComposerChangeAfterComposition(input: {
  echoArmed: boolean;
  inputType: string | null;
}): { echoArmed: boolean; ignoreChange: boolean } {
  if (!input.echoArmed) return { echoArmed: false, ignoreChange: false };
  if (input.inputType === "insertCompositionText") {
    return { echoArmed: false, ignoreChange: true };
  }
  return { echoArmed: false, ignoreChange: false };
}
