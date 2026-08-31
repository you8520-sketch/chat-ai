import { getDb } from "@/lib/db";

export type MemoryRelationshipTaskState =
  | "pending"
  | "succeeded"
  | "failed"
  | "skipped";

export type MemoryRelationshipTaskRecord = {
  state: MemoryRelationshipTaskState;
  updatedAt: string;
  reason?: string;
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

/** Canonical logical-task lifecycle write owner — one marker per assistant message. */
export function setMemoryRelationshipTaskState(
  messageId: number,
  next: MemoryRelationshipTaskState,
  reason?: string,
  db: ReturnType<typeof getDb> = getDb()
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

  const record: MemoryRelationshipTaskRecord = {
    state: next,
    updatedAt: new Date().toISOString(),
    reason,
  };
  db.prepare("UPDATE messages SET memory_relationship_task_json=? WHERE id=?").run(
    serializeMemoryRelationshipTaskRecord(record),
    messageId
  );
  return record;
}

export function isMemoryRelationshipTaskTerminal(
  record: MemoryRelationshipTaskRecord | null
): boolean {
  return record != null && TERMINAL_STATES.has(record.state);
}
