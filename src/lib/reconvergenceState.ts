import type Database from "better-sqlite3";
import type { ChatMsg } from "@/lib/ai";
import { getDb } from "@/lib/db";
import { ensureReconvergenceSchema } from "@/lib/reconvergenceSchema";

export type ReconvergenceNamespace = "production" | "shadow";

export type ReconvergenceMethod =
  | "message"
  | "direct_visit"
  | "shared_location"
  | "shared_task"
  | "item_return"
  | "existing_schedule"
  | "relationship_initiative";

/** Grounded return paths only — relationship_initiative is NOT grounded alone. */
export type ReconvergenceHookType =
  | "shared_task"
  | "shared_item"
  | "existing_promise"
  | "known_shared_location"
  | "shared_organization"
  | "established_contact_channel"
  | "confirmed_schedule";

export type ReconvergenceHook = {
  type: ReconvergenceHookType;
  summary: string;
  sourceTurn: number;
  confidence: "high" | "medium";
};

export type ReconvergenceLifecycle =
  | "together"
  | "separation_pending"
  | "separated"
  | "reconvergence_offered"
  | "temporary_quiet"
  | "hard_no_contact";

export type NoContactKind = "temporary_quiet" | "hard_no_contact" | null;

export type ReconvergenceState = {
  chatId: number;
  characterId: number;
  state: ReconvergenceLifecycle;
  separationTurn: number | null;
  reconvergenceDueTurn: number | null;
  lastSharedLocationKey: string | null;
  unresolvedHooks: ReconvergenceHook[];
  lastMethod: ReconvergenceMethod | null;
  methodCooldownUntilTurn: number | null;
  offeredTurn: number | null;
  version: number;
  lastTransitionRequestId: string | null;
  lastAssistantMessageId: number | null;
  lastGenerationSequence: number | null;
  lastSourceTurn: number | null;
  triggerDeferCount: number;
  noContactKind: NoContactKind;
  deadlineMissedDueToTrigger: boolean;
  updatedAt: string;
};

export type ReconvergenceDirective = {
  method: ReconvergenceMethod;
  hook: ReconvergenceHook | null;
  ownershipSafe: true;
  allowUserCognition: false;
  blockedNoGroundedPath?: boolean;
};

export type PendingReconvergenceTransition = {
  namespace: ReconvergenceNamespace;
  previous: ReconvergenceState;
  next: ReconvergenceState;
  reasonCodes: string[];
  reconvergenceDue: boolean;
  deferredByTrigger: boolean;
  blockedNoGroundedPath: boolean;
  expectedVersion: number;
  requestId: string | null;
  sourceTurn: number;
  generationSequence: number;
  /** When true, commit must not advance completed-turn clocks (regenerate). */
  isRegenerate: boolean;
};

const HARD_NO_CONTACT_TERMS = [
  "다시는 연락하지 마",
  "다시는 찾아오지 마",
  "차단한다",
  "접근하지 마",
  "접근 금지",
  "우리 관계는 끝이야",
  "다시는 만나지 말자",
];

const TEMPORARY_QUIET_TERMS = [
  "오늘은 연락하지 마",
  "지금은 혼자 있고 싶어",
  "조금 쉬고 싶어",
  "당분간 찾아오지 마",
  "혼자 있고 싶어",
  "연락하지 마",
  "찾아오지 마",
];

const PARTING_TERMS = [
  "갈게",
  "돌아갈게",
  "먼저 갈게",
  "이만",
  "작별",
  "집에 갈",
  "나 간다",
  "나가 볼게",
  "이별",
  "헤어지",
  "떠나",
];

const BLOCK_OR_FOLLOW_TERMS = [
  "따라가",
  "붙잡",
  "막아서",
  "손목을 잡",
  "길을 막",
  "동행",
  "같이 가",
  "붙들",
];

const USER_RECONNECT_TERMS = [
  "다시 연락",
  "전화할게",
  "메시지 보낼게",
  "돌아왔어",
  "다시 만나",
  "찾아갈게",
  "문 열",
  "너에게 말한다",
  "너한테 말한다",
  "다시 왔어",
  "약속 장소",
];

