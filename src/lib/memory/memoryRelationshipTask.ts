import { getDb } from "@/lib/db";
import {
  isCurrentAssistantGeneration,
  type AssistantGenerationScope,
} from "@/lib/assistantGenerationScope";

export type MemoryRelationshipTaskState =
  | "pending"
  | "succeeded"
  | "failed"
  | "skipped";

export type MemoryRelationshipTaskRecord = {
  state: MemoryRelationshipTaskState;
  updatedAt: string;
  reason?: string;
  generationSequence?: number;
  generationRequestId?: string | null;
};

const TERMINAL_STATES = new Set<MemoryRelationshipTaskState>([
  "succeeded",
  "failed",
  "skipped",
]);

const ALLOWED_TRANSITIONS: Record<
  MemoryRelationshipTaskState | "absent",
  MemoryRelationshipTaskState[]
> = {
  absent: ["pending", "skipped"],
  pending: ["succeeded", "failed"],
  skipped: [],
  succeeded: [],
  failed: [],
};

export function parseMemoryRelationshipTaskRecord(
  raw: string | null | undefined
): MemoryRelationshipTaskRecord | null {
  if (!raw?.trim()) return null;
  try {
    const parsed = JSON.parse(raw) as Partial<MemoryRelationshipTaskRecord>;
    if (
      parsed.state !== "pending" &&
      parsed.state !== "succeeded" &&
      parsed.state !== "failed" &&
      parsed.state !== "skipped"
    ) {
      return null;
    }
    if (typeof parsed.updatedAt !== "string" || !parsed.updatedAt.trim()) {
      return null;
    }
    return {
      state: parsed.state,
      updatedAt: parsed.updatedAt,
      reason: typeof parsed.reason === "string" ? parsed.reason : undefined,
      generationSequence:
        typeof parsed.generationSequence === "number" &&
        Number.isInteger(parsed.generationSequence) &&
        parsed.generationSequence >= 0
          ? parsed.generationSequence
          : undefined,
      generationRequestId:
        typeof parsed.generationRequestId === "string"
          ? parsed.generationRequestId
          : parsed.generationRequestId === null
            ? null
            : undefined,
    };
  } catch {
    return null;
  }
}

export function serializeMemoryRelationshipTaskRecord(
  record: MemoryRelationshipTaskRecord
): string {
  return JSON.stringify(record);
}

export function loadMessageMemoryRelationshipTask(
  messageId: number,
  db: ReturnType<typeof getDb> = getDb()
): MemoryRelationshipTaskRecord | null {
  const row = db
    .prepare("SELECT memory_relationship_task_json FROM messages WHERE id=?")
    .get(messageId) as { memory_relationship_task_json: string | null } | undefined;
  return parseMemoryRelationshipTaskRecord(row?.memory_relationship_task_json ?? null);
}

function canTransition(
  from: MemoryRelationshipTaskState | "absent",
  to: MemoryRelationshipTaskState
): boolean {
  return ALLOWED_TRANSITIONS[from].includes(to);
}

export function skipMemoryRelationshipProviderTask(
  messageId: number | undefined,
  reason: string,
  db: ReturnType<typeof getDb> = getDb(),
  generationScope?: Pick<AssistantGenerationScope, "generationSequence" | "generationRequestId">
): void {
  if (messageId) {
    setMemoryRelationshipTaskState(messageId, "skipped", reason, db, generationScope);
  }
}

/** Canonical logical-task lifecycle write owner — one marker per assistant message. */
export function setMemoryRelationshipTaskState(
  messageId: number,
  next: MemoryRelationshipTaskState,
  reason?: string,
  db: ReturnType<typeof getDb> = getDb(),
  generationScope?: Pick<AssistantGenerationScope, "generationSequence" | "generationRequestId">
): MemoryRelationshipTaskRecord | null {
  const existing = loadMessageMemoryRelationshipTask(messageId, db);
  const from: MemoryRelationshipTaskState | "absent" = existing?.state ?? "absent";

  if (existing?.state === next) {
    return existing;
  }
  if (!canTransition(from, next)) {
    console.warn("[memory-relationship-task] invalid transition", {
      messageId,
      from,
      to: next,
    });
    return existing;
  }

  if (generationScope != null) {
    const scope: AssistantGenerationScope = {
      assistantMessageId: messageId,
      generationSequence: generationScope.generationSequence,
      generationRequestId: generationScope.generationRequestId ?? null,
    };
    if (!isCurrentAssistantGeneration(scope, db)) {
      console.info("STALE_GENERATION_RESULT_REJECTED", {
        family: "memory_relationship",
        messageId,
        generationSequence: generationScope.generationSequence,
        phase: "task_state_write",
        next,
      });
      return existing;
    }
  }

  const record: MemoryRelationshipTaskRecord = {
    state: next,
    updatedAt: new Date().toISOString(),
    reason,
    generationSequence: generationScope?.generationSequence,
    generationRequestId: generationScope?.generationRequestId ?? null,
  };
  db.prepare("UPDATE messages SET memory_relationship_task_json=? WHERE id=?").run(
    serializeMemoryRelationshipTaskRecord(record),
    messageId
  );
  return record;
}

/** Clear durable task marker at generation boundary (e.g. same-message regenerate). */
export function clearMemoryRelationshipTaskMarker(
  messageId: number,
  db: ReturnType<typeof getDb> = getDb()
): void {
  db.prepare("UPDATE messages SET memory_relationship_task_json=NULL WHERE id=?").run(messageId);
}

export function isMemoryRelationshipTaskTerminal(
  record: MemoryRelationshipTaskRecord | null
): boolean {
  return record != null && TERMINAL_STATES.has(record.state);
}
