import type Database from "better-sqlite3";
import {
  DEFAULT_SELECTED_AI,
  OPENROUTER_MUSE_SPARK_11_MODEL,
  type SelectedAI,
  isValidSelectedAI,
  resolveSelectedAI,
  selectedAILabel,
} from "@/lib/chatModels";

export type AiModelUxState = {
  v: 1;
  /** 방별→전역 최초 전환 안내를 이미 보여줬는지 */
  globalMigrationNoticeSeen: boolean;
  /** 신규 유저 첫 채팅 진입 안내 */
  firstChatNoticeSeen: boolean;
  /** 모델 변경 직후, 다음 방 진입에서 확인 토스트 대기 */
  changeNoticePending: boolean;
  /** 변경 확인 토스트에 쓸 모델 id */
  lastChangedModelId: string;
  /** retired(Kimi/Qwen/GLM 등) → Muse 자동 전환 안내 대기 */
  retiredRemapNoticePending: boolean;
};

export const EMPTY_AI_MODEL_UX: AiModelUxState = {
  v: 1,
  globalMigrationNoticeSeen: false,
  firstChatNoticeSeen: false,
  changeNoticePending: false,
  lastChangedModelId: "",
  retiredRemapNoticePending: false,
};

export function parseAiModelUxJson(raw: string | null | undefined): AiModelUxState {
  const trimmed = raw?.trim();
  if (!trimmed) return { ...EMPTY_AI_MODEL_UX };
  try {
    const j = JSON.parse(trimmed) as Partial<AiModelUxState>;
    if (j?.v !== 1) return { ...EMPTY_AI_MODEL_UX };
    return {
      v: 1,
      globalMigrationNoticeSeen: j.globalMigrationNoticeSeen === true,
      firstChatNoticeSeen: j.firstChatNoticeSeen === true,
      changeNoticePending: j.changeNoticePending === true,
      lastChangedModelId: typeof j.lastChangedModelId === "string" ? j.lastChangedModelId : "",
      retiredRemapNoticePending: j.retiredRemapNoticePending === true,
    };
  } catch {
    return { ...EMPTY_AI_MODEL_UX };
  }
}

export function serializeAiModelUxJson(state: AiModelUxState): string {
  return JSON.stringify({
    v: 1,
    globalMigrationNoticeSeen: state.globalMigrationNoticeSeen === true,
    firstChatNoticeSeen: state.firstChatNoticeSeen === true,
    changeNoticePending: state.changeNoticePending === true,
    lastChangedModelId: state.lastChangedModelId || "",
    retiredRemapNoticePending: state.retiredRemapNoticePending === true,
  } satisfies AiModelUxState);
}

export function globalModelStatusLabel(modelId: SelectedAI): string {
  return `${selectedAILabel(modelId)} · 모든 채팅에 적용`;
}

export function globalModelIntroNotice(modelId: SelectedAI): string {
  return `현재 ${selectedAILabel(modelId)}을 사용 중입니다. 선택한 모델은 모든 채팅에 공통으로 적용됩니다.`;
}

export function globalModelChangedNotice(modelId: SelectedAI): string {
  return `${selectedAILabel(modelId)}로 변경했습니다. 이제 모든 채팅에서 이 모델을 사용합니다.`;
}

export function globalModelRetiredRemapNotice(): string {
  return `이전에 사용하던 모델의 제공이 종료되어 ${selectedAILabel(OPENROUTER_MUSE_SPARK_11_MODEL)}로 변경되었습니다. 선택한 모델은 모든 채팅에 공통으로 적용됩니다.`;
}

/**
 * Ensure users.selected_ai is populated and remapped off retired models (Kimi/Qwen/GLM → Muse).
 *
 * Lazy write: persists the resolved value on first ensure/get when empty or retired.
 * Does NOT resurrect chats.gemini_model into the global selection (past room models
 * are mirror/legacy only).
 */