const CONTACT_CHANNEL_TERMS = ["전화", "메시지", "문자", "카톡", "통신", "단말기", "연락처"];
const SHARED_ITEM_TERMS = ["맡긴", "돌려", "열쇠", "가방", "코트", "목걸이", "반지", "서류"];
const SHARED_TASK_TERMS = ["같이", "공동", "약속한 일", "남은 일", "미완료", "해야 할"];
const PROMISE_TERMS = ["약속", "내일 만나", "다음에 보", "다시 만나"];
const LOCATION_TERMS = ["집", "카페", "사무실", "기지", "숙소", "학교", "병원"];
const SCHEDULE_TERMS = ["일정", "회의", "출동", "디데이", "제한시간"];
const ORG_TERMS = ["조직", "부서", "소속", "기지", "팀"];

const OFFER_COOLDOWN_TURNS = 3;
const METHOD_COOLDOWN_TURNS = 6;
const GROUNDED_HOOK_TYPES = new Set<ReconvergenceHookType>([
  "shared_task",
  "shared_item",
  "existing_promise",
  "known_shared_location",
  "shared_organization",
  "established_contact_channel",
  "confirmed_schedule",
]);

function includesAny(text: string, terms: string[]): boolean {
  return terms.some((term) => text.includes(term));
}

function clampSummary(text: string): string {
  return text.replace(/\s+/g, " ").trim().slice(0, 120);
}

