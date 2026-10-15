import type Database from "better-sqlite3";
import {
  type SelectedAI,
  isValidSelectedAI,
  resolveUserSelectableMainRpAI,
  selectedAILabel,
} from "@/lib/chatModels";

export const MODEL_SELECTION_REQUIRED_CODE = "MODEL_SELECTION_REQUIRED";
export const MODEL_SELECTION_REQUIRED_MESSAGE = "채팅에 사용할 AI 모델을 선택해 주세요.";

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
  /** retired(Muse/Kimi/Qwen/GLM 등) → 기본 모델 자동 전환 안내 대기 */
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

export function isMainRpGenerationAllowed(
  selectedAI: SelectedAI | null | undefined
): selectedAI is SelectedAI {
  return selectedAI != null && isValidSelectedAI(selectedAI);
}

function readStoredSelectedAI(
  db: Database.Database,
  userId: number
): { stored: string; ux: AiModelUxState } {
  const row = db
    .prepare("SELECT selected_ai, ai_model_ux_json FROM users WHERE id=?")
    .get(userId) as { selected_ai: string; ai_model_ux_json: string } | undefined;
  return {
    stored: row?.selected_ai?.trim() ?? "",
    ux: parseAiModelUxJson(row?.ai_model_ux_json),
  };
}

/**
 * Read the account-global Main RP picker value without writing.
 * Empty, retired, and unknown stored ids stay as-is and resolve to unselected.
 */
export function ensureUserSelectedAI(
  db: Database.Database,
  userId: number
): { selectedAI: SelectedAI | null; seeded: boolean; remappedFromRetired: boolean } {
  const { stored } = readStoredSelectedAI(db, userId);
  return {
    selectedAI: resolveUserSelectableMainRpAI(stored),
    seeded: false,
    remappedFromRetired: false,
  };
}

export function getUserSelectedAI(db: Database.Database, userId: number): SelectedAI | null {
  return ensureUserSelectedAI(db, userId).selectedAI;
}

/** User-chat / picker display model — read-only, no default seed or retired remap. */
export function getUserChatSelectedAI(
  db: Database.Database,
  userId: number
): SelectedAI | null {
  return getUserSelectedAI(db, userId);
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
  const selectedAI = next;
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
 * Global "applies to all chats" intro/change toasts are no longer shown;
 * those flags are still cleared so they do not keep pending.
 * Retired-model auto-remap notices are no longer emitted; the picker asks
 * the user to choose a live model instead.
 */
export function consumeSelectedAiEntryNotice(
  db: Database.Database,
  userId: number,
  opts?: { isFirstChatVisitEver?: boolean; isAdmin?: boolean }
): { notice: string | null; kind: SelectedAiNoticeKind; selectedAI: SelectedAI | null } {
  void opts;
  const { selectedAI } = ensureUserSelectedAI(db, userId);
  const row = db.prepare("SELECT ai_model_ux_json FROM users WHERE id=?").get(userId) as
    | { ai_model_ux_json: string }
    | undefined;
  const ux = parseAiModelUxJson(row?.ai_model_ux_json);
  let dirty = false;

  if (ux.retiredRemapNoticePending) {
    ux.retiredRemapNoticePending = false;
    ux.globalMigrationNoticeSeen = true;
    ux.firstChatNoticeSeen = true;
    dirty = true;
  } else if (ux.changeNoticePending) {
    ux.changeNoticePending = false;
    ux.globalMigrationNoticeSeen = true;
    ux.firstChatNoticeSeen = true;
    dirty = true;
  } else if (!ux.globalMigrationNoticeSeen || !ux.firstChatNoticeSeen) {
    ux.globalMigrationNoticeSeen = true;
    ux.firstChatNoticeSeen = true;
    dirty = true;
  }

  if (dirty) {
    db.prepare("UPDATE users SET ai_model_ux_json=? WHERE id=?").run(
      serializeAiModelUxJson(ux),
      userId
    );
  }

  return { notice: null, kind: null, selectedAI };
}
