import { createHash, randomUUID } from "node:crypto";
import type Database from "better-sqlite3";
import { getDb } from "@/lib/db";
import { ensureInvestigationSchema } from "@/lib/investigationSchema";
import type {
  InvestigationOwnerScope,
  InvestigationResultPayload,
  InvestigationTargetRow,
  InvestigationTargetType,
} from "@/lib/investigationTypes";

export type UpsertInvestigationTargetInput = {
  ownerScope: InvestigationOwnerScope;
  ownerId?: string | null;
  targetType: InvestigationTargetType;
  targetKey: string;
  displayLabel?: string;
  payload: InvestigationResultPayload;
  requiredAccess?: InvestigationResultPayload["requiredAccess"];
};

/** Enforced owner mapping: WORLD/CREATOR are global; PERSONA/CHAT must carry their id. */
export function resolveInvestigationOwnerId(opts: {
  ownerScope: InvestigationOwnerScope;
  ownerId?: string | null;
  worldId?: string | null;
  creatorId?: string | null;
  personaId?: number | null;
  chatId?: number | null;
}): string | null {
  if (opts.ownerScope === "WORLD") return opts.ownerId ?? opts.worldId ?? null;
  if (opts.ownerScope === "CREATOR") return opts.ownerId ?? opts.creatorId ?? null;
  if (opts.ownerScope === "PERSONA") {
    return opts.ownerId ?? (opts.personaId != null ? String(opts.personaId) : null);
  }
  return opts.ownerId ?? (opts.chatId != null ? String(opts.chatId) : null);
}

/**
 * Create/update a concrete investigation target.
 * MUST NOT be called from secret compiler paths — only from presented documents,
 * creator/world systems, or test fixtures.
 */
export function upsertInvestigationTarget(
  input: UpsertInvestigationTargetInput & {
    worldId?: string | null;
    creatorId?: string | null;
    personaId?: number | null;
    chatId?: number | null;
  },
  db: Database.Database = getDb()
): InvestigationTargetRow {
  ensureInvestigationSchema(db);
  const ownerId = resolveInvestigationOwnerId(input);
  const existing = db
    .prepare(
      `SELECT * FROM investigation_targets
       WHERE owner_scope=? AND IFNULL(owner_id,'')=IFNULL(?, '') AND target_key=?`
    )
    .get(input.ownerScope, ownerId, input.targetKey) as
    | InvestigationTargetRow
    | undefined;

  const access = {
    ...(input.payload.requiredAccess ?? {}),
    ...(input.requiredAccess ?? {}),
  };
  const payloadJson = JSON.stringify({
    resultType: input.payload.resultType,
    resultState: input.payload.resultState,
    resultTags: input.payload.resultTags ?? [],
    observableFacts: input.payload.observableFacts ?? [],
    requiredAccess: access,
  });
  const accessJson = JSON.stringify(access);

  if (existing) {
    db.prepare(
      `UPDATE investigation_targets SET
         target_type=?,
         display_label=?,
         required_access_json=?,
         result_payload_json=?,
         is_active=1,
         revision=revision+1,
         updated_at=datetime('now')
       WHERE id=?`
    ).run(
      input.targetType,
      input.displayLabel ?? existing.display_label,
      accessJson,
      payloadJson,
      existing.id
    );
    return db
      .prepare(`SELECT * FROM investigation_targets WHERE id=?`)
      .get(existing.id) as InvestigationTargetRow;
  }

  const id = randomUUID();
  db.prepare(
    `INSERT INTO investigation_targets (
       id, owner_scope, owner_id, target_type, target_key, display_label,
       required_access_json, result_payload_json, is_active, revision
     ) VALUES (?,?,?,?,?,?,?,?,1,1)`
  ).run(
    id,
    input.ownerScope,
    ownerId,
    input.targetType,
    input.targetKey,
    input.displayLabel ?? input.targetKey,
    accessJson,
    payloadJson
  );
  return db
    .prepare(`SELECT * FROM investigation_targets WHERE id=?`)
    .get(id) as InvestigationTargetRow;
}