/** Strip quoted / third-party speech so "연락하지 마" inside quotes is not user lock. */
export function stripQuotedSpeech(text: string): string {
  return text
    .replace(/[「『"“‘'][^」』"”’']*[」』"”’']/g, " ")
    .replace(/\([^)]*\)/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

function tableFor(namespace: ReconvergenceNamespace): string {
  return namespace === "shadow"
    ? "chat_reconvergence_shadow_state"
    : "chat_reconvergence_state";
}

function rowToState(row: Record<string, unknown>): ReconvergenceState {
  let hooks: ReconvergenceHook[] = [];
  try {
    const parsed = JSON.parse(String(row.unresolved_hooks_json || "[]"));
    if (Array.isArray(parsed)) {
      hooks = parsed
        .map((raw): ReconvergenceHook | null => {
          if (!raw || typeof raw !== "object") return null;
          const h = raw as Record<string, unknown>;
          const rawType = String(h.type ?? "");
          const type = (
            rawType === "known_location" ? "known_shared_location" : rawType
          ) as ReconvergenceHookType;
          if (!GROUNDED_HOOK_TYPES.has(type)) return null;
          if (typeof h.summary !== "string" || typeof h.sourceTurn !== "number") {
            return null;
          }
          return {
            type,
            summary: clampSummary(h.summary),
            sourceTurn: h.sourceTurn,
            confidence: h.confidence === "high" ? "high" : "medium",
          };
        })
        .filter((h): h is ReconvergenceHook => h != null);
    }
  } catch {
    hooks = [];
  }
  return {
    chatId: Number(row.chat_id),
    characterId: Number(row.character_id),
    state: (String(row.state) as ReconvergenceLifecycle) || "together",
    separationTurn: (row.separation_turn as number | null) ?? null,
    reconvergenceDueTurn: (row.reconvergence_due_turn as number | null) ?? null,
    lastSharedLocationKey: (row.last_shared_location_key as string | null) ?? null,
    unresolvedHooks: hooks,
    lastMethod: (row.last_method as ReconvergenceMethod | null) ?? null,
    methodCooldownUntilTurn: (row.method_cooldown_until_turn as number | null) ?? null,
    offeredTurn: (row.offered_turn as number | null) ?? null,
    version: Number(row.version ?? 0),
    lastTransitionRequestId: (row.last_transition_request_id as string | null) ?? null,
    lastAssistantMessageId: (row.last_assistant_message_id as number | null) ?? null,
    lastGenerationSequence: (row.last_generation_sequence as number | null) ?? null,
    lastSourceTurn: (row.last_source_turn as number | null) ?? null,
    triggerDeferCount: Number(row.trigger_defer_count ?? 0),
    noContactKind: (row.no_contact_kind as NoContactKind) ?? null,
    deadlineMissedDueToTrigger: Number(row.deadline_missed_due_to_trigger ?? 0) === 1,
    updatedAt: String(row.updated_at ?? new Date().toISOString()),
  };
}

export function defaultReconvergenceState(
  chatId: number,
  characterId: number
): ReconvergenceState {
  return {
    chatId,
    characterId,
    state: "together",
    separationTurn: null,
    reconvergenceDueTurn: null,
    lastSharedLocationKey: null,
    unresolvedHooks: [],
    lastMethod: null,
    methodCooldownUntilTurn: null,
    offeredTurn: null,
    version: 0,
    lastTransitionRequestId: null,
    lastAssistantMessageId: null,
    lastGenerationSequence: null,
    lastSourceTurn: null,
    triggerDeferCount: 0,
    noContactKind: null,
    deadlineMissedDueToTrigger: false,
    updatedAt: new Date().toISOString(),
  };
}

export function loadReconvergenceState(
  chatId: number,
  characterId: number,
  namespace: ReconvergenceNamespace = "production",
  db: Database.Database = getDb()
): ReconvergenceState {
  ensureReconvergenceSchema(db);
  const table = tableFor(namespace);
  const row = db
    .prepare(
      `SELECT * FROM ${table} WHERE chat_id = ? AND character_id = ?`
    )
    .get(chatId, characterId) as Record<string, unknown> | undefined;
  if (!row) return defaultReconvergenceState(chatId, characterId);
  return rowToState(row);
}

export function detectNoContactKind(
  userMessage: string | null | undefined
): NoContactKind {
  const raw = userMessage?.trim() ?? "";
  if (!raw) return null;
  const text = stripQuotedSpeech(raw);
  if (!text) return null;
  if (includesAny(text, HARD_NO_CONTACT_TERMS)) return "hard_no_contact";
  if (includesAny(text, TEMPORARY_QUIET_TERMS)) return "temporary_quiet";
  return null;
}

/** Back-compat: any no-contact kind. */
export function detectNoContactLock(userMessage: string | null | undefined): boolean {
  return detectNoContactKind(userMessage) != null;
}

export function detectPartingIntent(userMessage: string | null | undefined): boolean {
  const text = stripQuotedSpeech(userMessage?.trim() ?? "");
  if (!text) return false;
  return includesAny(text, PARTING_TERMS);
}

export function detectAssistantBlocksParting(assistantText: string | null | undefined): boolean {
  const text = assistantText?.trim() ?? "";
  if (!text) return false;
  return includesAny(text, BLOCK_OR_FOLLOW_TERMS);
}

export function detectUserInitiatedReconnection(
  userMessage: string | null | undefined
): boolean {
  const text = stripQuotedSpeech(userMessage?.trim() ?? "");
  if (!text) return false;
  return includesAny(text, USER_RECONNECT_TERMS);
}

export function detectUserReturnContact(userMessage: string | null | undefined): boolean {
  return detectUserInitiatedReconnection(userMessage);
}

export function extractReconvergenceHooks(opts: {
  recentMessages?: ChatMsg[];
  currentUserMessage?: string | null;
  currentTurn: number;
}): ReconvergenceHook[] {
  const text = [
    ...(opts.recentMessages ?? []).slice(-8).map((m) => m.content),
    opts.currentUserMessage ?? "",
  ]
    .join("\n")
    .trim();
  if (!text) return [];
  const hooks: ReconvergenceHook[] = [];
  const add = (type: ReconvergenceHookType, summary: string, confidence: "high" | "medium") => {
    if (hooks.some((h) => h.type === type)) return;
    hooks.push({
      type,
      summary: clampSummary(summary),
      sourceTurn: opts.currentTurn,
      confidence,
    });
  };
  if (includesAny(text, SHARED_ITEM_TERMS)) add("shared_item", "공유·미반환 물건 흔적", "high");
  if (includesAny(text, SHARED_TASK_TERMS)) add("shared_task", "미완료 공동 업무 흔적", "high");
  if (includesAny(text, PROMISE_TERMS)) add("existing_promise", "기존 약속 흔적", "medium");
  if (includesAny(text, CONTACT_CHANNEL_TERMS)) {
    add("established_contact_channel", "확립된 연락 수단", "high");
  }
  if (includesAny(text, LOCATION_TERMS)) {
    add("known_shared_location", "공유·알려진 장소", "medium");
  }
  if (includesAny(text, SCHEDULE_TERMS)) add("confirmed_schedule", "확정 일정 흔적", "medium");
  if (includesAny(text, ORG_TERMS)) add("shared_organization", "공유 조직·거점", "medium");
  return hooks.slice(0, 4);
}

export function hasGroundedReturnPath(hooks: ReconvergenceHook[]): boolean {
  return hooks.some((h) => GROUNDED_HOOK_TYPES.has(h.type));
}

export function pickReconvergenceMethod(
  state: ReconvergenceState,
  hooks: ReconvergenceHook[]
): { method: ReconvergenceMethod; hook: ReconvergenceHook | null; blocked: boolean } {
  const grounded = hooks.filter((h) => GROUNDED_HOOK_TYPES.has(h.type));
  if (grounded.length === 0) {
    return { method: "relationship_initiative", hook: null, blocked: true };
  }
  const priority: Array<{ method: ReconvergenceMethod; type: ReconvergenceHookType }> = [
    { method: "shared_task", type: "shared_task" },
    { method: "item_return", type: "shared_item" },
    { method: "existing_schedule", type: "existing_promise" },
    { method: "existing_schedule", type: "confirmed_schedule" },
    { method: "shared_location", type: "known_shared_location" },
    { method: "shared_location", type: "shared_organization" },
    { method: "message", type: "established_contact_channel" },
  ];
  for (const p of priority) {
    const hook = grounded.find((h) => h.type === p.type) ?? null;
    if (!hook) continue;
    if (state.lastMethod === p.method) continue;
    return { method: p.method, hook, blocked: false };
  }
  const hook = grounded[0]!;
  const method: ReconvergenceMethod =
    state.lastMethod === "message" ? "shared_location" : "message";
  return { method, hook, blocked: false };
}

export function markReconvergenceOffered(
  state: ReconvergenceState,
  currentTurn: number,
  method: ReconvergenceMethod
): ReconvergenceState {
  return {
    ...state,
    state: "reconvergence_offered",
    offeredTurn: currentTurn,
    lastMethod: method,
    methodCooldownUntilTurn: currentTurn + METHOD_COOLDOWN_TURNS,
    reconvergenceDueTurn: null,
    triggerDeferCount: 0,
    updatedAt: new Date().toISOString(),
  };
}

/**
 * Pure advance — does not persist. Used by prepare().
 */
export function advanceReconvergenceState(opts: {
  previous: ReconvergenceState;
  currentTurn: number;
  currentUserMessage?: string | null;
  recentMessages?: ChatMsg[];
  triggerPresent?: boolean;
  triggerImpliesReunion?: boolean;
  isRegenerate?: boolean;
}): {
  state: ReconvergenceState;
  reasonCodes: string[];
  reconvergenceDue: boolean;
  deferredByTrigger: boolean;
  blockedNoGroundedPath: boolean;
} {
  const reasonCodes: string[] = [];
  let blockedNoGroundedPath = false;
  let next: ReconvergenceState = {
    ...opts.previous,
    unresolvedHooks: [...opts.previous.unresolvedHooks],
  };

  if (opts.isRegenerate) {
    reasonCodes.push("REGENERATE_NO_TURN_ADVANCE");
    return {
      state: next,
      reasonCodes,
      reconvergenceDue: false,
      deferredByTrigger: false,
      blockedNoGroundedPath: false,
    };
  }

  const noContact = detectNoContactKind(opts.currentUserMessage);
  if (noContact) {
    next = {
      ...next,
      state: noContact,
      noContactKind: noContact,
      reconvergenceDueTurn: null,
      updatedAt: new Date().toISOString(),
    };
    reasonCodes.push(
      noContact === "hard_no_contact" ? "HARD_NO_CONTACT" : "TEMPORARY_QUIET"
    );
    return {
      state: next,
      reasonCodes,
      reconvergenceDue: false,
      deferredByTrigger: false,
      blockedNoGroundedPath: false,
    };
  }

  if (next.state === "hard_no_contact" || next.state === "temporary_quiet") {
    if (detectUserInitiatedReconnection(opts.currentUserMessage)) {
      next = {
        ...next,
        state: "together",
        noContactKind: null,
        separationTurn: null,
        reconvergenceDueTurn: null,
        offeredTurn: null,
        triggerDeferCount: 0,
        updatedAt: new Date().toISOString(),
      };
      reasonCodes.push("USER_INITIATED_RECONNECTION");
    }
    return {
      state: next,
      reasonCodes,
      reconvergenceDue: false,
      deferredByTrigger: false,
      blockedNoGroundedPath: false,
    };
  }

  if (
    (next.state === "separated" ||
      next.state === "separation_pending" ||
      next.state === "reconvergence_offered") &&
    detectUserInitiatedReconnection(opts.currentUserMessage)
  ) {
    next = {
      ...next,
      state: "together",
      separationTurn: null,
      reconvergenceDueTurn: null,
      offeredTurn: null,
      noContactKind: null,
      triggerDeferCount: 0,
      updatedAt: new Date().toISOString(),
    };
    reasonCodes.push("USER_INITIATED_RECONNECTION");
    return {
      state: next,
      reasonCodes,
      reconvergenceDue: false,
      deferredByTrigger: false,
      blockedNoGroundedPath: false,
    };
  }

  const freshHooks = extractReconvergenceHooks({
    recentMessages: opts.recentMessages,
    currentUserMessage: opts.currentUserMessage,
    currentTurn: opts.currentTurn,
  });
  for (const hook of freshHooks) {
    if (!next.unresolvedHooks.some((h) => h.type === hook.type)) {
      next.unresolvedHooks.push(hook);
    }
  }
  next.unresolvedHooks = next.unresolvedHooks.slice(0, 6);

  if (opts.triggerImpliesReunion && (next.state === "separated" || next.state === "separation_pending")) {
    next = {
      ...next,
      state: "together",
      separationTurn: null,
      reconvergenceDueTurn: null,
      offeredTurn: opts.currentTurn,
      triggerDeferCount: 0,
      updatedAt: new Date().toISOString(),
    };
    reasonCodes.push("TRIGGER_FULFILLED_RECONVERGENCE");
    return {
      state: next,
      reasonCodes,
      reconvergenceDue: false,
      deferredByTrigger: false,
      blockedNoGroundedPath: false,
    };
  }

  const lastAssistant = [...(opts.recentMessages ?? [])]
    .reverse()
    .find((m) => m.role === "assistant");
  const assistantBlocks = detectAssistantBlocksParting(lastAssistant?.content);

  if (next.state === "together" && detectPartingIntent(opts.currentUserMessage)) {
    if (assistantBlocks) {
      next = {
        ...next,
        state: "separation_pending",
        updatedAt: new Date().toISOString(),
      };
      reasonCodes.push("SEPARATION_PENDING");
    } else {
      next = {
        ...next,
        state: "separated",
        separationTurn: opts.currentTurn,
        reconvergenceDueTurn: opts.currentTurn + 2,
        triggerDeferCount: 0,
        updatedAt: new Date().toISOString(),
      };
      reasonCodes.push("SEPARATED_CONFIRMED");
    }
  } else if (next.state === "separation_pending") {
    if (assistantBlocks) {
      reasonCodes.push("SEPARATION_STILL_PENDING_BLOCK");
    } else {
      next = {
        ...next,
        state: "separated",
        separationTurn: opts.currentTurn,
        reconvergenceDueTurn: opts.currentTurn + 2,
        triggerDeferCount: 0,
        updatedAt: new Date().toISOString(),
      };
      reasonCodes.push("SEPARATED_CONFIRMED");
    }
  }

  let deferredByTrigger = false;
  let reconvergenceDue = false;

  if (next.state === "separated" || next.state === "reconvergence_offered") {
    const due = next.reconvergenceDueTurn;
    if (due != null && opts.currentTurn >= due) {
      if (opts.triggerPresent) {
        if (next.triggerDeferCount >= 1) {
          next = {
            ...next,
            deadlineMissedDueToTrigger: true,
            updatedAt: new Date().toISOString(),
          };
          reasonCodes.push("DEADLINE_MISSED_DUE_TO_TRIGGER");
        } else {
          next = {
            ...next,
            reconvergenceDueTurn: opts.currentTurn + 1,
            triggerDeferCount: next.triggerDeferCount + 1,
            updatedAt: new Date().toISOString(),
          };
          deferredByTrigger = true;
          reasonCodes.push("AUTHORITATIVE_TRIGGER_DEFERRED_RECONVERGENCE");
        }
      } else {
        const cooldownActive =
          next.offeredTurn != null &&
          opts.currentTurn < next.offeredTurn + OFFER_COOLDOWN_TURNS;
        const methodCooldownActive =
          next.methodCooldownUntilTurn != null &&
          opts.currentTurn < next.methodCooldownUntilTurn;
        if (cooldownActive || methodCooldownActive) {
          reasonCodes.push("RECONVERGENCE_COOLDOWN");
        } else if (!hasGroundedReturnPath(next.unresolvedHooks)) {
          blockedNoGroundedPath = true;
          reasonCodes.push("RECONVERGENCE_BLOCKED_NO_GROUNDED_PATH");
        } else {
          reconvergenceDue = true;
          reasonCodes.push("RECONVERGENCE_DUE");
        }
      }
    }
  }

  return {
    state: next,
    reasonCodes,
    reconvergenceDue,
    deferredByTrigger,
    blockedNoGroundedPath,
  };
}

export function prepareReconvergenceTransition(opts: {
  namespace: ReconvergenceNamespace;
  chatId: number;
  characterId: number;
  currentTurn: number;
  currentUserMessage?: string | null;
  recentMessages?: ChatMsg[];
  triggerPresent?: boolean;
  triggerImpliesReunion?: boolean;
  requestId?: string | null;
  generationSequence?: number;
  isRegenerate?: boolean;
  previousOverride?: ReconvergenceState | null;
  db?: Database.Database;
}): PendingReconvergenceTransition {
  const db = opts.db ?? getDb();
  const previous =
    opts.previousOverride ??
    loadReconvergenceState(opts.chatId, opts.characterId, opts.namespace, db);
  const advanced = advanceReconvergenceState({
    previous,
    currentTurn: opts.currentTurn,
    currentUserMessage: opts.currentUserMessage,
    recentMessages: opts.recentMessages,
    triggerPresent: opts.triggerPresent,
    triggerImpliesReunion: opts.triggerImpliesReunion,
    isRegenerate: opts.isRegenerate,
  });
  return {
    namespace: opts.namespace,
    previous,
    next: {
      ...advanced.state,
      chatId: opts.chatId,
      characterId: opts.characterId,
    },
    reasonCodes: advanced.reasonCodes,
    reconvergenceDue: advanced.reconvergenceDue,
    deferredByTrigger: advanced.deferredByTrigger,
    blockedNoGroundedPath: advanced.blockedNoGroundedPath,
    expectedVersion: previous.version,
    requestId: opts.requestId ?? null,
    sourceTurn: opts.currentTurn,
    generationSequence: opts.generationSequence ?? 0,
    isRegenerate: Boolean(opts.isRegenerate),
  };
}

export type CommitReconvergenceResult = {
  committed: boolean;
  reason:
    | "committed"
    | "idempotent_replay"
    | "stale_version"
    | "regenerate_skipped"
    | "missing_request_id";
  state: ReconvergenceState;
};

/**
 * Commit only after authoritative assistant finalize success.
 * Idempotent on (namespace, chat, character, request_id, source_turn, generation_sequence).
 */
export function commitReconvergenceTransition(
  pending: PendingReconvergenceTransition,
  opts: {
    assistantMessageId: number | null;
    db?: Database.Database;
  }
): CommitReconvergenceResult {
  const db = opts.db ?? getDb();
  ensureReconvergenceSchema(db);

  if (pending.isRegenerate) {
    return {
      committed: false,
      reason: "regenerate_skipped",
      state: pending.previous,
    };
  }
  if (!pending.requestId) {
    return {
      committed: false,
      reason: "missing_request_id",
      state: pending.previous,
    };
  }

  const table = tableFor(pending.namespace);
  const tx = db.transaction(() => {
    const existingLog = db
      .prepare(
        `SELECT id FROM chat_reconvergence_transition_log
         WHERE namespace = ? AND chat_id = ? AND character_id = ?
           AND request_id = ? AND source_turn = ? AND generation_sequence = ?`
      )
      .get(
        pending.namespace,
        pending.next.chatId,
        pending.next.characterId,
        pending.requestId,
        pending.sourceTurn,
        pending.generationSequence
      );
    if (existingLog) {
      const current = loadReconvergenceState(
        pending.next.chatId,
        pending.next.characterId,
        pending.namespace,
        db
      );
      return {
        committed: false,
        reason: "idempotent_replay" as const,
        state: current,
      };
    }

    const current = loadReconvergenceState(
      pending.next.chatId,
      pending.next.characterId,
      pending.namespace,
      db
    );
    if (current.version !== pending.expectedVersion) {
      // Stale: if already offered this due window, do not double-offer.
      return {
        committed: false,
        reason: "stale_version" as const,
        state: current,
      };
    }

    const nextVersion = current.version + 1;
    const updatedAt = new Date().toISOString();
    const next = {
      ...pending.next,
      version: nextVersion,
      lastTransitionRequestId: pending.requestId,
      lastAssistantMessageId: opts.assistantMessageId,
      lastGenerationSequence: pending.generationSequence,
      lastSourceTurn: pending.sourceTurn,
      updatedAt,
    };

    db.prepare(
      `INSERT INTO ${table} (
        chat_id, character_id, state, separation_turn, reconvergence_due_turn,
        last_shared_location_key, unresolved_hooks_json, last_method,
        method_cooldown_until_turn, offered_turn, version,
        last_transition_request_id, last_assistant_message_id, last_generation_sequence,
        last_source_turn, trigger_defer_count, no_contact_kind,
        deadline_missed_due_to_trigger, updated_at
        ${pending.namespace === "shadow" ? ", hook_type, reason_codes_json" : ""}
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?
        ${pending.namespace === "shadow" ? ", ?, ?" : ""})
      ON CONFLICT(chat_id, character_id) DO UPDATE SET
        state = excluded.state,
        separation_turn = excluded.separation_turn,
        reconvergence_due_turn = excluded.reconvergence_due_turn,
        last_shared_location_key = excluded.last_shared_location_key,
        unresolved_hooks_json = excluded.unresolved_hooks_json,
        last_method = excluded.last_method,
        method_cooldown_until_turn = excluded.method_cooldown_until_turn,
        offered_turn = excluded.offered_turn,
        version = excluded.version,
        last_transition_request_id = excluded.last_transition_request_id,
        last_assistant_message_id = excluded.last_assistant_message_id,
        last_generation_sequence = excluded.last_generation_sequence,
        last_source_turn = excluded.last_source_turn,
        trigger_defer_count = excluded.trigger_defer_count,
        no_contact_kind = excluded.no_contact_kind,
        deadline_missed_due_to_trigger = excluded.deadline_missed_due_to_trigger,
        updated_at = excluded.updated_at
        ${
          pending.namespace === "shadow"
            ? ", hook_type = excluded.hook_type, reason_codes_json = excluded.reason_codes_json"
            : ""
        }
      WHERE ${table}.version = ?`
    ).run(
      ...(pending.namespace === "shadow"
        ? [
            next.chatId,
            next.characterId,
            next.state,
            next.separationTurn,
            next.reconvergenceDueTurn,
            next.lastSharedLocationKey,
            JSON.stringify(
              next.unresolvedHooks.map((h) => ({
                ...h,
                summary: clampSummary(h.summary),
              }))
            ),
            next.lastMethod,
            next.methodCooldownUntilTurn,
            next.offeredTurn,
            next.version,
            next.lastTransitionRequestId,
            next.lastAssistantMessageId,
            next.lastGenerationSequence,
            next.lastSourceTurn,
            next.triggerDeferCount,
            next.noContactKind,
            next.deadlineMissedDueToTrigger ? 1 : 0,
            updatedAt,
            next.unresolvedHooks[0]?.type ?? null,
            JSON.stringify(pending.reasonCodes),
            pending.expectedVersion,
          ]
        : [
            next.chatId,
            next.characterId,
            next.state,
            next.separationTurn,
            next.reconvergenceDueTurn,
            next.lastSharedLocationKey,
            JSON.stringify(
              next.unresolvedHooks.map((h) => ({
                ...h,
                summary: clampSummary(h.summary),
              }))
            ),
            next.lastMethod,
            next.methodCooldownUntilTurn,
            next.offeredTurn,
            next.version,
            next.lastTransitionRequestId,
            next.lastAssistantMessageId,
            next.lastGenerationSequence,
            next.lastSourceTurn,
            next.triggerDeferCount,
            next.noContactKind,
            next.deadlineMissedDueToTrigger ? 1 : 0,
            updatedAt,
            pending.expectedVersion,
          ])
    );

    const changes = db.prepare("SELECT changes() AS c").get() as { c: number };
    if (!changes.c) {
      const latest = loadReconvergenceState(
        pending.next.chatId,
        pending.next.characterId,
        pending.namespace,
        db
      );
      return {
        committed: false,
        reason: "stale_version" as const,
        state: latest,
      };
    }

    db.prepare(
      `INSERT INTO chat_reconvergence_transition_log (
        namespace, chat_id, character_id, request_id, assistant_message_id,
        generation_sequence, source_turn, from_state, to_state
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`
    ).run(
      pending.namespace,
      next.chatId,
      next.characterId,
      pending.requestId,
      opts.assistantMessageId,
      pending.generationSequence,
      pending.sourceTurn,
      pending.previous.state,
      next.state
    );

    return { committed: true, reason: "committed" as const, state: next };
  });

  return tx();
}

/** @deprecated Prefer prepare+commit. Kept for tests that pass in-memory state. */
export function saveReconvergenceState(
  state: ReconvergenceState,
  namespace: ReconvergenceNamespace = "production",
  db: Database.Database = getDb()
): void {
  ensureReconvergenceSchema(db);
  const pending: PendingReconvergenceTransition = {
    namespace,
    previous: { ...state, version: Math.max(0, state.version - 1) },
    next: state,
    reasonCodes: ["DIRECT_SAVE"],
    reconvergenceDue: false,
    deferredByTrigger: false,
    blockedNoGroundedPath: false,
    expectedVersion: Math.max(0, state.version - 1),
    requestId: state.lastTransitionRequestId ?? `direct-${Date.now()}`,
    sourceTurn: state.lastSourceTurn ?? 0,
    generationSequence: state.lastGenerationSequence ?? 0,
    isRegenerate: false,
  };
  // Force write bypassing CAS for harness helpers.
  const table = tableFor(namespace);
  const updatedAt = new Date().toISOString();
  db.prepare(
    `INSERT INTO ${table} (
      chat_id, character_id, state, separation_turn, reconvergence_due_turn,
      last_shared_location_key, unresolved_hooks_json, last_method,
      method_cooldown_until_turn, offered_turn, version,
      last_transition_request_id, last_assistant_message_id, last_generation_sequence,
      last_source_turn, trigger_defer_count, no_contact_kind,
      deadline_missed_due_to_trigger, updated_at
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    ON CONFLICT(chat_id, character_id) DO UPDATE SET
      state = excluded.state,
      separation_turn = excluded.separation_turn,
      reconvergence_due_turn = excluded.reconvergence_due_turn,
      last_shared_location_key = excluded.last_shared_location_key,
      unresolved_hooks_json = excluded.unresolved_hooks_json,
      last_method = excluded.last_method,
      method_cooldown_until_turn = excluded.method_cooldown_until_turn,
      offered_turn = excluded.offered_turn,
      version = excluded.version,
      last_transition_request_id = excluded.last_transition_request_id,
      last_assistant_message_id = excluded.last_assistant_message_id,
      last_generation_sequence = excluded.last_generation_sequence,
      last_source_turn = excluded.last_source_turn,
      trigger_defer_count = excluded.trigger_defer_count,
      no_contact_kind = excluded.no_contact_kind,
      deadline_missed_due_to_trigger = excluded.deadline_missed_due_to_trigger,
      updated_at = excluded.updated_at`
  ).run(
    state.chatId,
    state.characterId,
    state.state,
    state.separationTurn,
    state.reconvergenceDueTurn,
    state.lastSharedLocationKey,
    JSON.stringify(state.unresolvedHooks.map((h) => ({ ...h, summary: clampSummary(h.summary) }))),
    state.lastMethod,
    state.methodCooldownUntilTurn,
    state.offeredTurn,
    state.version,
    state.lastTransitionRequestId,
    state.lastAssistantMessageId,
    state.lastGenerationSequence,
    state.lastSourceTurn,
    state.triggerDeferCount,
    state.noContactKind,
    state.deadlineMissedDueToTrigger ? 1 : 0,
    updatedAt
  );
  void pending;
}

export const RECONVERGENCE_CONSTANTS = {
  OFFER_COOLDOWN_TURNS,
  METHOD_COOLDOWN_TURNS,
  GROUNDED_HOOK_TYPES,
} as const;