export function ensureUserSelectedAI(
  db: Database.Database,
  userId: number
): { selectedAI: SelectedAI; seeded: boolean; remappedFromRetired: boolean } {
  const row = db
    .prepare("SELECT selected_ai, ai_model_ux_json FROM users WHERE id=?")
    .get(userId) as { selected_ai: string; ai_model_ux_json: string } | undefined;

  const stored = row?.selected_ai?.trim() ?? "";
  const ux = parseAiModelUxJson(row?.ai_model_ux_json);
  let seeded = false;
  let remappedFromRetired = false;

  let selectedAI: SelectedAI;
  if (!stored) {
    selectedAI = DEFAULT_SELECTED_AI;
    seeded = true;
  } else if (isValidSelectedAI(stored)) {
    selectedAI = resolveSelectedAI(stored);
  } else {
    selectedAI = resolveSelectedAI(stored);
    remappedFromRetired = selectedAI === OPENROUTER_MUSE_SPARK_11_MODEL || selectedAI !== stored;
    if (!isValidSelectedAI(stored)) remappedFromRetired = true;
  }

  selectedAI = resolveSelectedAI(selectedAI);

  let uxDirty = false;
  if (remappedFromRetired && !ux.retiredRemapNoticePending) {
    ux.retiredRemapNoticePending = true;
    uxDirty = true;
  }

  if (stored !== selectedAI) {
    if (uxDirty) {
      db.prepare("UPDATE users SET selected_ai=?, ai_model_ux_json=? WHERE id=?").run(
        selectedAI,
        serializeAiModelUxJson(ux),
        userId
      );
    } else {
      db.prepare("UPDATE users SET selected_ai=? WHERE id=?").run(selectedAI, userId);
    }
  } else if (uxDirty) {
    db.prepare("UPDATE users SET ai_model_ux_json=? WHERE id=?").run(
      serializeAiModelUxJson(ux),
      userId
    );
  }

  return { selectedAI, seeded, remappedFromRetired };
}

export function getUserSelectedAI(db: Database.Database, userId: number): SelectedAI {
  return ensureUserSelectedAI(db, userId).selectedAI;
}

export function setUserSelectedAI(
  db: Database.Database,
  userId: number,
  next: SelectedAI,
  opts?: { deferChangeNotice?: boolean }
): { selectedAI: SelectedAI; changed: boolean } {
  if (!isValidSelectedAI(next)) {
    throw new Error("setUserSelectedAI requires an allow-listed SelectedAI");
  }
  const selectedAI = resolveSelectedAI(next);
  const prev = getUserSelectedAI(db, userId);
  const changed = prev !== selectedAI;
  const ux = parseAiModelUxJson(
    (
      db.prepare("SELECT ai_model_ux_json FROM users WHERE id=?").get(userId) as
        | { ai_model_ux_json: string }
        | undefined
    )?.ai_model_ux_json
  );
  if (changed) {
    ux.lastChangedModelId = selectedAI;
    ux.changeNoticePending = opts?.deferChangeNotice === true;
    ux.globalMigrationNoticeSeen = true;
    ux.firstChatNoticeSeen = true;
    ux.retiredRemapNoticePending = false;
  }
  db.prepare("UPDATE users SET selected_ai=?, ai_model_ux_json=? WHERE id=?").run(
    selectedAI,
    serializeAiModelUxJson(ux),
    userId
  );
  return { selectedAI, changed };
}

export type SelectedAiNoticeKind = "intro" | "changed" | "retired" | null;

/**
 * Consume at most one pending notice for chat entry.
 * Ack is written only when a notice is actually returned (shown).
 */
export function consumeSelectedAiEntryNotice(
  db: Database.Database,
  userId: number,
  opts?: { isFirstChatVisitEver?: boolean }
): { notice: string | null; kind: SelectedAiNoticeKind; selectedAI: SelectedAI } {
  const { selectedAI } = ensureUserSelectedAI(db, userId);
  const row = db.prepare("SELECT ai_model_ux_json FROM users WHERE id=?").get(userId) as
    | { ai_model_ux_json: string }
    | undefined;
  const ux = parseAiModelUxJson(row?.ai_model_ux_json);
  let notice: string | null = null;
  let kind: SelectedAiNoticeKind = null;
  let dirty = false;

  if (ux.retiredRemapNoticePending) {
    notice = globalModelRetiredRemapNotice();
    kind = "retired";
    ux.retiredRemapNoticePending = false;
    ux.globalMigrationNoticeSeen = true;
    ux.firstChatNoticeSeen = true;
    dirty = true;
  } else if (ux.changeNoticePending && ux.lastChangedModelId) {
    const changedTo = resolveSelectedAI(ux.lastChangedModelId);
    notice = globalModelChangedNotice(changedTo);
    kind = "changed";
    ux.changeNoticePending = false;
    dirty = true;
  } else if (!ux.globalMigrationNoticeSeen) {
    notice = globalModelIntroNotice(selectedAI);
    kind = "intro";
    ux.globalMigrationNoticeSeen = true;
    ux.firstChatNoticeSeen = true;
    dirty = true;
  } else if (!ux.firstChatNoticeSeen) {
    notice = globalModelIntroNotice(selectedAI);
    kind = "intro";
    ux.firstChatNoticeSeen = true;
    dirty = true;
  } else if (opts?.isFirstChatVisitEver && !ux.firstChatNoticeSeen) {
    notice = globalModelIntroNotice(selectedAI);
    kind = "intro";
    ux.firstChatNoticeSeen = true;
    dirty = true;
  }

  if (dirty) {
    db.prepare("UPDATE users SET ai_model_ux_json=? WHERE id=?").run(
      serializeAiModelUxJson(ux),
      userId
    );
  }

  return { notice, kind, selectedAI };
}