export function findInvestigationTarget(opts: {
  ownerScope: InvestigationOwnerScope;
  ownerId?: string | null;
  targetKey: string;
  db?: Database.Database;
}): InvestigationTargetRow | null {
  const db = opts.db ?? getDb();
  ensureInvestigationSchema(db);
  const row = db
    .prepare(
      `SELECT * FROM investigation_targets
       WHERE owner_scope=? AND IFNULL(owner_id,'')=IFNULL(?, '')
         AND target_key=? AND is_active=1`
    )
    .get(opts.ownerScope, opts.ownerId ?? null, opts.targetKey) as
    | InvestigationTargetRow
    | undefined;
  return row ?? null;
}

/** Resolve target visible to a chat: CHAT-scoped first, then PERSONA, then WORLD/CREATOR. */
export function resolveAccessibleInvestigationTarget(opts: {
  chatId: number;
  personaId?: number | null;
  targetKey: string;
  db?: Database.Database;
}): InvestigationTargetRow | null {
  const db = opts.db ?? getDb();
  ensureInvestigationSchema(db);
  const chat = findInvestigationTarget({
    ownerScope: "CHAT",
    ownerId: String(opts.chatId),
    targetKey: opts.targetKey,
    db,
  });
  if (chat) return chat;
  if (opts.personaId != null) {
    const persona = findInvestigationTarget({
      ownerScope: "PERSONA",
      ownerId: String(opts.personaId),
      targetKey: opts.targetKey,
      db,
    });
    if (persona) return persona;
  }
  const world = findInvestigationTarget({
    ownerScope: "WORLD",
    ownerId: null,
    targetKey: opts.targetKey,
    db,
  });
  if (world) return world;
  return findInvestigationTarget({
    ownerScope: "CREATOR",
    ownerId: null,
    targetKey: opts.targetKey,
    db,
  });
}

export function parseTargetPayload(
  row: InvestigationTargetRow
): InvestigationResultPayload {
  try {
    const parsed = JSON.parse(row.result_payload_json || "{}") as InvestigationResultPayload;
    return {
      resultType: parsed.resultType,
      resultState: parsed.resultState === "PARTIAL" ? "PARTIAL" : "VERIFIED",
      resultTags: Array.isArray(parsed.resultTags)
        ? parsed.resultTags.map(String).filter(Boolean).slice(0, 12)
        : [],
      observableFacts: Array.isArray(parsed.observableFacts)
        ? parsed.observableFacts.map(String).filter(Boolean).slice(0, 8)
        : [],
      requiredAccess:
        parsed.requiredAccess && typeof parsed.requiredAccess === "object"
          ? parsed.requiredAccess
          : undefined,
    };
  } catch {
    return {
      resultType: "DOCUMENT_CONTENT_VERIFIED",
      resultState: "PARTIAL",
      resultTags: [],
      observableFacts: [],
    };
  }
}

export function hashInvestigationTags(tags: string[]): string {
  const normalized = [...tags].map((t) => t.trim().toLowerCase()).filter(Boolean).sort();
  return createHash("sha256").update(JSON.stringify(normalized), "utf8").digest("hex").slice(0, 16);
}

/**
 * Register a chat-scoped document target only after the document was actually presented
 * in-scene (caller must gate on DOCUMENT_PRESENTED / explicit present). Never from secrets.
 */
export function registerPresentedDocumentTarget(opts: {
  chatId: number;
  documentLabel: string;
  payload: InvestigationResultPayload;
  db?: Database.Database;
}): InvestigationTargetRow {
  const key = `doc:${opts.documentLabel.trim().toLowerCase()}`;
  return upsertInvestigationTarget(
    {
      ownerScope: "CHAT",
      ownerId: String(opts.chatId),
      targetType: "DOCUMENT",
      targetKey: key,
      displayLabel: opts.documentLabel,
      payload: {
        ...opts.payload,
        requiredAccess: {
          requiresPresentedDocument: true,
          allowedActions: ["READ_DOCUMENT", "VERIFY_DOCUMENT"],
          ...(opts.payload.requiredAccess ?? {}),
        },
      },
    },
    opts.db
  );
}
