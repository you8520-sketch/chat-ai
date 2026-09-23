import {
  buildHandoffFixtureCaptureRecord,
  resolveFixturePersistPolicy,
  type HandoffFixtureCaptureRecord,
  type HandoffFixtureRuntimeMetadata,
} from "@/lib/deepseekAdultHandoffFixtureCapture";

/**
 * Explicit ADMIN/AUDIT-only capture. Default OFF.
 * Must not mutate generation, routing, or assembled request bodies.
 * Ordinary user chats are never persisted.
 */

export const ADMIN_HANDOFF_AUDIT_CAPTURE_MODE = "admin_audit_only" as const;

export type AdminHandoffAuditCaptureConfig = {
  enabled: boolean;
  allowedAdminUserIds: ReadonlySet<number>;
  allowedChatIds: ReadonlySet<number>;
};

function envFlag(value: string | undefined, fallback: boolean): boolean {
  const normalized = value?.trim().toLowerCase();
  if (!normalized) return fallback;
  return normalized === "1" || normalized === "true" || normalized === "yes";
}

function parseIdSet(value: string | undefined): ReadonlySet<number> {
  const ids = (value ?? "")
    .split(",")
    .map((entry) => Number.parseInt(entry.trim(), 10))
    .filter((id) => Number.isSafeInteger(id) && id > 0);
  return new Set(ids);
}

export function resolveAdminHandoffAuditCaptureConfig(
  env: NodeJS.ProcessEnv = process.env
): AdminHandoffAuditCaptureConfig {
  return {
    enabled: envFlag(env.ADMIN_HANDOFF_AUDIT_CAPTURE, false),
    allowedAdminUserIds: parseIdSet(env.ADMIN_HANDOFF_AUDIT_USER_IDS),
    allowedChatIds: parseIdSet(env.ADMIN_HANDOFF_AUDIT_CHAT_IDS),
  };
}

export function canCaptureAdminHandoffAudit(input: {
  config: AdminHandoffAuditCaptureConfig;
  isAdmin: boolean;
  userId: number;
  chatId: number;
  ordinaryUserChat: boolean;
}): boolean {
  if (!input.config.enabled) return false;
  if (input.ordinaryUserChat) return false;
  if (!input.isAdmin) return false;
  return (
    input.config.allowedAdminUserIds.has(input.userId) &&
    input.config.allowedChatIds.has(input.chatId)
  );
}

export function buildAdminHandoffAuditRecord(input: {
  sourceModel: string;
  targetModel: string;
  character: string;
  persona: string;
  speechLock: string;
  world: string;
  system: string;
  history: string;
  originAssistantMessageId: string | number | null;
  originAssistantRaw: string | null;
  currentUser: string;
  fullPrompt: string;
  runtime?: HandoffFixtureRuntimeMetadata;
}): HandoffFixtureCaptureRecord {
  const persist = resolveFixturePersistPolicy({
    approvedInternalAuditWorkflow: true,
    ordinaryUserChat: false,
    persistRawBodies: false,
  });
  if (!persist.persistMetadata || persist.persistRawBodies) {
    throw new Error("ADMIN_HANDOFF_AUDIT_PERSIST_POLICY_VIOLATION");
  }
  return buildHandoffFixtureCaptureRecord(input);
}
